# Pine Autoresearch Unattended Safety Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pine autoresearch safe for unattended cycle-only operation by first analyzing the current uncommitted parameter-surface ordering change, then closing the proven lane-alias exhaustion gap, preserving promotion safety, and recording exactly what changed, when, and why.

**Architecture:** Treat unattended safety as a narrow hardening layer around the already-implemented progressive parameter-surface engine. Keep canonical generated lane names as `exitRegime` and `globalAllParameter`; accept dashed aliases only on read boundaries; keep newly written state canonical. Treat the parameter-surface `localeCompare` replacement as deterministic-ordering hardening, not a proven production bug, unless analysis finds a current catalog/order divergence. Do not alter objective scoring, config policy, production scheduler state, manifests, or promotion behavior in this plan.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine autoresearch scripts, JSON manifest/history/state files, PowerShell scheduler wrapper tests.

---

## Non-negotiable worker rules

1. Start from `D:/Code/Experiment/backtest-kit-project`.
2. Run preflight before editing anything.
3. Do not modify production config, scheduler state, manifests, latest pointers, run artifacts, or promotion queue files.
4. Do not run `promote`, `autopromote`, or scheduler installation scripts.
5. Do not broaden the parameter surface catalog in this plan.
6. Do not change scoring, profitability thresholds, matrix promotion policy, holdout policy, or objective weights.
7. Do not normalize arbitrary lane strings. Only accept exact aliases `exit-regime` and `global-all-parameter`.
8. Do not claim profitability improvement. This plan proves deterministic ordering hardening and exhausted-lane non-repetition protection only.
9. Do not describe `PS-ORDER-001` as the cause of the latest autoresearch behavior unless analysis reproduces a current ordering divergence. Current evidence says it is preventive hardening.
10. If actual repo state differs from this plan’s expected preflight, stop and report the diff before implementing.
11. Every implementation task must add or preserve a failing test first unless the code is already changed in the working tree and the task is explicitly documenting/locking that change.

---

## Current evidence and change ledger

### Repository state observed before this plan

Observed in the current session around `2026-05-10 20:37 Asia/Jakarta`:

```text
## main...origin/main [ahead 7]
 M scripts/lib/pine-parameter-surface.mjs
?? docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
```

Known latest autoresearch result before this plan:

- latest run: `pine-fusion-v4-core-15m-locked-window-2026-05-10T12-15-30-420Z`
- selected lane: `exitRegime`
- generated variants: `8`
- all generated variants have patch fingerprints
- `noNewCandidate: false`
- `promotionEligible: false`
- matrix decision: `hold`
- failed gates: `primaryPromote`, `shadowPassCount`, `shadowPassRatio`
- promotion queue file `state/promotion-queue.jsonl` exists but is size `0`
- no current autoresearch/scheduler lock was present in prior inspection

Verification already observed before this plan:

```text
node --test tests/pine-parameter-surface.test.mjs tests/pine-regime-exit-scheduler.test.mjs
# 21 pass / 0 fail

node --test tests/pine-regime-exit-scheduler.test.mjs tests/pine-autoresearch-artifacts.test.mjs tests/pine-autoresearch-production-invariants.test.mjs tests/pine-autoresearch.test.mjs
# 189 pass / 0 fail / 1 skipped
```

The skipped production invariant is acceptable only because production-root mode was not required in that test invocation. For unattended readiness, this plan adds an explicit production-root check gate.

### Parameter surface analysis and change ledger

This is the current uncommitted working-tree change. It must be analyzed before a worker treats it as part of the fix. It must be preserved, tested, and committed only if the analysis below still supports keeping it; otherwise it must be reverted intentionally. It must not remain an unexplained local mutation.

Important correction from later review: `PS-ORDER-001` is **not currently proven to fix an observed production failure**. The latest catalog comparison in the current Node/runtime showed zero current full-catalog order differences between `localeCompare` and code-point ordering. The correct classification is preventive deterministic-order hardening, because `localeCompare()` can differ across locales/runtimes and future catalog keys can expose that difference. The real unattended blocker remains `LANE-ALIAS-001`.

