# Pine Autoresearch Regime-Aware Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Pine autoresearch from preview-only regime metadata into a production-grade, auditable regime-aware research loop with complete artifacts, safe promotion gates, robust scheduler behavior, and profitability-first acceptance criteria.

**Architecture:** Split orchestration into explicit stages: plan lanes before variants, generate lane-specific candidates, evaluate, finalize artifacts atomically, then gate promotion. The manifest becomes the only trusted decision artifact; raw evaluation folders without manifests are treated as incomplete runs. Safety gates distinguish operator blockers from failed strategy gates, so force cannot bypass evidence requirements.

**Tech Stack:** Node.js ESM scripts, `node:test`, PowerShell scheduler wrapper, JSON/JSONL artifacts, Pine strategy fixtures, existing backtest-kit CLI.

---

## Source Audit Summary

Current verified repo state during audit:
- Repo: `D:/Code/Experiment/backtest-kit-project`
- Branch: `main`
- HEAD: `e52dc1b`
- Tracked state: clean

Surviving flaws to fix:
1. `exitRegime` is selected but `shadowRegimeScoreboard.generatorSummary.previewOnly === true` and `candidateCount === 0`.
2. `buildExitFamilyCandidates` and `buildGlobalMutationBatch` are imported in `scripts/pine-autoresearch.mjs` but not used in actual variant generation.
3. Latest complete manifest is older than latest raw evaluation dirs; raw dirs `2026-05-06T23-22-36-112Z` and `2026-05-07T00-05-18-634Z` have no matching manifest.
4. Latest variants use `track` / `self-loop-fallback`, not real `exitRegime` or `globalAllParameter` lanes.
5. `canForceQueuedPromotion()` returns true for every `blocked` status.
6. `selectNextResearchLane()` returns `metadata.preferredLane` before honoring `budgetDebt`.
7. Matrix decision can report `shadowPassRatio: 1` with zero shadow labs.
8. Blind holdout config exists, but latest decision has `holdoutVerdict: null`.
9. Profitability thresholds allow zero ROI/profit-factor improvement.
10. Top-level `--help` can enter normal command loading/lock path.

---

## File Map

### Modify
- `scripts/pine-autoresearch.mjs`
  - Move regime lane selection before candidate generation.
  - Replace preview-only regime state with real generation result summary.
  - Add safe `--help` handling before config load / lock acquisition.
  - Enforce manifest finalization and incomplete-run markers.
  - Split promotion force safety statuses.

- `scripts/lib/pine-regime-exit-scheduler.mjs`
  - Fix debt-first lane selection.
  - Make preferred lane a tie-breaker, not an override.
  - Persist lane usage/debt after every finalized run.

- `scripts/lib/pine-exit-generators.mjs`
  - Ensure generated exit-regime candidates have explicit lane/family/patch metadata.
  - Add deterministic guards for zero-candidate cases.

- `scripts/lib/pine-global-search.mjs`
  - Ensure generated global-all-parameter candidates have explicit lane/family/patch metadata.
  - Add max-width and tabu/fingerprint behavior.

- `scripts/ops/pine-autoresearch-run.ps1`
  - Treat run without manifest as failure.
  - Emit terminal status summary.
  - Keep timeout/process-tree hardening.

- `config/pine-autoresearch.default.json`
  - Set production-safe defaults.
  - Tighten holdout and profitability gates.

- `tests/pine-autoresearch.test.mjs`
  - Add integration tests for real lane variant generation, manifest finalization, force status separation, zero-shadow ratio, safe help behavior.

- `tests/pine-regime-exit-scheduler.test.mjs`
  - Add scheduler debt-first tests. Create file if absent.

- `tests/pine-autoresearch-artifacts.test.mjs`
  - Add artifact completeness tests. Create file.

- `package.json`
  - Add targeted test scripts for hardening suite if useful.

### Create
- `scripts/lib/pine-autoresearch-artifacts.mjs`
  - Atomic run artifact lifecycle: start marker, manifest finalize, incomplete marker, latest pointer validation.

- `scripts/lib/pine-promotion-status.mjs`
  - Typed promotion statuses and forceability policy.

- `docs/pine-autoresearch-operational-runbook.md`
  - Operator rules for manifests, incomplete dirs, promotion force, recovery.

---

## Acceptance Gates

A run is production-acceptable only if all are true:
1. Selected lane appears in `searchPlan.variants[*].lane` at least once unless lane is explicitly disabled.
2. `exitRegime` run has `generatorSummary.previewOnly === false` and `candidateCount > 0`.
3. Every evaluation run dir has one of:
   - matching manifest in `manifests/<runId>.json`, or
   - explicit `incomplete/<runId>.json` with reason, startedAt, endedAt, process info.
4. `latest.json` never points to an incomplete run.
5. Promotion force is allowed only for operator/queue failures, never failed matrix/expectancy/holdout gates.
6. Shadow pass ratio is `0` or `null` when shadow lab denominator is zero, never `1`.
7. Blind holdout verdict is required for promotion when holdout labs are configured.
8. Profitability gate requires meaningful minimum ROI/profit-factor improvement, not zero-delta acceptance.
9. `node scripts/pine-autoresearch.mjs --help` prints help and does not load config, acquire locks, or run a cycle.
10. Full targeted tests pass.

---

## Task 1: Add Safe CLI Help Before Operational Path

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing test for top-level help**

Add this test near existing CLI/lock tests in `tests/pine-autoresearch.test.mjs`:

```js
test('pine-autoresearch --help exits before config load or lock acquisition', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const result = await spawnNode([
    path.join(repoRoot, 'scripts/pine-autoresearch.mjs'),
    '--help',
  ], {
    cwd: repoRoot,
    env: { ...process.env, PINE_AUTORESEARCH_TEST_TRACE_CONFIG_LOAD: '1' },
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:.*pine-autoresearch/i);
  assert.doesNotMatch(result.stdout + result.stderr, /cycle=|lock|manifest=|recommendation=/i);
});
```

If `spawnNode` helper does not exist, add this helper in the same test file:

```js
function spawnNode(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "help exits"
```

Expected before implementation: fail because help is not handled before operational setup.

- [ ] **Step 3: Implement help branch**

In `scripts/pine-autoresearch.mjs`, add:

```js
function isHelpRequest(argv = []) {
  return argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}

function formatAutoresearchHelp() {
  return [
    'Usage: node scripts/pine-autoresearch.mjs <command> [options]',
    '',
    'Commands:',
    '  cycle        Run scout/autoresearch cycle (default)',
    '  scout        Alias for cycle',
    '  digest       Write digest from latest manifest',
    '  promote      Promote queued manifest when gates pass',
    '  autopromote  Evaluate promotion queue',
    '',
    'Options:',
    '  --config <path>       Config file path',
    '  --profile <name>      Profile name',
    '  --force-cycle         Ignore cycle cadence guard',
    '  --force               Operator force for explicitly forceable queue blockers only',
    '  --help, -h            Print this help without loading config or acquiring locks',
  ].join('\n');
}
```

At the top of `main()` before `parseArgs()` config use:

```js
async function main() {
  const rawArgs = process.argv.slice(2);
  if (isHelpRequest(rawArgs)) {
    console.log(formatAutoresearchHelp());
    return;
  }

  const args = parseArgs(rawArgs);
  const command = args._[0] || 'cycle';
  // existing code continues
}
```

- [ ] **Step 4: Run help test**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "help exits"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): make autoresearch help non-operational"
```

---

## Task 2: Fix Debt-First Regime Lane Selection

**Files:**
- Modify: `scripts/lib/pine-regime-exit-scheduler.mjs`
- Create/Modify: `tests/pine-regime-exit-scheduler.test.mjs`

- [ ] **Step 1: Write failing debt-priority test**

Create `tests/pine-regime-exit-scheduler.test.mjs` if absent:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectNextResearchLane } from '../scripts/lib/pine-regime-exit-scheduler.mjs';

test('selectNextResearchLane pays highest budget debt before preferred stagnation lane', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: {
      exploit: 0,
      exitRegime: 0,
      globalAllParameter: 9,
      robustness: 2,
    },
    lanesEnabled: {
      exploit: true,
      exitRegime: true,
      globalAllParameter: true,
      robustness: true,
    },
  });

  assert.equal(lane, 'globalAllParameter');
});

test('selectNextResearchLane uses preferred lane as tie-breaker after debt', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: {
      exploit: 0,
      exitRegime: 0,
      globalAllParameter: 0,
      robustness: 0,
    },
    lanesEnabled: {
      exploit: true,
      exitRegime: true,
      globalAllParameter: true,
      robustness: true,
    },
  });

  assert.equal(lane, 'exitRegime');
});
```

- [ ] **Step 2: Run failing scheduler tests**

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected before implementation: first test fails because preferred lane wins before debt.

- [ ] **Step 3: Implement debt-first selection**

In `scripts/lib/pine-regime-exit-scheduler.mjs`, replace the preferred-lane early return with debt-first sort:

```js
const preferredLane = candidates.includes(metadata.preferredLane) ? metadata.preferredLane : null;

candidates.sort((a, b) => {
  const debtA = Number(budgetDebt[a] ?? 0);
  const debtB = Number(budgetDebt[b] ?? 0);

  if (debtB !== debtA) return debtB - debtA;
  if (preferredLane) {
    if (a === preferredLane && b !== preferredLane) return -1;
    if (b === preferredLane && a !== preferredLane) return 1;
  }
  return priority.indexOf(a) - priority.indexOf(b);
});

return candidates[0];
```

- [ ] **Step 4: Run scheduler tests**

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-regime-exit-scheduler.mjs tests/pine-regime-exit-scheduler.test.mjs
git commit -m "fix(pine): prioritize regime lane budget debt"
```

---

## Task 3: Introduce Real Regime Lane Candidate Planner

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-exit-generators.mjs`
- Modify: `scripts/lib/pine-global-search.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing generation test**

Add to `tests/pine-autoresearch.test.mjs`:

```js
test('buildRegimeAwareSearchBatch injects selected exitRegime candidates', () => {
  const champion = {
    useRegimeFilter: false,
    useTrailingStop: true,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    useStopsTP: true,
    slAtrMult: 0.5,
    tpAtrMult: 7.6,
    useDivergenceContext: true,
    divFreshBars: 8,
  };

  const batch = buildRegimeAwareSearchBatch({
    selectedLane: 'exitRegime',
    champion,
    maxConfigs: 8,
    historyEvents: [],
    policy: {
      exploitRatio: 0.25,
      paretoShortlistSize: 2,
      matrixCandidateLimit: 2,
    },
    schedulerState: {},
    regimeExitResearch: {
      enabled: true,
      exitRegimeEnabled: true,
      globalAllParameterEnabled: true,
    },
  });

  assert.ok(batch.length > 0);
  assert.ok(batch.some((variant) => variant.lane === 'exitRegime'));
  assert.ok(batch.every((variant) => variant.variantId));
  assert.ok(batch.every((variant) => variant.config));
  assert.ok(batch.every((variant) => variant.patch && Object.keys(variant.patch).length > 0));
});
```

Export `buildRegimeAwareSearchBatch` from `scripts/pine-autoresearch.mjs` for testing.

- [ ] **Step 2: Run failing test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "buildRegimeAwareSearchBatch"
```

Expected before implementation: fail because function/export does not exist or returns incumbent-only variants.

- [ ] **Step 3: Implement batch planner**

Add to `scripts/pine-autoresearch.mjs` near search helpers:

```js
export function buildRegimeAwareSearchBatch({
  selectedLane,
  champion,
  maxConfigs,
  historyEvents = [],
  policy = {},
  schedulerState = {},
  regimeExitResearch = {},
} = {}) {
  const safeMaxConfigs = Math.max(0, Math.floor(Number(maxConfigs) || 0));
  if (!champion || safeMaxConfigs <= 0) return [];

  if (regimeExitResearch?.enabled === true && selectedLane === 'exitRegime') {
    const candidates = buildExitFamilyCandidates({
      champion,
      maxConfigs: safeMaxConfigs,
      historyEvents,
      schedulerState,
      policy,
    });
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates.slice(0, safeMaxConfigs).map((candidate, index) => ({
        ...candidate,
        lane: 'exitRegime',
        family: candidate.family || 'exit',
        variantId: candidate.variantId || `exit-regime-${String(index + 1).padStart(2, '0')}`,
        index,
      }));
    }
  }

  if (regimeExitResearch?.enabled === true && selectedLane === 'globalAllParameter') {
    const candidates = buildGlobalMutationBatch({
      champion,
      maxConfigs: safeMaxConfigs,
      historyEvents,
      schedulerState,
      policy,
    });
    if (Array.isArray(candidates) && candidates.length > 0) {
      return candidates.slice(0, safeMaxConfigs).map((candidate, index) => ({
        ...candidate,
        lane: 'globalAllParameter',
        family: candidate.family || 'global',
        variantId: candidate.variantId || `global-all-${String(index + 1).padStart(2, '0')}`,
        index,
      }));
    }
  }

  return buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: safeMaxConfigs,
    historyEvents,
    policy,
    schedulerState,
  });
}
```

