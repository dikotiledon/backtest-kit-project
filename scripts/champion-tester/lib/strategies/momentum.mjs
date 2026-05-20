import { BaseStrategy } from './base-strategy.mjs';

/**
 * Momentum Strategy — RSI + MACD crossover.
 * 
 * Entry LONG: RSI < oversold AND MACD histogram crosses above 0
 * Entry SHORT: RSI > overbought AND MACD histogram crosses below 0
 * Exit: opposite signal or SL/TP hit
 */
export class MomentumStrategy extends BaseStrategy {
  constructor(params = {}) {
    super(params);
    this.params = {
      rsiPeriod: params.rsiPeriod || 14,
      rsiOversold: params.rsiOversold || 30,
      rsiOverbought: params.rsiOverbought || 70,
      macdFast: params.macdFast || 12,
      macdSlow: params.macdSlow || 26,
      macdSignal: params.macdSignal || 9,
      minConfidence: params.minConfidence || 0.6,
      useMultiTF: params.useMultiTF || false,
      ...params,
    };
    this.state = {
      closes: [],
      prevHist: null,
      // Running EMA state
      emaFast: null,
      emaSlow: null,
      // MACD history for signal line
      macdHistory: [],
      macdSignalEma: null,
      // Wilder's RSI state
      rsiAvgGain: null,
      rsiAvgLoss: null,
      rsiPrevClose: null,
      rsiCalcCount: 0,
    };
  }

  getName() { return 'momentum'; }
  getDescription() { return 'RSI + MACD crossover momentum strategy'; }
  getRequiredStreams() { return [`kline_${this.params.timeframe || '15m'}`]; }
  getRequiredHistory() { return Math.max(this.params.macdSlow + this.params.macdSignal, this.params.rsiPeriod) + 5; }

  /** Higher TFs for trend confirmation when useMultiTF is enabled */
  getConfirmationTimeframes() {
    if (!this.params.useMultiTF) return [];
    // Map current timeframe to higher confirmation timeframes
    const tf = this.params.timeframe || '15m';
    const tfMap = {
      '1m': ['5m', '15m'],
      '3m': ['15m', '1h'],
      '5m': ['15m', '1h'],
      '15m': ['1h', '4h'],
      '30m': ['4h'],
      '1h': ['4h', '1d'],
      '4h': ['1d'],
    };
    return tfMap[tf] || ['1h'];
  }

  static getDefaultParams() {
    return {
      rsiPeriod: { default: 14, min: 5, max: 50, desc: 'RSI lookback period' },
      rsiOversold: { default: 30, min: 10, max: 45, desc: 'RSI oversold threshold' },
      rsiOverbought: { default: 70, min: 55, max: 90, desc: 'RSI overbought threshold' },
      macdFast: { default: 12, min: 5, max: 30, desc: 'MACD fast EMA period' },
      macdSlow: { default: 26, min: 15, max: 50, desc: 'MACD slow EMA period' },
      macdSignal: { default: 9, min: 3, max: 20, desc: 'MACD signal line period' },
      minConfidence: { default: 0.6, min: 0.3, max: 0.95, desc: 'Minimum signal confidence' },
      useMultiTF: { default: false, desc: 'Enable multi-timeframe trend alignment filter' },
    };
  }

  onKlineClose(kline) {
    const close = kline.close;
    this.state.closes.push(close);
    this.candleCount++;

    // Keep buffer manageable (only needed for initial warmup)
    const maxLen = this.getRequiredHistory() + 50;
    if (this.state.closes.length > maxLen) {
      this.state.closes = this.state.closes.slice(-maxLen);
    }

    if (this.state.closes.length < this.getRequiredHistory()) return null;
    this.warmupComplete = true;

    // Calculate indicators (incremental)
    const rsi = this._calcRSI(close);
    const macd = this._calcMACD(close);
    const hist = macd.histogram;
    const prevHist = this.state.prevHist;
    this.state.prevHist = hist;

    if (prevHist === null) return null;

    // Signal logic
    const histCrossUp = prevHist <= 0 && hist > 0;
    const histCrossDown = prevHist >= 0 && hist < 0;

    // LONG signal
    if (rsi < this.params.rsiOversold && histCrossUp) {
      let confidence = this._calcConfidence(rsi, this.params.rsiOversold, 'long');
      // Multi-timeframe filter
      if (this.params.useMultiTF && !this._checkTrendAlignment('long')) {
        confidence *= 0.7;
      }
      if (confidence >= this.params.minConfidence) {
        return this.openLong(confidence, `RSI ${rsi.toFixed(1)} oversold + MACD bullish cross`, {
          entry: kline.close,
          metadata: { rsi, macdHist: hist, prevHist },
        });
      }
    }

    // SHORT signal
    if (rsi > this.params.rsiOverbought && histCrossDown) {
      let confidence = this._calcConfidence(rsi, this.params.rsiOverbought, 'short');
      // Multi-timeframe filter
      if (this.params.useMultiTF && !this._checkTrendAlignment('short')) {
        confidence *= 0.7;
      }
      if (confidence >= this.params.minConfidence) {
        return this.openShort(confidence, `RSI ${rsi.toFixed(1)} overbought + MACD bearish cross`, {
          entry: kline.close,
          metadata: { rsi, macdHist: hist, prevHist },
        });
      }
    }

    return null;
  }

