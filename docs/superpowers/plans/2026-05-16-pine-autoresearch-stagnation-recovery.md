# Pine Autoresearch Stagnation Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pine autoresearch recover deterministically from the latest repeated `supertrend-tuning` / all-tabu / zero-variant loop and surface the hidden diagnostics that currently make the system look healthier than it is.

**Architecture:** Fix the loop at the state boundary, not by widening random search blindly. Preserve true tabu ages when bootstrapping from prior manifests, make stagnation escape eligible for exploit/track zero-emission failures, force broad fallback at high stagnation, rotate away from exhausted tracks, and add manifest diagnostics that explain why high-score candidates fail promotion. Keep promotion safety gates intact.

**Tech Stack:** Node.js ESM, `node:test`, JSON config, Pine autoresearch artifacts under `pine/autoresearch/...`, sweep artifacts under `pine/sweeps/...`.

---

## Latest Evidence This Plan Targets

Latest observed failing cycle:

- Run: `pine-fusion-v4-core-15m-locked-window-2026-05-15T19-04-58-695Z`
- `activeTrackId: supertrend-tuning`
- `searchBatchSource: regime-fallback`
- `searchEfficiency.emittedVariantCount: 0`
- `searchEfficiency.allCandidatesTabu: true`
- exhausted families: `signal`, `risk`
- `primarySweep.skipped: true`, `skipReason: no-variants-generated`
- `stagnationLevel: 3`, but `stagnationEscape: { mode: 'none', reason: 'not-eligible' }`
- scheduler `tabuRejectedFingerprints: 111`, all stamped at cycle `23`

Recent trajectory:

| Run suffix | Emitted | Source | Top score | Decision | Stagnation |
|---|---:|---|---:|---|---:|
| `17-12-05-341Z` | 12 | `track:supertrend-tuning` | 186.97 | hold / `primaryPromote` | 1 |
| `17-38-06-143Z` | 3 | `track:supertrend-tuning` | 148.77 | hold / `primaryPromote` | 1 |
| `17-54-08-884Z` | 0 | `regime-fallback` | none | hold / no candidate | 1 |
| `18-04-43-791Z` | 9 | `track:supertrend-tuning` | 152.47 | hold / `primaryPromote` | 1 |
| `19-04-58-695Z` | 0 | `regime-fallback` | none | hold / no candidate | 3 |

Unsurfaced facts that must be fixed:

1. **Recent rejected fingerprint bootstrap re-stamps old rejects as current-cycle tabu.** `collectRecentRejectedCandidateFingerprints()` returns strings, and `mergeSchedulerTabuFingerprints()` normalizes those strings with `addedAtCycle = currentCycle`. This explains why 111 fingerprints were all stamped at cycle 23 and survived aging.
2. **Configured tabu policy is ambiguous.** `config/pine-autoresearch.default.json` has `searchPolicy.tabuPolicy.maxEntries = 40`, but runtime selection currently checks `searchPolicy.tabu`, then `rotationPolicy.tabu`, then `rotationPolicy.tabuLimit = 1000`. The intended 40-entry cap can be bypassed.
3. **Stagnation escape requires generated-lane exhaustion, so exploit/track zero-emission deadlocks remain `not-eligible`.** At level 3 with all candidates tabu, escape still returns `none` because `globalAllParameter` + `exitRegime` exhaustion is not the only stuck mode.
4. **Self-loop fallback only activates from `noNewCandidateStreak`, not from severe `stagnationLevel` / `noScoreImprovementStreak`.** A high-stagnation cycle can skip broad fallback even when the system is obviously stuck.
5. **`supertrend-tuning` can remain selected while the actual evaluated batch is fallback or exhaustion.** Attribution is better than before, but operational routing still lets one track dominate repeated cycles.
6. **Track/fallback variants lack stable patch fingerprints.** `searchPlan.variants[*].patchFingerprint` is often `null`, weakening novelty evidence and post-run auditability.
7. **Promotion failure is under-explained.** A candidate scored `186.97` with PF `9.63` and DD `1.25`, but failed `primaryPromote` because ROI was lower than champion (`86.83` vs `91.7`) and/or promotion thresholds. The manifest says `primaryPromote` failed but does not make the metric deltas obvious.
8. **Checkpoint and final scheduler levels can diverge in the same manifest.** Latest manifest had `checkpointState.schedulerStagnationLevel = 2` while final `stagnationLevel = 3`; this is explainable if checkpoint is pre-update, but it should be labeled as such.
9. **Configured stagnation fallback families omit newly implemented surfaces.** `context-aggregator` and `context-exit-shaping` exist in code but are missing from `searchPolicy.selfLoopEscape.stagnationFallbackFamilies`.

---

## File Structure

Modify these files:

- `scripts/pine-autoresearch.mjs`
  - preserve tabu entry ages while bootstrapping from manifests
  - resolve effective tabu policy from `searchPolicy.tabuPolicy`
  - make stagnation escape aware of zero-emission exploit/track exhaustion
  - add final manifest scheduler-cycle diagnostics
  - add promotion gate diagnostics
