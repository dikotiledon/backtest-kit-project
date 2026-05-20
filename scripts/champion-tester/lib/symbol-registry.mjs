import { EventEmitter } from 'node:events';
import { getConnector } from './binance-connector.mjs';
import { getFuturesConnector } from './binance-futures-connector.mjs';

/**
 * SymbolRegistry — central catalog of all tradeable symbols from Binance.
 * Fetches exchange info for spot + futures, caches it, provides search/filter.
 */
class SymbolRegistry extends EventEmitter {
  constructor() {
    super();
    this._spot = [];
    this._usdm = [];
    this._coinm = [];
    this._lastRefresh = { spot: 0, usdm: 0, coinm: 0 };
    this._refreshInterval = 6 * 60 * 60 * 1000; // 6 hours
  }

  // ─── Refresh ────────────────────────────────────────────────────

  async refresh(market = 'all') {
    const results = {};
    if (market === 'all' || market === 'spot') {
      results.spot = await this._refreshSpot();
    }
    if (market === 'all' || market === 'usdm') {
      results.usdm = await this._refreshFutures('usdm');
    }
    if (market === 'all' || market === 'coinm') {
      results.coinm = await this._refreshFutures('coinm');
    }
    this.emit('refreshed', results);
    return results;
  }

  async _refreshSpot() {
    try {
      const connector = getConnector();
      if (!connector.isConnected()) return { ok: false, error: 'Not connected' };
      const info = connector.getExchangeInfo();
      if (!info?.symbols) return { ok: false, error: 'No exchange info' };

      this._spot = info.symbols
        .filter(s => s.status === 'TRADING')
        .map(s => ({
          symbol: s.symbol,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          status: s.status,
          market: 'spot',
          filters: this._extractFilters(s.filters),
        }));
      this._lastRefresh.spot = Date.now();
      return { ok: true, count: this._spot.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _refreshFutures(market) {
    try {
      const fc = getFuturesConnector();
      if (!fc.isInitialized(market)) return { ok: false, error: `${market} not initialized` };
      const symbols = fc.listSymbols(market, { status: 'TRADING' });

      const list = symbols.map(s => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        contractType: s.contractType,
        marginAsset: s.marginAsset,
        status: 'TRADING',
        market,
      }));

      if (market === 'usdm') this._usdm = list;
      else this._coinm = list;
      this._lastRefresh[market] = Date.now();
      return { ok: true, count: list.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _extractFilters(filters) {
    if (!filters) return {};
    const result = {};
    for (const f of filters) {
      if (f.filterType === 'PRICE_FILTER') {
        result.minPrice = parseFloat(f.minPrice);
        result.maxPrice = parseFloat(f.maxPrice);
        result.tickSize = parseFloat(f.tickSize);
      } else if (f.filterType === 'LOT_SIZE') {
        result.minQty = parseFloat(f.minQty);
        result.maxQty = parseFloat(f.maxQty);
        result.stepSize = parseFloat(f.stepSize);
      } else if (f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL') {
        result.minNotional = parseFloat(f.minNotional || f.notional);
      }
    }
    return result;
  }

  // ─── Search & Query ─────────────────────────────────────────────

  search(query, market = 'all', filters = {}) {
    const q = (query || '').toUpperCase().trim();
    let pool = this._getPool(market);

    // Apply filters
    if (filters.quoteAsset) {
      pool = pool.filter(s => s.quoteAsset === filters.quoteAsset.toUpperCase());
    }
    if (filters.baseAsset) {
      pool = pool.filter(s => s.baseAsset === filters.baseAsset.toUpperCase());
    }
    if (filters.contractType) {
      pool = pool.filter(s => s.contractType === filters.contractType);
    }

    // Search
    if (!q) return pool.slice(0, filters.limit || 100);

    // Exact match first, then prefix, then contains
    const exact = pool.filter(s => s.symbol === q);
    const prefix = pool.filter(s => s.symbol.startsWith(q) && s.symbol !== q);
    const contains = pool.filter(s => s.symbol.includes(q) && !s.symbol.startsWith(q));

    const results = [...exact, ...prefix, ...contains];
    return results.slice(0, filters.limit || 50);
  }

  getSymbol(symbol, market = 'all') {
    const pool = this._getPool(market);
    return pool.find(s => s.symbol === symbol.toUpperCase()) || null;
  }

  getTopByVolume(market = 'spot', limit = 20) {
    // Volume data requires ticker — return all for now, sorted by name
    const pool = this._getPool(market);
    return pool.slice(0, limit);
  }

  isValid(symbol, market = 'all') {
    return !!this.getSymbol(symbol, market);
  }

  getStats() {
    return {
      spot: { count: this._spot.length, lastRefresh: this._lastRefresh.spot },
      usdm: { count: this._usdm.length, lastRefresh: this._lastRefresh.usdm },
      coinm: { count: this._coinm.length, lastRefresh: this._lastRefresh.coinm },
    };
  }

  needsRefresh(market) {
    const last = this._lastRefresh[market] || 0;
    return Date.now() - last > this._refreshInterval;
  }

  _getPool(market) {
    if (market === 'spot') return this._spot;
    if (market === 'usdm') return this._usdm;
    if (market === 'coinm') return this._coinm;
    return [...this._spot, ...this._usdm, ...this._coinm];
  }
}

// Singleton
let _registry = null;
export function getSymbolRegistry() {
  if (!_registry) _registry = new SymbolRegistry();
  return _registry;
}

export { SymbolRegistry };
