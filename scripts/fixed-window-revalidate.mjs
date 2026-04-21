import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { analyzeJsonlFile } from './lib/pine-optimizer.mjs';
import { applyPatchPlan, buildPatchPlan, leaderboardMarkdown, rankSweepResults } from './lib/pine-tuner.mjs';

const DEFAULT_CONFIGS = [
  {
    label: 'control',
    config: {
      useRegimeFilter: false,
      useVolatilityFilter: false,
      useAdxFilter: true,
      adxThreshold: 20,
      minPredSum: 0.5,
      useTrendXConf: true,
      minBarsBetween: 2,
      slAtrMult: 1.0,
      tpAtrMult: 2.5,
      useSignalFusion: false,
      minFusionScore: 1,
      useAtrFlipConfirm: false,
      use3LineConfirm: false,
      useEngulfingConfirm: false,
      useEmaCrossConfirm: false,
    },
  },
  {
    label: 'fusion-atr-only',
    config: {
      useRegimeFilter: false,
      useVolatilityFilter: false,
      useAdxFilter: true,
      adxThreshold: 20,
      minPredSum: 0.5,
      useTrendXConf: true,
      minBarsBetween: 2,
      slAtrMult: 1.0,
      tpAtrMult: 2.5,
      useSignalFusion: true,
      minFusionScore: 1,
      useAtrFlipConfirm: true,
      use3LineConfirm: false,
      useEngulfingConfirm: false,
      useEmaCrossConfirm: false,
    },
  },
  {
    label: 'fusion-atr-ema',
    config: {
      useRegimeFilter: false,
      useVolatilityFilter: false,
      useAdxFilter: true,
      adxThreshold: 20,
      minPredSum: 0.5,
      useTrendXConf: true,
      minBarsBetween: 2,
      slAtrMult: 1.0,
      tpAtrMult: 2.5,
      useSignalFusion: true,
      minFusionScore: 1,
      useAtrFlipConfirm: true,
      use3LineConfirm: false,
      useEngulfingConfirm: false,
      useEmaCrossConfirm: true,
    },
  },
  {
    label: 'fusion-atr-3line',
    config: {
      useRegimeFilter: false,
      useVolatilityFilter: false,
      useAdxFilter: true,
      adxThreshold: 20,
      minPredSum: 0.5,
      useTrendXConf: true,
      minBarsBetween: 2,
      slAtrMult: 1.0,
      tpAtrMult: 2.5,
      useSignalFusion: true,
      minFusionScore: 1,
      useAtrFlipConfirm: true,
      use3LineConfirm: true,
      useEngulfingConfirm: false,
      useEmaCrossConfirm: false,
    },
  },
];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function compactName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr, code });
      reject(new Error(`node ${args.join(' ')} failed with code ${code}`));
    });
  });
}

async function writeOutputs(runDir, results, meta) {
  const ranked = rankSweepResults(results.filter((r) => r.status === 'ok'));
  const payload = {
    meta,
    generatedAt: new Date().toISOString(),
    resultCount: results.length,
    ranked,
    failures: results.filter((r) => r.status !== 'ok'),
  };

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'leaderboard.json'), JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(path.join(runDir, 'leaderboard.md'), leaderboardMarkdown(ranked), 'utf8');

  if (ranked[0]?.patchedSource) {
    await fs.writeFile(path.join(runDir, 'best-config.pine'), ranked[0].patchedSource, 'utf8');
    await fs.writeFile(path.join(runDir, 'best-config.json'), JSON.stringify(ranked[0], null, 2), 'utf8');
  }
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  const input = args.input || './pine/test.pine';
  const symbol = args.symbol || 'XRPUSDT';
  const timeframe = args.timeframe || '15m';
  const limit = String(args.limit || '10000');
  const when = String(args.when || '');
  const exchange = args.exchange ? String(args.exchange) : null;
  const minTrades = args['min-trades'] ? Number(args['min-trades']) : 10;
  const runId = args['run-id'] || `fixed-window-${symbol}-${timeframe}-${limit}-${compactName(when || timestampId())}`;

  if (!when) {
    throw new Error('Missing required --when anchor for fixed-window revalidation');
  }

  const inputPath = path.resolve(cwd, input);
  const source = await fs.readFile(inputPath, 'utf8');
  const runDir = path.resolve(cwd, 'pine', 'sweeps', runId);
  const variantsDir = path.join(runDir, 'variants');
  await fs.mkdir(variantsDir, { recursive: true });

  const meta = {
    runId,
    inputPath,
    symbol,
    timeframe,
    limit: Number(limit),
    when,
    exchange,
    minTrades,
    configs: DEFAULT_CONFIGS,
  };
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const cliScript = path.resolve(cwd, 'scripts', 'pine-import-run-clean.mjs');
  const results = [];

  for (let index = 0; index < DEFAULT_CONFIGS.length; index++) {
    const item = DEFAULT_CONFIGS[index];
    const artifactId = `cfg-${String(index + 1).padStart(4, '0')}`;
    const configId = `${artifactId}__${item.label}`;
    const patchPlan = buildPatchPlan(item.config);
    const patchedSource = applyPatchPlan(source, patchPlan);
    const variantPath = path.join(variantsDir, `${artifactId}.pine`);
    const cleanedPath = path.join(variantsDir, 'dump', `${artifactId}.cleaned.jsonl`);

    console.log(`\n[revalidate ${index + 1}/${DEFAULT_CONFIGS.length}] ${item.label}`);

    try {
      await fs.writeFile(variantPath, patchedSource, 'utf8');
      const runArgs = [
        cliScript,
        '--input', variantPath,
        '--symbol', symbol,
        '--timeframe', timeframe,
        '--limit', limit,
        '--output', artifactId,
        '--when', when,
      ];
      if (exchange) {
        runArgs.push('--exchange', exchange);
      }

      await runNode(runArgs, cwd);
      const analysis = await analyzeJsonlFile(cleanedPath, { minTrades });
      results.push({
        status: 'ok',
        label: item.label,
        configId,
        artifactId,
        config: item.config,
        score: analysis.score,
        rowCount: analysis.rowCount,
        timeframeMinutes: analysis.timeframeMinutes,
        metrics: analysis.metrics,
        diagnostics: analysis.diagnostics,
        tradePreview: analysis.trades.slice(0, 10),
        patchedSource,
      });
      console.log(`[result] ${item.label} score=${analysis.score} trades=${analysis.metrics.tradeCount} roi=${analysis.metrics.roiPct} winRate=${analysis.metrics.winRatePct}`);
    } catch (error) {
      results.push({
        status: 'failed',
        label: item.label,
        configId,
        artifactId,
        config: item.config,
        error: error?.message || String(error),
      });
      console.error(`[failed] ${item.label}: ${error?.message || error}`);
    }

    await writeOutputs(runDir, results, meta);
  }

  const ranked = rankSweepResults(results.filter((r) => r.status === 'ok'));
  console.log(`\n[done] runDir=${runDir}`);
  if (ranked[0]) {
    console.log(`[best] ${ranked[0].label} score=${ranked[0].score} trades=${ranked[0].metrics.tradeCount} roi=${ranked[0].metrics.roiPct} winRate=${ranked[0].metrics.winRatePct}`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