- `scripts/lib/pine-autoresearch-tracks.mjs`
  - cap same-cycle tabu flood retention during stagnation
  - rotate away after repeated zero-own-family emissions
  - expose helper metadata in scheduler state
- `scripts/lib/pine-track-generators.mjs`
  - activate self-loop fallback on `stagnationLevel >= 1`, not only `noNewCandidateStreak`
  - attach lane patch fingerprints to track and fallback variants
  - expose own-family emitted counts in metadata
- `scripts/lib/pine-stagnation-escape.mjs`
  - allow zero-emission exploit/track exhaustion as eligible escape input
- `config/pine-autoresearch.default.json`
  - add missing fallback families and explicit zero-emission rotation policy
  - align tabu policy naming and caps
- Tests:
  - `tests/pine-autoresearch-tabu-saturation.test.mjs`
  - `tests/pine-autoresearch.test.mjs`
  - `tests/pine-track-generators.test.mjs`
  - `tests/pine-stagnation-escape.test.mjs`
  - `tests/pine-autoresearch-tracks.test.mjs`

---

### Task 1: Preserve Tabu Ages When Bootstrapping Rejected Fingerprints

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing test for age-preserving bootstrap entries**

Append this test near existing `mergeSchedulerTabuFingerprints` tests in `tests/pine-autoresearch.test.mjs`.

```js
test('mergeSchedulerTabuFingerprints preserves bootstrapped tabu ages instead of stamping every reject as current cycle', () => {
  const championFingerprint = 'champion-fp';
  const state = {
    cycleIndex: 24,
    stagnationLevel: 3,
    tabuRejectedFingerprints: [
      { fingerprint: 'current-a', addedAtCycle: 23, championFingerprint },
    ],
  };

  const merged = mergeSchedulerTabuFingerprints({
    schedulerState: state,
    recentRejectedFingerprints: [
      { fingerprint: 'old-a', addedAtCycle: 18, championFingerprint },
      { fingerprint: 'old-b', addedAtCycle: 19, championFingerprint },
      { fingerprint: 'current-a', addedAtCycle: 20, championFingerprint },
    ],
    currentCycle: 24,
    championFingerprint,
    policy: { maxAgeCycles: 20, maxEntries: 128, dropOnChampionChange: true },
  });

  const byFingerprint = new Map(
    merged.tabuRejectedFingerprints.map((entry) => [entry.fingerprint, entry]),
  );

  assert.equal(byFingerprint.get('current-a').addedAtCycle, 23);
  assert.equal(byFingerprint.has('old-a'), false, 'stagnation level 3 should age-prune old rejects');
  assert.equal(byFingerprint.has('old-b'), false, 'stagnation level 3 should not restamp old rejects as fresh');
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
node --test --test-name-pattern="mergeSchedulerTabuFingerprints preserves bootstrapped tabu ages" tests/pine-autoresearch.test.mjs
```

Expected: FAIL because string-only or age-losing merge keeps old rejects as fresh current-cycle entries.

- [ ] **Step 3: Implement age-preserving collection**

Replace `collectRecentRejectedCandidateFingerprints()` in `scripts/pine-autoresearch.mjs` with an entry-preserving helper.

```js
function manifestSchedulerCycleIndex(manifest, fallbackCycle) {
  const candidates = [
    manifest?.schedulerCycleIndex,
    manifest?.cycleIndex,
    manifest?.checkpointState?.schedulerCycleIndex,
    manifest?.checkpointState?.cycleIndex,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.floor(numeric);
  }
  return Math.max(0, Math.floor(Number(fallbackCycle) || 0));
}

async function collectRecentRejectedCandidateTabuEntries(config, { limit = 16, currentCycle = 0, championFingerprint = null } = {}) {
  const files = (await listManifestFiles(config)).slice(-Math.max(0, limit));
  const entries = [];
  const oldestFallbackCycle = Math.max(0, Math.floor(Number(currentCycle) || 0) - files.length);

  for (const [index, fileName] of files.entries()) {
    try {
      const manifest = await readJson(path.join(manifestsDir(config), fileName));
      const fingerprint = inferRejectedCandidateFingerprint(manifest);
      if (!fingerprint) continue;
      const manifestChampionFingerprint = manifest?.championFingerprint ?? championFingerprint ?? null;
      entries.push({
        fingerprint,
        addedAtCycle: manifestSchedulerCycleIndex(manifest, oldestFallbackCycle + index),
        championFingerprint: manifestChampionFingerprint,
      });
    } catch {
      // Ignore corrupt or concurrently-pruned manifests; current cycle can still proceed.
    }
  }

  const deduped = new Map();
  for (const entry of entries) {
    const existing = deduped.get(entry.fingerprint);
    if (!existing || entry.addedAtCycle > existing.addedAtCycle) deduped.set(entry.fingerprint, entry);
  }
  return [...deduped.values()];
}
```

Then change the `runScout()` call site from:

```js
recentRejectedFingerprints: await collectRecentRejectedCandidateFingerprints(config, config.rotationPolicy?.tabuBootstrapManifestLimit ?? 16),
```

to:

```js
recentRejectedFingerprints: await collectRecentRejectedCandidateTabuEntries(config, {
  limit: config.rotationPolicy?.tabuBootstrapManifestLimit ?? 16,
  currentCycle: loadedSchedulerState.cycleIndex ?? 0,
  championFingerprint: schedulerChampionFingerprint,
}),
```

