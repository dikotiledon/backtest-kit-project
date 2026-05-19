# Champion Tester — Design Spec

**Date:** 2026-05-17
**Status:** Approved
**Scope:** Phase 1 — Dataset management + single-symbol champion testing with React GUI
**Author:** Dikotiledon (AI assistant)

---

## 1. Problem Statement

The autoresearch system optimizes a pine strategy on a fixed set of symbols (XRPUSDT primary, BTC/ETH shadows) with pinned historical windows. There is no mechanism to validate whether the champion generalizes to:

- Other trading pairs (e.g., SOLUSDT, BNBUSDT, DOGEUSDT)
- Different time periods (recent vs. historical)
- Different data lengths (full 10k vs. shorter windows)

This creates a blind spot: the champion may be overfit to its training symbols. A dedicated testing tool is needed that:

1. Fetches and manages OHLCV datasets for arbitrary symbols
2. Runs the champion strategy against those datasets
3. Presents results in a usable web interface
4. Does all of this without touching or interfering with the live autoresearch scheduler

---

## 2. Goals & Non-Goals

### Goals

| # | Goal | Success Criteria |
|---|------|-----------------|
| G1 | Test champion on any symbol | User can input any TradingView-format symbol and get strategy metrics |
| G2 | Smart dataset management | Initial 10k fetch; incremental updates from last timestamp; no redundant fetching |
| G3 | Configurable test range | User can select: all data, last N bars, index range, or date range |
| G4 | Web GUI | React SPA with dataset management, test execution, and results history |
| G5 | Complete isolation | Zero writes to autoresearch state; no shared cache namespace; independent process |
| G6 | Results persistence | Every test run saved to JSON; browsable history with sorting/filtering |

### Non-Goals (Phase 1)

- Multi-symbol batch sweep (phase 2)
- Real-time WebSocket progress (phase 2)
- Equity curve / trade-by-trade charting (phase 2)
- Parameter optimization / grid search on new symbols
- Modifying the champion config
- Integration with the autoresearch promotion pipeline

---

## 3. Architecture Overview

### 3.1 System Boundary Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Champion Tester (isolated process)                              │
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌────────────────┐  │
│  │ React SPA    │────▶│ Express API  │────▶│ Strategy Runner│  │
│  │ (Vite dev/   │     │ :3847        │     │                │  │
│  │  built dist) │     │              │     │ ┌────────────┐ │  │
│  │ :5173 (dev)  │     │ ┌──────────┐ │     │ │ Patch Pine │ │  │
│  └──────────────┘     │ │ Dataset  │ │     │ │ Script     │ │  │
│                       │ │ Manager  │ │     │ └─────┬──────┘ │  │
│                       │ └────┬─────┘ │     │       │        │  │
│                       └──────┼───────┘     │       ▼        │  │
│                              │             │ ┌────────────┐ │  │
│                              ▼             │ │ Materialize│ │  │
│                       ┌──────────────┐     │ │ Temp Cache │ │  │
│                       │ ccxt         │     │ └─────┬──────┘ │  │
│                       │ (binance,    │     │       │        │  │
│                       │  bybit, etc) │     │       ▼        │  │
│                       └──────────────┘     │ ┌────────────┐ │  │
│                                            │ │pine-import-│ │  │
│                                            │ │run-clean   │ │  │
│                                            │ └─────┬──────┘ │  │
│                                            │       │        │  │
│                                            │       ▼        │  │
│                                            │ ┌────────────┐ │  │
│                                            │ │ Streaming  │ │  │
│                                            │ │ Metrics    │ │  │
│                                            │ └────────────┘ │  │
│                                            └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │ READS ONLY (no writes)                    │
         ▼                                           ▼
┌─────────────────┐                    ┌──────────────────────────┐
│ pine/autoresearch│                    │ pine/dump/data/candle/   │
│ /<matrix>/       │                    │ champion-tester/         │
│ champion.json    │                    │ <symbol>/<tf>/<ts>.json  │
│ (READ ONLY)      │                    │ (TEMP, cleaned after run)│
└─────────────────┘                    └──────────────────────────┘
```

### 3.2 Directory Structure

```
scripts/champion-tester/
├── server.mjs                  # Express API server + Vite middleware (dev)
├── package.json                # Isolated deps
├── vite.config.mjs             # Vite config (React + Tailwind)
├── tailwind.config.mjs         # Tailwind configuration
├── postcss.config.mjs          # PostCSS for Tailwind
├── .gitignore                  # Ignore data/, results/, node_modules/, dist/
├── data/                       # Dataset JSON files
│   └── binance_BTCUSDT_15m.json
├── results/                    # Test run history
│   └── 2026-05-17T14-30-00Z_BTCUSDT_15m.json
├── lib/                        # Backend modules
│   ├── dataset-manager.mjs     # Fetch/update/list/delete/slice datasets
│   ├── champion-loader.mjs     # Load champion config from autoresearch
│   ├── strategy-runner.mjs     # Execute strategy, analyze, cleanup
│   └── results-store.mjs       # Persist and query test results
└── web/                        # React frontend source
    ├── index.html              # Vite entry point
    └── src/
        ├── main.jsx            # React root mount
        ├── App.jsx             # Tab router + layout
        ├── api.js              # Fetch wrapper for all API calls
        ├── hooks/
        │   ├── useDatasets.js   # Dataset list + mutations
        │   ├── useChampions.js  # Champion list loader
        │   └── useResults.js    # Results history loader
        └── components/
            ├── Layout.jsx       # Shell: header, tabs, content area
            ├── DatasetPanel.jsx # Dataset CRUD UI
            ├── TestRunner.jsx   # Champion test execution UI
            ├── ResultsTable.jsx # Sortable/filterable history
            ├── MetricsCard.jsx  # Score/ROI/WR/PF/DD display card
            └── StatusBadge.jsx  # Loading/success/error indicators
