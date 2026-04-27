import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRegimeFromFeatures,
  detectThresholdAsymmetry,
  summarizeRegimeSlices,
  summarizeSideMetrics,
} from '../scripts/lib/pine-regime-analysis.mjs';

function sampleTrades() {
  return [
    { side: 'long', pnl: 4, mfePct: 7, maePct: 2, entryIndex: 0 },
    { side: 'long', pnl: -2, mfePct: 3, maePct: 4, entryIndex: 1 },
    { side: 'long', pnl: 3, mfePct: 5, maePct: 1, entryIndex: 2 },
    { side: 'short', pnl: 5, mfePct: 6, maePct: 2, entryIndex: 1 },
    { side: 'short', pnl: -1, mfePct: 2, maePct: 3, entryIndex: 3 },
  ];
}

function sampleFeatureRows() {
  return [
    { featureSqueezeState: 1, featureChannelCompressionScore: 0.9, featureTrendX: 0, featureLongContextCaution: 0, featureShortContextCaution: 0 },
    { featureTrendX: 1, featureTrendXLongPass: 1, featureTrendXShortPass: 1, featureLongContextCaution: 0, featureShortContextCaution: 0 },
    { featureSqueezeReleaseBull: 1, featureSqueezeReleaseBear: 0, featureSqueezeLongBoost: 1.2, featureSqueezeShortBoost: 0.4 },
    { featureLongContextCaution: 1, featureShortContextCaution: 1, featureTrendX: 0, featureChannelCompressionScore: 0.1 },
  ];
}

test('summarizeSideMetrics computes expectancy inputs by side', () => {
  const summary = summarizeSideMetrics({ trades: sampleTrades() });

  assert.equal(summary.long.tradeCount, 3);
  assert.equal(summary.short.tradeCount, 2);
  assert.ok(summary.long.avgWin > 0);
  assert.ok(summary.short.avgLoss > 0);
  assert.ok(summary.long.profitFactor > 0);
  assert.ok(summary.short.mfePct > 0);
  assert.ok(summary.long.maePct > 0);
});

test('classifyRegimeFromFeatures maps exported features into the four regimes', () => {
  assert.equal(classifyRegimeFromFeatures(sampleFeatureRows()[0]).regime, 'compression');
  assert.equal(classifyRegimeFromFeatures(sampleFeatureRows()[1]).regime, 'trend');
  assert.equal(classifyRegimeFromFeatures(sampleFeatureRows()[2]).regime, 'expansion');
  assert.equal(classifyRegimeFromFeatures(sampleFeatureRows()[3]).regime, 'chop');
});

test('summarizeRegimeSlices aggregates trade metrics by inferred regime', () => {
  const summary = summarizeRegimeSlices({ trades: sampleTrades(), featureRows: sampleFeatureRows() });

  assert.equal(summary.compression.tradeCount, 1);
  assert.equal(summary.trend.tradeCount, 2);
  assert.equal(summary.expansion.tradeCount, 1);
  assert.equal(summary.chop.tradeCount, 1);
  assert.ok(summary.trend.winRate > 0);
  assert.ok(summary.compression.avgWin > 0);
});

test('detectThresholdAsymmetry flags divergent side-optimal surfaces', () => {
  const result = detectThresholdAsymmetry({
    championMetrics: { thresholdSurface: { long: 1.0, short: 1.1 } },
    candidateMetrics: { thresholdSurface: { long: 1.8, short: 0.2 } },
  });

  assert.equal(result.isAsymmetric, true);
  assert.equal(result.flags.sideSurfaceDiverged, true);
  assert.match(result.recommendation, /split/i);
});
