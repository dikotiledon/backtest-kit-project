import { EventEmitter } from 'node:events';
import MarketStream from './market-stream.mjs';

/**
 * MarketDataService — orchestrates multiple MarketStream instances.
 * Provides unified subscription API, price cache, and stream management.
 */
class MarketDataService extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.mode = opts.mode || 'live'; // 'live' | 'demo' | 'testnet'
    this.streams = new Map(); // market -> MarketStream
    this.priceCache = new Map();
    this.klineBuffer = new Map();
    this.klineBufferSize = opts.klineBufferSize || 100;
    this._started = false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  start(markets = ['spot', 'usdm']) {
    for (const market of markets) {
      if (this.streams.has(market)) continue;
      const stream = new MarketStream(market, this.mode);
      stream.setEmitter(this);
      stream.connect();
      this.streams.set(market, stream);
    }
    this._started = true;

    // Forward events to update caches
    this.on('price:update', (data) => {
      this.priceCache.set(`${data.market}:${data.symbol}`, {
        price: data.price,
        timestamp: data.timestamp,
      });
    });

    this.on('kline:update', (data) => {
      if (!data.kline.isClosed) return; // only buffer closed klines
      const key = `${data.market}:${data.symbol}:${data.interval}`;
      if (!this.klineBuffer.has(key)) this.klineBuffer.set(key, []);
      const buf = this.klineBuffer.get(key);
      buf.push(data.kline);
      if (buf.length > this.klineBufferSize) buf.shift();
    });

    return { ok: true, markets };
  }

  stop() {
    for (const [, stream] of this.streams) {
      stream.disconnect();
    }
    this.streams.clear();
    this.priceCache.clear();
    this.klineBuffer.clear();
    this._started = false;
    this.removeAllListeners();
  }

  isStarted() {
    return this._started;
  }

  // ─── Subscription API ───────────────────────────────────────────

  /**
   * Subscribe to streams for symbols.
   * @param {string[]} symbols - e.g. ['BTCUSDT', 'ETHUSDT']
   * @param {string[]} streamTypes - e.g. ['aggTrade', 'kline_1m', 'miniTicker']
   * @param {string} market - 'spot' | 'usdm' | 'coinm'
   */
  subscribe(symbols, streamTypes, market = 'spot') {
    const stream = this.streams.get(market);
    if (!stream) {
      // Auto-create stream if not exists
      const newStream = new MarketStream(market, this.mode);
      newStream.setEmitter(this);
      newStream.connect();
      this.streams.set(market, newStream);
      // Retry after connection
      setTimeout(() => this.subscribe(symbols, streamTypes, market), 1000);
      return;
    }

    const streamNames = [];
    for (const symbol of symbols) {
      const sym = symbol.toLowerCase();
      for (const type of streamTypes) {
        streamNames.push(`${sym}@${type}`);
      }
    }
    stream.subscribe(streamNames);
  }

  /**
   * Unsubscribe from streams.
   */
  unsubscribe(symbols, streamTypes, market = 'spot') {
    const stream = this.streams.get(market);
    if (!stream) return;

    const streamNames = [];
    for (const symbol of symbols) {
      const sym = symbol.toLowerCase();
      for (const type of streamTypes) {
        streamNames.push(`${sym}@${type}`);
      }
    }
    stream.unsubscribe(streamNames);
  }

  // ─── Cached Data Access ─────────────────────────────────────────

  getPrice(symbol, market = 'spot') {
    const cached = this.priceCache.get(`${market}:${symbol.toUpperCase()}`);
    return cached || null;
  }

  getAllPrices(market = null) {
    const result = {};
    for (const [key, val] of this.priceCache) {
      if (market && !key.startsWith(market + ':')) continue;
      result[key] = val;
    }
    return result;
  }

  getKlines(symbol, interval, market = 'spot') {
    const key = `${market}:${symbol.toUpperCase()}:${interval}`;
    return this.klineBuffer.get(key) || [];
  }

  // ─── Status ─────────────────────────────────────────────────────

  getStatus() {
    const status = {};
    for (const [market, stream] of this.streams) {
      status[market] = {
        connected: stream.connected,
        subscriptions: stream.subscriptions.size,
        reconnectAttempts: stream.reconnectAttempts,
      };
    }
    return {
      started: this._started,
      streams: status,
      cachedPrices: this.priceCache.size,
      klineBuffers: this.klineBuffer.size,
    };
  }
}

// Singleton
let _instance = null;
export function getMarketDataService() {
  if (!_instance) _instance = new MarketDataService();
  return _instance;
}

export function resetMarketDataService() {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}

export { MarketDataService };