- [ ] **Step 4: Add final scheduler cycle index to manifests**

Modify `applySchedulerStateToManifest()` in `scripts/pine-autoresearch.mjs`.

```js
export function applySchedulerStateToManifest(manifest = {}, schedulerState = {}) {
  return {
    ...manifest,
    schedulerCycleIndex: Number.isFinite(Number(schedulerState?.cycleIndex))
      ? Math.floor(Number(schedulerState.cycleIndex))
      : manifest?.schedulerCycleIndex ?? null,
    noNewCandidateStreak: schedulerState?.noNewCandidateStreak ?? manifest?.noNewCandidateStreak ?? 0,
    lowEmissionStreak: schedulerState?.lowEmissionStreak ?? manifest?.lowEmissionStreak ?? 0,
    laneBudgetDebt: schedulerState?.budgetDebt ?? manifest?.laneBudgetDebt ?? null,
    stagnationLevel: schedulerState?.stagnationLevel ?? manifest?.stagnationLevel ?? 0,
    stagnationReason: schedulerState?.stagnationReason ?? manifest?.stagnationReason ?? null,
    lastEscalatedAt: schedulerState?.lastEscalatedAt ?? manifest?.lastEscalatedAt ?? null,
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test --test-name-pattern="mergeSchedulerTabuFingerprints preserves bootstrapped tabu ages|applySchedulerStateToManifest" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix: preserve pine tabu age when bootstrapping rejects"
```

---

### Task 2: Honor the Intended Tabu Policy and Cap Same-Cycle Floods

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-autoresearch.test.mjs`
- Test: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Add failing test for `searchPolicy.tabuPolicy` precedence**

Add this to `tests/pine-autoresearch.test.mjs`.

```js
test('resolveEffectiveSchedulerTabuPolicy honors searchPolicy.tabuPolicy before rotation tabuLimit', () => {
  assert.deepEqual(autoresearchCli.resolveEffectiveSchedulerTabuPolicy({
    searchPolicy: {
      tabuPolicy: { maxAgeCycles: 7, maxEntries: 40, dropOnChampionChange: true },
    },
    rotationPolicy: { tabuLimit: 1000 },
  }), {
    maxAgeCycles: 7,
    maxEntries: 40,
    dropOnChampionChange: true,
  });
});
```

Expected initial failure: `resolveEffectiveSchedulerTabuPolicy` does not exist.

- [ ] **Step 2: Export effective policy resolver**

Add this function near `mergeSchedulerTabuFingerprints()` in `scripts/pine-autoresearch.mjs`.

```js
export function resolveEffectiveSchedulerTabuPolicy(config = {}) {
  const candidates = [
    config?.searchPolicy?.tabu,
    config?.searchPolicy?.tabuPolicy,
    config?.rotationPolicy?.tabu,
    config?.rotationPolicy?.tabuPolicy,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  if (Number.isFinite(Number(config?.rotationPolicy?.tabuLimit))) {
    return {
      maxAgeCycles: 20,
      maxEntries: Math.max(1, Math.floor(Number(config.rotationPolicy.tabuLimit))),
      dropOnChampionChange: true,
    };
  }
  return { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true };
}
```

Change `runScout()` policy construction to:

```js
const schedulerTabuPolicy = resolveEffectiveSchedulerTabuPolicy(config);
```

- [ ] **Step 3: Add same-cycle flood cap to prune policy**

Add a policy field in `scripts/lib/pine-autoresearch-tracks.mjs` inside `normalizeTabuPrunePolicy()`.

```js
function normalizeTabuPrunePolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : {};
  return {
    maxAgeCycles: normalizePositiveInteger(source.maxAgeCycles, 20),
    maxEntries: normalizePositiveInteger(source.maxEntries, 32),
    maxSameCycleEntries: normalizePositiveInteger(source.maxSameCycleEntries, 24),
    dropOnChampionChange: source.dropOnChampionChange !== false,
  };
}
```

After the `deduped` map is built in `pruneTabuFingerprints()`, replace the current return chain with per-cycle throttling.

```js
const ordered = [...deduped.values()]
  .sort((left, right) => (right.addedAtCycle - left.addedAtCycle) || (right.index - left.index));
const sameCycleCounts = new Map();
const capped = [];
for (const entry of ordered) {
  const cycleCount = sameCycleCounts.get(entry.addedAtCycle) ?? 0;
  if (cycleCount >= policy.maxSameCycleEntries && stagnationLevel >= 2) continue;
  sameCycleCounts.set(entry.addedAtCycle, cycleCount + 1);
  capped.push(entry);
}

return capped
  .slice(0, policy.maxEntries)
  .sort((left, right) => (left.addedAtCycle - right.addedAtCycle) || (left.index - right.index))
  .map(({ fingerprint, addedAtCycle, championFingerprint }) => ({ fingerprint, addedAtCycle, championFingerprint }));
