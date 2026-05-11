# Autoresearch Lane Alias and Sort Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining autoresearch findings: deterministic parameter-surface ordering and lane-exhaustion alias handling, without changing config files or scheduler state format.

**Architecture:** Keep canonical internal lane names as `exitRegime` and `globalAllParameter`. Accept persisted/generated aliases (`exit-regime`, `global-all-parameter`) only at scheduler boundaries, normalize them before selection/exhaustion comparisons, and keep newly written exhaustion records canonical. Keep parameter surface ordering code-point deterministic instead of locale-dependent.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine autoresearch modules, JSON scheduler state.

---

## Current confirmed state

Repository: `D:/Code/Experiment/backtest-kit-project`

Current status before executing this plan:

```text
## main...origin/main [ahead 7]
 M scripts/lib/pine-parameter-surface.mjs
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
```

Important: `scripts/lib/pine-parameter-surface.mjs` already contains a partial manual fix replacing the two local `localeCompare` calls in `parameterSurfaceCatalog()` and `buildSurfaceMutationCandidates()`. Treat that as uncommitted work that still needs tests and commit discipline, not as completed verified work.

Do **not** modify:

- `config/pine-autoresearch.default.json`
- scheduler state under `pine/autoresearch/**/state/scheduler/**`
- production manifests/artifacts

## Root-cause summary

### Finding 1: locale-sensitive ordering in parameter surface

`parameterSurfaceCatalog()` and family queue sorting used `localeCompare`. This violates the deterministic ordering requirement because locale/runtime collation can differ across environments. Existing adjacent modules use explicit code-point comparators.

Correct behavior: stable code-point sorting for catalog keys and fallback family names.

### Finding 2: scheduler lane alias lookup can miss persisted exhaustion

`resolveExhaustedResearchLanes()` currently calls `normalizeLaneKey()` on explicit and persisted exhaustion keys. But `normalizeLaneKey()` only accepts canonical keys from:

```js
['exploit', 'exitRegime', 'globalAllParameter', 'robustness']
```

So persisted keys like `exit-regime` and `global-all-parameter` are dropped. Result: `selectNextResearchLane()` may treat an already exhausted generated lane as selectable, causing repeat/livelock risk.

Correct behavior: scheduler reads both aliases and canonical names, returns canonical exhausted lane names, and writes canonical lane names for new exhaustion records.

---

## File Structure

### Modify

- `scripts/lib/pine-parameter-surface.mjs`
  - Keep/add code-point comparator.
  - Replace all local `localeCompare` usage in this file with `compareCodePoints()`.

- `scripts/lib/pine-regime-exit-scheduler.mjs`
  - Extend `normalizeLaneKey()` to accept generated-lane aliases.
  - Keep `resolveExhaustedResearchLanes()` return values canonical.
  - Ensure fallback `selectableLanes.sort()` remains deterministic; either leave as canonical ASCII keys or replace with code-point sort for consistency.

- `tests/pine-parameter-surface.test.mjs`
  - Add regression proving catalog fallback ordering is code-point, not locale-driven.
  - Add regression proving filtered families still use deterministic family fallback ordering.

- `tests/pine-regime-exit-scheduler.test.mjs`
  - Import `resolveExhaustedResearchLanes`.
  - Add unit tests for alias normalization in explicit and persisted exhausted lanes.
  - Add selection tests proving dashed persisted aliases are treated as exhausted.

- `tests/pine-autoresearch.test.mjs`
  - Add one integration-level regression proving `runScout()` terminal no-lane path works when persisted scheduler state uses dashed `global-all-parameter` key.
  - Keep temp filesystem only; no production state writes.

### Optional docs

- This plan file itself: `docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md`

---

## Task 0: Preflight and protect existing work

**Files:** none

- [ ] **Step 1: Confirm branch and dirty state**

Run:

```bash
git status --short --branch
```

Expected current shape:

```text
## main...origin/main [ahead 7]
 M scripts/lib/pine-parameter-surface.mjs
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
?? docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md
```

If there are extra modified files, stop and inspect them before continuing.

