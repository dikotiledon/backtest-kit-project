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
import { buildScoutOrchestrationState, buildScoutRegimeAnalysisArtifact, resolveTrackSelectionState } from '../scripts/pine-autoresearch.mjs';

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