```

### 3.3 Dependency Strategy

**champion-tester/package.json owns:**
- `express` ^4.21 — API server
- `react` ^19, `react-dom` ^19 — UI framework
- `vite` ^6, `@vitejs/plugin-react` ^4 — build tooling
- `tailwindcss` ^4, `@tailwindcss/vite` — styling
- `concurrently` — run API + Vite in parallel during dev

**Resolved from main project's node_modules (not duplicated):**
- `ccxt` — exchange data fetching (already installed, ~50MB)
- `scripts/lib/pine-streaming-metrics.mjs` — JSONL analysis
- `scripts/lib/pine-dataset.mjs` — `validatePinnedCacheComplete` for cache verification
- `scripts/pine-import-run-clean.mjs` — strategy execution pipeline

**Rationale:** ccxt is large and already available. Frontend deps (react, vite, tailwind) are development-only and don't affect the main project. Express is lightweight and needed only by the champion-tester server.

---

## 4. Dataset Management — Detailed Design

### 4.1 Symbol Format Specification

**Input format:** TradingView-compatible symbol strings.

| Input | Parsed Exchange | Parsed Symbol | Normalized |
|-------|----------------|---------------|------------|
| `BINANCE:BTCUSDT` | binance | BTCUSDT | BINANCE:BTCUSDT |
| `BYBIT:ETHUSDT` | bybit | ETHUSDT | BYBIT:ETHUSDT |
| `OKX:SOLUSDT` | okx | SOLUSDT | OKX:SOLUSDT |
| `BTCUSDT` | binance (default) | BTCUSDT | BINANCE:BTCUSDT |
| `binance:btcusdt` | binance | BTCUSDT | BINANCE:BTCUSDT |

**Exchange ID mapping (TradingView name → ccxt id):**

```javascript
const EXCHANGE_MAP = {
  binance: 'binance',
  bybit: 'bybit',
  okx: 'okx',
  kucoin: 'kucoin',
  bitget: 'bitget',
  gate: 'gateio',
  gateio: 'gateio',
  coinbase: 'coinbase',
  kraken: 'kraken',
  htx: 'htx',
  huobi: 'htx',
  mexc: 'mexc',
  bitfinex: 'bitfinex',
};
```

**Validation rules:**
- Symbol must be non-empty after trimming
- Exchange (if provided) must exist in EXCHANGE_MAP or be a valid ccxt exchange id
- Symbol must be a valid market on the resolved exchange (checked during fetch)

### 4.2 Dataset Storage Format

**File naming:** `data/<exchange>_<SYMBOL>_<timeframe>.json`

Example: `data/binance_BTCUSDT_15m.json`

**Schema (v2):**

```typescript
interface Dataset {
  formatVersion: 2;
  createdAt: string;          // ISO-8601 timestamp of first fetch
  updatedAt: string;          // ISO-8601 timestamp of last update
  exchange: string;           // lowercase exchange name (e.g., "binance")
  exchangeId: string;         // ccxt exchange id (e.g., "binance")
  symbol: string;             // uppercase symbol (e.g., "BTCUSDT")
  tvSymbol: string;           // full TradingView format (e.g., "BINANCE:BTCUSDT")
  timeframe: string;          // candle timeframe (e.g., "15m")
  candleCount: number;        // total candles stored
  firstTimestamp: number;     // ms epoch of first candle
  lastTimestamp: number;      // ms epoch of last candle
  candles: Candle[];          // ordered array, ascending by timestamp
}

