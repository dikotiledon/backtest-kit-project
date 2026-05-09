# Pine Autoresearch Duplicate Sweep Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop autoresearch from re-running identical challengers/sweeps when the champion and generated `globalAllParameter` patches have already been tested.

**Architecture:** Add deterministic novelty accounting at the candidate-generation boundary, not after expensive sweeps. `globalAllParameter` must generate multiple history-aware patch variants per family, skip patch hashes already seen for the same champion, and surface exhaustion explicitly so the cycle can hold/skip instead of launching duplicate sweep payloads.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing Pine autoresearch scripts under `scripts/`, JSON manifests/history under `pine/autoresearch/`, npm scripts in `package.json`.

---

## Current Failure Snapshot

- Two reports are effectively duplicate runs:
  - `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/pine-fusion-v4-core-15m-locked-window-2026-05-08T12-26-53-119Z.md`
  - `report/pine-autoresearch/pine-fusion-v4-core-15m-locked-window/pine-fusion-v4-core-15m-locked-window-2026-05-08T11-40-00-147Z.md`
- Both manifests select `globalAllParameter` at `stagnationLevel=1`.
- Both variant files are raw-identical: `sha256 ac02b62d46392adb`.
- Same six generated variants repeat:
  - `global-all-parameter-entry`
  - `global-all-parameter-filters`
  - `global-all-parameter-risk`
  - `global-all-parameter-fusion-weight`
  - `global-all-parameter-asymmetry`
  - `global-all-parameter-exit-state`
- Manifest evidence says these are real generated variants, not preview-only metadata:
  - `candidateCount=6`
  - `previewOnly=false`
  - `countSource=generatedVariants`
  - `recommendation=hold`

## Non-Negotiable Fix Criteria

1. Same champion + same already-tested global patch hash must not launch another full sweep.
2. `globalAllParameter` must be deterministic but history-aware: reproducible, not repetitive.
3. If all available global variants are exhausted, the cycle must report explicit exhaustion and skip/hold cleanly.
4. Duplicate prevention must happen before writing variant file / launching sweep.
5. Manifests must expose enough evidence to prove why a duplicate was skipped or why new variants were selected.
6. Existing deterministic tests must remain deterministic; do not replace with uncontrolled randomness.

## Review Corrections — Mandatory Before Implementation

Local review found blockers in the first draft. These corrections supersede any conflicting task text below.

1. **Preflight must run first, not last.** Create the worktree and freeze/inspect scheduled autoresearch before Task 1. Do not implement on `main`. Do not launch Full/Micro cycles during this fix.
2. **History JSONL is not enough.** Current cycle history events do not persist `manifest.searchPlan.variants`, so novelty extraction must read recent completed manifest JSON files from `manifestsDir(config)` and may also read future enriched history events. Do not rely only on `historyEvents[].manifest`.
3. **Champion identity must not be lost.** Current cycle passes `championState.config` into `buildRegimeAwareSearchBatch()`. The fix must pass a source object containing both `configId` and `config` (`{ configId: championState.configId, config: championState.config }`) so patch fingerprints bind to champion identity.
4. **Use existing artifact writers.** `scripts/pine-autoresearch.mjs` imports `writeJson` and finalizes manifests through `finalizeAutoresearchManifest()`. Do not invent `writeJsonAtomic` or `config.manifestDir`; use `writeJson`, `manifestsDir(config)`, and the existing artifact lifecycle.
5. **Do not invent test helpers.** `minimalAutoresearchConfigForTest`, `minimalPrimarySweepForTest`, and `runAutoresearchCycleForTest` do not currently exist. Either create a narrow exported seam deliberately, or use inline config/primarySweep fixtures matching existing `buildScoutOrchestrationState wires variant files...` tests.
6. **Pre-sweep guard needs a pure helper.** Add and test a pure helper such as `shouldSkipGlobalAllParameterSweep({ regimeExitState, searchBatch })` or `buildGlobalExhaustionSkipManifest(...)` before wiring it into the cycle. Do not start by testing the full CLI cycle.
7. **Production invariant must not fail on old artifacts.** Existing historical manifests lack `patchFingerprint`, and some already duplicate variants. Use synthetic fixtures or a clear post-fix cutoff; do not add a permanently failing invariant over old production data.
8. **Scheduler freeze is approval-sensitive.** The plan may inspect scheduler state automatically, but disabling/removing scheduled tasks is external state. Require explicit user approval before `npm run pine:ops:remove-tasks` or equivalent destructive scheduler changes.
9. **No global exhaustion fallback.** If selected lane is `globalAllParameter` and novelty-filtered candidates are empty while tested fingerprints exist, do not fall back to incumbent/track search in that cycle. Finalize an exhausted/hold manifest before writing variants or launching sweep.
10. **Exhaustion evidence must include manifest-derived fingerprints.** `summarizeRegimeLaneGenerator()` and skip guard must receive either `testedPatchFingerprints` or `recentManifestsForNovelty`; history-only evidence is insufficient.
11. **Scheduler state must advance on exhausted skip.** Exhaustion skip must call `nextTrackState()` and `writeSchedulerState()` before return, otherwise the scheduler can select the same exhausted global lane forever.
12. **Post-fix manifests need a version marker.** Add `globalNoveltyGuardVersion: 1` to normal and exhausted manifests that contain the new novelty fields. Production invariant must scope to this marker or use synthetic fixtures only.
13. **Global generator must de-dupe same batch and skip no-op patches.** Clamp boundaries and repeated ladders can produce duplicate fingerprints or patches equal to current champion values; maintain `emittedFingerprints` and skip patches that do not change config.

## File Structure

- Modify: `scripts/lib/pine-global-search.mjs`
  - Add patch fingerprinting and history-aware variant generation.
  - Expand fixed one-step family mutations into deterministic ladders.
  - Filter already-tested fingerprints for the same champion.
- Modify: `scripts/pine-autoresearch.mjs`
  - Pass history/previous manifest data into `buildGlobalMutationBatch()`.
  - Detect empty novelty result and produce explicit no-op/hold/exhausted state before sweep.
  - Add manifest fields for novelty/exhaustion.
- Modify: `tests/pine-global-search.test.mjs`
  - Unit tests for patch fingerprint, novelty filtering, ladder selection, and exhaustion.
