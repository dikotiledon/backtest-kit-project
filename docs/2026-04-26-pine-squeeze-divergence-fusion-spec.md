# Pine squeeze + divergence fusion spec

## Status
Draft

## Goal
Fuse the approved Phase 3 squeeze/divergence design into `pine/test.pine` without weakening the existing ML + fusion stack.

## Design rules
- **squeeze = soft strength shaper**
- **divergence = non-visual asymmetric engine**
- keep core ML prediction, filter stack, and fusion gating intact
- add optimizer-visible exports for every new module state
- do not let squeeze/divergence directly replace the base signal

## Data flow
1. existing ML prediction + base filters
2. existing fusion / Supertrend / context stack
3. squeeze context engine
4. divergence state engine
5. aggregate into long/short effective strength
6. entry decision
7. simulated stop / target / trailing engine
8. context-aware exit tightening
9. `Feature_*` exports

## Entry shaping
### Squeeze
- detect squeeze compression
- release acts as a fresh strength boost
- active squeeze state acts as caution, not hard block by default

### Divergence
- use pivot-based RSI divergence
- bullish divergence boosts long bias
- bearish divergence boosts short bias
- opposite-side divergence adds caution

## Exit shaping
- divergence and squeeze can tighten trailing behavior
- exit shaping must never loosen hard SL/TP
- early exits only when caution state is active and exit shaping is enabled

## Optimizer surface
Keep it bounded.

### New inputs
- `useSqueezeContext`
- `squeezeLength`
- `squeezeBbMult`
- `squeezeKcMult`
- `squeezeReleaseFreshBars`
- `squeezeBoostValue`
- `useDivergenceContext`
- `divRsiLen`
- `divPivotLeft`
- `divPivotRight`
- `divFreshBars`
- `divLongBoostValue`
- `divShortBoostValue`

### New feature exports
- `Feature_SqueezeState`
- `Feature_SqueezeReleaseBull`
- `Feature_SqueezeReleaseBear`
- `Feature_SqueezeLongBoost`
- `Feature_SqueezeShortBoost`
- `Feature_SqueezeLongCaution`
- `Feature_SqueezeShortCaution`
- `Feature_DivBullConfirmed`
- `Feature_DivBearConfirmed`
- `Feature_DivBullFresh`
- `Feature_DivBearFresh`
- `Feature_DivLongBoost`
- `Feature_DivShortBoost`
- `Feature_DivLongCaution`
- `Feature_DivShortCaution`

## Verification plan

### 1. tuner patching
- verify new knobs are patchable
- verify combo pruning when modules are disabled
- verify helper derivation state stays stable

### 2. Pine contract tests
- exported `Feature_*` columns exist
- defaults stable
- disabled modules stay neutral
- key enabled configs flip expected exports

### 3. strategy regression
- existing Pine tests remain green
- no break to current signal engine or alert surface

### 4. targeted sweep validation
- compare control vs squeeze-only vs divergence-only vs combined
- verify combined winner is not just trade-count collapse or fragile overfit

## Rollout order
1. squeeze engine + exports
2. divergence engine + exports
3. aggregator + exit shaping
4. tuner/test plumbing
5. focused comparative sweeps

## Exit condition
- spec approved
- implementation wired in `pine/test.pine`
- verification gate passed or clearly blocked with reason
