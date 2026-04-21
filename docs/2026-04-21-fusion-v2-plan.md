# 2026-04-21 Fusion V2 Plan

## Goal
Replace the current hard-block fusion behavior with a softer Fusion v2 path that preserves most baseline entries while letting confirmations boost borderline setups.

## Problem from locked benchmark
On the locked XRPUSDT `15m` `10000`-bar window, hard fusion reduced trades from `277` to about `30-33` and flipped ROI from `+37.49%` to negative. The failure mode is over-suppression, not missing signal families.

## Fusion v2 design
### Core change
Use confirmations as a **prediction-strength bonus**, not a hard entry gate.

### Formula
- `longFusionBonus = min(fusionMaxBonus, longFusionScore * fusionBonusPerSignal)`
- `shortFusionBonus = min(fusionMaxBonus, shortFusionScore * fusionBonusPerSignal)`
- `effectiveLongStrength = prediction + longFusionBonus`
- `effectiveShortStrength = -prediction + shortFusionBonus`

### Entry rule
- Replace raw strength checks with effective strength checks.
- When Fusion v2 is enabled, bypass the legacy hard fusion gate so confirmations nudge borderline trades instead of deleting most of the book.

## Inputs
- `useFusionV2`
- `fusionBonusPerSignal`
- `fusionMaxBonus`

## Diagnostics
Add data-window exports for:
- `Feature_LongFusionBonus`
- `Feature_ShortFusionBonus`
- `Feature_EffectiveLongStrength`
- `Feature_EffectiveShortStrength`

## TDD sequence
1. Add failing tests for tuner patch support and new candidate grid `fusion-v2`.
2. Add failing diagnostics test for bonus/effective-strength summaries.
3. Implement minimal tuner + optimizer changes.
4. Implement minimal Pine changes.
5. Run full tests.
6. Run fixed-window `10000`-bar revalidation against the same locked anchor.

## First v2 sweep shortlist
Control:
- fusion off

Candidates:
1. ATR only, `fusionBonusPerSignal=0.25`, `fusionMaxBonus=0.5`
2. ATR + EMA, `fusionBonusPerSignal=0.25`, `fusionMaxBonus=0.5`
3. ATR + 3-line, `fusionBonusPerSignal=0.25`, `fusionMaxBonus=0.5`
4. ATR only, `fusionBonusPerSignal=0.5`, `fusionMaxBonus=1.0`

## Exit condition
- Fusion v2 implemented with tests first
- fixed-window comparison saved
- final recommendation states whether Fusion v2 beats or still loses to control
