# Pine Autoresearch — Deep Audit Report

**Date:** 2026-05-20
**Auditor:** Dikotiledon
**Scope:** `scripts/pine-autoresearch.mjs`, `scripts/lib/pine-autoresearch.mjs`, `scripts/lib/pine-metric-core.mjs`, `scripts/lib/pine-search-policy.mjs`, research artifacts in `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/`

---

## Executive Summary

The autoresearch system has run **380 history events** (360 cycles, 18 promotions) with the last auto-promotion on **2026-05-04** — 16 days of stagnation. The current champion (`squeeze-collapse-god-tier`, score 157.41) was manually promoted on 2026-05-18. The system generates only 3 variants per hourly cycle, of which 66% produce zero trades. Multiple fundamental logic flaws, design issues, and broken implementations prevent meaningful progress.

---

## Current Champion State

| Metric | Value |
|--------|-------|
| Config ID | squeeze-collapse-god-tier |
| Score | 157.41 |
| ROI % | 94.7 |
| Trade Count | 261 |
| Win Rate % | 43.68 |
| Profit Factor | 3.68 |
| Max Drawdown % | 2.88 |
| Avg Win | 1.15 |
| Avg Loss | 0.24 |
| Promoted At | 2026-05-18T00:57:02.498Z |
| Mode | manual-promotion |

---

## Table of Contents

