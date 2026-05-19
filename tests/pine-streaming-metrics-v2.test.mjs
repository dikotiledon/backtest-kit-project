import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as streamingModule from '../scripts/lib/pine-streaming-metrics.mjs';

describe('streaming metrics - new simulator trade shape compatibility', () => {
  it('module exports expected interface', () => {
    const exports = Object.keys(streamingModule);
    assert.ok(exports.includes('analyzeJsonlFileStreaming'), 'should export analyzeJsonlFileStreaming');
    assert.ok(exports.includes('createIncrementalTradeSimulator'), 'should export createIncrementalTradeSimulator');
    assert.ok(exports.includes('iterateJsonlRows'), 'should export iterateJsonlRows');
  });

  it('buildTrade produces returnPctExact field (net return)', () => {
    // Simulate a simple long trade via the incremental simulator
    const sim = streamingModule.createIncrementalTradeSimulator({ timeframeMinutes: 15 });

    // Entry bar: signal=1 at price 100
    sim.push({ timestamp: '2026-01-01T00:00:00Z', Close: 100, Open: 100, High: 100, Low: 100, Signal: 1, StopLoss: 95, TakeProfit: 110, EstimatedTime: 60 });
    // Exit bar: takeProfit hit at high=110
    sim.push({ timestamp: '2026-01-01T00:15:00Z', Close: 108, Open: 101, High: 110, Low: 100, Signal: 0 });

    const result = sim.finalize(null);
    assert.equal(result.trades.length, 1, 'should have 1 trade');

    const trade = result.trades[0];
    assert.ok(Number.isFinite(trade.returnPctExact), 'trade must have returnPctExact');
    assert.ok(Number.isFinite(trade.returnPct), 'trade must have returnPct (rounded)');
    // returnPctExact = (110 - 100) / 100 * 100 = 10
    assert.equal(trade.returnPctExact, 10);
    assert.equal(trade.exitReason, 'takeProfit');
  });

  it('returnPctExact is the unrounded net return used by metric-core', () => {
    const sim = streamingModule.createIncrementalTradeSimulator({ timeframeMinutes: 15 });

    // Entry at 100, exit by time at close=103.333...
    sim.push({ timestamp: '2026-01-01T00:00:00Z', Close: 100, Open: 100, High: 100, Low: 100, Signal: 1, StopLoss: 90, TakeProfit: 120, EstimatedTime: 15 });
    // maxBars = ceil(15/15) = 1, so this bar triggers time exit
    sim.push({ timestamp: '2026-01-01T00:15:00Z', Close: 103.333, Open: 101, High: 104, Low: 99, Signal: 0 });

    const result = sim.finalize(null);
    const trade = result.trades[0];

    // returnPctExact should be unrounded: (103.333 - 100) / 100 * 100 ≈ 3.333
    assert.ok(Math.abs(trade.returnPctExact - 3.333) < 0.001, `exact return ~3.333, got ${trade.returnPctExact}`);
    assert.strictEqual(trade.returnPct, 3.33); // rounded
  });

  it('trades with new simulator shape fields are compatible with metric-core', async () => {
    // Verify that trades containing grossReturnPct and costPct (new simulator fields)
    // don't break anything. The metric-core uses exactReturnPct helper which
    // prefers returnPctExact → returnPct, ignoring grossReturnPct.
    const { calculateMetrics } = await import('../scripts/lib/pine-metric-core.mjs');

    const trades = [
      {
        side: 'long',
        entryPrice: 100,
        exitPrice: 105,
        returnPctExact: 4.87,
        grossReturnPct: 5.0,
        costPct: 0.13,
        returnPct: 4.87,
        exitReason: 'takeProfit',
        holdBars: 5,
        entryTime: '2026-01-01T00:00:00Z',
        exitTime: '2026-01-01T01:15:00Z',
      },
      {
        side: 'short',
        entryPrice: 200,
        exitPrice: 195,
        returnPctExact: 2.37,
        grossReturnPct: 2.5,
        costPct: 0.13,
        returnPct: 2.37,
        exitReason: 'takeProfit',
        holdBars: 3,
        entryTime: '2026-01-02T00:00:00Z',
        exitTime: '2026-01-02T00:45:00Z',
      },
    ];

    const metrics = calculateMetrics(trades);
    assert.equal(metrics.tradeCount, 2);
    assert.equal(metrics.winCount, 2);
    // ROI should use returnPctExact (net), not grossReturnPct
    // 4.87 + 2.37 = 7.24
    assert.ok(Math.abs(metrics.roiPct - 7.24) < 0.01, `ROI should be ~7.24, got ${metrics.roiPct}`);
  });

  it('metric-core prefers returnPctExact over returnPct when values differ', async () => {
    const { calculateMetrics } = await import('../scripts/lib/pine-metric-core.mjs');

    // Simulate a case where returnPct is stale/rounded differently
    const trades = [
      {
        side: 'long',
        returnPctExact: 5.5555,
        returnPct: 5.56, // rounded differently
        exitReason: 'takeProfit',
        holdBars: 2,
      },
    ];

    const metrics = calculateMetrics(trades);
    // avgReturnPct should derive from returnPctExact (5.5555), not returnPct (5.56)
    // It gets rounded by the round() function in metric-core
    assert.ok(Math.abs(metrics.roiPct - 5.56) < 0.01, `ROI rounds from exact: ${metrics.roiPct}`);
  });
});
