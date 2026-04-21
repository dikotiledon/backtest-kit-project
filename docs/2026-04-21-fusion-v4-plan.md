# 2026-04-21 Fusion V4 Plan

## Goal
Replace count-based confirmation stacking with a side-specific residual layer that only intervenes where the base ML signal is ambiguous.

## Root cause from V1-V3
- Hard gating (V1) destroyed the trade book.
- Soft additive bonus (V2) was active but neutral.
- Threshold shaping (V3) changed the book, but underperformed because it still assumed confirmation counts are reliable evidence.
- Locked-window analysis showed real entry strength is quantized (`2, 4, 6, 8`) and several confirmation signals are weak, sparse, or anti-predictive on the actual trades being taken.

## Fusion V4 design
### Core idea
Use a **residual layer**, not a score-stacking layer.

### Rules
- Only active when `|prediction|` is inside an ambiguity band.
- Outside that band, leave the base model untouched.
- Apply side-specific residual weights to selected confirmation features.
- Preserve deterministic closed-bar behavior.

### Formula
- `fusionV4RangeActive = useFusionV4 and |prediction| in [minAbsPrediction, maxAbsPrediction]`
- `longResidual = sum(active long feature weights)`
- `shortResidual = sum(active short feature weights)`
- `effectiveLongStrength = raw + v2Bonus - v3Penalty + longResidual`
- `effectiveShortStrength = raw + v2Bonus - v3Penalty + shortResidual`

## Initial evidence-driven defaults
- Ambiguity band: `2.0 .. 4.0`
- Long ATR: `-0.25`
- Long Engulf: `-0.25`
- Long EMA: `0.0`
- Short ATR: `-0.5`
- Short Engulf: `-0.1`
- Short EMA: `0.0`

## Diagnostics
- `Feature_LongFusionV4Residual`
- `Feature_ShortFusionV4Residual`
- `Feature_FusionV4Active`

## Benchmark protocol
- Symbol: `XRPUSDT`
- Timeframe: `15m`
- Bars: `10000`
- Anchor: `2026-04-21T10:30:00.000Z`
- Compare against control at `minPredSum=2.0` (behaviorally same as current live control on actual starts)

## Adoption decision
- Adopted as the shipped default profile in `pine/test.pine`
- Shipped defaults now mirror best locked result `fusion-v4-04`
- Revalidated on the unpatched default script at the same anchor: score `60.26`, trades `241`, ROI `38.44%`, win rate `36.51%`, profit factor `1.51`, max drawdown `5.06%`

## Exit condition
- V4 implemented and tested
- Locked-window V4 benchmark completed
- Best V4 result compared against control
- Recommendation states keep/refine/reject
