import { EventEmitter } from 'node:events';
import { getRiskManager } from './risk-manager.mjs';
import { getBotManager } from './bot-manager.mjs';

/**
 * FundingTracker — monitors funding rates for futures positions.
 * Calculates funding payments every 8h and includes them in PnL.
 * Subscribes to markPrice:update events from MarketDataService.
 */
class FundingTracker extends EventEmitter {
  constructor() {
    super();
    this.rates = new Map(); // 'market:symbol' -> { rate, nextFundingTime, lastUpdated }
    this.fundingHistory = []; // { botId, symbol, market, rate, payment, timestamp }
    this._trackedSymbols = new Set(); // 'market:symbol'
    this._checkInterval = null;
    this._started = false;
    this._processedFundings = new Set(); // 'market:symbol:timestamp' to avoid duplicates
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  start(markets = ['usdm']) {
    if (this._started) return { ok: true, already: true };

    // Start periodic check for funding payments (every 60s)
    this._checkInterval = setInterval(() => this._checkFundingPayments(), 60_000);
    this._started = true;

    this.emit('funding:started', { markets });
    return { ok: true, markets };
  }

  stop() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
    this._started = false;
    this._trackedSymbols.clear();
    this.rates.clear();
    this._processedFundings.clear();
    this.emit('funding:stopped', {});
  }

  isStarted() {
    return this._started;
  }

  // ─── Symbol Tracking ────────────────────────────────────────────

  trackSymbol(symbol, market = 'usdm') {
    const key = `${market}:${symbol}`;
    this._trackedSymbols.add(key);
  }

  untrackSymbol(symbol, market = 'usdm') {
    const key = `${market}:${symbol}`;
    this._trackedSymbols.delete(key);
    // Keep rates data for reference, just stop tracking
  }

  getTrackedSymbols() {
    return [...this._trackedSymbols];
  }

  // ─── Rate Queries ───────────────────────────────────────────────

  getCurrentRate(symbol, market = 'usdm') {
    const key = `${market}:${symbol}`;
    const data = this.rates.get(key);
    return data ? data.rate : null;
  }

  getNextFundingTime(symbol, market = 'usdm') {
    const key = `${market}:${symbol}`;
    const data = this.rates.get(key);
    return data ? data.nextFundingTime : null;
  }

  getAllRates() {
    const result = {};
    for (const [key, data] of this.rates) {
      result[key] = { ...data };
    }
    return result;
  }

  // ─── Payment Calculation ────────────────────────────────────────

  /**
   * Calculate what the next funding payment would be.
   * Payment = positionSize × fundingRate
   * Positive rate: longs pay shorts. Negative rate: shorts pay longs.
   * Returns negative for payments made, positive for payments received.
   */
  calculateFundingPayment(symbol, market, positionSize, direction) {
    const rate = this.getCurrentRate(symbol, market);
    if (rate === null) return null;

    // For longs: payment = -positionSize * rate (positive rate = longs pay)
    // For shorts: payment = positionSize * rate (positive rate = shorts receive)
    if (direction === 'LONG') {
      return -positionSize * rate;
    } else {
      return positionSize * rate;
    }
  }

  /**
   * Get accumulated funding payments for a specific bot.
   */
  getAccumulatedFunding(botId) {
    const botHistory = this.fundingHistory.filter(h => h.botId === botId);
    const total = botHistory.reduce((sum, h) => sum + h.payment, 0);
    return {
      total,
      count: botHistory.length,
      history: botHistory,
    };
  }

  // ─── Event Handling ─────────────────────────────────────────────

  /**
   * Called when markPrice:update is received from MarketDataService.
   * Updates the rates map for tracked symbols.
   */
  onMarkPriceUpdate(data) {
    const { symbol, market, fundingRate, nextFundingTime } = data;
    const key = `${market}:${symbol}`;

    // Only track symbols we care about
    if (!this._trackedSymbols.has(key)) return;

    this.rates.set(key, {
      rate: fundingRate,
      nextFundingTime,
      lastUpdated: Date.now(),
    });
  }

  // ─── Internal: Funding Payment Detection ────────────────────────

  _checkFundingPayments() {
    const now = Date.now();

    for (const [key, data] of this.rates) {
      if (!this._trackedSymbols.has(key)) continue;
      if (!data.nextFundingTime) continue;

      // Check if funding time has passed
      if (now < data.nextFundingTime) continue;

      // Deduplicate: don't process same funding event twice
      const dedupeKey = `${key}:${data.nextFundingTime}`;
      if (this._processedFundings.has(dedupeKey)) continue;
      this._processedFundings.add(dedupeKey);

      // Clean old deduplication entries (keep last 500)
      if (this._processedFundings.size > 500) {
        const entries = [...this._processedFundings];
        this._processedFundings = new Set(entries.slice(-250));
      }

      const [market, symbol] = key.split(':');
      this._processFundingForSymbol(symbol, market, data.rate, now);
    }
  }

  _processFundingForSymbol(symbol, market, rate, timestamp) {
    const mgr = getBotManager();
    const rm = getRiskManager();

    for (const [botId, bot] of mgr.bots) {
      if (!bot.position) continue;
      if (bot.config.symbol !== symbol) continue;
      if (bot.config.market !== market) continue;

      const direction = bot.position.side; // 'LONG' or 'SHORT'
      const positionSize = bot.position.quantity * (bot.position.entryPrice || 0);

      if (positionSize <= 0) continue;

      const payment = this.calculateFundingPayment(symbol, market, positionSize, direction);
      if (payment === null) continue;

      // Record funding payment
      const record = {
        botId,
        symbol,
        market,
        rate,
        payment,
        direction,
        timestamp,
      };

      this.fundingHistory.push(record);

      // Cap history at 10000 entries
      if (this.fundingHistory.length > 10000) {
        this.fundingHistory = this.fundingHistory.slice(-5000);
      }

      // Register with risk manager for PnL tracking
      rm.registerPnL(payment, botId);

      // Emit event
      this.emit('funding:payment', record);
    }
  }
}

// Singleton
let _ft = null;
export function getFundingTracker() {
  if (!_ft) _ft = new FundingTracker();
  return _ft;
}

export { FundingTracker };
