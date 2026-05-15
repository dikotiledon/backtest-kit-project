import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildChampionConfigFingerprint } from '../scripts/lib/pine-global-search.mjs';
import { buildIncumbentSearchBatch, configFingerprint } from '../scripts/lib/pine-search-policy.mjs';
import { loadConfig, runScout } from '../scripts/pine-autoresearch.mjs';

const championState = {
  configId: 'stub-champ',
  config: {
    adxThreshold: 20,
    slAtrMult: 0.5,
    tpAtrMult: 2.5,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    riskAtrLen: 14,
    neighborsCount: 32,
    h: 8,
    r: 8,
    x: 25,
    minPredSum: 1.8,
    minBarsBetween: 1,
    useTrendXConf: true,
    useSignalFusion: true,
    useFusionV4: true,
    useTrailingStop: true,
    useStopsTP: true,
  },
  score: 150,
  tradeCount: 200,
  winRatePct: 55,
  roiPct: 30,
  profitFactor: 2.5,
  maxDrawdownPct: 2,
  expectancy: 0.2,
};

function schedulerStatePath(config) {
  return path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`);
}

async function setupFixture() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-saturation-'));
  const scriptPath = path.join(tmpRoot, 'test.pine');
  const configPath = path.join(tmpRoot, 'config.json');
  const rawConfig = {
    matrixId: 'pine-test-saturation',
    scriptPath,
    outputs: {
      researchRoot: path.join(tmpRoot, 'research'),
      digestRoot: path.join(tmpRoot, 'digest'),
    },
    grid: 'phase3-core',
    maxConfigs: 3,
    minTrades: 10,
    primaryLab: {
      labId: 'xrp',
      symbol: 'XRPUSDT',
      timeframe: '15m',
      limit: 100,
      when: '2026-04-21T10:30:00Z',
      exchange: 'ccxt-exchange',
      thresholds: {
        minScoreDelta: 0.25,
        minRoiDeltaPct: 0,
        minProfitFactorDelta: 0,
        maxDrawdownDeltaPct: 1,
        minTradeCount: 10,
        minTradeRatioVsIncumbent: 0.5,
      },
    },
    shadowLabs: [],
    blindHoldoutLabs: [],
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
    searchPolicy: {
      mode: 'incumbent-local',
      exploitRatio: 0.67,
      exploitFamilies: ['signal', 'risk'],
      exploreFamilies: ['signal'],
      paretoShortlistSize: 3,
      matrixCandidateLimit: 3,
      tabu: { maxAgeCycles: 3, maxEntries: 128, dropOnChampionChange: true },
    },
    rotationPolicy: {
      tabuLimit: 128,
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 99,
        holdEscalateAfter: 99,
        highSimilarityThreshold: 0.8,
        maxStagnationLevel: 2,
        lowEmissionEscalateAfter: 4,
        lowEmissionThreshold: 3,
      },
    },
    pinnedData: { enabled: false },
    retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false, pruneVariantFiles: false },
  };

  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, '// stub Pine source', 'utf8');
  await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf8');

  const config = await loadConfig(tmpRoot, configPath, {});
  await fs.mkdir(config.researchRoot, { recursive: true });
  await fs.mkdir(path.dirname(schedulerStatePath(config)), { recursive: true });
  await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify(championState, null, 2), 'utf8');

  const championFingerprint = buildChampionConfigFingerprint(championState.config);
  const agedTabuEntries = buildIncumbentSearchBatch({
    incumbent: championState.config,
    maxConfigs: 64,
    policy: config.searchPolicy,
    schedulerState: {},
  })
    .filter((variant) => variant?.config)
    .map((variant) => ({
      fingerprint: configFingerprint(variant.config),
      addedAtCycle: 0,
      championFingerprint,
    }));

  await fs.writeFile(schedulerStatePath(config), JSON.stringify({
    cycleIndex: 0,
    stagnationLevel: 0,
    lowEmissionStreak: 0,
    tabuRejectedFingerprints: agedTabuEntries,
  }, null, 2), 'utf8');

  return { tmpRoot, config };
}

function gateFailingEvaluator() {
  return async ({ candidate, variantKey }) => ({
    label: candidate.configId || `${variantKey}-stub`,
    configId: candidate.configId || `${variantKey}-stub`,
    config: candidate.config || candidate,
    score: 100,
    tradeCount: 200,
    winRatePct: 40,
    roiPct: 20,
    profitFactor: 2.0,
    maxDrawdownPct: 3,
    expectancy: 0.1,
  });
}

async function fakePrimarySweep({ runDir, variantFilePath, cycleIndex }) {
  await fs.mkdir(runDir, { recursive: true });
  const variants = JSON.parse(await fs.readFile(variantFilePath, 'utf8'));
  return {
    runDir,
    gridName: 'phase3-core',
    totalCombos: variants.length,
    sweepOffset: 0,
    topConfigs: variants.map((variant, index) => ({
      label: variant.variantId || `variant-${cycleIndex}-${index}`,
      configId: `${variant.variantId || 'variant'}-${cycleIndex}-${index}`,
      config: variant.config,
      score: 120 - index,
      tradeCount: 200,
      winRatePct: 45,
      roiPct: 25,
      profitFactor: 2.1,
      maxDrawdownPct: 2.5,
      expectancy: 0.12,
    })),
    best: variants[0]
      ? {
          label: variants[0].variantId || `variant-${cycleIndex}-0`,
          configId: `${variants[0].variantId || 'variant'}-${cycleIndex}-0`,
          config: variants[0].config,
          score: 120,
        }
      : null,
  };
}

test('tabu saturation recovers via lowEmissionStreak escalation and tabu aging', async () => {
  const { tmpRoot, config } = await setupFixture();
  try {
    const cycles = [];

    for (let cycleIndex = 1; cycleIndex <= 5; cycleIndex += 1) {
      const result = await runScout(config, {
        evaluateConfigOnLab: gateFailingEvaluator(),
        runPrimarySweep: async (trackedConfig, runId, { variantFilePath }) => fakePrimarySweep({
          runDir: path.join(tmpRoot, 'pine', 'sweeps', `stub-${cycleIndex}`),
          variantFilePath,
          cycleIndex,
        }),
      });
      const schedulerState = JSON.parse(await fs.readFile(schedulerStatePath(config), 'utf8'));
      cycles.push({
        manifest: result.manifest,
        schedulerState,
        tabuCount: schedulerState.tabuRejectedFingerprints?.length ?? 0,
      });
    }

    const cycle3 = cycles[2];
    assert.ok(
      cycle3.manifest.stagnationLevel >= 1
        || cycle3.manifest.searchEfficiency?.allCandidatesTabu === true
        || (cycle3.schedulerState.lowEmissionStreak ?? 0) >= 2,
      'cycle 3 should have escalated, reported tabu exhaustion, or accumulated scheduler low emission pressure',
    );

    const cycle4 = cycles[3];
    const cycle5 = cycles[4];
    assert.ok(cycle4.manifest.stagnationLevel >= 1, 'cycle 4 should remain escalated');
    assert.ok(
      (cycle4.schedulerState.lowEmissionStreak ?? 0) > 0 || Boolean(cycle4.schedulerState.stagnationReason),
      'cycle 4 scheduler state should retain low-emission or stagnation progression',
    );
    assert.ok(cycle4.tabuCount < cycle3.tabuCount, 'cycle 4 tabu set should shrink after escalation-aged pruning');
    assert.ok(
      (cycle5.manifest.searchEfficiency?.emittedVariantCount ?? 0) > (cycle4.manifest.searchEfficiency?.emittedVariantCount ?? 0),
      'cycle 5 emitted count should increase after tabu aging + pool widening',
    );

    const recoveryManifest = cycle5.manifest;
    assert.equal(
      recoveryManifest.searchEfficiency?.allCandidatesTabu,
      false,
      'recovery cycle should prove generation is no longer fully tabu-pruned',
    );
    assert.ok(
      (recoveryManifest.searchEfficiency?.emittedVariantCount ?? 0) > 0,
      'recovery cycle should emit a non-empty executable variant batch',
    );
    assert.ok(
      Array.isArray(recoveryManifest.searchPlan?.variants),
      'recovery manifest should expose concrete emitted search variants',
    );
    assert.ok(
      recoveryManifest.searchPlan.variants.length > 0,
      'recovery manifest should include at least one emitted variant',
    );
    assert.equal(
      recoveryManifest.stagnationReason,
      'lowEmissionStreak',
      'recovery cycle should carry the concrete low-emission recovery reason',
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
