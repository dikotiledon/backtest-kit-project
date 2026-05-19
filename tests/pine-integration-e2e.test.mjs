// tests/pine-integration-e2e.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrades } from '../scripts/lib/pine-optimizer.mjs';
import { calculateMetrics } from '../scripts/lib/pine-metric-core.mjs';
import { calculateCompoundedMetrics } from '../scripts/lib/pine-metric-core.mjs';
import { buildCostModel } from '../scripts/lib/pine-cost-model.mjs';
import { buildDataQualityReport } from '../scripts/lib/pine-data-quality.mjs';
import { isStatisticallySignificant } from '../scripts/lib/pine-statistical-significance.mjs';
import { buildWalkForwardWindows, evaluateWalkForwardFold, summarizeWalkForwardResults, isWalkForwardValid } from '../scripts/lib/pine-walk-forward.mjs';
import { computeCandidateUtility, computeMultipleTestingPenalty } from '../scripts/lib/pine-objective-function.mjs';
import { createFlagRegistry } from '../scripts/lib/pine-feature-flags.mjs';
import { migrateConfig } from '../scripts/lib/pine-config-version.mjs';

// Deterministic synthetic OHLC data generator
function generateSyntheticData(bars, { seed = 42 } = {}) {
  let s = seed | 0;
  function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rows = [];
  let price = 100;
  for (let i = 0; i < bars; i++) {
    // Add a gap so Open != previous Close (simulates overnight gaps)
    const gap = (rng() - 0.5) * 0.4;
    const open = price + gap;
    const move = (rng() - 0.5) * 2;
    const high = Math.max(open, open + Math.abs(move) + rng() * 0.5);
    const low = Math.min(open, open - Math.abs(move) - rng() * 0.5);
    const close = open + move;
    price = close;

    let signal = 0;
    let stopLoss;
    let takeProfit;
    if (i % 20 === 0 && i > 0) {
      signal = 1;
      stopLoss = close * 0.97;
      takeProfit = close * 1.03;
    }

    rows.push({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      Open: Number(open.toFixed(4)),
      High: Number(high.toFixed(4)),
      Low: Number(low.toFixed(4)),
      Close: Number(close.toFixed(4)),
      Signal: signal,
      StopLoss: stopLoss ? Number(stopLoss.toFixed(4)) : undefined,
      TakeProfit: takeProfit ? Number(takeProfit.toFixed(4)) : undefined,
    });
  }
  return rows;
}