interface Candle {
  timestamp: number;  // ms epoch (candle open time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

**Invariants:**
- `candles` array is always sorted ascending by `timestamp`
- No duplicate timestamps within a dataset
- `candleCount === candles.length`
- `firstTimestamp === candles[0].timestamp`
- `lastTimestamp === candles[candles.length - 1].timestamp`

### 4.3 Fetch Behavior — Initial Load

**Trigger:** User requests a symbol+timeframe that has no existing dataset.

**Algorithm:**

```
1. Parse symbol → resolve exchange + ccxt id
2. Compute `since = now - (10000 * timeframeMs)`
3. Paginate fetchOHLCV in batches of 1000:
   while remaining > 0:
     batch = exchange.fetchOHLCV(symbol, tf, currentSince, min(remaining, 1000))
     if batch is empty → break (hit exchange data boundary)
     append to candles[]
     currentSince = lastBatchTimestamp + stepMs
     remaining -= batch.length
     if batch.length < batchSize → break (no more data)
4. Deduplicate by timestamp (Map keyed on ts)
5. Sort ascending
6. Validate: no gaps allowed? No — gaps are acceptable (exchange may have gaps)
7. Write dataset to disk
```

**Edge cases:**
- Exchange doesn't have 10k bars of history → store whatever is available, `candleCount` reflects actual
- Symbol doesn't exist on exchange → ccxt throws `BadSymbol` → surface as user-friendly error
- Network timeout during pagination → partial data discarded, error returned, no partial write
- Rate limiting → ccxt's built-in `enableRateLimit: true` handles throttling

### 4.4 Fetch Behavior — Incremental Update

**Trigger:** User clicks "Update" on an existing dataset.

**Algorithm:**

```
1. Read existing dataset from disk
2. Extract lastTimestamp from metadata
3. Compute since = lastTimestamp + stepMs (one interval after last known bar)
4. Compute estimatedBars = ceil((now - since) / stepMs)
5. If estimatedBars <= 0 → return "already up to date", no fetch
6. Paginate fetchOHLCV from `since` with limit = estimatedBars + 100 (buffer)
7. Merge: concat existing.candles + newCandles
8. Deduplicate by timestamp (Map)
9. Sort ascending
10. Update metadata: candleCount, lastTimestamp, updatedAt
11. Write dataset to disk (atomic: write to temp, rename)
```

**Key properties:**
- Never re-fetches data that already exists (starts from lastTimestamp + 1 step)
- The `+ 100` buffer handles clock drift and ensures we don't miss the most recent bar
- Deduplication makes the operation idempotent — safe to call multiple times
- If new fetch returns 0 bars (market is closed or no new data), dataset is unchanged

### 4.5 Supported Timeframes

| Timeframe | Milliseconds | Bars in 10k | Approx. Duration |
|-----------|-------------|-------------|-------------------|
| 1m | 60,000 | 10,000 | ~7 days |
| 5m | 300,000 | 10,000 | ~35 days |
| 15m | 900,000 | 10,000 | ~104 days |
| 30m | 1,800,000 | 10,000 | ~208 days |
| 1h | 3,600,000 | 10,000 | ~417 days |
| 4h | 14,400,000 | 10,000 | ~4.6 years |
| 1d | 86,400,000 | 10,000 | ~27 years |

Also supported: 3m, 45m, 2h, 6h, 8h, 12h, 1w.

### 4.6 Data Slicing for Testing

The user can specify which portion of a dataset to test against:

| Slice Mode | Parameters | Behavior |
|-----------|-----------|----------|
| All | (none) | Use entire dataset |
| Last N | `lastN: number` | Take last N candles from dataset |
| Index range | `fromIndex, toIndex` | Zero-based inclusive slice |
| Date range | `fromTimestamp, toTimestamp` | Filter by candle timestamp (ms epoch) |

**Validation:**
- `lastN` must be > 0 and <= candleCount
- `fromIndex` must be < `toIndex` and both within bounds
- `fromTimestamp` must be < `toTimestamp`
- Resulting slice must have >= 100 candles (minimum for meaningful strategy execution)
- If slice produces 0 candles → error with explanation

### 4.7 Dataset Lifecycle Operations

| Operation | Behavior |
|-----------|----------|
| **List** | Read all `*.json` from `data/`, return metadata (no candles) |
| **Fetch** | Create new or update existing (auto-detect) |
| **Info** | Return full metadata for a specific dataset |
| **Delete** | Remove JSON file from disk |

---

## 5. Strategy Execution — Detailed Design

### 5.1 Champion Loading

**Source:** `pine/autoresearch/<matrixId>/champion.json`

**Champion schema (as read):**

```typescript
interface ChampionFile {
  configId: string;           // e.g., "original-153-champion"
  label: string;              // human-readable description
  config: Record<string, number | boolean | string>;  // pine input overrides
  score: number;              // composite score
  tradeCount: number;
  roiPct: number;
  winRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgWin: number;
  avgLoss: number;
  configFingerprint: string;  // JSON-serialized sorted config
  promotedAt: string;         // ISO timestamp
  mode: string;               // promotion mode
}
```

**Loading behavior:**
- Champion is loaded fresh on every test run (never cached in memory)
- This ensures the tester always uses the latest champion even if autoresearch promotes mid-session
- If champion.json is missing or malformed → clear error: "No champion found for matrix <id>"

### 5.2 Pine Script Patching

The champion's `config` object contains key-value pairs that map to pine script `input.*()` declarations.

**Patching algorithm:**

```
For each (key, value) in champion.config:
  Find pattern: `<key> = input.int(<default>, ...)` or
                `<key> = input.float(<default>, ...)` or
                `<key> = input.bool(<default>, ...)` or
                `<key> = input(<default>, ...)`
  Replace <default> with the champion value:
    - boolean → "true" / "false"
    - number → string representation (e.g., "6.85")
    - string → quoted (e.g., '"value"')
```

**Example transformation:**

```pine
// Before patching:
slAtrMult = input.float(1.5, "SL ATR Multiplier")
useAdxFilter = input.bool(false, "Use ADX Filter")

// After patching with champion config {slAtrMult: 0.5, useAdxFilter: true}:
slAtrMult = input.float(0.5, "SL ATR Multiplier")
useAdxFilter = input.bool(true, "Use ADX Filter")
```

**Edge cases:**
- Config key not found in script → silently skip (champion may have keys from newer script versions)
- Multiple matches for same key → all replaced (shouldn't happen in well-formed pine)
- Script has imports → handled by `flattenImports()` in pine-import-run-clean (runs after patching)

### 5.3 Cache Materialization

The `@backtest-kit/cli` reads candle data from a file-per-candle cache structure. We materialize the dataset slice into this format.

**Cache structure:**
```
pine/dump/data/candle/champion-tester/<SYMBOL>/<timeframe>/<timestamp>.json
```

**Each candle file contains:**
```json
{
  "timestamp": 1715900000000,
  "open": 65432.10,
  "high": 65500.00,
  "low": 65400.00,
  "close": 65480.50,
  "volume": 1234.56
}
```

**Performance considerations:**
- 10,000 candles = 10,000 small file writes
- Use `Promise.all` with batching (256 concurrent writes) to parallelize
- Typical materialization time: 2-5 seconds for 10k candles on SSD
- Files are cleaned up after each run (see §5.5)

**Namespace isolation:**
- Exchange name is always `champion-tester` (hardcoded)
- Autoresearch uses `ccxt-exchange` — zero collision possible
- Even if both run simultaneously, they read/write different directories

### 5.4 Execution Pipeline

**Full sequence with timing estimates:**

```
Step 1: Load champion.json                    (~5ms)
Step 2: Read pine/test.pine                   (~10ms)
Step 3: Patch input values                    (~2ms)
Step 4: Write temp script                     (~5ms)
Step 5: Slice dataset candles                 (~50ms for 10k)
Step 6: Materialize candles to cache          (~3s for 10k)
Step 7: Run pine-import-run-clean.mjs         (~15-60s depending on bar count)
        ├─ flattenImports()                  (~100ms)
        ├─ validatePinnedCacheComplete()     (~2s for 10k)
        ├─ @backtest-kit/cli execution       (~10-50s)
        └─ cleanupJsonl()                    (~200ms)
Step 8: Analyze cleaned JSONL                 (~500ms)
Step 9: Save result to results/               (~10ms)
Step 10: Cleanup temp files + cache           (~3s for 10k)

Total estimated: 25-70 seconds per run
```

**CLI invocation (exact args):**

```bash
node scripts/pine-import-run-clean.mjs \
  --input pine/dump/champion-tester-runs/run-<uuid>.pine \
  --symbol <SYMBOL> \
  --timeframe <timeframe> \
  --limit <candleCount> \
  --when <lastCandleTimestamp + 1 step as ISO> \
  --require-cache-complete \
  --cache-root pine/dump/data/candle \
  --cache-exchange champion-tester \
  --output champion-test-<uuid>
```

**Why `--when` is computed as lastCandle + 1 step:**
The `--when` flag defines the exclusive end boundary. `--limit` defines how many bars before `--when`. Together they define the exact window that must exist in cache. By setting `when = lastCandleTs + stepMs`, we ensure the window covers exactly our materialized candles.

### 5.5 Cleanup Protocol

**After every run (success or failure), clean up:**

| Artifact | Path | Cleanup |
|----------|------|--------|
| Patched script | `pine/dump/champion-tester-runs/run-<id>.pine` | Delete |
| Flattened script | `pine/dump/champion-tester-runs/run-<id>.flattened.pine` | Delete |
| Raw JSONL | `pine/dump/champion-tester-runs/dump/champion-test-<id>.jsonl` | Delete |
| Cleaned JSONL | `pine/dump/champion-tester-runs/dump/champion-test-<id>.cleaned.jsonl` | Delete |
| Signals JSONL | `pine/dump/champion-tester-runs/dump/champion-test-<id>.signals.jsonl` | Delete |
| Cache files | `pine/dump/data/candle/champion-tester/<symbol>/<tf>/*.json` | Delete all in dir |
| Cache dir | `pine/dump/data/candle/champion-tester/<symbol>/<tf>/` | rmdir |

**Cleanup is wrapped in try/catch — failures are logged but don't propagate.**

### 5.6 Concurrency & Safety

- Only one test run executes at a time (server-side mutex via a simple `running` flag)
- If a run is in progress and another is requested → HTTP 409 Conflict with message
- This prevents cache directory conflicts between concurrent runs
- The mutex is released on both success and failure (finally block)
- Autoresearch uses a completely different cache namespace → no cross-interference even if both run simultaneously

---

## 6. Results Persistence

### 6.1 Result File Format

**File naming:** `results/<ISO-timestamp>_<symbol>_<timeframe>.json`

Example: `results/2026-05-17T14-30-00Z_BTCUSDT_15m.json`

**Schema:**

```typescript
interface TestResult {
  // Identity
  runId: string;              // UUID (first 8 chars)
  timestamp: string;          // ISO-8601 when test was executed
  
  // Status
  ok: boolean;                // true if strategy ran successfully
  error?: string;             // error message if ok=false
  durationMs: number;         // total execution time
  
  // Champion info (snapshot at time of test)
  champion: {
    matrixId: string;         // e.g., "pine-fusion-v4-core-15m-locked-window"
    configId: string;         // e.g., "original-153-champion"
    label: string;
    score: number;            // champion's score on its home symbol
    configFingerprint: string;
  };
  
  // Dataset info
  dataset: {
    tvSymbol: string;         // e.g., "BINANCE:BTCUSDT"
    symbol: string;           // e.g., "BTCUSDT"
    exchange: string;         // e.g., "binance"
    timeframe: string;        // e.g., "15m"
    candlesUsed: number;      // how many bars were tested
    totalAvailable: number;   // total bars in dataset
    sliceMode: string;        // "all" | "lastN" | "indexRange" | "dateRange"
    from: string;             // ISO timestamp of first candle in slice
    to: string;               // ISO timestamp of last candle in slice
  };
  
  // Metrics (only present if ok=true)
  metrics?: {
    score: number;
    roiPct: number;
    winRatePct: number;
    profitFactor: number;
    maxDrawdownPct: number;
    tradeCount: number;
    avgWinPct: number;
    avgLossPct: number;
    sharpeRatio?: number;
    expectancy?: number;
    longsCount: number;
    shortsCount: number;
    avgBarsInTrade: number;
  };
  
  // Diagnostics
  diagnostics?: {
    rowCount: number;         // total JSONL rows processed
    baseStartLongCount: number;
    baseStartShortCount: number;
    signalCount: number;
  };
  
  // Score breakdown (component scores)
  breakdown?: Record<string, number>;
}
```

### 6.2 Results Store Operations

| Operation | Endpoint | Behavior |
|-----------|----------|----------|
| **List** | `GET /api/results` | Read all result files, return sorted by timestamp desc. Supports `?symbol=X&timeframe=Y` filters |
| **Get** | `GET /api/results/:runId` | Return full result for a specific run |
| **Save** | (internal) | Called by strategy runner after each test |
| **Delete** | `DELETE /api/results/:runId` | Remove a specific result file |

### 6.3 Result Comparison

The results table enables comparison by showing the champion's "home" score alongside the test score:

```
| Symbol    | TF  | Bars  | Score | Home Score | Δ Score | ROI%  | WR%   | PF   |
|-----------|-----|-------|-------|------------|---------|-------|-------|------|
| BTCUSDT   | 15m | 10000 | 98.3  | 152.5      | -54.2   | 45.2% | 38.1% | 2.1  |
| ETHUSDT   | 15m | 10000 | 112.7 | 152.5      | -39.8   | 62.3% | 40.5% | 2.8  |
| SOLUSDT   | 15m | 10000 | 67.4  | 152.5      | -85.1   | 28.1% | 35.2% | 1.6  |
```

This immediately shows how well the champion generalizes.

---

## 7. API Specification

### 7.1 Endpoint Reference

#### `GET /api/health`

**Response:**
```json
{ "ok": true, "service": "champion-tester", "uptime": 3600, "version": "1.0.0" }
```

#### `GET /api/timeframes`

**Response:**
```json
{ "ok": true, "timeframes": ["1m","3m","5m","15m","30m","45m","1h","2h","4h","6h","8h","12h","1d","1w"] }
```

#### `GET /api/datasets`

**Response:**
```json
{
  "ok": true,
  "datasets": [
    {
      "file": "binance_BTCUSDT_15m.json",
      "tvSymbol": "BINANCE:BTCUSDT",
      "exchange": "binance",
      "symbol": "BTCUSDT",
      "timeframe": "15m",
      "candleCount": 10000,
      "firstTimestamp": 1710000000000,
      "lastTimestamp": 1715900000000,
      "createdAt": "2026-05-17T07:00:00Z",
      "updatedAt": "2026-05-17T14:00:00Z"
    }
  ]
}
```

#### `POST /api/datasets/fetch`

**Request body:**
```json
{
  "symbol": "BINANCE:BTCUSDT",
  "timeframe": "15m",
  "initialLimit": 10000
}
```

**Validation:**
- `symbol` — required, non-empty string
- `timeframe` — required, must be in supported list
- `initialLimit` — optional, default 10000, range [100, 50000]

**Response (success):**
```json
{
  "ok": true,
  "isNew": true,
  "fetched": 10000,
  "tvSymbol": "BINANCE:BTCUSDT",
  "symbol": "BTCUSDT",
  "exchange": "binance",
  "timeframe": "15m",
  "candleCount": 10000,
  "firstTimestamp": 1710000000000,
  "lastTimestamp": 1715900000000,
  "updatedAt": "2026-05-17T14:00:00Z"
}
```

**Response (error):**
```json
{ "ok": false, "error": "Unsupported exchange: fakex" }
```

**HTTP status codes:**
- 200 — success (new or updated)
- 400 — validation error (missing/invalid params)
- 500 — exchange error, network error, disk error

#### `DELETE /api/datasets/:exchange/:symbol/:timeframe`

**Response:** `{ "ok": true }`

**HTTP status codes:**
- 200 — deleted
- 404 — dataset not found
- 500 — disk error

#### `GET /api/champions`

**Response:**
```json
{
  "ok": true,
  "champions": [
    {
      "matrixId": "pine-fusion-v4-core-15m-locked-window",
      "configId": "original-153-champion",
      "label": "Original 153.25 champion restored",
      "score": 152.47,
      "tradeCount": 261,
      "roiPct": 91.7,
      "winRatePct": 42.53
    }
  ]
}
```

#### `GET /api/champions/:matrixId`

**Response:** Full champion object including `config` map.

#### `POST /api/test/run`

**Request body:**
```json
{
  "matrixId": "pine-fusion-v4-core-15m-locked-window",
  "symbol": "BINANCE:BTCUSDT",
  "timeframe": "15m",
  "slice": {
    "mode": "lastN",
    "lastN": 5000
  }
}
```

**Slice mode variants:**
```json
{ "mode": "all" }
{ "mode": "lastN", "lastN": 5000 }
{ "mode": "indexRange", "fromIndex": 2000, "toIndex": 7000 }
{ "mode": "dateRange", "fromTimestamp": 1710000000000, "toTimestamp": 1715000000000 }
```

**Validation:**
- `matrixId` — required, must have a champion.json
- `symbol` — required, must have a fetched dataset
- `timeframe` — required, must match dataset
- `slice` — optional, defaults to `{ mode: "all" }`
- Resulting slice must have >= 100 candles

**Response (success):**
```json
{
  "ok": true,
  "runId": "a1b2c3d4",
  "durationMs": 34500,
  "champion": { "matrixId": "...", "configId": "...", "label": "..." },
  "dataset": { "tvSymbol": "...", "candlesUsed": 5000, "from": "...", "to": "..." },
  "metrics": {
    "score": 98.3,
    "roiPct": 45.2,
    "winRatePct": 38.1,
    "profitFactor": 2.1,
    "maxDrawdownPct": 4.5,
    "tradeCount": 180
  },
  "diagnostics": { "rowCount": 5000, "signalCount": 360 },
  "breakdown": { "roi": 30, "winRate": 25, "profitFactor": 20, "drawdown": 23.3 }
}
```

**Response (run in progress):**
```json
{ "ok": false, "error": "A test is already running. Please wait.", "code": "RUN_IN_PROGRESS" }
```
HTTP 409 Conflict.

**Response (failure during execution):**
```json
{
  "ok": false,
  "runId": "a1b2c3d4",
  "error": "Process exited with code 1\nError: ...",
  "champion": { "matrixId": "...", "configId": "..." },
  "dataset": { "tvSymbol": "...", "candlesUsed": 5000 }
}
```
HTTP 200 (the request succeeded; the strategy execution failed).

#### `GET /api/results`

**Query params:**
- `symbol` — filter by symbol (optional)
- `timeframe` — filter by timeframe (optional)
- `limit` — max results (default 50, max 200)
- `sort` — field to sort by (default: `timestamp`, options: `score`, `roiPct`, `winRatePct`, `tradeCount`)
- `order` — `asc` or `desc` (default: `desc`)

**Response:**
```json
{
  "ok": true,
  "total": 42,
  "results": [ /* array of TestResult objects without full breakdown */ ]
}
```

#### `GET /api/results/:runId`

**Response:** Full TestResult object.

#### `DELETE /api/results/:runId`

**Response:** `{ "ok": true }`

### 7.2 Error Response Convention

All errors follow a consistent shape:

```json
{
  "ok": false,
  "error": "Human-readable error message",
  "code": "OPTIONAL_ERROR_CODE"
}
```

**Error codes (optional, for programmatic handling):**
- `VALIDATION_ERROR` — bad input
- `NOT_FOUND` — resource doesn't exist
- `RUN_IN_PROGRESS` — concurrent run blocked
- `EXCHANGE_ERROR` — ccxt/network failure
- `EXECUTION_ERROR` — pine script failed
- `TIMEOUT` — execution exceeded time limit

---

## 8. Web GUI — Detailed Design

### 8.1 Technology Stack

| Layer | Technology | Version | Rationale |
|-------|-----------|---------|----------|
| Framework | React | 19.x | Rich ecosystem, charting libs, user's choice |
| Build | Vite | 6.x | Fast HMR, ESM-native, zero-config React support |
| Styling | Tailwind CSS | 4.x | Utility-first, dark theme built-in, no CSS files to manage |
| HTTP client | fetch (native) | — | No extra deps, async/await, sufficient for this use case |
| State | React hooks (useState/useEffect) | — | Simple enough scope; no Redux/Zustand needed |
| Routing | Tab state (no router) | — | Single-page with tabs, URL routing unnecessary |

### 8.2 Layout & Navigation

```
┌────────────────────────────────────────────────────────────┐
│  🏆 Champion Tester          [Datasets] [Test] [Results]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  [Active Tab Content Area]                                  │
│                                                            │
│                                                            │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Header:** App title + champion status badge (shows current champion score/configId).
**Tabs:** Three tabs with active indicator. Content swaps without page reload.

### 8.3 Tab 1: Datasets Panel

**Wireframe:**

```
┌────────────────────────────────────────────────────────────┐
│  Fetch New Dataset                                          │
│  ┌──────────────────────┐ ┌────────┐ ┌──────────────┐  │
│  │ BINANCE:BTCUSDT        │ │ 15m    │ │ [Fetch 10k]  │  │
│  └──────────────────────┘ └────────┘ └──────────────┘  │
│                                                            │
│  Your Datasets                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Symbol       │ TF  │ Bars   │ Range        │ Actions  │  │
│  ├─────────────┼─────┼────────┼──────────────┼──────────┤  │
│  │ BINANCE:BTC  │ 15m │ 10,000 │ Mar-May 2026 │ ↻  🗑️    │  │
│  │ BINANCE:ETH  │ 15m │ 10,000 │ Feb-May 2026 │ ↻  🗑️    │  │
│  │ BINANCE:SOL  │ 15m │ 8,432  │ Mar-May 2026 │ ↻  🗑️    │  │
│  └─────────────┴─────┴────────┴──────────────┴──────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Symbol input: text field with placeholder "BINANCE:BTCUSDT"
- Timeframe: dropdown select populated from `/api/timeframes`
- Fetch button: disabled while fetching, shows spinner
- Update (↻): triggers incremental update, shows "Fetching X bars..."
- Delete (🗑️): confirmation dialog before deletion
- Table auto-refreshes after fetch/update/delete
- Date range column shows human-readable format ("Mar 15 – May 17, 2026")

**States:**
- Empty state: "No datasets yet. Fetch one above to get started."
- Loading: skeleton rows in table
- Error: red toast notification with error message
- Success: green toast "Fetched 10,000 bars for BINANCE:BTCUSDT 15m"

### 8.4 Tab 2: Test Runner

**Wireframe:**

```
┌────────────────────────────────────────────────────────────┐
│  Run Champion Test                                          │
│                                                            │
│  Champion:  [▼ pine-fusion-v4-core-15m  (Score: 152.5)]    │
│  Dataset:   [▼ BINANCE:BTCUSDT 15m (10,000 bars)]          │
│                                                            │
│  Data Range:                                                │
│  (●) All data  ( ) Last N bars  ( ) Index range  ( ) Dates  │
│  [N: 5000______]  (shown conditionally)                     │
│                                                            │
│  [🚀 Run Test]                                              │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  Latest Result                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Score: 98.3    ROI: 45.2%    Win Rate: 38.1%           │  │
│  │  PF: 2.1       Max DD: 4.5%  Trades: 180               │  │
│  │  Δ vs Home: -54.2 (champion scores 152.5 on XRPUSDT)    │  │
│  │  Duration: 34.5s | Bars tested: 5,000                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Champion dropdown: auto-selects if only one matrix exists; shows score/configId preview
- Dataset dropdown: only shows datasets matching selected timeframe; shows bar count
- Slice radio group: conditional inputs appear below based on selection
  - "All data" → no extra inputs
  - "Last N bars" → number input with max = dataset candleCount
  - "Index range" → two number inputs (from/to) with slider
  - "Date range" → two date pickers (from/to) constrained to dataset range
- Run button: disabled during execution, shows progress spinner + elapsed time
- Result card: appears after run completes, color-coded (green if score > 100, yellow 50-100, red < 50)
- Δ vs Home: shows difference between test score and champion's home score

**States:**
- Idle: form ready, no result shown
- Running: spinner + "Running strategy on BTCUSDT 15m (5,000 bars)..." + elapsed timer
- Success: result card with metrics
- Error: red card with error message + "Run failed" badge
- No datasets: message "Fetch a dataset first" with link to Datasets tab

**UX details:**
- After successful run, result auto-saves and appears in Results tab
- Champion dropdown refreshes on tab focus (picks up promotions)
- Dataset dropdown refreshes on tab focus (picks up new fetches)
- Slice validation happens client-side before submit (min 100 bars)

### 8.5 Tab 3: Results History

**Wireframe:**

```
┌────────────────────────────────────────────────────────────┐
│  Results History                          Filter: [All ▼]  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Date↓    │ Symbol  │ Bars │ Score│ ROI%  │ WR%  │ PF  │  │
│  ├─────────┼─────────┼──────┼──────┼───────┼──────┼─────┤  │
│  │ May 17   │ BTCUSDT │ 10k  │ 98.3 │ 45.2% │ 38.1%│ 2.1 │  │
│  │ May 17   │ ETHUSDT │ 10k  │ 112.7│ 62.3% │ 40.5%│ 2.8 │  │
│  │ May 16   │ SOLUSDT │ 5k   │ 67.4 │ 28.1% │ 35.2%│ 1.6 │  │
│  │ May 16   │ BTCUSDT │ 5k   │ 85.1 │ 38.7% │ 36.8%│ 1.9 │  │
│  └─────────┴─────────┴──────┴──────┴───────┴──────┴─────┘  │
│                                                            │
│  ┌─ Detail Panel (shown on row click) ──────────────────┐  │
│  │ BINANCE:BTCUSDT 15m | 10,000 bars | May 17 14:30       │  │
│  │ Champion: original-153-champion (home: 152.5)          │  │
│  │                                                        │  │
│  │ Score: 98.3  (Δ -54.2)                                 │  │
│  │ ROI: 45.2%   Win Rate: 38.1%   PF: 2.1               │  │
│  │ Max DD: 4.5%  Trades: 180 (92L / 88S)                 │  │
│  │ Avg Win: 1.15%  Avg Loss: 0.24%  Expectancy: 0.42%   │  │
│  │ Avg Bars in Trade: 12                                 │  │
│  │                                                        │  │
│  │ Score Breakdown:                                       │  │
│  │ [ROI: 30] [WR: 25] [PF: 20] [DD: 23.3]               │  │
│  │                                          [🗑️ Delete]  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**Interactions:**
- Column headers are clickable for sorting (toggle asc/desc)
- Filter dropdown: "All", or filter by symbol (populated from unique symbols in results)
- Row click: expands detail panel below the row (accordion style)
- Detail panel shows full metrics + score breakdown + delete button
- Delete: confirmation dialog, removes from disk and table
- Color coding: score cell background (green > 100, yellow 50-100, red < 50)
- Relative time display: "2 hours ago", "yesterday", etc.

**States:**
- Empty: "No test results yet. Run a test to see results here."
- Loading: skeleton table
- Populated: sortable table with expandable rows

### 8.6 Component Architecture

```
App.jsx
├── Layout.jsx
│   ├── Header (title + champion badge)
│   ├── TabBar (Datasets | Test | Results)
│   └── TabContent (renders active panel)
├── DatasetPanel.jsx
│   ├── FetchForm (symbol input + timeframe + button)
│   ├── DatasetTable (list with actions)
│   └── Toast (success/error notifications)
├── TestRunner.jsx
│   ├── ChampionSelect (dropdown)
│   ├── DatasetSelect (dropdown)
│   ├── SliceConfig (radio + conditional inputs)
│   ├── RunButton (with progress state)
│   └── MetricsCard (result display)
├── ResultsTable.jsx
│   ├── FilterBar (symbol filter dropdown)
│   ├── SortableTable (column sort)
│   └── ResultDetail (expandable row detail)
└── StatusBadge.jsx (reusable loading/success/error indicator)
```

### 8.7 API Client (`api.js`)

```javascript
// Centralized API client with error handling
const API_BASE = '/api';

async function request(method, path, body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json();
  if (!data.ok) throw new ApiError(data.error, data.code, res.status);
  return data;
}

// Exported methods:
export const api = {
  getDatasets: () => request('GET', '/datasets'),
  fetchDataset: (symbol, timeframe, initialLimit) => 
    request('POST', '/datasets/fetch', { symbol, timeframe, initialLimit }),
  deleteDataset: (exchange, symbol, timeframe) => 
    request('DELETE', `/datasets/${exchange}/${symbol}/${timeframe}`),
  getChampions: () => request('GET', '/champions'),
  runTest: (matrixId, symbol, timeframe, slice) => 
    request('POST', '/test/run', { matrixId, symbol, timeframe, slice }),
  getResults: (params) => request('GET', `/results?${new URLSearchParams(params)}`),
  getResult: (runId) => request('GET', `/results/${runId}`),
  deleteResult: (runId) => request('DELETE', `/results/${runId}`),
};
```

### 8.8 Styling & Theme

**Dark theme palette (Tailwind):**
- Background: `bg-gray-900` (main), `bg-gray-800` (cards/panels)
- Text: `text-gray-100` (primary), `text-gray-400` (secondary)
- Accent: `text-blue-400` (links, active tabs)
- Success: `text-green-400`, `bg-green-900/20`
- Warning: `text-yellow-400`, `bg-yellow-900/20`
- Error: `text-red-400`, `bg-red-900/20`
- Borders: `border-gray-700`
- Inputs: `bg-gray-700 border-gray-600 text-gray-100`

**Responsive breakpoints:**
- Mobile (< 768px): single column, stacked cards
- Desktop (>= 768px): full table layout, side-by-side elements

**Typography:**
- Monospace for numbers/metrics: `font-mono`
- Sans-serif for labels: default Tailwind sans stack

---

## 9. Development Workflow

### 9.1 Setup

```bash
cd D:\Code\Experiment\backtest-kit-project\scripts\champion-tester
npm install
```

### 9.2 Development Mode

```bash
npm run dev
# Starts:
#   - Express API on http://localhost:3847
#   - Vite dev server on http://localhost:5173 (proxies /api to :3847)
```

**package.json scripts:**
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "dev:api": "node --watch server.mjs",
    "dev:web": "vite --config vite.config.mjs",
    "build": "vite build --config vite.config.mjs",
    "start": "NODE_ENV=production node server.mjs",
    "preview": "vite preview --config vite.config.mjs"
  }
}
```

### 9.3 Production Mode

```bash
npm run build    # Builds React to dist/
npm start        # Express serves dist/ + API on :3847
```

### 9.4 Vite Configuration

```javascript
// vite.config.mjs
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

