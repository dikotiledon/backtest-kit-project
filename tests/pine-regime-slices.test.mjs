import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRegimeSlice, summarizeRegimeSliceMetrics, freezeRegimeThresholds } from '../scripts/lib/pine-regime-slices.mjs';

test('classifyRegimeSlice labels trend high-vol long-favored rows deterministically', () => {
  const thresholds = freezeRegimeThresholds({ atrPctMedian: 2, trendStrengthMedian: 25, longShortEdgeDelta: 0.1 });
  const label = classifyRegimeSlice({ atrPct: 3, trendStrength: 40, side: 'long', sideEdge: 0.2 }, thresholds);

  assert.deepEqual(label.sort(), ['high-vol', 'long-favored', 'trend'].sort());
});

test('classifyRegimeSlice uses conservative defaults when thresholds missing', () => {
  const label = classifyRegimeSlice({ atrPct: 3, trendStrength: 40, side: 'long', sideEdge: 999 }, {});

  assert.deepEqual(label.sort(), ['chop', 'low-vol'].sort());
});

test('classifyRegimeSlice marks chop and low-vol with explicit thresholds', () => {
  const thresholds = freezeRegimeThresholds({ atrPctMedian: 3, trendStrengthMedian: 30, longShortEdgeDelta: 0.2 });
  const label = classifyRegimeSlice({ atrPct: 1.5, trendStrength: 10, side: 'long', sideEdge: 0.5 }, thresholds);

  assert.deepEqual(label.sort(), ['chop', 'low-vol', 'long-favored'].sort());
});

test('classifyRegimeSlice marks short-favored when edge is below negative delta', () => {
  const thresholds = freezeRegimeThresholds({ atrPctMedian: 1, trendStrengthMedian: 10, longShortEdgeDelta: 0.1 });
  const label = classifyRegimeSlice({ atrPct: 1.5, trendStrength: 20, side: 'short', sideEdge: -0.2 }, thresholds);

  assert.deepEqual(label.sort(), ['high-vol', 'short-favored', 'trend'].sort());
});

test('classifyRegimeSlice parses numeric string sideEdge before fallback', () => {
  const thresholds = freezeRegimeThresholds({ atrPctMedian: 1, trendStrengthMedian: 10, longShortEdgeDelta: 0.1 });
  const label = classifyRegimeSlice(
    { atrPct: 2, trendStrength: 30, side: 'long', sideEdge: '0.2', longEdge: 0, shortEdge: 999 },
    thresholds
  );

  assert.deepEqual(label.sort(), ['high-vol', 'long-favored', 'trend'].sort());
});

test('summarizeRegimeSliceMetrics blocks low trade count slices', () => {
  const summary = summarizeRegimeSliceMetrics({ regimeSliceId: 'trend', trades: [{ pnl: 1 }, { pnl: -1 }], minTrades: 10 });

  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.reason, 'insufficientRegimeTrades');
});

test('summarizeRegimeSliceMetrics exposes percent winRate and rounded metrics', () => {
  const summary = summarizeRegimeSliceMetrics({
    regimeSliceId: 'trend-high-vol',
    trades: [{ pnl: 1.11119 }, { pnl: -0.11119 }, { pnl: 0.33339 }],
    minTrades: 3
  });

  assert.equal(summary.promotionEligible, true);
  assert.equal(summary.reason, null);
  assert.equal(summary.tradeCount, 3);
  assert.equal(summary.validPnlCount, 3);
  assert.equal(summary.invalidPnlCount, 0);
  assert.equal(summary.totalPnl, 1.3334);
  assert.equal(summary.avgPnl, 0.4445);
  assert.equal(summary.winRatePct, 66.6667);
});

test('summarizeRegimeSliceMetrics blocks zero-trade slices', () => {
  const summary = summarizeRegimeSliceMetrics({ regimeSliceId: 'none', trades: [], minTrades: 1 });

  assert.equal(summary.tradeCount, 0);
  assert.equal(summary.validPnlCount, 0);
  assert.equal(summary.invalidPnlCount, 0);
  assert.equal(summary.totalPnl, 0);
  assert.equal(summary.avgPnl, 0);
  assert.equal(summary.winRatePct, 0);
  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.reason, 'insufficientRegimeTrades');
});

test('summarizeRegimeSliceMetrics tracks invalid pnl and excludes it from win/loss math', () => {
  const summary = summarizeRegimeSliceMetrics({
    regimeSliceId: 'mixed-quality',
    trades: [{ pnl: 1 }, { pnl: 'bad' }, { pnl: -2 }, { pnl: null }],
    minTrades: 4
  });

  assert.equal(summary.tradeCount, 4);
  assert.equal(summary.validPnlCount, 2);
  assert.equal(summary.invalidPnlCount, 2);
  assert.equal(summary.totalPnl, -1);
  assert.equal(summary.avgPnl, -0.5);
  assert.equal(summary.winRatePct, 50);
  assert.equal(summary.promotionEligible, true);
  assert.equal(summary.reason, null);
});
