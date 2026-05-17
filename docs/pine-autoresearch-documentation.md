# Pine Autoresearch System — Complete Documentation
## Backtest Kit Project

**Last Updated:** 2026-05-17
**Project Path:** `D:\Code\Experiment\backtest-kit-project`
**Runtime:** Node.js ESM, `node:test` framework

---

## Table of Contents

1. System Overview
2. Architecture & File Map
3. The Pine Strategy (What Gets Optimized)
4. Autoresearch Cycle Flow
5. Configuration Reference
6. Research Tracks & Patch Pools
7. Scoring & Promotion Gates
8. Stagnation & Escape Mechanisms
9. Tabu System
10. Lab Evaluation & Matrix Decision
11. Scheduler State Machine
12. Manifest Structure
13. CLI Commands & npm Scripts
14. LLM-Assisted Research Lane
15. Operational Procedures
16. Recent Structural Fixes (2026-05-16)

---

## 1. System Overview

The Pine Autoresearch system is an automated trading strategy optimizer that:

1. Takes a PineScript indicator strategy as input
2. Generates parameter variants using configurable patch pools
3. Evaluates each variant by running backtests on pinned historical data
4. Compares candidates against the current champion using a multi-gate promotion system
5. Promotes superior candidates automatically when all gates pass
6. Manages search stagnation, track rotation, and convergence detection

**Core loop:** Generate variants → Backtest → Score → Compare → Promote or Reject → Rotate track → Repeat

**Key properties:**
- Fully offline (pinned datasets, no live exchange calls during research)
- Deterministic backtests (same config + same data = same result)
- Multi-asset validation (primary lab + shadow labs on different symbols/timeframes)
- Blind holdout verification (unseen data window for final promotion gate)
- Complexity-penalized scoring (penalizes parameter bloat)

---

## 2. Architecture & File Map

### Project Structure

```
backtest-kit-project/
├── config/                          # Configuration files
│   ├── pine-autoresearch.default.json    # Main autoresearch config
│   ├── pine-autoresearch-llm.default.json # LLM lane config
│   ├── champion-original-153.json        # Champion parameter snapshot
│   └── exploration-seeds-v2.json         # Seed configs for exploration
├── scripts/                         # Entry-point scripts
│   ├── pine-autoresearch.mjs             # Main orchestrator (3800+ lines)
│   ├── pine-sweep.mjs                    # Batch sweep runner
│   ├── pine-dataset.mjs                  # Dataset pinning/staging
│   ├── pine-autoresearch-llm.mjs         # LLM research lane entry
│   └── lib/                              # Core library modules
│       ├── pine-autoresearch.mjs              # Lab decision logic, scoring
│       ├── pine-autoresearch-tracks.mjs       # Scheduler state machine
│       ├── pine-track-generators.mjs          # Patch pool generation
│       ├── pine-tuner.mjs                     # Parameter tuning engine
│       ├── pine-search-policy.mjs             # Search policy resolution
│       ├── pine-optimizer.mjs                 # Optimization algorithms
│       ├── pine-stagnation-escape.mjs         # Escape plan logic
│       ├── pine-regime-analysis.mjs           # Regime classification
│       ├── pine-streaming-metrics.mjs         # MFE/MAE streaming
│       ├── pine-objective-function.mjs        # Composite score function
│       ├── pine-significance-gate.mjs         # Statistical significance
│       ├── pine-expectancy.mjs                # Trade expectancy calc
│       ├── pine-entry-invariance.mjs          # Entry signal validation
│       └── ... (40+ modules total)
├── tests/                           # Test suite (node:test)
│   ├── pine-autoresearch.test.mjs         # 249 tests
│   ├── pine-autoresearch-tracks.test.mjs  # 66 tests
│   ├── pine-track-generators.test.mjs     # 34 tests
│   └── ... (12+ test files)
├── pine/                            # PineScript source & research artifacts
│   ├── test.pine                          # Main strategy (1895 lines)
│   ├── datasets/                          # Pinned OHLCV datasets
│   ├── autoresearch/                      # Research output
│   │   └── pine-fusion-v4-core-15m-locked-window/
│   │       ├── state/                     # Scheduler state, champion pointer
│   │       ├── manifests/                 # Cycle result manifests
│   │       ├── evaluations/               # Backtest result JSONs
│   │       ├── runs/                      # Run artifacts
│   │       └── incomplete/                # Partial/failed runs
│   └── dump/data/candle/                  # Raw candle cache
└── package.json                     # npm scripts
```

### Key Module Responsibilities

| Module | Role |
|---|---|
| `scripts/pine-autoresearch.mjs` | Main orchestrator: cycle, promote, digest, autopromote commands |
| `scripts/lib/pine-autoresearch.mjs` | Lab decision logic: `decideAutoresearchOutcome`, `decideMatrixPromotion`, scoring |
| `scripts/lib/pine-autoresearch-tracks.mjs` | Scheduler state machine: `nextTrackState`, `nextStagnationState`, track rotation |
| `scripts/lib/pine-track-generators.mjs` | Patch pool generation: `buildTrackCandidateBatch`, family-specific patches |
| `scripts/lib/pine-tuner.mjs` | Parameter surface: knob keys, grid definitions, config application |
| `scripts/lib/pine-stagnation-escape.mjs` | Escape plans: `decideStagnationEscapePlan` |
| `scripts/lib/pine-search-policy.mjs` | Budget allocation, lane selection, annealing |
| `scripts/lib/pine-optimizer.mjs` | Pareto optimization, shortlist selection |
| `scripts/lib/pine-objective-function.mjs` | Composite score calculation |
| `scripts/lib/pine-regime-analysis.mjs` | Regime classification from exported features |