```

- [ ] **Step 4: Test same-cycle flood cap**

Add to `tests/pine-autoresearch-tracks.test.mjs`.

```js
test('pruneTabuFingerprints caps same-cycle flood during severe stagnation', () => {
  const entries = Array.from({ length: 111 }, (_, index) => ({
    fingerprint: `fp-${index}`,
    addedAtCycle: 23,
    championFingerprint: 'champion',
  }));

  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 24,
    currentChampionFingerprint: 'champion',
    stagnationLevel: 3,
    policy: {
      maxAgeCycles: 20,
      maxEntries: 128,
      maxSameCycleEntries: 24,
      dropOnChampionChange: true,
    },
  });

  assert.equal(pruned.length, 24);
  assert.ok(pruned.every((entry) => entry.addedAtCycle === 23));
});
```

- [ ] **Step 5: Update config**

In `config/pine-autoresearch.default.json`, change `searchPolicy.tabuPolicy` to include the flood cap.

```json
"tabuPolicy": {
  "maxAgeCycles": 20,
  "maxEntries": 40,
  "maxSameCycleEntries": 24,
  "dropOnChampionChange": true
}
```

Also reduce bootstrap size to stop historical manifest replay from becoming a second tabu wall.

```json
"tabuBootstrapManifestLimit": 48
```

- [ ] **Step 6: Run tests**

```bash
node --test --test-name-pattern="resolveEffectiveSchedulerTabuPolicy|pruneTabuFingerprints caps same-cycle flood" tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tracks.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pine-autoresearch.mjs scripts/lib/pine-autoresearch-tracks.mjs config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix: cap pine tabu replay during stagnation"
```

---

### Task 3: Make Stagnation Escape Eligible for Zero-Emission Exploit/Track Deadlocks

**Files:**
- Modify: `scripts/lib/pine-stagnation-escape.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-stagnation-escape.test.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing unit test**

Add to `tests/pine-stagnation-escape.test.mjs`.

```js
test('decideStagnationEscapePlan treats zero-emission exploit exhaustion as eligible at level 2+', () => {
  assert.deepEqual(decideStagnationEscapePlan({
    stagnationLevel: 3,
    generatedLanesExhausted: false,
    exploitExhausted: true,
    zeroEmissionExhausted: true,
  }), {
    mode: 'progressive-widen',
    reason: 'zero-emission-exhausted',
    allowArchitectureKeys: true,
    multiKeyMutationCount: 3,
    ladderScale: 2,
  });
});
```

- [ ] **Step 2: Implement zero-emission eligibility**

Modify `decideStagnationEscapePlan()` in `scripts/lib/pine-stagnation-escape.mjs`.

```js
export function decideStagnationEscapePlan(input = {}) {
  const {
    stagnationLevel = 0,
    generatedLanesExhausted = false,
    exploitExhausted = false,
    zeroEmissionExhausted = false,
  } = normalizeInput(input);

  const level = Number(stagnationLevel);
  const safeLevel = Number.isFinite(level) ? level : 0;
  const generatedExhausted = isTruthy(generatedLanesExhausted);
  const exploitDone = isTruthy(exploitExhausted);
  const zeroEmissionDone = isTruthy(zeroEmissionExhausted);

  if (safeLevel < 2) return { mode: 'none', reason: 'not-eligible' };

  if (!generatedExhausted && zeroEmissionDone) {
    return {
      mode: 'progressive-widen',
      reason: 'zero-emission-exhausted',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 3,
      ladderScale: 2,
    };
  }

  if (!generatedExhausted) return { mode: 'none', reason: 'not-eligible' };

  // keep existing generated-lane branches below unchanged
}
```

Keep the existing generated-lane behavior exactly as-is after the new zero-emission branch.

- [ ] **Step 3: Pass zero-emission state from scout resolver**

Modify `resolveScoutStagnationEscape()` in `scripts/pine-autoresearch.mjs`.

```js
export function resolveScoutStagnationEscape({ schedulerState = {}, championState = null, latestManifest = null } = {}) {
  const championConfigFingerprint = championState?.config
    ? buildChampionConfigFingerprint(championState.config)
    : null;
  const exhaustedLanes = resolveExhaustedResearchLanes({
    schedulerState,
    championConfigFingerprint,
  });
  const generatedLanesExhausted = exhaustedLanes.includes('globalAllParameter')
    && exhaustedLanes.includes('exitRegime');
  const previousSearchEfficiency = latestManifest?.searchEfficiency ?? null;
  const exploitExhausted = resolveSearchEfficiencyExploitExhausted(previousSearchEfficiency);
  const zeroEmissionExhausted = Number(previousSearchEfficiency?.emittedVariantCount) === 0
    && previousSearchEfficiency?.allCandidatesTabu === true;
  return decideStagnationEscapePlan({
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    generatedLanesExhausted,
    exploitExhausted,
    zeroEmissionExhausted,
  });
}
```

- [ ] **Step 4: Add integration-style resolver test**

Add to `tests/pine-autoresearch.test.mjs` next to existing `resolveScoutStagnationEscape` tests.

