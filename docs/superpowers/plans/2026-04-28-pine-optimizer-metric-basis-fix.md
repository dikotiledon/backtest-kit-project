# Pine Optimizer Metric Basis Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Pine optimizer trade metrics so win/loss counts, win rate, profit factor, drawdown, and score all derive from the same exact return basis instead of rounded raw price deltas.

**Architecture:** Keep per-trade exact values (`rawPnlExact`, `returnPctExact`) alongside rounded display fields, then compute ranking/reporting metrics from exact percentage returns while preserving raw price-unit totals as diagnostics only. Preserve the existing score formula shape for this patch, but feed it corrected metrics and expose a breakdown helper so future ranking anomalies are auditable.

**Tech Stack:** Node.js ESM, `node:test`, existing `scripts/lib/pine-optimizer.mjs`, Pine autoresearch report pipeline

---

## File map

- Modify: `scripts/lib/pine-optimizer.mjs`
  - Add exact-value helpers for trades
  - Recompute metrics from exact return basis
  - Preserve rounded display fields without using them for classification
  - Add score breakdown helper used by `scoreMetrics`
- Create: `tests/pine-optimizer.test.mjs`
  - Regression tests for low-price rounding bug
  - Asset-scale invariance tests
  - Score breakdown test with corrected PF path
- Modify: `docs/2026-04-21-pine-autoresearch-cron.md`
  - Document metric basis so report readers know which fields are ranking inputs vs diagnostics

---

### Task 1: Lock the bug in with failing optimizer tests

**Files:**
- Create: `tests/pine-optimizer.test.mjs`
- Modify: none
- Test: `tests/pine-optimizer.test.mjs`

- [ ] **Step 1: Write the failing regression tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics, scoreMetricsBreakdown } from '../scripts/lib/pine-optimizer.mjs';

test('calculateMetrics counts low-price rounded losses from exact return values', () => {
  const trades = [
    { pnl: 0, returnPct: -0.2, rawPnlExact: -0.004, returnPctExact: -0.2 },
    { pnl: 0, returnPct: -0.15, rawPnlExact: -0.003, returnPctExact: -0.15 },
    { pnl: 0.03, returnPct: 1.5, rawPnlExact: 0.03, returnPctExact: 1.5 },
  ];

  const metrics = calculateMetrics(trades);

  assert.equal(metrics.winCount, 1);
  assert.equal(metrics.lossCount, 2);
  assert.equal(metrics.flatCount, 0);
  assert.equal(metrics.winRatePct, 33.33);
  assert.equal(metrics.roiPct, 1.15);
  assert.equal(metrics.avgWin, 1.5);
  assert.equal(metrics.avgLoss, 0.18);
  assert.equal(metrics.profitFactor, 4.29);
  assert.equal(metrics.maxDrawdownPct, 0.35);
  assert.equal(metrics.totalProfit, 0.03);
  assert.equal(metrics.totalLossAbs, 0.01);
  assert.equal(metrics.totalProfitPct, 1.5);
  assert.equal(metrics.totalLossAbsPct, 0.35);
  assert.equal(metrics.metricBasis.profitFactor, 'returnPctExact');
});

test('calculateMetrics is invariant to asset price scale when return stream matches', () => {
  const xrpTrades = [
    { pnl: 0, returnPct: 1.2, rawPnlExact: 0.0048, returnPctExact: 1.2 },
    { pnl: 0, returnPct: -0.3, rawPnlExact: -0.0012, returnPctExact: -0.3 },
    { pnl: 0.01, returnPct: 0.5, rawPnlExact: 0.002, returnPctExact: 0.5 },
  ];
  const btcTrades = [
    { pnl: 120, returnPct: 1.2, rawPnlExact: 120, returnPctExact: 1.2 },
    { pnl: -30, returnPct: -0.3, rawPnlExact: -30, returnPctExact: -0.3 },
    { pnl: 50, returnPct: 0.5, rawPnlExact: 50, returnPctExact: 0.5 },
  ];

  const xrp = calculateMetrics(xrpTrades);
  const btc = calculateMetrics(btcTrades);

  assert.deepEqual(
    {
      winCount: xrp.winCount,
      lossCount: xrp.lossCount,
      flatCount: xrp.flatCount,
      winRatePct: xrp.winRatePct,
      roiPct: xrp.roiPct,
      avgWin: xrp.avgWin,
      avgLoss: xrp.avgLoss,
      profitFactor: xrp.profitFactor,
      maxDrawdownPct: xrp.maxDrawdownPct,
    },
    {
      winCount: btc.winCount,
      lossCount: btc.lossCount,
      flatCount: btc.flatCount,
      winRatePct: btc.winRatePct,
      roiPct: btc.roiPct,
      avgWin: btc.avgWin,
      avgLoss: btc.avgLoss,
      profitFactor: btc.profitFactor,
      maxDrawdownPct: btc.maxDrawdownPct,
    },
  );
});

