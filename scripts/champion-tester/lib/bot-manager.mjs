import { EventEmitter } from 'node:events';
import { TradingBot, BOT_STATES } from './trading-bot.mjs';
import { getTradeDB } from './trade-db.mjs';
import { getRiskManager } from './risk-manager.mjs';
import { getMarketDataService } from './market-data-service.mjs';
import { getExecutor } from './trade-executor.mjs';
import { getFundingTracker } from './funding-tracker.mjs';
import { getSlippageEstimator } from './slippage-estimator.mjs';
import { getPositionSizer } from './position-sizer.mjs';
import { CorrelationFilter } from './strategies/correlation-filter.mjs';
import crypto from 'node:crypto';

/**
 * BotManager — orchestrates multiple trading bots.
 * Provides master start/stop, bot CRUD, market data routing,
 * and signal → order execution bridge.
 */
class BotManager extends EventEmitter {
  constructor() {
    super();
    this.bots = new Map(); // botId -> TradingBot
    this.masterState = 'stopped'; // 'running' | 'stopped' | 'paused'
    this._signalQueue = [];
    this._settings = {
      maxConcurrentBots: 10,
      maxGlobalDailyLossUSDT: 100,
      autoRestartOnError: true,
      autoRestartMaxRetries: 3,
      paperTrade: true, // default true for safety — no real orders unless explicitly disabled
      useCorrelationFilter: true,
      correlationThreshold: 0.7,
      correlationWindow: 50,
    };
    this._correlationFilter = new CorrelationFilter();
    this._klineHandlers = new Map(); // 'market:symbol:interval' -> Set<botId>
  }

  // ─── Master Controls ────────────────────────────────────────────

  async startAll() {
    if (this.masterState === 'running') return { ok: true, already: true };

    // Start periodic unrealized PnL broadcast
    this._startUnrealizedPnlBroadcast();

    // Get mode from trading config
    let mode = 'live';
    try {
      const { loadConfig } = await import('./binance-config.mjs');
      const cfg = await loadConfig();
      if (cfg?.testnet) mode = 'demo'; // testnet toggle = demo mode
    } catch {}

    const mds = getMarketDataService();
    if (!mds.isStarted()) {
      mds.mode = mode;
      mds.start(['usdm']); // Start futures stream (primary market)
      this.emit('log', { level: 'info', message: `Market data service started (mode=${mode})` });
    }

    // Wire up kline routing
    this._wireMarketData(mds);

    // Start funding rate tracker
    const ft = getFundingTracker();
    if (!ft.isStarted()) {
      ft.start(['usdm']);
      this.emit('log', { level: 'info', message: 'Funding rate tracker started' });
    }
    // Wire markPrice events to funding tracker
    mds.on('markPrice:update', (data) => ft.onMarkPriceUpdate(data));
    // Wire funding payment events to log broadcast
    ft.on('funding:payment', (data) => {
      this.emit('log', {
        level: 'info',
        message: `[FUNDING] ${data.direction} ${data.symbol} rate=${(data.rate * 100).toFixed(4)}% payment=${data.payment.toFixed(4)} USDT (bot: ${data.botId})`,
      });
    });

    let started = 0;
    for (const [, bot] of this.bots) {
      if (bot.config.enabled && bot.state !== BOT_STATES.RUNNING) {
        bot.start();
        this._subscribeBot(bot, mds);
        this.emit('log', { level: 'info', message: `Bot ${bot.id} subscribed to ${bot.config.symbol}@kline_${bot.config.timeframe} (${bot.config.market})` });
        started++;
      }
    }

    // Track symbols for all enabled bots in funding tracker + subscribe markPrice
    const ft2 = getFundingTracker();
    const fundingSymbols = new Map(); // market -> Set<symbol>
    for (const [, bot] of this.bots) {
      if (bot.config.enabled && bot.config.market && bot.config.market !== 'spot') {
        ft2.trackSymbol(bot.config.symbol, bot.config.market);
        if (!fundingSymbols.has(bot.config.market)) fundingSymbols.set(bot.config.market, new Set());
        fundingSymbols.get(bot.config.market).add(bot.config.symbol);
      }
    }
    // Subscribe to markPrice streams for funding rate data
    for (const [market, symbols] of fundingSymbols) {
      mds.subscribe([...symbols], ['markPrice'], market);
    }

    this.masterState = 'running';
    this.emit('manager:started', { botsStarted: started, mode });
    this.emit('log', { level: 'info', message: `Bot Manager started: ${started} bots running (${mode})` });
    return { ok: true, botsStarted: started };
  }