### 9.5 Server Static Serving (Production)

In production, `server.mjs` serves the built frontend:

```javascript
if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir));
  // SPA fallback: serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distDir, 'index.html'));
    }
  });
}
```

---

## 10. Testing Strategy

### 10.1 Backend Unit Tests

**Framework:** `node:test` (matches main project convention)

**Test file:** `scripts/champion-tester/tests/champion-tester.test.mjs`

| Module | Test Cases |
|--------|------------|
| `dataset-manager.mjs` | parseSymbol() with various formats; sliceDataset() edge cases; TIMEFRAME_MS completeness |
| `champion-loader.mjs` | loadChampion() with valid/missing/malformed files; listChampionSources() |
| `strategy-runner.mjs` | applyConfigToSource() patching correctness; cleanup on failure |
| `results-store.mjs` | save/list/get/delete operations; sorting; filtering |

**Mocking strategy:**
- ccxt calls: mock `fetchOHLCV` to return deterministic candle arrays
- File I/O: use temp directories for dataset/results tests
- pine-import-run-clean: not unit-tested (integration test covers it)

### 10.2 Integration Tests

| Test | What it validates |
|------|-------------------|
| Full run (small dataset) | Fetch 100 bars → run champion → get metrics → verify result saved |
| Incremental update | Fetch 100 bars → wait → update → verify new bars appended |
| Isolation check | Run champion-tester while autoresearch state exists → verify no autoresearch files modified |
| Cleanup verification | After run, verify no temp files remain in cache or dump dirs |
| Error handling | Invalid symbol → verify clean error; missing dataset → 404 |

