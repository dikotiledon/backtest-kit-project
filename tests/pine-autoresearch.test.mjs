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
  configFingerprint,
  sameConfig,
  selectChampionBootstrapSource,
  selectRobustMatrixCandidate,
  summarizeDigestAnnouncement,
} from '../scripts/lib/pine-autoresearch.mjs';
import {
  buildChampionConfigFingerprint,
  buildGlobalPatchFingerprint,
} from '../scripts/lib/pine-global-search.mjs';
import { buildLanePatchFingerprint } from '../scripts/lib/pine-lane-novelty.mjs';
import { selectNextResearchLane } from '../scripts/lib/pine-regime-exit-scheduler.mjs';
import { buildTrackCandidateBatch } from '../scripts/lib/pine-track-generators.mjs';
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
  resolveEffectiveRuntimeExchange,
  mergeSchedulerTabuFingerprints,
  normalizeTabuEntries,
  resolvePromotionManifestPath,
  resolveTrackSelectionState,
  selectChangedMatrixCandidate,
  selectPromotionManifestSource,
  shouldQueuePromotionManifest,
  withManifestPath,
  applySchedulerStateToManifest,
  buildOfflineDataMissingCycleEvent,
  buildOfflineDataMissingSkipResult,
  buildRegimeExitStateForScout,
  buildRegimeAwareSearchBatch,
  collectTestedGlobalPatchFingerprints,
  loadRecentCompletedManifestsForNovelty,
  shouldSkipGeneratedLaneSweep,
  shouldSkipGlobalAllParameterSweep,
  buildGlobalAllParameterExhaustedManifest,
  resolveConsumedBudgetLane,
  resolveLaneBudgetDebtAdvance,
} from '../scripts/pine-autoresearch.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loadConfig preserves searchPolicy tabu policy from file config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-config-tabu-'));
  const configPath = path.join(dir, 'autoresearch.json');

  try {
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'tabu-load-test',
      scriptPath: 'strategy.pine',
      grid: 'phase3-core',
      primaryLab: { labId: 'Primary', symbol: 'XRPUSDT', timeframe: '15m', limit: 120 },
      outputs: { researchRoot: 'research', digestRoot: 'digest' },
      searchPolicy: {
        mode: 'incumbent-local',
        tabu: { maxAgeCycles: 7, maxEntries: 11, dropOnChampionChange: false },
      },
    }), 'utf8');

    const config = await loadConfig(dir, configPath, {});

    assert.deepEqual(config.searchPolicy.tabu, {
      maxAgeCycles: 7,
      maxEntries: 11,
      dropOnChampionChange: false,
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('loadConfig preserves incumbent search policy mutation bounds and architecture knobs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-config-policy-'));
  const configPath = path.join(dir, 'autoresearch.json');

  try {
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'policy-load-test',
      scriptPath: 'strategy.pine',
      grid: 'phase3-core',
      primaryLab: { labId: 'Primary', symbol: 'XRPUSDT', timeframe: '15m', limit: 120 },
      outputs: { researchRoot: 'research', digestRoot: 'digest' },
      searchPolicy: {
        mode: 'incumbent-local',
        freezeArchitecture: false,
        frozenArchitectureKeys: 'useSignalFusion,useFusionV4',
        patchBounds: {
          minPredSum: [1.25, 8],
          neighborsCount: { min: 16, max: 96 },
        },
      },
    }), 'utf8');

    const config = await loadConfig(dir, configPath, {});

    assert.equal(config.searchPolicy.freezeArchitecture, false);
    assert.deepEqual(config.searchPolicy.frozenArchitectureKeys, ['useSignalFusion', 'useFusionV4']);
    assert.deepEqual(config.searchPolicy.patchBounds, {
      minPredSum: [1.25, 8],
      neighborsCount: { min: 16, max: 96 },
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('canonical config fingerprint ignores identity-only keys everywhere', () => {
  const semantic = { tpAtrMult: 7.6, slAtrMult: 0.5, useFusionV4: true };
  const withIdentity = {
    ...semantic,
    configId: 'candidate-identity',
    label: 'candidate label',
    promotedAt: '2026-05-12T00:00:00.000Z',
    sourceRunId: 'run-identity',
    configFingerprint: 'identity-only-fingerprint',
  };

  assert.equal(buildChampionConfigFingerprint(semantic), buildChampionConfigFingerprint(withIdentity));
  assert.equal(
    autoresearchCli.buildCanonicalConfigFingerprint(semantic),
    autoresearchCli.buildCanonicalConfigFingerprint(withIdentity),
  );
});

test('collectRecentTestedCandidateFingerprints includes held, promoted, and no-new-candidate variants', () => {
  const fingerprints = autoresearchCli.collectTestedCandidateFingerprintsFromManifests([
    { searchPlan: { variants: [{ config: { a: 1 } }, { config: { a: 2 } }] } },
    { matrixCandidates: [{ challenger: { config: { a: 3 } } }] },
  ]);

  assert.equal(fingerprints.size, 3);
  assert.ok(fingerprints.has(autoresearchCli.buildCanonicalConfigFingerprint({ a: 1 })));
  assert.ok(fingerprints.has(autoresearchCli.buildCanonicalConfigFingerprint({ a: 2 })));
  assert.ok(fingerprints.has(autoresearchCli.buildCanonicalConfigFingerprint({ a: 3 })));
});

test('collectTestedCandidateFingerprintsFromManifests includes challenger config and ignores malformed manifests', () => {
  const fingerprints = autoresearchCli.collectTestedCandidateFingerprintsFromManifests([
    null,
    { searchPlan: { variants: [{ config: null }, {}, { config: [] }] } },
    { matrixCandidates: [null, { challenger: {} }] },
    { challenger: { config: { a: 4 } } },
  ]);

  assert.deepEqual([...fingerprints], [autoresearchCli.buildCanonicalConfigFingerprint({ a: 4 })]);
});

test('collectTestedCandidateFingerprintsFromManifests canonicalizes identity-only metadata', () => {
  const fingerprints = autoresearchCli.collectTestedCandidateFingerprintsFromManifests([
    { challenger: { config: { a: 5, configId: 'first', sourceRunId: 'run-a' } } },
    { searchPlan: { variants: [{ config: { a: 5, configId: 'second', promotedAt: '2026-05-12T00:00:00.000Z' } }] } },
  ]);

  assert.deepEqual([...fingerprints], [autoresearchCli.buildCanonicalConfigFingerprint({ a: 5 })]);
});

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

function spawnNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
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

test('evaluateMatrix honors require holdout mode and blocks pending blind holdout', async () => {
  const champion = makeResult({
    configId: 'champion',
    score: 100,
    tradeCount: 200,
    roiPct: 40,
    profitFactor: 1.4,
    maxDrawdownPct: 5,
    config: { minPredSum: 2 },
  });
  const challenger = makeResult({
    configId: 'challenger',
    score: 110,
    tradeCount: 220,
    roiPct: 55,
    profitFactor: 1.8,
    maxDrawdownPct: 5.1,
    config: { minPredSum: 1.8 },
  });

  const result = await evaluateMatrix({
    primaryLab: {
      labId: 'primary',
      thresholds: {
        minScoreDelta: 0.25,
        minRoiDeltaPct: 0,
        minProfitFactorDelta: 0,
        maxDrawdownDeltaPct: 0.75,
        minTradeCount: 100,
        minTradeRatioVsIncumbent: 0.75,
        significance: { minRelativeScoreDelta: 0, minTradeCount: 100 },
      },
    },
    shadowLabs: [],
    blindHoldoutLabs: [{ labId: 'blind-holdout-a' }],
    holdoutMode: 'require',
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
  }, 'run-holdout-require', champion, challenger, {
    evaluateConfigOnLab: async ({ candidate }) => candidate,
  });

  assert.equal(result.labResults[0].decision.recommendation, 'hold');
  assert.equal(result.labResults[0].decision.holdoutGate.status, 'pending');
  assert.equal(result.labResults[0].decision.gates.holdoutVerdict, false);
  assert.deepEqual(result.labResults[0].decision.failedGates, ['holdoutVerdict']);
  assert.equal(result.matrixDecision.recommendation, 'hold');
  assert.equal(result.matrixDecision.gates.primaryPromote, false);
});

test('collectTestedGlobalPatchFingerprints reads v2 manifest searchPlan variants for same champion only', () => {
  const currentChampion = { configId: 'champ-current', config: { minPredSum: 1.8, adxThreshold: 20 } };
  const championConfigFingerprint = buildChampionConfigFingerprint(currentChampion.config);
  const entryPatch = { minPredSum: 2 };
  const filtersPatch = { adxThreshold: 22 };
  const entryFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: entryPatch,
  });
  const filtersFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'global-all-parameter',
    mutationFamily: 'filters',
    patch: filtersPatch,
  });
  const manifests = [
    {
      champion: { configId: 'champ-current', config: { adxThreshold: 20, minPredSum: 1.8 } },
      searchPlan: {
        variants: [
          {
            lane: 'globalAllParameter',
            patchFingerprint: entryFingerprint,
            patch: entryPatch,
            mutationFamily: 'entry',
            metadata: {
              championConfigFingerprint,
              patchFingerprintVersion: 2,
              patchFingerprint: entryFingerprint,
            },
          },
          {
            lane: 'global-all-parameter',
            patchFingerprint: filtersFingerprint,
            patch: filtersPatch,
            family: 'filters',
            metadata: {
              championConfigFingerprint,
              patchFingerprintVersion: 2,
            },
          },
          {
            lane: 'exitRegime',
            patchFingerprint: 'fp-exit-regime',
          },
        ],
      },
    },
    {
      champion: { configId: 'other-champ', config: { minPredSum: 2.6, adxThreshold: 20 } },
      searchPlan: {
        variants: [
          { lane: 'globalAllParameter', patchFingerprint: 'fp-other', metadata: { patchFingerprintVersion: 2 } },
        ],
      },
    },
  ];

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: currentChampion,
    manifests,
  });

  assert.deepEqual([...fingerprints].sort(), [entryFingerprint, filtersFingerprint].sort());
});

test('collectTestedGlobalPatchFingerprints matches same championConfigFingerprint across configId changes', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const patch = { minPredSum: 2 };
  const patchFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch,
  });
  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'new-label', config: { adxThreshold: 20, minPredSum: 1.8 } },
    manifests: [
      {
        champion: { configId: 'old-label', config: championConfig },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              patchFingerprint,
              patch,
              mutationFamily: 'entry',
              metadata: { championConfigFingerprint, patchFingerprintVersion: 2 },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});


test('collectTestedGlobalPatchFingerprints collects minimal manifest matched by variant championConfigFingerprint', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const patchFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'new-id', config: championConfig },
    manifests: [
      {
        champion: { configId: 'old-id' },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              patchFingerprint,
              patch: { minPredSum: 2 },
              metadata: {
                championConfigFingerprint,
                patchFingerprintVersion: 2,
                mutationFamily: 'entry',
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('collectTestedGlobalPatchFingerprints reconstructs v2 fingerprint from legacy manifest patch evidence', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const patch = { minPredSum: 2 };
  const expected = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch,
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    manifests: [
      {
        champion: { configId: 'champ-legacy', config: { adxThreshold: 20, minPredSum: 1.8 } },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              patch,
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [expected]);
});

test('collectTestedGlobalPatchFingerprints reconstructs legacy patch from variant config and champion config', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const expected = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    manifests: [
      {
        champion: { configId: 'champ-legacy', config: championConfig },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              config: { minPredSum: 2, adxThreshold: 20 },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [expected]);
});

test('collectTestedGlobalPatchFingerprints rejects variant patch config disagreement poison', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const actualPatchFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });
  const poisonedPatchFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 9 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    manifests: [
      {
        champion: { configId: 'champ-current', config: championConfig },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              patch: { minPredSum: 9 },
              config: { minPredSum: 2, adxThreshold: 20 },
              patchFingerprint: poisonedPatchFingerprint,
              metadata: {
                championConfigFingerprint,
                patchFingerprintVersion: 2,
                patchFingerprint: poisonedPatchFingerprint,
              },
            },
          ],
        },
      },
    ],
  });

  assert.equal(fingerprints.has(poisonedPatchFingerprint), false);
  assert.equal(fingerprints.has(actualPatchFingerprint), false);
  assert.equal(fingerprints.size, 0);
});

test('collectTestedGlobalPatchFingerprints rejects malformed stored fingerprint when reconstruction disagrees', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const expected = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    manifests: [
      {
        champion: { configId: 'champ-legacy', config: championConfig },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              patch: { minPredSum: 2 },
              patchFingerprint: 'bogus-stored-fingerprint',
              metadata: {
                championConfigFingerprint,
                patchFingerprintVersion: 2,
                patchFingerprint: 'also-bogus',
              },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [expected]);
  assert.equal(fingerprints.has('bogus-stored-fingerprint'), false);
  assert.equal(fingerprints.has('also-bogus'), false);
});

test('collectTestedGlobalPatchFingerprints ignores stored-only fingerprints without patch or config evidence', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const manifests = [
    {
      champion: { configId: 'champ-current', config: championConfig },
      searchPlan: {
        variants: [
          {
            lane: 'globalAllParameter',
            family: 'entry',
            patchFingerprint: 'stored-only-manifest-config-poison',
            metadata: {
              championConfigFingerprint,
              patchFingerprintVersion: 2,
              patchFingerprint: 'stored-only-manifest-config-poison',
            },
          },
        ],
      },
    },
    {
      championConfigFingerprint,
      searchPlan: {
        variants: [
          {
            lane: 'globalAllParameter',
            family: 'entry',
            patchFingerprint: 'stored-only-fingerprint-poison',
            metadata: {
              championConfigFingerprint,
              patchFingerprintVersion: 2,
              patchFingerprint: 'stored-only-fingerprint-poison',
            },
          },
        ],
      },
    },
  ];

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    manifests,
  });

  assert.equal(fingerprints.has('stored-only-manifest-config-poison'), false);
  assert.equal(fingerprints.has('stored-only-fingerprint-poison'), false);
  assert.equal(fingerprints.size, 0);
});

test('collectTestedGlobalPatchFingerprints reconstructs config-only variant when manifest has fingerprint but no champion config', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const expected = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    manifests: [
      {
        champion: { configId: 'legacy-summary', config: null },
        championConfigFingerprint,
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              config: { minPredSum: 2, adxThreshold: 20 },
              patchFingerprint: expected,
              metadata: { patchFingerprintVersion: 2, patchFingerprint: expected },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [expected]);
});