```js
test('resolveScoutStagnationEscape escalates zero-emission all-tabu track deadlock without generated lane exhaustion', () => {
  const champion = globalAllParameterChampion('champ-zero-emission-escape');
  const result = resolveScoutStagnationEscape({
    schedulerState: { stagnationLevel: 3, laneExhaustions: {} },
    championState: champion,
    latestManifest: {
      searchEfficiency: {
        emittedVariantCount: 0,
        allCandidatesTabu: true,
        exhaustedFamilies: ['signal', 'risk'],
      },
    },
  });

  assert.equal(result.mode, 'progressive-widen');
  assert.equal(result.reason, 'zero-emission-exhausted');
  assert.equal(result.allowArchitectureKeys, true);
});
```

- [ ] **Step 5: Run tests**

```bash
node --test tests/pine-stagnation-escape.test.mjs --test-name-pattern="zero-emission"
node --test --test-name-pattern="resolveScoutStagnationEscape escalates zero-emission" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-stagnation-escape.mjs scripts/pine-autoresearch.mjs tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix: trigger pine stagnation escape on zero emission"
```

---

### Task 4: Activate Broad Self-Loop Fallback From Stagnation, Not Only `noNewCandidateStreak`

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs`
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Add failing generator test**

Add to `tests/pine-track-generators.test.mjs`.

```js
test('stagnation level activates broad fallback even before no-new-candidate streak increments', () => {
  const incumbent = {
    minPredSum: 1.8,
    minBarsBetween: 1,
    slAtrMult: 0.5,
    tpAtrMult: 6.85,
    useSignalFusion: true,
    useFusionV4: true,
    useSupertrendFilter: true,
    useSupertrendEntryConfirm: false,
    supertrendAtrLen: 10,
    supertrendFactor: 1.5,
    useTrailingStop: true,
    trailAtrMult: 1,
    trailActivateR: 0.5,
  };

  const variants = buildTrackCandidateBatch({
    track: { trackId: 'supertrend-tuning', sourceFamily: 'supertrend' },
    incumbent,
    maxConfigs: 8,
    historyEvents: [],
    schedulerState: {
      noNewCandidateStreak: 0,
      lowEmissionStreak: 0,
      stagnationLevel: 3,
      tabuRejectedFingerprints: [],
    },
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        stagnationFallbackFamilies: ['ml-core', 'fusion', 'supertrend', 'context-aggregator', 'context-exit-shaping'],
        minFallbackConfigs: 6,
        stagnationTemperatureBoost: 4,
      },
      annealing: { enabled: true, maxTemperature: 16 },
    },
  });

  assert.ok(variants.length > 0);
  assert.ok(variants.some((variant) => variant.lane === 'self-loop-fallback'));
  assert.ok(variants.some((variant) => ['ml-core', 'fusion', 'context-aggregator', 'context-exit-shaping'].includes(variant.family)));
});
```

- [ ] **Step 2: Change escape activation**

In `scripts/lib/pine-track-generators.mjs`, replace `escapeActive` with:

```js
const noNewCandidateStreak = Math.max(0, Number(schedulerState.noNewCandidateStreak ?? 0) || 0);
const lowEmissionStreak = Math.max(0, Number(schedulerState.lowEmissionStreak ?? 0) || 0);
const activateAfter = Math.max(1, Number(selfLoopEscape.activateAfter ?? 1) || 1);
const escapeActive = selfLoopEscape.enabled === true
  && (
    noNewCandidateStreak >= activateAfter
    || lowEmissionStreak >= activateAfter
    || stagnationLevel >= 1
  );
```

- [ ] **Step 3: Add missing fallback families to config**

In `config/pine-autoresearch.default.json`, extend `searchPolicy.selfLoopEscape.stagnationFallbackFamilies`.

```json
"stagnationFallbackFamilies": [
  "signal",
  "risk",
  "exit-state",
  "ml-core",
  "fusion",
  "supertrend",
  "squeeze",
  "divergence",
  "avwap-context",
  "channel-context",
  "context-aggregator",
  "context-exit-shaping"
]
```

Also raise fallback breadth under severe stagnation.

```json
"minFallbackConfigs": 6
```

- [ ] **Step 4: Run tests**

```bash
node --test --test-name-pattern="stagnation level activates broad fallback|advertised fallback families emit" tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-track-generators.mjs config/pine-autoresearch.default.json tests/pine-track-generators.test.mjs
git commit -m "fix: activate pine fallback from stagnation pressure"
```

---

### Task 5: Rotate Away From Tracks With Repeated Zero Own-Family Emission

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Add failing rotation test**

Add to `tests/pine-autoresearch-tracks.test.mjs`.

```js
test('resolveTrackSelectionState rotates after repeated zero-emission cycle on same active track', () => {
  const state = {
    activeTrackId: 'supertrend-tuning',
    cycleIndex: 24,
    sameTrackCycleStreak: 4,
    noScoreImprovementStreak: 4,
    lowEmissionStreak: 1,
    stagnationLevel: 3,
  };

  const previousCycle = {
    activeTrackId: 'supertrend-tuning',
    promotionEligible: false,
    searchBatchSource: 'regime-fallback',
    searchEfficiency: { emittedVariantCount: 0, allCandidatesTabu: true },
  };

  const result = resolveTrackSelectionState({
    schedulerState: state,
    rotationPolicy: { zeroEmissionRotateAfter: 1, maxCyclesPerTrack: 8 },
    researchTracks: [
      { trackId: 'supertrend-tuning', enabled: true },
      { trackId: 'ml-core-tuning', enabled: true },
      { trackId: 'fusion-tuning', enabled: true },
    ],
    previousCycle,
  });

  assert.equal(result.hardRotationTrigger, 'zeroEmissionStagnation');
  assert.equal(result.activeTrackSelectionState.activeTrackId, null);
  assert.ok(result.activeTrackSelectionState.cycleIndex > state.cycleIndex);
});
```

- [ ] **Step 2: Implement trigger**

In `resolveTrackSelectionState()` in `scripts/lib/pine-autoresearch-tracks.mjs`, compute zero-emission trigger before `hardRotationTrigger`.

```js
const zeroEmissionRotateAfter = rotationPolicy.zeroEmissionRotateAfter ?? 2;
const previousZeroEmission = previousCycle?.promotionEligible === false
  && previousCycle?.activeTrackId
  && previousCycle.activeTrackId === schedulerState.activeTrackId
  && Number(previousCycle?.searchEfficiency?.emittedVariantCount) === 0;