- [ ] **Step 2: Inspect current partial diff**

Run:

```bash
git diff -- scripts/lib/pine-parameter-surface.mjs
```

Expected: only a `compareCodePoints()` helper and two replacements from `.localeCompare(...)` to `compareCodePoints(...)`.

- [ ] **Step 3: Check remaining target usage**

Run:

```bash
rg -n "localeCompare" scripts/lib/pine-parameter-surface.mjs scripts/lib/pine-regime-exit-scheduler.mjs tests/pine-parameter-surface.test.mjs tests/pine-regime-exit-scheduler.test.mjs
```

Expected before Task 1: no `localeCompare` in `pine-parameter-surface.mjs`; likely no output for these target files. If output exists in target files, Task 1 must remove it.

---

## Task 1: Lock deterministic parameter-surface ordering with tests

**Files:**
- Modify: `tests/pine-parameter-surface.test.mjs`
- Verify existing/current modify: `scripts/lib/pine-parameter-surface.mjs`

- [ ] **Step 1: Add the failing ordering regression tests**

Append these tests near the existing `parameterSurfaceCatalog` tests in `tests/pine-parameter-surface.test.mjs`:

```js
test('parameterSurfaceCatalog uses code-point ordering inside a family', () => {
  const fusionKeys = parameterSurfaceCatalog({
    families: ['fusion'],
    includeArchitecture: true,
  }).map((item) => item.key);

  const relevant = fusionKeys.filter((key) => key === 'use3LineConfirm' || key === 'useAtrFlipConfirm');
  assert.deepEqual(relevant, ['use3LineConfirm', 'useAtrFlipConfirm']);
});

test('buildSurfaceMutationCandidates keeps deterministic fallback ordering for unknown families', () => {
  const candidates = buildSurfaceMutationCandidates({
    champion,
    maxConfigs: 6,
    levels: 1,
    families: ['avwap-context', 'channel-context', 'context-aggregator'],
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.family).slice(0, 3),
    ['avwap-context', 'channel-context', 'context-aggregator'],
  );
});
```

Why this exact test:

- `use3LineConfirm` vs `useAtrFlipConfirm` catches lexicographic code-point behavior (`3` before `A`).
- The unknown-family fallback test ensures family ordering remains deterministic when families are outside `FAMILY_PRIORITY`.

- [ ] **Step 2: Run the tests and confirm current behavior**

Run:

```bash
node --test tests/pine-parameter-surface.test.mjs
```

Expected after the already-started fix: all tests pass. If it fails because ordering is locale-dependent, apply Step 3.

- [ ] **Step 3: Ensure implementation uses code-point sort**

In `scripts/lib/pine-parameter-surface.mjs`, ensure this helper exists after `familyOrderRank()`:

```js
function compareCodePoints(left, right) {
  if (left === right) return 0;
  const leftPoints = Array.from(String(left));
  const rightPoints = Array.from(String(right));
  const limit = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < limit; index += 1) {
    const leftCodePoint = leftPoints[index].codePointAt(0);
    const rightCodePoint = rightPoints[index].codePointAt(0);
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }

  return leftPoints.length - rightPoints.length;
}
```

Ensure `parameterSurfaceCatalog()` ends with:

```js
    .sort((a, b) => familyOrderRank(a.family) - familyOrderRank(b.family) || compareCodePoints(a.key, b.key));
```

Ensure `buildSurfaceMutationCandidates()` queue sorting uses:

```js
  const queues = [...grouped.entries()]
    .sort(([left], [right]) => familyOrderRank(left) - familyOrderRank(right) || compareCodePoints(left, right))
    .map(([family, specs]) => ({ family, candidates: familyCandidates(specs, config, levels) }))
    .filter((queue) => queue.candidates.length > 0);
```

- [ ] **Step 4: Re-run focused tests**

Run:

```bash
node --test tests/pine-parameter-surface.test.mjs
```

Expected: PASS.

---

## Task 2: Add scheduler alias tests before changing scheduler code

**Files:**
- Modify: `tests/pine-regime-exit-scheduler.test.mjs`

- [ ] **Step 1: Import `resolveExhaustedResearchLanes`**

