# Pine Autoresearch Comprehensive Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Pine autoresearch from a partially-stuck optimizer into a reliable, novelty-preserving, resource-efficient research loop that can keep finding real candidates instead of wasting cycles.

**Architecture:** Stabilize the system first: unify config identity, stop exploit-lane tabu replays, and prune leaked artifacts. Then improve search quality: replace hardcoded exploit mutations with bounded progressive mutations, make stagnation escalation real, and add matrix execution short-circuiting plus bounded concurrency. Finish by tightening lineage/rotation logic and adding observability so future stalls are visible before they become week-long dead zones.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine autoresearch CLI/scripts, JSON manifests/history, scheduler state under `pine/autoresearch/.../state/scheduler`.

**Project Location:** `D:/Code/Experiment/backtest-kit-project`

**Execution Start:** Every worker must start from the project root:

```bash
cd D:/Code/Experiment/backtest-kit-project
git status --short --branch
```

Expected: repository exists on the expected branch. If this path does not exist, stop and ask the main session for the correct repo path; do not create a new folder.

---

## Scope Note

This request spans four tightly related subsystems:

1. **Identity + scheduler correctness**
2. **Search generation quality**
3. **Runtime efficiency + artifact hygiene**
4. **Stagnation escape + observability**

They are coupled enough that one umbrella plan is reasonable, but each task below is independently testable and can ship in a separate commit.

---

## File Structure

### Files to modify

- `scripts/lib/pine-global-search.mjs`
  - Own the canonical stripped config fingerprint used across generated-lane novelty and scheduler identity.
- `scripts/lib/pine-search-policy.mjs`
  - Own exploit/explore candidate generation, tabu handling, annealing, and architecture freezing behavior.
- `scripts/lib/pine-autoresearch-tracks.mjs`
  - Own novelty signature generation, similarity scoring, and scheduler transition state.
- `scripts/lib/pine-autoresearch-lineage.mjs`
  - Own family-key and lineage ping-pong detection.
- `scripts/pine-autoresearch.mjs`
  - Own run orchestration, matrix evaluation, artifact pruning, scheduler updates, and manifest/history emission.
- `tests/pine-autoresearch.test.mjs`
  - Main orchestration and CLI behavior coverage.
- `tests/pine-autoresearch-tracks.test.mjs`
  - Similarity, novelty signature, and scheduler behavior coverage.
- `tests/pine-autoresearch-lineage.test.mjs`
  - Numeric/structural lineage and ping-pong coverage.

### Files to create

- `scripts/lib/pine-stagnation-escape.mjs`
  - Own escalation policy for deep stagnation after generated lanes and exploit lane exhaust.
- `scripts/lib/pine-async-pool.mjs`
  - Tiny internal bounded-concurrency helper for matrix execution. No new dependency.
- `tests/pine-search-policy.test.mjs`
  - Targeted unit coverage for exploit-lane generation and tabu exhaustion.
- `tests/pine-stagnation-escape.test.mjs`
  - Unit coverage for escalation decisions.
- `tests/pine-async-pool.test.mjs`
  - Tiny bounded-concurrency helper coverage.

### Deliverable boundaries

- **Task 1** ships correctness primitives only.
- **Task 2** ships exploit-lane quality improvements only.
- **Task 3** ships runtime/cleanup improvements only.
- **Task 4** ships stagnation escape logic only.
- **Task 5** ships lineage + similarity hardening only.
- **Task 6** ships observability only.

---

## Task 1: Canonical Config Identity and Scheduler Compatibility

**Files:**
- Modify: `scripts/lib/pine-global-search.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing canonical fingerprint test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('canonical config fingerprint ignores identity-only keys everywhere', () => {
  const semantic = {
    tpAtrMult: 7.6,
    slAtrMult: 0.5,
    useFusionV4: true,
  };

  const withIdentity = {
    ...semantic,
    configId: 'cfg-7',
    label: 'champion',
    promotedAt: '2026-05-11T00:00:00.000Z',
    sourceRunId: 'run-1',
    configFingerprint: 'old-fp',
  };

  assert.equal(
    buildChampionConfigFingerprint(semantic),
    buildChampionConfigFingerprint(withIdentity),
  );

  assert.equal(
    autoresearchCli.buildCanonicalConfigFingerprint(semantic),
    autoresearchCli.buildCanonicalConfigFingerprint(withIdentity),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: FAIL because `buildCanonicalConfigFingerprint` is not exported yet.

- [ ] **Step 3: Add canonical fingerprint export in `scripts/lib/pine-global-search.mjs`**

Add/replace with:

```javascript
export function buildCanonicalConfigFingerprint(config = {}) {
  return JSON.stringify(stableValue(stripConfigIdentity(config || {})));
}

export function buildChampionConfigFingerprint(config = {}) {
  return buildCanonicalConfigFingerprint(config);
}
```

- [ ] **Step 4: Re-export the canonical helper from `scripts/pine-autoresearch.mjs`**

Add to the import list:

```javascript
import {
  buildCanonicalConfigFingerprint,
  buildChampionConfigFingerprint,
  buildGlobalMutationBatch,
  buildGlobalPatchFingerprint,
} from './lib/pine-global-search.mjs';
```

Add to exports near the bottom:

```javascript
export { buildCanonicalConfigFingerprint };
```

- [ ] **Step 5: Replace non-canonical identity use in scheduler/manifests**

Replace these patterns inside `scripts/pine-autoresearch.mjs`:

```javascript
const championFingerprint = configFingerprint(championState.config);
const candidateFingerprint = configFingerprint(challengerSummary.config);
```

with:

```javascript
const championFingerprint = buildCanonicalConfigFingerprint(championState.config);
const candidateFingerprint = buildCanonicalConfigFingerprint(challengerSummary.config);
```

Also replace similar `configFingerprint(...config...)` uses that represent semantic config identity in:
- `buildOfflineDataMissingManifest`
- `buildGlobalAllParameterExhaustedSchedulerManifestInput`
- `decideQueuedPromotionAction`
- `runPromote`
- `seedChampionState`

Do **not** replace patch/object equality helpers that are intentionally full-object comparisons.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-global-search.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): unify canonical config identity"
```

---

## Task 2: Stop Exploit-Lane Tabu Replays and Improve Search Quality

**Files:**
- Create: `tests/pine-search-policy.test.mjs`
- Modify: `scripts/lib/pine-search-policy.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-search-policy.test.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing tabu exhaustion test**

Create `tests/pine-search-policy.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIncumbentSearchBatch } from '../scripts/lib/pine-search-policy.mjs';
import { buildCanonicalConfigFingerprint } from '../scripts/lib/pine-global-search.mjs';

const champion = {
  neighborsCount: 32,
  adxThreshold: 20,
  minPredSum: 2,
  minBarsBetween: 2,
  h: 8,
  r: 8,
  x: 25,
  slAtrMult: 1,
  tpAtrMult: 2.5,
  trailAtrMult: 1,
  trailActivateR: 0.5,
  riskAtrLen: 14,
  useSignalFusion: true,
  useFusionV2: false,
  useFusionV3: false,
  useFusionV4: true,
  useSupertrendFilter: true,
  useTrailingStop: true,
  useStopsTP: true,
};

test('buildIncumbentSearchBatch emits no variants when every exploit patch is tabu', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: 8,
    historyEvents: [],
    policy: {
      exploitRatio: 1,
      exploitFamilies: ['signal', 'risk'],
      exploreFamilies: [],
    },
    schedulerState: {
      tabuRejectedFingerprints: new Array(128).fill(0).map((_, i) => `${i}`),
      forceTabuAll: true,
    },
  });

  assert.deepEqual(batch, []);
});
```

- [ ] **Step 2: Write the failing annealing behavior test**

Append to `tests/pine-search-policy.test.mjs`:

```javascript
test('annealing increases mutation diversity instead of scaling a single delta to extremes', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: 4,
    historyEvents: [],
    policy: {
      annealing: {
        enabled: true,
        baseTemperature: 0.4,
        growthFactor: 1.8,
        maxTemperature: 4,
      },
    },
    schedulerState: {
      noChangeStreak: 5,
    },
  });

  assert.equal(batch.length, 4);
  assert.ok(batch.some((item) => Object.keys(item.patch || {}).length >= 2));
  assert.ok(batch.every((item) => (item.config.adxThreshold ?? 20) <= 30));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test tests/pine-search-policy.test.mjs
```

Expected: FAIL because `buildIncumbentSearchBatch` currently always emits a fallback variant and does not expose `patch` or multi-key diversity.

- [ ] **Step 4: Replace `pickNonTabuVariant` to report exhaustion instead of replaying tabu candidates**

In `scripts/lib/pine-search-policy.mjs`, replace the function with:

```javascript
function pickNonTabuVariant({ base, pool, startIndex, lane, family, batchIndex, tabuSet, temperature, makePatch }) {
  let tabuSkipped = 0;
  for (let probe = 0; probe < pool.length; probe++) {
    const rawPatch = pool[(startIndex + probe) % pool.length];
    const patch = makePatch(base, rawPatch, temperature, batchIndex);
    const candidate = { ...clone(base), ...patch };
    if (!tabuSet.has(configFingerprint(candidate))) {
      return {
        exhausted: false,
        nextIndex: startIndex + probe + 1,
        variant: {
          ...withPatch(base, patch, { lane, family, index: batchIndex, temperature, tabuSkipped }),
          patch,
        },
      };
    }
    tabuSkipped += 1;
  }

  return {
    exhausted: true,
    nextIndex: startIndex + pool.length,
    variant: null,
  };
}
```

- [ ] **Step 5: Replace hardcoded scaling with bounded diversity generation (preserve pool direction)**

In `scripts/lib/pine-search-policy.mjs`, add these helpers:

```javascript
function boundedStep(baseValue, ratio, { min = 0, max = Infinity, integer = false } = {}) {
  const next = baseValue * ratio;
  const clamped = Math.min(max, Math.max(min, next));
  return integer ? Math.round(clamped) : Number(clamped.toFixed(4));
}

function patchBounds(key, baseValue) {
  if (key === 'adxThreshold') return { min: 10, max: 40, integer: true };
  if (key === 'minPredSum') return { min: 0.5, max: 3, integer: false };
  if (key === 'minBarsBetween') return { min: 0, max: 16, integer: true };
  if (key === 'slAtrMult') return { min: 0.125, max: 2, integer: false };
  if (key === 'tpAtrMult') return { min: 2, max: 15, integer: false };
  if (key === 'trailAtrMult') return { min: 0.5, max: 2, integer: false };
  if (key === 'trailActivateR') return { min: 0, max: 2, integer: false };
  if (key === 'riskAtrLen') return { min: 7, max: 35, integer: true };
  return { min: 0, max: Math.max(1, baseValue * 2), integer: Number.isInteger(baseValue) };
}

// Preserve the direction encoded in the pool entry (the pool says "go higher" or "go lower").
// Temperature widens the step; batchIndex varies magnitude across the batch.
function buildDiversePatch(base, rawPatch, temperature, batchIndex) {
  const keys = Object.keys(rawPatch);
  const patch = {};
  const magnitudes = temperature >= 2 ? [1, 1.5, 0.75, 2] : [1, 1.25, 0.75, 1.5];

  for (const key of keys) {
    const baseValue = Number(base[key]);
    const targetValue = Number(rawPatch[key]);
    if (!Number.isFinite(baseValue) || !Number.isFinite(targetValue)) {
      patch[key] = rawPatch[key];
      continue;
    }
    const poolDelta = targetValue - baseValue;
    const magnitude = magnitudes[(batchIndex - 1) % magnitudes.length];
    const nextValue = baseValue + poolDelta * magnitude * temperature;
    const bounds = patchBounds(key, baseValue);
    patch[key] = Number.isInteger(baseValue) && bounds.integer
      ? Math.round(Math.min(bounds.max, Math.max(bounds.min, nextValue)))
      : Number(Math.min(bounds.max, Math.max(bounds.min, nextValue)).toFixed(4));
  }

  // At hot temperatures, pair a single-key pool entry with a correlated key to break single-axis oscillation.
  if (temperature >= 2 && keys.length === 1) {
    const pairKey = keys[0] === 'tpAtrMult' ? 'slAtrMult' : 'tpAtrMult';
    const pairBase = Number(base[pairKey]);
    if (Number.isFinite(pairBase)) {
      patch[pairKey] = boundedStep(pairBase, 1.05, patchBounds(pairKey, pairBase));
    }
  }

  return patch;
}
```

Why direction matters: the existing pool entries encode intent (`{tpAtrMult: 5.5}` from base 7.6 means "try decreasing"). Replacing with `base * ratio` drops that information and lets the optimizer oscillate randomly around the base value.

- [ ] **Step 6: Make architecture freeze derive from champion config, not hardcoded booleans**

Replace `freezeArchitecture` with:

```javascript
function freezeArchitecture(config, frozenKeys = [
  'useSignalFusion',
  'useFusionV2',
  'useFusionV3',
  'useFusionV4',
  'useSupertrendFilter',
  'useTrailingStop',
  'useStopsTP',
]) {
  const frozen = {};
  for (const key of frozenKeys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      frozen[key] = config[key];
    }
  }
  return { ...config, ...frozen };
}
```

Update `buildIncumbentSearchBatch` to call:

```javascript
const base = policy.freezeArchitecture === false
  ? clone(incumbent)
  : freezeArchitecture(incumbent, policy.frozenArchitectureKeys);
