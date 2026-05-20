import { BaseStrategy } from './base-strategy.mjs';

/**
 * Breakout Strategy — Bollinger Band squeeze + volume spike.
 * 
 * Entry LONG: Price breaks above upper BB after squeeze + volume > 1.5x avg
 * Entry SHORT: Price breaks below lower BB after squeeze + volume > 1.5x avg
 * Squeeze: BB width < threshold (low volatility compression)
 */
export class BreakoutStrategy extends BaseStrategy {
  constructor(params = {}) {
    super(params);
    this.params = {
      bbPeriod: params.bbPeriod || 20,
      bbStdDev: params.bbStdDev || 2.0,
      squeezeThreshold: params.squeezeThreshold || 0.02,
      volumeMultiplier: params.volumeMultiplier || 1.5,
      minConfidence: params.minConfidence || 0.6,
      ...params,
    };
    this.state = { closes: [], volumes: [], wasSqueezing: false };
  }

  getName() { return 'breakout'; }
  getDescription() { return 'Bollinger Band squeeze breakout with volume confirmation'; }
  getRequiredStreams() { return [`kline_${this.params.timeframe || '15m'}`]; }
  getRequiredHistory() { return this.params.bbPeriod + 10; }

  static getDefaultParams() {
    return {
      bbPeriod: { default: 20, min: 10, max: 50, desc: 'Bollinger Band period' },
      bbStdDev: { default: 2.0, min: 1.0, max: 3.5, desc: 'BB standard deviation multiplier' },
      squeezeThreshold: { default: 0.02, min: 0.005, max: 0.05, desc: 'BB width squeeze threshold (ratio)' },
      volumeMultiplier: { default: 1.5, min: 1.1, max: 3.0, desc: 'Volume spike multiplier vs average' },
      minConfidence: { default: 0.6, min: 0.3, max: 0.95, desc: 'Minimum signal confidence' },
    };
  }

  onKlineClose(kline) {
    this.state.closes.push(kline.close);
    this.state.volumes.push(kline.volume);
    this.candleCount++;

    const maxLen = this.params.bbPeriod + 50;
    if (this.state.closes.length > maxLen) {
      this.state.closes = this.state.closes.slice(-maxLen);
      this.state.volumes = this.state.volumes.slice(-maxLen);
    }

    if (this.state.closes.length < this.getRequiredHistory()) return null;
    this.warmupComplete = true;

    const { upper, lower, middle, width } = this._calcBB();
    const avgVolume = this._avgVolume(this.params.bbPeriod);
    const currentVolume = kline.volume;
    const volumeSpike = currentVolume > avgVolume * this.params.volumeMultiplier;
    const isSqueeze = width < this.params.squeezeThreshold;

    // Detect squeeze release
    const wasSqueeze = this.state.wasSqueezing;
    this.state.wasSqueezing = isSqueeze;

    // Need: was squeezing + now breaking out + volume confirms
    if (!wasSqueeze) return null;
    if (!volumeSpike) return null;

    // Breakout above upper band
    if (kline.close > upper) {
      const confidence = this._calcConfidence(kline.close, upper, currentVolume, avgVolume);
      if (confidence >= this.params.minConfidence) {
        return this.openLong(confidence, `BB breakout above ${upper.toFixed(2)} + volume ${(currentVolume/avgVolume).toFixed(1)}x`, {
          entry: kline.close,
          sl: middle,
          metadata: { upper, lower, middle, width, volumeRatio: currentVolume / avgVolume },
        });
      }
    }

    // Breakout below lower band
    if (kline.close < lower) {
      const confidence = this._calcConfidence(lower, kline.close, currentVolume, avgVolume);
      if (confidence >= this.params.minConfidence) {
        return this.openShort(confidence, `BB breakout below ${lower.toFixed(2)} + volume ${(currentVolume/avgVolume).toFixed(1)}x`, {
          entry: kline.close,
          sl: middle,
          metadata: { upper, lower, middle, width, volumeRatio: currentVolume / avgVolume },
        });
      }
    }

    return null;
  }

  _calcBB() {
    const period = this.params.bbPeriod;
    const closes = this.state.closes.slice(-period);
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    const upper = mean + stdDev * this.params.bbStdDev;
    const lower = mean - stdDev * this.params.bbStdDev;
    const width = (upper - lower) / mean;
    return { upper, lower, middle: mean, width, stdDev };
  }

  _avgVolume(period) {
    const vols = this.state.volumes.slice(-period);
    return vols.reduce((a, b) => a + b, 0) / vols.length;
  }

  _calcConfidence(breakPrice, bandPrice, volume, avgVolume) {
    const priceStrength = Math.min(Math.abs(breakPrice - bandPrice) / bandPrice * 100, 2) / 2;
    const volumeStrength = Math.min((volume / avgVolume - 1) / 2, 1);
    return Math.min(0.5 + priceStrength * 0.25 + volumeStrength * 0.25, 0.95);
  }
}
