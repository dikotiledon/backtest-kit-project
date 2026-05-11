# Progressive Pine Autoresearch Parameter Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tiny hardcoded autoresearch mutation space with a reliable, progressive search engine that covers the real patchable Pine strategy parameter surface and never repeats exhausted generated lanes for the same champion.

**Architecture:** Add a canonical parameter-surface catalog for patchable strategy inputs, generate bounded neighbor ladders from the current champion config, and apply novelty/exhaustion tracking to every generated regime lane (`globalAllParameter`, `exitRegime`, future robustness lanes). Keep patch application through the existing `pine-tuner.mjs` patchers so every generated candidate is actually runnable against `pine/test.pine`.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine sweep/autoresearch scripts, JSON manifests/history, existing scheduler state under `pine/autoresearch/.../state/scheduler`.

**Project Location:** `D:/Code/Experiment/backtest-kit-project`

**Execution Start:** Every worker must start from the project root:

```bash
cd D:/Code/Experiment/backtest-kit-project
git status --short --branch
```

Expected: repository exists on the expected branch. If this path does not exist, stop and ask the main session for the correct repo path; do not create a new folder.

---

## Problem Summary

Current behavior is not a live lock. It is algorithmic livelock:

- `pine/test.pine` exposes 121 input identifiers; 93 are already patchable through `scripts/lib/pine-tuner.mjs` patchers.
- `phase3-core` has 60 explicit variants despite a much larger declared grid.
- `scripts/lib/pine-global-search.mjs` currently mutates only 6 families x 4 ladder levels = 24 unique global patches for the current champion.
- `scripts/lib/pine-exit-generators.mjs` currently emits only 2 fixed exit candidates.
- There is no `exitRegime` novelty/exhaustion guard, so once `globalAllParameter` exhausts, the scheduler repeatedly sends the same two exit variants.
- `computeSweepOffset` cannot rotate a two-candidate variant file when `maxConfigs=8`: `(cycleCount * 8) % 2 = 0`.

The fix must make the search space wider **and** prove non-repetition through tests and production invariants.

---

## Second-Pass Audit: Corrections Required Before Implementation

This section supersedes any later task detail that conflicts with it. The first draft was directionally right, but not strict enough. A worker must apply these corrections while implementing the tasks below.

### Critical misses found in the first draft

1. **Candidate ordering can starve later families.**
   - A naive catalog-order generator with `maxConfigs=8` will over-sample early families (`ml-core`, `entry`, etc.) and may take too many cycles before touching risk/exit/context families.
   - Required correction: `buildSurfaceMutationCandidates()` must generate by round-robin family interleaving, not simple catalog order. For each family, emit one candidate per parameter axis/level pass, then move to the next family. This ensures one small cycle sees broad surface coverage.
   - Add/adjust tests so an 8-candidate global batch contains at least 5 distinct families when enough family candidates exist.

2. **Generic novelty must not weaken the hardened global fingerprint rules.**
   - Existing `collectTestedGlobalPatchFingerprints()` already rejects stored-only fingerprints, malformed fingerprints, config/patch disagreement poison, and stale same-`configId` champion evidence.
   - Required correction: do not replace global collection with a weaker generic collector. Either:
     - keep `collectTestedGlobalPatchFingerprints()` for `globalAllParameter`, and build an exit-specific collector with the same poison-resistance patterns, or
     - refactor the hardened collector into a generic implementation without losing any tests from `tests/pine-autoresearch.test.mjs` around malformed/stored-only/stale evidence.
   - Add exit-specific tests mirroring the existing global poison tests: stored-only fingerprint rejected, malformed stored fingerprint rejected when reconstruction disagrees, variant patch/config disagreement rejected, stale same configId with changed config ignored.

3. **Lane naming must be canonicalized.**
   - Existing code currently mixes `exit-regime`, `exitRegime`, `global-all-parameter`, and `globalAllParameter` forms.
   - Required correction: add `canonicalGeneratedLane(lane)` and use it in lane fingerprints, manifest collection, scheduler exhaustion, and generator outputs. Fingerprints for `exit-regime` and `exitRegime` must match.
   - Add tests proving lane alias equivalence for both generated lanes.

4. **The plan snippets reference variables/signatures that do not exist yet.**
   - `buildGlobalMutationBatch()` currently does not accept `policy`; if implementation needs `allowArchitectureKeys`, add an explicit parameter or pass it via a defined `surfacePolicy` object.
   - `buildExitFamilyCandidates()` must explicitly accept `{ testedPatchFingerprints, levels, families }` if tasks use those values.
   - `buildGeneratedLaneExhaustedManifest()` does not exist; either create it as a lane-neutral wrapper or rename/refactor `buildGlobalAllParameterExhaustedManifest()` with compatibility exports.
   - Required correction: every implementation step must update signatures and imports before using new parameters. Tests must fail on missing signatures before code is changed.

5. **Config changes must preserve the already-dirty production config.**
   - `config/pine-autoresearch.default.json` was already modified before this task.
   - Required correction: before editing it, run `git diff -- config/pine-autoresearch.default.json` and save the diff path/summary in the task notes. Edits must merge into existing user changes, not overwrite or normalize unrelated formatting.

6. **This plan improves progressive exploration; it does not by itself prove profitability.**
   - A broader parameter surface can produce more candidates, but objective quality still depends on scoring, floors, holdout labs, and promotion rules.
   - Required correction: final verification must say exactly what is proven: non-repeating broad exploration. Do not claim “optimal profitable strategy” unless full multi-window/holdout promotion evidence proves it.
   - Add a follow-up plan/task if the user wants optimizer objective changes: hard ROI floors, trade-count floors, walk-forward/holdout weighting, and budget allocation by alpha family.

7. **Existing phase3-core grid must remain compatible.**
   - Current `phase3-core` has 71 declared grid keys but only 60 explicit `__variants` are selected by `countSweepCombos()`.
   - Required correction: parameter-surface generator must not break `getCandidateGrid('phase3-core')`, explicit variant behavior, or existing `countSweepCombos()` semantics.
   - Add regression test: `getCandidateGrid('phase3-core')` still returns explicit variants and `countSweepCombos(grid) === grid.__variants.length` unless a separate explicit task changes that behavior.

### New mandatory acceptance gates

Add these gates to the existing acceptance criteria:

10. An 8-candidate global batch includes broad family diversity, not just early catalog keys.
11. Exit novelty collection has the same anti-poison discipline as the existing global collector.
12. Lane aliases (`exit-regime`/`exitRegime`, `global-all-parameter`/`globalAllParameter`) produce canonical matching fingerprints and exhaustion records.
13. `phase3-core` grid behavior remains backward-compatible.
14. The final report separates “progressive exploration verified” from “profitability improved”; profitability requires separate outcome evidence.

---

## File Structure

### Create

- `scripts/lib/pine-parameter-surface.mjs`
  - Canonical patchable parameter catalog.
  - Family groupings.
  - Numeric ladder generation.
  - Boolean toggle generation.
  - Candidate patch generation from champion config.

- `scripts/lib/pine-lane-novelty.mjs`
  - Generic lane patch fingerprints for all generated lanes.
  - Manifest/history collection for lane fingerprints.
  - Candidate annotation/filtering.
  - Exhaustion summaries per lane.

- `tests/pine-parameter-surface.test.mjs`
  - Verifies catalog covers strategic patchable Pine inputs and excludes display-only junk.

- `tests/pine-lane-novelty.test.mjs`
  - Verifies lane fingerprints are stable, champion-bound, lane-bound, patch-bound, and collected from manifests/history.

### Modify

- `scripts/lib/pine-tuner.mjs`
  - Export patcher introspection helpers: `patchableParameterKeys()`, `hasPatchSupport(key)`.
  - Keep all current patch behavior unchanged.

- `scripts/lib/pine-global-search.mjs`
  - Replace 6-family hardcoded mutation builder with parameter-surface based mutation builder.
  - Preserve existing exported fingerprint functions/tests for compatibility.
  - Increase default generator version.

- `scripts/lib/pine-exit-generators.mjs`
  - Generate exit/regime candidates from the exit-related parameter surface.
  - Accept tested fingerprints and filter already-tested candidates.
  - Emit candidate metadata with lane fingerprints.

- `scripts/pine-autoresearch.mjs`
  - Collect tested lane fingerprints for selected generated lane.
  - Pass lane novelty context into both global and exit generators.
  - Generalize exhausted-lane skip from `globalAllParameter` only to any generated lane.
  - Record lane exhaustion for `exitRegime` too.
  - Ensure fallback does not silently run a generated lane that is known exhausted.

- `scripts/lib/pine-regime-exit-scheduler.mjs`
  - Keep current exhaustion lookup, but verify all generated lanes respect it.
  - Add test coverage for all lanes exhausted -> no generated lane selected.

- `config/pine-autoresearch.default.json`
  - Add explicit `regimeExitResearch.parameterSurface` knobs for enabled families and per-cycle candidate budget.

- `tests/pine-global-search.test.mjs`
  - Replace tiny-family expectations with wide-surface expectations.

- `tests/pine-exit-generators.test.mjs`
  - Replace 2-candidate assumptions with progressive exit surface expectations.

- `tests/pine-autoresearch.test.mjs`
  - Add lane exhaustion tests for `exitRegime` and all generated lanes.

- `tests/pine-autoresearch-production-invariants.test.mjs`
  - Add invariant that generated lane candidates have lane fingerprints and do not repeat for current champion when prior manifests contain them.

---

## Parameter Surface Policy

The first production surface should optimize strategy-relevant, patcher-supported parameters only. Exclude pure display/control inputs (`showDash`, colors, label sizes, dashboard, boxes, MTF display labels) because they cannot improve trading objective and waste cycles.

Initial enabled families:

