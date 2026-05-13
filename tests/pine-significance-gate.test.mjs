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

test('decideSignificanceGate handles null input as missing scores', () => {
  assert.doesNotThrow(() => decideSignificanceGate(null));
  assert.deepEqual(decideSignificanceGate(null), {
    passed: false,
    reason: 'missing_score',
    relativeScoreDelta: null,
  });
});

test('decideSignificanceGate treats null score as missing', () => {
  for (const challenger of [
    { score: null, metrics: { tradeCount: 220 } },
    { score: null, metrics: { score: 110, tradeCount: 220 } },
    { metrics: { score: null, tradeCount: 220 } },
  ]) {
    assert.deepEqual(
      decideSignificanceGate({
        incumbent: { score: 100, metrics: { tradeCount: 220 } },
        challenger,
      }),
      {
        passed: false,
        reason: 'missing_score',
        relativeScoreDelta: null,
      },
    );
  }
});

test('decideSignificanceGate defaults null relative score delta policy', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { score: 101, metrics: { tradeCount: 220 } },
    policy: { minRelativeScoreDelta: null, minTradeCount: 150 },
  });

  assert.deepEqual(result, {
    passed: false,
    reason: 'score_delta_below_floor',
    relativeScoreDelta: 0.01,
    minRelativeScoreDelta: 0.02,
  });
});

test('decideSignificanceGate defaults null minimum trade count policy', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 220 } },
    challenger: { score: 110, metrics: { tradeCount: 99 } },
    policy: { minTradeCount: null },
  });

  assert.deepEqual(result, {
    passed: false,
    reason: 'insufficient_sample',
    relativeScoreDelta: null,
    challengerTradeCount: 99,
    minTradeCount: 100,
  });
});

test('decideSignificanceGate treats non-numeric score values as missing', () => {
  for (const score of ['', [], {}, true]) {
    assert.deepEqual(
      decideSignificanceGate({
        incumbent: { score: 100, metrics: { tradeCount: 220 } },
        challenger: { score, metrics: { tradeCount: 220 } },
      }),
      {
        passed: false,
        reason: 'missing_score',
        relativeScoreDelta: null,
      },
    );
  }
});

test('decideSignificanceGate defaults minTradeCount to 100 (not 150)', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 120 } },
    challenger: { score: 105, metrics: { tradeCount: 120 } },
    policy: { minRelativeScoreDelta: 0.01 },
  });
  // With 120 trades and old default 150, this would fail with 'insufficient_sample'
  // With new default 100, it should pass (120 >= 100)
  assert.notEqual(result.reason, 'insufficient_sample');
  assert.equal(result.passed, true);
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
