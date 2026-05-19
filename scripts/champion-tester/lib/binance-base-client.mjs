import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

/**
 * BinanceBaseClient — shared HTTP infrastructure for Spot, USD-M, and COIN-M APIs.
 * Handles: HMAC-SHA256 signing, rate limiting, retries with exponential backoff,
 * request queuing, error classification, and structured logging.
 */
export class BinanceBaseClient extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.apiSecret
   * @param {string} opts.baseURL
   * @param {number} [opts.timeout=15000]
   * @param {number} [opts.maxRetries=3]
   * @param {number} [opts.rateLimitPerMinute=1200]
   * @param {boolean} [opts.recvWindow=5000]
   */
  constructor(opts) {
    super();
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.baseURL = opts.baseURL.replace(/\/$/, '');
    this.timeout = opts.timeout ?? 15000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.recvWindow = opts.recvWindow ?? 5000;

    // Rate limiting (token bucket)
    this.rateLimitPerMinute = opts.rateLimitPerMinute ?? 1200;
    this._tokens = this.rateLimitPerMinute;
    this._lastRefill = Date.now();
    this._requestQueue = [];
    this._processing = false;

    // Server time offset for clock sync
    this._timeOffset = 0;
    this._lastSyncTime = 0;
  }

  // ─── Clock Sync ─────────────────────────────────────────────────

  async syncTime() {
    try {
      const before = Date.now();
      const res = await this._rawRequest('GET', '/api/v3/time', {}, false);
      const after = Date.now();
      const serverTime = res.serverTime;
      const roundTrip = after - before;
      this._timeOffset = serverTime - before - Math.floor(roundTrip / 2);
      this._lastSyncTime = Date.now();
      return this._timeOffset;
    } catch {
      // Fallback: try fapi time endpoint for futures
      try {
        const before = Date.now();
        const res = await this._rawRequest('GET', '/fapi/v1/time', {}, false);
        const after = Date.now();
        const serverTime = res.serverTime;
        const roundTrip = after - before;
        this._timeOffset = serverTime - before - Math.floor(roundTrip / 2);
        this._lastSyncTime = Date.now();
        return this._timeOffset;
      } catch {
        this._timeOffset = 0;
      }
    }
    return 0;
  }

  getTimestamp() {
    return Date.now() + this._timeOffset;
  }

  // ─── Signing ────────────────────────────────────────────────────

  sign(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  buildQuery(params) {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    );
    return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }

  // ─── Rate Limiting ──────────────────────────────────────────────

  _refillTokens() {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    const refill = Math.floor((elapsed / 60000) * this.rateLimitPerMinute);
    if (refill > 0) {
      this._tokens = Math.min(this.rateLimitPerMinute, this._tokens + refill);
      this._lastRefill = now;
    }
  }

  _consumeToken() {
    this._refillTokens();
    if (this._tokens > 0) {
      this._tokens--;
      return true;
    }
    return false;
  }

  _waitForToken() {
    return new Promise((resolve) => {
      const check = () => {
        if (this._consumeToken()) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // ─── HTTP Requests ──────────────────────────────────────────────

  async _rawRequest(method, path, params = {}, signed = false) {
    let url = `${this.baseURL}${path}`;
    let body = null;

    let queryString = this.buildQuery(params);

    if (signed) {
      const timestamp = this.getTimestamp();
      queryString += (queryString ? '&' : '') + `timestamp=${timestamp}&recvWindow=${this.recvWindow}`;
      const signature = this.sign(queryString);
      queryString += `&signature=${signature}`;
    }

    if (method === 'GET' || method === 'DELETE') {
      if (queryString) url += `?${queryString}`;
    } else {
      body = queryString;
    }

    const headers = {
      'X-MBX-APIKEY': this.apiKey,
      'User-Agent': 'champion-tester/2.0',
    };
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Parse rate limit headers
      const usedWeight = response.headers.get('x-mbx-used-weight-1m');
      if (usedWeight) {
        const used = parseInt(usedWeight, 10);
        if (used > this.rateLimitPerMinute * 0.8) {
          this.emit('rateLimit:warning', { usedWeight: used, limit: this.rateLimitPerMinute });
        }
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }

      if (!response.ok) {
        const error = new BinanceAPIError(
          data?.msg || `HTTP ${response.status}`,
          data?.code || response.status,
          response.status,
          path,
          data
        );

        // Handle specific error codes
        if (response.status === 429 || response.status === 418) {
          const retryAfter = response.headers.get('retry-after');
          error.retryAfter = retryAfter ? parseInt(retryAfter, 10) * 1000 : 60000;
          error.rateLimited = true;
          this.emit('rateLimit:exceeded', { retryAfter: error.retryAfter, path });
        }

        if (data?.code === -1021) {
          // Timestamp error — resync
          error.clockDesync = true;
          await this.syncTime();
        }

        throw error;
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof BinanceAPIError) throw err;
      if (err.name === 'AbortError') {
        throw new BinanceAPIError(`Request timeout (${this.timeout}ms)`, 'TIMEOUT', 408, path);
      }
      throw new BinanceAPIError(err.message, 'NETWORK_ERROR', 0, path);
    }
  }

  /**
   * Execute request with rate limiting, retries, and error handling
   */
  async request(method, path, params = {}, signed = false) {
    await this._waitForToken();

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this._rawRequest(method, path, params, signed);
      } catch (err) {
        lastError = err;

        // Don't retry client errors (4xx except 429/418)
        if (err.httpStatus >= 400 && err.httpStatus < 500 && !err.rateLimited && !err.clockDesync) {
          throw err;
        }

        // Don't retry on last attempt
        if (attempt === this.maxRetries) break;

        // Exponential backoff
        let delay;
        if (err.rateLimited) {
          delay = err.retryAfter || 60000;
        } else if (err.clockDesync) {
          delay = 500; // Quick retry after time sync
        } else {
          delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30000);
        }

        this.emit('retry', { attempt: attempt + 1, delay, error: err.message, path });
        await sleep(delay);
      }
    }

    throw lastError;
  }

  // Convenience methods
  async get(path, params = {}, signed = false) {
    return this.request('GET', path, params, signed);
  }

  async post(path, params = {}, signed = false) {
    return this.request('POST', path, params, signed);
  }

  async put(path, params = {}, signed = false) {
    return this.request('PUT', path, params, signed);
  }

  async del(path, params = {}, signed = false) {
    return this.request('DELETE', path, params, signed);
  }
}

