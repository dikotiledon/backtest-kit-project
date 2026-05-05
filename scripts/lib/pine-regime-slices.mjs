function toFiniteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function toNumberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function freezeRegimeThresholds(raw = {}) {
  return {
    atrPctMedian: toFiniteOr(toNumberOr(raw.atrPctMedian), 0),
    trendStrengthMedian: toFiniteOr(toNumberOr(raw.trendStrengthMedian), 0),
    longShortEdgeDelta: toFiniteOr(toNumberOr(raw.longShortEdgeDelta), 0)
  };
}

export function classifyRegimeSlice(row = {}, thresholds = {}) {
  const frozen = freezeRegimeThresholds(thresholds);
  const labels = [];

  const trendStrength = toNumberOr(row.trendStrength);
  const atrPct = toNumberOr(row.atrPct);

  labels.push(trendStrength >= frozen.trendStrengthMedian ? 'trend' : 'chop');
  labels.push(atrPct >= frozen.atrPctMedian ? 'high-vol' : 'low-vol');

  const longEdge = toNumberOr(row.longEdge);
  const shortEdge = toNumberOr(row.shortEdge);
  const sideEdge = Number.isFinite(row.sideEdge) ? Number(row.sideEdge) : longEdge - shortEdge;

  if (row.side === 'long' && sideEdge >= frozen.longShortEdgeDelta) {
    labels.push('long-favored');
  }

  if (row.side === 'short' && sideEdge <= -frozen.longShortEdgeDelta) {
    labels.push('short-favored');
  }

  return labels;
}

export function summarizeRegimeSliceMetrics({ regimeSliceId, trades = [], minTrades = 30 } = {}) {
  const normalizedTrades = Array.isArray(trades) ? trades : [];
  const tradeCount = normalizedTrades.length;

  let totalPnl = 0;
  let wins = 0;

  for (const trade of normalizedTrades) {
    const pnl = toNumberOr(trade?.pnl);
    totalPnl += pnl;
    if (pnl > 0) wins += 1;
  }

  const avgPnl = tradeCount > 0 ? totalPnl / tradeCount : 0;
  const winRatePct = tradeCount > 0 ? (wins / tradeCount) * 100 : 0;
  const requiredTrades = toNumberOr(minTrades, 30);
  const promotionEligible = tradeCount >= requiredTrades;

  return {
    regimeSliceId: regimeSliceId ?? null,
    tradeCount,
    totalPnl,
    avgPnl,
    winRatePct,
    promotionEligible,
    reason: promotionEligible ? null : 'insufficientRegimeTrades'
  };
}
