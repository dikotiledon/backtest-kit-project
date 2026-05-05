import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParetoShortlist,
  computeParameterComplexityPenalty,
  computeSweepOffset,
  decideAutoPromotionAction,
  decideAutoresearchOutcome,
  decideMatrixPromotion,
  extractChampionBootstrapCandidate,
  partitionLabs,
  planArtifactPrune,
  renderDigestMarkdown,
  sameConfig,
  selectChampionBootstrapSource,
  selectRobustMatrixCandidate,
  summarizeDigestAnnouncement,
} from '../scripts/lib/pine-autoresearch.mjs';
import { buildPromotionQueueItem } from '../scripts/lib/pine-promotion-queue.mjs';
import * as autoresearchCli from '../scripts/pine-autoresearch.mjs';
import {
  buildScoutOrchestrationState,
  buildScoutRegimeAnalysisArtifact,
  decideCycleStartAction,
  canForceQueuedPromotion,
  decideQueuedPromotionAction,
  evaluateMatrix,
  ensureChampionState,
  latestManifestPath,
  loadConfig,
  manifestsDir,
  resolveAutopromoteQueueStatus,
  mergeSchedulerTabuFingerprints,
  resolvePromotionManifestPath,
  resolveTrackSelectionState,
  selectChangedMatrixCandidate,
  selectPromotionManifestSource,
  shouldQueuePromotionManifest,
  withManifestPath,
  applySchedulerStateToManifest,
  buildOfflineDataMissingCycleEvent,
  buildOfflineDataMissingSkipResult,
} from '../scripts/pine-autoresearch.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runPwsh(command, { cwd = repoRoot } = {}) {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
      cwd,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message ? `\n${error.message}` : ''}`.trim() }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runPwshFile(scriptPath, args = [], { cwd = repoRoot } = {}) {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath, ...args], {
      cwd,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message ? `\n${error.message}` : ''}`.trim() }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

function makeResult({
  configId,
  score,
  tradeCount,
  roiPct,
  profitFactor,
  maxDrawdownPct,
  avgWin,
  avgLoss,
  config,
}) {
  return {
    configId,
    score,
    config: config || { configId },
    metrics: {
      tradeCount,
      roiPct,
      profitFactor,
      maxDrawdownPct,
      avgWin,
      avgLoss,
    },
  };
}

test('sameConfig compares deep config content, not object identity', () => {
  assert.equal(sameConfig({ a: 1, nested: { b: true } }, { nested: { b: true }, a: 1 }), true);
  assert.equal(sameConfig({ a: 1 }, { a: 2 }), false);
});

test('resolvePromotionManifestPath prefers explicit manifest over run-id', () => {
  const config = { researchRoot: 'D:\\tmp\\research' };
  const result = resolvePromotionManifestPath({
    config,
    args: {
      manifest: 'D:\\override\\manifest.json',
      'run-id': 'run-123',
    },
  });

  assert.equal(result, 'D:\\override\\manifest.json');
});

test('resolvePromotionManifestPath resolves run-id under manifests dir', () => {
  const config = { researchRoot: 'D:\\tmp\\research' };
  const result = resolvePromotionManifestPath({
    config,
    args: { 'run-id': 'run-123' },
  });

  assert.equal(result, path.join(config.researchRoot, 'manifests', 'run-123.json'));
});

test('resolvePromotionManifestPath rejects unsafe run-id patterns', () => {
  const config = { researchRoot: 'D:\\tmp\\research' };
  const unsafeRunIds = [
    '/absolute',
    'foo/bar',
    '..',
    'a/../b',
    '../evil',
    'foo\\bar',
    'foo/..\\bar',
  ];

  for (const runId of unsafeRunIds) {
    assert.throws(() => resolvePromotionManifestPath({ config, args: { 'run-id': runId } }), (error) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error.message, `Invalid run-id for manifest lookup: ${runId}`);
      return true;
    });
  }
});

test('selectPromotionManifestSource preserves manifestOverride reference', () => {
  const manifestOverride = {
    runId: 'run-override',
    challenger: { configId: 'challenger', config: { a: 1 } },
    matrixDecision: { recommendation: 'promote' },
  };
  const selected = selectPromotionManifestSource({
    latest: { runId: 'run-loaded', challenger: { configId: 'loaded', config: { a: 2 } }, matrixDecision: { recommendation: 'promote' } },
    explicitManifestPath: 'D:\\tmp\\research\\manifests\\run-override.json',
    manifestOverride,
  });

  assert.equal(selected, manifestOverride);
  assert.equal(manifestOverride.manifestPath, undefined);
});

test('withManifestPath copies manifest and preserves exact queued path', () => {
  const manifest = {
    runId: 'run-queued',
    challenger: { configId: 'challenger', config: { a: 1 } },
    matrixDecision: { recommendation: 'promote' },
  };

  const selected = withManifestPath(manifest, 'pine/autoresearch/m/manifests/run-queued.json');

  assert.notEqual(selected, manifest);
  assert.equal(manifest.manifestPath, undefined);
  assert.equal(selected.manifestPath, 'pine/autoresearch/m/manifests/run-queued.json');
});

test('selectPromotionManifestSource backfills manifestPath for explicit manifest loads', () => {
  const latest = {
    runId: 'run-loaded',
    challenger: { configId: 'loaded', config: { a: 2 } },
    matrixDecision: { recommendation: 'promote' },
  };
  const selected = selectPromotionManifestSource({
    latest,
    explicitManifestPath: 'D:\\tmp\\research\\manifests\\run-loaded.json',
  });

  assert.notEqual(selected, latest);
  assert.equal(selected.manifestPath, 'D:\\tmp\\research\\manifests\\run-loaded.json');
  assert.equal(latest.manifestPath, undefined);
});

test('resolvePromotionManifestPath returns null without explicit target', () => {
  const result = resolvePromotionManifestPath({ config: { researchRoot: 'D:\\tmp\\research' }, args: {} });

  assert.equal(result, null);
});

test('pine autoresearch exposes neutral evaluator seams for external lanes', () => {
  assert.equal(typeof evaluateMatrix, 'function');
  assert.equal(typeof ensureChampionState, 'function');
  assert.equal(typeof latestManifestPath, 'function');
  assert.equal(typeof manifestsDir, 'function');
});

test('pine-autoresearch-run.ps1 parses cleanly', async () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const command = `$null = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile(${psSingleQuote(scriptPath)}, [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_.Message }; exit 1 }`;
  const result = await runPwsh(command);

  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test('pine-autoresearch-run.ps1 dry-run skips lock acquisition', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-dry-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const markerPath = path.join(tempRoot, 'marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'dry-run-check',
    '-Command', `Set-Content -LiteralPath ${psSingleQuote(markerPath)} -Value 'ran'`,
    '-RepoRoot', tempRoot,
    '-DryRun',
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /\[dry-run\]/);
  assert.equal(await readIfExists(path.join(tempRoot, 'tmp', 'pine-autoresearch-locks', 'scheduler.lock')), null);
  assert.equal(await readIfExists(markerPath), null);
});

test('pine-autoresearch-run.ps1 skips a fresh scheduler lock', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-fresh-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, 'scheduler.lock'), [
    'task=fresh-check',
    `pid=${process.pid}`,
    `startedAt=${new Date().toISOString()}`,
    '',
  ].join('\n'), 'utf8');
  const markerPath = path.join(tempRoot, 'fresh-marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'fresh-check',
    '-Command', `Set-Content -LiteralPath ${psSingleQuote(markerPath)} -Value 'ran'`,
    '-RepoRoot', tempRoot,
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /skipped: scheduler lock exists/);
  assert.equal(await readIfExists(markerPath), null);
  assert.notEqual(await readIfExists(path.join(lockDir, 'scheduler.lock')), null);
});

test('pine-autoresearch-run.ps1 reclaims a stale dead scheduler lock', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-stale-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, 'scheduler.lock'), [
    'task=stale-check',
    'pid=99999999',
    `startedAt=${new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()}`,
    '',
  ].join('\n'), 'utf8');
  const markerPath = path.join(tempRoot, 'stale-marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'stale-check',
    '-Command', `Set-Content -LiteralPath ${psSingleQuote(markerPath)} -Value 'ran'`,
    '-RepoRoot', tempRoot,
    '-LockName', `Global\\BacktestKit-Pine-Autoresearch-Test-Stale-${process.pid}`,
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /scheduler lock stale; reclaiming/);
  assert.equal((await readIfExists(markerPath))?.trim(), 'ran');
  assert.equal(await readIfExists(path.join(lockDir, 'scheduler.lock')), null);
});

test('pine-autoresearch-run.ps1 reclaims stale scheduler lock when pid was reused by another process', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-reused-pid-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(path.join(lockDir, 'scheduler.lock'), [
    'task=reused-pid-check',
    'pid=' + process.pid,
    'startedAt=' + new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
    '',
  ].join('\n'), 'utf8');
  const markerPath = path.join(tempRoot, 'reused-pid-marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'reused-pid-check',
    '-Command', 'Set-Content -LiteralPath ' + psSingleQuote(markerPath) + " -Value 'ran'",
    '-RepoRoot', tempRoot,
    '-LockName', 'Global\\BacktestKit-Pine-Autoresearch-Test-Reused-' + process.pid,
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /scheduler lock stale; reclaiming/);
  assert.equal((await readIfExists(markerPath))?.trim(), 'ran');
  assert.equal(await readIfExists(path.join(lockDir, 'scheduler.lock')), null);
});

test('pine-autoresearch-run.ps1 removes its lock after a nonzero command', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-fail-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const lockPath = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks', 'scheduler.lock');
  const markerPath = path.join(tempRoot, 'nonzero-marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'fail-check',
    '-Command', `Set-Content -LiteralPath ${psSingleQuote(markerPath)} -Value 'ran'; exit 7`,
    '-RepoRoot', tempRoot,
    '-LockName', `Global\\BacktestKit-Pine-Autoresearch-Test-Fail-${process.pid}`,
  ], { cwd: repoRoot });

  assert.notEqual(result.code, 0);
  assert.equal((await readIfExists(markerPath))?.trim(), 'ran');
  assert.equal(await readIfExists(lockPath), null);
});

test('autoresearchLockPath points at state/autoresearch.lock.json', () => {
  const result = autoresearchCli.autoresearchLockPath({ researchRoot: 'pine/autoresearch/matrix-a' });

  assert.equal(result, path.join('pine/autoresearch/matrix-a', 'state', 'autoresearch.lock.json'));
});

test('shouldUseAutoresearchLock only wraps state-mutating commands', () => {
  assert.equal(autoresearchCli.shouldUseAutoresearchLock('cycle'), true);
  assert.equal(autoresearchCli.shouldUseAutoresearchLock('promote'), true);
  assert.equal(autoresearchCli.shouldUseAutoresearchLock('autopromote'), true);
  assert.equal(autoresearchCli.shouldUseAutoresearchLock('digest'), false);
  assert.equal(autoresearchCli.shouldUseAutoresearchLock('holdout'), false);
});