---

## 3. The Pine Strategy (What Gets Optimized)

The strategy is a PineScript v5 indicator (`pine/test.pine`, 1895 lines) that generates trade signals using a 7-layer gate cascade:

### Trade Entry Decision Chain

```
Layer 1: ML Prediction (Lorentzian KNN, K=8, 5 features)
  → Layer 2: Kernel Regression Filter (Nadaraya-Watson, Rational Quadratic)
    → Layer 3: Signal Type Change (isDifferentSignalType)
      → Layer 4: Trend Confirmation (trendx, Multiplier 1.6)
        → Layer 5: Prediction Strength (effectiveStrength >= minPredSum)
          → Layer 6: Cooldown (minBarsBetween)
            → Layer 7: Signal Fusion + Supertrend + Context
              → ENTRY
```

### ML Model Details
- Library: `jdehorty/MLExtensions/3`
- Features: RSI(14), WT(10,11), CCI(20), ADX(29), RSI(9)
- Distance: Lorentzian `log(1 + |diff|)`
- Neighbors: K=8 (configurable)
- Training: Labels based on 4-bar forward price direction
- Output: `prediction` sum (range ~-8 to +8)

### Signal Strength Composition
```
effectiveLongStrength = prediction
  + fusionV4Residual (ATR flip weight + engulfing weight + EMA weight)
  + squeezeLongBoost (0.25 on squeeze release)
  + divLongBoost (0.7 on bullish divergence)
  + contextLongBoost (channel/AVWAP boost)
```

Must exceed `minPredSum` (default 1.8) to pass.

### Trade Execution
- **Entry:** At close price when all 7 layers pass
- **Stop Loss:** `close - slAtrMult * ATR(14)` (default slAtrMult=0.5, very tight)
- **Take Profit:** `close + tpAtrMult * ATR(14)` (default tpAtrMult=6.85)
- **Trailing Stop:** Activates at `trailActivateR * riskDistance` (default 0.5R), trails at `trailAtrMult * ATR(14)`
- **Risk:Reward:** ~13.7:1 (asymmetric, designed for rare high-conviction moves)

### Exit Triggers (any one fires)
1. Stop loss hit (base or trailing)
2. Take profit hit
3. Time stop (if `useTimeStop=true`)
4. Signal-based exit (if `useSignalExits=true`)
5. Exit-state tightening (failed follow-through, context caution, etc.)

### Champion Config (current)
- Score: 152.47
- ROI: 91.7%
- Profit Factor: 3.56
- Max Drawdown: 2.88%
- Trade Count: 261
- Symbol: XRPUSDT 15m, 10k bars

### Optimizable Parameters (grouped by family)

| Family | Key Parameters | Currently Active |
|---|---|---|
| **ml-core** | neighborsCount, h, r, x, lag | Yes |
| **signal/risk** | slAtrMult, tpAtrMult, trailActivateR, trailAtrMult, minPredSum, minBarsBetween | Yes |
| **fusion** | useFusionV4, fusionV4 weights, useAtrFlipConfirm, useEngulfingConfirm | Yes |
| **supertrend** | supertrendAtrLen, supertrendFactor, useSupertrendFilter | Yes |
| **squeeze** | useSqueezeContext, squeezeLength, squeezeBbMult, squeezeKcMult, squeezeReleaseFreshBars, squeezeBoostValue | Yes |
| **divergence** | useDivergenceContext, divRsiLen, divPivotLeft/Right, divFreshBars, divBoostValues | Yes |
| **exit-state** | useTimeStop, useFailedFollowThroughTighten, usePartialDerisk, useContextCautionTighten, usePostEntrySqueezeCollapseTighten, useAdverseDivergenceTighten | All **false** (unexplored) |
| **avwap-context** | useAvwapContext, avwapSwingPeriod, etc. | **false** |
| **channel-context** | useChannelContext, channelDetectLength, etc. | **false** |

---

## 4. Autoresearch Cycle Flow

Triggered by: `npm run pine:autoresearch`

Command: `node scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json`

### Step-by-Step Cycle