1. [Critical Flaws](#critical-flaws)
2. [Logic Flaws](#logic-flaws)
3. [Design Issues](#design-issues)
4. [Research Results Analysis](#research-results-analysis)
5. [Summary Table](#summary-table)
6. [Recommendations](#recommendations)

---


## Critical Flaws

### CRIT-1: Non-Compounded ROI Calculation

**File:** `scripts/lib/pine-metric-core.mjs` — `calculateMetrics()`

**Code:**
```js
const roiPctRaw = trades.reduce((sum, trade) => sum + exactReturnPct(trade), 0);
```

**Problem:**
ROI is computed as a simple arithmetic sum of per-trade return percentages. This treats every trade as if it operates on the original capital base, ignoring compounding entirely.

A strategy doing 245 trades at 0.37% average per trade gets credited with 91.23% ROI. In reality:
- Compounded: (1.0037)^245 - 1 = 147.8% (higher)
- The arithmetic sum neither matches compounded returns nor real equity growth
- More critically: it creates a **linear bias toward trade count** — more trades = higher ROI sum regardless of trade quality

**Evidence:**
The `calculateCompoundedMetrics` function exists in the same file but is **never called** in the scoring pipeline (`scoreMetrics` uses `calculateMetrics` output exclusively).

**Impact:** HIGH
- The optimization target is mathematically inconsistent with real trading outcomes
- Configs with more frequent, smaller trades are systematically over-scored vs configs with fewer, larger trades
- Score comparison between configs with different trade counts is unreliable

**Mitigation:** Not catastrophic for *relative* comparison within the same dataset (all configs use the same formula), but gives a false picture of actual performance and creates subtle bias.

---


### CRIT-2: Arithmetic Drawdown Calculation (Not Equity-Based)

**File:** `scripts/lib/pine-metric-core.mjs` — `calculateMetrics()`

**Code:**
```js
let cumulativePct = 0;
let peakPct = 0;
let maxDrawdownPct = 0;
for (const trade of trades) {
  cumulativePct += exactReturnPct(trade);
  if (cumulativePct > peakPct) peakPct = cumulativePct;
  const drawdownPct = peakPct - cumulativePct;
  if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
}
```

**Problem:**
Drawdown is computed as peak-to-trough on an arithmetic cumulative sum of return percentages, NOT on an actual equity curve. This systematically **underestimates** real drawdown because:

1. It ignores compounding effects during drawdown periods
2. A 10% drawdown on a compounded equity curve represents more capital loss than 10% subtracted from a linear sum
3. After a large gain, the "peak" in arithmetic terms is lower than the compounded peak, so subsequent drawdowns appear smaller

**Numerical Example:**
- Trade sequence: +5%, +5%, -8%, -3%
- Arithmetic: peak = 10%, trough = -1%, DD = 11%
- Compounded: peak = 1.1025, trough = 1.1025 * 0.92 * 0.97 = 0.9836, DD = 10.78%
- In this case similar, but diverges significantly over longer sequences

**Impact:** HIGH
- Champion DD of 2.88% is likely understated by 0.5-2% depending on trade sequencing
- Risk assessment is systematically optimistic
- The drawdown weight in the score formula (0.6) already under-penalizes DD; understating the DD value compounds this problem
- Live trading will experience worse drawdowns than backtested

**Connection to CRIT-1:** Both ROI and DD use the same flawed arithmetic-sum approach. The `calculateCompoundedMetrics` function computes both correctly but is unused.

---


### CRIT-3: Floating-Point Pollution in Config Fingerprints

**File:** `scripts/lib/pine-search-policy.mjs` — `scalePatch()`, `signalPatches()`, `riskPatches()`

**Evidence from manifest data:**
```json
"regimeThreshold": 0.30000000000000004
```

**Problem:**
Config parameter values are computed via raw floating-point arithmetic without consistent rounding. When these values are serialized into config fingerprints (via `JSON.stringify` of sorted keys), IEEE 754 precision artifacts create distinct fingerprints for logically identical configs.

**Root Cause Chain:**
1. `scalePatch()` multiplies base values by temperature/scale factors using raw arithmetic
2. Some patches use `toFixed()` (e.g., `Number((baseMinPred - 0.5 * scale).toFixed(2))`) but others don't
3. The `regimeThreshold` parameter is computed as `0.5 - 0.2` or similar, yielding `0.30000000000000004`
4. `configFingerprint()` calls `JSON.stringify(stableValue(config))` which preserves the raw float
5. The configId string embeds the raw value: `regimeThreshold-0.30000000000000004`

**Consequences:**
1. **Tabu deduplication fails** — a config with `regimeThreshold: 0.3` and one with `0.30000000000000004` are treated as different configs in the tabu set
2. **Wasted cycles** — the system re-tests configs it has already tested under a slightly different fingerprint
3. **configId strings become absurdly long** — the full configId for a single variant is 500+ characters
4. **Blocked challenger queue pollution** — entries that should deduplicate don't

**Affected Functions:**
- `scalePatch()` — line 104 in pine-search-policy.mjs
- `buildDiversePatch()` — line 141
- Any track generator that computes threshold values arithmetically

**Fix:** Round all numeric parameter values to a fixed precision (6 decimal places) before fingerprinting:
```js
function roundParam(value) {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}
```

---


### CRIT-4: 66% of Variants Are Zero-Trade Dead Ends

**File:** `scripts/lib/pine-track-generators.mjs` (asymmetry-regime track family)

**Evidence from latest manifest (2026-05-19T23:00):**
- Batch size: 3 variants
- Variant 0001 (asymmetry-01): `useRegimeFilter: false`, `adxThreshold: 21` → 245 trades, score 155.83
- Variant 0002 (asymmetry-02): `useRegimeFilter: true`, `regimeThreshold: -0.5` → **0 trades**, score -50
- Variant 0003 (asymmetry-03): `useRegimeFilter: true`, `regimeThreshold: 0.30000000000000004` → **0 trades**, score -50

**Problem:**
The `asymmetry-regime` track family generates variants that toggle `useRegimeFilter` from `false` (champion's value) to `true` with arbitrary threshold values. Since the champion was specifically optimized WITHOUT the regime filter, enabling it with untested thresholds predictably kills all trade signals.

**Why This Is Stupid:**
1. The champion has `useRegimeFilter: false` — the regime filter is KNOWN to be counterproductive for this config
2. Trying `regimeThreshold: -0.5` is nonsensical — a negative threshold means the regime indicator must be below -0.5, which may never occur
3. The system generates these dead variants EVERY CYCLE, burning 66% of its already tiny 3-variant budget
4. With hourly cycles, this wastes ~16 compute-hours per day testing configs that will never produce trades

**Root Cause:**
The track generator does not validate that toggling a boolean filter `false → true` is likely to produce viable trading activity. There is no "minimum viability pre-check" before committing a variant to the expensive full-sweep pipeline.

**Impact:** HIGH — Search efficiency is destroyed. At 1 useful variant per hour, finding improvements in a 40+ dimensional parameter space is nearly impossible.

**Fix Options:**
1. Never toggle `useRegimeFilter: false → true` when the champion explicitly disabled it
2. Add a fast pre-check (run 100 bars) to verify a variant produces ≥1 trade before committing to full sweep
3. Increase `maxConfigs` to compensate, or deprioritize the `asymmetry-regime` track when it repeatedly produces zero-trade configs

---


### CRIT-5: Stagnation Not Converging After 16 Days

**File:** `scripts/pine-autoresearch.mjs` — convergence detection block (~line 3580)

**Evidence:**
- Last auto-promotion: 2026-05-04 (16 days ago)
- Total cycles since: ~360
- Stagnation level: 1 (barely escalated)
- System still runs hourly, generating 3 variants (66% dead), finding nothing

**Problem:**
The convergence detection logic checks `noScoreImprovementStreak` from the scheduler state, but this counter appears to not increment correctly after the manual promotion on May 18. The manual promotion reset the scheduler state:

```js
if (loadedSchedulerState.lastChampionFingerprint !== schedulerChampionFingerprint) {
  loadedSchedulerState.tabuRejectedFingerprints = [];
  loadedSchedulerState.cycleIndex = 0;
  loadedSchedulerState.noChangeStreak = 0;
  loadedSchedulerState.noNewCandidateStreak = 0;
  loadedSchedulerState.stagnationLevel = 0;
  loadedSchedulerState.stagnationReason = null;
  loadedSchedulerState.laneExhaustions = {};
}
```

When the champion was manually promoted on May 18, all counters reset to zero. The system started fresh with the new champion but has only run ~34 cycles since (`schedulerCycleIndex: 34` in the latest manifest). So from the scheduler's perspective, it's only been 34 cycles — not enough to trigger convergence at `noScoreImprovementConvergeAfter: 6` IF the counter isn't tracking correctly.

**The Real Bug:**
The stagnation level is at 1, but cycle index is 34 with zero improvements. The `shouldDeclareConvergence` function likely checks `noScoreImprovementStreak` which may be incremented only when the best candidate is literally the same config as champion (steady-state), NOT when the best candidate fails promotion gates. A challenger that scores 155.83 vs champion's 157.41 is "different" — so the streak counter doesn't increment — but it still represents zero improvement.

**Impact:** HIGH — The system burns compute indefinitely without admitting the search space near the champion is exhausted. It should either:
1. Converge and stop
2. Escalate stagnation level to trigger wider exploration (higher temperature, different track families, multi-param mutations)

---


## Logic Flaws

### LOGIC-1: Pareto Dominance Includes tradeCount as Quality Metric

**File:** `scripts/lib/pine-autoresearch.mjs` — `dominates()`

**Code:**
```js
function dominates(left, right) {
  const betterOrEqual =
    (left.score ?? 0) >= (right.score ?? 0) &&
    (left.roiPct ?? 0) >= (right.roiPct ?? 0) &&
    (left.profitFactor ?? 0) >= (right.profitFactor ?? 0) &&
    (left.tradeCount ?? 0) >= (right.tradeCount ?? 0) &&
    (left.maxDrawdownPct ?? Infinity) <= (right.maxDrawdownPct ?? Infinity);

  const strictlyBetter =
    (left.score ?? 0) > (right.score ?? 0) ||
    (left.roiPct ?? 0) > (right.roiPct ?? 0) ||
    (left.profitFactor ?? 0) > (right.profitFactor ?? 0) ||
    (left.tradeCount ?? 0) > (right.tradeCount ?? 0) ||
    (left.maxDrawdownPct ?? Infinity) < (right.maxDrawdownPct ?? Infinity);

  return betterOrEqual && strictlyBetter;
}
```

**Problem:**
`tradeCount` is treated as a quality dimension in Pareto dominance. This means:
- A config with 260 trades dominates one with 245 trades (all else equal)
- A more selective strategy that filters out marginal trades gets eliminated from the Pareto frontier
- The system has an implicit bias toward "trade more" rather than "trade better"

**Why This Is Wrong:**
Trade count is an *activity* metric, not a *quality* metric. A strategy that takes 200 high-conviction trades with 50% win rate and 2:1 reward:risk is objectively better than one that takes 300 trades with 40% win rate and 1.5:1 reward:risk — but the Pareto filter would keep the latter.

The promotion gates already enforce `minTradeCount >= 100` and `minTradeRatioVsIncumbent >= 0.75`, so there's no need for trade count in the Pareto dominance check.

**Impact:** LOW-MEDIUM — Selective high-quality configs may be filtered from the Pareto shortlist before reaching matrix evaluation.

---


### LOGIC-2: profitFactor Infinity Cap Creates Perverse Incentive

**File:** `scripts/lib/pine-metric-core.mjs` — `scoreMetricsBreakdown()`

**Code:**
```js
const profitFactor = Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 10;
```

**Problem:**
When a config has zero losing trades, `profitFactor` = Infinity. The scoring function caps this at 10, which then contributes `10 * 8 = 80 points` to the score. This is the single largest possible PF contribution.

**Perverse Incentive Chain:**
1. A config that takes 11 trades (clearing the minTrades=10 penalty threshold) with zero losses gets PF=Infinity → capped at 10
2. Score contribution from PF alone: 80 points
3. Even with tiny ROI (say 5%), the total score would be: `5 + (100*0.8) + 80 + 0 = 165` — higher than the champion's 157.41
4. This config would top the Pareto shortlist

**Why the gates partially save this:**
The promotion gates require `minTradeCount >= 100`, so an 11-trade config can't actually promote. But it still:
- Occupies a slot in the Pareto shortlist (limit 4)
- Gets evaluated in the matrix (wasting compute)
- Displaces legitimate challengers from evaluation

**The deeper issue:**
Even with 100+ trades, a config could have PF=10 (capped from Infinity) if it happens to have zero losses in the test window. This is almost certainly overfitting — no real strategy has zero losses over 100+ trades. The cap should be lower (e.g., 5) or PF should be log-scaled.

**Impact:** LOW — The promotion gates catch the worst cases, but shortlist pollution wastes evaluation budget.

---

### LOGIC-3: Score Formula Weight Imbalance

**File:** `scripts/lib/pine-metric-core.mjs` — `scoreMetricsBreakdown()`

**Formula:**
```
score = roiPct * 1.0 + winRatePct * 0.8 + profitFactor * 8 + (-maxDrawdownPct * 0.6) + tradePenalty
```

**Breakdown for champion (score 157.41):**
| Component | Value | Weight | Contribution | % of Score |
|-----------|-------|--------|--------------|------------|
| ROI | 94.7% | 1.0 | 94.7 | 60.2% |
| Win Rate | 43.68% | 0.8 | 34.94 | 22.2% |
| Profit Factor | 3.68 | 8.0 | 29.44 | 18.7% |
| Drawdown | 2.88% | -0.6 | -1.73 | -1.1% |
| Trade Penalty | 0 | — | 0 | 0% |
| **Total** | | | **157.35** | |

**Problems:**

1. **Drawdown is nearly irrelevant** — A strategy with 10% DD only loses 6 points. A strategy with 20% DD loses 12 points. Meanwhile, the ROI from taking more trades (which increases DD) easily compensates. The formula actively rewards risk-taking.

2. **ROI dominates at 60%** — Combined with the non-compounded ROI bug (CRIT-1), this means the score is primarily "sum of per-trade returns" which is just "trade count × average return". The formula collapses to approximately rewarding `tradeCount * avgReturn + winRate * 0.8 + PF * 8`.

3. **Win rate is double-counted** — Win rate already influences profit factor (higher WR → higher PF for same avg win/loss). Including both means WR is effectively weighted twice.

4. **No expectancy component** — Expectancy (WR × avgWin - (1-WR) × avgLoss) is the single most important metric for a trading strategy. It's computed separately for the expectancy gate but NOT included in the score formula.

**Impact:** MEDIUM — The score formula optimizes for "high ROI + high win rate" rather than "best risk-adjusted edge". This explains why the champion has a mediocre 43.68% win rate but high ROI — the formula doesn't care about win rate quality, just quantity.

---


### LOGIC-4: Blocked Challenger Queue Hard Cap of 5

**File:** `scripts/pine-autoresearch.mjs` — blocked challenger storage (~line 3600)

**Code:**
```js
const deduped = [
  blockedEntry,
  ...existingQueue.filter(e => e.configFingerprint !== blockedEntry.configFingerprint)
].slice(0, 5);
```

**Problem:**
Only 5 blocked challengers are stored at any time. In a system that runs hourly cycles (380 events in history), this means:
- 98.7% of blocked challengers are permanently lost
- A config that fails `primaryPromote` by -1.58 points today cannot be retried tomorrow unless independently regenerated
- The queue uses FIFO eviction — older promising configs get pushed out by newer mediocre ones

**Why This Matters:**
The latest blocked challenger had:
- Score: 155.83 (only -1.58 vs champion's 157.41)
- PF: 3.82 (BETTER than champion's 3.68)
- DD: 2.03% (BETTER than champion's 2.88%)
- Trades: 245 (slightly fewer than champion's 261)

This config is arguably better risk-adjusted but scores slightly lower due to the ROI-heavy scoring formula. If market conditions shift slightly (different data window), it might pass. But after 5 more cycles, it's gone forever.

**The system already has re-queue logic:**
```js
shouldRequeueBlockedChallenger()
filterRequeueCandidates()
```
But with a cap of 5, these functions operate on a tiny pool that's constantly being evicted.

**Impact:** MEDIUM — Promising near-champion configs are permanently discarded. The search must rediscover them from scratch, which may never happen given the small batch sizes and tabu tracking.

---

### LOGIC-5: ROI Relaxation is Effectively Dead Code

**File:** `scripts/lib/pine-autoresearch.mjs` — `decideAutoresearchOutcome()`

**Code:**
```js
const standardRelaxed = roiRelaxationEnabled
  && comparisons.scoreDelta >= (roiRelaxation.minScoreDeltaToRelax ?? Infinity)
  && comparisons.roiDeltaPct >= -(roiRelaxation.maxRoiRegressionPct ?? 0);
```

**Problem:**
The default value for `minScoreDeltaToRelax` is `Infinity`. This means the condition `comparisons.scoreDelta >= Infinity` is ALWAYS false. ROI relaxation can never activate unless explicitly configured with a finite value.

**What ROI relaxation is supposed to do:**
Allow promotion of configs that have slightly worse ROI but compensate with better score (via better PF, DD, or other metrics). This is exactly the scenario with the current blocked challenger:
- ROI: -3.47% worse
- PF: +0.14 better
- DD: -0.85% better (lower is better)

If `minScoreDeltaToRelax` were set to e.g. 3.0, and the challenger's score delta exceeded that, the ROI regression would be forgiven.

**Connected Issue:**
The `skipProfitabilityFloor` flag is set when ROI relaxation is applied:
```js
const skipProfitabilityFloor = comparisons.roiRelaxationApplied === true;
```
Since relaxation never activates, this skip path is also dead code.

**Impact:** MEDIUM — Risk-efficient configs (better DD, better PF, slightly worse ROI) can NEVER promote through the automated path. The only way to promote them is manually, which is what happened with the current champion.

---


## Design Issues

### DESIGN-1: Primary Lab Has Absolute Veto Power

**File:** `scripts/pine-autoresearch.mjs` — `evaluateMatrix()` (~line 2960)

**Code:**
```js
const requiresPrimaryPromote = config.matrixPolicy?.requirePrimaryPromote !== false;
if (requiresPrimaryPromote && primaryResult.decision.recommendation !== 'promote') {
  const labResults = [primaryResult];
  const matrixDecision = decideMatrixPromotion({
    labResults,
    shadowsEvaluated: false,  // <-- shadows never even run
    policy: config.matrixPolicy,
    champion: championState,
    challenger: challengerSummary,
  });
  return { labResults, holdoutVerdict: null, matrixDecision, diagnosticShadowResults };
}
```

**Problem:**
When `requirePrimaryPromote: true` (the default), if the challenger fails on the primary lab, shadow labs are **never evaluated**. The matrix decision is made based on a single dataset.

**Why This Is Dangerous:**
1. The primary lab is `xrpusdt-15m-primary` — a single asset on a single timeframe
2. The champion was specifically optimized on this lab (it's the training set)
3. Any challenger that's slightly worse on XRP but significantly better on BTC+ETH gets permanently blocked
4. This creates **overfitting to the primary lab** — the system converges to the local optimum of one dataset

**Evidence from latest manifest:**
The shadow lab results showed:
- `xrpusdt-15m-march-shadow`: hold (scoreDelta: 2.07, roiDelta: -1.47)
- `btcusdt-15m-march-shadow`: **promote** (scoreDelta: 4.08, roiDelta: 0.15)
- `ethusdt-15m-feb-shadow`: hold (scoreDelta: -2.67, roiDelta: -2.11)

The challenger PASSED on BTC but was never given the chance because it failed on the primary XRP lab first.

**The diagnostic shadow evaluation exists but is toothless:**
```js
if (config.matrixPolicy?.diagnosticShadowEvaluation === true && labs.length > 1) {
  diagnosticShadowResults = await mapWithConcurrency(labs.slice(1), shadowConcurrency, evaluateLabPair);
}
```
This collects shadow data for diagnostics but never uses it for promotion decisions.

**Impact:** HIGH — The system is structurally incapable of finding cross-asset robust improvements that don't also happen to be the best on the primary lab. This is the definition of overfitting to training data.

---


### DESIGN-2: Search Only Mutates One Parameter at a Time

**File:** `scripts/lib/pine-search-policy.mjs` — `signalPatches()`, `riskPatches()`

**Code pattern:**
```js
// Each patch is a SINGLE parameter change
{ adxThreshold: baseAdx + 5 }
{ slAtrMult: baseSl + 0.25 }
{ tpAtrMult: baseTp + 0.5 }
{ trailAtrMult: baseTrail + 0.25 }
```

**Problem:**
The exploit lane generates variants by applying ONE parameter mutation at a time from the champion config. This is axis-aligned search — it explores along each dimension independently but never explores diagonals.

**Why This Fails:**
In a 40+ dimensional parameter space, the optimal configuration often lies along a diagonal. For example:
- Increasing TP (take profit) while simultaneously decreasing trail multiplier
- Increasing ADX threshold while decreasing minPredSum
- Changing SL and TP together to maintain a specific risk:reward ratio

These joint optima are unreachable in a single step with axis-aligned mutations. The search would need to:
1. First find that increasing TP alone is slightly worse (blocked)
2. Then find that decreasing trail alone is slightly worse (blocked)
3. Never discover that TP+trail together is better

**The `globalAllParameter` lane should fix this but it's broken:**
From the latest manifest:
```json
"generatorSummary": {
  "lane": "robustness",
  "candidateCount": 0,
  "previewOnly": true,
  "countSource": "none",
  "exhausted": false,
  "testedPatchFingerprintCount": 0,
  "maxNovelCandidates": 12,
  "variantIds": [],
  "patchFingerprints": []
}
```

The `globalAllParameter` lane is configured but producing zero candidates. The `robustness` lane was selected but also generated nothing (`candidateCount: 0`, `previewOnly: true`). This means the multi-parameter search capability exists in code but is not functioning.

**Impact:** MEDIUM — The search is trapped in a local optimum because it can only explore one dimension at a time. Combined with the small batch size (3 variants), this makes escaping the current champion's neighborhood nearly impossible.

---

### DESIGN-3: Promotion Thresholds Create an Asymmetric Trap

**File:** `scripts/lib/pine-autoresearch.mjs` — `decideAutoresearchOutcome()`

**Threshold defaults:**
```js
const minScoreDelta = thresholds.minScoreDelta ?? 0.25;
const minRoiDeltaPct = thresholds.minRoiDeltaPct ?? 0;
const minProfitFactorDelta = thresholds.minProfitFactorDelta ?? 0;
const maxDrawdownDeltaPct = thresholds.maxDrawdownDeltaPct ?? 0.75;
const minTradeCount = thresholds.minTradeCount ?? 100;
const minTradeRatioVsIncumbent = thresholds.minTradeRatioVsIncumbent ?? 0.75;
```

**The Trap:**
A challenger must be better on ALL of these simultaneously:
- Score delta ≥ 0.25 (must improve score)
- ROI delta ≥ 0 (must not regress ROI at all)
- PF delta ≥ 0 (must not regress profit factor)
- DD delta ≤ 0.75 (drawdown can only worsen by 0.75%)
- Trade count ≥ 100
- Trade ratio ≥ 0.75 of incumbent

**Why this is a trap:**
The champion was manually promoted as "god-tier" — it's already near-optimal on the primary lab. Finding a config that improves score, ROI, AND PF simultaneously while not worsening DD is statistically improbable when you're already at:
- ROI: 94.7%
- PF: 3.68
- DD: 2.88%

The thresholds create a "must be better at everything" requirement that becomes exponentially harder to satisfy as the champion improves. There's no mechanism for "trade-off promotion" — e.g., accepting 2% less ROI for 1% less drawdown.

**Combined with LOGIC-5 (dead ROI relaxation):** The system has no escape valve for legitimate trade-offs. It can only promote strict Pareto improvements, which become vanishingly rare near an optimum.

**Impact:** MEDIUM-HIGH — Explains the 16-day stagnation. The system is mathematically trapped: the champion is good enough that no single-parameter mutation can improve ALL metrics simultaneously.

---


### DESIGN-4: Orphan Run Artifacts Accumulate Without Cleanup

**File:** `scripts/pine-autoresearch.mjs` — run lifecycle management

**Evidence:**
- 160 `.started.json` files in the `runs/` directory
- Only 34 manifests exist (from `schedulerCycleIndex: 34` since last champion change)
- The `incomplete/` directory exists for failed runs

**Problem:**
Every cycle creates a `.started.json` artifact. When a run completes, a manifest is written. But:
1. Runs that crash mid-sweep leave `.started.json` without a corresponding manifest
2. The `markAutoresearchRunIncompleteUnlessManifestExists` function moves these to `incomplete/` but only on the NEXT run's error path
3. Normal successful runs don't clean up old `.started.json` files from prior crashes
4. Over 380 cycles, 160 started files have accumulated (126 orphans)

**Impact:** LOW — Disk waste only. No functional impact on research quality. But indicates the lifecycle management has gaps.

---

### DESIGN-5: Evaluation Cache is Per-Run Only

**File:** `scripts/pine-autoresearch.mjs` — `evaluateMatrix()` (~line 2888)

**Code:**
```js
const matrixEvaluationCache = createEvaluationCache();
for (const candidate of paretoShortlist.slice(0, trackedConfig.searchPolicy.matrixCandidateLimit)) {
  const { labResults, matrixDecision } = await evaluateMatrix(trackedConfig, runId, championState, candidate, {
    evaluationCache: matrixEvaluationCache,
  });
}
```

**Problem:**
The evaluation cache is created fresh each cycle. The champion's performance on each lab is re-computed every single cycle, even though the champion config hasn't changed. Over 34 cycles since the last champion change, the champion has been re-evaluated on the primary lab 34 times with identical results.

**Impact:** LOW-MEDIUM — Wasted compute. Each lab evaluation runs a full backtest sweep. For 6 labs × 34 cycles = 204 redundant champion evaluations. Not a logic flaw, but an efficiency issue that compounds the already-slow search.

---

## Research Results Analysis

### Pattern of Stagnation

**History breakdown:**
| Metric | Value |
|--------|-------|
| Total events | 380 |
| Cycle events | 360 |
| Promote events | 17 |
| Auto-promote events | 1 |
| Seed events | 2 |
| Promotion rate | 4.7% (18/380) |
| Days since last auto-promote | 16 |
| Cycles since champion change | 34 |
| Variants per cycle | 3 |
| Useful variants per cycle | ~1 (66% zero-trade) |

### Latest Blocked Challenger Analysis

The most recent blocked challenger (from the `blocked-challenger-queue.json`):

| Metric | Champion | Challenger | Delta | Gate |
|--------|----------|------------|-------|------|
| Score | 157.41 | 155.83 | -1.58 | FAIL (need ≥ +0.25) |
| ROI % | 94.7 | 91.23 | -3.47 | FAIL (need ≥ 0) |
| PF | 3.68 | 3.82 | +0.14 | PASS |
| DD % | 2.88 | 2.03 | -0.85 | PASS (lower is better) |
| Trades | 261 | 245 | -16 | PASS (ratio 0.94 ≥ 0.75) |

**Interpretation:**
The challenger is a BETTER risk-adjusted strategy (higher PF, lower DD) but takes fewer trades with slightly lower average return. The scoring formula's ROI bias (60% of score) and the strict "must improve everything" gates prevent this objectively reasonable trade-off from promoting.

### Search Efficiency

| Metric | Value |
|--------|-------|
| Variants generated per cycle | 3 |
| Zero-trade variants | 2 (66%) |
| Useful evaluations per cycle | 1 |
| Cycles per day | ~24 (hourly) |
| Useful evaluations per day | ~8 |
| Parameter dimensions | 40+ |
| Estimated full grid size | >10^12 combinations |
| Coverage rate | negligible |

The search is exploring approximately 8 useful configs per day in a space with trillions of combinations. Even with intelligent mutation (not random), this is insufficient to escape a local optimum.

---


## Summary Table

| # | ID | Severity | Category | Issue | Impact |
|---|-----|----------|----------|-------|--------|
| 1 | CRIT-1 | HIGH | Scoring | Non-compounded ROI calculation | False optimization target; trade-count bias |
| 2 | CRIT-2 | HIGH | Scoring | Arithmetic drawdown (not equity-based) | Understated risk; optimistic DD numbers |
| 3 | CRIT-3 | MEDIUM | Infrastructure | Float precision pollutes fingerprints | Wasted cycles; tabu dedup failures |
| 4 | CRIT-4 | HIGH | Search | 66% of variants produce zero trades | Search efficiency destroyed |
| 5 | CRIT-5 | HIGH | Lifecycle | Stagnation not converging after 16 days | Wasted compute indefinitely |
| 6 | LOGIC-1 | LOW-MED | Evaluation | tradeCount in Pareto dominance | Selective strategies unfairly eliminated |
| 7 | LOGIC-2 | LOW | Scoring | PF Infinity cap at 10 (80 points) | Shortlist ranking distortion |
| 8 | LOGIC-3 | MEDIUM | Scoring | Score weight imbalance (DD irrelevant) | Optimizes for wrong objective |
| 9 | LOGIC-4 | MEDIUM | Lifecycle | Blocked queue hard cap of 5 | Promising configs permanently lost |
| 10 | LOGIC-5 | MEDIUM | Promotion | ROI relaxation is dead code | Risk-efficient configs can never promote |
| 11 | DESIGN-1 | HIGH | Architecture | Primary lab has absolute veto power | Overfitting to single dataset |
| 12 | DESIGN-2 | MEDIUM | Search | Single-parameter axis-aligned mutations | Cannot find diagonal optima |
| 13 | DESIGN-3 | MED-HIGH | Promotion | Thresholds create asymmetric trap | Mathematically stuck near optimum |
| 14 | DESIGN-4 | LOW | Infrastructure | 160 orphan run artifacts | Disk waste |
| 15 | DESIGN-5 | LOW-MED | Performance | Evaluation cache is per-run only | Redundant champion evaluations |

---

## Root Cause Synthesis

The stagnation is not caused by a single bug but by **compounding failures across multiple layers:**

1. **Scoring layer** — The formula rewards ROI (which is inflated by trade count) and barely penalizes drawdown. This makes the champion's score artificially hard to beat.

2. **Search layer** — Only 3 variants per cycle, 66% are dead (zero-trade regime-filter toggles), single-parameter mutations can't escape local optima, and the globalAllParameter lane produces nothing.

3. **Evaluation layer** — Primary lab has absolute veto. A challenger must beat the champion on the exact dataset the champion was optimized for. Cross-asset robustness is ignored.

4. **Promotion layer** — Must improve ALL metrics simultaneously (no trade-offs allowed). ROI relaxation is dead code. The "god-tier" champion is near the Pareto frontier on the primary lab, making strict improvement statistically impossible.

5. **Lifecycle layer** — Stagnation detection doesn't trigger correctly after manual promotion. The system runs indefinitely without escalating or converging.

**The net effect:** The system is a hamster wheel. It generates one useful variant per hour, evaluates it against impossibly strict gates on a single dataset, fails, and repeats. The blocked challenger queue loses promising configs after 5 cycles. The stagnation escape is too gentle. The search space near the champion is exhausted but the system doesn't admit it.

---


## Recommendations

### Priority 1: Stop the Bleeding (Immediate)

#### R1.1: Fix Zero-Trade Variant Generation

**Problem:** CRIT-4 — 66% of variants are dead
**Fix:** In the track generator for `asymmetry-regime`, never toggle `useRegimeFilter: false → true` when the champion has it disabled. If the champion explicitly disabled a filter, the search should respect that architectural decision.

**Implementation:**
```js
// In buildTrackCandidateBatch or the asymmetry track generator:
// Skip variants that toggle a disabled filter ON
if (champion.useRegimeFilter === false && variant.config.useRegimeFilter === true) {
  continue; // Don't waste a slot on this
}
```

**Alternative:** Add a fast pre-check (100 bars) to verify ≥1 trade before committing to full sweep.

**Expected impact:** Immediately triples effective search throughput (3 useful variants instead of 1).

---

#### R1.2: Fix Floating-Point Precision

**Problem:** CRIT-3 — Fingerprint pollution
**Fix:** Round all numeric parameter values before fingerprinting.

**Implementation in `scripts/lib/pine-search-policy.mjs`:**
```js
function roundParam(value, precision = 6) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(precision));
}

// Apply in scalePatch():
function scalePatch(base, patch, temperature, patchBounds = {}, diversityScale = 1) {
  const result = {};
  for (const [key, targetValue] of Object.entries(patch)) {
    const baseValue = base[key] ?? targetValue;
    const delta = (targetValue - baseValue) * temperature * diversityScale;
    const scaled = baseValue + delta;
    const clamped = clampPatchValue(key, scaled, patchBounds);
    result[key] = roundParam(clamped);
  }
  return result;
}
```

**Expected impact:** Eliminates duplicate fingerprints, improves tabu accuracy, cleaner configIds.

---

#### R1.3: Increase Batch Size

**Problem:** 3 variants/cycle is too few for a 40+ dimension space
**Fix:** Increase `maxConfigs` from 3 to at least 8-12.

With zero-trade fix (R1.1), all 8-12 would be useful. At hourly cycles, this gives 192-288 useful evaluations per day instead of ~8.

---


### Priority 2: Fix the Promotion Logic (This Week)

#### R2.1: Enable ROI Relaxation

**Problem:** LOGIC-5 — Dead code prevents risk-efficient promotions
**Fix:** Set `minScoreDeltaToRelax` to a finite value in the research config.

**Recommended config:**
```json
{
  "roiRelaxation": {
    "enabled": true,
    "minScoreDeltaToRelax": 3.0,
    "maxRoiRegressionPct": 5.0,
    "tieredRelaxation": {
      "enabled": true,
      "pfMultiplierThreshold": 1.05,
      "ddImprovementRequired": true,
      "maxRoiRegressionPct": 8.0
    }
  }
}
```

**Logic:** If a challenger's score delta exceeds +3.0 AND its ROI regression is within 5%, allow promotion. For tiered: if PF improved by ≥5% AND DD improved, allow up to 8% ROI regression.

**Expected impact:** The blocked challenger (PF +0.14, DD -0.85%, ROI -3.47%) would still NOT pass because its score delta is -1.58 (negative). But future challengers with genuinely better composite scores that happen to trade ROI for risk improvement would be able to promote.

---

#### R2.2: Relax Primary Lab Veto

**Problem:** DESIGN-1 — Single dataset blocks cross-asset improvements
**Fix:** Change from absolute veto to weighted matrix.

**Option A (Conservative):** Allow promotion if primary fails but ≥4/6 labs pass:
```js
const requiresPrimaryPromote = config.matrixPolicy?.requirePrimaryPromote !== false;
const primaryFailed = primaryResult.decision.recommendation !== 'promote';
const allowShadowOverride = config.matrixPolicy?.allowShadowOverride === true;
const shadowOverrideThreshold = config.matrixPolicy?.shadowOverrideMinPassRatio ?? 0.67;

if (requiresPrimaryPromote && primaryFailed && !allowShadowOverride) {
  // Current behavior: block immediately
} else if (requiresPrimaryPromote && primaryFailed && allowShadowOverride) {
  // New: evaluate shadows anyway, allow if enough pass
  const shadowResults = await mapWithConcurrency(labs.slice(1), shadowConcurrency, evaluateLabPair);
  const shadowPassRatio = shadowResults.filter(r => r.decision.recommendation === 'promote').length / shadowResults.length;
  if (shadowPassRatio >= shadowOverrideThreshold) {
    // Allow promotion despite primary failure
  }
}
```

**Option B (Aggressive):** Remove primary veto entirely, use weighted scoring across all labs:
```js
const labWeights = { primary: 2.0, shadow: 1.0, holdout: 1.5 };
const weightedPassScore = labResults.reduce((sum, r) => {
  const weight = r.lab.labId === config.primaryLab.labId ? labWeights.primary : labWeights.shadow;
  return sum + (r.decision.recommendation === 'promote' ? weight : 0);
}, 0);
const totalWeight = labResults.reduce((sum, r) => {
  return sum + (r.lab.labId === config.primaryLab.labId ? labWeights.primary : labWeights.shadow);
}, 0);
const weightedPassRatio = weightedPassScore / totalWeight;
```

**Recommended:** Option A with `shadowOverrideMinPassRatio: 0.75` (must pass 75% of shadow labs to override primary failure).

---

#### R2.3: Fix Promotion Threshold Asymmetry

**Problem:** DESIGN-3 — Must improve ALL metrics simultaneously
**Fix:** Allow trade-offs between metrics using a composite improvement score.

**Concept:**
```js
// Instead of: ALL gates must pass
// Use: Weighted composite must be positive, with hard floors on critical metrics

const compositeImprovement = 
  comparisons.scoreDelta * 1.0 +
  comparisons.roiDeltaPct * 0.5 +
  comparisons.profitFactorDelta * 10 +
  (-comparisons.drawdownDeltaPct) * 5;

const hardFloors = {
  minTradeCount: 100,
  maxDrawdownRegression: 2.0,  // DD can worsen by at most 2%
  maxRoiRegression: 10.0,      // ROI can worsen by at most 10%
  minProfitFactor: 2.0,        // Absolute PF floor
};

const passed = compositeImprovement > 0 
  && challenger.tradeCount >= hardFloors.minTradeCount
  && comparisons.drawdownDeltaPct <= hardFloors.maxDrawdownRegression
  && comparisons.roiDeltaPct >= -hardFloors.maxRoiRegression
  && challenger.profitFactor >= hardFloors.minProfitFactor;
```

**Expected impact:** Allows legitimate trade-offs (e.g., -3% ROI for -1% DD and +0.14 PF) while maintaining hard safety floors.

---


### Priority 3: Fix the Scoring Foundation (Next Sprint)

#### R3.1: Switch to Compounded ROI

**Problem:** CRIT-1 — Arithmetic ROI is mathematically wrong
**Fix:** Use the existing `calculateCompoundedMetrics` function or switch to log-return sum.

**Option A (Use existing function):**
```js
// In the scoring pipeline, replace:
const metrics = calculateMetrics(trades);
// With:
const metrics = calculateMetrics(trades);
const compounded = calculateCompoundedMetrics(trades);
metrics.roiPct = round(compounded.compoundedRoiPct, 2);
metrics.maxDrawdownPct = round(compounded.maxDrawdownPct, 2);
```

**Option B (Log-return sum — simpler, more accurate):**
```js
// Replace arithmetic sum with log-return sum
const logReturnSum = trades.reduce((sum, trade) => {
  const r = exactReturnPct(trade) / 100;
  return sum + Math.log(1 + r);
}, 0);
const roiPct = (Math.exp(logReturnSum) - 1) * 100;
```

**Option C (Keep arithmetic but normalize by trade count):**
```js
// If you want to keep the simple formula but remove trade-count bias:
const avgReturnPct = roiPctRaw / tradeCount;
const normalizedRoi = avgReturnPct * Math.sqrt(tradeCount); // Sharpe-like scaling
```

**Recommended:** Option A — it already exists, is tested, and gives real equity-curve metrics.

**Migration concern:** Changing the scoring formula invalidates all historical comparisons. The champion's score will change. Recommend:
1. Compute new scores for champion and recent challengers
2. Update champion.json with new score
3. Reset history counters (or add a `scoringVersion` field to history events)

---

#### R3.2: Fix Drawdown to Use Equity Curve

**Problem:** CRIT-2 — Arithmetic DD underestimates real risk
**Fix:** Same as R3.1 Option A — `calculateCompoundedMetrics` already computes equity-curve drawdown correctly.

The existing implementation:
```js
export function calculateCompoundedMetrics(trades) {
  let equity = 1.0;
  let peak = 1.0;
  let maxDrawdownPct = 0;
  for (const trade of trades) {
    const r = exactReturnPct(trade) / 100;
    equity *= (1 + r);
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }
  // ...
}
```

This is the correct formula. It's already written. Just needs to be wired into the scoring pipeline.

---

#### R3.3: Rebalance Score Weights

**Problem:** LOGIC-3 — DD contributes only 1.1% of champion's score
**Fix:** Increase drawdown penalty weight and add expectancy.

**Proposed new formula:**
```js
export function scoreMetricsBreakdown(metrics, options = {}) {
  const weights = {
    roi: options.roiWeight ?? 0.8,
    winRate: options.winRateWeight ?? 0.3,
    profitFactor: options.profitFactorWeight ?? 12,
    drawdown: options.drawdownWeight ?? 3.0,
    expectancy: options.expectancyWeight ?? 20,
  };

  const profitFactor = Math.min(metrics.profitFactor, 6); // Cap at 6, not 10
  const expectancy = (metrics.winRatePct / 100) * metrics.avgWin 
    - (1 - metrics.winRatePct / 100) * metrics.avgLoss;

  const roi = round(metrics.roiPct * weights.roi);
  const winRate = round(metrics.winRatePct * weights.winRate);
  const profitFactorContribution = round(profitFactor * weights.profitFactor);
  const drawdown = round(-metrics.maxDrawdownPct * weights.drawdown);
  const expectancyContribution = round(expectancy * weights.expectancy);
  const tradePenalty = metrics.tradeCount < minTrades ? (metrics.tradeCount - minTrades) * 5 : 0;

  return {
    roi,
    winRate,
    profitFactor: profitFactorContribution,
    drawdown,
    expectancy: expectancyContribution,
    tradePenalty,
    total: round(roi + winRate + profitFactorContribution + drawdown + expectancyContribution + tradePenalty),
  };
}
```

**Key changes:**
1. PF capped at 6 instead of 10 (max contribution: 72 instead of 80)
2. DD weight increased from 0.6 to 3.0 (champion's DD now costs 8.64 instead of 1.73)
3. Win rate weight reduced from 0.8 to 0.3 (it's already captured in PF)
4. Expectancy added as explicit component (the most important trading metric)
5. ROI weight slightly reduced from 1.0 to 0.8

**Champion score under new formula:**
```
ROI: 94.7 * 0.8 = 75.76
WR: 43.68 * 0.3 = 13.10
PF: 3.68 * 12 = 44.16
DD: -2.88 * 3.0 = -8.64
Expectancy: (0.4368 * 1.15 - 0.5632 * 0.24) * 20 = (0.5023 - 0.1352) * 20 = 7.34
Total: 131.72
```

This makes drawdown 6.6% of the score (vs 1.1% before) and adds expectancy as a meaningful component.

---


### Priority 4: Fix Search Efficiency (Next Sprint)

#### R4.1: Add Multi-Parameter Joint Mutations

**Problem:** DESIGN-2 — Axis-aligned search can't find diagonal optima
**Fix:** Add a "joint" family to the patch generators that combines correlated parameters.

**Implementation:**
```js
export function jointPatches(base, { temperature = 1 } = {}) {
  const safeTemp = Math.max(1, Number(temperature) || 1);
  const patches = [];

  // Risk:Reward pairs (SL + TP move together)
  patches.push(
    { slAtrMult: base.slAtrMult * 0.8, tpAtrMult: base.tpAtrMult * 1.2 },
    { slAtrMult: base.slAtrMult * 1.2, tpAtrMult: base.tpAtrMult * 0.8 },
    { slAtrMult: base.slAtrMult * 0.7, tpAtrMult: base.tpAtrMult * 1.4 },
  );

  // Trail + TP (exit management as a unit)
  patches.push(
    { trailAtrMult: base.trailAtrMult * 0.8, tpAtrMult: base.tpAtrMult * 1.1 },
    { trailAtrMult: base.trailAtrMult * 1.3, tpAtrMult: base.tpAtrMult * 0.9 },
    { trailActivateR: base.trailActivateR * 0.7, trailAtrMult: base.trailAtrMult * 0.8 },
  );

  // Signal sensitivity pairs (ADX + minPredSum)
  patches.push(
    { adxThreshold: base.adxThreshold - 2, minPredSum: base.minPredSum + 0.2 },
    { adxThreshold: base.adxThreshold + 2, minPredSum: base.minPredSum - 0.2 },
    { adxThreshold: base.adxThreshold - 3, minPredSum: base.minPredSum + 0.3 },
  );

  // Fusion weight pairs (long/short asymmetry)
  patches.push(
    { fusionV4LongAtrWeight: base.fusionV4LongAtrWeight - 0.1, fusionV4ShortAtrWeight: base.fusionV4ShortAtrWeight + 0.1 },
    { fusionV4LongEngulfWeight: base.fusionV4LongEngulfWeight - 0.1, fusionV4ShortEngulfWeight: base.fusionV4ShortEngulfWeight + 0.1 },
  );

  // Temperature scaling
  if (safeTemp >= 2) {
    patches.push(
      { slAtrMult: base.slAtrMult * 0.5, tpAtrMult: base.tpAtrMult * 2.0, trailAtrMult: base.trailAtrMult * 0.7 },
      { adxThreshold: base.adxThreshold - 5, minPredSum: base.minPredSum + 0.5, minBarsBetween: Math.max(0, base.minBarsBetween - 1) },
    );
  }

  return patches.map(patch => {
    const rounded = {};
    for (const [key, value] of Object.entries(patch)) {
      rounded[key] = Number.isFinite(value) ? Number(value.toFixed(6)) : value;
    }
    return rounded;
  });
}
```

**Integration:** Add `'joint'` to the `exploitFamilies` array:
```js
const exploitFamilies = policy.exploitFamilies?.length 
  ? policy.exploitFamilies 
  : ['signal', 'risk', 'joint'];
```

---

#### R4.2: Fix the globalAllParameter Lane

**Problem:** The lane produces zero candidates despite being enabled
**Investigation needed:** The `buildGlobalMutationBatch` function in `pine-global-search.mjs` is returning empty arrays. Likely causes:
1. All mutations are hitting the tabu set (already tested)
2. The `frozenKeys` list is too aggressive
3. The `variantsPerFamily` parameter is misconfigured

**Diagnostic step:**
```js
// Add logging to buildGlobalMutationBatch:
console.log('globalAllParameter debug:', {
  frozenKeysCount: frozenKeys.length,
  testedPatchFingerprintCount: testedPatchFingerprints.size,
  maxNovelCandidates: maxConfigs,
  championKeys: Object.keys(champion.config || champion).length,
});
```

---

#### R4.3: Implement Fast Pre-Check for Variant Viability

**Problem:** Zero-trade variants waste full sweep compute
**Fix:** Before committing a variant to the full sweep pipeline, run a fast 100-bar simulation to verify it produces at least 1 trade signal.

```js
async function preCheckVariantViability(config, variant, { minSignals = 1, maxBars = 200 } = {}) {
  // Run a truncated simulation with just the first 200 bars
  // Only check for signal generation, not full trade execution
  const signals = await quickSignalCheck(config, variant.config, maxBars);
  return signals.length >= minSignals;
}

// In the sweep pipeline, before full evaluation:
const viableVariants = [];
for (const variant of executableVariants) {
  if (await preCheckVariantViability(config, variant)) {
    viableVariants.push(variant);
  }
}
```

**Expected impact:** Eliminates zero-trade variants before they consume full-sweep compute time.

---


### Priority 5: Fix Lifecycle and Infrastructure (Backlog)

#### R5.1: Fix Convergence Detection

**Problem:** CRIT-5 — System doesn't converge after 16 days of no improvement
**Fix:** The `noScoreImprovementStreak` counter must increment when the best candidate fails promotion gates (not only when the best candidate is identical to champion).

**Current logic (suspected):**
```js
// Only increments when candidate === champion (steady-state)
if (noNewCandidate) {
  updatedState.noScoreImprovementStreak++;
}
```

**Correct logic:**
```js
// Increment when no candidate IMPROVES on champion score
const bestCandidateScore = selectedCandidate?.challenger?.score ?? 0;
const championScore = championState.score ?? 0;
const improved = bestCandidateScore > championScore + minScoreDelta;

if (!improved) {
  updatedState.noScoreImprovementStreak = (updatedState.noScoreImprovementStreak ?? 0) + 1;
} else {
  updatedState.noScoreImprovementStreak = 0;
}
```

**Also:** After manual promotion resets the scheduler state, the convergence policy's `noScoreImprovementConvergeAfter` (default 6) should trigger after 6 cycles of no improvement from the new champion — not wait for hundreds of cycles because the counter definition is too narrow.

---

#### R5.2: Increase Blocked Challenger Queue Size

**Problem:** LOGIC-4 — Cap of 5 is too aggressive for hourly cycles
**Fix:** Increase cap to 20-50 and add a TTL-based eviction instead of FIFO.

```js
const MAX_BLOCKED_QUEUE_SIZE = 30;
const BLOCKED_ENTRY_TTL_HOURS = 72; // Evict entries older than 3 days

const now = Date.now();
const filtered = existingQueue.filter(e => {
  const age = now - Date.parse(e.blockedAt);
  return age < BLOCKED_ENTRY_TTL_HOURS * 3600000;
});
const deduped = [
  blockedEntry,
  ...filtered.filter(e => e.configFingerprint !== blockedEntry.configFingerprint)
].slice(0, MAX_BLOCKED_QUEUE_SIZE);
```

**Expected impact:** Promising near-champion configs survive long enough for the re-queue logic (`shouldRequeueBlockedChallenger`, `filterRequeueCandidates`) to actually be useful.

---

#### R5.3: Persist Evaluation Cache Across Runs

**Problem:** DESIGN-5 — Champion re-evaluated every cycle
**Fix:** Cache champion lab results to disk, keyed by champion fingerprint + lab ID.

```js
const CACHE_DIR = path.join(config.researchRoot, 'state', 'evaluation-cache');

async function getCachedChampionResult(championFingerprint, labId) {
  const cachePath = path.join(CACHE_DIR, `${championFingerprint}-${labId}.json`);
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

async function cacheChampionResult(championFingerprint, labId, result) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, `${championFingerprint}-${labId}.json`);
  await fs.writeFile(cachePath, JSON.stringify(result), 'utf8');
}
```

**Invalidation:** Clear cache when champion changes (already handled by the fingerprint-based key).

**Expected impact:** Saves ~6 full backtests per cycle (one per lab for the champion). At ~20 seconds per backtest, saves ~2 minutes per hourly cycle.

---

#### R5.4: Clean Up Orphan Run Artifacts

**Problem:** DESIGN-4 — 160 started.json files accumulating
**Fix:** Add cleanup logic at cycle start.

```js
async function cleanupOrphanRuns(runsDir, maxAge = 24 * 3600000) {
  const files = await fs.readdir(runsDir);
  const startedFiles = files.filter(f => f.endsWith('.started.json'));
  const now = Date.now();
  
  for (const file of startedFiles) {
    const filePath = path.join(runsDir, file);
    const stat = await fs.stat(filePath);
    if (now - stat.mtimeMs > maxAge) {
      await fs.unlink(filePath);
    }
  }
}
```

---

#### R5.5: Remove tradeCount from Pareto Dominance

**Problem:** LOGIC-1 — Activity metric treated as quality metric
**Fix:** Remove `tradeCount` from the `dominates()` function.

```js
function dominates(left, right) {
  const betterOrEqual =
    (left.score ?? 0) >= (right.score ?? 0) &&
    (left.roiPct ?? 0) >= (right.roiPct ?? 0) &&
    (left.profitFactor ?? 0) >= (right.profitFactor ?? 0) &&
    // REMOVED: (left.tradeCount ?? 0) >= (right.tradeCount ?? 0) &&
    (left.maxDrawdownPct ?? Infinity) <= (right.maxDrawdownPct ?? Infinity);

  const strictlyBetter =
    (left.score ?? 0) > (right.score ?? 0) ||
    (left.roiPct ?? 0) > (right.roiPct ?? 0) ||
    (left.profitFactor ?? 0) > (right.profitFactor ?? 0) ||
    // REMOVED: (left.tradeCount ?? 0) > (right.tradeCount ?? 0) ||
    (left.maxDrawdownPct ?? Infinity) < (right.maxDrawdownPct ?? Infinity);

  return betterOrEqual && strictlyBetter;
}
```

Trade count is still enforced by the promotion gates (minTradeCount, minTradeRatio). It doesn't need to be in Pareto dominance.

---


## Implementation Priority Matrix

| Priority | Fix | Effort | Impact | Risk |
|----------|-----|--------|--------|------|
| P1 (Now) | R1.1 Zero-trade filter | 30 min | HIGH | LOW |
| P1 (Now) | R1.2 Float precision | 1 hour | MEDIUM | LOW |
| P1 (Now) | R1.3 Increase batch size | 5 min (config) | HIGH | LOW |
| P2 (This week) | R2.1 Enable ROI relaxation | 15 min (config) | MEDIUM | LOW |
| P2 (This week) | R2.2 Relax primary veto | 2 hours | HIGH | MEDIUM |
| P2 (This week) | R2.3 Composite thresholds | 3 hours | HIGH | MEDIUM |
| P3 (Next sprint) | R3.1 Compounded ROI | 1 hour | HIGH | MEDIUM* |
| P3 (Next sprint) | R3.2 Equity-curve DD | 1 hour | HIGH | MEDIUM* |
| P3 (Next sprint) | R3.3 Rebalance weights | 2 hours | MEDIUM | MEDIUM* |
| P4 (Next sprint) | R4.1 Joint mutations | 3 hours | MEDIUM | LOW |
| P4 (Next sprint) | R4.2 Fix globalAllParam | 2 hours (debug) | MEDIUM | LOW |
| P4 (Next sprint) | R4.3 Fast pre-check | 4 hours | MEDIUM | LOW |
| P5 (Backlog) | R5.1 Fix convergence | 2 hours | HIGH | LOW |
| P5 (Backlog) | R5.2 Blocked queue size | 30 min | LOW-MED | LOW |
| P5 (Backlog) | R5.3 Persist eval cache | 2 hours | LOW-MED | LOW |
| P5 (Backlog) | R5.4 Cleanup orphans | 30 min | LOW | LOW |
| P5 (Backlog) | R5.5 Remove tradeCount Pareto | 15 min | LOW-MED | LOW |

*P3 items marked MEDIUM risk because changing the scoring formula invalidates historical comparisons and requires champion score recalculation.

---

## Quick Wins (Can Do Right Now)

1. **R1.3** — Change `maxConfigs` from 3 to 8 in the research config. Zero code changes.
2. **R2.1** — Add `roiRelaxation` config block. Zero code changes.
3. **R5.2** — Change `.slice(0, 5)` to `.slice(0, 30)`. One-line code change.
4. **R5.5** — Remove two lines from `dominates()`. Trivial code change.

These four changes take <15 minutes combined and immediately improve search efficiency and promotion flexibility.

---

## Testing Strategy

For any scoring formula changes (P3), the following validation is required:

1. **Recalculate champion score** under new formula
2. **Recalculate top 10 historical challengers** to verify ordering is preserved
3. **Run the existing test suite** (`tests/pine-autoresearch*.test.mjs` — 35 test files)
4. **Verify no regression** in promotion gate logic
5. **Update champion.json** with new score value
6. **Add `scoringVersion` field** to history events for audit trail

For search changes (P1, P4):
1. **Verify variant generation** produces non-zero-trade configs
2. **Check tabu deduplication** works correctly with rounded fingerprints
3. **Run production-invariants test** (`pine-autoresearch-production-invariants.test.mjs`)

---


## Appendix A: Code Location Reference

### Core Files (by importance to this audit)

| File | Size | Role |
|------|------|------|
| `scripts/pine-autoresearch.mjs` | 164 KB | Main orchestrator — runScout, evaluateMatrix, runPromote, main loop |
| `scripts/lib/pine-autoresearch.mjs` | 60 KB | Core logic — scoring decisions, Pareto, matrix promotion, gates |
| `scripts/lib/pine-metric-core.mjs` | ~4 KB | Scoring formula — calculateMetrics, scoreMetrics, scoreMetricsBreakdown |
| `scripts/lib/pine-search-policy.mjs` | ~15 KB | Candidate generation — signalPatches, riskPatches, buildIncumbentSearchBatch |
| `scripts/lib/pine-autoresearch-tracks.mjs` | 32 KB | Track rotation, scheduler state, stagnation detection |
| `scripts/lib/pine-autoresearch-lineage.mjs` | 9 KB | Promotion lineage tracking |
| `scripts/lib/pine-global-search.mjs` | ~8 KB | globalAllParameter lane — buildGlobalMutationBatch |
| `scripts/lib/pine-track-generators.mjs` | ~12 KB | Track-based candidate generation (asymmetry, regime, etc.) |
| `scripts/lib/pine-stagnation-escape.mjs` | ~5 KB | Stagnation escape planning |
| `scripts/lib/pine-autoresearch-artifacts.mjs` | 6.5 KB | Run lifecycle — begin, finalize, mark incomplete |

### Research Artifacts

| Path | Content |
|------|---------|
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/champion.json` | Current champion config + metrics |
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/history.jsonl` | 380 events (2.2 MB) |
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json` | Latest manifest (217 KB) |
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/manifests/` | 34 manifest JSONs |
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/runs/` | 160 started.json files |
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/blocked-challenger-queue.json` | 5 blocked configs (26 KB) |
| `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/` | Scheduler state |

### Test Files (relevant to audit findings)

| Test File | Tests |
|-----------|-------|
| `tests/pine-autoresearch.test.mjs` | 322 KB — main integration tests |
| `tests/pine-autoresearch-production-invariants.test.mjs` | 26 KB — production safety checks |
| `tests/pine-autoresearch-promotion-overhaul.test.mjs` | 34 KB — promotion logic tests |
| `tests/pine-autoresearch-tracks.test.mjs` | 56 KB — track rotation tests |
| `tests/pine-autoresearch-gates.test.mjs` | 5 KB — gate logic tests |
| `tests/pine-autoresearch-holdout.test.mjs` | 4 KB — holdout verification |
| `tests/pine-autoresearch-tabu-saturation.test.mjs` | 11 KB — tabu dedup tests |

---


## Appendix B: Detailed Config Analysis

### Current Champion vs Best Blocked Challenger

**Champion: `squeeze-collapse-god-tier`**
```json
{
  "useRegimeFilter": false,
  "useVolatilityFilter": false,
  "useAdxFilter": true,
  "adxThreshold": 20,
  "minPredSum": 1.8,
  "useTrendXConf": true,
  "minBarsBetween": 1,
  "slAtrMult": 0.5,
  "tpAtrMult": 6.85,
  "useSignalFusion": true,
  "useFusionV4": true,
  "fusionV4MinAbsPrediction": 2,
  "fusionV4MaxAbsPrediction": 4,
  "useAtrFlipConfirm": true,
  "useEngulfingConfirm": true,
  "fusionV4LongAtrWeight": -0.25,
  "fusionV4LongEngulfWeight": -0.25,
  "fusionV4ShortAtrWeight": -0.5,
  "fusionV4ShortEngulfWeight": -0.1,
  "useSupertrendFilter": true,
  "supertrendAtrLen": 10,
  "supertrendFactor": 1.5,
  "useTrailingStop": true,
  "trailAtrLen": 14,
  "trailAtrMult": 1,
  "trailActivateR": 0.5,
  "useStopsTP": true,
  "useDivergenceContext": true,
  "divFreshBars": 8,
  "divPivotLeft": 3,
  "divPivotRight": 3,
  "divRsiLen": 21,
  "divLongBoostValue": 0.7,
  "divShortBoostValue": 0.7,
  "usePostEntrySqueezeCollapseTighten": true,
  "postEntrySqueezeCollapseBars": 6,
  "postEntrySqueezeCollapseTrailAtrMult": 0.5
}
```

**Blocked Challenger #1 (adxThreshold: 21)**

Only difference from champion: `adxThreshold: 21` (champion has 20)

| Metric | Champion | Challenger | Delta | Verdict |
|--------|----------|------------|-------|---------|
| Score | 157.41 | 155.83 | -1.58 | ❌ Worse |
| ROI % | 94.7 | 91.23 | -3.47 | ❌ Worse |
| Profit Factor | 3.68 | 3.82 | +0.14 | ✅ Better |
| Max DD % | 2.88 | 2.03 | -0.85 | ✅ Better |
| Trade Count | 261 | 245 | -16 | ⚠️ Fewer |
| Win Rate % | 43.68 | 44.08 | +0.40 | ✅ Better |
| Avg Win | 1.15 | 1.14 | -0.01 | ≈ Same |
| Avg Loss | 0.24 | 0.24 | 0.00 | Same |

**Analysis:**
Raising ADX threshold from 20→21 makes the signal filter slightly more selective:
- 16 fewer trades (more marginal trades filtered out)
- Better win rate (+0.40%) — the filtered trades were net losers
- Better PF and DD — removing those trades reduced losses more than profits
- Lower ROI — removing 16 trades reduces the arithmetic ROI sum

**The core tension:** This challenger is objectively a better *risk-adjusted* strategy. It filters out marginal trades, resulting in better selectivity metrics across the board. But because ROI is an arithmetic sum (CRIT-1), removing trades mechanically lowers ROI regardless of trade quality.

**Under compounded ROI:** The 245 trades at slightly better average return would likely produce HIGHER compounded ROI than 261 trades at slightly worse average — the challenger might actually be the better config on a proper equity curve basis.

---

### Blocked Challenger #2 (fusionV4 weight adjustments)

Differences from champion:
- `fusionV4LongAtrWeight`: -0.31 (champion: -0.25)
- `fusionV4ShortAtrWeight`: -0.56 (champion: -0.50)

These make the fusion model penalize ATR-flip signals more heavily on both sides. This is a more conservative signal generation approach.

**Implication:** The search found that being more conservative on ATR-based signals improves risk metrics but reduces trade count (and thus arithmetic ROI). Same pattern as Challenger #1 — the scoring formula's ROI bias prevents risk-efficient configs from promoting.

---


## Appendix C: Structural Diagnosis — Why the System Is Stuck

### The Feedback Loop That Prevents Progress

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE STAGNATION TRAP                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Champion optimized on primary lab (XRP 15m)                 │
│     ↓                                                           │
│  2. Score formula rewards arithmetic ROI (trade count × avg)    │
│     ↓                                                           │
│  3. Search generates single-param mutations (3/cycle, 66% dead) │
│     ↓                                                           │
│  4. Best challenger is risk-efficient but lower ROI             │
│     ↓                                                           │
│  5. primaryPromote gate blocks (score delta negative)           │
│     ↓                                                           │
│  6. ROI relaxation is dead code (Infinity threshold)            │
│     ↓                                                           │
│  7. Challenger discarded, blocked queue cap = 5                 │
│     ↓                                                           │
│  8. Stagnation counter doesn't increment (candidate ≠ champion)│
│     ↓                                                           │
│  9. No convergence declared, no escalation triggered            │
│     ↓                                                           │
│  10. System repeats from step 3, forever                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Breaking the Loop — Minimum Viable Fix Set

To break this specific stagnation, you need AT MINIMUM:

1. **Fix CRIT-4** (zero-trade variants) — so the search actually tests useful configs
2. **Fix CRIT-5** (convergence detection) — so the system admits it's stuck
3. **Fix LOGIC-5** (ROI relaxation) OR **DESIGN-3** (threshold asymmetry) — so risk-efficient configs can promote

Any ONE of these alone is insufficient:
- Fixing only CRIT-4 gives more useful variants but they still can't promote
- Fixing only CRIT-5 makes the system stop but doesn't fix the underlying inability to promote
- Fixing only LOGIC-5 allows trade-offs but the search still generates mostly dead variants

The minimum viable fix is: **CRIT-4 + (LOGIC-5 OR DESIGN-3)**

---

### Why Manual Promotion Was Required

The current champion was manually promoted on 2026-05-18 because:
1. The auto-research system found it as a candidate
2. The candidate passed some but not all automated gates
3. A human (Diko) evaluated it and decided it was genuinely better
4. Manual promotion bypassed the automated gates

This is a symptom of the system being too conservative. When a human must intervene to promote configs that the system itself discovered, the gates are miscalibrated.

---

### The Deeper Question: Is the Champion Actually Optimal?

Given the scoring formula flaws (CRIT-1, CRIT-2, LOGIC-3), the champion's score of 157.41 is computed on a flawed basis. Under a corrected formula:

**Current formula (flawed):**
- ROI 94.7% (arithmetic sum, inflated by trade count)
- DD 2.88% (arithmetic, understated)
- Score: 157.41

**Estimated corrected formula:**
- ROI ~147% (compounded, higher because positive expectancy compounds)
- DD ~4.2% (equity-curve, higher because compounding amplifies drawdowns)
- Score: different ranking possible

The blocked challenger with adxThreshold=21 might actually score HIGHER under a corrected formula because:
- Its compounded ROI might be closer to (or exceed) the champion's
- Its equity-curve DD is likely still lower
- Its PF is already higher

**Conclusion:** We cannot be certain the current champion is actually the best config. The scoring formula's flaws may be hiding a better alternative that's already been discovered and discarded.

---


## Appendix D: Specific Code Fixes (Copy-Paste Ready)

### Fix 1: Round Parameters Before Fingerprinting

**File:** `scripts/lib/pine-search-policy.mjs`

**Add helper at top of file:**
```js
function roundParam(value, precision = 6) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(precision));
}
```

**Modify `scalePatch` (line ~104):**
```js
function scalePatch(base, patch, temperature, patchBounds = {}, diversityScale = 1) {
  const result = {};
  for (const [key, targetValue] of Object.entries(patch)) {
    const baseValue = base[key] ?? targetValue;
    const delta = (targetValue - baseValue) * temperature * diversityScale;
    const scaled = baseValue + delta;
    const clamped = clampPatchValue(key, scaled, patchBounds);
    result[key] = roundParam(clamped);  // <-- ADD THIS
  }
  return result;
}
```

**Modify `withPatch` (line ~67):**
```js
function withPatch(base, patch, meta) {
  const config = { ...clone(base) };
  for (const [key, value] of Object.entries(patch)) {
    config[key] = typeof value === 'number' ? roundParam(value) : value;  // <-- ROUND
  }
  return {
    config,
    patch,
    touchedKeys: Object.keys(patch),
    ...(meta || {}),
  };
}
```

---


### Fix 2: Remove tradeCount from Pareto Dominance

**File:** `scripts/lib/pine-autoresearch.mjs` — `dominates()` (line ~315)

**Replace:**
```js
function dominates(left, right) {
  const betterOrEqual =
    (left.score ?? 0) >= (right.score ?? 0) &&
    (left.roiPct ?? 0) >= (right.roiPct ?? 0) &&
    (left.profitFactor ?? 0) >= (right.profitFactor ?? 0) &&
    (left.tradeCount ?? 0) >= (right.tradeCount ?? 0) &&
    (left.maxDrawdownPct ?? Infinity) <= (right.maxDrawdownPct ?? Infinity);

  const strictlyBetter =
    (left.score ?? 0) > (right.score ?? 0) ||
    (left.roiPct ?? 0) > (right.roiPct ?? 0) ||
    (left.profitFactor ?? 0) > (right.profitFactor ?? 0) ||
    (left.tradeCount ?? 0) > (right.tradeCount ?? 0) ||
    (left.maxDrawdownPct ?? Infinity) < (right.maxDrawdownPct ?? Infinity);

  return betterOrEqual && strictlyBetter;
}
```

**With:**
```js
function dominates(left, right) {
  const betterOrEqual =
    (left.score ?? 0) >= (right.score ?? 0) &&
    (left.roiPct ?? 0) >= (right.roiPct ?? 0) &&
    (left.profitFactor ?? 0) >= (right.profitFactor ?? 0) &&
    (left.maxDrawdownPct ?? Infinity) <= (right.maxDrawdownPct ?? Infinity);

  const strictlyBetter =
    (left.score ?? 0) > (right.score ?? 0) ||
    (left.roiPct ?? 0) > (right.roiPct ?? 0) ||
    (left.profitFactor ?? 0) > (right.profitFactor ?? 0) ||
    (left.maxDrawdownPct ?? Infinity) < (right.maxDrawdownPct ?? Infinity);

  return betterOrEqual && strictlyBetter;
}
```

**Rationale:** Trade count is enforced by promotion gates (minTradeCount >= 100, minTradeRatioVsIncumbent >= 0.75). It should not influence Pareto frontier selection.

---

### Fix 3: Increase Blocked Challenger Queue Cap

**File:** `scripts/pine-autoresearch.mjs` — blocked challenger storage (~line 3600)

**Replace:**
```js
const deduped = [blockedEntry, ...existingQueue.filter(e => e.configFingerprint !== blockedEntry.configFingerprint)].slice(0, 5);
```

**With:**
```js
const MAX_BLOCKED_QUEUE = 30;
const BLOCKED_TTL_MS = 72 * 3600000; // 72 hours
const now = Date.now();
const fresh = existingQueue.filter(e => {
  if (!e.blockedAt) return true;
  return (now - Date.parse(e.blockedAt)) < BLOCKED_TTL_MS;
});
const deduped = [blockedEntry, ...fresh.filter(e => e.configFingerprint !== blockedEntry.configFingerprint)].slice(0, MAX_BLOCKED_QUEUE);
```

---

### Fix 4: Wire Compounded Metrics into Scoring

**File:** `scripts/lib/pine-optimizer.mjs` — `analyzeJsonlFile()` (line ~303)

**After the existing `calculateMetrics` call, add:**
```js
const metrics = calculateMetrics(trades);
const compounded = calculateCompoundedMetrics(trades);

// Override arithmetic metrics with compounded equivalents
metrics.roiPct = round(compounded.compoundedRoiPct, 2);
metrics.maxDrawdownPct = round(compounded.maxDrawdownPct, 2);
```

**Note:** This changes the scoring basis for ALL evaluations. Requires champion.json score recalculation and test suite update. See Testing Strategy in AUDIT-REC-MATRIX.md.

---


### Fix 5: Skip Zero-Trade Regime Variants

**File:** `scripts/lib/pine-track-generators.mjs` — asymmetry-regime track generator

**Add guard in `buildTrackCandidateBatch` or the track's variant builder:**
```js
function filterViableRegimeVariants(variants, championConfig) {
  return variants.filter(variant => {
    const config = variant.config || variant;
    
    // Never toggle a disabled filter ON — it predictably kills all trades
    if (championConfig.useRegimeFilter === false && config.useRegimeFilter === true) {
      return false;
    }
    if (championConfig.useVolatilityFilter === false && config.useVolatilityFilter === true) {
      return false;
    }
    
    return true;
  });
}
```

**Alternative approach — validate in the batch builder:**

In `scripts/pine-autoresearch.mjs`, after `buildTrackCandidateBatch`:
```js
const fallbackSearchBatch = activeTrack
  ? buildTrackCandidateBatch({ ... })
  : buildIncumbentSearchBatchFn({ ... });

// Filter out variants that toggle disabled filters ON
const viableBatch = fallbackSearchBatch.filter(variant => {
  if (!variant.config) return true; // metadata entries pass through
  const champ = championState.config;
  if (champ.useRegimeFilter === false && variant.config.useRegimeFilter === true) return false;
  if (champ.useVolatilityFilter === false && variant.config.useVolatilityFilter === true) return false;
  return true;
});
```

**Expected outcome:** All 3 batch slots now contain configs that will actually produce trades.

---

### Fix 6: Fix Stagnation Counter Logic

**File:** `scripts/lib/pine-autoresearch-tracks.mjs` — `nextTrackState()`

**The counter should increment when best candidate fails to improve on champion, not only when candidate IS champion:**

**Find the `noScoreImprovementStreak` logic and modify:**
```js
// Current (suspected) — only counts steady-state (no new candidate)
const noScoreImprovement = manifest.noNewCandidate === true;

// Fixed — counts ANY cycle where score didn't improve
const bestScore = manifest.bestCandidateScore ?? manifest.challenger?.score ?? 0;
const championScore = manifest.champion?.score ?? manifest.incumbent?.score ?? 0;
const minDelta = policy.minScoreDeltaForImprovement ?? 0.25;
const noScoreImprovement = bestScore <= championScore + minDelta;
```

**This ensures:**
- A challenger that scores 155.83 vs champion 157.41 (delta = -1.58) increments the streak
- A challenger that scores 157.50 vs champion 157.41 (delta = +0.09 < 0.25) increments the streak
- Only a genuine improvement (delta ≥ 0.25) resets the streak

**With this fix + `noScoreImprovementConvergeAfter: 6`:** The system would converge after 6 hours of no improvement instead of running indefinitely.

---

### Fix 7: Persistent Champion Evaluation Cache

**File:** `scripts/pine-autoresearch.mjs` — near `evaluateMatrix()`

**Add file-based cache layer:**
```js
import { createHash } from 'node:crypto';

function buildChampionCachePath(config, championFingerprint, labId) {
  const hash = createHash('sha256')
    .update(`${championFingerprint}:${labId}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(config.researchRoot, 'state', 'eval-cache', `champion-${hash}.json`);
}

async function getCachedChampionEvaluation(config, championFingerprint, labId) {
  const cachePath = buildChampionCachePath(config, championFingerprint, labId);
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    if (cached.championFingerprint === championFingerprint && cached.labId === labId) {
      return cached.result;
    }
  } catch { /* cache miss */ }
  return null;
}

async function setCachedChampionEvaluation(config, championFingerprint, labId, result) {
  const cachePath = buildChampionCachePath(config, championFingerprint, labId);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify({
    championFingerprint,
    labId,
    cachedAt: new Date().toISOString(),
    result,
  }), 'utf8');
}
```

**Integration in `evaluateMatrix`:**
```js
const incumbentResult = await getCachedChampionEvaluation(config, championConfigFingerprint, lab.labId)
  || await evaluateConfigOnLabFn({ config, lab, runId, variantKey: 'champion', candidate: championState });

// Cache for next cycle
await setCachedChampionEvaluation(config, championConfigFingerprint, lab.labId, incumbentResult);
```

**Invalidation:** Automatic — cache key includes champion fingerprint. New champion = new fingerprint = cache miss.

---


## Appendix E: Verification Checklist

### Before Implementing Any Fix

- [ ] Run existing test suite: `node --test tests/pine-autoresearch*.test.mjs`
- [ ] Note current test count and pass rate as baseline
- [ ] Back up `champion.json` and `history.jsonl`
- [ ] Record current champion score (157.41) for comparison

### After P1 Fixes (Zero-trade filter, Float precision, Batch size)

- [ ] Verify variant generation produces 0 zero-trade configs
- [ ] Verify all configIds have clean numeric values (no `0.30000000000000004`)
- [ ] Verify tabu set correctly deduplicates rounded fingerprints
- [ ] Run: `node --test tests/pine-autoresearch-tabu-saturation.test.mjs`
- [ ] Run: `node --test tests/pine-autoresearch-tracks.test.mjs`
- [ ] Run: `node --test tests/pine-autoresearch-production-invariants.test.mjs`
- [ ] Manually trigger one scout cycle and verify manifest shows all variants with tradeCount > 0

### After P2 Fixes (ROI relaxation, Primary veto, Thresholds)

- [ ] Verify ROI relaxation activates when conditions are met
- [ ] Verify primary lab failure no longer blocks when shadow override threshold is met
- [ ] Run: `node --test tests/pine-autoresearch-gates.test.mjs`
- [ ] Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
- [ ] Run: `node --test tests/pine-autoresearch-holdout.test.mjs`
- [ ] Test with the current blocked challenger — verify it would/wouldn't promote under new rules
- [ ] Verify no regression in existing promotion safety (holdout still required, lineage still checked)

### After P3 Fixes (Compounded ROI, Equity DD, Score rebalance)

- [ ] Recalculate champion score under new formula
- [ ] Recalculate top 5 blocked challengers under new formula
- [ ] Verify ordering is reasonable (no absurd inversions)
- [ ] Update `champion.json` with new score
- [ ] Add `scoringVersion: 2` field to champion.json
- [ ] Run FULL test suite (all 35 test files)
- [ ] Verify `calculateCompoundedMetrics` produces sane values for edge cases:
  - [ ] Empty trades array → 0 ROI, 0 DD
  - [ ] Single trade → correct
  - [ ] All winning trades → PF = Infinity handled
  - [ ] All losing trades → negative ROI, correct DD
  - [ ] Large trade count (1000+) → no overflow

### After P4 Fixes (Joint mutations, globalAllParam, Pre-check)

- [ ] Verify joint patches produce valid configs (all values within bounds)
- [ ] Verify globalAllParameter lane produces > 0 candidates
- [ ] Verify pre-check correctly identifies zero-trade configs
- [ ] Run: `node --test tests/pine-autoresearch-tracks.test.mjs`
- [ ] Run one full scout cycle and verify search efficiency improved

### After P5 Fixes (Convergence, Queue, Cache, Cleanup, Pareto)

- [ ] Verify convergence triggers after N cycles of no improvement
- [ ] Verify blocked queue retains entries for 72 hours
- [ ] Verify evaluation cache hits on second cycle (champion not re-evaluated)
- [ ] Verify orphan cleanup removes old .started.json files
- [ ] Verify Pareto frontier includes selective strategies (fewer trades, better metrics)
- [ ] Run: `node --test tests/pine-autoresearch-production-invariants.test.mjs`

---