test('formatAutoresearchLockSkip preserves reclaim_in_progress reason', () => {
  const result = autoresearchCli.formatAutoresearchLockSkip('cycle', {
    reason: 'reclaim_in_progress',
    currentOwner: { command: 'autopromote', profile: 'matrix-a' },
  });

  assert.equal(result, '[autoresearch] cycle=skipped reason=reclaim_in_progress owner=autopromote profile=matrix-a');
});

test('decideAutoresearchOutcome recommends promote when all gates pass', () => {
  const incumbent = makeResult({
    configId: 'incumbent',
    score: 60.26,
    tradeCount: 241,
    roiPct: 38.44,
    profitFactor: 1.51,
    maxDrawdownPct: 5.06,
  });

  const challenger = makeResult({
    configId: 'challenger',
    score: 60.75,
    tradeCount: 230,
    roiPct: 39.1,
    profitFactor: 1.58,
    maxDrawdownPct: 5.2,
  });

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
  });

  assert.equal(result.recommendation, 'promote');
  assert.deepEqual(result.failedGates, []);
});

test('decideAutoresearchOutcome recommends hold when trade ratio collapses', () => {
  const incumbent = makeResult({
    configId: 'incumbent',
    score: 60.26,
    tradeCount: 241,
    roiPct: 38.44,
    profitFactor: 1.51,
    maxDrawdownPct: 5.06,
  });

  const challenger = makeResult({
    configId: 'challenger-low-trades',
    score: 61.4,
    tradeCount: 110,
    roiPct: 41.2,
    profitFactor: 1.8,
    maxDrawdownPct: 4.5,
  });

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.deepEqual(result.failedGates, ['tradeFloor', 'tradeRatio']);
});

test('decideAutoresearchOutcome marks unchanged challenger as steady-state hold', () => {
  const incumbent = makeResult({
    configId: 'champion',
    score: 70.78,
    tradeCount: 239,
    roiPct: 47.19,
    profitFactor: 1.8,
    maxDrawdownPct: 4.45,
    config: { minPredSum: 2, useTrailingStop: true },
  });

  const challenger = makeResult({
    configId: 'champion',
    score: 70.78,
    tradeCount: 239,
    roiPct: 47.19,
    profitFactor: 1.8,
    maxDrawdownPct: 4.45,
    config: { useTrailingStop: true, minPredSum: 2 },
  });

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.deepEqual(result.failedGates, ['candidateChanged']);
  assert.match(result.summary, /steady-state validation only/);
});

test('decideAutoresearchOutcome accepts return-basis optimizer metrics with raw diagnostic totals', () => {
  const incumbent = {
    configId: 'incumbent',
    score: 147.89,
    config: { minPredSum: 2 },
    metrics: {
      tradeCount: 245,
      winCount: 105,
      lossCount: 139,
      flatCount: 1,
      roiPct: 86.54,
      avgWin: 1.14,
      avgLoss: 0.24,
      profitFactor: 3.58,
      maxDrawdownPct: 2.64,
      totalProfit: 1.78,
      totalLossAbs: 0.29,
      totalProfitPct: 120.03,
      totalLossAbsPct: 33.49,
      metricBasis: {
        classification: 'returnPctExact',
        profitFactor: 'returnPctExact',
      },
    },
  };

  const challenger = {
    configId: 'challenger',
    score: 150.56,
    config: { minPredSum: 2, useSqueezeContext: true },
    metrics: {
      tradeCount: 249,
      winCount: 88,
      lossCount: 160,
      flatCount: 1,
      roiPct: 82.91,
      avgWin: 1.18,
      avgLoss: 0.13,
      profitFactor: 5.03,
      maxDrawdownPct: 1.43,
      totalProfit: 1.49,
      totalLossAbs: 0.04,
      totalProfitPct: 103.5,
      totalLossAbsPct: 20.59,
      metricBasis: {
        classification: 'returnPctExact',
        profitFactor: 'returnPctExact',
      },
    },
  };

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.match(result.failedGates.join(','), /roi/);
});

test('shouldQueuePromotionManifest returns true for changed promote manifests', () => {
  const manifest = {
    matrixDecision: { recommendation: 'promote' },
    challenger: { config: { useTrailingStop: true }, configId: 'candidate-a' },
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
  };

  assert.equal(shouldQueuePromotionManifest(manifest), true);
});

test('shouldQueuePromotionManifest returns false for hold or unchanged fingerprints', () => {
  const holdManifest = {
    matrixDecision: { recommendation: 'hold' },
    challenger: { config: { useTrailingStop: true } },
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
  };
  const unchangedManifest = {
    matrixDecision: { recommendation: 'promote' },
    challenger: { config: { useTrailingStop: true } },
    candidateFingerprint: 'same-fp',
    championFingerprint: 'same-fp',
  };

  assert.equal(shouldQueuePromotionManifest(holdManifest), false);
  assert.equal(shouldQueuePromotionManifest(unchangedManifest), false);
});

test('shouldQueuePromotionManifest returns false when challenger config or candidate fingerprint is missing', () => {
  const missingChallengerConfig = {
    matrixDecision: { recommendation: 'promote' },
    challenger: {},
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
  };
  const missingCandidateFingerprint = {
    matrixDecision: { recommendation: 'promote' },
    challenger: { config: { useTrailingStop: true } },
    championFingerprint: 'champion-fp',
  };

  assert.equal(shouldQueuePromotionManifest(missingChallengerConfig), false);
  assert.equal(shouldQueuePromotionManifest(missingCandidateFingerprint), false);
});
test('decideQueuedPromotionAction promotes valid queued manifest', () => {
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: 'champion-fp',
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    config: { useTrailingStop: false },
    configFingerprint: 'champion-fp',
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.status, 'promoted');
  assert.match(result.reason, /queued promotion guards passed/i);
});

test('decideQueuedPromotionAction marks stale when champion changed since queued decision', () => {
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: 'champion-fp-at-decision',
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    config: { useTrailingStop: false },
    configFingerprint: 'champion-fp-current',
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'stale');
  assert.equal(result.reason, 'Current champion changed since queued decision');
});

test('decideQueuedPromotionAction fails when queued family identity differs from manifest', () => {
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:fp-b',
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprintAtDecision: 'fp-a',
      candidateFamilyKey: 'family-b-original',
      championFamilyKeyAtDecision: 'family-a',
    },
    manifest: {
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      candidateFamilyKey: 'family-b-mutated',
      championFamilyKey: 'family-a',
      challenger: { config: { minPredSum: 1.6 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { config: { minPredSum: 1.8 }, configFingerprint: 'fp-a' },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /family/);
});

test('decideQueuedPromotionAction fails on champion family mismatch between queued and manifest', () => {
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:fp-b',
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprintAtDecision: 'fp-a',
      candidateFamilyKey: 'family-b',
      championFamilyKeyAtDecision: 'family-a-original',
    },
    manifest: {
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      candidateFamilyKey: 'family-b',
      championFamilyKey: 'family-a-mutated',
      challenger: { config: { minPredSum: 1.6 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { config: { minPredSum: 1.8 }, configFingerprint: 'fp-a' },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /champion family/i);
});

test('decideQueuedPromotionAction promotes when queued lineage fields missing for backward compatibility', () => {
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:candidate-fp',
      runId: 'run-a',
      championFingerprintAtDecision: 'champion-fp',
    },
    manifest: {
      runId: 'run-a',
      candidateFingerprint: 'candidate-fp',
      championFingerprint: 'champion-fp',
      candidateFamilyKey: 'family-b',
      championFamilyKey: 'family-a',
      matrixDecision: { recommendation: 'promote' },
      challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
    },
    championState: {
      config: { useTrailingStop: false },
      configFingerprint: 'champion-fp',
    },
    autoAction: { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' },
  });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.status, 'promoted');
});

test('decideQueuedPromotionAction holds stale when queued champion fingerprint is missing', () => {
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    config: { useTrailingStop: false },
    configFingerprint: 'champion-fp-current',
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  for (const championFingerprintAtDecision of [undefined, null, '']) {
    const queuedItem = {
      itemId: 'run-a:candidate-fp',
      runId: 'run-a',
      championFingerprintAtDecision,
    };

    const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

    assert.equal(result.recommendation, 'hold');
    assert.equal(result.status, 'stale');
    assert.equal(result.reason, 'Queued champion fingerprint missing at decision');
    assert.equal(canForceQueuedPromotion(result), false);
  }
});

test('decideQueuedPromotionAction blocks when autopromote gates fail', () => {
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: 'champion-fp',
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    config: { useTrailingStop: false },
    configFingerprint: 'champion-fp',
  };
  const autoAction = { recommendation: 'hold', summary: 'Auto-promote hold: failed cooldown gate(s).' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'Auto-promote hold: failed cooldown gate(s).');
  assert.equal(canForceQueuedPromotion(result), true);
});

test('resolveAutopromoteQueueStatus maps promoted false results to a queue status', () => {
  assert.equal(resolveAutopromoteQueueStatus({ promoted: true, reason: 'autopromoted' }), 'promoted');
  assert.equal(resolveAutopromoteQueueStatus({ promoted: false, reason: 'Champion already matches candidate-a' }), 'stale');
  assert.equal(resolveAutopromoteQueueStatus({ promoted: false, reason: 'promotion_noop' }), 'blocked');
});

test('canForceQueuedPromotion only allows blocked queue actions', () => {
  assert.equal(canForceQueuedPromotion({ status: 'blocked' }), true);
  assert.equal(canForceQueuedPromotion({ status: 'stale' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'failed' }), false);
});

