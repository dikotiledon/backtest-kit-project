import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  fetchOrUpdateDataset, listDatasets, deleteDataset,
  readDataset, datasetPath, parseSymbol,
  validateSymbolInput, TIMEFRAME_MS,
} from './lib/dataset-manager.mjs';
import { listChampionSources, loadChampion } from './lib/champion-loader.mjs';
import { runChampionTest, getRunStatus, loadPersistedState, loadLastResult, cancelRunningTest } from './lib/strategy-runner.mjs';
import { runSweep, getSweepStatus, cancelSweep } from './lib/sweep-runner.mjs';
import { ResultsStore } from './lib/results-store.mjs';
import { normalizeResult } from './lib/metric-normalizer.mjs';
import { registerTradingRoutes } from './lib/trading-routes.mjs';
import { registerMarketRoutes } from './lib/market-routes.mjs';
import { registerBotRoutes } from './lib/bot-routes.mjs';
import { getBotManager } from './lib/bot-manager.mjs';
import { loadConfig } from './lib/binance-config.mjs';
import { getConnector } from './lib/binance-connector.mjs';
import { getFuturesConnector } from './lib/binance-futures-connector.mjs';
import logger from './lib/logger.mjs';
import { AppError } from './lib/errors.mjs';
import { scheduleBackups } from './lib/db-backup.mjs';
import { getAlerter } from './lib/alerter.mjs';
import { getMarketDataService } from './lib/market-data-service.mjs';
import { getTradeDB } from './lib/trade-db.mjs';
import { getPositionReconciler } from './lib/position-reconciler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.resolve(__dirname, 'data');
const RESULTS_DIR = path.resolve(__dirname, 'results');

const store = new ResultsStore(RESULTS_DIR);
const app = express();
app.use(express.json());

// ─── Logger (delegates to lib/logger.mjs) ───────────────────────────────────

