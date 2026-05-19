# Champion Tester Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated web tool that tests the autoresearch champion strategy against arbitrary symbols with smart dataset management.

**Architecture:** Express API backend + React/Vite frontend. Backend reuses existing pine execution pipeline via cache materialization. Completely isolated from autoresearch (separate cache namespace, read-only champion access, own package.json).

**Tech Stack:** Node.js, Express, React 19, Vite 6, Tailwind CSS 4, ccxt (from parent), node:test

---

## File Structure

### New Files to Create

```
scripts/champion-tester/
├── package.json
├── vite.config.mjs
├── .gitignore
├── server.mjs                    (rewrite existing — add results, mutex, startup cleanup)
├── lib/
│   ├── dataset-manager.mjs       (already exists — minor updates)
│   ├── champion-loader.mjs       (already exists — minor updates)
│   ├── strategy-runner.mjs       (already exists — add mutex, timeout, duration tracking)
│   └── results-store.mjs         (NEW — persist/query test results)
├── tests/
│   └── champion-tester.test.mjs  (NEW — unit + integration tests)
├── web/
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css
│       ├── api.js
│       ├── hooks/
│       │   ├── useDatasets.js
│       │   ├── useChampions.js
│       │   └── useResults.js
│       └── components/
│           ├── Layout.jsx
│           ├── DatasetPanel.jsx
│           ├── TestRunner.jsx
│           ├── ResultsTable.jsx
│           ├── MetricsCard.jsx
│           └── StatusBadge.jsx
```

### Existing Files (Read Only — never modify)

```
pine/autoresearch/<matrix>/champion.json    (read by champion-loader)
pine/test.pine                              (read by strategy-runner)
scripts/pine-import-run-clean.mjs           (invoked as child process)
scripts/lib/pine-streaming-metrics.mjs      (imported for analysis)
scripts/lib/pine-dataset.mjs                (imported for cache validation)
```

---

## Task 1: Project Scaffolding & Package Setup

**Files:**
- Create: `scripts/champion-tester/package.json`
- Create: `scripts/champion-tester/.gitignore`
- Create: `scripts/champion-tester/vite.config.mjs`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "champion-tester",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "node --watch server.mjs",
    "dev:web": "vite",
    "build": "vite build",
    "start": "node server.mjs",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "concurrently": "^9.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
dist/
data/
results/
```

- [ ] **Step 3: Create vite.config.mjs**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: './web',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester && npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 5: Commit**

```bash
git add scripts/champion-tester/package.json scripts/champion-tester/.gitignore scripts/champion-tester/vite.config.mjs
git commit -m "feat(champion-tester): scaffold project with package.json and vite config"
```

---

## Task 2: Results Store Module

**Files:**
- Create: `scripts/champion-tester/lib/results-store.mjs`

- [ ] **Step 1: Create results-store.mjs**

```javascript
import fs from 'node:fs/promises';
import path from 'node:path';

export class ResultsStore {
  constructor(resultsDir) {
    this.resultsDir = resultsDir;
  }

  async init() {
    await fs.mkdir(this.resultsDir, { recursive: true });
  }

  _filename(result) {
    const ts = result.timestamp.replace(/[:.]/g, '-');
    return `${ts}_${result.dataset.symbol}_${result.dataset.timeframe}.json`;
  }

  async save(result) {
    await this.init();
    const filename = this._filename(result);
    const filePath = path.join(this.resultsDir, filename);
    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
    return { filename, filePath };
  }

  async list({ symbol, timeframe, limit = 50, sort = 'timestamp', order = 'desc' } = {}) {
    await this.init();
    const files = await fs.readdir(this.resultsDir);
    const results = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (symbol && result.dataset?.symbol !== symbol) continue;
        if (timeframe && result.dataset?.timeframe !== timeframe) continue;
        results.push(result);
      } catch { /* skip malformed */ }
    }

    results.sort((a, b) => {
      const aVal = sort === 'timestamp' ? a.timestamp : (a.metrics?.[sort] ?? 0);
      const bVal = sort === 'timestamp' ? b.timestamp : (b.metrics?.[sort] ?? 0);
      if (order === 'desc') return aVal > bVal ? -1 : 1;
      return aVal < bVal ? -1 : 1;
    });

    return { total: results.length, results: results.slice(0, limit) };
  }

  async get(runId) {
    await this.init();
    const files = await fs.readdir(this.resultsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (result.runId === runId) return result;
      } catch { /* skip */ }
    }
    return null;
  }

  async delete(runId) {
    await this.init();
    const files = await fs.readdir(this.resultsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (result.runId === runId) {
          await fs.unlink(path.join(this.resultsDir, file));
          return true;
        }
      } catch { /* skip */ }
    }
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/champion-tester/lib/results-store.mjs
git commit -m "feat(champion-tester): add results store module"
```

---

## Task 3: Update Dataset Manager

**Files:**
- Modify: `scripts/champion-tester/lib/dataset-manager.mjs`

The existing file is mostly complete. Add atomic write (temp+rename) and input validation.

- [ ] **Step 1: Add atomic write helper and validation**

Add at the top of the file after existing imports:

```javascript
import { randomUUID } from 'node:crypto';
```

Replace the `writeDataset` function with:

```javascript
export async function writeDataset(filePath, dataset) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(dataset, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}
```

- [ ] **Step 2: Add validateSymbolInput function**

Add after `parseSymbol`:

```javascript
export function validateSymbolInput(symbol, timeframe) {
  const errors = [];
  if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
    errors.push('symbol is required');
  }
  if (!timeframe || !TIMEFRAME_MS[timeframe]) {
    errors.push(`timeframe must be one of: ${Object.keys(TIMEFRAME_MS).join(', ')}`);
  }
  return errors;
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/champion-tester/lib/dataset-manager.mjs
git commit -m "feat(champion-tester): add atomic writes and input validation to dataset manager"
```

---

## Task 4: Update Strategy Runner (Mutex, Timeout, Duration)

**Files:**
- Modify: `scripts/champion-tester/lib/strategy-runner.mjs`

- [ ] **Step 1: Add mutex and timeout support**

Add at the top of the file:

```javascript
let _running = false;
let _runningSymbol = null;
let _runningStartedAt = null;