- Modify: `tests/pine-autoresearch.test.mjs`
  - Integration tests for `buildRegimeAwareSearchBatch()` and orchestration behavior when duplicate variants are exhausted.
- Optional modify: `docs/pine-autoresearch-ops.md` or existing scheduler/autoresearch runbook if present
  - Document duplicate-sweep guard and exhaustion status.
- Do not intentionally modify: `config/pine-autoresearch.default.json`
  - It already has unrelated local edits (`maxConcurrentLabWorkers` 1→4, `maxRowsPerAnalysisChunk` 5000→10000). Preserve them unless user explicitly asks.

---

## Task 0: Preflight, Worktree, and Scheduler Safety

**Files:**
- No code files changed.

- [ ] **Step 1: Verify current repo state and do not implement on `main`**

Run:

```bash
cd D:/Code/Experiment/backtest-kit-project
git status --short --branch
git branch --show-current
```

Expected:
- Current branch may be `main`, but implementation must move to a worktree branch before code edits.
- Known unrelated diff may exist in `config/pine-autoresearch.default.json`; do not include it in commits.

- [ ] **Step 2: Create isolated implementation worktree**

Run:

```bash
cd D:/Code/Experiment/backtest-kit-project
git worktree add .worktrees/duplicate-sweep-guard -b fix/duplicate-sweep-guard
cd .worktrees/duplicate-sweep-guard
```

Expected: new branch `fix/duplicate-sweep-guard` checked out in `.worktrees/duplicate-sweep-guard`.

- [ ] **Step 3: Inspect scheduler state without changing it**

Run:

```bash
npm run pine:ops:scheduler-health
```

Expected: reports healthy/no active stale lock. If unhealthy, stop and report. Do not reclaim/remove/disable scheduled tasks without explicit user approval.

- [ ] **Step 4: Confirm no autoresearch cycle is running**

