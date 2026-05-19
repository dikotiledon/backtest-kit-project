// scripts/lib/pine-simulator.mjs
import { applyCostToTrade } from './pine-cost-model.mjs';

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeRows(rows) {
  return rows.filter((row) => row && row.timestamp && Number.isFinite(row.Close));
}

function inferTimeframeMinutes(rows) {
  const valid = rows.filter((row) => row?.timestamp).slice(0, 10);
  for (let i = 1; i < valid.length; i++) {
    const diffMs = Date.parse(valid[i].timestamp) - Date.parse(valid[i - 1].timestamp);
    if (Number.isFinite(diffMs) && diffMs > 0) return diffMs / 60000;
  }
  return 15;
}

function barsToHold(row, timeframeMinutes) {
  const estimatedMinutes = Number.isFinite(row?.EstimatedTime) && row.EstimatedTime > 0
    ? row.EstimatedTime : 240;
  return Math.max(1, Math.ceil(estimatedMinutes / timeframeMinutes));
}

function barRange(row) {
  return {
    high: Number.isFinite(row.High) ? row.High : row.Close,
    low: Number.isFinite(row.Low) ? row.Low : row.Close,
  };
}

function getOpen(row) {
  return Number.isFinite(row.Open) ? row.Open : row.Close;
}

function excursionPct(position, kind) {
  const entry = position.entryPrice;
  if (!Number.isFinite(entry) || entry === 0) return null;
  if (position.side === 'long') {
    const favorable = position.maxHigh - entry;
    const adverse = entry - position.minLow;
    return round(((kind === 'mfe' ? favorable : adverse) / entry) * 100, 4);
  }
  const favorable = entry - position.minLow;
  const adverse = position.maxHigh - entry;
  return round(((kind === 'mfe' ? favorable : adverse) / entry) * 100, 4);
}

function buildTrade(position, exitRow, exitReason, exitPrice, exitIndex) {
  const rawPnl = position.side === 'long'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const returnPctExact = position.entryPrice === 0 ? 0 : (rawPnl / position.entryPrice) * 100;

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
    rawPnlExact: round(rawPnl, 6),
    returnPctExact: round(returnPctExact, 6),
    pnl: round(rawPnl, 2),
    returnPct: round(returnPctExact, 2),
    mfePct: excursionPct(position, 'mfe'),
    maePct: excursionPct(position, 'mae'),
  };
}

export function simulateTrades(rows, options = {}) {
  const normalized = normalizeRows(rows);
  const timeframeMinutes = options.timeframeMinutes || inferTimeframeMinutes(normalized);
  const entryMode = options.entryMode || 'next-bar-open';
  const costModel = options.costModel ?? null;
  const trades = [];
  let position = null;
  let pendingSignal = null;

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    const signal = row.Signal;

    // Process pending entry (next-bar-open mode)
    if (!position && pendingSignal && entryMode === 'next-bar-open') {
      const entryPrice = getOpen(row);
      position = {
        side: pendingSignal.side,
        entryIndex: i,
        entryTime: row.timestamp,
        entryPrice,
        maxHigh: entryPrice,
        minLow: entryPrice,
        stopLoss: pendingSignal.stopLoss,
        takeProfit: pendingSignal.takeProfit,
        maxBars: pendingSignal.maxBars,
      };
      pendingSignal = null;
    }

    // Process open position
    if (position) {
      const close = row.Close;
      const { high, low } = barRange(row);
      const open = getOpen(row);
      const heldBars = i - position.entryIndex;
      let exitReason = null;
      let exitPrice = null;

      position.maxHigh = Math.max(position.maxHigh, high);
      position.minLow = Math.min(position.minLow, low);

      if (position.side === 'long') {
        if (Number.isFinite(position.stopLoss) && low <= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = open < position.stopLoss ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && high >= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = open > position.takeProfit ? open : position.takeProfit;
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
          exitPrice = open > position.stopLoss ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && low <= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = open < position.takeProfit ? open : position.takeProfit;
        } else if (signal === 1) {
          exitReason = 'flip';
          exitPrice = close;
        } else if (heldBars >= position.maxBars) {
          exitReason = 'time';
          exitPrice = close;
        }
      }

      if (exitReason) {
        let trade = buildTrade(position, row, exitReason, exitPrice, i);
        if (costModel) trade = applyCostToTrade(trade, costModel);
        trades.push(trade);
        position = null;
      } else {
        // Trailing SL/TP updates
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

    // Register new signal
    if (!position && (signal === 1 || signal === -1)) {
      if (entryMode === 'next-bar-open') {
        pendingSignal = {
          side: signal === 1 ? 'long' : 'short',
          stopLoss: Number.isFinite(row.StopLoss) ? row.StopLoss : NaN,
          takeProfit: Number.isFinite(row.TakeProfit) ? row.TakeProfit : NaN,
          maxBars: barsToHold(row, timeframeMinutes),
        };
      } else {
        position = {
          side: signal === 1 ? 'long' : 'short',
          entryIndex: i,
          entryTime: row.timestamp,
          entryPrice: row.Close,
          maxHigh: row.Close,
          minLow: row.Close,
          stopLoss: Number.isFinite(row.StopLoss) ? row.StopLoss : NaN,
          takeProfit: Number.isFinite(row.TakeProfit) ? row.TakeProfit : NaN,
          maxBars: barsToHold(row, timeframeMinutes),
        };
      }
    }
  }

  // Close open position at end of data
  if (position && normalized.length) {
    const lastIndex = normalized.length - 1;
    const lastRow = normalized[lastIndex];
    let trade = buildTrade(position, lastRow, 'endOfData', lastRow.Close, lastIndex);
    if (costModel) trade = applyCostToTrade(trade, costModel);
    trades.push(trade);
  }

  return trades;
}
