# Pine Autoresearch Generation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Pine autoresearch variant generation, protect promotion gates, and make regime/asymmetry diagnostics honest before running another optimization cycle.

**Architecture:** Fix the system from the outside inward: first remove risky config drift, then make track/family generation capable of emitting real non-tabu variants, then make diagnostics stop reporting missing data as evidence. Each task is test-first and independently verifiable with focused `node --test` commands.

**Tech Stack:** Node.js ESM, `node:test`, JSON config, Pine script artifacts, existing autoresearch modules under `scripts/lib/` and `scripts/pine-autoresearch.mjs`.

---

## Current Evidence Baseline

- Latest clean artifact audit found run `pine-fusion-v4-core-15m-locked-window-2026-05-14T18-41-22-383Z` emitted zero variants.
- Champion and challenger were identical: `original-153-champion`, score `152.47`, ROI `91.7%`, PF `3.56`, DD `2.88%`, trades `261`.
- `primarySweep.skipReason = no-variants-generated`; `variants.json = []`; `searchEfficiency.allCandidatesTabu = true`; exhausted families were `signal` and `risk`.
- Scheduler showed `activeTrackId = supertrend-tuning`, `sameTrackCycleStreak = 7`, `noNewCandidateStreak = 2`, `lowEmissionStreak = 2`, `stagnationLevel = 1`, escape `none/not-eligible`.
- Current working tree is on `main` with uncommitted edits. Do not implement on `main` without explicit user consent; execution should start from a branch/worktree.

## File Structure

- Modify: `config/pine-autoresearch.default.json`
  - Restore regime-exit promotion floor drift.
- Modify: `scripts/lib/pine-tuner.mjs`
  - Expose track-owned knob keys for `supertrend`, `ml-core`, `fusion`, `avwap-context`, `channel-context`, and `context-aggregator`.
- Modify: `scripts/lib/pine-track-generators.mjs`
  - Add real patch pools for currently advertised but unsupported families.
  - Make unsupported fallback families visible instead of silently narrowing to `signal/risk`.
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
  - Keep or strengthen tabu aging/stagnation behavior already being tested by `tests/pine-autoresearch-tabu-saturation.test.mjs`.
- Modify: `scripts/pine-autoresearch.mjs`
  - Fix multi-lab regime diagnostics row/trade alignment.
- Modify: `scripts/lib/pine-regime-analysis.mjs`
  - Prefer normalized return percent for mixed-symbol side metrics.
  - Stop turning empty metrics into fake threshold surfaces.
  - Render missing MFE/MAE as `n/a`, not `0`.
- Modify: `scripts/lib/pine-optimizer.mjs`
  - Add MFE/MAE fields from OHLC path during simulated trades.
- Modify: `scripts/lib/pine-streaming-metrics.mjs`
  - Add same MFE/MAE fields to streaming trade builder if it is used for persisted trade previews.
- Modify tests:
  - `tests/pine-track-generators.test.mjs`
  - `tests/pine-autoresearch-tabu-saturation.test.mjs`
  - `tests/pine-regime-analysis.test.mjs`
  - `tests/pine-autoresearch.test.mjs`
  - `tests/pine-optimizer.test.mjs` or nearest existing optimizer test file

---

### Task 0: Safe Execution Setup

**Files:**
- No production edits.

- [ ] **Step 1: Confirm branch and dirty state**

Run:

```bash
git status --short
git rev-parse --abbrev-ref HEAD
```

Expected: current dirty files are visible. If branch is `main`, do not continue unless user approves edits on `main` or you create a branch/worktree.

- [ ] **Step 2: Create implementation branch**

Run:

```bash
git switch -c fix/pine-autoresearch-generation-recovery
```

Expected: branch changes from `main` to `fix/pine-autoresearch-generation-recovery`.

- [ ] **Step 3: Re-check dirty state**

Run:

```bash
git status --short
```

Expected: same pre-existing six modified files remain visible. Treat them as existing work; do not overwrite blindly.

---

### Task 1: Restore Regime-Exit Promotion Floors

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Test: existing config-loading tests in `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Inspect current drift**

Run:

```bash
git diff -- config/pine-autoresearch.default.json
```

Expected: diff shows only this risky drift inside `regimeExitResearch.promotion`:

```diff
-      "minRoiDeltaPct": 3,
-      "minProfitFactorDelta": 0.1,
+      "minRoiDeltaPct": 0,
+      "minProfitFactorDelta": 0,
```

- [ ] **Step 2: Restore safe promotion floor**

Edit `config/pine-autoresearch.default.json` in the `regimeExitResearch.promotion` block so it reads:

```json
      "promotion": {
        "allowAutomaticRegimeSwitching": false,
        "requireGlobalChampionAnchor": true,
        "minRoiDeltaPct": 3,
        "minProfitFactorDelta": 0.1,
        "minTradeCount": 60,
        "requireBlindHoldoutVerdict": true
      }
