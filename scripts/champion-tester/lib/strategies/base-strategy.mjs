/**
 * BaseStrategy — abstract class all trading strategies must extend.
 * Defines the interface for the bot engine to interact with strategies.
 */
export class BaseStrategy {
  constructor(params = {}) {
    this.params = params;
    this.state = {};
    this.warmupComplete = false;
    this.candleCount = 0;
    // Multi-timeframe state
    this._higherTFData = {}; // { '1h': { closes: [], emaShort: null, emaLong: null } }
  }

  /** Human-readable strategy name */
  getName() { return 'base'; }

  /** Description for UI */
  getDescription() { return 'Base strategy (do not use directly)'; }

  /** Required WS streams, e.g. ['kline_15m', 'aggTrade'] */
  getRequiredStreams() { return ['kline_15m']; }

  /** Minimum candles needed before generating signals */
  getRequiredHistory() { return 50; }

  /** Default params with descriptions for UI */
  static getDefaultParams() { return {}; }

  /**
   * Called on each closed kline. Return signal or null.
   * @param {object} kline - { open, high, low, close, volume, openTime, closeTime }
   * @param {object} state - persistent state between calls
   * @returns {object|null} signal or null
   */
  onKlineClose(kline, state) {
    this.candleCount++;
    if (this.candleCount >= this.getRequiredHistory()) {
      this.warmupComplete = true;
    }
    return null;
  }

  /**
   * Called on real-time price updates (for SL/TP/trailing checks).
   * @param {number} price
   * @param {object} position - current open position if any
   * @returns {object|null} signal or null
   */
  onPriceUpdate(price, position) {
    return null;
  }

  /** Get serializable state for persistence */
  getState() { return { ...this.state }; }

  /** Restore state from persistence */
  setState(saved) { this.state = { ...saved }; }

  /** Reset all indicators and state */
  reset() {
    this.state = {};
    this.warmupComplete = false;
    this.candleCount = 0;
    this._higherTFData = {};
  }

  /** Check if strategy is warmed up */
  isReady() { return this.warmupComplete; }

  // ─── Multi-Timeframe Support ────────────────────────────────────

  /**
   * Returns higher timeframes to subscribe to for trend confirmation.
   * Override in subclass to customize.
   * @returns {string[]} e.g. ['1h', '4h']
   */
  getConfirmationTimeframes() {
    return [];
  }

  /**
   * Called when a higher timeframe kline closes.
   * Updates internal higher-TF EMA state for trend alignment checks.
   * @param {string} timeframe - e.g. '1h'
   * @param {object} kline - { open, high, low, close, volume, openTime, closeTime }
   */
  onHigherTFUpdate(timeframe, kline) {
    if (!this._higherTFData[timeframe]) {
      this._higherTFData[timeframe] = { closes: [], emaShort: null, emaLong: null, prevEmaShort: null };
    }
    const tf = this._higherTFData[timeframe];
    tf.closes.push(kline.close);

    // Maintain short (20) and long (50) EMAs on higher TF
    const shortPeriod = 20;
    const longPeriod = 50;

    tf.prevEmaShort = tf.emaShort;

    if (tf.closes.length >= shortPeriod) {
      if (tf.emaShort === null) {
        tf.emaShort = tf.closes.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
      } else {
        const k = 2 / (shortPeriod + 1);
        tf.emaShort = kline.close * k + tf.emaShort * (1 - k);
      }
    }

    if (tf.closes.length >= longPeriod) {
      if (tf.emaLong === null) {
        tf.emaLong = tf.closes.slice(-longPeriod).reduce((a, b) => a + b, 0) / longPeriod;
      } else {
        const k = 2 / (longPeriod + 1);
        tf.emaLong = kline.close * k + tf.emaLong * (1 - k);
      }
    }

    // Trim closes buffer
    if (tf.closes.length > longPeriod + 10) {
      tf.closes = tf.closes.slice(-longPeriod);
    }
  }

  /**
   * Check if higher timeframe trend agrees with signal direction.
   * @param {'long'|'short'} direction
   * @returns {boolean} true if aligned or no higher TF data available
   */
  _checkTrendAlignment(direction) {
    const timeframes = this.getConfirmationTimeframes();
    if (timeframes.length === 0) return true;

    for (const tf of timeframes) {
      const data = this._higherTFData[tf];
      if (!data || data.emaShort === null || data.prevEmaShort === null) continue;

      // Check EMA slope direction
      const slope = data.emaShort - data.prevEmaShort;

      if (direction === 'long' && slope < 0) return false;
      if (direction === 'short' && slope > 0) return false;
    }

    return true;
  }

  // ─── Signal Helpers ─────────────────────────────────────────────

  _signal(action, confidence, reason, opts = {}) {
    return {
      action,           // OPEN_LONG | OPEN_SHORT | CLOSE_LONG | CLOSE_SHORT
      confidence,       // 0-1
      reason,           // human-readable
      suggestedEntry: opts.entry || null,
      suggestedSL: opts.sl || null,
      suggestedTP: opts.tp || null,
      metadata: opts.metadata || {},
      timestamp: Date.now(),
    };
  }

  openLong(confidence, reason, opts) {
    return this._signal('OPEN_LONG', confidence, reason, opts);
  }

  openShort(confidence, reason, opts) {
    return this._signal('OPEN_SHORT', confidence, reason, opts);
  }

  closeLong(confidence, reason, opts) {
    return this._signal('CLOSE_LONG', confidence, reason, opts);
  }

  closeShort(confidence, reason, opts) {
    return this._signal('CLOSE_SHORT', confidence, reason, opts);
  }
}
