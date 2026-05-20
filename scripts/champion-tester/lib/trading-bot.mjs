import { EventEmitter } from 'node:events';
import { createStrategy } from './strategies/index.mjs';
import crypto from 'node:crypto';

/**
 * TradingBot — individual bot instance that monitors one symbol.
 * Subscribes to market data, runs strategy, generates signals.
 * 
 * Lifecycle: CREATED → STARTING → RUNNING → STOPPING → STOPPED
 *                                    ├→ PAUSED
 *                                    └→ ERROR
 */

const BOT_STATES = {
  CREATED: 'created',
  STARTING: 'starting',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
};

class TradingBot extends EventEmitter {
  constructor(config) {
    super();
    this.id = config.id || `bot_${crypto.randomUUID().slice(0, 8)}`;
    this.config = {
      symbol: config.symbol,
      market: config.market || 'usdm',
      strategy: config.strategy || 'momentum',
      strategyParams: config.strategyParams || {},
      timeframe: config.timeframe || '15m',
      leverage: config.leverage || 10,
      marginType: config.marginType || 'ISOLATED',
      positionSide: config.positionSide || 'BOTH',
      allocation: config.allocation || 100,
      maxPositionSize: config.maxPositionSize || 50,
      stopLossPct: config.stopLossPct || 2.0,
      takeProfitPct: config.takeProfitPct || 4.0,
      trailingStopPct: config.trailingStopPct || null,
      cooldownMs: config.cooldownMs || 30000,
      enabled: config.enabled !== false,
      createdAt: config.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.state = BOT_STATES.CREATED;
    this.strategy = null;
    this.position = null;
    this.lastSignalTime = 0;
    this.lastTradeTime = 0;
    this.errorCount = 0;
    this.unrealizedPnl = 0;
    this.lastPrice = null;
    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnl: 0,
      bestTrade: 0,
      worstTrade: 0,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      lastTradeWin: false,
      avgWinAmount: 0,
      avgLossAmount: 0,
      avgWinLossRatio: 0,
      startedAt: null,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  start() {
    if (this.state === BOT_STATES.RUNNING) return;
    this.state = BOT_STATES.STARTING;

    try {
      this.strategy = createStrategy(this.config.strategy, {
        ...this.config.strategyParams,
        timeframe: this.config.timeframe,
      });
      this.state = BOT_STATES.RUNNING;
      this.stats.startedAt = new Date().toISOString();
      this.errorCount = 0;
      this.emit('started', { botId: this.id });
    } catch (err) {
      this.state = BOT_STATES.ERROR;
      this.emit('error', { botId: this.id, error: err.message });
    }
  }

  stop() {
    if (this.state === BOT_STATES.STOPPED) return;
    this.state = BOT_STATES.STOPPING;
    this.strategy = null;
    this.state = BOT_STATES.STOPPED;
    this.emit('stopped', { botId: this.id });
  }

  pause() {
    if (this.state !== BOT_STATES.RUNNING) return;
    this.state = BOT_STATES.PAUSED;
    this.emit('paused', { botId: this.id });
  }

  resume() {
    if (this.state !== BOT_STATES.PAUSED) return;
    this.state = BOT_STATES.RUNNING;
    this.emit('resumed', { botId: this.id });
  }

  // ─── Market Data Handlers ───────────────────────────────────────

  /**
   * Called when a kline closes for this bot's symbol/timeframe.
   * @returns {object|null} signal or null
   */
  onKlineClose(kline) {
    if (this.state !== BOT_STATES.RUNNING) return null;
    if (!this.strategy) return null;

    // Cooldown check
    if (Date.now() - this.lastTradeTime < this.config.cooldownMs) return null;

    try {
      const signal = this.strategy.onKlineClose(kline);
      if (signal) {
        this.lastSignalTime = Date.now();
        // Enrich signal with bot context
        signal.botId = this.id;
        signal.symbol = this.config.symbol;
        signal.market = this.config.market;
        signal.leverage = this.config.leverage;
        signal.allocation = this.config.allocation;
        signal.maxPositionSize = this.config.maxPositionSize;
        signal.stopLossPct = this.config.stopLossPct;
        signal.takeProfitPct = this.config.takeProfitPct;
        signal.trailingStopPct = this.config.trailingStopPct;
        this.emit('signal', signal);
        return signal;
      }
    } catch (err) {
      this.errorCount++;
      this.emit('error', { botId: this.id, error: err.message, errorCount: this.errorCount });
      if (this.errorCount >= 5) {
        this.pause();
        this.emit('autoPaused', { botId: this.id, reason: 'Too many errors' });
      }
    }

    return null;
  }

  /**
   * Called on real-time price updates for position monitoring.
   */
  onPriceUpdate(price) {
    if (this.state !== BOT_STATES.RUNNING) return null;
    if (!this.position) return null;
    if (!this.strategy) return null;

    try {
      return this.strategy.onPriceUpdate(price, this.position);
    } catch { return null; }
  }

  // ─── Position Tracking ──────────────────────────────────────────

  setPosition(position) {
    this.position = position;
  }

  clearPosition() {
    this.position = null;
  }

  registerTradeResult(pnl) {
    this.stats.totalTrades++;
    this.stats.totalPnl += pnl;
    this.lastTradeTime = Date.now();

    if (pnl > 0) {
      this.stats.winningTrades++;
      this.stats.consecutiveWins++;
      this.stats.consecutiveLosses = 0;
      this.stats.lastTradeWin = true;
      if (pnl > this.stats.bestTrade) this.stats.bestTrade = pnl;
      // Running average of win amounts
      this.stats.avgWinAmount =
        ((this.stats.avgWinAmount * (this.stats.winningTrades - 1)) + pnl) / this.stats.winningTrades;
    } else if (pnl < 0) {
      this.stats.losingTrades++;
      this.stats.consecutiveLosses++;
      this.stats.consecutiveWins = 0;
      this.stats.lastTradeWin = false;
      if (pnl < this.stats.worstTrade) this.stats.worstTrade = pnl;
      // Running average of loss amounts (stored as positive)
      this.stats.avgLossAmount =
        ((this.stats.avgLossAmount * (this.stats.losingTrades - 1)) + Math.abs(pnl)) / this.stats.losingTrades;
    }

    // Compute win/loss ratio
    this.stats.avgWinLossRatio = this.stats.avgLossAmount > 0
      ? this.stats.avgWinAmount / this.stats.avgLossAmount
      : 0;
  }

  // ─── Status ─────────────────────────────────────────────────────

  getStatus() {
    return {
      id: this.id,
      config: this.config,
      state: this.state,
      position: this.position,
      stats: this.stats,
      unrealizedPnl: this.unrealizedPnl || 0,
      lastPrice: this.lastPrice || null,
      strategyReady: this.strategy?.isReady() || false,
      errorCount: this.errorCount,
      lastSignalTime: this.lastSignalTime,
      lastTradeTime: this.lastTradeTime,
      winRate: this.stats.totalTrades > 0
        ? ((this.stats.winningTrades / this.stats.totalTrades) * 100).toFixed(1)
        : '0.0',
    };
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(patch) {
    const wasRunning = this.state === BOT_STATES.RUNNING;
    if (wasRunning) this.stop();
    this.config = { ...this.config, ...patch, updatedAt: new Date().toISOString() };
    if (wasRunning && this.config.enabled) this.start();
  }
}

export { TradingBot, BOT_STATES };