If `buildExitFamilyCandidates` / `buildGlobalMutationBatch` currently use different parameter names, update adapters in their modules so both accept `{ champion, maxConfigs, historyEvents, schedulerState, policy }` and return variants shaped as:

```js
{
  variantId: 'exit-regime-01',
  lane: 'exitRegime',
  family: 'exit',
  patch: { trailAtrMult: 1.25 },
  config: { ...champion, trailAtrMult: 1.25 },
}
```

- [ ] **Step 4: Wire planner into `runScout` before primary sweep**

Replace the old `searchBatch` / fallback block with:

```js
const regimeExitStateSeed = buildRegimeExitStateForScout({
  config: trackedConfig,
  championState,
  historyEventsBefore,
  searchBatch: [],
  offlineDataSummary,
  schedulerState,
});
const selectedRegimeLane = regimeExitStateSeed?.shadowRegimeScoreboard?.selectedLane || null;

const searchVariants = buildRegimeAwareSearchBatch({
  selectedLane: selectedRegimeLane,
  champion: championState.config,
  maxConfigs: trackedConfig.maxConfigs,
  historyEvents: historyEventsBefore,
  policy: trackedConfig.searchPolicy,
  schedulerState,
  regimeExitResearch: trackedConfig.regimeExitResearch,
});
```

Then pass real `searchVariants` into final `buildRegimeExitStateForScout()`.

- [ ] **Step 5: Run targeted test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "buildRegimeAwareSearchBatch"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/pine-autoresearch.mjs scripts/lib/pine-exit-generators.mjs scripts/lib/pine-global-search.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): generate real regime-aware search variants"
```

---

## Task 4: Replace Preview-Only Regime Summary With Auditable Generator Summary

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing manifest summary test**

```js
test('buildRegimeExitStateForScout reports real candidate counts without previewOnly when selected lane generated variants', () => {
  const state = buildRegimeExitStateForScout({
    config: {
      regimeExitResearch: {
        enabled: true,
        offline: { mode: 'local-first' },
        budget: {
          exploitRatio: 0.25,
          exitRegimeRatio: 0.35,
          globalAllParameterRatio: 0.25,
          robustnessRatio: 0.15,
        },
      },
      maxConfigs: 8,
    },
    championState: { config: { useTrailingStop: true, trailAtrMult: 1 } },
    searchBatch: [
      { variantId: 'exit-regime-01', lane: 'exitRegime', family: 'exit', patch: { trailAtrMult: 1.25 }, config: { trailAtrMult: 1.25 } },
      { variantId: 'exit-regime-02', lane: 'exitRegime', family: 'exit', patch: { trailAtrMult: 0.75 }, config: { trailAtrMult: 0.75 } },
    ],
    schedulerState: { stagnationLevel: 0 },
    offlineDataSummary: { ok: true, mode: 'local-first', requiredLabs: [], missingLabs: [] },
  });

  assert.equal(state.shadowRegimeScoreboard.selectedLane, 'exitRegime');
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.previewOnly, false);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.candidateCount, 2);
  assert.equal(state.shadowRegimeScoreboard.generatorSummary.countSource, 'generatedVariants');
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "reports real candidate counts"
```

Expected before implementation: fail because `previewOnly` is always true.

- [ ] **Step 3: Implement summary logic**

Replace `summarizeRegimeLaneGenerator()` body with:

```js
function summarizeRegimeLaneGenerator({ selectedLane, searchBatch = [] } = {}) {
  const generatedForLane = Array.isArray(searchBatch)
    ? searchBatch.filter((variant) => variant?.lane === selectedLane)
    : [];

  return {
    lane: selectedLane || null,
    laneKind: selectedLane || null,
    candidateCount: generatedForLane.length,
    previewOnly: generatedForLane.length === 0,
    countSource: generatedForLane.length > 0 ? 'generatedVariants' : 'none',
    blockedFamilyCount: null,
    variantIds: generatedForLane.map((variant) => variant.variantId).filter(Boolean).slice(0, 20),
  };
}
```

- [ ] **Step 4: Run targeted tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "RegimeExitState|candidate counts|buildRegimeAwareSearchBatch"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): make regime generator summaries auditable"
```

---

## Task 5: Add Atomic Artifact Lifecycle and Incomplete Run Markers

**Files:**
- Create: `scripts/lib/pine-autoresearch-artifacts.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Create: `tests/pine-autoresearch-artifacts.test.mjs`

- [ ] **Step 1: Write artifact lifecycle tests**

Create `tests/pine-autoresearch-artifacts.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  beginAutoresearchRunArtifact,
  finalizeAutoresearchManifest,
  markAutoresearchRunIncomplete,
  validateLatestManifestPointer,
} from '../scripts/lib/pine-autoresearch-artifacts.mjs';

test('artifact lifecycle writes incomplete marker when manifest is not finalized', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const runId = 'run-001';
  const started = await beginAutoresearchRunArtifact({ root, runId, profile: 'full' });

  assert.ok(fs.existsSync(started.startedPath));

  const incomplete = await markAutoresearchRunIncomplete({
    root,
    runId,
    reason: 'process_exit_without_manifest',
    error: 'missing manifest',
  });

  assert.ok(fs.existsSync(incomplete.incompletePath));
  const payload = JSON.parse(fs.readFileSync(incomplete.incompletePath, 'utf8'));
  assert.equal(payload.runId, runId);
  assert.equal(payload.reason, 'process_exit_without_manifest');
});