Run a process inspection command suitable for Windows PowerShell:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pine-autoresearch' } | Select-Object ProcessId,CommandLine
```

Expected: no active `pine-autoresearch cycle` process. If active, stop and ask for approval before killing or disabling scheduler tasks.

- [ ] **Step 5: Commit plan file if requested before implementation**

Only if user wants the plan committed separately:

```bash
git add docs/superpowers/plans/2026-05-08-pine-autoresearch-duplicate-sweep-guard.md
git commit -m "docs(pine): plan duplicate sweep guard"
```

## Task 1: Add Global Patch Fingerprints

**Files:**
- Modify: `scripts/lib/pine-global-search.mjs`
- Test: `tests/pine-global-search.test.mjs`

- [ ] **Step 1: Add failing tests for stable patch fingerprinting**

Append to `tests/pine-global-search.test.mjs`:

```js
test('buildGlobalMutationBatch exposes stable patchFingerprint independent of object key order', () => {
  const [first] = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-1',
      config: {
        minPredSum: 1.8,
        adxThreshold: 20,
        slAtrMult: 0.5,
        trailAtrMult: 1,
        fusionV4LongAtrWeight: -0.25,
        fusionV4LongEmaWeight: 0,
        fusionV4ShortEmaWeight: 0,
      },
    },
    maxConfigs: 1,
    families: ['entry'],
  });

  const [second] = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-1',
      config: {
        trailAtrMult: 1,
        slAtrMult: 0.5,
        adxThreshold: 20,
        minPredSum: 1.8,
        fusionV4ShortEmaWeight: 0,
        fusionV4LongEmaWeight: 0,
        fusionV4LongAtrWeight: -0.25,
      },
    },
    maxConfigs: 1,
    families: ['entry'],
  });

  assert.equal(typeof first.patchFingerprint, 'string');
  assert.equal(first.patchFingerprint.length, 64);
  assert.equal(first.patchFingerprint, second.patchFingerprint);
  assert.equal(first.metadata.patchFingerprint, first.patchFingerprint);
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node --test tests/pine-global-search.test.mjs --test-name-pattern "patchFingerprint"
```

Expected: FAIL because `patchFingerprint` is not implemented.

- [ ] **Step 3: Implement stable stringify + fingerprint**

In `scripts/lib/pine-global-search.mjs`, add below imports/constants:

```js
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildGlobalPatchFingerprint({ championId = null, lane, mutationFamily, patch } = {}) {
  return createHash('sha256')
    .update(stableJson({ championId: championId ?? null, lane, mutationFamily, patch: patch || {} }))
    .digest('hex');
}
```

Then in `buildGlobalMutationBatch()`, after `normalizedPatch` is created and before `out.push()`, add:

```js
const patchFingerprint = buildGlobalPatchFingerprint({
  championId: originConfigId,
  lane,
  mutationFamily: family,
  patch: normalizedPatch,
});
```

Add these fields to the pushed object:

```js
patchFingerprint,
metadata: {
  generatorVersion: GENERATOR_VERSION,
  originConfigId,
  mutationFamily: family,
  patchFingerprint,
},
```

If `metadata` already exists, merge rather than replace:

```js
metadata: {
  generatorVersion: GENERATOR_VERSION,
  originConfigId,
  mutationFamily: family,
  patchFingerprint,
},
```

- [ ] **Step 4: Run test and verify it passes**

Run:

```bash
node --test tests/pine-global-search.test.mjs --test-name-pattern "patchFingerprint"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-global-search.mjs tests/pine-global-search.test.mjs
git commit -m "test(pine): fingerprint global search patches"
```

---

## Task 2: Add Deterministic Patch Ladders Per Global Family

**Files:**
- Modify: `scripts/lib/pine-global-search.mjs`
- Test: `tests/pine-global-search.test.mjs`

- [ ] **Step 1: Add failing test for multiple variants per family**

Append to `tests/pine-global-search.test.mjs`:

```js
test('buildGlobalMutationBatch can emit deterministic ladder variants for one family', () => {
  const batch = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-ladder',
      config: {
        minPredSum: 1.8,
        adxThreshold: 20,
        slAtrMult: 0.5,
        trailAtrMult: 1,
        fusionV4LongAtrWeight: -0.25,
        fusionV4LongEmaWeight: 0,
        fusionV4ShortEmaWeight: 0,
      },
    },
    maxConfigs: 3,
    families: ['entry'],
    variantsPerFamily: 3,
  });

  assert.equal(batch.length, 3);
  assert.deepEqual(batch.map((item) => item.patch), [
    { minPredSum: 2 },
    { minPredSum: 1.6 },
    { minPredSum: 2.2 },
  ]);
  assert.deepEqual(batch.map((item) => item.variantId), [
    'global-all-parameter-entry-p01',
    'global-all-parameter-entry-p02',
    'global-all-parameter-entry-p03',
  ]);
  assert.equal(new Set(batch.map((item) => item.patchFingerprint)).size, 3);
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test tests/pine-global-search.test.mjs --test-name-pattern "ladder variants"
```

Expected: FAIL because `variantsPerFamily` and ladder patches do not exist.

- [ ] **Step 3: Replace single-patch family builder with ladder builder**

In `scripts/lib/pine-global-search.mjs`, keep existing one-step behavior as level 1, but add level-aware patch generation.

Add helper:

```js
function signedStep(level, baseStep) {
  const magnitude = Math.ceil(level / 2) * baseStep;
  return level % 2 === 1 ? magnitude : -magnitude;
}
```

Replace or wrap `buildFamilyPatch({ family, config })` with:

```js
function buildFamilyPatch({ family, config, level = 1 }) {
  const c = config || {};

  if (family === 'entry') {
    const minPredSum = clamp(numberOr(c.minPredSum, 2) + signedStep(level, 0.2), 0.1, 10);
    return { minPredSum };
  }

  if (family === 'filters') {
    const adxThreshold = clamp(numberOr(c.adxThreshold, 20) + signedStep(level, 2), 1, 100);
    return { adxThreshold };
  }

  if (family === 'risk') {
    const slAtrMult = clamp(numberOr(c.slAtrMult, 1) + signedStep(level, 0.1), 0.1, 20);
    return { slAtrMult };
  }

  if (family === 'fusion-weight') {
    const fusionV4LongAtrWeight = clamp(numberOr(c.fusionV4LongAtrWeight, -0.25) + signedStep(level, 0.1), -5, 5);
    return { fusionV4LongAtrWeight };
  }

  if (family === 'asymmetry') {
    const delta = signedStep(level, 0.1);
    const fusionV4LongEmaWeight = clamp(numberOr(c.fusionV4LongEmaWeight, 0) + delta, -5, 5);
    const fusionV4ShortEmaWeight = clamp(numberOr(c.fusionV4ShortEmaWeight, 0) - delta, -5, 5);
    return { fusionV4LongEmaWeight, fusionV4ShortEmaWeight };
  }

  if (family === 'exit-state') {
    const trailAtrMult = clamp(numberOr(c.trailAtrMult, 1) + signedStep(level, 0.1), 0.1, 20);
    return { trailAtrMult };
  }

  return null;
}
```

In `buildGlobalMutationBatch()`, add parameter `variantsPerFamily = 1`:

```js
export function buildGlobalMutationBatch({ incumbent, champion, maxConfigs, frozenKeys, families, variantsPerFamily = 1 } = {}) {
```

Then nested-loop families and levels:

```js
const safeVariantsPerFamily = Math.max(1, Math.floor(Number(variantsPerFamily) || 1));
for (const family of selectedFamilies) {
  for (let level = 1; level <= safeVariantsPerFamily; level += 1) {
    const patch = buildFamilyPatch({ family, config, level });
    // existing validation + push logic
    out.push({
      candidateId: buildCandidateId({ lane, mutationFamily: family, patch: normalizedPatch }),
      variantId: `${lane}-${family}-p${String(level).padStart(2, '0')}`,
      lane,
      mutationFamily: family,
      family,
      axis: family,
      patch: normalizedPatch,
      config: { ...config, ...normalizedPatch },
      touchedKeys: Object.keys(normalizedPatch),
      patchFingerprint,
      metadata: {
        generatorVersion: GENERATOR_VERSION,
        originConfigId,
        mutationFamily: family,
        patchFingerprint,
        ladderLevel: level,
      },
    });
  }
}
```

Important compatibility rule: if `variantsPerFamily` is omitted, keep `variantId` names compatible with current IDs if tests require them. If existing tests assert `global-all-parameter-entry`, either update tests deliberately or emit legacy IDs at level 1:

```js
const variantId = safeVariantsPerFamily === 1
  ? `${lane}-${family}`
  : `${lane}-${family}-p${String(level).padStart(2, '0')}`;
```

- [ ] **Step 4: Run focused tests**

```bash
node --test tests/pine-global-search.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-global-search.mjs tests/pine-global-search.test.mjs
git commit -m "feat(pine): add global search patch ladders"
```

---

## Task 3: Filter Previously Tested Global Patch Fingerprints

**Files:**
- Modify: `scripts/lib/pine-global-search.mjs`
- Test: `tests/pine-global-search.test.mjs`

- [ ] **Step 1: Add failing novelty filter test**

Append to `tests/pine-global-search.test.mjs`:

```js
test('buildGlobalMutationBatch skips previously tested patch fingerprints', () => {
  const champion = {
    configId: 'champ-novelty',
    config: {
      minPredSum: 1.8,
      adxThreshold: 20,
      slAtrMult: 0.5,
      trailAtrMult: 1,
      fusionV4LongAtrWeight: -0.25,
      fusionV4LongEmaWeight: 0,
      fusionV4ShortEmaWeight: 0,
    },
  };

  const first = buildGlobalMutationBatch({
    champion,
    maxConfigs: 1,
    families: ['entry'],
    variantsPerFamily: 3,
  });

  const second = buildGlobalMutationBatch({
    champion,
    maxConfigs: 2,
    families: ['entry'],
    variantsPerFamily: 3,
    testedPatchFingerprints: new Set([first[0].patchFingerprint]),
  });

  assert.equal(second.length, 2);
  assert.deepEqual(second.map((item) => item.variantId), [
    'global-all-parameter-entry-p02',
    'global-all-parameter-entry-p03',
  ]);
  assert.equal(second.some((item) => item.patchFingerprint === first[0].patchFingerprint), false);
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test tests/pine-global-search.test.mjs --test-name-pattern "previously tested"
```

Expected: FAIL because `testedPatchFingerprints` is ignored.

- [ ] **Step 3: Implement novelty filtering**

In `buildGlobalMutationBatch()` signature add:

```js
testedPatchFingerprints,
```

Normalize it near the top:

```js
const testedFingerprints = new Set(
  Array.isArray(testedPatchFingerprints)
    ? testedPatchFingerprints
    : testedPatchFingerprints instanceof Set
      ? [...testedPatchFingerprints]
      : []
);
```

After `patchFingerprint` is computed, skip already-tested fingerprints, same-batch duplicates, and no-op patches:

```js
const emittedFingerprints = new Set();

// inside level loop after patchFingerprint:
if (testedFingerprints.has(patchFingerprint)) continue;
if (emittedFingerprints.has(patchFingerprint)) continue;
if (Object.entries(normalizedPatch).every(([key, value]) => Object.is(config?.[key], value))) continue;
emittedFingerprints.add(patchFingerprint);
```

Add a focused test:

```js
test('buildGlobalMutationBatch de-dupes same-batch patches and skips no-op patches', () => {
  const batch = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-boundary',
      config: {
        minPredSum: 10,
        adxThreshold: 100,
        slAtrMult: 20,
        trailAtrMult: 20,
        fusionV4LongAtrWeight: 5,
        fusionV4LongEmaWeight: 5,
        fusionV4ShortEmaWeight: -5,
      },
    },
    maxConfigs: 20,
    families: ['entry', 'filters', 'risk', 'exit-state', 'asymmetry'],
    variantsPerFamily: 3,
  });

  assert.equal(new Set(batch.map((item) => item.patchFingerprint)).size, batch.length);
  assert.equal(batch.some((item) => Object.entries(item.patch).every(([key, value]) => Object.is(item.config[key], value))), false);
});
```

Return `out.slice(0, limit)` as before.

- [ ] **Step 4: Run tests**

```bash
node --test tests/pine-global-search.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-global-search.mjs tests/pine-global-search.test.mjs
git commit -m "feat(pine): skip tested global search patches"
```

---

## Task 4: Extract Tested Patch Fingerprints From Previous Manifests and History

**Correction:** current `history.jsonl` cycle entries do not include full manifests or `searchPlan.variants`. Implement extraction from completed manifest JSON files first, then support future history events as an additional source.

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing unit test for history extraction**

Add exported helper tests in `tests/pine-autoresearch.test.mjs` near other helper tests:

```js
test('collectTestedGlobalPatchFingerprints reads manifest searchPlan variants for same champion only', () => {
  const currentChampion = { configId: 'champ-current' };
  const historyEvents = [
    {
      type: 'cycle-complete',
      manifest: {
        champion: { configId: 'champ-current' },
        searchPlan: {
          variants: [
            {
              lane: 'globalAllParameter',
              patchFingerprint: 'fp-current-a',
              metadata: { patchFingerprint: 'fp-current-meta' },
            },
          ],
        },
      },
    },
    {
      type: 'cycle-complete',
      manifest: {
        champion: { configId: 'other-champ' },
        searchPlan: {
          variants: [
            { lane: 'globalAllParameter', patchFingerprint: 'fp-other' },
          ],
        },
      },
    },
  ];

  const fingerprints = collectTestedGlobalPatchFingerprints({
    champion: currentChampion,
    manifests: historyEvents.map((event) => event.manifest),
  });

  assert.deepEqual([...fingerprints].sort(), ['fp-current-a', 'fp-current-meta']);
});
```

Also update import list at top:

```js
collectTestedGlobalPatchFingerprints,
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "collectTestedGlobalPatchFingerprints"
```

Expected: FAIL because helper is not exported.

- [ ] **Step 3: Implement helper in `scripts/pine-autoresearch.mjs`**

Add near other exported helper functions:

```js
function configIdentity(value) {
  return value?.configId ?? value?.id ?? value?.name ?? value?.config?.configId ?? null;
}