export function getRunStatus() {
  if (!_running) return { running: false };
  return {
    running: true,
    symbol: _runningSymbol,
    startedAt: _runningStartedAt,
    elapsedMs: Date.now() - _runningStartedAt,
  };
}
```

- [ ] **Step 2: Wrap runChampionTest with mutex and duration tracking**

Replace the `export async function runChampionTest` signature and add mutex logic at the start:

```javascript
export async function runChampionTest({
  matrixId,
  dataset,
  slice = {},
  onProgress = null,
  timeoutMs = 120_000,
}) {
  if (_running) {
    throw Object.assign(
      new Error('A test is already running. Please wait.'),
      { code: 'RUN_IN_PROGRESS' }
    );
  }

  _running = true;
  _runningSymbol = dataset.symbol;
  _runningStartedAt = Date.now();
  const startTime = Date.now();

  try {
    // ... existing logic ...
    // (keep all existing code inside this try block)
  } finally {
    _running = false;
    _runningSymbol = null;
    _runningStartedAt = null;
  }
}
```

- [ ] **Step 3: Add timeout to child process execution**

Update `runNodeScript` to accept a timeout:

```javascript
function runNodeScript(args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`Process exited with code ${code}\n${stderr}`));
    });
  });
}
```

- [ ] **Step 4: Add durationMs to result object**

In the return statement of `runChampionTest`, add:

```javascript
return {
  ok: true,
  runId,
  timestamp: new Date(startTime).toISOString(),
  durationMs: Date.now() - startTime,
  // ... rest of existing fields
};
```

- [ ] **Step 5: Commit**

```bash
git add scripts/champion-tester/lib/strategy-runner.mjs
git commit -m "feat(champion-tester): add mutex, timeout, and duration tracking to strategy runner"
```

---

## Task 5: Rewrite Server with Full API

**Files:**
- Rewrite: `scripts/champion-tester/server.mjs`

- [ ] **Step 1: Write server.mjs — imports and setup**

```javascript
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import {
  fetchOrUpdateDataset, listDatasets, deleteDataset,
  readDataset, datasetPath, parseSymbol,
  validateSymbolInput, TIMEFRAME_MS,
} from './lib/dataset-manager.mjs';
import { listChampionSources, loadChampion } from './lib/champion-loader.mjs';
import { runChampionTest, getRunStatus } from './lib/strategy-runner.mjs';
import { ResultsStore } from './lib/results-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.resolve(__dirname, 'data');
const RESULTS_DIR = path.resolve(__dirname, 'results');

const store = new ResultsStore(RESULTS_DIR);
const app = express();
app.use(express.json());
```

- [ ] **Step 2: Write server.mjs — startup cleanup**

```javascript
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
```

- [ ] **Step 3: Write server.mjs — dataset endpoints**

```javascript
app.get('/api/health', async (req, res) => {
  const status = getRunStatus();
  const datasets = await listDatasets(DATA_DIR);
  const results = await store.list({ limit: 1 });
  res.json({
    ok: true, service: 'champion-tester',
    uptime: process.uptime(), runStatus: status,
    datasetCount: datasets.length, resultCount: results.total,
  });
});