test('decideQueuedPromotionAction fails when queued manifest is missing or runId mismatches', () => {
  const queuedItem = { itemId: 'run-a:candidate-fp', runId: 'run-a' };
  const missingManifest = decideQueuedPromotionAction({ queuedItem, manifest: null });
  const mismatchedManifest = decideQueuedPromotionAction({
    queuedItem,
    manifest: {
      runId: 'run-b',
      matrixDecision: { recommendation: 'promote' },
      challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
    },
    championState: { config: { useTrailingStop: false } },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(missingManifest.status, 'failed');
  assert.equal(missingManifest.reason, 'Queued manifest missing for run-a:candidate-fp');
  assert.equal(mismatchedManifest.status, 'failed');
  assert.equal(mismatchedManifest.reason, 'Manifest runId run-b does not match queued runId run-a');
});


test('decideCycleStartAction skips when pending promotion exists and not forced', () => {
  const pendingPromotion = {
    itemId: 'run-123:candidate-fp',
    runId: 'run-123',
  };

  const result = decideCycleStartAction({ pendingPromotion });

  assert.equal(result.recommendation, 'skip');
  assert.equal(result.reason, 'pending_promotion');
  assert.equal(result.pendingPromotion, pendingPromotion);
  assert.match(result.summary, /Skip cycle: pending promotion run-123:candidate-fp from run run-123/);
});

test('decideCycleStartAction allows forced cycle with pending promotion', () => {
  const pendingPromotion = {
    itemId: 'run-123:candidate-fp',
    runId: 'run-123',
  };

  const result = decideCycleStartAction({ pendingPromotion, forceCycle: true });

  assert.equal(result.recommendation, 'run');
  assert.equal(result.reason, 'forced');
  assert.equal(result.pendingPromotion, pendingPromotion);
  assert.equal(result.summary, undefined);
});

test('decideCycleStartAction runs when no pending promotion exists', () => {
  const result = decideCycleStartAction();

  assert.equal(result.recommendation, 'run');
  assert.equal(result.reason, 'no_pending_promotion');
  assert.equal(result.pendingPromotion, null);
  assert.equal(result.summary, undefined);
});

test('buildPromotionQueueItem accepts a promote manifest from autoresearch output', () => {
  const manifest = {
    runId: 'run-a',
    generatedAt: '2026-04-30T00:00:00.000Z',
    manifestPath: 'research/manifests/run-a.json',
    matrixDecision: { recommendation: 'promote' },
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
    champion: { configId: 'champion-a' },
  };

  assert.equal(shouldQueuePromotionManifest(manifest), true);

  const queueItem = buildPromotionQueueItem({
    manifest: { ...manifest, manifestPath: 'research/manifests/run-a.json' },
    createdAt: manifest.generatedAt,
  });

  assert.equal(queueItem.itemId, 'run-a:candidate-fp');
  assert.equal(queueItem.manifestPath, 'research/manifests/run-a.json');
  assert.equal(queueItem.createdAt, '2026-04-30T00:00:00.000Z');
});

test('legacy promote manifests without regime-exit fields remain queueable and promotable', () => {
  const manifest = {
    runId: 'run-legacy',
    generatedAt: '2026-05-01T00:00:00.000Z',
    manifestPath: 'research/manifests/run-legacy.json',
    matrixDecision: { recommendation: 'promote' },
    candidateFingerprint: 'candidate-legacy-fp',
    championFingerprint: 'champion-legacy-fp',
    challenger: { configId: 'candidate-legacy', config: { useTrailingStop: true } },
    champion: { configId: 'champion-legacy' },
  };

  assert.equal(manifest.researchBudgetMode, undefined);
  assert.equal(manifest.shadowRegimeScoreboard, undefined);
  assert.equal(shouldQueuePromotionManifest(manifest), true);

  const queuedItem = buildPromotionQueueItem({ manifest, createdAt: manifest.generatedAt });
  const action = decideQueuedPromotionAction({
    queuedItem,
    manifest,
    championState: {
      config: { useTrailingStop: false },
      configFingerprint: manifest.championFingerprint,
    },
    autoAction: { recommendation: 'promote', summary: 'All legacy gates passed.' },
  });

  assert.equal(action.recommendation, 'promote');
  assert.equal(action.status, 'promoted');
  assert.match(action.reason, /queued promotion guards passed/i);
});

test('regime-exit manifest shadow signals stay advisory and cannot bypass failing promotion gates', () => {
  const manifest = {
    runId: 'run-regime',
    generatedAt: '2026-05-01T00:00:00.000Z',
    manifestPath: 'research/manifests/run-regime.json',
    matrixDecision: { recommendation: 'promote' },
    candidateFingerprint: 'candidate-regime-fp',
    championFingerprint: 'champion-regime-fp',
    challenger: { configId: 'candidate-regime', config: { useTrailingStop: true } },
    champion: { configId: 'champion-regime' },
    researchBudgetMode: 'regime-exit',
    shadowRegimeScoreboard: {
      selectedLane: 'exitRegime',
      recommendation: 'switch-now',
      score: 0.999,
      laneConfidence: 0.997,
      regimeSwitchSignal: 'strong',
    },
    promotion: {
      allowAutomaticRegimeSwitching: true,
      requireGlobalChampionAnchor: true,
    },
  };

  const queuedItem = buildPromotionQueueItem({ manifest, createdAt: manifest.generatedAt });
  const blocked = decideQueuedPromotionAction({
    queuedItem,
    manifest,
    championState: {
      config: { useTrailingStop: false },
      configFingerprint: manifest.championFingerprint,
    },
    autoAction: {
      recommendation: 'hold',
      summary: 'Auto-promote hold: failed matrix/expectancy/anchor gates despite strong regime switch signal.',
    },
  });

  assert.equal(blocked.recommendation, 'hold');
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reason, /matrix\/expectancy\/anchor gates/i);
  assert.match(blocked.reason, /strong regime switch signal/i);
  assert.equal(canForceQueuedPromotion(blocked), true);
});

test('decideAutoresearchOutcome holds when expectancy regresses despite a higher win rate', () => {
  const incumbent = makeResult({
    configId: 'champion',
    score: 70.78,
    tradeCount: 239,
    roiPct: 47.19,
    profitFactor: 1.8,
    maxDrawdownPct: 4.45,
    avgWin: 2.4,
    avgLoss: 1.0,
  });

  const challenger = makeResult({
    configId: 'challenger',
    score: 71.4,
    tradeCount: 244,
    roiPct: 48.9,
    profitFactor: 1.86,
    maxDrawdownPct: 4.3,
    avgWin: 1.5,
    avgLoss: 1.2,
  });

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
    expectancyPolicy: {
      enabled: true,
      wrJumpDiagnosticThreshold: 8,
      rejectWrGainAvgWinLoss: true,
      requireExpectancyNonRegression: true,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.match(result.failedGates.join(','), /expectancy/);
  assert.equal(result.expectancyGate.passed, false);
  assert.match(result.summary, /expectancy gate/i);
});

test('decideAutoresearchOutcome can promote when expectancy improves even if win rate falls', () => {
  const incumbent = makeResult({
    configId: 'champion',
    score: 70.78,
    tradeCount: 239,
    roiPct: 47.19,
    profitFactor: 1.8,
    maxDrawdownPct: 4.45,
    avgWin: 1.2,
    avgLoss: 1.1,
  });

  const challenger = makeResult({
    configId: 'challenger',
    score: 71.4,
    tradeCount: 244,
    roiPct: 48.9,
    profitFactor: 1.86,
    maxDrawdownPct: 4.3,
    avgWin: 2.0,
    avgLoss: 0.8,
  });

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
    expectancyPolicy: {
      enabled: true,
      wrJumpDiagnosticThreshold: 8,
      rejectWrGainAvgWinLoss: true,
      requireExpectancyNonRegression: true,
    },
  });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.expectancyGate.passed, true);
  assert.ok(result.expectancyGate.comparisons.expectancyDelta > 0);
});

test('decideMatrixPromotion recommends promote when primary and enough shadows pass', () => {
  const champion = {
    configId: 'champion',
    config: { minPredSum: 2 },
  };
  const challenger = {
    configId: 'challenger',
    config: { minPredSum: 1.5 },
  };

  const labResults = [
    { decision: { recommendation: 'promote' } },
    { decision: { recommendation: 'promote' } },
    { decision: { recommendation: 'hold' } },
  ];

  const result = decideMatrixPromotion({
    labResults,
    champion,
    challenger,
    policy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 1,
      minShadowPassRatio: 0.5,
      requireCandidateChange: true,
    },
  });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.counts.shadowPassCount, 1);
  assert.equal(result.counts.shadowPassRatio, 0.5);
});

test('decideMatrixPromotion recommends hold when primary wins but shadows reject', () => {
  const result = decideMatrixPromotion({
    labResults: [
      { decision: { recommendation: 'promote' } },
      { decision: { recommendation: 'hold' } },
      { decision: { recommendation: 'hold' } },
    ],
    champion: { configId: 'champion', config: { minPredSum: 2 } },
    challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
    policy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 1,
      minShadowPassRatio: 0.5,
      requireCandidateChange: true,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.deepEqual(result.failedGates, ['shadowPassCount', 'shadowPassRatio']);
});

test('decideMatrixPromotion explains steady-state hold clearly', () => {
  const result = decideMatrixPromotion({
    labResults: [
      { decision: { recommendation: 'hold' } },
      { decision: { recommendation: 'hold' } },
      { decision: { recommendation: 'hold' } },
    ],
    champion: { configId: 'champion', config: { minPredSum: 2 } },
    challenger: { configId: 'champion', config: { minPredSum: 2 } },
    policy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 1,
      minShadowPassRatio: 0.5,
      requireCandidateChange: true,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.deepEqual(result.failedGates, ['candidateChanged', 'primaryPromote', 'shadowPassCount', 'shadowPassRatio']);
  assert.match(result.summary, /No new candidate/);
});

test('decideAutoPromotionAction requires matrix pass, change, cooldown, and quota', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: [
      { type: 'promote', timestamp: '2026-04-20T00:30:00.000Z' },
    ],
    policy: {
      enabled: true,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
    },
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
});

test('decideAutoPromotionAction tolerates non-array historyEvents and preserves legacy promote outcome', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: null,
    policy: {
      enabled: true,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
    },
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
  assert.deepEqual(result.failedGates, []);
});

test('decideAutoPromotionAction ignores malformed historyEvents entries and preserves legacy promote outcome', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: [null, 42, 'bad', {}, { type: 'noop' }],
    policy: {
      enabled: true,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
    },
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
  assert.deepEqual(result.failedGates, []);
});

test('decideAutoPromotionAction tolerates null policy and defaults to disabled hold', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: [],
    policy: null,
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.gates.enabled, false);
  assert.equal(result.failedGates.includes('enabled'), true);
});

test('decideAutoPromotionAction keeps legacy promote when lineagePolicy is missing', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: [],
    policy: {
      enabled: true,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
    },
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.gates.lineage, true);
  assert.equal(result.lineage.risk.level, 'disabled');
});

test('decideAutoPromotionAction blocks when candidate is unchanged', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'champion', config: { minPredSum: 2 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: [],
    policy: {
      enabled: true,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
    },
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'hold');
  assert.deepEqual(result.failedGates, ['candidateChanged']);
});

test('decideAutoPromotionAction blocks direct ping-pong reversal without extra margin', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'old-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      candidateFamilyKey: 'family-b',
      championFingerprint: 'fp-c',
      championFamilyKey: 'family-c',
      matrixDecision: {
        recommendation: 'promote',
        counts: { shadowPassCount: 3, shadowPassRatio: 0.6 },
      },
      robustness: { aggregateScoreDelta: 2, aggregateRoiDeltaPct: 1, aggregateProfitFactorDelta: 0.03 },
    },
    championState: { configId: 'current-c', config: { minPredSum: 1.8 }, configFingerprint: 'fp-c' },
    historyEvents: [
      {
        type: 'autopromote',
        timestamp: '2026-05-03T00:00:00.000Z',
        fromFingerprint: 'fp-b',
        toFingerprint: 'fp-c',
        fromFamilyKey: 'family-b',
        toFamilyKey: 'family-c',
      },
    ],
    policy: {
      enabled: true,
      cooldownHours: 0,
      maxPromotionsPerDay: 10,
      requireMatrixPromotion: true,
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 5,
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
      },
    },
    now: '2026-05-03T06:00:00.000Z',
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.gates.lineage, false);
  assert.equal(result.failedGates.includes('lineage'), true);
  assert.equal(result.lineage.risk.level, 'direct-reversal');
});

