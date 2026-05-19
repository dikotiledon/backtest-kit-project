import { getConnector, resetConnector } from './binance-connector.mjs';
import { getFuturesConnector, resetFuturesConnector } from './binance-futures-connector.mjs';
import { getExecutor } from './trade-executor.mjs';
import {
  loadConfig, saveConfig, getConfigStatus,
  deleteConfig, getDefaultRiskLimits,
  getDefaultFuturesConfig, getDefaultFuturesRiskLimits,
} from './binance-config.mjs';

export function registerTradingRoutes(app, broadcast) {

  function ensureFutures(market, res) {
    const fc = getFuturesConnector();
    if (!fc.isInitialized(market)) {
      res.status(400).json({ ok: false, error: `Futures '${market}' not connected` });
      return null;
    }
    return fc;
  }

  function ensureSpot(res) {
    const c = getConnector();
    if (!c.isConnected()) {
      res.status(400).json({ ok: false, error: 'Spot not connected' });
      return null;
    }
    return c;
  }

  // ═══ CONFIG ═══════════════════════════════════════════════════════

  app.get('/api/trading/config', async (req, res) => {
    try { res.json({ ok: true, ...(await getConfigStatus()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/config', async (req, res) => {
    try {
      const { apiKey, apiSecret, testnet, tradingEnabled, riskLimits, futures } = req.body;
      if (!apiKey || !apiSecret) return res.status(400).json({ ok: false, error: 'apiKey and apiSecret required' });
      const r = await saveConfig({ apiKey, apiSecret, testnet, tradingEnabled, riskLimits, futures });
      resetConnector(); resetFuturesConnector();
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/trading/config', async (req, res) => {
    try {
      const ex = await loadConfig();
      if (!ex) return res.status(404).json({ ok: false, error: 'No config. POST first.' });
      const { testnet, tradingEnabled, riskLimits, futures } = req.body;
      const updated = {
        apiKey: ex.apiKey, apiSecret: ex.apiSecret,
        testnet: testnet ?? ex.testnet, tradingEnabled: tradingEnabled ?? ex.tradingEnabled,
        riskLimits: riskLimits ? { ...ex.riskLimits, ...riskLimits } : ex.riskLimits,
        futures: futures ? { ...ex.futures, ...futures, riskLimits: futures.riskLimits ? { ...(ex.futures?.riskLimits || {}), ...futures.riskLimits } : ex.futures?.riskLimits } : ex.futures,
      };
      const r = await saveConfig(updated);
      if (testnet !== undefined && testnet !== ex.testnet) { resetConnector(); resetFuturesConnector(); }
      res.json({ ok: true, ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/trading/config', async (req, res) => {
    try { resetConnector(); resetFuturesConnector(); res.json(await deleteConfig()); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/config/defaults', (_req, res) => {
    res.json({ ok: true, riskLimits: getDefaultRiskLimits(), futures: getDefaultFuturesConfig(), futuresRiskLimits: getDefaultFuturesRiskLimits() });
  });

  // ═══ SPOT CONNECTION ══════════════════════════════════════════════

  app.post('/api/trading/connect', async (req, res) => {
    try {
      const c = getConnector();
      const r = await c.initialize(); await c.loadExchangeInfo();
      broadcast('trading:connected', { market: 'spot', testnet: c.config.testnet });
      res.json({ ok: true, market: 'spot', ...r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/disconnect', async (req, res) => {
    try { await getConnector().disconnect(); broadcast('trading:disconnected', { market: 'spot' }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES CONNECTION ═══════════════════════════════════════════

  app.post('/api/trading/futures/connect', async (req, res) => {
    try {
      const cfg = await loadConfig();
      if (!cfg?.apiKey) return res.status(400).json({ ok: false, error: 'Credentials not configured' });
      if (!cfg.futures?.enabled) return res.status(400).json({ ok: false, error: 'Futures not enabled in config' });
      const { market } = req.body;
      const markets = market ? [market] : (cfg.futures.markets || ['usdm']);
      const fc = getFuturesConnector();
      const results = await fc.initialize({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, testnet: cfg.testnet, markets });
      for (const m of markets) { if (results[m]?.ok) await fc.loadExchangeInfo(m); }
      broadcast('trading:futures:connected', { markets, results });
      res.json({ ok: true, markets, results });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/futures/disconnect', async (req, res) => {
    try {
      await getFuturesConnector().disconnect(req.body.market || null);
      broadcast('trading:futures:disconnected', { market: req.body.market || 'all' });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ COMBINED STATUS ══════════════════════════════════════════════

  app.get('/api/trading/status', async (req, res) => {
    try {
      res.json({ ok: true, config: await getConfigStatus(), spot: getConnector().getStatus(), futures: getFuturesConnector().getStatus(), executor: getExecutor().getStatus() });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ SPOT ACCOUNT & MARKET DATA ══════════════════════════════════

  app.get('/api/trading/account', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, account: await c.getAccount() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/balance', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, balance: await c.getBalance(req.query.asset || null) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/price/:symbol', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, ...(await c.getPrice(req.params.symbol)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/ticker/:symbol', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, ticker: await c.getTicker24h(req.params.symbol) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/orderbook/:symbol', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, orderbook: await c.getOrderBook(req.params.symbol, Math.min(Number(req.query.limit) || 20, 100)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/klines/:symbol', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; const { interval = '15m', limit = '100' } = req.query; res.json({ ok: true, klines: await c.getKlines(req.params.symbol, interval, Math.min(Number(limit), 1000)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ SPOT ORDERS ══════════════════════════════════════════════════

  app.post('/api/trading/order', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; const order = await c.newOrder(req.body); broadcast('trading:order:new', order); res.json({ ok: true, order }); }
    catch (e) { res.status(e.message?.includes('disabled') ? 403 : 500).json({ ok: false, error: e.message, binanceError: e.binanceData }); }
  });

  app.post('/api/trading/order/test', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, result: await c.testOrder(req.body) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/orders/open', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, orders: await c.getOpenOrders(req.query.symbol || null) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/orders/:symbol', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, orders: await c.getAllOrders(req.params.symbol, Math.min(Number(req.query.limit) || 50, 200)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/trading/order/:symbol/:orderId', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; const r = await c.cancelOrder(req.params.symbol, Number(req.params.orderId)); broadcast('trading:order:cancel', r); res.json({ ok: true, result: r }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/trading/orders/:symbol/all', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; const r = await c.cancelAllOrders(req.params.symbol); broadcast('trading:orders:cancelAll', { symbol: req.params.symbol }); res.json({ ok: true, result: r }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/order/oco', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; const r = await c.newOCO(req.body); broadcast('trading:order:oco', r); res.json({ ok: true, result: r }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/trades/:symbol', async (req, res) => {
    try { const c = ensureSpot(res); if (!c) return; res.json({ ok: true, trades: await c.getMyTrades(req.params.symbol, Math.min(Number(req.query.limit) || 50, 200)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES ACCOUNT & MARKET DATA ════════════════════════════════

  app.get('/api/trading/futures/account/:market', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, market: req.params.market, account: await fc.getAccount(req.params.market) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/balance/:market', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, market: req.params.market, balance: await fc.getBalance(req.params.market) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/positions/:market', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const positions = req.query.symbol
        ? await fc.getPositions(req.params.market, req.query.symbol)
        : await fc.getOpenPositions(req.params.market);
      res.json({ ok: true, market: req.params.market, positions });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/price/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, ...(await fc.getPrice(req.params.market, req.params.symbol)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/mark-price/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, data: await fc.getMarkPrice(req.params.market, req.params.symbol) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/funding-rate/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, rates: await fc.getFundingRate(req.params.market, req.params.symbol, Math.min(Number(req.query.limit) || 100, 1000)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/open-interest/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, ...(await fc.getOpenInterest(req.params.market, req.params.symbol)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/orderbook/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, orderbook: await fc.getOrderBook(req.params.market, req.params.symbol, Math.min(Number(req.query.limit) || 20, 1000)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/klines/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; const { interval = '15m', limit = '100' } = req.query; res.json({ ok: true, klines: await fc.getKlines(req.params.market, req.params.symbol, interval, Math.min(Number(limit), 1500)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES LEVERAGE & MARGIN ════════════════════════════════════

  app.post('/api/trading/futures/leverage', async (req, res) => {
    try {
      const { market, symbol, leverage } = req.body;
      if (!market || !symbol || !leverage) return res.status(400).json({ ok: false, error: 'market, symbol, leverage required' });
      const fc = ensureFutures(market, res); if (!fc) return;
      res.json({ ok: true, ...(await fc.setLeverage(market, symbol, leverage)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/futures/margin-type', async (req, res) => {
    try {
      const { market, symbol, marginType } = req.body;
      if (!market || !symbol || !marginType) return res.status(400).json({ ok: false, error: 'market, symbol, marginType required' });
      const fc = ensureFutures(market, res); if (!fc) return;
      res.json({ ok: true, ...(await fc.setMarginType(market, symbol, marginType)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/futures/position-mode', async (req, res) => {
    try {
      const { market, dualSidePosition } = req.body;
      if (!market || dualSidePosition === undefined) return res.status(400).json({ ok: false, error: 'market, dualSidePosition required' });
      const fc = ensureFutures(market, res); if (!fc) return;
      res.json({ ok: true, ...(await fc.setPositionMode(market, dualSidePosition)) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/position-mode/:market', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, ...(await fc.getPositionMode(req.params.market)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES ORDERS ═══════════════════════════════════════════════

  app.post('/api/trading/futures/order', async (req, res) => {
    try {
      const { market, ...params } = req.body;
      if (!market) return res.status(400).json({ ok: false, error: 'market required' });
      const fc = ensureFutures(market, res); if (!fc) return;
      const order = await fc.newOrder(market, params);
      broadcast('trading:futures:order:new', { market, order });
      res.json({ ok: true, market, order });
    } catch (e) { res.status(500).json({ ok: false, error: e.message, binanceError: e.rawData }); }
  });

  app.post('/api/trading/futures/order/batch', async (req, res) => {
    try {
      const { market, orders } = req.body;
      if (!market || !orders) return res.status(400).json({ ok: false, error: 'market and orders required' });
      const fc = ensureFutures(market, res); if (!fc) return;
      const results = await fc.batchOrders(market, orders);
      broadcast('trading:futures:order:batch', { market, results });
      res.json({ ok: true, market, results });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/orders/open/:market', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, orders: await fc.getOpenOrders(req.params.market, req.query.symbol || null) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/orders/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, orders: await fc.getAllOrders(req.params.market, req.params.symbol, Math.min(Number(req.query.limit) || 50, 1000)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/trading/futures/order/:market/:symbol/:orderId', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const r = await fc.cancelOrder(req.params.market, req.params.symbol, Number(req.params.orderId));
      broadcast('trading:futures:order:cancel', { market: req.params.market, ...r });
      res.json({ ok: true, result: r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/trading/futures/orders/:market/:symbol/all', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const r = await fc.cancelAllOrders(req.params.market, req.params.symbol);
      broadcast('trading:futures:orders:cancelAll', { market: req.params.market, symbol: req.params.symbol });
      res.json({ ok: true, result: r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES CLOSE POSITION ═══════════════════════════════════════

  app.post('/api/trading/futures/close/:market/:symbol', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const { positionSide } = req.body;
      const r = await fc.closePosition(req.params.market, req.params.symbol, positionSide || 'BOTH');
      broadcast('trading:futures:position:closed', { market: req.params.market, ...r });
      res.json(r);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/futures/close-all/:market', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const results = await fc.closeAllPositions(req.params.market);
      broadcast('trading:futures:positions:closedAll', { market: req.params.market, results });
      res.json({ ok: true, results });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES TRADE HISTORY & INCOME ═══════════════════════════════

  app.get('/api/trading/futures/trades/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, trades: await fc.getMyTrades(req.params.market, req.params.symbol, Math.min(Number(req.query.limit) || 50, 1000)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/income/:market', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const { symbol, incomeType, startTime, endTime, limit } = req.query;
      res.json({ ok: true, income: await fc.getIncome(req.params.market, { symbol, incomeType, startTime: startTime ? Number(startTime) : undefined, endTime: endTime ? Number(endTime) : undefined, limit: Number(limit) || 100 }) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/futures/commission/:market/:symbol', async (req, res) => {
    try { const fc = ensureFutures(req.params.market, res); if (!fc) return; res.json({ ok: true, ...(await fc.getCommissionRate(req.params.market, req.params.symbol)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ TRADE EXECUTOR (Strategy Signals) ════════════════════════════

  app.post('/api/trading/executor/start', async (req, res) => {
    try {
      const r = await getExecutor().start();
      broadcast('trading:executor:started', {});
      res.json(r);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/executor/stop', (req, res) => {
    const r = getExecutor().stop();
    broadcast('trading:executor:stopped', {});
    res.json(r);
  });

  app.get('/api/trading/executor/status', (req, res) => {
    res.json({ ok: true, ...getExecutor().getStatus() });
  });

  app.post('/api/trading/executor/signal', async (req, res) => {
    try {
      const executor = getExecutor();
      const result = await executor.executeSignal(req.body);
      if (result.ok) { broadcast('trading:signal:executed', result); }
      else { broadcast('trading:signal:rejected', result); }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/executor/close/:market/:symbol', async (req, res) => {
    try {
      const { positionSide } = req.body;
      const result = await getExecutor().closePosition(req.params.market, req.params.symbol, positionSide || 'BOTH');
      broadcast('trading:position:closed', result);
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/trading/executor/close-all', async (req, res) => {
    try {
      const { market } = req.body;
      const results = await getExecutor().closeAllPositions(market || null);
      broadcast('trading:positions:closedAll', { results });
      res.json({ ok: true, results });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/trading/executor/positions', (req, res) => {
    const { market } = req.query;
    res.json({ ok: true, positions: getExecutor().getOpenPositions(market || null) });
  });

  app.get('/api/trading/executor/daily-stats', (req, res) => {
    res.json({ ok: true, stats: getExecutor().getDailyStats() });
  });

  app.get('/api/trading/executor/history', async (req, res) => {
    try {
      const executor = getExecutor();
      const { date, limit } = req.query;
      const trades = date
        ? await executor.getTradeHistory(date)
        : await executor.getRecentTrades(Math.min(Number(limit) || 20, 100));
      res.json({ ok: true, trades });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ FUTURES SYMBOLS LIST ═════════════════════════════════════════

  app.get('/api/trading/futures/symbols/:market', async (req, res) => {
    try {
      const fc = ensureFutures(req.params.market, res); if (!fc) return;
      const { quoteAsset, contractType, status } = req.query;
      const symbols = fc.listSymbols(req.params.market, { quoteAsset, contractType, status: status || 'TRADING' });
      res.json({ ok: true, market: req.params.market, count: symbols.length, symbols: symbols.map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset, contractType: s.contractType, marginAsset: s.marginAsset })) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
}