```
1. Load config & resolve paths
2. Check convergence marker (state/converged.json)
   → If converged=true and not --force-cycle: skip
3. Load champion state (state/scheduler/*.json)
4. Normalize scheduler state (backfill missing fields)
5. Resolve current track (rotation logic)
6. Generate variant batch:
   a. Select patch pool for current track family
   b. Apply annealing temperature
   c. Scale patches relative to incumbent
   d. Filter by tabu (fingerprint dedup)
   e. Filter by gate-aware filter (slAtrMult floor)
   f. Build metadata + patch fingerprints
7. Run backtests (pinned dataset, offline):
   a. Flatten PineScript with injected parameters
   b. Execute via backtest-kit CLI
   c. Parse trade results + metrics
8. Score candidates (composite objective function)
9. Pareto shortlist (top N by score)
10. Evaluate matrix (primary lab + shadows):
    a. Primary lab: compare candidate vs champion
    b. If primary passes: evaluate shadow labs
    c. If primary fails + diagnosticShadowEvaluation: evaluate shadows anyway (diagnostic)
    d. Matrix decision: require primary pass + minShadowPassCount
11. Select best candidate from matrix
12. Update scheduler state:
    a. Track streaks (noChange, noNewCandidate, noScoreImprovement, lowEmission)
    b. Compute healthyCycleCount
    c. Compute stagnation level (escalate/de-escalate)
    d. Decide track rotation
    e. Update tabu fingerprints
13. Write manifest (cycle results JSON)
14. Auto-promote if all gates pass:
    a. Matrix promotion passed
    b. Candidate changed from champion
    c. Cooldown elapsed (12h)
    d. Daily quota not exceeded
    e. Blind holdout verification (if required)
15. Check convergence:
    a. If noScoreImprovementStreak >= convergeAfter AND escape exhausted: write converged.json
16. Cleanup: prune old runs per retention policy
```

### Cycle Outcomes

| Outcome | Meaning |
|---|---|
| `promoted` | New champion installed |
| `held` | Candidate found but didn't pass all gates |
| `no-new-candidate` | All variants were tabu or same as champion |
| `zero-emission` | Track couldn't generate any valid variants |
| `converged` | System declared convergence, stops cycling |
| `skipped` | Convergence marker exists, cycle not run |

---

## 5. Configuration Reference

Main config: `config/pine-autoresearch.default.json`

### Top-Level Keys

| Key | Purpose |
|---|---|
| `matrixId` | Unique research identity (`pine-fusion-v4-core-15m-locked-window`) |
| `scriptPath` | Path to PineScript file (`../pine/test.pine`) |
| `grid` | Grid profile name (`phase3-core`) |
| `searchPolicy` | Search mode, families, annealing, tabu, gate-aware filter |
| `researchBudget` | Budget allocation ratios across lanes |
| `researchTracks` | Array of track definitions (trackId, family, windowSet) |
| `rotationPolicy` | Track rotation triggers, stagnation config, de-escalation |
| `primaryLab` | Primary evaluation lab (symbol, timeframe, limit, thresholds) |
| `shadowLabs` | Array of shadow labs for cross-asset validation |
| `matrixPolicy` | Matrix promotion requirements (shadow pass count/ratio) |
| `autoPromotion` | Auto-promote settings (cooldown, daily quota, lineage) |
| `blindHoldoutLabs` | Unseen data labs for final verification |
| `complexityPolicy` | Penalty per activated/changed parameter |
| `pinnedData` | Dataset pinning config (exchange, source, cache paths) |
| `outputs` | Research root and digest root paths |
| `retention` | Artifact retention policy |
| `regimeExitResearch` | Regime-aware exit research lane config |

### Search Policy Detail

```json
"searchPolicy": {
  "mode": "incumbent-local",
  "exploitRatio": 0.5,
  "exploitFamilies": "signal risk exit-state ml-core fusion supertrend",
  "exploreFamilies": "signal risk exit-state ml-core fusion supertrend squeeze divergence avwap-context channel-context",
  "paretoShortlistSize": 12,
  "matrixCandidateLimit": 12,
  "selfLoopEscape": { "enabled": true, "activateAfter": 1, "includeFallback": true, ... },
  "gateAwareFilter": { "enabled": true, "slAtrMultMinRatio": 0.5 },
  "annealing": { "enabled": true, "baseTemperature": 0.4, "growthFactor": 1.8, "maxTemperature": 16 },
  "tabuPolicy": { "maxAgeCycles": 20, "maxEntries": 40, "maxSameCycleEntries": 24, "dropOnChampionChange": true }
}
```

### Primary Lab Thresholds

```json
"thresholds": {
  "minScoreDelta": 0.1,
  "minRoiDeltaPct": 0,
  "minProfitFactorDelta": 0,
  "maxDrawdownDeltaPct": 0.75,
  "minTradeCount": 150,
  "minTradeRatioVsIncumbent": 0.75,
  "roiRelaxation": {
    "enabled": true,
    "minScoreDeltaToRelax": 12,
    "maxRoiRegressionPct": 10,
    "tieredRelaxation": {
      "enabled": true,
      "pfMultiplierThreshold": 2,
      "ddImprovementRequired": true,
      "maxRoiRegressionPct": 20
    }
  }
}
```

### Labs Configuration

| Lab | Symbol | Timeframe | Bars | Role |
|---|---|---|---|---|
| xrpusdt-15m-primary | XRPUSDT | 15m | 10000 | Primary (must pass) |
| btcusdt-15m-current-shadow | BTCUSDT | 15m | 10000 | Shadow |
| ethusdt-15m-current-shadow | ETHUSDT | 15m | 10000 | Shadow |
| xrpusdt-15m-march-shadow | XRPUSDT | 15m | 5000 | Shadow (earlier window) |
| btcusdt-15m-march-shadow | BTCUSDT | 15m | 5000 | Shadow |
| ethusdt-15m-feb-shadow | ETHUSDT | 15m | 2500 | Shadow |
| xrpusdt-15m-nov2025-blind-holdout | XRPUSDT | 15m | 3000 | Blind holdout |
| btcusdt-15m-nov2025-blind-holdout | BTCUSDT | 15m | 3000 | Blind holdout |