function log(level, msg, meta = {}) {
  if (logger[level]) {
    logger[level](msg, meta);
  } else {
    logger.info(msg, meta);
  }
}

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api')) {
      log('http', `${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// ─── Startup Cleanup ────────────────────────────────────────────────────────

async function startupCleanup() {
  const dirs = [
    path.resolve(PROJECT_ROOT, 'pine/dump/champion-tester-runs'),
    path.resolve(PROJECT_ROOT, 'pine/dump/data/candle/champion-tester'),
  ];
  for (const dir of dirs) {
    try { await fs.rm(dir, { recursive: true, force: true }); } catch {}
  }
  console.log('[crypto-trader] startup cleanup done');
}

// ─── Health & Utility ───────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  const status = getRunStatus();
  const datasets = await listDatasets(DATA_DIR);
  const results = await store.list({ limit: 1 });
  res.json({
    ok: true, service: 'crypto-trader', version: '2.0.0',
    uptime: process.uptime(), runStatus: status,
    datasetCount: datasets.length, resultCount: results.total,
  });
});

app.get('/api/timeframes', (req, res) => {
  res.json({ ok: true, timeframes: Object.keys(TIMEFRAME_MS) });
});

// ─── Dataset API ────────────────────────────────────────────────────────────

app.get('/api/datasets', async (req, res) => {
  try {
    const datasets = await listDatasets(DATA_DIR);
    res.json({ ok: true, datasets });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/datasets/fetch', async (req, res) => {
  try {
    const { symbol, timeframe, initialLimit } = req.body;
    const errors = validateSymbolInput(symbol, timeframe);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: errors.join('; '), code: 'VALIDATION_ERROR' });
    }

    const limit = Math.min(Math.max(Number(initialLimit) || 10000, 100), 50000);
    log('info', 'Dataset fetch started', { symbol, timeframe, limit });
    const result = await fetchOrUpdateDataset({ tvSymbol: symbol, timeframe, dataDir: DATA_DIR, initialLimit: limit });
    log('info', 'Dataset fetch complete', { symbol, timeframe, fetched: result.fetched, isNew: result.isNew, total: result.dataset.candleCount });

    res.json({
      ok: true, isNew: result.isNew, fetched: result.fetched,
      tvSymbol: result.dataset.tvSymbol, symbol: result.dataset.symbol,
      exchange: result.dataset.exchange, timeframe: result.dataset.timeframe,
      candleCount: result.dataset.candleCount,
      firstTimestamp: result.dataset.firstTimestamp,
      lastTimestamp: result.dataset.lastTimestamp,
      updatedAt: result.dataset.updatedAt,
    });
  } catch (err) {
    log('error', 'Dataset fetch failed', { error: err.message });
    res.status(500).json({ ok: false, error: err.message, code: 'EXCHANGE_ERROR' });
  }
});

app.delete('/api/datasets/:exchange/:symbol/:timeframe', async (req, res) => {
  try {
    const { exchange, symbol, timeframe } = req.params;
    await deleteDataset(DATA_DIR, exchange, symbol, timeframe);
    res.json({ ok: true });
  } catch (err) {
    const status = err.code === 'ENOENT' ? 404 : 500;
    res.status(status).json({ ok: false, error: err.message, code: 'NOT_FOUND' });
  }
});

// ─── Champion API ───────────────────────────────────────────────────────────

app.get('/api/champions', async (req, res) => {
  try {
    const sources = await listChampionSources();
    res.json({ ok: true, champions: sources });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/champions/:matrixId', async (req, res) => {
  try {
    const champion = await loadChampion(req.params.matrixId);
    res.json({ ok: true, champion });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message, code: 'NOT_FOUND' });
  }
});

// ─── Test Runner API (async: returns runId immediately, polls for result) ───

app.post('/api/test/run', async (req, res) => {
  try {
    const { matrixId, symbol, timeframe, slice } = req.body;
    if (!matrixId || !symbol || !timeframe) {
      return res.status(400).json({
        ok: false, error: 'matrixId, symbol, and timeframe are required',
        code: 'VALIDATION_ERROR',
      });
    }

    const parsed = parseSymbol(symbol);
    const filePath = datasetPath(DATA_DIR, parsed.exchange, parsed.symbol, timeframe);
    const dataset = await readDataset(filePath);
    if (!dataset) {
      return res.status(404).json({
        ok: false,
        error: `Dataset not found for ${symbol} ${timeframe}. Fetch it first.`,
        code: 'NOT_FOUND',
      });
    }

    // Check if already running
    const status = getRunStatus();
    if (status.running) {
      return res.status(409).json({
        ok: false, error: 'A test is already running. Please wait.',
        code: 'RUN_IN_PROGRESS', runId: status.runId,
      });
    }

    // Start async — respond immediately with runId
    log('info', 'Test started', { symbol, timeframe, matrixId, slice: slice || {} });
    broadcast('test:start', { symbol, timeframe, matrixId });

    // Fire and forget — result delivered via WebSocket
    runChampionTest({ matrixId, dataset, slice: slice || {} })
      .then(async (result) => {
        const normalized = normalizeResult(result);
        await store.save(normalized);
        log('info', 'Test complete', {
          runId: normalized.runId, ok: normalized.ok, score: normalized.score,
          trades: normalized.trades?.length, durationMs: normalized.durationMs,
        });
        broadcast('test:complete', { result: normalized });
      })
      .catch((err) => {
        log('error', 'Test failed', { error: err.message });
        broadcast('test:error', { error: err.message || String(err) });
      });

    res.json({ ok: true, started: true, symbol, timeframe, matrixId });
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') {
      return res.status(409).json({ ok: false, error: err.message, code: err.code });
    }
    res.status(500).json({ ok: false, error: err.message, code: 'EXECUTION_ERROR' });
  }
});

app.get('/api/test/status', (req, res) => {
  const status = getRunStatus();
  res.json({ ok: true, ...status });
});

app.post('/api/test/cancel', (req, res) => {
  const status = getRunStatus();
  if (!status.running) {
    return res.json({ ok: true, cancelled: false, reason: 'No test running' });
  }
  cancelRunningTest();
  log('info', 'Test cancelled by user', { runId: status.runId });
  res.json({ ok: true, cancelled: true, runId: status.runId });
});

// ─── Results API ────────────────────────────────────────────────────────────

app.get('/api/results', async (req, res) => {
  try {
    const { symbol, timeframe, limit, sort, order } = req.query;
    const data = await store.list({
      symbol, timeframe,
      limit: Math.min(Number(limit) || 50, 200),
      sort: sort || 'timestamp',
      order: order || 'desc',
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/results/:runId', async (req, res) => {
  try {
    const result = await store.get(req.params.runId);
    if (!result) return res.status(404).json({ ok: false, error: 'Result not found', code: 'NOT_FOUND' });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/results/:runId', async (req, res) => {
  try {
    const deleted = await store.delete(req.params.runId);
    if (!deleted) return res.status(404).json({ ok: false, error: 'Result not found', code: 'NOT_FOUND' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Sweep API ──────────────────────────────────────────────────────────────

app.post('/api/sweep/run', async (req, res) => {
  try {
    const { matrixId, datasets } = req.body;
    if (!matrixId) {
      return res.status(400).json({ ok: false, error: 'matrixId is required', code: 'VALIDATION_ERROR' });
    }
    if (!Array.isArray(datasets) || datasets.length === 0) {
      return res.status(400).json({ ok: false, error: 'datasets array is required and must not be empty', code: 'VALIDATION_ERROR' });
    }

    const parsedDatasets = datasets.map(d => {
      const parsed = parseSymbol(d.symbol);
      return { exchange: parsed.exchange, symbol: parsed.symbol, timeframe: d.timeframe };
    });

    // Check if already running
    const sweepStatus = getSweepStatus();
    if (sweepStatus.running) {
      return res.status(409).json({ ok: false, error: 'Sweep already in progress', code: 'SWEEP_IN_PROGRESS' });
    }
    const runStatus = getRunStatus();
    if (runStatus.running) {
      return res.status(409).json({ ok: false, error: 'A test is already running', code: 'RUN_IN_PROGRESS' });
    }

    log('info', 'Sweep started', { matrixId, datasetCount: parsedDatasets.length });

    // Fire async — respond immediately
    const onProgress = (progressData) => broadcast('sweep:progress', progressData);
    runSweep({ matrixId, datasets: parsedDatasets, dataDir: DATA_DIR, onProgress })
      .then(async (result) => {
        // Save successful results to store
        if (result.results) {
          for (const r of result.results) {
            if (r.ok) await store.save(normalizeResult(r));
          }
        }
        log('info', 'Sweep complete', { sweepId: result.sweepId, completed: result.completed, total: result.total });
        broadcast('sweep:complete', result);
      })
      .catch((err) => {
        log('error', 'Sweep failed', { error: err.message });
        broadcast('sweep:error', { error: err.message });
      });

    res.json({ ok: true, started: true, datasetCount: parsedDatasets.length, matrixId });
  } catch (err) {
    if (err.code === 'SWEEP_IN_PROGRESS' || err.code === 'RUN_IN_PROGRESS') {
      return res.status(409).json({ ok: false, error: err.message, code: err.code });
    }
    log('error', 'Sweep request failed', { error: err.message });
    res.status(500).json({ ok: false, error: err.message, code: 'EXECUTION_ERROR' });
  }
});

app.get('/api/sweep/status', (req, res) => {
  const status = getSweepStatus();
  res.json(status);
});

app.post('/api/sweep/cancel', (req, res) => {
  cancelSweep();
  res.json({ ok: true });
});

// ─── Trading API ────────────────────────────────────────────────────────────

registerTradingRoutes(app, broadcast);
registerMarketRoutes(app);
registerBotRoutes(app, broadcast);

// ─── Static Serving ────────────────────────────────────────────────────────

// `npm start` runs this server directly and should serve the built web UI.
// Dev mode still uses Vite on :5173, but serving dist here is harmless and
// avoids a confusing `Cannot GET /` after `npm run build && npm start`.
const distDir = path.resolve(__dirname, 'dist');
try {
  await fs.access(path.join(distDir, 'index.html'));
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'));
    }
  });
} catch {
  if (process.env.NODE_ENV === 'production') {
    log('warn', 'Built web UI not found; run npm run build before npm start', { distDir });
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.CRYPTO_TRADER_PORT || process.env.CHAMPION_TESTER_PORT || '3847', 10);

await startupCleanup();

// Load persisted state from previous run (if server crashed mid-run)
const persistedState = await loadPersistedState();
if (persistedState.lastAborted) {
  console.log(`[crypto-trader] Previous run was aborted: ${persistedState.lastAborted.runId}`);
}

// Load last result so it's available immediately on /api/test/status
const lastResult = await loadLastResult();
if (lastResult) {
  console.log(`[crypto-trader] Loaded last result: runId=${lastResult.runId} ok=${lastResult.ok}`);
}

const server = app.listen(PORT, () => {
  console.log(`\n  ⚡ Crypto Trader running at http://localhost:${PORT}`);
  console.log(`  📁 Data: ${DATA_DIR}`);
  console.log(`  📁 Results: ${RESULTS_DIR}`);
  console.log(`  🤖 Bot Manager: ready\n`);

  // Auto-connect to Binance if credentials exist
  autoConnectBinance();
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  log('info', 'WebSocket connected', { ip: req.socket.remoteAddress });
  // Send current state on connect so page refresh recovers running status
  const status = getRunStatus();
  ws.send(JSON.stringify({
    type: 'connected',
    data: { service: 'crypto-trader', runStatus: status },
  }));
  ws.on('close', () => log('info', 'WebSocket disconnected'));
  ws.on('error', (err) => log('error', 'WebSocket error', { error: err.message }));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

export { broadcast };
export default app;

// ─── Bot Manager Initialization ─────────────────────────────────────────────

try {
  const botMgr = getBotManager();
  const loadResult = botMgr.loadState();
  if (loadResult.ok && loadResult.loaded > 0) {
    console.log(`[crypto-trader] Loaded ${loadResult.loaded} bot(s) from database`);
  }
  // Log events → console + WS broadcast
  botMgr.on('log', (d) => {
    const prefix = d.level === 'error' ? '❌' : d.level === 'warn' ? '⚠️' : d.level === 'debug' ? '🔍' : '📡';
    console.log(`[bot-engine] ${prefix} ${d.message}`);
    broadcast('system:log', d);
  });
  botMgr.on('bot:signal', (d) => {
    console.log(`[bot-engine] ⚡ SIGNAL: ${d.action} ${d.symbol} @ ${d.suggestedEntry || d.price || '?'} conf=${d.confidence || '?'}`);
    broadcast('bot:signal', d);
  });
  botMgr.on('bot:signal:rejected', (d) => {
    console.log(`[bot-engine] 🚫 REJECTED: ${d.symbol} — ${d.riskCheck?.violations?.join(', ') || 'risk check failed'}`);
    broadcast('bot:signal:rejected', d);
  });
  botMgr.on('bot:error', (d) => {
    console.log(`[bot-engine] ❌ ERROR: bot ${d.botId} — ${d.error}`);
    broadcast('bot:error', d);
  });
  botMgr.on('bot:started', (d) => broadcast('bot:started', d));
  botMgr.on('bot:stopped', (d) => broadcast('bot:stopped', d));
  botMgr.on('bot:paused', (d) => broadcast('bot:paused', d));
  botMgr.on('bot:autoPaused', (d) => {
    console.log(`[bot-engine] ⏸️ AUTO-PAUSED: bot ${d.botId} — ${d.reason}`);
    broadcast('bot:autoPaused', d);
  });
  botMgr.on('bot:paper-trade', (d) => {
    console.log(`[bot-engine] 📝 PAPER: ${d.symbol} ${d.side} qty=${d.quantity?.toFixed?.(6) || d.quantity} @ ${d.avgPrice}`);
    broadcast('bot:paper-trade', d);
  });
  botMgr.on('bots:unrealized-pnl', (d) => {
    broadcast('bots:unrealized-pnl', d);
  });
  botMgr.on('manager:started', (d) => {
    console.log(`[bot-engine] 🚀 Bot Manager STARTED: ${d.botsStarted} bots, testnet=${d.testnet}`);
    broadcast('manager:started', d);
  });
  botMgr.on('manager:stopped', (d) => broadcast('manager:stopped', d));
} catch (err) {
  console.log(`[crypto-trader] Bot manager init: ${err.message}`);
}

// ─── Alerter Wiring ─────────────────────────────────────────────────────────

try {
  const alerter = getAlerter();
  const botMgr = getBotManager();
  botMgr.on('bot:signal', (d) => {
    alerter.sendAlert('signal_executed', `${d.action} ${d.symbol} @ ${d.suggestedEntry || d.price || '?'}`, d);
  });
  botMgr.on('bot:signal:rejected', (d) => {
    alerter.sendAlert('signal_rejected', `${d.symbol} — ${d.riskCheck?.violations?.join(', ') || 'risk check failed'}`, d);
  });
  botMgr.on('bot:error', (d) => {
    alerter.sendAlert('bot_error', `bot ${d.botId} — ${d.error}`, d);
  });
} catch {}

// ─── Express Error Middleware ─────────────────────────────────────────────────

app.use((err, req, res, _next) => {
  if (err instanceof AppError) {
    logger.warn(`AppError: ${err.message}`, { code: err.code, statusCode: err.statusCode });
    return res.status(err.statusCode).json(err.toJSON());
  }
  logger.error('Unhandled express error', { error: err.message, stack: err.stack });
  res.status(500).json({ ok: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// ─── Global Error Handling ───────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  log('fatal', 'Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log('fatal', 'Unhandled rejection', { error: String(reason) });
});

// ─── Scheduled Backups ───────────────────────────────────────────────────────

const backupScheduler = scheduleBackups();

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('info', `Shutdown initiated (${signal})`, {});
  const startTime = Date.now();

  // 0. Stop backup scheduler
  backupScheduler.stop();

  // 1. Stop all bots
  try {
    const botMgr = getBotManager();
    botMgr.stopAll();
    log('info', 'All bots stopped');
  } catch (err) {
    log('error', 'Error stopping bots', { error: err.message });
  }

  // 2. Stop position reconciler
  try {
    const reconciler = getPositionReconciler();
    reconciler.stop();
    log('info', 'Position reconciler stopped');
  } catch (err) {
    log('error', 'Error stopping reconciler', { error: err.message });
  }

  // 3. Close all WebSocket streams (market data)
  try {
    const mds = getMarketDataService();
    mds.stop();
    log('info', 'Market data streams closed');
  } catch (err) {
    log('error', 'Error stopping market data', { error: err.message });
  }

  // 4. Close WebSocket server
  try {
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down');
    }
    wss.close();
    log('info', 'WebSocket server closed');
  } catch (err) {
    log('error', 'Error closing WebSocket server', { error: err.message });
  }

  // 5. Close SQLite DB
  try {
    const db = getTradeDB();
    db.close();
    log('info', 'Database closed');
  } catch (err) {
    log('error', 'Error closing database', { error: err.message });
  }

  // 6. Close HTTP server
  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    log('info', 'HTTP server closed');
  } catch (err) {
    log('error', 'Error closing HTTP server', { error: err.message });
  }

  const elapsed = Date.now() - startTime;
  log('info', `Shutdown complete in ${elapsed}ms. Goodbye.`);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Auto-Connect Binance on Startup ───────────────────────────────────────────

async function autoConnectBinance() {
  try {
    const cfg = await loadConfig();
    if (!cfg?.apiKey) {
      console.log('[crypto-trader] No API credentials configured. Skipping auto-connect.');
      return;
    }

    const mode = cfg.testnet ? 'demo' : 'live';
    console.log(`[crypto-trader] Auto-connecting to Binance (mode=${mode})...`);

    // Connect Spot
    try {
      const c = getConnector();
      await c.initialize();
      await c.loadExchangeInfo();
      console.log(`[crypto-trader] ✅ Spot connected (${mode})`);
    } catch (err) {
      console.log(`[crypto-trader] ⚠️ Spot connect failed: ${err.message}`);
    }

    // Connect Futures if enabled
    if (cfg.futures?.enabled) {
      const markets = cfg.futures.markets || ['usdm'];
      try {
        const fc = getFuturesConnector();
        await fc.initialize({ apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, testnet: cfg.testnet, mode: cfg.testnet ? 'demo' : 'live', markets });
        for (const m of markets) {
          try { await fc.loadExchangeInfo(m); } catch {}
        }
        console.log(`[crypto-trader] ✅ Futures connected: ${markets.join(', ')} (${cfg.testnet ? 'demo' : 'live'})`);
      } catch (err) {
        console.log(`[crypto-trader] ⚠️ Futures connect failed: ${err.message}`);
      }
    }

    // Start position reconciler after connectors are ready
    try {
      const reconciler = getPositionReconciler();
      reconciler.on('log', (d) => {
        const prefix = d.level === 'warn' ? '⚠️' : d.level === 'error' ? '❌' : '🔄';
        console.log(`[reconciler] ${prefix} ${d.message}`);
        broadcast('system:log', { ...d, source: 'reconciler' });
      });
      reconciler.on('reconciled', (data) => {
        const total = data.futures.matched + data.spot.matched;
        const orphans = data.futures.orphans.length + data.spot.orphans.length;
        if (total > 0 || orphans > 0) {
          console.log(`[reconciler] 🔄 Reconciled: ${total} matched, ${orphans} orphans, ${data.futures.updated + data.spot.updated} updated`);
        }
        broadcast('reconciler:update', data);
      });
      reconciler.on('error', (d) => {
        console.log(`[reconciler] ❌ ${d.message}`);
      });
      await reconciler.start();
      console.log(`[crypto-trader] 🔄 Position reconciler started (interval: 60s)`);
    } catch (err) {
      console.log(`[crypto-trader] ⚠️ Position reconciler failed: ${err.message}`);
    }
  } catch (err) {
    console.log(`[crypto-trader] Auto-connect error: ${err.message}`);
  }
}
