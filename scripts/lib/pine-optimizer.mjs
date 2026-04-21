import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadJsonlRows(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function inferTimeframeMinutes(rows) {
  const valid = rows.filter((row) => row?.timestamp).slice(0, 10);
  for (let i = 1; i < valid.length; i++) {
    const prev = Date.parse(valid[i - 1].timestamp);
    const cur = Date.parse(valid[i].timestamp);
    const diffMs = cur - prev;
    if (Number.isFinite(diffMs) && diffMs > 0) {
      return diffMs / 60000;
    }
  }
  return 15;
}

export function normalizeRows(rows) {
  return rows.filter((row) => row && row.timestamp && Number.isFinite(row.Close));
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function barsToHold(row, timeframeMinutes) {
  const estimatedMinutes = Number.isFinite(row?.EstimatedTime) && row.EstimatedTime > 0
    ? row.EstimatedTime
    : 240;
  return Math.max(1, Math.ceil(estimatedMinutes / timeframeMinutes));
}

function buildTrade(position, exitRow, exitReason, exitPrice, exitIndex) {
  const rawPnl = position.side === 'long'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const returnPct = position.entryPrice === 0 ? 0 : (rawPnl / position.entryPrice) * 100;

  return {
    side: position.side,
    entryIndex: position.entryIndex,
    exitIndex,
    entryTime: position.entryTime,
    exitTime: exitRow.timestamp,
    entryPrice: position.entryPrice,
    exitPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    holdBars: exitIndex - position.entryIndex,
    maxBars: position.maxBars,
    exitReason,
    pnl: round(rawPnl),
    returnPct: round(returnPct),
  };
}

export function simulateTrades(rows, options = {}) {
  const normalized = normalizeRows(rows);
  const timeframeMinutes = options.timeframeMinutes || inferTimeframeMinutes(normalized);
  const trades = [];
  let position = null;

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    const signal = row.Signal;

    if (position) {
      const close = row.Close;
      const heldBars = i - position.entryIndex;
      let exitReason = null;
      let exitPrice = null;

      if (position.side === 'long') {
        if (Number.isFinite(position.stopLoss) && close <= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && close >= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = position.takeProfit;
        } else if (signal === -1) {
          exitReason = 'flip';
          exitPrice = close;
        } else if (heldBars >= position.maxBars) {
          exitReason = 'time';
          exitPrice = close;
        }
      } else {
        if (Number.isFinite(position.stopLoss) && close >= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && close <= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = position.takeProfit;
        } else if (signal === 1) {
          exitReason = 'flip';
          exitPrice = close;
        } else if (heldBars >= position.maxBars) {
          exitReason = 'time';
          exitPrice = close;
        }
      }

      if (exitReason) {
        trades.push(buildTrade(position, row, exitReason, exitPrice, i));
        position = null;
      }
    }

    if (!position && (signal === 1 || signal === -1)) {
      position = {
        side: signal === 1 ? 'long' : 'short',
        entryIndex: i,
        entryTime: row.timestamp,
        entryPrice: row.Close,
        stopLoss: Number.isFinite(row.StopLoss) ? row.StopLoss : NaN,
        takeProfit: Number.isFinite(row.TakeProfit) ? row.TakeProfit : NaN,
        maxBars: barsToHold(row, timeframeMinutes),
      };
    }
  }

  if (position && normalized.length) {
    const lastIndex = normalized.length - 1;
    const lastRow = normalized[lastIndex];
    trades.push(buildTrade(position, lastRow, 'endOfData', lastRow.Close, lastIndex));
  }

  return trades;
}

export function calculateMetrics(trades) {
  const tradeCount = trades.length;
  const winTrades = trades.filter((trade) => trade.pnl > 0);
  const lossTrades = trades.filter((trade) => trade.pnl < 0);
  const totalProfit = winTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const totalLossAbs = Math.abs(lossTrades.reduce((sum, trade) => sum + trade.pnl, 0));
  const roiPctRaw = trades.reduce((sum, trade) => sum + trade.returnPct, 0);

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    cumulative += trade.returnPct;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const avgReturnPct = tradeCount ? roiPctRaw / tradeCount : 0;
  const avgPnl = tradeCount ? (totalProfit - totalLossAbs) / tradeCount : 0;
  const profitFactor = totalLossAbs === 0
    ? (totalProfit > 0 ? Number.POSITIVE_INFINITY : 0)
    : totalProfit / totalLossAbs;

  return {
    tradeCount,
    winCount: winTrades.length,
    lossCount: lossTrades.length,
    winRatePct: round(tradeCount ? (winTrades.length / tradeCount) * 100 : 0),
    roiPct: round(roiPctRaw),
    avgReturnPct: round(avgReturnPct),
    avgPnl: round(avgPnl),
    totalPnl: round(totalProfit - totalLossAbs),
    totalProfit: round(totalProfit),
    totalLossAbs: round(totalLossAbs),
    profitFactor: Number.isFinite(profitFactor) ? round(profitFactor) : profitFactor,
    maxDrawdownPct: round(maxDrawdown),
  };
}

export function scoreMetrics(metrics, options = {}) {
  const minTrades = options.minTrades ?? 10;
  const weights = {
    roi: options.roiWeight ?? 1.0,
    winRate: options.winRateWeight ?? 0.35,
    profitFactor: options.profitFactorWeight ?? 8,
    drawdown: options.drawdownWeight ?? 0.6,
  };

  const profitFactor = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 10;
  let score = 0;
  score += metrics.roiPct * weights.roi;
  score += metrics.winRatePct * weights.winRate;
  score += profitFactor * weights.profitFactor;
  score -= metrics.maxDrawdownPct * weights.drawdown;

  if (metrics.tradeCount < minTrades) {
    score -= (minTrades - metrics.tradeCount) * 5;
  }

  return round(score);
}

function countHits(rows, key) {
  return rows.reduce((sum, row) => sum + (Number(row?.[key]) > 0 ? 1 : 0), 0);
}

export function summarizeSignalDiagnostics(rows) {
  const normalized = normalizeRows(rows);
  const scoreSum = (key) => normalized.reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);

  return {
    rawLongPredictionCount: countHits(normalized, 'Feature_RawLongPrediction'),
    rawShortPredictionCount: countHits(normalized, 'Feature_RawShortPrediction'),
    filterVolatilityPassCount: countHits(normalized, 'Feature_FilterVolatility'),
    filterRegimePassCount: countHits(normalized, 'Feature_FilterRegime'),
    filterAdxPassCount: countHits(normalized, 'Feature_FilterAdx'),
    filterAllPassCount: countHits(normalized, 'Feature_FilterAll'),
    longPostFilterCount: countHits(normalized, 'Feature_LongPostFilter'),
    shortPostFilterCount: countHits(normalized, 'Feature_ShortPostFilter'),
    signalLongCount: countHits(normalized, 'Feature_SignalLong'),
    signalShortCount: countHits(normalized, 'Feature_SignalShort'),
    newBuySignalCount: countHits(normalized, 'Feature_NewBuySignal'),
    newSellSignalCount: countHits(normalized, 'Feature_NewSellSignal'),
    baseStartLongCount: countHits(normalized, 'Feature_BaseStartLong'),
    baseStartShortCount: countHits(normalized, 'Feature_BaseStartShort'),
    trendXLongPassCount: countHits(normalized, 'Feature_TrendXLongPass'),
    trendXShortPassCount: countHits(normalized, 'Feature_TrendXShortPass'),
    predLongStrengthPassCount: countHits(normalized, 'Feature_PredLongStrengthPass'),
    predShortStrengthPassCount: countHits(normalized, 'Feature_PredShortStrengthPass'),
    cooldownOkCount: countHits(normalized, 'Feature_CooldownOk'),
    atrFlipBullCount: countHits(normalized, 'Feature_AtrFlipBull'),
    atrFlipBearCount: countHits(normalized, 'Feature_AtrFlipBear'),
    line3BullCount: countHits(normalized, 'Feature_3LineBull'),
    line3BearCount: countHits(normalized, 'Feature_3LineBear'),
    engulfingBullCount: countHits(normalized, 'Feature_EngulfingBull'),
    engulfingBearCount: countHits(normalized, 'Feature_EngulfingBear'),
    emaCrossBullCount: countHits(normalized, 'Feature_EmaCrossBull'),
    emaCrossBearCount: countHits(normalized, 'Feature_EmaCrossBear'),
    longFusionPassCount: countHits(normalized, 'Feature_LongFusionPass'),
    shortFusionPassCount: countHits(normalized, 'Feature_ShortFusionPass'),
    longFusionScoreSum: scoreSum('Feature_LongFusionScore'),
    shortFusionScoreSum: scoreSum('Feature_ShortFusionScore'),
    longFusionBonusSum: scoreSum('Feature_LongFusionBonus'),
    shortFusionBonusSum: scoreSum('Feature_ShortFusionBonus'),
    longFusionPenaltySum: scoreSum('Feature_LongFusionPenalty'),
    shortFusionPenaltySum: scoreSum('Feature_ShortFusionPenalty'),
    longFusionV4ResidualSum: scoreSum('Feature_LongFusionV4Residual'),
    shortFusionV4ResidualSum: scoreSum('Feature_ShortFusionV4Residual'),
    fusionV4ActiveCount: countHits(normalized, 'Feature_FusionV4Active'),
    effectiveLongStrengthSum: scoreSum('Feature_EffectiveLongStrength'),
    effectiveShortStrengthSum: scoreSum('Feature_EffectiveShortStrength'),
    blockLongTrendXCount: countHits(normalized, 'Feature_BlockLong_TrendX'),
    blockShortTrendXCount: countHits(normalized, 'Feature_BlockShort_TrendX'),
    blockLongPredCount: countHits(normalized, 'Feature_BlockLong_Pred'),
    blockShortPredCount: countHits(normalized, 'Feature_BlockShort_Pred'),
    blockLongCooldownCount: countHits(normalized, 'Feature_BlockLong_Cooldown'),
    blockShortCooldownCount: countHits(normalized, 'Feature_BlockShort_Cooldown'),
    blockLongFusionCount: countHits(normalized, 'Feature_BlockLong_Fusion'),
    blockShortFusionCount: countHits(normalized, 'Feature_BlockShort_Fusion'),
    startLongCount: countHits(normalized, 'Feature_StartLong'),
    startShortCount: countHits(normalized, 'Feature_StartShort'),
  };
}

export async function analyzeJsonlFile(filePath, options = {}) {
  const rows = normalizeRows(await loadJsonlRows(filePath));
  const trades = simulateTrades(rows, options);
  const metrics = calculateMetrics(trades);
  const score = scoreMetrics(metrics, options);
  const diagnostics = summarizeSignalDiagnostics(rows);

  return {
    filePath: path.resolve(filePath),
    rowCount: rows.length,
    timeframeMinutes: options.timeframeMinutes || inferTimeframeMinutes(rows),
    trades,
    metrics,
    score,
    diagnostics,
  };
}