| Family | Keys |
| --- | --- |
| `ml-core` | `neighborsCount`, `h`, `r`, `x`, `lag`, `cap`, `sampleStride` where patch support exists |
| `entry` | `useTrendXConf`, `minPredSum`, `minBarsBetween` |
| `filters` | `useVolatilityFilter`, `useRegimeFilter`, `regimeThreshold`, `useAdxFilter`, `adxThreshold`, `useEmaFilter`, `emaPeriod`, `useSmaFilter`, `smaPeriod` |
| `fusion` | `useSignalFusion`, `minFusionScore`, `useAtrFlipConfirm`, `use3LineConfirm`, `useEngulfingConfirm`, `useEmaCrossConfirm`, `useFusionV2`, `fusionBonusPerSignal`, `fusionMaxBonus`, `useFusionV3`, `fusionPenaltyPerMissing`, `useFusionV4`, all `fusionV4*Weight`, `fusionV4MinAbsPrediction`, `fusionV4MaxAbsPrediction` |
| `supertrend` | `useSupertrendFilter`, `useSupertrendEntryConfirm`, `supertrendAtrLen`, `supertrendFactor` |
| `avwap-context` | `useAvwapContext`, `avwapSwingPeriod`, `avwapReclaimFreshBars`, `avwapMaxDistanceAtr`, `avwapMaxAnchorAge`, `avwapRequireReclaimForEntry` when patch support exists |
| `channel-context` | `useChannelContext`, `channelDetectLength`, `channelCompressionThreshold`, `channelBreakoutFreshBars`, `channelEnableRetest`, `channelRetestFreshBars`, `channelHostileBlocksEntry` when patch support exists |
| `context-aggregator` | `useContextAggregator`, `contextStrictRequireChannel`, `contextBoostAddsToStrength`, `contextBoostValue`, `contextHostileBlocksEntry` when patch support exists |
| `context-exit-shaping` | `useContextExitShaping`, `contextTightenTrailOnCaution`, `contextTrailTightenFactor`, `contextAllowEarlySignalExit` when patch support exists |
| `squeeze` | all squeeze context keys |
| `divergence` | all divergence context keys |
| `risk` | `useStopsTP`, `riskAtrLen`, `slAtrMult`, `tpAtrMult` |
| `exit` | `useSignalExits`, `useTrailingStop`, `trailAtrLen`, `trailAtrMult`, `trailActivateR` |
| `exit-state` | failed-follow-through, time-stop, context-caution, partial-derisk, post-entry-squeeze, adverse-divergence keys |

Important: if a catalog key has no `pine-tuner` patcher, the generator must not emit it. This keeps every candidate executable.

---

## Task 1: Export Patch Support Introspection

**Files:**
- Modify: `scripts/lib/pine-tuner.mjs`
- Test: `tests/pine-tuner.test.mjs`

- [ ] **Step 1: Write failing tests for patcher introspection**

Add near existing patch-plan tests in `tests/pine-tuner.test.mjs`:

```js
import {
  buildPatchPlan,
  hasPatchSupport,
  patchableParameterKeys,
} from '../scripts/lib/pine-tuner.mjs';

test('patchableParameterKeys exposes deterministic patcher key list', () => {
  const keys = patchableParameterKeys();

  assert.equal(Array.isArray(keys), true);
  assert.equal(keys.length >= 90, true);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)));
  assert.equal(keys.includes('minPredSum'), true);
  assert.equal(keys.includes('slAtrMult'), true);
  assert.equal(keys.includes('trailAtrMult'), true);
  assert.equal(keys.includes('divRsiLen'), true);
  assert.equal(keys.includes('showDash'), false);
});

test('hasPatchSupport returns true only for existing patchers', () => {
  assert.equal(hasPatchSupport('minPredSum'), true);
  assert.equal(hasPatchSupport('tpAtrMult'), true);
  assert.equal(hasPatchSupport('useAdverseDivergenceTighten'), true);
  assert.equal(hasPatchSupport('showDash'), false);
  assert.equal(hasPatchSupport('missingParam'), false);
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test tests/pine-tuner.test.mjs --test-name-pattern "patchableParameterKeys|hasPatchSupport"
```

Expected: FAIL because exports do not exist.

- [ ] **Step 3: Add introspection exports**

Add after `PATCHERS` definition in `scripts/lib/pine-tuner.mjs`:

```js
export function patchableParameterKeys() {
  return Object.keys(PATCHERS).sort((a, b) => a.localeCompare(b));
}

export function hasPatchSupport(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PATCHERS, key);
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
node --test tests/pine-tuner.test.mjs --test-name-pattern "patchableParameterKeys|hasPatchSupport"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-tuner.mjs tests/pine-tuner.test.mjs
git commit -m "test(pine): expose patchable parameter introspection"
```

---

## Task 2: Add Canonical Pine Parameter Surface

**Files:**
- Create: `scripts/lib/pine-parameter-surface.mjs`
- Create: `tests/pine-parameter-surface.test.mjs`

- [ ] **Step 1: Write failing parameter-surface tests**

Create `tests/pine-parameter-surface.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildParameterLadder,
  buildSurfaceMutationCandidates,
  parameterSurfaceCatalog,
  parameterSurfaceKeys,
  strategicParameterFamilies,
} from '../scripts/lib/pine-parameter-surface.mjs';
import { hasPatchSupport } from '../scripts/lib/pine-tuner.mjs';

const champion = {
  configId: 'surface-champion',
  config: {
    neighborsCount: 32,
    h: 8,
    r: 8,
    x: 25,
    lag: 2,
    minPredSum: 1.8,
    minBarsBetween: 1,
    useAdxFilter: true,
    adxThreshold: 20,
    useRegimeFilter: false,
    regimeThreshold: -0.1,
    useFusionV4: true,
    fusionV4LongAtrWeight: -0.25,
    fusionV4ShortAtrWeight: -0.5,
    useSupertrendFilter: true,
    supertrendAtrLen: 10,
    supertrendFactor: 1.5,
    useSqueezeContext: true,
    squeezeLength: 20,
    squeezeBoostValue: 0.25,
    useDivergenceContext: true,
    divRsiLen: 21,
    divLongBoostValue: 0.7,
    useStopsTP: true,
    riskAtrLen: 14,
    slAtrMult: 0.5,
    tpAtrMult: 7.6,
    useTrailingStop: true,
    trailAtrLen: 14,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    useTimeStop: false,
    timeStopBars: 8,
    usePartialDerisk: false,
    partialDeriskAtR: 1,
  },
};

test('parameterSurfaceCatalog contains strategic patchable Pine parameters', () => {
  const keys = parameterSurfaceKeys();

  assert.equal(keys.includes('neighborsCount'), true);
  assert.equal(keys.includes('h'), true);
  assert.equal(keys.includes('minPredSum'), true);
  assert.equal(keys.includes('adxThreshold'), true);
  assert.equal(keys.includes('fusionV4LongAtrWeight'), true);
  assert.equal(keys.includes('supertrendFactor'), true);
  assert.equal(keys.includes('squeezeLength'), true);
  assert.equal(keys.includes('divRsiLen'), true);
  assert.equal(keys.includes('riskAtrLen'), true);
  assert.equal(keys.includes('slAtrMult'), true);
  assert.equal(keys.includes('tpAtrMult'), true);
  assert.equal(keys.includes('trailAtrMult'), true);
  assert.equal(keys.includes('useTimeStop'), true);

  assert.equal(keys.includes('showDash'), false);
  assert.equal(keys.includes('showBarColors'), false);
  assert.equal(keys.includes('text_size'), false);
  assert.equal(keys.includes('delete_boxes'), false);
});

test('all enabled catalog keys have patch support', () => {
  for (const item of parameterSurfaceCatalog()) {
    assert.equal(hasPatchSupport(item.key), true, `missing patch support for ${item.key}`);
  }
});

test('strategicParameterFamilies groups broad optimization surface', () => {
  const families = strategicParameterFamilies();

  assert.equal(families.includes('ml-core'), true);
  assert.equal(families.includes('entry'), true);
  assert.equal(families.includes('filters'), true);
  assert.equal(families.includes('fusion'), true);
  assert.equal(families.includes('squeeze'), true);
  assert.equal(families.includes('divergence'), true);
  assert.equal(families.includes('risk'), true);
  assert.equal(families.includes('exit'), true);
  assert.equal(families.includes('exit-state'), true);
});

test('buildParameterLadder returns bounded numeric neighbors around champion value', () => {
  assert.deepEqual(buildParameterLadder({ key: 'slAtrMult', value: 0.5, min: 0.1, max: 20, step: 0.1, levels: 4 }), [0.6, 0.4, 0.7, 0.3]);
  assert.deepEqual(buildParameterLadder({ key: 'adxThreshold', value: 20, min: 0, max: 100, step: 2, levels: 4 }), [22, 18, 24, 16]);
});

test('buildSurfaceMutationCandidates emits broad non-display candidate set', () => {
  const candidates = buildSurfaceMutationCandidates({
    champion,
    maxConfigs: 80,
    levels: 4,
  });

  const keys = new Set(candidates.flatMap((candidate) => Object.keys(candidate.patch)));
  assert.equal(candidates.length >= 50, true);
  assert.equal(keys.has('minPredSum'), true);
  assert.equal(keys.has('neighborsCount'), true);
  assert.equal(keys.has('h'), true);
  assert.equal(keys.has('adxThreshold'), true);
  assert.equal(keys.has('fusionV4LongAtrWeight'), true);
  assert.equal(keys.has('supertrendFactor'), true);
  assert.equal(keys.has('squeezeLength'), true);
  assert.equal(keys.has('divRsiLen'), true);
  assert.equal(keys.has('riskAtrLen'), true);
  assert.equal(keys.has('slAtrMult'), true);
  assert.equal(keys.has('tpAtrMult'), true);
  assert.equal(keys.has('trailAtrMult'), true);
  assert.equal(keys.has('showDash'), false);
});

test('buildSurfaceMutationCandidates interleaves families so small cycles are broad', () => {
  const candidates = buildSurfaceMutationCandidates({
    champion,
    maxConfigs: 8,
    levels: 4,
  });

  const families = new Set(candidates.map((candidate) => candidate.family));
  assert.equal(candidates.length, 8);
  assert.equal(families.size >= 5, true);
  assert.equal(families.has('risk'), true);
  assert.equal(families.has('exit'), true);
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/pine-parameter-surface.test.mjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement parameter surface module**

Create `scripts/lib/pine-parameter-surface.mjs`:

```js
import { hasPatchSupport } from './pine-tuner.mjs';

function roundToStep(value, step) {
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(value.toFixed(Math.max(decimals, 6)));
}