### 10.3 Frontend Tests

Deferred to phase 2. Phase 1 relies on manual testing of the React UI.

### 10.4 Manual Smoke Test Checklist

```
[ ] Start server (npm run dev)
[ ] Open http://localhost:5173
[ ] Datasets tab: fetch BINANCE:BTCUSDT 15m (10k bars)
[ ] Datasets tab: verify table shows dataset with correct metadata
[ ] Datasets tab: click Update, verify incremental fetch
[ ] Test tab: select champion + dataset + "Last 5000 bars"
[ ] Test tab: run test, verify metrics appear
[ ] Results tab: verify result appears in history
[ ] Results tab: click row, verify detail panel
[ ] Results tab: sort by score, verify order changes
[ ] Verify: no files modified in pine/autoresearch/
[ ] Verify: no leftover files in pine/dump/champion-tester-runs/
[ ] Verify: no leftover files in pine/dump/data/candle/champion-tester/
```

---

## 11. Error Handling & Edge Cases

### 11.1 Network Errors

| Scenario | Handling |
|----------|----------|
| Exchange unreachable | Retry up to 3 times with exponential backoff (ccxt handles internally) |
| Partial fetch (network drops mid-pagination) | Discard partial data, return error, no partial write |
| Exchange rate limit hit | ccxt `enableRateLimit: true` auto-throttles; if 429 persists, surface error |
| DNS resolution failure | Surface as "Cannot reach exchange" |

