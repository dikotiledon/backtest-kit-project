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
import { runChampionTest, getRunStatus } from './lib/strategy-runner.mjs';
import { runSweep, getSweepStatus, cancelSweep } from './lib/sweep-runner.mjs';
import { ResultsStore } from './lib/results-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.resolve(__dirname, 'data');
const RESULTS_DIR = path.resolve(__dirname, 'results');

const store = new ResultsStore(RESULTS_DIR);
const app = express();
app.use(express.json());

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
    const result = await fetchOrUpdateDataset({ tvSymbol: symbol, timeframe, dataDir: DATA_DIR, initialLimit: limit });

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

// ─── Test Runner API ────────────────────────────────────────────────────────

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

    broadcast('test:start', { symbol, timeframe });
    const result = await runChampionTest({ matrixId, dataset, slice: slice || {} });
    await store.save(result);
    broadcast('test:complete', result);
    res.json(result);
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') {
      return res.status(409).json({ ok: false, error: err.message, code: err.code });
    }
    res.status(500).json({ ok: false, error: err.message, code: 'EXECUTION_ERROR' });
  }
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

    const onProgress = (progressData) => broadcast('sweep:progress', progressData);
    const result = await runSweep({ matrixId, datasets: parsedDatasets, dataDir: DATA_DIR, onProgress });

    // Save successful results to store
    if (result.results) {
      for (const r of result.results) {
        if (r.ok) await store.save(r);
      }
    }

    res.json({ ok: true, sweepId: result.sweepId, total: result.total, message: 'Sweep started' });
  } catch (err) {
    if (err.code === 'SWEEP_IN_PROGRESS' || err.code === 'RUN_IN_PROGRESS') {
      return res.status(409).json({ ok: false, error: err.message, code: err.code });
    }
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

// ─── Static Serving (Production) ────────────────────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'));
    }
  });
}

// ─── Start ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.CHAMPION_TESTER_PORT || '3847', 10);

await startupCleanup();
const server = app.listen(PORT, () => {
  console.log(`\n  ⚡ Champion Tester running at http://localhost:${PORT}`);
  console.log(`  📁 Data: ${DATA_DIR}`);
  console.log(`  📁 Results: ${RESULTS_DIR}\n`);
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected', data: { service: 'champion-tester' } }));
});

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

export { broadcast };
export default app;