function sameChampionIdentity(a, b) {
  const left = configIdentity(a);
  const right = configIdentity(b);
  return left !== null && right !== null && left === right;
}

export async function loadRecentCompletedManifestsForNovelty({ config, limit = 24 } = {}) {
  const dir = manifestsDir(config);
  const names = await fs.readdir(dir).catch(() => []);
  const jsonNames = names.filter((name) => name.endsWith('.json')).sort().slice(-Math.max(1, limit));
  const manifests = [];
  for (const name of jsonNames) {
    try {
      manifests.push(await readJson(path.join(dir, name)));
    } catch {
      // Ignore malformed historical artifact; production invariant covers latest pointer separately.
    }
  }
  return manifests;
}

export function collectTestedGlobalPatchFingerprints({ champion, historyEvents = [], manifests = [] } = {}) {
  const fingerprints = new Set();
  const sources = [
    ...manifests,
    ...historyEvents.map((event) => event?.manifest).filter(Boolean),
  ];

  for (const manifest of sources) {
    if (!sameChampionIdentity(champion, manifest?.champion ?? manifest?.incumbent)) continue;
    const variants = Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [];
    for (const variant of variants) {
      const lane = variant?.lane;
      if (lane !== 'globalAllParameter' && lane !== 'global-all-parameter') continue;
      const direct = variant?.patchFingerprint;
      const metadata = variant?.metadata?.patchFingerprint;
      if (typeof direct === 'string' && direct.length > 0) fingerprints.add(direct);
      if (typeof metadata === 'string' && metadata.length > 0) fingerprints.add(metadata);
    }
  }

  return fingerprints;
}
```

- [ ] **Step 4: Run focused test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "collectTestedGlobalPatchFingerprints"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): collect tested global patch fingerprints"
```

---

## Task 5: Wire Novelty Filter Into Regime-Aware Batch Generation