---

## 6. Research Tracks & Patch Pools

### Configured Tracks

| Track ID | Family | Window Set | Purpose |
|---|---|---|---|
| `squeeze-context` | squeeze | primary | Optimize squeeze detection parameters |
| `divergence-context` | divergence | rotating | Optimize divergence detection |
| `exit-state-research` | exit-state | rotating | Explore exit management features |
| `ml-core-tuning` | ml-core | primary | Tune ML model parameters (h, r, x, lag, K) |
| `supertrend-tuning` | supertrend | rotating | Tune supertrend filter parameters |

### Patch Pool Families

Each family has a `*Patches(base)` function in `pine-track-generators.mjs` that generates parameter variants relative to the incumbent config.

**squeeze patches:** Vary squeezeLength, squeezeBbMult, squeezeKcMult, squeezeReleaseFreshBars, squeezeBoostValue

**divergence patches:** Vary divRsiLen, divPivotLeft/Right, divFreshBars, divLongBoostValue, divShortBoostValue

**exit-state patches (13 variants, 6 families):**
- Time stop: useTimeStop + timeStopBars + timeStopMinUnrealizedAtr (3 variants)
- Failed follow-through tighten: followThroughBars + minProgressAtr + tightenTrailAtrMult (2 variants)
- Partial de-risk: partialDeriskAtR + partialDeriskClosePct (2 variants)
- Context caution tighten: contextCautionDelta + contextCautionTrailAtrMult (2 variants)
- Post-entry squeeze collapse: postEntrySqueezeCollapseBars + collapseTrailAtrMult (2 variants)
- Adverse divergence tighten: adverseDivergenceBars + adverseDivergenceTrailAtrMult (2 variants)

**ml-core patches:** Vary neighborsCount, h, r, x, lag

**supertrend patches:** Vary supertrendAtrLen, supertrendFactor

**signal/risk patches:** Vary slAtrMult, tpAtrMult, trailActivateR, trailAtrMult, minPredSum, minBarsBetween

**fusion patches:** Vary fusionV4 weights, useAtrFlipConfirm, useEngulfingConfirm, useEmaCrossConfirm

### Fallback Families

When the primary track exhausts its pool (all tabu), fallback families activate:
- Default fallback: `signal risk ml-core fusion supertrend`
- Stagnation fallback (level ≥1): adds `squeeze divergence exit-state avwap-context channel-context`

### Temperature & Annealing

- `baseTemperature`: 0.4 (initial mutation scale)
- `growthFactor`: 1.8 (temperature grows with cycle index)
- `maxTemperature`: 16 (cap)
- `stagnationTemperatureBoost`: 4 (multiplier at high stagnation)
- Temperature scales patch magnitudes: higher temp = larger parameter jumps

### Gate-Aware Filter

Pre-emission filter that skips variants mechanically incompatible with promotion:
- If `config.slAtrMult < base.slAtrMult * slAtrMultMinRatio` (default 0.5): skip
- Prevents wasting budget on candidates that will definitely fail the ROI gate
- Applied in main loop, fallback loop, and self-loop-fallback loop

---

## 7. Scoring & Promotion Gates

### Composite Score Function

The objective function combines multiple metrics into a single score:
- ROI contribution
- Profit Factor contribution
- Drawdown contribution (inverse)
- Trade count contribution
- Win rate contribution
- Complexity penalty (per activated/changed parameter)

Score formula weights are internal to `pine-objective-function.mjs`.

### Promotion Gate Cascade

A candidate must pass ALL gates to promote:

```
1. Score Delta Gate: scoreDelta >= minScoreDelta (0.1)
2. ROI Gate: roiDeltaPct >= minRoiDeltaPct (0) OR roiRelaxation applies
3. Profit Factor Gate: pfDelta >= minProfitFactorDelta (0)
4. Drawdown Gate: drawdownDeltaPct <= maxDrawdownDeltaPct (0.75)
5. Trade Count Gate: tradeCount >= minTradeCount (150)
6. Trade Ratio Gate: tradeCount >= incumbent * minTradeRatioVsIncumbent (0.75)
7. Significance Gate: statistical significance of improvement
8. Expectancy Gate: trade expectancy non-regression
```

### ROI Relaxation (Two Tiers)

**Standard relaxation:**
- scoreDelta >= minScoreDeltaToRelax (12)
- roiRegression <= maxRoiRegressionPct (10%)

**Tiered relaxation (new):**
- scoreDelta >= minScoreDeltaToRelax (12)
- PF multiplier >= pfMultiplierThreshold (2x)
- DD improved (drawdownDeltaPct < 0)
- roiRegression <= tiered maxRoiRegressionPct (20%)

This allows high-PF, low-DD candidates to promote even with moderate ROI regression.

### Matrix Promotion