test('decideAutoPromotionAction falls back to history lineage when policy.lineage is malformed array', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'old-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      candidateFamilyKey: 'family-b',
      championFingerprint: 'fp-c',
      championFamilyKey: 'family-c',
      matrixDecision: {
        recommendation: 'promote',
        counts: { shadowPassCount: 3, shadowPassRatio: 0.6 },
      },
      robustness: { aggregateScoreDelta: 2, aggregateRoiDeltaPct: 1, aggregateProfitFactorDelta: 0.03 },
    },
    championState: { configId: 'current-c', config: { minPredSum: 1.8 }, configFingerprint: 'fp-c' },
    historyEvents: [
      {
        type: 'autopromote',
        timestamp: '2026-05-03T00:00:00.000Z',
        fromFingerprint: 'fp-b',
        toFingerprint: 'fp-c',
        fromFamilyKey: 'family-b',
        toFamilyKey: 'family-c',
      },
    ],
    policy: {
      enabled: true,
      cooldownHours: 0,
      maxPromotionsPerDay: 10,
      requireMatrixPromotion: true,
      lineage: [],
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 5,
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
      },
    },
    now: '2026-05-03T06:00:00.000Z',
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.gates.lineage, false);
  assert.equal(result.lineage.risk.level, 'direct-reversal');
});

test('decideAutoPromotionAction falls back to history lineage when policy.lineage is malformed scalar', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion', config: { minPredSum: 2 } },
    historyEvents: [{ type: 'promote', timestamp: '2026-04-20T00:30:00.000Z' }],
    policy: {
      enabled: true,
      cooldownHours: 24,
      maxPromotionsPerDay: 2,
      requireMatrixPromotion: true,
      lineage: 'bad',
    },
    now: '2026-04-21T02:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
  assert.deepEqual(result.failedGates, []);
});
test('decideAutoPromotionAction ignores injected policy lineage and derives lineage from history events', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'old-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      candidateFamilyKey: 'family-b',
      championFingerprint: 'fp-c',
      championFamilyKey: 'family-c',
      matrixDecision: {
        recommendation: 'promote',
        counts: { shadowPassCount: 3, shadowPassRatio: 0.6 },
      },
      robustness: { aggregateScoreDelta: 2, aggregateRoiDeltaPct: 1, aggregateProfitFactorDelta: 0.03 },
    },
    championState: { configId: 'current-c', config: { minPredSum: 1.8 }, configFingerprint: 'fp-c' },
    historyEvents: [
      {
        type: 'autopromote',
        timestamp: '2026-05-03T00:00:00.000Z',
        fromFingerprint: 'fp-b',
        toFingerprint: 'fp-c',
        fromFamilyKey: 'family-b',
        toFamilyKey: 'family-c',
      },
    ],
    policy: {
      enabled: true,
      cooldownHours: 0,
      maxPromotionsPerDay: 10,
      requireMatrixPromotion: true,
      lineage: {
        recentTransitions: [],
        recentPromotedFingerprints: [],
        recentDemotedFingerprints: [],
        recentPromotedFamilies: [],
        recentDemotedFamilies: [],
      },
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 5,
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
      },
    },
    now: '2026-05-03T06:00:00.000Z',
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.gates.lineage, false);
  assert.equal(result.lineage.risk.level, 'direct-reversal');
});

test('decideAutoPromotionAction allows direct reversal with extra matrix margin', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'old-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      candidateFamilyKey: 'family-b',
      championFingerprint: 'fp-c',
      championFamilyKey: 'family-c',
      matrixDecision: {
        recommendation: 'promote',
        counts: { shadowPassCount: 5, shadowPassRatio: 1 },
      },
      robustness: { aggregateScoreDelta: 8, aggregateRoiDeltaPct: 6, aggregateProfitFactorDelta: 0.2 },
    },
    championState: { configId: 'current-c', config: { minPredSum: 1.8 }, configFingerprint: 'fp-c' },
    historyEvents: [
      {
        type: 'autopromote',
        timestamp: '2026-05-03T00:00:00.000Z',
        fromFingerprint: 'fp-b',
        toFingerprint: 'fp-c',
        fromFamilyKey: 'family-b',
        toFamilyKey: 'family-c',
      },
    ],
    policy: {
      enabled: true,
      cooldownHours: 0,
      maxPromotionsPerDay: 10,
      requireMatrixPromotion: true,
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 5,
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
      },
    },
    now: '2026-05-03T06:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.gates.lineage, true);
  assert.equal(result.lineage.risk.level, 'direct-reversal');
});

test('extractChampionBootstrapCandidate accepts direct seed payloads', () => {
  const source = extractChampionBootstrapCandidate({
    configId: 'seed-direct',
    config: { minPredSum: 2 },
    score: 70,
  });

  assert.equal(source.configId, 'seed-direct');
  assert.deepEqual(source.config, { minPredSum: 2 });
});

test('selectChampionBootstrapSource prefers latest promoted challenger before seed file', () => {
  const selected = selectChampionBootstrapSource({
    latestManifest: {
      matrixDecision: { recommendation: 'promote' },
      challenger: { configId: 'latest-promote', config: { minPredSum: 1.5 } },
      champion: { configId: 'latest-champion', config: { minPredSum: 2 } },
    },
    seedPayload: { configId: 'seed-file', config: { minPredSum: 2.5 } },
  });

  assert.equal(selected.kind, 'latest-promoted-challenger');
  assert.equal(selected.source.configId, 'latest-promote');
});

test('selectChampionBootstrapSource falls back to tracked seed file when latest manifest is absent', () => {
  const selected = selectChampionBootstrapSource({
    latestManifest: null,
    seedPayload: { configId: 'seed-file', config: { minPredSum: 2.5 } },
  });

  assert.equal(selected.kind, 'seed-file');
  assert.equal(selected.source.configId, 'seed-file');
});

test('summarizeDigestAnnouncement includes matrix lab counts', () => {
  const text = summarizeDigestAnnouncement({
    latestManifest: {
      challenger: {
        configId: 'challenger',
        score: 60.9,
        roiPct: 39.2,
        config: { minPredSum: 1.5 },
      },
      champion: {
        configId: 'champion',
        config: { minPredSum: 2 },
      },
      matrixDecision: {
        recommendation: 'hold',
        counts: {
          allPassCount: 1,
          totalLabs: 3,
        },
      },
    },
    previousManifest: {
      challenger: {
        configId: 'previous',
        score: 60.1,
      },
    },
  });

  assert.match(text, /pine autoresearch hold/);
  assert.match(text, /labs 1\/3/);
  assert.match(text, /prev previous score 60.1/);
});

test('summarizeDigestAnnouncement compresses steady-state loops', () => {
  const text = summarizeDigestAnnouncement({
    latestManifest: {
      champion: {
        configId: 'champion',
        score: 70.78,
        roiPct: 47.19,
        config: { minPredSum: 2 },
      },
      challenger: {
        configId: 'champion',
        score: 70.78,
        roiPct: 47.19,
        config: { minPredSum: 2 },
      },
      researchState: {
        steadyState: true,
        noChangeStreak: 4,
      },
      matrixDecision: {
        recommendation: 'hold',
      },
    },
  });

  assert.match(text, /pine autoresearch steady-state/);
  assert.match(text, /streak 4/);
});

test('computeSweepOffset advances hourly scout batches across prior cycles', () => {
  const offset = computeSweepOffset({
    historyEvents: [
      { type: 'cycle' },
      { type: 'cycle' },
      { type: 'promote' },
      { type: 'cycle' },
    ],
    maxConfigs: 8,
    totalCombos: 30,
  });

  assert.equal(offset, 24);
});

test('planArtifactPrune keeps latest manifest-backed runs and deletes older plus partial artifacts', () => {
  const result = planArtifactPrune({
    manifestRunIds: ['run-1', 'run-2', 'run-3', 'run-4'],
    sweepRunIds: ['run-0', 'run-1', 'run-2', 'run-3', 'run-4', 'run-x'],
    evaluationRunIds: ['run-2', 'run-3', 'run-4', 'run-y'],
    keepLatestRuns: 2,
  });

  assert.deepEqual(result.keepRunIds, ['run-3', 'run-4']);
  assert.deepEqual(result.partialSweepRunIds, ['run-0', 'run-x']);
  assert.deepEqual(result.oldSweepRunIds, ['run-1', 'run-2']);
  assert.deepEqual(result.partialEvaluationRunIds, ['run-y']);
  assert.deepEqual(result.oldEvaluationRunIds, ['run-2']);
  assert.deepEqual(result.deleteSweepRunIds, ['run-0', 'run-1', 'run-2', 'run-x']);
  assert.deepEqual(result.deleteEvaluationRunIds, ['run-2', 'run-y']);
});

test('planArtifactPrune can preserve all manifest-backed runs when keepLatestRuns covers them', () => {
  const result = planArtifactPrune({
    manifestRunIds: ['run-1', 'run-2'],
    sweepRunIds: ['run-1', 'run-2', 'run-x'],
    evaluationRunIds: ['run-1', 'run-2'],
    keepLatestRuns: 10,
  });

  assert.deepEqual(result.keepRunIds, ['run-1', 'run-2']);
  assert.deepEqual(result.oldSweepRunIds, []);
  assert.deepEqual(result.oldEvaluationRunIds, []);
  assert.deepEqual(result.partialSweepRunIds, ['run-x']);
  assert.deepEqual(result.deleteSweepRunIds, ['run-x']);
  assert.deepEqual(result.deleteEvaluationRunIds, []);
});

test('buildParetoShortlist keeps non-dominated configs and always retains champion', () => {
  const shortlist = buildParetoShortlist({
    champion: { configId: 'champion', score: 70.78, roiPct: 47.19, profitFactor: 1.8, maxDrawdownPct: 4.45, tradeCount: 239 },
    rankedResults: [
      { configId: 'c1', score: 71.2, roiPct: 46.5, profitFactor: 1.9, maxDrawdownPct: 4.2, tradeCount: 220 },
      { configId: 'c2', score: 68.1, roiPct: 49.1, profitFactor: 1.7, maxDrawdownPct: 5.8, tradeCount: 260 },
      { configId: 'dominated', score: 65, roiPct: 40, profitFactor: 1.3, maxDrawdownPct: 7.5, tradeCount: 180 },
    ],
    limit: 3,
  });

  assert.deepEqual(shortlist.map((item) => item.configId), ['champion', 'c1', 'c2']);
});

test('selectRobustMatrixCandidate prefers multi-window strength over single primary peak', () => {
  const selected = selectRobustMatrixCandidate({
    candidates: [
      {
        challenger: { configId: 'primary-hero' },
        matrixDecision: { recommendation: 'hold', counts: { allPassCount: 2, totalLabs: 6, shadowPassCount: 1, shadowPassRatio: 0.2 } },
        robustness: { aggregateScoreDelta: 5.1, aggregateRoiDeltaPct: 7.0, aggregateProfitFactorDelta: 0.2, aggregateDrawdownDeltaPct: 1.8 },
      },
      {
        challenger: { configId: 'robust-winner' },
        matrixDecision: { recommendation: 'promote', counts: { allPassCount: 5, totalLabs: 6, shadowPassCount: 4, shadowPassRatio: 0.8 } },
        robustness: { aggregateScoreDelta: 2.4, aggregateRoiDeltaPct: 3.1, aggregateProfitFactorDelta: 0.1, aggregateDrawdownDeltaPct: -0.4 },
      },
    ],
  });

  assert.equal(selected.challenger.configId, 'robust-winner');
});