/**
 * Structured Binance API error
 */
export class BinanceAPIError extends Error {
  constructor(message, code, httpStatus, path, rawData = null) {
    super(message);
    this.name = 'BinanceAPIError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.path = path;
    this.rawData = rawData;
    this.rateLimited = false;
    this.clockDesync = false;
    this.retryAfter = 0;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      httpStatus: this.httpStatus,
      path: this.path,
      rateLimited: this.rateLimited,
      timestamp: this.timestamp,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Filters and precision helpers for order adjustment
 */
export class SymbolFilterManager {
  constructor() {
    this.filters = new Map();
  }

  load(symbolsData) {
    for (const s of symbolsData) {
      this.filters.set(s.symbol, {
        status: s.status,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        contractType: s.contractType || null,
        marginAsset: s.marginAsset || null,
        pricePrecision: s.pricePrecision ?? 8,
        quantityPrecision: s.quantityPrecision ?? 8,
        filters: s.filters || [],
      });
    }
  }

  get(symbol) {
    return this.filters.get(symbol.toUpperCase()) || null;
  }

  getFilter(symbol, filterType) {
    const info = this.get(symbol);
    if (!info) return null;
    return info.filters.find(f => f.filterType === filterType) || null;
  }

  /**
   * Adjust quantity and price to comply with exchange filters
   */
  adjustOrder(symbol, quantity, price = null) {
    const sym = symbol.toUpperCase();
    const info = this.get(sym);
    if (!info) return { quantity, price, warnings: ['Symbol filters not loaded'] };

    let adjQty = quantity;
    let adjPrice = price;
    const warnings = [];

    // LOT_SIZE / MARKET_LOT_SIZE
    const lotSize = this.getFilter(sym, 'LOT_SIZE') || this.getFilter(sym, 'MARKET_LOT_SIZE');
    if (lotSize) {
      const step = parseFloat(lotSize.stepSize);
      const minQty = parseFloat(lotSize.minQty);
      const maxQty = parseFloat(lotSize.maxQty);

      if (adjQty < minQty) {
        warnings.push(`Quantity ${adjQty} below min ${minQty}, adjusted`);
        adjQty = minQty;
      }
      if (adjQty > maxQty) {
        warnings.push(`Quantity ${adjQty} above max ${maxQty}, adjusted`);
        adjQty = maxQty;
      }
      if (step > 0) {
        adjQty = Math.floor(adjQty / step) * step;
        const decimals = countDecimals(step);
        adjQty = parseFloat(adjQty.toFixed(decimals));
      }
    } else if (info.quantityPrecision != null) {
      adjQty = parseFloat(adjQty.toFixed(info.quantityPrecision));
    }

    // PRICE_FILTER
    if (adjPrice !== null) {
      const priceFilter = this.getFilter(sym, 'PRICE_FILTER');
      if (priceFilter) {
        const tickSize = parseFloat(priceFilter.tickSize);
        const minPrice = parseFloat(priceFilter.minPrice);
        const maxPrice = parseFloat(priceFilter.maxPrice);

        if (minPrice > 0 && adjPrice < minPrice) adjPrice = minPrice;
        if (maxPrice > 0 && adjPrice > maxPrice) adjPrice = maxPrice;
        if (tickSize > 0) {
          adjPrice = Math.round(adjPrice / tickSize) * tickSize;
          const decimals = countDecimals(tickSize);
          adjPrice = parseFloat(adjPrice.toFixed(decimals));
        }
      } else if (info.pricePrecision != null) {
        adjPrice = parseFloat(adjPrice.toFixed(info.pricePrecision));
      }
    }

    // MIN_NOTIONAL / NOTIONAL
    let minNotional = 0;
    const notionalFilter = this.getFilter(sym, 'MIN_NOTIONAL') || this.getFilter(sym, 'NOTIONAL');
    if (notionalFilter) {
      minNotional = parseFloat(notionalFilter.minNotional || notionalFilter.notional || '0');
    }

    return { quantity: adjQty, price: adjPrice, minNotional, warnings };
  }

  listSymbols(filter = {}) {
    const results = [];
    for (const [symbol, info] of this.filters) {
      if (filter.status && info.status !== filter.status) continue;
      if (filter.contractType && info.contractType !== filter.contractType) continue;
      if (filter.quoteAsset && info.quoteAsset !== filter.quoteAsset) continue;
      if (filter.marginAsset && info.marginAsset !== filter.marginAsset) continue;
      results.push({ symbol, ...info });
    }
    return results;
  }
}

function countDecimals(num) {
  const str = num.toString();
  const idx = str.indexOf('.');
  return idx >= 0 ? str.length - idx - 1 : 0;
}
