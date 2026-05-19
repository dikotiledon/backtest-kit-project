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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.resolve(__dirname, 'data');
const RESULTS_DIR = path.resolve(__dirname, 'results');

const store = new ResultsStore(RESULTS_DIR);
const app = express();
app.use(express.json());

// ─── Structured Logger ──────────────────────────────────────────────────────

function log(level, msg, meta = {}) {
  const ts = new Date().toISOString();
  const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  console.log(`[${ts}] [${level}] ${msg}${metaStr}`);
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
  console.log('[champion-tester] startup cleanup done');
}

// ─── Health & Utility ───────────────────────────────────────────────────────

app.get('/api/health', async (req, res) => {
  const status = getRunStatus();
  const datasets = await listDatasets(DATA_DIR);
  const results = await store.list({ limit: 1 });
  res.json({
    ok: true, service: 'champion-tester', version: '1.0.0',
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

const PORT = parseInt(process.env.CHAMPION_TESTER_PORT || '3847', 10);

await startupCleanup();

// Load persisted state from previous run (if server crashed mid-run)
const persistedState = await loadPersistedState();
if (persistedState.lastAborted) {
  console.log(`[champion-tester] Previous run was aborted: ${persistedState.lastAborted.runId}`);
}

// Load last result so it's available immediately on /api/test/status
const lastResult = await loadLastResult();
if (lastResult) {
  console.log(`[champion-tester] Loaded last result: runId=${lastResult.runId} ok=${lastResult.ok}`);
}

const server = app.listen(PORT, () => {
  console.log(`\n  ⚡ Champion Tester running at http://localhost:${PORT}`);
  console.log(`  📁 Data: ${DATA_DIR}`);
  console.log(`  📁 Results: ${RESULTS_DIR}\n`);
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  log('info', 'WebSocket connected', { ip: req.socket.remoteAddress });
  // Send current state on connect so page refresh recovers running status
  const status = getRunStatus();
  ws.send(JSON.stringify({
    type: 'connected',
    data: { service: 'champion-tester', runStatus: status },
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

// ─── Global Error Handling ───────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  log('fatal', 'Uncaught exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log('fatal', 'Unhandled rejection', { error: String(reason) });
});