After primary lab passes, shadow labs are evaluated:
- `requirePrimaryPromote`: true (primary must pass first)
- `minShadowPassCount`: 3 (at least 3 shadows must pass)
- `minShadowPassRatio`: 0.6 (60% of shadows must pass)
- `diagnosticShadowEvaluation`: true (evaluate shadows even on primary failure for data collection)

### Auto-Promotion Requirements

1. Matrix promotion passed
2. Candidate config differs from champion
3. Cooldown elapsed (12 hours since last promotion)
4. Daily quota not exceeded (max 2 per day)
5. Lineage policy satisfied (family diversity)
6. Blind holdout verification passed (if required)

---

## 8. Stagnation & Escape Mechanisms

### Stagnation Level (0-6)

The system tracks how "stuck" the search is via `stagnationLevel`:

**Escalation triggers (any one can escalate):**
- `noNewCandidateStreak >= noNewCandidateEscalateAfter` (2)
- `noScoreImprovementStreak >= noScoreImprovementEscalateAfter` (2)
- `noChangeStreak >= holdEscalateAfter` (3)
- `lowEmissionStreak >= lowEmissionEscalateAfter` (3)
- `topCandidateSimilarity >= highSimilarityThreshold` (0.8)

**De-escalation (new):**
- Requires `deescalation.enabled = true`
- Triggers when system is "productive" for `consecutiveHealthyCycles` (2) consecutive cycles
- "Productive" = noNewCandidateStreak=0 AND noChangeStreak=0 AND lowEmissionStreak=0
- Excludes noScoreImprovementStreak (gate mismatch is not stagnation)
- Reduces level by 1 per trigger

**Reset to 0:**
- Only on `promotionEligible = true` (actual promotion)

### noScoreImprovementStreak Logic

Only counts as "score improved" when:
- `promotionEligible === true` (actually promoted), OR
- `primaryLabPassed === true` AND `bestScoreDelta > 0`

A candidate that scores higher but fails the primary lab gate does NOT reset the streak. This prevents false progress signals.

### Stagnation Effects

| Level | Effect |
|---|---|
| 0 | Normal operation |
| 1 | Broad fallback families activate, temperature boost begins |
| 2 | Stronger temperature boost, wider search |
| 3 | Progressive-widen escape, aggressive tabu pruning (maxAge/4) |
| 4+ | Maximum temperature, all families active |
| 6 | Max level cap |

### Escape Plans

`decideStagnationEscapePlan()` in `pine-stagnation-escape.mjs`:

1. **zero-emission-exhausted**: When current track can't emit any variants
   - Action: Force track rotation to next enabled track
2. **progressive-widen**: When stagnation level >= 1
   - Action: Widen search to include all families, boost temperature
3. **convergence**: When noScoreImprovementStreak >= convergeAfter (12) AND escape exhausted
   - Action: Write converged.json, stop cycling

### Track Rotation Triggers

| Trigger | Condition |
|---|---|
| `noChangeStreak` | Same candidate for N cycles |
| `noveltySimilarity` | Novelty signature repeating |
| `maxCyclesPerTrack` | Track exceeded 8 cycles |
| `zeroEmissionStagnation` | Track emitted 0 variants |
| `similarityRotateAbove` | Top candidate similarity > 0.99 |

---

## 9. Tabu System

Prevents re-evaluating previously rejected configurations.

### How It Works

1. Each candidate config gets a canonical fingerprint (`configFingerprint`)
2. Rejected candidates are added to `tabuRejectedFingerprints` in scheduler state
3. During variant generation, fingerprints are checked against the tabu set
4. Matching fingerprints are skipped (not emitted)

### Tabu Policy

```json
"tabuPolicy": {
  "maxAgeCycles": 20,
  "maxEntries": 40,
  "maxSameCycleEntries": 24,
  "dropOnChampionChange": true
}
```

- **maxAgeCycles**: Entries older than 20 cycles are pruned
- **maxEntries**: Hard cap at 40 entries total
- **maxSameCycleEntries**: Max 24 entries from a single cycle (flood cap)
- **dropOnChampionChange**: Clear tabu when champion changes (new search surface)

### Stagnation-Scaled Pruning

At high stagnation levels, tabu age horizon shrinks:
- Level 0: maxAge = 20
- Level 3: maxAge = 20/4 = 5 cycles
- This allows previously-rejected configs to be re-evaluated with different context

### Patch Fingerprints

Each variant also carries a `patchFingerprint` (what was changed from incumbent) and `patchFingerprintVersion` for deduplication within a batch.

---

## 10. Lab Evaluation & Matrix Decision

### Lab Evaluation Flow

```
1. Flatten PineScript with candidate parameters injected
2. Run backtest-kit CLI on pinned dataset
3. Parse output: trades, metrics, equity curve
4. Compute composite score
5. Compare candidate vs champion (decideAutoresearchOutcome)
6. Return decision: promote | hold | reject
```

### decideAutoresearchOutcome

The core comparison function in `scripts/lib/pine-autoresearch.mjs`:

**Inputs:** incumbent metrics, challenger metrics, thresholds, complexity policy

