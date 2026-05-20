import { EventEmitter } from 'node:events';

/**
 * SlippageEstimator — models realistic fill prices for market orders.
 * Tracks historical slippage per symbol to improve estimates over time.
 * Singleton via getSlippageEstimator().
 */
class SlippageEstimator extends EventEmitter {
  constructor() {
    super();
    this.history = new Map(); // 'market:symbol' -> array of records
    this.liquidPairs = new Set([
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
      'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
    ]);
    this.maxHistoryPerSymbol = 100;
  }

  /**
   * Get the map key for a symbol+market pair.
   */
  _key(symbol, market) {
    return `${market}:${symbol}`;
  }

  /**
   * Estimate slippage for a market order.
   * @param {string} symbol - e.g. 'BTCUSDT'
   * @param {string} market - 'spot' | 'usdm' | 'coinm'
   * @param {string} side - 'BUY' | 'SELL'
   * @param {number} quantity - order quantity
   * @param {number} currentPrice - last known price
   * @returns {{ estimatedFillPrice: number, slippagePct: number, slippageBps: number }}
   */
  estimateSlippage(symbol, market, side, quantity, currentPrice) {
    const baseBps = this.liquidPairs.has(symbol) ? 2 : 5;
    const sizeFactor = Math.min((quantity * currentPrice) / 10000, 3);

    // Historical adjustment
    const stats = this.getStats(symbol, market);
    const historicalAdj = stats.sampleCount > 0 ? stats.avgSlippageBps : 0;

    const totalBps = baseBps * (1 + sizeFactor * 0.5) + historicalAdj * 0.3;

    let estimatedFillPrice;
    if (side === 'BUY') {
      estimatedFillPrice = currentPrice * (1 + totalBps / 10000);
    } else {
      estimatedFillPrice = currentPrice * (1 - totalBps / 10000);
    }

    const slippagePct = (Math.abs(estimatedFillPrice - currentPrice) / currentPrice) * 100;

    return {
      estimatedFillPrice,
      slippagePct,
      slippageBps: totalBps,
    };
  }

  /**
   * Convenience method — returns the estimated fill price directly.
   * @param {string} symbol
   * @param {string} market
   * @param {string} side - 'BUY' | 'SELL'
   * @param {number} quantity
   * @param {number} currentPrice
   * @returns {number} estimated fill price
   */
  getAdjustedPrice(symbol, market, side, quantity, currentPrice) {
    const { estimatedFillPrice } = this.estimateSlippage(symbol, market, side, quantity, currentPrice);
    return estimatedFillPrice;
  }

  /**
   * Record actual slippage from a real fill to improve future estimates.
   * @param {string} symbol
   * @param {string} market
   * @param {number} expectedPrice - price at signal time
   * @param {number} actualFillPrice - actual avg fill price
   * @param {number} quantity
   */
  recordActualSlippage(symbol, market, expectedPrice, actualFillPrice, quantity) {
    const key = this._key(symbol, market);
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }

    const slippageBps = Math.abs(actualFillPrice - expectedPrice) / expectedPrice * 10000;

    const record = {
      expectedPrice,
      actualPrice: actualFillPrice,
      slippageBps,
      quantity,
      timestamp: Date.now(),
    };

    const arr = this.history.get(key);
    arr.push(record);

    // Keep only last N records
    if (arr.length > this.maxHistoryPerSymbol) {
      arr.splice(0, arr.length - this.maxHistoryPerSymbol);
    }

    this.emit('slippage:recorded', { symbol, market, ...record });
  }

  /**
   * Get slippage statistics for a symbol+market pair.
   * @param {string} symbol
   * @param {string} market
   * @returns {{ avgSlippageBps: number, maxSlippageBps: number, sampleCount: number, lastUpdated: number|null }}
   */
  getStats(symbol, market) {
    const key = this._key(symbol, market);
    const arr = this.history.get(key);

    if (!arr || arr.length === 0) {
      return { avgSlippageBps: 0, maxSlippageBps: 0, sampleCount: 0, lastUpdated: null };
    }

    let sum = 0;
    let max = 0;
    for (const r of arr) {
      sum += r.slippageBps;
      if (r.slippageBps > max) max = r.slippageBps;
    }

    return {
      avgSlippageBps: sum / arr.length,
      maxSlippageBps: max,
      sampleCount: arr.length,
      lastUpdated: arr[arr.length - 1].timestamp,
    };
  }

  /**
   * Get all tracked symbols' stats.
   * @returns {Object.<string, { avgSlippageBps, maxSlippageBps, sampleCount, lastUpdated }>}
   */
  getAllStats() {
    const result = {};
    for (const [key, arr] of this.history.entries()) {
      if (arr.length === 0) continue;
      const [market, symbol] = key.split(':');
      let sum = 0;
      let max = 0;
      for (const r of arr) {
        sum += r.slippageBps;
        if (r.slippageBps > max) max = r.slippageBps;
      }
      result[key] = {
        symbol,
        market,
        avgSlippageBps: sum / arr.length,
        maxSlippageBps: max,
        sampleCount: arr.length,
        lastUpdated: arr[arr.length - 1].timestamp,
      };
    }
    return result;
  }
}

// Singleton
let _instance = null;

export function getSlippageEstimator() {
  if (!_instance) _instance = new SlippageEstimator();
  return _instance;
}

export { SlippageEstimator };
