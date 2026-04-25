# Pine Reference Context Integration Design

Date: 2026-04-25
Project: backtest-kit
Target script: `pine/test.pine`
Reference scripts:
- `pine/reference/Dynamic Swing Anchored VWAP.pine`
- `pine/reference/Smart Money Breakout Channels.pine`

## Goal

Integrate the two new Pine references into the current `pine/test.pine` strategy in a way that is:

- optimizer-safe
- auditable through `display.data_window` feature exports
- compatible with the current `pine-tuner` / `pine-optimizer` workflow
- bounded in search-space growth
- strong enough to shape both entries and exits without becoming a visual-port monolith

This design ports trading logic and state, not chart-object UX.

## Non-goals

This design does not attempt to:

- fully replicate reference visuals, labels, polylines, boxes, tables, or gauges
- import lower-timeframe volume-delta visuals from the breakout script in phase 1
- split the strategy into multiple Pine files
- replace the existing ML / kernel / fusion / supertrend stack
- brute-force every new parameter in autoresearch

## Current strategy constraints

`pine/test.pine` already operates as a single-file strategy surface with:

- ML prediction and feature-engineering inputs
- post-prediction filter stack
- kernel bias gates
- TrendX confirmation
- signal-fusion layers
- Supertrend-based gating
- simulated position / stop / target / trailing logic
- optimizer-ready `display.data_window` exports

The JS tooling expects this architecture:

- `scripts/lib/pine-tuner.mjs` patches named Pine inputs in place
- `scripts/lib/pine-tuner.mjs#filterSweepCombos()` removes irrelevant params when modules are disabled
- sweeps and autoresearch rely on bounded curated parameter surfaces, not unbounded feature explosion

Because of that, the integration should stay single-file but modular-in-file.

## High-level conclusion

Best architecture:

- single-file, modular-in-file integration
- Anchored VWAP as the primary context qualifier
- Breakout Channel as the secondary confirmer / booster
- exit shaping driven by context degradation flags
- explicit feature exports for all raw states, pass/fail states, block reasons, and exit modifiers
- medium knob surface, not minimal and not brute-force

## Why this architecture

### Rejected option: full reference port

Full-porting both scripts is the wrong target because the references are dominated by visual object systems and chart UX, while the strategy needs deterministic state, compact inputs, and optimizer-visible outputs.

### Rejected option: equal-weight context modules

The two references do not represent the same kind of information:

- Anchored VWAP provides persistent directional / reclaim context
- Breakout Channels provide episodic compression / breakout structure

Treating them as equal-weight modules would blur their roles and reduce interpretability.

### Selected option: asymmetric tiered integration

- Anchored VWAP qualifies baseline context
- Breakout context strengthens or degrades that context
- either module may raise exit caution after a trade is live

This matches the approved tiered policy while preserving signal attribution.

## Module design

## 1. Anchored VWAP Context Engine

### Purpose

Provide persistent directional context and reclaim/loss state around a swing-anchored VWAP.

### Keep from reference conceptually

- swing anchor detection
- anchored VWAP from the most relevant swing anchor forward
- side-of-VWAP directional bias
- reclaim / lose events
- normalized distance from anchored VWAP
- anchor age

### Drop from reference

- labels
- polylines
- adaptive drawing machinery
- style-only controls

### Inputs

Group: `Phase 3: AVWAP Context`

Planned optimizer-visible knobs:
- `useAvwapContext` (bool)
- `avwapSwingPeriod` (int)
- `avwapReclaimFreshBars` (int)
- `avwapMaxDistanceAtr` (float)
- `avwapMaxAnchorAge` (int)
- `avwapRequireReclaimForEntry` (bool)

### Raw states

- `avwapValue`
- `avwapSide` (`+1`, `-1`)
- `avwapBullBias`
- `avwapBearBias`
- `avwapReclaimBull`
- `avwapReclaimBear`
- `avwapDistanceNorm`
- `avwapAnchorAge`

### Derived states

- `avwapLongOk`
- `avwapShortOk`
- `avwapLongCaution`
- `avwapShortCaution`

## 2. Breakout Channel Context Engine

### Purpose

Provide structural compression / breakout context without importing the reference script’s visual-object complexity.

### Keep from reference conceptually

- channel active state
- channel upper/lower bounds
- width / compression proxy
- bullish breakout event
- bearish breakout event
- optional retest state

### Drop from reference

- lower-timeframe volume delta
- gauge/table/box rendering
- overlap-heavy visual management unless required for core state

### Inputs

Group: `Phase 3: Breakout Context`

Planned optimizer-visible knobs:
- `useChannelContext` (bool)
- `channelDetectLength` (int)
- `channelCompressionThreshold` (float)
- `channelBreakoutFreshBars` (int)
- `channelEnableRetest` (bool)
- `channelRetestFreshBars` (int)
- `channelHostileBlocksEntry` (bool)