### 11.2 Data Errors

| Scenario | Handling |
|----------|----------|
| Symbol not found on exchange | ccxt `BadSymbol` error → "Symbol XYZUSDT not found on binance" |
| Exchange returns malformed data | Filter out non-numeric candles during normalization |
| Dataset file corrupted on disk | JSON parse error → treat as missing, offer re-fetch |
| Disk full during write | fs error → surface to user, no partial file left |

### 11.3 Execution Errors

| Scenario | Handling |
|----------|----------|
| Pine script syntax error after patching | pine-import-run-clean exits non-zero → capture stderr, return in result |
| @backtest-kit/cli crash | Process exit code != 0 → capture output, cleanup, return error result |
| Timeout (> 120s) | Kill child process, cleanup, return timeout error |
| No trades generated | Analysis returns score=0, tradeCount=0 → valid result (not an error) |
| JSONL file empty or missing | Return score=0 with diagnostic note |

### 11.4 Concurrency Edge Cases

| Scenario | Handling |
|----------|----------|
| Two test runs requested simultaneously | Second request gets HTTP 409 + "RUN_IN_PROGRESS" |
| Dataset fetch while test is running | Allowed — dataset operations don't conflict with test cache |
| Dataset delete while test uses it | Test already loaded candles into memory → no conflict |
| Server crash during test run | Orphaned temp files → startup cleanup sweep (see §11.5) |

