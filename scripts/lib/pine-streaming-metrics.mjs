import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import {
  round,
  calculateMetrics,
  scoreMetricsBreakdown,
  scoreMetrics,
} from './pine-metric-core.mjs';

function barsToHold(row, timeframeMinutes) {
  const estimatedMinutes = Number.isFinite(row?.EstimatedTime) && row.EstimatedTime > 0
    ? row.EstimatedTime
    : 240;
  return Math.max(1, Math.ceil(estimatedMinutes / timeframeMinutes));
}

function barRange(row) {
  const close = row.Close;
  return {
    high: Number.isFinite(row.High) ? row.High : close,
    low: Number.isFinite(row.Low) ? row.Low : close,
  };
}

function updateExcursions(position, row) {
  const { high, low } = barRange(row);
  if (Number.isFinite(high)) position.maxHigh = Math.max(position.maxHigh, high);
  if (Number.isFinite(low)) position.minLow = Math.min(position.minLow, low);
}

function excursionPct(position, kind) {
  const entryPrice = position.entryPrice;
  if (!Number.isFinite(entryPrice) || entryPrice === 0) return null;

  if (position.side === 'long') {
    const favorable = position.maxHigh - entryPrice;
    const adverse = entryPrice - position.minLow;
    return round(((kind === 'mfe' ? favorable : adverse) / entryPrice) * 100);
  }

  const favorable = entryPrice - position.minLow;
  const adverse = position.maxHigh - entryPrice;
  return round(((kind === 'mfe' ? favorable : adverse) / entryPrice) * 100);
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
    mfePct: excursionPct(position, 'mfe'),
    maePct: excursionPct(position, 'mae'),
  };
}