test('selectChangedMatrixCandidate ignores unchanged champion candidates', () => {
  const championState = { config: { a: 1 } };
  const selected = selectChangedMatrixCandidate({
    championState,
    candidates: [
      { challenger: { configId: 'champion', config: { a: 1 } }, matrixDecision: { recommendation: 'hold' } },
      { challenger: { configId: 'changed', config: { a: 2 } }, matrixDecision: { recommendation: 'hold' }, robustness: { aggregateScoreDelta: -1 } },
    ],
  });

  assert.equal(selected.challenger.configId, 'changed');
});

test('selectChangedMatrixCandidate returns null when only champion is available', () => {
  const selected = selectChangedMatrixCandidate({
    championState: { config: { a: 1 } },
    candidates: [
      { challenger: { configId: 'champion', config: { a: 1 } }, matrixDecision: { recommendation: 'hold' } },
    ],
  });

  assert.equal(selected, null);
});

test('selectChangedMatrixCandidate skips malformed candidates without challenger config', () => {
  const selected = selectChangedMatrixCandidate({
    championState: { config: { a: 1 } },
    candidates: [
      null,
      {},
      { challenger: {} },
      {
        challenger: { configId: 'malformed-high-robustness' },
        matrixDecision: { recommendation: 'promote', counts: { allPassCount: 10, totalLabs: 10, shadowPassCount: 10, shadowPassRatio: 1 } },
        robustness: { aggregateScoreDelta: 1000, aggregateRoiDeltaPct: 1000, aggregateProfitFactorDelta: 1000, aggregateDrawdownDeltaPct: -1000 },
      },
      { challenger: { configId: 'changed', config: { a: 2 } }, matrixDecision: { recommendation: 'hold' }, robustness: { aggregateScoreDelta: -10 } },
    ],
  });

  assert.equal(selected.challenger.configId, 'changed');
});

test('selectChangedMatrixCandidate returns null when only malformed candidates are available', () => {
  const selected = selectChangedMatrixCandidate({
    candidates: [null, {}, { challenger: {} }],
  });

  assert.equal(selected, null);
});

test('buildScoutOrchestrationState marks no-new-candidate when selected candidate equals champion', () => {
  const championConfig = { minPredSum: 2, tpAtrMult: 5.5 };
  const championState = { configId: 'champion', score: 70, config: championConfig };
  const challenger = { configId: 'champion', score: 70, config: { ...championConfig } };
  const matrixDecision = decideMatrixPromotion({
    labResults: [],
    champion: championState,
    challenger,
    policy: { requireCandidateChange: true },
  });

  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      pinnedData: { enabled: false },
    },
    runId: 'pine-autoresearch-no-new-candidate',
    championState,
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'self-loop', family: 'fallback', config: { ...championConfig } }],
    primarySweep: {
      topConfigs: [{ configId: 'champion', score: 70, roiPct: 40, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 200, config: { ...championConfig } }],
    },
    matrixCandidates: [{ challenger, matrixDecision, robustness: {} }],
    trackState: { rejectedCandidateFingerprint: 'stale-reject' },
  });

  assert.equal(result.manifest.noNewCandidate, true);
  assert.equal(result.manifest.rejectedCandidateFingerprint, null);
  assert.equal(result.manifest.matrixDecision.gates.candidateChanged, false);
  assert.match(result.manifest.matrixDecision.summary, /No new candidate/);
});


test('buildScoutOrchestrationState wires variant files, shortlist, matrix selection, and manifest fields', () => {
  const config = {
    matrixId: 'pine-autoresearch',
    selectedProfile: 'full',
    researchRoot: '/tmp/research',
    searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
    primaryLab: { labId: 'primary' },
    shadowLabs: [{ labId: 'shadow-1' }],
    pinnedData: { enabled: true, datasetsRoot: '/data', cacheRoot: '/cache', exchangeName: 'binance' },
  };

  const championState = {
    configId: 'champion',
    score: 70,
    config: { minPredSum: 2 },
  };

  const historyEventsBefore = [
    { type: 'cycle', steadyState: true },
    { type: 'cycle', steadyState: true },
  ];

  const searchBatch = [
    { variantId: 'v1', lane: 'exploit', family: 'signal', config: { minPredSum: 1.5 } },
    { variantId: 'v2', lane: 'explore', family: 'risk', config: { minPredSum: 1.6 } },
  ];

  const primarySweep = {
    topConfigs: [
      { configId: 'c1', score: 72, roiPct: 48, profitFactor: 1.9, maxDrawdownPct: 4.1, tradeCount: 230 },
      { configId: 'c2', score: 71, roiPct: 47, profitFactor: 1.8, maxDrawdownPct: 4.3, tradeCount: 225 },
      { configId: 'c3', score: 69, roiPct: 46, profitFactor: 1.7, maxDrawdownPct: 4.6, tradeCount: 220 },
    ],
  };

  const matrixCandidates = [
    {
      challenger: { configId: 'c1', config: { minPredSum: 1.5 }, winRatePct: 40, avgWin: 2.1, avgLoss: 0.9, expectancy: 0.15 },
      labResults: [{
        incumbent: { configId: 'champion', winRatePct: 32, avgWin: 1.8, avgLoss: 1.0, expectancy: 0.02 },
        challenger: { configId: 'c1', winRatePct: 40, avgWin: 2.1, avgLoss: 0.9, expectancy: 0.15 },
        decision: {
          recommendation: 'promote',
          comparisons: { scoreDelta: 1, roiDeltaPct: 2, profitFactorDelta: 0.1, drawdownDeltaPct: -0.2, avgWinDelta: 0.3, avgLossDelta: -0.1 },
          expectancy: {
            passed: true,
            comparisons: { expectancyDelta: 0.13, avgWinDelta: 0.3, avgLossDelta: -0.1 },
            champion: { expectancy: 0.02 },
            challenger: { expectancy: 0.15 },
            gate: { passed: true },
            diagnostics: { wrDecompositionRequired: false },
          },
          expectancyGate: {
            passed: true,
            comparisons: { expectancyDelta: 0.13, avgWinDelta: 0.3, avgLossDelta: -0.1 },
            champion: { expectancy: 0.02 },
            challenger: { expectancy: 0.15 },
            gate: { passed: true },
            diagnostics: { wrDecompositionRequired: false },
          },
        },
      }],
      matrixDecision: { recommendation: 'promote', gates: { candidateChanged: true } },
      robustness: { aggregateScoreDelta: 1, aggregateRoiDeltaPct: 2, aggregateProfitFactorDelta: 0.1, aggregateDrawdownDeltaPct: -0.2 },
      expectancy: {
        champion: { winRatePct: 32, avgWin: 1.8, avgLoss: 1.0, expectancy: 0.02 },
        challenger: { winRatePct: 40, avgWin: 2.1, avgLoss: 0.9, expectancy: 0.15 },
        delta: { winRatePct: 8, avgWin: 0.3, avgLoss: -0.1, expectancy: 0.13 },
        gate: { passed: true },
        wrDecompositionRequired: false,
      },
    },
  ];

  const result = buildScoutOrchestrationState({
    config,
    runId: 'pine-autoresearch-123',
    championState,
    historyEventsBefore,
    searchBatch,
    primarySweep,
    matrixCandidates,
  });

  assert.match(result.variantFilePath, /pine-autoresearch-123-variants\.json$/);
  assert.deepEqual(result.paretoShortlist.map((item) => item.configId), ['champion', 'c1']);
  assert.equal(result.selectedCandidate.challenger.configId, 'c1');
  assert.equal(result.manifest.searchPlan.variantCount, 2);
  assert.deepEqual(result.manifest.searchPlan.variants.map((variant) => variant.variantId), ['v1', 'v2']);
  assert.equal(result.manifest.matrixCandidates[0].challenger.configId, 'c1');
  assert.equal(result.manifest.challenger.configId, 'c1');
  assert.equal(result.manifest.researchState.steadyState, false);
  assert.equal(result.manifest.pinnedData.enabled, true);
  assert.equal(result.manifest.expectancy.gate.passed, true);
  assert.equal(result.manifest.expectancy.wrDecompositionRequired, false);
  assert.ok(result.manifest.expectancy.delta.expectancy > 0);
});


test('buildScoutOrchestrationState keeps heavy lab analysis out of the persisted manifest', () => {
  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [{ labId: 'shadow-1' }],
      pinnedData: { enabled: true, datasetsRoot: '/data', cacheRoot: '/cache', exchangeName: 'binance' },
    },
    runId: 'pine-autoresearch-heavy-manifest',
    championState: { configId: 'champion', score: 70, config: { a: 1 } },
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'signal', config: { a: 1 } }],
    primarySweep: { topConfigs: [{ configId: 'c1', score: 72, roiPct: 48, profitFactor: 1.9, maxDrawdownPct: 4.1, tradeCount: 230, config: { a: 2 } }] },
    matrixCandidates: [{
      challenger: { configId: 'c1', config: { a: 2 } },
      labResults: [{
        lab: { labId: 'primary' },
        incumbent: { configId: 'champion' },
        challenger: { configId: 'c1' },
        decision: { recommendation: 'promote' },
        analysis: {
          incumbent: { trades: [{ pnl: 1 }], rows: [{ timestamp: '2026-01-01T00:00:00.000Z', Close: 1 }] },
          challenger: { trades: [{ pnl: 2 }], rows: [{ timestamp: '2026-01-01T00:15:00.000Z', Close: 2 }] },
        },
      }],
      matrixDecision: { recommendation: 'promote', gates: { candidateChanged: true } },
      robustness: {},
    }],
  });

  assert.ok(result.labResults[0].analysis);
  assert.equal(result.manifest.labResults[0].analysis, undefined);
  assert.doesNotThrow(() => JSON.stringify(result.manifest));
});


test('buildScoutOrchestrationState evaluates top-candidate similarity across the full candidate set', () => {
  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [{ labId: 'shadow-1' }],
      pinnedData: { enabled: true, datasetsRoot: '/data', cacheRoot: '/cache', exchangeName: 'binance' },
    },
    runId: 'pine-autoresearch-124',
    championState: { configId: 'champion', score: 70, config: { a: 1 } },
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'signal', config: { a: 1 } }],
    primarySweep: {
      topConfigs: [
        { configId: 'c1', score: 72, roiPct: 48, profitFactor: 1.9, maxDrawdownPct: 4.1, tradeCount: 230, config: { a: 0 } },
        { configId: 'c2', score: 71, roiPct: 47, profitFactor: 1.8, maxDrawdownPct: 4.3, tradeCount: 225, config: { a: 0 } },
        { configId: 'c3', score: 69, roiPct: 46, profitFactor: 1.7, maxDrawdownPct: 4.6, tradeCount: 220, config: { a: 0 } },
        { configId: 'c4', score: 68, roiPct: 45, profitFactor: 1.6, maxDrawdownPct: 4.8, tradeCount: 210, config: { a: 1, b: 2 } },
      ],
    },
    matrixCandidates: [{ challenger: { configId: 'c1', config: { a: 0 } }, matrixDecision: { recommendation: 'hold', summary: 'Hold c1' }, robustness: {} }],
  });

  assert.equal(result.manifest.topCandidateSimilarity, 0.5);
});

