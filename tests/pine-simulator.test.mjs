import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrades } from '../scripts/lib/pine-simulator.mjs';
import { buildCostModel } from '../scripts/lib/pine-cost-model.mjs';

describe('pine-simulator', () => {
  describe('entry timing', () => {
    it('enters at next bar open, not signal bar close', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 100, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 104, High: 106, Low: 103, Close: 105, Signal: -1 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades.length, 1);
      assert.equal(trades[0].entryPrice, 101.5);
      assert.equal(trades[0].side, 'long');
    });

    it('falls back to Close when next bar has no Open', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', High: 105, Low: 100, Close: 104, Signal: 0 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades.length, 1);
      assert.equal(trades[0].entryPrice, 104);
    });

    it('legacy mode enters at signal bar close', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 100, Close: 104, Signal: -1 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'signal-bar-close' });
      assert.equal(trades[0].entryPrice, 101);
    });
  });

  describe('exit mechanics', () => {
    it('exits at SL price when Low breaches stop', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 97, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 101, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 104, High: 104.5, Low: 96, Close: 98, Signal: 0 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades[0].exitReason, 'stopLoss');
      assert.equal(trades[0].exitPrice, 97);
    });

    it('uses open price when bar gaps through stop', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 97, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 101, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 95, High: 96, Low: 93, Close: 94, Signal: 0 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades[0].exitReason, 'stopLoss');
      assert.equal(trades[0].exitPrice, 95);
    });
  });

  describe('cost integration', () => {
    it('applies cost model to each trade', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101, High: 105, Low: 100, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 104, High: 111, Low: 103, Close: 110, Signal: 0 },
      ];
      const costModel = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open', costModel });
      assert.equal(trades.length, 1);
      assert.ok(trades[0].costPct > 0);
      assert.ok(trades[0].returnPctExact < trades[0].grossReturnPct);
    });
  });
});
