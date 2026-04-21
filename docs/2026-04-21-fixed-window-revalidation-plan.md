# 2026-04-21 Fixed-Window Revalidation Plan

## Goal
Revalidate the current control and shortlisted fusion candidates on the exact same XRPUSDT 15m 10,000-bar window so strategy selection is based on apples-to-apples data.

## Locked benchmark window
- Symbol: `XRPUSDT`
- Timeframe: `15m`
- Limit: `10000`
- Anchor (`--when`): `2026-04-21T10:30:00.000Z`
- Reason: user requested exact data lock now; this anchor is the last fully closed 15m bar before the request timestamp.

## Configs to compare
### Control
- `useSignalFusion=false`
- `minPredSum=0.5`
- `useTrendXConf=true`
- `minBarsBetween=2`
- `useRegimeFilter=false`
- `useVolatilityFilter=false`
- `useAdxFilter=true`
- `adxThreshold=20`
- `slAtrMult=1.0`
- `tpAtrMult=2.5`

### Shortlist A, ATR only
- `useSignalFusion=true`
- `minFusionScore=1`
- `useAtrFlipConfirm=true`
- `use3LineConfirm=false`
- `useEngulfingConfirm=false`
- `useEmaCrossConfirm=false`

### Shortlist B, ATR + EMA
- `useSignalFusion=true`
- `minFusionScore=1`
- `useAtrFlipConfirm=true`
- `use3LineConfirm=false`
- `useEngulfingConfirm=false`
- `useEmaCrossConfirm=true`

### Shortlist C, ATR + 3 Line Strike
- `useSignalFusion=true`
- `minFusionScore=1`
- `useAtrFlipConfirm=true`
- `use3LineConfirm=true`
- `useEngulfingConfirm=false`
- `useEmaCrossConfirm=false`

## Execution
1. Run all configs inside one shared revalidation directory.
2. Pass the same `--when` and `--limit 10000` to every run.
3. Keep artifacts and cached candles for auditability.
4. Rank by score, then ROI, then win rate.
5. Prefer configs with meaningful trade count over tiny-sample outliers.

## Exit condition
- All four configs executed on the same locked window.
- Shared-window leaderboard saved.
- Recommendation names the best config and explains the trade-count tradeoff.
