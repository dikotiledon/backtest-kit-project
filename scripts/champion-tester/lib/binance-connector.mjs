import { Spot } from '@binance/connector';
import { BinanceBaseClient, SymbolFilterManager } from './binance-base-client.mjs';
import { loadConfig } from './binance-config.mjs';
import { EventEmitter } from 'node:events';

/**
 * BinanceConnector — comprehensive Spot trading engine.
 * Refactored to use BinanceBaseClient for consistent error handling,
 * rate limiting, retries, and clock sync.
 *
 * Retains @binance/connector Spot class for convenience methods
 * but wraps with robust error handling layer.
 */
class BinanceConnector extends EventEmitter {
  constructor() {
    super();
    this.client = null;       // @binance/connector Spot instance
    this.baseClient = null;   // BinanceBaseClient for raw requests
    this.config = null;
    this.connected = false;
    this.listenKey = null;
    this.listenKeyInterval = null;
    this.filterManager = new SymbolFilterManager();
    this._lastError = null;
  }

  // ─── Initialization ─────────────────────────────────────────────

  async initialize() {
    this.config = await loadConfig();
    if (!this.config || !this.config.apiKey || !this.config.apiSecret) {
      throw new Error('Binance credentials not configured');
    }

    // Support three modes: live, demo (testnet toggle), old testnet
    let baseURL;
    if (this.config.testnet && !this.config.useOldTestnet) {
      baseURL = 'https://demo-api.binance.com'; // Demo mode
    } else if (this.config.testnet && this.config.useOldTestnet) {
      baseURL = 'https://testnet.binance.vision'; // Old testnet
    } else {
      baseURL = 'https://api.binance.com'; // Live
    }

    this.client = new Spot(this.config.apiKey, this.config.apiSecret, {
      baseURL,
      timeout: 15000,
    });

    this.baseClient = new BinanceBaseClient({
      apiKey: this.config.apiKey,
      apiSecret: this.config.apiSecret,
      baseURL,
      timeout: 15000,
      maxRetries: 3,
      rateLimitPerMinute: 1200,
    });

    // Sync server time
    await this.baseClient.syncTime();

    // Forward rate limit events
    this.baseClient.on('rateLimit:warning', (d) => this.emit('rateLimit:warning', d));
    this.baseClient.on('rateLimit:exceeded', (d) => this.emit('rateLimit:exceeded', d));
    this.baseClient.on('retry', (d) => this.emit('retry', d));

    this.connected = true;
    this._lastError = null;
    this.emit('initialized', { testnet: this.config.testnet });
    return { ok: true, testnet: this.config.testnet };
  }

  ensureClient() {
    if (!this.client) throw new Error('Connector not initialized. Call initialize() first.');
  }

  // ─── Account ────────────────────────────────────────────────────

  async getAccount() {
    this.ensureClient();
    try {
      const res = await this.client.account();
      const data = res.data;
      return {
        makerCommission: data.makerCommission,
        takerCommission: data.takerCommission,
        canTrade: data.canTrade,
        canWithdraw: data.canWithdraw,
        canDeposit: data.canDeposit,
        accountType: data.accountType,
        balances: data.balances.filter(b =>
          parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
        ),
        updateTime: data.updateTime,
      };
    } catch (err) {
      this._handleError('getAccount', err);
    }
  }

  async getBalance(asset = null) {
    const account = await this.getAccount();
    if (asset) {
      const bal = account.balances.find(
        b => b.asset.toUpperCase() === asset.toUpperCase()
      );
      return bal || { asset: asset.toUpperCase(), free: '0', locked: '0' };
    }
    return account.balances;
  }

  // ─── Exchange Info & Symbol Filters ─────────────────────────────

  async loadExchangeInfo(symbol = null) {
    this.ensureClient();
    try {
      const params = symbol ? { symbol: symbol.toUpperCase() } : {};
      const res = await this.client.exchangeInfo(params);
      this.filterManager.load(res.data.symbols || []);
      this.emit('exchangeInfo:loaded', { symbolCount: res.data.symbols?.length || 0 });
      return res.data;
    } catch (err) {
      this._handleError('loadExchangeInfo', err);
    }
  }

  getExchangeInfo() {
    // Return cached exchange info in a format compatible with SymbolRegistry
    const symbols = [];
    for (const [symbol, info] of this.filterManager.filters) {
      symbols.push({
        symbol,
        status: info.status,
        baseAsset: info.baseAsset,
        quoteAsset: info.quoteAsset,
        filters: info.filters,
      });
    }
    return { symbols };
  }

  getSymbolInfo(symbol) {
    return this.filterManager.get(symbol);
  }

  adjustOrder(symbol, quantity, price = null) {
    return this.filterManager.adjustOrder(symbol, quantity, price);
  }

  // ─── Market Data ────────────────────────────────────────────────

