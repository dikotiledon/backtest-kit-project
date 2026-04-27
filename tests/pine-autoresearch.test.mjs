import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildParetoShortlist,
  computeSweepOffset,
  decideAutoPromotionAction,
  decideAutoresearchOutcome,
  decideMatrixPromotion,
  extractChampionBootstrapCandidate,
  planArtifactPrune,
  renderDigestMarkdown,
  sameConfig,
  selectChampionBootstrapSource,
  selectRobustMatrixCandidate,
  summarizeDigestAnnouncement,
} from '../scripts/lib/pine-autoresearch.mjs';
import { buildScoutOrchestrationState } from '../scripts/pine-autoresearch.mjs';

function makeResult({
  configId,
  score,
  tradeCount,
  roiPct,
  profitFactor,
  maxDrawdownPct,
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
    },
  };
}

test('sameConfig compares deep config content, not object identity', () => {
  assert.equal(sameConfig({ a: 1, nested: { b: true } }, { nested: { b: true }, a: 1 }), true);
  assert.equal(sameConfig({ a: 1 }, { a: 2 }), false);
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
      challenger: { configId: 'c1', config: { minPredSum: 1.5 } },
      labResults: [{ decision: { recommendation: 'promote', comparisons: { scoreDelta: 1, roiDeltaPct: 2, profitFactorDelta: 0.1, drawdownDeltaPct: -0.2 } } }],
      matrixDecision: { recommendation: 'promote', gates: { candidateChanged: true } },
      robustness: { aggregateScoreDelta: 1, aggregateRoiDeltaPct: 2, aggregateProfitFactorDelta: 0.1, aggregateDrawdownDeltaPct: -0.2 },
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
      topCandidateSimilarity: 0.75,
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
  assert.equal(result.manifest.topCandidateSimilarity, 0.75);
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
  });
});

test('default autoresearch config rotates across multiple pinned windows', async () => {
  const raw = await fs.readFile(new URL('../config/pine-autoresearch.default.json', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  const whens = new Set([config.primaryLab.when, ...config.shadowLabs.map((lab) => lab.when)]);

  assert.ok(whens.size >= 3);
  assert.ok(config.shadowLabs.length >= 5);
});
