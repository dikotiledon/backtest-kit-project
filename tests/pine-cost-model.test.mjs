// tests/pine-cost-model.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTradeCost,
  computeSlippage,
  buildCostModel,
  applyCostToTrade,
} from '../scripts/lib/pine-cost-model.mjs';

describe('pine-cost-model', () => {
  describe('buildCostModel', () => {
    it('returns default model when no config provided', () => {
      const model = buildCostModel();
      assert.equal(model.commissionPct, 0.04);
      assert.equal(model.slippagePct, 0.02);
      assert.equal(model.spreadPct, 0.01);
      assert.equal(model.enabled, true);
    });

    it('accepts custom config', () => {
      const model = buildCostModel({ commissionPct: 0.1, slippagePct: 0.05, spreadPct: 0 });
      assert.equal(model.commissionPct, 0.1);
      assert.equal(model.slippagePct, 0.05);
      assert.equal(model.spreadPct, 0);
    });

    it('returns disabled model when enabled=false', () => {
      const model = buildCostModel({ enabled: false });
      assert.equal(model.enabled, false);
      assert.equal(model.commissionPct, 0);
      assert.equal(model.slippagePct, 0);
      assert.equal(model.spreadPct, 0);
    });
  });

  describe('computeTradeCost', () => {
    it('computes round-trip cost for normal exit', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      // Entry: commission(0.04) + slippage(0.02) + spread(0.01) = 0.07
      // Exit (takeProfit): commission(0.04) + slippage(0.02) = 0.06
      // Total: 0.07 + 0.06 = 0.13
      const cost = computeTradeCost(model, { exitReason: 'takeProfit' });
      assert.equal(cost, 0.13);
    });

    it('computes higher cost for stop-loss exit due to slippage multiplier', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01, slippageStopMultiplier: 2.5 });
      // Entry: commission(0.04) + slippage(0.02) + spread(0.01) = 0.07
      // Exit (stopLoss): commission(0.04) + slippage(0.02*2.5=0.05) = 0.09
      // Total: 0.07 + 0.09 = 0.16
      const cost = computeTradeCost(model, { exitReason: 'stopLoss' });
      assert.equal(cost, 0.16);
    });

    it('returns 0 for disabled model', () => {
      const model = buildCostModel({ enabled: false });
      assert.equal(computeTradeCost(model), 0);
    });
  });

  describe('computeSlippage', () => {
    it('applies asymmetric slippage for stop-loss exits', () => {
      const model = buildCostModel({ slippagePct: 0.02, slippageStopMultiplier: 2.5 });
      const slippage = computeSlippage(model, { exitReason: 'stopLoss' });
      assert.equal(slippage, 0.05); // 0.02 * 2.5
    });

    it('applies base slippage for normal exits', () => {
      const model = buildCostModel({ slippagePct: 0.02 });
      const slippage = computeSlippage(model, { exitReason: 'takeProfit' });
      assert.equal(slippage, 0.02);
    });
  });

  describe('applyCostToTrade', () => {
    it('reduces returnPct by round-trip cost', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      const trade = { returnPctExact: 1.5, exitReason: 'takeProfit', entryPrice: 100, exitPrice: 101.5 };
      const adjusted = applyCostToTrade(trade, model);
      // grossReturn = 1.5, cost = 0.13, net = 1.37
      assert.equal(adjusted.grossReturnPct, 1.5);
      assert.equal(adjusted.costPct, 0.13);
      assert.equal(adjusted.returnPctExact, 1.37);
    });

    it('turns marginal winners into losers', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      const trade = { returnPctExact: 0.05, exitReason: 'takeProfit', entryPrice: 100, exitPrice: 100.05 };
      const adjusted = applyCostToTrade(trade, model);
      // net = 0.05 - 0.13 = -0.08
      assert.ok(adjusted.returnPctExact < 0);
      assert.equal(adjusted.returnPctExact, -0.08);
    });

    it('returns trade unchanged for disabled model', () => {
      const model = buildCostModel({ enabled: false });
      const trade = { returnPctExact: 1.5, exitReason: 'takeProfit' };
      const adjusted = applyCostToTrade(trade, model);
      assert.equal(adjusted.returnPctExact, 1.5);
    });
  });
});