test('pine script exports regime-facing features for asymmetry diagnostics', async () => {
  const source = await fs.readFile(new URL('../pine/test.pine', import.meta.url), 'utf8');

  assert.match(source, /plot\(featureCompressionState, "Feature_CompressionState", display=display\.data_window\)/);
  assert.match(source, /plot\(featureExpansionState, "Feature_ExpansionState", display=display\.data_window\)/);
  assert.match(source, /plot\(featureTrendStrengthState, "Feature_TrendStrengthState", display=display\.data_window\)/);
  assert.match(source, /plot\(featureCautionDensity, "Feature_CautionDensity", display=display\.data_window\)/);
});


test('applySchedulerStateToManifest overwrites persisted stagnation metadata with post-cycle scheduler state', () => {
  const manifest = {
    noNewCandidateStreak: 1,
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
  };

  const updated = applySchedulerStateToManifest(manifest, {
    noNewCandidateStreak: 2,
    stagnationLevel: 1,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-04T00:00:00.000Z',
  });

  assert.equal(updated.noNewCandidateStreak, 2);
  assert.equal(updated.stagnationLevel, 1);
  assert.equal(updated.stagnationReason, 'noNewCandidateStreak');
  assert.equal(updated.lastEscalatedAt, '2026-05-04T00:00:00.000Z');
});

test('buildScoutRegimeAnalysisArtifact aggregates all selected-candidate lab analyses', () => {
  const result = buildScoutRegimeAnalysisArtifact({
    matrixId: 'pine-autoresearch',
    runId: 'run-multi-lab',
    selectedCandidate: {
      challenger: { configId: 'cand-1' },
      labResults: [
        {
          lab: { labId: 'primary' },
          analysis: {
            incumbent: {
              trades: [{ side: 'long', pnl: 1, mfePct: 2, maePct: 0.5, featureIndex: 0 }],
              rows: [{ featureCompressionState: 1 }],
            },
            challenger: {
              trades: [{ side: 'long', pnl: 3, mfePct: 4, maePct: 0.3, featureIndex: 0 }],
              rows: [{ featureCompressionState: 1 }],
            },
          },
        },
        {
          lab: { labId: 'shadow-1' },
          analysis: {
            incumbent: {
              trades: [{ side: 'short', pnl: -1, mfePct: 1.5, maePct: 0.9, featureIndex: 0 }],
              rows: [{ featureCompressionState: 0 }],
            },
            challenger: {
              trades: [{ side: 'short', pnl: 2, mfePct: 2.5, maePct: 0.4, featureIndex: 0 }],
              rows: [{ featureExpansionState: 1 }],
            },
          },
        },
      ],
    },
    matrixCandidates: [],
  });

  assert.equal(result.analysisSource.sourceLabCount, 2);
  assert.deepEqual(result.analysisSource.sourceLabIds, ['primary', 'shadow-1']);
  assert.equal(result.artifact.evidence.tradeCount, 2);
  assert.equal(result.artifact.sideMetrics.long.tradeCount, 1);
  assert.equal(result.artifact.sideMetrics.short.tradeCount, 1);
  assert.match(result.artifact.markdown, /Threshold surfaces/);
});

test('buildScoutRegimeAnalysisArtifact keeps analysis output available even without qualifying trade rows', () => {
  const result = buildScoutRegimeAnalysisArtifact({
    matrixId: 'pine-autoresearch',
    runId: 'run-empty',
    selectedCandidate: null,
    matrixCandidates: [],
  });

  assert.equal(result.artifact.recommendation, 'limited-evidence');
  assert.equal(result.artifact.evidence.tradeCount, 0);
  assert.match(result.artifact.markdown, /Evidence quality/);
  assert.match(result.artifact.markdown, /Threshold surfaces/);
});

test('buildScoutOrchestrationState records active track and novelty metadata', () => {
  const config = {
    matrixId: 'pine-autoresearch',
    selectedProfile: 'full',
    researchRoot: '/tmp/research',
    searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
    primaryLab: { labId: 'primary' },
    shadowLabs: [{ labId: 'shadow-1' }],
    pinnedData: { enabled: true, datasetsRoot: '/data', cacheRoot: '/cache', exchangeName: 'binance' },
    researchTracks: [
      { trackId: 'squeeze-context', gridName: 'phase3-core', windowSet: 'primary', enabled: true },
      { trackId: 'divergence-context', gridName: 'phase3-core', windowSet: 'rotating', enabled: true },
    ],
  };

  const result = buildScoutOrchestrationState({
    config,
    runId: 'pine-autoresearch-124',
    championState: { configId: 'champion', score: 70, config: { a: 1, nested: { b: true, c: 'x' }, extra: 9 } },
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'signal', config: { a: 1, nested: { b: false, c: 'x' } } }],
    primarySweep: {
      topConfigs: [
        { configId: 'c1', score: 72, roiPct: 48, profitFactor: 1.9, maxDrawdownPct: 4.1, tradeCount: 230, config: { a: 1, nested: { b: false, c: 'x' } } },
        { configId: 'c2', score: 71, roiPct: 47, profitFactor: 1.8, maxDrawdownPct: 4.3, tradeCount: 225, config: { a: 1, nested: { b: true, c: 'y' } } },
        { configId: 'c3', score: 69, roiPct: 46, profitFactor: 1.7, maxDrawdownPct: 4.6, tradeCount: 220, config: { a: 0, nested: { b: true, c: 'x' } } },
      ],
    },
    matrixCandidates: [{ challenger: { configId: 'c1', config: { a: 1, nested: { b: false, c: 'x' } } }, matrixDecision: { recommendation: 'promote', summary: 'Promote c1' }, robustness: {} }],
    trackState: {
      activeTrackId: 'squeeze-context',
      windowSetId: 'primary',
      noveltySignature: 'squeeze-context|phase3-core|cand-1|primary|primary-shadow',
      rotationTrigger: 'noChangeStreak',
      rotationReason: 'cycleIndex',
      candidateFingerprint: 'cand-1',
      championFingerprint: 'champion',
      labSetId: 'primary,shadow-1',
      gridName: 'phase3-core',
      sameTrackCycleStreak: 4,
      promotionEligible: true,
      promotionEligibleReason: 'Promote c1',
      topCandidateSimilarity: 0.5,
    },
  });

  assert.equal(result.manifest.activeTrackId, 'squeeze-context');
  assert.equal(result.manifest.windowSetId, 'primary');
  assert.equal(result.manifest.noveltySignature, 'squeeze-context|phase3-core|cand-1|primary|primary-shadow');
  assert.equal(result.manifest.rotationTrigger, 'noChangeStreak');
  assert.equal(result.manifest.rotationReason, 'cycleIndex');
  assert.equal(result.manifest.sameTrackCycleStreak, 4);
  assert.equal(result.manifest.promotionEligible, true);
  assert.equal(result.manifest.promotionEligibleReason, 'Promote c1');
  assert.equal(result.manifest.topCandidateSimilarity, 0.5);
});

test('mergeSchedulerTabuFingerprints bootstraps recent manifest rejects without losing existing tabu state', () => {
  const merged = mergeSchedulerTabuFingerprints({
    schedulerState: { activeTrackId: 'track-a', tabuRejectedFingerprints: ['old-1', 'old-2'] },
    recentRejectedFingerprints: ['old-2', 'new-1', 'new-2'],
    tabuLimit: 3,
  });

  assert.equal(merged.activeTrackId, 'track-a');
  assert.deepEqual(merged.tabuRejectedFingerprints, ['old-2', 'new-1', 'new-2']);
});

test('resolveTrackSelectionState advances cycle index when no-change rotation clears the active track', () => {
  const { hardRotationTrigger, activeTrackSelectionState } = resolveTrackSelectionState({
    schedulerState: {
      activeTrackId: 'track-c',
      cycleIndex: 3,
      noChangeStreak: 3,
      sameTrackCycleStreak: 3,
    },
    rotationPolicy: { noChangeStreakRotateAfter: 3, maxCyclesPerTrack: 8 },
    researchTracks: [
      { trackId: 'track-a', enabled: true },
      { trackId: 'track-b', enabled: true },
      { trackId: 'track-c', enabled: true },
    ],
  });

  assert.equal(hardRotationTrigger, 'noChangeStreak');
  assert.equal(activeTrackSelectionState.activeTrackId, null);
  assert.equal(activeTrackSelectionState.cycleIndex, 4);
});

test('resolveTrackSelectionState pre-rotates on prior novelty and max-cycle evidence', () => {
  const novelty = resolveTrackSelectionState({
    schedulerState: {
      activeTrackId: 'track-b',
      cycleIndex: 5,
      noChangeStreak: 0,
      sameTrackCycleStreak: 2,
    },
    rotationPolicy: { noChangeStreakRotateAfter: 3, similarityRotateAbove: 0.85, maxCyclesPerTrack: 8 },
    researchTracks: [
      { trackId: 'track-a', enabled: true },
      { trackId: 'track-b', enabled: true },
      { trackId: 'track-c', enabled: true },
    ],
    previousCycle: { topCandidateSimilarity: 0.91, promotionEligible: false },
  });

  assert.equal(novelty.hardRotationTrigger, 'noveltySimilarity');
  assert.equal(novelty.activeTrackSelectionState.activeTrackId, null);
  assert.equal(novelty.activeTrackSelectionState.cycleIndex, 6);

  const maxCycle = resolveTrackSelectionState({
    schedulerState: {
      activeTrackId: 'track-c',
      cycleIndex: 7,
      noChangeStreak: 0,
      sameTrackCycleStreak: 9,
    },
    rotationPolicy: { noChangeStreakRotateAfter: 3, similarityRotateAbove: 0.85, maxCyclesPerTrack: 8 },
    researchTracks: [
      { trackId: 'track-a', enabled: true },
      { trackId: 'track-b', enabled: true },
      { trackId: 'track-c', enabled: true },
    ],
    previousCycle: { topCandidateSimilarity: 0.4, promotionEligible: false },
  });

  assert.equal(maxCycle.hardRotationTrigger, 'maxCyclesPerTrack');
  assert.equal(maxCycle.activeTrackSelectionState.activeTrackId, null);
  assert.equal(maxCycle.activeTrackSelectionState.cycleIndex, 10);
});



test('buildScoutOrchestrationState persists candidate and champion lineage keys', () => {
  const championState = {
    configId: 'champion-a',
    score: 100,
    tradeCount: 100,
    roiPct: 50,
    winRatePct: 40,
    profitFactor: 2,
    maxDrawdownPct: 3,
    config: { useFusionV4: true, useDivergenceContext: true, minPredSum: 1.8 },
    configFingerprint: 'fp-a',
  };
  const challenger = {
    configId: 'challenger-b',
    score: 110,
    tradeCount: 120,
    roiPct: 60,
    winRatePct: 42,
    profitFactor: 2.2,
    maxDrawdownPct: 2.5,
    config: { useFusionV4: true, useDivergenceContext: true, minPredSum: 1.6 },
  };

  const result = buildScoutOrchestrationState({
    config: {
      researchRoot: 'pine/autoresearch/test',
      matrixId: 'test-matrix',
      grid: 'phase3-core',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 1, paretoShortlistSize: 2 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      blindHoldoutLabs: [],
    },
    runId: 'run-lineage',
    championState,
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [challenger] },
    matrixCandidates: [{
      challenger,
      labResults: [],
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger', counts: { shadowPassCount: 0, shadowPassRatio: 0 } },
      robustness: { aggregateScoreDelta: 10, aggregateRoiDeltaPct: 10 },
    }],
    trackState: { championFingerprint: 'fp-a', candidateFingerprint: 'fp-b' },
  });

  assert.equal(result.manifest.candidateFingerprint, 'fp-b');
  assert.equal(result.manifest.championFingerprint, 'fp-a');
  assert.equal(typeof result.manifest.candidateFamilyKey, 'string');
  assert.equal(typeof result.manifest.championFamilyKey, 'string');
  assert.equal(result.manifest.robustness.aggregateScoreDelta, 10);
});

