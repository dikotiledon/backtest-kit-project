// tests/pine-metric-core-v2.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMetrics,
  calculateCompoundedMetrics,
} from '../scripts/lib/pine-metric-core.mjs';

describe('pine-metric-core compounded metrics', () => {
  describe('calculateCompoundedMetrics', () => {
    it('computes compounded ROI correctly', () => {
      // 3 trades: +10%, -5%, +8%
      // Compounded: 1.10 * 0.95 * 1.08 = 1.1286 => 12.86%
      const trades = [
        { returnPctExact: 10 },
        { returnPctExact: -5 },
        { returnPctExact: 8 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(metrics.compoundedRoiPct - 12.86) < 0.01);
    });

    it('handles 50% gain then 50% loss correctly as -25%', () => {
      const trades = [
        { returnPctExact: 50 },
        { returnPctExact: -50 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      // 1.5 * 0.5 = 0.75 => -25%
      assert.ok(Math.abs(metrics.compoundedRoiPct - (-25)) < 0.01);
    });

    it('additive ROI differs from compounded for same trades', () => {
      const trades = [
        { returnPctExact: 50 },
        { returnPctExact: -50 },
      ];
      const additive = calculateMetrics(trades);
      const compounded = calculateCompoundedMetrics(trades);
      // Additive: 50 + (-50) = 0%
      assert.ok(Math.abs(additive.roiPct) < 0.01);
      // Compounded: -25%
      assert.ok(Math.abs(compounded.compoundedRoiPct - (-25)) < 0.01);
    });

    it('computes equity-curve drawdown', () => {
      // Equity: 1.0 -> 1.10 -> 1.045 -> 1.1286
      // Peak at 1.10, trough at 1.045 => DD = (1.10 - 1.045)/1.10 = 5%
      const trades = [
        { returnPctExact: 10 },
        { returnPctExact: -5 },
        { returnPctExact: 8 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(metrics.maxDrawdownPct - 5) < 0.1);
    });

    it('computes equity-curve drawdown for deep loss', () => {
      // 1.0 -> 1.20 -> 0.84 => DD = (1.20 - 0.84)/1.20 = 30%
      const trades = [
        { returnPctExact: 20 },
        { returnPctExact: -30 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(metrics.maxDrawdownPct - 30) < 0.1);
    });

    it('returns zero for empty trades', () => {
      const metrics = calculateCompoundedMetrics([]);
      assert.equal(metrics.compoundedRoiPct, 0);
      assert.equal(metrics.maxDrawdownPct, 0);
    });

    it('includes CAGR when duration info available', () => {
      const trades = [
        { returnPctExact: 5, entryTime: '2026-01-01T00:00:00Z', exitTime: '2026-06-01T00:00:00Z' },
        { returnPctExact: 5, entryTime: '2026-06-02T00:00:00Z', exitTime: '2026-12-01T00:00:00Z' },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Number.isFinite(metrics.cagrPct));
      assert.ok(metrics.cagrPct > 0);
    });
  });
});
