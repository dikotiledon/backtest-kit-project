import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSignificanceGate } from '../scripts/lib/pine-significance-gate.mjs';

test('decideSignificanceGate rejects small score delta below relative effect floor', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { score: 101.5, metrics: { tradeCount: 220 } },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.deepEqual(result, {
    passed: false,
    reason: 'score_delta_below_floor',
    relativeScoreDelta: 0.015,
    minRelativeScoreDelta: 0.02,
  });
});

test('decideSignificanceGate accepts challenger at minimum relative delta', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { score: 102, metrics: { tradeCount: 220 } },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.deepEqual(result, {
    passed: true,
    reason: 'significant',
    relativeScoreDelta: 0.02,
    minRelativeScoreDelta: 0.02,
  });
});

test('decideSignificanceGate rejects insufficient challenger trade count', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { score: 110, metrics: { tradeCount: 149 } },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.deepEqual(result, {
    passed: false,
    reason: 'insufficient_sample',
    relativeScoreDelta: null,
    challengerTradeCount: 149,
    minTradeCount: 150,
  });
});

test('decideSignificanceGate rejects missing score inputs', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { metrics: { tradeCount: 220 } },
  });

  assert.deepEqual(result, {
    passed: false,
    reason: 'missing_score',
    relativeScoreDelta: null,
  });
});

test('decideSignificanceGate requires larger delta when challenger trade count drifts below parity', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { score: 103, metrics: { tradeCount: 180 } },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.deepEqual(result, {
    passed: false,
    reason: 'trade_count_drift_requires_larger_delta',
    relativeScoreDelta: 0.03,
    minRelativeScoreDelta: 0.04,
    tradeRatio: 0.818,
  });
});