**Computes:**
- scoreDelta, roiDeltaPct, profitFactorDelta, drawdownDeltaPct
- tradeCount checks, trade ratio
- ROI relaxation (standard + tiered)
- Complexity penalties

**Returns:** `{ recommendation, summary, comparisons, gates }`

### Matrix Decision Flow

```
1. Evaluate primary lab
2. If primary passes (recommendation = 'promote'):
   a. Evaluate all shadow labs in parallel
   b. Count shadow passes
   c. Check minShadowPassCount (3) and minShadowPassRatio (0.6)
3. If primary fails AND diagnosticShadowEvaluation=true:
   a. Evaluate shadows anyway (best-effort, errors swallowed)
   b. Store as diagnosticShadowResults (no promotion)
4. decideMatrixPromotion: combine primary + shadow verdicts
```

### Diagnostic Shadow Results

When primary fails but diagnostic evaluation is enabled, shadow results are stored in the manifest:
```json
"diagnosticShadowResults": [
  { "labId": "btcusdt-15m-current-shadow", "recommendation": "promote", "scoreDelta": 12.5, "roiDeltaPct": -8.2 },
  { "labId": "ethusdt-15m-current-shadow", "recommendation": "hold", "scoreDelta": 3.1, "roiDeltaPct": -22.1 }
]
```

This data reveals whether rejected candidates generalize across assets.

---

## 11. Scheduler State Machine

### State File Location

`pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/pine-fusion-v4-core-15m-locked-window.json`

### State Fields

| Field | Type | Purpose |
|---|---|---|
| `activeTrackId` | string | Currently active research track |
| `cycleIndex` | int | Current cycle number |
| `noChangeStreak` | int | Consecutive cycles with same candidate |
| `noNewCandidateStreak` | int | Consecutive cycles with no new candidate |
| `noScoreImprovementStreak` | int | Consecutive cycles without primary lab pass + score improvement |
| `lowEmissionStreak` | int | Consecutive cycles with few emitted variants |
| `sameTrackCycleStreak` | int | Consecutive cycles on same track |
| `_healthyCycleCount` | int | Consecutive productive cycles (for de-escalation) |
| `stagnationLevel` | int | Current stagnation level (0-6) |
| `stagnationReason` | string | Why stagnation escalated/de-escalated |
| `lastEscalatedAt` | ISO string | When stagnation last escalated |
| `lastRotationTrigger` | string | What caused last track rotation |
| `lastChampionFingerprint` | string | Fingerprint of current champion |
| `lastCandidateFingerprint` | string | Fingerprint of last evaluated candidate |
| `lastNoveltySignature` | string | Novelty signature for repeat detection |
| `tabuRejectedFingerprints` | array | Tabu entries with fingerprint + cycle + champion |
| `blockedPromotionFingerprints` | array | Candidates blocked by promotion gates |
| `laneExhaustions` | object | Per-lane exhaustion tracking |

### State Transitions (nextTrackState)

Called after each cycle with the manifest results:

```js
nextTrackState({ state, policy, manifest }) => newState
```

1. Compute all streaks from manifest data
2. Compute `healthyCycleCount` (productive = no noNewCandidate, noChange, lowEmission)
3. Call `nextStagnationState()` with streaks + policy + healthyCycleCount
4. Decide track rotation (if triggers met)
5. Update tabu fingerprints (add rejected, prune old)
6. Return new state

### Backward Compatibility

`normalizeSchedulerState()` handles missing fields by defaulting to `defaultSchedulerState()` values. Old state files without `_healthyCycleCount` get it defaulted to 0.

---

## 12. Manifest Structure

Each cycle produces a manifest JSON in `manifests/` directory.

### Manifest File Naming

`pine-fusion-v4-core-15m-locked-window-<ISO-timestamp>.json`

### Key Manifest Fields

```json
{
  "matrixId": "pine-fusion-v4-core-15m-locked-window",
  "runId": "<uuid>",
  "generatedAt": "<ISO timestamp>",
  "cycleIndex": 25,
  "activeTrackId": "squeeze-context",
  "source": "track:squeeze-context",
  "searchEfficiency": {
    "emittedVariantCount": 12,
    "tabuSkippedCount": 3,
    "allCandidatesTabu": false
  },
  "bestScoreDelta": 19.86,
  "promotionEligible": false,
  "primaryLabPassed": false,
  "noNewCandidate": false,
  "stagnationLevel": 3,
  "stagnationReason": "noScoreImprovementStreak",
  "stagnationEscape": { "plan": "progressive-widen", "reason": "zero-emission-exhausted" },
  "rotationTrigger": null,
  "topCandidateSimilarity": 0.6,
  "candidateFingerprint": "<hash>",
  "championFingerprint": "<hash>",
  "robustness": {
    "aggregateScoreDelta": 45.2,
    "aggregateRoiDeltaPct": -12.3,
    "aggregateProfitFactorDelta": 8.7,
    "aggregateDrawdownDeltaPct": -3.2
  },
  "diagnosticShadowResults": [...],
  "cycleSummary": {
    "champion": { "score": 152.47, "roiPct": 91.7, "profitFactor": 3.56, ... },
    "bestCandidate": { "score": 172.33, "roiPct": 76.41, "profitFactor": 9.14, ... },
    "gateResults": { "primaryPromote": false, "roiRelaxationApplied": false, ... }
  }
}
```

