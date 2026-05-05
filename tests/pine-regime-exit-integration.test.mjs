import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoutOrchestrationState } from '../scripts/pine-autoresearch.mjs';

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