test('buildScoutOrchestrationState does not inherit a stale lastRotationTrigger', () => {
  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [{ labId: 'shadow-1' }],
      pinnedData: { enabled: true, datasetsRoot: '/data', cacheRoot: '/cache', exchangeName: 'binance' },
      researchTracks: [
        { trackId: 'squeeze-context', gridName: 'phase3-core', windowSet: 'primary', enabled: true },
      ],
    },
    runId: 'pine-autoresearch-124',
    championState: { configId: 'champion', score: 70, config: { a: 1 } },
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'signal', config: { a: 1 } }],
    primarySweep: { topConfigs: [{ configId: 'c1', score: 72, roiPct: 48, profitFactor: 1.9, maxDrawdownPct: 4.1, tradeCount: 230, config: { a: 1 } }] },
    matrixCandidates: [{ challenger: { configId: 'c1', config: { a: 1 } }, matrixDecision: { recommendation: 'promote', summary: 'Promote c1' }, robustness: {} }],
    trackState: {
      activeTrackId: 'squeeze-context',
      windowSetId: 'primary',
      noveltySignature: 'squeeze-context|phase3-core|cand-1|primary|primary-shadow',
      lastRotationTrigger: 'noChangeStreak',
      candidateFingerprint: 'cand-1',
      championFingerprint: 'champion',
      labSetId: 'primary,shadow-1',
      gridName: 'phase3-core',
      sameTrackCycleStreak: 4,
      promotionEligible: true,
      promotionEligibleReason: 'Promote c1',
      topCandidateSimilarity: 0.75,
    },
  });

  assert.equal(result.manifest.rotationTrigger, null);
  assert.equal(result.manifest.rotationReason, null);
});

test('buildScoutOrchestrationState exposes stagnation metadata in manifest', () => {
  const result = buildScoutOrchestrationState({
    config: {
      researchRoot: 'pine/autoresearch/test',
      matrixId: 'test-matrix',
      grid: 'phase3-core',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 1, paretoShortlistSize: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 1, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      blindHoldoutLabs: [],
    },
    runId: 'run-stagnation',
    championState: {
      configId: 'champion-a',
      score: 100,
      tradeCount: 100,
      roiPct: 50,
      profitFactor: 2,
      maxDrawdownPct: 3,
      config: { minPredSum: 1.8 },
    },
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [] },
    matrixCandidates: [],
    trackState: {
      activeTrackId: 'track-a',
      noNewCandidateStreak: 3,
      stagnationLevel: 2,
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T00:00:00.000Z',
    },
  });

  assert.equal(result.manifest.noNewCandidateStreak, 3);
  assert.equal(result.manifest.stagnationLevel, 2);
  assert.equal(result.manifest.stagnationReason, 'noNewCandidateStreak');
  assert.equal(result.manifest.lastEscalatedAt, '2026-05-03T00:00:00.000Z');

  const resultWithoutEscalation = buildScoutOrchestrationState({
    config: {
      researchRoot: 'pine/autoresearch/test',
      matrixId: 'test-matrix',
      grid: 'phase3-core',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 1, paretoShortlistSize: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 1, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      blindHoldoutLabs: [],
    },
    runId: 'run-stagnation-default-null',
    championState: {
      configId: 'champion-a',
      score: 100,
      tradeCount: 100,
      roiPct: 50,
      profitFactor: 2,
      maxDrawdownPct: 3,
      config: { minPredSum: 1.8 },
    },
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [] },
    matrixCandidates: [],
    trackState: {
      activeTrackId: 'track-a',
      noNewCandidateStreak: 3,
      stagnationLevel: 2,
      stagnationReason: 'noNewCandidateStreak',
    },
  });

  assert.equal(resultWithoutEscalation.manifest.lastEscalatedAt, null);
});


test('promotion history event records from/to fingerprints and family keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-lineage-promote-'));
  try {
    const configPath = path.join(dir, 'config.json');
    const scriptPath = path.join(dir, 'strategy.pine');
    await fs.writeFile(scriptPath, 'minPredSum = input.float(1.8, title="Min Prediction Sum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'lineage-test',
      scriptPath,
      outputs: {
        researchRoot: path.join(dir, 'research'),
        digestRoot: path.join(dir, 'digest'),
      },
      baseConfig: { minPredSum: 1.8 },
      autoPromotion: { enabled: true, cooldownHours: 0, maxPromotionsPerDay: 10, requireMatrixPromotion: true },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.writeFile(autoresearchCli.latestManifestPath(config), JSON.stringify({
      runId: 'run-promote-lineage',
      generatedAt: '2026-05-03T00:00:00.000Z',
      champion: { configId: 'champion-a', config: { minPredSum: 1.8 }, configFingerprint: 'fp-a' },
      challenger: { configId: 'challenger-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      candidateFamilyKey: 'family-b',
      championFamilyKey: 'family-a',
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger' },
    }), 'utf8');

    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      configId: 'champion-a',
      config: { minPredSum: 1.8 },
      configFingerprint: 'fp-a',
    }), 'utf8');
    const result = await autoresearchCli.runPromote(config, { force: false }, 'manual');
    assert.equal(result.promoted, true);

    const history = JSON.parse((await fs.readFile(path.join(config.researchRoot, 'history.jsonl'), 'utf8')).trim().split('\n').at(-1));
    assert.equal(history.fromFingerprint, 'fp-a');
    assert.equal(history.toFingerprint, 'fp-b');
    assert.equal(history.fromFamilyKey, 'family-a');
    assert.equal(history.toFamilyKey, 'family-b');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('renderDigestMarkdown includes search-plan, shortlist summary, and rotation diagnostics', () => {
  const markdown = renderDigestMarkdown({
    config: { matrixId: 'pine-fusion-v4-core-15m-locked-window', primaryLab: { labId: 'xrpusdt-15m-primary' }, shadowLabs: [{}, {}] },
    championState: { configId: 'champion', score: 70.78, roiPct: 47.19 },
    latestManifest: {
      runId: 'run-1',
      champion: { configId: 'champion', score: 70.78, roiPct: 47.19, config: { minPredSum: 2 } },
      challenger: { configId: 'robust-winner', score: 68.9, roiPct: 45.1, config: { minPredSum: 1.5 } },
      searchPlan: { variantCount: 8, exploitRatio: 0.8 },
      paretoShortlist: [{ configId: 'champion' }, { configId: 'robust-winner' }],
      matrixDecision: { recommendation: 'promote', counts: { allPassCount: 5, totalLabs: 6, shadowPassRatio: 0.8 }, summary: 'Promote robust-winner' },
      topCandidateSimilarity: 0.91,
      rotationTrigger: 'noChangeStreak',
      sameTrackCycleStreak: 9,
      promotionEligible: true,
      promotionEligibleReason: 'Promote robust-winner',
      rotationReason: 'noChangeStreak',
      expectancy: {
        champion: { expectancy: 0.1 },
        challenger: { expectancy: 0.22 },
        delta: { expectancy: 0.12, avgWin: 0.2, avgLoss: -0.1 },
        gate: { passed: true },
        wrDecompositionRequired: false,
      },
    },
    previousManifest: null,
    historyEvents: [],
  });

  assert.match(markdown, /Search plan/);
  assert.match(markdown, /variantCount: 8/);
  assert.match(markdown, /Pareto shortlist/);
  assert.match(markdown, /robust-winner/);
  assert.match(markdown, /topCandidateSimilarity: 0\.91/);
  assert.match(markdown, /rotationTrigger: noChangeStreak/);
  assert.match(markdown, /sameTrackCycleStreak: 9/);
  assert.match(markdown, /promotionEligible: true/);
  assert.match(markdown, /promotionEligibleReason: Promote robust-winner/);
  assert.match(markdown, /Expectancy/);
  assert.match(markdown, /challengerExpectancy: 0\.22/);
  assert.match(markdown, /wrDecompositionRequired: false/);
});

test('renderDigestMarkdown reports no-new-candidate self-loop state', () => {
  const markdown = renderDigestMarkdown({
    config: { matrixId: 'pine-fusion-v4-core-15m-locked-window', primaryLab: { labId: 'xrpusdt-15m-primary' }, shadowLabs: [{}, {}] },
    championState: { configId: 'champion', score: 145.42, roiPct: 84.66 },
    latestManifest: {
      runId: 'run-self-loop',
      champion: { configId: 'champion', score: 145.42, roiPct: 84.66, config: { minPredSum: 2 } },
      challenger: { configId: 'champion', score: 145.42, roiPct: 84.66, config: { minPredSum: 2 } },
      searchPlan: { variantCount: 3, exploitRatio: 0.8 },
      paretoShortlist: [{ configId: 'champion' }],
      matrixDecision: { recommendation: 'hold', failedGates: ['candidateChanged'], counts: { allPassCount: 0, totalLabs: 6, shadowPassRatio: 0 }, summary: 'No new candidate' },
      noNewCandidate: true,
      noNewCandidateStreak: 2,
      topCandidateSimilarity: 1,
      rotationTrigger: 'noveltySimilarity',
      sameTrackCycleStreak: 0,
      promotionEligible: false,
      promotionEligibleReason: 'No changed challenger',
    },
    previousManifest: null,
    historyEvents: [],
  });

  assert.match(markdown, /noNewCandidate: true/);
  assert.match(markdown, /noNewCandidateStreak: 2/);
});

test('default autoresearch config enables incumbent-local shortlist policy', async () => {
  const raw = await fs.readFile(new URL('../config/pine-autoresearch.default.json', import.meta.url), 'utf8');
  const config = JSON.parse(raw);

  assert.deepEqual(config.searchPolicy, {
    mode: 'incumbent-local',
    exploitRatio: 0.8,
    freezeArchitecture: true,
    exploitFamilies: ['signal', 'risk'],
    exploreFamilies: ['signal'],
    paretoShortlistSize: 4,
    matrixCandidateLimit: 3,
    selfLoopEscape: {
      enabled: true,
      activateAfter: 1,
      includeFallback: true,
      fallbackFamilies: ['signal', 'risk'],
      minFallbackConfigs: 3,
      temperatureBoost: 1.5,
      stagnationFallbackFamilies: ['signal', 'risk', 'exit-state', 'asymmetry'],
      stagnationTemperatureBoost: 2,
    },
    annealing: {
      enabled: true,
      baseTemperature: 0.4,
      growthFactor: 1.8,
      maxTemperature: 4,
    },
  });
  const loaded = await loadConfig(process.cwd(), './config/pine-autoresearch.default.json');
  assert.deepEqual(loaded.searchPolicy.selfLoopEscape, config.searchPolicy.selfLoopEscape);
  assert.deepEqual(loaded.searchPolicy.annealing, config.searchPolicy.annealing);
  assert.deepEqual(config.complexityPolicy.enabled, true);
  assert.equal(config.blindHoldoutLabs.length, 2);
  assert.match(config.blindHoldoutLabs[0].labId, /blind-holdout/);
  assert.deepEqual(config.expectancyPolicy, {
    enabled: true,
    wrJumpDiagnosticThreshold: 8,
    rejectWrGainAvgWinLoss: true,
    requireExpectancyNonRegression: true,
  });
});

