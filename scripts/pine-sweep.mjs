import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  analyzeJsonlFile,
} from './lib/pine-optimizer.mjs';
import {
  applyPatchPlan,
  buildPatchPlan,
  configIdFromCombo,
  getCandidateGrid,
  leaderboardMarkdown,
  normalizeVariantRecords,
  rankSweepResults,
  selectSweepCombos,
} from './lib/pine-tuner.mjs';

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

function serializeGrid(grid) {
  return Object.fromEntries(
    Object.entries(grid)
      .filter(([key]) => !key.startsWith('__'))
      .map(([key, values]) => [key, [...values]]),
  );
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
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`node ${args.join(' ')} failed with code ${code}`));
      }
    });
  });
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {}
}

async function writeSweepFiles(runDir, results, meta) {
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

  const input = args.input || args._[0] || './pine/test.pine';
  const symbol = args.symbol || args._[1] || 'XRPUSDT';
  const timeframe = args.timeframe || args._[2] || '15m';
  const limit = String(args.limit || args._[3] || '5000');
  const maxConfigs = args['max-configs'] ? Number(args['max-configs']) : null;
  const offset = args.offset ? Number(args.offset) : 0;
  const keepArtifacts = Boolean(args['keep-artifacts']);
  const minTrades = args['min-trades'] ? Number(args['min-trades']) : 10;
  const when = args.when ? String(args.when) : null;
  const exchange = args.exchange ? String(args.exchange) : null;
  const noCache = Boolean(args['no-cache']);
  const requireCacheComplete = Boolean(args['require-cache-complete']);
  const cacheRoot = args['cache-root'] ? String(args['cache-root']) : null;
  const cacheExchange = args['cache-exchange'] ? String(args['cache-exchange']) : null;
  const gridName = String(args.grid || 'default');
  const runId = args['run-id'] || `sweep-${gridName}-${symbol}-${timeframe}-${limit}-${timestampId()}`;

  const inputPath = path.resolve(cwd, input);
  const source = await fs.readFile(inputPath, 'utf8');
  const grid = getCandidateGrid(gridName);
  const variantFile = args['variant-file'] ? path.resolve(cwd, args['variant-file']) : null;
  const rawVariants = variantFile ? JSON.parse(await fs.readFile(variantFile, 'utf8')) : null;
  if (rawVariants && !Array.isArray(rawVariants)) {
    throw new Error(`variant-file must contain a JSON array of variant records: ${variantFile}`);
  }
  const variantRecords = rawVariants
    ? normalizeVariantRecords(rawVariants)
    : selectSweepCombos(grid, { maxConfigs, offset }).map((config, index) => ({
        variantId: `variant-${index + 1}`,
        lane: 'grid',
        family: gridName,
        config,
      }));

  const runDir = path.resolve(cwd, 'pine', 'sweeps', runId);
  const variantsDir = path.join(runDir, 'variants');
  await fs.mkdir(variantsDir, { recursive: true });

  const meta = {
    runId,
    inputPath,
    symbol,
    timeframe,
    limit: Number(limit),
    minTrades,
    candidateGrid: serializeGrid(grid),
    gridName,
    configCount: variantRecords.length,
    variantFile,
    variantCount: variantRecords.length,
    sweepOffset: offset,
    when,
    exchange,
  };
  await fs.writeFile(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  const results = [];
  const cliScript = path.resolve(cwd, 'scripts', 'pine-import-run-clean.mjs');

  for (let index = 0; index < variantRecords.length; index++) {
    const record = variantRecords[index];
    const combo = record.config;
    const configId = configIdFromCombo(index, combo);
    const artifactId = `cfg-${String(index + 1).padStart(4, '0')}`;
    const patchPlan = buildPatchPlan(combo);
    const patchedSource = applyPatchPlan(source, patchPlan);
    const variantPath = path.join(variantsDir, `${artifactId}.pine`);
    const outputBase = artifactId;
    const flattenedPath = variantPath.replace(/\.pine$/i, '.flattened.pine');
    const dumpDir = path.join(variantsDir, 'dump');
    const rawPath = path.join(dumpDir, `${outputBase}.jsonl`);
    const cleanedPath = path.join(dumpDir, `${outputBase}.cleaned.jsonl`);
    const signalsPath = path.join(dumpDir, `${outputBase}.signals.jsonl`);

    console.log(`\n[sweep ${index + 1}/${variantRecords.length}] ${configId}`);

    try {
      await fs.writeFile(variantPath, patchedSource, 'utf8');
      const runArgs = [
        cliScript,
        '--input', variantPath,
        '--symbol', symbol,
        '--timeframe', timeframe,
        '--limit', limit,
        '--output', outputBase,
      ];
      if (when) {
        runArgs.push('--when', when);
      }
      if (exchange) {
        runArgs.push('--exchange', exchange);
      }
      if (noCache) {
        runArgs.push('--no-cache');
      }
      if (requireCacheComplete) {
        runArgs.push('--require-cache-complete');
      }
      if (cacheRoot) {
        runArgs.push('--cache-root', cacheRoot);
      }
      if (cacheExchange) {
        runArgs.push('--cache-exchange', cacheExchange);
      }

      await runNode(runArgs, cwd);

      const analysis = await analyzeJsonlFile(cleanedPath, { minTrades });
      const result = {
        status: 'ok',
        configId,
        variantId: record.variantId,
        lane: record.lane,
        family: record.family,
        artifactId,
        config: combo,
        score: analysis.score,
        rowCount: analysis.rowCount,
        timeframeMinutes: analysis.timeframeMinutes,
        metrics: analysis.metrics,
        diagnostics: analysis.diagnostics,
        tradePreview: analysis.trades.slice(0, 10),
        patchedSource,
      };
      results.push(result);

      console.log(`[result] score=${result.score} trades=${result.metrics.tradeCount} roi=${result.metrics.roiPct} winRate=${result.metrics.winRatePct} baseLong=${result.diagnostics.baseStartLongCount} baseShort=${result.diagnostics.baseStartShortCount}`);
    } catch (error) {
      results.push({
        status: 'failed',
        configId,
        variantId: record.variantId,
        lane: record.lane,
        family: record.family,
        artifactId,
        config: combo,
        error: error?.message || String(error),
      });
      console.error(`[failed] ${configId}: ${error?.message || error}`);
    }

    await writeSweepFiles(runDir, results, meta);

    if (!keepArtifacts) {
      await safeUnlink(variantPath);
      await safeUnlink(flattenedPath);
      await safeUnlink(rawPath);
      await safeUnlink(cleanedPath);
      await safeUnlink(signalsPath);
    }
  }

  const ranked = rankSweepResults(results.filter((r) => r.status === 'ok'));
  console.log(`\n[done] runDir=${runDir}`);
  if (ranked[0]) {
    console.log(`[best] ${ranked[0].configId} score=${ranked[0].score} trades=${ranked[0].metrics.tradeCount} roi=${ranked[0].metrics.roiPct} winRate=${ranked[0].metrics.winRatePct}`);
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
