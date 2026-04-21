# 2026-04-21 Signal Fusion Implementation Plan

## Goal
Upgrade `pine/test.pine` from a single canonical ML entry path into a measurable multi-signal fusion engine, while keeping backtest-kit compatibility and avoiding unsafe long-only/short-only concepts.

## Constraints
- Final script must keep both long and short paths available.
- Use TDD for every behavior change.
- Keep existing backtest-kit outputs (`Signal`, `StopLoss`, `TakeProfit`, `EstimatedTime`) intact.
- Prefer deterministic closed-bar signals first.
- Do not wire signal families with unclear repaint behavior into the first fusion pass.

## Signal-family review
### Safe enough for first fusion pass
1. `buySignal` / `sellSignal` (ATR trend flip labels, defined early)
2. `buySignalx` / `sellSignalx` (confirmation trend flip labels, defined early)
3. 3 Line Strike (`bullSig` / `bearSig`)
4. Engulfing (`bullishEngulfing` / `bearishEngulfing`)
5. EMA 38/62 conservative entry condition (`entryUpTrend` / `entryDnTrend`) via duplicated deterministic formula near entry engine

### Hold out for later pass
1. `market` / MSB order-block state, because zigzag-style structure logic may revise interpretation and needs dedicated validation
2. SuperTrend AI clustering state
3. MRC / MTF conditions
4. RSI divergence-like visual labels from chart screenshot, because no clean machine entry variable is currently wired/exported in the executable path

## Execution steps
### Step 1, add tests first
- Add RED tests for new tuner patch support:
  - `useSignalFusion`
  - `minFusionScore`
  - `useAtrFlipConfirm`
  - `use3LineConfirm`
  - `useEngulfingConfirm`
  - `useEmaCrossConfirm`
- Add RED tests for a new candidate grid `fusion-safe`
- Add RED tests for optimizer diagnostics to count fusion-score pass/block outputs

### Step 2, implement Pine fusion engine
- Add fusion inputs in `pine/test.pine`
- Compute deterministic confirmation booleans near entry engine:
  - ATR flip confirm from `buySignal` / `sellSignal`
  - 3 Line Strike confirm
  - Engulfing confirm
  - EMA 38/62 conservative entry confirm
- Compute:
  - enabled fusion source count
  - `longFusionScore`
  - `shortFusionScore`
  - `longFusionPass`
  - `shortFusionPass`
- Preserve current behavior when fusion is disabled or min score is `0`
- Gate `startLongTrade` / `startShortTrade` with fusion pass

### Step 3, export diagnostics
Add data-window exports for:
- `Feature_LongFusionScore`
- `Feature_ShortFusionScore`
- `Feature_LongFusionPass`
- `Feature_ShortFusionPass`
- `Feature_AtrFlipBull`
- `Feature_AtrFlipBear`
- `Feature_EmaCrossBull`
- `Feature_EmaCrossBear`
- `Feature_BlockLong_Fusion`
- `Feature_BlockShort_Fusion`

### Step 4, implement tuner support
- Add patchers for fusion inputs
- Add candidate grid `fusion-safe`
- Keep exit-tuning baseline parameters from best all-condition run as the control branch:
  - `useRegimeFilter=false`
  - `useVolatilityFilter=false`
  - `useAdxFilter=true`
  - `adxThreshold=20`
  - `minPredSum=0.5`
  - `useTrendXConf=true`
  - `minBarsBetween=2`
  - `slAtrMult=1.0`
  - `tpAtrMult=2.5`

### Step 5, run validation and sweep
- Run `npm test`
- Run a focused `fusion-safe` sweep on XRPUSDT 15m 5000
- Rank configs by score, then ROI, then win rate
- Compare against the current best all-condition baseline

## First sweep grid
- `useSignalFusion: [false, true]`
- `minFusionScore: [1, 2]`
- `useAtrFlipConfirm: [false, true]`
- `use3LineConfirm: [false, true]`
- `useEngulfingConfirm: [false, true]`
- `useEmaCrossConfirm: [false, true]`

## Exit condition
- Plan file exists in project
- Fusion implementation merged into `pine/test.pine`, tuner, and tests
- Tests green
- First safe-fusion sweep completed
- Recommendation compares safe-fusion results against current best all-condition baseline
