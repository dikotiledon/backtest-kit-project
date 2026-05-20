import { BaseStrategy } from './base-strategy.mjs';
import {
  ema, atr, rsi, adx, supertrend, engulfing, pivotHigh, pivotLow,
} from './indicators.mjs';

/**
 * ChampionBridge Strategy — translates autoresearch champion config
 * into live trading signals using the same indicator logic as the Pine Script.
 *
 * Reads champion.json config and reproduces:
 * - Signal Fusion V4 (prediction scoring with weighted confirmations)
 * - ADX trend filter
 * - Supertrend filter
 * - ATR-based SL/TP
 * - Trailing stop with activation threshold
 * - RSI divergence context boost
 * - Post-entry squeeze collapse tightening
 * - Engulfing pattern confirmation
 * - Minimum bars between trades
 */
export class ChampionBridgeStrategy extends BaseStrategy {
  constructor(params = {}) {
    super(params);
    // Champion config is passed directly
    this.cfg = params.championConfig || {};
    this.state = {
      candles: [],
      lastEntryBar: -999,
      position: null, // null | { side, entryPrice, entryBar, trailStop, activated }
    };
  }

  getName() { return 'champion-bridge'; }
  getDescription() { return `Autoresearch champion: ${this.params.label || 'unknown'}`; }
  getRequiredStreams() { return [`kline_${this.params.timeframe || '15m'}`]; }
  getRequiredHistory() { return 60; } // Need enough bars for indicators

  static getDefaultParams() {
    return {
      championConfig: { default: {}, desc: 'Champion config object from champion.json' },
      label: { default: '', desc: 'Champion label' },
      matrixId: { default: '', desc: 'Autoresearch matrix ID' },
    };
  }