test('collectTestedGlobalPatchFingerprints uses current config for variant-matched stale manifest config reconstruction', () => {
  const currentConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const staleConfig = { minPredSum: 1.1, adxThreshold: 20 };
  const currentFingerprint = buildChampionConfigFingerprint(currentConfig);
  const staleFingerprint = buildChampionConfigFingerprint(staleConfig);
  const expected = buildGlobalPatchFingerprint({
    championConfigFingerprint: currentFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });
  const staleBogus = buildGlobalPatchFingerprint({
    championConfigFingerprint: currentFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2, adxThreshold: 20 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: currentConfig },
    manifests: [
      {
        champion: { configId: 'champ-stale', config: staleConfig },
        championConfigFingerprint: staleFingerprint,
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              config: { minPredSum: 2, adxThreshold: 20 },
              metadata: { championConfigFingerprint: currentFingerprint },
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [expected]);
  assert.equal(fingerprints.has(staleBogus), false);
});

test('collectTestedGlobalPatchFingerprints does not collect old fingerprints for same configId changed config', () => {
  const oldConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const newConfig = { minPredSum: 2.4, adxThreshold: 20 };
  const oldConfigFingerprint = buildChampionConfigFingerprint(oldConfig);
  const oldPatchFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint: oldConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2 },
  });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'reused-id', config: newConfig },
    manifests: [
      {
        champion: { configId: 'reused-id', config: oldConfig },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              patchFingerprint: oldPatchFingerprint,
              patch: { minPredSum: 2 },
              mutationFamily: 'entry',
              metadata: {
                championConfigFingerprint: oldConfigFingerprint,
                patchFingerprintVersion: 2,
              },
            },
          ],
        },
      },
    ],
  });

  assert.equal(fingerprints.has(oldPatchFingerprint), false);
  assert.equal(fingerprints.size, 0);
});

test('collectTestedGlobalPatchFingerprints ignores minimal legacy manifest matched only by reused configId', () => {
  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'same-id', config: { minPredSum: 2.4, adxThreshold: 20 } },
    manifests: [
      {
        champion: { configId: 'same-id' },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              family: 'entry',
              patch: { minPredSum: 2 },
            },
          ],
        },
      },
    ],
  });

  assert.equal(fingerprints.size, 0);
});

test('collectTestedGlobalPatchFingerprints accepts future history event manifests', () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const patch = { minPredSum: 2 };
  const patchFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch,
  });
  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: { configId: 'champ-current', config: championConfig },
    historyEvents: [
      {
        type: 'cycle-complete',
        manifest: {
          champion: { configId: 'champ-current', config: championConfig },
          searchPlan: {
            variants: [
              {
                lane: 'globalAllParameter',
                patchFingerprint,
                patch,
                mutationFamily: 'entry',
                metadata: { championConfigFingerprint, patchFingerprintVersion: 2 },
              },
            ],
          },
        },
      },
    ],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('loadRecentCompletedManifestsForNovelty reads recent manifests and ignores missing or malformed files', async () => {
  const missingRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-novelty-missing-'));
  assert.deepEqual(await loadRecentCompletedManifestsForNovelty({ config: { researchRoot: missingRoot } }), []);

  const researchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-novelty-manifests-'));
  const config = { researchRoot };
  const dir = manifestsDir(config);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '001-old.json'), JSON.stringify({ runId: 'old' }), 'utf8');
  await fs.writeFile(path.join(dir, '002-valid.json'), JSON.stringify({ runId: 'valid' }), 'utf8');
  await fs.writeFile(path.join(dir, '003-malformed.json'), '{', 'utf8');
  await fs.writeFile(path.join(dir, '004-new.json'), JSON.stringify({ runId: 'new' }), 'utf8');
  await fs.writeFile(path.join(dir, 'ignored.txt'), JSON.stringify({ runId: 'ignored' }), 'utf8');

  const manifests = await loadRecentCompletedManifestsForNovelty({ config, limit: 3 });

  assert.deepEqual(manifests.map((manifest) => manifest.runId), ['valid', 'new']);
});

test('loadRecentCompletedManifestsForNovelty can scan all retained manifests for novelty', async () => {
  const researchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-novelty-all-'));
  const config = { researchRoot };
  const dir = manifestsDir(config);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '001-old.json'), JSON.stringify({ runId: 'old' }), 'utf8');
  await fs.writeFile(path.join(dir, '002-middle.json'), JSON.stringify({ runId: 'middle' }), 'utf8');
  await fs.writeFile(path.join(dir, '003-new.json'), JSON.stringify({ runId: 'new' }), 'utf8');

  const recentOnly = await loadRecentCompletedManifestsForNovelty({ config, limit: 1 });
  const allRetained = await loadRecentCompletedManifestsForNovelty({ config, limit: null });

  assert.deepEqual(recentOnly.map((manifest) => manifest.runId), ['new']);
  assert.deepEqual(allRetained.map((manifest) => manifest.runId), ['old', 'middle', 'new']);
});

test('buildRegimeAwareSearchBatch skips tested global patch outside recent manifest window when all retained manifests are loaded', async () => {
  const championConfig = { minPredSum: 1.8, adxThreshold: 20 };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const testedPatch = { minPredSum: 2 };
  const expectedFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch: testedPatch,
  });
  const researchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-novelty-window-'));
  const config = { researchRoot };
  const dir = manifestsDir(config);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '001-old-tested.json'), JSON.stringify({
    runId: 'old-tested',
    champion: { configId: 'old-id', config: championConfig },
    searchPlan: {
      variants: [{ lane: 'globalAllParameter', family: 'entry', patch: testedPatch }],
    },
  }), 'utf8');
  await fs.writeFile(path.join(dir, '002-middle.json'), JSON.stringify({ runId: 'middle' }), 'utf8');
  await fs.writeFile(path.join(dir, '003-new.json'), JSON.stringify({ runId: 'new' }), 'utf8');

  const recentOnly = await loadRecentCompletedManifestsForNovelty({ config, limit: 1 });
  const allRetained = await loadRecentCompletedManifestsForNovelty({ config, limit: null });
  assert.equal(collectTestedGlobalPatchFingerprints({
    champion: { configId: 'current-id', config: championConfig },
    manifests: recentOnly,
  }).has(expectedFingerprint), false);

  const blockedBatch = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion: { configId: 'current-id', config: championConfig },
    maxConfigs: 1,
    policy: {
      recentManifestsForNovelty: allRetained,
      globalAllParameterVariantsPerFamily: 1,
    },
    regimeExitResearch: { enabled: true },
  });

  assert.equal(blockedBatch.some((variant) => variant.patchFingerprint === expectedFingerprint), false);
  assert.deepEqual(blockedBatch.map((variant) => variant.family), ['filters']);
});

for (const helpArgs of [['--help'], ['-h'], ['help']]) {
  test(`pine-autoresearch ${helpArgs.join(' ')} exits before config load or lock acquisition`, async () => {
    const result = await spawnNode([
      path.join(repoRoot, 'scripts/pine-autoresearch.mjs'),
      ...helpArgs,
      '--config',
      path.join(repoRoot, 'tmp', 'definitely-missing-autoresearch-config.json'),
    ], {
      cwd: repoRoot,
      env: process.env,
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:.*pine-autoresearch/i);
    assert.doesNotMatch(result.stdout + result.stderr, /cycle=|lock|manifest=|recommendation=/i);
    assert.doesNotMatch(result.stdout + result.stderr, /ENOENT|no such file|cannot find|missing.*config/i);
  });
}

test('pine-autoresearch-run.ps1 parses cleanly', async () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const command = `$null = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile(${psSingleQuote(scriptPath)}, [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_.Message }; exit 1 }`;
  const result = await runPwsh(command);

  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test('pine-autoresearch-scheduler-health.ps1 parses cleanly', async () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const command = `$null = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile(${psSingleQuote(scriptPath)}, [ref]$null, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_.Message }; exit 1 }`;
  const result = await runPwsh(command);

  assert.equal(result.code, 0, result.stderr || result.stdout);
});

test('pine scheduler-health npm script points at health command', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts['pine:ops:scheduler-health'],
    'pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-scheduler-health.ps1',
  );
});

test('pine-autoresearch-scheduler-health.ps1 reports healthy when lock is missing', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-scheduler-health-missing-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const lockPath = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks', 'scheduler.lock');
  const result = await runPwshFile(scriptPath, ['-RepoRoot', tempRoot], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`status=healthy reason=lock-missing lock=${lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('pine-autoresearch-scheduler-health.ps1 reports busy for a fresh live lock', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-scheduler-health-live-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  const lockPath = path.join(lockDir, 'scheduler.lock');
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(lockPath, [
    'task=live-check',
    `pid=${process.pid}`,
    `startedAt=${new Date().toISOString()}`,
    '',
  ].join('\n'), 'utf8');
  const result = await runPwshFile(scriptPath, ['-RepoRoot', tempRoot], { cwd: repoRoot });

  assert.equal(result.code, 1);
  assert.match(result.stdout, /status=busy reason=owner-active ownerAlive=True task=live-check/);
  assert.match(result.stdout, new RegExp(`pid=${process.pid} lock=${lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.notEqual(await readIfExists(lockPath), null);
});

test('pine-autoresearch-scheduler-health.ps1 inspects and reclaims a dead-owner lock', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-scheduler-health-stale-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-scheduler-health.ps1');
  const lockDir = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks');
  const lockPath = path.join(lockDir, 'scheduler.lock');
  await fs.mkdir(lockDir, { recursive: true });
  const lockPayload = [
    'task=dead-check',
    'pid=99999999',
    `startedAt=${new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString()}`,
    '',
  ].join('\n');
  await fs.writeFile(lockPath, lockPayload, 'utf8');

  const inspect = await runPwshFile(scriptPath, ['-RepoRoot', tempRoot], { cwd: repoRoot });
  assert.equal(inspect.code, 2);
  assert.match(inspect.stdout, /status=stale action=inspect-only reason=owner-dead ownerAlive=False task=dead-check pid=99999999/);
  assert.match(inspect.stdout, new RegExp(`lock=${lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(await readIfExists(lockPath), lockPayload);

  const reclaim = await runPwshFile(scriptPath, ['-RepoRoot', tempRoot, '-Reclaim'], { cwd: repoRoot });
  assert.equal(reclaim.code, 0, reclaim.stderr || reclaim.stdout);
  assert.match(reclaim.stdout, /status=reclaimed reason=owner-dead ownerAlive=False task=dead-check pid=99999999/);
  assert.match(reclaim.stdout, new RegExp(`lock=${lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(await readIfExists(lockPath), null);
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

test('scheduler wrapper reports failure when command exits zero without manifest marker', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-wrapper-manifest-'));
  const commandPath = path.join(tempRoot, 'fake-command.ps1');
  await fs.writeFile(commandPath, 'Write-Output "fake success without manifest"\nexit 0\n', 'utf8');

  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'manifest-check',
    '-CommandPath', commandPath,
    '-RepoRoot', tempRoot,
    '-RequireManifest',
    '-ManifestRoot', tempRoot,
    '-ExpectedRunId', 'missing-run',
    '-LockName', `Global\\BacktestKit-Pine-Autoresearch-Test-Manifest-${process.pid}`,
  ], { cwd: repoRoot });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr + result.stdout, /manifest.*missing|missing.*manifest/i);
});

test('scheduler wrapper validates required manifest JSON and runId', async () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');

  for (const [caseName, body, expected] of [
    ['empty', '', /manifest is empty/i],
    ['malformed', '{', /manifest is malformed/i],
    ['array', '[]', /manifest must be a JSON object/i],
    ['missing-run-id', '{}', /manifest missing runId/i],
    ['mismatch', '{"runId":"other-run"}', /runId mismatch/i],
  ]) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `pine-wrapper-manifest-${caseName}-`));
    const manifestDir = path.join(tempRoot, 'manifests');
    await fs.mkdir(manifestDir, { recursive: true });
    await fs.writeFile(path.join(manifestDir, 'expected-run.json'), body, 'utf8');
    const commandPath = path.join(tempRoot, 'fake-command.ps1');
    await fs.writeFile(commandPath, 'exit 0\n', 'utf8');

    const result = await runPwshFile(scriptPath, [
      '-TaskName', `manifest-${caseName}`,
      '-CommandPath', commandPath,
      '-RepoRoot', tempRoot,
      '-RequireManifest',
      '-ManifestRoot', tempRoot,
      '-ExpectedRunId', 'expected-run',
      '-LockName', `Global\\BacktestKit-Pine-Autoresearch-Test-Manifest-${caseName}-${process.pid}`,
    ], { cwd: repoRoot });

    assert.notEqual(result.code, 0, `${caseName} should fail`);
    assert.match(result.stderr + result.stdout, expected, caseName);
  }
});

test('pine-autoresearch-run.ps1 drains stderr without pipe deadlock', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-stderr-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const lockPath = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks', 'scheduler.lock');
  const markerPath = path.join(tempRoot, 'stderr-marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'stderr-check',
    '-Command', `1..8000 | ForEach-Object { [Console]::Error.WriteLine(('stderr-line-' + $_).PadRight(200, 'x')) }; Set-Content -LiteralPath ${psSingleQuote(markerPath)} -Value 'ran'`,
    '-RepoRoot', tempRoot,
    '-LockName', `Global\\BacktestKit-Pine-Autoresearch-Test-Stderr-${process.pid}`,
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal((await readIfExists(markerPath))?.trim(), 'ran');
  assert.equal(await readIfExists(lockPath), null);
  const logs = await fs.readdir(path.join(tempRoot, 'tmp', 'pine-autoresearch-logs'));
  const logPath = path.join(tempRoot, 'tmp', 'pine-autoresearch-logs', logs.find((name) => /^stderr-check-.*\.log$/.test(name)));
  const log = await fs.readFile(logPath, 'utf8');
  assert.match(log, /stderr-line-8000/);
});