### Raw states

- `channelActive`
- `channelUpper`
- `channelLower`
- `channelWidthNorm`
- `channelCompressionScore`
- `channelBullBreakFresh`
- `channelBearBreakFresh`
- `channelRetestBull`
- `channelRetestBear`

### Derived states

- `channelLongBoost`
- `channelShortBoost`
- `channelLongHostile`
- `channelShortHostile`
- `channelLongCaution`
- `channelShortCaution`

## 3. Context Aggregator

### Purpose

Combine asymmetric module outputs into final entry qualification, boost state, and exit caution state.

### Inputs

Group: `Phase 3: Context Aggregator`

Planned knobs:
- `useContextAggregator` (bool)
- `contextStrictRequireChannel` (bool)
- `contextBoostAddsToStrength` (bool)
- `contextBoostValue` (float)
- `contextHostileBlocksEntry` (bool)

### Policy

Approved policy:
- Anchored VWAP is primary qualifier
- Breakout Channel is secondary booster / degrader
- AVWAP good + Channel neutral = entry allowed
- AVWAP good + Channel aligned = entry allowed with boost
- AVWAP bad = entry blocked regardless of channel alignment
- either module may trigger exit caution after entry

### Final aggregated states

- `contextLongQualify`
- `contextShortQualify`
- `contextLongBoost`
- `contextShortBoost`
- `contextLongCaution`
- `contextShortCaution`
- `contextLongBlocked`
- `contextShortBlocked`

### Disabled behavior

When `useContextAggregator` is false, the aggregator must become a transparent pass-through:

- `contextLongQualify = true`
- `contextShortQualify = true`
- `contextLongBoost = 0`
- `contextShortBoost = 0`
- `contextLongCaution = false`
- `contextShortCaution = false`
- `contextLongBlocked = false`
- `contextShortBlocked = false`

## 4. Context Exit Shaping

### Purpose

Tighten live-trade management when context degrades, without replacing hard risk controls.

### Inputs

Group: `Phase 3: Context Exit Shaping`

Planned knobs:
- `useContextExitShaping` (bool)
- `contextTightenTrailOnCaution` (bool)
- `contextTrailTightenFactor` (float)
- `contextAllowEarlySignalExit` (bool)

### Rules

When caution becomes true for a live position:

- tighten trailing-stop behavior
- allow earlier signal-driven exit

Context caution must never:
- disable stop loss
- widen stop loss
- loosen take-profit logic
- silently override hard risk protections

## Data flow

The integration should execute in this order each bar:

1. existing base engine computes:
   - ML prediction
   - filter stack
   - kernel bias
   - TrendX
   - fusion state
   - Supertrend state
   - current base entry / exit conditions
2. AVWAP module computes raw and derived AVWAP context states
3. Breakout module computes raw and derived channel context states
4. Context aggregator computes qualification / boost / caution states
5. final entries are built from base engine plus context states
6. exit shaping modifies trailing / early-exit permissions from caution states
7. all raw states and decisions are exported via `display.data_window`

## Entry logic

### Long entries

Base pattern:

`startLongTrade = baseStartLong`
`AND existing gates`
`AND contextLongQualify`
`AND not contextLongBlocked`

Where:
- `contextLongQualify` requires `avwapLongOk`
- channel alignment is optional in normal mode and required only in strict mode
- channel hostility may block entries when `channelHostileBlocksEntry` is enabled
- stretch / stale-anchor failure may block entries when AVWAP constraints fail
- `contextLongBoost` may optionally add to effective long strength
- `contextLongBlocked` is true when any of these conditions fail the long context policy:
  - AVWAP not qualified
  - channel hostility blocks entry
  - strict mode requires channel confirmation and channel is not aligned
  - AVWAP stretch / anchor-age constraints fail

### Short entries

Mirror of long logic, using `contextShortQualify`, `contextShortBoost`, and `contextShortBlocked`.

## Exit logic

Context does not fire opaque direct exits.

Instead, it adjusts exit behavior through caution flags:

- `contextLongCaution`
- `contextShortCaution`

Effects:
- tighter trailing stop management
- earlier signal exit permission

The existing hard SL/TP remains the highest-priority risk control.

## Truth table

| Base setup valid | AVWAP | Channel | Entry | Exit behavior |
|---|---|---|---|---|
| yes | qualify | neutral | allow | normal |
| yes | qualify | aligned | allow + boost | normal |
| yes | qualify | hostile | block when hostile-block enabled | caution if live |
| yes | fail | aligned | block | caution if live |
| yes | fail | neutral | block | normal or caution by state |
| yes | qualify then degrade | degraded after entry | already in trade | tighten trail + early signal exit allowed |

