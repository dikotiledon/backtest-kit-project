import { BinanceBaseClient, BinanceAPIError, SymbolFilterManager } from './binance-base-client.mjs';
import { EventEmitter } from 'node:events';

/**
 * BinanceFuturesConnector — USD-M and COIN-M Futures trading engine.
 * 
 * USD-M Futures: settled in USDT/BUSD, uses fapi endpoints
 * COIN-M Futures: settled in coin (BTC, ETH, etc.), uses dapi endpoints
 * 
 * Features:
 * - Full order management (market, limit, stop, take-profit, trailing stop)
 * - Position management (hedge mode, one-way mode)
 * - Leverage and margin type control
 * - Funding rate queries
 * - Income history
 * - User data stream (listen key management)
 * - Exchange filter compliance
 */

const ENDPOINTS = {
  usdm: {
    live: 'https://fapi.binance.com',
    demo: 'https://demo-fapi.binance.com',
    testnet: 'https://testnet.binancefuture.com',
  },
  coinm: {
    live: 'https://dapi.binance.com',
    demo: 'https://demo-dapi.binance.com',
    testnet: 'https://testnet.binancefuture.com',
  },
};

// API path prefixes differ between USD-M and COIN-M
const API_PREFIX = {
  usdm: '/fapi/v1',
  usdm_v2: '/fapi/v2',
  coinm: '/dapi/v1',
  coinm_v2: '/dapi/v2',
};