---

## 13. CLI Commands & npm Scripts

### Core Commands

| Command | Purpose |
|---|---|
| `npm run pine:autoresearch` | Run one research cycle |
| `npm run pine:autoresearch:micro` | Run with micro profile (2 configs, faster) |
| `npm run pine:autoresearch:digest` | Generate human-readable digest of recent cycles |
| `npm run pine:autoresearch:promote` | Manually promote a candidate |
| `npm run pine:autoresearch:autopromote` | Run auto-promotion logic on pending candidates |

### Dataset Commands

| Command | Purpose |
|---|---|
| `npm run pine:dataset:pin` | Pin datasets from exchange to local cache |
| `npm run pine:dataset:stage` | Stage datasets for evaluation |
| `npm run pine:dataset:verify` | Verify dataset integrity |

### LLM Lane Commands

| Command | Purpose |
|---|---|
| `npm run pine:autoresearch:llm` | Run LLM-assisted research cycle |
| `npm run pine:autoresearch:llm:propose` | LLM proposes parameter changes |
| `npm run pine:autoresearch:llm:digest` | Digest LLM research results |
| `npm run pine:autoresearch:llm:validate` | Validate LLM proposals |
| `npm run pine:autoresearch:llm:review-status` | Check LLM review queue |
| `npm run pine:autoresearch:llm:review-resolve` | Resolve pending LLM reviews |

### Operational Commands

| Command | Purpose |
|---|---|
| `npm run pine:ops:install-tasks` | Install Windows scheduled tasks for autoresearch |
| `npm run pine:ops:remove-tasks` | Remove scheduled tasks |
| `npm run pine:ops:install-llm-tasks` | Install LLM lane scheduled tasks |
| `npm run pine:ops:scheduler-health` | Check scheduler health |
| `npm run pine:ops:install-force-cycle-task` | Install force-cycle task (bypasses convergence) |

### Other Commands

| Command | Purpose |
|---|---|
| `npm run pine:run` | Import and run a single PineScript backtest |
| `npm run pine:sweep` | Run a parameter sweep |
| `npm run pine:analyze` | Analyze/optimize results |
| `npm test` | Run all tests |

---

## 14. LLM-Assisted Research Lane

A separate research lane that uses LLMs to propose parameter changes.

### Architecture

```
pine-autoresearch-llm.mjs (entry)
  → pine-autoresearch-llm-runner.mjs (orchestration)
    → pine-autoresearch-llm-context.mjs (build context for LLM)
    → pine-autoresearch-llm-provider.mjs (LLM API abstraction)
    → pine-autoresearch-llm-openai-provider.mjs (OpenAI implementation)
    → pine-autoresearch-llm-evaluator.mjs (evaluate LLM proposals)
    → pine-autoresearch-llm-quality.mjs (quality scoring)
    → pine-autoresearch-llm-review-queue.mjs (human review queue)
    → pine-autoresearch-llm-memory.mjs (cross-cycle memory)
    → pine-autoresearch-llm-ledger.mjs (cost tracking)
```

### Config

`config/pine-autoresearch-llm.default.json` — controls:
- Model selection
- Allowlisted parameters (which knobs the LLM can touch)
- Budget limits
- Review queue settings

`config/pine-autoresearch-llm-allowlist.default.json` — explicit parameter allowlist

### Flow

1. Build context: current champion, recent manifests, performance history
2. LLM proposes parameter changes with reasoning
3. Validate proposals against allowlist and bounds
4. Evaluate proposed configs via backtest
5. Queue for human review if quality threshold met
6. Promote if approved

---

## 15. Operational Procedures

### Starting a Fresh Research Campaign

1. Pin datasets: `npm run pine:dataset:pin`
2. Verify datasets: `npm run pine:dataset:verify`
3. Ensure champion config exists in `config/pine-autoresearch-seed-b2.json`
4. Run first cycle: `npm run pine:autoresearch`
5. Install scheduled tasks: `npm run pine:ops:install-tasks`

### Monitoring

- Check scheduler health: `npm run pine:ops:scheduler-health`
- View recent results: `npm run pine:autoresearch:digest`
- Read latest manifest in `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/manifests/`
- Check scheduler state: read `state/scheduler/*.json`

### Recovering from Convergence

1. Delete `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/converged.json`
2. Run next cycle: `npm run pine:autoresearch`

Or use `--force-cycle` flag to bypass without deleting.

### Recovering from Stagnation

The system self-recovers via:
- Track rotation (switches to different parameter family)
- Stagnation escape (progressive-widen, zero-emission-exhausted)
- De-escalation (reduces stagnation level after productive cycles)
- Tabu pruning (aggressive at high stagnation, allows re-evaluation)

Manual intervention:
- Reset scheduler state to lower stagnation level
- Clear tabu entries
- Change champion (triggers tabu drop)

### Promoting Manually

```bash
npm run pine:autoresearch:promote -- --run-id <uuid>
```

### Running Tests