test('pine-autoresearch-run.ps1 times out hung command and removes scheduler lock', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-run-timeout-'));
  const scriptPath = path.join(repoRoot, 'scripts', 'ops', 'pine-autoresearch-run.ps1');
  const lockPath = path.join(tempRoot, 'tmp', 'pine-autoresearch-locks', 'scheduler.lock');
  const markerPath = path.join(tempRoot, 'timeout-marker.txt');
  const result = await runPwshFile(scriptPath, [
    '-TaskName', 'timeout-check',
    '-Command', `Set-Content -LiteralPath ${psSingleQuote(markerPath)} -Value $PID; Start-Sleep -Seconds 30`,
    '-RepoRoot', tempRoot,
    '-LockName', `Global\\BacktestKit-Pine-Autoresearch-Test-Timeout-${process.pid}`,
    '-TimeoutSeconds', '1',
  ], { cwd: repoRoot });

  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /timeout after 1s; killing process tree/);
  assert.equal(await readIfExists(lockPath), null);
  const childPid = Number((await readIfExists(markerPath))?.trim());
  assert.equal(Number.isFinite(childPid), true);
  const liveCheck = await runPwsh(`if (Get-Process -Id ${childPid} -ErrorAction SilentlyContinue) { exit 1 }`);
  assert.equal(liveCheck.code, 0, liveCheck.stderr || liveCheck.stdout);
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
    score: 62,
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
  assert.equal(result.gates.significance, true);
  assert.equal(result.significanceGate.reason, 'significant');
});

test('decideAutoresearchOutcome rejects small noise deltas with significance gate', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 220, maxDrawdownPct: 5 }),
    challenger: makeResult({ configId: 'challenger', score: 101.5, roiPct: 41, profitFactor: 1.5, tradeCount: 220, maxDrawdownPct: 5 }),
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.deepEqual(outcome.failedGates, ['significance']);
  assert.equal(outcome.gates.significance, false);
  assert.equal(outcome.significanceGate.reason, 'score_delta_below_floor');
});

test('decideAutoresearchOutcome promotes sufficiently large relative score deltas', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 220, maxDrawdownPct: 5 }),
    challenger: makeResult({ configId: 'challenger', score: 103, roiPct: 41, profitFactor: 1.5, tradeCount: 220, maxDrawdownPct: 5 }),
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
    },
  });

  assert.equal(outcome.recommendation, 'promote');
  assert.deepEqual(outcome.failedGates, []);
  assert.equal(outcome.gates.significance, true);
  assert.equal(outcome.significanceGate.reason, 'significant');
});

test('decideAutoresearchOutcome preserves earlier failure reasons when significance also fails', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 220, maxDrawdownPct: 5 }),
    challenger: makeResult({ configId: 'challenger', score: 100.1, roiPct: 41, profitFactor: 1.5, tradeCount: 220, maxDrawdownPct: 5 }),
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.deepEqual(outcome.failedGates, ['score', 'significance']);
  assert.equal(outcome.gates.score, false);
  assert.equal(outcome.gates.significance, false);
  assert.equal(outcome.significanceGate.reason, 'score_delta_below_floor');
  assert.match(outcome.summary, /failed score, significance gate\(s\)\./);
});

test('decideAutoresearchOutcome applies default significance sample floor to legacy thresholds', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 140, maxDrawdownPct: 5 }),
    challenger: makeResult({ configId: 'challenger', score: 103, roiPct: 41, profitFactor: 1.5, tradeCount: 120, maxDrawdownPct: 5 }),
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 100,
      minTradeRatioVsIncumbent: 0.75,
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.equal(outcome.gates.tradeFloor, true);
  assert.equal(outcome.gates.significance, false);
  assert.deepEqual(outcome.failedGates, ['significance']);
  assert.equal(outcome.significanceGate.reason, 'insufficient_sample');
  assert.equal(outcome.significanceGate.challengerTradeCount, 120);
  assert.equal(outcome.significanceGate.minTradeCount, 150);
});

test('decideAutoresearchOutcome blocks promotion when blind holdout verdict is required synchronously', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 50, tradeCount: 100 }),
    challenger: makeResult({ configId: 'challenger', score: 120, roiPct: 70, tradeCount: 160 }),
    matrixDecision: {
      recommendation: 'promote',
      gates: { candidateChanged: true, primaryPromote: true, shadowPassCount: true, shadowPassRatio: true },
      failedGates: [],
    },
    expectancy: { gate: { passed: true } },
    holdoutVerdict: null,
    blindHoldoutLabs: [{ labId: 'xrpusdt-15m-nov2025-blind-holdout' }],
    holdoutMode: 'require',
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.match(outcome.summary, /holdout verdict required/i);
});

test('decideAutoresearchOutcome rejects near-zero ROI improvement despite other passing gates', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 100 }),
    challenger: makeResult({ configId: 'challenger', score: 103, roiPct: 40.1, profitFactor: 1.41, tradeCount: 160 }),
    matrixDecision: {
      recommendation: 'promote',
      gates: { candidateChanged: true, primaryPromote: true, shadowPassCount: true, shadowPassRatio: true },
      failedGates: [],
    },
    expectancy: { gate: { passed: true } },
    holdoutVerdict: { passed: true },
    promotionPolicy: {
      minRoiDeltaPct: 5,
      minProfitFactorDelta: 0.1,
      minTradeCount: 60,
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.match(outcome.summary, /ROI|profit factor/i);
});

test('decideAutoresearchOutcome holds when profitability floor sees non-finite challenger metrics', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 5 }),
    challenger: makeResult({ configId: 'challenger', score: 103, roiPct: Infinity, profitFactor: Infinity, tradeCount: 110, maxDrawdownPct: 5 }),
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 60,
      minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.02, minTradeCount: 60 },
    },
    holdoutVerdict: { passed: true },
    promotionPolicy: {
      minRoiDeltaPct: 5,
      minProfitFactorDelta: 0.1,
      minTradeCount: 60,
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.equal(outcome.profitabilityFloor.invalid, true);
  assert.equal(outcome.profitabilityFloor.reason, 'non_finite_profitability_input');
  assert.deepEqual(outcome.profitabilityFloor.invalidFields, ['challengerRoiPct', 'challengerProfitFactor']);
  assert.match(outcome.summary, /non_finite_profitability_input/);
});

test('decideAutoresearchOutcome profitability floor trade-count-only failure summary is specific', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 5 }),
    challenger: makeResult({ configId: 'challenger', score: 101, roiPct: 50, profitFactor: 1.6, tradeCount: 80, maxDrawdownPct: 5 }),
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 60,
      minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0, minTradeCount: 60 },
    },
    holdoutVerdict: { passed: true },
    promotionPolicy: {
      minRoiDeltaPct: 5,
      minProfitFactorDelta: 0.1,
      minTradeCount: 90,
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.match(outcome.summary, /trade count 80 < 90/);
  assert.doesNotMatch(outcome.summary, /ROI delta|profit factor delta/i);
});

test('promotion call sites pass holdout verdict required inputs', async () => {
  const source = await fs.readFile(new URL('../scripts/pine-autoresearch.mjs', import.meta.url), 'utf8');
  const decisionBlocks = [...source.matchAll(/const decision = decideAutoresearchOutcome\(\{\s*([\s\S]*?)\s*\}\);/g)]
    .map((match) => match[1]);

  assert.equal(decisionBlocks.length, 2);

  const matrixBlock = decisionBlocks.find((block) => block.includes('config.holdoutVerdict ?? null'));
  assert.ok(matrixBlock, 'evaluateMatrix must pass configured holdout verdict into outcome decision');
  assert.match(matrixBlock, /blindHoldoutLabs:\s*config\.blindHoldoutLabs \?\? \[\]/);

  const blindHoldoutBlock = decisionBlocks.find((block) => block.includes('latest.holdoutVerdict ?? config.holdoutVerdict ?? null'));
  assert.ok(blindHoldoutBlock, 'blind-holdout flow must evaluate without self-requiring a prior holdout verdict');
  assert.match(blindHoldoutBlock, /blindHoldoutLabs:\s*\[\]/);
});

test('blind-holdout run passes configured labs without prior verdict', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-blind-holdout-self-block-'));
  try {
    const scriptDir = path.join(dir, 'scripts');
    const configPath = path.join(dir, 'config.json');
    const strategyPath = path.join(dir, 'strategy.pine');
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(strategyPath, 'minPredSum = input.float(1.8, title="Min Prediction Sum")\n', 'utf8');
    await fs.writeFile(path.join(scriptDir, 'pine-import-run-clean.mjs'), `
import fs from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const inputPath = valueAfter('--input');
const outputBase = valueAfter('--output');
const isChallenger = path.basename(inputPath).startsWith('challenger');
const winReturnPct = isChallenger ? 2 : 1;
const rows = [];
let timestamp = Date.parse('2026-01-01T00:00:00.000Z');
for (let i = 0; i < 120; i += 1) {
  const win = i % 5 !== 4;
  rows.push({ timestamp: new Date(timestamp).toISOString(), Close: 100, Signal: 1, EstimatedTime: 15 });
  timestamp += 15 * 60 * 1000;
  rows.push({ timestamp: new Date(timestamp).toISOString(), Close: win ? 100 + winReturnPct : 99, Signal: 0, EstimatedTime: 15 });
  timestamp += 15 * 60 * 1000;
}
const dumpDir = path.join(path.dirname(inputPath), 'dump');
await fs.mkdir(dumpDir, { recursive: true });
await fs.writeFile(path.join(dumpDir, outputBase + '.cleaned.jsonl'), rows.map((row) => JSON.stringify(row)).join('\\n') + '\\n', 'utf8');
`, 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'blind-holdout-self-block-test',
      scriptPath: strategyPath,
      grid: 'phase3-core',
      minTrades: 10,
      thresholds: {
        minScoreDelta: 0.25,
        minRoiDeltaPct: 0,
        minProfitFactorDelta: 0,
        maxDrawdownDeltaPct: 0.75,
        minTradeCount: 10,
        minTradeRatioVsIncumbent: 0.75,
        significance: { minRelativeScoreDelta: 0, minTradeCount: 10 },
      },
      expectancyPolicy: { enabled: false },
      primaryLab: { labId: 'Primary Lab', symbol: 'XRPUSDT', timeframe: '15m', limit: 240 },
      blindHoldoutLabs: [
        { labId: 'Blind Holdout Lab A', symbol: 'XRPUSDT', timeframe: '15m', limit: 240 },
        { labId: 'Blind Holdout Lab B', symbol: 'XRPUSDT', timeframe: '15m', limit: 240 },
      ],
      blindHoldoutPolicy: { minShadowPassCount: 1, minShadowPassRatio: 1 },
      outputs: {
        researchRoot: path.join(dir, 'research'),
        digestRoot: path.join(dir, 'digest'),
      },
      baseConfig: { minPredSum: 1.8 },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      configId: 'champion-a',
      config: { minPredSum: 1.8 },
      configFingerprint: 'champion-fp',
    }), 'utf8');
    await fs.writeFile(path.join(autoresearchCli.manifestsDir(config), 'blind-holdout-source.json'), JSON.stringify({
      runId: 'blind-holdout-source',
      generatedAt: '2026-05-07T00:00:00.000Z',
      champion: { configId: 'champion-a', config: { minPredSum: 1.8 }, configFingerprint: 'champion-fp' },
      challenger: { configId: 'challenger-b', label: 'challenger-b', config: { minPredSum: 1.6 }, configFingerprint: 'challenger-fp' },
    }), 'utf8');
    await fs.writeFile(autoresearchCli.latestManifestPath(config), JSON.stringify({ runId: 'blind-holdout-source' }), 'utf8');

    const result = await spawnNode([
      path.join(repoRoot, 'scripts/pine-autoresearch.mjs'),
      'blind-holdout',
      '--config',
      configPath,
    ], { cwd: dir, env: process.env });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /blind-holdout=holdout_pass/);
    const holdoutPath = result.stdout.match(/\[autoresearch\] holdout=(.+)/)?.[1]?.trim();
    assert.ok(holdoutPath, result.stdout);
    const payload = JSON.parse(await fs.readFile(holdoutPath, 'utf8'));
    assert.equal(payload.status, 'holdout_pass');
    assert.equal(payload.matrixDecision.recommendation, 'promote');
    assert.equal(payload.champion.configId, 'champion-a');
    assert.equal(payload.challenger.configId, 'challenger-b');
    assert.equal(payload.championFingerprint, configFingerprint({ minPredSum: 1.8 }));
    assert.equal(payload.candidateFingerprint, configFingerprint({ minPredSum: 1.6 }));
    assert.deepEqual(payload.holdoutGate, {
      required: true,
      status: 'passed',
      passed: true,
      reason: 'blind_holdout_passed',
    });
    assert.equal(payload.promotionReady, true);
    assert.equal(payload.labResults[0].decision.recommendation, 'promote');
    assert.equal(payload.labResults[0].decision.failedGates.includes('holdoutVerdict'), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
  assert.deepEqual(result.failedGates, ['tradeFloor', 'tradeRatio', 'significance']);
  assert.equal(result.gates.significance, false);
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
  const championConfig = { useTrailingStop: false };
  const championFingerprint = configFingerprint(championConfig);
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: championFingerprint,
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    config: championConfig,
    configFingerprint: championFingerprint,
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.status, 'promoted');
  assert.match(result.reason, /queued promotion guards passed/i);
});

test('decideQueuedPromotionAction rejects stale stored champion fingerprint when current config exists', () => {
  const championAtDecision = { useTrailingStop: false, minPredSum: 1.8 };
  const staleStoredFingerprint = configFingerprint(championAtDecision);
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: staleStoredFingerprint,
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true, minPredSum: 1.6 } },
  };
  const championState = {
    config: { useTrailingStop: false, minPredSum: 2.2 },
    configFingerprint: staleStoredFingerprint,
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'stale');
  assert.equal(result.reason, 'Current champion changed since queued decision');
});

test('decideQueuedPromotionAction accepts stored legacy champion fingerprint only when current config is absent', () => {
  const legacyChampionFingerprint = configFingerprint({ useTrailingStop: false, configId: 'legacy-champion' });
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: legacyChampionFingerprint,
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    configFingerprint: legacyChampionFingerprint,
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.status, 'promoted');
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

test('decideQueuedPromotionAction does not go stale when only champion identity metadata changed', () => {
  const semanticChampion = { tpAtrMult: 7.6, slAtrMult: 0.5, useFusionV4: true };
  const championWithIdentity = {
    ...semanticChampion,
    configId: 'champion-relabelled',
    label: 'Champion relabelled',
    promotedAt: '2026-05-12T00:00:00.000Z',
    sourceRunId: 'run-relabelled',
    configFingerprint: 'identity-only-fingerprint',
  };
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: autoresearchCli.buildCanonicalConfigFingerprint(semanticChampion),
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { ...semanticChampion, tpAtrMult: 8.1 } },
  };
  const championState = {
    config: championWithIdentity,
    configFingerprint: configFingerprint(championWithIdentity),
  };
  const autoAction = { recommendation: 'promote', summary: 'Auto-promote challenger candidate-a: guards passed.' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.status, 'promoted');
});