| Change id | File | Status | First observed | Classification | Reason | Behavior impact | Required proof |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PS-ORDER-001` | `scripts/lib/pine-parameter-surface.mjs` | uncommitted before this plan | autocapture around `2026-05-10 17:54 Asia/Jakarta`; re-inspected around `2026-05-10 21:17 Asia/Jakarta` | preventive hardening / untested local change; not reproduced as current catalog divergence | replace locale-sensitive ordering with runtime-locale-independent code-point ordering to prevent future cross-runtime candidate ordering drift | for current catalog, expected candidate set/count/value semantics unchanged; only potential order changes under different locale/future keys | analysis command recorded; parameter-surface ordering tests added; `rg -n "localeCompare" scripts/lib/pine-parameter-surface.mjs` returns no output |

Exact current diff for `PS-ORDER-001`:

```diff
+function compareCodePoints(left, right) {
+  if (left === right) return 0;
+  const leftPoints = Array.from(String(left));
+  const rightPoints = Array.from(String(right));
+  const limit = Math.min(leftPoints.length, rightPoints.length);
+
+  for (let index = 0; index < limit; index += 1) {
+    const leftCodePoint = leftPoints[index].codePointAt(0);
+    const rightCodePoint = rightPoints[index].codePointAt(0);
+    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
+  }
+
+  return leftPoints.length - rightPoints.length;
+}
...
-    .sort((a, b) => familyOrderRank(a.family) - familyOrderRank(b.family) || a.key.localeCompare(b.key));
+    .sort((a, b) => familyOrderRank(a.family) - familyOrderRank(b.family) || compareCodePoints(a.key, b.key));
...
-    .sort(([left], [right]) => familyOrderRank(left) - familyOrderRank(right) || left.localeCompare(right))
+    .sort(([left], [right]) => familyOrderRank(left) - familyOrderRank(right) || compareCodePoints(left, right))
```

Analysis already performed in current session:

```text
fusion relevant current: [ 'use3LineConfirm', 'useAtrFlipConfirm' ]
global locale-vs-code diff positions: 0
localeFamilies: [ 'avwap-context', 'channel-context', 'context-aggregator' ]
codeFamilies:   [ 'avwap-context', 'channel-context', 'context-aggregator' ]