const zeroEmissionTrigger = previousZeroEmission
  && (schedulerState.lowEmissionStreak ?? 0) >= zeroEmissionRotateAfter
  ? 'zeroEmissionStagnation'
  : null;
```

Then prepend it to the trigger chain.

```js
const hardRotationTrigger = zeroEmissionTrigger
  ?? (schedulerState.noChangeStreak >= noChangeStreakRotateAfter ? 'noChangeStreak' : null)
  ?? (Number.isFinite(previousCycle?.topCandidateSimilarity) && previousCycle.topCandidateSimilarity > similarityRotateAbove ? 'noveltySimilarity' : null)
  ?? (schedulerState.sameTrackCycleStreak > maxCyclesPerTrack && previousCycle?.promotionEligible === false ? 'maxCyclesPerTrack' : null);
```

- [ ] **Step 3: Update config**

In `config/pine-autoresearch.default.json`, add:

```json
"zeroEmissionRotateAfter": 1
```

inside `rotationPolicy`.

- [ ] **Step 4: Run test**

```bash
node --test --test-name-pattern="zero-emission cycle" tests/pine-autoresearch-tracks.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs config/pine-autoresearch.default.json tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix: rotate pine tracks after zero-emission stagnation"
```

---

### Task 6: Attach Stable Patch Fingerprints to Track and Fallback Variants

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs`
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Add failing fingerprint test**

Add to `tests/pine-track-generators.test.mjs`.

```js
test('track and fallback variants carry stable patch fingerprints', () => {
  const variants = buildTrackCandidateBatch({
    track: { trackId: 'supertrend-tuning', sourceFamily: 'supertrend' },
    incumbent: {
      minPredSum: 1.8,
      minBarsBetween: 1,
      useSupertrendFilter: true,
      useSupertrendEntryConfirm: false,
      supertrendAtrLen: 10,
      supertrendFactor: 1.5,
    },
    maxConfigs: 4,
    schedulerState: { stagnationLevel: 2, noNewCandidateStreak: 0 },
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        includeFallback: true,
        stagnationFallbackFamilies: ['ml-core', 'fusion'],
        minFallbackConfigs: 2,
      },
    },
  });

  assert.ok(variants.length > 0);
  for (const variant of variants) {
    assert.equal(typeof variant.patchFingerprint, 'string');
    assert.ok(variant.patchFingerprint.length >= 32);
    assert.equal(typeof variant.patchFingerprintVersion, 'number');
    assert.equal(typeof variant.metadata.patchFingerprint, 'string');
  }
});
```

- [ ] **Step 2: Implement fingerprints in `buildMetadata()`**

At the top of `scripts/lib/pine-track-generators.mjs`, add imports:

```js
import { buildChampionConfigFingerprint } from './pine-global-search.mjs';
import { buildLanePatchFingerprint, LANE_PATCH_FINGERPRINT_VERSION } from './pine-lane-novelty.mjs';
```

Modify `buildMetadata()`.

```js
function buildMetadata({ trackId, family, index, patch, config, lane, temperature = 1, tabuSkipped = 0 }) {
  const shared = sharedKnobKeys();
  const own = trackOwnKnobKeys(family);
  const patchKeys = Object.keys(patch);
  const championConfigFingerprint = buildChampionConfigFingerprint(config ? { ...config, ...Object.fromEntries(patchKeys.map((key) => [key, undefined])) } : {});
  const patchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint: buildChampionConfigFingerprint(config || {}),
    lane,
    mutationFamily: family,
    patch,
  });
  const metadata = {
    variantId: `${String(family || trackId)}-${String(index + 1).padStart(2, '0')}`,
    family,
    lane,
    patch: clone(patch),
    patchFingerprint,
    patchFingerprintVersion: LANE_PATCH_FINGERPRINT_VERSION,
    sharedKeys: patchKeys.filter((key) => shared.includes(key)),
    ownKeys: patchKeys.filter((key) => own.includes(key)),
    temperature,
    tabuSkipped,
    config,
  };
  if (lane === 'self-loop-fallback') metadata.trackId = trackId;
  return {
    ...metadata,
    patchFingerprint,
    patchFingerprintVersion: LANE_PATCH_FINGERPRINT_VERSION,
    metadata,
  };
}
```

