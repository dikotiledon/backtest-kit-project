// tests/pine-walk-forward.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWalkForwardWindows,
  evaluateWalkForwardFold,
  summarizeWalkForwardResults,
  isWalkForwardValid,
  buildRegimeAwareWindows,
} from '../scripts/lib/pine-walk-forward.mjs';

describe('pine-walk-forward', () => {
  describe('buildWalkForwardWindows', () => {
    it('splits data into train/test folds (rolling)', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 5, stepMode: 'rolling',
      });
      assert.equal(windows.length, 5);
      for (const w of windows) {
        assert.ok(w.trainStart < w.trainEnd);
        assert.ok(w.testStart < w.testEnd);
        assert.equal(w.testStart, w.trainEnd);
      }
    });

    it('rolling windows advance forward in time', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 4, stepMode: 'rolling',
      });
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].trainStart > windows[i - 1].trainStart);
      }
    });

    it('anchored windows keep same start, extend train', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 4, stepMode: 'anchored',
      });
      for (const w of windows) {
        assert.equal(w.trainStart, 0);
      }
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].trainEnd > windows[i - 1].trainEnd);
      }
    });

    it('test windows never overlap', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 5, stepMode: 'rolling',
      });
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].testStart >= windows[i - 1].testEnd);
      }
    });

    it('returns empty for zero bars', () => {
      const windows = buildWalkForwardWindows({ totalBars: 0, folds: 5 });
      assert.equal(windows.length, 0);
    });
  });

  describe('buildRegimeAwareWindows', () => {
    it('creates windows aligned to regime boundaries', () => {
      const regimeSlices = [
        { startBar: 0, endBar: 3000, regime: 'trending' },
        { startBar: 3000, endBar: 7000, regime: 'ranging' },
        { startBar: 7000, endBar: 10000, regime: 'trending' },
      ];
      const windows = buildRegimeAwareWindows({
        totalBars: 10000, regimeSlices, trainRatio: 0.7, folds: 3,
      });
      assert.ok(windows.length >= 1);
      for (const w of windows) {
        assert.ok(w.trainStart < w.trainEnd);
        assert.ok(w.testStart < w.testEnd);
        assert.ok(Array.isArray(w.regimes));
      }
    });

    it('falls back to standard rolling when no regime slices', () => {
      const windows = buildRegimeAwareWindows({
        totalBars: 10000, regimeSlices: [], trainRatio: 0.7, folds: 5,
      });
      assert.equal(windows.length, 5);
    });
  });

  describe('evaluateWalkForwardFold', () => {
    it('returns metrics for train and test periods', () => {
      const fold = evaluateWalkForwardFold({
        trainTrades: [{ returnPctExact: 1.5 }, { returnPctExact: -0.5 }, { returnPctExact: 2.0 }],
        testTrades: [{ returnPctExact: 0.8 }, { returnPctExact: -1.2 }, { returnPctExact: 0.5 }],
      });
      assert.ok(Number.isFinite(fold.trainRoiPct));
      assert.ok(Number.isFinite(fold.testRoiPct));
      assert.ok(Number.isFinite(fold.degradationPct));
      assert.equal(fold.trainTradeCount, 3);
      assert.equal(fold.testTradeCount, 3);
    });

    it('degradation is negative when test worse than train', () => {
      const fold = evaluateWalkForwardFold({
        trainTrades: [{ returnPctExact: 5 }, { returnPctExact: 3 }],
        testTrades: [{ returnPctExact: -1 }, { returnPctExact: -2 }],
      });
      assert.ok(fold.degradationPct < 0);
    });
  });

  describe('summarizeWalkForwardResults', () => {
    it('computes average degradation and efficiency', () => {
      const folds = [
        { trainRoiPct: 10, testRoiPct: 8, degradationPct: -20 },
        { trainRoiPct: 12, testRoiPct: 7, degradationPct: -41.67 },
        { trainRoiPct: 8, testRoiPct: 6, degradationPct: -25 },
      ];
      const summary = summarizeWalkForwardResults(folds);
      assert.equal(summary.foldCount, 3);
      assert.ok(summary.avgDegradationPct < 0);
      assert.ok(summary.walkForwardEfficiency > 0 && summary.walkForwardEfficiency < 1);
    });
  });

  describe('isWalkForwardValid', () => {
    it('passes when efficiency above threshold', () => {
      const summary = { walkForwardEfficiency: 0.7, avgDegradationPct: -30, foldCount: 5 };
      const result = isWalkForwardValid(summary, { minEfficiency: 0.5, maxDegradationPct: -50 });
      assert.equal(result.valid, true);
    });

    it('fails when efficiency below threshold', () => {
      const summary = { walkForwardEfficiency: 0.3, avgDegradationPct: -70, foldCount: 5 };
      const result = isWalkForwardValid(summary, { minEfficiency: 0.5, maxDegradationPct: -50 });
      assert.equal(result.valid, false);
      assert.ok(result.failedGates.includes('efficiency'));
    });

    it('fails when degradation too severe', () => {
      const summary = { walkForwardEfficiency: 0.6, avgDegradationPct: -60, foldCount: 5 };
      const result = isWalkForwardValid(summary, { minEfficiency: 0.5, maxDegradationPct: -50 });
      assert.equal(result.valid, false);
      assert.ok(result.failedGates.includes('degradation'));
    });
  });
});
