import { getBotManager } from './bot-manager.mjs';
import { listStrategies, getStrategyInfo } from './strategies/index.mjs';
import { getRiskManager } from './risk-manager.mjs';
import { getTradeDB } from './trade-db.mjs';
import { getFundingTracker } from './funding-tracker.mjs';
import { getSlippageEstimator } from './slippage-estimator.mjs';
import { getPositionSizer } from './position-sizer.mjs';
import {
  createChampionBotConfig, createChampionBotConfigs,
  getChampionInfo, listChampions,
} from './champion-auto-trader.mjs';

/**
 * Bot routes — CRUD, master controls, strategy info, analytics.
 */
export function registerBotRoutes(app, broadcast) {

  // Bot manager events are already forwarded in server.mjs
  // No duplicate listeners here — just register routes

  // ═══ MASTER CONTROLS ══════════════════════════════════════════════

  app.post('/api/bots/start-all', async (req, res) => {
    try {
      const mgr = getBotManager();
      const result = await mgr.startAll();
      broadcast('manager:started', result);
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/bots/stop-all', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.stopAll();
      broadcast('manager:stopped', result);
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/bots/pause-all', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.pauseAll();
      broadcast('manager:paused', result);
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/bots/resume-all', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.resumeAll();
      broadcast('manager:resumed', result);
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ BOT CRUD ═════════════════════════════════════════════════════

  app.post('/api/bots', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.createBot(req.body);
      broadcast('bot:created', result);
      res.json({ ok: true, bot: result });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.get('/api/bots', (req, res) => {
    try {
      const mgr = getBotManager();
      const { state, market, symbol } = req.query;
      const bots = mgr.listBots({ state, market, symbol });
      res.json({ ok: true, count: bots.length, bots });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/bots/stats/global', (req, res) => {
    try {
      const mgr = getBotManager();
      res.json({ ok: true, ...mgr.getGlobalStats() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/bots/status', (req, res) => {
    try {
      const mgr = getBotManager();
      res.json({ ok: true, ...mgr.getStatus() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/bots/:id', (req, res) => {
    try {
      const mgr = getBotManager();
      const bot = mgr.getBot(req.params.id);
      res.json({ ok: true, bot });
    } catch (e) { res.status(404).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/bots/:id', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.updateBot(req.params.id, req.body);
      broadcast('bot:updated', { botId: req.params.id });
      res.json({ ok: true, bot: result });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/bots/:id', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.deleteBot(req.params.id);
      broadcast('bot:deleted', { botId: req.params.id });
      res.json(result);
    } catch (e) { res.status(404).json({ ok: false, error: e.message }); }
  });

  // ═══ BOT ACTIONS ══════════════════════════════════════════════════

  app.post('/api/bots/:id/start', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.startBot(req.params.id);
      broadcast('bot:started', { botId: req.params.id });
      res.json({ ok: true, bot: result });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/bots/:id/stop', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.stopBot(req.params.id);
      broadcast('bot:stopped', { botId: req.params.id });
      res.json({ ok: true, bot: result });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/bots/:id/pause', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.pauseBot(req.params.id);
      broadcast('bot:paused', { botId: req.params.id });
      res.json({ ok: true, bot: result });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/bots/:id/resume', (req, res) => {
    try {
      const mgr = getBotManager();
      const result = mgr.resumeBot(req.params.id);
      broadcast('bot:resumed', { botId: req.params.id });
      res.json({ ok: true, bot: result });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.get('/api/bots/:id/stats', (req, res) => {
    try {
      const mgr = getBotManager();
      res.json({ ok: true, stats: mgr.getBotStats(req.params.id) });
    } catch (e) { res.status(404).json({ ok: false, error: e.message }); }
  });

  app.get('/api/bots/:id/trades', (req, res) => {
    try {
      const db = getTradeDB();
      const { limit, offset } = req.query;
      const trades = db.getTrades({
        botId: req.params.id,
        limit: Math.min(Number(limit) || 50, 200),
        offset: Number(offset) || 0,
      });
      res.json({ ok: true, trades });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ BOT SETTINGS ═════════════════════════════════════════════════

  app.get('/api/bots/settings/global', (req, res) => {
    try {
      const mgr = getBotManager();
      res.json({ ok: true, settings: mgr.getSettings() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/bots/settings/global', (req, res) => {
    try {
      const mgr = getBotManager();
      mgr.updateSettings(req.body);
      res.json({ ok: true, settings: mgr.getSettings() });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // ═══ STRATEGIES ═══════════════════════════════════════════════════

  app.get('/api/strategies', (req, res) => {
    res.json({ ok: true, strategies: listStrategies() });
  });

  app.get('/api/strategies/:id', (req, res) => {
    const info = getStrategyInfo(req.params.id);
    if (!info) return res.status(404).json({ ok: false, error: 'Strategy not found' });
    res.json({ ok: true, strategy: info });
  });

  // ═══ RISK MANAGER ═════════════════════════════════════════════════

  app.get('/api/risk/status', (req, res) => {
    try {
      const rm = getRiskManager();
      res.json({ ok: true, ...rm.getStatus() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/risk/limits', (req, res) => {
    try {
      const rm = getRiskManager();
      rm.updateLimits(req.body);
      res.json({ ok: true, limits: rm.getLimits() });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/risk/kill-switch', (req, res) => {
    try {
      const rm = getRiskManager();
      const { active, reason } = req.body;
      if (active) rm.activateKillSwitch(reason || 'Manual activation');
      else rm.deactivateKillSwitch();
      broadcast('risk:killSwitch', { active: rm.isKillSwitchActive() });
      res.json({ ok: true, active: rm.isKillSwitchActive() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/risk/events', (req, res) => {
    try {
      const db = getTradeDB();
      const { limit, botId } = req.query;
      const events = db.getRiskEvents(Number(limit) || 50, botId || null);
      res.json({ ok: true, events });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ ANALYTICS ════════════════════════════════════════════════════

  app.get('/api/analytics/summary', (req, res) => {
    try {
      const db = getTradeDB();
      const { botId } = req.query;
      res.json({ ok: true, ...db.getSummary(botId || null) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/analytics/equity', (req, res) => {
    try {
      const db = getTradeDB();
      const { days } = req.query;
      res.json({ ok: true, curve: db.getEquityCurve(Number(days) || 30) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/analytics/daily', (req, res) => {
    try {
      const db = getTradeDB();
      const { startDate, endDate, limit } = req.query;
      res.json({ ok: true, stats: db.getDailyStats(startDate, endDate, Number(limit) || 30) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/analytics/trades', (req, res) => {
    try {
      const db = getTradeDB();
      const { symbol, market, botId, limit, offset, startDate, endDate } = req.query;
      const trades = db.getTrades({
        symbol, market, botId,
        limit: Math.min(Number(limit) || 50, 200),
        offset: Number(offset) || 0,
        startDate, endDate,
      });
      const total = db.getTradeCount({ symbol, market, botId });
      res.json({ ok: true, trades, total });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ CHAMPION AUTO-TRADER ══════════════════════════════════════════

  // ═══ FUNDING RATES ════════════════════════════════════════════════

  app.get('/api/funding/rates', (req, res) => {
    try {
      const ft = getFundingTracker();
      const rates = ft.getAllRates();
      const tracked = ft.getTrackedSymbols();
      res.json({ ok: true, tracked, rates });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/funding/history', (req, res) => {
    try {
      const ft = getFundingTracker();
      const { botId, limit } = req.query;
      const maxLimit = Math.min(Number(limit) || 50, 500);

      let history = ft.fundingHistory;
      if (botId) {
        history = history.filter(h => h.botId === botId);
      }
      // Return most recent first
      history = history.slice(-maxLimit).reverse();

      const accumulated = botId ? ft.getAccumulatedFunding(botId) : null;
      res.json({ ok: true, count: history.length, history, accumulated });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ CHAMPION AUTO-TRADER (continued) ═════════════════════════════

  app.get('/api/champions', async (req, res) => {
    try {
      const champions = await listChampions();
      res.json({ ok: true, champions });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/champions/:matrixId', async (req, res) => {
    try {
      const info = await getChampionInfo(req.params.matrixId);
      if (info.error) return res.status(404).json({ ok: false, error: info.error });
      res.json({ ok: true, champion: info });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/champions/:matrixId/create-bot', async (req, res) => {
    try {
      const { symbol, market, leverage, allocation, maxPositionSize } = req.body;
      if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });
      const config = await createChampionBotConfig(req.params.matrixId, symbol, market || 'usdm', {
        leverage, allocation, maxPositionSize,
      });
      const mgr = getBotManager();
      const bot = mgr.createBot(config);
      broadcast('bot:created', bot);
      res.json({ ok: true, bot });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.post('/api/champions/:matrixId/create-bots', async (req, res) => {
    try {
      const { symbols, market, leverage, allocation, maxPositionSize } = req.body;
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ ok: false, error: 'symbols array required' });
      }
      if (symbols.length > 20) {
        return res.status(400).json({ ok: false, error: 'Max 20 symbols per batch' });
      }
      const configs = await createChampionBotConfigs(req.params.matrixId, symbols, market || 'usdm', {
        leverage, allocation, maxPositionSize,
      });
      const mgr = getBotManager();
      const bots = [];
      for (const cfg of configs) {
        const bot = mgr.createBot(cfg);
        bots.push(bot);
      }
      broadcast('bot:created:batch', { count: bots.length });
      res.json({ ok: true, count: bots.length, bots });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  // ═══ POSITION SIZING ══════════════════════════════════════════════

  app.get('/api/position-sizing/config', (req, res) => {
    try {
      const sizer = getPositionSizer();
      res.json({ ok: true, mode: sizer.getMode(), config: sizer.getConfig() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.put('/api/position-sizing/config', (req, res) => {
    try {
      const sizer = getPositionSizer();
      const { mode, ...params } = req.body;
      if (mode) sizer.setMode(mode);
      if (Object.keys(params).length > 0) sizer.updateConfig(params);
      broadcast('position-sizing:updated', { mode: sizer.getMode(), config: sizer.getConfig() });
      res.json({ ok: true, mode: sizer.getMode(), config: sizer.getConfig() });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.get('/api/position-sizing/preview', (req, res) => {
    try {
      const sizer = getPositionSizer();
      const allocation = Number(req.query.allocation) || 100;
      const equity = Number(req.query.equity) || undefined;
      const peakEquity = Number(req.query.peakEquity) || undefined;
      const consecutiveLosses = Number(req.query.consecutiveLosses) || 0;
      const winRate = Number(req.query.winRate) || 0;
      const avgWinLossRatio = Number(req.query.avgWinLossRatio) || 0;
      const lastTradeWin = req.query.lastTradeWin === 'true';

      const result = sizer.calculateSize(allocation, {
        equity,
        peakEquity,
        consecutiveLosses,
        winRate,
        avgWinLossRatio,
        lastTradeWin,
      });

      res.json({ ok: true, mode: sizer.getMode(), baseAllocation: allocation, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ SLIPPAGE STATS ═══════════════════════════════════════════════

  app.get('/api/slippage/stats', (req, res) => {
    try {
      const { symbol, market } = req.query;
      const estimator = getSlippageEstimator();

      if (symbol && market) {
        const stats = estimator.getStats(symbol, market);
        res.json({ ok: true, symbol, market, ...stats });
      } else if (symbol) {
        // Return stats for all markets for this symbol
        const all = estimator.getAllStats();
        const filtered = Object.values(all).filter(s => s.symbol === symbol);
        res.json({ ok: true, symbol, stats: filtered });
      } else if (market) {
        // Return stats for all symbols in this market
        const all = estimator.getAllStats();
        const filtered = Object.values(all).filter(s => s.market === market);
        res.json({ ok: true, market, stats: filtered });
      } else {
        // Return all stats
        const all = estimator.getAllStats();
        res.json({ ok: true, stats: Object.values(all) });
      }
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}
