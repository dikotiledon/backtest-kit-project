# Champion Tester — Phase 2 Implementation Plan

**Date:** 2026-05-17
**Prerequisite:** Phase 1 complete (all 17 tasks done)
**Project:** `D:\Code\Experiment\backtest-kit-project\scripts\champion-tester`

---

## Priority Order

| # | Feature | Priority | Tasks |
|---|---------|----------|-------|
| 1 | Multi-symbol sweep | High | 1-3 |
| 2 | WebSocket progress | High | 4-6 |
| 3 | Equity curve chart | Medium | 7-8 |
| 4 | Trade list view | Medium | 9-10 |
| 5 | Export to CSV | Medium | 11 |
| 6 | Side-by-side compare | Low | 12-13 |

Total: 13 tasks

---

## Task 1: Sweep Engine (Backend)

**File:** `lib/sweep-runner.mjs` (new)

**Description:** Run champion against multiple datasets sequentially with progress reporting.

**Interface:**
```javascript
export async function runSweep({ matrixId, datasets, onProgress, timeoutMs = 120_000 }) {
  // datasets: array of { symbol, exchange, timeframe, filePath }
  // onProgress: callback({ completed, total, current, result })
  // Returns: { results: [], summary: { totalTime, avgScore, bestSymbol, worstSymbol } }
}
```

**Logic:**
1. Validate all datasets exist before starting
2. Iterate sequentially (reuse existing single-run mutex per execution)
3. Call `runChampionTest` for each dataset
4. Emit progress after each completion
5. On individual failure: record error, continue to next (don't abort sweep)
6. Build summary at end: avg/min/max for each metric, best/worst symbols

**Mutex:** Sweep acquires a sweep-level lock (separate from single-run). If single run in progress, wait or reject. If sweep in progress, reject new sweep AND single runs.

---

## Task 2: Sweep API Endpoint

**File:** `server.mjs` (modify)

**New endpoints:**
- `POST /api/sweep/run` — Start sweep (body: `{ matrixId, symbols: [{symbol, timeframe}], options }`)
- `GET /api/sweep/status` — Current sweep progress
- `POST /api/sweep/cancel` — Cancel running sweep

**Response for /api/sweep/run:**
```json
{
  "ok": true,
  "sweepId": "sweep-uuid",
  "total": 5,
  "message": "Sweep started"
}
```

**Status response:**
```json
{
  "ok": true,
  "running": true,
  "sweepId": "sweep-uuid",
  "completed": 3,
  "total": 5,
  "current": { "symbol": "BINANCE:ETHUSDT", "timeframe": "15m" },
  "results": [ /* completed results so far */ ]
}
```

---

## Task 3: Sweep UI Panel

**File:** `web/src/components/SweepPanel.jsx` (new)

**UI:**
- "Run Sweep" section: select champion, multi-select datasets (checkboxes on dataset table), start button
- Progress bar: X/N completed, current symbol shown
- Results grid: same MetricsCard pattern but for sweep summary (avg score, best/worst, total time)
- Individual results table below (reuse ResultsTable pattern)
- Cancel button during sweep

**Also modify:** `web/src/App.jsx` — add "Sweep" tab (4th tab)

---

## Task 4: WebSocket Server Setup

**File:** `server.mjs` (modify)

**Description:** Add WebSocket support for real-time progress.

**Implementation:**
- Install `ws` package: add to package.json dependencies
- Create WebSocket server on same HTTP server
- Broadcast events: `test:start`, `test:progress`, `test:complete`, `test:error`, `sweep:progress`, `sweep:complete`
- Clients connect to `ws://localhost:3847/ws`

**Event format:**
```json
{
  "type": "test:progress",
  "data": { "symbol": "BTCUSDT", "phase": "executing", "elapsedMs": 5000 }
}
```

---

## Task 5: WebSocket Client Hook

**File:** `web/src/hooks/useWebSocket.js` (new)

**Interface:**
```javascript
export function useWebSocket() {
  // Returns: { connected, lastEvent, subscribe(type, handler) }
  // Auto-reconnect on disconnect
  // Parse JSON events
}
```

---

## Task 6: Wire WebSocket into TestRunner & SweepPanel

**Files:** Modify `TestRunner.jsx` and `SweepPanel.jsx`

- Show real-time phase during test execution (materializing → executing → analyzing → cleanup)
- Show elapsed time updating live
- Sweep: update progress bar in real-time without polling

---

## Task 7: Trade Data Persistence

**File:** `lib/strategy-runner.mjs` (modify)

**Description:** Preserve individual trade data from JSONL output alongside metrics.

Currently the runner analyzes JSONL and extracts summary metrics. Extend to also capture:
- Array of individual trades: `{ entryTime, exitTime, side, entryPrice, exitPrice, pnl, barsHeld }`
- Cumulative equity curve data points: `{ timestamp, equity }`

Store in result object under `result.trades` and `result.equityCurve`.

---

## Task 8: Equity Curve Chart Component

**File:** `web/src/components/EquityChart.jsx` (new)

**Dependencies:** Add `lightweight-charts` (TradingView) to package.json devDependencies

**UI:**
- Renders when viewing a specific result (click row in ResultsTable)
- Line chart showing cumulative PnL over time
- Dark theme matching app
- Hover tooltip with equity value + timestamp
- Baseline at 0 (green above, red below)

---

## Task 9: Trade List Data (Backend already done in Task 7)

No additional backend work — trades already persisted in Task 7.

---

## Task 10: Trade List Component

**File:** `web/src/components/TradeList.jsx` (new)

**UI:**
- Table: Entry Time, Exit Time, Side (Long/Short), Entry Price, Exit Price, PnL, Bars Held
- Color-coded PnL (green positive, red negative)
- Summary row at bottom: total trades, avg PnL, avg bars held, long/short ratio
- Sortable by any column

---

## Task 11: Export to CSV

**Files:**
- `web/src/utils/exportCsv.js` (new utility)
- Modify `ResultsTable.jsx` — add "Export CSV" button

**Logic:**
- Convert results array to CSV string (headers + rows)
- Trigger browser download via Blob + URL.createObjectURL
- Filename: `champion-tester-results-{date}.csv`
- Columns: Symbol, Timeframe, Net Profit, ROI%, Win Rate, Trades, PF, Max DD, Duration, Date

---

## Task 12: Result Detail View

**File:** `web/src/components/ResultDetail.jsx` (new)

**UI:**
- Shown when clicking a result row (modal or slide-out panel)
- Top: MetricsCard grid (existing pattern)
- Middle: EquityChart
- Bottom: TradeList
- Close button to return to table

---

## Task 13: Side-by-Side Compare

**File:** `web/src/components/CompareView.jsx` (new)

**UI:**
- Select two results from dropdown
- Split layout: left result vs right result
- Each side shows: metrics cards + equity chart
- Difference row: highlight which is better for each metric
- Useful for comparing same strategy on different symbols or time ranges

---

## Execution Notes

- Tasks 1-3 (sweep) are self-contained and can be done first
- Tasks 4-6 (WebSocket) are self-contained
- Tasks 7-10 (equity + trades) depend on each other sequentially
- Task 11 (CSV export) is independent
- Tasks 12-13 (detail view + compare) depend on Tasks 7-10

**Suggested execution order:** 1→2→3→4→5→6→7→8→10→11→12→13

---

## Dependencies to Install

```bash
npm install ws lightweight-charts
```

Add to package.json:
- `ws` in dependencies (server-side WebSocket)
- `lightweight-charts` in devDependencies (client-side charting)