**Correction:** the cycle must pass a champion source with `configId` and `config`, not only `championState.config`, otherwise fingerprints cannot bind to champion identity.

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing integration test for consecutive same-champion novelty**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('buildRegimeAwareSearchBatch skips duplicate globalAllParameter variants from history', () => {
  const champion = {
    configId: 'champ-repeat',
    config: {
      minPredSum: 1.8,
      adxThreshold: 20,
      slAtrMult: 0.5,
      trailAtrMult: 1,
      fusionV4LongAtrWeight: -0.25,
      fusionV4LongEmaWeight: 0,
      fusionV4ShortEmaWeight: 0,
    },
  };

  const first = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 2,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 3 },
  });

  const historyEvents = [
    {
      type: 'cycle-complete',
      manifest: {
        champion: { configId: 'champ-repeat' },
        searchPlan: {
          variants: first.map((variant) => ({
            lane: variant.lane,
            patchFingerprint: variant.patchFingerprint,
            metadata: variant.metadata,
          })),
        },
      },
    },
  ];

  const second = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 2,
    historyEvents,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 3 },
  });

  assert.equal(second.length, 2);
  assert.equal(second.some((variant) => first.some((old) => old.patchFingerprint === variant.patchFingerprint)), false);
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "skips duplicate globalAllParameter"
```

Expected: FAIL because `buildRegimeAwareSearchBatch()` does not pass tested fingerprints to `buildGlobalMutationBatch()`.

- [ ] **Step 3: Wire helper into `buildRegimeAwareSearchBatch()`**

In `scripts/pine-autoresearch.mjs`, inside the `selectedLane === 'globalAllParameter'` branch, change call to:

```js
const testedPatchFingerprints = collectTestedGlobalPatchFingerprints({
  champion,
  historyEvents,
  manifests: policy?.recentManifestsForNovelty || [],
});
const candidates = buildGlobalMutationBatch({
  champion,
  maxConfigs: safeMaxConfigs,
  historyEvents,
  schedulerState,
  policy,
  testedPatchFingerprints,
  variantsPerFamily: policy?.globalAllParameterVariantsPerFamily ?? schedulerState?.globalAllParameterVariantsPerFamily ?? 4,
});
```

In the main cycle, load manifests before `buildRegimeAwareSearchBatch()` and pass them through policy:

```js
const recentManifestsForNovelty = await loadRecentCompletedManifestsForNovelty({
  config: trackedConfig,
  limit: trackedConfig.rotationPolicy?.tabuBootstrapManifestLimit ?? 24,
});

const championSource = { configId: championState.configId, config: championState.config };
const regimeAwareSearchBatch = buildRegimeAwareSearchBatch({
  selectedLane: selectedRegimeLane,
  champion: championSource,
  maxConfigs: trackedConfig.maxConfigs,
  historyEvents: historyEventsBefore,
  policy: { ...trackedConfig.searchPolicy, recentManifestsForNovelty },
  schedulerState,
  regimeExitResearch: trackedConfig.regimeExitResearch,
});
```

Immediately after building `candidates`, return them as-is for `globalAllParameter`, including an empty array. Do not fall back to incumbent search from inside `buildRegimeAwareSearchBatch()` for this selected lane:

```js
if (selectedLane === 'globalAllParameter') {
  return candidates.map((candidate) => ({
    ...candidate,
    lane: 'globalAllParameter',
    patchFingerprint: candidate.patchFingerprint ?? candidate.metadata?.patchFingerprint ?? null,
  }));
}
```

In the main cycle, empty global-lane result must be preserved until the exhaustion guard runs. Do not replace it with `fallbackSearchBatch` before guard evaluation.

- [ ] **Step 4: Run focused tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "skips duplicate globalAllParameter|collectTestedGlobalPatchFingerprints"
```

Expected: PASS.

Add an assertion to this test or a sibling test that when all tested fingerprints are provided for selected `globalAllParameter`, `buildRegimeAwareSearchBatch()` returns `[]` and does not return incumbent/track fallback variants.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): avoid repeated global search variants"
```

---

## Task 6: Add Explicit Exhaustion State Before Sweep Launch

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing test for exhausted global lane summary**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('buildRegimeExitStateForScout reports exhausted globalAllParameter lane when no novel variants remain', () => {
  const champion = {
    configId: 'champ-exhausted',
    config: {
      minPredSum: 1.8,
      adxThreshold: 20,
      slAtrMult: 0.5,
      trailAtrMult: 1,
      fusionV4LongAtrWeight: -0.25,
      fusionV4LongEmaWeight: 0,
      fusionV4ShortEmaWeight: 0,
    },
  };

  const allVariants = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 6,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });

  const historyEvents = [
    {
      type: 'cycle-complete',
      manifest: {
        champion: { configId: 'champ-exhausted' },
        searchPlan: {
          variants: allVariants.map((variant) => ({
            lane: variant.lane,
            patchFingerprint: variant.patchFingerprint,
            metadata: variant.metadata,
          })),
        },
      },
    },
  ];

  const searchBatch = buildRegimeAwareSearchBatch({
    selectedLane: 'globalAllParameter',
    champion,
    maxConfigs: 6,
    historyEvents,
    regimeExitResearch: { enabled: true },
    policy: { globalAllParameterVariantsPerFamily: 1 },
  });

  const state = buildRegimeExitStateForScout({
    config: {
      maxConfigs: 6,
      regimeExitResearch: {
        enabled: true,
        globalAllParameterEnabled: true,
        exitRegimeEnabled: false,
        robustnessEnabled: false,
      },
    },
    championState: champion,
    historyEventsBefore: historyEvents,
    searchBatch,
    schedulerState: {
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 0 },
    },
  });

  assert.equal(searchBatch.length, 0);
  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'globalAllParameter');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.candidateCount, 0);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.previewOnly, false);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.countSource, 'exhausted');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.exhausted, true);
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "exhausted globalAllParameter"
```

Expected: FAIL because countSource remains `none`/preview behavior does not distinguish exhaustion.

- [ ] **Step 3: Implement exhaustion summary**

Modify `summarizeRegimeLaneGenerator()` in `scripts/pine-autoresearch.mjs` to accept `historyEvents`, `championState`, and manifest-derived `testedPatchFingerprints`. Detect exhausted global lane from precomputed novelty evidence, not history alone:

```js
function summarizeRegimeLaneGenerator({
  selectedLane,
  searchBatch = [],
  championState = null,
  historyEvents = [],
  testedPatchFingerprints = null,
  recentManifestsForNovelty = [],
  maxNovelCandidates = null,
} = {}) {
  const generatedForLane = Array.isArray(searchBatch)
    ? searchBatch.filter((variant) => variant?.lane === selectedLane)
    : [];
  const knownFingerprints = testedPatchFingerprints instanceof Set
    ? testedPatchFingerprints
    : collectTestedGlobalPatchFingerprints({
        champion: championState,
        historyEvents,
        manifests: recentManifestsForNovelty,
      });
  const exhausted = selectedLane === 'globalAllParameter'
    && generatedForLane.length === 0
    && knownFingerprints.size > 0;

  return {
    lane: selectedLane || null,
    laneKind: selectedLane || null,
    candidateCount: generatedForLane.length,
    previewOnly: false,
    countSource: exhausted ? 'exhausted' : (generatedForLane.length > 0 ? 'generatedVariants' : 'none'),
    blockedFamilyCount: null,
    exhausted,
    testedPatchFingerprintCount: knownFingerprints.size,
    maxNovelCandidates,
    variantIds: generatedForLane.map((variant) => variant.variantId).filter(Boolean).slice(0, 20),
    patchFingerprints: generatedForLane.map((variant) => variant.patchFingerprint).filter(Boolean).slice(0, 20),
  };
}
```

