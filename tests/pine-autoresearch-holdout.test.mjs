import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHoldoutGate,
  decideAutoresearchOutcome,
} from '../scripts/lib/pine-autoresearch.mjs';
import {
  buildScoutOrchestrationState,
  shouldQueuePromotionManifest,
} from '../scripts/pine-autoresearch.mjs';

function makeResult({ configId, score = 100, tradeCount = 200, roiPct = 50, profitFactor = 2, maxDrawdownPct = 5, config = null } = {}) {
  return {
    configId,
    score,
    config: config ?? { configId },
    metrics: {
      tradeCount,
      roiPct,
      profitFactor,
      maxDrawdownPct,
    },
  };
}

const passingThresholds = {
  minScoreDelta: 0.25,
  minRoiDeltaPct: 0,
  minProfitFactorDelta: 0,
  maxDrawdownDeltaPct: 0.75,
  minTradeCount: 100,
  minTradeRatioVsIncumbent: 0.75,
  significance: { minRelativeScoreDelta: 0, minTradeCount: 100 },
};

function promoteCandidateInput(overrides = {}) {
  return {
    incumbent: makeResult({
      configId: 'champion',
      score: 100,
      roiPct: 40,
      profitFactor: 1.4,
      tradeCount: 200,
      maxDrawdownPct: 5,
      config: { minPredSum: 2 },
    }),
    challenger: makeResult({
      configId: 'challenger',
      score: 110,
      roiPct: 55,
      profitFactor: 1.8,
      tradeCount: 220,
      maxDrawdownPct: 5.1,
      config: { minPredSum: 1.8 },
    }),
    thresholds: passingThresholds,
    expectancyPolicy: { enabled: false },
    blindHoldoutLabs: [{ labId: 'blind-holdout-a' }],
    ...overrides,
  };
}

test('classifyHoldoutGate marks required blind holdout as pending without a verdict', () => {
  assert.deepEqual(classifyHoldoutGate({ blindHoldoutLabs: [{ labId: 'holdout-a' }] }), {
    required: true,
    status: 'pending',
    passed: false,
    reason: 'blind_holdout_pending',
  });
});

test('decideAutoresearchOutcome can promote matrix while blind holdout is pending in defer mode', () => {
  const decision = decideAutoresearchOutcome(promoteCandidateInput());

  assert.equal(decision.recommendation, 'promote');
  assert.equal(decision.holdoutGate.status, 'pending');
  assert.equal(decision.gates.holdoutVerdict, undefined);
  assert.equal(decision.failedGates.includes('holdoutVerdict'), false);
});

test('decideAutoresearchOutcome require mode blocks pending blind holdout', () => {
  const decision = decideAutoresearchOutcome(promoteCandidateInput({ holdoutMode: 'require' }));

  assert.equal(decision.recommendation, 'hold');
  assert.equal(decision.holdoutGate.status, 'pending');
  assert.equal(decision.gates.holdoutVerdict, false);
  assert.deepEqual(decision.failedGates, ['holdoutVerdict']);
});

test('decideAutoresearchOutcome blocks failed blind holdout', () => {
  const decision = decideAutoresearchOutcome(promoteCandidateInput({
    holdoutVerdict: { passed: false, reason: 'blind_holdout_regression' },
  }));

  assert.equal(decision.recommendation, 'hold');
  assert.equal(decision.holdoutGate.status, 'failed');
  assert.equal(decision.holdoutGate.reason, 'blind_holdout_regression');
  assert.equal(decision.gates.holdoutVerdict, false);
  assert.deepEqual(decision.failedGates, ['holdoutVerdict']);
});

test('shouldQueuePromotionManifest rejects holdout-pending manifest', () => {
  const manifest = {
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'challenger', config: { minPredSum: 1.8 } },
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
    holdoutGate: { required: true, status: 'pending', passed: false, reason: 'blind_holdout_pending' },
    promotionReady: false,
  };

  assert.equal(shouldQueuePromotionManifest(manifest), false);
});

test('shouldQueuePromotionManifest queues holdout-passed ready manifest when matrix passed and candidate changed', () => {
  const manifest = {
    matrixDecision: { recommendation: 'promote' },
    challenger: { configId: 'challenger', config: { minPredSum: 1.8 } },
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
    holdoutGate: { required: true, status: 'passed', passed: true, reason: 'blind_holdout_passed' },
    promotionReady: true,
  };

  assert.equal(shouldQueuePromotionManifest(manifest), true);
});

test('buildScoutOrchestrationState persists pending holdout gate and disables promotion readiness', () => {
  const championState = makeResult({
    configId: 'champion',
    score: 100,
    roiPct: 40,
    profitFactor: 1.4,
    tradeCount: 200,
    maxDrawdownPct: 5,
    config: { minPredSum: 2 },
  });
  const challenger = makeResult({
    configId: 'challenger',
    score: 110,
    roiPct: 55,
    profitFactor: 1.8,
    tradeCount: 220,
    maxDrawdownPct: 5,
    config: { minPredSum: 1.8 },
  });

  const { manifest } = buildScoutOrchestrationState({
    config: {
      matrixId: 'holdout-readiness-test',
      selectedProfile: 'test',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 1, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requireCandidateChange: true, requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0 },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      blindHoldoutLabs: [{ labId: 'blind-holdout-a' }],
      pinnedData: { enabled: false },
    },
    runId: 'holdout-readiness-run',
    championState,
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [challenger] },
    matrixCandidates: [{
      challenger,
      labResults: [{
        lab: { labId: 'primary' },
        incumbent: championState,
        challenger,
        decision: decideAutoresearchOutcome(promoteCandidateInput({ incumbent: championState, challenger })),
      }],
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger: matrix guards passed.', gates: { candidateChanged: true }, failedGates: [] },
      robustness: {},
    }],
    trackState: {
      candidateFingerprint: 'candidate-fp',
      championFingerprint: 'champion-fp',
    },
  });

  assert.equal(manifest.matrixDecision.recommendation, 'promote');
  assert.equal(manifest.holdoutGate.status, 'pending');
  assert.equal(manifest.promotionEligible, true);
  assert.equal(manifest.promotionReady, false);
});