  stopAll() {
    // Stop unrealized PnL broadcast
    this._stopUnrealizedPnlBroadcast();

    for (const [, bot] of this.bots) {
      if (bot.state === BOT_STATES.RUNNING || bot.state === BOT_STATES.PAUSED) {
        bot.stop();
      }
    }

    // Stop funding tracker
    const ft = getFundingTracker();
    ft.stop();

    this.masterState = 'stopped';
    this._klineHandlers.clear();
    this._correlationFilter.clear();
    this.emit('manager:stopped', {});
    return { ok: true };
  }

  pauseAll() {
    for (const [, bot] of this.bots) {
      if (bot.state === BOT_STATES.RUNNING) bot.pause();
    }
    this.masterState = 'paused';
    this.emit('manager:paused', {});
    return { ok: true };
  }

  resumeAll() {
    for (const [, bot] of this.bots) {
      if (bot.state === BOT_STATES.PAUSED) bot.resume();
    }
    this.masterState = 'running';
    this.emit('manager:resumed', {});
    return { ok: true };
  }

  // ─── Bot CRUD ───────────────────────────────────────────────────

  createBot(config) {
    if (this.bots.size >= this._settings.maxConcurrentBots) {
      throw new Error(`Max bots limit reached (${this._settings.maxConcurrentBots})`);
    }

    const bot = new TradingBot(config);
    this._attachBotListeners(bot);
    this.bots.set(bot.id, bot);

    // Persist
    this._persistBot(bot);

    this.emit('bot:created', { botId: bot.id, config: bot.getConfig() });
    return bot.getStatus();
  }

  startBot(botId) {
    const bot = this._getBot(botId);
    bot.start();

    if (this.masterState === 'running') {
      const mds = getMarketDataService();
      this._subscribeBot(bot, mds);

      // Track symbol for funding if futures + subscribe markPrice
      if (bot.config.market && bot.config.market !== 'spot') {
        getFundingTracker().trackSymbol(bot.config.symbol, bot.config.market);
        mds.subscribe([bot.config.symbol], ['markPrice'], bot.config.market);
      }
    }

    this._persistBot(bot);
    return bot.getStatus();
  }

  stopBot(botId) {
    const bot = this._getBot(botId);
    bot.stop();
    this._unsubscribeBot(bot);

    // Untrack symbol from funding if no other bots use it
    if (bot.config.market && bot.config.market !== 'spot') {
      const otherBotsOnSymbol = [...this.bots.values()].some(
        b => b.id !== botId && b.config.symbol === bot.config.symbol
          && b.config.market === bot.config.market && b.state === BOT_STATES.RUNNING
      );
      if (!otherBotsOnSymbol) {
        getFundingTracker().untrackSymbol(bot.config.symbol, bot.config.market);
      }
    }

    this._persistBot(bot);
    return bot.getStatus();
  }

  pauseBot(botId) {
    const bot = this._getBot(botId);
    bot.pause();
    this._persistBot(bot);
    return bot.getStatus();
  }

  resumeBot(botId) {
    const bot = this._getBot(botId);
    bot.resume();
    this._persistBot(bot);
    return bot.getStatus();
  }