Update call site in `buildRegimeExitStateForScout()` to pass `championState` and `historyEventsBefore`:

```js
generatorSummary: summarizeRegimeLaneGenerator({
  selectedLane,
  searchBatch,
  championState,
  historyEvents: historyEventsBefore,
  recentManifestsForNovelty: regimeExitContext?.recentManifestsForNovelty || [],
  testedPatchFingerprints: regimeExitContext?.testedPatchFingerprints || null,
}),
```

- [ ] **Step 4: Run focused tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "exhausted globalAllParameter|skips duplicate globalAllParameter|reports real candidate counts"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): report global search exhaustion"
```

---

## Task 7: Prevent Variant File/Sweep Launch When No Novel Variants Exist

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

**Correction:** there is no current `runAutoresearchCycleForTest()` seam and no `writeJsonAtomic()`. First add pure guard/manifest helpers, then wire them into the existing cycle at the actual boundary: before `await writeJson(variantFilePath, searchVariants);` and before `await runPrimarySweep(...)`.

- [ ] **Step 1: Locate cycle function boundary**

Find the function that executes a cycle and calls primary sweep after `buildRegimeAwareSearchBatch()`. Use:

```bash
rg -n "runPrimarySweep|buildRegimeAwareSearchBatch|variantFilePath|writeFile.*variants|searchBatch.length" scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
```

Expected: exact cycle branch found before editing.

- [ ] **Step 2: Add failing test for no duplicate sweep launch**

If the cycle runner is testable with injected sweep runner, add a test in `tests/pine-autoresearch.test.mjs`:

```js
test('autoresearch cycle skips primary sweep when globalAllParameter has no novel variants', async () => {
  const sweepCalls = [];
  const result = await runAutoresearchCycleForTest({
    configOverrides: {
      maxConfigs: 6,
      regimeExitResearch: {
        enabled: true,
        globalAllParameterEnabled: true,
        exitRegimeEnabled: false,
        robustnessEnabled: false,
      },
    },
    championState: {
      configId: 'champ-skip-sweep',
      config: {
        minPredSum: 1.8,
        adxThreshold: 20,
        slAtrMult: 0.5,
        trailAtrMult: 1,
        fusionV4LongAtrWeight: -0.25,
        fusionV4LongEmaWeight: 0,
        fusionV4ShortEmaWeight: 0,
      },
    },
    schedulerState: { stagnationLevel: 1, budgetDebt: { globalAllParameter: 0 } },
    historyEventsBefore: [
      {
        type: 'cycle-complete',
        manifest: {
          champion: { configId: 'champ-skip-sweep' },
          searchPlan: {
            variants: precomputedExhaustedVariants.map((variant) => ({
              lane: variant.lane,
              patchFingerprint: variant.patchFingerprint,
              metadata: variant.metadata,
            })),
          },
        },
      },
    ],
    runPrimarySweep: async (...args) => {
      sweepCalls.push(args);
      throw new Error('primary sweep must not run when no novel variants exist');
    },
  });

  assert.equal(sweepCalls.length, 0);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'global-all-parameter-exhausted');
});
```

Before constructing `historyEventsBefore`, compute `precomputedExhaustedVariants` in the test with the same champion/config and `buildRegimeAwareSearchBatch()`, using `maxConfigs: 6` and `policy: { globalAllParameterVariantsPerFamily: 1 }` so every current level-1 global family fingerprint is known.

If no such test harness exists, do not invent a fake full-cycle implementation. Instead add and test pure exported helpers first:

```js
export function shouldSkipGlobalAllParameterSweep({ regimeExitState, searchBatch = [] } = {}) {
  const generatorSummary = regimeExitState?.shadowRegimeScoreboard?.generatorSummary;
  return regimeExitState?.enabled === true
    && regimeExitState?.shadowRegimeScoreboard?.selectedLane === 'globalAllParameter'
    && generatorSummary?.exhausted === true
    && searchBatch.length === 0;
}

export function buildGlobalAllParameterExhaustedManifest({ config, runId, championState, regimeExitState, schedulerState } = {}) {
  return {
    generatedAt: isoNow(),
    matrixId: config.matrixId,
    runId,
    profile: config.selectedProfile,
    champion: summarizeResult(championState),
    incumbent: summarizeResult(championState),
    challenger: summarizeResult(championState),
    primarySweep: null,
    searchPlan: {
      mode: config.searchPolicy?.mode ?? null,
      exploitRatio: config.searchPolicy?.exploitRatio ?? null,
      variantCount: 0,
      variants: [],
    },
    matrixDecision: {
      recommendation: 'hold',
      reason: 'global-all-parameter-exhausted',
      summary: 'Hold: globalAllParameter novel patch space exhausted for current champion.',
    },
    noNewCandidate: true,
    noNewCandidateStreak: (schedulerState?.noNewCandidateStreak ?? 0) + 1,
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    globalNoveltyGuardVersion: 1,
    stagnationReason: 'globalAllParameterExhausted',
    ...(regimeExitState?.enabled ? {
      resourceBudget: regimeExitState.resourceBudget ?? null,
      resourceUsageSummary: regimeExitState.resourceUsageSummary ?? null,
      checkpointState: regimeExitState.checkpointState ?? null,
      objectiveBreakdown: regimeExitState.objectiveBreakdown ?? null,
      multipleTestingPenalty: regimeExitState.multipleTestingPenalty ?? null,
      holdoutVerdict: regimeExitState.holdoutVerdict ?? null,
      offlineDataSummary: regimeExitState.offlineDataSummary ?? null,
      shadowRegimeScoreboard: regimeExitState.shadowRegimeScoreboard ?? null,
    } : {}),
  };
}
```

Then wire these helpers into the existing cycle.

- [ ] **Step 3: Run test and verify it fails**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "skips primary sweep"
```

Expected: FAIL because existing cycle still launches or no test seam exists.

- [ ] **Step 4: Implement pre-sweep guard**

