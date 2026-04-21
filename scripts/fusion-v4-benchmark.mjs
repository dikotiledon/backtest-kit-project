import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { analyzeJsonlFile } from './lib/pine-optimizer.mjs';
import { applyPatchPlan, buildPatchPlan, cartesianProduct, filterSweepCombos, getCandidateGrid, configIdFromCombo, rankSweepResults, leaderboardMarkdown } from './lib/pine-tuner.mjs';

const cwd = process.cwd();
const inputPath = path.resolve(cwd, 'pine/test.pine');
const source = await fs.readFile(inputPath, 'utf8');
const when = '2026-04-21T10:30:00.000Z';
const runId = 'fixed-window-fusion-v4-XRPUSDT-15m-10000-2026-04-21T10-30-00Z';
const runDir = path.resolve(cwd, 'pine', 'sweeps', runId);
const variantsDir = path.join(runDir, 'variants');
await fs.mkdir(variantsDir, { recursive: true });

function runNode(args, cwd) {
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
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr, code }) : reject(new Error(`node ${args.join(' ')} failed with code ${code}`)));
  });
}

async function safeUnlink(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {}
}

async function writeSweepFiles(results) {
  const ranked = rankSweepResults(results.filter((r) => r.status === 'ok'));
  const payload = {
    generatedAt: new Date().toISOString(),
    when,
    resultCount: results.length,
    ranked,
    failures: results.filter((r) => r.status !== 'ok'),
  };
  await fs.writeFile(path.join(runDir, 'leaderboard.json'), JSON.stringify(payload, null, 2), 'utf8');
  await fs.writeFile(path.join(runDir, 'leaderboard.md'), leaderboardMarkdown(ranked), 'utf8');
  if (ranked[0]?.patchedSource) {
    await fs.writeFile(path.join(runDir, 'best-config.pine'), ranked[0].patchedSource, 'utf8');
    await fs.writeFile(path.join(runDir, 'best-config.json'), JSON.stringify(ranked[0], null, 2), 'utf8');
  }
}

const control = {
  useRegimeFilter: false,
  useVolatilityFilter: false,
  useAdxFilter: true,
  adxThreshold: 20,
  minPredSum: 2.0,
  useTrendXConf: true,
  minBarsBetween: 2,
  slAtrMult: 1.0,
  tpAtrMult: 2.5,
  useSignalFusion: false,
  useFusionV2: false,
  useFusionV3: false,
  useFusionV4: false,
  minFusionScore: 1,
  useAtrFlipConfirm: false,
  use3LineConfirm: false,
  useEngulfingConfirm: false,
  useEmaCrossConfirm: false,
  fusionBonusPerSignal: 0.25,
  fusionMaxBonus: 0.5,
  fusionPenaltyPerMissing: 0.25,
  fusionV4MinAbsPrediction: 2.0,
  fusionV4MaxAbsPrediction: 4.0,
  fusionV4LongAtrWeight: -0.25,
  fusionV4LongEngulfWeight: -0.25,
  fusionV4LongEmaWeight: 0.0,
  fusionV4ShortAtrWeight: -0.5,
  fusionV4ShortEngulfWeight: -0.1,
  fusionV4ShortEmaWeight: 0.0,
};

const v4Grid = filterSweepCombos(cartesianProduct(getCandidateGrid('fusion-v4'))).map((combo) => ({
  ...control,
  ...combo,
}));

const manualVariants = [
  {
    ...control,
    useSignalFusion: true,
    useFusionV4: true,
    fusionV4MinAbsPrediction: 2.0,
    fusionV4MaxAbsPrediction: 2.0,
    useAtrFlipConfirm: true,
    useEngulfingConfirm: true,
    useEmaCrossConfirm: false,
    fusionV4ShortEngulfWeight: 0.0,
  },
  {
    ...control,
    useSignalFusion: true,
    useFusionV4: true,
    fusionV4MinAbsPrediction: 2.0,
    fusionV4MaxAbsPrediction: 2.0,
    useAtrFlipConfirm: true,
    useEngulfingConfirm: false,
    useEmaCrossConfirm: true,
    fusionV4ShortEmaWeight: 0.25,
  },
];

const allCombos = [...v4Grid, ...manualVariants];
const seen = new Set();
const combos = allCombos.filter((combo) => {
  const key = JSON.stringify(combo);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

const configs = [{ label: 'control-2.0', combo: control }, ...combos.map((combo, idx) => ({ label: `fusion-v4-${String(idx + 1).padStart(2, '0')}`, combo }))];
const results = [];
const cliScript = path.resolve(cwd, 'scripts', 'pine-import-run-clean.mjs');

for (let index = 0; index < configs.length; index++) {
  const item = configs[index];
  const artifactId = `cfg-${String(index + 1).padStart(4, '0')}`;
  const configId = item.label === 'control-2.0' ? item.label : configIdFromCombo(index, item.combo);
  const variantPath = path.join(variantsDir, `${artifactId}.pine`);
  const cleanedPath = path.join(variantsDir, 'dump', `${artifactId}.cleaned.jsonl`);
  const patchPlan = buildPatchPlan(item.combo);
  const patchedSource = applyPatchPlan(source, patchPlan);
  const flattenedPath = variantPath.replace(/\.pine$/i, '.flattened.pine');
  const rawPath = path.join(variantsDir, 'dump', `${artifactId}.jsonl`);
  const signalsPath = path.join(variantsDir, 'dump', `${artifactId}.signals.jsonl`);

  console.log(`\n[grid ${index + 1}/${configs.length}] ${item.label}`);

  try {
    await fs.writeFile(variantPath, patchedSource, 'utf8');
    await runNode([
      cliScript,
      '--input', variantPath,
      '--symbol', 'XRPUSDT',
      '--timeframe', '15m',
      '--limit', '10000',
      '--output', artifactId,
      '--when', when,
    ], cwd);
    const analysis = await analyzeJsonlFile(cleanedPath, { minTrades: 10 });
    results.push({
      status: 'ok',
      label: item.label,
      configId,
      artifactId,
      config: item.combo,
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
    results.push({ status: 'failed', label: item.label, configId, artifactId, config: item.combo, error: error?.message || String(error) });
    console.error(`[failed] ${item.label}: ${error?.message || error}`);
  }

  await writeSweepFiles(results);
  await safeUnlink(variantPath);
  await safeUnlink(flattenedPath);
  await safeUnlink(rawPath);
  await safeUnlink(cleanedPath);
  await safeUnlink(signalsPath);
}

const ranked = rankSweepResults(results.filter((r) => r.status === 'ok'));
console.log(`\n[done] runDir=${runDir}`);
if (ranked[0]) {
  console.log(`[best] ${ranked[0].label} score=${ranked[0].score} trades=${ranked[0].metrics.tradeCount} roi=${ranked[0].metrics.roiPct} winRate=${ranked[0].metrics.winRatePct}`);
}