Implementation note: if the exact champion-before-patch config is needed to avoid hashing patched config, change the caller to pass `base` into `buildMetadata({ baseConfig: base, ... })` and build `championConfigFingerprint` from `baseConfig`. Do not ship a fingerprint built from the already-mutated config if tests reveal instability across equivalent variants.

- [ ] **Step 3: Run test**

```bash
node --test --test-name-pattern="stable patch fingerprints" tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/pine-track-generators.mjs tests/pine-track-generators.test.mjs
git commit -m "fix: fingerprint pine track variants"
```

---

### Task 7: Surface Promotion Gate Diagnostics for High-Score Holds

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs` or `scripts/pine-autoresearch.mjs` depending where `decideMatrixPromotion()` emits gate details
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing test for metric deltas on failed primary promote**

Add near `decideMatrixPromotion` tests in `tests/pine-autoresearch.test.mjs`.

```js
test('matrix hold explains high-score candidate rejected by ROI floor', () => {
  const champion = { score: 152.47, roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261 };
  const challenger = { score: 186.97, roiPct: 86.83, profitFactor: 9.63, maxDrawdownPct: 1.25, tradeCount: 265 };
  const decision = decideMatrixPromotion({
    champion,
    challenger,
    labResults: [{
      lab: { labId: 'xrp-primary' },
      incumbent: champion,
      challenger,
      decision: {
        recommendation: 'hold',
        gates: { primaryPromote: false },
        failedGates: ['primaryPromote'],
      },
    }],
    policy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0 },
  });

  assert.equal(decision.recommendation, 'hold');
  assert.equal(decision.gateDiagnostics.primary.roiDeltaPct, -4.87);
  assert.equal(decision.gateDiagnostics.primary.profitFactorDelta, 6.07);
  assert.equal(decision.gateDiagnostics.primary.scoreDelta, 34.5);
});
```

- [ ] **Step 2: Implement gate diagnostics**

Where `decideMatrixPromotion()` constructs its return object, add:

```js
function roundDelta(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Number(numeric.toFixed(digits));
}