describe('end-to-end integration', () => {
  const syntheticData = generateSyntheticData(2000, { seed: 123 });

  describe('data quality gate', () => {
    it('synthetic data passes quality check', () => {
      const report = buildDataQualityReport(syntheticData, { timeframeMinutes: 15 });
      assert.equal(report.valid, true);
      assert.equal(report.severity, 'ok');
    });
  });

  describe('legacy vs new simulator comparison', () => {
    it('both simulators produce trades from same data', () => {
      const legacyTrades = simulateTrades(syntheticData);
      const newTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      assert.ok(legacyTrades.length > 0, 'legacy should produce trades');
      assert.ok(newTrades.length > 0, 'new should produce trades');
    });

    it('new simulator entry prices differ from legacy', () => {
      const legacyTrades = simulateTrades(syntheticData);
      const newTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      let diffCount = 0;
      const minLen = Math.min(legacyTrades.length, newTrades.length);
      for (let i = 0; i < minLen; i++) {
        if (legacyTrades[i].entryPrice !== newTrades[i].entryPrice) diffCount++;
      }
      assert.ok(diffCount > 0, 'entry prices should differ between modes');
    });

    it('cost model reduces net returns', () => {
      const noCostTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      const costTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true, USE_COST_MODEL: true },
        costModel: { commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 },
      });
      const noCostRoi = calculateMetrics(noCostTrades).roiPct;
      const costRoi = calculateMetrics(costTrades).roiPct;
      assert.ok(costRoi < noCostRoi, `cost ROI (${costRoi}) should be < no-cost (${noCostRoi})`);
    });
  });

  describe('compounded vs additive metrics', () => {
    it('compounded metrics differ from additive', () => {
      const trades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      const additive = calculateMetrics(trades);
      const compounded = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(additive.roiPct - compounded.compoundedRoiPct) > 0.01,
        'compounded and additive ROI should differ');
    });
  });

  describe('walk-forward validation', () => {
    it('runs walk-forward on synthetic data', () => {
      const trades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      const windows = buildWalkForwardWindows({ totalBars: syntheticData.length, trainRatio: 0.7, folds: 3 });
      const foldResults = windows.map(w => {
        const trainTrades = trades.filter(t => t.entryIndex >= w.trainStart && t.entryIndex < w.trainEnd);
        const testTrades = trades.filter(t => t.entryIndex >= w.testStart && t.entryIndex < w.testEnd);
        return evaluateWalkForwardFold({ trainTrades, testTrades });
      });
      const summary = summarizeWalkForwardResults(foldResults);
      assert.equal(summary.foldCount, 3);
      assert.ok(Number.isFinite(summary.walkForwardEfficiency));
      assert.ok(Number.isFinite(summary.avgDegradationPct));
    });
  });

  describe('statistical significance', () => {
    it('detects significant difference between good and bad strategies', () => {
      const goodReturns = Array.from({ length: 50 }, (_, i) => 0.5 + (i % 5) * 0.1);
      const badReturns = Array.from({ length: 50 }, (_, i) => -0.2 + (i % 5) * 0.1);
      const result = isStatisticallySignificant(badReturns, goodReturns, { seed: 42 });
      assert.equal(result.significant, true);
    });
  });

  describe('full promotion pipeline', () => {
    it('config migration produces valid v2 config', () => {
      const v1 = {
        matrixId: 'test',
        searchPolicy: { annealing: { enabled: true, maxTemperature: 16, growthFactor: 1.8, baseTemperature: 0.4 }, tabuPolicy: { dropOnChampionChange: true, maxAgeCycles: 20, maxEntries: 40 } },
        autoPromotion: { enabled: true, cooldownHours: 12, maxPromotionsPerDay: 2 },
      };
      const v2 = migrateConfig(v1);
      assert.equal(v2.configVersion, 2);
      assert.equal(v2.searchPolicy.annealing.maxTemperature, 4);
      assert.ok(v2.featureFlags);
      assert.ok(v2.costModel);
      assert.ok(v2.walkForwardPolicy);
    });

    it('feature flags default to all-off', () => {
      const registry = createFlagRegistry();
      for (const [, value] of registry) {
        assert.equal(value, false);
      }
    });

    it('multiple testing penalty scales with candidates', () => {
      const p10 = computeMultipleTestingPenalty({ attemptedCandidates: 10 }, { base: 1.0, step: 0.3 });
      const p100 = computeMultipleTestingPenalty({ attemptedCandidates: 100 }, { base: 1.0, step: 0.3 });
      const p1000 = computeMultipleTestingPenalty({ attemptedCandidates: 1000 }, { base: 1.0, step: 0.3 });
      assert.ok(p10 < p100);
      assert.ok(p100 < p1000);
      assert.ok(p100 > 2);
    });

    it('computeCandidateUtility produces consistent ranking', () => {
      const weak = { roiPct: 10, winRatePct: 45, profitFactor: 1.1, maxDrawdownPct: 20, tradeCount: 100 };
      const strong = { roiPct: 40, winRatePct: 60, profitFactor: 2.0, maxDrawdownPct: 8, tradeCount: 150 };
      const { utility: weakUtil } = computeCandidateUtility(weak);
      const { utility: strongUtil } = computeCandidateUtility(strong);
      assert.ok(strongUtil > weakUtil, `strong (${strongUtil}) should beat weak (${weakUtil})`);
    });
  });
});