test('scoreMetricsBreakdown exposes corrected PF contribution for the XRP regression case', () => {
  const breakdown = scoreMetricsBreakdown({
    tradeCount: 249,
    roiPct: 82.91,
    winRatePct: 35.34,
    profitFactor: 5.03,
    maxDrawdownPct: 1.43,
  }, { minTrades: 150 });

  assert.deepEqual(breakdown, {
    roi: 82.91,
    winRate: 28.27,
    profitFactor: 40.24,
    drawdown: -0.86,
    tradePenalty: 0,
    total: 150.56,
  });
});
```

- [ ] **Step 2: Run the new test file and verify it fails on current code**

Run:
```bash
node --test tests/pine-optimizer.test.mjs
```

Expected: FAIL because current code does not export `scoreMetricsBreakdown`, does not return `flatCount` / `totalProfitPct` / `totalLossAbsPct` / `metricBasis`, and still classifies wins/losses from rounded `pnl`.

- [ ] **Step 3: Commit only the failing characterization tests**

```bash
git add tests/pine-optimizer.test.mjs
git commit -m "test: capture pine optimizer metric basis regressions"
```

---

### Task 2: Preserve exact trade values without breaking existing report display fields

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs`
- Create: none
- Test: `tests/pine-optimizer.test.mjs`

- [ ] **Step 1: Add exact-value fields in `buildTrade` and helper accessors for exact metrics**

Replace the current `buildTrade` body and add exact-value helpers near `round(...)`:

```js
function exactRawPnl(trade) {
  if (Number.isFinite(trade?.rawPnlExact)) return trade.rawPnlExact;
  if (Number.isFinite(trade?.pnl)) return trade.pnl;
  return 0;
}

function exactReturnPct(trade) {
  if (Number.isFinite(trade?.returnPctExact)) return trade.returnPctExact;
  if (Number.isFinite(trade?.returnPct)) return trade.returnPct;
  return 0;
}

function buildTrade(position, exitRow, exitReason, exitPrice, exitIndex) {
  const rawPnlExact = position.side === 'long'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const returnPctExact = position.entryPrice === 0 ? 0 : (rawPnlExact / position.entryPrice) * 100;

  return {
    side: position.side,
    entryIndex: position.entryIndex,
    exitIndex,
    entryTime: position.entryTime,
    exitTime: exitRow.timestamp,
    entryPrice: position.entryPrice,
    exitPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    holdBars: exitIndex - position.entryIndex,
    maxBars: position.maxBars,
    exitReason,
    rawPnlExact,
    returnPctExact,
    pnl: round(rawPnlExact),
    returnPct: round(returnPctExact),
  };
}
```

- [ ] **Step 2: Export an exact-value-safe score breakdown function scaffold before changing metric math**

Add this directly above `scoreMetrics(...)` so tests can import it later:

```js
export function scoreMetricsBreakdown(metrics, options = {}) {
  const minTrades = options.minTrades ?? 10;
  const weights = {
    roi: options.roiWeight ?? 1.0,
    winRate: options.winRateWeight ?? 0.8,
    profitFactor: options.profitFactorWeight ?? 8,
    drawdown: options.drawdownWeight ?? 0.6,
  };

  const profitFactor = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 10;
  const tradePenalty = metrics.tradeCount < minTrades
    ? (minTrades - metrics.tradeCount) * 5
    : 0;

  const breakdown = {
    roi: round(metrics.roiPct * weights.roi),
    winRate: round(metrics.winRatePct * weights.winRate),
    profitFactor: round(profitFactor * weights.profitFactor),
    drawdown: round(-metrics.maxDrawdownPct * weights.drawdown),
    tradePenalty: round(-tradePenalty),
  };

  return {
    ...breakdown,
    total: round(breakdown.roi + breakdown.winRate + breakdown.profitFactor + breakdown.drawdown + breakdown.tradePenalty),
  };
}
```

- [ ] **Step 3: Run the optimizer tests again to confirm they still fail only on metric logic**

Run:
```bash
node --test tests/pine-optimizer.test.mjs
```

Expected: FAIL, but now the missing-export failure is gone and remaining failures point at wrong win/loss classification and metric fields.

- [ ] **Step 4: Commit the exact-value scaffolding**

```bash
git add scripts/lib/pine-optimizer.mjs
git commit -m "refactor: preserve exact pine trade values for metric calculations"
```

---