Change the import at the top of `tests/pine-regime-exit-scheduler.test.mjs` to:

```js
import {
  allocateRegimeExitLaneBudget,
  resolveExhaustedResearchLanes,
  selectNextResearchLane,
  STAGNATION_LANE_METADATA,
} from '../scripts/lib/pine-regime-exit-scheduler.mjs';
```

- [ ] **Step 2: Add alias normalization tests**

Insert these tests after `stagnation metadata strictPromotionGates only enabled at level 3`:

```js
test('resolveExhaustedResearchLanes canonicalizes explicit generated lane aliases', () => {
  assert.deepEqual(
    resolveExhaustedResearchLanes({
      exhaustedLanes: ['exit-regime', 'global-all-parameter', 'exitRegime', 'globalAllParameter', 'unknown-lane'],
    }),
    ['exitRegime', 'globalAllParameter'],
  );
});

test('resolveExhaustedResearchLanes canonicalizes persisted generated lane aliases', () => {
  const championConfigFingerprint = 'champion-fp';
  const schedulerState = {
    laneExhaustions: {
      [championConfigFingerprint]: {
        'exit-regime': { reason: 'exit-regime-exhausted' },
        'global-all-parameter': { reason: 'global-all-parameter-exhausted' },
        'not-a-lane': { reason: 'ignored' },
      },
    },
  };

  assert.deepEqual(
    resolveExhaustedResearchLanes({ schedulerState, championConfigFingerprint }),
    ['exitRegime', 'globalAllParameter'],
  );
});

test('selectNextResearchLane skips dashed persisted exitRegime exhaustion', () => {
  const championConfigFingerprint = 'champion-fp';
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: { exitRegime: 100, globalAllParameter: 0, exploit: 0, robustness: 0 },
    lanesEnabled: { exploit: false, exitRegime: true, globalAllParameter: true, robustness: false },
    schedulerState: {
      laneExhaustions: {
        [championConfigFingerprint]: {
          'exit-regime': { reason: 'exit-regime-exhausted' },
        },
      },
    },
    championConfigFingerprint,
  });

  assert.equal(lane, 'globalAllParameter');
});

test('selectNextResearchLane returns null when only lane is dashed persisted exhausted alias', () => {
  const championConfigFingerprint = 'champion-fp';
  const lane = selectNextResearchLane({
    stagnationLevel: 1,
    budgetDebt: { globalAllParameter: 100 },
    lanesEnabled: { exploit: false, exitRegime: false, globalAllParameter: true, robustness: false },
    schedulerState: {
      laneExhaustions: {
        [championConfigFingerprint]: {
          'global-all-parameter': { reason: 'global-all-parameter-exhausted' },
        },
      },
    },
    championConfigFingerprint,
  });

  assert.equal(lane, null);
});
```

- [ ] **Step 3: Run the new tests and confirm failure before implementation**

Run:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected before Task 3: FAIL because dashed aliases are ignored.

If the tests pass before scheduler changes, inspect current `normalizeLaneKey()` because another worker may have already fixed it.

---

## Task 3: Normalize generated lane aliases in scheduler

**Files:**
- Modify: `scripts/lib/pine-regime-exit-scheduler.mjs`

- [ ] **Step 1: Replace `normalizeLaneKey()`**

In `scripts/lib/pine-regime-exit-scheduler.mjs`, replace:

```js
function normalizeLaneKey(lane) {
  return LANE_KEYS.includes(lane) ? lane : null;
}
```

with:

```js
function normalizeLaneKey(lane) {
  if (lane === 'exit-regime') return 'exitRegime';
  if (lane === 'global-all-parameter') return 'globalAllParameter';
  return LANE_KEYS.includes(lane) ? lane : null;
}
```

This is intentionally narrow. Do not accept arbitrary case variants. Silent broad normalization can hide malformed state.

- [ ] **Step 2: Keep `resolveExhaustedResearchLanes()` canonical**

Leave the public return shape as canonical strings. The function should remain:

