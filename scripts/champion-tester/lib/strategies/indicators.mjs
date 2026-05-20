/**
 * Technical Indicators Library
 * Pure JS implementations of indicators used by the champion strategy.
 * All functions work on arrays of candles: { open, high, low, close, volume }
 */

// ─── EMA ──────────────────────────────────────────────────────────

export function ema(data, period) {
  if (data.length < period) return new Array(data.length).fill(null);
  const k = 2 / (period + 1);
  const result = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result[period - 1] = sum / period;
  for (let i = period; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

// ─── SMA ──────────────────────────────────────────────────────────

export function sma(data, period) {
  const result = new Array(data.length).fill(null);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result[i] = sum / period;
  }
  return result;
}

// ─── ATR (Average True Range) ─────────────────────────────────────

export function atr(highs, lows, closes, period = 14) {
  const tr = new Array(highs.length).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr[i] = Math.max(hl, hc, lc);
  }
  // RMA (Wilder's smoothing) for ATR
  return rma(tr, period);
}

// ─── RMA (Wilder's Moving Average) ───────────────────────────────

export function rma(data, period) {
  const result = new Array(data.length).fill(null);
  let sum = 0;
  for (let i = 0; i < Math.min(period, data.length); i++) sum += data[i];
  if (data.length >= period) {
    result[period - 1] = sum / period;
    const alpha = 1 / period;
    for (let i = period; i < data.length; i++) {
      result[i] = alpha * data[i] + (1 - alpha) * result[i - 1];
    }
  }
  return result;
}

// ─── RSI ──────────────────────────────────────────────────────────

export function rsi(closes, period = 14) {
  const result = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  // Initial averages
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result[i + 1] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ─── ADX (Average Directional Index) ─────────────────────────────

export function adx(highs, lows, closes, period = 14) {
  const len = highs.length;
  const result = { adx: new Array(len).fill(null), plusDI: new Array(len).fill(null), minusDI: new Array(len).fill(null) };
  if (len < period * 2) return result;

  const tr = [], plusDM = [], minusDM = [];
  for (let i = 1; i < len; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hl, hc, lc));

    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  // Smoothed TR, +DM, -DM using Wilder's smoothing
  const smoothTR = wilderSmooth(tr, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);

  const dx = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === null || smoothTR[i] === 0) { dx.push(null); continue; }
    const pdi = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const mdi = (smoothMinusDM[i] / smoothTR[i]) * 100;
    result.plusDI[i + period] = pdi;
    result.minusDI[i + period] = mdi;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : Math.abs(pdi - mdi) / sum * 100);
  }

  // ADX = smoothed DX
  const adxSmoothed = wilderSmooth(dx.filter(v => v !== null), period);
  const offset = period * 2 - 1;
  for (let i = 0; i < adxSmoothed.length; i++) {
    if (offset + i < len) result.adx[offset + i] = adxSmoothed[i];
  }

  return result;
}

function wilderSmooth(data, period) {
  const result = [];
  let sum = 0;
  for (let i = 0; i < period && i < data.length; i++) sum += (data[i] || 0);
  if (data.length >= period) {
    result.push(sum);
    for (let i = period; i < data.length; i++) {
      const prev = result[result.length - 1];
      result.push(prev - (prev / period) + (data[i] || 0));
    }
  }
  return result;
}

// ─── Supertrend ───────────────────────────────────────────────────

export function supertrend(highs, lows, closes, atrPeriod = 10, factor = 3) {
  const len = closes.length;
  const atrValues = atr(highs, lows, closes, atrPeriod);
  const result = { trend: new Array(len).fill(0), upper: new Array(len).fill(null), lower: new Array(len).fill(null) };

  let prevUpper = 0, prevLower = 0, prevTrend = 1;

  for (let i = 0; i < len; i++) {
    if (atrValues[i] === null) continue;
    const mid = (highs[i] + lows[i]) / 2;
    let upper = mid + factor * atrValues[i];
    let lower = mid - factor * atrValues[i];

    // Carry forward
    if (prevLower > 0 && lower < prevLower && closes[i - 1] > prevLower) lower = prevLower;
    if (prevUpper > 0 && upper > prevUpper && closes[i - 1] < prevUpper) upper = prevUpper;

    let trend;
    if (prevTrend === 1) {
      trend = closes[i] < lower ? -1 : 1;
    } else {
      trend = closes[i] > upper ? 1 : -1;
    }

    result.trend[i] = trend;
    result.upper[i] = upper;
    result.lower[i] = lower;
    prevUpper = upper;
    prevLower = lower;
    prevTrend = trend;
  }

  return result;
}

