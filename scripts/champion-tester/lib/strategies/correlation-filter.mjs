/**
 * Correlation Filter — rolling correlation matrix between symbols.
 * Used to detect correlated exposure before opening new positions.
 */
export class CorrelationFilter {
  constructor(opts = {}) {
    this.defaultWindow = opts.window || 50;
    this.defaultThreshold = opts.threshold || 0.7;
    // { symbol: [{ price, timestamp, return }] }
    this._data = {};
  }

  /**
   * Feed a price observation for a symbol.
   * @param {string} symbol
   * @param {number} price
   * @param {number} timestamp - epoch ms
   */
  addPrice(symbol, price, timestamp) {
    if (!this._data[symbol]) this._data[symbol] = [];
    const arr = this._data[symbol];
    const prevPrice = arr.length > 0 ? arr[arr.length - 1].price : null;
    const ret = prevPrice !== null && prevPrice !== 0 ? (price - prevPrice) / prevPrice : 0;
    arr.push({ price, timestamp, return: ret });

    // Keep buffer bounded (2x default window should be plenty)
    const maxLen = this.defaultWindow * 2 + 10;
    if (arr.length > maxLen) {
      this._data[symbol] = arr.slice(-maxLen);
    }
  }

  /**
   * Compute Pearson correlation of returns between two symbols.
   * @param {string} symbolA
   * @param {string} symbolB
   * @param {number} [window=50] - lookback window for returns
   * @returns {number|null} correlation coefficient [-1, 1] or null if insufficient data
   */
  getCorrelation(symbolA, symbolB, window = this.defaultWindow) {
    const dataA = this._data[symbolA];
    const dataB = this._data[symbolB];

    if (!dataA || !dataB) return null;
    if (dataA.length < window + 1 || dataB.length < window + 1) return null;

    // Get last `window` returns (skip first entry which has return=0)
    const returnsA = dataA.slice(-window).map(d => d.return);
    const returnsB = dataB.slice(-window).map(d => d.return);

    return this._pearson(returnsA, returnsB);
  }

  /**
   * Check if opening a position would create correlated exposure.
   * @param {string} symbol - symbol we want to trade
   * @param {'long'|'short'} direction - intended direction
   * @param {Array<{symbol: string, direction: string}>} openPositions - current open positions
   * @param {number} [threshold=0.7] - correlation threshold
   * @returns {boolean} true if this would ADD correlated exposure above threshold
   */
  wouldAddExposure(symbol, direction, openPositions, threshold = this.defaultThreshold) {
    if (!openPositions || openPositions.length === 0) return false;

    for (const pos of openPositions) {
      if (pos.symbol === symbol) continue;

      const corr = this.getCorrelation(symbol, pos.symbol);
      if (corr === null) continue;

      // Same direction + positive correlation = correlated exposure
      // Opposite direction + negative correlation = also correlated exposure
      const sameDirection = pos.direction === direction;
      const effectiveCorr = sameDirection ? corr : -corr;

      if (effectiveCorr > threshold) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all pairwise correlations for tracked symbols.
   * @param {number} [window]
   * @returns {Map<string, number>} key = "symbolA:symbolB", value = correlation
   */
  getMatrix(window = this.defaultWindow) {
    const symbols = Object.keys(this._data);
    const matrix = new Map();

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const corr = this.getCorrelation(symbols[i], symbols[j], window);
        if (corr !== null) {
          matrix.set(`${symbols[i]}:${symbols[j]}`, corr);
        }
      }
    }

    return matrix;
  }

  /**
   * Get list of tracked symbols.
   * @returns {string[]}
   */
  getSymbols() {
    return Object.keys(this._data);
  }

  /**
   * Clear data for a symbol or all symbols.
   * @param {string} [symbol] - if omitted, clears all
   */
  clear(symbol) {
    if (symbol) {
      delete this._data[symbol];
    } else {
      this._data = {};
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────

  /**
   * Pearson correlation coefficient between two arrays.
   * @param {number[]} x
   * @param {number[]} y
   * @returns {number} correlation [-1, 1]
   */
  _pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
    );

    if (denominator === 0) return 0;
    return numerator / denominator;
  }
}