function clamp(value, min, max) {
  let out = Number(value);
  if (!Number.isFinite(out)) return null;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

const RAW_SURFACE = [
  { key: 'neighborsCount', family: 'ml-core', type: 'int', min: 1, max: 100, step: 8 },
  { key: 'h', family: 'ml-core', type: 'int', min: 3, max: 50, step: 3 },
  { key: 'r', family: 'ml-core', type: 'float', min: 0.25, max: 25, step: 1 },
  { key: 'x', family: 'ml-core', type: 'int', min: 2, max: 25, step: 4 },
  { key: 'lag', family: 'ml-core', type: 'int', min: 1, max: 2, step: 1 },

  { key: 'useTrendXConf', family: 'entry', type: 'bool' },
  { key: 'minPredSum', family: 'entry', type: 'float', min: 0, max: 10, step: 0.2 },
  { key: 'minBarsBetween', family: 'entry', type: 'int', min: 0, max: 50, step: 1 },

  { key: 'useVolatilityFilter', family: 'filters', type: 'bool' },
  { key: 'useRegimeFilter', family: 'filters', type: 'bool' },
  { key: 'regimeThreshold', family: 'filters', type: 'float', min: -10, max: 10, step: 0.2 },
  { key: 'useAdxFilter', family: 'filters', type: 'bool' },
  { key: 'adxThreshold', family: 'filters', type: 'int', min: 0, max: 100, step: 2 },
  { key: 'useEmaFilter', family: 'filters', type: 'bool' },
  { key: 'emaPeriod', family: 'filters', type: 'int', min: 1, max: 500, step: 25 },
  { key: 'useSmaFilter', family: 'filters', type: 'bool' },
  { key: 'smaPeriod', family: 'filters', type: 'int', min: 1, max: 500, step: 25 },

  { key: 'useSignalFusion', family: 'fusion', type: 'bool' },
  { key: 'minFusionScore', family: 'fusion', type: 'int', min: 0, max: 4, step: 1 },
  { key: 'useAtrFlipConfirm', family: 'fusion', type: 'bool' },
  { key: 'use3LineConfirm', family: 'fusion', type: 'bool' },
  { key: 'useEngulfingConfirm', family: 'fusion', type: 'bool' },
  { key: 'useEmaCrossConfirm', family: 'fusion', type: 'bool' },
  { key: 'useFusionV2', family: 'fusion', type: 'bool', architecture: true },
  { key: 'fusionBonusPerSignal', family: 'fusion', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'fusionMaxBonus', family: 'fusion', type: 'float', min: 0, max: 5, step: 0.1 },
  { key: 'useFusionV3', family: 'fusion', type: 'bool', architecture: true },
  { key: 'fusionPenaltyPerMissing', family: 'fusion', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'useFusionV4', family: 'fusion', type: 'bool', architecture: true },
  { key: 'fusionV4MinAbsPrediction', family: 'fusion', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'fusionV4MaxAbsPrediction', family: 'fusion', type: 'float', min: 0, max: 20, step: 0.5 },
  { key: 'fusionV4LongAtrWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4LongEngulfWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4LongEmaWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4ShortAtrWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4ShortEngulfWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4ShortEmaWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },

  { key: 'useSupertrendFilter', family: 'supertrend', type: 'bool' },
  { key: 'useSupertrendEntryConfirm', family: 'supertrend', type: 'bool' },
  { key: 'supertrendAtrLen', family: 'supertrend', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'supertrendFactor', family: 'supertrend', type: 'float', min: 0.1, max: 10, step: 0.25 },

  { key: 'useAvwapContext', family: 'avwap-context', type: 'bool' },
  { key: 'avwapSwingPeriod', family: 'avwap-context', type: 'int', min: 2, max: 300, step: 8 },

  { key: 'useChannelContext', family: 'channel-context', type: 'bool' },
  { key: 'channelDetectLength', family: 'channel-context', type: 'int', min: 2, max: 200, step: 4 },

  { key: 'useContextAggregator', family: 'context-aggregator', type: 'bool' },
  { key: 'contextBoostValue', family: 'context-aggregator', type: 'float', min: 0, max: 3, step: 0.05 },

  { key: 'useContextExitShaping', family: 'context-exit-shaping', type: 'bool' },
  { key: 'contextTrailTightenFactor', family: 'context-exit-shaping', type: 'float', min: 0.1, max: 1, step: 0.05 },

  { key: 'useSqueezeContext', family: 'squeeze', type: 'bool' },
  { key: 'squeezeLength', family: 'squeeze', type: 'int', min: 2, max: 200, step: 4 },
  { key: 'squeezeBbMult', family: 'squeeze', type: 'float', min: 0.1, max: 10, step: 0.25 },
  { key: 'squeezeKcMult', family: 'squeeze', type: 'float', min: 0.1, max: 10, step: 0.25 },
  { key: 'squeezeReleaseFreshBars', family: 'squeeze', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'squeezeBoostValue', family: 'squeeze', type: 'float', min: 0, max: 3, step: 0.05 },

  { key: 'useDivergenceContext', family: 'divergence', type: 'bool' },
  { key: 'divRsiLen', family: 'divergence', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'divPivotLeft', family: 'divergence', type: 'int', min: 1, max: 20, step: 1 },
  { key: 'divPivotRight', family: 'divergence', type: 'int', min: 1, max: 20, step: 1 },
  { key: 'divFreshBars', family: 'divergence', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'divLongBoostValue', family: 'divergence', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'divShortBoostValue', family: 'divergence', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'divCautionPenaltyValue', family: 'divergence', type: 'float', min: 0, max: 3, step: 0.05 },

  { key: 'useStopsTP', family: 'risk', type: 'bool' },
  { key: 'riskAtrLen', family: 'risk', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'slAtrMult', family: 'risk', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'tpAtrMult', family: 'risk', type: 'float', min: 0.1, max: 50, step: 0.5 },

  { key: 'useSignalExits', family: 'exit', type: 'bool' },
  { key: 'useTrailingStop', family: 'exit', type: 'bool' },
  { key: 'trailAtrLen', family: 'exit', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'trailAtrMult', family: 'exit', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'trailActivateR', family: 'exit', type: 'float', min: 0, max: 10, step: 0.25 },

  { key: 'useFailedFollowThroughTighten', family: 'exit-state', type: 'bool' },
  { key: 'followThroughBars', family: 'exit-state', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'followThroughMinProgressAtr', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'followThroughTightenTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'useTimeStop', family: 'exit-state', type: 'bool' },
  { key: 'timeStopBars', family: 'exit-state', type: 'int', min: 1, max: 300, step: 4 },
  { key: 'timeStopMinUnrealizedAtr', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'useContextCautionTighten', family: 'exit-state', type: 'bool' },
  { key: 'contextCautionDelta', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'contextCautionTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'usePartialDerisk', family: 'exit-state', type: 'bool' },
  { key: 'partialDeriskAtR', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'partialDeriskClosePct', family: 'exit-state', type: 'float', min: 0, max: 100, step: 5 },
  { key: 'usePostEntrySqueezeCollapseTighten', family: 'exit-state', type: 'bool' },
  { key: 'postEntrySqueezeCollapseBars', family: 'exit-state', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'postEntrySqueezeCollapseTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'useAdverseDivergenceTighten', family: 'exit-state', type: 'bool' },
  { key: 'adverseDivergenceBars', family: 'exit-state', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'adverseDivergenceTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
];

export function parameterSurfaceCatalog({ families = null, includeArchitecture = false } = {}) {
  const familySet = Array.isArray(families) && families.length > 0 ? new Set(families) : null;
  return RAW_SURFACE
    .filter((item) => hasPatchSupport(item.key))
    .filter((item) => !familySet || familySet.has(item.family))
    .filter((item) => includeArchitecture || item.architecture !== true)
    .map((item) => ({ ...item }));
}

export function parameterSurfaceKeys(options = {}) {
  return parameterSurfaceCatalog(options).map((item) => item.key);
}

export function strategicParameterFamilies(options = {}) {
  return [...new Set(parameterSurfaceCatalog(options).map((item) => item.family))];
}

export function buildParameterLadder({ value, min = null, max = null, step = 1, levels = 4, type = 'float' } = {}) {
  const base = Number(value);
  const safeStep = Number(step);
  const safeLevels = Math.max(1, Math.floor(Number(levels) || 1));
  if (!Number.isFinite(base) || !Number.isFinite(safeStep) || safeStep <= 0) return [];

  const values = [];
  for (let level = 1; level <= safeLevels; level += 1) {
    const magnitude = Math.ceil(level / 2) * safeStep;
    const signed = level % 2 === 1 ? magnitude : -magnitude;
    let next = clamp(base + signed, min, max);
    if (next === null) continue;
    next = type === 'int' ? Math.round(next) : roundToStep(next, safeStep);
    if (!Object.is(next, base) && !values.some((item) => Object.is(item, next))) values.push(next);
  }
  return values;
}

function sourceConfig(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) return source.config;
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  return {};
}

export function buildSurfaceMutationCandidates({ champion, incumbent, maxConfigs = 8, families = null, levels = 4, includeArchitecture = false } = {}) {
  const source = incumbent ?? champion;
  const config = sourceConfig(source);
  const limit = Math.max(0, Math.floor(Number(maxConfigs) || 0));
  if (limit === 0) return [];

  const byFamily = new Map();
  for (const spec of parameterSurfaceCatalog({ families, includeArchitecture })) {
    const current = config[spec.key];
    const values = spec.type === 'bool'
      ? (typeof current === 'boolean' ? [!current] : [true, false])
      : buildParameterLadder({ ...spec, value: current, levels });

    for (const value of values) {
      if (Object.is(current, value)) continue;
      const item = {
        family: spec.family,
        mutationFamily: spec.family,
        axis: spec.key,
        patch: { [spec.key]: value },
        config: { ...config, [spec.key]: value },
        touchedKeys: [spec.key],
        metadata: {
          parameterKey: spec.key,
          parameterFamily: spec.family,
          parameterType: spec.type,
        },
      };
      if (!byFamily.has(spec.family)) byFamily.set(spec.family, []);
      byFamily.get(spec.family).push(item);
    }
  }

  const out = [];
  const queues = [...byFamily.values()].filter((items) => items.length > 0);
  while (queues.length > 0 && out.length < limit) {
    for (let index = 0; index < queues.length && out.length < limit; index += 1) {
      const next = queues[index].shift();
      if (next) out.push(next);
    }
    for (let index = queues.length - 1; index >= 0; index -= 1) {
      if (queues[index].length === 0) queues.splice(index, 1);
    }
  }

  return out;
}
```

- [ ] **Step 4: Run passing test**

```bash
node --test tests/pine-parameter-surface.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-parameter-surface.mjs tests/pine-parameter-surface.test.mjs
git commit -m "feat(pine): add strategic parameter surface catalog"
```

---

## Task 3: Add Generic Lane Novelty Fingerprints

**Files:**
- Create: `scripts/lib/pine-lane-novelty.mjs`
- Create: `tests/pine-lane-novelty.test.mjs`

- [ ] **Step 1: Write failing lane novelty tests**

Create `tests/pine-lane-novelty.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLanePatchFingerprint,
  collectTestedLanePatchFingerprints,
  filterNovelLaneCandidates,
} from '../scripts/lib/pine-lane-novelty.mjs';
import { buildChampionConfigFingerprint } from '../scripts/lib/pine-global-search.mjs';

const championConfig = { minPredSum: 1.8, slAtrMult: 0.5, tpAtrMult: 7.6 };
const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);

function candidate(lane, family, patch) {
  return {
    lane,
    family,
    mutationFamily: family,
    patch,
    config: { ...championConfig, ...patch },
    metadata: { championConfigFingerprint },
  };
}

test('buildLanePatchFingerprint binds champion config lane family and patch', () => {
  const first = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const reordered = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, buildLanePatchFingerprint({ championConfigFingerprint, lane: 'globalAllParameter', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } }));
  assert.notEqual(first, buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'risk', patch: { slAtrMult: 0.4 } }));
  assert.notEqual(first, buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.3 } }));
});