// ─── Bollinger Bands ──────────────────────────────────────────────

export function bollingerBands(closes, period = 20, stdDev = 2) {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  const width = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += Math.pow(closes[j] - middle[i], 2);
    }
    const sd = Math.sqrt(sum / period);
    upper[i] = middle[i] + stdDev * sd;
    lower[i] = middle[i] - stdDev * sd;
    width[i] = middle[i] > 0 ? (upper[i] - lower[i]) / middle[i] : 0;
  }

  return { upper, middle, lower, width };
}

// ─── MACD ─────────────────────────────────────────────────────────

export function macd(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const macdLine = new Array(closes.length).fill(null);

  // MACD line = fast EMA - slow EMA
  for (let i = 0; i < closes.length; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      macdLine[i] = fastEma[i] - slowEma[i];
    }
  }

  // Signal line = EMA of MACD line (only over non-null values)
  const macdValues = [];
  const macdIndices = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] !== null) {
      macdValues.push(macdLine[i]);
      macdIndices.push(i);
    }
  }

  const signalValues = ema(macdValues, signalPeriod);
  const signal = new Array(closes.length).fill(null);
  const histogram = new Array(closes.length).fill(null);

  for (let j = 0; j < macdIndices.length; j++) {
    const i = macdIndices[j];
    if (signalValues[j] !== null) {
      signal[i] = signalValues[j];
      histogram[i] = macdLine[i] - signal[i];
    }
  }

  return { macdLine, signal, histogram };
}

// ─── Engulfing Pattern Detection ──────────────────────────────────

export function engulfing(opens, highs, lows, closes) {
  const len = closes.length;
  const result = new Array(len).fill(0); // 1 = bullish, -1 = bearish, 0 = none

  for (let i = 1; i < len; i++) {
    const prevBody = closes[i - 1] - opens[i - 1];
    const currBody = closes[i] - opens[i];

    // Bullish engulfing: prev bearish, current bullish, current body engulfs prev
    if (prevBody < 0 && currBody > 0 && opens[i] <= closes[i - 1] && closes[i] >= opens[i - 1]) {
      result[i] = 1;
    }
    // Bearish engulfing: prev bullish, current bearish, current body engulfs prev
    else if (prevBody > 0 && currBody < 0 && opens[i] >= closes[i - 1] && closes[i] <= opens[i - 1]) {
      result[i] = -1;
    }
  }
  return result;
}

// ─── Pivot Points (for divergence) ────────────────────────────────

export function pivotHigh(data, leftBars, rightBars) {
  const result = new Array(data.length).fill(null);
  for (let i = leftBars; i < data.length - rightBars; i++) {
    let isPivot = true;
    for (let j = i - leftBars; j < i; j++) {
      if (data[j] >= data[i]) { isPivot = false; break; }
    }
    if (!isPivot) continue;
    for (let j = i + 1; j <= i + rightBars; j++) {
      if (data[j] >= data[i]) { isPivot = false; break; }
    }
    if (isPivot) result[i] = data[i];
  }
  return result;
}

export function pivotLow(data, leftBars, rightBars) {
  const result = new Array(data.length).fill(null);
  for (let i = leftBars; i < data.length - rightBars; i++) {
    let isPivot = true;
    for (let j = i - leftBars; j < i; j++) {
      if (data[j] <= data[i]) { isPivot = false; break; }
    }
    if (!isPivot) continue;
    for (let j = i + 1; j <= i + rightBars; j++) {
      if (data[j] <= data[i]) { isPivot = false; break; }
    }
    if (isPivot) result[i] = data[i];
  }
  return result;
}
