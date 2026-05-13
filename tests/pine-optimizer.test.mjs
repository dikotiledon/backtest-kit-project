import test from 'node:test';
import assert from 'node:assert/strict';

const loadPineOptimizer = () => import('../scripts/lib/pine-optimizer.mjs');

test('calculateMetrics counts low-price rounded losses from exact return values', async () => {
  const { calculateMetrics } = await loadPineOptimizer();
  const trades = [
    { pnl: 0, returnPct: -0.2, rawPnlExact: -0.004, returnPctExact: -0.2 },
    { pnl: 0, returnPct: -0.15, rawPnlExact: -0.003, returnPctExact: -0.15 },
    { pnl: 0.03, returnPct: 1.5, rawPnlExact: 0.03, returnPctExact: 1.5 },
  ];

  const metrics = calculateMetrics(trades);

  assert.equal(metrics.winCount, 1);
  assert.equal(metrics.lossCount, 2);
  assert.equal(metrics.flatCount, 0);
  assert.equal(metrics.winRatePct, 33.33);
  assert.equal(metrics.roiPct, 1.15);
  assert.equal(metrics.avgWin, 1.5);
  assert.equal(metrics.avgLoss, 0.18);
  assert.equal(metrics.profitFactor, 4.29);
  assert.equal(metrics.maxDrawdownPct, 0.35);
  assert.equal(metrics.totalProfit, 0.03);
  assert.equal(metrics.totalLossAbs, 0.01);
  assert.equal(metrics.totalProfitPct, 1.5);
  assert.equal(metrics.totalLossAbsPct, 0.35);
  assert.equal(metrics.metricBasis.profitFactor, 'returnPctExact');
});

test('calculateMetrics is invariant to asset price scale when return stream matches', async () => {
  const { calculateMetrics } = await loadPineOptimizer();
  const xrpTrades = [
    { pnl: 0, returnPct: 1.2, rawPnlExact: 0.0048, returnPctExact: 1.2 },
    { pnl: 0, returnPct: -0.3, rawPnlExact: -0.0012, returnPctExact: -0.3 },
    { pnl: 0.01, returnPct: 0.5, rawPnlExact: 0.002, returnPctExact: 0.5 },
  ];
  const btcTrades = [
    { pnl: 120, returnPct: 1.2, rawPnlExact: 120, returnPctExact: 1.2 },
    { pnl: -30, returnPct: -0.3, rawPnlExact: -30, returnPctExact: -0.3 },
    { pnl: 50, returnPct: 0.5, rawPnlExact: 50, returnPctExact: 0.5 },
  ];

  const xrp = calculateMetrics(xrpTrades);
  const btc = calculateMetrics(btcTrades);

  assert.deepEqual(
    {
      winCount: xrp.winCount,
      lossCount: xrp.lossCount,
      flatCount: xrp.flatCount,
      winRatePct: xrp.winRatePct,
      roiPct: xrp.roiPct,
      avgWin: xrp.avgWin,
      avgLoss: xrp.avgLoss,
      profitFactor: xrp.profitFactor,
      maxDrawdownPct: xrp.maxDrawdownPct,
    },
    {
      winCount: btc.winCount,
      lossCount: btc.lossCount,
      flatCount: btc.flatCount,
      winRatePct: btc.winRatePct,
      roiPct: btc.roiPct,
      avgWin: btc.avgWin,
      avgLoss: btc.avgLoss,
      profitFactor: btc.profitFactor,
      maxDrawdownPct: btc.maxDrawdownPct,
    },
  );
});

test('scoreMetricsBreakdown exposes corrected PF contribution for the XRP regression case', async () => {
  const pineOptimizer = await loadPineOptimizer();

  assert.equal(typeof pineOptimizer.scoreMetricsBreakdown, 'function', 'scoreMetricsBreakdown export missing');

  const breakdown = pineOptimizer.scoreMetricsBreakdown({
    tradeCount: 249,
    roiPct: 82.91,
    winRatePct: 35.34,
    profitFactor: 5.03,
    maxDrawdownPct: 1.43,
  }, { minTrades: 150 });

  assert.deepEqual(breakdown, {
    roi: 82.91,
    winRate: 28.27,
    profitFactor: 40.24,
    drawdown: -0.86,
    tradePenalty: 0,
    total: 150.56,
  });
});

test('simulateTrades does not use same-bar SL/TP update for exit decision', async () => {
  const { simulateTrades } = await loadPineOptimizer();
  const rows = [
    { timestamp: '2025-01-01T00:00Z', Close: 100, High: 105, Low: 95, Signal: 1, StopLoss: 90, TakeProfit: 120, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:15Z', Close: 98, High: 100, Low: 96, Signal: 0, StopLoss: 85, TakeProfit: 130, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:30Z', Close: 84, High: 99, Low: 83, Signal: 0, StopLoss: 85, TakeProfit: 130, Feature_SimPos: 1 },
  ];
  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'stopLoss');
  assert.equal(trades[0].exitIndex, 2);
});

test('simulateTrades uses intra-bar High/Low for SL/TP touch detection', async () => {
  const { simulateTrades } = await loadPineOptimizer();
  const rows = [
    { timestamp: '2025-01-01T00:00Z', Close: 100, High: 100, Low: 100, Signal: 1, StopLoss: 95, TakeProfit: 110, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:15Z', Close: 105, High: 111, Low: 104, Signal: 0, Feature_SimPos: 1 },
  ];
  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'takeProfit');
  assert.equal(trades[0].exitPrice, 110);
});

test('simulateTrades gap-through fills at open when open is past SL', async () => {
  const { simulateTrades } = await loadPineOptimizer();
  const rows = [
    { timestamp: '2025-01-01T00:00Z', Close: 100, High: 100, Low: 100, Open: 100, Signal: 1, StopLoss: 95, TakeProfit: 120, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:15Z', Close: 90, High: 93, Low: 88, Open: 93, Signal: 0, Feature_SimPos: 1 },
  ];
  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'stopLoss');
  assert.equal(trades[0].exitPrice, 93);
});