test('decideQueuedPromotionAction fails when queued family identity differs from manifest', () => {
  const championConfig = { minPredSum: 1.8 };
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:fp-b',
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprintAtDecision: configFingerprint(championConfig),
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
    championState: { config: championConfig, configFingerprint: 'fp-a' },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'invalid');
  assert.match(result.reason, /family/);
});

test('decideQueuedPromotionAction fails on champion family mismatch between queued and manifest', () => {
  const championConfig = { minPredSum: 1.8 };
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:fp-b',
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprintAtDecision: configFingerprint(championConfig),
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
    championState: { config: championConfig, configFingerprint: 'fp-a' },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'invalid');
  assert.match(result.reason, /champion family/i);
});

test('decideQueuedPromotionAction promotes when queued lineage fields missing for backward compatibility', () => {
  const championConfig = { useTrailingStop: false };
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:candidate-fp',
      runId: 'run-a',
      championFingerprintAtDecision: configFingerprint(championConfig),
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
      config: championConfig,
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

test('decideQueuedPromotionAction marks safety failure when autopromote gates fail', () => {
  const championConfig = { useTrailingStop: false };
  const queuedItem = {
    itemId: 'run-a:candidate-fp',
    runId: 'run-a',
    championFingerprintAtDecision: configFingerprint(championConfig),
  };
  const manifest = {
    runId: 'run-a',
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'candidate-a', config: { useTrailingStop: true } },
  };
  const championState = {
    config: championConfig,
    configFingerprint: 'champion-fp',
  };
  const autoAction = { recommendation: 'hold', summary: 'Auto-promote hold: failed cooldown gate(s).' };

  const result = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'safety_failed');
  assert.equal(result.reason, 'Auto-promote hold: failed cooldown gate(s).');
  assert.equal(canForceQueuedPromotion(result), false);
});

test('resolveAutopromoteQueueStatus maps promoted false results to a queue status', () => {
  assert.equal(resolveAutopromoteQueueStatus({ promoted: true, reason: 'autopromoted' }), 'promoted');
  assert.equal(resolveAutopromoteQueueStatus({ promoted: false, reason: 'Champion already matches candidate-a' }), 'stale');
  assert.equal(resolveAutopromoteQueueStatus({ promoted: false, reason: 'promotion_noop' }), 'queue_blocked');
});

test('canForceQueuedPromotion rejects failed strategy safety gates', () => {
  assert.equal(canForceQueuedPromotion({ status: 'safety_failed', reason: 'matrix gates failed' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'expectancy_failed', reason: 'expectancy regression' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'holdout_failed', reason: 'blind holdout failed' }), false);
});

test('canForceQueuedPromotion allows only operator recoverable blockers', () => {
  assert.equal(canForceQueuedPromotion({ status: 'operator_blocked', reason: 'manual queue approval required' }), true);
  assert.equal(canForceQueuedPromotion({ status: 'queue_blocked', reason: 'queue lock stale' }), true);
  assert.equal(canForceQueuedPromotion({ status: 'stale', reason: 'already promoted' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'invalid', reason: 'fingerprint mismatch' }), false);
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

  assert.equal(missingManifest.status, 'invalid');
  assert.equal(missingManifest.reason, 'Queued manifest missing for run-a:candidate-fp');
  assert.equal(mismatchedManifest.status, 'invalid');
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

test('resolveEffectiveRuntimeExchange uses pinned cache exchange for pinned runs', () => {
  assert.equal(resolveEffectiveRuntimeExchange({
    pinnedData: { enabled: true, exchangeName: 'ccxt-exchange' },
    lab: { exchange: 'default_exchange' },
  }), 'ccxt-exchange');
  assert.equal(resolveEffectiveRuntimeExchange({
    pinnedData: { enabled: false, exchangeName: 'ccxt-exchange' },
    lab: { exchange: 'default_exchange' },
  }), 'default_exchange');
  assert.equal(resolveEffectiveRuntimeExchange({
    pinnedData: { enabled: true },
    lab: { exchange: 'default_exchange' },
  }), 'default_exchange');
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
      configFingerprint: manifest.championFingerprint,
    },
    autoAction: {
      recommendation: 'hold',
      summary: 'Auto-promote hold: failed matrix/anchor gates despite strong regime switch signal.',
    },
  });

  assert.equal(blocked.recommendation, 'hold');
  assert.equal(blocked.status, 'safety_failed');
  assert.match(blocked.reason, /matrix\/anchor gates/i);
  assert.match(blocked.reason, /strong regime switch signal/i);
  assert.equal(canForceQueuedPromotion(blocked), false);
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
    score: 72.3,
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

test('decideMatrixPromotion does not report perfect zero shadow ratio', () => {
  const decision = decideMatrixPromotion({
    labResults: [{ decision: { recommendation: 'promote' } }],
    champion: { configId: 'champion', config: { minPredSum: 2 } },
    challenger: { configId: 'challenger', config: { minPredSum: 1.5 } },
    policy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 3,
      minShadowPassRatio: 0.6,
      requireCandidateChange: true,
    },
  });

  assert.equal(decision.counts.shadowLabs, 0);
  assert.equal(decision.counts.shadowPassCount, 0);
  assert.equal(decision.counts.shadowPassRatio, 0);
  assert.equal(decision.gates.shadowPassRatio, false);
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

test('buildParetoShortlist can reserve all shortlist slots for challengers', () => {
  const champion = { configId: 'champ', score: 10, roiPct: 10, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 2, config: { a: 1 } };
  const rankedResults = [
    { configId: 'cand-1', score: 11, roiPct: 12, profitFactor: 1.5, tradeCount: 100, maxDrawdownPct: 2, config: { a: 2 } },
    { configId: 'cand-2', score: 10.5, roiPct: 11, profitFactor: 1.45, tradeCount: 100, maxDrawdownPct: 2, config: { a: 3 } },
  ];
  const shortlist = buildParetoShortlist({ champion, rankedResults, limit: 2, includeChampion: false });

  assert.deepEqual(shortlist.map((item) => item.configId), ['cand-1', 'cand-2']);
});

test('buildParetoShortlist keeps challenger with champion configId but changed semantic config', () => {
  const champion = { configId: 'champ', score: 10, roiPct: 10, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 2, config: { a: 1 } };
  const rankedResults = [
    { configId: 'champ', score: 11, roiPct: 12, profitFactor: 1.5, tradeCount: 100, maxDrawdownPct: 2, config: { a: 2 } },
  ];
  const shortlist = buildParetoShortlist({ champion, rankedResults, limit: 1, includeChampion: false });

  assert.deepEqual(shortlist.map((item) => item.configId), ['champ']);
  assert.deepEqual(shortlist[0].config, { a: 2 });
});

test('buildParetoShortlist excludes canonical champion-equivalent challenger with different identity fields', () => {
  const champion = { configId: 'champ', score: 10, roiPct: 10, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 2, config: { a: 1, nested: { enabled: true } } };
  const rankedResults = [
    {
      configId: 'champ-copy',
      score: 12,
      roiPct: 13,
      profitFactor: 1.6,
      tradeCount: 110,
      maxDrawdownPct: 1.8,
      config: {
        a: 1,
        nested: { enabled: true },
        configId: 'identity-only-copy',
        label: 'champion clone',
        sourceRunId: 'run-identity',
        promotedAt: '2026-05-12T00:00:00.000Z',
        configFingerprint: 'stale-identity-fp',
      },
    },
    { configId: 'distinct', score: 9, roiPct: 9, profitFactor: 1.3, tradeCount: 90, maxDrawdownPct: 2.2, config: { a: 2, nested: { enabled: true } } },
  ];
  const shortlist = buildParetoShortlist({ champion, rankedResults, limit: 2, includeChampion: false });

  assert.deepEqual(shortlist.map((item) => item.configId), ['distinct']);
});

test('buildParetoShortlist deduplicates semantic challenger configs before backfill', () => {
  const champion = { configId: 'champ', score: 10, roiPct: 10, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 2, config: { a: 1 } };
  const rankedResults = [
    { configId: 'dup-score', score: 20, roiPct: 5, profitFactor: 1.6, tradeCount: 100, maxDrawdownPct: 2, config: { a: 2 } },
    { configId: 'dup-roi', score: 19, roiPct: 6, profitFactor: 1.6, tradeCount: 100, maxDrawdownPct: 2, config: { a: 2, label: 'same semantic challenger' } },
    { configId: 'distinct', score: 10, roiPct: 4, profitFactor: 1.2, tradeCount: 80, maxDrawdownPct: 3, config: { a: 3 } },
  ];
  const shortlist = buildParetoShortlist({ champion, rankedResults, limit: 2, includeChampion: false });

  assert.deepEqual(shortlist.map((item) => item.configId), ['dup-score', 'distinct']);
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

test('selectChangedMatrixCandidate returns null for an exhausted empty candidate batch', () => {
  const selected = selectChangedMatrixCandidate({
    championState: { config: { a: 1 } },
    candidates: [],
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

test('buildScoutOrchestrationState includes entry invariance verdict from recent cycles', () => {
  const championConfig = { minPredSum: 2, adxThreshold: 20, minBarsBetween: 2, neighborsCount: 32, tpAtrMult: 7.6 };
  const championState = { configId: 'champion', score: 70, config: championConfig };
  const historyEventsBefore = Array.from({ length: 5 }, (_, index) => ({
    type: 'cycle',
    touchedKeys: ['tpAtrMult'],
    challenger: { tradeCount: 261, winRatePct: 42.53 + (index % 2 ? 0.001 : 0) },
  }));

  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        entryInvariance: { minCycles: 5, entryKeys: ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount'] },
      },
      matrixPolicy: { requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      pinnedData: { enabled: false },
    },
    runId: 'pine-autoresearch-entry-invariance',
    championState,
    historyEventsBefore,
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'risk', patch: { tpAtrMult: 8.1 }, config: { ...championConfig, tpAtrMult: 8.1 } }],
    primarySweep: {
      topConfigs: [{ configId: 'champion', score: 70, roiPct: 40, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 261, winRatePct: 42.53, config: { ...championConfig } }],
    },
    matrixCandidates: [],
  });

  assert.equal(result.manifest.entryInvariance.flagged, true);
  assert.equal(result.manifest.entryInvariance.reason, 'exit_only_drift');
  assert.deepEqual(result.manifest.entryInvariance.untouchedEntryKeys, ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount']);
});

test('buildScoutOrchestrationState exposes lane budget debt in manifest debug state', () => {
  const championConfig = { minPredSum: 2, adxThreshold: 20 };
  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch-lane-debt',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
      },
      matrixPolicy: { requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      pinnedData: { enabled: false },
    },
    runId: 'pine-autoresearch-lane-debt',
    championState: { configId: 'champion', score: 70, config: championConfig },
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [] },
    matrixCandidates: [],
    trackState: {
      budgetDebt: { exploit: 2, exitRegime: -5, globalAllParameter: 2, robustness: 1 },
    },
  });

  assert.deepEqual(result.manifest.laneBudgetDebt, { exploit: 2, exitRegime: -5, globalAllParameter: 2, robustness: 1 });
});

test('resolveConsumedBudgetLane pays down only a lane present in final variants', () => {
  assert.equal(resolveConsumedBudgetLane({
    selectedLane: 'robustness',
    searchBatch: [
      { lane: 'track' },
      { lane: 'fallback' },
    ],
  }), null);

  assert.equal(resolveConsumedBudgetLane({
    selectedLane: 'robustness',
    searchBatch: [
      { lane: 'exploit' },
      { lane: 'explore' },
    ],
  }), 'exploit');

  assert.equal(resolveConsumedBudgetLane({
    selectedLane: 'exitRegime',
    searchBatch: [
      { lane: 'exitRegime' },
      { lane: 'exitRegime' },
    ],
  }), 'exitRegime');
});

test('resolveLaneBudgetDebtAdvance does not accrue disabled lane debt', () => {
  const result = resolveLaneBudgetDebtAdvance({
    config: {
      maxConfigs: 20,
      regimeExitResearch: {
        enabled: true,
        exitRegimeEnabled: false,
        lanes: {
          exploitRatio: 0.25,
          exitRegimeRatio: 0.35,
          globalAllParameterRatio: 0.25,
          robustnessRatio: 0.15,
        },
      },
    },
    schedulerState: { budgetDebt: { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 0 } },
    selectedLane: 'exploit',
  });

  assert.equal(result.advanced, true);
  assert.deepEqual(result.budgetDebt, { exploit: -8, exitRegime: 0, globalAllParameter: 5, robustness: 3 });
});

test('force-entry-mutation search policy produces entry-key mutations in generated variants', () => {
  const champion = {
    configId: 'champion',
    config: {
      useSignalFusion: true,
      useFusionV4: true,
      neighborsCount: 32,
      adxThreshold: 20,
      minPredSum: 2,
      minBarsBetween: 2,
      h: 8,
      r: 8,
      x: 25,
      riskAtrLen: 14,
      slAtrMult: 1,
      tpAtrMult: 7.6,
      trailAtrMult: 1,
      trailActivateR: 0.5,
    },
  };
  const requiredTouchedKeys = ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount'];

  const batch = buildRegimeAwareSearchBatch({
    selectedLane: null,
    champion,
    maxConfigs: 4,
    historyEvents: [{ type: 'cycle' }],
    policy: {
      mode: 'force-entry-mutation',
      reason: 'exit_only_drift',
      allowArchitectureKeys: false,
      requiredTouchedKeys,
      exploitRatio: 0.5,
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
    },
  });

  assert.equal(batch.length, 4);
  assert.equal(batch.some((variant) => variant.family === 'risk'), true);
  assert.equal(batch.every((variant) => Object.keys(variant.patch || {}).some((key) => requiredTouchedKeys.includes(key))), true);
  assert.equal(batch.every((variant) => requiredTouchedKeys.some((key) => variant.config[key] !== champion.config[key])), true);
});

test('entry invariance enforcement injects entry mutation after generated globalAllParameter lane selection', () => {
  const championConfig = {
    useSignalFusion: true,
    useFusionV4: true,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 7.6,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };
  const requiredTouchedKeys = ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount'];
  const generatedBatch = [{
    variantId: 'global-all-risk-only',
    lane: 'globalAllParameter',
    family: 'risk',
    mutationFamily: 'risk',
    patch: { tpAtrMult: 8.1 },
    touchedKeys: ['tpAtrMult'],
    config: { ...championConfig, tpAtrMult: 8.1 },
    metadata: { patchFingerprint: 'stale-fingerprint' },
  }];

  const enforced = autoresearchCli.enforceEntryInvarianceOnSearchBatch({
    searchBatch: generatedBatch,
    championConfig,
    historyEvents: [{ type: 'cycle' }],
    policy: {
      mode: 'force-entry-mutation',
      requiredTouchedKeys,
      exploitRatio: 1,
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
    },
    entryInvariance: {
      flagged: true,
      reason: 'exit_only_drift',
      untouchedEntryKeys: requiredTouchedKeys,
    },
  });

  assert.equal(enforced.length, 1);
  assert.equal(enforced[0].lane, 'globalAllParameter');
  assert.equal(enforced[0].patch.tpAtrMult, 8.1);
  assert.equal('slAtrMult' in enforced[0].patch, false);
  assert.equal(enforced[0].config.slAtrMult, championConfig.slAtrMult);
  assert.equal(Object.keys(enforced[0].patch).some((key) => requiredTouchedKeys.includes(key)), true);
  assert.equal(requiredTouchedKeys.some((key) => enforced[0].config[key] !== championConfig[key]), true);
  assert.equal(enforced[0].metadata.forcedEntryMutation, true);
  assert.equal(enforced[0].metadata.forcedEntryMutationSource, 'entry-invariance-post-selection');
  assert.notEqual(enforced[0].metadata.patchFingerprint, 'stale-fingerprint');
});

test('entry invariance enforcement does not replay object-shaped tabu after active-track entry mutation', () => {
  const championConfig = {
    useSignalFusion: true,
    useFusionV4: true,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 7.6,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };
  const requiredTouchedKeys = ['minPredSum'];
  const rejectedConfig = {
    ...championConfig,
    useTimeStop: true,
    timeStopBars: 8,
    minPredSum: 1.5,
  };
  const rejectedFingerprint = configFingerprint(rejectedConfig);
  const schedulerState = {
    cycleIndex: 7,
    tabuRejectedFingerprints: [{
      fingerprint: rejectedFingerprint,
      addedAtCycle: 7,
      championFingerprint: configFingerprint(championConfig),
    }],
  };

  const selectedSearchBatch = buildTrackCandidateBatch({
    track: { trackId: 'exit-state', sourceFamily: 'exit-state' },
    incumbent: championConfig,
    maxConfigs: 3,
    historyEvents: [],
    budgetPolicy: {},
    schedulerState,
  });

  assert.equal(selectedSearchBatch[0].config.timeStopBars, 8);
  assert.equal(configFingerprint(selectedSearchBatch[0].config) === rejectedFingerprint, false);

  const enforced = autoresearchCli.enforceEntryInvarianceOnSearchBatch({
    searchBatch: selectedSearchBatch,
    championConfig,
    historyEvents: [{ type: 'cycle' }],
    policy: {
      mode: 'force-entry-mutation',
      requiredTouchedKeys,
      exploitRatio: 1,
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
    },
    schedulerState,
    entryInvariance: {
      flagged: true,
      reason: 'exit_only_drift',
      untouchedEntryKeys: requiredTouchedKeys,
    },
  });

  assert.equal(enforced.length > 0, true);
  assert.equal(enforced.some((variant) => Object.keys(variant.patch || {}).some((key) => requiredTouchedKeys.includes(key))), true);
  assert.equal(enforced.some((variant) => configFingerprint(variant.config) === rejectedFingerprint), false);
});

test('entry invariance enforcement fails closed when every forced final config is tabu', () => {
  const championConfig = {
    useSignalFusion: true,
    useFusionV4: true,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 7.6,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };
  const requiredTouchedKeys = ['minPredSum'];
  const selectedSearchBatch = buildTrackCandidateBatch({
    track: { trackId: 'exit-state', sourceFamily: 'exit-state' },
    incumbent: championConfig,
    maxConfigs: 3,
    historyEvents: [],
    budgetPolicy: {},
    schedulerState: {},
  });
  const rejectedFingerprints = selectedSearchBatch.flatMap((variant) => [1.5, 2.5].map((minPredSum) => configFingerprint({
    ...championConfig,
    ...variant.patch,
    minPredSum,
  })));

  const enforced = autoresearchCli.enforceEntryInvarianceOnSearchBatch({
    searchBatch: selectedSearchBatch,
    championConfig,
    historyEvents: [{ type: 'cycle' }],
    policy: {
      mode: 'force-entry-mutation',
      requiredTouchedKeys,
      exploitRatio: 1,
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
    },
    schedulerState: {
      tabuRejectedFingerprints: rejectedFingerprints.map((fingerprint, index) => (
        index === 0
          ? fingerprint
          : { fingerprint, addedAtCycle: 3, championFingerprint: configFingerprint(championConfig) }
      )),
    },
    entryInvariance: {
      flagged: true,
      reason: 'exit_only_drift',
      untouchedEntryKeys: requiredTouchedKeys,
    },
  });

  assert.deepEqual(enforced, []);
});

test('entry invariance enforcement injects entry mutation after generated exitRegime lane selection', () => {
  const championConfig = {
    useSignalFusion: true,
    useFusionV4: true,
    neighborsCount: 32,
    adxThreshold: 20,
    minPredSum: 2,
    minBarsBetween: 2,
    h: 8,
    r: 8,
    x: 25,
    riskAtrLen: 14,
    slAtrMult: 1,
    tpAtrMult: 7.6,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const requiredTouchedKeys = ['neighborsCount'];
  const generatedBatch = [{
    variantId: 'exit-regime-risk-only',
    lane: 'exitRegime',
    family: 'risk',
    mutationFamily: 'risk',
    patch: { tpAtrMult: 8.1 },
    touchedKeys: ['tpAtrMult'],
    config: { ...championConfig, tpAtrMult: 8.1 },
    patchFingerprint: 'stale-exit-fingerprint',
    metadata: {
      championConfigFingerprint,
      patchFingerprint: 'stale-exit-fingerprint',
      patchFingerprintVersion: 2,
    },
  }];

  const enforced = autoresearchCli.enforceEntryInvarianceOnSearchBatch({
    searchBatch: generatedBatch,
    championConfig,
    historyEvents: [{ type: 'cycle' }],
    policy: {
      mode: 'force-entry-mutation',
      requiredTouchedKeys,
      exploitRatio: 1,
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
    },
    entryInvariance: {
      flagged: true,
      reason: 'exit_only_drift',
      untouchedEntryKeys: requiredTouchedKeys,
    },
  });

  const expectedFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'risk',
    patch: enforced[0].patch,
  });

  assert.equal(enforced.length, 1);
  assert.equal(enforced[0].lane, 'exitRegime');
  assert.equal(enforced[0].patch.tpAtrMult, 8.1);
  assert.deepEqual(Object.keys(enforced[0].patch).sort(), ['neighborsCount', 'tpAtrMult'].sort());
  assert.equal(enforced[0].config.neighborsCount !== championConfig.neighborsCount, true);
  assert.equal(enforced[0].patchFingerprint, expectedFingerprint);
  assert.equal(enforced[0].metadata.patchFingerprint, expectedFingerprint);
  assert.equal(enforced[0].metadata.championConfigFingerprint, championConfigFingerprint);
  assert.equal(enforced[0].metadata.patchFingerprintVersion, 2);
});

