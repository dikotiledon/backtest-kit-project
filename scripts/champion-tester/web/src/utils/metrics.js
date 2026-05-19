export function metricNumber(metrics, canonical, aliases = []) {
  for (const key of [canonical, ...aliases]) {
    const value = metrics?.[key];
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function normalizeMetrics(metrics = {}) {
  const netProfit = metricNumber(metrics, 'netProfit', ['totalPnl', 'totalProfit']);
  const roi = metricNumber(metrics, 'roi', ['roiPct']);
  const winRate = metricNumber(metrics, 'winRate', ['winRatePct']);
  const totalTrades = metricNumber(metrics, 'totalTrades', ['tradeCount']);
  const maxDrawdown = metricNumber(metrics, 'maxDrawdown', ['maxDrawdownPct']);
  const profitFactor = metricNumber(metrics, 'profitFactor');
  const sharpeRatio = metricNumber(metrics, 'sharpeRatio');

  return {
    ...metrics,
    netProfit,
    roi,
    winRate,
    totalTrades,
    maxDrawdown,
    profitFactor,
    sharpeRatio,
  };
}

export function normalizeResultMetrics(result) {
  return result ? { ...result, metrics: normalizeMetrics(result.metrics || {}) } : result;
}

export function formatNumber(value, digits = 2, fallback = '—') {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n.toFixed(digits);
}

export function formatPercent(value, digits = 1, fallback = '—') {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return `${n.toFixed(digits)}%`;
}