  async getPrice(symbol) {
    this.ensureClient();
    try {
      const res = await this.client.tickerPrice(symbol.toUpperCase());
      return { symbol: res.data.symbol, price: parseFloat(res.data.price) };
    } catch (err) {
      this._handleError('getPrice', err);
    }
  }

  async getPrices(symbols = []) {
    this.ensureClient();
    try {
      const params = symbols.length
        ? { symbols: JSON.stringify(symbols.map(s => s.toUpperCase())) }
        : {};
      const res = await this.client.tickerPrice('', params);
      const data = Array.isArray(res.data) ? res.data : [res.data];
      return data.map(d => ({ symbol: d.symbol, price: parseFloat(d.price) }));
    } catch (err) {
      this._handleError('getPrices', err);
    }
  }

  async getTicker24h(symbol) {
    this.ensureClient();
    try {
      const res = await this.client.ticker24hr(symbol.toUpperCase());
      return res.data;
    } catch (err) {
      this._handleError('getTicker24h', err);
    }
  }

  async getOrderBook(symbol, limit = 20) {
    this.ensureClient();
    try {
      const res = await this.client.depth(symbol.toUpperCase(), { limit });
      return res.data;
    } catch (err) {
      this._handleError('getOrderBook', err);
    }
  }

  async getKlines(symbol, interval, limit = 100) {
    this.ensureClient();
    try {
      const res = await this.client.klines(symbol.toUpperCase(), interval, { limit });
      return res.data.map(k => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6],
        quoteVolume: parseFloat(k[7]),
        trades: k[8],
      }));
    } catch (err) {
      this._handleError('getKlines', err);
    }
  }

  // ─── Order Management ───────────────────────────────────────────

  async newOrder(params) {
    this.ensureClient();
    if (!this.config.tradingEnabled) {
      throw new Error('Trading is disabled. Enable it in settings.');
    }

    const {
      symbol, side, type,
      quantity, quoteOrderQty,
      price, stopPrice,
      timeInForce, newClientOrderId,
      icebergQty, newOrderRespType,
    } = params;

    if (!symbol || !side || !type) {
      throw new Error('symbol, side, and type are required');
    }

    const orderParams = {};
    if (quantity) orderParams.quantity = quantity;
    if (quoteOrderQty) orderParams.quoteOrderQty = quoteOrderQty;
    if (price) orderParams.price = price;
    if (stopPrice) orderParams.stopPrice = stopPrice;
    if (timeInForce) orderParams.timeInForce = timeInForce;
    if (newClientOrderId) orderParams.newClientOrderId = newClientOrderId;
    if (icebergQty) orderParams.icebergQty = icebergQty;
    if (newOrderRespType) orderParams.newOrderRespType = newOrderRespType;

    try {
      const res = await this.client.newOrder(
        symbol.toUpperCase(),
        side.toUpperCase(),
        type.toUpperCase(),
        orderParams
      );
      this.emit('order:new', res.data);
      return res.data;
    } catch (err) {
      this._handleError('newOrder', err);
    }
  }

  async testOrder(params) {
    this.ensureClient();
    const { symbol, side, type, quantity, price, timeInForce } = params;
    const orderParams = {};
    if (quantity) orderParams.quantity = quantity;
    if (price) orderParams.price = price;
    if (timeInForce) orderParams.timeInForce = timeInForce;

    try {
      const res = await this.client.newOrderTest(
        symbol.toUpperCase(),
        side.toUpperCase(),
        type.toUpperCase(),
        orderParams
      );
      return res.data;
    } catch (err) {
      this._handleError('testOrder', err);
    }
  }

  async cancelOrder(symbol, orderId) {
    this.ensureClient();
    try {
      const res = await this.client.cancelOrder(symbol.toUpperCase(), { orderId });
      this.emit('order:cancel', res.data);
      return res.data;
    } catch (err) {
      this._handleError('cancelOrder', err);
    }
  }

  async cancelAllOrders(symbol) {
    this.ensureClient();
    try {
      const res = await this.client.cancelOpenOrders(symbol.toUpperCase());
      this.emit('order:cancelAll', { symbol, cancelled: res.data });
      return res.data;
    } catch (err) {
      this._handleError('cancelAllOrders', err);
    }
  }

  async getOrder(symbol, orderId) {
    this.ensureClient();
    try {
      const res = await this.client.getOrder(symbol.toUpperCase(), { orderId });
      return res.data;
    } catch (err) {
      this._handleError('getOrder', err);
    }
  }

  async getOpenOrders(symbol = null) {
    this.ensureClient();
    try {
      const params = symbol ? { symbol: symbol.toUpperCase() } : {};
      const res = await this.client.openOrders(params);
      return res.data;
    } catch (err) {
      this._handleError('getOpenOrders', err);
    }
  }

  async getAllOrders(symbol, limit = 50) {
    this.ensureClient();
    try {
      const res = await this.client.allOrders(symbol.toUpperCase(), { limit });
      return res.data;
    } catch (err) {
      this._handleError('getAllOrders', err);
    }
  }

  // ─── Trade History ──────────────────────────────────────────────

  async getMyTrades(symbol, limit = 50) {
    this.ensureClient();
    try {
      const res = await this.client.myTrades(symbol.toUpperCase(), { limit });
      return res.data;
    } catch (err) {
      this._handleError('getMyTrades', err);
    }
  }

  // ─── Convenience Order Methods ──────────────────────────────────

  async marketBuy(symbol, quantity) {
    return this.newOrder({
      symbol, side: 'BUY', type: 'MARKET',
      quantity: String(quantity),
      newOrderRespType: 'FULL',
    });
  }

  async marketSell(symbol, quantity) {
    return this.newOrder({
      symbol, side: 'SELL', type: 'MARKET',
      quantity: String(quantity),
      newOrderRespType: 'FULL',
    });
  }

  async limitBuy(symbol, quantity, price) {
    return this.newOrder({
      symbol, side: 'BUY', type: 'LIMIT',
      quantity: String(quantity),
      price: String(price),
      timeInForce: 'GTC',
      newOrderRespType: 'FULL',
    });
  }

  async limitSell(symbol, quantity, price) {
    return this.newOrder({
      symbol, side: 'SELL', type: 'LIMIT',
      quantity: String(quantity),
      price: String(price),
      timeInForce: 'GTC',
      newOrderRespType: 'FULL',
    });
  }

  async stopLossOrder(symbol, side, quantity, stopPrice) {
    return this.newOrder({
      symbol, side, type: 'STOP_LOSS_LIMIT',
      quantity: String(quantity),
      price: String(stopPrice),
      stopPrice: String(stopPrice),
      timeInForce: 'GTC',
    });
  }

  async takeProfitOrder(symbol, side, quantity, price) {
    return this.newOrder({
      symbol, side, type: 'TAKE_PROFIT_LIMIT',
      quantity: String(quantity),
      price: String(price),
      stopPrice: String(price),
      timeInForce: 'GTC',
    });
  }

  // ─── OCO Orders ────────────────────────────────────────────────

  async newOCO(params) {
    this.ensureClient();
    if (!this.config.tradingEnabled) {
      throw new Error('Trading is disabled');
    }

    const { symbol, side, quantity, price, stopPrice, stopLimitPrice } = params;
    try {
      const res = await this.client.newOCO(
        symbol.toUpperCase(),
        side.toUpperCase(),
        String(quantity),
        String(price),
        String(stopPrice),
        { stopLimitPrice: String(stopLimitPrice), stopLimitTimeInForce: 'GTC' }
      );
      this.emit('order:oco', res.data);
      return res.data;
    } catch (err) {
      this._handleError('newOCO', err);
    }
  }

  // ─── User Data Stream ──────────────────────────────────────────

  async startUserDataStream() {
    this.ensureClient();
    try {
      const res = await this.client.createListenKey();
      this.listenKey = res.data.listenKey;

      // Keep-alive every 30 minutes
      this.listenKeyInterval = setInterval(async () => {
        try {
          await this.client.renewListenKey(this.listenKey);
        } catch (err) {
          this.emit('error', { type: 'listenKey', error: err.message });
        }
      }, 30 * 60 * 1000);

      return this.listenKey;
    } catch (err) {
      this._handleError('startUserDataStream', err);
    }
  }

  async stopUserDataStream() {
    if (this.listenKeyInterval) {
      clearInterval(this.listenKeyInterval);
      this.listenKeyInterval = null;
    }
    if (this.listenKey) {
      try {
        await this.client.closeListenKey(this.listenKey);
      } catch {}
      this.listenKey = null;
    }
  }

  // ─── Error Handling ─────────────────────────────────────────────

  _handleError(method, err) {
    const message = err.response?.data?.msg || err.message || String(err);
    const code = err.response?.data?.code || err.code || 'UNKNOWN';
    this._lastError = { method, message, code, timestamp: Date.now() };
    this.emit('error', this._lastError);

    const error = new Error(`[${method}] ${message}`);
    error.code = code;
    error.binanceData = err.response?.data || null;
    throw error;
  }

  // ─── Cleanup ───────────────────────────────────────────────────

  async disconnect() {
    await this.stopUserDataStream();
    this.client = null;
    this.baseClient = null;
    this.connected = false;
    this.filterManager = new SymbolFilterManager();
    this.emit('disconnected');
  }

  isConnected() {
    return this.connected && this.client !== null;
  }

  getStatus() {
    return {
      connected: this.connected,
      testnet: this.config?.testnet ?? null,
      tradingEnabled: this.config?.tradingEnabled ?? false,
      hasListenKey: !!this.listenKey,
      lastError: this._lastError,
    };
  }
}

// Singleton instance
let instance = null;

export function getConnector() {
  if (!instance) instance = new BinanceConnector();
  return instance;
}

export function resetConnector() {
  if (instance) {
    instance.disconnect().catch(() => {});
    instance = null;
  }
}

export { BinanceConnector };