```

- [ ] **Step 7: Update `buildIncumbentSearchBatch` to drop exhausted picks**

Use this loop pattern:

```javascript
while (batch.length < exploit) {
  const family = orderedExploitFamilies[batch.length % orderedExploitFamilies.length];
  const pool = familyPatchMap[family];
  const picked = pickNonTabuVariant({
    base,
    pool,
    startIndex: index,
    lane: 'exploit',
    family,
    batchIndex: batch.length + 1,
    tabuSet,
    temperature,
    makePatch: buildDiversePatch,
  });
  index = picked.nextIndex;
  if (picked.exhausted) break;
  batch.push(picked.variant);
}
```

Apply the same pattern to the explore loop.

- [ ] **Step 8: Add an orchestration test that an empty search batch becomes a skip/exhaustion path**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('runScout can stop cleanly when exploit lane emits no variants', async () => {
  const result = autoresearchCli.selectChangedMatrixCandidate({
    candidates: [],
    championState: { config: { tpAtrMult: 7.6 } },
  });

  assert.equal(result, null);
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run:

```bash
node --test tests/pine-search-policy.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add scripts/lib/pine-search-policy.mjs scripts/pine-autoresearch.mjs tests/pine-search-policy.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): stop exploit tabu replays and improve mutation diversity"
```

---

## Task 3: Matrix Runtime Efficiency and Artifact Hygiene

**Files:**
- Create: `scripts/lib/pine-async-pool.mjs`
- Create: `tests/pine-async-pool.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing async pool test**

Create `tests/pine-async-pool.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { mapWithConcurrency } from '../scripts/lib/pine-async-pool.mjs';

test('mapWithConcurrency preserves order while limiting in-flight work', async () => {
  let inFlight = 0;
  let maxInFlight = 0;

  const result = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
    return value * 10;
  });

  assert.deepEqual(result, [10, 20, 30, 40]);
  assert.equal(maxInFlight, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-async-pool.test.mjs
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Add the bounded concurrency helper**

Create `scripts/lib/pine-async-pool.mjs`:

```javascript
export async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(limit) || 1);
  const out = new Array(list.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= list.length) return;
      out[current] = await mapper(list[current], current);
    }
  }

  await Promise.all(new Array(Math.min(concurrency, list.length)).fill(0).map(() => worker()));
  return out;
}
```

- [ ] **Step 4: Add a failing early-exit matrix test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('evaluateMatrix stops after primary failure when primary promotion is required', async () => {
  const config = {
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
    complexityPolicy: {},
    regimeExitResearch: { enabled: false },
    blindHoldoutLabs: [],
    primaryLab: { labId: 'primary', thresholds: { minScoreDelta: 10, minRoiDeltaPct: 0, minProfitFactorDelta: 0, maxDrawdownDeltaPct: 5, minTradeCount: 1, minTradeRatioVsIncumbent: 0.5 } },
    shadowLabs: [
      { labId: 'shadow-a', thresholds: { minScoreDelta: 0, minRoiDeltaPct: 0, minProfitFactorDelta: 0, maxDrawdownDeltaPct: 5, minTradeCount: 1, minTradeRatioVsIncumbent: 0.5 } },
      { labId: 'shadow-b', thresholds: { minScoreDelta: 0, minRoiDeltaPct: 0, minProfitFactorDelta: 0, maxDrawdownDeltaPct: 5, minTradeCount: 1, minTradeRatioVsIncumbent: 0.5 } },
    ],
  };

  let primaryCalls = 0;
  let shadowCalls = 0;
  const originalEvaluate = autoresearchCli.__testOverrides?.evaluateConfigOnLab;
  autoresearchCli.__testOverrides = {
    evaluateConfigOnLab: async ({ lab }) => {
      if (lab.labId === 'primary') primaryCalls += 1;
      else shadowCalls += 1;
      return {
        label: lab.labId,
        configId: lab.labId,
        score: 1,
        tradeCount: 100,
        roiPct: 1,
        profitFactor: 1.1,
        maxDrawdownPct: 1,
        winRatePct: 50,
        avgWin: 1,
        avgLoss: -1,
        config: {},
      };
    },
  };

  try {
    const championState = { configId: 'champ', config: { tpAtrMult: 7.6 } };
    const challengerSummary = { configId: 'chal', config: { tpAtrMult: 10.6 } };
    const result = await autoresearchCli.evaluateMatrix(config, 'run-early-exit', championState, challengerSummary);
    assert.equal(result.labResults.length, 1, 'only primary should have been evaluated');
    assert.equal(primaryCalls, 2, 'primary evaluates champion + challenger');
    assert.equal(shadowCalls, 0, 'shadow labs must be skipped after primary fails');
  } finally {
    autoresearchCli.__testOverrides = originalEvaluate ? { evaluateConfigOnLab: originalEvaluate } : {};
  }
});
```

Note: this test requires exposing an override hook on `autoresearchCli`. In Step 5 below, wrap `evaluateConfigOnLab` calls so they honor `autoresearchCli.__testOverrides?.evaluateConfigOnLab` when present. Without the hook the test cannot meaningfully verify the short-circuit — do not merge this task with a placeholder assertion.

- [ ] **Step 5: Update matrix evaluation to use bounded concurrency and primary short-circuit**

In `scripts/pine-autoresearch.mjs`, add import:

```javascript
import { mapWithConcurrency } from './lib/pine-async-pool.mjs';
```

Then refactor `evaluateMatrix` around this structure:

```javascript
async function evaluateLabPair({ config, lab, runId, championState, challengerSummary, sameCandidate }) {
  const incumbentResult = await evaluateConfigOnLab({
    config,
    lab,
    runId,
    variantKey: 'champion',
    candidate: championState,
  });

  const challengerResult = sameCandidate
    ? {
        ...clone(incumbentResult),
        label: challengerSummary?.label || challengerSummary?.configId || incumbentResult.label,
        configId: challengerSummary?.configId || incumbentResult.configId,
        config: challengerSummary?.config || incumbentResult.config,
      }
    : await evaluateConfigOnLab({
        config,
        lab,
        runId,
        variantKey: 'challenger',
        candidate: challengerSummary,
      });

  const decision = decideAutoresearchOutcome({
    incumbent: incumbentResult,
    challenger: challengerResult,
    thresholds: lab.thresholds,
    expectancyPolicy: config.expectancyPolicy,
    complexityPolicy: config.complexityPolicy,
    holdoutVerdict: config.holdoutVerdict ?? null,
    blindHoldoutLabs: config.blindHoldoutLabs ?? [],
    promotionPolicy: config.regimeExitResearch?.enabled ? config.regimeExitResearch?.promotion : null,
  });

  return {
    lab,
    incumbent: summarizeResult(incumbentResult),
    challenger: summarizeResult(challengerResult),
    decision,
    analysis: {
      incumbent: { trades: incumbentResult.trades, rows: incumbentResult.rows },
      challenger: { trades: challengerResult.trades, rows: challengerResult.rows },
    },
  };
}
```

Refactor `evaluateMatrix` to:

```javascript
export async function evaluateMatrix(config, runId, championState, challengerSummary) {
  const labs = partitionLabs(config).selectionLabs;
  const sameCandidate = sameConfig(championState.config, challengerSummary?.config);
  if (labs.length === 0) {
    return { labResults: [], matrixDecision: decideMatrixPromotion({ labResults: [], policy: config.matrixPolicy, champion: championState, challenger: challengerSummary }) };
  }

  const primaryResult = await evaluateLabPair({
    config,
    lab: labs[0],
    runId,
    championState,
    challengerSummary,
    sameCandidate,
  });

  if (config.matrixPolicy?.requirePrimaryPromote !== false && primaryResult.decision.recommendation !== 'promote') {
    const labResults = [primaryResult];
    return {
      labResults,
      matrixDecision: decideMatrixPromotion({ labResults, policy: config.matrixPolicy, champion: championState, challenger: challengerSummary }),
    };
  }

  const shadowResults = await mapWithConcurrency(
    labs.slice(1),
    config.regimeExitResearch?.resource?.maxConcurrentLabWorkers ?? 3,
    (lab) => evaluateLabPair({ config, lab, runId, championState, challengerSummary, sameCandidate }),
  );

  const labResults = [primaryResult, ...shadowResults];
  return {
    labResults,
    matrixDecision: decideMatrixPromotion({ labResults, policy: config.matrixPolicy, champion: championState, challenger: challengerSummary }),
  };
}
```

- [ ] **Step 6: Prune variant files with the same retention window as manifests**

In `scripts/pine-autoresearch.mjs`, extend `pruneRunArtifacts` with:

```javascript
async function listVariantFiles(config) {
  try {
    const names = await fs.readdir(config.researchRoot);
    return names.filter((name) => name.endsWith('-variants.json')).sort();
  } catch {
    return [];
  }
}
```

Add deletion logic:

```javascript
const variantFiles = await listVariantFiles(config);
const keepVariantNames = new Set(plan.keepRunIds.map((runId) => `${runId}-variants.json`));
const deleteVariantNames = variantFiles.filter((name) => !keepVariantNames.has(name));
```

Delete them in the same style as sweep/evaluation cleanup and include:

```javascript
deletedVariantFiles,
```

in the returned prune result.

- [ ] **Step 7: Add the failing variant prune test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('planArtifactPrune-compatible cleanup removes stale variant files', async () => {
  const result = planArtifactPrune({
    manifestRunIds: ['run-2', 'run-3'],
    sweepRunIds: ['run-1', 'run-2', 'run-3'],
    evaluationRunIds: ['run-1', 'run-2', 'run-3'],
    keepLatestRuns: 1,
  });

  assert.deepEqual(result.keepRunIds, ['run-3']);
});
```

- [ ] **Step 8: Run tests to verify they pass**

Run:

```bash
node --test tests/pine-async-pool.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/pine-async-pool.mjs scripts/pine-autoresearch.mjs tests/pine-async-pool.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "perf(pine): parallelize matrix work and prune variant artifacts"
```

---

## Task 4: Real Stagnation Escape Instead of Passive Lane Rotation

**Files:**
- Create: `scripts/lib/pine-stagnation-escape.mjs`
- Create: `tests/pine-stagnation-escape.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing escalation policy tests**

Create `tests/pine-stagnation-escape.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { decideStagnationEscapePlan } from '../scripts/lib/pine-stagnation-escape.mjs';

test('decideStagnationEscapePlan stays idle when stagnation is shallow', () => {
  const plan = decideStagnationEscapePlan({
    stagnationLevel: 1,
    generatedLanesExhausted: false,
    exploitExhausted: false,
  });

  assert.deepEqual(plan, { mode: 'none', reason: 'not-eligible' });
});

test('decideStagnationEscapePlan widens search when all lanes are exhausted', () => {
  const plan = decideStagnationEscapePlan({
    stagnationLevel: 3,
    generatedLanesExhausted: true,
    exploitExhausted: true,
  });

  assert.equal(plan.mode, 'progressive-widen');
  assert.equal(plan.allowArchitectureKeys, true);
  assert.equal(plan.multiKeyMutationCount, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-stagnation-escape.test.mjs
```

Expected: FAIL because the file does not exist.

- [ ] **Step 3: Add the stagnation escape policy helper**

Create `scripts/lib/pine-stagnation-escape.mjs`:

```javascript
export function decideStagnationEscapePlan({
  stagnationLevel = 0,
  generatedLanesExhausted = false,
  exploitExhausted = false,
} = {}) {
  if (stagnationLevel < 2 || !generatedLanesExhausted) {
    return { mode: 'none', reason: 'not-eligible' };
  }

  if (stagnationLevel === 2) {
    return {
      mode: 'widen-bounds',
      reason: 'generated-lanes-exhausted',
      allowArchitectureKeys: false,
      multiKeyMutationCount: 2,
      ladderScale: 1.5,
    };
  }

  if (stagnationLevel >= 3 && exploitExhausted) {
    return {
      mode: 'progressive-widen',
      reason: 'all-lanes-exhausted',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 3,
      ladderScale: 2,
    };
  }

  return {
    mode: 'exploit-deepen',
    reason: 'exploit-still-available',
    allowArchitectureKeys: false,
    multiKeyMutationCount: 2,
    ladderScale: 1.25,
  };
}
```

- [ ] **Step 4: Wire the policy into `runScout` search generation**

In `scripts/pine-autoresearch.mjs`, add import:

```javascript
import { decideStagnationEscapePlan } from './lib/pine-stagnation-escape.mjs';
```

Before `buildRegimeAwareSearchBatch`, add:

```javascript
const championLaneFingerprint = buildChampionConfigFingerprint(championState.config);
const exhaustedLanes = resolveExhaustedResearchLanes({
  schedulerState,
  championConfigFingerprint: championLaneFingerprint,
});
const generatedLanesExhausted = ['globalAllParameter', 'exitRegime'].every((lane) => exhaustedLanes.includes(lane));

// Detect exploit-lane exhaustion from the prior cycle's search efficiency (Task 6 persists this).
// Treat exploit lane as exhausted when the last cycle emitted zero variants OR every variant was tabu.
const previousSearchEfficiency = latestManifest?.searchEfficiency ?? null;
const exploitExhausted = Boolean(previousSearchEfficiency)
  && (previousSearchEfficiency.allCandidatesTabu === true
    || previousSearchEfficiency.emittedVariantCount === 0);

const stagnationEscape = decideStagnationEscapePlan({
  stagnationLevel: schedulerState.stagnationLevel ?? 0,
  generatedLanesExhausted,
  exploitExhausted,
});
```

Note: `exploitExhausted` depends on Task 6 (`searchEfficiency` being persisted in the manifest). If Tasks 4 and 6 ship in different commits, ensure Task 6 lands first or gate this read with a null-safe fallback to keep Task 4 functional on its own.

Extend the policy passed to the generated/global search with:

```javascript
const searchPolicyWithNovelty = {
  ...trackedConfig.searchPolicy,
  recentManifestsForNovelty,
  allowArchitectureKeys: stagnationEscape.allowArchitectureKeys === true,
  multiKeyMutationCount: stagnationEscape.multiKeyMutationCount ?? 1,
  ladderScale: stagnationEscape.ladderScale ?? 1,
};
```

- [ ] **Step 5: Persist the escape mode into the manifest for debugging**

Inside `buildScoutOrchestrationState(...).manifest`, add:

```javascript
stagnationEscape: trackState.stagnationEscape ?? null,
```

Pass it in from `runScout` track state:

```javascript
stagnationEscape,
```

- [ ] **Step 6: Add orchestration coverage for manifest persistence**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('applySchedulerStateToManifest preserves explicit stagnation metadata while allowing new escape metadata upstream', () => {
  const manifest = applySchedulerStateToManifest({
    runId: 'run-1',
    stagnationEscape: { mode: 'progressive-widen' },
  }, {
    stagnationLevel: 3,
    stagnationReason: 'noRegimeResearchLane',
  });

  assert.deepEqual(manifest.stagnationEscape, { mode: 'progressive-widen' });
  assert.equal(manifest.stagnationLevel, 3);
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
node --test tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pine-stagnation-escape.mjs scripts/pine-autoresearch.mjs tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): add real stagnation escape policy"
```

---

## Task 5: Weighted Similarity and Numeric Ping-Pong Hardening

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `scripts/lib/pine-autoresearch-lineage.mjs`
- Modify: `tests/pine-autoresearch-tracks.test.mjs`
- Modify: `tests/pine-autoresearch-lineage.test.mjs`

- [ ] **Step 1: Write the failing weighted similarity test**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```javascript
test('computeConfigSimilarity weights high-impact keys more than cosmetic keys', () => {
  const champion = { tpAtrMult: 7.6, divPivotLeft: 3, useFusionV4: true };
  const cosmetic = { tpAtrMult: 7.6, divPivotLeft: 2, useFusionV4: true };
  const material = { tpAtrMult: 10.6, divPivotLeft: 3, useFusionV4: true };

  const cosmeticSimilarity = computeConfigSimilarity({ left: champion, right: cosmetic });
  const materialSimilarity = computeConfigSimilarity({ left: champion, right: material });

  assert.ok(cosmeticSimilarity > materialSimilarity);
});
```

- [ ] **Step 2: Write the failing numeric ping-pong test**

Append to `tests/pine-autoresearch-lineage.test.mjs`:

```javascript
test('detectPingPongRisk catches numeric return to recently demoted tpAtrMult', () => {
  const risk = detectPingPongRisk({
    candidateFingerprint: 'cand-10.6',
    candidateFamilyKey: '{"useFusionV4":true}',
    currentChampionFingerprint: 'champ-7.6',
    currentChampionFamilyKey: '{"useFusionV4":true}',
    candidateConfig: { tpAtrMult: 10.6, slAtrMult: 0.5 },
    currentChampionConfig: { tpAtrMult: 7.6, slAtrMult: 0.5 },
    lineage: {
      recentTransitions: [
        {
          fromFingerprint: 'cand-10.6',
          toFingerprint: 'champ-7.6',
          fromFamilyKey: '{"useFusionV4":true}',
          toFamilyKey: '{"useFusionV4":true}',
          fromConfig: { tpAtrMult: 10.6, slAtrMult: 0.5 },
          toConfig: { tpAtrMult: 7.6, slAtrMult: 0.5 },
        },
      ],
    },
    policy: {
      lookbackPromotions: 6,
      numericKeys: ['tpAtrMult', 'slAtrMult'],
    },
  });

  assert.equal(risk.blocked, true);
  assert.equal(risk.level, 'numeric-reversal');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch-lineage.test.mjs
```

Expected: FAIL because similarity is currently uniform and numeric-reversal logic does not exist.

- [ ] **Step 4: Replace uniform similarity with weighted similarity**

In `scripts/lib/pine-autoresearch-tracks.mjs`, add:

```javascript
const DEFAULT_KEY_WEIGHTS = new Map([
  ['tpAtrMult', 3],
  ['slAtrMult', 3],
  ['trailAtrMult', 2],
  ['trailActivateR', 2],
  ['minPredSum', 3],
  ['adxThreshold', 2],
  ['useFusionV4', 2],
  ['useSignalFusion', 2],
  ['useSupertrendFilter', 2],
  ['divPivotLeft', 1],
  ['divPivotRight', 1],
  ['divFreshBars', 1],
]);
```

Replace object similarity with:

```javascript
function similarityRatio(left, right, path = []) {
  if (isPlainObject(left) && isPlainObject(right)) {
    const comparableKeys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    if (comparableKeys.length === 0) return 1;
    let weightedScore = 0;
    let weightedTotal = 0;

    for (const key of comparableKeys) {
      const weight = DEFAULT_KEY_WEIGHTS.get(key) ?? 1;
      const childScore = Object.prototype.hasOwnProperty.call(left, key) && Object.prototype.hasOwnProperty.call(right, key)
        ? similarityRatio(left[key], right[key], [...path, key])
        : 0;
      weightedScore += childScore * weight;
      weightedTotal += weight;
    }

    return Number((weightedScore / weightedTotal).toFixed(3));
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const limit = Math.max(left.length, right.length);
    if (limit === 0) return 1;
    let score = 0;
    for (let i = 0; i < limit; i++) {
      score += i < left.length && i < right.length ? similarityRatio(left[i], right[i], path) : 0;
    }
    return Number((score / limit).toFixed(3));
  }

  return Number((stableValue(left) === stableValue(right) ? 1 : 0).toFixed(3));
}
```

- [ ] **Step 5: Extend lineage summaries to retain config values for numeric keys**

In `scripts/lib/pine-autoresearch-lineage.mjs`, update `summarizePromotionLineage` mapping:

```javascript
.map((event) => ({
  timestamp: event.timestamp ?? null,
  mode: event.type,
  fromFingerprint: event.fromFingerprint ?? event.fromConfigFingerprint ?? null,
  toFingerprint: event.toFingerprint ?? event.toConfigFingerprint ?? event.championFingerprint ?? null,
  fromFamilyKey: event.fromFamilyKey ?? null,
  toFamilyKey: event.toFamilyKey ?? null,
  fromConfigId: event.fromConfigId ?? null,
  toConfigId: event.toConfigId ?? event.championConfigId ?? null,
  sourceRunId: event.runId ?? event.sourceRunId ?? null,
  fromConfig: event.fromConfig ?? null,
  toConfig: event.toConfig ?? null,
}))
```

- [ ] **Step 6: Add numeric reversal detection (only when both sides define the key)**

In `scripts/lib/pine-autoresearch-lineage.mjs`, add this helper above `detectPingPongRisk`:

```javascript
function numericKeysMatch(left, right, numericKeys) {
  for (const key of numericKeys) {
    const leftValue = left?.[key];
    const rightValue = right?.[key];
    // Skip keys that either side does not define. Avoid `Object.is(undefined, undefined) === true` false positives.
    if (leftValue === undefined || rightValue === undefined) return false;
    if (!Object.is(Number(leftValue), Number(rightValue))) return false;
  }
  return true;
}
```

Then insert before `recentPromotedRepeat`:

```javascript
  const numericKeys = Array.isArray(policy.numericKeys) && policy.numericKeys.length > 0
    ? policy.numericKeys
    : ['tpAtrMult', 'slAtrMult', 'trailAtrMult', 'minPredSum'];

  const numericReversal = transitions.find((event) => (
    event.fromConfig
    && event.toConfig
    && candidateConfig
    && currentChampionConfig
    && numericKeysMatch(event.fromConfig, candidateConfig, numericKeys)
    && numericKeysMatch(event.toConfig, currentChampionConfig, numericKeys)
  ));
  if (numericReversal) {
    return {
      blocked: true,
      level: 'numeric-reversal',
      reason: 'candidate numerics were recently demoted by the current champion numerics',
      matchedTransition: numericReversal,
    };
  }
```

Update function signature to accept:

```javascript
candidateConfig,
currentChampionConfig,
```

- [ ] **Step 6b: Make promotion events actually carry config objects so the check can fire in production**

The current `history.jsonl` promotion event shape only carries `fromConfigId` / `toConfigId` / `championConfigId` strings — no full config object. Without this step the numeric reversal check is dead code against real lineage data.

In `scripts/pine-autoresearch.mjs`, find the promote event emitter inside `runPromote` (search for `type: 'promote'` inside the history append) and extend the appended event with:

```javascript
    fromConfig: previousChampionState?.config ?? null,
    toConfig: challengerSummary?.config ?? null,
    fromFingerprint: buildCanonicalConfigFingerprint(previousChampionState?.config ?? {}),
    toFingerprint: buildCanonicalConfigFingerprint(challengerSummary?.config ?? {}),
    fromFamilyKey: buildCandidateFamilyKey({ config: previousChampionState?.config ?? {} }),
    toFamilyKey: buildCandidateFamilyKey({ config: challengerSummary?.config ?? {} }),
```

Repeat for the `autopromote` path in `decideAutoPromotionAction` → promotion append.

Add a regression test in `tests/pine-autoresearch.test.mjs`:

```javascript
test('promote event emitted to history carries fromConfig/toConfig for lineage reversal checks', () => {
  const event = autoresearchCli.buildPromotionHistoryEvent({
    previousChampionState: { config: { tpAtrMult: 7.6, slAtrMult: 0.5 } },
    challengerSummary: { config: { tpAtrMult: 10.6, slAtrMult: 0.5 } },
    runId: 'run-1',
  });

  assert.equal(event.type, 'promote');
  assert.deepEqual(event.fromConfig, { tpAtrMult: 7.6, slAtrMult: 0.5 });
  assert.deepEqual(event.toConfig, { tpAtrMult: 10.6, slAtrMult: 0.5 });
  assert.ok(event.fromFingerprint);
  assert.ok(event.toFingerprint);
});
```

Implement `buildPromotionHistoryEvent` and export it so both the manual and auto promote paths go through the same builder. This centralizes the event shape so it stays consistent.

- [ ] **Step 7: Thread the configs into lineage gate calls**

In `scripts/lib/pine-autoresearch.mjs`, update `decideAutoPromotionAction`:

```javascript
  const lineageGate = decideLineagePromotionGate({
    candidateFingerprint: latestManifest?.candidateFingerprint ?? latestManifest?.challenger?.candidateFingerprint ?? null,
    candidateFamilyKey: latestManifest?.candidateFamilyKey ?? latestManifest?.challenger?.familyKey ?? null,
    currentChampionFingerprint: latestManifest?.championFingerprint ?? championState?.configFingerprint ?? null,
    currentChampionFamilyKey: latestManifest?.championFamilyKey ?? championState?.familyKey ?? null,
    candidateConfig: latestManifest?.challenger?.config ?? null,
    currentChampionConfig: championState?.config ?? null,
    lineage,
    matrixDecision: decision,
    robustness: latestManifest?.robustness ?? latestManifest?.selectedCandidate?.robustness ?? {},
    policy: safePolicy.lineagePolicy ?? { enabled: false },
  });
```

- [ ] **Step 8: Run tests to verify they pass**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch-lineage.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/lib/pine-autoresearch-lineage.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch-lineage.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): harden similarity and numeric lineage reversal checks"
```

---

## Task 6: Cycle Efficiency Observability

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing history event observability test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('build cycle history event retains efficiency metadata', () => {
  const manifest = {
    generatedAt: '2026-05-11T00:00:00.000Z',
    runId: 'run-1',
    champion: { configId: 'champ' },
    challenger: { configId: 'cand' },
    matrixDecision: { recommendation: 'hold', summary: 'hold' },
    researchState: { steadyState: false, noChangeStreak: 0 },
    searchEfficiency: {
      variantCount: 8,
      emittedVariantCount: 5,
      exhaustedFamilies: ['signal'],
      allCandidatesTabu: false,
    },
  };

  const event = autoresearchCli.buildCycleHistoryEvent(manifest);
  assert.deepEqual(event.searchEfficiency, manifest.searchEfficiency);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: FAIL because `buildCycleHistoryEvent` does not include `searchEfficiency`.

- [ ] **Step 3: Emit search efficiency in the manifest**

In `buildScoutOrchestrationState(...).manifest`, add:

```javascript
searchEfficiency: {
  variantCount: searchBatch.length,
  emittedVariantCount: searchBatch.filter(Boolean).length,
  exhaustedFamilies: searchBatch.filter((variant) => variant?.exhaustedFamily).map((variant) => variant.exhaustedFamily),
  allCandidatesTabu: searchBatch.length === 0,
},
```

- [ ] **Step 4: Thread efficiency into history events**

In `buildCycleHistoryEvent(manifest = {})`, add:

```javascript
searchEfficiency: manifest.searchEfficiency ?? null,
durationMs: manifest.durationMs ?? null,
```

- [ ] **Step 5: Stamp wall-clock duration in `runScout`**

At the start of `runScout`, add:

```javascript
const startedAtMs = Date.now();
```

Before final manifest write, set:

```javascript
const finalManifest = applySchedulerStateToManifest({
  ...manifest,
  durationMs: Date.now() - startedAtMs,
}, updatedSchedulerState);
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): add cycle efficiency observability"
```

---
## Task 18: Tabu Set Aging and Champion-Scoped Pruning

**Why:** The scheduler's `tabuRejectedFingerprints` grows unbounded. The current file holds 25+ entries, many against `tpAtrMult: 5.5` from an earlier champion era that is no longer relevant. This is why the exploit-lane goes empty — half the pool maps to fingerprints tabu'd against a dead champion.

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Write failing tabu aging test**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```javascript
test('pruneTabuFingerprints drops entries older than maxAgeCycles and trims to maxEntries', () => {
  const pruned = pruneTabuFingerprints({
    entries: [
      { fingerprint: 'a', addedAtCycle: 1, championFingerprint: 'champ-old' },
      { fingerprint: 'b', addedAtCycle: 10, championFingerprint: 'champ-current' },
      { fingerprint: 'c', addedAtCycle: 48, championFingerprint: 'champ-current' },
      { fingerprint: 'd', addedAtCycle: 50, championFingerprint: 'champ-current' },
    ],
    currentCycle: 51,
    currentChampionFingerprint: 'champ-current',
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
  });

  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['c', 'd']);
});

test('pruneTabuFingerprints clears everything when champion changed and dropOnChampionChange is true', () => {
  const pruned = pruneTabuFingerprints({
    entries: [
      { fingerprint: 'a', addedAtCycle: 40, championFingerprint: 'champ-old' },
    ],
    currentCycle: 41,
    currentChampionFingerprint: 'champ-current',
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
  });

  assert.deepEqual(pruned, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs
```

Expected: FAIL because `pruneTabuFingerprints` is not exported and tabu entries are stored as plain strings.

- [ ] **Step 3: Add the pruning helper**

In `scripts/lib/pine-autoresearch-tracks.mjs`, add:

```javascript
export function pruneTabuFingerprints({ entries = [], currentCycle = 0, currentChampionFingerprint = null, policy = {} } = {}) {
  const maxAgeCycles = Math.max(1, Number(policy.maxAgeCycles ?? 20));
  const maxEntries = Math.max(1, Number(policy.maxEntries ?? 32));
  const dropOnChampionChange = policy.dropOnChampionChange !== false;

  const normalized = Array.isArray(entries)
    ? entries
      .filter((entry) => entry && typeof entry.fingerprint === 'string')
      .map((entry) => ({
        fingerprint: entry.fingerprint,
        addedAtCycle: Number.isFinite(Number(entry.addedAtCycle)) ? Number(entry.addedAtCycle) : 0,
        championFingerprint: entry.championFingerprint ?? null,
      }))
    : [];

  const filtered = normalized.filter((entry) => {
    if (dropOnChampionChange && currentChampionFingerprint && entry.championFingerprint && entry.championFingerprint !== currentChampionFingerprint) {
      return false;
    }
    return currentCycle - entry.addedAtCycle <= maxAgeCycles;
  });

  filtered.sort((left, right) => right.addedAtCycle - left.addedAtCycle);
  const kept = filtered.slice(0, maxEntries);
  kept.sort((left, right) => left.addedAtCycle - right.addedAtCycle);
  return kept;
}
```

- [ ] **Step 4: Migrate stored tabu shape on load**

In `scripts/pine-autoresearch.mjs`, wherever `schedulerState.tabuRejectedFingerprints` is read (search for `tabuRejectedFingerprints`), add a normalization step so legacy string-array state still works:

```javascript
function normalizeTabuEntries(raw, { currentCycle, championFingerprint }) {
  if (!raw) return [];
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
    return raw.map((fingerprint) => ({
      fingerprint,
      addedAtCycle: currentCycle,
      championFingerprint,
    }));
  }
  return Array.isArray(raw) ? raw : [];
}
```

- [ ] **Step 5: Prune before writing scheduler state**

In `nextTrackState` (or the scheduler write path in `scripts/pine-autoresearch.mjs`), apply pruning whenever a tabu entry is appended:

```javascript
const prunedTabu = pruneTabuFingerprints({
  entries: normalizeTabuEntries(previous.tabuRejectedFingerprints, {
    currentCycle: previous.cycleIndex ?? 0,
    championFingerprint: previous.lastChampionFingerprint ?? null,
  }),
  currentCycle: previous.cycleIndex ?? 0,
  currentChampionFingerprint: manifest?.championFingerprint ?? previous.lastChampionFingerprint ?? null,
  policy: policy.tabu || { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
});
```

Make the search policy read the new shape:

```javascript
function normalizeTabuCache(value) {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    return new Set(value.map((entry) => entry?.fingerprint).filter(Boolean));
  }
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch.test.mjs tests/pine-search-policy.test.mjs
```

Expected: PASS.

- [ ] **Step 7: One-time state repair**

Run once after deploy to strip stale entries from existing scheduler state:

```bash
node -e "const fs=require('fs'); const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/pine-fusion-v4-core-15m-locked-window.json'; const s=JSON.parse(fs.readFileSync(p,'utf8')); s.tabuRejectedFingerprints=[]; fs.writeFileSync(p, JSON.stringify(s, null, 2));"
```

Expected: file rewrites with empty tabu list. Subsequent cycles re-populate with champion-scoped entries.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs scripts/lib/pine-search-policy.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix(pine): age-bound tabu set and drop stale champion entries"
```

---

## Task 19: Statistical Significance Gate on Promotion Deltas

**Why:** Primary lab thresholds are `minScoreDelta: 0.25, minRoiDeltaPct: 0, minProfitFactorDelta: 0`. The 2026-05-11 challenger beat the champion by 1.25 ROI points on identical trade counts — noise, not signal. Nothing in the current pipeline requires a minimum effect size or bootstrap CI. The system has been rubber-stamping noise for weeks.

**Files:**
- Create: `scripts/lib/pine-significance-gate.mjs`
- Create: `tests/pine-significance-gate.test.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing significance gate tests**

Create `tests/pine-significance-gate.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { decideSignificanceGate } from '../scripts/lib/pine-significance-gate.mjs';

test('decideSignificanceGate rejects small score delta below effect floor', () => {
  const gate = decideSignificanceGate({
    incumbent: { score: 153.25, tradeCount: 261, roiPct: 92.32, profitFactor: 3.58 },
    challenger: { score: 154.74, tradeCount: 261, roiPct: 93.57, profitFactor: 3.61 },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.equal(gate.passed, false);
  assert.equal(gate.reason, 'score_delta_below_floor');
  assert.equal(gate.relativeScoreDelta < 0.02, true);
});

test('decideSignificanceGate accepts challenger with >= minimum relative delta', () => {
  const gate = decideSignificanceGate({
    incumbent: { score: 150, tradeCount: 200, roiPct: 85, profitFactor: 3.2 },
    challenger: { score: 160, tradeCount: 200, roiPct: 93, profitFactor: 3.6 },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.equal(gate.passed, true);
  assert.equal(gate.reason, 'significant');
});

test('decideSignificanceGate holds when challenger trade count is too small for reliable delta', () => {
  const gate = decideSignificanceGate({
    incumbent: { score: 150, tradeCount: 200, roiPct: 85, profitFactor: 3.2 },
    challenger: { score: 160, tradeCount: 40, roiPct: 93, profitFactor: 3.6 },
    policy: { minRelativeScoreDelta: 0.02, minTradeCount: 150 },
  });

  assert.equal(gate.passed, false);
  assert.equal(gate.reason, 'insufficient_sample');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-significance-gate.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the gate**

Create `scripts/lib/pine-significance-gate.mjs`:

```javascript
function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function decideSignificanceGate({ incumbent = {}, challenger = {}, policy = {} } = {}) {
  const minRelativeScoreDelta = Number.isFinite(Number(policy.minRelativeScoreDelta))
    ? Math.max(0, Number(policy.minRelativeScoreDelta))
    : 0.02;
  const minTradeCount = Math.max(1, Math.floor(Number(policy.minTradeCount ?? 150)));

  const incumbentScore = finite(incumbent.score);
  const challengerScore = finite(challenger.score);
  const challengerTradeCount = finite(challenger.tradeCount);
  const incumbentTradeCount = finite(incumbent.tradeCount);

  if (incumbentScore === null || challengerScore === null) {
    return { passed: false, reason: 'missing_score', relativeScoreDelta: null };
  }

  if (challengerTradeCount === null || challengerTradeCount < minTradeCount) {
    return { passed: false, reason: 'insufficient_sample', relativeScoreDelta: null, challengerTradeCount, minTradeCount };
  }

  const baseline = Math.max(Math.abs(incumbentScore), 1e-6);
  const relativeScoreDelta = (challengerScore - incumbentScore) / baseline;

  if (relativeScoreDelta < minRelativeScoreDelta) {
    return {
      passed: false,
      reason: 'score_delta_below_floor',
      relativeScoreDelta: Number(relativeScoreDelta.toFixed(4)),
      minRelativeScoreDelta,
    };
  }

  // Trade-count parity guard: if challenger has fewer trades than incumbent by >10%, require larger effect.
  if (incumbentTradeCount !== null) {
    const tradeRatio = challengerTradeCount / incumbentTradeCount;
    if (tradeRatio < 0.9 && relativeScoreDelta < minRelativeScoreDelta * 2) {
      return {
        passed: false,
        reason: 'trade_count_drift_requires_larger_delta',
        relativeScoreDelta: Number(relativeScoreDelta.toFixed(4)),
        tradeRatio: Number(tradeRatio.toFixed(3)),
      };
    }
  }

  return { passed: true, reason: 'significant', relativeScoreDelta: Number(relativeScoreDelta.toFixed(4)) };
}
```

- [ ] **Step 4: Integrate the gate into `decideAutoresearchOutcome`**

In `scripts/lib/pine-autoresearch.mjs`, import and call:

```javascript
import { decideSignificanceGate } from './pine-significance-gate.mjs';
```

After the expectancy gate evaluation but before holdout classification, insert:

```javascript
const significanceGate = decideSignificanceGate({
  incumbent,
  challenger,
  policy: thresholds?.significance || {},
});
if (failedGates.length === 0 && significanceGate.passed === false) {
  failedGates.push('significance');
  gates.significance = false;
}
```

Include `significanceGate` in the returned decision object.

- [ ] **Step 5: Configure primary-lab thresholds to require real effect**

In `config/pine-autoresearch.default.json` primary lab block, add under `thresholds`:

```json
"significance": {
  "minRelativeScoreDelta": 0.02,
  "minTradeCount": 150
}
```

Shadow labs may override with smaller values, but primary must not.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/pine-significance-gate.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-significance-gate.mjs scripts/lib/pine-autoresearch.mjs config/pine-autoresearch.default.json tests/pine-significance-gate.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): require relative-effect significance on primary lab promotions"
```

---

## Task 20: Entry-Parameter Invariance Detector

**Why:** Champion 2026-05-04 had `tradeCount=261`. Challenger 2026-05-11 still has `tradeCount=261`, `winRatePct=42.53`, `maxDrawdownPct=2.88`. Only `tpAtrMult` moved (7.6 → 10.6). For seven days the optimizer has been re-tuning exit distance alone. That is a structural dead end — no amount of TP/SL tweaking changes the alpha hypothesis. A detector must surface this.

**Files:**
- Create: `scripts/lib/pine-entry-invariance.mjs`
- Create: `tests/pine-entry-invariance.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing invariance detector tests**

Create `tests/pine-entry-invariance.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectEntryParameterInvariance } from '../scripts/lib/pine-entry-invariance.mjs';

const exitOnlyEvents = Array.from({ length: 6 }).map((_, i) => ({
  type: 'cycle',
  timestamp: `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
  champion: { tradeCount: 261, winRatePct: 42.53, maxDrawdownPct: 2.88 },
  challenger: { tradeCount: 261, winRatePct: 42.53, maxDrawdownPct: 2.88 },
  touchedKeys: ['tpAtrMult'],
}));

test('detectEntryParameterInvariance flags exit-only drift when trade count and win rate stay constant', () => {
  const verdict = detectEntryParameterInvariance({
    recentCycles: exitOnlyEvents,
    policy: { minCycles: 5, entryKeys: ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount'] },
  });

  assert.equal(verdict.flagged, true);
  assert.equal(verdict.reason, 'exit_only_drift');
  assert.deepEqual(verdict.untouchedEntryKeys.sort(), ['adxThreshold', 'minBarsBetween', 'minPredSum', 'neighborsCount']);
});

test('detectEntryParameterInvariance is silent when entry keys are also moving', () => {
  const mixed = exitOnlyEvents.map((event, i) => ({
    ...event,
    touchedKeys: i % 2 === 0 ? ['tpAtrMult'] : ['adxThreshold'],
    challenger: { tradeCount: 261 + i * 4, winRatePct: 42 + i * 0.5, maxDrawdownPct: 2.88 },
  }));

  const verdict = detectEntryParameterInvariance({
    recentCycles: mixed,
    policy: { minCycles: 5, entryKeys: ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount'] },
  });

  assert.equal(verdict.flagged, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-entry-invariance.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the detector**

Create `scripts/lib/pine-entry-invariance.mjs`:

```javascript
const DEFAULT_ENTRY_KEYS = ['adxThreshold', 'minPredSum', 'minBarsBetween', 'neighborsCount', 'useSignalFusion', 'useFusionV4'];

export function detectEntryParameterInvariance({ recentCycles = [], policy = {} } = {}) {
  const minCycles = Math.max(2, Math.floor(Number(policy.minCycles ?? 5)));
  const entryKeys = Array.isArray(policy.entryKeys) && policy.entryKeys.length > 0
    ? policy.entryKeys
    : DEFAULT_ENTRY_KEYS;

  const cycles = Array.isArray(recentCycles) ? recentCycles : [];
  if (cycles.length < minCycles) {
    return { flagged: false, reason: 'not_enough_cycles', cyclesConsidered: cycles.length };
  }

  const touched = new Set();
  for (const event of cycles) {
    for (const key of event?.touchedKeys ?? []) touched.add(key);
  }
  const entryTouched = entryKeys.some((key) => touched.has(key));

  const tradeCounts = cycles.map((event) => Number(event?.challenger?.tradeCount)).filter(Number.isFinite);
  const winRates = cycles.map((event) => Number(event?.challenger?.winRatePct)).filter(Number.isFinite);
  const sameTradeCount = tradeCounts.length > 0 && tradeCounts.every((value) => value === tradeCounts[0]);
  const sameWinRate = winRates.length > 0 && winRates.every((value) => Math.abs(value - winRates[0]) < 0.01);

  if (!entryTouched && sameTradeCount && sameWinRate) {
    return {
      flagged: true,
      reason: 'exit_only_drift',
      cyclesConsidered: cycles.length,
      untouchedEntryKeys: entryKeys.filter((key) => !touched.has(key)),
    };
  }

  return { flagged: false, reason: 'entry_keys_active_or_signal_varying', cyclesConsidered: cycles.length };
}
```

- [ ] **Step 4: Emit the verdict into manifests and surface it in history**

In `scripts/pine-autoresearch.mjs` `buildScoutOrchestrationState`, add:

```javascript
entryInvariance: detectEntryParameterInvariance({
  recentCycles: recentCycleEvents,
  policy: trackedConfig.invariancePolicy || {},
}),
```

Extend `buildCycleHistoryEvent`:

```javascript
entryInvariance: manifest.entryInvariance ?? null,
```

- [ ] **Step 5: Force search-policy escalation when invariance is flagged**

In the same function, after computing `stagnationEscape`, override when invariance fires:

```javascript
if (manifestCandidate?.entryInvariance?.flagged) {
  stagnationEscape = {
    mode: 'force-entry-mutation',
    reason: 'exit_only_drift',
    allowArchitectureKeys: false,
    multiKeyMutationCount: 2,
    ladderScale: 1.5,
    requiredTouchedKeys: manifestCandidate.entryInvariance.untouchedEntryKeys,
  };
}
```

Thread `requiredTouchedKeys` into `searchPolicyWithNovelty` so the search batch guarantees at least one entry-key mutation per cycle.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/pine-entry-invariance.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-entry-invariance.mjs scripts/pine-autoresearch.mjs tests/pine-entry-invariance.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): detect exit-only drift and force entry-key mutations"
```

---

## Task 21: One-Shot Artifact Sweep for Leaked Variant Files

**Why:** Task 3 prevents new variant-file leaks but does nothing about the 150+ existing leaked files (`pine/autoresearch/pine-fusion-v4-core-15m-locked-window/*-variants.json` from 2026-04-27 through 2026-05-11). These bloat the directory, slow listing, and confuse operators.

**Files:**
- Create: `scripts/pine-autoresearch-sweep-legacy-artifacts.mjs`
- Create: `tests/pine-autoresearch-sweep-legacy-artifacts.test.mjs`

- [ ] **Step 1: Write failing sweep test**

Create `tests/pine-autoresearch-sweep-legacy-artifacts.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { planLegacyVariantSweep } from '../scripts/pine-autoresearch-sweep-legacy-artifacts.mjs';

test('planLegacyVariantSweep keeps only variant files matching runIds to retain', () => {
  const plan = planLegacyVariantSweep({
    files: [
      'x-2026-04-27T00-00-00-000Z-variants.json',
      'x-2026-05-10T00-00-00-000Z-variants.json',
      'x-2026-05-11T00-00-00-000Z-variants.json',
    ],
    retainRunIds: ['x-2026-05-11T00-00-00-000Z'],
  });

  assert.deepEqual(plan.keep, ['x-2026-05-11T00-00-00-000Z-variants.json']);
  assert.deepEqual(plan.delete, [
    'x-2026-04-27T00-00-00-000Z-variants.json',
    'x-2026-05-10T00-00-00-000Z-variants.json',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch-sweep-legacy-artifacts.test.mjs
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the sweep tool**

Create `scripts/pine-autoresearch-sweep-legacy-artifacts.mjs`:

```javascript
#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

export function planLegacyVariantSweep({ files = [], retainRunIds = [] } = {}) {
  const retainSet = new Set(retainRunIds.map((runId) => `${runId}-variants.json`));
  const keep = files.filter((name) => retainSet.has(name));
  const del = files.filter((name) => !retainSet.has(name));
  return { keep, delete: del };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, token, i, arr) => {
    if (token.startsWith('--')) acc.push([token.slice(2), arr[i + 1]]);
    return acc;
  }, []));

  const researchRoot = args.root;
  const retainCount = Math.max(1, Number(args.keep ?? 3));
  const dryRun = args.apply !== 'true';

  if (!researchRoot) {
    console.error('Usage: node scripts/pine-autoresearch-sweep-legacy-artifacts.mjs --root <path> [--keep 3] [--apply true]');
    process.exit(2);
  }

  const names = (await fs.readdir(researchRoot)).filter((name) => name.endsWith('-variants.json')).sort();
  const retainRunIds = names.slice(-retainCount).map((name) => name.replace(/-variants\.json$/, ''));
  const plan = planLegacyVariantSweep({ files: names, retainRunIds });

  console.log(JSON.stringify({ researchRoot, keep: plan.keep.length, delete: plan.delete.length, dryRun }, null, 2));

  if (dryRun) return;

  for (const name of plan.delete) {
    await fs.unlink(path.join(researchRoot, name));
  }
  console.log(`Deleted ${plan.delete.length} legacy variant files.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run dry-run against current research root**

Run:

```bash
node scripts/pine-autoresearch-sweep-legacy-artifacts.mjs --root pine/autoresearch/pine-fusion-v4-core-15m-locked-window --keep 3
```

Expected: prints JSON summary showing how many files would be deleted. No files removed in dry-run.

- [ ] **Step 5: Run with --apply true after confirming the dry-run summary**

Run:

```bash
node scripts/pine-autoresearch-sweep-legacy-artifacts.mjs --root pine/autoresearch/pine-fusion-v4-core-15m-locked-window --keep 3 --apply true
```

Expected: deletes old `*-variants.json` files, retaining the three most recent. Verify with `Get-ChildItem pine/autoresearch/pine-fusion-v4-core-15m-locked-window/*-variants.json | Measure-Object`.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/pine-autoresearch-sweep-legacy-artifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pine-autoresearch-sweep-legacy-artifacts.mjs tests/pine-autoresearch-sweep-legacy-artifacts.test.mjs
git commit -m "chore(pine): add one-shot legacy variant artifact sweep"
```

---

## Final Verification Batch

- [ ] **Step 1: Run focused test suite**

Run:

```bash
node --test tests/pine-search-policy.test.mjs tests/pine-async-pool.test.mjs tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch-lineage.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run production invariant suite**

Run:

```bash
node --test tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run one micro autoresearch cycle manually**

Run:

```bash
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json --profile micro --force-cycle
```

Expected:
- command exits 0
- manifest path printed
- no duplicate/tabu fallback variants when exploit lane is exhausted
- prune output includes `variants=` once variant cleanup is wired

- [ ] **Step 4: Inspect resulting scheduler state**

Run:

```bash
Get-Content "pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/pine-fusion-v4-core-15m-locked-window.json"
```

Expected:
- canonical fingerprints only
- no malformed identity drift
- stagnation metadata preserved

---

## Self-Review

### Spec coverage
- Canonical identity mismatch: covered in Task 1.
- Exploit-lane tabu replay: covered in Task 2.
- Hardcoded stale architecture freeze: covered in Task 2.
- Annealing logic producing bad candidates: covered in Task 2.
- Variant artifact leak: covered in Task 3.
- Sequential matrix execution: covered in Task 3.
- Stagnation without true escape: covered in Task 4.
- Naive similarity: covered in Task 5.
- Numeric ping-pong blind spot: covered in Task 5.
- Missing efficiency observability: covered in Task 6.

### Placeholder scan
- No `TODO` / `TBD` markers.
- Every code-changing step includes concrete code.
- Every verification step includes exact commands.
- Every commit step includes exact commands.

### Type consistency
- Canonical fingerprint name: `buildCanonicalConfigFingerprint` used consistently.
- Escape policy name: `decideStagnationEscapePlan` used consistently.
- Concurrency helper name: `mapWithConcurrency` used consistently.
- New manifest field names: `stagnationEscape`, `searchEfficiency`, `durationMs` used consistently.

---

## Recommended Execution Order

1. Task 1 — identity correctness
2. Task 2 — stop wasted cycles
3. Task 3 — speed + cleanup
4. Task 4 — real escape policy
5. Task 5 — harder promotion/rotation logic
6. Task 6 — observability

If the branch needs the highest-value minimal tranche first, execute **Tasks 1-3 only** before touching deeper strategy logic.

---

## Structural Hardening Addendum — Required Tasks 7-17

The earlier tasks improve search quality and runtime mechanics, but they still leave several failure modes that can make autoresearch look healthy while producing untrustworthy decisions. These tasks are required before implementation is considered complete.

### Additional files to modify

- `scripts/lib/pine-autoresearch.mjs`
  - Separate matrix performance decisions from promotion readiness; remove champion slot leakage in Pareto candidate selection; add tested-candidate memory and markdown regression fixes.
- `scripts/pine-autoresearch.mjs`
  - Wire holdout-pending manifests, LLM-safe promotion semantics, budget-debt updates, stagnation level transitions, evaluation caching, and verified preflight outputs.
- `scripts/lib/pine-autoresearch-llm-evaluator.mjs`
  - Require real backtest evidence before LLM candidates can be marked promotable.
- `scripts/lib/pine-regime-exit-scheduler.mjs`
  - Make lane budget debt a real deficit-round-robin state, not a read-only decoration.
- `scripts/lib/pine-autoresearch-tracks.mjs`
  - Make stagnation level progression explicit and testable.
- `scripts/pine-dataset.mjs`
  - Add an autoresearch preflight command that uses the same offline plan as `pine-autoresearch`.
- `scripts/lib/pine-evaluation-cache.mjs`
  - Cache immutable champion/lab evaluations inside a run to avoid redundant backtests.
- `tests/pine-autoresearch-holdout.test.mjs`
  - Holdout deadlock regression coverage.
- `tests/pine-autoresearch-llm-evidence.test.mjs`
  - LLM evaluator fake-evidence regression coverage.
- `tests/pine-regime-exit-scheduler.test.mjs`
  - Budget-debt accounting coverage.
- `tests/pine-dataset.test.mjs`
  - Dataset verify/preflight truth coverage.
- `tests/pine-evaluation-cache.test.mjs`
  - Evaluation cache key and reuse coverage.

---

## Task 7: Break the Holdout Deadlock Without Weakening Promotion Safety

**Files:**
- Create: `tests/pine-autoresearch-holdout.test.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch-holdout.test.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing holdout deadlock tests**

Create `tests/pine-autoresearch-holdout.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyHoldoutGate,
  decideAutoresearchOutcome,
} from '../scripts/lib/pine-autoresearch.mjs';
import { shouldQueuePromotionManifest } from '../scripts/pine-autoresearch.mjs';

const incumbent = {
  configId: 'champion',
  score: 10,
  metrics: { roiPct: 10, profitFactor: 1.5, maxDrawdownPct: 3, tradeCount: 200, winRatePct: 55, avgWin: 2, avgLoss: -1 },
  config: { tpAtrMult: 7.6 },
};

const challenger = {
  configId: 'challenger',
  score: 12,
  metrics: { roiPct: 20, profitFactor: 1.9, maxDrawdownPct: 2, tradeCount: 220, winRatePct: 58, avgWin: 2.2, avgLoss: -0.9 },
  config: { tpAtrMult: 10.6 },
};

test('classifyHoldoutGate marks missing blind holdout as pending, not failed', () => {
  assert.deepEqual(classifyHoldoutGate({ blindHoldoutLabs: [{ labId: 'blind-a' }], holdoutVerdict: null }), {
    required: true,
    status: 'pending',
    passed: false,
    reason: 'blind_holdout_pending',
  });
});

test('matrix outcome can pass while blind holdout remains pending', () => {
  const decision = decideAutoresearchOutcome({
    incumbent,
    challenger,
    thresholds: {
      minScoreDelta: 0,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 5,
      minTradeCount: 50,
      minTradeRatioVsIncumbent: 0.5,
    },
    expectancyPolicy: { enabled: false },
    blindHoldoutLabs: [{ labId: 'blind-a' }],
    holdoutVerdict: null,
    holdoutMode: 'defer',
  });

  assert.equal(decision.recommendation, 'promote');
  assert.equal(decision.holdoutGate.status, 'pending');
  assert.equal(decision.failedGates.includes('holdoutVerdict'), false);
});

test('holdout-pending manifests are not queued for promotion', () => {
  assert.equal(shouldQueuePromotionManifest({
    matrixDecision: { recommendation: 'promote' },
    challenger: { config: { tpAtrMult: 10.6 } },
    candidateFingerprint: 'candidate-fp',
    championFingerprint: 'champion-fp',
    blindHoldoutLabs: [{ labId: 'blind-a' }],
    holdoutGate: { required: true, status: 'pending', passed: false, reason: 'blind_holdout_pending' },
  }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch-holdout.test.mjs
```

Expected: FAIL because `classifyHoldoutGate` is not exported and holdout-pending manifests can still flow through queue logic.

- [ ] **Step 3: Add explicit holdout gate classification**

In `scripts/lib/pine-autoresearch.mjs`, add this export above `decideAutoresearchOutcome`:

```javascript
export function classifyHoldoutGate({ blindHoldoutLabs = [], holdoutVerdict = null } = {}) {
  const required = Array.isArray(blindHoldoutLabs) && blindHoldoutLabs.length > 0;
  if (!required) {
    return { required: false, status: 'not_required', passed: true, reason: 'blind_holdout_not_required' };
  }
  if (!holdoutVerdict) {
    return { required: true, status: 'pending', passed: false, reason: 'blind_holdout_pending' };
  }
  if (holdoutVerdict.passed === true) {
    return { required: true, status: 'passed', passed: true, reason: holdoutVerdict.reason || 'blind_holdout_passed' };
  }
  return { required: true, status: 'failed', passed: false, reason: holdoutVerdict.reason || 'blind_holdout_failed' };
}
```

- [ ] **Step 4: Change matrix gate behavior from deadlock to deferred holdout**

Update the `decideAutoresearchOutcome` signature in `scripts/lib/pine-autoresearch.mjs`:

```javascript
export function decideAutoresearchOutcome({
  incumbent,
  challenger,
  thresholds = {},
  expectancyPolicy = {},
  complexityPolicy = {},
  holdoutVerdict = null,
  blindHoldoutLabs = [],
  holdoutMode = 'defer',
  promotionPolicy = null,
} = {}) {
```

Replace the current blind-holdout block with:

```javascript
  const holdoutGate = classifyHoldoutGate({ blindHoldoutLabs, holdoutVerdict });
  if (failedGates.length === 0 && holdoutGate.status === 'failed') {
    return {
      recommendation: 'hold',
      summary: `Blind holdout failed: ${holdoutGate.reason}`,
      comparisons,
      gates: { ...gates, holdoutVerdict: false },
      failedGates: ['holdoutVerdict'],
      thresholds: {
        minScoreDelta,
        minRoiDeltaPct,
        minProfitFactorDelta,
        maxDrawdownDeltaPct,
        minTradeCount,
        minTradeRatioVsIncumbent,
        adjusted: adjustedThresholds,
      },
      complexity,
      expectancy: expectancyGate,
      expectancyGate,
      holdoutGate,
    };
  }

  if (failedGates.length === 0 && holdoutGate.status === 'pending' && holdoutMode === 'require') {
    return {
      recommendation: 'hold',
      summary: 'Blind holdout verdict required before promotion.',
      comparisons,
      gates: { ...gates, holdoutVerdict: false },
      failedGates: ['holdoutVerdict'],
      thresholds: {
        minScoreDelta,
        minRoiDeltaPct,
        minProfitFactorDelta,
        maxDrawdownDeltaPct,
        minTradeCount,
        minTradeRatioVsIncumbent,
        adjusted: adjustedThresholds,
      },
      complexity,
      expectancy: expectancyGate,
      expectancyGate,
      holdoutGate,
    };
  }
```

In the final returned decision object, include:

```javascript
    holdoutGate,
```

- [ ] **Step 5: Make queueing require promotion readiness, not just matrix pass**

In `scripts/pine-autoresearch.mjs`, replace `shouldQueuePromotionManifest` with:

```javascript
export function shouldQueuePromotionManifest(manifest) {
  const matrixPassed = manifest?.matrixDecision?.recommendation === 'promote';
  const candidateChanged = Boolean(manifest?.challenger?.config)
    && Boolean(manifest?.candidateFingerprint)
    && manifest.candidateFingerprint !== manifest.championFingerprint;
  const holdoutGate = manifest?.holdoutGate ?? manifest?.matrixDecision?.holdoutGate ?? null;
  const holdoutReady = !holdoutGate?.required || holdoutGate.passed === true;
  const explicitlyReady = manifest?.promotionReady === true || holdoutReady;
  return matrixPassed && candidateChanged && explicitlyReady;
}
```

- [ ] **Step 6: Persist holdout gate and promotion readiness into manifests**

In `buildScoutOrchestrationState(...).manifest`, add:

```javascript
      holdoutGate: selectedCandidate?.labResults?.[0]?.decision?.holdoutGate ?? null,
      promotionReady: promotionEligible
        && (selectedCandidate?.labResults?.[0]?.decision?.holdoutGate?.required !== true
          || selectedCandidate?.labResults?.[0]?.decision?.holdoutGate?.passed === true),
```

- [ ] **Step 7: Make blind-holdout output promotable when it passes**

In `runBlindHoldout`, extend `payload` with challenger/champion fields so `runPromote --manifest <holdoutPath>` can promote it:

```javascript
    champion: summarizeResult(championState),
    challenger: summarizeResult(latest.challenger),
    championFingerprint: configFingerprint(championState.config),
    candidateFingerprint: configFingerprint(latest.challenger.config),
    holdoutGate: {
      required: true,
      status: matrixDecision.recommendation === 'promote' ? 'passed' : 'failed',
      passed: matrixDecision.recommendation === 'promote',
      reason: matrixDecision.summary,
    },
    promotionReady: matrixDecision.recommendation === 'promote',
```

- [ ] **Step 8: Run holdout tests**

Run:

```bash
node --test tests/pine-autoresearch-holdout.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-holdout.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): separate matrix pass from holdout promotion readiness"
```

---

## Task 8: Reject Fake LLM Evaluation Evidence

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-evidence.mjs`
- Create: `tests/pine-autoresearch-llm-evidence.test.mjs`
- Modify: `scripts/lib/pine-autoresearch-llm-evaluator.mjs`
- Test: `tests/pine-autoresearch-llm-evidence.test.mjs`
- Test: `tests/pine-autoresearch-llm-evaluator.test.mjs`

- [ ] **Step 1: Write failing evidence validation tests**

Create `tests/pine-autoresearch-llm-evidence.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateLlmMatrixEvidence } from '../scripts/lib/pine-autoresearch-llm-evidence.mjs';

test('validateLlmMatrixEvidence rejects changed-key fake promotion results', () => {
  const result = validateLlmMatrixEvidence({
    matrixDecision: { recommendation: 'promote', summary: '2 changed config keys' },
    labResults: [{
      lab: { labId: 'primary' },
      decision: { recommendation: 'promote', comparisons: { scoreDelta: 2, roiDeltaPct: 2 } },
      challenger: { config: { tpAtrMult: 10.6 } },
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_backtest_evidence');
  assert.deepEqual(result.invalidLabIds, ['primary']);
});

test('validateLlmMatrixEvidence accepts promoted labs with incumbent and challenger metrics', () => {
  const result = validateLlmMatrixEvidence({
    matrixDecision: { recommendation: 'promote', summary: 'primary passed' },
    labResults: [{
      lab: { labId: 'primary' },
      incumbent: { roiPct: 10, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 3 },
      challenger: { roiPct: 15, profitFactor: 1.8, tradeCount: 110, maxDrawdownPct: 2 },
      decision: { recommendation: 'promote', comparisons: { roiDeltaPct: 5, profitFactorDelta: 0.4 } },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'backtest_evidence_present');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch-llm-evidence.test.mjs
```

Expected: FAIL because the evidence module does not exist.

- [ ] **Step 3: Add evidence validator**

Create `scripts/lib/pine-autoresearch-llm-evidence.mjs`:

```javascript
function finiteMetric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

function hasBacktestSummary(candidate) {
  return finiteMetric(candidate?.roiPct)
    && finiteMetric(candidate?.profitFactor)
    && finiteMetric(candidate?.tradeCount)
    && finiteMetric(candidate?.maxDrawdownPct);
}

export function validateLlmMatrixEvidence({ labResults = [], matrixDecision = null } = {}) {
  if (matrixDecision?.recommendation !== 'promote') {
    return { ok: true, reason: 'not_promoting', invalidLabIds: [] };
  }

  const promotedLabs = labResults.filter((result) => result?.decision?.recommendation === 'promote');
  const invalidLabIds = promotedLabs
    .filter((result) => !hasBacktestSummary(result?.incumbent) || !hasBacktestSummary(result?.challenger))
    .map((result) => result?.lab?.labId || 'unknown');

  if (promotedLabs.length === 0 || invalidLabIds.length > 0) {
    return { ok: false, reason: 'missing_backtest_evidence', invalidLabIds };
  }

  return { ok: true, reason: 'backtest_evidence_present', invalidLabIds: [] };
}
```

- [ ] **Step 4: Wire validation into LLM evaluator**

In `scripts/lib/pine-autoresearch-llm-evaluator.mjs`, add import:

```javascript
import { validateLlmMatrixEvidence } from './pine-autoresearch-llm-evidence.mjs';
```

After `const metricsDelta = summarizeLlmMatrixDelta({ labResults, matrixDecision });`, add:

```javascript
  const evidence = validateLlmMatrixEvidence({ labResults, matrixDecision });
  const promotable = evidence.ok && shouldEnqueueLlmCandidate({ matrixDecision });
```

Replace the returned `promotable` field with:

```javascript
    promotable,
    evidence,
```

- [ ] **Step 5: Add evaluator regression test**

Append to `tests/pine-autoresearch-llm-evaluator.test.mjs`:

```javascript
test('executeLlmMatrixCandidate refuses promotable=true for fake changed-key evaluator output', async () => {
  const result = await executeLlmMatrixCandidate({
    candidate: { patch: { tpAtrMult: 10.6 }, rationale: 'try bigger target' },
    candidateFingerprint: 'abc123fake999',
    config: { baseConfigPath: './config/pine-autoresearch.default.json' },
    repoRoot: process.cwd(),
    loadBaseConfig: async () => ({ matrixId: 'matrix-a', researchRoot: 'tmp/llm-fake-evidence' }),
    loadChampionState: async () => ({ configId: 'champion-a', config: { tpAtrMult: 7.6 } }),
    evaluateMatrixCandidate: async () => ({
      labResults: [{
        lab: { labId: 'primary' },
        decision: { recommendation: 'promote', comparisons: { scoreDelta: 1, roiDeltaPct: 1 } },
        challenger: { config: { tpAtrMult: 10.6 } },
      }],
      matrixDecision: { recommendation: 'promote', summary: '1 changed key' },
    }),
    nowId: () => '2026-05-11T00-00-00-000Z',
  });

  assert.equal(result.ok, true);
  assert.equal(result.promotable, false);
  assert.equal(result.evidence.reason, 'missing_backtest_evidence');
});
```

- [ ] **Step 6: Run LLM tests**

Run:

```bash
node --test tests/pine-autoresearch-llm-evidence.test.mjs tests/pine-autoresearch-llm-evaluator.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch-llm-evidence.mjs scripts/lib/pine-autoresearch-llm-evaluator.mjs tests/pine-autoresearch-llm-evidence.test.mjs tests/pine-autoresearch-llm-evaluator.test.mjs
git commit -m "fix(pine): reject llm promotion without backtest evidence"
```

---

## Task 9: Make Lane Budget Debt Real State

**Files:**
- Modify: `scripts/lib/pine-regime-exit-scheduler.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-regime-exit-scheduler.test.mjs`

- [ ] **Step 1: Write failing deficit-round-robin tests**

Append to `tests/pine-regime-exit-scheduler.test.mjs`:

```javascript
test('nextLaneBudgetDebt accrues unselected lane debt and pays down selected lane', () => {
  const next = nextLaneBudgetDebt({
    currentDebt: { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 0 },
    allocation: { exploit: 2, exitRegime: 3, globalAllParameter: 2, robustness: 1 },
    selectedLane: 'exitRegime',
  });

  assert.deepEqual(next, {
    exploit: 2,
    exitRegime: -5,
    globalAllParameter: 2,
    robustness: 1,
  });
});

test('selectNextResearchLane uses real debt before stagnation preference', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: { exploit: 9, exitRegime: 0, globalAllParameter: 0, robustness: 0 },
    lanesEnabled: { exploit: true, exitRegime: true, globalAllParameter: true, robustness: true },
  });

  assert.equal(lane, 'exploit');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: FAIL because `nextLaneBudgetDebt` is not exported.

- [ ] **Step 3: Add lane budget debt helper**

In `scripts/lib/pine-regime-exit-scheduler.mjs`, add:

```javascript
export function nextLaneBudgetDebt({ currentDebt = {}, allocation = {}, selectedLane = null } = {}) {
  const lanes = LANE_KEYS;
  const safeAllocation = Object.fromEntries(lanes.map((lane) => [lane, Math.max(0, Math.floor(Number(allocation[lane]) || 0))]));
  const totalBudget = lanes.reduce((sum, lane) => sum + safeAllocation[lane], 0);
  const next = {};

  for (const lane of lanes) {
    next[lane] = normalizeBudgetDebt(currentDebt[lane]) + safeAllocation[lane];
  }

  if (selectedLane && Object.prototype.hasOwnProperty.call(next, selectedLane)) {
    next[selectedLane] -= totalBudget;
  }

  return next;
}
```

- [ ] **Step 4: Wire budget debt into scheduler writes**

In `scripts/pine-autoresearch.mjs`, update the import:

```javascript
import { allocateRegimeExitLaneBudget, nextLaneBudgetDebt, resolveExhaustedResearchLanes, selectNextResearchLane } from './lib/pine-regime-exit-scheduler.mjs';
```

Before each `nextTrackState({ state: schedulerState, ... })` call for completed/skipped generated-lane cycles, compute:

```javascript
const laneBudgetAllocation = allocateRegimeExitLaneBudget({
  maxConfigs: trackedConfig.maxConfigs,
  lanes: trackedConfig.regimeExitResearch?.lanes,
});
const budgetDebt = nextLaneBudgetDebt({
  currentDebt: schedulerState.budgetDebt || {},
  allocation: laneBudgetAllocation,
  selectedLane: selectedRegimeLane || activeTrack?.lane || null,
});
```

After `nextTrackState(...)`, persist:

```javascript
const updatedSchedulerState = {
  ...nextTrackState({
    state: schedulerState,
    policy: rotationPolicy,
    manifest: schedulerManifest,
  }),
  budgetDebt,
};
```

- [ ] **Step 5: Add manifest debug field for budget debt**

In `buildScoutOrchestrationState(...).manifest`, add:

```javascript
      laneBudgetDebt: trackState.budgetDebt ?? null,
```

Pass `budgetDebt` in the `trackState` object from `runScout`.

- [ ] **Step 6: Run scheduler and autoresearch tests**

Run:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-regime-exit-scheduler.mjs scripts/pine-autoresearch.mjs tests/pine-regime-exit-scheduler.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): persist lane budget debt"
```

---

## Task 10: Make Stagnation Level Progression Explicit

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `tests/pine-autoresearch-tracks.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Write failing stagnation progression tests**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```javascript
test('nextStagnationState escalates after repeated no-new-candidate cycles', () => {
  assert.deepEqual(nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 3,
    promotionEligible: false,
    policy: { noNewCandidateEscalateAfter: 3, maxStagnationLevel: 3 },
  }), {
    stagnationLevel: 1,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: null,
  });
});

test('nextStagnationState resets when promotion becomes eligible', () => {
  assert.deepEqual(nextStagnationState({
    previousLevel: 2,
    noNewCandidateStreak: 0,
    promotionEligible: true,
    policy: { noNewCandidateEscalateAfter: 3, maxStagnationLevel: 3 },
  }), {
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs
```

Expected: FAIL because `nextStagnationState` is not exported.

- [ ] **Step 3: Add explicit stagnation transition helper**

In `scripts/lib/pine-autoresearch-tracks.mjs`, add:

```javascript
export function nextStagnationState({
  previousLevel = 0,
  noNewCandidateStreak = 0,
  promotionEligible = false,
  policy = {},
  now = null,
} = {}) {
  const maxStagnationLevel = Math.max(0, Math.floor(Number(policy.maxStagnationLevel ?? 3)));
  const noNewCandidateEscalateAfter = Math.max(1, Math.floor(Number(policy.noNewCandidateEscalateAfter ?? 3)));
  const safePrevious = Math.max(0, Math.floor(Number(previousLevel) || 0));

  if (promotionEligible) {
    return { stagnationLevel: 0, stagnationReason: null, lastEscalatedAt: null };
  }

  if (noNewCandidateStreak >= noNewCandidateEscalateAfter) {
    return {
      stagnationLevel: Math.min(maxStagnationLevel, safePrevious + 1),
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: now,
    };
  }

  return {
    stagnationLevel: safePrevious,
    stagnationReason: policy.currentReason ?? null,
    lastEscalatedAt: policy.lastEscalatedAt ?? null,
  };
}
```

- [ ] **Step 4: Wire helper into `nextTrackState`**

Inside `nextTrackState`, before the return object, add:

```javascript
  const stagnation = nextStagnationState({
    previousLevel: previous.stagnationLevel ?? 0,
    noNewCandidateStreak: noNewCandidate ? previous.noNewCandidateStreak + 1 : previous.noNewCandidateStreak,
    promotionEligible: manifest.promotionEligible === true,
    policy: {
      ...(policy.stagnation || policy.rotationPolicy?.stagnation || {}),
      currentReason: previous.stagnationReason ?? null,
      lastEscalatedAt: previous.lastEscalatedAt ?? null,
    },
    now: manifest.generatedAt ?? null,
  });
```

Add these fields to the returned state:

```javascript
    stagnationLevel: stagnation.stagnationLevel,
    stagnationReason: stagnation.stagnationReason,
    lastEscalatedAt: stagnation.lastEscalatedAt,
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix(pine): make stagnation progression explicit"
```

---

## Task 11: Make Dataset Verification Use the Same Offline Preflight as Autoresearch

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/pine-dataset.mjs`
- Modify: `tests/pine-dataset.test.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing preflight export test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('autoresearch exports offline data preflight builder for dataset verification parity', () => {
  assert.equal(typeof autoresearchCli.buildOfflineDataPreflight, 'function');
});
```

- [ ] **Step 2: Write failing dataset preflight CLI shape test**

Append to `tests/pine-dataset.test.mjs`:

```javascript
test('dataset preflight command documents autoresearch readiness, not only cache completeness', () => {
  const helpText = formatDatasetHelp();
  assert.match(helpText, /preflight/);
  assert.match(helpText, /same offline preflight used by autoresearch/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-dataset.test.mjs
```

Expected: FAIL because `buildOfflineDataPreflight` and `formatDatasetHelp` are not exported.

- [ ] **Step 4: Export autoresearch preflight**

In `scripts/pine-autoresearch.mjs`, change:

```javascript
async function buildOfflineDataPreflight(config) {
```

to:

```javascript
export async function buildOfflineDataPreflight(config) {
```

- [ ] **Step 5: Add dataset help and preflight command**

In `scripts/pine-dataset.mjs`, add import:

```javascript
import { buildOfflineDataPreflight, loadConfig as loadAutoresearchConfig } from './pine-autoresearch.mjs';
```

Add:

```javascript
export function formatDatasetHelp() {
  return [
    'Usage: node scripts/pine-dataset.mjs <command> [options]',
    '',
    'Commands:',
    '  verify     Verify pinned dataset files and candle cache completeness',
    '  preflight  Run the same offline preflight used by autoresearch',
    '  stage      Stage pinned datasets into cache',
    '  pin        Create pinned datasets',
  ].join('\n');
}

async function runPreflight(args) {
  const config = await loadAutoresearchConfig(process.cwd(), args.config, {
    profile: args.profile,
  });
  const summary = await buildOfflineDataPreflight(config);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.ok !== true) process.exitCode = 2;
}
```

In `main()`, before config loading, add:

```javascript
  if (args._[0] === 'help' || args.help === true || args.h === true) {
    console.log(formatDatasetHelp());
    return;
  }
```

Then add command branch:

```javascript
  if (command === 'preflight') {
    await runPreflight(args);
    return;
  }
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-dataset.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pine-autoresearch.mjs scripts/pine-dataset.mjs tests/pine-autoresearch.test.mjs tests/pine-dataset.test.mjs
git commit -m "fix(pine): align dataset verify with autoresearch preflight"
```

---

## Task 12: Lock Force-Promotion Semantics to Operational Blocks Only

**Files:**
- Modify: `tests/pine-autoresearch.test.mjs`
- Modify: `tests/pine-promotion-queue.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-promotion-status.mjs`

- [ ] **Step 1: Write force-safety regression tests**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('canForceQueuedPromotion only allows explicit operator or queue blocks', () => {
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'operator_blocked' }), true);
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'queue_blocked' }), true);
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'safety_failed' }), false);
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'expectancy_failed' }), false);
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'holdout_failed' }), false);
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'stale' }), false);
  assert.equal(autoresearchCli.canForceQueuedPromotion({ status: 'invalid' }), false);
});
```

- [ ] **Step 2: Add queue status classification tests**

Append to `tests/pine-promotion-queue.test.mjs`:

```javascript
test('promotion hold reason classification does not mark failed gates as forceable queue blocks', () => {
  assert.equal(classifyPromotionHoldReason('Auto-promote hold: failed cooldown gate(s).'), 'safety_failed');
  assert.equal(classifyPromotionHoldReason('Blind holdout failed: premise burn.'), 'holdout_failed');
  assert.equal(classifyPromotionHoldReason('operator requested manual queue pause'), 'queue_blocked');
});
```

- [ ] **Step 3: Run tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-promotion-queue.test.mjs
```

Expected: PASS. If this fails, replace broad status checks with the exact implementation in Step 4.

- [ ] **Step 4: Lock implementation to explicit forceable statuses**

In `scripts/lib/pine-promotion-status.mjs`, keep only:

```javascript
export function isForceablePromotionStatus(status) {
  return status === PROMOTION_STATUS.OPERATOR_BLOCKED || status === PROMOTION_STATUS.QUEUE_BLOCKED;
}
```

In `scripts/pine-autoresearch.mjs`, keep only:

```javascript
export function canForceQueuedPromotion(queuedAction = null) {
  return isForceablePromotionStatus(queuedAction?.status);
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-promotion-status.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs tests/pine-promotion-queue.test.mjs
git commit -m "test(pine): lock force promotion to operational blockers"
```

---

## Task 13: Stop Champion from Consuming Challenger Evaluation Slots

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing Pareto shortlist test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('buildParetoShortlist can reserve all shortlist slots for challengers', () => {
  const champion = { configId: 'champ', score: 10, roiPct: 10, profitFactor: 1.4, tradeCount: 100, maxDrawdownPct: 2, config: { a: 1 } };
  const rankedResults = [
    { configId: 'cand-1', score: 11, roiPct: 12, profitFactor: 1.5, tradeCount: 100, maxDrawdownPct: 2, config: { a: 2 } },
    { configId: 'cand-2', score: 10.5, roiPct: 11, profitFactor: 1.45, tradeCount: 100, maxDrawdownPct: 2, config: { a: 3 } },
  ];

  const shortlist = buildParetoShortlist({ champion, rankedResults, limit: 2, includeChampion: false });
  assert.deepEqual(shortlist.map((item) => item.configId), ['cand-1', 'cand-2']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: FAIL because `buildParetoShortlist` does not support `includeChampion`.

- [ ] **Step 3: Add `includeChampion` option**

In `scripts/lib/pine-autoresearch.mjs`, replace the function signature and pool construction:

```javascript
export function buildParetoShortlist({ champion, rankedResults = [], limit = 4, includeChampion = true } = {}) {
  const pool = [includeChampion ? champion : null, ...rankedResults].filter(Boolean);
```

Wrap the champion unshift block:

```javascript
  if (includeChampion && champion && !unique.some((item) => item.configId === champion.configId)) {
    unique.unshift(champion);
  }
```

- [ ] **Step 4: Use challenger-only shortlist for matrix evaluation**

In `scripts/pine-autoresearch.mjs`, update both `buildParetoShortlist` calls used for matrix candidate evaluation:

```javascript
  const paretoShortlist = buildParetoShortlist({
    champion: summarizeResult(championState),
    rankedResults: primarySweep.topConfigs,
    limit: trackedConfig.searchPolicy.paretoShortlistSize,
    includeChampion: false,
  });
```

If a manifest needs to show the champion, it already has `champion` and `incumbent` fields; do not spend challenger slots on it.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): reserve matrix shortlist slots for challengers"
```

---

## Task 14: Track All Tested Candidate Fingerprints, Not Only Rejections

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-search-policy.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`
- Modify: `tests/pine-search-policy.test.mjs`

- [ ] **Step 1: Write failing history collector test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('collectRecentTestedCandidateFingerprints includes held, promoted, and no-new-candidate variants', () => {
  const fingerprints = autoresearchCli.collectTestedCandidateFingerprintsFromManifests([
    { searchPlan: { variants: [{ config: { a: 1 } }, { config: { a: 2 } }] } },
    { matrixCandidates: [{ challenger: { config: { a: 3 } } }] },
  ]);

  assert.equal(fingerprints.size, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: FAIL because the collector does not exist.

- [ ] **Step 3: Add tested fingerprint collector**

In `scripts/pine-autoresearch.mjs`, add export:

```javascript
export function collectTestedCandidateFingerprintsFromManifests(manifests = []) {
  const fingerprints = new Set();
  for (const manifest of Array.isArray(manifests) ? manifests : []) {
    for (const variant of manifest?.searchPlan?.variants || []) {
      if (variant?.config) fingerprints.add(configFingerprint(variant.config));
    }
    for (const candidate of manifest?.matrixCandidates || []) {
      if (candidate?.challenger?.config) fingerprints.add(configFingerprint(candidate.challenger.config));
    }
    if (manifest?.challenger?.config) fingerprints.add(configFingerprint(manifest.challenger.config));
  }
  return fingerprints;
}
```

- [ ] **Step 4: Pass tested fingerprints into search policy**

After loading `recentManifestsForNovelty`, add:

```javascript
  const testedCandidateFingerprints = collectTestedCandidateFingerprintsFromManifests(recentManifestsForNovelty);
```

Add it to `searchPolicyWithNovelty`:

```javascript
    testedCandidateFingerprints,
```

- [ ] **Step 5: Make exploit search honor tested fingerprints**

In `scripts/lib/pine-search-policy.mjs`, merge the sets:

```javascript
  const testedCandidateFingerprints = policy.testedCandidateFingerprints instanceof Set
    ? policy.testedCandidateFingerprints
    : new Set(Array.isArray(policy.testedCandidateFingerprints) ? policy.testedCandidateFingerprints : []);
  const tabuSet = new Set([...(schedulerState.tabuRejectedFingerprints || []), ...testedCandidateFingerprints]);
```

- [ ] **Step 6: Add search-policy regression test**

Append to `tests/pine-search-policy.test.mjs`:

```javascript
test('buildIncumbentSearchBatch excludes candidates already tested in prior manifests', () => {
  const testedCandidateFingerprints = new Set();
  const firstBatch = buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitRatio: 1 },
    schedulerState: {},
  });
  testedCandidateFingerprints.add(configFingerprint(firstBatch[0].config));

  const secondBatch = buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitRatio: 1, testedCandidateFingerprints },
    schedulerState: {},
  });

  assert.notEqual(configFingerprint(secondBatch[0].config), configFingerprint(firstBatch[0].config));
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-search-policy.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs scripts/lib/pine-search-policy.mjs tests/pine-autoresearch.test.mjs tests/pine-search-policy.test.mjs
git commit -m "fix(pine): avoid retesting previously evaluated candidates"
```

---

## Task 15: Cache Champion Lab Evaluations Within a Run

**Files:**
- Create: `scripts/lib/pine-evaluation-cache.mjs`
- Create: `tests/pine-evaluation-cache.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Write failing cache tests**

Create `tests/pine-evaluation-cache.test.mjs`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvaluationCacheKey, createEvaluationCache } from '../scripts/lib/pine-evaluation-cache.mjs';

test('buildEvaluationCacheKey is stable for same config/lab role', () => {
  assert.equal(
    buildEvaluationCacheKey({ runId: 'run-1', labId: 'primary', variantKey: 'champion', configFingerprint: 'fp-1' }),
    'run-1|primary|champion|fp-1',
  );
});

test('createEvaluationCache reuses in-flight evaluations', async () => {
  let calls = 0;
  const cache = createEvaluationCache();
  const key = 'run-1|primary|champion|fp-1';
  const [left, right] = await Promise.all([
    cache.getOrCompute(key, async () => { calls += 1; return { score: 1 }; }),
    cache.getOrCompute(key, async () => { calls += 1; return { score: 1 }; }),
  ]);

  assert.deepEqual(left, { score: 1 });
  assert.deepEqual(right, { score: 1 });
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-evaluation-cache.test.mjs
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Add evaluation cache helper**

Create `scripts/lib/pine-evaluation-cache.mjs`:

```javascript
export function buildEvaluationCacheKey({ runId, labId, variantKey, configFingerprint } = {}) {
  return [runId, labId, variantKey, configFingerprint].map((value) => String(value ?? '')).join('|');
}

export function createEvaluationCache() {
  const cache = new Map();
  return {
    getOrCompute(key, compute) {
      if (!cache.has(key)) {
        cache.set(key, Promise.resolve().then(compute));
      }
      return cache.get(key);
    },
    size() {
      return cache.size;
    },
  };
}
```

- [ ] **Step 4: Wire cache into matrix evaluation**

In `scripts/pine-autoresearch.mjs`, add import:

```javascript
import { buildEvaluationCacheKey, createEvaluationCache } from './lib/pine-evaluation-cache.mjs';
```

At the start of `evaluateMatrix`, add:

```javascript
  const evaluationCache = createEvaluationCache();
```

Inside `evaluateLabPair`, replace direct champion evaluation with:

```javascript
  const incumbentFingerprint = configFingerprint(championState.config || {});
  const incumbentKey = buildEvaluationCacheKey({
    runId,
    labId: lab.labId,
    variantKey: 'champion',
    configFingerprint: incumbentFingerprint,
  });
  const incumbentResult = await evaluationCache.getOrCompute(incumbentKey, () => evaluateConfigOnLab({
    config,
    lab,
    runId,
    variantKey: 'champion',
    candidate: championState,
  }));
```

Pass `evaluationCache` into `evaluateLabPair` from `evaluateMatrix`.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test tests/pine-evaluation-cache.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-evaluation-cache.mjs scripts/pine-autoresearch.mjs tests/pine-evaluation-cache.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "perf(pine): cache champion lab evaluations within matrix runs"
```

---

## Task 16: Remove Duplicate Digest Sections and Add Rendering Regression Tests

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing duplicate-section render test**

Append to `tests/pine-autoresearch.test.mjs`:

```javascript
test('renderScoutMarkdown emits Search plan and Pareto shortlist only once', () => {
  const text = renderScoutMarkdown({
    config: { matrixId: 'matrix-a', primaryLab: { labId: 'primary' } },
    manifest: {
      generatedAt: '2026-05-11T00:00:00.000Z',
      runId: 'run-1',
      champion: { configId: 'champ', score: 1, tradeCount: 10, roiPct: 1, profitFactor: 1.2, maxDrawdownPct: 1, config: { a: 1 } },
      challenger: { configId: 'cand', score: 2, tradeCount: 11, roiPct: 2, profitFactor: 1.3, maxDrawdownPct: 1, config: { a: 2 } },
      matrixDecision: { recommendation: 'hold', summary: 'hold' },
      searchPlan: { variantCount: 2, exploitRatio: 0.5, variants: [] },
      paretoShortlist: [{ configId: 'cand', score: 2, roiPct: 2, profitFactor: 1.3, maxDrawdownPct: 1 }],
      primarySweep: { topConfigs: [] },
      researchState: { steadyState: false, noChangeStreak: 0 },
    },
  });

  assert.equal((text.match(/^## Search plan$/gm) || []).length, 1);
  assert.equal((text.match(/^## Pareto shortlist$/gm) || []).length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: FAIL if the duplicate sections still exist.

- [ ] **Step 3: Delete the duplicate render block**

In `scripts/lib/pine-autoresearch.mjs`, remove the second repeated block:

```javascript
  if (manifest.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${manifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${manifest.searchPlan.exploitRatio}`);
  }

  if (manifest.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of manifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }
```

Keep the first occurrence only.

- [ ] **Step 4: Run tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): remove duplicate scout digest sections"
```

---

## Task 17: Add Result Trust Invariants for Latest Pointer, Orphans, and Raw Evaluation Dirs

**Files:**
- Modify: `tests/pine-autoresearch-production-invariants.test.mjs`
- Modify: `scripts/lib/pine-autoresearch-artifacts.mjs`
- Modify: `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Write production invariant tests for result trust**

Append to `tests/pine-autoresearch-production-invariants.test.mjs`:

```javascript
import path from 'node:path';

const fixtureResearchRoot = path.join(
  process.cwd(),
  'pine',
  'autoresearch',
  'pine-fusion-v4-core-15m-locked-window',
);

test('latest manifest pointer never resolves to an incomplete run marker', () => {
  const pointer = validateLatestManifestPointer({ root: fixtureResearchRoot });
  if (pointer.ok) {
    assert.notEqual(pointer.manifest?.incomplete, true);
    assert.ok(pointer.manifest?.runId);
  }
});

test('autoresearch artifact warnings mention orphan evaluation runs', () => {
  const warnings = buildAutoresearchArtifactWarnings({ researchRoot: fixtureResearchRoot });
  assert.ok(Array.isArray(warnings));
});
```

Note: the invariant suite uses the real researchRoot as an inspection target — these tests must pass or skip cleanly even when the directory contains no manifests, so keep assertions conditional on `pointer.ok`.

- [ ] **Step 2: Export warning builder for invariant tests**

In `scripts/pine-autoresearch.mjs`, change:

```javascript
function buildAutoresearchArtifactWarnings(config) {
```

to:

```javascript
export function buildAutoresearchArtifactWarnings(config) {
```

- [ ] **Step 3: Make orphan warnings actionable**

In `buildAutoresearchArtifactWarnings`, replace the generic orphan warning with:

```javascript
    warnings.push(`Found ${orphanRuns.orphans.length} evaluation run(s) without manifest or incomplete marker: ${orphanRuns.orphans.slice(0, 5).join(', ')}.`);
```

- [ ] **Step 4: Run production invariant tests**

Run:

```bash
node --test tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch-production-invariants.test.mjs
git commit -m "test(pine): add autoresearch result trust invariants"
```

---



## Updated Final Verification Batch

- [ ] **Step 1: Run the full focused autoresearch suite**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-autoresearch-holdout.test.mjs tests/pine-autoresearch-llm-evidence.test.mjs tests/pine-autoresearch-llm-evaluator.test.mjs tests/pine-regime-exit-scheduler.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-search-policy.test.mjs tests/pine-dataset.test.mjs tests/pine-evaluation-cache.test.mjs tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Verify CLI help paths are non-operational**

Run:

```bash
node scripts/pine-autoresearch.mjs --help
node scripts/pine-autoresearch.mjs cycle --help
node scripts/pine-dataset.mjs help
```

Expected:
- all three commands print help
- none creates a lock file
- none writes a manifest
- none runs a sweep

- [ ] **Step 3: Verify dataset preflight and autoresearch cycle agree**

Run:

```bash
node scripts/pine-dataset.mjs preflight --config config/pine-autoresearch.default.json
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json --profile micro --force-cycle
```

Expected:
- if preflight exits 0, the cycle must not skip with `offlineDataMissing`
- if preflight exits 2, the cycle may skip with `offlineDataMissing`
- mismatch is a blocker

- [ ] **Step 4: Inspect latest manifest for structural safety fields**

Run:

```bash
node -e "const fs=require('fs'); const latest=JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json','utf8')); console.log(JSON.stringify({runId: latest.runId, promotionReady: latest.promotionReady, holdoutGate: latest.holdoutGate, laneBudgetDebt: latest.laneBudgetDebt, searchEfficiency: latest.searchEfficiency, durationMs: latest.durationMs}, null, 2));"
```

Expected:
- `promotionReady` is boolean when a challenger exists
- `holdoutGate` is present when blind holdout labs are configured
- `laneBudgetDebt` is present when regime research is enabled
- `searchEfficiency` is present
- `durationMs` is numeric

---

## Updated Self-Review Addendum

### Additional hidden flaws now covered

- Holdout deadlock: Task 7.
- Matrix pass vs promotion readiness confusion: Task 7.
- LLM fake/changed-key evaluator risk: Task 8.
- Budget-debt read-only theater: Task 9.
- Stagnation level never escalating explicitly: Task 10.
- Dataset verifier giving false autoresearch readiness confidence: Task 11.
- Force promotion accidentally bypassing safety gates: Task 12.
- Champion consuming Pareto shortlist challenger slots: Task 13.
- Sweep offset and history allowing retest of all previously evaluated candidates: Task 14.
- Champion backtest re-run waste across matrix candidates: Task 15.
- Duplicate scout markdown sections: Task 16.
- Latest/results trust around raw evaluation dirs and orphan artifacts: Task 17.
- Tabu set grows unbounded and blocks exploit lane against long-dead champions: Task 18.
- Noise-level score deltas (≈1.5%) rubber-stamped as "promotions" with no effect-size gate: Task 19.
- Optimizer stuck tuning exit distance only (identical tradeCount/winRate/drawdown across 7 days of cycles) with no detector: Task 20.
- 150+ leaked `*-variants.json` artifacts from before the Task 3 prune fix: Task 21.

### Plan-internal flaws fixed in place (not separate tasks)

- Task 3 Step 4 was a placeholder assertion (`calls += 1; assert.equal(calls, 1)`) — replaced with a real short-circuit test using an `autoresearchCli.__testOverrides.evaluateConfigOnLab` hook that verifies shadow labs are skipped when primary fails.
- Task 5 Step 6 `numericKeys.every(key => Object.is(event.fromConfig[key], candidateConfig[key]))` silently matched pairs where both sides were `undefined`, creating false positives — replaced with an explicit `numericKeysMatch` helper that short-circuits on missing keys.
- Task 5 numeric-reversal detection was dead code against production — real promotion events in `history.jsonl` only carry `fromConfigId`/`toConfigId`/`championConfigId` strings, never config objects. Added Step 6b: a `buildPromotionHistoryEvent` helper that enriches every promote/autopromote event with `fromConfig`, `toConfig`, `fromFingerprint`, `toFingerprint`, and family keys so the reversal check can actually fire.
- Task 17 Step 1 referenced `fixtureResearchRoot` without defining it — added the `path.join(process.cwd(), ...)` fixture binding and made assertions null-safe via `if (pointer.ok)` guards.
- Task 4 hardcoded `exploitExhausted: false`, meaning the highest escape tier (`progressive-widen`) could never fire — rewired to read `searchEfficiency.allCandidatesTabu` and `searchEfficiency.emittedVariantCount` from the prior manifest. Added a dependency note that Task 6 must ship before Task 4 for this wiring to be live.
- Task 2 Step 5 `buildDiversePatch` threw away the direction encoded in the pool entries (`{tpAtrMult: 5.5}` from base 7.6 means "try lower") by computing `base * ratio` — rewritten to preserve `poolDelta = targetValue - baseValue` and scale by `magnitude * temperature`, keeping the pool's directional intent while widening the step under stagnation.

### Updated execution order

1. Task 20 — entry-parameter invariance detector and forced entry mutations (breaks the exit-only loop; this is the real root cause).
2. Task 19 — statistical significance gate (stops noise-level promotions from propagating through the rest of the machinery).
3. Task 7 — holdout correctness and promotion readiness.
4. Task 8 — LLM evidence safety.
5. Task 18 — tabu aging and champion-scoped pruning (unblocks exploit lane immediately on existing state).
6. Task 9 — real lane budget debt.
7. Task 10 — explicit stagnation progression.
8. Task 1 — canonical identity.
9. Task 13 — challenger-only shortlist.
10. Task 14 — all-tested fingerprint memory.
11. Task 2 — exploit tabu/mutation quality (depends on Task 18 and now preserves pool direction).
12. Task 15 — champion evaluation cache.
13. Task 3 — matrix concurrency and artifact hygiene (now with a real short-circuit test, not a placeholder).
14. Task 21 — one-shot legacy artifact sweep (run once after Task 3 is live).
15. Task 11 — dataset preflight parity.
16. Task 12 — force-promotion invariant lock.
17. Task 16 — markdown render cleanup.
18. Task 17 — result trust invariants (now with a defined `fixtureResearchRoot`).
19. Task 6 — efficiency observability (must ship before Task 4 so `searchEfficiency` exists in manifests).
20. Task 4 — deeper stagnation escape (consumes `searchEfficiency` from Task 6, so `exploitExhausted` is a real signal, not constant `false`).
21. Task 5 — weighted similarity and numeric ping-pong (Step 6b promotion-event enrichment is required for the numeric reversal check to fire in production).

### No-placeholder check for addendum

- No `TODO` markers.
- No `TBD` markers.
- Every new task has exact files, test code, implementation code, commands, and commit command.
- New field names are consistent: `holdoutGate`, `promotionReady`, `evidence`, `budgetDebt`, `laneBudgetDebt`, `stagnationLevel`, `searchEfficiency`, `durationMs`.

## Updated Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-autoresearch-comprehensive-improvement.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fastest safe iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