### 11.5 Startup Cleanup

On server start, sweep and remove any orphaned artifacts:

```javascript
async function startupCleanup() {
  // Remove any leftover temp scripts
  const runsDir = path.resolve(PROJECT_ROOT, 'pine/dump/champion-tester-runs');
  await rimraf(runsDir); // recreated on next run
  
  // Remove any leftover cache files
  const cacheDir = path.resolve(PROJECT_ROOT, 'pine/dump/data/candle/champion-tester');
  await rimraf(cacheDir); // recreated on next run
}
```

This handles the case where the server crashed mid-run and left artifacts behind.

---

## 12. Security Considerations

| Concern | Mitigation |
|---------|------------|
| Symbol injection (malicious input) | parseSymbol() strips to alphanumeric + colon; ccxt validates against market list |
| Path traversal in API params | All file paths constructed from validated components, never from raw user input |
| Arbitrary code execution | No `eval()`, no dynamic imports from user input; pine scripts are data, not executed by Node |
| DoS via large dataset requests | `initialLimit` capped at 50,000; request timeout on fetch endpoint |
| Sensitive data exposure | No API keys needed (ccxt public endpoints only); no auth on local tool |
| Port exposure | Binds to localhost only by default; not exposed to network |

---

## 13. Performance Considerations

### 13.1 Dataset Fetch Performance