test('finalizeAutoresearchManifest writes manifest then latest pointer atomically', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const manifest = { runId: 'run-002', generatedAt: '2026-05-07T00:00:00.000Z', matrixDecision: { recommendation: 'hold' } };

  const result = await finalizeAutoresearchManifest({ root, manifest });

  assert.ok(fs.existsSync(result.manifestPath));
  assert.ok(fs.existsSync(path.join(root, 'latest.json')));
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'latest.json'), 'utf8'));
  assert.equal(latest.runId, 'run-002');
});

test('validateLatestManifestPointer rejects latest pointer without manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ runId: 'run-missing' }), 'utf8');

  const result = validateLatestManifestPointer({ root });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'latest_manifest_missing');
});
```

- [ ] **Step 2: Run failing artifact tests**

```bash
node --test tests/pine-autoresearch-artifacts.test.mjs
```

Expected before implementation: fail because module does not exist.

- [ ] **Step 3: Implement artifact module**

Create `scripts/lib/pine-autoresearch-artifacts.mjs`:

```js
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function beginAutoresearchRunArtifact({ root, runId, profile, now = new Date() }) {
  const startedPath = path.join(root, 'runs', `${runId}.started.json`);
  await writeJsonAtomic(startedPath, {
    runId,
    profile: profile || null,
    pid: process.pid,
    startedAt: now.toISOString(),
  });
  return { startedPath };
}

export async function finalizeAutoresearchManifest({ root, manifest }) {
  if (!manifest?.runId) throw new Error('manifest.runId is required');
  const manifestPath = path.join(root, 'manifests', `${manifest.runId}.json`);
  const latestPath = path.join(root, 'latest.json');
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(latestPath, { ...manifest, manifestPath });
  return { manifestPath, latestPath };
}

export async function markAutoresearchRunIncomplete({ root, runId, reason, error, now = new Date() }) {
  const incompletePath = path.join(root, 'incomplete', `${runId}.json`);
  await writeJsonAtomic(incompletePath, {
    runId,
    reason: reason || 'unknown',
    error: error ? String(error) : null,
    pid: process.pid,
    endedAt: now.toISOString(),
  });
  return { incompletePath };
}

