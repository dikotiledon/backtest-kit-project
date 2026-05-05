import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRegimeSlice, summarizeRegimeSliceMetrics, freezeRegimeThresholds } from '../scripts/lib/pine-regime-slices.mjs';

test('classifyRegimeSlice labels trend high-vol long-favored rows deterministically', () => {
  const thresholds = freezeRegimeThresholds({ atrPctMedian: 2, trendStrengthMedian: 25, longShortEdgeDelta: 0.1 });
  const label = classifyRegimeSlice({ atrPct: 3, trendStrength: 40, side: 'long', sideEdge: 0.2 }, thresholds);

  assert.deepEqual(label.sort(), ['high-vol', 'long-favored', 'trend'].sort());
});

test('summarizeRegimeSliceMetrics blocks low trade count slices', () => {
  const summary = summarizeRegimeSliceMetrics({ regimeSliceId: 'trend', trades: [{ pnl: 1 }, { pnl: -1 }], minTrades: 10 });

  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.reason, 'insufficientRegimeTrades');
});