function buildPrimaryGateDiagnostics({ champion, challenger } = {}) {
  return {
    scoreDelta: roundDelta((challenger?.score ?? 0) - (champion?.score ?? 0), 2),
    roiDeltaPct: roundDelta((challenger?.roiPct ?? 0) - (champion?.roiPct ?? 0), 2),
    profitFactorDelta: roundDelta((challenger?.profitFactor ?? 0) - (champion?.profitFactor ?? 0), 2),
    maxDrawdownDeltaPct: roundDelta((challenger?.maxDrawdownPct ?? 0) - (champion?.maxDrawdownPct ?? 0), 2),
    tradeCountDelta: roundDelta((challenger?.tradeCount ?? 0) - (champion?.tradeCount ?? 0), 0),
  };
}
```

Return it as:

```js
gateDiagnostics: {
  primary: buildPrimaryGateDiagnostics({ champion, challenger }),
},
```

If `decideMatrixPromotion()` does not receive both champion/challenger in that exact scope, build the same object in `buildScoutOrchestrationState()` after `matrixDecision` and merge it into manifest-local `matrixDecision`.

- [ ] **Step 3: Run test**

```bash
node --test --test-name-pattern="high-score candidate rejected by ROI floor" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: explain pine promotion gate deltas"
```

---

### Task 8: End-to-End Regression for Latest Observed Failure Sequence

**Files:**
- Modify: `tests/pine-autoresearch-tabu-saturation.test.mjs`

- [ ] **Step 1: Add sequence test**

Add a second test that reproduces the latest path: variants emit, one high-score hold happens, same champion continues, tabu wall rebuilds, next cycle must still emit broad variants.

```js
test('severe no-score stagnation does not rebuild an all-current-cycle tabu wall', async () => {
  const { tmpRoot, config } = await setupFixture();
  try {
    config.maxConfigs = 8;
    config.searchPolicy.selfLoopEscape = {
      enabled: true,
      activateAfter: 1,
      includeFallback: true,
      fallbackFamilies: ['signal', 'risk'],
      stagnationFallbackFamilies: ['ml-core', 'fusion', 'supertrend', 'squeeze', 'divergence', 'context-aggregator', 'context-exit-shaping'],
      minFallbackConfigs: 6,
      temperatureBoost: 1.5,
      stagnationTemperatureBoost: 4,
    };
    config.rotationPolicy.stagnation.noScoreImprovementEscalateAfter = 1;
    config.rotationPolicy.stagnation.maxStagnationLevel = 4;

    const cycles = [];
    for (let cycleIndex = 1; cycleIndex <= 6; cycleIndex += 1) {
      const result = await runScout(config, {
        evaluateConfigOnLab: gateFailingEvaluator(),
        runPrimarySweep: async (trackedConfig, runId, { variantFilePath }) => fakePrimarySweep({
          runDir: path.join(tmpRoot, 'pine', 'sweeps', `stagnation-${cycleIndex}`),
          variantFilePath,
          cycleIndex,
        }),
      });
      const schedulerState = JSON.parse(await fs.readFile(schedulerStatePath(config), 'utf8'));
      cycles.push({ manifest: result.manifest, schedulerState });
    }

    const last = cycles.at(-1);
    assert.ok(last.manifest.stagnationLevel >= 2);
    assert.equal(last.manifest.searchEfficiency.allCandidatesTabu, false);
    assert.ok(last.manifest.searchEfficiency.emittedVariantCount > 0);
    assert.notEqual(last.manifest.searchBatchSource, 'regime-fallback');

    const tabuByCycle = new Map();
    for (const entry of last.schedulerState.tabuRejectedFingerprints || []) {
      tabuByCycle.set(entry.addedAtCycle, (tabuByCycle.get(entry.addedAtCycle) || 0) + 1);
    }
    assert.ok(Math.max(...tabuByCycle.values()) <= 24, 'same-cycle tabu flood should be capped');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the regression**

```bash
node --test --test-name-pattern="severe no-score stagnation" tests/pine-autoresearch-tabu-saturation.test.mjs
```

Expected: PASS after Tasks 1-5.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-autoresearch-tabu-saturation.test.mjs
git commit -m "test: cover pine severe stagnation recovery"
```

---

### Task 9: Focused and Full Verification

**Files:** none unless tests expose failures.

- [ ] **Step 1: Run focused suites**

```bash
node --test tests/pine-track-generators.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch-tabu-saturation.test.mjs
node --test --test-name-pattern="resolveEffectiveSchedulerTabuPolicy|resolveScoutStagnationEscape|mergeSchedulerTabuFingerprints|high-score candidate rejected by ROI floor|buildScoutOrchestrationState" tests/pine-autoresearch.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run whole project**

```bash
npm test
```

Expected: `0 fail`. Current known baseline after previous merge was `820 tests`, `819 pass`, `1 skipped`, exit `0`; exact total may increase after new tests.

- [ ] **Step 3: Commit any test repair**

If only test expectation repairs are needed:

```bash
git add tests scripts config
git commit -m "test: align pine stagnation recovery expectations"
```

Do not commit broad production changes under this message.

---

### Task 10: Fresh Cycle Validation After Code Fix

**Files:** no source edits expected. Generated artifacts will update under `pine/autoresearch/...` and `pine/sweeps/...`; only commit source/tests/config unless the project normally commits artifacts.

- [ ] **Step 1: Run one fresh autoresearch cycle on `main`**

Use the existing project script that produced recent cycles. Prefer the configured npm script over ad-hoc node invocations.

```bash
npm run pine:autoresearch -- --profile full --force-cycle
```

If the script name differs, inspect package scripts with:

```bash
node -e "console.log(require('./package.json').scripts)"
```

- [ ] **Step 2: Audit latest manifest**

Run:

```bash
node --input-type=module -e "import fs from 'fs'; const l=JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json','utf8')); console.log(JSON.stringify({runId:l.runId,activeTrackId:l.activeTrackId,searchBatchSource:l.searchBatchSource,eff:l.searchEfficiency,stagnation:{level:l.stagnationLevel,reason:l.stagnationReason,escape:l.stagnationEscape},schedulerCycleIndex:l.schedulerCycleIndex,decision:l.matrixDecision?.recommendation,failed:l.matrixDecision?.failedGates,gateDiagnostics:l.matrixDecision?.gateDiagnostics},null,2));"
```

Expected acceptance criteria:

- If `stagnationLevel >= 2`, then `stagnationEscape.mode !== 'none'` for zero-emission/all-tabu history.
- `searchEfficiency.emittedVariantCount > 0` unless there is a specific generated-lane exhaustion manifest with clear source.
- `searchBatchSource` names the actual source and does not hide `track` vs `fallback` vs `regime` selection.
- `tabuRejectedFingerprints` are not all stamped with the current cycle after bootstrapping old manifests.
- Promotion holds include primary gate deltas explaining why a high-score candidate failed.

- [ ] **Step 3: Do not auto-promote**

If a candidate promotes on primary, do not auto-promote from this plan. Holdout gates and queue policy still govern promotion safety.

---

## Self-Review Checklist

- [ ] Covers recommended fix targets: tabu flood, broad escape, track rotation, escape eligibility, integration regression.
- [ ] Covers unsurfaced facts: policy mismatch, patch fingerprint nulls, promotion-gate opacity, checkpoint/final scheduler mismatch, missing context fallback families.
- [ ] Includes exact files and commands.
- [ ] Uses tests before implementation for each behavior change.
- [ ] Keeps promotion floors intact.
- [ ] Avoids artifact-only success; requires fresh cycle validation after source tests.

## Execution Notes

Recommended execution mode: subagent-driven development.

Suggested task grouping:

1. Tabu age + policy cap: Tasks 1-2
2. Escape activation + track rotation: Tasks 3-5
3. Fingerprints + diagnostics: Tasks 6-7
4. End-to-end regression + verification: Tasks 8-10

Each group should have implementation worker, spec reviewer, code-quality reviewer, then main-session synthesis.