export function validateLatestManifestPointer({ root }) {
  const latestPath = path.join(root, 'latest.json');
  if (!fsSync.existsSync(latestPath)) return { ok: false, reason: 'latest_missing' };
  let latest;
  try {
    latest = JSON.parse(fsSync.readFileSync(latestPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'latest_invalid_json', error: String(error?.message || error) };
  }
  const runId = latest?.runId;
  if (!runId) return { ok: false, reason: 'latest_run_id_missing' };
  const manifestPath = path.join(root, 'manifests', `${runId}.json`);
  if (!fsSync.existsSync(manifestPath)) return { ok: false, reason: 'latest_manifest_missing', runId, manifestPath };
  return { ok: true, runId, manifestPath };
}
```

- [ ] **Step 4: Wire into `runScout`**

In `scripts/pine-autoresearch.mjs` import:

```js
import {
  beginAutoresearchRunArtifact,
  finalizeAutoresearchManifest,
  markAutoresearchRunIncomplete,
} from './lib/pine-autoresearch-artifacts.mjs';
```

At run start after `runId` exists:

```js
await beginAutoresearchRunArtifact({
  root: trackedConfig.researchRoot,
  runId,
  profile: trackedConfig.selectedProfile,
});
```

Where manifest/latest are currently written, replace direct writes with:

```js
await finalizeAutoresearchManifest({
  root: trackedConfig.researchRoot,
  manifest,
});
```

Wrap `runScout` main body:

```js
try {
  // existing run body
} catch (error) {
  await markAutoresearchRunIncomplete({
    root: trackedConfig.researchRoot,
    runId,
    reason: 'run_failed_before_manifest',
    error: error?.stack || error?.message || String(error),
  });
  throw error;
}
```

- [ ] **Step 5: Run artifact tests**

```bash
node --test tests/pine-autoresearch-artifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch-artifacts.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-artifacts.test.mjs
git commit -m "feat(pine): track incomplete autoresearch runs"
```

---

## Task 6: Make Scheduler Wrapper Fail When Manifest Missing

**Files:**
- Modify: `scripts/ops/pine-autoresearch-run.ps1`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing wrapper test**

Add to `tests/pine-autoresearch.test.mjs` near scheduler wrapper tests:

```js
test('scheduler wrapper reports failure when command exits zero without manifest marker', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-wrapper-manifest-'));
  const commandPath = path.join(tempRoot, 'fake-command.ps1');
  fs.writeFileSync(commandPath, 'Write-Output "fake success without manifest"\nexit 0\n', 'utf8');

  const wrapper = path.resolve(import.meta.dirname, '../scripts/ops/pine-autoresearch-run.ps1');
  const result = await spawnProcess('pwsh', [
    '-NoProfile',
    '-File', wrapper,
    '-CommandPath', commandPath,
    '-RequireManifest',
    '-ManifestRoot', tempRoot,
    '-ExpectedRunId', 'missing-run',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /manifest.*missing|missing.*manifest/i);
});
```

Add helper if needed:

```js
function spawnProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "zero without manifest"
```

Expected before implementation: fail because wrapper does not require manifest.

- [ ] **Step 3: Implement wrapper params and manifest check**

In `scripts/ops/pine-autoresearch-run.ps1`, add params:

```powershell
[Parameter(Mandatory = $false)]
[switch] $RequireManifest,

[Parameter(Mandatory = $false)]
[string] $ManifestRoot,

[Parameter(Mandatory = $false)]
[string] $ExpectedRunId
```

After child process exits successfully, add:

```powershell
if ($RequireManifest) {
  if ([string]::IsNullOrWhiteSpace($ManifestRoot) -or [string]::IsNullOrWhiteSpace($ExpectedRunId)) {
    Write-Error "RequireManifest needs ManifestRoot and ExpectedRunId"
    exit 64
  }

  $manifestPath = Join-Path $ManifestRoot (Join-Path "manifests" ("$ExpectedRunId.json"))
  $incompletePath = Join-Path $ManifestRoot (Join-Path "incomplete" ("$ExpectedRunId.json"))

  if (-not (Test-Path -LiteralPath $manifestPath)) {
    if (Test-Path -LiteralPath $incompletePath) {
      Write-Error "autoresearch manifest missing; incomplete marker exists: $incompletePath"
    } else {
      Write-Error "autoresearch manifest missing and no incomplete marker exists: $manifestPath"
    }
    exit 65
  }
}
```

- [ ] **Step 4: Run wrapper test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "zero without manifest"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ops/pine-autoresearch-run.ps1 tests/pine-autoresearch.test.mjs
git commit -m "fix(ops): fail autoresearch wrapper when manifest is missing"
```

---

## Task 7: Split Promotion Statuses and Restrict Force

**Files:**
- Create: `scripts/lib/pine-promotion-status.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing forceability tests**

Replace unsafe expectations and add explicit tests:

```js
test('canForceQueuedPromotion rejects failed strategy safety gates', () => {
  assert.equal(canForceQueuedPromotion({ status: 'safety_failed', reason: 'matrix gates failed' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'expectancy_failed', reason: 'expectancy regression' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'holdout_failed', reason: 'blind holdout failed' }), false);
});

test('canForceQueuedPromotion allows only operator recoverable blockers', () => {
  assert.equal(canForceQueuedPromotion({ status: 'operator_blocked', reason: 'manual queue approval required' }), true);
  assert.equal(canForceQueuedPromotion({ status: 'queue_blocked', reason: 'queue lock stale' }), true);
  assert.equal(canForceQueuedPromotion({ status: 'stale', reason: 'already promoted' }), false);
  assert.equal(canForceQueuedPromotion({ status: 'invalid', reason: 'fingerprint mismatch' }), false);
});
```

Update old tests that expected force true for failed gates:

```js
assert.equal(result.status, 'safety_failed');
assert.equal(canForceQueuedPromotion(result), false);
```

- [ ] **Step 2: Run failing tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "canForceQueuedPromotion|autopromote gates|regime switch"
```

Expected before implementation: fail because blocked remains forceable.

- [ ] **Step 3: Create status module**

Create `scripts/lib/pine-promotion-status.mjs`:

```js
export const PROMOTION_STATUS = Object.freeze({
  PROMOTED: 'promoted',
  OPERATOR_BLOCKED: 'operator_blocked',
  QUEUE_BLOCKED: 'queue_blocked',
  SAFETY_FAILED: 'safety_failed',
  EXPECTANCY_FAILED: 'expectancy_failed',
  HOLDOUT_FAILED: 'holdout_failed',
  STALE: 'stale',
  INVALID: 'invalid',
});

export function isForceablePromotionStatus(status) {
  return status === PROMOTION_STATUS.OPERATOR_BLOCKED || status === PROMOTION_STATUS.QUEUE_BLOCKED;
}

export function classifyPromotionHoldReason(reason = '') {
  const text = String(reason);
  if (/expectancy/i.test(text)) return PROMOTION_STATUS.EXPECTANCY_FAILED;
  if (/holdout|blind/i.test(text)) return PROMOTION_STATUS.HOLDOUT_FAILED;
  if (/matrix|gate|anchor|cooldown|promotion/i.test(text)) return PROMOTION_STATUS.SAFETY_FAILED;
  if (/queue|lock|operator|manual/i.test(text)) return PROMOTION_STATUS.QUEUE_BLOCKED;
  return PROMOTION_STATUS.SAFETY_FAILED;
}
```

- [ ] **Step 4: Wire status policy**

In `scripts/pine-autoresearch.mjs`, import:

```js
import { classifyPromotionHoldReason, isForceablePromotionStatus, PROMOTION_STATUS } from './lib/pine-promotion-status.mjs';
```

Update `canForceQueuedPromotion`:

```js
export function canForceQueuedPromotion(queuedAction = null) {
  return isForceablePromotionStatus(queuedAction?.status);
}
```

Update `decideQueuedPromotionAction()` returns:

```js
if (autoAction?.recommendation !== 'promote') {
  const reason = autoAction?.summary || 'Autopromote gates did not pass';
  return {
    recommendation: 'hold',
    status: classifyPromotionHoldReason(reason),
    reason,
  };
}
```

Use `PROMOTION_STATUS.INVALID`, `PROMOTION_STATUS.STALE`, and `PROMOTION_STATUS.PROMOTED` for other branches.

- [ ] **Step 5: Run promotion tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "canForceQueuedPromotion|autopromote gates|regime switch"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-promotion-status.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): restrict forced promotion to operator blockers"
```

---

## Task 8: Fix Matrix Denominators and Require Holdout Verdict

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing zero-shadow ratio test**

```js
test('evaluateMatrix does not report perfect shadow ratio with zero shadow labs', () => {
  const decision = evaluateMatrix({
    candidateChanged: true,
    primaryPromote: true,
    shadowResults: [],
    policy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 3,
      minShadowPassRatio: 0.6,
      requireCandidateChange: true,
    },
  });

  assert.equal(decision.counts.shadowLabs, 0);
  assert.equal(decision.counts.shadowPassCount, 0);
  assert.equal(decision.counts.shadowPassRatio, 0);
  assert.equal(decision.gates.shadowPassRatio, false);
});
```

- [ ] **Step 2: Write failing holdout-required test**

```js
test('decideAutoresearchOutcome blocks promotion when blind holdout is configured but verdict is missing', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 50, tradeCount: 100 }),
    challenger: makeResult({ configId: 'challenger', score: 120, roiPct: 70, tradeCount: 120 }),
    matrixDecision: {
      recommendation: 'promote',
      gates: { candidateChanged: true, primaryPromote: true, shadowPassCount: true, shadowPassRatio: true },
      failedGates: [],
    },
    expectancy: { gate: { passed: true } },
    holdoutVerdict: null,
    blindHoldoutLabs: [{ labId: 'xrpusdt-15m-nov2025-blind-holdout' }],
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.match(outcome.summary, /holdout verdict required/i);
});
```

- [ ] **Step 3: Run failing tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "zero shadow|holdout verdict required"
```

Expected before implementation: fail.

- [ ] **Step 4: Implement denominator logic**

In matrix evaluation logic, compute:

```js
const shadowLabs = shadowResults.length;
const shadowPassCount = shadowResults.filter((result) => result?.passed === true).length;
const shadowPassRatio = shadowLabs > 0 ? shadowPassCount / shadowLabs : 0;
const shadowPassRatioGate = shadowLabs > 0 && shadowPassRatio >= policy.minShadowPassRatio;
```

- [ ] **Step 5: Implement holdout required gate**

In `decideAutoresearchOutcome()` before promote:

