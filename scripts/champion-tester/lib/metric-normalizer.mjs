const NUMBER_FIELDS = [
  'netProfit',
  'roi',
  'winRate',
  'totalTrades',
  'maxDrawdown',
  'profitFactor',
  'sharpeRatio',
];

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finiteOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function round(value, digits = 2) {
  const n = finiteOrNull(value);
  if (n === null) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/**
 * Normalize metrics from the existing pine streaming analyzer into the field
 * names consumed by the web UI. The analyzer currently emits names like
 * totalPnl/roiPct/winRatePct/tradeCount/maxDrawdownPct; older UI code and
 * result indexes expected netProfit/roi/winRate/totalTrades/maxDrawdown.
 * Keeping both aliases makes old result files, new API responses, CSV export,
 * dashboard, Run Test, Sweep, and Results agree on one contract.
 */
export function normalizeMetrics(metrics = {}) {
  const normalized = { ...metrics };

  const netProfit = firstFinite(metrics.netProfit, metrics.totalPnl, metrics.totalProfit);
  const roi = firstFinite(metrics.roi, metrics.roiPct);
  const winRate = firstFinite(metrics.winRate, metrics.winRatePct);
  const totalTrades = firstFinite(metrics.totalTrades, metrics.tradeCount);
  const maxDrawdown = firstFinite(metrics.maxDrawdown, metrics.maxDrawdownPct);
  const profitFactor = firstFinite(metrics.profitFactor);
  const sharpeRatio = firstFinite(metrics.sharpeRatio);

  normalized.netProfit = round(netProfit);
  normalized.roi = round(roi);
  normalized.winRate = round(winRate);
  normalized.totalTrades = totalTrades === null ? null : Math.round(totalTrades);
  normalized.maxDrawdown = round(maxDrawdown);
  normalized.profitFactor = round(profitFactor);
  normalized.sharpeRatio = round(sharpeRatio);

  // Preserve analyzer aliases too, filling missing ones for compatibility.
  if (normalized.totalPnl == null && normalized.netProfit != null) normalized.totalPnl = normalized.netProfit;
  if (normalized.roiPct == null && normalized.roi != null) normalized.roiPct = normalized.roi;
  if (normalized.winRatePct == null && normalized.winRate != null) normalized.winRatePct = normalized.winRate;
  if (normalized.tradeCount == null && normalized.totalTrades != null) normalized.tradeCount = normalized.totalTrades;
  if (normalized.maxDrawdownPct == null && normalized.maxDrawdown != null) normalized.maxDrawdownPct = normalized.maxDrawdown;

  return normalized;
}

export function normalizeResult(result) {
  if (!result || typeof result !== 'object') return result;
  return {
    ...result,
    metrics: normalizeMetrics(result.metrics || {}),
  };
}

export function compactMetricEntry(metrics = {}) {
  const normalized = normalizeMetrics(metrics);
  return Object.fromEntries(NUMBER_FIELDS.map((field) => [field, normalized[field] ?? null]));
}