test('early hold manifests preserve entry invariance verdict', () => {
  const entryInvariance = {
    flagged: true,
    reason: 'exit_only_drift',
    untouchedEntryKeys: ['adxThreshold'],
  };

  const manifest = autoresearchCli.buildOfflineDataMissingManifest({
    config: { matrixId: 'pine-autoresearch', searchPolicy: { mode: 'incumbent-local' } },
    runId: 'offline-missing-entry-invariance',
    championState: { configId: 'champion', config: { adxThreshold: 20 } },
    offlineDataSummary: { ok: false, mode: 'offline-strict' },
    entryInvariance,
  });

  assert.deepEqual(manifest.entryInvariance, entryInvariance);
});

test('early hold manifests and scheduler inputs use canonical config fingerprints', () => {
  const semanticChampion = { tpAtrMult: 7.6, slAtrMult: 0.5, useFusionV4: true };
  const championConfig = {
    ...semanticChampion,
    configId: 'champion-identity',
    label: 'Champion Identity',
    promotedAt: '2026-05-12T00:00:00.000Z',
    sourceRunId: 'run-identity',
    configFingerprint: 'identity-only-fingerprint',
  };
  const expectedFingerprint = buildChampionConfigFingerprint(semanticChampion);
  const offlineManifest = autoresearchCli.buildOfflineDataMissingManifest({
    config: { matrixId: 'pine-autoresearch', searchPolicy: { mode: 'incumbent-local' } },
    runId: 'offline-canonical-fingerprint',
    championState: { configId: 'champion', config: championConfig },
    offlineDataSummary: { ok: false, mode: 'offline-strict' },
  });
  const schedulerInput = autoresearchCli.buildGlobalAllParameterExhaustedSchedulerManifestInput({
    manifest: { generatedAt: '2026-05-12T00:00:00.000Z' },
    championState: { configId: 'champion', config: championConfig },
  });

  assert.equal(offlineManifest.candidateFingerprint, expectedFingerprint);
  assert.equal(offlineManifest.championFingerprint, expectedFingerprint);
  assert.equal(schedulerInput.candidateFingerprint, expectedFingerprint);
  assert.equal(schedulerInput.championFingerprint, expectedFingerprint);
});

test('entry invariance manifest cycle unions selected challenger delta and generated variant patch keys', () => {
  const cycle = autoresearchCli.entryInvarianceCycleFromManifest({
    champion: {
      config: { adxThreshold: 20, minPredSum: 2, tpAtrMult: 7.6 },
    },
    challenger: {
      config: { adxThreshold: 20, minPredSum: 2, tpAtrMult: 8.1 },
      tradeCount: 261,
      winRatePct: 42.53,
    },
    searchPlan: {
      variants: [
        { patch: { adxThreshold: 25 }, touchedKeys: ['adxThreshold'] },
      ],
    },
  });

  assert.deepEqual(new Set(cycle.touchedKeys), new Set(['tpAtrMult', 'adxThreshold']));
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

test('buildScoutOrchestrationState leaves challenger shortlist empty when sweep only returns champion', () => {
  const championConfig = { minPredSum: 2, tpAtrMult: 5.5 };
  const championState = { configId: 'champion', score: 70, config: championConfig };
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
    runId: 'pine-autoresearch-empty-challenger-shortlist',
    championState,
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'self-loop', family: 'fallback', config: { ...championConfig } }],
    primarySweep: {
      topConfigs: [{ configId: 'champion', score: 70, roiPct: 40, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 200, config: { ...championConfig } }],
    },
    matrixCandidates: [],
    trackState: { rejectedCandidateFingerprint: 'stale-reject' },
  });

  assert.deepEqual(result.paretoShortlist, []);
  assert.equal(result.selectedCandidate, null);
  assert.equal(result.manifest.noNewCandidate, true);
  assert.equal(result.manifest.rejectedCandidateFingerprint, null);
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
      { configId: 'c2', score: 71, roiPct: 49, profitFactor: 1.8, maxDrawdownPct: 4.3, tradeCount: 225 },
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
  assert.deepEqual(result.paretoShortlist.map((item) => item.configId), ['c1', 'c2']);
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
          incumbent: {
            trades: [{ pnl: 1 }],
            rows: [{ timestamp: '2026-01-01T00:00:00.000Z', Close: 1, Feature_RawLongPrediction: 123 }],
          },
          challenger: {
            trades: [{ pnl: 2 }],
            rows: [{ timestamp: '2026-01-01T00:15:00.000Z', Close: 2, Feature_RawLongPrediction: 456 }],
            diagnostics: { rawMarker: 'Feature_RawLongPrediction' },
          },
        },
      }],
      matrixDecision: { recommendation: 'promote', gates: { candidateChanged: true } },
      robustness: {},
    }],
  });

  const manifestJson = JSON.stringify(result.manifest);
  assert.ok(result.labResults[0].analysis);
  assert.equal(result.manifest.labResults[0].analysis, undefined);
  assert.equal(manifestJson.includes('Feature_RawLongPrediction'), false);
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

test('normalizeTabuEntries migrates legacy string tabu entries to champion-scoped objects', () => {
  assert.deepEqual(normalizeTabuEntries(['old-1', '', null, 'old-2'], {
    currentCycle: 7,
    championFingerprint: 'champ-1',
  }), [
    { fingerprint: 'old-1', addedAtCycle: 7, championFingerprint: 'champ-1' },
    { fingerprint: 'old-2', addedAtCycle: 7, championFingerprint: 'champ-1' },
  ]);
});

test('mergeSchedulerTabuFingerprints bootstraps recent manifest rejects without losing existing tabu state', () => {
  const merged = mergeSchedulerTabuFingerprints({
    schedulerState: { activeTrackId: 'track-a', tabuRejectedFingerprints: ['old-1', 'old-2'] },
    recentRejectedFingerprints: ['old-2', 'new-1', 'new-2'],
    currentCycle: 7,
    championFingerprint: 'champ-1',
    policy: { maxAgeCycles: 20, maxEntries: 3, dropOnChampionChange: true },
  });

  assert.equal(merged.activeTrackId, 'track-a');
  assert.deepEqual(merged.tabuRejectedFingerprints, [
    { fingerprint: 'old-2', addedAtCycle: 7, championFingerprint: 'champ-1' },
    { fingerprint: 'new-1', addedAtCycle: 7, championFingerprint: 'champ-1' },
    { fingerprint: 'new-2', addedAtCycle: 7, championFingerprint: 'champ-1' },
  ]);
});