```js
const holdoutRequired = Array.isArray(blindHoldoutLabs) && blindHoldoutLabs.length > 0;
if (holdoutRequired && !holdoutVerdict) {
  return {
    recommendation: 'hold',
    summary: 'Blind holdout verdict required before promotion.',
    gates: { holdoutVerdict: false },
  };
}
if (holdoutVerdict && holdoutVerdict.passed !== true) {
  return {
    recommendation: 'hold',
    summary: `Blind holdout failed: ${holdoutVerdict.reason || 'unspecified'}`,
    gates: { holdoutVerdict: false },
  };
}
```

- [ ] **Step 6: Run targeted tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "zero shadow|holdout verdict required"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): harden matrix and holdout promotion gates"
```

---

## Task 9: Tighten Production Profitability Gates

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing profitability-floor test**

```js
test('decideAutoresearchOutcome rejects near-zero ROI improvement despite other passing gates', () => {
  const outcome = decideAutoresearchOutcome({
    incumbent: makeResult({ configId: 'champion', score: 100, roiPct: 40, profitFactor: 1.4, tradeCount: 100 }),
    challenger: makeResult({ configId: 'challenger', score: 101, roiPct: 40.1, profitFactor: 1.41, tradeCount: 110 }),
    matrixDecision: {
      recommendation: 'promote',
      gates: { candidateChanged: true, primaryPromote: true, shadowPassCount: true, shadowPassRatio: true },
      failedGates: [],
    },
    expectancy: { gate: { passed: true } },
    holdoutVerdict: { passed: true },
    promotionPolicy: {
      minRoiDeltaPct: 5,
      minProfitFactorDelta: 0.1,
      minTradeCount: 60,
    },
  });

  assert.equal(outcome.recommendation, 'hold');
  assert.match(outcome.summary, /ROI|profit factor/i);
});
```

- [ ] **Step 2: Run failing test**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "near-zero ROI"
```

Expected before implementation: fail if zero deltas pass.

- [ ] **Step 3: Implement promotion profitability policy**

In promotion decision logic:

```js
function evaluateProfitabilityFloor({ incumbent, challenger, policy = {} }) {
  const minRoiDeltaPct = Number(policy.minRoiDeltaPct ?? 5);
  const minProfitFactorDelta = Number(policy.minProfitFactorDelta ?? 0.1);
  const minTradeCount = Number(policy.minTradeCount ?? 60);
  const roiDelta = Number(challenger?.metrics?.roiPct ?? challenger?.roiPct ?? 0) - Number(incumbent?.metrics?.roiPct ?? incumbent?.roiPct ?? 0);
  const pfDelta = Number(challenger?.metrics?.profitFactor ?? challenger?.profitFactor ?? 0) - Number(incumbent?.metrics?.profitFactor ?? incumbent?.profitFactor ?? 0);
  const tradeCount = Number(challenger?.metrics?.tradeCount ?? challenger?.tradeCount ?? 0);

  const passed = roiDelta >= minRoiDeltaPct && pfDelta >= minProfitFactorDelta && tradeCount >= minTradeCount;
  return { passed, roiDelta, pfDelta, tradeCount, minRoiDeltaPct, minProfitFactorDelta, minTradeCount };
}
```

Before promote:

```js
const profitabilityFloor = evaluateProfitabilityFloor({ incumbent, challenger, policy: promotionPolicy });
if (!profitabilityFloor.passed) {
  return {
    recommendation: 'hold',
    summary: `Profitability floor failed: ROI delta ${round(profitabilityFloor.roiDelta)} < ${profitabilityFloor.minRoiDeltaPct} or profit factor delta ${round(profitabilityFloor.pfDelta, 3)} < ${profitabilityFloor.minProfitFactorDelta}.`,
    profitabilityFloor,
  };
}
```

Export `evaluateProfitabilityFloor` if useful for tests.

- [ ] **Step 4: Tighten config defaults**

In `config/pine-autoresearch.default.json`, set production floors:

```json
"promotion": {
  "allowAutomaticRegimeSwitching": false,
  "requireGlobalChampionAnchor": true,
  "minRoiDeltaPct": 5,
  "minProfitFactorDelta": 0.1,
  "minTradeCount": 60,
  "requireBlindHoldoutVerdict": true
}
```

For blind holdout lab thresholds, replace zero deltas:

```json
"thresholds": {
  "minScoreDelta": 0,
  "minRoiDeltaPct": 5,
  "minProfitFactorDelta": 0.1,
  "maxDrawdownDeltaPct": 0.75,
  "minTradeCount": 60,
  "minTradeRatioVsIncumbent": 0.75
}
```

- [ ] **Step 5: Run profitability tests**

```bash
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "near-zero ROI|profitability"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add config/pine-autoresearch.default.json scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): enforce profitability floors for promotion"
```

---

