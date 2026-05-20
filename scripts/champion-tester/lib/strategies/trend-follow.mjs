import { BaseStrategy } from './base-strategy.mjs';

/**
 * Trend Follow Strategy — EMA crossover (9/21/55) + ADX filter.
 * 
 * Entry LONG: Fast EMA > Medium EMA > Slow EMA + ADX > threshold
 * Entry SHORT: Fast EMA < Medium EMA < Slow EMA + ADX > threshold
 * Exit: EMA alignment breaks
 */
export class TrendFollowStrategy extends BaseStrategy {
  constructor(params = {}) {
    super(params);
    this.params = {
      fastPeriod: params.fastPeriod || 9,
      mediumPeriod: params.mediumPeriod || 21,
      slowPeriod: params.slowPeriod || 55,
      adxPeriod: params.adxPeriod || 14,
      adxThreshold: params.adxThreshold || 25,
      minConfidence: params.minConfidence || 0.6,
      ...params,
    };
    this.state = { closes: [], highs: [], lows: [], prevTrend: null };
  }

  getName() { return 'trend-follow'; }
  getDescription() { return 'EMA crossover trend following with ADX strength filter'; }
  getRequiredStreams() { return [`kline_${this.params.timeframe || '15m'}`]; }
  getRequiredHistory() { return this.params.slowPeriod + this.params.adxPeriod + 5; }

  static getDefaultParams() {
    return {
      fastPeriod: { default: 9, min: 3, max: 20, desc: 'Fast EMA period' },
      mediumPeriod: { default: 21, min: 10, max: 40, desc: 'Medium EMA period' },
      slowPeriod: { default: 55, min: 30, max: 100, desc: 'Slow EMA period' },
      adxPeriod: { default: 14, min: 7, max: 30, desc: 'ADX calculation period' },
      adxThreshold: { default: 25, min: 15, max: 40, desc: 'Min ADX for trend confirmation' },
      minConfidence: { default: 0.6, min: 0.3, max: 0.95, desc: 'Minimum signal confidence' },
    };
  }

  onKlineClose(kline) {
    this.state.closes.push(kline.close);
    this.state.highs.push(kline.high);
    this.state.lows.push(kline.low);
    this.candleCount++;

    const maxLen = this.getRequiredHistory() + 50;
    if (this.state.closes.length > maxLen) {
      this.state.closes = this.state.closes.slice(-maxLen);
      this.state.highs = this.state.highs.slice(-maxLen);
      this.state.lows = this.state.lows.slice(-maxLen);
    }

    if (this.state.closes.length < this.getRequiredHistory()) return null;
    this.warmupComplete = true;

    const fastEMA = this._ema(this.state.closes, this.params.fastPeriod);
    const medEMA = this._ema(this.state.closes, this.params.mediumPeriod);
    const slowEMA = this._ema(this.state.closes, this.params.slowPeriod);
    const adx = this._calcADX();

    // Determine trend
    const bullish = fastEMA > medEMA && medEMA > slowEMA;
    const bearish = fastEMA < medEMA && medEMA < slowEMA;
    const trending = adx >= this.params.adxThreshold;

    let currentTrend = null;
    if (bullish && trending) currentTrend = 'long';
    else if (bearish && trending) currentTrend = 'short';

    const prevTrend = this.state.prevTrend;
    this.state.prevTrend = currentTrend;

    // Signal on trend change only
    if (currentTrend === prevTrend) return null;

    if (currentTrend === 'long' && prevTrend !== 'long') {
      const confidence = this._calcConfidence(adx, fastEMA, medEMA, slowEMA);
      if (confidence >= this.params.minConfidence) {
        // Close short if we were short
        if (prevTrend === 'short') {
          return this.closeLong(confidence, `Trend reversal: EMAs aligned bullish, ADX ${adx.toFixed(1)}`, {
            entry: kline.close,
            metadata: { fastEMA, medEMA, slowEMA, adx },
          });
        }
        return this.openLong(confidence, `Bullish trend: EMA 9>${medEMA.toFixed(0)}>${slowEMA.toFixed(0)}, ADX ${adx.toFixed(1)}`, {
          entry: kline.close,
          sl: medEMA,
          metadata: { fastEMA, medEMA, slowEMA, adx },
        });
      }
    }

    if (currentTrend === 'short' && prevTrend !== 'short') {
      const confidence = this._calcConfidence(adx, fastEMA, medEMA, slowEMA);
      if (confidence >= this.params.minConfidence) {
        if (prevTrend === 'long') {
          return this.closeShort(confidence, `Trend reversal: EMAs aligned bearish, ADX ${adx.toFixed(1)}`, {
            entry: kline.close,
            metadata: { fastEMA, medEMA, slowEMA, adx },
          });
        }
        return this.openShort(confidence, `Bearish trend: EMA 9<${medEMA.toFixed(0)}<${slowEMA.toFixed(0)}, ADX ${adx.toFixed(1)}`, {
          entry: kline.close,
          sl: medEMA,
          metadata: { fastEMA, medEMA, slowEMA, adx },
        });
      }
    }

    return null;
  }

  _calcConfidence(adx, fast, med, slow) {
    // Higher ADX = stronger trend = higher confidence
    const adxStrength = Math.min((adx - this.params.adxThreshold) / 30, 0.4);
    // Wider EMA spread = stronger signal
    const spread = Math.abs(fast - slow) / slow;
    const spreadStrength = Math.min(spread * 10, 0.4);
    return Math.min(0.5 + adxStrength + spreadStrength, 0.95);
  }

  _calcADX() {
    const period = this.params.adxPeriod;
    const highs = this.state.highs;
    const lows = this.state.lows;
    const closes = this.state.closes;
    const len = closes.length;

    if (len < period * 2) return 0;

    // Simplified ADX calculation
    let plusDM = 0, minusDM = 0, tr = 0;

    for (let i = len - period; i < len; i++) {
      const highDiff = highs[i] - highs[i - 1];
      const lowDiff = lows[i - 1] - lows[i];

      if (highDiff > lowDiff && highDiff > 0) plusDM += highDiff;
      if (lowDiff > highDiff && lowDiff > 0) minusDM += lowDiff;

      const hl = highs[i] - lows[i];
      const hc = Math.abs(highs[i] - closes[i - 1]);
      const lc = Math.abs(lows[i] - closes[i - 1]);
      tr += Math.max(hl, hc, lc);
    }

    if (tr === 0) return 0;
    const plusDI = (plusDM / tr) * 100;
    const minusDI = (minusDM / tr) * 100;
    const diSum = plusDI + minusDI;
    if (diSum === 0) return 0;
    const dx = Math.abs(plusDI - minusDI) / diSum * 100;
    return dx; // Simplified: return DX as ADX approximation
  }

  _ema(data, period) {
    if (data.length < period) return data[data.length - 1];
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return ema;
  }
}