```js
export function resolveExhaustedResearchLanes({ schedulerState = {}, championConfigFingerprint = null, exhaustedLanes = [] } = {}) {
  const explicit = Array.isArray(exhaustedLanes)
    ? exhaustedLanes.map(normalizeLaneKey).filter(Boolean)
    : [];
  const persisted = championConfigFingerprint && schedulerState?.laneExhaustions?.[championConfigFingerprint]
    ? Object.keys(schedulerState.laneExhaustions[championConfigFingerprint]).map(normalizeLaneKey).filter(Boolean)
    : [];
  return [...new Set([...explicit, ...persisted])];
}
```

Do not rewrite persisted scheduler state in this task. Compatibility must be read-side first.

- [ ] **Step 3: Run scheduler tests**

Run:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: PASS.

---

## Task 4: Add integration regression for dashed persisted global lane exhaustion

**Files:**
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add an integration test after existing terminal no-lane test**

Add this test immediately after `runScout returns terminal no-lane hold when only globalAllParameter lane is boolean-enabled and already exhausted`:

```js
test('runScout treats dashed persisted global lane exhaustion as terminal no-lane hold', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-runscout-no-lane-global-dashed-exhausted-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    const researchRoot = path.join(dir, 'research');
    const digestRoot = path.join(dir, 'digest');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'global-dashed-exhausted-no-lane-test',
      scriptPath,
      outputs: { researchRoot, digestRoot },
      maxConfigs: 6,
      minTrades: 1,
      searchPolicy: {
        mode: 'incumbent-local',
        exploitRatio: 0.8,
        paretoShortlistSize: 2,
        matrixCandidateLimit: 1,
        globalAllParameterVariantsPerFamily: 1,
      },
      primaryLab: {
        labId: 'primary',
        symbol: 'XRPUSDT',
        timeframe: '15m',
        limit: 12,
        when: '2026-05-01T03:00:00.000Z',
        exchange: 'ccxt-exchange',
      },
      shadowLabs: [],
      blindHoldoutLabs: [],
      pinnedData: { enabled: false },
      regimeExitResearch: {
        enabled: true,
        exploitEnabled: false,
        exitRegimeEnabled: false,
        globalAllParameterEnabled: true,
        robustnessLadderEnabled: false,
        offline: { mode: 'local-first' },
      },
      retention: { pruneSweepRuns: false, pruneEvaluationRuns: false, prunePartialRuns: false },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    const champion = globalAllParameterChampion('champ-runscout-no-lane-dashed');
    const championConfigFingerprint = buildChampionConfigFingerprint(champion.config);
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.mkdir(path.join(config.researchRoot, 'state', 'scheduler'), { recursive: true });
    await fs.writeFile(path.join(config.researchRoot, 'champion.json'), JSON.stringify({
      ...champion,
      configFingerprint: 'champ-runscout-no-lane-dashed-fp',
    }), 'utf8');
    await fs.writeFile(path.join(config.researchRoot, 'state', 'scheduler', `${config.matrixId}.json`), JSON.stringify({
      stagnationLevel: 1,
      budgetDebt: { globalAllParameter: 1000 },
      laneExhaustions: {
        [championConfigFingerprint]: {
          'global-all-parameter': {
            lane: 'global-all-parameter',
            championConfigFingerprint,
            exhaustedAt: '2026-05-09T00:00:00.000Z',
            runId: 'run-global-dashed-exhausted',
            reason: 'global-all-parameter-exhausted',
            nextSelectedLane: null,
            fallbackReason: 'all-enabled-lanes-exhausted',
          },
        },
      },
    }), 'utf8');

    const sweepCalls = [];
    const result = await autoresearchCli.runScout(config, {
      runPrimarySweep: async (...args) => {
        sweepCalls.push(args);
        throw new Error('primary sweep must not run when dashed persisted global lane is exhausted');
      },
    });

    assert.deepEqual(sweepCalls, []);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no-regime-research-lane');
    assert.equal(result.manifest.primarySweep, null);
    assert.equal(result.manifest.matrixDecision.recommendation, 'hold');
    assert.equal(result.manifest.matrixDecision.reason, 'no-regime-research-lane');
    assert.equal(result.manifest.shadowRegimeScoreboard.selectedLane, null);
    assert.equal(result.manifest.shadowRegimeScoreboard.noLaneReason, 'all-enabled-lanes-exhausted');
    assert.deepEqual(result.manifest.searchPlan.variants, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run focused integration tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "terminal no-lane|dashed persisted global lane"
```