## Task 10: Validate Latest Pointer and Detect Orphan Evaluation Dirs

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-autoresearch-artifacts.mjs`
- Test: `tests/pine-autoresearch-artifacts.test.mjs`

- [ ] **Step 1: Add orphan detection test**

Append to `tests/pine-autoresearch-artifacts.test.mjs`:

```js
test('findOrphanEvaluationRuns reports evaluation dirs without manifest or incomplete marker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });
  fs.mkdirSync(path.join(root, 'evaluations', 'run-complete'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'run-complete.json'), JSON.stringify({ runId: 'run-complete' }), 'utf8');

  const result = findOrphanEvaluationRuns({ root });

  assert.deepEqual(result.orphans.map((item) => item.runId), ['run-orphan']);
});
```

- [ ] **Step 2: Implement orphan detection**

In `scripts/lib/pine-autoresearch-artifacts.mjs`:

```js
export function findOrphanEvaluationRuns({ root }) {
  const evalRoot = path.join(root, 'evaluations');
  if (!fsSync.existsSync(evalRoot)) return { ok: true, orphans: [] };
  const orphans = fsSync.readdirSync(evalRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((runId) => {
      const manifestPath = path.join(root, 'manifests', `${runId}.json`);
      const incompletePath = path.join(root, 'incomplete', `${runId}.json`);
      return !fsSync.existsSync(manifestPath) && !fsSync.existsSync(incompletePath);
    })
    .sort()
    .map((runId) => ({ runId, evaluationDir: path.join(evalRoot, runId) }));

  return { ok: orphans.length === 0, orphans };
}
```

- [ ] **Step 3: Add digest/report warning**

In digest/report generation path in `scripts/pine-autoresearch.mjs`, call:

```js
const orphanRuns = findOrphanEvaluationRuns({ root: config.researchRoot });
if (!orphanRuns.ok) {
  warnings.push(`Found ${orphanRuns.orphans.length} evaluation run(s) without manifest or incomplete marker.`);
}
```

- [ ] **Step 4: Run artifact tests**

```bash
node --test tests/pine-autoresearch-artifacts.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-artifacts.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-artifacts.test.mjs
git commit -m "feat(pine): detect orphan autoresearch evaluations"
```

---

## Task 11: Add Production Run Invariants Test Suite

**Files:**
- Create: `tests/pine-autoresearch-production-invariants.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create invariant test file**

Create `tests/pine-autoresearch-production-invariants.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateLatestManifestPointer, findOrphanEvaluationRuns } from '../scripts/lib/pine-autoresearch-artifacts.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const researchRoot = path.join(repoRoot, 'pine/autoresearch/pine-fusion-v4-core-15m-locked-window');

test('production latest.json points to an existing manifest', () => {
  const result = validateLatestManifestPointer({ root: researchRoot });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('production evaluation dirs are finalized or explicitly incomplete', () => {
  const result = findOrphanEvaluationRuns({ root: researchRoot });
  assert.equal(result.ok, true, JSON.stringify(result.orphans, null, 2));
});

test('latest complete manifest does not claim preview-only regime generation as real candidate work', () => {
  const latestPath = path.join(researchRoot, 'latest.json');
  if (!fs.existsSync(latestPath)) return;
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const scoreboard = latest.shadowRegimeScoreboard;
  if (!scoreboard || scoreboard.selectedLane !== 'exitRegime') return;

  assert.equal(scoreboard.generatorSummary.previewOnly, false);
  assert.ok(scoreboard.generatorSummary.candidateCount > 0);
  assert.equal(scoreboard.generatorSummary.countSource, 'generatedVariants');
});
```

This test is expected to fail on current production artifacts until orphan dirs are marked incomplete or removed. That failure is useful.

- [ ] **Step 2: Add script**

In `package.json` scripts:

```json
"test:pine:autoresearch:hardening": "node --test tests/pine-regime-exit-scheduler.test.mjs tests/pine-autoresearch-artifacts.test.mjs tests/pine-autoresearch-production-invariants.test.mjs tests/pine-autoresearch.test.mjs"
```

- [ ] **Step 3: Run invariant suite**

```bash
npm run test:pine:autoresearch:hardening
```

Expected at this stage: production invariant may fail because existing orphan dirs are real historical artifacts. Do not delete them silently. Mark them incomplete in Task 12.

- [ ] **Step 4: Commit**

```bash
git add tests/pine-autoresearch-production-invariants.test.mjs package.json
git commit -m "test(pine): add autoresearch production invariants"
```

---

## Task 12: Migrate Existing Orphan Evaluation Dirs to Explicit Incomplete Markers

**Files:**
- Create: `scripts/pine-autoresearch-repair-artifacts.mjs`
- Test: `tests/pine-autoresearch-artifacts.test.mjs`
- Runtime artifact writes under `pine/autoresearch/.../incomplete/*.json`

- [ ] **Step 1: Write repair dry-run test**

Add to `tests/pine-autoresearch-artifacts.test.mjs`:

```js
test('repair artifact dry run lists orphan dirs without writing markers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });

  const result = await repairOrphanEvaluationRuns({ root, dryRun: true, reason: 'historical_orphan' });

  assert.deepEqual(result.repaired, []);
  assert.deepEqual(result.orphans.map((item) => item.runId), ['run-orphan']);
  assert.equal(fs.existsSync(path.join(root, 'incomplete', 'run-orphan.json')), false);
});
```

Export `repairOrphanEvaluationRuns` from `scripts/lib/pine-autoresearch-artifacts.mjs`:

```js
export async function repairOrphanEvaluationRuns({ root, dryRun = true, reason = 'historical_orphan' }) {
  const scan = findOrphanEvaluationRuns({ root });
  const repaired = [];
  if (!dryRun) {
    for (const orphan of scan.orphans) {
      await markAutoresearchRunIncomplete({ root, runId: orphan.runId, reason });
      repaired.push(orphan.runId);
    }
  }
  return { orphans: scan.orphans, repaired };
}
```

- [ ] **Step 2: Create CLI repair script**

Create `scripts/pine-autoresearch-repair-artifacts.mjs`:

```js
import path from 'node:path';
import { repairOrphanEvaluationRuns } from './lib/pine-autoresearch-artifacts.mjs';

function parseArgs(argv) {
  const out = { dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write') out.dryRun = false;
    if (arg === '--root') out.root = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = args.root || path.resolve('pine/autoresearch/pine-fusion-v4-core-15m-locked-window');
const result = await repairOrphanEvaluationRuns({
  root,
  dryRun: args.dryRun,
  reason: 'historical_orphan_without_manifest',
});

console.log(JSON.stringify({ root, dryRun: args.dryRun, ...result }, null, 2));
if (result.orphans.length > 0 && args.dryRun) process.exitCode = 2;
```

- [ ] **Step 3: Run dry-run repair**

```bash
node scripts/pine-autoresearch-repair-artifacts.mjs
```

Expected: lists existing orphan evaluation dirs and exits `2` in dry-run mode.

- [ ] **Step 4: Write incomplete markers for existing historical orphans**

```bash
node scripts/pine-autoresearch-repair-artifacts.mjs --write
```

Expected: writes `incomplete/<runId>.json` markers for orphan dirs.

- [ ] **Step 5: Re-run production invariants**

```bash
npm run test:pine:autoresearch:hardening
```

Expected: orphan invariant passes. If preview-only latest manifest still fails, keep that failure until Task 3/4 produce a new real regime-aware manifest; do not fake it.

- [ ] **Step 6: Commit script and markers**

```bash
git add scripts/pine-autoresearch-repair-artifacts.mjs scripts/lib/pine-autoresearch-artifacts.mjs tests/pine-autoresearch-artifacts.test.mjs pine/autoresearch/pine-fusion-v4-core-15m-locked-window/incomplete

git commit -m "chore(pine): mark orphan autoresearch evaluations incomplete"
```

---

## Task 13: Production Micro-Cycle Verification Before Full Cycle

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Runtime artifacts only

- [ ] **Step 1: Ensure production-safe defaults**

Verify config contains:

```json
"regimeExitResearch": {
  "enabled": true,
  "offline": { "mode": "offline-strict" },
  "promotion": {
    "allowAutomaticRegimeSwitching": false,
    "requireGlobalChampionAnchor": true,
    "minRoiDeltaPct": 5,
    "minProfitFactorDelta": 0.1,
    "minTradeCount": 60,
    "requireBlindHoldoutVerdict": true
  }
}
```

If local-first is needed for development, create a separate dev config file instead of weakening default production config.

- [ ] **Step 2: Run dataset verification**

```bash
npm run pine:dataset:verify --silent
```

Expected: all required labs print `cacheComplete:true` and `missingCount:0`.

- [ ] **Step 3: Run targeted hardening tests**

```bash
npm run test:pine:autoresearch:hardening
```

Expected: all tests pass except any explicitly documented invariant requiring a fresh real run.

- [ ] **Step 4: Run one micro cycle**

```bash
npm run pine:autoresearch:micro
```

Expected output must include:
- `[autoresearch] manifest=...`
- `[autoresearch] recommendation=...`
- no `cycle=skipped reason=offlineDataMissing`
- no missing manifest

- [ ] **Step 5: Inspect generated manifest**

Run:

```bash
node -e "const fs=require('fs'); const p='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json'; const m=JSON.parse(fs.readFileSync(p,'utf8')); console.log(JSON.stringify({runId:m.runId, selectedLane:m.shadowRegimeScoreboard?.selectedLane, generator:m.shadowRegimeScoreboard?.generatorSummary, variants:m.searchPlan?.variants?.map(v=>v.lane), recommendation:m.matrixDecision?.recommendation, holdoutVerdict:m.holdoutVerdict}, null, 2));"
```

Expected:

```json
{
  "selectedLane": "exitRegime",
  "generator": {
    "previewOnly": false,
    "countSource": "generatedVariants"
  }
}
```

`candidateCount` must be greater than `0`; variant lane list must include selected lane.

- [ ] **Step 6: Commit config if changed**

```bash
git add config/pine-autoresearch.default.json
git commit -m "config(pine): use strict production autoresearch gates"
```

---

## Task 14: Add Operational Runbook

**Files:**
- Create: `docs/pine-autoresearch-operational-runbook.md`

- [ ] **Step 1: Write runbook**

Create `docs/pine-autoresearch-operational-runbook.md`:

```markdown
# Pine Autoresearch Operational Runbook

## Trust Rules

- Trust `manifests/<runId>.json` and `latest.json` only when `latest.json.runId` has a matching manifest.
- Do not trust raw `evaluations/<runId>/` directories without a manifest.
- Raw evaluation dirs without manifest must have `incomplete/<runId>.json` before the system is considered clean.

## Before Scheduled Full Run

1. Run `npm run pine:dataset:verify --silent`.
2. Run `npm run test:pine:autoresearch:hardening`.
3. Confirm no active locks:
   - `tmp/pine-autoresearch-locks/scheduler.lock`
   - `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/autoresearch.lock.json`

## After Scheduled Full Run

1. Confirm wrapper log contains `[autoresearch] manifest=`.
2. Confirm `latest.json.runId` matches a manifest.
3. Confirm `shadowRegimeScoreboard.generatorSummary.previewOnly` is false for selected regime lane.
4. Confirm promotion did not bypass safety gates with `--force`.

## Force Promotion Policy

Force is allowed only for:
- `operator_blocked`
- `queue_blocked`

Force is never allowed for:
- `safety_failed`
- `expectancy_failed`
- `holdout_failed`
- `invalid`
- `stale`

## Recovery From Orphan Evaluation Dirs

Run dry-run first:

```bash
node scripts/pine-autoresearch-repair-artifacts.mjs
```

If listed orphans are historical/incomplete, mark them:

```bash
node scripts/pine-autoresearch-repair-artifacts.mjs --write
```

Never manually edit `latest.json` unless restoring from a verified manifest backup.
```

- [ ] **Step 2: Commit runbook**

```bash
git add docs/pine-autoresearch-operational-runbook.md
git commit -m "docs(pine): add autoresearch operations runbook"
```

---

## Final Verification

Run all gates:

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs tests/pine-autoresearch-artifacts.test.mjs tests/pine-autoresearch.test.mjs
npm run test:pine:autoresearch:hardening
npm run pine:dataset:verify --silent
npm run pine:autoresearch:micro
```

Then inspect latest manifest:

```bash
node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json','utf8')); const g=m.shadowRegimeScoreboard?.generatorSummary; if(!g || g.previewOnly || g.candidateCount<=0) process.exit(1); console.log(JSON.stringify({runId:m.runId,lane:m.shadowRegimeScoreboard.selectedLane,generator:g,recommendation:m.matrixDecision?.recommendation,holdoutVerdict:m.holdoutVerdict},null,2));"
```

Expected: exit `0`, selected lane has real generated variants, latest manifest exists, no orphan eval dirs.

---

## Rollback Plan

If real regime candidate generation creates unstable or low-quality candidates:
1. Set `regimeExitResearch.exitRegimeEnabled=false` and `globalAllParameterEnabled=false` in a local rollback config only.
2. Keep artifact lifecycle and promotion safety fixes enabled.
3. Do not revert manifest/incomplete marker logic.
4. Run hardening suite before resuming scheduler.

If scheduler wrapper rejects runs because manifest is missing:
1. Treat rejection as correct.
2. Inspect `incomplete/<runId>.json`.
3. Inspect wrapper log.
4. Fix root cause before clearing locks.

---

## Plan Self-Review

- Spec coverage: all audit flaws map to tasks: candidate generation Tasks 3-4; missing manifests Tasks 5-6/10-12; unsafe force Task 7; lane debt Task 2; holdout/profitability Tasks 8-9; help Task 1; ops Task 14.
- Placeholder scan: no placeholder tokens or vague “add tests” steps remain.
- Type consistency: all introduced exported names are defined in tasks before use: `buildRegimeAwareSearchBatch`, `pine-autoresearch-artifacts` functions, `PROMOTION_STATUS`, `isForceablePromotionStatus`, `classifyPromotionHoldReason`.
