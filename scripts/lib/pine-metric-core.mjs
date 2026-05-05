export function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function exactRawPnl(trade) {
  if (Number.isFinite(trade?.rawPnlExact)) return trade.rawPnlExact;
  if (Number.isFinite(trade?.pnl)) return trade.pnl;
  return 0;
}

function exactReturnPct(trade) {
  if (Number.isFinite(trade?.returnPctExact)) return trade.returnPctExact;
  if (Number.isFinite(trade?.returnPct)) return trade.returnPct;
  return 0;
}

export function calculateMetrics(trades) {
  const tradeCount = trades.length;
  const winTrades = trades.filter((trade) => exactReturnPct(trade) > 0);
  const lossTrades = trades.filter((trade) => exactReturnPct(trade) < 0);
  const flatTrades = trades.filter((trade) => exactReturnPct(trade) === 0);

  const totalProfitPct = winTrades.reduce((sum, trade) => sum + exactReturnPct(trade), 0);
  const totalLossPctAbs = Math.abs(lossTrades.reduce((sum, trade) => sum + exactReturnPct(trade), 0));
  const roiPctRaw = trades.reduce((sum, trade) => sum + exactReturnPct(trade), 0);

  const totalProfitRaw = winTrades.reduce((sum, trade) => sum + Math.max(exactRawPnl(trade), 0), 0);
  const totalLossRawAbs = Math.abs(lossTrades.reduce((sum, trade) => sum + Math.min(exactRawPnl(trade), 0), 0));

  let cumulativePct = 0;
  let peakPct = 0;
  let maxDrawdownPct = 0;
  for (const trade of trades) {
    cumulativePct += exactReturnPct(trade);
    if (cumulativePct > peakPct) peakPct = cumulativePct;
    const drawdownPct = peakPct - cumulativePct;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }

  const avgReturnPct = tradeCount ? roiPctRaw / tradeCount : 0;
  const avgPnl = tradeCount ? (totalProfitRaw - totalLossRawAbs) / tradeCount : 0;
  const avgWin = winTrades.length ? totalProfitPct / winTrades.length : 0;
  const avgLoss = lossTrades.length ? totalLossPctAbs / lossTrades.length : 0;
  const profitFactor = totalLossPctAbs === 0
    ? (totalProfitPct > 0 ? Number.POSITIVE_INFINITY : 0)
    : totalProfitPct / totalLossPctAbs;

  return {
    tradeCount,
    winCount: winTrades.length,
    lossCount: lossTrades.length,
    flatCount: flatTrades.length,
    winRatePct: round(tradeCount ? (winTrades.length / tradeCount) * 100 : 0),
    roiPct: round(roiPctRaw),
    avgReturnPct: round(avgReturnPct),
    avgPnl: round(avgPnl),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    totalPnl: round(totalProfitRaw - totalLossRawAbs),
    totalProfit: round(totalProfitRaw),
    totalLossAbs: round(totalLossRawAbs),
    totalProfitPct: round(totalProfitPct),
    totalLossAbsPct: round(totalLossPctAbs),
    profitFactor: Number.isFinite(profitFactor) ? round(profitFactor) : profitFactor,
    maxDrawdownPct: round(maxDrawdownPct),
    metricBasis: {
      classification: 'returnPctExact',
      roi: 'returnPctExact',
      avgWinLoss: 'returnPctExact',
      profitFactor: 'returnPctExact',
      drawdown: 'returnPctExact',
      rawTotals: 'rawPnlExact',
    },
  };
}

export function scoreMetricsBreakdown(metrics, options = {}) {
  const minTrades = options.minTrades ?? 10;
  const weights = {
    roi: options.roiWeight ?? 1.0,
    winRate: options.winRateWeight ?? 0.8,
    profitFactor: options.profitFactorWeight ?? 8,
    drawdown: options.drawdownWeight ?? 0.6,
  };

  const profitFactor = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 10;
  const roi = round(metrics.roiPct * weights.roi);
  const winRate = round(metrics.winRatePct * weights.winRate);
  const profitFactorContribution = round(profitFactor * weights.profitFactor);
  const drawdown = round(-metrics.maxDrawdownPct * weights.drawdown);
  const tradePenalty = metrics.tradeCount < minTrades ? round((metrics.tradeCount - minTrades) * 5) : 0;

  return {
    roi,
    winRate,
    profitFactor: profitFactorContribution,
    drawdown,
    tradePenalty,
    total: round(roi + winRate + profitFactorContribution + drawdown + tradePenalty),
  };
}

export function scoreMetrics(metrics, options = {}) {
  return scoreMetricsBreakdown(metrics, options).total;
}
