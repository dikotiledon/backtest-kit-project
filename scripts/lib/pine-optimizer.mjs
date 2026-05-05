import fs from 'node:fs/promises';
import path from 'node:path';

export { analyzeJsonlFileStreaming } from './pine-streaming-metrics.mjs';

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

function buildTrade(position, exitRow, exitReason, exitPrice, exitIndex) {
  const rawPnlExact = position.side === 'long'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const returnPctExact = position.entryPrice === 0 ? 0 : (rawPnlExact / position.entryPrice) * 100;

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
    rawPnlExact,
    returnPctExact,
    pnl: round(rawPnlExact),
    returnPct: round(returnPctExact),
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
      const simPos = Number(row?.Feature_SimPos);
      let exitReason = null;
      let exitPrice = null;

      if (position.side === 'long' && simPos === 1) {
        if (Number.isFinite(row?.StopLoss)) position.stopLoss = row.StopLoss;
        if (Number.isFinite(row?.TakeProfit)) position.takeProfit = row.TakeProfit;
      }
      if (position.side === 'short' && simPos === -1) {
        if (Number.isFinite(row?.StopLoss)) position.stopLoss = row.StopLoss;
        if (Number.isFinite(row?.TakeProfit)) position.takeProfit = row.TakeProfit;
      }

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
    supertrendBullCount: countHits(normalized, 'Feature_SupertrendBull'),
    supertrendBearCount: countHits(normalized, 'Feature_SupertrendBear'),
    supertrendPassLongCount: countHits(normalized, 'Feature_SupertrendPassLong'),
    supertrendPassShortCount: countHits(normalized, 'Feature_SupertrendPassShort'),
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
    blockLongSupertrendCount: countHits(normalized, 'Feature_BlockLong_Supertrend'),
    blockShortSupertrendCount: countHits(normalized, 'Feature_BlockShort_Supertrend'),
    trailActiveCount: countHits(normalized, 'Feature_TrailActive'),
    trailMovedCount: countHits(normalized, 'Feature_TrailMoved'),
    trailExitLongCount: countHits(normalized, 'Feature_TrailExitLong'),
    trailExitShortCount: countHits(normalized, 'Feature_TrailExitShort'),
    startLongCount: countHits(normalized, 'Feature_StartLong'),
    startShortCount: countHits(normalized, 'Feature_StartShort'),
  };
}

export async function analyzeJsonlFile(filePath, options = {}) {
  const parsedRows = await loadJsonlRows(filePath);
  const rows = normalizeRows(parsedRows);
  const trades = simulateTrades(rows, options);
  const metrics = calculateMetrics(trades);
  const score = scoreMetrics(metrics, options);
  const diagnostics = summarizeSignalDiagnostics(rows);

  return {
    filePath: path.resolve(filePath),
    rowCount: parsedRows.length,
    timeframeMinutes: options.timeframeMinutes || inferTimeframeMinutes(rows),
    rows,
    trades,
    metrics,
    score,
    diagnostics,
  };
}