test('collectTestedLanePatchFingerprints reads matching lane fingerprints from manifests and history', () => {
  const patchFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{ lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 }, patchFingerprint, metadata: { championConfigFingerprint, patchFingerprint } }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
    historyEvents: [{ type: 'cycle', manifest }],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('filterNovelLaneCandidates annotates and removes known lane fingerprints', () => {
  const oldCandidate = candidate('exitRegime', 'exit', { slAtrMult: 0.4 });
  const newCandidate = candidate('exitRegime', 'exit', { tpAtrMult: 8.1 });
  const oldFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: oldCandidate.patch });

  const novel = filterNovelLaneCandidates({
    candidates: [oldCandidate, newCandidate],
    champion: { config: championConfig },
    lane: 'exitRegime',
    testedPatchFingerprints: new Set([oldFingerprint]),
  });

  assert.equal(novel.length, 1);
  assert.deepEqual(novel[0].patch, { tpAtrMult: 8.1 });
  assert.equal(novel[0].patchFingerprint.length, 64);
  assert.equal(novel[0].metadata.patchFingerprint, novel[0].patchFingerprint);
  assert.equal(novel[0].metadata.patchFingerprintVersion, 3);
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/pine-lane-novelty.test.mjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement lane novelty module**

Create `scripts/lib/pine-lane-novelty.mjs`:

```js
import { createHash } from 'node:crypto';
import { buildChampionConfigFingerprint } from './pine-global-search.mjs';

export const LANE_PATCH_FINGERPRINT_VERSION = 3;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sortedPatch(patch = {}) {
  return Object.fromEntries(Object.entries(patch || {}).sort(([a], [b]) => a.localeCompare(b)));
}

function sourceConfig(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) return source.config;
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  return {};
}

function championFingerprint(source) {
  const direct = source?.championConfigFingerprint ?? source?.metadata?.championConfigFingerprint;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  return buildChampionConfigFingerprint(sourceConfig(source));
}

export function buildLanePatchFingerprint({ championConfigFingerprint, lane, mutationFamily, patch } = {}) {
  if (typeof championConfigFingerprint !== 'string' || championConfigFingerprint.length === 0) {
    throw new Error('championConfigFingerprint is required for lane patch fingerprint');
  }
  return createHash('sha256')
    .update(stableJson({
      championConfigFingerprint,
      lane: lane ?? null,
      mutationFamily: mutationFamily ?? null,
      patch: sortedPatch(patch),
      version: LANE_PATCH_FINGERPRINT_VERSION,
    }))
    .digest('hex');
}

function manifestChampionFingerprint(manifest) {
  if (typeof manifest?.championConfigFingerprint === 'string') return manifest.championConfigFingerprint;
  if (manifest?.champion?.config && typeof manifest.champion.config === 'object') return buildChampionConfigFingerprint(manifest.champion.config);
  return null;
}

export function collectTestedLanePatchFingerprints({ champion, lane, manifests = [], historyEvents = [] } = {}) {
  const out = new Set();
  const expectedChampion = championFingerprint(champion);
  const sources = [
    ...(Array.isArray(manifests) ? manifests : []),
    ...(Array.isArray(historyEvents) ? historyEvents.map((event) => event?.manifest).filter(Boolean) : []),
  ];

  for (const manifest of sources) {
    const manifestFingerprint = manifestChampionFingerprint(manifest);
    const variants = Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [];
    for (const variant of variants) {
      if (lane && variant?.lane !== lane) continue;
      const variantChampion = variant?.metadata?.championConfigFingerprint ?? manifestFingerprint;
      if (variantChampion !== expectedChampion) continue;
      const fingerprint = variant?.patchFingerprint ?? variant?.metadata?.patchFingerprint;
      if (typeof fingerprint === 'string' && fingerprint.length === 64) {
        out.add(fingerprint);
        continue;
      }
      if (variant?.patch && typeof variant.patch === 'object') {
        out.add(buildLanePatchFingerprint({
          championConfigFingerprint: expectedChampion,
          lane: variant?.lane ?? lane,
          mutationFamily: variant?.mutationFamily ?? variant?.family ?? null,
          patch: variant.patch,
        }));
      }
    }
  }

  return out;
}

export function filterNovelLaneCandidates({ candidates = [], champion, lane, testedPatchFingerprints = new Set() } = {}) {
  const championConfigFingerprint = championFingerprint(champion);
  const tested = testedPatchFingerprints instanceof Set ? testedPatchFingerprints : new Set(testedPatchFingerprints || []);
  const emitted = new Set();
  const out = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateLane = candidate.lane ?? lane;
    const mutationFamily = candidate.mutationFamily ?? candidate.family ?? null;
    const patchFingerprint = buildLanePatchFingerprint({
      championConfigFingerprint,
      lane: candidateLane,
      mutationFamily,
      patch: candidate.patch || {},
    });
    if (tested.has(patchFingerprint) || emitted.has(patchFingerprint)) continue;
    emitted.add(patchFingerprint);
    out.push({
      ...candidate,
      lane: candidateLane,
      patchFingerprint,
      metadata: {
        ...(candidate.metadata || {}),
        championConfigFingerprint,
        patchFingerprint,
        patchFingerprintVersion: LANE_PATCH_FINGERPRINT_VERSION,
      },
    });
  }

  return out;
}
```

- [ ] **Step 4: Run passing test**

```bash
node --test tests/pine-lane-novelty.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-lane-novelty.mjs tests/pine-lane-novelty.test.mjs
git commit -m "feat(pine): add generic generated-lane novelty guard"
```

---

## Task 4: Broaden Global Search Generator

**Files:**
- Modify: `scripts/lib/pine-global-search.mjs`
- Modify: `tests/pine-global-search.test.mjs`

- [ ] **Step 1: Write failing global-surface tests**

Append to `tests/pine-global-search.test.mjs`:

```js
test('buildGlobalMutationBatch uses broad parameter surface beyond six legacy families', () => {
  const champion = {
    configId: 'broad-global-champion',
    config: {
      neighborsCount: 32,
      h: 8,
      r: 8,
      x: 25,
      lag: 2,
      minPredSum: 1.8,
      adxThreshold: 20,
      fusionV4LongAtrWeight: -0.25,
      supertrendFactor: 1.5,
      squeezeLength: 20,
      divRsiLen: 21,
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      trailAtrMult: 1,
      useTrailingStop: true,
      useTimeStop: false,
      timeStopBars: 8,
    },
  };

  const batch = buildGlobalMutationBatch({
    champion,
    maxConfigs: 80,
    variantsPerFamily: 4,
  });

  const keys = new Set(batch.flatMap((item) => Object.keys(item.patch)));
  assert.equal(batch.length >= 50, true);
  assert.equal(keys.has('neighborsCount'), true);
  assert.equal(keys.has('h'), true);
  assert.equal(keys.has('supertrendFactor'), true);
  assert.equal(keys.has('squeezeLength'), true);
  assert.equal(keys.has('divRsiLen'), true);
  assert.equal(keys.has('riskAtrLen'), true);
  assert.equal(keys.has('tpAtrMult'), true);
  assert.equal(keys.has('useTimeStop'), true);
  assert.equal(keys.has('showDash'), false);
  assert.equal(batch.every((item) => item.patchFingerprint?.length === 64), true);
});

test('buildGlobalMutationBatch filters broad parameter surface by family', () => {
  const champion = {
    config: {
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      riskAtrLen: 14,
      trailAtrMult: 1,
      useTrailingStop: true,
      timeStopBars: 8,
    },
  };

  const batch = buildGlobalMutationBatch({
    champion,
    families: ['risk', 'exit', 'exit-state'],
    maxConfigs: 30,
    variantsPerFamily: 3,
  });

  const families = new Set(batch.map((item) => item.mutationFamily));
  assert.deepEqual([...families].sort(), ['exit', 'exit-state', 'risk']);
  assert.equal(batch.some((item) => Object.hasOwn(item.patch, 'tpAtrMult')), true);
  assert.equal(batch.some((item) => Object.hasOwn(item.patch, 'trailAtrMult')), true);
  assert.equal(batch.some((item) => Object.hasOwn(item.patch, 'timeStopBars')), true);
});
```

- [ ] **Step 2: Run failing global tests**

```bash
node --test tests/pine-global-search.test.mjs --test-name-pattern "broad parameter surface|filters broad parameter surface"
```

Expected: FAIL because current generator only emits legacy families.

- [ ] **Step 3: Modify generator to use parameter surface**

In `scripts/lib/pine-global-search.mjs`:

1. Add imports:

```js
import { buildSurfaceMutationCandidates } from './pine-parameter-surface.mjs';
```

2. Change generator version:

```js
const GENERATOR_VERSION = 'global-search-v2-parameter-surface';
```

3. Replace the inner legacy `for (const family of selectedFamilies)` loop in `buildGlobalMutationBatch` with parameter-surface candidates:

```js
  const surfaceCandidates = buildSurfaceMutationCandidates({
    champion: source,
    maxConfigs: limit * Math.max(1, safeVariantsPerFamily) * 4,
    families: selectedFamilies,
    levels: safeVariantsPerFamily,
    includeArchitecture: policy?.allowArchitectureKeys === true,
  });

  for (const surfaceCandidate of surfaceCandidates) {
    const normalizedPatch = Object.fromEntries(toPatchEntries(surfaceCandidate.patch));
    const validation = validateGlobalMutationPatch(normalizedPatch, {
      frozenKeys,
      allowArchitectureKeys: policy?.allowArchitectureKeys === true,
    });
    if (!validation.ok) continue;

    const family = surfaceCandidate.mutationFamily ?? surfaceCandidate.family;
    const patchFingerprint = buildGlobalPatchFingerprint({
      championConfigFingerprint,
      lane,
      mutationFamily: family,
      patch: normalizedPatch,
    });
    if (testedFingerprints.has(patchFingerprint)) continue;
    if (emittedFingerprints.has(patchFingerprint)) continue;
    if (Object.entries(normalizedPatch).every(([key, value]) => Object.is(config?.[key], value))) continue;
    emittedFingerprints.add(patchFingerprint);

    const variantId = `${lane}-${family}-${surfaceCandidate.axis ?? Object.keys(normalizedPatch)[0]}-p${String(out.length + 1).padStart(3, '0')}`;
    out.push({
      candidateId: buildCandidateId({ lane, mutationFamily: family, patch: normalizedPatch }),
      variantId,
      lane,
      family,
      mutationFamily: family,
      axis: surfaceCandidate.axis ?? family,
      patch: normalizedPatch,
      config: { ...config, ...normalizedPatch },
      touchedKeys: Object.keys(normalizedPatch),
      patchFingerprint,
      metadata: {
        ...(surfaceCandidate.metadata || {}),
        originConfigId,
        generatorVersion: GENERATOR_VERSION,
        mutationFamily: family,
        championConfigFingerprint,
        patchFingerprint,
        patchFingerprintVersion: PATCH_FINGERPRINT_VERSION,
      },
    });

    if (out.length >= limit) return out;
  }

  return out;
```

4. Extend `KNOWN_KEYS`, `POSITIVE_KEYS`, and `BOOLEAN_KEYS` to include all keys in the parameter surface. Use exact supported keys from `scripts/lib/pine-parameter-surface.mjs`, including `neighborsCount`, `h`, `r`, `x`, `lag`, `riskAtrLen`, context, squeeze, divergence, and exit-state keys.

- [ ] **Step 4: Run global tests**

```bash
node --test tests/pine-global-search.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-global-search.mjs tests/pine-global-search.test.mjs
git commit -m "feat(pine): broaden global autoresearch parameter surface"
```

---

## Task 5: Broaden Exit-Regime Generator and Filter Novelty

**Files:**
- Modify: `scripts/lib/pine-exit-generators.mjs`
- Modify: `tests/pine-exit-generators.test.mjs`

- [ ] **Step 1: Write failing exit generator tests**

Append to `tests/pine-exit-generators.test.mjs`:

```js
test('buildExitFamilyCandidates emits progressive exit and exit-state surface beyond two fixed patches', () => {
  const champion = {
    id: 'exit-surface-champ',
    config: {
      useStopsTP: true,
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useSignalExits: false,
      useTrailingStop: true,
      trailAtrLen: 14,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useTimeStop: false,
      timeStopBars: 8,
      usePartialDerisk: false,
      partialDeriskAtR: 1,
      useAdverseDivergenceTighten: false,
      adverseDivergenceBars: 6,
    },
  };

  const candidates = buildExitFamilyCandidates({
    incumbent: champion,
    regimeSliceId: 'all-market',
    maxConfigs: 16,
  });

  const keys = new Set(candidates.flatMap((item) => Object.keys(item.patch)));
  assert.equal(candidates.length > 2, true);
  assert.equal(keys.has('riskAtrLen'), true);
  assert.equal(keys.has('slAtrMult'), true);
  assert.equal(keys.has('tpAtrMult'), true);
  assert.equal(keys.has('trailAtrLen'), true);
  assert.equal(keys.has('trailAtrMult'), true);
  assert.equal(keys.has('trailActivateR'), true);
  assert.equal(keys.has('useTimeStop'), true);
  assert.equal(keys.has('timeStopBars'), true);
  assert.equal(candidates.every((item) => item.patchFingerprint?.length === 64), true);
});

test('buildExitFamilyCandidates skips tested exit-regime fingerprints and returns next novel candidates', () => {
  const champion = {
    id: 'exit-novelty-champ',
    config: {
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useTrailingStop: true,
      trailAtrLen: 14,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useTimeStop: false,
      timeStopBars: 8,
    },
  };

  const first = buildExitFamilyCandidates({ incumbent: champion, maxConfigs: 4 });
  const second = buildExitFamilyCandidates({
    incumbent: champion,
    maxConfigs: 4,
    testedPatchFingerprints: new Set(first.map((item) => item.patchFingerprint)),
  });

  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.equal(second.some((item) => first.some((old) => old.patchFingerprint === item.patchFingerprint)), false);
});
```

- [ ] **Step 2: Run failing exit tests**

```bash
node --test tests/pine-exit-generators.test.mjs --test-name-pattern "progressive exit|skips tested exit"
```

Expected: FAIL because generator emits only two candidates and has no novelty filter.

- [ ] **Step 3: Implement broader exit generator**

Modify `scripts/lib/pine-exit-generators.mjs`:

1. Add imports:

```js
import { buildSurfaceMutationCandidates } from './pine-parameter-surface.mjs';
import { filterNovelLaneCandidates } from './pine-lane-novelty.mjs';
```

2. Expand `SUPPORTED_EXIT_PATCH_KEYS` to include every risk/exit/exit-state key with patch support:

```js
export const SUPPORTED_EXIT_PATCH_KEYS = [
  'useStopsTP', 'riskAtrLen', 'slAtrMult', 'tpAtrMult',
  'useSignalExits', 'useTrailingStop', 'trailAtrLen', 'trailAtrMult', 'trailActivateR',
  'useFailedFollowThroughTighten', 'followThroughBars', 'followThroughMinProgressAtr', 'followThroughTightenTrailAtrMult',
  'useTimeStop', 'timeStopBars', 'timeStopMinUnrealizedAtr',
  'useContextCautionTighten', 'contextCautionDelta', 'contextCautionTrailAtrMult',
  'usePartialDerisk', 'partialDeriskAtR', 'partialDeriskClosePct',
  'usePostEntrySqueezeCollapseTighten', 'postEntrySqueezeCollapseBars', 'postEntrySqueezeCollapseTrailAtrMult',
  'useAdverseDivergenceTighten', 'adverseDivergenceBars', 'adverseDivergenceTrailAtrMult',
];
```

3. Replace fixed `patchPool` construction with surface candidates:

```js
  const rawCandidates = buildSurfaceMutationCandidates({
    champion: source,
    maxConfigs: limit * 6,
    families: ['risk', 'exit', 'exit-state'],
    levels: 6,
  }).map((item) => {
    const patch = canonicalPatch(item.patch);
    const exitFamily = item.family === 'risk' ? 'atr-stop-take-profit' : item.family;
    const candidateId = buildCandidateId({ exitFamily, regimeSliceId, patch });
    return {
      candidateId,
      lane: 'exitRegime',
      family: item.family,
      mutationFamily: item.family,
      exitFamily,
      regimeSliceId,
      patch,
      variantId: `exit-regime-${item.family}-${item.axis}-${candidateId}`,
      config: { ...base.config, ...patch },
      metadata: {
        ...(item.metadata || {}),
        axis: item.axis,
        partialTakeProfit: PARTIAL_TAKE_PROFIT_STATUS,
        blockedFamilies: BLOCKED_EXIT_FAMILIES,
        ...(source?.id ? { originConfigId: source.id } : {}),
      },
    };
  }).filter((item) => validateExitPatch(item.patch).ok);

  return filterNovelLaneCandidates({
    candidates: rawCandidates,
    champion: source,
    lane: 'exitRegime',
    testedPatchFingerprints,
  }).slice(0, limit);
```

4. Update `validateExitPatch` numeric/boolean rules for the new keys. Reuse broad numeric limits from the parameter surface. Boolean keys include every `use*` key.

- [ ] **Step 4: Run exit generator tests**

```bash
node --test tests/pine-exit-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-exit-generators.mjs tests/pine-exit-generators.test.mjs
git commit -m "feat(pine): generate progressive exit-regime candidates"
```

---

## Task 5A: Harden Exit Novelty Against Poisoned Evidence

**Files:**
- Modify: `scripts/lib/pine-lane-novelty.mjs`
- Modify: `tests/pine-lane-novelty.test.mjs`

- [ ] **Step 1: Add anti-poison tests mirroring global novelty hardening**

Append to `tests/pine-lane-novelty.test.mjs`:

```js
test('collectTestedLanePatchFingerprints rejects stored-only fingerprints without patch or config evidence', () => {
  const storedOnlyFingerprint = 'a'.repeat(64);
  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [{
      champion: { config: championConfig },
      searchPlan: { variants: [{ lane: 'exitRegime', patchFingerprint: storedOnlyFingerprint, metadata: { championConfigFingerprint } }] },
    }],
  });

  assert.deepEqual([...fingerprints], []);
});

test('collectTestedLanePatchFingerprints rejects malformed stored fingerprint when reconstruction disagrees', () => {
  const wrongFingerprint = 'b'.repeat(64);
  const correctFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [{
      champion: { config: championConfig },
      searchPlan: { variants: [{ lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 }, patchFingerprint: wrongFingerprint, metadata: { championConfigFingerprint } }] },
    }],
  });

  assert.deepEqual([...fingerprints], [correctFingerprint]);
});

test('collectTestedLanePatchFingerprints rejects variant patch and config disagreement', () => {
  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [{
      champion: { config: championConfig },
      searchPlan: { variants: [{ lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 }, config: { ...championConfig, slAtrMult: 0.9 }, metadata: { championConfigFingerprint } }] },
    }],
  });

  assert.deepEqual([...fingerprints], []);
});

test('buildLanePatchFingerprint canonicalizes generated lane aliases', () => {
  const camel = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const kebab = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exit-regime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const globalCamel = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'globalAllParameter', mutationFamily: 'risk', patch: { slAtrMult: 0.4 } });
  const globalKebab = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'global-all-parameter', mutationFamily: 'risk', patch: { slAtrMult: 0.4 } });

  assert.equal(camel, kebab);
  assert.equal(globalCamel, globalKebab);
});
```

- [ ] **Step 2: Run failing anti-poison tests**

```bash
node --test tests/pine-lane-novelty.test.mjs --test-name-pattern "stored-only|malformed stored|patch and config disagreement|canonicalizes generated lane aliases"
```

Expected: FAIL until generic collector validates evidence instead of trusting stored fingerprints.

- [ ] **Step 3: Implement hardened collector behavior**

In `scripts/lib/pine-lane-novelty.mjs`:

- Add `canonicalGeneratedLane(lane)` mapping:

```js
export function canonicalGeneratedLane(lane) {
  if (lane === 'exitRegime' || lane === 'exit-regime') return 'exitRegime';
  if (lane === 'globalAllParameter' || lane === 'global-all-parameter') return 'globalAllParameter';
  return lane ?? null;
}
```

- Use `canonicalGeneratedLane()` inside `buildLanePatchFingerprint()` and collection comparisons.
- Do not add a stored fingerprint unless a reconstructable `patch` exists or a variant `config` differs from champion config in exactly the patch keys.
- If both `patch` and `config` exist, verify every patch key has the patched value in `variant.config` and every non-patch key matches champion config when present.
- If stored fingerprint disagrees with reconstruction, return the reconstructed fingerprint and ignore the stored value.
- If stored fingerprint has no reconstructable evidence, ignore it.

- [ ] **Step 4: Run lane novelty tests**

```bash
node --test tests/pine-lane-novelty.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-lane-novelty.mjs tests/pine-lane-novelty.test.mjs
git commit -m "feat(pine): harden generated-lane novelty evidence"
```

---

## Task 6: Apply Lane Novelty and Exhaustion in Autoresearch Orchestration

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing orchestration tests**

Append to `tests/pine-autoresearch.test.mjs` near existing global exhaustion tests:

```js
test('buildRegimeAwareSearchBatch skips duplicate exitRegime variants from prior manifests', () => {
  const champion = {
    configId: 'champ-exit-repeat',
    config: {
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useTrailingStop: true,
      trailAtrLen: 14,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useTimeStop: false,
      timeStopBars: 8,
    },
  };

  const first = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 4,
    regimeExitResearch: { enabled: true },
  });
  const manifest = {
    champion,
    searchPlan: { variants: first },
  };

  const second = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 4,
    regimeExitResearch: { enabled: true },
    policy: { recentManifestsForNovelty: [manifest] },
  });

  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.equal(second.some((variant) => first.some((old) => old.patchFingerprint === variant.patchFingerprint)), false);
});

test('buildRegimeExitStateForScout reports exhausted exitRegime lane with manifest evidence', () => {
  const champion = {
    configId: 'champ-exit-exhausted',
    config: {
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useTrailingStop: true,
      trailAtrLen: 14,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useTimeStop: false,
      timeStopBars: 8,
    },
  };

  const allVariants = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 200,
    regimeExitResearch: { enabled: true },
  });

  const state = buildRegimeExitStateForScout({
    config: {
      maxConfigs: 8,
      regimeExitResearch: {
        enabled: true,
        exitRegimeEnabled: true,
        globalAllParameterEnabled: false,
        robustnessEnabled: false,
      },
    },
    championState: champion,
    searchBatch: [],
    schedulerState: { stagnationLevel: 0, budgetDebt: { exitRegime: 0 } },
    regimeExitContext: { recentManifestsForNovelty: [{ champion, searchPlan: { variants: allVariants } }] },
  });

  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'exitRegime');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.candidateCount, 0);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.exhausted, true);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');
});
```

- [ ] **Step 2: Run failing orchestration tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "duplicate exitRegime|exhausted exitRegime"
```

Expected: FAIL until autoresearch passes novelty context to exit generator and summarizes lane exhaustion generically.

- [ ] **Step 3: Import generic lane novelty**

In `scripts/pine-autoresearch.mjs`, add:

```js
import {
  collectTestedLanePatchFingerprints,
} from './lib/pine-lane-novelty.mjs';
```

- [ ] **Step 4: Pass tested exit fingerprints into `buildExitFamilyCandidates`**

Inside `buildRegimeAwareSearchBatch`, before calling `buildExitFamilyCandidates`, add:

```js
    const testedPatchFingerprints = collectTestedLanePatchFingerprints({
      champion,
      lane: 'exitRegime',
      historyEvents,
      manifests: policy?.recentManifestsForNovelty || [],
    });
```

Then call:

```js
    const candidates = buildExitFamilyCandidates({
      incumbent: champion,
      champion,
      regimeSliceId: schedulerState?.selectedRegimeSliceId ?? null,
      maxConfigs: safeMaxConfigs,
      testedPatchFingerprints,
    });
```

- [ ] **Step 5: Generalize exhausted-lane summary**

Replace global-only helper names with lane-generic helpers while keeping old wrappers for test compatibility:

```js
function generatedLaneExhaustionReason(lane) {
  if (lane === 'globalAllParameter') return 'global-all-parameter-exhausted';
  if (lane === 'exitRegime') return 'exit-regime-exhausted';
  return `${String(lane || 'generated-lane')}-exhausted`;
}

export function shouldSkipGeneratedLaneSweep({ regimeExitState, searchBatch } = {}) {
  const selectedLane = regimeExitState?.shadowRegimeScoreboard?.selectedLane;
  const summary = regimeExitState?.shadowRegimeScoreboard?.generatorSummary;
  return regimeExitState?.enabled === true
    && ['globalAllParameter', 'exitRegime'].includes(selectedLane)
    && Array.isArray(searchBatch)
    && searchBatch.length === 0
    && summary?.exhausted === true;
}

export function shouldSkipGlobalAllParameterSweep(args = {}) {
  const selectedLane = args?.regimeExitState?.shadowRegimeScoreboard?.selectedLane;
  return selectedLane === 'globalAllParameter' && shouldSkipGeneratedLaneSweep(args);
}
```

- [ ] **Step 6: Record exhaustion for selected generated lane**

In `runScout`, replace global-only skip branch with generic branch:

```js
  if (shouldSkipGeneratedLaneSweep({ regimeExitState: regimeExitStateBeforeSweep, searchBatch: searchVariants })) {
    const selectedLane = regimeExitStateBeforeSweep.shadowRegimeScoreboard.selectedLane;
    const reason = generatedLaneExhaustionReason(selectedLane);
    const championFingerprint = configFingerprint(championState.config);
    const exhaustedManifest = buildGeneratedLaneExhaustedManifest({
      config: trackedConfig,
      runId,
      championState,
      regimeExitState: regimeExitStateBeforeSweep,
      schedulerState,
      reason,
      trackState: {
        activeTrackId,
        windowSetId,
        rotationTrigger: hardRotationTrigger,
        rotationReason: reason,
        candidateFingerprint: championFingerprint,
        championFingerprint,
        labSetId,
        gridName,
      },
    });
    const postExhaustionTrackState = nextTrackState({
      state: schedulerState,
      policy: rotationPolicy,
      manifest: buildGlobalAllParameterExhaustedSchedulerManifestInput({
        manifest: exhaustedManifest,
        championState,
      }),
    });
    const laneConfigFingerprint = buildChampionConfigFingerprint(championState.config);
    const updatedSchedulerState = recordResearchLaneExhaustion({
      state: postExhaustionTrackState,
      lane: selectedLane,
      championConfigFingerprint: laneConfigFingerprint,
      exhaustedAt: exhaustedManifest.generatedAt,
      runId,
      reason,
      stagnationLevel: postExhaustionTrackState.stagnationLevel ?? schedulerState?.stagnationLevel ?? 0,
      budgetDebt: postExhaustionTrackState.budgetDebt || schedulerState?.budgetDebt || {},
      lanesEnabled: resolveRegimeLaneEnabled(trackedConfig.regimeExitResearch || {}),
    });
    await writeSchedulerState(schedulerStatePath, updatedSchedulerState);
    const finalExhaustedManifest = applySchedulerStateToManifest(exhaustedManifest, updatedSchedulerState);
    const finalizedArtifact = await finalizeAutoresearchManifest({ root: trackedConfig.researchRoot, manifest: finalExhaustedManifest });
    manifestFinalized = true;
    const artifactPaths = await writeScoutCycleArtifacts({ config: trackedConfig, championState, manifest: finalExhaustedManifest, manifestPath: finalizedArtifact.manifestPath });
    return { skipped: true, reason, manifest: finalExhaustedManifest, manifestPath: finalizedArtifact.manifestPath, ...artifactPaths };
  }
```

- [ ] **Step 7: Run orchestration tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "duplicate exitRegime|exhausted exitRegime|globalAllParameter"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): enforce novelty and exhaustion for generated lanes"
```

---

## Task 7: Scheduler No-Livelock Tests

**Files:**
- Modify: `tests/pine-regime-exit-scheduler.test.mjs`
- Modify: `scripts/lib/pine-regime-exit-scheduler.mjs` only if tests reveal needed behavior change

- [ ] **Step 1: Write scheduler tests**

Append to `tests/pine-regime-exit-scheduler.test.mjs`:

```js
test('selectNextResearchLane skips exhausted global and exit generated lanes', () => {
  const championConfigFingerprint = 'champion-fp-all-generated-exhausted';
  const lane = selectNextResearchLane({
    stagnationLevel: 3,
    budgetDebt: { globalAllParameter: 999, exitRegime: 999, robustness: 0, exploit: 0 },
    lanesEnabled: { exploit: true, exitRegime: true, globalAllParameter: true, robustness: true },
    championConfigFingerprint,
    schedulerState: {
      laneExhaustions: {
        [championConfigFingerprint]: {
          globalAllParameter: { lane: 'globalAllParameter', reason: 'global-all-parameter-exhausted' },
          exitRegime: { lane: 'exitRegime', reason: 'exit-regime-exhausted' },
        },
      },
    },
  });

  assert.notEqual(lane, 'globalAllParameter');
  assert.notEqual(lane, 'exitRegime');
  assert.equal(['robustness', 'exploit'].includes(lane), true);
});

test('selectNextResearchLane returns null when every enabled lane is exhausted', () => {
  const championConfigFingerprint = 'champion-fp-all-lanes-exhausted';
  const lane = selectNextResearchLane({
    stagnationLevel: 3,
    lanesEnabled: { exploit: true, exitRegime: true, globalAllParameter: true, robustness: true },
    championConfigFingerprint,
    schedulerState: {
      laneExhaustions: {
        [championConfigFingerprint]: {
          exploit: { lane: 'exploit', reason: 'exploit-exhausted' },
          exitRegime: { lane: 'exitRegime', reason: 'exit-regime-exhausted' },
          globalAllParameter: { lane: 'globalAllParameter', reason: 'global-all-parameter-exhausted' },
          robustness: { lane: 'robustness', reason: 'robustness-exhausted' },
        },
      },
    },
  });

  assert.equal(lane, null);
});
```

- [ ] **Step 2: Run scheduler tests**

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: PASS if current scheduler already handles persisted lane exhaustion generically; if FAIL, fix `resolveExhaustedResearchLanes` / `selectNextResearchLane` to use all keys in `LANE_KEYS` exactly.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/pine-regime-exit-scheduler.mjs tests/pine-regime-exit-scheduler.test.mjs
git commit -m "test(pine): prevent generated-lane scheduler livelock"
```

---

## Task 7A: Preserve Existing Phase3 Grid Semantics

**Files:**
- Modify: `tests/pine-tuner.test.mjs`
- Modify: `scripts/lib/pine-tuner.mjs` only if the test reveals a regression

- [ ] **Step 1: Add regression test for explicit phase3 variants**

Append to `tests/pine-tuner.test.mjs`:

```js
test('phase3-core keeps explicit variant count semantics', () => {
  const grid = getCandidateGrid('phase3-core');

  assert.equal(Array.isArray(grid.__variants), true);
  assert.equal(grid.__variants.length, 60);
  assert.equal(countSweepCombos(grid), grid.__variants.length);
  assert.equal(Object.keys(grid).filter((key) => !key.startsWith('__')).length >= 70, true);
});
```

Ensure imports include `countSweepCombos` and `getCandidateGrid` from `../scripts/lib/pine-tuner.mjs`.

- [ ] **Step 2: Run regression test**

```bash
node --test tests/pine-tuner.test.mjs --test-name-pattern "phase3-core keeps explicit variant count semantics"
```

Expected: PASS before implementation and PASS after implementation. If it fails after surface work, restore explicit-variant behavior unless the user explicitly approves changing `phase3-core` semantics.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-tuner.test.mjs scripts/lib/pine-tuner.mjs
git commit -m "test(pine): preserve phase3 core explicit variants"
```

---

## Task 8: Production Invariants for Progressive Generated Lanes

**Files:**
- Modify: `tests/pine-autoresearch-production-invariants.test.mjs`

- [ ] **Step 1: Add invariant tests**

Append a production invariant test:

```js
test('generated regime lane variants carry current-champion patch fingerprints', async () => {
  const config = await loadProductionConfig();
  const champion = await loadProductionChampion(config);
  const recentManifests = await loadProductionManifests(config);

  for (const lane of ['globalAllParameter', 'exitRegime']) {
    const batch = buildRegimeAwareSearchBatch({
      selectedLane: lane,
      champion,
      maxConfigs: 8,
      regimeExitResearch: config.regimeExitResearch,
      policy: { ...config.searchPolicy, recentManifestsForNovelty: recentManifests },
    });

    for (const variant of batch) {
      assert.equal(typeof variant.patchFingerprint, 'string', `${lane} variant missing patchFingerprint`);
      assert.equal(variant.patchFingerprint.length, 64, `${lane} variant fingerprint length`);
      assert.equal(variant.metadata?.patchFingerprint, variant.patchFingerprint, `${lane} metadata fingerprint mismatch`);
      assert.equal(typeof variant.metadata?.championConfigFingerprint, 'string', `${lane} missing championConfigFingerprint`);
      assert.equal(Object.keys(variant.patch || {}).length > 0, true, `${lane} empty patch`);
    }
  }
});
```

If helper names differ in the file, use the existing production invariant helper names already present in `tests/pine-autoresearch-production-invariants.test.mjs`. Do not add filesystem assumptions beyond existing helpers.

- [ ] **Step 2: Run invariant test**

```bash
node --test tests/pine-autoresearch-production-invariants.test.mjs --test-name-pattern "generated regime lane variants"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-autoresearch-production-invariants.test.mjs
git commit -m "test(pine): require fingerprints for generated regime lanes"
```

---

## Task 9: Configurable Surface Controls

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `scripts/lib/pine-regime-exit-config.mjs`
- Modify: `tests/pine-regime-exit-config.test.mjs`

- [ ] **Step 1: Add config tests**

Append to `tests/pine-regime-exit-config.test.mjs`:

```js
test('normalizeRegimeExitResearchConfig preserves parameter surface controls', () => {
  const config = normalizeRegimeExitResearchConfig({
    enabled: true,
    parameterSurface: {
      enabledFamilies: ['ml-core', 'entry', 'risk', 'exit', 'exit-state'],
      globalLevels: 6,
      exitLevels: 6,
      allowArchitectureKeys: false,
    },
  });

  assert.deepEqual(config.parameterSurface.enabledFamilies, ['ml-core', 'entry', 'risk', 'exit', 'exit-state']);
  assert.equal(config.parameterSurface.globalLevels, 6);
  assert.equal(config.parameterSurface.exitLevels, 6);
  assert.equal(config.parameterSurface.allowArchitectureKeys, false);
});
```

- [ ] **Step 2: Capture existing production config diff before editing**

```bash
git diff -- config/pine-autoresearch.default.json
```

Expected: if output is non-empty, preserve it in the worker notes and merge new `parameterSurface` fields into the existing dirty file without overwriting unrelated user changes.

- [ ] **Step 3: Run failing config test**

```bash
node --test tests/pine-regime-exit-config.test.mjs --test-name-pattern "parameter surface controls"
```

Expected: FAIL until config normalizer preserves these fields.

- [ ] **Step 4: Implement config normalization**

In `scripts/lib/pine-regime-exit-config.mjs`, add default:

```js
const DEFAULT_PARAMETER_SURFACE = {
  enabledFamilies: [
    'ml-core', 'entry', 'filters', 'fusion', 'supertrend',
    'avwap-context', 'channel-context', 'context-aggregator', 'context-exit-shaping',
    'squeeze', 'divergence', 'risk', 'exit', 'exit-state',
  ],
  globalLevels: 6,
  exitLevels: 6,
  allowArchitectureKeys: false,
};
```

Then merge into normalized output:

```js
parameterSurface: {
  ...DEFAULT_PARAMETER_SURFACE,
  ...(input.parameterSurface || {}),
  enabledFamilies: Array.isArray(input.parameterSurface?.enabledFamilies) && input.parameterSurface.enabledFamilies.length > 0
    ? input.parameterSurface.enabledFamilies.filter((item) => typeof item === 'string' && item.length > 0)
    : DEFAULT_PARAMETER_SURFACE.enabledFamilies,
  globalLevels: Math.max(1, Math.floor(Number(input.parameterSurface?.globalLevels) || DEFAULT_PARAMETER_SURFACE.globalLevels)),
  exitLevels: Math.max(1, Math.floor(Number(input.parameterSurface?.exitLevels) || DEFAULT_PARAMETER_SURFACE.exitLevels)),
  allowArchitectureKeys: input.parameterSurface?.allowArchitectureKeys === true,
},
```

- [ ] **Step 5: Add default config values**

In `config/pine-autoresearch.default.json`, under `regimeExitResearch`, add:

```json
"parameterSurface": {
  "enabledFamilies": [
    "ml-core",
    "entry",
    "filters",
    "fusion",
    "supertrend",
    "avwap-context",
    "channel-context",
    "context-aggregator",
    "context-exit-shaping",
    "squeeze",
    "divergence",
    "risk",
    "exit",
    "exit-state"
  ],
  "globalLevels": 6,
  "exitLevels": 6,
  "allowArchitectureKeys": false
}
```

- [ ] **Step 6: Wire config to generators**

In `scripts/pine-autoresearch.mjs`, pass:

```js
families: regimeExitResearch?.parameterSurface?.enabledFamilies,
variantsPerFamily: regimeExitResearch?.parameterSurface?.globalLevels ?? policy?.globalAllParameterVariantsPerFamily ?? 6,
```

For exit generator pass:

```js
levels: regimeExitResearch?.parameterSurface?.exitLevels ?? 6,
```

- [ ] **Step 7: Run config tests**

```bash
node --test tests/pine-regime-exit-config.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add config/pine-autoresearch.default.json scripts/lib/pine-regime-exit-config.mjs tests/pine-regime-exit-config.test.mjs
git commit -m "feat(pine): configure autoresearch parameter surface"
```

---

## Task 10: End-to-End Non-Repetition Harness

**Files:**
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add fake-run end-to-end test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('runScout writes different generated candidates across repeated exitRegime cycles for same champion', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-exit-progressive-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, [
      'slAtrMult = input.float(0.5, title="SL ATR x")',
      'tpAtrMult = input.float(7.6, title="TP ATR x (1:1 R:R by default)")',
      'riskAtrLen = input.int(14, title="ATR Length")',
      'useTrailingStop = input.bool(true, title="Use ATR Trailing Stop")',
      'trailAtrLen = input.int(14, title="Trail ATR Length")',
      'trailAtrMult = input.float(1, title="Trail ATR x")',
      'trailActivateR = input.float(0.5, title="Trail Activate at R")',
      'useTimeStop = input.bool(false, title="Use Time Stop")',
      'timeStopBars = input.int(8, title="Time Stop Bars")',
    ].join('\n'), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'exit-progressive-runscout-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 4,
      minTrades: 1,
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      primaryLab: { labId: 'primary', symbol: 'XRPUSDT', timeframe: '15m', limit: 12, when: '2026-05-01T03:00:00.000Z', exchange: 'ccxt-exchange' },
      shadowLabs: [],
      blindHoldoutLabs: [],
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        exitRegimeEnabled: true,
        globalAllParameterEnabled: false,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
        parameterSurface: { enabledFamilies: ['risk', 'exit', 'exit-state'], exitLevels: 6, globalLevels: 6, allowArchitectureKeys: false },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = {
      configId: 'champ-runscout-exit-progressive',
      config: { riskAtrLen: 14, slAtrMult: 0.5, tpAtrMult: 7.6, useTrailingStop: true, trailAtrLen: 14, trailAtrMult: 1, trailActivateR: 0.5, useTimeStop: false, timeStopBars: 8 },
    };
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({ ...champion, configFingerprint: 'champ-runscout-exit-progressive-fp' }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({ stagnationLevel: 0, budgetDebt: { exitRegime: 0 } }), 'utf8');

    const sweepVariantFingerprints = [];
    const runPrimarySweep = async (_config, _runId, options) => {
      const variants = JSON.parse(await fs.readFile(options.variantFilePath, 'utf8'));
      sweepVariantFingerprints.push(variants.map((variant) => variant.patchFingerprint));
      return { topConfigs: [{ configId: champion.configId, score: 1, roiPct: 1, profitFactor: 1, maxDrawdownPct: 1, tradeCount: 10, config: champion.config }] };
    };

    await autoresearchCli.runScout(config, { runPrimarySweep });
    await autoresearchCli.runScout(config, { runPrimarySweep });

    assert.equal(sweepVariantFingerprints.length, 2);
    assert.equal(sweepVariantFingerprints[0].length, 4);
    assert.equal(sweepVariantFingerprints[1].length, 4);
    assert.equal(sweepVariantFingerprints[1].some((fp) => sweepVariantFingerprints[0].includes(fp)), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run end-to-end test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "different generated candidates across repeated exitRegime"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-autoresearch.test.mjs
git commit -m "test(pine): prove repeated exit-regime cycles progress"
```

---

## Task 11: Full Verification Matrix

**Files:**
- No source changes unless verification reveals failures.

- [ ] **Step 1: Run targeted generator/orchestration tests**

```bash
node --test tests/pine-parameter-surface.test.mjs tests/pine-lane-novelty.test.mjs tests/pine-global-search.test.mjs tests/pine-exit-generators.test.mjs tests/pine-regime-exit-scheduler.test.mjs tests/pine-regime-exit-config.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run autoresearch hardening suite**

```bash
npm run test:pine:autoresearch:hardening
```

Expected: PASS. Fixture-only production artifact skips are acceptable only if current suite already marks them skipped.

- [ ] **Step 3: Run main affected tests**

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-tuner.test.mjs tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Validate dataset cache state**

```bash
npm run pine:dataset:verify
```

Expected: exit 0. Existing incomplete-cache/missing-count warnings can remain only if command exits 0 and they match pre-existing dataset status.

- [ ] **Step 5: Check whitespace/diff health**

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Inspect latest generator behavior without starting a live cycle**

Run a Node probe that builds candidates only:

```bash
node -e "import('./scripts/pine-autoresearch.mjs').then(async m=>{const fs=await import('node:fs'); const path=await import('node:path'); const cfg=await m.loadConfig(process.cwd(),'./config/pine-autoresearch.default.json',{}); const champion=JSON.parse(fs.readFileSync(path.join(cfg.researchRoot,'champion.json'),'utf8')); const global=m.buildRegimeAwareSearchBatch({selectedLane:'globalAllParameter', champion, maxConfigs:8, regimeExitResearch:cfg.regimeExitResearch, policy:cfg.searchPolicy}); const exit=m.buildRegimeAwareSearchBatch({selectedLane:'exitRegime', champion, maxConfigs:8, regimeExitResearch:cfg.regimeExitResearch, policy:cfg.searchPolicy}); console.log(JSON.stringify({globalCount:global.length, exitCount:exit.length, globalKeys:[...new Set(global.flatMap(v=>Object.keys(v.patch||{})))], exitKeys:[...new Set(exit.flatMap(v=>Object.keys(v.patch||{})))]},null,2));})"
```

Expected: `exitCount` is greater than 2 when current champion has untested exit surface patches; generated keys include more than `slAtrMult`, `tpAtrMult`, `useTrailingStop`, `trailAtrMult`.

- [ ] **Step 7: Commit final verification notes if docs changed**

If no docs changed, do not create a docs-only commit.

---

## Task 12: Safe Rollout Procedure

**Files:**
- Scheduler state under `pine/autoresearch/.../state/scheduler/*.json`
- No code changes.

- [ ] **Step 1: Confirm no live process or lock**

```powershell
Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path,StartTime
Test-Path D:\Code\Experiment\backtest-kit-project\pine\autoresearch\pine-fusion-v4-core-15m-locked-window\state\autoresearch.lock.json
Test-Path D:\Code\Experiment\backtest-kit-project\tmp\pine-autoresearch-locks\scheduler.lock
```

Expected: no live autoresearch process and both lock checks `False` before manual cycle.

- [ ] **Step 2: Backup scheduler state**

```powershell
$state = 'D:\Code\Experiment\backtest-kit-project\pine\autoresearch\pine-fusion-v4-core-15m-locked-window\state\scheduler\pine-fusion-v4-core-15m-locked-window.json'
$backup = "$state.bak-$(Get-Date -Format yyyyMMddTHHmmssZ)"
Copy-Item $state $backup
Write-Host $backup
```

Expected: backup file path printed.

- [ ] **Step 3: Clear stale generated-lane exhaustion only after code fix is merged**

Use this only after all verification above passes. Do not clear exhaustion before code fix; that only restarts the old livelock.

```powershell
node -e "const fs=require('fs'); const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/pine-fusion-v4-core-15m-locked-window.json'; const s=JSON.parse(fs.readFileSync(p,'utf8')); delete s.lastLaneExhaustion; s.laneExhaustions={}; s.stagnationLevel=1; fs.writeFileSync(p, JSON.stringify(s,null,2)); console.log(JSON.stringify({stagnationLevel:s.stagnationLevel, laneExhaustions:s.laneExhaustions},null,2));"
```

Expected: `laneExhaustions` is `{}` and `stagnationLevel` remains at least `1` so global search receives pressure.

- [ ] **Step 4: Run one manual full scout cycle**

```bash
npm run pine:autoresearch -- --profile full
```

Expected: first cycle writes a variants file with broad generated candidates, not the old two fixed exit variants. If this starts a long cycle, wait for completion and inspect manifest.

- [ ] **Step 5: Inspect generated variants after manual cycle**

```powershell
$root='D:\Code\Experiment\backtest-kit-project\pine\autoresearch\pine-fusion-v4-core-15m-locked-window'
Get-ChildItem $root -Filter '*-variants.json' | Sort-Object LastWriteTime | Select-Object -Last 1 | ForEach-Object { Get-Content $_.FullName | ConvertFrom-Json | Select-Object lane,variantId,patchFingerprint,patch | Format-List }
```

Expected: variant file includes patch fingerprints and multiple useful strategy parameters. It must not contain only:

```json
[{"slAtrMult":0.25,"tpAtrMult":8.1},{"trailAtrMult":1,"useTrailingStop":false}]
```

- [ ] **Step 6: Re-enable scheduled tasks only after manual cycle produces progressive variants**

```powershell
Enable-ScheduledTask -TaskName BacktestKit-Pine-Full
Enable-ScheduledTask -TaskName BacktestKit-Pine-Micro
Enable-ScheduledTask -TaskName BacktestKit-Pine-Digest
```

Expected: tasks enabled only after one verified progressive manual cycle.

---

## Acceptance Criteria

The implementation is complete only when all criteria are true:

1. `globalAllParameter` can emit far more than 24 current-champion patches through the patcher-backed parameter surface.
2. `exitRegime` can emit far more than 2 current-champion patches.
3. Every generated `globalAllParameter` and `exitRegime` candidate has a champion-bound 64-char `patchFingerprint`.
4. Prior manifests/history suppress repeated generated-lane candidates for the same champion.
5. Exhausted `exitRegime` is recorded in scheduler state the same way exhausted `globalAllParameter` is recorded.
6. Scheduler never picks a generated lane that is exhausted for the current champion.
7. Consecutive fake `runScout` cycles for the same champion produce different generated fingerprints until that lane exhausts.
8. Production invariant tests pass.
9. Manual rollout creates broad variant files before scheduled tasks are re-enabled.
10. An 8-candidate global batch includes broad family diversity, not just early catalog keys.
11. Exit novelty collection has the same anti-poison discipline as the existing global collector.
12. Lane aliases (`exit-regime`/`exitRegime`, `global-all-parameter`/`globalAllParameter`) produce canonical matching fingerprints and exhaustion records.
13. `phase3-core` grid behavior remains backward-compatible.
14. Final report separates “progressive exploration verified” from “profitability improved”; profitability requires separate outcome evidence.

---

## Self-Review

### Spec coverage

- Actual Pine parameter surface: covered by Task 2 and Task 4.
- Progressive global search: covered by Task 4.
- Progressive exit search: covered by Task 5.
- Reliable non-repetition: covered by Task 3, Task 6, Task 7, Task 8, Task 10.
- Safe rollout: covered by Task 12.
- Verification: covered by Task 11.

### Placeholder scan

No `TBD`, `TODO`, `implement later`, or “write appropriate tests” placeholders remain. Every task has concrete files, test commands, code snippets, and expected results.

### Type consistency

Shared names are consistent across tasks:

- `parameterSurfaceCatalog`, `parameterSurfaceKeys`, `strategicParameterFamilies`, `buildParameterLadder`, `buildSurfaceMutationCandidates`
- `buildLanePatchFingerprint`, `collectTestedLanePatchFingerprints`, `filterNovelLaneCandidates`
- `patchableParameterKeys`, `hasPatchSupport`
- `shouldSkipGeneratedLaneSweep`

### Risk notes

- Do not reset scheduler exhaustion or re-enable scheduled tasks until code-level generator and novelty fixes are merged and verified.
- If `config/pine-autoresearch.default.json` is already dirty before implementation, inspect and preserve user changes before editing.
- Keep architecture booleans disabled by default (`allowArchitectureKeys: false`) to avoid destabilizing the champion lineage unless explicitly enabled later.