  deleteBot(botId) {
    const bot = this._getBot(botId);
    if (bot.state === BOT_STATES.RUNNING) bot.stop();
    this._unsubscribeBot(bot);
    bot.removeAllListeners();
    this.bots.delete(botId);

    try { getTradeDB().deleteBot(botId); } catch {}
    this.emit('bot:deleted', { botId });
    return { ok: true };
  }

  updateBot(botId, patch) {
    const bot = this._getBot(botId);
    bot.updateConfig(patch);
    this._persistBot(bot);
    this.emit('bot:updated', { botId, patch });
    return bot.getStatus();
  }

  // ─── Queries ────────────────────────────────────────────────────

  listBots(filter = {}) {
    let bots = [...this.bots.values()].map(b => b.getStatus());

    if (filter.state) bots = bots.filter(b => b.state === filter.state);
    if (filter.market) bots = bots.filter(b => b.config.market === filter.market);
    if (filter.symbol) bots = bots.filter(b => b.config.symbol === filter.symbol);

    return bots;
  }

  getBot(botId) {
    return this._getBot(botId).getStatus();
  }

  getBotStats(botId) {
    const bot = this._getBot(botId);
    return bot.stats;
  }

  getGlobalStats() {
    let totalPnl = 0, totalTrades = 0, wins = 0, losses = 0;
    let totalUnrealizedPnl = 0;
    for (const [, bot] of this.bots) {
      totalPnl += bot.stats.totalPnl;
      totalTrades += bot.stats.totalTrades;
      wins += bot.stats.winningTrades;
      losses += bot.stats.losingTrades;
      totalUnrealizedPnl += (bot.unrealizedPnl || 0);
    }
    return {
      totalBots: this.bots.size,
      runningBots: [...this.bots.values()].filter(b => b.state === BOT_STATES.RUNNING).length,
      totalPnl, totalUnrealizedPnl, totalTrades, wins, losses,
      winRate: totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0',
      masterState: this.masterState,
    };
  }

  getStatus() {
    return {
      masterState: this.masterState,
      totalBots: this.bots.size,
      running: [...this.bots.values()].filter(b => b.state === BOT_STATES.RUNNING).length,
      paused: [...this.bots.values()].filter(b => b.state === BOT_STATES.PAUSED).length,
      stopped: [...this.bots.values()].filter(b => b.state === BOT_STATES.STOPPED).length,
      settings: this._settings,
    };
  }

  // ─── Settings ───────────────────────────────────────────────────

  updateSettings(patch) {
    this._settings = { ...this._settings, ...patch };
  }

  getSettings() {
    return { ...this._settings };
  }

  // ─── Persistence ────────────────────────────────────────────────