export class BinanceFuturesConnector extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map(); // 'usdm' | 'coinm' -> BinanceBaseClient
    this.filterManagers = new Map(); // 'usdm' | 'coinm' -> SymbolFilterManager
    this.listenKeys = new Map(); // 'usdm' | 'coinm' -> { key, interval }
    this.initialized = new Map(); // 'usdm' | 'coinm' -> boolean
    this.config = null;
  }

  // ─── Initialization ─────────────────────────────────────────────

  /**
   * Initialize one or both futures markets
   * @param {object} config - { apiKey, apiSecret, testnet, markets: ['usdm', 'coinm'] }
   */
  async initialize(config) {
    this.config = config;
    const markets = config.markets || ['usdm'];
    const results = {};

    for (const market of markets) {
      try {
        await this._initMarket(market, config);
        results[market] = { ok: true };
      } catch (err) {
        results[market] = { ok: false, error: err.message };
      }
    }

    this.emit('initialized', results);
    return results;
  }

  async _initMarket(market, config) {
    if (market !== 'usdm' && market !== 'coinm') {
      throw new Error(`Invalid futures market: ${market}. Use 'usdm' or 'coinm'`);
    }

    const endpoints = ENDPOINTS[market];
    // Support three modes: live, demo, testnet
    let baseURL;
    if (config.mode === 'demo' || (config.testnet && !config.useOldTestnet)) {
      baseURL = endpoints.demo;
    } else if (config.testnet && config.useOldTestnet) {
      baseURL = endpoints.testnet;
    } else {
      baseURL = endpoints.live;
    }

    const client = new BinanceBaseClient({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      baseURL,
      timeout: config.timeout || 15000,
      maxRetries: config.maxRetries || 3,
      rateLimitPerMinute: 2400, // Futures has higher rate limits
    });

    // Sync server time
    await client.syncTime();

    this.clients.set(market, client);
    this.filterManagers.set(market, new SymbolFilterManager());
    this.initialized.set(market, true);

    // Forward events
    client.on('rateLimit:warning', (data) => this.emit('rateLimit:warning', { market, ...data }));
    client.on('rateLimit:exceeded', (data) => this.emit('rateLimit:exceeded', { market, ...data }));
    client.on('retry', (data) => this.emit('retry', { market, ...data }));
  }

  _getClient(market) {
    const client = this.clients.get(market);
    if (!client) throw new Error(`Futures market '${market}' not initialized`);
    return client;
  }

  _prefix(market, v2 = false) {
    const key = v2 ? `${market}_v2` : market;
    return API_PREFIX[key];
  }

  isInitialized(market) {
    return this.initialized.get(market) === true;
  }

  // ─── Exchange Info ──────────────────────────────────────────────

  async loadExchangeInfo(market) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.get(`${prefix}/exchangeInfo`);

    const fm = this.filterManagers.get(market);
    fm.load(data.symbols || []);

    this.emit('exchangeInfo:loaded', { market, symbolCount: data.symbols?.length || 0 });
    return data;
  }

  getSymbolInfo(market, symbol) {
    const fm = this.filterManagers.get(market);
    return fm?.get(symbol.toUpperCase()) || null;
  }

  adjustOrder(market, symbol, quantity, price = null) {
    const fm = this.filterManagers.get(market);
    if (!fm) return { quantity, price, minNotional: 0, warnings: ['Filters not loaded'] };
    return fm.adjustOrder(symbol, quantity, price);
  }

  listSymbols(market, filter = {}) {
    const fm = this.filterManagers.get(market);
    return fm?.listSymbols(filter) || [];
  }

  // ─── Account & Position ─────────────────────────────────────────

  async getAccount(market) {
    const client = this._getClient(market);
    const prefix = this._prefix(market, true); // v2 for account
    const data = await client.get(`${prefix}/account`, {}, true);
    return {
      totalWalletBalance: data.totalWalletBalance,
      totalUnrealizedProfit: data.totalUnrealizedProfit,
      totalMarginBalance: data.totalMarginBalance,
      totalCrossWalletBalance: data.totalCrossWalletBalance,
      totalCrossUnPnl: data.totalCrossUnPnl,
      availableBalance: data.availableBalance,
      maxWithdrawAmount: data.maxWithdrawAmount,
      canTrade: data.canTrade,
      canDeposit: data.canDeposit,
      canWithdraw: data.canWithdraw,
      feeTier: data.feeTier,
      updateTime: data.updateTime,
      assets: (data.assets || []).filter(a =>
        parseFloat(a.walletBalance) !== 0 ||
        parseFloat(a.unrealizedProfit) !== 0
      ),
      positions: (data.positions || []).filter(p =>
        parseFloat(p.positionAmt) !== 0 ||
        parseFloat(p.unrealizedProfit) !== 0
      ),
    };
  }

  async getBalance(market) {
    const client = this._getClient(market);
    const prefix = this._prefix(market, true);
    const data = await client.get(`${prefix}/balance`, {}, true);
    return (Array.isArray(data) ? data : []).filter(b =>
      parseFloat(b.balance) !== 0 || parseFloat(b.crossUnPnl) !== 0
    );
  }

  async getPositions(market, symbol = null) {
    const client = this._getClient(market);
    const prefix = this._prefix(market, true);
    const params = symbol ? { symbol: symbol.toUpperCase() } : {};
    const data = await client.get(`${prefix}/positionRisk`, params, true);
    return (Array.isArray(data) ? data : []).map(p => ({
      symbol: p.symbol,
      positionSide: p.positionSide, // BOTH, LONG, SHORT
      positionAmt: parseFloat(p.positionAmt),
      entryPrice: parseFloat(p.entryPrice),
      markPrice: parseFloat(p.markPrice),
      unrealizedProfit: parseFloat(p.unRealizedProfit || p.unrealizedProfit || '0'),
      liquidationPrice: parseFloat(p.liquidationPrice),
      leverage: parseInt(p.leverage, 10),
      marginType: p.marginType, // isolated or cross
      isolatedMargin: parseFloat(p.isolatedMargin || '0'),
      notional: parseFloat(p.notional || '0'),
      maxNotionalValue: parseFloat(p.maxNotionalValue || '0'),
      updateTime: p.updateTime,
    }));
  }

  async getOpenPositions(market) {
    const positions = await this.getPositions(market);
    return positions.filter(p => p.positionAmt !== 0);
  }

  // ─── Leverage & Margin ──────────────────────────────────────────

  async setLeverage(market, symbol, leverage) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.post(`${prefix}/leverage`, {
      symbol: symbol.toUpperCase(),
      leverage: Math.max(1, Math.min(125, parseInt(leverage, 10))),
    }, true);
    this.emit('leverage:changed', { market, symbol, leverage: data.leverage });
    return data;
  }

  async setMarginType(market, symbol, marginType) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const type = marginType.toUpperCase(); // ISOLATED or CROSSED
    try {
      const data = await client.post(`${prefix}/marginType`, {
        symbol: symbol.toUpperCase(),
        marginType: type,
      }, true);
      this.emit('marginType:changed', { market, symbol, marginType: type });
      return data;
    } catch (err) {
      // -4046: No need to change margin type (already set)
      if (err.code === -4046) return { code: 200, msg: 'Already set' };
      throw err;
    }
  }

  async setPositionMode(market, dualSidePosition) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    try {
      const data = await client.post(`${prefix}/positionSide/dual`, {
        dualSidePosition: String(dualSidePosition),
      }, true);
      this.emit('positionMode:changed', { market, dualSidePosition });
      return data;
    } catch (err) {
      // -4059: No need to change position side (already set)
      if (err.code === -4059) return { code: 200, msg: 'Already set' };
      throw err;
    }
  }

  async getPositionMode(market) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/positionSide/dual`, {}, true);
  }

  async addIsolatedMargin(market, symbol, positionSide, amount) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.post(`${prefix}/positionMargin`, {
      symbol: symbol.toUpperCase(),
      positionSide: positionSide || 'BOTH',
      amount: String(amount),
      type: 1, // 1 = add, 2 = reduce
    }, true);
  }

  async reduceIsolatedMargin(market, symbol, positionSide, amount) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.post(`${prefix}/positionMargin`, {
      symbol: symbol.toUpperCase(),
      positionSide: positionSide || 'BOTH',
      amount: String(amount),
      type: 2,
    }, true);
  }

  // ─── Market Data ────────────────────────────────────────────────

  async getPrice(market, symbol) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const params = symbol ? { symbol: symbol.toUpperCase() } : {};
    const data = await client.get(`${prefix}/ticker/price`, params);
    if (Array.isArray(data)) {
      return data.map(d => ({ symbol: d.symbol, price: parseFloat(d.price), time: d.time }));
    }
    return { symbol: data.symbol, price: parseFloat(data.price), time: data.time };
  }

  async getTicker24h(market, symbol) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const params = symbol ? { symbol: symbol.toUpperCase() } : {};
    return client.get(`${prefix}/ticker/24hr`, params);
  }

  async getMarkPrice(market, symbol = null) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const params = symbol ? { symbol: symbol.toUpperCase() } : {};
    const data = await client.get(`${prefix}/premiumIndex`, params);
    const normalize = (d) => ({
      symbol: d.symbol,
      markPrice: parseFloat(d.markPrice),
      indexPrice: parseFloat(d.indexPrice),
      lastFundingRate: parseFloat(d.lastFundingRate),
      nextFundingTime: d.nextFundingTime,
      interestRate: parseFloat(d.interestRate || '0'),
      time: d.time,
    });
    return Array.isArray(data) ? data.map(normalize) : normalize(data);
  }

  async getFundingRate(market, symbol, limit = 100) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.get(`${prefix}/fundingRate`, {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 1000),
    });
    return data.map(r => ({
      symbol: r.symbol,
      fundingRate: parseFloat(r.fundingRate),
      fundingTime: r.fundingTime,
    }));
  }

  async getOrderBook(market, symbol, limit = 20) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/depth`, {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 1000),
    });
  }

  async getKlines(market, symbol, interval, limit = 100) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.get(`${prefix}/klines`, {
      symbol: symbol.toUpperCase(),
      interval,
      limit: Math.min(limit, 1500),
    });
    return data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
      quoteVolume: parseFloat(k[7]),
      trades: k[8],
      takerBuyBaseVol: parseFloat(k[9]),
      takerBuyQuoteVol: parseFloat(k[10]),
    }));
  }

  async getAggTrades(market, symbol, limit = 100) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/aggTrades`, {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 1000),
    });
  }

  async getOpenInterest(market, symbol) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.get(`${prefix}/openInterest`, {
      symbol: symbol.toUpperCase(),
    });
    return {
      symbol: data.symbol,
      openInterest: parseFloat(data.openInterest),
      time: data.time,
    };
  }

  // ─── Order Management ───────────────────────────────────────────

  /**
   * Place a futures order
   * @param {string} market - 'usdm' | 'coinm'
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.side - BUY | SELL
   * @param {string} params.type - LIMIT | MARKET | STOP | STOP_MARKET | TAKE_PROFIT | TAKE_PROFIT_MARKET | TRAILING_STOP_MARKET
   * @param {string} [params.positionSide] - BOTH | LONG | SHORT (hedge mode)
   * @param {number|string} [params.quantity]
   * @param {number|string} [params.price]
   * @param {number|string} [params.stopPrice]
   * @param {string} [params.timeInForce] - GTC | IOC | FOK | GTX
   * @param {boolean} [params.reduceOnly]
   * @param {boolean} [params.closePosition]
   * @param {number|string} [params.activationPrice] - for trailing stop
   * @param {number|string} [params.callbackRate] - for trailing stop (1-5%)
   * @param {string} [params.workingType] - MARK_PRICE | CONTRACT_PRICE
   * @param {string} [params.newClientOrderId]
   * @param {string} [params.newOrderRespType] - ACK | RESULT
   */
  async newOrder(market, params) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);

    const {
      symbol, side, type,
      positionSide, quantity, price, stopPrice,
      timeInForce, reduceOnly, closePosition,
      activationPrice, callbackRate, workingType,
      newClientOrderId, newOrderRespType,
    } = params;

    if (!symbol || !side || !type) {
      throw new Error('symbol, side, and type are required');
    }

    const orderParams = {
      symbol: symbol.toUpperCase(),
      side: side.toUpperCase(),
      type: type.toUpperCase(),
    };

    if (positionSide) orderParams.positionSide = positionSide.toUpperCase();
    if (quantity) orderParams.quantity = String(quantity);
    if (price) orderParams.price = String(price);
    if (stopPrice) orderParams.stopPrice = String(stopPrice);
    if (timeInForce) orderParams.timeInForce = timeInForce;
    if (reduceOnly !== undefined) orderParams.reduceOnly = String(reduceOnly);
    if (closePosition !== undefined) orderParams.closePosition = String(closePosition);
    if (activationPrice) orderParams.activationPrice = String(activationPrice);
    if (callbackRate) orderParams.callbackRate = String(callbackRate);
    if (workingType) orderParams.workingType = workingType;
    if (newClientOrderId) orderParams.newClientOrderId = newClientOrderId;
    if (newOrderRespType) orderParams.newOrderRespType = newOrderRespType;

    const data = await client.post(`${prefix}/order`, orderParams, true);
    this.emit('order:new', { market, order: data });
    return data;
  }

  /**
   * Place multiple orders in batch (up to 5)
   */
  async batchOrders(market, orders) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);

    if (!Array.isArray(orders) || orders.length === 0 || orders.length > 5) {
      throw new Error('batchOrders requires 1-5 orders');
    }

    const batchPayload = orders.map(o => {
      const p = { ...o };
      if (p.symbol) p.symbol = p.symbol.toUpperCase();
      if (p.side) p.side = p.side.toUpperCase();
      if (p.type) p.type = p.type.toUpperCase();
      if (p.quantity) p.quantity = String(p.quantity);
      if (p.price) p.price = String(p.price);
      if (p.stopPrice) p.stopPrice = String(p.stopPrice);
      return p;
    });

    const data = await client.post(`${prefix}/batchOrders`, {
      batchOrders: JSON.stringify(batchPayload),
    }, true);

    this.emit('order:batch', { market, results: data });
    return data;
  }

  async cancelOrder(market, symbol, orderId) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.del(`${prefix}/order`, {
      symbol: symbol.toUpperCase(),
      orderId,
    }, true);
    this.emit('order:cancel', { market, order: data });
    return data;
  }

  async cancelAllOrders(market, symbol) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.del(`${prefix}/allOpenOrders`, {
      symbol: symbol.toUpperCase(),
    }, true);
    this.emit('order:cancelAll', { market, symbol, result: data });
    return data;
  }

  async getOrder(market, symbol, orderId) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/order`, {
      symbol: symbol.toUpperCase(),
      orderId,
    }, true);
  }

  async getOpenOrders(market, symbol = null) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const params = symbol ? { symbol: symbol.toUpperCase() } : {};
    return client.get(`${prefix}/openOrders`, params, true);
  }

  async getAllOrders(market, symbol, limit = 50) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/allOrders`, {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 1000),
    }, true);
  }

  // ─── Convenience Order Methods ──────────────────────────────────

  async marketBuy(market, symbol, quantity, opts = {}) {
    return this.newOrder(market, {
      symbol, side: 'BUY', type: 'MARKET', quantity,
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
      newOrderRespType: 'RESULT',
    });
  }

  async marketSell(market, symbol, quantity, opts = {}) {
    return this.newOrder(market, {
      symbol, side: 'SELL', type: 'MARKET', quantity,
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
      newOrderRespType: 'RESULT',
    });
  }

  async limitBuy(market, symbol, quantity, price, opts = {}) {
    return this.newOrder(market, {
      symbol, side: 'BUY', type: 'LIMIT', quantity, price,
      timeInForce: opts.timeInForce || 'GTC',
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
    });
  }

  async limitSell(market, symbol, quantity, price, opts = {}) {
    return this.newOrder(market, {
      symbol, side: 'SELL', type: 'LIMIT', quantity, price,
      timeInForce: opts.timeInForce || 'GTC',
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
    });
  }

  async stopMarket(market, symbol, side, quantity, stopPrice, opts = {}) {
    return this.newOrder(market, {
      symbol, side, type: 'STOP_MARKET', quantity, stopPrice,
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
      workingType: opts.workingType || 'CONTRACT_PRICE',
      closePosition: opts.closePosition,
    });
  }

  async takeProfitMarket(market, symbol, side, quantity, stopPrice, opts = {}) {
    return this.newOrder(market, {
      symbol, side, type: 'TAKE_PROFIT_MARKET', quantity, stopPrice,
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
      workingType: opts.workingType || 'CONTRACT_PRICE',
      closePosition: opts.closePosition,
    });
  }

  async trailingStop(market, symbol, side, quantity, callbackRate, opts = {}) {
    return this.newOrder(market, {
      symbol, side, type: 'TRAILING_STOP_MARKET',
      quantity, callbackRate,
      activationPrice: opts.activationPrice,
      positionSide: opts.positionSide,
      reduceOnly: opts.reduceOnly,
      workingType: opts.workingType || 'CONTRACT_PRICE',
    });
  }

  /**
   * Close a position at market price
   * Works in both one-way and hedge mode
   */
  async closePosition(market, symbol, positionSide = 'BOTH') {
    const positions = await this.getPositions(market, symbol);
    const pos = positions.find(p => {
      if (positionSide === 'BOTH') return p.positionAmt !== 0;
      return p.positionSide === positionSide && p.positionAmt !== 0;
    });

    if (!pos) {
      return { ok: false, error: `No open position for ${symbol} (${positionSide})` };
    }

    const side = pos.positionAmt > 0 ? 'SELL' : 'BUY';
    const qty = Math.abs(pos.positionAmt);

    const order = await this.newOrder(market, {
      symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      positionSide: positionSide !== 'BOTH' ? positionSide : undefined,
      reduceOnly: positionSide === 'BOTH' ? true : undefined,
    });

    return { ok: true, order, closedPosition: pos };
  }

  /**
   * Close all open positions at market
   */
  async closeAllPositions(market) {
    const positions = await this.getOpenPositions(market);
    const results = [];

    for (const pos of positions) {
      try {
        const side = pos.positionAmt > 0 ? 'SELL' : 'BUY';
        const qty = Math.abs(pos.positionAmt);
        const order = await this.newOrder(market, {
          symbol: pos.symbol,
          side,
          type: 'MARKET',
          quantity: qty,
          positionSide: pos.positionSide !== 'BOTH' ? pos.positionSide : undefined,
          reduceOnly: pos.positionSide === 'BOTH' ? true : undefined,
        });
        results.push({ ok: true, symbol: pos.symbol, order });
      } catch (err) {
        results.push({ ok: false, symbol: pos.symbol, error: err.message });
      }
    }

    return results;
  }

  // ─── Trade History & Income ─────────────────────────────────────

  async getMyTrades(market, symbol, limit = 50) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/userTrades`, {
      symbol: symbol.toUpperCase(),
      limit: Math.min(limit, 1000),
    }, true);
  }

  async getIncome(market, opts = {}) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const params = {};
    if (opts.symbol) params.symbol = opts.symbol.toUpperCase();
    if (opts.incomeType) params.incomeType = opts.incomeType;
    if (opts.startTime) params.startTime = opts.startTime;
    if (opts.endTime) params.endTime = opts.endTime;
    params.limit = Math.min(opts.limit || 100, 1000);
    return client.get(`${prefix}/income`, params, true);
  }

  async getForceOrders(market, opts = {}) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const params = {};
    if (opts.symbol) params.symbol = opts.symbol.toUpperCase();
    if (opts.autoCloseType) params.autoCloseType = opts.autoCloseType;
    if (opts.startTime) params.startTime = opts.startTime;
    if (opts.endTime) params.endTime = opts.endTime;
    params.limit = Math.min(opts.limit || 50, 100);
    return client.get(`${prefix}/forceOrders`, params, true);
  }

  // ─── Commission & Fee ───────────────────────────────────────────

  async getCommissionRate(market, symbol) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    return client.get(`${prefix}/commissionRate`, {
      symbol: symbol.toUpperCase(),
    }, true);
  }

  // ─── User Data Stream (Listen Key) ─────────────────────────────

  async startUserDataStream(market) {
    const client = this._getClient(market);
    const prefix = this._prefix(market);
    const data = await client.post(`${prefix}/listenKey`, {}, false);
    const listenKey = data.listenKey;

    // Keep-alive every 30 minutes
    const interval = setInterval(async () => {
      try {
        await client.put(`${prefix}/listenKey`, {}, false);
      } catch (err) {
        this.emit('error', { market, type: 'listenKey:keepAlive', error: err.message });
      }
    }, 30 * 60 * 1000);

    this.listenKeys.set(market, { key: listenKey, interval });
    this.emit('userDataStream:started', { market, listenKey });
    return listenKey;
  }

  async stopUserDataStream(market) {
    const entry = this.listenKeys.get(market);
    if (!entry) return;

    clearInterval(entry.interval);
    try {
      const client = this._getClient(market);
      const prefix = this._prefix(market);
      await client.del(`${prefix}/listenKey`, {}, false);
    } catch {}

    this.listenKeys.delete(market);
    this.emit('userDataStream:stopped', { market });
  }

  getListenKey(market) {
    return this.listenKeys.get(market)?.key || null;
  }

  // ─── Cleanup ───────────────────────────────────────────────────

  async disconnect(market = null) {
    const markets = market ? [market] : [...this.clients.keys()];

    for (const m of markets) {
      await this.stopUserDataStream(m).catch(() => {});
      this.clients.delete(m);
      this.filterManagers.delete(m);
      this.initialized.delete(m);
    }

    this.emit('disconnected', { markets });
  }

  getStatus() {
    const status = {};
    for (const [market, initialized] of this.initialized) {
      status[market] = {
        initialized,
        hasListenKey: !!this.listenKeys.get(market),
      };
    }
    return {
      markets: status,
      testnet: this.config?.testnet ?? null,
    };
  }
}

// ─── Singleton Management ─────────────────────────────────────────

let futuresInstance = null;

export function getFuturesConnector() {
  if (!futuresInstance) futuresInstance = new BinanceFuturesConnector();
  return futuresInstance;
}

export function resetFuturesConnector() {
  if (futuresInstance) {
    futuresInstance.disconnect().catch(() => {});
    futuresInstance = null;
  }
}

export { BinanceAPIError };