export async function* iterateJsonlRows(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  try {
    for await (const line of rl) {
      lineNumber += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${filePath}:${lineNumber}`, { cause: error });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

function createDiagnosticsCollector() {
  const hits = new Map();
  const sums = new Map();

  const hitKeys = [
    'Feature_RawLongPrediction', 'Feature_RawShortPrediction', 'Feature_FilterVolatility', 'Feature_FilterRegime',
    'Feature_FilterAdx', 'Feature_FilterAll', 'Feature_LongPostFilter', 'Feature_ShortPostFilter',
    'Feature_SignalLong', 'Feature_SignalShort', 'Feature_NewBuySignal', 'Feature_NewSellSignal',
    'Feature_BaseStartLong', 'Feature_BaseStartShort', 'Feature_TrendXLongPass', 'Feature_TrendXShortPass',
    'Feature_PredLongStrengthPass', 'Feature_PredShortStrengthPass', 'Feature_CooldownOk', 'Feature_AtrFlipBull',
    'Feature_AtrFlipBear', 'Feature_3LineBull', 'Feature_3LineBear', 'Feature_EngulfingBull', 'Feature_EngulfingBear',
    'Feature_EmaCrossBull', 'Feature_EmaCrossBear', 'Feature_LongFusionPass', 'Feature_ShortFusionPass',
    'Feature_SupertrendBull', 'Feature_SupertrendBear', 'Feature_SupertrendPassLong', 'Feature_SupertrendPassShort',
    'Feature_FusionV4Active', 'Feature_BlockLong_TrendX', 'Feature_BlockShort_TrendX', 'Feature_BlockLong_Pred',
    'Feature_BlockShort_Pred', 'Feature_BlockLong_Cooldown', 'Feature_BlockShort_Cooldown', 'Feature_BlockLong_Fusion',
    'Feature_BlockShort_Fusion', 'Feature_BlockLong_Supertrend', 'Feature_BlockShort_Supertrend', 'Feature_TrailActive',
    'Feature_TrailMoved', 'Feature_TrailExitLong', 'Feature_TrailExitShort', 'Feature_StartLong', 'Feature_StartShort',
  ];

  const sumKeys = [
    'Feature_LongFusionScore', 'Feature_ShortFusionScore', 'Feature_LongFusionBonus', 'Feature_ShortFusionBonus',
    'Feature_LongFusionPenalty', 'Feature_ShortFusionPenalty', 'Feature_LongFusionV4Residual',
    'Feature_ShortFusionV4Residual', 'Feature_EffectiveLongStrength', 'Feature_EffectiveShortStrength',
  ];

  for (const key of hitKeys) hits.set(key, 0);
  for (const key of sumKeys) sums.set(key, 0);

  return {
    push(row) {
      for (const key of hitKeys) {
        if (Number(row?.[key]) > 0) hits.set(key, hits.get(key) + 1);
      }
      for (const key of sumKeys) {
        sums.set(key, sums.get(key) + (Number(row?.[key]) || 0));
      }
    },
    result() {
      return {
        rawLongPredictionCount: hits.get('Feature_RawLongPrediction'),
        rawShortPredictionCount: hits.get('Feature_RawShortPrediction'),
        filterVolatilityPassCount: hits.get('Feature_FilterVolatility'),
        filterRegimePassCount: hits.get('Feature_FilterRegime'),
        filterAdxPassCount: hits.get('Feature_FilterAdx'),
        filterAllPassCount: hits.get('Feature_FilterAll'),
        longPostFilterCount: hits.get('Feature_LongPostFilter'),
        shortPostFilterCount: hits.get('Feature_ShortPostFilter'),
        signalLongCount: hits.get('Feature_SignalLong'),
        signalShortCount: hits.get('Feature_SignalShort'),
        newBuySignalCount: hits.get('Feature_NewBuySignal'),
        newSellSignalCount: hits.get('Feature_NewSellSignal'),
        baseStartLongCount: hits.get('Feature_BaseStartLong'),
        baseStartShortCount: hits.get('Feature_BaseStartShort'),
        trendXLongPassCount: hits.get('Feature_TrendXLongPass'),
        trendXShortPassCount: hits.get('Feature_TrendXShortPass'),
        predLongStrengthPassCount: hits.get('Feature_PredLongStrengthPass'),
        predShortStrengthPassCount: hits.get('Feature_PredShortStrengthPass'),
        cooldownOkCount: hits.get('Feature_CooldownOk'),
        atrFlipBullCount: hits.get('Feature_AtrFlipBull'),
        atrFlipBearCount: hits.get('Feature_AtrFlipBear'),
        line3BullCount: hits.get('Feature_3LineBull'),
        line3BearCount: hits.get('Feature_3LineBear'),
        engulfingBullCount: hits.get('Feature_EngulfingBull'),
        engulfingBearCount: hits.get('Feature_EngulfingBear'),
        emaCrossBullCount: hits.get('Feature_EmaCrossBull'),
        emaCrossBearCount: hits.get('Feature_EmaCrossBear'),
        longFusionPassCount: hits.get('Feature_LongFusionPass'),
        shortFusionPassCount: hits.get('Feature_ShortFusionPass'),
        supertrendBullCount: hits.get('Feature_SupertrendBull'),
        supertrendBearCount: hits.get('Feature_SupertrendBear'),
        supertrendPassLongCount: hits.get('Feature_SupertrendPassLong'),
        supertrendPassShortCount: hits.get('Feature_SupertrendPassShort'),
        longFusionScoreSum: sums.get('Feature_LongFusionScore'),
        shortFusionScoreSum: sums.get('Feature_ShortFusionScore'),
        longFusionBonusSum: sums.get('Feature_LongFusionBonus'),
        shortFusionBonusSum: sums.get('Feature_ShortFusionBonus'),
        longFusionPenaltySum: sums.get('Feature_LongFusionPenalty'),
        shortFusionPenaltySum: sums.get('Feature_ShortFusionPenalty'),
        longFusionV4ResidualSum: sums.get('Feature_LongFusionV4Residual'),
        shortFusionV4ResidualSum: sums.get('Feature_ShortFusionV4Residual'),
        fusionV4ActiveCount: hits.get('Feature_FusionV4Active'),
        effectiveLongStrengthSum: sums.get('Feature_EffectiveLongStrength'),
        effectiveShortStrengthSum: sums.get('Feature_EffectiveShortStrength'),
        blockLongTrendXCount: hits.get('Feature_BlockLong_TrendX'),
        blockShortTrendXCount: hits.get('Feature_BlockShort_TrendX'),
        blockLongPredCount: hits.get('Feature_BlockLong_Pred'),
        blockShortPredCount: hits.get('Feature_BlockShort_Pred'),
        blockLongCooldownCount: hits.get('Feature_BlockLong_Cooldown'),
        blockShortCooldownCount: hits.get('Feature_BlockShort_Cooldown'),
        blockLongFusionCount: hits.get('Feature_BlockLong_Fusion'),
        blockShortFusionCount: hits.get('Feature_BlockShort_Fusion'),
        blockLongSupertrendCount: hits.get('Feature_BlockLong_Supertrend'),
        blockShortSupertrendCount: hits.get('Feature_BlockShort_Supertrend'),
        trailActiveCount: hits.get('Feature_TrailActive'),
        trailMovedCount: hits.get('Feature_TrailMoved'),
        trailExitLongCount: hits.get('Feature_TrailExitLong'),
        trailExitShortCount: hits.get('Feature_TrailExitShort'),
        startLongCount: hits.get('Feature_StartLong'),
        startShortCount: hits.get('Feature_StartShort'),
      };
    },
  };
}

export function createIncrementalTradeSimulator(options = {}) {
  const trades = [];
  let index = 0;
  let rowCount = 0;
  let position = null;
  const firstTimestamps = [];
  const diagnostics = createDiagnosticsCollector();

  const timeframeFromOptions = Number.isFinite(options.timeframeMinutes) && options.timeframeMinutes > 0
    ? options.timeframeMinutes
    : null;

  const inferTimeframe = () => {
    if (timeframeFromOptions) return timeframeFromOptions;
    for (let i = 1; i < firstTimestamps.length; i++) {
      const prev = Date.parse(firstTimestamps[i - 1]);
      const cur = Date.parse(firstTimestamps[i]);
      const diffMs = cur - prev;
      if (Number.isFinite(diffMs) && diffMs > 0) return diffMs / 60000;
    }
    return 15;
  };

  return {
    push(rawRow) {
      rowCount += 1;
      if (!rawRow || !rawRow.timestamp || !Number.isFinite(rawRow.Close)) return;

      if (firstTimestamps.length < 10) firstTimestamps.push(rawRow.timestamp);
      diagnostics.push(rawRow);

      const row = rawRow;
      const signal = row.Signal;

      if (position) {
        const close = row.Close;
        const hasExplicitOpen = Number.isFinite(row.Open);
        const { high, low } = barRange(row);
        const open = hasExplicitOpen ? row.Open : close;
        const heldBars = index - position.entryIndex;
        let exitReason = null;
        let exitPrice = null;

        updateExcursions(position, row);

        // Exit detection uses PREVIOUS bar's SL/TP (already stored in position)
        if (position.side === 'long') {
          if (Number.isFinite(position.stopLoss) && low <= position.stopLoss) {
            exitReason = 'stopLoss';
            exitPrice = (hasExplicitOpen && open < position.stopLoss) ? open : position.stopLoss;
          } else if (Number.isFinite(position.takeProfit) && high >= position.takeProfit) {
            exitReason = 'takeProfit';
            exitPrice = (hasExplicitOpen && open > position.takeProfit) ? open : position.takeProfit;
          } else if (signal === -1) {
            exitReason = 'flip';
            exitPrice = close;
          } else if (heldBars >= position.maxBars) {
            exitReason = 'time';
            exitPrice = close;
          }
        } else {
          if (Number.isFinite(position.stopLoss) && high >= position.stopLoss) {
            exitReason = 'stopLoss';
            exitPrice = (hasExplicitOpen && open > position.stopLoss) ? open : position.stopLoss;
          } else if (Number.isFinite(position.takeProfit) && low <= position.takeProfit) {
            exitReason = 'takeProfit';
            exitPrice = (hasExplicitOpen && open < position.takeProfit) ? open : position.takeProfit;
          } else if (signal === 1) {
            exitReason = 'flip';
            exitPrice = close;
          } else if (heldBars >= position.maxBars) {
            exitReason = 'time';
            exitPrice = close;
          }
        }

        if (exitReason) {
          trades.push(buildTrade(position, row, exitReason, exitPrice, index));
          position = null;
        } else {
          // Update SL/TP AFTER exit check — effective next bar
          const simPos = Number(row?.Feature_SimPos);
          if (position.side === 'long' && simPos === 1) {
            if (Number.isFinite(row?.StopLoss)) position.stopLoss = row.StopLoss;
            if (Number.isFinite(row?.TakeProfit)) position.takeProfit = row.TakeProfit;
          }
          if (position.side === 'short' && simPos === -1) {
            if (Number.isFinite(row?.StopLoss)) position.stopLoss = row.StopLoss;
            if (Number.isFinite(row?.TakeProfit)) position.takeProfit = row.TakeProfit;
          }
        }
      }

      if (!position && (signal === 1 || signal === -1)) {
        const timeframeMinutes = inferTimeframe();
        position = {
          side: signal === 1 ? 'long' : 'short',
          entryIndex: index,
          entryTime: row.timestamp,
          entryPrice: row.Close,
          maxHigh: row.Close,
          minLow: row.Close,
          stopLoss: Number.isFinite(row.StopLoss) ? row.StopLoss : NaN,
          takeProfit: Number.isFinite(row.TakeProfit) ? row.TakeProfit : NaN,
          maxBars: barsToHold(row, timeframeMinutes),
        };
      }

      index += 1;
    },
    finalize(lastRow) {
      if (position && lastRow) {
        trades.push(buildTrade(position, lastRow, 'endOfData', lastRow.Close, index - 1));
        position = null;
      }
      return {
        trades,
        rowCount,
        diagnostics: diagnostics.result(),
        timeframeMinutes: inferTimeframe(),
      };
    },
  };
}

export async function analyzeJsonlFileStreaming(filePath, options = {}) {
  const simulator = createIncrementalTradeSimulator(options);
  let lastNormalizedRow = null;

  for await (const row of iterateJsonlRows(filePath)) {
    if (row && row.timestamp && Number.isFinite(row.Close)) {
      lastNormalizedRow = row;
    }
    simulator.push(row);
  }

  const { trades, rowCount, diagnostics, timeframeMinutes } = simulator.finalize(lastNormalizedRow);
  const metrics = calculateMetrics(trades);
  const breakdown = scoreMetricsBreakdown(metrics, options);
  const score = scoreMetrics(metrics, options);

  return {
    filePath: path.resolve(filePath),
    rowCount,
    timeframeMinutes,
    metrics,
    score,
    breakdown,
    diagnostics,
  };
}
