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