  loadState() {
    try {
      const db = getTradeDB();
      const saved = db.getAllBots();
      for (const row of saved) {
        const bot = new TradingBot(row.config);
        bot.id = row.id;
        if (row.stats) bot.stats = row.stats;
        this._attachBotListeners(bot);
        this.bots.set(bot.id, bot);
      }
      return { ok: true, loaded: saved.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _persistBot(bot) {
    try {
      getTradeDB().saveBot(bot.id, bot.getConfig(), null, bot.stats);
    } catch { /* ignore if DB not ready */ }
  }

  // ─── Market Data Wiring ─────────────────────────────────────────

  _wireMarketData(mds) {
    // Remove old listeners to avoid duplicates
    mds.removeAllListeners('kline:update');
    mds.removeAllListeners('price:update');
    mds.removeAllListeners('stream:connected');
    mds.removeAllListeners('stream:disconnected');
    mds.removeAllListeners('stream:error');

    // Log stream lifecycle
    mds.on('stream:connected', (data) => {
      this.emit('log', { level: 'info', message: `WS stream connected: ${data.market}` });
    });
    mds.on('stream:disconnected', (data) => {
      this.emit('log', { level: 'warn', message: `WS stream disconnected: ${data.market} (code=${data.code})` });
    });
    mds.on('stream:error', (data) => {
      this.emit('log', { level: 'error', message: `WS stream error: ${data.market} — ${data.error}` });
    });
    mds.on('stream:reconnect', (data) => {
      this.emit('log', { level: 'warn', message: `WS reconnecting: ${data.market} attempt #${data.attempt} (delay ${data.delayMs}ms)` });
    });

    mds.on('kline:update', (data) => {
      const key = `${data.market}:${data.symbol}:${data.interval}`;
      const botIds = this._klineHandlers.get(key);
      if (!botIds || botIds.size === 0) return;

      // Only process closed klines
      if (!data.kline.isClosed) return;

      this.emit('log', { level: 'debug', message: `Kline closed: ${data.symbol} ${data.interval} O=${data.kline.open} H=${data.kline.high} L=${data.kline.low} C=${data.kline.close}` });

      for (const botId of botIds) {
        const bot = this.bots.get(botId);
        if (!bot || bot.state !== BOT_STATES.RUNNING) continue;
        bot.onKlineClose(data.kline);
      }
    });

    mds.on('price:update', (data) => {
      // Feed correlation filter with price data
      this._correlationFilter.addPrice(data.symbol, data.price, data.timestamp);

      // Route price updates to bots for position monitoring
      for (const [, bot] of this.bots) {
        if (bot.state !== BOT_STATES.RUNNING) continue;
        if (bot.config.symbol !== data.symbol) continue;
        if (bot.config.market !== data.market) continue;
        bot.onPriceUpdate(data.price);
      }

      // Calculate unrealized PnL for bots with open positions on this symbol
      for (const [, bot] of this.bots) {
        if (!bot.position) continue;
        if (bot.config.symbol !== data.symbol) continue;
        if (bot.config.market !== data.market) continue;

        const pos = bot.position;
        const direction = pos.side === 'LONG' ? 1 : -1;
        const unrealizedPnl = direction * (data.price - pos.entryPrice) * pos.quantity;
        bot.unrealizedPnl = unrealizedPnl;
        bot.lastPrice = data.price;
      }
    });
  }

  _subscribeBot(bot, mds) {
    const streamType = `kline_${bot.config.timeframe}`;
    const key = `${bot.config.market}:${bot.config.symbol}:${bot.config.timeframe}`;

    if (!this._klineHandlers.has(key)) {
      this._klineHandlers.set(key, new Set());
      // Subscribe to stream
      mds.subscribe([bot.config.symbol], [streamType, 'aggTrade'], bot.config.market);
    }
    this._klineHandlers.get(key).add(bot.id);
  }

  _unsubscribeBot(bot) {
    const key = `${bot.config.market}:${bot.config.symbol}:${bot.config.timeframe}`;
    const handlers = this._klineHandlers.get(key);
    if (handlers) {
      handlers.delete(bot.id);
      if (handlers.size === 0) {
        this._klineHandlers.delete(key);
        // Could unsubscribe from MDS here, but keep stream alive for other uses
      }
    }
  }

  // ─── Internal ───────────────────────────────────────────────────

  _getBot(botId) {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error(`Bot not found: ${botId}`);
    return bot;
  }

  /**
   * Collect open positions from all running bots for correlation checking.
   * @returns {Array<{symbol: string, direction: string}>}
   */
  _collectOpenPositions() {
    const positions = [];
    for (const [, bot] of this.bots) {
      if (bot.position) {
        positions.push({
          symbol: bot.position.symbol || bot.config.symbol,
          direction: bot.position.side, // 'LONG' or 'SHORT'
        });
      }
    }
    return positions;
  }

  _attachBotListeners(bot) {
    bot.on('signal', async (signal) => {
      // Pass through risk manager
      const rm = getRiskManager();
      const currentPrice = signal.suggestedEntry || signal.price || 0;

      // Dynamic position sizing
      const rmStatus = rm.getStatus();
      const rmState = rmStatus.state || {};
      const totalTrades = (bot.stats?.winningTrades || 0) + (bot.stats?.losingTrades || 0);
      const winRate = totalTrades > 0 ? (bot.stats.winningTrades / totalTrades) : 0;
      const consecutiveLosses = bot.stats?.consecutiveLosses || 0;
      const lastTradeWin = bot.stats?.lastTradeWin || false;

      const sizer = getPositionSizer();
      const sizing = sizer.calculateSize(signal.allocation, {
        equity: rmState.currentEquity,
        peakEquity: rmState.peakEquity,
        dailyPnl: rmState.dailyPnl,
        consecutiveLosses,
        winRate,
        avgWinLossRatio: bot.stats?.avgWinLossRatio || 0,
        lastTradeWin,
      });

      this.emit('log', {
        level: 'debug',
        message: `[POSITION-SIZER] bot=${bot.id} mode=${sizer.getMode()} base=${signal.allocation} adjusted=${sizing.adjustedAllocation.toFixed(2)} factor=${sizing.sizeFactor} reason="${sizing.reason}"`,
      });

      const effectiveAllocation = sizing.adjustedAllocation;
      const quantity = currentPrice > 0 ? effectiveAllocation / currentPrice : 0;

      const check = rm.checkOrder({
        symbol: signal.symbol,
        side: signal.action.includes('LONG') ? 'BUY' : 'SELL',
        quantity,
        price: currentPrice,
        leverage: signal.leverage,
      }, bot.id);

      if (check.allowed) {
        rm.registerTrade({ side: signal.action.includes('OPEN') ? 'BUY' : 'SELL' });
        this.emit('bot:signal', { ...signal, riskCheck: check, sizing });

        // Execute the signal
        await this._executeSignal(bot, signal, currentPrice, quantity);
      } else {
        this.emit('bot:signal:rejected', { ...signal, riskCheck: check });
      }
    });

    bot.on('error', (data) => {
      this.emit('bot:error', data);
    });

    bot.on('started', (data) => this.emit('bot:started', data));
    bot.on('stopped', (data) => this.emit('bot:stopped', data));
    bot.on('paused', (data) => this.emit('bot:paused', data));
    bot.on('resumed', (data) => this.emit('bot:resumed', data));
    bot.on('autoPaused', (data) => this.emit('bot:autoPaused', data));
  }

  // ─── Signal Execution ─────────────────────────────────────────────

  /**
   * Execute a validated signal — either paper trade or real execution.
   * Maps strategy signal format to TradeExecutor's expected format.
   */
  async _executeSignal(bot, signal, currentPrice, quantity) {
    const market = signal.market || bot.config.market || 'usdm';
    const isOpen = signal.action === 'OPEN_LONG' || signal.action === 'OPEN_SHORT';
    const isLong = signal.action === 'OPEN_LONG' || signal.action === 'CLOSE_SHORT';
    const side = isLong ? 'BUY' : 'SELL';

    // Correlation filter check — only on position opens
    if (isOpen && this._settings.useCorrelationFilter) {
      const direction = signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT';
      const openPositions = this._collectOpenPositions();
      const wouldAdd = this._correlationFilter.wouldAddExposure(
        signal.symbol,
        direction,
        openPositions,
        this._settings.correlationThreshold,
        this._settings.correlationWindow
      );
      if (wouldAdd) {
        this.emit('bot:signal:correlated', {
          botId: bot.id,
          symbol: signal.symbol,
          direction,
          reason: 'Correlated exposure risk',
        });
        this.emit('log', {
          level: 'warn',
          message: `[CORRELATION] Rejected ${signal.action} ${signal.symbol} for bot ${bot.id}: Correlated exposure risk`,
        });
        return { ok: false, error: 'Correlated exposure risk' };
      }
    }

    // Calculate SL/TP from bot config percentages
    const stopLossPct = signal.stopLossPct || bot.config.stopLossPct || 2.0;
    const takeProfitPct = signal.takeProfitPct || bot.config.takeProfitPct || 4.0;
    let stopLoss = null;
    let takeProfit = null;

    if (isOpen && currentPrice > 0) {
      if (isLong) {
        stopLoss = currentPrice * (1 - stopLossPct / 100);
        takeProfit = currentPrice * (1 + takeProfitPct / 100);
      } else {
        stopLoss = currentPrice * (1 + stopLossPct / 100);
        takeProfit = currentPrice * (1 - takeProfitPct / 100);
      }
    }

    const executorSignal = {
      market,
      symbol: signal.symbol,
      side,
      type: 'MARKET',
      quantity,
      leverage: signal.leverage || bot.config.leverage,
      marginType: bot.config.marginType || 'ISOLATED',
      positionSide: bot.config.positionSide || 'BOTH',
      stopLoss,
      takeProfit,
      reason: `${signal.action} via bot ${bot.id} (strategy: ${bot.config.strategy})`,
    };

    // Paper trading mode
    if (this._settings.paperTrade) {
      return this._executePaperTrade(bot, signal, executorSignal, currentPrice, quantity);
    }

    // Real execution
    try {
      const executor = getExecutor();
      if (!executor.isActive()) {
        await executor.start();
      }

      const result = await executor.executeSignal(executorSignal);

      if (result.ok) {
        this._handleExecutionResult(bot, signal, result, isOpen);
      } else {
        this.emit('log', {
          level: 'error',
          message: `Execution failed for bot ${bot.id}: ${result.error}`,
        });
      }

      return result;
    } catch (err) {
      this.emit('log', {
        level: 'error',
        message: `Execution error for bot ${bot.id}: ${err.message}`,
      });
      return { ok: false, error: err.message };
    }
  }

  /**
   * Paper trade: simulate fill at slippage-adjusted price, log to DB, update stats.
   */
  _executePaperTrade(bot, signal, executorSignal, currentPrice, quantity) {
    const isOpen = signal.action === 'OPEN_LONG' || signal.action === 'OPEN_SHORT';
    const tradeId = `paper_${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();

    // Apply slippage model for realistic fill price
    const fillPrice = getSlippageEstimator().getAdjustedPrice(
      executorSignal.symbol,
      executorSignal.market,
      executorSignal.side,
      quantity,
      currentPrice
    );

    const paperResult = {
      ok: true,
      paper: true,
      tradeId,
      market: executorSignal.market,
      symbol: executorSignal.symbol,
      side: executorSignal.side,
      type: 'MARKET',
      quantity,
      avgPrice: fillPrice,
      leverage: executorSignal.leverage,
      stopLoss: executorSignal.stopLoss,
      takeProfit: executorSignal.takeProfit,
      timestamp: Date.now(),
    };

    // Persist to DB
    try {
      const db = getTradeDB();
      db.insertTrade({
        id: tradeId,
        botId: bot.id,
        symbol: executorSignal.symbol,
        market: executorSignal.market,
        side: executorSignal.side,
        type: 'MARKET',
        quantity,
        price: fillPrice,
        avgFillPrice: fillPrice,
        status: 'FILLED',
        pnl: null,
        fees: 0,
        strategy: bot.config.strategy,
        signalReason: `[PAPER] ${signal.action}`,
        orderId: tradeId,
        binanceOrderId: null,
        createdAt: now,
        filledAt: now,
      });
    } catch { /* DB may not be ready */ }

    // Update bot position and stats
    if (isOpen) {
      bot.setPosition({
        market: executorSignal.market,
        symbol: executorSignal.symbol,
        side: signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT',
        entryPrice: fillPrice,
        quantity,
        leverage: executorSignal.leverage,
        entryTime: Date.now(),
        paper: true,
      });
    } else {
      // Closing — calculate PnL
      const pos = bot.position;
      if (pos) {
        const direction = pos.side === 'LONG' ? 1 : -1;
        const pnl = direction * (fillPrice - pos.entryPrice) * quantity;
        bot.registerTradeResult(pnl);
        bot.clearPosition();

        // Register PnL with risk manager
        const rm = getRiskManager();
        rm.registerPnL(pnl, bot.id);
        rm.registerPositionClose();

        paperResult.pnl = pnl;
        this._persistBot(bot);
      }
    }

    this.emit('bot:paper-trade', { botId: bot.id, ...paperResult });
    this.emit('log', {
      level: 'info',
      message: `[PAPER] ${signal.action} ${executorSignal.symbol} qty=${quantity.toFixed(6)} @ ${fillPrice} (bot: ${bot.id})`,
    });

    return paperResult;
  }

  /**
   * Handle real execution result: update bot position, register PnL, persist.
   */
  _handleExecutionResult(bot, signal, result, isOpen) {
    if (isOpen) {
      bot.setPosition({
        market: result.market,
        symbol: signal.symbol,
        side: signal.action === 'OPEN_LONG' ? 'LONG' : 'SHORT',
        entryPrice: result.avgPrice,
        quantity: result.executedQty,
        leverage: result.leverage,
        orderId: result.order?.orderId,
        entryTime: Date.now(),
      });
    } else {
      // Closing — calculate PnL from position
      const pos = bot.position;
      if (pos) {
        const direction = pos.side === 'LONG' ? 1 : -1;
        const pnl = direction * (result.avgPrice - pos.entryPrice) * result.executedQty;
        bot.registerTradeResult(pnl);
        bot.clearPosition();

        const rm = getRiskManager();
        rm.registerPnL(pnl, bot.id);
        rm.registerPositionClose();
      }
    }

    // Persist trade to DB
    try {
      const db = getTradeDB();
      db.insertTrade({
        id: `trade_${crypto.randomUUID().slice(0, 12)}`,
        botId: bot.id,
        symbol: signal.symbol,
        market: result.market,
        side: result.order?.side || (signal.action.includes('LONG') ? 'BUY' : 'SELL'),
        type: result.order?.type || 'MARKET',
        quantity: result.executedQty,
        price: result.avgPrice,
        avgFillPrice: result.avgPrice,
        status: 'FILLED',
        pnl: null, // PnL calculated on close
        fees: 0,
        strategy: bot.config.strategy,
        signalReason: signal.action,
        orderId: result.order?.orderId?.toString(),
        binanceOrderId: result.order?.orderId?.toString(),
        createdAt: new Date().toISOString(),
        filledAt: new Date().toISOString(),
      });
    } catch { /* DB may not be ready */ }

    this._persistBot(bot);

    this.emit('log', {
      level: 'info',
      message: `EXECUTED ${signal.action} ${signal.symbol} qty=${result.executedQty} @ ${result.avgPrice} (bot: ${bot.id})`,
    });
  }

  // ─── Unrealized PnL Broadcast ───────────────────────────────────

  _startUnrealizedPnlBroadcast() {
    if (this._unrealizedPnlInterval) return;
    this._unrealizedPnlInterval = setInterval(() => {
      const positions = [];
      for (const [, bot] of this.bots) {
        if (!bot.position) continue;
        positions.push({
          botId: bot.id,
          symbol: bot.config.symbol,
          unrealizedPnl: bot.unrealizedPnl || 0,
          lastPrice: bot.lastPrice || null,
        });
      }
      this.emit('bots:unrealized-pnl', { positions });
    }, 5000);
  }

  _stopUnrealizedPnlBroadcast() {
    if (this._unrealizedPnlInterval) {
      clearInterval(this._unrealizedPnlInterval);
      this._unrealizedPnlInterval = null;
    }
  }
}

// Singleton
let _mgr = null;
export function getBotManager() {
  if (!_mgr) _mgr = new BotManager();
  return _mgr;
}

export { BotManager };
