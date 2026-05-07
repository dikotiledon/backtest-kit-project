import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegimeExitStateForScout, buildScoutOrchestrationState } from '../scripts/pine-autoresearch.mjs';

function baseInput() {
  return {
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      maxConfigs: 8,
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      pinnedData: { enabled: false },
    },
    runId: 'regime-exit-integration',
    championState: { configId: 'champion', score: 70, config: { minPredSum: 2 } },
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'signal', config: { minPredSum: 1.9 } }],
    primarySweep: { topConfigs: [{ configId: 'c1', score: 72, roiPct: 44, profitFactor: 1.6, maxDrawdownPct: 5, tradeCount: 200, config: { minPredSum: 1.9 } }] },
    matrixCandidates: [{ challenger: { configId: 'c1', config: { minPredSum: 1.9 } }, matrixDecision: { recommendation: 'hold', summary: 'Hold' }, robustness: {} }],
  };
}

test('regime-exit disabled keeps legacy manifest shape and promotion semantics', () => {
  const result = buildScoutOrchestrationState({
    ...baseInput(),
    regimeExitState: { enabled: false },
  });

  assert.equal(result.manifest.researchBudgetMode, undefined);
  assert.equal(result.manifest.resourceBudget, undefined);
  assert.equal(result.manifest.objectiveBreakdown, undefined);
  assert.equal(result.manifest.offlineDataSummary, undefined);
  assert.equal(result.manifest.shadowRegimeScoreboard, undefined);
  assert.ok(['promote', 'hold'].includes(result.manifest.matrixDecision.recommendation));
});

test('regime-exit enabled surfaces compact manifest fields', () => {
  const result = buildScoutOrchestrationState({
    ...baseInput(),
    regimeExitState: {
      enabled: true,
      researchBudgetMode: 'regime-exit',
      resourceBudget: { maxConcurrentLabWorkers: 1 },
      objectiveBreakdown: { minRoiPct: 25 },
      offlineDataSummary: { ok: true, mode: 'offline-strict' },
      shadowRegimeScoreboard: { lane: 'exitRegime' },
    },
  });

  assert.equal(result.manifest.researchBudgetMode, 'regime-exit');
  assert.equal(result.manifest.resourceBudget.maxConcurrentLabWorkers >= 1, true);
  assert.equal(result.manifest.objectiveBreakdown !== undefined, true);
  assert.equal(result.manifest.offlineDataSummary !== undefined, true);
  assert.equal(result.manifest.shadowRegimeScoreboard !== undefined, true);
});


test('buildRegimeExitStateForScout returns null for missing input without throw', () => {
  assert.doesNotThrow(() => buildRegimeExitStateForScout({}));
  assert.equal(buildRegimeExitStateForScout({}), null);
});