## Feature export requirements

All important states must be visible in `display.data_window`.

### AVWAP exports

- `Feature_AvwapBullBias`
- `Feature_AvwapBearBias`
- `Feature_AvwapReclaimBull`
- `Feature_AvwapReclaimBear`
- `Feature_AvwapDistanceNorm`
- `Feature_AvwapAnchorAge`
- `Feature_AvwapLongOk`
- `Feature_AvwapShortOk`

### Channel exports

- `Feature_ChannelActive`
- `Feature_ChannelWidthNorm`
- `Feature_ChannelCompressionScore`
- `Feature_ChannelBullBreak`
- `Feature_ChannelBearBreak`
- `Feature_ChannelRetestBull`
- `Feature_ChannelRetestBear`
- `Feature_ChannelLongBoost`
- `Feature_ChannelShortBoost`

### Aggregator / attribution exports

- `Feature_ContextLongQualify`
- `Feature_ContextShortQualify`
- `Feature_LongContextBoost`
- `Feature_ShortContextBoost`
- `Feature_BlockLong_Avwap`
- `Feature_BlockShort_Avwap`
- `Feature_BlockLong_ChannelHostile`
- `Feature_BlockShort_ChannelHostile`
- `Feature_BlockLong_ContextStrict`
- `Feature_BlockShort_ContextStrict`
- `Feature_BlockLong_ContextStretch`
- `Feature_BlockShort_ContextStretch`

### Exit-shaping exports

- `Feature_LongContextCaution`
- `Feature_ShortContextCaution`
- `Feature_LongEarlyExitAllowed`
- `Feature_ShortEarlyExitAllowed`
- `Feature_LongTrailTightened`
- `Feature_ShortTrailTightened`

## Implementation structure inside `pine/test.pine`

Recommended section order:

1. existing base / fusion / supertrend logic
2. `AVWAP Context` section
3. `Breakout Context` section
4. `Context Aggregator` section
5. final entry construction
6. exit-shaping section
7. feature export section

Each new section should follow the same internal pattern:
- inputs
- raw states
- derived pass/boost/caution states
- downstream final values

## JS and tooling impact

This design includes required JS-side work.

### `scripts/lib/pine-tuner.mjs`

Add patchers for all new optimizer-visible Pine inputs.

### Sweep normalization / filtering

Extend `filterSweepCombos()` so irrelevant parameters are removed when:
- `useAvwapContext` is false
- `useChannelContext` is false
- `useContextAggregator` is false
- `useContextExitShaping` is false

### Curated phase-3 grid updates

Add bounded variant families for:
- AVWAP-only context
- Channel-only context
- combined context
- context exit-shaping

The search surface should remain curated and explicit, not brute-force cartesian expansion.

## Testing plan

Required tests:

1. tuner patcher coverage for new inputs
2. combo-filter tests ensuring disabled modules collapse equivalent parameter sets
3. Pine export expectation tests for the new feature columns
4. behavior tests proving:
   - AVWAP can block entries
   - Channel can boost entries
   - hostile / degraded context can trigger exit caution
   - context exit shaping changes trailing / early-exit behavior without weakening SL/TP

## Phased rollout

### Phase 1
- implement raw module states and feature exports
- keep impact on trading behavior conservative by defaulting new context modules to disabled or transparent-pass mode until validation is complete

### Phase 2
- wire entry qualification and context boost logic

### Phase 3
- wire context-based exit shaping

### Phase 4
- expand curated sweep / autoresearch coverage only after exports show non-redundant value

## Risks and mitigations

### Risk: signal redundancy

AVWAP may overlap with:
- TrendX
- Supertrend
- kernel bias

Channel context may overlap with:
- fusion confirmations
- prediction-strength gating

Mitigation:
- export raw states and block reasons from day 1
- verify non-redundancy in sweeps before broadening search space

### Risk: search-space explosion

Mitigation:
- keep a medium knob surface
- add curated families only
- remove irrelevant params when modules are disabled

### Risk: script complexity growth

Mitigation:
- modular-in-file boundaries
- consistent section order
- no visual-object port in the core strategy path

## Success criteria

This design is successful when:

- `pine/test.pine` remains deterministic and optimizer-compatible
- the new modules expose auditable raw states and attribution flags
- entry blocks and boosts are measurable by exported features
- context caution visibly changes exit behavior without weakening hard risk controls
- search-space growth remains moderate
- sweeps can determine whether the new logic adds non-redundant edge over the current stack

## Final recommendation

Implement the integration as a modular-in-file, asymmetric context system:

- AVWAP qualifies
- Channel confirms or degrades
- context caution shapes exits
- feature exports remain first-class
- JS tuner / sweep plumbing is part of the design scope, not an afterthought