app.get('/api/timeframes', (req, res) => {
  res.json({ ok: true, timeframes: Object.keys(TIMEFRAME_MS) });
});

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
    if (errors.length) return res.status(400).json({ ok: false, error: errors.join('; '), code: 'VALIDATION_ERROR' });

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
```

- [ ] **Step 4: Commit partial server**

```bash
git add scripts/champion-tester/server.mjs
git commit -m "feat(champion-tester): server with dataset + health endpoints"
```

---

## Task 6: Server — Champion & Test Endpoints

**Files:**
- Modify: `scripts/champion-tester/server.mjs`

- [ ] **Step 1: Add champion endpoints**

Append after dataset endpoints:

```javascript
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
```

- [ ] **Step 2: Add test run endpoint**

```javascript
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

    const result = await runChampionTest({ matrixId, dataset, slice: slice || {} });
    await store.save(result);
    res.json(result);
  } catch (err) {
    if (err.code === 'RUN_IN_PROGRESS') {
      return res.status(409).json({ ok: false, error: err.message, code: err.code });
    }
    res.status(500).json({ ok: false, error: err.message, code: 'EXECUTION_ERROR' });
  }
});
```

- [ ] **Step 3: Add results endpoints**

```javascript
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
```

- [ ] **Step 4: Add server startup**

```javascript
const PORT = parseInt(process.env.CHAMPION_TESTER_PORT || '3847', 10);

// Production: serve built frontend
if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'));
    }
  });
}

await startupCleanup();
app.listen(PORT, () => {
  console.log(`\n  \u26A1 Champion Tester running at http://localhost:${PORT}`);
  console.log(`  \uD83D\uDCC1 Data: ${DATA_DIR}`);
  console.log(`  \uD83D\uDCC1 Results: ${RESULTS_DIR}\n`);
});

export default app;
```

- [ ] **Step 5: Commit**

```bash
git add scripts/champion-tester/server.mjs
git commit -m "feat(champion-tester): complete server with champion, test, and results endpoints"
```

---

## Task 7: React Frontend — Shell & Layout

**Files:**
- Create: `scripts/champion-tester/web/index.html`
- Create: `scripts/champion-tester/web/src/main.jsx`
- Create: `scripts/champion-tester/web/src/index.css`
- Create: `scripts/champion-tester/web/src/App.jsx`
- Create: `scripts/champion-tester/web/src/components/Layout.jsx`

- [ ] **Step 1: Create web/index.html**

```html
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Champion Tester</title>
</head>
<body class="bg-gray-900 text-gray-100 min-h-screen">
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create web/src/index.css**

```css
@import "tailwindcss";
```

- [ ] **Step 3: Create web/src/main.jsx**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Create web/src/App.jsx**

```jsx
import { useState } from 'react';
import Layout from './components/Layout.jsx';
import DatasetPanel from './components/DatasetPanel.jsx';
import TestRunner from './components/TestRunner.jsx';
import ResultsTable from './components/ResultsTable.jsx';

export default function App() {
  const [tab, setTab] = useState('datasets');

  return (
    <Layout activeTab={tab} onTabChange={setTab}>
      {tab === 'datasets' && <DatasetPanel />}
      {tab === 'test' && <TestRunner />}
      {tab === 'results' && <ResultsTable />}
    </Layout>
  );
}
```

- [ ] **Step 5: Create web/src/components/Layout.jsx**

```jsx
const TABS = [
  { id: 'datasets', label: 'Datasets' },
  { id: 'test', label: 'Test' },
  { id: 'results', label: 'Results' },
];

export default function Layout({ activeTab, onTabChange, children }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          \uD83C\uDFC6 Champion Tester
        </h1>
      </header>
      <nav className="flex gap-1 mb-6 border-b border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === t.id
                ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/champion-tester/web/
git commit -m "feat(champion-tester): react shell with layout and tab navigation"
```

---

## Task 8: API Client & Hooks

**Files:**
- Create: `scripts/champion-tester/web/src/api.js`
- Create: `scripts/champion-tester/web/src/hooks/useDatasets.js`
- Create: `scripts/champion-tester/web/src/hooks/useChampions.js`
- Create: `scripts/champion-tester/web/src/hooks/useResults.js`

- [ ] **Step 1: Create web/src/api.js**

```javascript
class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!data.ok) throw new ApiError(data.error, data.code, res.status);
  return data;
}

export const api = {
  getTimeframes: () => request('GET', '/timeframes'),
  getDatasets: () => request('GET', '/datasets'),
  fetchDataset: (symbol, timeframe, initialLimit) =>
    request('POST', '/datasets/fetch', { symbol, timeframe, initialLimit }),
  deleteDataset: (exchange, symbol, timeframe) =>
    request('DELETE', `/datasets/${exchange}/${symbol}/${timeframe}`),
  getChampions: () => request('GET', '/champions'),
  runTest: (matrixId, symbol, timeframe, slice) =>
    request('POST', '/test/run', { matrixId, symbol, timeframe, slice }),
  getResults: (params = {}) =>
    request('GET', `/results?${new URLSearchParams(params)}`),
  deleteResult: (runId) => request('DELETE', `/results/${runId}`),
};
```

- [ ] **Step 2: Create web/src/hooks/useDatasets.js**

```javascript
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

export function useDatasets() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDatasets();
      setDatasets(data.datasets);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { datasets, loading, error, refresh };
}
```

- [ ] **Step 3: Create web/src/hooks/useChampions.js**

```javascript
import { useState, useEffect } from 'react';
import { api } from '../api.js';

export function useChampions() {
  const [champions, setChampions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getChampions()
      .then((data) => setChampions(data.champions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { champions, loading };
}
```

- [ ] **Step 4: Create web/src/hooks/useResults.js**