test('mergeSchedulerTabuFingerprints prunes stale old-champion object entries', () => {
  const merged = mergeSchedulerTabuFingerprints({
    schedulerState: {
      activeTrackId: 'track-a',
      tabuRejectedFingerprints: [
        { fingerprint: 'stale-age', addedAtCycle: 1, championFingerprint: 'champ-1' },
        { fingerprint: 'old-champ', addedAtCycle: 6, championFingerprint: 'champ-old' },
        { fingerprint: 'current-champ', addedAtCycle: 6, championFingerprint: 'champ-1' },
      ],
    },
    recentRejectedFingerprints: [],
    currentCycle: 7,
    championFingerprint: 'champ-1',
    policy: { maxAgeCycles: 5, maxEntries: 10, dropOnChampionChange: true },
  });

  assert.deepEqual(merged.tabuRejectedFingerprints, [
    { fingerprint: 'current-champ', addedAtCycle: 6, championFingerprint: 'champ-1' },
  ]);
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


async function createPromotionFixture(prefix, manifestOverrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const configPath = path.join(dir, 'config.json');
  const scriptPath = path.join(dir, 'strategy.pine');
  await fs.writeFile(scriptPath, 'minPredSum = input.float(1.8, title="Min Prediction Sum")\n', 'utf8');
  await fs.writeFile(configPath, JSON.stringify({
    matrixId: `${prefix}-matrix`,
    scriptPath,
    outputs: { researchRoot: path.join(dir, 'research'), digestRoot: path.join(dir, 'digest') },
    baseConfig: { minPredSum: 1.8 },
  }), 'utf8');
  const config = await autoresearchCli.loadConfig(dir, configPath, {});
  await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
  await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
    configId: 'champion-a',
    config: { minPredSum: 1.8 },
    configFingerprint: 'fp-a',
  }), 'utf8');
  const manifest = {
    runId: `${prefix}-run`,
    generatedAt: '2026-05-12T00:00:00.000Z',
    champion: { configId: 'champion-a', config: { minPredSum: 1.8 }, configFingerprint: 'fp-a' },
    challenger: { configId: 'challenger-b', config: { minPredSum: 1.6 } },
    championFingerprint: 'fp-a',
    candidateFingerprint: 'fp-b',
    matrixDecision: { recommendation: 'promote', summary: 'Promote challenger' },
    ...manifestOverrides,
  };
  const manifestPath = path.join(autoresearchCli.manifestsDir(config), `${manifest.runId}.json`);
  await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
  await fs.writeFile(autoresearchCli.latestManifestPath(config), JSON.stringify({ runId: manifest.runId }), 'utf8');
  return { dir, config, manifestPath };
}

test('runPromote fails closed when latest pointer canonical manifest is invalid', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-latest-fail-'));
  try {
    const configPath = path.join(dir, 'config.json');
    const scriptPath = path.join(dir, 'strategy.pine');
    await fs.writeFile(scriptPath, 'minPredSum = input.float(1.8, title="Min Prediction Sum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'latest-fail-test',
      scriptPath,
      outputs: { researchRoot: path.join(dir, 'research'), digestRoot: path.join(dir, 'digest') },
      baseConfig: { minPredSum: 1.8 },
    }), 'utf8');
    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      configId: 'champion-a',
      config: { minPredSum: 1.8 },
      configFingerprint: 'fp-a',
    }), 'utf8');
    await fs.writeFile(autoresearchCli.latestManifestPath(config), JSON.stringify({ runId: 'missing-canonical' }), 'utf8');

    await assert.rejects(
      () => autoresearchCli.runPromote(config, { force: false }, 'manual'),
      /Invalid latest manifest pointer.*latest_manifest_missing/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runPromote rejects pending required holdout even with force', async () => {
  const { dir, config } = await createPromotionFixture('pine-promote-pending-holdout-', {
    holdoutGate: { required: true, status: 'pending', passed: false, reason: 'blind_holdout_pending' },
    promotionReady: false,
  });
  try {
    await assert.rejects(
      () => autoresearchCli.runPromote(config, { force: true }, 'manual'),
      /promotion-ready: holdoutReady, promotionReady/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('runPromote rejects failed required holdout even with force', async () => {
  const { dir, config } = await createPromotionFixture('pine-promote-failed-holdout-', {
    holdoutGate: { required: true, status: 'failed', passed: false, reason: 'blind_holdout_regression' },
    promotionReady: true,
  });
  try {
    await assert.rejects(
      () => autoresearchCli.runPromote(config, { force: true }, 'manual'),
      /promotion-ready: holdoutReady/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runPromote preserves explicit manifest override when latest pointer is invalid', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-explicit-manifest-'));
  try {
    const configPath = path.join(dir, 'config.json');
    const scriptPath = path.join(dir, 'strategy.pine');
    await fs.writeFile(scriptPath, 'minPredSum = input.float(1.8, title="Min Prediction Sum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'explicit-manifest-test',
      scriptPath,
      outputs: { researchRoot: path.join(dir, 'research'), digestRoot: path.join(dir, 'digest') },
      baseConfig: { minPredSum: 1.8 },
    }), 'utf8');
    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      configId: 'champion-a',
      config: { minPredSum: 1.8 },
      configFingerprint: 'fp-a',
    }), 'utf8');
    await fs.writeFile(autoresearchCli.latestManifestPath(config), '{', 'utf8');
    const explicitPath = path.join(autoresearchCli.manifestsDir(config), 'explicit-run.json');
    await fs.writeFile(explicitPath, JSON.stringify({
      runId: 'explicit-run',
      challenger: { configId: 'challenger-b', config: { minPredSum: 1.6 } },
      championFingerprint: 'fp-a',
      candidateFingerprint: 'fp-b',
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger' },
    }), 'utf8');

    const result = await autoresearchCli.runPromote(config, { manifest: explicitPath, force: false }, 'manual');

    assert.equal(result.promoted, true);
    const champion = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'champion.json'), 'utf8'));
    assert.equal(champion.sourceManifestPath, explicitPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
    await fs.writeFile(path.join(autoresearchCli.manifestsDir(config), 'run-promote-lineage.json'), JSON.stringify({
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
    await fs.writeFile(autoresearchCli.latestManifestPath(config), JSON.stringify({ runId: 'run-promote-lineage' }), 'utf8');

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
    exploitRatio: 0.5,
    freezeArchitecture: false,
    exploitFamilies: ['signal', 'risk'],
    exploreFamilies: ['signal'],
    paretoShortlistSize: 12,
    matrixCandidateLimit: 12,
    selfLoopEscape: {
      enabled: true,
      activateAfter: 1,
      includeFallback: true,
      fallbackFamilies: ['signal', 'risk'],
      minFallbackConfigs: 3,
      temperatureBoost: 1.5,
      stagnationFallbackFamilies: ['signal', 'risk', 'exit-state', 'asymmetry'],
      stagnationTemperatureBoost: 4,
    },
    annealing: {
      enabled: true,
      baseTemperature: 0.4,
      growthFactor: 1.8,
      maxTemperature: 12,
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
  assert.deepEqual(config.primaryLab.thresholds.significance, {
    minRelativeScoreDelta: 0.02,
    minTradeCount: 150,
  });
  assert.deepEqual(loaded.primaryLab.thresholds.significance, config.primaryLab.thresholds.significance);
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


test('buildRegimeExitStateForScout reports real candidate counts without previewOnly when selected lane generated variants', () => {
  const state = buildRegimeExitStateForScout({
    config: {
      regimeExitResearch: {
        enabled: true,
        offline: { mode: 'local-first' },
        budget: {
          exploitRatio: 0.25,
          exitRegimeRatio: 0.35,
          globalAllParameterRatio: 0.25,
          robustnessRatio: 0.15,
        },
      },
      maxConfigs: 8,
    },
    championState: { config: { useTrailingStop: true, trailAtrMult: 1 } },
    searchBatch: [
      { variantId: 'exit-regime-01', lane: 'exitRegime', family: 'exit', patch: { trailAtrMult: 1.25 }, config: { trailAtrMult: 1.25 } },
      { variantId: 'exit-regime-02', lane: 'exitRegime', family: 'exit', patch: { trailAtrMult: 0.75 }, config: { trailAtrMult: 0.75 } },
    ],
    schedulerState: { stagnationLevel: 0 },
    offlineDataSummary: { ok: true, mode: 'local-first', requiredLabs: [], missingLabs: [] },
  });

  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'exitRegime');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.previewOnly, false);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.candidateCount, 2);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.countSource, 'generatedVariants');
});


test('buildRegimeAwareSearchBatch injects selected exitRegime candidates', () => {
  const champion = {
    useRegimeFilter: false,
    useTrailingStop: true,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    useStopsTP: true,
    slAtrMult: 0.5,
    tpAtrMult: 7.6,
    useDivergenceContext: true,
    divFreshBars: 8,
  };

  const batch = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 8,
    historyEvents: [],
    policy: {
      exploitRatio: 0.25,
      paretoShortlistSize: 2,
      matrixCandidateLimit: 2,
    },
    schedulerState: {},
    regimeExitResearch: {
      enabled: true,
      exitRegimeEnabled: true,
      globalAllParameterEnabled: true,
    },
  });

  assert.ok(batch.length > 0);
  assert.ok(batch.some((variant) => variant.lane === 'exitRegime'));
  assert.ok(batch.every((variant) => variant.variantId));
  assert.ok(batch.every((variant) => variant.config));
  assert.ok(batch.every((variant) => variant.patch && Object.keys(variant.patch).length > 0));
});

function exitRegimeChampion(configId = 'champ-exit-repeat') {
  return {
    configId,
    config: {
      useRegimeFilter: false,
      useTrailingStop: true,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useStopsTP: true,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useDivergenceContext: true,
      divFreshBars: 8,
    },
  };
}

function exitRegimeManifest({ champion, variants }) {
  return {
    champion: { configId: champion.configId, config: { ...champion.config } },
    searchPlan: {
      variants: variants.map((variant) => ({
        lane: variant.lane,
        family: variant.family,
        mutationFamily: variant.mutationFamily,
        patch: variant.patch,
        config: variant.config,
        patchFingerprint: variant.patchFingerprint,
        metadata: variant.metadata,
      })),
    },
  };
}

test('buildRegimeAwareSearchBatch skips duplicate exitRegime variants from prior manifests', () => {
  const champion = exitRegimeChampion('champ-exit-repeat');
  const first = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 4,
    regimeExitResearch: { enabled: true },
  });
  const manifest = exitRegimeManifest({ champion, variants: first });

  const second = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 4,
    regimeExitResearch: { enabled: true },
    policy: { recentManifestsForNovelty: [manifest] },
  });

  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.ok(first.every((variant) => variant.patchFingerprint));
  assert.ok(second.every((variant) => variant.patchFingerprint));
  assert.equal(second.some((variant) => first.some((old) => old.patchFingerprint === variant.patchFingerprint)), false);
});

test('buildRegimeExitStateForScout reports exhausted exitRegime lane with manifest evidence', () => {
  const champion = exitRegimeChampion('champ-exit-exhausted-summary');
  const allVariants = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
  });
  const recentManifestsForNovelty = [exitRegimeManifest({ champion, variants: allVariants })];
  const exhaustedBatch = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
    policy: { recentManifestsForNovelty },
  });

  const state = buildRegimeExitStateForScout({
    config: {
      maxConfigs: 200,
      regimeExitResearch: {
        enabled: true,
        lanes: {
          exploitRatio: 0,
          exitRegimeRatio: 1,
          globalAllParameterRatio: 0,
          robustnessRatio: 0,
        },
        exitRegimeEnabled: true,
        globalAllParameterEnabled: false,
        robustnessLadderEnabled: false,
      },
    },
    championState: champion,
    historyEventsBefore: [],
    searchBatch: [],
    schedulerState: {
      stagnationLevel: 1,
      budgetDebt: { exitRegime: 0 },
    },
    regimeExitContext: { recentManifestsForNovelty },
  });

  assert.ok(allVariants.length > 4);
  assert.deepEqual(exhaustedBatch, []);
  assert.equal(exhaustedBatch.some((variant) => variant.lane !== 'exitRegime'), false);
  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'exitRegime');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.candidateCount, 0);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.exhausted, true);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');
  assert.equal(shouldSkipGeneratedLaneSweep({ regimeExitState: state, searchBatch: [] }), true);
  assert.equal(shouldSkipGlobalAllParameterSweep({ regimeExitState: state, searchBatch: [] }), false);
});

function globalAllParameterChampion(configId = 'champ-repeat') {
  return {
    configId,
    config: {
      minPredSum: 1.8,
      adxThreshold: 20,
      slAtrMult: 0.5,
      trailAtrMult: 1,
      fusionV4LongAtrWeight: -0.25,
      fusionV4LongEmaWeight: 0,
      fusionV4ShortEmaWeight: 0,
    },
  };
}

function globalAllParameterManifest({ champion, variants }) {
  return {
    champion: { configId: champion.configId, config: { ...champion.config } },
    searchPlan: {
      variants: variants.map((variant) => ({
        lane: variant.lane,
        family: variant.family,
        mutationFamily: variant.mutationFamily,
        patch: variant.patch,
        config: variant.config,
        patchFingerprint: variant.patchFingerprint,
        metadata: variant.metadata,
      })),
    },
  };
}

function buildGlobalAllParameterScoutManifest({ champion, searchBatch }) {
  return buildScoutOrchestrationState({
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
    runId: 'pine-autoresearch-global-manifest',
    championState: champion,
    historyEventsBefore: [],
    searchBatch,
    primarySweep: {
      topConfigs: [
        { configId: champion.configId, score: 70, roiPct: 40, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 200, config: { ...champion.config } },
      ],
    },
    matrixCandidates: [],
  }).manifest;
}

test('buildScoutOrchestrationState persists global patch fingerprints from real searchBatch input', () => {
  const champion = globalAllParameterChampion('champ-real-manifest-persist');
  const searchBatch = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 2,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });

  const manifest = buildGlobalAllParameterScoutManifest({ champion, searchBatch });
  const persisted = manifest.searchPlan.variants;

  assert.equal(manifest.globalNoveltyGuardVersion, 1);
  assert.equal(searchBatch.length, 2);
  assert.ok(searchBatch.every((variant) => variant.patchFingerprint));
  assert.ok(searchBatch.every((variant) => variant.metadata?.patchFingerprint));
  assert.deepEqual(persisted.map((variant) => variant.variantId), searchBatch.map((variant) => variant.variantId));
  assert.deepEqual(persisted.map((variant) => variant.lane), ['globalAllParameter', 'globalAllParameter']);
  assert.deepEqual(persisted.map((variant) => variant.family), searchBatch.map((variant) => variant.family));
  assert.deepEqual(persisted.map((variant) => variant.patch), searchBatch.map((variant) => variant.patch));
  assert.deepEqual(persisted.map((variant) => variant.patchFingerprint), searchBatch.map((variant) => variant.patchFingerprint));
  assert.deepEqual(persisted.map((variant) => variant.metadata?.patchFingerprint), searchBatch.map((variant) => variant.metadata.patchFingerprint));
  assert.deepEqual(persisted.map((variant) => variant.config), searchBatch.map((variant) => variant.config));
});

