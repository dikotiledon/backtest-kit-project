import { getConnector } from './binance-connector.mjs';
import { getFuturesConnector } from './binance-futures-connector.mjs';
import { loadConfig } from './binance-config.mjs';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRADE_LOG_DIR = path.resolve(__dirname, '..', 'data', 'trade-logs');

/**
 * TradeExecutor — bridges champion strategy signals to live Binance orders.
 * Supports Spot, USD-M Futures, and COIN-M Futures markets.
 * Enforces risk limits, position sizing, leverage management, and trade logging.
 */
class TradeExecutor extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.dailyStats = { trades: 0, pnl: 0, losses: 0, date: null };
    this.openPositions = new Map(); // key -> position (key = market:symbol:side)
    this.pendingOrders = new Map(); // orderId -> order meta
    this.lastLossTime = 0;
    this.lastLiquidationTime = 0;
    this.tradeLog = [];
    this._config = null;
  }

  async start() {
    const config = await loadConfig();
    if (!config) throw new Error('Binance not configured');
    if (!config.tradingEnabled) throw new Error('Trading is disabled in config');

    this._config = config;

    // Initialize spot connector
    const connector = getConnector();
    if (!connector.isConnected()) await connector.initialize();
    await connector.loadExchangeInfo();

    // Initialize futures if enabled
    if (config.futures?.enabled) {
      const futuresConn = getFuturesConnector();
      const markets = config.futures.markets || ['usdm'];
      await futuresConn.initialize({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        testnet: config.testnet,
        markets,
      });
      for (const m of markets) {
        await futuresConn.loadExchangeInfo(m);
      }
    }

    this.riskLimits = config.riskLimits;
    this.futuresRiskLimits = config.futures?.riskLimits || null;
    this.futuresConfig = config.futures || null;
    this.resetDailyIfNeeded();
    this.active = true;
    this.emit('started');
    return { ok: true };
  }

  stop() {
    this.active = false;
    this.emit('stopped');
    return { ok: true };
  }

  isActive() {
    return this.active;
  }

  // ─── Risk Management ────────────────────────────────────────────

  resetDailyIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyStats.date !== today) {
      this.dailyStats = { trades: 0, pnl: 0, losses: 0, date: today };
    }
  }

  checkRiskLimits(market, symbol, side, sizeUSDT) {
    this.resetDailyIfNeeded();
    const isFutures = market === 'usdm' || market === 'coinm';
    const limits = isFutures ? (this.futuresRiskLimits || this.riskLimits) : this.riskLimits;
    const violations = [];

    // Max daily trades
    if (this.dailyStats.trades >= limits.maxDailyTrades) {
      violations.push(`Daily trade limit reached (${limits.maxDailyTrades})`);
    }

    // Max daily loss
    if (this.dailyStats.pnl < 0 && Math.abs(this.dailyStats.pnl) >= limits.maxDailyLossUSDT) {
      violations.push(`Daily loss limit reached ($${limits.maxDailyLossUSDT})`);
    }

    // Max position size
    const maxSize = limits.maxPositionSizeUSDT;
    if (sizeUSDT > maxSize) {
      violations.push(`Position size $${sizeUSDT.toFixed(2)} exceeds max $${maxSize}`);
    }

    // Max open positions
    const currentPositions = this._countPositions(market);
    if (side === 'BUY' && currentPositions >= limits.maxOpenPositions) {
      violations.push(`Max open positions reached (${limits.maxOpenPositions})`);
    }

    // Cooldown after loss
    if (Date.now() - this.lastLossTime < limits.cooldownAfterLossMs) {
      const remaining = Math.ceil((limits.cooldownAfterLossMs - (Date.now() - this.lastLossTime)) / 1000);
      violations.push(`Loss cooldown active (${remaining}s remaining)`);
    }

    // Futures-specific: cooldown after liquidation
    if (isFutures && this.futuresRiskLimits?.cooldownAfterLiquidation) {
      if (Date.now() - this.lastLiquidationTime < this.futuresRiskLimits.cooldownAfterLiquidation) {
        const remaining = Math.ceil(
          (this.futuresRiskLimits.cooldownAfterLiquidation - (Date.now() - this.lastLiquidationTime)) / 1000
        );
        violations.push(`Liquidation cooldown active (${remaining}s remaining)`);
      }
    }

    // Futures-specific: max leverage check
    if (isFutures && this.futuresRiskLimits?.maxLeverage) {
      // This is checked at order time, not here
    }

    return violations;
  }

  _countPositions(market) {
    let count = 0;
    for (const [key] of this.openPositions) {
      if (market && !key.startsWith(market + ':')) continue;
      count++;
    }
    return count;
  }

  _positionKey(market, symbol, positionSide = 'BOTH') {
    return `${market}:${symbol.toUpperCase()}:${positionSide}`;
  }

  // ─── Signal Execution (Spot) ────────────────────────────────────

  /**
   * Execute a trading signal
   * @param {object} signal
   * @param {string} signal.market - 'spot' | 'usdm' | 'coinm'
   * @param {string} signal.symbol
   * @param {string} signal.side - BUY | SELL
   * @param {string} [signal.type] - MARKET | LIMIT
   * @param {number} [signal.quantity]
   * @param {number} [signal.price]
   * @param {number} [signal.stopLoss]
   * @param {number} [signal.takeProfit]
   * @param {number} [signal.leverage] - futures only
   * @param {string} [signal.marginType] - futures only: CROSSED | ISOLATED
   * @param {string} [signal.positionSide] - futures hedge mode: LONG | SHORT
   * @param {number} [signal.callbackRate] - trailing stop %
   * @param {string} [signal.reason]
   */
  async executeSignal(signal) {
    if (!this.active) {
      return { ok: false, error: 'Trade executor not active' };
    }

    const market = signal.market || 'spot';

    if (market === 'spot') {
      return this._executeSpotSignal(signal);
    } else if (market === 'usdm' || market === 'coinm') {
      return this._executeFuturesSignal(signal);
    } else {
      return { ok: false, error: `Unknown market: ${market}` };
    }
  }

  async _executeSpotSignal(signal) {
    const connector = getConnector();
    if (!connector.isConnected()) {
      return { ok: false, error: 'Binance connector not connected' };
    }

    const { symbol, side, type = 'MARKET', reason = '' } = signal;
    let { quantity, price, stopLoss, takeProfit } = signal;

    // Get current price for risk calculation
    const currentPrice = (await connector.getPrice(symbol)).price;
    const sizeUSDT = (quantity || 0) * currentPrice;

    // Risk check
    const violations = this.checkRiskLimits('spot', symbol, side, sizeUSDT);
    if (violations.length > 0) {
      const result = {
        ok: false, error: 'Risk limit violated', market: 'spot',
        violations, signal, timestamp: Date.now(),
      };
      this.emit('signal:rejected', result);
      await this.logTrade(result);
      return result;
    }

    // Adjust to exchange filters
    const adjusted = connector.adjustOrder(symbol, quantity, price);
    quantity = adjusted.quantity;
    if (price) price = adjusted.price;

    // Check minimum notional
    if (adjusted.minNotional > 0) {
      const notional = quantity * (price || currentPrice);
      if (notional < adjusted.minNotional) {
        return {
          ok: false,
          error: `Order notional $${notional.toFixed(2)} below minimum $${adjusted.minNotional}`,
        };
      }
    }

    try {
      let mainOrder;

      if (type === 'MARKET') {
        mainOrder = side === 'BUY'
          ? await connector.marketBuy(symbol, quantity)
          : await connector.marketSell(symbol, quantity);
      } else if (type === 'LIMIT') {
        if (!price) price = currentPrice;
        mainOrder = side === 'BUY'
          ? await connector.limitBuy(symbol, quantity, price)
          : await connector.limitSell(symbol, quantity, price);
      } else {
        return { ok: false, error: `Unsupported order type: ${type}` };
      }

      // Track position
      const executedQty = parseFloat(mainOrder.executedQty || mainOrder.origQty);
      const avgPrice = this._calcAvgPrice(mainOrder);
      const posKey = this._positionKey('spot', symbol);

      if (side === 'BUY') {
        this.openPositions.set(posKey, {
          market: 'spot', symbol, side: 'LONG',
          entryPrice: avgPrice, quantity: executedQty,
          orderId: mainOrder.orderId, entryTime: Date.now(),
          stopLoss, takeProfit,
        });
      } else {
        const pos = this.openPositions.get(posKey);
        if (pos) {
          const pnl = (avgPrice - pos.entryPrice) * executedQty;
          this.dailyStats.pnl += pnl;
          if (pnl < 0) {
            this.dailyStats.losses++;
            this.lastLossTime = Date.now();
          }
          this.openPositions.delete(posKey);
        }
      }

      this.dailyStats.trades++;

      // Place SL/TP if provided
      let slOrder = null;
      let tpOrder = null;

      if (stopLoss && side === 'BUY') {
        try {
          slOrder = await connector.stopLossOrder(symbol, 'SELL', executedQty, stopLoss);
        } catch (err) {
          this.emit('error', { type: 'stopLoss', error: err.message });
        }
      }

      if (takeProfit && side === 'BUY') {
        try {
          tpOrder = await connector.takeProfitOrder(symbol, 'SELL', executedQty, takeProfit);
        } catch (err) {
          this.emit('error', { type: 'takeProfit', error: err.message });
        }
      }

      const result = {
        ok: true, market: 'spot',
        order: mainOrder, stopLossOrder: slOrder, takeProfitOrder: tpOrder,
        executedQty, avgPrice, signal, reason, timestamp: Date.now(),
      };

      this.emit('signal:executed', result);
      await this.logTrade(result);
      return result;

    } catch (err) {
      const result = {
        ok: false, error: err.message, market: 'spot',
        signal, timestamp: Date.now(),
        binanceError: err.binanceData || null,
      };
      this.emit('signal:error', result);
      await this.logTrade(result);
      return result;
    }
  }

  // ─── Position Management ─────────────────────────────────────────

  /**
   * Close a position (works for spot and futures)
   */
  async closePosition(market, symbol, positionSide = 'BOTH') {
    if (market === 'spot') {
      const posKey = this._positionKey('spot', symbol);
      const pos = this.openPositions.get(posKey);
      if (!pos) return { ok: false, error: `No open spot position for ${symbol}` };

      return this.executeSignal({
        market: 'spot',
        symbol: pos.symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: pos.quantity,
        reason: 'Manual close',
      });
    }

    // Futures close
    const futuresConn = getFuturesConnector();
    if (!futuresConn.isInitialized(market)) {
      return { ok: false, error: `Futures market '${market}' not initialized` };
    }

    const result = await futuresConn.closePosition(market, symbol, positionSide);

    if (result.ok) {
      const posKey = this._positionKey(market, symbol, positionSide);
      const pos = this.openPositions.get(posKey);
      if (pos) {
        const avgPrice = parseFloat(result.order.avgPrice || result.order.price || '0');
        const direction = pos.side === 'LONG' ? 1 : -1;
        const pnl = direction * (avgPrice - pos.entryPrice) * Math.abs(result.closedPosition.positionAmt);
        this.dailyStats.pnl += pnl;
        if (pnl < 0) {
          this.dailyStats.losses++;
          this.lastLossTime = Date.now();
        }
        this.openPositions.delete(posKey);
      }
      this.dailyStats.trades++;
      this.emit('position:closed', { market, symbol, positionSide, result });
      await this.logTrade({ ok: true, market, action: 'close', symbol, positionSide, ...result });
    }

    return result;
  }

  /**
   * Close all positions across all markets
   */
  async closeAllPositions(market = null) {
    const results = [];

    if (!market || market === 'spot') {
      for (const [key, pos] of this.openPositions) {
        if (!key.startsWith('spot:')) continue;
        const r = await this.closePosition('spot', pos.symbol);
        results.push(r);
      }
    }

    if (!market || market === 'usdm') {
      const futuresConn = getFuturesConnector();
      if (futuresConn.isInitialized('usdm')) {
        const futuresResults = await futuresConn.closeAllPositions('usdm');
        for (const r of futuresResults) {
          results.push({ ...r, market: 'usdm' });
        }
        for (const [key] of this.openPositions) {
          if (key.startsWith('usdm:')) this.openPositions.delete(key);
        }
      }
    }

    if (!market || market === 'coinm') {
      const futuresConn = getFuturesConnector();
      if (futuresConn.isInitialized('coinm')) {
        const futuresResults = await futuresConn.closeAllPositions('coinm');
        for (const r of futuresResults) {
          results.push({ ...r, market: 'coinm' });
        }
        for (const [key] of this.openPositions) {
          if (key.startsWith('coinm:')) this.openPositions.delete(key);
        }
      }
    }

    return results;
  }

  // ─── Position Tracking ──────────────────────────────────────────

  getOpenPositions(market = null) {
    const positions = [];
    for (const [key, pos] of this.openPositions) {
      if (market && !key.startsWith(market + ':')) continue;
      positions.push(pos);
    }
    return positions;
  }

  getDailyStats() {
    this.resetDailyIfNeeded();
    return { ...this.dailyStats };
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  _calcAvgPrice(orderResponse) {
    if (orderResponse.fills && orderResponse.fills.length > 0) {
      let totalQty = 0;
      let totalCost = 0;
      for (const fill of orderResponse.fills) {
        const qty = parseFloat(fill.qty);
        const price = parseFloat(fill.price);
        totalQty += qty;
        totalCost += qty * price;
      }
      return totalCost / totalQty;
    }
    return parseFloat(orderResponse.avgPrice || orderResponse.price || '0');
  }

  // ─── Trade Logging ───────────────────────────────────────────────

  async logTrade(tradeResult) {
    this.tradeLog.push(tradeResult);

    if (this.tradeLog.length > 500) {
      this.tradeLog = this.tradeLog.slice(-200);
    }

    try {
      await fs.mkdir(TRADE_LOG_DIR, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      const logFile = path.join(TRADE_LOG_DIR, `${today}.jsonl`);
      const line = JSON.stringify({
        ...tradeResult,
        _logged: new Date().toISOString(),
      }) + '\n';
      await fs.appendFile(logFile, line, 'utf8');
    } catch {}
  }

  async getTradeHistory(date = null) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const logFile = path.join(TRADE_LOG_DIR, `${targetDate}.jsonl`);
    try {
      const raw = await fs.readFile(logFile, 'utf8');
      return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  }

  async getRecentTrades(limit = 20) {
    return this.tradeLog.slice(-limit);
  }

  // ─── Status ──────────────────────────────────────────────────────

  getStatus() {
    return {
      active: this.active,
      openPositions: this.getOpenPositions(),
      dailyStats: this.getDailyStats(),
      recentTrades: this.tradeLog.slice(-5),
      riskLimits: this.riskLimits || null,
      futuresRiskLimits: this.futuresRiskLimits || null,
      futuresEnabled: this.futuresConfig?.enabled || false,
    };
  }
}

// Singleton
let executorInstance = null;

export function getExecutor() {
  if (!executorInstance) executorInstance = new TradeExecutor();
  return executorInstance;
}

export { TradeExecutor };