  onKlineClose(kline) {
    this.state.candles.push(kline);
    this.candleCount++;

    // Keep buffer manageable
    if (this.state.candles.length > 200) {
      this.state.candles = this.state.candles.slice(-200);
    }

    if (this.state.candles.length < this.getRequiredHistory()) return null;
    this.warmupComplete = true;

    const candles = this.state.candles;
    const len = candles.length;
    const idx = len - 1;
    const cfg = this.cfg;

    // Extract OHLCV arrays
    const opens = candles.map(c => c.open);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    // ─── Compute Indicators ───────────────────────────────────

    const atrValues = atr(highs, lows, closes, 14);
    const currentATR = atrValues[idx];
    if (!currentATR || currentATR === 0) return null;

    // ADX Filter
    let adxPass = true;
    if (cfg.useAdxFilter) {
      const adxResult = adx(highs, lows, closes, 14);
      const currentADX = adxResult.adx[idx];
      adxPass = currentADX !== null && currentADX >= (cfg.adxThreshold || 20);
    }

    // Supertrend Filter
    let supertrendDir = 0;
    if (cfg.useSupertrendFilter) {
      const stResult = supertrend(
        highs, lows, closes,
        cfg.supertrendAtrLen || 10,
        cfg.supertrendFactor || 1.5
      );
      supertrendDir = stResult.trend[idx]; // 1 = bullish, -1 = bearish
    }

    // Engulfing patterns
    let engulfSignal = 0;
    if (cfg.useEngulfingConfirm) {
      const engulfResult = engulfing(opens, highs, lows, closes);
      engulfSignal = engulfResult[idx]; // 1 = bullish, -1 = bearish
    }

    // ATR flip (direction change)
    let atrFlipLong = false, atrFlipShort = false;
    if (cfg.useAtrFlipConfirm && idx >= 2) {
      const prevATRDir = closes[idx - 1] - closes[idx - 2];
      const currATRDir = closes[idx] - closes[idx - 1];
      atrFlipLong = prevATRDir <= 0 && currATRDir > 0;
      atrFlipShort = prevATRDir >= 0 && currATRDir < 0;
    }

    // ─── Signal Fusion V4 ─────────────────────────────────────

    if (!cfg.useSignalFusion || !cfg.useFusionV4) return null;

    // Base prediction (simplified: use price momentum as proxy)
    const momentum = this._calcMomentum(closes, idx);

    // Long prediction score
    let longPred = momentum;
    if (cfg.fusionV4LongAtrWeight && atrFlipLong) longPred += cfg.fusionV4LongAtrWeight;
    if (cfg.fusionV4LongEngulfWeight && engulfSignal === 1) longPred += cfg.fusionV4LongEngulfWeight;

    // Short prediction score
    let shortPred = -momentum;
    if (cfg.fusionV4ShortAtrWeight && atrFlipShort) shortPred += cfg.fusionV4ShortAtrWeight;
    if (cfg.fusionV4ShortEngulfWeight && engulfSignal === -1) shortPred += cfg.fusionV4ShortEngulfWeight;

    // Prediction thresholds
    const minPred = cfg.fusionV4MinAbsPrediction || 2;
    const maxPred = cfg.fusionV4MaxAbsPrediction || 4;

    // Minimum bars between entries
    const minBars = cfg.minBarsBetween || 1;
    const barsSinceEntry = idx - this.state.lastEntryBar;
    if (barsSinceEntry < minBars) return null;

    // ─── Generate Signals ─────────────────────────────────────

    let signal = null;

    // LONG signal
    if (longPred >= minPred && longPred <= maxPred && adxPass) {
      // Supertrend must be bullish (or disabled)
      if (!cfg.useSupertrendFilter || supertrendDir === 1) {
        // Divergence boost
        let confidence = this._predToConfidence(longPred, minPred, maxPred);
        if (cfg.useDivergenceContext) {
          const divBoost = this._checkBullishDivergence(closes, idx, cfg);
          if (divBoost) confidence = Math.min(confidence + 0.1, 0.95);
        }

        const slPrice = closes[idx] - (cfg.slAtrMult || 1.5) * currentATR;
        const tpPrice = closes[idx] + (cfg.tpAtrMult || 3.0) * currentATR;

        signal = this.openLong(confidence, `FusionV4 LONG pred=${longPred.toFixed(2)} ADX=${adxPass}`, {
          entry: closes[idx],
          sl: slPrice,
          tp: tpPrice,
          metadata: { longPred, shortPred, atrFlipLong, engulfSignal, supertrendDir },
        });

        this.state.lastEntryBar = idx;
      }
    }

    // SHORT signal
    if (!signal && shortPred >= minPred && shortPred <= maxPred && adxPass) {
      if (!cfg.useSupertrendFilter || supertrendDir === -1) {
        let confidence = this._predToConfidence(shortPred, minPred, maxPred);
        if (cfg.useDivergenceContext) {
          const divBoost = this._checkBearishDivergence(closes, idx, cfg);
          if (divBoost) confidence = Math.min(confidence + 0.1, 0.95);
        }

        const slPrice = closes[idx] + (cfg.slAtrMult || 1.5) * currentATR;
        const tpPrice = closes[idx] - (cfg.tpAtrMult || 3.0) * currentATR;

        signal = this.openShort(confidence, `FusionV4 SHORT pred=${shortPred.toFixed(2)} ADX=${adxPass}`, {
          entry: closes[idx],
          sl: slPrice,
          tp: tpPrice,
          metadata: { longPred, shortPred, atrFlipShort, engulfSignal, supertrendDir },
        });

        this.state.lastEntryBar = idx;
      }
    }

    return signal;
  }

  // ─── Position Monitoring (trailing stop) ────────────────────