In the cycle branch, build `regimeExitState` before writing the variant file. Insert the guard before:

```js
await writeJson(variantFilePath, searchVariants);
const primarySweep = await runPrimarySweep(trackedConfig, runId, { sweepOffset, totalCombos, variantFilePath });
```

Use existing artifact lifecycle, not `writeJsonAtomic`:

```js
const globalLaneExhaustedBeforeFallback = selectedRegimeLane === 'globalAllParameter'
  && regimeAwareSearchBatch.length === 0
  && collectTestedGlobalPatchFingerprints({
    champion: championSource,
    historyEvents: historyEventsBefore,
    manifests: recentManifestsForNovelty,
  }).size > 0;

const searchVariants = globalLaneExhaustedBeforeFallback
  ? []
  : generatedRegimeLane
    ? regimeAwareSearchBatch
    : fallbackSearchBatch.length > 0
      ? fallbackSearchBatch
      : regimeAwareSearchBatch;

const regimeExitStateBeforeSweep = buildRegimeExitStateForScout({
  config: trackedConfig,
  championState,
  historyEventsBefore,
  searchBatch: searchVariants,
  offlineDataSummary,
  schedulerState,
  regimeExitContext: {
    recentManifestsForNovelty,
    testedPatchFingerprints: collectTestedGlobalPatchFingerprints({
      champion: championSource,
      historyEvents: historyEventsBefore,
      manifests: recentManifestsForNovelty,
    }),
  },
});

if (shouldSkipGlobalAllParameterSweep({ regimeExitState: regimeExitStateBeforeSweep, searchBatch: searchVariants })) {
  const exhaustedManifest = buildGlobalAllParameterExhaustedManifest({
    config: trackedConfig,
    runId,
    championState,
    regimeExitState: regimeExitStateBeforeSweep,
    schedulerState,
  });
  const updatedSchedulerState = nextTrackState({
    state: schedulerState,
    policy: rotationPolicy,
    manifest: {
      activeTrackId,
      candidateFingerprint: configFingerprint(championState.config),
      championFingerprint: configFingerprint(championState.config),
      noNewCandidate: true,
      noNewCandidateStreak: exhaustedManifest.noNewCandidateStreak,
      stagnationLevel: exhaustedManifest.stagnationLevel,
      stagnationReason: exhaustedManifest.stagnationReason,
      generatedAt: exhaustedManifest.generatedAt,
      windowSetId,
      labSetId,
      gridName,
    },
  });
  await writeSchedulerState(schedulerStatePath, updatedSchedulerState);
  const finalExhaustedManifest = applySchedulerStateToManifest(exhaustedManifest, updatedSchedulerState);
  const finalizedArtifact = await finalizeAutoresearchManifest({
    root: trackedConfig.researchRoot,
    manifest: finalExhaustedManifest,
  });
  await appendJsonl(historyPath(trackedConfig), {
    timestamp: exhaustedManifest.generatedAt,
    type: 'cycle',
    runId,
    championConfigId: exhaustedManifest.champion?.configId,
    challengerConfigId: exhaustedManifest.challenger?.configId,
    recommendation: exhaustedManifest.matrixDecision.recommendation,
    summary: exhaustedManifest.matrixDecision.summary,
    noNewCandidate: true,
    noNewCandidateStreak: exhaustedManifest.noNewCandidateStreak,
    stagnationLevel: exhaustedManifest.stagnationLevel,
    stagnationReason: exhaustedManifest.stagnationReason,
  });
  await writeText(path.join(trackedConfig.digestRoot, `${runId}.md`), renderScoutMarkdown({ config: trackedConfig, manifest: finalExhaustedManifest }));
  return { skipped: true, reason: 'global-all-parameter-exhausted', manifest: finalExhaustedManifest, manifestPath: finalizedArtifact.manifestPath };
}
```

After adding this, reuse `regimeExitStateBeforeSweep` later instead of rebuilding `regimeExitState` if possible.

- [ ] **Step 5: Run focused test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "skips primary sweep"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): skip exhausted duplicate global sweeps"
```

---

## Task 8: Manifest Evidence and Report Visibility

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing manifest test for novelty fields**

Append to `tests/pine-autoresearch.test.mjs` near `buildScoutOrchestrationState` tests:

```js
test('buildScoutOrchestrationState persists global patch fingerprints in searchPlan variants', () => {
  const state = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
    },
    runId: 'run-fingerprint-manifest',
    championState: {
      configId: 'champ-manifest',
      score: 70,
      config: { minPredSum: 1.8 },
    },
    historyEventsBefore: [],
    searchBatch: [
      {
        variantId: 'global-all-parameter-entry-p01',
        lane: 'globalAllParameter',
        family: 'entry',
        patch: { minPredSum: 2 },
        patchFingerprint: 'fp-manifest',
        metadata: { patchFingerprint: 'fp-manifest', ladderLevel: 1 },
        config: { minPredSum: 2 },
      },
    ],
    primarySweep: {
      topConfigs: [
        { configId: 'champ-manifest', score: 70, config: { minPredSum: 1.8 } },
        { configId: 'candidate', score: 71, config: { minPredSum: 2 } },
      ],
    },
    matrixCandidates: [],
  });

  assert.equal(state.manifest.searchPlan.variants[0].patchFingerprint, 'fp-manifest');
  assert.deepEqual(state.manifest.searchPlan.variants[0].patch, { minPredSum: 2 });
  assert.equal(state.manifest.searchPlan.variants[0].metadata.patchFingerprint, 'fp-manifest');
});
```

Use inline fixture style above; `minimalAutoresearchConfigForTest()` and `minimalPrimarySweepForTest()` do not currently exist.

- [ ] **Step 2: Run test and verify it fails**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "persists global patch fingerprints"
```

Expected: FAIL if manifest strips patch fields.

- [ ] **Step 3: Persist patch metadata in manifest search plan**

In `buildScoutOrchestrationState()`, change search plan variant mapping from:

```js
variants: searchBatch.map(({ variantId, lane, family, config: variantConfig }) => ({ variantId, lane, family, config: variantConfig })),
```

to:

```js
globalNoveltyGuardVersion: 1,
variants: searchBatch.map(({ variantId, lane, family, config: variantConfig, patch, patchFingerprint, metadata }) => ({
  variantId,
  lane,
  family,
  patch: patch ?? null,
  patchFingerprint: patchFingerprint ?? metadata?.patchFingerprint ?? null,
  metadata: metadata ?? null,
  config: variantConfig,
})),
```