### Task 3: Recompute optimizer metrics from exact percentage returns and keep raw totals diagnostic-only

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs`
- Create: none
- Test: `tests/pine-optimizer.test.mjs`

- [ ] **Step 1: Replace `calculateMetrics(trades)` with a basis-consistent implementation**

Replace the full function with:

```js
export function calculateMetrics(trades) {
  const tradeCount = trades.length;
  const winTrades = trades.filter((trade) => exactReturnPct(trade) > 0);
  const lossTrades = trades.filter((trade) => exactReturnPct(trade) < 0);
  const flatTrades = trades.filter((trade) => exactReturnPct(trade) === 0);

  const totalProfitPct = winTrades.reduce((sum, trade) => sum + exactReturnPct(trade), 0);
  const totalLossPctAbs = Math.abs(lossTrades.reduce((sum, trade) => sum + exactReturnPct(trade), 0));
  const roiPctRaw = trades.reduce((sum, trade) => sum + exactReturnPct(trade), 0);

  const totalProfitRaw = winTrades.reduce((sum, trade) => sum + Math.max(exactRawPnl(trade), 0), 0);
  const totalLossRawAbs = Math.abs(lossTrades.reduce((sum, trade) => sum + Math.min(exactRawPnl(trade), 0), 0));

  let cumulativePct = 0;
  let peakPct = 0;
  let maxDrawdownPct = 0;
  for (const trade of trades) {
    cumulativePct += exactReturnPct(trade);
    if (cumulativePct > peakPct) peakPct = cumulativePct;
    const drawdownPct = peakPct - cumulativePct;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }

  const avgReturnPct = tradeCount ? roiPctRaw / tradeCount : 0;
  const avgPnl = tradeCount ? (totalProfitRaw - totalLossRawAbs) / tradeCount : 0;
  const avgWin = winTrades.length ? totalProfitPct / winTrades.length : 0;
  const avgLoss = lossTrades.length ? totalLossPctAbs / lossTrades.length : 0;
  const profitFactor = totalLossPctAbs === 0
    ? (totalProfitPct > 0 ? Number.POSITIVE_INFINITY : 0)
    : totalProfitPct / totalLossPctAbs;

  return {
    tradeCount,
    winCount: winTrades.length,
    lossCount: lossTrades.length,
    flatCount: flatTrades.length,
    winRatePct: round(tradeCount ? (winTrades.length / tradeCount) * 100 : 0),
    roiPct: round(roiPctRaw),
    avgReturnPct: round(avgReturnPct),
    avgPnl: round(avgPnl),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    totalPnl: round(totalProfitRaw - totalLossRawAbs),
    totalProfit: round(totalProfitRaw),
    totalLossAbs: round(totalLossRawAbs),
    totalProfitPct: round(totalProfitPct),
    totalLossAbsPct: round(totalLossPctAbs),
    profitFactor: Number.isFinite(profitFactor) ? round(profitFactor) : profitFactor,
    maxDrawdownPct: round(maxDrawdownPct),
    metricBasis: {
      classification: 'returnPctExact',
      roi: 'returnPctExact',
      avgWinLoss: 'returnPctExact',
      profitFactor: 'returnPctExact',
      drawdown: 'returnPctExact',
      rawTotals: 'rawPnlExact',
    },
  };
}
```

- [ ] **Step 2: Switch `scoreMetrics(...)` to delegate to the breakdown helper**

Replace the current function body with:

```js
export function scoreMetrics(metrics, options = {}) {
  return scoreMetricsBreakdown(metrics, options).total;
}
```

- [ ] **Step 3: Run the optimizer tests and make them pass**

Run:
```bash
node --test tests/pine-optimizer.test.mjs
```

Expected: PASS with `3` tests passing.

- [ ] **Step 4: Commit the metric basis fix**

```bash
git add scripts/lib/pine-optimizer.mjs tests/pine-optimizer.test.mjs
git commit -m "fix: normalize pine optimizer metrics to exact return basis"
```

---

### Task 4: Prove autoresearch still works with corrected metrics and add one integration guard

**Files:**
- Modify: `tests/pine-autoresearch.test.mjs`
- Modify: `scripts/lib/pine-optimizer.mjs` (only if tiny compatibility shim is needed after test failure)
- Test: `tests/pine-optimizer.test.mjs`, `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add one integration test that shows autoresearch decision logic accepts the expanded metric object**

Append this test near other autoresearch metric-gate tests:

```js
test('decideAutoresearchOutcome accepts return-basis optimizer metrics with raw diagnostic totals', () => {
  const incumbent = {
    configId: 'incumbent',
    score: 147.89,
    config: { minPredSum: 2 },
    metrics: {
      tradeCount: 245,
      winCount: 105,
      lossCount: 139,
      flatCount: 1,
      roiPct: 86.54,
      avgWin: 1.14,
      avgLoss: 0.24,
      profitFactor: 3.58,
      maxDrawdownPct: 2.64,
      totalProfit: 1.78,
      totalLossAbs: 0.29,
      totalProfitPct: 120.03,
      totalLossAbsPct: 33.49,
      metricBasis: {
        classification: 'returnPctExact',
        profitFactor: 'returnPctExact',
      },
    },
  };

  const challenger = {
    configId: 'challenger',
    score: 150.56,
    config: { minPredSum: 2, useSqueezeContext: true },
    metrics: {
      tradeCount: 249,
      winCount: 88,
      lossCount: 160,
      flatCount: 1,
      roiPct: 82.91,
      avgWin: 1.18,
      avgLoss: 0.13,
      profitFactor: 5.03,
      maxDrawdownPct: 1.43,
      totalProfit: 1.49,
      totalLossAbs: 0.04,
      totalProfitPct: 103.5,
      totalLossAbsPct: 20.59,
      metricBasis: {
        classification: 'returnPctExact',
        profitFactor: 'returnPctExact',
      },
    },
  };

  const result = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0.25,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.match(result.failedGates.join(','), /roi/);
});
```

- [ ] **Step 2: Run the focused suite**

Run:
```bash
node --test tests/pine-optimizer.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS. `tests/pine-optimizer.test.mjs` should stay green, and `tests/pine-autoresearch.test.mjs` should continue passing with the richer metric object.

- [ ] **Step 3: Commit the autoresearch compatibility guard**

```bash
git add tests/pine-autoresearch.test.mjs
git commit -m "test: guard autoresearch against pine optimizer metric regressions"
```

---

### Task 5: Document the metric basis and re-run the real XRP regression artifact

**Files:**
- Modify: `docs/2026-04-21-pine-autoresearch-cron.md`
- Create: none
- Test: real artifact verification command

- [ ] **Step 1: Add a short “Metric basis” note to the autoresearch doc**

Append this section near the reporting/manifest explanation:

```md
## Metric basis

Autoresearch ranking metrics now use exact per-trade percentage returns as the canonical basis for:
- `winCount` / `lossCount` / `flatCount`
- `winRatePct`
- `roiPct`
- `avgWin` / `avgLoss`
- `profitFactor`
- `maxDrawdownPct`
- `score`

Raw price-unit totals (`avgPnl`, `totalPnl`, `totalProfit`, `totalLossAbs`) remain in the metric payload as diagnostics only and are not used for candidate ranking.
```

- [ ] **Step 2: Re-run the real XRP primary-lab artifact and print corrected metrics**

Run:
```bash
node --input-type=module -e "import { pathToFileURL } from 'node:url'; const { analyzeJsonlFile, scoreMetricsBreakdown } = await import(pathToFileURL('./scripts/lib/pine-optimizer.mjs').href); const base = './pine/autoresearch/pine-fusion-v4-core-15m-locked-window/evaluations/pine-fusion-v4-core-15m-locked-window-2026-04-28T04-22-49-011Z/xrpusdt-15m-primary/dump'; for (const side of ['champion', 'challenger']) { const result = await analyzeJsonlFile(`${base}/${side}-xrpusdt-15m-primary.cleaned.jsonl`, { minTrades: 150 }); console.log(side, JSON.stringify({ metrics: result.metrics, scoreBreakdown: scoreMetricsBreakdown(result.metrics, { minTrades: 150 }), score: result.score }, null, 2)); }"
```

Expected:
- challenger `profitFactor` should be near `5.03`, not `37.25`
- challenger score should be near `150.56`, not `399.65`
- champion/challenger `winCount` and `lossCount` should no longer ignore tiny XRP losses

- [ ] **Step 3: Run the final verification set**

Run:
```bash
node --test tests/pine-optimizer.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit docs + final verification state**

```bash
git add docs/2026-04-21-pine-autoresearch-cron.md scripts/lib/pine-optimizer.mjs tests/pine-optimizer.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "docs: clarify pine autoresearch metric basis"
```

---

## Self-review

- Spec coverage: plan covers the exact bug source (rounded raw `pnl`), the affected metric layer (`calculateMetrics`), the score layer (`scoreMetrics`), autoresearch integration, and real-artifact re-verification.
- Placeholder scan: no TBD/TODO placeholders remain; each task includes exact files, code, and commands.
- Type consistency: exact fields are named `rawPnlExact` / `returnPctExact`; derived metrics use `flatCount`, `totalProfitPct`, `totalLossAbsPct`, and `metricBasis` consistently across tests and implementation.

Plan complete and saved to `docs/superpowers/plans/2026-04-28-pine-optimizer-metric-basis-fix.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
