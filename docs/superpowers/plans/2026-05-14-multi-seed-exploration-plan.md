# Multi-Seed Exploration Plan — Breaking the Local Optimum

**Date:** 2026-05-14
**Status:** Implemented and running

## Problem Statement

The autoresearch system was stuck in a local optimum:
- Champion: score 153.25, ROI 92.32%, PF 3.58, 261 trades, max DD 2.88%
- Only 6 of 20 available trading features were enabled
- 14 features (AVWAP, Channel, Context Aggregator, Exit-State features, filters) were NEVER explored
- Local search (mutate 1-2 params) cannot make multi-dimensional jumps to enable new feature combinations

## Root Cause Analysis

The "incumbent-local" search mode mutates 1-2 parameters at a time from the current champion. To enable a new feature like `useAvwapContext`, you need to:
1. Flip the boolean to `true`
2. Set 3-5 sub-parameters to reasonable values simultaneously

A single-axis mutation of just the boolean (with default sub-params) won't beat a champion refined over 74 cycles. This is a fundamental limitation of local search — it cannot cross fitness valleys.

## Solution: Multi-Seed Benchmarking

Instead of relying on local search to discover new feature combinations, we:
1. Manually created 5 exploration seeds with different feature combinations enabled
2. Benchmarked each against the primary lab (XRPUSDT 15m, 10000 bars)
3. Identified the most promising direction
4. Replaced the champion with the best seed to let the optimizer refine it

## Benchmark Results

### Round 1 (5 seeds)

| Seed | Features Enabled | Score | Trades | ROI | WR |
|------|-----------------|-------|--------|-----|-----|
| B: Adaptive Exits | FollowThrough + TimeStop + PartialDerisk | **141.02** | 266 | 77.91% | **47.37%** |
| D: Fusion V3 + Context | V3 penalty + all confirms + aggregator | 112.96 | 135 | 50.96% | 43.7% |
| A: Context-Rich Entry | AVWAP + Channel + Aggregator (hostile=true) | 84.58 | 46 | 18.02% | 43.48% |
| E: Kitchen Sink | Everything enabled | 84.87 | 45 | 17.27% | 44.44% |
| C: Multi-Filter Regime | Regime + Volatility + EMA + ST confirm | -50 | 0 | 0% | 0% |

### Round 2 (refined seeds)

| Seed | Features Enabled | Score | Trades | ROI | WR |
|------|-----------------|-------|--------|-----|-----|
| **B2: Exits + Full TP** | FollowThrough + TimeStop + PartialDerisk (tpAtrMult=7.6) | **144.64** | 263 | 80.91% | **48.29%** |
| A2: Context (no hostile) | AVWAP + Channel + Aggregator (hostile=false) | 84.58 | 46 | 18.02% | 43.48% |
| B3: Exits + Context | B2 + A2 combined | 84.58 | 46 | 18.02% | 43.48% |

## Key Findings

1. **Exit-state features are the most promising direction** — Seed B2 achieves 48.29% win rate (vs champion's ~43%) with similar trade count
2. **Context Aggregator kills entries** — Even with `contextHostileBlocksEntry=false`, enabling AVWAP + Channel + Aggregator reduces trades from 261 to 46. The context system's internal hostile detection is too aggressive.
3. **Multi-filter stacking is lethal** — Regime + Volatility + EMA + Supertrend confirm = zero signals
4. **Fusion V3 penalty is too restrictive** — Requiring all 4 confirmation signals halves trade count

## What Was Implemented

1. **New champion:** Seed B2 (score 144.64, 263 trades, 80.91% ROI, 48.29% WR)
   - Enables: `useFailedFollowThroughTighten`, `useTimeStop`, `usePartialDerisk`
   - Key params to tune: `followThroughBars`, `timeStopBars`, `timeStopMinUnrealizedAtr`, `partialDeriskAtR`, `partialDeriskClosePct`

2. **Seed config updated:** `config/pine-autoresearch-seed-b2.json`

3. **Scheduler state reset:** Clean slate, cycle 0, no tabu entries, exit-state-research track active

4. **Budget debt:** exploit=100 to force the system to optimize from the new champion immediately

## Expected Outcome

The optimizer will now:
1. Start from B2 (with exit-state features enabled)
2. Tune the 6 exit-state parameters (followThroughBars, timeStopBars, etc.)
3. Also tune risk/exit params (trailAtrMult, trailActivateR, slAtrMult)
4. The score gap (144.64 → 153.25+) should be closeable because:
   - `partialDeriskAtR=1.5` is likely too aggressive (try 2.0-3.0)
   - `partialDeriskClosePct=50` might be too high (try 25-30%)
   - `timeStopBars=12` might be too short (try 15-20)
   - `followThroughMinProgressAtr=0.5` might be too strict (try 0.25-0.3)

## Files Created/Modified

- `config/exploration-seeds.json` — Round 1 seeds (5 variants)
- `config/exploration-seeds-v2.json` — Round 2 refined seeds (3 variants)
- `config/pine-autoresearch-seed-b2.json` — New seed config
- `config/pine-autoresearch.default.json` — Updated seedChampion path
- `pine/autoresearch/.../champion.json` — Replaced with B2
- `pine/autoresearch/.../state/scheduler/...json` — Reset to cycle 0

## Next Steps (Manual)

1. Run `node scripts/pine-autoresearch.mjs` to start optimization from B2
2. Monitor first 5-10 cycles for improvement
3. If score exceeds 153.25, the system has found a better configuration
4. If stuck again after 20 cycles, consider:
   - Reducing `partialDeriskClosePct` to 25%
   - Increasing `partialDeriskAtR` to 2.5
   - Disabling `usePartialDerisk` and keeping only TimeStop + FollowThrough