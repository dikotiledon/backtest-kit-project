function toFiniteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function toNumberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

export function freezeRegimeThresholds(raw = {}) {
  return {
    atrPctMedian: toFiniteOr(Number(raw.atrPctMedian), Number.POSITIVE_INFINITY),
    trendStrengthMedian: toFiniteOr(Number(raw.trendStrengthMedian), Number.POSITIVE_INFINITY),
    longShortEdgeDelta: toFiniteOr(Number(raw.longShortEdgeDelta), Number.POSITIVE_INFINITY)
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
  const sideEdgeParsed = Number(row.sideEdge);
  const sideEdge = Number.isFinite(sideEdgeParsed) ? sideEdgeParsed : longEdge - shortEdge;

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
  let validPnlCount = 0;
  let invalidPnlCount = 0;
  let wins = 0;

  for (const trade of normalizedTrades) {
    const pnlRaw = trade?.pnl;
    const pnl = Number(pnlRaw);

    if (pnlRaw === null || pnlRaw === undefined || pnlRaw === '' || !Number.isFinite(pnl)) {
      invalidPnlCount += 1;
      continue;
    }

    validPnlCount += 1;
    totalPnl += pnl;
    if (pnl > 0) wins += 1;
  }

  const avgPnl = validPnlCount > 0 ? totalPnl / validPnlCount : 0;
  // Contract: winRatePct uses percent scale [0, 100], not fraction [0, 1].
  const winRatePct = validPnlCount > 0 ? (wins / validPnlCount) * 100 : 0;
  const requiredTrades = toNumberOr(minTrades, 30);
  const promotionEligible = tradeCount >= requiredTrades;

  return {
    regimeSliceId: regimeSliceId ?? null,
    tradeCount,
    validPnlCount,
    invalidPnlCount,
    totalPnl: round4(totalPnl),
    avgPnl: round4(avgPnl),
    winRatePct: round4(winRatePct),
    promotionEligible,
    reason: promotionEligible ? null : 'insufficientRegimeTrades'
  };
}