```

- [ ] **Step 3: Run focused config tests**

Run:

```bash
node --test --test-name-pattern="loads extended self-loop escape config|regimeExitResearch|promotion" tests/pine-autoresearch.test.mjs
```

Expected: tests matching existing config behavior pass. If no test matches `regimeExitResearch`, add a test in Task 1 Step 4.

- [ ] **Step 4: Add explicit regression test if missing**

Modify `tests/pine-autoresearch.test.mjs` with this test near existing config normalization tests:

```js
test('default regime-exit promotion keeps profitability floor', async () => {
  const configPath = path.resolve('config/pine-autoresearch.default.json');
  const raw = JSON.parse(await fs.readFile(configPath, 'utf8'));

  assert.equal(raw.regimeExitResearch.promotion.minRoiDeltaPct, 3);
  assert.equal(raw.regimeExitResearch.promotion.minProfitFactorDelta, 0.1);
  assert.equal(raw.regimeExitResearch.promotion.requireBlindHoldoutVerdict, true);
});
```

If `path` or `fs` are not imported in that file, use its existing import pattern. Do not add a second incompatible import style.

- [ ] **Step 5: Verify**

Run:

```bash
node --test --test-name-pattern="default regime-exit promotion keeps profitability floor" tests/pine-autoresearch.test.mjs
```

Expected: `pass 1`, `fail 0` for this named test.

- [ ] **Step 6: Commit**

```bash
git add config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs
git commit -m "fix: preserve regime exit promotion floors"
```

---

### Task 2: Add Real Track-Owned Keys for Advertised Families

**Files:**
- Modify: `scripts/lib/pine-tuner.mjs`
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Write failing test for family key exposure**

Add to `tests/pine-track-generators.test.mjs` after `shared and track-owned knob lists are exposed`:

```js
test('advertised autoresearch families expose track-owned knob lists', () => {
  assert.deepEqual(trackOwnKnobKeys('supertrend-tuning'), [
    'useSupertrendFilter',
    'useSupertrendEntryConfirm',
    'supertrendAtrLen',
    'supertrendFactor',
  ]);

  assert.ok(trackOwnKnobKeys('ml-core-tuning').includes('neighborsCount'));
  assert.ok(trackOwnKnobKeys('ml-core-tuning').includes('cap'));
  assert.ok(trackOwnKnobKeys('ml-core-tuning').includes('sampleStride'));

  assert.ok(trackOwnKnobKeys('fusion').includes('useFusionV4'));
  assert.ok(trackOwnKnobKeys('fusion').includes('fusionV4LongAtrWeight'));
  assert.ok(trackOwnKnobKeys('avwap-context').includes('avwapSwingPeriod'));
  assert.ok(trackOwnKnobKeys('channel-context').includes('channelDetectLength'));
  assert.ok(trackOwnKnobKeys('context-aggregator').includes('contextBoostValue'));
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test --test-name-pattern="advertised autoresearch families expose track-owned knob lists" tests/pine-track-generators.test.mjs
```

Expected before implementation: FAIL because these families currently do not expose full own-key lists.

- [ ] **Step 3: Implement key lists**

Modify `scripts/lib/pine-tuner.mjs` near `TRACK_OWN_KNOB_KEYS` and context key constants:

```js
const SUPERtrend_CONTEXT_KEYS = [
  'useSupertrendFilter',
  'useSupertrendEntryConfirm',
  'supertrendAtrLen',
  'supertrendFactor',
];

const ML_CORE_KEYS = [
  'neighborsCount',
  'cap',
  'sampleStride',
];

const FUSION_CONTEXT_KEYS = [
  'useSignalFusion',
  'minFusionScore',
  'useAtrFlipConfirm',
  'use3LineConfirm',
  'useEngulfingConfirm',
  'useEmaCrossConfirm',
  'useFusionV2',
  'fusionBonusPerSignal',
  'fusionMaxBonus',
  'useFusionV3',
  'fusionPenaltyPerMissing',
  'useFusionV4',
  'fusionV4MinAbsPrediction',
  'fusionV4MaxAbsPrediction',
  'fusionV4LongAtrWeight',
  'fusionV4LongEngulfWeight',
  'fusionV4LongEmaWeight',
  'fusionV4ShortAtrWeight',
  'fusionV4ShortEngulfWeight',
  'fusionV4ShortEmaWeight',
];
```

Use `SUPERtrend_CONTEXT_KEYS` only if that exact casing is accepted by lint/style. Preferred final name is `SUPERTREND_CONTEXT_KEYS`; if using that, update references consistently.

Then extend `TRACK_OWN_KNOB_KEYS`:

```js
  supertrend: SUPERTREND_CONTEXT_KEYS,
  'ml-core': ML_CORE_KEYS,
  fusion: FUSION_CONTEXT_KEYS,
  'avwap-context': AVWAP_CONTEXT_KEYS,
  'channel-context': CHANNEL_CONTEXT_KEYS,
  'context-aggregator': CONTEXT_AGGREGATOR_KEYS,
```

Extend `trackFamilyAliases(name)`:

```js
  if (normalized.includes('supertrend')) return 'supertrend';
  if (normalized.includes('ml-core') || normalized.includes('mlcore')) return 'ml-core';
  if (normalized.includes('fusion')) return 'fusion';
  if (normalized.includes('avwap')) return 'avwap-context';
  if (normalized.includes('channel')) return 'channel-context';
  if (normalized.includes('aggregator')) return 'context-aggregator';
```

- [ ] **Step 4: Run focused test**

Run:

```bash
node --test --test-name-pattern="advertised autoresearch families expose track-owned knob lists" tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-tuner.mjs tests/pine-track-generators.test.mjs
git commit -m "feat: expose advertised pine track knob families"
```

---

### Task 3: Add Real Patch Pools for Supertrend, ML, Fusion, AVWAP, Channel

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs`
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Write failing generation tests**

Add to `tests/pine-track-generators.test.mjs`:

```js
const expandedIncumbent = {
  ...incumbent,
  useSignalFusion: true,
  minFusionScore: 1,
  useAtrFlipConfirm: true,
  use3LineConfirm: false,
  useEngulfingConfirm: true,
  useEmaCrossConfirm: false,
  useFusionV4: true,
  fusionV4MinAbsPrediction: 2,
  fusionV4MaxAbsPrediction: 4,
  fusionV4LongAtrWeight: -0.25,
  fusionV4LongEngulfWeight: -0.25,
  fusionV4LongEmaWeight: 0,
  fusionV4ShortAtrWeight: -0.5,
  fusionV4ShortEngulfWeight: -0.1,
  fusionV4ShortEmaWeight: 0,
  useSupertrendFilter: true,
  useSupertrendEntryConfirm: false,
  supertrendAtrLen: 10,
  supertrendFactor: 1.5,
  neighborsCount: 32,
  cap: 400,
  sampleStride: 4,
  useAvwapContext: false,
  avwapSwingPeriod: 50,
  avwapReclaimFreshBars: 6,
  avwapMaxDistanceAtr: 1,
  avwapMaxAnchorAge: 100,
  avwapRequireReclaimForEntry: false,
  useChannelContext: false,
  channelDetectLength: 18,
  channelCompressionThreshold: 0.35,
  channelBreakoutFreshBars: 4,
  channelEnableRetest: false,
  channelRetestFreshBars: 6,
  channelHostileBlocksEntry: true,
};

test('supertrend track emits actual supertrend mutations', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'supertrend-tuning', sourceFamily: 'supertrend' },
    incumbent: expandedIncumbent,
    maxConfigs: 4,
    historyEvents: [],
    budgetPolicy: {},
  });

  assert.equal(batch.length > 0, true);
  assert.equal(batch.every((item) => item.family === 'supertrend'), true);
  assert.equal(batch.some((item) => Object.hasOwn(item.patch, 'supertrendFactor')), true);
  assert.equal(batch.some((item) => Object.hasOwn(item.patch, 'supertrendAtrLen')), true);
});

test('advertised fallback families emit non-empty family-specific candidates under stagnation', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'supertrend-tuning', sourceFamily: 'supertrend' },
    incumbent: expandedIncumbent,
    maxConfigs: 24,
    historyEvents: [],
    budgetPolicy: {
      annealing: { enabled: true, baseTemperature: 1, growthFactor: 1, maxTemperature: 8 },
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        stagnationFallbackFamilies: ['ml-core', 'fusion', 'supertrend', 'avwap-context', 'channel-context'],
        minFallbackConfigs: 12,
        temperatureBoost: 1.5,
        stagnationTemperatureBoost: 3,
      },
    },
    schedulerState: { noNewCandidateStreak: 3, stagnationLevel: 2, tabuRejectedFingerprints: [] },
  });

  const families = new Set(batch.filter((item) => item.lane === 'self-loop-fallback').map((item) => item.family));
  for (const family of ['ml-core', 'fusion', 'supertrend', 'avwap-context', 'channel-context']) {
    assert.equal(families.has(family), true, `${family} fallback should emit at least one candidate`);
  }
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test --test-name-pattern="supertrend track emits actual supertrend mutations|advertised fallback families emit" tests/pine-track-generators.test.mjs
```

Expected before implementation: FAIL because unsupported families fall back or skip.

- [ ] **Step 3: Implement family resolver**

Modify `resolveTrackFamily()` in `scripts/lib/pine-track-generators.mjs`:

```js
  if (candidate.includes('supertrend')) return 'supertrend';
  if (candidate.includes('ml-core') || candidate.includes('mlcore')) return 'ml-core';
  if (candidate.includes('fusion')) return 'fusion';
  if (candidate.includes('avwap')) return 'avwap-context';
  if (candidate.includes('channel')) return 'channel-context';
  if (candidate.includes('aggregator')) return 'context-aggregator';
```

Place these before the final `incumbent-local` fallback.

- [ ] **Step 4: Implement patch pools**

Add these functions in `scripts/lib/pine-track-generators.mjs` near existing `squeezePatches()` / `divergencePatches()`:

```js
function supertrendPatches(base) {
  return [
    {
      useSupertrendFilter: true,
      supertrendAtrLen: lowerBound((base.supertrendAtrLen ?? 10) - 3, 1),
      supertrendFactor: Math.max(0.1, numeric(base.supertrendFactor ?? 1.5) - 0.3),
    },
    {
      useSupertrendFilter: true,
      supertrendAtrLen: numeric(base.supertrendAtrLen ?? 10) + 4,
      supertrendFactor: numeric(base.supertrendFactor ?? 1.5) + 0.5,
    },
    {
      useSupertrendFilter: true,
      useSupertrendEntryConfirm: !(base.useSupertrendEntryConfirm === true),
      supertrendFactor: Math.max(0.1, numeric(base.supertrendFactor ?? 1.5) + 0.2),
    },
  ];
}

function mlCorePatches(base) {
  return [
    { neighborsCount: lowerBound((base.neighborsCount ?? 32) - 8, 1) },
    { neighborsCount: numeric(base.neighborsCount ?? 32) + 16 },
    { cap: Math.max(50, numeric(base.cap ?? 400) - 100) },
    { cap: numeric(base.cap ?? 400) + 200 },
    { sampleStride: lowerBound((base.sampleStride ?? 4) - 1, 1) },
    { sampleStride: numeric(base.sampleStride ?? 4) + 2 },
  ];
}

function fusionPatches(base) {
  return [
    { useSignalFusion: true, minFusionScore: lowerBound((base.minFusionScore ?? 1) + 1, 0) },
    { useFusionV4: true, fusionV4MinAbsPrediction: Math.max(0, numeric(base.fusionV4MinAbsPrediction ?? 2) - 0.5) },
    { useFusionV4: true, fusionV4MaxAbsPrediction: numeric(base.fusionV4MaxAbsPrediction ?? 4) + 0.5 },
    { useFusionV4: true, fusionV4LongAtrWeight: numeric(base.fusionV4LongAtrWeight ?? -0.25) - 0.15, fusionV4ShortAtrWeight: numeric(base.fusionV4ShortAtrWeight ?? -0.5) - 0.15 },
    { useFusionV4: true, fusionV4LongEngulfWeight: numeric(base.fusionV4LongEngulfWeight ?? -0.25) + 0.15, fusionV4ShortEngulfWeight: numeric(base.fusionV4ShortEngulfWeight ?? -0.1) + 0.15 },
    { useEmaCrossConfirm: true, fusionV4LongEmaWeight: numeric(base.fusionV4LongEmaWeight ?? 0) + 0.15, fusionV4ShortEmaWeight: numeric(base.fusionV4ShortEmaWeight ?? 0) + 0.15 },
  ];
}

function avwapContextPatches(base) {
  return [
    { useAvwapContext: true, avwapSwingPeriod: lowerBound((base.avwapSwingPeriod ?? 50) - 20, 2) },
    { useAvwapContext: true, avwapReclaimFreshBars: lowerBound((base.avwapReclaimFreshBars ?? 6) + 2, 1) },
    { useAvwapContext: true, avwapMaxDistanceAtr: Math.max(0.1, numeric(base.avwapMaxDistanceAtr ?? 1) - 0.2) },
    { useAvwapContext: true, avwapRequireReclaimForEntry: !(base.avwapRequireReclaimForEntry === true) },
  ];
}

function channelContextPatches(base) {
  return [
    { useChannelContext: true, channelDetectLength: lowerBound((base.channelDetectLength ?? 18) - 6, 2) },
    { useChannelContext: true, channelCompressionThreshold: Math.max(0, numeric(base.channelCompressionThreshold ?? 0.35) - 0.1) },
    { useChannelContext: true, channelBreakoutFreshBars: lowerBound((base.channelBreakoutFreshBars ?? 4) + 2, 1) },
    { useChannelContext: true, channelEnableRetest: true, channelRetestFreshBars: lowerBound((base.channelRetestFreshBars ?? 6) + 2, 1) },
  ];
}
```

Then update `getPatchPool(family, base)`:

```js
  if (family === 'supertrend') return supertrendPatches(base);
  if (family === 'ml-core') return mlCorePatches(base);
  if (family === 'fusion') return fusionPatches(base);
  if (family === 'avwap-context') return avwapContextPatches(base);
  if (family === 'channel-context') return channelContextPatches(base);
```

- [ ] **Step 5: Extend fallback pools**

Inside `getFallbackPatchPool()`, add family entries that reuse these patch functions:

```js
    'ml-core': mlCorePatches(base),
    fusion: fusionPatches(base),
    supertrend: supertrendPatches(base),
    'avwap-context': avwapContextPatches(base),
    'channel-context': channelContextPatches(base),
```

- [ ] **Step 6: Fix fallback validation to use actual fallback family**

In `buildTrackCandidateBatch()`, fallback currently validates as `incumbent-local`. Replace this:

```js
        patch = validateTrackPatch({ trackId: 'incumbent-local', patch: scaledPatch });
```

with:

```js
        patch = validateTrackPatch({ trackId: fallbackFamily, patch: scaledPatch });
```

This is the key fix that lets supertrend/ml-core/fusion/context candidates survive validation.

- [ ] **Step 7: Run focused generation tests**

Run:

```bash
node --test --test-name-pattern="advertised autoresearch families expose|supertrend track emits|advertised fallback families emit" tests/pine-track-generators.test.mjs
```

Expected: all named tests pass.

- [ ] **Step 8: Run full track-generator tests**

Run:

```bash
node --test tests/pine-track-generators.test.mjs
```

Expected: pass. If legacy fallback-order tests fail because new fallback families are now valid, update expectations only for tests that explicitly include the new families; do not weaken tabu assertions.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/pine-tuner.mjs scripts/lib/pine-track-generators.mjs tests/pine-track-generators.test.mjs
git commit -m "feat: generate real pine track family variants"
```

---

### Task 4: Make Tabu Saturation Recovery Prove Real Emission

**Files:**
- Modify: `tests/pine-autoresearch-tabu-saturation.test.mjs`
- Modify only if needed: `scripts/lib/pine-autoresearch-tracks.mjs`, `scripts/lib/pine-track-generators.mjs`, `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Strengthen existing tabu saturation test**

Open `tests/pine-autoresearch-tabu-saturation.test.mjs` and keep existing passing assertions. Add assertions after the recovery cycle that prove a non-empty emitted batch and not only aged pruning.

Add assertions shaped like this, adapting variable names to the existing test:

```js
assert.equal(recoveryManifest.searchEfficiency.allCandidatesTabu, false);
assert.equal(recoveryManifest.searchEfficiency.emittedVariantCount > 0, true);
assert.equal(Array.isArray(recoveryManifest.searchPlan?.variants), true);
assert.equal(recoveryManifest.searchPlan.variants.length > 0, true);
assert.notEqual(recoveryManifest.stagnationEscape?.mode, 'none');
```

If the manifest fixture uses `latest` instead of `recoveryManifest`, use the existing manifest variable. Do not invent a new fixture when the current test already models the stuck loop.

- [ ] **Step 2: Run test**

Run:

```bash
node --test tests/pine-autoresearch-tabu-saturation.test.mjs
```

Expected: PASS. If it fails, fix production code rather than deleting assertions.

- [ ] **Step 3: If production fix needed, age tabu more aggressively on low-emission stagnation**

In `scripts/lib/pine-autoresearch-tracks.mjs`, keep the intended policy: once `lowEmissionStreak` reaches configured escalation and `stagnationLevel >= 1`, old tabu entries must prune enough for generation to resume.

Use this policy in the tabu pruning call path:

```js
const effectiveMaxAgeCycles = stagnationLevel >= 1
  ? Math.max(1, Math.floor(resolvedTabuPolicy.maxAgeCycles / 2))
  : resolvedTabuPolicy.maxAgeCycles;
```

If this exact logic already exists, do not duplicate it; instead fix the caller so the computed `stagnationLevel` is passed before pruning.

- [ ] **Step 4: Run focused test again**

Run:

```bash
node --test tests/pine-autoresearch-tabu-saturation.test.mjs
```

Expected: `pass 1`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/lib/pine-track-generators.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-tabu-saturation.test.mjs
git commit -m "fix: recover pine generation after tabu saturation"
```

---

### Task 5: Fix Multi-Lab Regime Row Alignment

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing multi-lab alignment test**

Add to `tests/pine-autoresearch.test.mjs` near existing `buildScoutRegimeAnalysisArtifact` tests:

```js
test('buildScoutRegimeAnalysisArtifact offsets trade feature indexes across selected-candidate labs', () => {
  const result = buildScoutRegimeAnalysisArtifact({
    matrixId: 'pine-autoresearch',
    runId: 'run-offsets',
    selectedCandidate: {
      labResults: [
        {
          analysis: {
            challenger: {
              trades: [{ side: 'long', returnPctExact: 1, entryIndex: 0 }],
              rows: [{ Feature_CompressionState: 1, Feature_ExpansionState: 0 }],
            },
            incumbent: {
              trades: [{ side: 'long', returnPctExact: 1, entryIndex: 0 }],
              rows: [{ Feature_CompressionState: 1, Feature_ExpansionState: 0 }],
            },
          },
        },
        {
          analysis: {
            challenger: {
              trades: [{ side: 'long', returnPctExact: 1, entryIndex: 0 }],
              rows: [{ Feature_CompressionState: 0, Feature_ExpansionState: 1 }],
            },
            incumbent: {
              trades: [{ side: 'long', returnPctExact: 1, entryIndex: 0 }],
              rows: [{ Feature_CompressionState: 0, Feature_ExpansionState: 1 }],
            },
          },
        },
      ],
    },
    matrixCandidates: [],
  });

  assert.equal(result.artifact.regimeSlices.compression.tradeCount, 1);
  assert.equal(result.artifact.regimeSlices.expansion.tradeCount, 1);
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
node --test --test-name-pattern="offsets trade feature indexes" tests/pine-autoresearch.test.mjs
```

Expected before implementation: FAIL with compression `2` and expansion `0`, or equivalent misclassification.

- [ ] **Step 3: Implement aligned collection helper**

In `scripts/pine-autoresearch.mjs` near `buildScoutRegimeAnalysisArtifact()`, add:

```js
function offsetTradeFeatureIndexes(trade = {}, rowOffset = 0) {
  const result = { ...trade };
  for (const key of ['featureIndex', 'featureRowIndex', 'entryIndex', 'barIndex']) {
    if (Number.isInteger(result[key]) && result[key] >= 0) {
      result[key] += rowOffset;
    }
  }
  return result;
}

function collectLabAnalysisSide(sourceLabResults = [], side = 'challenger') {
  const rows = [];
  const trades = [];
  for (const { analysis } of sourceLabResults) {
    const sideAnalysis = analysis?.[side] || {};
    const labRows = Array.isArray(sideAnalysis.rows) ? sideAnalysis.rows : [];
    const rowOffset = rows.length;
    rows.push(...labRows);
    for (const trade of sideAnalysis.trades || []) {
      trades.push(offsetTradeFeatureIndexes(trade, rowOffset));
    }
  }
  return { rows, trades };
}
```

Replace the current independent `flatMap()` blocks:

```js
      challenger: {
        trades: sourceLabResults.flatMap(({ analysis }) => analysis?.challenger?.trades || []),
        rows: sourceLabResults.flatMap(({ analysis }) => analysis?.challenger?.rows || []),
      },
```

with:

```js
      challenger: collectLabAnalysisSide(sourceLabResults, 'challenger'),
```

and replace the incumbent block with:

```js
      incumbent: collectLabAnalysisSide(sourceLabResults, 'incumbent'),
```

- [ ] **Step 4: Run focused test**

Run:

```bash
node --test --test-name-pattern="buildScoutRegimeAnalysisArtifact" tests/pine-autoresearch.test.mjs
```

Expected: existing aggregation tests and new offset test pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix: align pine regime rows across labs"
```

---

### Task 6: Make Regime Diagnostics Honest About Empty Data and Mixed Symbols

**Files:**
- Modify: `scripts/lib/pine-regime-analysis.mjs`
- Test: `tests/pine-regime-analysis.test.mjs`

- [ ] **Step 1: Write failing diagnostics tests**

Add to `tests/pine-regime-analysis.test.mjs`:

```js
test('empty regime artifact does not expose fake candidate threshold surface', () => {
  const artifact = buildRegimeAnalysisArtifact({
    matrixId: 'pine-autoresearch',
    runId: 'run-empty',
    trades: [],
    featureRows: [],
  });

  assert.equal(artifact.evidence.hasCandidateSurface, false);
  assert.match(artifact.markdown, /candidate \| n\/a \| n\/a \| n\/a \| unknown/);
});

test('side metrics prefer normalized return percentage over raw mixed-symbol pnl', () => {
  const summary = summarizeSideMetrics({
    trades: [
      { side: 'long', pnl: 1000, returnPctExact: 1 },
      { side: 'long', pnl: -2000, returnPctExact: -2 },
    ],
  });

  assert.equal(summary.long.avgWin, 1);
  assert.equal(summary.long.avgLoss, 2);
  assert.equal(summary.long.profitFactor, 0.5);
});

test('missing MFE and MAE stay null in metrics and render as n/a', () => {
  const artifact = buildRegimeAnalysisArtifact({
    matrixId: 'pine-autoresearch',
    runId: 'run-no-excursion',
    trades: [{ side: 'long', returnPctExact: 1, entryIndex: 0 }],
    featureRows: [{ Feature_CompressionState: 1 }],
  });

  assert.equal(artifact.sideMetrics.long.mfePct, null);
  assert.equal(artifact.sideMetrics.long.maePct, null);
  assert.match(artifact.markdown, /\| long \| 1 \| 100% \| 1 \| 0 \|/);
  assert.match(artifact.markdown, /n\/a/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test --test-name-pattern="empty regime artifact|prefer normalized|missing MFE" tests/pine-regime-analysis.test.mjs
```

Expected before implementation: at least the empty-surface and raw-PnL tests fail.

- [ ] **Step 3: Prefer return percentages**

In `scripts/lib/pine-regime-analysis.mjs`, replace `tradePnl(trade)` with:

```js
function tradePnl(trade) {
  const value = trade?.returnPctExact ?? trade?.returnPct ?? trade?.pnlPct ?? trade?.pnl ?? trade?.profit ?? trade?.return ?? 0;
  return toNumber(value, 0);
}
```

This keeps raw `pnl` fallback but prefers normalized percent fields.

- [ ] **Step 4: Stop fake empty threshold surfaces**

Add helper near `extractThresholdSurface()`:

```js
function hasSideMetricEvidence(metrics = {}) {
  return Number(metrics?.long?.tradeCount ?? 0) > 0 || Number(metrics?.short?.tradeCount ?? 0) > 0;
}
```

Then start `extractThresholdSurface(metrics = {})` with:

```js
  if (metrics.thresholdSurface) return metrics.thresholdSurface;
  if (!hasSideMetricEvidence(metrics)) return null;
```

Keep the existing long/short extraction after that.

- [ ] **Step 5: Render missing values as n/a**

Replace `formatPct(value)` with:

```js
function formatPct(value) {
  if (value === null || value === undefined) return 'n/a';
  if (!Number.isFinite(value)) return value === Number.POSITIVE_INFINITY ? 'Infinity' : 'n/a';
  return String(round(value, 2));
}
```

- [ ] **Step 6: Run focused diagnostics tests**

Run:

```bash
node --test tests/pine-regime-analysis.test.mjs
```

Expected: all regime-analysis tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-regime-analysis.mjs tests/pine-regime-analysis.test.mjs
git commit -m "fix: make pine regime diagnostics honest"
```

---

### Task 7: Compute MFE/MAE from Trade Path

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs`
- Modify: `scripts/lib/pine-streaming-metrics.mjs`
- Test: `tests/pine-optimizer.test.mjs` or nearest optimizer/streaming metrics test file

- [ ] **Step 1: Find existing optimizer tests**

Run:

```bash
Get-ChildItem tests -Filter "*optimizer*.mjs" | Select-Object Name
Get-ChildItem tests -Filter "*streaming*.mjs" | Select-Object Name
```

Expected: identify exact test files. Use existing files; do not create a duplicate if optimizer tests already exist.

- [ ] **Step 2: Add optimizer MFE/MAE test**

In the optimizer test file, add:

```js
test('simulateTrades records MFE and MAE from OHLC path', () => {
  const trades = simulateTrades([
    { timestamp: 1, Signal: 1, Close: 100, StopLoss: 90, TakeProfit: 120, MaxBars: 10 },
    { timestamp: 2, Signal: 0, Open: 100, High: 110, Low: 95, Close: 105, StopLoss: 90, TakeProfit: 120, MaxBars: 10 },
    { timestamp: 3, Signal: -1, Open: 105, High: 108, Low: 97, Close: 102, StopLoss: 90, TakeProfit: 120, MaxBars: 10 },
  ], { timeframeMinutes: 15 });

  assert.equal(trades.length, 1);
  assert.equal(trades[0].mfePct, 10);
  assert.equal(trades[0].maePct, 5);
});
```

Import `simulateTrades` and `assert` following that file's current import style.

- [ ] **Step 3: Run test to verify failure**

Run the exact test file discovered in Step 1, for example:

```bash
node --test --test-name-pattern="records MFE and MAE" tests/pine-optimizer.test.mjs
```

Expected before implementation: FAIL because MFE/MAE fields are missing.

- [ ] **Step 4: Implement excursion tracking in optimizer**

In `scripts/lib/pine-optimizer.mjs`, add:

```js
function updateExcursions(position, row) {
  const close = Number.isFinite(row.Close) ? row.Close : position.entryPrice;
  const high = Number.isFinite(row.High) ? row.High : close;
  const low = Number.isFinite(row.Low) ? row.Low : close;
  position.maxHigh = Math.max(position.maxHigh ?? position.entryPrice, high);
  position.minLow = Math.min(position.minLow ?? position.entryPrice, low);
}

function excursionFields(position) {
  if (!Number.isFinite(position.entryPrice) || position.entryPrice === 0) {
    return { mfePct: null, maePct: null };
  }
  if (position.side === 'long') {
    return {
      mfePct: round(((position.maxHigh - position.entryPrice) / position.entryPrice) * 100),
      maePct: round(((position.entryPrice - position.minLow) / position.entryPrice) * 100),
    };
  }
  return {
    mfePct: round(((position.entryPrice - position.minLow) / position.entryPrice) * 100),
    maePct: round(((position.maxHigh - position.entryPrice) / position.entryPrice) * 100),
  };
}
```

Update `buildTrade()` return object to include:

```js
    ...excursionFields(position),
```

When opening a position, initialize:

```js
        maxHigh: row.Close,
        minLow: row.Close,
```

At the start of the `if (position)` block, call:

```js
      updateExcursions(position, row);
```

Do this before exit detection so the exit bar contributes to MFE/MAE.

- [ ] **Step 5: Mirror in streaming metrics**

Apply the same helper logic in `scripts/lib/pine-streaming-metrics.mjs`. If that file has a different row structure, use its normalized `row.Open/High/Low/Close` fields. The persisted trade object must include `mfePct` and `maePct` with the same semantics as optimizer trades.

- [ ] **Step 6: Run optimizer and streaming focused tests**

Run discovered test files, for example:

```bash
node --test --test-name-pattern="MFE|MAE|excursion|simulateTrades" tests/pine-optimizer.test.mjs tests/pine-streaming-metrics.test.mjs
```

Expected: MFE/MAE tests pass. If no streaming test file exists, add one next to the existing streaming module tests and run it explicitly.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-optimizer.mjs scripts/lib/pine-streaming-metrics.mjs tests
git commit -m "feat: record pine trade excursions"
```

---

### Task 8: Focused Integration Verification

**Files:**
- No new code unless tests expose a real integration bug.

- [ ] **Step 1: Run focused generator/search tests**

Run:

```bash
node --test tests/pine-track-generators.test.mjs tests/pine-autoresearch-tabu-saturation.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run focused diagnostics tests**

Run:

```bash
node --test tests/pine-regime-analysis.test.mjs --test-name-pattern="buildScoutRegimeAnalysisArtifact|regime-facing features" tests/pine-autoresearch.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run parameter/global search smoke tests**

Run:

```bash
node --test tests/pine-parameter-surface.test.mjs tests/pine-global-search.test.mjs tests/pine-tuner.test.mjs
```

Expected: all pass. These catch accidental key-list/filtering regressions.

- [ ] **Step 4: Run broader Pine autoresearch tests if time permits**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-track-generators.test.mjs tests/pine-search-policy.test.mjs tests/pine-regime-analysis.test.mjs
```

Expected: all pass. If this is too slow or killed, record exact killed command and fall back to the focused commands above.

- [ ] **Step 5: Inspect diff**

Run:

```bash
git diff --stat
git diff -- config/pine-autoresearch.default.json scripts/lib/pine-track-generators.mjs scripts/lib/pine-tuner.mjs scripts/lib/pine-regime-analysis.mjs scripts/pine-autoresearch.mjs
```

Expected:
- `regimeExitResearch.promotion.minRoiDeltaPct` is `3`.
- `regimeExitResearch.promotion.minProfitFactorDelta` is `0.1`.
- advertised families now have actual key lists and patch pools.
- diagnostics changes do not weaken promotion logic.

---

### Task 9: One Short Dry-Run Generation Probe

**Files:**
- No code edits.
- Generated artifacts under `pine/autoresearch` or temp run directory.

- [ ] **Step 1: Locate supported CLI flags**

Run:

```bash
node scripts/pine-autoresearch.mjs --help
```

Expected: CLI help prints. Identify any dry-run, max-config, matrix, or once flags. Do not invent flags.

- [ ] **Step 2: Run the smallest safe generation probe**

Use the actual flags from help. Preferred shape if supported:

```bash
node scripts/pine-autoresearch.mjs --matrix pine-fusion-v4-core-15m-locked-window --once --max-configs 3 --dry-run
```

Expected: command completes without long full optimization and emits/search-plans at least one variant for an active supported family.

If those flags are not supported, do not run a long autoresearch cycle. Instead run a direct Node smoke script:

```bash
node --input-type=module -e "import { buildTrackCandidateBatch } from './scripts/lib/pine-track-generators.mjs'; const incumbent={useSupertrendFilter:true,useSupertrendEntryConfirm:false,supertrendAtrLen:10,supertrendFactor:1.5,minPredSum:1.8,minBarsBetween:1,slAtrMult:0.5,tpAtrMult:6.85,trailAtrMult:1,trailActivateR:0.5,neighborsCount:32,cap:400,sampleStride:4,useSignalFusion:true,useFusionV4:true,fusionV4MinAbsPrediction:2,fusionV4MaxAbsPrediction:4,fusionV4LongAtrWeight:-0.25,fusionV4ShortAtrWeight:-0.5,useAvwapContext:false,useChannelContext:false}; const batch=buildTrackCandidateBatch({track:{trackId:'supertrend-tuning',sourceFamily:'supertrend'},incumbent,maxConfigs:8,historyEvents:[],budgetPolicy:{selfLoopEscape:{enabled:true,activateAfter:1,includeFallback:true,stagnationFallbackFamilies:['supertrend','ml-core','fusion'],minFallbackConfigs:3,temperatureBoost:1.5,stagnationTemperatureBoost:3}},schedulerState:{noNewCandidateStreak:3,stagnationLevel:2,tabuRejectedFingerprints:[]}}); console.log(JSON.stringify(batch.map(v=>({family:v.family,lane:v.lane,patch:v.patch})),null,2)); if(batch.length===0) process.exit(1);"
```

Expected: printed JSON includes non-empty `supertrend`, `ml-core`, or `fusion` candidates.

- [ ] **Step 3: Commit final verification notes if repo uses docs for run notes**

If no docs note is expected, skip commit. If a run note is created, commit it separately:

```bash
git add docs/superpowers/plans/2026-05-15-pine-autoresearch-generation-recovery.md
git commit -m "docs: plan pine autoresearch generation recovery"
```

---

## Self-Review

- Spec coverage: plan covers stuck latest run, tabu saturation, misleading supertrend track attribution, missing family patch pools, risky promotion-floor drift, diagnostics false evidence, MFE/MAE missing data, mixed-symbol raw-PnL distortion, and verification.
- Placeholder scan: no implementation step relies on blank markers, vague “handle edge cases”, or unbounded “write tests”. Each task names files, code shape, command, and expected result.
- Type consistency: family names are `supertrend`, `ml-core`, `fusion`, `avwap-context`, `channel-context`, `context-aggregator`; tests and production snippets use the same names.

## Execution Recommendation

Use **Subagent-Driven execution**. Dispatch one fresh subagent per task group:

1. Config floor + tests.
2. Track-owned keys + family patch pools.
3. Tabu recovery proof.
4. Regime diagnostics row alignment.
5. MFE/MAE and normalized diagnostics.
6. Integration verification.

Main session reviews diffs between tasks and runs final focused verification.
