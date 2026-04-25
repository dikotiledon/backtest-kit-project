# Pine input audit, phase3-core expansion, and matrix rotation

## Why this exists
The prior `phase3-core` grid only searched a narrow Phase 3 slice, mostly Supertrend plus trailing-stop toggles. That was not enough to honestly claim broader Pine exploration.

This audit splits the current `pine/test.pine` inputs into three buckets:
1. search-covered now
2. held constant on purpose
3. non-strategy / display controls excluded from autoresearch

It also records the two structural fixes needed to make wider search meaningful:
- rotating candidate batches instead of always taking the first `maxConfigs`
- multi-window matrix validation instead of one frozen window only

## Search-covered now
These Pine defaults are now part of the expanded `phase3-core` search space or patchable by the sweep engine.

### ML / filter controls
- `neighborsCount`
- `useVolatilityFilter`
- `useRegimeFilter`
- `useAdxFilter`
- `regimeThreshold`
- `adxThreshold`
- `useEmaFilter`
- `emaPeriod`
- `useSmaFilter`
- `smaPeriod`
- `h` (kernel lookback window)
- `r` (kernel relative weighting)
- `x` (kernel regression level)
- `lag`

### Entry gating / fusion controls
- `useTrendXConf`
- `minPredSum`
- `minBarsBetween`
- `useSignalFusion`
- `minFusionScore`
- `useAtrFlipConfirm`
- `use3LineConfirm`
- `useEngulfingConfirm`
- `useEmaCrossConfirm`
- `useFusionV2`
- `useFusionV3`
- `useFusionV4`
- `fusionV4MinAbsPrediction`
- `fusionV4MaxAbsPrediction`
- `fusionV4LongAtrWeight`
- `fusionV4LongEngulfWeight`
- `fusionV4LongEmaWeight`
- `fusionV4ShortAtrWeight`
- `fusionV4ShortEngulfWeight`
- `fusionV4ShortEmaWeight`

### Phase 3 / exit controls
- `useSupertrendFilter`
- `useSupertrendEntryConfirm`
- `supertrendAtrLen`
- `supertrendFactor`
- `useStopsTP`
- `riskAtrLen`
- `useSignalExits`
- `slAtrMult`
- `tpAtrMult`
- `useTrailingStop`
- `trailAtrLen`
- `trailAtrMult`
- `trailActivateR`

## Context modules added on 2026-04-25

New bounded families:
- AVWAP context: `useAvwapContext`, `avwapSwingPeriod`, `avwapReclaimFreshBars`, `avwapMaxDistanceAtr`, `avwapMaxAnchorAge`, `avwapRequireReclaimForEntry`
- Breakout context: `useChannelContext`, `channelDetectLength`, `channelCompressionThreshold`, `channelBreakoutFreshBars`, `channelEnableRetest`, `channelRetestFreshBars`, `channelHostileBlocksEntry`
- Aggregator / exit shaping: `useContextAggregator`, `contextStrictRequireChannel`, `contextBoostAddsToStrength`, `contextBoostValue`, `contextHostileBlocksEntry`, `useContextExitShaping`, `contextTightenTrailOnCaution`, `contextTrailTightenFactor`, `contextAllowEarlySignalExit`

Safety rule: when any context module is disabled, its dependent parameters are pruned from sweep combo identity.

## Held constant on purpose
These are user inputs, but not expanded into the main autoresearch grid yet.

### Stability / determinism holds
- `settings.source`
- `settings.maxBarsBack`
- `settings.featureCount`
- `settings.colorCompression`
- `showTradeStats`
- `useWorstCase`
- `cap`
- `sampleStride`
- `enableStrategy`

Reason: these either affect runtime/perf more than strategy quality, alter training/search semantics too broadly, or are better handled in a dedicated diagnostic grid instead of the main champion loop.

### Deferred exit-model controls
- `showExits`
- `useDynamicExits`

Reason: these change exit semantics enough that they should be isolated in a dedicated exit-model branch instead of being mixed immediately into the main Phase 3 production loop.

## Explicitly excluded from autoresearch
These inputs are not currently treated as strategy search dimensions for the champion loop.

### Legacy / decorative / chart-only controls
- `per`
- `src1`, `src2`
- `showBarColors`
- `showBarPredictions`
- `def`
- `showDash`
- all `MRC:*` controls
- all zigzag / MSB drawing controls
- commented smoothed-MA inputs

Reason: they do not define the main backtest decision surface we are optimizing in the locked-window autoresearch loop.

## Structural search fixes
### 1) Rotating candidate batches
Before this change, the sweep always evaluated the first `maxConfigs` combinations after cartesian expansion.
That meant widening the grid would still keep rediscovering the same front slice.

Now the scout rotates by prior cycle count:
- cycle 0 -> batch 0..N-1
- cycle 1 -> batch N..2N-1
- wrap-around when needed

This is required for hourly scouting to actually explore the expanded search space.

### 2) Multi-window matrix
Matrix now spans more than one pinned window:
- current window: `2026-04-21T10:30:00.000Z`
- March window: `2026-03-17T10:30:00.000Z`
- February window: `2026-02-14T10:30:00.000Z`

Labs now cover:
- current XRP primary
- current BTC shadow
- current ETH shadow
- March XRP shadow
- March BTC shadow
- February ETH shadow

Purpose: reduce single-window saturation and reject candidates that only win on the original frozen anchor.

## Operating implication
Expanded grid + hourly-only schedule is now meaningful only because:
- scout batches rotate
- matrix windows diversify
- micro loop can be disabled so compute budget goes to hourly exploration instead of steady-state repetition

## Next recommended follow-up
If this wider Phase 3 search still saturates, the next branch should isolate the deferred exit-model controls:
- `useDynamicExits`
- `showExits`
- possibly `featureCount` / `maxBarsBack` in a separate non-production research grid