test('collectTestedGlobalPatchFingerprints reads fingerprints from buildScoutOrchestrationState manifest', () => {
  const champion = globalAllParameterChampion('champ-real-manifest-collect');
  const searchBatch = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 2,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });
  const manifest = buildGlobalAllParameterScoutManifest({ champion, searchBatch });

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion,
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints].sort(), searchBatch.map((variant) => variant.patchFingerprint).sort());
});

test('buildRegimeAwareSearchBatch skips duplicate globalAllParameter variants from history and manifests', () => {
  const champion = globalAllParameterChampion('champ-repeat');
  const first = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 2,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 3 },
  });
  const manifest = globalAllParameterManifest({ champion, variants: [first[0]] });
  const historyEvents = [{ type: 'cycle-complete', manifest: globalAllParameterManifest({ champion, variants: [first[1]] }) }];

  const second = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 2,
    historyEvents,
    regimeExitResearch: { enabled: true },
    policy: {
      globalAllParameterVariantsPerFamily: 3,
      recentManifestsForNovelty: [manifest],
    },
  });

  assert.equal(second.length, 2);
  assert.equal(second.some((variant) => first.some((old) => old.patchFingerprint === variant.patchFingerprint)), false);
});

test('buildRegimeAwareSearchBatch returns exhausted globalAllParameter [] and does not fall back', () => {
  const champion = globalAllParameterChampion('champ-exhausted-no-fallback');
  const allVariants = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });
  const manifest = globalAllParameterManifest({ champion, variants: allVariants });

  const exhausted = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
    policy: {
      globalAllParameterVariantsPerFamily: 1,
      recentManifestsForNovelty: [manifest],
    },
  });

  assert.ok(allVariants.length > 6);
  assert.deepEqual(exhausted, []);
});

test('buildRegimeExitStateForScout reports exhausted globalAllParameter lane with manifest-derived evidence', () => {
  const champion = globalAllParameterChampion('champ-exhausted-summary');
  const allVariants = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });
  const recentManifestsForNovelty = [globalAllParameterManifest({ champion, variants: allVariants })];

  const state = buildRegimeExitStateForScout({
    config: {
      maxConfigs: 200,
      regimeExitResearch: {
        enabled: true,
        globalAllParameterEnabled: true,
        exitRegimeEnabled: false,
        robustnessEnabled: false,
      },
    },
    championState: champion,
    historyEventsBefore: [],
    searchBatch: [],
    schedulerState: {
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 0 },
    },
    regimeExitContext: { recentManifestsForNovelty },
  });

  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'globalAllParameter');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.candidateCount, 0);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.previewOnly, false);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.exhausted, true);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.testedPatchFingerprintCount, allVariants.length);
});

test('buildRegimeExitStateForScout skips exhausted globalAllParameter lane for same champion when alternatives are enabled', () => {
  const champion = globalAllParameterChampion('champ-exhausted-selector');
  const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
  const state = buildRegimeExitStateForScout({
    config: {
      maxConfigs: 6,
      regimeExitResearch: {
        enabled: true,
        globalAllParameterEnabled: true,
        exitRegimeEnabled: true,
        robustnessLadderEnabled: true,
      },
    },
    championState: champion,
    searchBatch: [],
    schedulerState: {
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 1000, exitRegime: 0 },
      laneExhaustions: {
        [championConfigFingerprint]: {
          globalAllParameter: {
            lane: 'globalAllParameter',
            championConfigFingerprint,
            exhaustedAt: '2026-05-09T00:00:00.000Z',
            runId: 'run-global-exhausted',
            reason: 'global-all-parameter-exhausted',
          },
        },
      },
    },
  });

  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'exitRegime');
  assert.notEqual(state.shadowRegimeScoreboard.selectedLane, 'globalAllParameter');
  assert.deepEqual(state.shadowRegimeScoreboard.exhaustedLanes, ['globalAllParameter']);
});

test('buildRegimeExitStateForScout ignores old globalAllParameter exhaustion after champion config changes', () => {
  const oldChampion = globalAllParameterChampion('champ-old-exhausted');
  const newChampion = {
    ...globalAllParameterChampion('champ-new-config'),
    config: { ...globalAllParameterChampion('champ-new-config').config, minPredSum: 2.1 },
  };
  const oldChampionConfigFingerprint = buildChampionConfigFingerprint(oldChampion.config);
  const state = buildRegimeExitStateForScout({
    config: {
      maxConfigs: 6,
      regimeExitResearch: {
        enabled: true,
        globalAllParameterEnabled: true,
        exitRegimeEnabled: true,
      },
    },
    championState: newChampion,
    searchBatch: [],
    schedulerState: {
      stagnationLevel: 1,
      laneExhaustions: {
        [oldChampionConfigFingerprint]: {
          globalAllParameter: {
            lane: 'globalAllParameter',
            championConfigFingerprint: oldChampionConfigFingerprint,
            exhaustedAt: '2026-05-09T00:00:00.000Z',
            runId: 'run-old-global-exhausted',
            reason: 'global-all-parameter-exhausted',
          },
        },
      },
    },
  });

  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'globalAllParameter');
  assert.deepEqual(state.shadowRegimeScoreboard.exhaustedLanes, []);
});

test('selectNextResearchLane does not let preferred-lane budget debt override exhaustion', () => {
  const championConfigFingerprint = buildChampionConfigFingerprint(globalAllParameterChampion('champ-debt').config);
  const selectedLane = selectNextResearchLane({
    stagnationLevel: 3,
    budgetDebt: { globalAllParameter: 9999, exitRegime: 0, robustness: 0, exploit: 0 },
    lanesEnabled: {
      exploit: false,
      exitRegime: true,
      globalAllParameter: true,
      robustness: true,
    },
    championConfigFingerprint,
    schedulerState: {
      laneExhaustions: {
        [championConfigFingerprint]: {
          globalAllParameter: {
            lane: 'globalAllParameter',
            championConfigFingerprint,
            exhaustedAt: '2026-05-09T00:00:00.000Z',
            runId: 'run-global-exhausted',
            reason: 'global-all-parameter-exhausted',
          },
        },
      },
    },
  });

  assert.equal(selectedLane, 'exitRegime');
});

function exhaustedGlobalAllParameterRegimeState(champion = globalAllParameterChampion('champ-exhausted-helper')) {
  const allVariants = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });
  return buildRegimeExitStateForScout({
    config: {
      matrixId: 'pine-autoresearch',
      maxConfigs: 200,
      regimeExitResearch: {
        enabled: true,
        globalAllParameterEnabled: true,
        exitRegimeEnabled: false,
        robustnessEnabled: false,
      },
    },
    championState: champion,
    searchBatch: [],
    schedulerState: { stagnationLevel: 1, budgetDebt: { globalAllParameter: 0 } },
    regimeExitContext: { recentManifestsForNovelty: [globalAllParameterManifest({ champion, variants: allVariants })] },
  });
}

test('shouldSkipGlobalAllParameterSweep returns true only for exhausted empty globalAllParameter sweep', () => {
  const champion = globalAllParameterChampion('champ-skip-helper');
  const regimeExitState = exhaustedGlobalAllParameterRegimeState(champion);

  assert.equal(shouldSkipGlobalAllParameterSweep({ regimeExitState, searchBatch: [] }), true);
  assert.equal(shouldSkipGlobalAllParameterSweep({ regimeExitState, searchBatch: [{ variantId: 'novel' }] }), false);
  assert.equal(shouldSkipGlobalAllParameterSweep({ regimeExitState: { ...regimeExitState, enabled: false }, searchBatch: [] }), false);
  assert.equal(shouldSkipGlobalAllParameterSweep({
    regimeExitState: {
      ...regimeExitState,
      shadowRegimeScoreboard: {
        ...regimeExitState.shadowRegimeScoreboard,
        selectedLane: 'exitRegime',
      },
    },
    searchBatch: [],
  }), false);
});

test('buildGlobalAllParameterExhaustedManifest records exhausted globalAllParameter evidence', () => {
  const champion = globalAllParameterChampion('champ-exhausted-manifest');
  const regimeExitState = exhaustedGlobalAllParameterRegimeState(champion);
  const manifest = buildGlobalAllParameterExhaustedManifest({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8 },
    },
    runId: 'run-exhausted-manifest',
    championState: champion,
    regimeExitState,
    schedulerState: { noNewCandidateStreak: 2, stagnationLevel: 1 },
  });

  assert.equal(manifest.globalNoveltyGuardVersion, 1);
  assert.equal(manifest.searchPlan.variantCount, 0);
  assert.deepEqual(manifest.searchPlan.variants, []);
  assert.equal(manifest.matrixDecision.recommendation, 'hold');
  assert.equal(manifest.matrixDecision.reason, 'global-all-parameter-exhausted');
  assert.equal(manifest.primarySweep, null);
  assert.equal(manifest.noNewCandidate, true);
  assert.equal(manifest.shadowRegimeScoreboard.selectedLane, 'globalAllParameter');
  assert.equal(manifest.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');
  assert.ok(manifest.shadowRegimeScoreboard.generatorSummary.testedPatchFingerprintCount > 6);
});