| Operation | Expected Time | Bottleneck |
|-----------|--------------|------------|
| Initial 10k fetch (15m tf) | 30-90s | Exchange rate limits (1000 bars/request, ~10 requests) |
| Incremental update (100 bars) | 2-5s | Single API call |
| Dataset read from disk (10k candles) | 50-200ms | JSON parse of ~5MB file |
| Dataset list (10 files) | 100-300ms | Read + parse metadata from each file |

### 13.2 Strategy Execution Performance

| Step | 1,000 bars | 5,000 bars | 10,000 bars |
|------|-----------|-----------|------------|
| Cache materialization | 0.5s | 1.5s | 3s |
| pine-import-run-clean | 5-10s | 15-30s | 30-60s |
| Metrics analysis | 100ms | 300ms | 500ms |
| Cleanup | 0.5s | 1.5s | 3s |
| **Total** | **~8s** | **~20s** | **~40s** |

### 13.3 Optimization Opportunities (Future)

- **Batch cache writes:** Write candles in chunks of 256 using `Promise.all` instead of sequential
- **Keep cache warm:** Option to skip cleanup and reuse cache for same symbol (toggle in UI)
- **Streaming results:** WebSocket to push progress updates during long runs
- **Dataset compression:** gzip dataset files on disk (reduces 5MB → ~1MB)
- **Memory-mapped datasets:** For very large datasets, stream from disk instead of loading all into memory

---

## 14. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Cache collision with autoresearch | Very Low | High | Hardcoded unique exchange name `champion-tester`; different directory tree |
| R2 | Large datasets exhaust disk space | Medium | Medium | 10k candles ≈ 5MB per dataset; warn if data/ exceeds 500MB |
| R3 | Pine script execution hangs | Low | Medium | 120s hard timeout with process kill; cleanup in finally block |
| R4 | Stale champion after promotion | Very Low | Low | Champion loaded fresh each run; never cached |
| R5 | Port conflict with other services | Low | Low | Configurable via `CHAMPION_TESTER_PORT` env var |
| R6 | ccxt breaking changes | Low | Medium | Pin ccxt version in main project; test after updates |
| R7 | @backtest-kit/cli output format changes | Low | High | Streaming metrics analyzer is resilient to extra fields; test after updates |
| R8 | Concurrent autoresearch + champion-tester | Low | Low | Completely separate namespaces; no shared mutable state |
| R9 | Dataset JSON too large for memory | Low | Medium | 50k candles ≈ 25MB JSON; Node handles this fine; cap at 50k |
| R10 | Exchange API downtime | Medium | Low | Clear error message; user retries manually |

---

## 15. Observability & Diagnostics

### 15.1 Server Logging

All operations log to stdout with structured format:

```
[champion-tester] [2026-05-17T14:30:00Z] [INFO] Dataset fetched: BINANCE:BTCUSDT 15m (10000 bars, 45.2s)
[champion-tester] [2026-05-17T14:31:00Z] [INFO] Test started: BTCUSDT 15m (5000 bars, champion: original-153)
[champion-tester] [2026-05-17T14:31:35Z] [INFO] Test complete: BTCUSDT 15m (score: 98.3, 34.5s)
[champion-tester] [2026-05-17T14:32:00Z] [ERROR] Test failed: SOLUSDT 15m (timeout after 120s)
```

### 15.2 Health Endpoint

`GET /api/health` returns:
- Service uptime
- Current run status (idle / running + symbol + elapsed)
- Dataset count
- Results count
- Last run timestamp

### 15.3 Diagnostics in Results

Every test result includes `diagnostics` field:
- `rowCount` — total JSONL rows (should match candle count)
- `signalCount` — number of entry signals generated
- `baseStartLongCount` / `baseStartShortCount` — actual trade entries
- If `signalCount = 0` → strategy generated no signals on this symbol (useful diagnostic)
- If `tradeCount = 0` but `signalCount > 0` → signals filtered out by risk management

---

## 16. Phase 2 Roadmap

| Feature | Description | Priority |
|---------|-------------|----------|
| Multi-symbol sweep | Run champion against all fetched datasets in batch | High |
| WebSocket progress | Real-time updates during long runs/sweeps | High |
| Equity curve chart | TradingView lightweight-charts showing cumulative PnL | Medium |
| Trade list view | Individual trade entries with entry/exit prices and bars held | Medium |
| Export to CSV | Download results table as CSV for external analysis | Medium |
| Side-by-side compare | Compare two results visually (different symbols or time ranges) | Low |
| Auto-update datasets | Cron job to keep datasets fresh automatically | Low |
| Custom champion config | Allow tweaking champion params before testing (what-if analysis) | Low |
| Docker deployment | Containerize for remote/cloud deployment | Low |

---

## 17. Acceptance Criteria

Phase 1 is complete when:

1. ☐ `npm run dev` starts both API and frontend without errors
2. ☐ User can fetch a 10k-bar dataset for any valid Binance symbol
3. ☐ User can incrementally update an existing dataset (only new bars fetched)
4. ☐ User can run the champion strategy against a dataset with configurable slice
5. ☐ Test results display score, ROI%, win rate%, PF, max DD%, trade count
6. ☐ Results persist to disk and appear in the Results History tab
7. ☐ Results table is sortable by any metric column
8. ☐ No files in `pine/autoresearch/` are modified during any operation
9. ☐ No orphaned temp files remain after test completion (success or failure)
10. ☐ Autoresearch scheduler continues to run normally with champion-tester active
11. ☐ All backend unit tests pass
12. ☐ Manual smoke test checklist passes