- [ ] **Step 4: Run focused test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "persists global patch fingerprints"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): persist global novelty metadata"
```

---

## Task 9: Production Invariant Against Duplicate Variant Files

**Files:**
- Modify: `tests/pine-autoresearch-production-invariants.test.mjs`
- Possibly modify: `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Add invariant test**

Append to `tests/pine-autoresearch-production-invariants.test.mjs`:

```js
test('recent completed autoresearch manifests do not repeat identical globalAllParameter patch fingerprints for same champion', async () => {
  const researchRoot = path.join(projectRoot, 'pine', 'autoresearch', 'pine-fusion-v4-core-15m-locked-window');
  const manifestDir = path.join(researchRoot, 'manifests');
  const files = (await fs.readdir(manifestDir))
    .filter((file) => file.endsWith('.json'))
    .sort()
    .slice(-20);

  const seen = new Map();
  const duplicates = [];
  for (const file of files) {
    const manifest = JSON.parse(await fs.readFile(path.join(manifestDir, file), 'utf8'));
    const championId = manifest?.champion?.configId ?? manifest?.incumbent?.configId ?? null;
    const variants = Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [];
    for (const variant of variants) {
      if (variant?.lane !== 'globalAllParameter') continue;
      const fp = variant?.patchFingerprint ?? variant?.metadata?.patchFingerprint ?? null;
      if (!championId || !fp) continue;
      const key = `${championId}:${fp}`;
      if (seen.has(key)) duplicates.push({ first: seen.get(key), second: file, championId, fp });
      else seen.set(key, file);
    }
  }

  assert.deepEqual(duplicates, []);
});
```

Current historical manifests already contain duplicates and older manifests do not have `patchFingerprint`; therefore require either a synthetic fixture test in a temporary directory or scope production artifact checks to `manifest.globalNoveltyGuardVersion >= 1`. Do not create a permanently failing test against old data.

- [ ] **Step 2: Run invariant test**

```bash
node --test tests/pine-autoresearch-production-invariants.test.mjs --test-name-pattern "do not repeat identical globalAllParameter"
```

Expected after implementation: PASS for generated fixtures or new manifests. If existing historical duplicates make it fail, adjust scope to ignore manifests before this fix commit via a clear cutoff field, not by hiding the invariant.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-autoresearch-production-invariants.test.mjs
git commit -m "test(pine): guard against duplicate global search manifests"
```

---

## Task 10: Full Verification Gate

**Files:**
- No code changes expected unless failures reveal missed implementation.

- [ ] **Step 1: Run focused unit tests**

```bash
node --test tests/pine-global-search.test.mjs tests/pine-regime-exit-scheduler.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run autoresearch hardening suite**

```bash
npm run test:pine:autoresearch:hardening
```

Expected: PASS. Previous reference after scheduler hardening was `155/155`; new count should be higher and all pass.

- [ ] **Step 3: Run dataset verification**

```bash
npm run pine:dataset:verify
```

Expected: all configured labs cache complete. Previous reference: all 8 labs passed.

- [ ] **Step 4: Run a dry/no-sweep duplicate reproduction if test harness exists**

Use a test command only. Do not launch a full expensive sweep unless explicitly approved.

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "duplicate|globalAllParameter|exhausted|fingerprint"
```

Expected: PASS.

- [ ] **Step 5: Check working tree**

```bash
git status --short --branch
```

Expected:
- Branch is not `main` if implementation follows worktree discipline.
- Only intended files changed.
- Pre-existing `config/pine-autoresearch.default.json` local diff remains either untouched or explicitly handled.

- [ ] **Step 6: Commit verification note or final implementation commit if needed**

If prior tasks committed cleanly, no extra commit required. If final fixes happened during verification:

```bash
git add scripts/lib/pine-global-search.mjs scripts/pine-autoresearch.mjs tests/pine-global-search.test.mjs tests/pine-autoresearch.test.mjs tests/pine-autoresearch-production-invariants.test.mjs
 git commit -m "fix(pine): prevent duplicate autoresearch sweeps"
```

---

## Task 11: Execution Discipline and Rollback

**Files:**
- No required code changes.

- [ ] **Step 1: Execute in isolated worktree**

Use a separate worktree before code execution:

```bash
cd D:/Code/Experiment/backtest-kit-project
git worktree add .worktrees/duplicate-sweep-guard -b fix/duplicate-sweep-guard
cd .worktrees/duplicate-sweep-guard
```

Expected: new branch created from current HEAD.

- [ ] **Step 2: Protect current local config diff**

Before editing, inspect config diff:

```bash
git diff -- config/pine-autoresearch.default.json
```

Expected current unrelated diff only:

```diff
-      "maxConcurrentLabWorkers": 1,
-      "maxRowsPerAnalysisChunk": 5000,
+      "maxConcurrentLabWorkers": 4,
+      "maxRowsPerAnalysisChunk": 10000,
```

Do not include that config diff in duplicate-sweep commits unless user explicitly approves.

- [ ] **Step 3: Rollback if implementation worsens behavior**

If any of these happen, stop and report blocker instead of patch stacking:

- duplicate tests still fail after three implementation attempts
- full hardening suite introduces unrelated failures
- cycle runner cannot be safely guarded without architecture split
- production invariant needs broad historical data migration

Rollback command for implementation branch only:

```bash
git reset --hard HEAD~1
```

Use only for the most recent bad commit on the feature branch. Never reset `main` without explicit approval.

---

## Self-Review

- Spec coverage: plan covers duplicate challenger root cause, deterministic global generator, novelty/history filter, exhaustion skip, manifest evidence, tests, and verification.
- Placeholder scan: no placeholder tasks remain. The cycle-runner test must generate exhausted fingerprints from `buildRegimeAwareSearchBatch()` before invoking the injected sweep guard; do not hard-code fake fingerprints.
- Type consistency: uses `patchFingerprint`, `metadata.patchFingerprint`, `metadata.mutationFamily`, `variantId`, `lane`, `family`, `searchPlan.variants`, `champion.configId`, `globalNoveltyGuardVersion`, and manifest-derived novelty sources consistently.
- Risk control: plan requires worktree, TDD, focused tests, hardening suite, dataset verify, and no scheduler/full sweep launch without approval.