```javascript
import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

export function useResults() {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const data = await api.getResults(params);
      setResults(data.results);
      setTotal(data.total);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { results, total, loading, refresh };
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/champion-tester/web/src/api.js scripts/champion-tester/web/src/hooks/
git commit -m "feat(champion-tester): api client and react hooks"
```

---

## Task 9: DatasetPanel Component

**Files:**
- Create: `scripts/champion-tester/web/src/components/DatasetPanel.jsx`
- Create: `scripts/champion-tester/web/src/components/StatusBadge.jsx`

- [ ] **Step 1: Create StatusBadge.jsx**

```jsx
export default function StatusBadge({ status, message }) {
  const colors = {
    loading: 'text-blue-400',
    success: 'text-green-400',
    error: 'text-red-400',
  };
  return (
    <span className={`text-sm ${colors[status] || 'text-gray-400'}`}>
      {status === 'loading' && '\u23F3 '}
      {status === 'success' && '\u2713 '}
      {status === 'error' && '\u2717 '}
      {message}
    </span>
  );
}
```

- [ ] **Step 2: Create DatasetPanel.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useDatasets } from '../hooks/useDatasets.js';
import StatusBadge from './StatusBadge.jsx';

export default function DatasetPanel() {
  const { datasets, loading, refresh } = useDatasets();
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('15m');
  const [timeframes, setTimeframes] = useState([]);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.getTimeframes().then((d) => setTimeframes(d.timeframes));
  }, []);

  const handleFetch = async () => {
    setFetching(true);
    setStatus(null);
    try {
      const res = await api.fetchDataset(symbol, timeframe);
      setStatus({ type: 'success', msg: `Fetched ${res.fetched} bars for ${res.tvSymbol}` });
      refresh();
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setFetching(false);
    }
  };

  const handleUpdate = async (ds) => {
    setStatus(null);
    try {
      const res = await api.fetchDataset(ds.tvSymbol, ds.timeframe);
      setStatus({ type: 'success', msg: `Updated: +${res.fetched} bars` });
      refresh();
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    }
  };

  const handleDelete = async (ds) => {
    if (!confirm(`Delete ${ds.tvSymbol} ${ds.timeframe}?`)) return;
    try {
      await api.deleteDataset(ds.exchange, ds.symbol, ds.timeframe);
      refresh();
    } catch (err) {
      setStatus({ type: 'error', msg: err.message });
    }
  };

  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString() : '-';

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Fetch New Dataset</h2>
        <div className="flex gap-3 items-end">
          <input
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm flex-1"
            placeholder="BINANCE:BTCUSDT"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          />
          <select
            className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
          >
            {timeframes.map((tf) => <option key={tf} value={tf}>{tf}</option>)}
          </select>
          <button
            onClick={handleFetch}
            disabled={fetching || !symbol.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded text-sm font-medium"
          >
            {fetching ? 'Fetching...' : 'Fetch 10k'}
          </button>
        </div>
        {status && <div className="mt-2"><StatusBadge status={status.type} message={status.msg} /></div>}
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-3">Your Datasets</h2>
        {loading ? <p className="text-gray-400">Loading...</p> :
         datasets.length === 0 ? <p className="text-gray-400">No datasets yet.</p> :
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-gray-700">
                <th className="text-left py-2">Symbol</th>
                <th className="text-left py-2">TF</th>
                <th className="text-right py-2">Bars</th>
                <th className="text-left py-2">Range</th>
                <th className="text-right py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((ds) => (
                <tr key={ds.file} className="border-b border-gray-700/50">
                  <td className="py-2 font-mono">{ds.tvSymbol}</td>
                  <td className="py-2">{ds.timeframe}</td>
                  <td className="py-2 text-right font-mono">{ds.candleCount.toLocaleString()}</td>
                  <td className="py-2 text-gray-400">{fmtDate(ds.firstTimestamp)} \u2013 {fmtDate(ds.lastTimestamp)}</td>
                  <td className="py-2 text-right space-x-2">
                    <button onClick={() => handleUpdate(ds)} className="text-blue-400 hover:text-blue-300">\u21BB</button>
                    <button onClick={() => handleDelete(ds)} className="text-red-400 hover:text-red-300">\uD83D\uDDD1</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/champion-tester/web/src/components/DatasetPanel.jsx scripts/champion-tester/web/src/components/StatusBadge.jsx
git commit -m "feat(champion-tester): dataset panel component"
```

---

## Task 10: MetricsCard Component

**Files:**
- Create: `scripts/champion-tester/web/src/components/MetricsCard.jsx`

- [ ] **Step 1: Create MetricsCard.jsx**

```jsx
export default function MetricsCard({ result, homeScore }) {
  if (!result) return null;

  const scoreColor = result.metrics?.score > 100
    ? 'text-green-400' : result.metrics?.score > 50
    ? 'text-yellow-400' : 'text-red-400';

  const delta = homeScore ? (result.metrics?.score - homeScore).toFixed(1) : null;

  if (!result.ok) {
    return (
      <div className="bg-red-900/20 border border-red-700 rounded-lg p-4 mt-4">
        <p className="text-red-400 font-medium">Run Failed</p>
        <p className="text-sm text-gray-300 mt-1">{result.error}</p>
      </div>
    );
  }

  const m = result.metrics || {};
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mt-4">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-gray-400 text-xs">Score</p>
          <p className={`text-xl font-bold font-mono ${scoreColor}`}>{m.score?.toFixed(1)}</p>
          {delta && <p className="text-xs text-gray-500">Δ {delta}</p>}
        </div>
        <div>
          <p className="text-gray-400 text-xs">ROI%</p>
          <p className="text-xl font-bold font-mono">{m.roiPct?.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Win Rate</p>
          <p className="text-xl font-bold font-mono">{m.winRatePct?.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Profit Factor</p>
          <p className="text-lg font-mono">{m.profitFactor?.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Max DD%</p>
          <p className="text-lg font-mono">{m.maxDrawdownPct?.toFixed(2)}%</p>
        </div>
        <div>
          <p className="text-gray-400 text-xs">Trades</p>
          <p className="text-lg font-mono">{m.tradeCount}</p>
        </div>
      </div>
      {result.durationMs && (
        <p className="text-xs text-gray-500 mt-3 text-center">
          {(result.durationMs / 1000).toFixed(1)}s | {result.dataset?.candlesUsed?.toLocaleString()} bars
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/champion-tester/web/src/components/MetricsCard.jsx
git commit -m "feat(champion-tester): metrics card component"
```

---

## Task 11: TestRunner Component

**Files:**
- Create: `scripts/champion-tester/web/src/components/TestRunner.jsx`

- [ ] **Step 1: Create TestRunner.jsx**

```jsx
import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useDatasets } from '../hooks/useDatasets.js';
import { useChampions } from '../hooks/useChampions.js';
import MetricsCard from './MetricsCard.jsx';

export default function TestRunner() {
  const { datasets } = useDatasets();
  const { champions } = useChampions();
  const [matrixId, setMatrixId] = useState('');
  const [selectedDs, setSelectedDs] = useState('');
  const [sliceMode, setSliceMode] = useState('all');
  const [lastN, setLastN] = useState(5000);
  const [fromIndex, setFromIndex] = useState(0);
  const [toIndex, setToIndex] = useState(9999);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Auto-select first champion
  useEffect(() => {
    if (champions.length && !matrixId) setMatrixId(champions[0].matrixId);
  }, [champions]);

  // Elapsed timer
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);

  const buildSlice = () => {
    if (sliceMode === 'lastN') return { lastN: Number(lastN) };
    if (sliceMode === 'indexRange') return { fromIndex: Number(fromIndex), toIndex: Number(toIndex) };
    return {};
  };

  const handleRun = async () => {
    const ds = datasets.find((d) => d.file === selectedDs);
    if (!ds || !matrixId) return;

    setRunning(true);
    setElapsed(0);
    setResult(null);
    setError(null);

    try {
      const res = await api.runTest(matrixId, ds.tvSymbol, ds.timeframe, buildSlice());
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const selectedChampion = champions.find((c) => c.matrixId === matrixId);

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold">Run Champion Test</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Champion</label>
            <select
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              value={matrixId}
              onChange={(e) => setMatrixId(e.target.value)}
            >
              {champions.map((c) => (
                <option key={c.matrixId} value={c.matrixId}>
                  {c.matrixId} (Score: {c.score})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Dataset</label>
            <select
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm"
              value={selectedDs}
              onChange={(e) => setSelectedDs(e.target.value)}
            >
              <option value="">Select dataset...</option>
              {datasets.map((ds) => (
                <option key={ds.file} value={ds.file}>
                  {ds.tvSymbol} {ds.timeframe} ({ds.candleCount.toLocaleString()} bars)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-400 block mb-2">Data Range</label>
          <div className="flex gap-4 text-sm">
            {['all', 'lastN', 'indexRange'].map((mode) => (
              <label key={mode} className="flex items-center gap-1 cursor-pointer">
                <input type="radio" name="slice" value={mode}
                  checked={sliceMode === mode}
                  onChange={() => setSliceMode(mode)}
                  className="accent-blue-500"
                />
                {mode === 'all' ? 'All data' : mode === 'lastN' ? 'Last N bars' : 'Index range'}
              </label>
            ))}
          </div>
          {sliceMode === 'lastN' && (
            <input type="number" value={lastN} onChange={(e) => setLastN(e.target.value)}
              className="mt-2 bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm w-32"
              min={100} />
          )}
          {sliceMode === 'indexRange' && (
            <div className="mt-2 flex gap-2">
              <input type="number" value={fromIndex} onChange={(e) => setFromIndex(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm w-24"
                placeholder="From" min={0} />
              <input type="number" value={toIndex} onChange={(e) => setToIndex(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded px-3 py-1 text-sm w-24"
                placeholder="To" />
            </div>
          )}
        </div>

        <button
          onClick={handleRun}
          disabled={running || !selectedDs || !matrixId}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-6 py-2 rounded text-sm font-medium"
        >
          {running ? `Running... ${elapsed}s` : '\uD83D\uDE80 Run Test'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
          <p className="text-red-400">{error}</p>
        </div>
      )}

      <MetricsCard result={result} homeScore={selectedChampion?.score} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/champion-tester/web/src/components/TestRunner.jsx
git commit -m "feat(champion-tester): test runner component"
```

---

## Task 12: ResultsTable Component

**Files:**
- Create: `scripts/champion-tester/web/src/components/ResultsTable.jsx`

- [ ] **Step 1: Create ResultsTable.jsx**

```jsx
import { useState } from 'react';
import { useResults } from '../hooks/useResults.js';
import { api } from '../api.js';

export default function ResultsTable() {
  const { results, loading, refresh } = useResults();
  const [sortCol, setSortCol] = useState('timestamp');
  const [sortDir, setSortDir] = useState('desc');
  const [expanded, setExpanded] = useState(null);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    else { setSortCol(col); setSortDir('desc'); }
    refresh({ sort: col, order: sortDir === 'desc' ? 'asc' : 'desc' });
  };

  const handleDelete = async (runId) => {
    if (!confirm('Delete this result?')) return;
    await api.deleteResult(runId);
    refresh();
  };

  const scoreColor = (score) =>
    score > 100 ? 'text-green-400' : score > 50 ? 'text-yellow-400' : 'text-red-400';

  const fmtTime = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const SortHeader = ({ col, children }) => (
    <th
      className="text-left py-2 cursor-pointer hover:text-gray-200 select-none"
      onClick={() => handleSort(col)}
    >
      {children} {sortCol === col ? (sortDir === 'desc' ? '\u2193' : '\u2191') : ''}
    </th>
  );

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (results.length === 0) return <p className="text-gray-400">No test results yet. Run a test to see results here.</p>;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h2 className="text-lg font-semibold mb-3">Results History</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 border-b border-gray-700">
            <SortHeader col="timestamp">Date</SortHeader>
            <th className="text-left py-2">Symbol</th>
            <th className="text-right py-2">Bars</th>
            <SortHeader col="score">Score</SortHeader>
            <th className="text-right py-2">ROI%</th>
            <th className="text-right py-2">WR%</th>
            <th className="text-right py-2">PF</th>
            <th className="text-right py-2">Trades</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <>
              <tr
                key={r.runId}
                className="border-b border-gray-700/50 cursor-pointer hover:bg-gray-700/30"
                onClick={() => setExpanded(expanded === r.runId ? null : r.runId)}
              >
                <td className="py-2 text-gray-400">{fmtTime(r.timestamp)}</td>
                <td className="py-2 font-mono">{r.dataset?.symbol}</td>
                <td className="py-2 text-right font-mono">{r.dataset?.candlesUsed?.toLocaleString()}</td>
                <td className={`py-2 text-right font-mono font-bold ${scoreColor(r.metrics?.score)}`}>
                  {r.ok ? r.metrics?.score?.toFixed(1) : 'FAIL'}
                </td>
                <td className="py-2 text-right font-mono">{r.metrics?.roiPct?.toFixed(1)}</td>
                <td className="py-2 text-right font-mono">{r.metrics?.winRatePct?.toFixed(1)}</td>
                <td className="py-2 text-right font-mono">{r.metrics?.profitFactor?.toFixed(2)}</td>
                <td className="py-2 text-right font-mono">{r.metrics?.tradeCount}</td>
              </tr>
              {expanded === r.runId && (
                <tr key={`${r.runId}-detail`}>
                  <td colSpan={8} className="py-3 px-4 bg-gray-900/50">
                    <div className="text-xs space-y-1">
                      <p><span className="text-gray-400">Champion:</span> {r.champion?.configId}</p>
                      <p><span className="text-gray-400">Duration:</span> {(r.durationMs / 1000).toFixed(1)}s</p>
                      <p><span className="text-gray-400">Max DD:</span> {r.metrics?.maxDrawdownPct?.toFixed(2)}%</p>
                      {r.error && <p className="text-red-400">{r.error}</p>}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.runId); }}
                        className="text-red-400 hover:text-red-300 mt-2"
                      >\uD83D\uDDD1 Delete</button>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/champion-tester/web/src/components/ResultsTable.jsx
git commit -m "feat(champion-tester): results table component"
```

---

## Task 13: Unit Tests

**Files:**
- Create: `scripts/champion-tester/tests/champion-tester.test.mjs`

- [ ] **Step 1: Create test file — dataset-manager tests**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbol, sliceDataset, validateSymbolInput, TIMEFRAME_MS } from '../lib/dataset-manager.mjs';

describe('parseSymbol', () => {
  it('parses EXCHANGE:SYMBOL format', () => {
    const r = parseSymbol('BINANCE:BTCUSDT');
    assert.equal(r.exchange, 'binance');
    assert.equal(r.symbol, 'BTCUSDT');
    assert.equal(r.raw, 'BINANCE:BTCUSDT');
  });

  it('defaults to binance when no exchange', () => {
    const r = parseSymbol('ETHUSDT');
    assert.equal(r.exchange, 'binance');
    assert.equal(r.symbol, 'ETHUSDT');
    assert.equal(r.raw, 'BINANCE:ETHUSDT');
  });

  it('normalizes case', () => {
    const r = parseSymbol('bybit:solusdt');
    assert.equal(r.exchange, 'bybit');
    assert.equal(r.symbol, 'SOLUSDT');
  });

  it('trims whitespace', () => {
    const r = parseSymbol('  BTCUSDT  ');
    assert.equal(r.symbol, 'BTCUSDT');
  });
});

describe('validateSymbolInput', () => {
  it('returns empty array for valid input', () => {
    const errors = validateSymbolInput('BTCUSDT', '15m');
    assert.equal(errors.length, 0);
  });

  it('rejects empty symbol', () => {
    const errors = validateSymbolInput('', '15m');
    assert.ok(errors.length > 0);
  });

  it('rejects invalid timeframe', () => {
    const errors = validateSymbolInput('BTCUSDT', '99m');
    assert.ok(errors.length > 0);
  });
});

describe('sliceDataset', () => {
  const candles = Array.from({ length: 100 }, (_, i) => ({
    timestamp: 1000 + i * 60000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100,
  }));

  it('returns all when no options', () => {
    const result = sliceDataset(candles, {});
    assert.equal(result.length, 100);
  });

  it('slices last N', () => {
    const result = sliceDataset(candles, { lastN: 10 });
    assert.equal(result.length, 10);
    assert.equal(result[0].timestamp, candles[90].timestamp);
  });

  it('slices by index range', () => {
    const result = sliceDataset(candles, { fromIndex: 20, toIndex: 29 });
    assert.equal(result.length, 10);
    assert.equal(result[0].timestamp, candles[20].timestamp);
  });

  it('slices by timestamp range', () => {
    const from = candles[50].timestamp;
    const to = candles[59].timestamp;
    const result = sliceDataset(candles, { fromTimestamp: from, toTimestamp: to });
    assert.equal(result.length, 10);
  });
});

describe('TIMEFRAME_MS', () => {
  it('has all expected timeframes', () => {
    const expected = ['1m','3m','5m','15m','30m','45m','1h','2h','4h','6h','8h','12h','1d','1w'];
    for (const tf of expected) {
      assert.ok(TIMEFRAME_MS[tf], `Missing timeframe: ${tf}`);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester && node --test tests/champion-tester.test.mjs`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/champion-tester/tests/
git commit -m "test(champion-tester): unit tests for dataset-manager"
```

---

## Task 14: Results Store Tests

**Files:**
- Modify: `scripts/champion-tester/tests/champion-tester.test.mjs`

- [ ] **Step 1: Add results-store tests**

Append to the test file:

```javascript
import { ResultsStore } from '../lib/results-store.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('ResultsStore', () => {
  let store;
  let tmpDir;

  const makeResult = (runId, symbol, score) => ({
    runId,
    timestamp: new Date().toISOString(),
    ok: true,
    durationMs: 1000,
    champion: { matrixId: 'test-matrix', configId: 'test-config', label: 'test' },
    dataset: { tvSymbol: `BINANCE:${symbol}`, symbol, exchange: 'binance', timeframe: '15m', candlesUsed: 1000 },
    metrics: { score, roiPct: 50, winRatePct: 40, profitFactor: 2, maxDrawdownPct: 3, tradeCount: 100 },
  });

  it('setup temp dir', async () => {
    tmpDir = path.join(os.tmpdir(), `ct-test-${Date.now()}`);
    store = new ResultsStore(tmpDir);
  });

  it('saves and retrieves a result', async () => {
    const result = makeResult('abc123', 'BTCUSDT', 98.3);
    await store.save(result);
    const retrieved = await store.get('abc123');
    assert.equal(retrieved.runId, 'abc123');
    assert.equal(retrieved.metrics.score, 98.3);
  });

  it('lists results sorted by timestamp desc', async () => {
    const r2 = makeResult('def456', 'ETHUSDT', 112.7);
    await store.save(r2);
    const { results } = await store.list();
    assert.ok(results.length >= 2);
  });

  it('filters by symbol', async () => {
    const { results } = await store.list({ symbol: 'BTCUSDT' });
    assert.ok(results.every((r) => r.dataset.symbol === 'BTCUSDT'));
  });

  it('deletes a result', async () => {
    const deleted = await store.delete('abc123');
    assert.equal(deleted, true);
    const retrieved = await store.get('abc123');
    assert.equal(retrieved, null);
  });

  it('cleanup temp dir', async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester && node --test tests/champion-tester.test.mjs`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/champion-tester/tests/
git commit -m "test(champion-tester): results store unit tests"
```

---

## Task 15: Verify Frontend Builds

**Files:**
- No new files

- [ ] **Step 1: Run Vite build**

Run: `cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester && npm run build`
Expected: `dist/` directory created with `index.html` and JS/CSS assets, no errors

- [ ] **Step 2: Verify no TypeScript/JSX errors**

Check output for warnings. Fix any import issues.

- [ ] **Step 3: Commit dist to gitignore (already done in Task 1)**

Verify `dist/` is in `.gitignore`. No commit needed.

---

## Task 16: End-to-End Smoke Test

**Files:**
- No new files

- [ ] **Step 1: Start the dev server**

Run: `cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester && npm run dev`
Expected: API on :3847, Vite on :5173, no errors

- [ ] **Step 2: Test health endpoint**

Run: `curl http://localhost:3847/api/health`
Expected: `{"ok":true,"service":"champion-tester",...}`

- [ ] **Step 3: Test dataset fetch (small)**

Run:
```bash
curl -X POST http://localhost:3847/api/datasets/fetch \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BINANCE:BTCUSDT","timeframe":"15m","initialLimit":200}'
```
Expected: `{"ok":true,"isNew":true,"fetched":200,...}`

- [ ] **Step 4: Test dataset list**

Run: `curl http://localhost:3847/api/datasets`
Expected: Array containing the BTCUSDT 15m dataset

- [ ] **Step 5: Test champion list**

Run: `curl http://localhost:3847/api/champions`
Expected: Array with `pine-fusion-v4-core-15m-locked-window` entry

- [ ] **Step 6: Test strategy run (small slice)**

Run:
```bash
curl -X POST http://localhost:3847/api/test/run \
  -H "Content-Type: application/json" \
  -d '{"matrixId":"pine-fusion-v4-core-15m-locked-window","symbol":"BINANCE:BTCUSDT","timeframe":"15m","slice":{"lastN":200}}'
```
Expected: `{"ok":true,"runId":"...","metrics":{"score":...},...}`

- [ ] **Step 7: Verify results saved**

Run: `curl http://localhost:3847/api/results`
Expected: Array with the run from Step 6

- [ ] **Step 8: Verify cleanup**

Run:
```powershell
Get-ChildItem "D:\Code\Experiment\backtest-kit-project\pine\dump\data\candle\champion-tester" -ErrorAction SilentlyContinue
Get-ChildItem "D:\Code\Experiment\backtest-kit-project\pine\dump\champion-tester-runs" -ErrorAction SilentlyContinue
```
Expected: Both directories empty or non-existent

- [ ] **Step 9: Verify autoresearch untouched**

Run:
```powershell
git -C "D:\Code\Experiment\backtest-kit-project" diff --name-only pine/autoresearch/
```
Expected: No output (no files modified)

- [ ] **Step 10: Open browser GUI**

Open `http://localhost:5173` in browser.
Verify: Datasets tab shows fetched dataset, Test tab can run, Results tab shows history.

- [ ] **Step 11: Stop dev server, clean up test data**

```powershell
Remove-Item "D:\Code\Experiment\backtest-kit-project\scripts\champion-tester\data\*" -ErrorAction SilentlyContinue
Remove-Item "D:\Code\Experiment\backtest-kit-project\scripts\champion-tester\results\*" -ErrorAction SilentlyContinue
```

---

## Task 17: Final Commit & Documentation

**Files:**
- Modify: `D:\Code\Experiment\backtest-kit-project\package.json` (add convenience script)

- [ ] **Step 1: Add convenience script to main package.json**

Add to the `"scripts"` section:

```json
"champion-tester": "cd scripts/champion-tester && npm run dev",
"champion-tester:start": "cd scripts/champion-tester && npm start"
```

- [ ] **Step 2: Verify all tests pass**

Run: `cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester && node --test tests/`
Expected: All tests PASS

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(champion-tester): complete phase 1 implementation"
```

---

## Summary

| Task | Description | Key Deliverable |
|------|-------------|----------------|
| 1 | Project scaffolding | package.json, vite.config, .gitignore |
| 2 | Results store module | lib/results-store.mjs |
| 3 | Update dataset manager | Atomic writes, validation |
| 4 | Update strategy runner | Mutex, timeout, duration |
| 5 | Server — dataset endpoints | Express API (health, timeframes, datasets) |
| 6 | Server — champion & test endpoints | Express API (champions, test/run, results) |
| 7 | React shell & layout | index.html, main.jsx, App.jsx, Layout.jsx |
| 8 | API client & hooks | api.js, useDatasets, useChampions, useResults |
| 9 | DatasetPanel component | Fetch/update/delete UI |
| 10 | MetricsCard component | Score/ROI/WR/PF/DD display |
| 11 | TestRunner component | Champion select, slice config, run button |
| 12 | ResultsTable component | Sortable history with detail expand |
| 13 | Unit tests — dataset manager | parseSymbol, sliceDataset, validation |
| 14 | Unit tests — results store | save, list, get, delete, filter |
| 15 | Verify frontend builds | Vite build passes |
| 16 | End-to-end smoke test | Full flow: fetch → run → results → cleanup |
| 17 | Final commit & docs | Convenience scripts, all tests green |