example pair behavior:
{ a: 'A', b: 'a', locale: 1, code: -32 }
{ a: 'ä', b: 'z', locale: -1, code: 106 }
```

Interpretation:

- Current catalog does not expose an ordering difference in this runtime.
- `localeCompare()` is still unsuitable as a cross-runtime deterministic ordering primitive because simple strings can sort differently than code-point order.
- Keeping `PS-ORDER-001` is justified only as a small deterministic-ordering hardening with tests, not as a fix for the latest autoresearch result.

Keep/revert decision rule:

- Keep if the diff remains exactly scoped to comparator + two sort call sites, tests are added, and candidate set/count semantics remain unchanged.
- Revert if analysis finds catalog keys/families/ladders changed, sort replacement changes candidate count/value semantics, or tests cannot lock the intended invariant without broadening production behavior.

What this change must **not** do:

- It must not add/remove parameter keys.
- It must not change patch application.
- It must not change family priority ordering.
- It must not change `maxConfigs`, lane budget, promotion policy, or config files.

### Remaining known hardening gap

| Finding id | Area | Status | Reason it blocks unattended operation | Required fix |
| --- | --- | --- | --- | --- |
| `LANE-ALIAS-001` | `scripts/lib/pine-regime-exit-scheduler.mjs` | open | `scripts/lib/pine-lane-novelty.mjs` already canonicalizes dashed generated-lane aliases, but scheduler exhaustion read path currently accepts only canonical keys. A persisted dashed key like `global-all-parameter` can be ignored, making an exhausted lane selectable again. Current production state uses canonical `globalAllParameter`, so this is not the live cause of the last runs, but unattended operation must tolerate mixed historical state. | scheduler must canonicalize exact dashed aliases when reading explicit/persisted exhaustion lanes; tests must prove `selectNextResearchLane()` and `runScout()` skip dashed exhausted lanes |

---

## File Structure

### Modify

- `scripts/lib/pine-parameter-surface.mjs`
  - Keep `compareCodePoints()`.
  - Ensure no local `localeCompare()` remains.

- `tests/pine-parameter-surface.test.mjs`
  - Add deterministic ordering regressions for code-point order.
  - Do not alter existing broad-surface tests except as needed to add focused tests.

- `scripts/lib/pine-regime-exit-scheduler.mjs`
  - Extend `normalizeLaneKey()` to accept only exact aliases `exit-regime` and `global-all-parameter`.
  - Keep `resolveExhaustedResearchLanes()` return values canonical.
  - Do not rewrite persisted scheduler state.

- `tests/pine-regime-exit-scheduler.test.mjs`
  - Import `resolveExhaustedResearchLanes`.
  - Add unit tests for explicit and persisted dashed aliases.
  - Add selection tests proving exhausted dashed aliases are skipped.

- `tests/pine-autoresearch.test.mjs`
  - Add integration regression proving `runScout()` does not run primary sweep when only enabled generated lane is exhausted under dashed persisted key.

### Create or update docs

- `docs/superpowers/plans/2026-05-10-autoresearch-unattended-safety-hardening.md`
  - This plan.

### Do not modify

- `config/pine-autoresearch.default.json`
- `config/*.json`
- `pine/autoresearch/**/state/**`
- `pine/autoresearch/**/manifests/**`
- `pine/autoresearch/**/latest.json`
- `pine/autoresearch/**/history.jsonl`
- `pine/autoresearch/**/runs/**`
- `pine/autoresearch/**/evaluations/**`
- scheduler installation scripts, unless a future separate ops plan asks for that explicitly

---

## Unattended safety definition

After this plan, it is acceptable to run unattended **cycle-only** autoresearch if all of these are true:

1. Working tree has no uncommitted code/test changes except intentionally untracked docs.
2. No autoresearch or scheduler lock exists before starting.
3. No running `scripts/pine-autoresearch` or `npm run pine:*autoresearch*` process exists before starting.
4. Latest manifest pointer validates.
5. Production-root invariant check passes against the real autoresearch root.
6. Hardening suite passes.
7. Scheduler reads canonical and dashed exhausted generated-lane keys equivalently.
8. `runScout()` skips primary sweep and returns terminal hold when all enabled generated lanes are exhausted, even if persisted exhaustion key is dashed.
9. Promotion queue is empty or pending promotions explicitly block cycle start unless forced by an operator.
10. Autopromote is not enabled as part of the unattended cycle run unless a separate promotion-readiness plan is completed.

Still not proven by this plan:

- higher profitability
- better ROI than current champion
- safety of unattended `autopromote`
- correctness of external scheduled-task installation
- cloud/remote runner stability

---

## Task 0: Preflight and stop conditions

**Files:** none

- [ ] **Step 1: Confirm repo and branch**

Run:

```bash
cd D:/Code/Experiment/backtest-kit-project
git status --short --branch
```

Expected shape before implementing code:

```text
## main...origin/main [ahead 7]
 M scripts/lib/pine-parameter-surface.mjs
?? docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md
?? docs/superpowers/plans/2026-05-10-autoresearch-unattended-safety-hardening.md
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
```

Acceptable variation: this plan file may be absent before first write or present after write.

Stop if any of these appear:

- modified `config/*.json`
- modified `pine/autoresearch/**`
- modified files unrelated to this plan
- branch is not `main`
- repository path is not `D:/Code/Experiment/backtest-kit-project`

- [ ] **Step 2: Confirm current parameter-surface diff**

Run:

```bash
git diff -- scripts/lib/pine-parameter-surface.mjs
```

Expected diff is only `PS-ORDER-001`: `compareCodePoints()` plus the two sort replacements. Stop if catalog keys, family definitions, ladder rules, or candidate construction changed.

- [ ] **Step 3: Confirm no live locks/processes before test work**

Run:

```powershell
$paths = @(
  'pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/autoresearch.lock.json',
  'tmp/pine-autoresearch-locks/scheduler.lock',
  'tmp/pine-autoresearch-locks/scheduler.lock.reclaim'
)
foreach ($p in $paths) {
  if (Test-Path $p) { Write-Host "PRESENT $p"; Get-Content -Raw $p }
  else { Write-Host "MISSING $p" }
}
Write-Host '--- processes'
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'scripts/pine-autoresearch|npm run pine' } |
  Select-Object ProcessId,CommandLine |
  Format-List
```

Expected:

- all three lock paths are `MISSING`
- no process other than the inspection command itself

If a real autoresearch process is running, stop. Do not kill it unless explicitly instructed.

---

## Task 1: Analyze and then lock parameter-surface deterministic ordering

**Files:**
- Modify: `tests/pine-parameter-surface.test.mjs`
- Verify: `scripts/lib/pine-parameter-surface.mjs`

- [ ] **Step 1: Re-run analysis before deciding keep/revert**

Run this before adding tests or committing the current `PS-ORDER-001` diff:

```bash
@'
import { parameterSurfaceCatalog } from './scripts/lib/pine-parameter-surface.mjs';

function compareCodePoints(left, right) {
  if (left === right) return 0;
  const leftPoints = Array.from(String(left));
  const rightPoints = Array.from(String(right));
  const limit = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < limit; index += 1) {
    const delta = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (delta !== 0) return delta;
  }
  return leftPoints.length - rightPoints.length;
}

const catalog = parameterSurfaceCatalog({ includeArchitecture: true });
const keys = catalog.map((item) => `${item.family}:${item.key}`);
const locale = [...keys].sort((a, b) => a.localeCompare(b));
const code = [...keys].sort(compareCodePoints);
const differingPositions = [];
for (let index = 0; index < Math.min(locale.length, code.length); index += 1) {
  if (locale[index] !== code[index]) differingPositions.push({ index, locale: locale[index], code: code[index] });
}

const fusionKeys = parameterSurfaceCatalog({ families: ['fusion'], includeArchitecture: true }).map((item) => item.key);
const relevantFusion = fusionKeys.filter((key) => key === 'use3LineConfirm' || key === 'useAtrFlipConfirm');
const demonstrationPairs = [['A', 'a'], ['ä', 'z'], ['2', 'A']].map(([left, right]) => ({
  left,
  right,
  locale: left.localeCompare(right),
  code: compareCodePoints(left, right),
}));

console.log(JSON.stringify({
  catalogSize: catalog.length,
  differingPositionCount: differingPositions.length,
  firstDifferingPositions: differingPositions.slice(0, 12),
  relevantFusion,
  demonstrationPairs,
}, null, 2));
'@ | node
```

Expected current result:

- `differingPositionCount` may be `0` for current catalog/runtime.
- demonstration pairs show `localeCompare` can differ from code-point ordering.

Decision:

- If the only diff remains comparator + two sort replacements, keep as preventive hardening.
- If current catalog semantics changed beyond ordering, stop and report before continuing.

- [ ] **Step 2: Add code-point catalog order regression**

Add this test after `all enabled catalog keys have patch support`:

```js
test('parameterSurfaceCatalog uses code-point ordering inside a family', () => {
  const fusionKeys = parameterSurfaceCatalog({
    families: ['fusion'],
    includeArchitecture: true,
  }).map((item) => item.key);

  const relevant = fusionKeys.filter((key) => key === 'use3LineConfirm' || key === 'useAtrFlipConfirm');
  assert.deepEqual(relevant, ['use3LineConfirm', 'useAtrFlipConfirm']);
});
```

This proves `3` sorts before `A` by code point. It fails under some locale-sensitive collations.

- [ ] **Step 2: Add fallback family order regression**

Add this test after `buildSurfaceMutationCandidates interleaves families so small cycles are broad`:

```js
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

- [ ] **Step 3: Verify implementation uses explicit code-point comparator**

`scripts/lib/pine-parameter-surface.mjs` must contain:

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

`parameterSurfaceCatalog()` must sort with:

```js
.sort((a, b) => familyOrderRank(a.family) - familyOrderRank(b.family) || compareCodePoints(a.key, b.key));
```

`buildSurfaceMutationCandidates()` queue sorting must use:

```js
.sort(([left], [right]) => familyOrderRank(left) - familyOrderRank(right) || compareCodePoints(left, right))
```

- [ ] **Step 4: Confirm no localeCompare remains in target file**

Run:

```bash
rg -n "localeCompare" scripts/lib/pine-parameter-surface.mjs
```

Expected: no output, exit 1 from `rg` is acceptable because there are no matches.

- [ ] **Step 5: Run parameter-surface tests**

Run:

```bash
node --test tests/pine-parameter-surface.test.mjs
```

Expected: all tests pass.

---

## Task 2: Add scheduler alias tests before scheduler implementation

**Files:**
- Modify: `tests/pine-regime-exit-scheduler.test.mjs`

- [ ] **Step 1: Import `resolveExhaustedResearchLanes`**

Change the import block at the top of `tests/pine-regime-exit-scheduler.test.mjs` to:

```js
import {
  allocateRegimeExitLaneBudget,
  resolveExhaustedResearchLanes,
  selectNextResearchLane,
  STAGNATION_LANE_METADATA,
} from '../scripts/lib/pine-regime-exit-scheduler.mjs';
```

- [ ] **Step 2: Add explicit alias canonicalization test**

Add this test after `stagnation metadata strictPromotionGates only enabled at level 3`:

```js
test('resolveExhaustedResearchLanes canonicalizes explicit generated lane aliases', () => {
  assert.deepEqual(
    resolveExhaustedResearchLanes({
      exhaustedLanes: ['exit-regime', 'global-all-parameter', 'exitRegime', 'globalAllParameter', 'unknown-lane'],
    }),
    ['exitRegime', 'globalAllParameter'],
  );
});
```

- [ ] **Step 3: Add persisted alias canonicalization test**

Add this test after the explicit alias test:

```js
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
```

- [ ] **Step 4: Add selection test for dashed `exit-regime` exhaustion**

Add this test after the persisted alias test:

```js
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
```

- [ ] **Step 5: Add terminal selection test for dashed `global-all-parameter` exhaustion**

Add this test after the dashed `exit-regime` selection test:

```js
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

- [ ] **Step 6: Run scheduler tests and confirm failure before implementation**

Run:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected before Task 3 implementation: tests involving dashed aliases fail because scheduler ignores dashed keys.

If tests already pass before Task 3, inspect `scripts/lib/pine-regime-exit-scheduler.mjs` because another worker may have already implemented alias support.

---

## Task 3: Normalize generated lane aliases in scheduler read path

**Files:**
- Modify: `scripts/lib/pine-regime-exit-scheduler.mjs`

- [ ] **Step 1: Replace `normalizeLaneKey()` narrowly**

Replace current function:

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

Do not accept case-insensitive variants, underscore variants, plural variants, or arbitrary slug conversion. Bad state should remain visible instead of silently normalized.

- [ ] **Step 2: Keep `resolveExhaustedResearchLanes()` canonical**

The function must remain equivalent to:

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

Do not rewrite persisted scheduler state in this task.

- [ ] **Step 3: Run scheduler tests**

Run:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: all scheduler tests pass.

---

## Task 4: Add `runScout()` integration regression for dashed persisted global exhaustion

**Files:**
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Locate existing terminal no-lane test**

Run:

```bash
rg -n "runScout returns terminal no-lane hold" tests/pine-autoresearch.test.mjs
```

Expected: one existing canonical no-lane test.

- [ ] **Step 2: Add dashed persisted exhaustion regression**

Add this test immediately after the existing canonical terminal no-lane test:

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

- [ ] **Step 3: Run focused integration tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "terminal no-lane|dashed persisted global lane"
```

Expected: pass. If the canonical test passes but dashed test fails, scheduler alias read path is still incomplete.

---

## Task 5: Add a local unattended readiness checklist command to the plan, not code

**Files:** none

This task defines the command sequence operators must run before unmonitored cycle-only use. Do not add a script in this plan; scripts can be added in a later ops plan if this checklist proves stable.

- [ ] **Step 1: Verify no code/config drift**

Run:

```bash
git status --short --branch
```

Expected after implementation and commit:

```text
## main...origin/main [ahead 8]
?? docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md
?? docs/superpowers/plans/2026-05-10-autoresearch-unattended-safety-hardening.md
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
```

If code/test files are still modified, do not run unattended.

- [ ] **Step 2: Verify locks and processes**

Run the lock/process inspection from Task 0 Step 3.

Expected: no real running autoresearch process and no locks.

- [ ] **Step 3: Verify promotion queue is empty or intentionally blocking**

Run:

```powershell
$queue = 'pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/promotion-queue.jsonl'
if (Test-Path $queue) {
  Get-Item $queue | Select-Object FullName,Length,LastWriteTime | Format-List
  Get-Content $queue -Tail 10
} else {
  Write-Host 'MISSING promotion queue file'
}
```

Expected for unattended cycle-only run:

- file may exist with length `0`, or
- no pending promotion item, or
- pending promotion intentionally causes `cycle` to skip unless operator uses `--force-cycle`

Do not run unattended if there is an unexplained pending promotion.

- [ ] **Step 4: Verify latest manifest state**

Run:

```powershell
node -e "const fs=require('fs'); const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json'; const m=JSON.parse(fs.readFileSync(p,'utf8')); const variants=m.searchPlan?.variants||[]; console.log(JSON.stringify({runId:m.runId, selectedLane:m.shadowRegimeScoreboard?.selectedLane, noNewCandidate:m.noNewCandidate, variantCount:variants.length, allHavePatchFingerprint:variants.every(v=>Boolean(v.patchFingerprint||v.metadata?.patchFingerprint)), promotionEligible:m.promotionEligible, failedGates:m.matrixDecision?.failedGates}, null, 2));"
```

Expected before unattended cycle-only run:

- `promotionEligible` is `false`, or any promotion is intentionally queue-blocked
- generated variants have fingerprints when variant count > 0
- no malformed latest JSON

- [ ] **Step 5: Run production-root invariant check explicitly**

Run:

```bash
$env:PINE_AUTORESEARCH_PRODUCTION_INVARIANTS='required'; node --test tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: pass against real configured production root. If this fails because production root is not configured, do not call unattended safe; fix the invariant configuration first or run with `PINE_AUTORESEARCH_PRODUCTION_ROOT` pointing at `pine/autoresearch/pine-fusion-v4-core-15m-locked-window`.

---

## Task 6: Verification matrix

**Files:** none

- [ ] **Step 1: Focused surface + scheduler tests**

Run:

```bash
node --test tests/pine-parameter-surface.test.mjs tests/pine-regime-exit-scheduler.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Focused generated-lane integration tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "exitRegime|globalAllParameter|terminal no-lane|dashed persisted global lane"
```

Expected: all selected tests pass.

- [ ] **Step 3: Full hardening gate**

Run:

```bash
npm run test:pine:autoresearch:hardening
```

Expected: pass. Known acceptable result is `189 pass / 0 fail / 1 skipped` only when the skipped test is the production-root invariant fixture-mode skip. If any non-production-root test fails, stop.

- [ ] **Step 4: Production-root invariant required gate**

Run:

```bash
$env:PINE_AUTORESEARCH_PRODUCTION_INVARIANTS='required'; node --test tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: pass. If it skips or fails due to missing production root, unattended safety is not proven.

- [ ] **Step 5: Diff hygiene**

Run:

```bash
git diff --check
```

Expected: no output, exit 0.

- [ ] **Step 6: Scope guard**

Run:

```bash
git status --short
```

Expected modified files before commit only:

```text
 M scripts/lib/pine-parameter-surface.mjs
 M scripts/lib/pine-regime-exit-scheduler.mjs
 M tests/pine-autoresearch.test.mjs
 M tests/pine-parameter-surface.test.mjs
 M tests/pine-regime-exit-scheduler.test.mjs
?? docs/superpowers/plans/2026-05-10-autoresearch-lane-alias-and-sort-hardening.md
?? docs/superpowers/plans/2026-05-10-autoresearch-unattended-safety-hardening.md
?? docs/superpowers/plans/2026-05-10-progressive-pine-autoresearch-parameter-surface.md
```

No config/state/manifest artifacts should be modified.

---

## Task 7: Commit code/tests only

**Files:** code/tests only

- [ ] **Step 1: Stage code and tests**

Run:

```bash
git add scripts/lib/pine-parameter-surface.mjs scripts/lib/pine-regime-exit-scheduler.mjs tests/pine-autoresearch.test.mjs tests/pine-parameter-surface.test.mjs tests/pine-regime-exit-scheduler.test.mjs
```

Do not stage plan docs unless the user explicitly asks to version-control docs.

- [ ] **Step 2: Commit**

Run:

```bash
git commit -m "fix(pine): harden unattended generated lane exhaustion"
```

- [ ] **Step 3: Confirm final code status**

Run:

```bash
git status --short --branch
git log --oneline -8
```

Expected:

- branch ahead count increases from 7 to 8
- no modified code/test files remain
- untracked plan docs may remain

---

## Task 8: Final unattended-safety report template

Use this exact structure in the final report. Do not add vague claims.

```markdown
Verdict: [safe for unattended cycle-only / not safe yet]

Evidence:
- Branch/status: [...]
- Parameter surface deterministic ordering: [test command + result]
- Scheduler alias exhaustion: [test command + result]
- runScout dashed exhaustion no-sweep regression: [test command + result]
- Hardening suite: [test command + result]
- Production-root invariant required: [test command + result]
- Locks/processes: [inspection result]
- Promotion queue: [empty / pending and intentionally blocking]

Committed change:
- Commit: [sha] `fix(pine): harden unattended generated lane exhaustion`
- Files changed: [list]

What changed and why:
- `PS-ORDER-001`: after analysis, kept/reverted [choose one]. If kept: replaced locale-sensitive sort with code-point comparator as preventive deterministic-order hardening; not claimed as a reproduced latest-run bug.
- `LANE-ALIAS-001`: scheduler now reads exact dashed generated-lane aliases as canonical exhausted lanes so stale/mixed state cannot reselect exhausted generated lanes.

Boundaries:
- No profitability improvement claimed.
- No config/state/manifest mutation performed by the fix.
- Autopromote remains outside unattended approval unless separately reviewed.
```

---

## Subagent handoff prompts

### Implementation subagent prompt

Use this prompt if dispatching implementation:

```text
You are implementing `docs/superpowers/plans/2026-05-10-autoresearch-unattended-safety-hardening.md` in `D:/Code/Experiment/backtest-kit-project`.

Follow the plan exactly. Do not modify config files, production autoresearch state, manifests, latest pointers, run artifacts, promotion queue, scoring, objective policy, or scheduler install scripts.

Your scope is only:
- `scripts/lib/pine-parameter-surface.mjs`
- `scripts/lib/pine-regime-exit-scheduler.mjs`
- `tests/pine-parameter-surface.test.mjs`
- `tests/pine-regime-exit-scheduler.test.mjs`
- `tests/pine-autoresearch.test.mjs`

Start with Task 0 preflight. If repo state differs from expected, stop and report.

Implement Tasks 1-4 using TDD. Run Task 6 verification except commit only if explicitly instructed by main session. Return exact commands/results and `git status --short`.
```

### Review subagent prompt

Use this prompt if dispatching review:

```text
Review the diff in `D:/Code/Experiment/backtest-kit-project` against `docs/superpowers/plans/2026-05-10-autoresearch-unattended-safety-hardening.md`.

Do not edit files.

Check:
1. Scope: only allowed code/test files changed.
2. Parameter surface: no `localeCompare` remains in `scripts/lib/pine-parameter-surface.mjs`; no catalog/family/ladder semantics changed.
3. Scheduler: `normalizeLaneKey()` accepts exactly `exit-regime` and `global-all-parameter` aliases plus canonical lane names; no broad slug/case normalization.
4. Tests: scheduler alias unit tests exist; runScout dashed persisted global exhaustion regression exists and proves primary sweep is not called.
5. No config/state/manifest/promotion files changed.
6. Verification commands were run and passed.

Return Critical / Important / Nice-to-have findings with evidence. If none, say APPROVED and list proof.
```

---

## Self-review checklist

- Spec coverage:
  - Track what changed, when, and why: change ledger section.
  - Parameter surface unmonitored concern: Tasks 1, 5, 6, 8.
  - Other known finding: scheduler alias hardening Tasks 2-4.
  - Whole plan clear for subagents: file scope, exact code snippets, commands, stop conditions, handoff prompts.
  - No fatal drift: non-negotiable worker rules and do-not-modify list.
- Placeholder scan:
  - No `TBD`.
  - No vague “add tests” without exact tests.
  - No “similar to” instructions that require guessing.
- Type/signature consistency:
  - `resolveExhaustedResearchLanes` import path matches current scheduler module.
  - Canonical lane names are `exitRegime`, `globalAllParameter`.
  - Accepted aliases are exactly `exit-regime`, `global-all-parameter`.
  - The integration test uses existing helper names already present in `tests/pine-autoresearch.test.mjs`: `autoresearchCli`, `globalAllParameterChampion`, `buildChampionConfigFingerprint`.