  _calcConfidence(rsi, threshold, direction) {
    // Stronger signal when RSI is further from threshold
    const distance = Math.abs(rsi - threshold);
    const maxDistance = direction === 'long' ? threshold : (100 - threshold);
    return Math.min(0.5 + (distance / maxDistance) * 0.5, 0.95);
  }

  /**
   * Incremental RSI using Wilder's smoothing.
   * First call with enough data uses simple average; subsequent calls use exponential smoothing.
   */
  _calcRSI(close) {
    const period = this.params.rsiPeriod;
    const prevClose = this.state.rsiPrevClose;
    this.state.rsiPrevClose = close;

    if (prevClose === null) return 50;

    const diff = close - prevClose;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    this.state.rsiCalcCount++;

    if (this.state.rsiAvgGain === null) {
      // Accumulate initial period
      if (!this.state._rsiGains) this.state._rsiGains = [];
      if (!this.state._rsiLosses) this.state._rsiLosses = [];
      this.state._rsiGains.push(gain);
      this.state._rsiLosses.push(loss);

      if (this.state._rsiGains.length >= period) {
        // First RSI: simple average
        this.state.rsiAvgGain = this.state._rsiGains.reduce((a, b) => a + b, 0) / period;
        this.state.rsiAvgLoss = this.state._rsiLosses.reduce((a, b) => a + b, 0) / period;
        delete this.state._rsiGains;
        delete this.state._rsiLosses;
      } else {
        return 50; // Not enough data yet
      }
    } else {
      // Wilder's smoothing
      this.state.rsiAvgGain = (this.state.rsiAvgGain * (period - 1) + gain) / period;
      this.state.rsiAvgLoss = (this.state.rsiAvgLoss * (period - 1) + loss) / period;
    }

    if (this.state.rsiAvgLoss === 0) return 100;
    const rs = this.state.rsiAvgGain / this.state.rsiAvgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Incremental MACD with proper signal line (EMA of MACD line history).
   */
  _calcMACD(close) {
    // Update running fast EMA
    this.state.emaFast = this._updateEma(close, this.state.emaFast, this.params.macdFast);
    // Update running slow EMA
    this.state.emaSlow = this._updateEma(close, this.state.emaSlow, this.params.macdSlow);

    const macdLine = this.state.emaFast - this.state.emaSlow;

    // Store MACD history for signal line calculation
    this.state.macdHistory.push(macdLine);

    // Signal line = EMA of MACD line values over signal period
    this.state.macdSignalEma = this._updateEma(
      macdLine, this.state.macdSignalEma, this.params.macdSignal
    );

    const signal = this.state.macdSignalEma;
    const histogram = macdLine - signal;

    // Trim MACD history to prevent unbounded growth
    if (this.state.macdHistory.length > this.params.macdSignal + 50) {
      this.state.macdHistory = this.state.macdHistory.slice(-this.params.macdSignal - 10);
    }

    return { macdLine, signal, histogram };
  }

  /**
   * Incremental EMA update. Maintains running value in state.
   * @param {number} value - new data point
   * @param {number|null} prevEma - previous EMA value (null = needs initialization)
   * @param {number} period - EMA period
   * @returns {number} updated EMA value
   */
  _updateEma(value, prevEma, period) {
    if (prevEma === null) {
      // Initialize from closes buffer if we have enough data
      const closes = this.state.closes;
      if (closes.length < period) return value;
      const seed = closes.slice(-(period)).reduce((a, b) => a + b, 0) / period;
      // Apply EMA from seed to current (but seed already includes current)
      return seed;
    }
    const k = 2 / (period + 1);
    return value * k + prevEma * (1 - k);
  }

  /** Reset state including incremental indicator state */
  reset() {
    super.reset();
    this.state = {
      closes: [],
      prevHist: null,
      emaFast: null,
      emaSlow: null,
      macdHistory: [],
      macdSignalEma: null,
      rsiAvgGain: null,
      rsiAvgLoss: null,
      rsiPrevClose: null,
      rsiCalcCount: 0,
    };
  }
}
