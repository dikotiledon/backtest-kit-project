import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLlmMatrixEvidence } from '../scripts/lib/pine-autoresearch-llm-evidence.mjs';

const METRICS = {
  roiPct: 12.5,
  profitFactor: 1.8,
  tradeCount: 42,
  maxDrawdownPct: 4.2,
};

test('validateLlmMatrixEvidence rejects changed-key fake promotion results', () => {
  const evidence = validateLlmMatrixEvidence({
    labResults: [{
      lab: { labId: 'primary' },
      decision: {
        recommendation: 'promote',
        comparisons: {
          scoreDelta: 3,
          roiDeltaPct: 8,
          profitFactorDelta: 0.5,
          drawdownDeltaPct: -1,
        },
      },
      challenger: { config: { minPredSum: 2.4 } },
    }],
    matrixDecision: { recommendation: 'promote' },
  });

  assert.deepEqual(evidence, {
    ok: false,
    reason: 'missing_backtest_evidence',
    invalidLabIds: ['primary'],
  });
});

test('validateLlmMatrixEvidence accepts promoted labs with incumbent and challenger metrics', () => {
  const evidence = validateLlmMatrixEvidence({
    labResults: [{
      lab: { labId: 'primary' },
      decision: { recommendation: 'promote' },
      incumbent: { ...METRICS },
      challenger: { ...METRICS, roiPct: 15.1 },
    }],
    matrixDecision: { recommendation: 'promote' },
  });

  assert.deepEqual(evidence, {
    ok: true,
    reason: 'backtest_evidence_present',
    invalidLabIds: [],
  });
});

test('validateLlmMatrixEvidence skips evidence checks when matrix is not promoting', () => {
  assert.deepEqual(validateLlmMatrixEvidence({
    labResults: [{ lab: { labId: 'primary' }, decision: { recommendation: 'promote' } }],
    matrixDecision: { recommendation: 'hold' },
  }), {
    ok: true,
    reason: 'not_promoting',
    invalidLabIds: [],
  });
});

test('validateLlmMatrixEvidence accepts finite zero metric values', () => {
  const zeroMetrics = {
    roiPct: 0,
    profitFactor: 0,
    tradeCount: 0,
    maxDrawdownPct: 0,
  };

  assert.deepEqual(validateLlmMatrixEvidence({
    labResults: [{
      lab: { labId: 'primary' },
      decision: { recommendation: 'promote' },
      incumbent: zeroMetrics,
      challenger: zeroMetrics,
    }],
    matrixDecision: { recommendation: 'promote' },
  }), {
    ok: true,
    reason: 'backtest_evidence_present',
    invalidLabIds: [],
  });
});

test('validateLlmMatrixEvidence rejects non-numeric metric impostors without throwing', () => {
  assert.deepEqual(validateLlmMatrixEvidence({
    labResults: [{
      lab: { labId: 'primary' },
      decision: { recommendation: 'promote' },
      incumbent: { roiPct: null, profitFactor: '', tradeCount: [], maxDrawdownPct: false },
      challenger: { roiPct: {}, profitFactor: '1.4', tradeCount: 12, maxDrawdownPct: 3 },
    }],
    matrixDecision: { recommendation: 'promote' },
  }), {
    ok: false,
    reason: 'missing_backtest_evidence',
    invalidLabIds: ['primary'],
  });

  assert.deepEqual(validateLlmMatrixEvidence(null), {
    ok: true,
    reason: 'not_promoting',
    invalidLabIds: [],
  });
});

test('validateLlmMatrixEvidence rejects matrix promote with no promoted lab evidence', () => {
  assert.deepEqual(validateLlmMatrixEvidence({
    labResults: [{ lab: { labId: 'primary' }, decision: { recommendation: 'hold' } }],
    matrixDecision: { recommendation: 'promote' },
  }), {
    ok: false,
    reason: 'missing_backtest_evidence',
    invalidLabIds: [],
  });
});
