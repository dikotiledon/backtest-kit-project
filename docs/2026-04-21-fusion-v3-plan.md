# 2026-04-21 Fusion V3 Plan

## Goal
Build a more aggressive but still controlled fusion path that can materially alter entry selection without collapsing the trade book like Fusion v1.

## Why V3 exists
- Fusion v1 hard-gated entries and destroyed the book.
- Fusion v2 applied bonus-only soft fusion, but on the locked 10,000-bar benchmark it stayed neutral. Bonuses were active, yet entry outcomes stayed identical to control.

## Fusion v3 design
Use **confirmation-aware penalty + bonus threshold shaping**.

### Formula
- `fusionBonus = min(fusionMaxBonus, fusionScore * fusionBonusPerSignal)`
- `fusionPenalty = max(0, enabledConfirmCount - fusionScore) * fusionPenaltyPerMissing`
- `effectiveStrength = rawStrength + fusionBonus - fusionPenalty`
- Entry passes when `effectiveStrength >= minPredSum`

### Intended behavior
- confirmed setups get a lift
- weak, poorly confirmed setups get filtered
- unlike v1, no binary all-or-nothing block
- unlike v2, missing confirmations actually cost something

## Inputs
- `useFusionV3`
- `fusionPenaltyPerMissing`
- existing `fusionBonusPerSignal`
- existing `fusionMaxBonus`

## Diagnostics
- `Feature_LongFusionPenalty`
- `Feature_ShortFusionPenalty`
- existing bonus and effective-strength diagnostics stay active

## Locked benchmark
- Symbol: `XRPUSDT`
- Timeframe: `15m`
- Bars: `10000`
- Anchor: `2026-04-21T10:30:00.000Z`

## Sweep
Control plus Fusion v3 grid:
- `minPredSum`: `[0.5, 0.75, 1.0]`
- `fusionBonusPerSignal`: `[0.25, 0.5]`
- `fusionMaxBonus`: `[0.5, 1.0]`
- `fusionPenaltyPerMissing`: `[0.25, 0.5]`
- `use3LineConfirm`: `[false, true]`
- `useEmaCrossConfirm`: `[false, true]`
- fixed: `useAtrFlipConfirm=true`, `useEngulfingConfirm=false`

## Exit condition
- Fusion v3 benchmark complete on locked data
- best variant compared against control
- recommendation states whether v3 improves, harms, or remains neutral