```bash
# All tests
npm test

# Specific test file
node --test tests/pine-autoresearch.test.mjs

# Pattern match
node --test --test-name-pattern="tiered ROI" tests/pine-autoresearch.test.mjs

# Hardening suite
npm run test:pine:autoresearch:hardening
```

---

## 16. Recent Structural Fixes (2026-05-16)

### Commits

| Commit | Description |
|---|---|
| `58ff753` | **Tiered ROI relaxation** — When PF improves >2x AND DD improves, allow up to 20% ROI regression (vs standard 10%) |
| `b9d37ae` | **noScoreImprovementStreak fix** — Only resets on primary lab pass, not raw score delta. Prevents false progress signals. |
| `9f965b1` | **Stagnation de-escalation** — Level drops by 1 after 2 consecutive productive cycles. Uses "productive" definition (excludes noScoreImprovementStreak). |
| `233ddf5` | **Exit-state patch pool expansion** — From 3 patches (timeStop only) to 13 patches across 6 feature families. |
| `9828b13` | **Diagnostic shadow evaluation** — Shadows run even on primary failure (best-effort). Results stored in manifest. |
| `2c5f9d5` | **Gate-aware search filter** — Skips variants with slAtrMult below 50% of champion. Prevents wasting budget on ROI-hostile candidates. |
| `1ea0b6d` | **diagnosticShadowResults capture fix** — Was missing from evaluateMatrix destructuring. |
| `df8366a` | **De-escalation productive-cycle fix** — Excludes noScoreImprovementStreak from healthy-cycle definition. Fixes interaction between Task 2 and Task 3. |

### Critical Design Flaw Found & Fixed

The interaction between the streak fix (Task 3) and de-escalation (Task 2) created a near-impossible condition:
- Task 3 makes noScoreImprovementStreak increment whenever primaryLabPassed=false
- Task 2 originally required ALL streaks at 0 for de-escalation
- Since the ROI gate blocks primary lab pass, noScoreImprovementStreak is almost always > 0
- De-escalation could never trigger

**Fix:** "Productive cycle" for de-escalation now means: emitting variants + finding new candidates + not in low-emission. The noScoreImprovementStreak is explicitly excluded because it signals a gate mismatch, not actual stagnation.

---

## Appendix A: Untapped Indicators in PineScript

Indicators computed but NOT wired into trade decisions:

| Indicator | Lines | Potential Use |
|---|---|---|
| SuperTrend AI (K-Means Clustering) | 1220-1400 | Replace fixed supertrend with adaptive factor selection |
| Mean Reversion Channel (MRC) | 1405-1640 | Exit shaping — tighten trail when overbought |
| Market Structure Break (MSB) | 1690-1870 | Context boost/penalty to prediction strength |
| 4 Smoothed Moving Averages | 1060-1090 | Trend regime classification |
| EMA Cross (38/62) | 1140-1190 | Redundant with kernel regression |
| Fibonacci Channel | 60-63 | Support/resistance zones |

All are exported as `Feature_*` plots for the autoresearch regime analysis system.

---

## Appendix B: Signal Plot Color Reference

| Plot | Color | Meaning |
|---|---|---|
| Buy label (line 1035) | Dark green → Light green | ML prediction strength (darker = stronger) |
| Sell label (line 1036) | Dark red → Light red | ML prediction strength (darker = stronger) |
| Primary supertrend buy (line 28-29) | Green circle + label | ATR supertrend (Mult 0.8) flip to bullish |
| Confirmation supertrend buy (line 47-48) | Bright green rgb(0,255,0) | ATR supertrend (Mult 1.6) flip to bullish |
| Primary supertrend sell (line 32-33) | Red circle + label | ATR supertrend (Mult 0.8) flip to bearish |
| Confirmation supertrend sell (line 51-52) | Bright red rgb(255,0,0) | ATR supertrend (Mult 1.6) flip to bearish |
| Kernel estimate (line 345) | Teal/Red | Nadaraya-Watson kernel direction |
| Bar colors | Gradient teal→red | ML prediction direction + strength |
| Conservative entry B/S | Lime/Red chars | EMA 38/62 cross (display only) |
| 3 Line Strike | Green/Red triangles | Candlestick pattern (display only) |
| Engulfing | Green/Red tiny triangles | Engulfing pattern (active in fusion) |
| Trend triangles | Lime/Red at screen edges | EMA 38>62 trend direction |

---

## Appendix C: Test Coverage

| Test File | Count | Covers |
|---|---|---|
| pine-autoresearch.test.mjs | 249 | Lab decisions, scoring, matrix, promotion, holdout |
| pine-autoresearch-tracks.test.mjs | 66 | Scheduler state, stagnation, de-escalation, streaks |
| pine-track-generators.test.mjs | 34 | Patch pools, gate-aware filter, fallback, annealing |
| pine-stagnation-escape.test.mjs | ~7 | Escape plan decisions |
| pine-autoresearch-tabu-saturation.test.mjs | ~1 | Tabu saturation edge cases |
| pine-regime-analysis.test.mjs | ~8 | Regime classification |
| pine-optimizer.test.mjs | ~8 | Pareto optimization |
| pine-streaming-metrics.test.mjs | ~6 | MFE/MAE streaming |

Total: ~380 tests, all passing.

---

*End of documentation.*
