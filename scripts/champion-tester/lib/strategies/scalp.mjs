import { BaseStrategy } from './base-strategy.mjs';

/**
 * Scalp Strategy — VWAP deviation + volume imbalance.
 * 
 * Entry LONG: Price < VWAP by threshold + buy volume dominance
 * Entry SHORT: Price > VWAP by threshold + sell volume dominance
 * Fast exits with tight SL/TP.
 */
export class ScalpStrategy extends BaseStrategy {
  constructor(params = {}) {
    super(params);
    this.params = {
      vwapDeviation: params.vwapDeviation || 0.3,
      volumeImbalance: params.volumeImbalance || 1.3,
      lookback: params.lookback || 20,
      minConfidence: params.minConfidence || 0.65,
      ...params,
    };
    this.state = { closes: [], volumes: [], highs: [], lows: [], typicalPrices: [], cumVP: 0, cumVol: 0 };
  }

  getName() { return 'scalp'; }
  getDescription() { return 'VWAP deviation scalping with volume imbalance'; }
  getRequiredStreams() { return [`kline_${this.params.timeframe || '5m'}`]; }
  getRequiredHistory() { return this.params.lookback + 5; }

  static getDefaultParams() {
    return {
      vwapDeviation: { default: 0.3, min: 0.1, max: 1.0, desc: 'VWAP deviation % for entry' },
      volumeImbalance: { default: 1.3, min: 1.1, max: 2.5, desc: 'Buy/sell volume ratio threshold' },
      lookback: { default: 20, min: 10, max: 50, desc: 'Candles for VWAP calculation' },
      minConfidence: { default: 0.65, min: 0.4, max: 0.95, desc: 'Minimum signal confidence' },
    };
  }

  onKlineClose(kline) {
    const tp = (kline.high + kline.low + kline.close) / 3;
    this.state.closes.push(kline.close);
    this.state.volumes.push(kline.volume);
    this.state.highs.push(kline.high);
    this.state.lows.push(kline.low);
    this.state.typicalPrices.push(tp);
    this.candleCount++;

    const maxLen = this.params.lookback + 30;
    if (this.state.closes.length > maxLen) {
      this.state.closes = this.state.closes.slice(-maxLen);
      this.state.volumes = this.state.volumes.slice(-maxLen);
      this.state.highs = this.state.highs.slice(-maxLen);
      this.state.lows = this.state.lows.slice(-maxLen);
      this.state.typicalPrices = this.state.typicalPrices.slice(-maxLen);
    }

    if (this.state.closes.length < this.getRequiredHistory()) return null;
    this.warmupComplete = true;

    const vwap = this._calcVWAP();
    const deviation = ((kline.close - vwap) / vwap) * 100;
    const buyPressure = this._calcBuyPressure();

    // LONG: price below VWAP + buy pressure
    if (deviation < -this.params.vwapDeviation && buyPressure > this.params.volumeImbalance) {
      const confidence = this._calcConfidence(Math.abs(deviation), buyPressure);
      if (confidence >= this.params.minConfidence) {
        return this.openLong(confidence, `Price ${deviation.toFixed(2)}% below VWAP, buy pressure ${buyPressure.toFixed(2)}x`, {
          entry: kline.close,
          sl: kline.low - (kline.high - kline.low) * 0.5,
          tp: vwap,
          metadata: { vwap, deviation, buyPressure },
        });
      }
    }

    // SHORT: price above VWAP + sell pressure
    if (deviation > this.params.vwapDeviation && buyPressure < (1 / this.params.volumeImbalance)) {
      const confidence = this._calcConfidence(Math.abs(deviation), 1 / buyPressure);
      if (confidence >= this.params.minConfidence) {
        return this.openShort(confidence, `Price +${deviation.toFixed(2)}% above VWAP, sell pressure ${(1/buyPressure).toFixed(2)}x`, {
          entry: kline.close,
          sl: kline.high + (kline.high - kline.low) * 0.5,
          tp: vwap,
          metadata: { vwap, deviation, buyPressure },
        });
      }
    }

    return null;
  }

  _calcVWAP() {
    const lookback = this.params.lookback;
    const tps = this.state.typicalPrices.slice(-lookback);
    const vols = this.state.volumes.slice(-lookback);
    let cumVP = 0, cumVol = 0;
    for (let i = 0; i < tps.length; i++) {
      cumVP += tps[i] * vols[i];
      cumVol += vols[i];
    }
    return cumVol > 0 ? cumVP / cumVol : tps[tps.length - 1];
  }

  _calcBuyPressure() {
    // Approximate buy vs sell volume using candle body position
    const lookback = Math.min(5, this.state.closes.length);
    let buyVol = 0, sellVol = 0;
    const start = this.state.closes.length - lookback;

    for (let i = start; i < this.state.closes.length; i++) {
      const range = this.state.highs[i] - this.state.lows[i];
      if (range === 0) { buyVol += 0.5; sellVol += 0.5; continue; }
      const bodyRatio = (this.state.closes[i] - this.state.lows[i]) / range;
      buyVol += this.state.volumes[i] * bodyRatio;
      sellVol += this.state.volumes[i] * (1 - bodyRatio);
    }

    return sellVol > 0 ? buyVol / sellVol : 1;
  }

  _calcConfidence(deviation, pressure) {
    const devStrength = Math.min(deviation / (this.params.vwapDeviation * 3), 0.4);
    const pressureStrength = Math.min((pressure - 1) / 2, 0.4);
    return Math.min(0.5 + devStrength + pressureStrength, 0.95);
  }
}