test('default autoresearch config rotates across multiple pinned windows', async () => {
  const raw = await fs.readFile(new URL('../config/pine-autoresearch.default.json', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const whens = new Set([config.primaryLab.when, ...config.shadowLabs.map((lab) => lab.when)]);

  assert.ok(whens.size >= 3);
  assert.ok(config.shadowLabs.length >= 5);
});


test('complexity penalty makes newly activated parameters pay for degrees of freedom', () => {
  const incumbent = makeResult({
    configId: 'incumbent',
    score: 70,
    tradeCount: 200,
    roiPct: 40,
    profitFactor: 1.6,
    maxDrawdownPct: 4,
    config: { useRegimeFilter: false, useSqueezeContext: false, minPredSum: 2 },
  });
  const challenger = makeResult({
    configId: 'challenger',
    score: 70.5,
    tradeCount: 210,
    roiPct: 40.2,
    profitFactor: 1.7,
    maxDrawdownPct: 4,
    config: { useRegimeFilter: true, useSqueezeContext: false, minPredSum: 2 },
  });

  const complexity = computeParameterComplexityPenalty({
    incumbentConfig: incumbent.config,
    challengerConfig: challenger.config,
    policy: { enabled: true, scorePenaltyPerActivatedParam: 0.75, roiPenaltyPctPerActivatedParam: 0.5 },
  });
  assert.deepEqual(complexity.activatedKeys, ['useRegimeFilter']);
  assert.equal(complexity.scorePenalty, 0.75);

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
    complexityPolicy: { enabled: true, scorePenaltyPerActivatedParam: 0.75, roiPenaltyPctPerActivatedParam: 0.5 },
  });

  assert.equal(result.recommendation, 'hold');
  assert.match(result.failedGates.join(','), /score/);
  assert.equal(result.thresholds.adjusted.minScoreDelta, 1);
  assert.equal(result.complexity.activatedCount, 1);
});

test('loadConfig normalizes blind holdout labs with slug + merged thresholds', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-test-'));
  const configPath = path.join(tempDir, 'autoresearch.json');
  await fs.writeFile(configPath, JSON.stringify({
    matrixId: 'test-matrix',
    scriptPath: '../pine/test.pine',
    grid: 'phase3-core',
    thresholds: {
      minScoreDelta: 0.5,
      minTradeCount: 111,
    },
    primaryLab: {
      labId: 'Primary Lab',
      symbol: 'XRPUSDT',
      timeframe: '15m',
      limit: 1000,
      when: '2026-04-01T00:00:00Z',
      exchange: 'default_exchange',
    },
    blindHoldoutLabs: [
      {
        labId: 'Blind Holdout November 2025',
        symbol: 'BTCUSDT',
        timeframe: '15m',
        limit: 500,
        when: '2025-11-30T23:45:00.000Z',
        exchange: 'default_exchange',
        thresholds: {
          minRoiDeltaPct: 1,
        },
      },
    ],
    outputs: {
      researchRoot: './out/research',
      digestRoot: './out/digest',
    },
  }), 'utf8');

  const config = await loadConfig(tempDir, configPath);
  assert.equal(config.blindHoldoutLabs.length, 1);
  assert.equal(config.blindHoldoutLabs[0].labId, 'blind-holdout-november-2025');
  assert.deepEqual(config.blindHoldoutLabs[0].thresholds, {
    minScoreDelta: 0.5,
    minRoiDeltaPct: 1,
    minProfitFactorDelta: 0,
    maxDrawdownDeltaPct: 0.75,
    minTradeCount: 111,
    minTradeRatioVsIncumbent: 0.75,
  });
});



test('loadConfig exposes lineage and stagnation guardrail defaults', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-elite-config-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'elite-config-test',
      scriptPath,
      researchRoot: path.join(dir, 'research'),
      digestRoot: path.join(dir, 'digest'),
      baseConfig: { minPredSum: 1.8 },
      autoPromotion: { enabled: true },
      rotationPolicy: {},
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    assert.equal(config.autoPromotion.requireMatrixPromotion, true);
    assert.equal(config.autoPromotion.lineagePolicy.enabled, true);
    assert.equal(config.autoPromotion.lineagePolicy.lookbackPromotions, 6);
    assert.equal(config.rotationPolicy.stagnation.enabled, true);
    assert.equal(config.rotationPolicy.stagnation.noNewCandidateEscalateAfter, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadConfig preserves lineagePolicy defaults when raw overrides only one field', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-elite-config-lineage-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'elite-config-lineage-partial',
      scriptPath,
      researchRoot: path.join(dir, 'research'),
      digestRoot: path.join(dir, 'digest'),
      baseConfig: { minPredSum: 1.8 },
      autoPromotion: {
        enabled: true,
        lineagePolicy: {
          enabled: false,
        },
      },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    assert.equal(config.autoPromotion.enabled, true);
    assert.equal(config.autoPromotion.lineagePolicy.enabled, false);
    assert.equal(config.autoPromotion.lineagePolicy.lookbackPromotions, 6);
    assert.ok(Array.isArray(config.autoPromotion.lineagePolicy.familyKeys));
    assert.ok(config.autoPromotion.lineagePolicy.familyKeys.includes('useFusionV4'));
    assert.equal(config.autoPromotion.lineagePolicy.baseShadowPassCount, 3);
    assert.equal(config.autoPromotion.lineagePolicy.directReversalExtraShadowPasses, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('loadConfig preserves stagnation defaults when raw overrides subset of fields', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-elite-config-stagnation-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'elite-config-stagnation-partial',
      scriptPath,
      researchRoot: path.join(dir, 'research'),
      digestRoot: path.join(dir, 'digest'),
      baseConfig: { minPredSum: 1.8 },
      autoPromotion: { enabled: true },
      rotationPolicy: {
        stagnation: {
          enabled: false,
          maxStagnationLevel: 7,
        },
      },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    assert.equal(config.rotationPolicy.stagnation.enabled, false);
    assert.equal(config.rotationPolicy.stagnation.maxStagnationLevel, 7);
    assert.equal(config.rotationPolicy.stagnation.noNewCandidateEscalateAfter, 3);
    assert.equal(config.rotationPolicy.stagnation.holdEscalateAfter, 5);
    assert.equal(config.rotationPolicy.stagnation.highSimilarityThreshold, 0.9);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('offline strict missing path builds skip result + history payload with compact lab timestamps', () => {
  const offlineDataSummary = {
    ok: false,
    reason: 'offlineDataMissing',
    mode: 'offline-strict',
    missingLabs: [{
      labId: 'primary',
      missingCount: 9,
      missingTimestamps: [
        '2026-05-01T00:00:00.000Z',
        '2026-05-01T00:15:00.000Z',
        '2026-05-01T00:30:00.000Z',
        '2026-05-01T00:45:00.000Z',
        '2026-05-01T01:00:00.000Z',
      ],
    }],
  };

  const skipResult = buildOfflineDataMissingSkipResult({ offlineDataSummary });
  assert.equal(skipResult.skipped, true);
  assert.equal(skipResult.reason, 'offlineDataMissing');
  assert.equal(skipResult.promotionEligible, false);
  assert.equal(skipResult.promotionEligibleReason, 'offlineDataMissing');
  assert.equal(skipResult.offlineDataSummary.reason, 'offlineDataMissing');

  const event = buildOfflineDataMissingCycleEvent({
    runId: 'run-offline-missing',
    offlineDataSummary: skipResult.offlineDataSummary,
  });
  assert.equal(event.type, 'cycle');
  assert.equal(event.runId, 'run-offline-missing');
  assert.equal(event.recommendation, 'hold');
  assert.equal(event.summary, 'offlineDataMissing');
  assert.equal(event.promotionEligible, false);
  assert.equal(event.promotionEligibleReason, 'offlineDataMissing');
  assert.equal(event.offlineDataSummary.reason, 'offlineDataMissing');
  assert.equal(event.offlineDataSummary.missingLabs[0].missingCount, 9);
  assert.equal(event.offlineDataSummary.missingLabs[0].missingTimestamps.length, 5);
});



test('runScout offline-strict missing branch appends cycle history and returns skipped payload', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-offline-missing-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    const cacheRoot = path.join(dir, 'cache-empty');
    await fs.mkdir(cacheRoot, { recursive: true });
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'offline-runscout-test',
      scriptPath,
      outputs: {
        researchRoot,
        digestRoot,
      },
      primaryLab: {
        labId: 'primary',
        symbol: 'XRPUSDT',
        timeframe: '15m',
        limit: 12,
        when: '2026-05-01T03:00:00.000Z',
        exchange: 'ccxt-exchange',
      },
      shadowLabs: [],
      blindHoldoutLabs: [],
      pinnedData: {
        enabled: true,
        datasetsRoot: path.join(dir, 'datasets'),
        cacheRoot,
        exchangeName: 'ccxt-exchange',
      },
      regimeExitResearch: {
        enabled: true,
        offline: {
          mode: 'offline-strict',
        },
      },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    await fs.mkdir(config.researchRoot, { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      configId: 'champion-seed',
      config: { minPredSum: 1.8 },
      configFingerprint: 'seed-fp',
    }), 'utf8');

    const result = await autoresearchCli.runScout(config);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'offlineDataMissing');
    assert.equal(result.promotionEligibleReason, 'offlineDataMissing');

    const historyPath = path.join(config.researchRoot, 'history.jsonl');
    const historyRaw = await fs.readFile(historyPath, 'utf8');
    const historyEvents = historyRaw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const cycleEvent = historyEvents.find((event) => event.type === 'cycle');

    assert.ok(cycleEvent);
    assert.equal(cycleEvent.promotionEligible, false);
    assert.equal(cycleEvent.promotionEligibleReason, 'offlineDataMissing');
    assert.equal(cycleEvent.offlineDataSummary.reason, 'offlineDataMissing');

    const missingLab = cycleEvent.offlineDataSummary.missingLabs[0];
    assert.ok(missingLab);
    assert.ok(Array.isArray(missingLab.missingTimestamps));
    assert.ok(missingLab.missingTimestamps.length <= 5);
    if (missingLab.missingCount > 5) {
      assert.equal(missingLab.missingTimestamps.length, 5);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('partitionLabs keeps blind holdout out of selection labs', () => {
  const tiers = partitionLabs({
    primaryLab: { labId: 'train-primary' },
    shadowLabs: [{ labId: 'selection-shadow' }],
    blindHoldoutLabs: [{ labId: 'november-blind' }],
  });

  assert.deepEqual(tiers.trainingLabs.map((lab) => lab.labId), ['train-primary']);
  assert.deepEqual(tiers.selectionLabs.map((lab) => lab.labId), ['train-primary', 'selection-shadow']);
  assert.deepEqual(tiers.blindHoldoutLabs.map((lab) => lab.labId), ['november-blind']);
});