Expected: PASS. If the dashed test fails and canonical test passes, the scheduler alias fix is incomplete.

---

## Task 5: Focused verification matrix

**Files:** none

- [ ] **Step 1: Run direct target suites**

Run:

```bash
node --test tests/pine-parameter-surface.test.mjs tests/pine-regime-exit-scheduler.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run autoresearch focused suite**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "exitRegime|globalAllParameter|terminal no-lane|dashed persisted global lane"
```

Expected: PASS. This intentionally over-selects related tests to catch regression around generated lane exhaustion.

- [ ] **Step 3: Run hardening gate if focused suite passes**

Run:

```bash
npm run test:pine:autoresearch:hardening
```

Expected: PASS, with the known production-root invariant skipped only when fixture-only mode applies.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 5: Confirm no config/state touched**

Run:

```bash
git status --short
```

Expected modified files only:

```text
 M scripts/lib/pine-parameter-surface.mjs
 M scripts/lib/pine-regime-exit-scheduler.mjs
 M tests/pine-autoresearch.test.mjs
 M tests/pine-parameter-surface.test.mjs
 M tests/pine-regime-exit-scheduler.test.mjs
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
?? docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md
```

No `config/*.json`, `pine/autoresearch/**/state/**`, or manifest files should be modified.

---

## Task 6: Commit verified fix

**Files:**
- Commit code/tests only unless user explicitly wants plan docs committed.

- [ ] **Step 1: Stage code and tests**

Run:

```bash
git add scripts/lib/pine-parameter-surface.mjs scripts/lib/pine-regime-exit-scheduler.mjs tests/pine-autoresearch.test.mjs tests/pine-parameter-surface.test.mjs tests/pine-regime-exit-scheduler.test.mjs
```

- [ ] **Step 2: Commit**

Run:

```bash
git commit -m "fix(pine): harden generated lane alias exhaustion"
```

- [ ] **Step 3: Record final status**

Run:

```bash
git status --short --branch
git log --oneline -5
```

Expected: main ahead count increases by 1. Untracked plan docs remain unless user explicitly asked to commit/remove them.

---

## Task 7: Post-fix audit questions before claiming complete

Answer these in the final report with evidence from commands:

1. Did every scheduler read path canonicalize dashed generated-lane aliases?
   - Evidence: `resolveExhaustedResearchLanes` tests pass.
2. Did `selectNextResearchLane()` refuse exhausted dashed aliases?
   - Evidence: scheduler selection tests pass.
3. Did `runScout()` avoid primary sweep when only dashed persisted `global-all-parameter` is exhausted?
   - Evidence: integration regression passes and `sweepCalls` remains empty.
4. Did parameter surface avoid `localeCompare` in the target file?
   - Evidence: `rg -n "localeCompare" scripts/lib/pine-parameter-surface.mjs` returns no output.
5. Did verification avoid mutating configs/state?
   - Evidence: `git status --short` has only expected code/test/doc paths.

Do not claim profitability improvement. The verified claim is narrower: deterministic ordering and non-repetition protection for alias-shaped generated-lane exhaustion state.

---

## Self-review checklist

- Spec coverage:
  - deterministic sort fixed and tested: Task 1
  - scheduler alias normalization fixed and tested: Tasks 2-3
  - runScout integration no-fallback behavior tested: Task 4
  - verification and commit discipline: Tasks 5-6
  - final claim boundaries: Task 7
- Placeholder scan: no `TBD`, no vague “add tests”, exact code snippets included.
- Type/signature consistency:
  - `resolveExhaustedResearchLanes` import path matches current module.
  - lane names remain canonical: `exitRegime`, `globalAllParameter`.
  - accepted aliases are exactly `exit-regime`, `global-all-parameter`.