test('runScout does not pay down selected robustness debt when active track variants consume the cycle', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-unconsumed-robustness-debt-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'unconsumed-robustness-debt-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 4,
      minTrades: 1,
      researchTracks: [
        { trackId: 'squeeze-context', gridName: 'phase3-core', windowSet: 'primary', enabled: true },
      ],
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 0,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        exploitEnabled: true,
        exitRegimeEnabled: true,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: true,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-unconsumed-robustness');
    const initialBudgetDebt = { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 1000 };
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-unconsumed-robustness-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 0,
      budgetDebt: initialBudgetDebt,
    }), 'utf8');

    const sweepVariants = [];
    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async (_config, _runId, options) => {
        sweepVariants.push(...JSON.parse(await fs.readFile(options.variantFilePath, 'utf8')));
        return { topConfigs: [] };
      },
    });

    const schedulerState = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), 'utf8'));
    assert.equal(result.manifest.shadowRegimeScoreboard.selectedLane, 'robustness');
    assert.ok(sweepVariants.length > 0);
    assert.equal(sweepVariants.every((variant) => variant.lane === 'track'), true);
    assert.deepEqual(schedulerState.budgetDebt, initialBudgetDebt);
    assert.deepEqual(result.manifest.laneBudgetDebt, initialBudgetDebt);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runScout records next non-global lane after exhausted globalAllParameter hold when alternatives are enabled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-global-exhausted-next-lane-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'global-exhausted-next-lane-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 200,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        globalAllParameterVariantsPerFamily: 1,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        exitRegimeEnabled: true,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: true,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-next-lane');
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-next-lane-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 0, exitRegime: 0 },
      noNewCandidateStreak: 0,
      globalAllParameterVariantsPerFamily: 1,
    }), 'utf8');

    const allVariants = buildRegimeAwareSearchBatch({
      selectedLane: 'globalAllParameter',
      champion,
      maxConfigs: 200,
      regimeExitResearch: { enabled: true },
      policy: { globalAllParameterVariantsPerFamily: 1 },
    });
    await fs.writeFile(
      path.join(autoresearchCli.manifestsDir(config), '000-prior-global.json'),
      JSON.stringify(globalAllParameterManifest({ champion, variants: allVariants })),
      'utf8',
    );

    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async () => {
        throw new Error('primary sweep must not run while recording exhausted global lane');
      },
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'global-all-parameter-exhausted');
    const schedulerState = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), 'utf8'));
    const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
    assert.equal(schedulerState.lastLaneExhaustion.lane, 'globalAllParameter');
    assert.equal(schedulerState.lastLaneExhaustion.championConfigFingerprint, championConfigFingerprint);
    assert.equal(schedulerState.lastLaneExhaustion.nextSelectedLane, 'exitRegime');
    assert.notEqual(schedulerState.lastLaneExhaustion.nextSelectedLane, 'globalAllParameter');
    assert.deepEqual(schedulerState.budgetDebt, { exploit: 50, exitRegime: 70, globalAllParameter: -150, robustness: 30 });
    assert.deepEqual(result.manifest.laneBudgetDebt, schedulerState.budgetDebt);
    assert.equal(schedulerState.laneExhaustions[championConfigFingerprint].globalAllParameter.nextSelectedLane, 'exitRegime');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runScout skips primary sweep and records selected exitRegime exhaustion without fallback variants', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-exit-exhausted-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.0, "trailAtrMult")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'exit-exhausted-runscout-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 200,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        lanes: {
          exploitRatio: 0,
          exitRegimeRatio: 1,
          globalAllParameterRatio: 0,
          robustnessRatio: 0,
        },
        exitRegimeEnabled: true,
        globalAllParameterEnabled: false,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = exitRegimeChampion('champ-runscout-exit-exhausted');
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-exit-exhausted-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { exitRegime: 0 },
      noNewCandidateStreak: 0,
    }), 'utf8');

    const allVariants = buildRegimeAwareSearchBatch({
      selectedLane: 'exitRegime',
      champion,
      maxConfigs: 200,
      regimeExitResearch: { enabled: true },
    });
    await fs.writeFile(
      path.join(autoresearchCli.manifestsDir(config), '000-prior-exit.json'),
      JSON.stringify(exitRegimeManifest({ champion, variants: allVariants })),
      'utf8',
    );

    const sweepCalls = [];
    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async (...args) => {
        sweepCalls.push(args);
        throw new Error('primary sweep must not run when exitRegime is exhausted');
      },
    });

    assert.deepEqual(sweepCalls, []);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'exit-regime-exhausted');
    assert.equal(result.manifest.searchPlan.variantCount, 0);
    assert.deepEqual(result.manifest.searchPlan.variants, []);
    assert.equal(result.manifest.matrixDecision.reason, 'exit-regime-exhausted');
    assert.equal(result.manifest.shadowRegimeScoreboard.selectedLane, 'exitRegime');
    assert.equal(result.manifest.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');

    const variantFilePath = path.join(config.researchRoot, `${result.manifest.runId}-variants.json`);
    assert.equal(await readIfExists(variantFilePath), null);

    const schedulerState = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), 'utf8'));
    assert.equal(schedulerState.lastLaneExhaustion.lane, 'exitRegime');
    assert.equal(schedulerState.lastLaneExhaustion.reason, 'exit-regime-exhausted');
    const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
    assert.equal(schedulerState.lastLaneExhaustion.championConfigFingerprint, championConfigFingerprint);
    assert.equal(schedulerState.laneExhaustions[championConfigFingerprint].exitRegime.lane, 'exitRegime');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runScout skips primary sweep and updates scheduler state when globalAllParameter is exhausted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-global-exhausted-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'global-exhausted-runscout-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 200,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        globalAllParameterVariantsPerFamily: 1,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        lanes: {
          exploitRatio: 0,
          exitRegimeRatio: 0,
          globalAllParameterRatio: 1,
          robustnessRatio: 0,
        },
        exitRegimeEnabled: false,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-exhausted');
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-exhausted-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 0 },
      noNewCandidateStreak: 0,
      globalAllParameterVariantsPerFamily: 1,
    }), 'utf8');

    const allVariants = buildRegimeAwareSearchBatch({
      selectedLane: 'globalAllParameter',
      champion,
      maxConfigs: 200,
      regimeExitResearch: { enabled: true },
      policy: { globalAllParameterVariantsPerFamily: 1 },
    });
    await fs.writeFile(
      path.join(autoresearchCli.manifestsDir(config), '000-prior-global.json'),
      JSON.stringify(globalAllParameterManifest({ champion, variants: allVariants })),
      'utf8',
    );

    const sweepCalls = [];
    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async (...args) => {
        sweepCalls.push(args);
        throw new Error('primary sweep must not run when globalAllParameter is exhausted');
      },
    });

    assert.deepEqual(sweepCalls, []);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'global-all-parameter-exhausted');
    assert.equal(result.manifest.globalNoveltyGuardVersion, 1);
    assert.equal(result.manifest.searchPlan.variantCount, 0);
    assert.deepEqual(result.manifest.searchPlan.variants, []);
    assert.equal(result.manifest.matrixDecision.reason, 'global-all-parameter-exhausted');
    assert.equal(result.manifest.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');
    assert.equal(result.manifestPath, path.join(autoresearchCli.manifestsDir(config), `${result.manifest.runId}.json`));

    const variantFilePath = path.join(config.researchRoot, `${result.manifest.runId}-variants.json`);
    assert.equal(await readIfExists(variantFilePath), null);

    const schedulerState = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), 'utf8'));
    assert.equal(schedulerState.noNewCandidateStreak, 1);
    assert.equal(schedulerState.lastChampionFingerprint, schedulerState.lastCandidateFingerprint);
    const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
    assert.equal(schedulerState.lastLaneExhaustion.lane, 'globalAllParameter');
    assert.equal(schedulerState.lastLaneExhaustion.championConfigFingerprint, championConfigFingerprint);
    assert.equal(schedulerState.lastLaneExhaustion.reason, 'global-all-parameter-exhausted');
    assert.equal(schedulerState.lastLaneExhaustion.nextSelectedLane, null);
    assert.equal(schedulerState.lastLaneExhaustion.fallbackReason, 'all-enabled-lanes-exhausted');
    assert.equal(schedulerState.laneExhaustions[championConfigFingerprint].globalAllParameter.lane, 'globalAllParameter');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runScout exhausted globalAllParameter finalizes comparable artifacts and markdown without undefined', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-global-exhausted-artifacts-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'global-exhausted-artifacts-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 200,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        globalAllParameterVariantsPerFamily: 1,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        lanes: {
          exploitRatio: 0,
          exitRegimeRatio: 0,
          globalAllParameterRatio: 1,
          robustnessRatio: 0,
        },
        exitRegimeEnabled: false,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
      },
      retention: { keepLatestRuns: 1, pruneSweepRuns: true, pruneEvaluationRuns: true, prunePartialRuns: true },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-exhausted-artifacts');
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-exhausted-artifacts-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 0 },
      noNewCandidateStreak: 0,
      globalAllParameterVariantsPerFamily: 1,
    }), 'utf8');

    const allVariants = buildRegimeAwareSearchBatch({
      selectedLane: 'globalAllParameter',
      champion,
      maxConfigs: 200,
      regimeExitResearch: { enabled: true },
      policy: { globalAllParameterVariantsPerFamily: 1 },
    });
    await fs.writeFile(
      path.join(autoresearchCli.manifestsDir(config), '000-prior-global.json'),
      JSON.stringify(globalAllParameterManifest({ champion, variants: allVariants })),
      'utf8',
    );

    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async () => {
        throw new Error('primary sweep must not run when globalAllParameter is exhausted');
      },
    });

    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'global-all-parameter-exhausted');
    assert.equal(result.manifestPath, path.join(autoresearchCli.manifestsDir(config), `${result.manifest.runId}.json`));
    assert.equal(result.scoutPath, path.join(config.digestRoot, `${result.manifest.runId}.md`));
    assert.equal(result.liveDigestPath, path.join(config.digestRoot, 'latest-digest.md'));
    assert.ok(result.pruneResult);

    const historyMarkdown = await fs.readFile(path.join(config.digestRoot, 'history.md'), 'utf8');
    assert.match(historyMarkdown, /globalAllParameter novel patch space exhausted/);

    const latestDigest = await fs.readFile(path.join(config.digestRoot, 'latest-digest.md'), 'utf8');
    assert.match(latestDigest, new RegExp(`Latest run: ${result.manifest.runId}`));

    const latest = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'latest.json'), 'utf8'));
    assert.equal(latest.manifestPath, result.manifestPath);
    assert.equal(latest.runId, result.manifest.runId);

    const historyEvents = (await fs.readFile(path.join(config.researchRoot, 'history.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const cycleEvent = historyEvents.find((event) => event.runId === result.manifest.runId);
    assert.ok(cycleEvent);
    for (const key of [
      'steadyState',
      'noChangeStreak',
      'activeTrackId',
      'windowSetId',
      'noveltySignature',
      'rotationTrigger',
      'rotationReason',
      'sameTrackCycleStreak',
      'topCandidateSimilarity',
      'promotionEligible',
      'promotionEligibleReason',
      'noNewCandidate',
      'noNewCandidateStreak',
      'stagnationLevel',
      'stagnationReason',
      'lastEscalatedAt',
      'rejectedCandidateFingerprint',
      'globalNoveltyGuardVersion',
    ]) {
      assert.ok(Object.hasOwn(cycleEvent, key), `missing history field ${key}`);
    }
    assert.equal(cycleEvent.steadyState, true);
    assert.equal(cycleEvent.noNewCandidate, true);
    assert.equal(cycleEvent.promotionEligible, false);
    assert.equal(cycleEvent.promotionEligibleReason, 'global-all-parameter-exhausted');

    const scoutMarkdown = await fs.readFile(result.scoutPath, 'utf8');
    assert.match(scoutMarkdown, /Primary sweep: \*\*skipped\*\*/);
    assert.match(scoutMarkdown, /global-all-parameter-exhausted/);
    assert.doesNotMatch(scoutMarkdown, /undefined/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('runScout returns terminal no-lane hold when only globalAllParameter lane is boolean-enabled and already exhausted', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-no-lane-global-exhausted-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'global-exhausted-no-lane-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 6,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        globalAllParameterVariantsPerFamily: 1,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        exploitEnabled: false,
        exitRegimeEnabled: false,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-no-lane');
    const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-no-lane-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 1000 },
      laneExhaustions: {
        [championConfigFingerprint]: {
          globalAllParameter: {
            lane: 'globalAllParameter',
            championConfigFingerprint,
            exhaustedAt: '2026-05-09T00:00:00.000Z',
            runId: 'run-global-exhausted',
            reason: 'global-all-parameter-exhausted',
            nextSelectedLane: null,
            fallbackReason: 'all-enabled-lanes-exhausted',
          },
        },
      },
    }), 'utf8');

    const sweepCalls = [];
    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async (...args) => {
        sweepCalls.push(args);
        throw new Error('primary sweep must not run when no regime lane is available');
      },
    });

    assert.deepEqual(sweepCalls, []);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no-regime-research-lane');
    assert.equal(result.manifest.primarySweep, null);
    assert.equal(result.manifest.matrixDecision.recommendation, 'hold');
    assert.equal(result.manifest.matrixDecision.reason, 'no-regime-research-lane');
    assert.equal(result.manifest.shadowRegimeScoreboard.selectedLane, null);
    assert.equal(result.manifest.shadowRegimeScoreboard.noLaneReason, 'all-enabled-lanes-exhausted');
    assert.deepEqual(result.manifest.searchPlan.variants, []);
    assert.equal(result.scoutPath, path.join(config.digestRoot, `${result.manifest.runId}.md`));
    assert.equal(result.liveDigestPath, path.join(config.digestRoot, 'latest-digest.md'));
    assert.ok(result.pruneResult);

    const noLaneDigest = await fs.readFile(path.join(config.digestRoot, 'latest-digest.md'), 'utf8');
    assert.match(noLaneDigest, new RegExp(`Latest run: ${result.manifest.runId}`));
    const noLaneHistoryMarkdown = await fs.readFile(path.join(config.digestRoot, 'history.md'), 'utf8');
    assert.match(noLaneHistoryMarkdown, /no enabled non-exhausted regime research lane/);
    const noLaneScoutMarkdown = await fs.readFile(result.scoutPath, 'utf8');
    assert.match(noLaneScoutMarkdown, /Primary sweep: \*\*skipped\*\*/);
    assert.match(noLaneScoutMarkdown, /no-regime-research-lane/);
    assert.doesNotMatch(noLaneScoutMarkdown, /undefined/);

    const noLaneEvents = (await fs.readFile(path.join(config.researchRoot, 'history.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const noLaneEvent = noLaneEvents.find((event) => event.runId === result.manifest.runId);
    assert.equal(noLaneEvent.noLaneReason, 'all-enabled-lanes-exhausted');
    assert.equal(noLaneEvent.steadyState, true);
    assert.equal(noLaneEvent.promotionEligible, false);
    assert.equal(noLaneEvent.promotionEligibleReason, 'no-regime-research-lane');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});


test('runScout treats dashed persisted global lane exhaustion as terminal no-lane hold', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-no-lane-global-dashed-exhausted-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'global-dashed-exhausted-no-lane-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 6,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        globalAllParameterVariantsPerFamily: 1,
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
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        exploitEnabled: false,
        exitRegimeEnabled: false,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-no-lane-dashed');
    const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-no-lane-dashed-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 1000 },
      laneExhaustions: {
        [championConfigFingerprint]: {
          'global-all-parameter': {
            lane: 'global-all-parameter',
            championConfigFingerprint,
            exhaustedAt: '2026-05-09T00:00:00.000Z',
            runId: 'run-global-dashed-exhausted',
            reason: 'global-all-parameter-exhausted',
            nextSelectedLane: null,
            fallbackReason: 'all-enabled-lanes-exhausted',
          },
        },
      },
    }), 'utf8');

    const sweepCalls = [];
    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async (...args) => {
        sweepCalls.push(args);
        throw new Error('primary sweep must not run when dashed persisted global lane is exhausted');
      },
    });

    assert.deepEqual(sweepCalls, []);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no-regime-research-lane');
    assert.equal(result.manifest.primarySweep, null);
    assert.equal(result.manifest.matrixDecision.recommendation, 'hold');
    assert.equal(result.manifest.matrixDecision.reason, 'no-regime-research-lane');
    assert.equal(result.manifest.shadowRegimeScoreboard.selectedLane, null);
    assert.equal(result.manifest.shadowRegimeScoreboard.noLaneReason, 'all-enabled-lanes-exhausted');
    assert.deepEqual(result.manifest.searchPlan.variants, []);

    const persistedSchedulerState = JSON.parse(await fs.readFile(
      path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`),
      'utf8',
    ));
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        persistedSchedulerState.laneExhaustions[championConfigFingerprint],
        'global-all-parameter',
      ),
      true,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        persistedSchedulerState.laneExhaustions[championConfigFingerprint],
        'globalAllParameter',
      ),
      false,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
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
    assert.equal(result.manifestPath, path.join(autoresearchCli.manifestsDir(config), `${result.manifest.runId}.json`));
    assert.equal(result.scoutPath, path.join(config.digestRoot, `${result.manifest.runId}.md`));
    assert.equal(result.liveDigestPath, path.join(config.digestRoot, 'latest-digest.md'));
    assert.ok(result.pruneResult);
    assert.equal(result.manifest.primarySweep, null);
    assert.equal(result.manifest.matrixDecision.recommendation, 'hold');
    assert.equal(result.manifest.matrixDecision.reason, 'offlineDataMissing');
    assert.equal(result.manifest.offlineDataSummary.reason, 'offlineDataMissing');

    const latest = JSON.parse(await fs.readFile(path.join(config.researchRoot, 'latest.json'), 'utf8'));
    assert.equal(latest.manifestPath, result.manifestPath);
    assert.equal(latest.runId, result.manifest.runId);

    const persistedManifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    assert.equal(persistedManifest.runId, result.manifest.runId);
    assert.equal(persistedManifest.matrixDecision.reason, 'offlineDataMissing');

    const scoutMarkdown = await fs.readFile(result.scoutPath, 'utf8');
    assert.match(scoutMarkdown, /Primary sweep: \*\*skipped\*\*/);
    assert.match(scoutMarkdown, /offlineDataMissing/);
    assert.doesNotMatch(scoutMarkdown, /undefined/);

    const latestDigest = await fs.readFile(path.join(config.digestRoot, 'latest-digest.md'), 'utf8');
    assert.match(latestDigest, new RegExp(`Latest run: ${result.manifest.runId}`));

    const historyMarkdown = await fs.readFile(path.join(config.digestRoot, 'history.md'), 'utf8');
    assert.match(historyMarkdown, /offline-strict autoresearch/);

    const historyPath = path.join(config.researchRoot, 'history.jsonl');
    const historyRaw = await fs.readFile(historyPath, 'utf8');
    const historyEvents = historyRaw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const cycleEvent = historyEvents.find((event) => event.type === 'cycle');

    assert.ok(cycleEvent);
    assert.equal(cycleEvent.promotionEligible, false);
    assert.equal(cycleEvent.promotionEligibleReason, 'offlineDataMissing');
    assert.equal(cycleEvent.offlineDataSummary.reason, 'offlineDataMissing');
    assert.equal(cycleEvent.runId, result.manifest.runId);

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