  onPriceUpdate(price, position) {
    if (!position) return null;
    if (!this.cfg.useTrailingStop) return null;

    const cfg = this.cfg;
    const candles = this.state.candles;
    if (candles.length < 14) return null;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const atrValues = atr(highs, lows, closes, cfg.trailAtrLen || 14);
    const currentATR = atrValues[atrValues.length - 1];
    if (!currentATR) return null;

    const trailMult = cfg.trailAtrMult || 1.0;
    const activateR = cfg.trailActivateR || 0.5;

    // Check if trailing should activate
    const entryPrice = position.entryPrice;
    const isLong = position.side === 'LONG';
    const rMultiple = isLong
      ? (price - entryPrice) / (currentATR * (cfg.slAtrMult || 1.5))
      : (entryPrice - price) / (currentATR * (cfg.slAtrMult || 1.5));

    if (rMultiple < activateR) return null; // Not yet activated

    // Trailing stop level
    const trailStop = isLong
      ? price - trailMult * currentATR
      : price + trailMult * currentATR;

    // Post-entry squeeze collapse tightening
    let effectiveTrail = trailStop;
    if (cfg.usePostEntrySqueezeCollapseTighten) {
      const barsSinceEntry = candles.length - 1 - this.state.lastEntryBar;
      if (barsSinceEntry >= (cfg.postEntrySqueezeCollapseBars || 6)) {
        const tighterMult = cfg.postEntrySqueezeCollapseTrailAtrMult || 0.5;
        effectiveTrail = isLong
          ? price - tighterMult * currentATR
          : price + tighterMult * currentATR;
      }
    }

    // Check if price hit trailing stop
    if (isLong && price <= effectiveTrail) {
      return this.closeLong(0.9, `Trailing stop hit at ${effectiveTrail.toFixed(2)}`, {
        metadata: { trailStop: effectiveTrail, rMultiple },
      });
    }
    if (!isLong && price >= effectiveTrail) {
      return this.closeShort(0.9, `Trailing stop hit at ${effectiveTrail.toFixed(2)}`, {
        metadata: { trailStop: effectiveTrail, rMultiple },
      });
    }

    return null;
  }

  // ─── Helpers ────────────────────────────────────────────────

  _calcMomentum(closes, idx) {
    // Multi-timeframe momentum proxy using rate of change
    if (idx < 10) return 0;
    const roc5 = (closes[idx] - closes[idx - 5]) / closes[idx - 5] * 100;
    const roc10 = (closes[idx] - closes[idx - 10]) / closes[idx - 10] * 100;
    // Normalize to prediction-like scale (0-5)
    return (roc5 * 2 + roc10) / 3 * 10;
  }

  _predToConfidence(pred, minPred, maxPred) {
    // Map prediction score to 0.5-0.95 confidence
    const range = maxPred - minPred;
    if (range === 0) return 0.7;
    const normalized = (pred - minPred) / range;
    return Math.min(0.5 + normalized * 0.45, 0.95);
  }

  _checkBullishDivergence(closes, idx, cfg) {
    const rsiValues = rsi(closes, cfg.divRsiLen || 21);
    const freshBars = cfg.divFreshBars || 8;
    if (idx < freshBars + 5) return false;

    // Simple divergence: price making lower low but RSI making higher low
    const recentLows = closes.slice(idx - freshBars, idx + 1);
    const recentRsi = rsiValues.slice(idx - freshBars, idx + 1);
    const priceLow = Math.min(...recentLows);
    const priceIdx = recentLows.indexOf(priceLow);

    if (priceIdx > 0 && priceIdx < recentLows.length - 1) {
      // Check if RSI at price low is higher than previous RSI low
      const prevRsiLow = Math.min(...recentRsi.slice(0, priceIdx).filter(v => v !== null));
      const currRsiAtLow = recentRsi[priceIdx];
      if (currRsiAtLow !== null && prevRsiLow !== Infinity && currRsiAtLow > prevRsiLow) {
        return true;
      }
    }
    return false;
  }

  _checkBearishDivergence(closes, idx, cfg) {
    const rsiValues = rsi(closes, cfg.divRsiLen || 21);
    const freshBars = cfg.divFreshBars || 8;
    if (idx < freshBars + 5) return false;

    const recentHighs = closes.slice(idx - freshBars, idx + 1);
    const recentRsi = rsiValues.slice(idx - freshBars, idx + 1);
    const priceHigh = Math.max(...recentHighs);
    const priceIdx = recentHighs.indexOf(priceHigh);

    if (priceIdx > 0 && priceIdx < recentHighs.length - 1) {
      const prevRsiHigh = Math.max(...recentRsi.slice(0, priceIdx).filter(v => v !== null));
      const currRsiAtHigh = recentRsi[priceIdx];
      if (currRsiAtHigh !== null && prevRsiHigh !== -Infinity && currRsiAtHigh < prevRsiHigh) {
        return true;
      }
    }
    return false;
  }
}