test('buildRegimeExitStateForScout returns compact staged summaries and manifest-ready enabled fields', () => {
  const seed = baseInput();
  seed.config.regimeExitResearch = {
    enabled: true,
    lanes: {
      exploitRatio: 0.25,
      exitRegimeRatio: 0.35,
      globalAllParameterRatio: 0.25,
      robustnessRatio: 0.15,
    },
    resource: { maxConcurrentLabWorkers: 2, maxCandidateBatchSize: 6, maxRowsLoadedPerWorker: 120000 },
    objective: {
      minRoiPct: 25,
      minExpectancyDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeRatioVsIncumbent: 0.8,
      multipleTestingPenaltyBase: 0.25,
      multipleTestingPenaltyStep: 0.05,
    },
    offline: { mode: 'offline-strict' },
    exitRegimeEnabled: true,
    globalAllParameterEnabled: true,
    robustnessLadderEnabled: true,
    streamingMetricsEnabled: true,
    childWorkerIsolationEnabled: true,
  };

  const regimeExitState = buildRegimeExitStateForScout({
    config: seed.config,
    championState: seed.championState,
    historyEventsBefore: seed.historyEventsBefore,
    searchBatch: [
      ...seed.searchBatch,
      { variantId: 'exit-regime-v1', lane: 'exitRegime', family: 'exit-regime', config: { minPredSum: 2 } },
    ],
    offlineDataSummary: { ok: true, mode: 'offline-strict' },
    schedulerState: { stagnationLevel: 1, budgetDebt: { exitRegime: 2 } },
  });

  assert.equal(regimeExitState.enabled, true);
  assert.equal(regimeExitState.researchBudgetMode, 'regime-exit');
  assert.equal(regimeExitState.resourceBudget.maxConcurrentLabWorkers >= 1, true);
  assert.equal(typeof regimeExitState.resourceUsageSummary.searchBatchSize, 'number');
  assert.equal(regimeExitState.resourceUsageSummary.configuredWorkerModel, 'isolated');
  assert.equal(regimeExitState.resourceUsageSummary.workerModelSource, 'configured');
  assert.equal(regimeExitState.resourceUsageSummary.configuredStreamingMetricsEnabled, true);
  assert.equal(regimeExitState.resourceUsageSummary.streamingMetricsSource, 'configured');
  assert.equal('workerModel' in regimeExitState.resourceUsageSummary, false);
  assert.equal('streamingMetricsEnabled' in regimeExitState.resourceUsageSummary, false);
  assert.equal(typeof regimeExitState.checkpointState.historyEventCount, 'number');
  assert.equal(regimeExitState.objectiveBreakdown.minRoiPct, 25);
  assert.equal(regimeExitState.multipleTestingPenalty.base, 0.25);
  assert.equal(regimeExitState.holdoutVerdict, null);
  assert.equal(regimeExitState.offlineDataSummary.mode, 'offline-strict');
  assert.equal(typeof regimeExitState.shadowRegimeScoreboard.selectedLane, 'string');
  assert.equal(regimeExitState.shadowRegimeScoreboard.laneBudgetAllocation.exitRegime >= 0, true);
  assert.equal(regimeExitState.shadowRegimeScoreboard.generatorSummary.candidateCount, 1);
  assert.equal(regimeExitState.shadowRegimeScoreboard.generatorSummary.previewOnly, false);
  assert.equal(regimeExitState.shadowRegimeScoreboard.generatorSummary.countSource, 'generatedVariants');

  const orchestration = buildScoutOrchestrationState({
    ...seed,
    regimeExitState,
  });

  assert.equal(orchestration.manifest.researchBudgetMode, 'regime-exit');
  assert.equal(orchestration.manifest.resourceBudget.maxConcurrentLabWorkers >= 1, true);
  assert.equal(orchestration.manifest.objectiveBreakdown.minRoiPct, 25);
  assert.equal(orchestration.manifest.offlineDataSummary.mode, 'offline-strict');
  assert.equal(orchestration.manifest.shadowRegimeScoreboard !== undefined, true);

  const compactBlock = {
    researchBudgetMode: orchestration.manifest.researchBudgetMode,
    resourceBudget: orchestration.manifest.resourceBudget,
    resourceUsageSummary: orchestration.manifest.resourceUsageSummary,
    checkpointState: orchestration.manifest.checkpointState,
    objectiveBreakdown: orchestration.manifest.objectiveBreakdown,
    multipleTestingPenalty: orchestration.manifest.multipleTestingPenalty,
    holdoutVerdict: orchestration.manifest.holdoutVerdict,
    offlineDataSummary: orchestration.manifest.offlineDataSummary,
    shadowRegimeScoreboard: orchestration.manifest.shadowRegimeScoreboard,
  };
  const compactJson = JSON.stringify(compactBlock);

  assert.equal(compactJson.includes('"requiredLabs"'), false);
  assert.equal(compactJson.includes('"missingLabs"'), false);
  assert.equal(compactJson.includes('"searchBatch":['), false);
  assert.equal(compactJson.includes('"analysis"'), false);
  assert.equal(compactJson.includes('"rows"'), false);
  assert.equal(compactJson.includes('"labResults"'), false);
  assert.equal(compactJson.includes('"matrixCandidates"'), false);

  assert.equal('workerModel' in orchestration.manifest.resourceUsageSummary, false);
  assert.equal('streamingMetricsEnabled' in orchestration.manifest.resourceUsageSummary, false);
  assert.equal(orchestration.manifest.resourceUsageSummary.workerModelSource, 'configured');
  assert.equal(orchestration.manifest.resourceUsageSummary.streamingMetricsSource, 'configured');
});
