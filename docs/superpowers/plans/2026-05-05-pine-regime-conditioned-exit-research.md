# Pine Regime-Conditioned Exit Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive, offline-capable, memory-bounded Pine autoresearch upgrade that combines regime-conditioned exit research, controlled global all-parameter search, hard anti-overfit gates, staged evaluation, and robust verification.

**Architecture:** Keep the existing non-LLM autoresearch lane as the safe baseline behind a feature flag. Add focused helper modules for objective scoring, offline data preflight, resource budgets, streaming metrics, checkpoint/resume, regime slicing, exit candidate generation, global grouped mutation, and lane scheduling. Integrate them into `scripts/pine-autoresearch.mjs` only after each helper has tests, preserving matrix/expectancy/lineage/autopromote safety and LLM isolation.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine autoresearch scripts, JSON/JSONL artifacts, Windows-friendly child processes, pinned candle datasets, local candle cache.

---

## Scope Boundary

This plan implements the approved spec:

`docs/superpowers/specs/2026-05-05-pine-regime-conditioned-exit-research-design.md`

Do this work in a dedicated worktree/branch. Do not implement directly on `main`; current root was observed as `main...origin/main [ahead 128]` during design.

The non-LLM lane must remain usable with the feature disabled. The LLM lane must not import or depend on new non-LLM modules unless a task explicitly says otherwise; this plan does not require LLM lane changes.

## File Map

### Create

- `scripts/lib/pine-regime-exit-config.mjs` — normalize feature flags, offline mode, resource caps, objective policy, and lane budgets.
- `scripts/lib/pine-offline-data-plan.mjs` — verify pinned dataset/cache completeness before research cycles.
- `scripts/lib/pine-objective-function.mjs` — candidate utility, hard floors, incumbent deltas, multiple-testing penalty.
- `scripts/lib/pine-resource-budget.mjs` — profile resource caps, manifest spill decisions, artifact refs, usage summaries.
- `scripts/lib/pine-streaming-metrics.mjs` — streaming JSONL parser, incremental trade simulation, compact metrics.
- `scripts/lib/pine-checkpoint-state.mjs` — checkpoint read/write/claim/complete/fail/resume helpers.
- `scripts/lib/pine-regime-slices.mjs` — deterministic regime labels and slice summaries.
- `scripts/lib/pine-exit-generators.mjs` — bounded exit-family candidate patches.
- `scripts/lib/pine-global-search.mjs` — grouped all-parameter mutation generator.
- `scripts/lib/pine-regime-exit-scheduler.mjs` — lane allocation by budget debt, stagnation, resource caps.
- `scripts/lib/pine-worker-runner.mjs` — child-process evaluation runner with timeout/memory diagnostics.
- `scripts/pine-evaluate-candidate-worker.mjs` — worker entry point that returns bounded summaries only.
- `tests/pine-regime-exit-config.test.mjs`
- `tests/pine-offline-data-plan.test.mjs`
- `tests/pine-objective-function.test.mjs`
- `tests/pine-resource-budget.test.mjs`
- `tests/pine-streaming-metrics.test.mjs`
- `tests/pine-checkpoint-state.test.mjs`
- `tests/pine-regime-slices.test.mjs`
- `tests/pine-exit-generators.test.mjs`
- `tests/pine-global-search.test.mjs`
- `tests/pine-regime-exit-scheduler.test.mjs`
- `tests/pine-worker-runner.test.mjs`
- `tests/pine-regime-exit-integration.test.mjs`
- `tests/pine-regime-exit-compatibility.test.mjs`

### Modify

- `config/pine-autoresearch.default.json` — add disabled-by-default feature config and resource/offline policies.
- `scripts/pine-autoresearch.mjs` — load new config, preflight offline datasets, optionally run staged regime/exit/global research path, persist compact manifest fields, maintain old path when disabled.
- `scripts/lib/pine-optimizer.mjs` — expose streaming analyzer next to existing full-load analyzer; keep existing API.
- `scripts/lib/pine-promotion-queue.mjs` — include optional regime/exit/resource/holdout evidence in queue items while tolerating old manifests.
- `scripts/lib/pine-regime-analysis.mjs` — reuse or delegate deterministic slice helpers where safe.
- `tests/pine-autoresearch.test.mjs` — no-regression plus new manifest/promotion behavior.
- `tests/pine-promotion-queue.test.mjs` — optional evidence fields and old queue compatibility.
- `tests/pine-autoresearch-llm-no-regression.test.mjs` — assert non-LLM additions do not alter LLM isolation.
- `docs/reference/modules.md` — add new helper modules.
- `docs/reference/schemas.md` — optional schema fields for new manifests/checkpoints/resource summaries.
- `docs/pine-autoresearch.md` — operator workflow for offline/resource-bounded research.
- `docs/artifacts-and-state.md` — new checkpoint/resource/artifact-ref files.
- `docs/pine-tooling.md` — offline strict dataset verify flow.

---

## Task 0: Create Worktree And Baseline

**Files:** none committed by this task.

- [ ] **Step 1: Create implementation worktree**

Run from repo root:

```bash
git worktree add .worktrees/regime-exit-research -b feature/regime-exit-research
cd .worktrees/regime-exit-research
git status --short --branch
```

Expected:

```text
## feature/regime-exit-research
```

- [ ] **Step 2: Confirm spec and plan are visible in worktree**

Run:

```bash
test -f docs/superpowers/specs/2026-05-05-pine-regime-conditioned-exit-research-design.md
test -f docs/superpowers/plans/2026-05-05-pine-regime-conditioned-exit-research.md
```

Expected: exit code `0`.

- [ ] **Step 3: Run baseline focused tests**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-optimizer.test.mjs tests/pine-regime-analysis.test.mjs tests/pine-expectancy.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs
```

Expected: all tests pass before changes.

- [ ] **Step 4: Commit plan/spec visibility if needed**

If the worktree shows the spec or plan as untracked, commit those docs first:

```bash
git add docs/superpowers/specs/2026-05-05-pine-regime-conditioned-exit-research-design.md docs/superpowers/plans/2026-05-05-pine-regime-conditioned-exit-research.md
git commit -m "docs(pine): plan regime conditioned exit research"
```

Expected: one docs commit or no commit if already tracked.

---

## Task 1: Config Flags, Defaults, And Kill Switch

**Files:**
- Create: `scripts/lib/pine-regime-exit-config.mjs`
- Create: `tests/pine-regime-exit-config.test.mjs`
- Modify: `config/pine-autoresearch.default.json`
- Modify: `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Write config normalization tests**

Create `tests/pine-regime-exit-config.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRegimeExitResearchConfig,
  isRegimeExitResearchEnabled,
} from '../scripts/lib/pine-regime-exit-config.mjs';

test('normalizeRegimeExitResearchConfig defaults to safe disabled mode', () => {
  const config = normalizeRegimeExitResearchConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.offline.mode, 'offline-strict');
  assert.equal(config.lanes.exploitRatio, 0.25);
  assert.equal(config.lanes.exitRegimeRatio, 0.35);
  assert.equal(config.lanes.globalAllParameterRatio, 0.25);
  assert.equal(config.lanes.robustnessRatio, 0.15);
  assert.equal(config.resource.maxManifestBytes > 0, true);
  assert.equal(config.resource.maxConcurrentLabWorkers >= 1, true);
});

test('isRegimeExitResearchEnabled requires top-level flag', () => {
  assert.equal(isRegimeExitResearchEnabled(normalizeRegimeExitResearchConfig({ enabled: false })), false);
  assert.equal(isRegimeExitResearchEnabled(normalizeRegimeExitResearchConfig({ enabled: true })), true);
});

test('normalizeRegimeExitResearchConfig clamps invalid ratios and caps', () => {
  const config = normalizeRegimeExitResearchConfig({
    enabled: true,
    lanes: {
      exploitRatio: -1,
      exitRegimeRatio: 99,
      globalAllParameterRatio: Number.NaN,
      robustnessRatio: 0,
    },
    resource: {
      maxConcurrentLabWorkers: 0,
      maxManifestBytes: -10,
    },
  });

  const total = config.lanes.exploitRatio + config.lanes.exitRegimeRatio + config.lanes.globalAllParameterRatio + config.lanes.robustnessRatio;
  assert.equal(Math.abs(total - 1) < 0.000001, true);
  assert.equal(config.resource.maxConcurrentLabWorkers, 1);
  assert.equal(config.resource.maxManifestBytes >= 16384, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/pine-regime-exit-config.test.mjs
```

Expected: FAIL with module not found for `pine-regime-exit-config.mjs`.

- [ ] **Step 3: Create config helper**

Create `scripts/lib/pine-regime-exit-config.mjs` with these exports and behavior:

```js
function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLaneRatios(raw = {}) {
  const base = {
    exploitRatio: clamp(finiteNumber(raw.exploitRatio, 0.25), 0, 1),
    exitRegimeRatio: clamp(finiteNumber(raw.exitRegimeRatio, 0.35), 0, 1),
    globalAllParameterRatio: clamp(finiteNumber(raw.globalAllParameterRatio, 0.25), 0, 1),
    robustnessRatio: clamp(finiteNumber(raw.robustnessRatio, 0.15), 0, 1),
  };
  const sum = Object.values(base).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return { exploitRatio: 0.25, exitRegimeRatio: 0.35, globalAllParameterRatio: 0.25, robustnessRatio: 0.15 };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value / sum]));
}

export function normalizeRegimeExitResearchConfig(raw = {}) {
  return {
    enabled: Boolean(raw.enabled),
    exitRegimeEnabled: raw.exitRegimeEnabled !== false,
    globalAllParameterEnabled: raw.globalAllParameterEnabled !== false,
    robustnessLadderEnabled: raw.robustnessLadderEnabled !== false,
    streamingMetricsEnabled: raw.streamingMetricsEnabled !== false,
    childWorkerIsolationEnabled: raw.childWorkerIsolationEnabled !== false,
    offline: {
      mode: ['offline-strict', 'local-first', 'refresh'].includes(raw.offline?.mode) ? raw.offline.mode : 'offline-strict',
      allowEmergencyReducedMatrix: Boolean(raw.offline?.allowEmergencyReducedMatrix),
    },
    lanes: normalizeLaneRatios(raw.lanes),
    resource: {
      maxCandidateBatchSize: Math.max(1, Math.floor(finiteNumber(raw.resource?.maxCandidateBatchSize, 8))),
      maxConcurrentLabWorkers: Math.max(1, Math.floor(finiteNumber(raw.resource?.maxConcurrentLabWorkers, 1))),
      maxRowsLoadedPerWorker: Math.max(100, Math.floor(finiteNumber(raw.resource?.maxRowsLoadedPerWorker, 250000))),
      maxManifestBytes: Math.max(16384, Math.floor(finiteNumber(raw.resource?.maxManifestBytes, 512000))),
      maxRetainedJsonlPerRun: Math.max(0, Math.floor(finiteNumber(raw.resource?.maxRetainedJsonlPerRun, 4))),
      softLaneTimeoutMs: Math.max(1000, Math.floor(finiteNumber(raw.resource?.softLaneTimeoutMs, 15 * 60 * 1000))),
      hardWorkerTimeoutMs: Math.max(1000, Math.floor(finiteNumber(raw.resource?.hardWorkerTimeoutMs, 5 * 60 * 1000))),
      maxWorkerOldSpaceMb: Math.max(64, Math.floor(finiteNumber(raw.resource?.maxWorkerOldSpaceMb, 512))),
    },
    objective: {
      minRoiPct: finiteNumber(raw.objective?.minRoiPct, 25),
      minExpectancyDelta: finiteNumber(raw.objective?.minExpectancyDelta, 0),
      maxDrawdownDeltaPct: finiteNumber(raw.objective?.maxDrawdownDeltaPct, 0.75),
      minTradeRatioVsIncumbent: finiteNumber(raw.objective?.minTradeRatioVsIncumbent, 0.8),
      multipleTestingPenaltyBase: finiteNumber(raw.objective?.multipleTestingPenaltyBase, 0.25),
      multipleTestingPenaltyStep: finiteNumber(raw.objective?.multipleTestingPenaltyStep, 0.05),
    },
  };
}

export function isRegimeExitResearchEnabled(config = {}) {
  return Boolean(config.enabled);
}
```

- [ ] **Step 4: Add config defaults**

Modify `config/pine-autoresearch.default.json` by adding a top-level `regimeExitResearch` object. Keep `enabled` false for safe rollout:

```json
"regimeExitResearch": {
  "enabled": false,
  "exitRegimeEnabled": true,
  "globalAllParameterEnabled": true,
  "robustnessLadderEnabled": true,
  "streamingMetricsEnabled": true,
  "childWorkerIsolationEnabled": true,
  "offline": {
    "mode": "offline-strict",
    "allowEmergencyReducedMatrix": false
  },
  "lanes": {
    "exploitRatio": 0.25,
    "exitRegimeRatio": 0.35,
    "globalAllParameterRatio": 0.25,
    "robustnessRatio": 0.15
  },
  "resource": {
    "maxCandidateBatchSize": 8,
    "maxConcurrentLabWorkers": 1,
    "maxRowsLoadedPerWorker": 250000,
    "maxManifestBytes": 512000,
    "maxRetainedJsonlPerRun": 4,
    "softLaneTimeoutMs": 900000,
    "hardWorkerTimeoutMs": 300000,
    "maxWorkerOldSpaceMb": 512
  },
  "objective": {
    "minRoiPct": 25,
    "minExpectancyDelta": 0,
    "maxDrawdownDeltaPct": 0.75,
    "minTradeRatioVsIncumbent": 0.8,
    "multipleTestingPenaltyBase": 0.25,
    "multipleTestingPenaltyStep": 0.05
  }
}
```

- [ ] **Step 5: Wire config into `loadConfig`**

Modify `scripts/pine-autoresearch.mjs` imports:

```js
import { normalizeRegimeExitResearchConfig } from './lib/pine-regime-exit-config.mjs';
```

Inside `loadConfig`, add this field to the returned config object:

```js
regimeExitResearch: normalizeRegimeExitResearchConfig(raw.regimeExitResearch || {}),
```

- [ ] **Step 6: Run config tests**

Run:

```bash
node --test tests/pine-regime-exit-config.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add config/pine-autoresearch.default.json scripts/lib/pine-regime-exit-config.mjs scripts/pine-autoresearch.mjs tests/pine-regime-exit-config.test.mjs
git commit -m "feat(pine): add regime exit research config gate"
```

---

## Task 2: Offline Data Preflight

**Files:**
- Create: `scripts/lib/pine-offline-data-plan.mjs`
- Create: `tests/pine-offline-data-plan.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`

- [ ] **Step 1: Write offline tests**

Create `tests/pine-offline-data-plan.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOfflineDataPlan, summarizeOfflineDataPlan } from '../scripts/lib/pine-offline-data-plan.mjs';

test('buildOfflineDataPlan requires local cache in offline-strict mode', () => {
  const plan = buildOfflineDataPlan({
    matrixId: 'matrix-a',
    pinnedData: { enabled: true, cacheRoot: '/cache', sourceMode: 'local-cache', exchangeName: 'ccxt-exchange' },
    labs: [{ labId: 'primary', symbol: 'XRPUSDT', timeframe: '15m', limit: 1000, when: '2026-04-21T00:00:00Z' }],
    offline: { mode: 'offline-strict' },
  });

  assert.equal(plan.mode, 'offline-strict');
  assert.equal(plan.networkAllowed, false);
  assert.equal(plan.requiredLabs.length, 1);
  assert.equal(plan.requiredLabs[0].requiresCacheComplete, true);
});

test('summarizeOfflineDataPlan records missing cache as offlineDataMissing', () => {
  const summary = summarizeOfflineDataPlan({
    mode: 'offline-strict',
    networkAllowed: false,
    requiredLabs: [{ labId: 'primary', complete: false, missingCount: 2 }],
  });

  assert.equal(summary.ok, false);
  assert.equal(summary.reason, 'offlineDataMissing');
  assert.equal(summary.missingLabs[0].labId, 'primary');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-offline-data-plan.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create offline helper**

Create `scripts/lib/pine-offline-data-plan.mjs`:

```js
export function buildOfflineDataPlan({ matrixId, pinnedData = {}, labs = [], offline = {} } = {}) {
  const mode = ['offline-strict', 'local-first', 'refresh'].includes(offline.mode) ? offline.mode : 'offline-strict';
  const networkAllowed = mode === 'refresh';
  return {
    matrixId: matrixId ?? 'pine-autoresearch',
    mode,
    networkAllowed,
    cacheRoot: pinnedData.cacheRoot ?? null,
    sourceMode: pinnedData.sourceMode ?? 'local-cache',
    requiredLabs: labs.map((lab) => ({
      labId: lab.labId,
      symbol: lab.symbol,
      timeframe: lab.timeframe,
      limit: lab.limit,
      when: lab.when,
      exchangeName: lab.exchange || pinnedData.exchangeName || 'ccxt-exchange',
      requiresCacheComplete: mode === 'offline-strict',
      complete: lab.complete ?? null,
      missingCount: lab.missingCount ?? 0,
      datasetHash: lab.datasetHash ?? null,
    })),
  };
}

export function summarizeOfflineDataPlan(plan = {}) {
  const missingLabs = (plan.requiredLabs || []).filter((lab) => lab.complete === false || Number(lab.missingCount || 0) > 0);
  return {
    ok: missingLabs.length === 0,
    reason: missingLabs.length ? 'offlineDataMissing' : 'offlineDataReady',
    mode: plan.mode ?? 'offline-strict',
    networkAllowed: Boolean(plan.networkAllowed),
    cacheRoot: plan.cacheRoot ?? null,
    sourceMode: plan.sourceMode ?? null,
    missingLabs,
  };
}
```

- [ ] **Step 4: Add preflight call in `runScout` when feature enabled**

In `scripts/pine-autoresearch.mjs`, import:

```js
import { buildOfflineDataPlan, summarizeOfflineDataPlan } from './lib/pine-offline-data-plan.mjs';
```

At the start of `runScout(config)`, after config/dirs are ready and before generating candidates, build a plan from `primaryLab`, `shadowLabs`, and `blindHoldoutLabs`. Use existing dataset verification helpers where available; if any required lab is missing in offline-strict mode, write a compact manifest/history event with `offlineDataSummary.reason = 'offlineDataMissing'` and return hold/no-op.

Required manifest fields when blocked:

```js
{
  promotionEligible: false,
  promotionEligibleReason: 'offlineDataMissing',
  offlineDataSummary: {
    ok: false,
    reason: 'offlineDataMissing',
    mode: 'offline-strict',
    missingLabs: []
  }
}
```

- [ ] **Step 5: Run tests**

```bash
node --test tests/pine-offline-data-plan.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add scripts/lib/pine-offline-data-plan.mjs scripts/pine-autoresearch.mjs tests/pine-offline-data-plan.test.mjs
git commit -m "feat(pine): add offline data preflight plan"
```

---

## Task 3: Objective Function And Multiple-Testing Penalty

**Files:**
- Create: `scripts/lib/pine-objective-function.mjs`
- Create: `tests/pine-objective-function.test.mjs`

- [ ] **Step 1: Write objective tests**

Create `tests/pine-objective-function.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMultipleTestingPenalty,
  computeCandidateUtility,
  evaluateObjectiveGates,
} from '../scripts/lib/pine-objective-function.mjs';

test('computeMultipleTestingPenalty increases with search breadth', () => {
  const small = computeMultipleTestingPenalty({ attemptedCandidates: 4, mutationFamilyCount: 1, regimeSliceCount: 1, exitFamilyCount: 1 }, { base: 0.25, step: 0.05 });
  const wide = computeMultipleTestingPenalty({ attemptedCandidates: 64, mutationFamilyCount: 6, regimeSliceCount: 4, exitFamilyCount: 5 }, { base: 0.25, step: 0.05 });

  assert.equal(wide > small, true);
});

test('evaluateObjectiveGates rejects win-rate-only improvement with expectancy regression', () => {
  const result = evaluateObjectiveGates({
    incumbent: { roiPct: 80, winRatePct: 40, profitFactor: 3, maxDrawdownPct: 3, tradeCount: 250, expectancy: 1.2 },
    candidate: { roiPct: 50, winRatePct: 70, profitFactor: 1.2, maxDrawdownPct: 5, tradeCount: 250, expectancy: 0.5 },
    policy: { minRoiPct: 25, minExpectancyDelta: 0, maxDrawdownDeltaPct: 0.75, minTradeRatioVsIncumbent: 0.8 },
  });

  assert.equal(result.pass, false);
  assert.equal(result.failedGates.includes('expectancyRegression'), true);
  assert.equal(result.failedGates.includes('drawdownRegression'), true);
});

test('computeCandidateUtility prioritizes ROI and expectancy over win rate', () => {
  const highExpectancy = computeCandidateUtility({ roiPct: 90, expectancy: 1.5, profitFactor: 3, maxDrawdownPct: 3, tradeCount: 260, winRatePct: 42 }, { multipleTestingPenalty: 0 });
  const highWinRate = computeCandidateUtility({ roiPct: 20, expectancy: 0.3, profitFactor: 1.1, maxDrawdownPct: 8, tradeCount: 260, winRatePct: 80 }, { multipleTestingPenalty: 0 });

  assert.equal(highExpectancy.utility > highWinRate.utility, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-objective-function.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create objective helper**

Create `scripts/lib/pine-objective-function.mjs` with exports:

```js
function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeMultipleTestingPenalty(context = {}, policy = {}) {
  const attempted = Math.max(1, number(context.attemptedCandidates, 1));
  const breadth =
    Math.log2(attempted) +
    Math.max(0, number(context.mutationFamilyCount, 0) - 1) +
    Math.max(0, number(context.regimeSliceCount, 0) - 1) +
    Math.max(0, number(context.exitFamilyCount, 0) - 1);
  return number(policy.base, 0.25) + breadth * number(policy.step, 0.05);
}

export function computeCandidateUtility(metrics = {}, { multipleTestingPenalty = 0, complexityPenalty = 0, robustnessBonus = 0, targetRegimeImprovement = 0 } = {}) {
  const roiComponent = number(metrics.roiPct) * 1.0;
  const expectancyComponent = number(metrics.expectancy) * 25;
  const profitFactorComponent = Math.min(number(metrics.profitFactor), 10) * 8;
  const drawdownPenalty = number(metrics.maxDrawdownPct) * 3;
  const tradeCountComponent = Math.log10(Math.max(1, number(metrics.tradeCount))) * 5;
  const winRateDiagnostic = Math.min(number(metrics.winRatePct), 100) * 0.05;
  const utility = roiComponent + expectancyComponent + profitFactorComponent - drawdownPenalty + tradeCountComponent + robustnessBonus + targetRegimeImprovement + winRateDiagnostic - complexityPenalty - multipleTestingPenalty;
  return { utility, components: { roiComponent, expectancyComponent, profitFactorComponent, drawdownPenalty, tradeCountComponent, winRateDiagnostic, robustnessBonus, targetRegimeImprovement, complexityPenalty, multipleTestingPenalty } };
}

export function evaluateObjectiveGates({ incumbent = {}, candidate = {}, policy = {} } = {}) {
  const failedGates = [];
  const roiPct = number(candidate.roiPct);
  const expectancyDelta = number(candidate.expectancy) - number(incumbent.expectancy);
  const drawdownDeltaPct = number(candidate.maxDrawdownPct) - number(incumbent.maxDrawdownPct);
  const tradeRatioVsIncumbent = number(candidate.tradeCount) / Math.max(1, number(incumbent.tradeCount));

  if (roiPct < number(policy.minRoiPct, 25)) failedGates.push('roiFloor');
  if (expectancyDelta < number(policy.minExpectancyDelta, 0)) failedGates.push('expectancyRegression');
  if (drawdownDeltaPct > number(policy.maxDrawdownDeltaPct, 0.75)) failedGates.push('drawdownRegression');
  if (tradeRatioVsIncumbent < number(policy.minTradeRatioVsIncumbent, 0.8)) failedGates.push('tradeCountRegression');

  return { pass: failedGates.length === 0, failedGates, comparisons: { expectancyDelta, drawdownDeltaPct, tradeRatioVsIncumbent, roiPct } };
}
```

- [ ] **Step 4: Run objective tests**

```bash
node --test tests/pine-objective-function.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/lib/pine-objective-function.mjs tests/pine-objective-function.test.mjs
git commit -m "feat(pine): add objective scoring guardrails"
```

---

## Task 4: Resource Budget, Artifact References, And Manifest Spill Guard

**Files:**
- Create: `scripts/lib/pine-resource-budget.mjs`
- Create: `tests/pine-resource-budget.test.mjs`

- [ ] **Step 1: Write resource budget tests**

Create `tests/pine-resource-budget.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeResourceBudget,
  shouldSpillManifestSection,
  buildArtifactRef,
  createResourceUsageSummary,
} from '../scripts/lib/pine-resource-budget.mjs';

test('normalizeResourceBudget clamps unsafe values', () => {
  const budget = normalizeResourceBudget({ maxConcurrentLabWorkers: 0, maxManifestBytes: 10, maxWorkerOldSpaceMb: 1 });
  assert.equal(budget.maxConcurrentLabWorkers, 1);
  assert.equal(budget.maxManifestBytes >= 16384, true);
  assert.equal(budget.maxWorkerOldSpaceMb >= 64, true);
});

test('shouldSpillManifestSection returns true when serialized section is too large', () => {
  const result = shouldSpillManifestSection({ huge: 'x'.repeat(1000) }, { maxSectionBytes: 100 });
  assert.equal(result.spill, true);
  assert.equal(result.bytes > 100, true);
});

test('buildArtifactRef records path hash bytes and schema version', () => {
  const ref = buildArtifactRef({ path: '/tmp/a.json', bytes: 12, sha256: 'abc', schemaVersion: 1 });
  assert.deepEqual(ref, { path: '/tmp/a.json', bytes: 12, sha256: 'abc', schemaVersion: 1 });
});

test('createResourceUsageSummary records skipped candidates and artifact bytes', () => {
  const summary = createResourceUsageSummary({ peakRssBytes: 100, artifactBytesWritten: 200, skippedByResourceCap: 3, prunedFiles: 4 });
  assert.equal(summary.peakRssBytes, 100);
  assert.equal(summary.artifactBytesWritten, 200);
  assert.equal(summary.skippedByResourceCap, 3);
  assert.equal(summary.prunedFiles, 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-resource-budget.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create resource helper**

Create `scripts/lib/pine-resource-budget.mjs` with the functions used in the tests. Use `Buffer.byteLength(JSON.stringify(value), 'utf8')` for byte estimates. Do not import project-heavy modules.

- [ ] **Step 4: Run resource tests**

```bash
node --test tests/pine-resource-budget.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add scripts/lib/pine-resource-budget.mjs tests/pine-resource-budget.test.mjs
git commit -m "feat(pine): add resource budget helpers"
```

---

## Task 5: Streaming Metrics Parity

**Files:**
- Create: `scripts/lib/pine-streaming-metrics.mjs`
- Create: `tests/pine-streaming-metrics.test.mjs`
- Modify: `scripts/lib/pine-optimizer.mjs`

- [ ] **Step 1: Write streaming parity tests**

Create `tests/pine-streaming-metrics.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeJsonlFile } from '../scripts/lib/pine-optimizer.mjs';
import { analyzeJsonlFileStreaming } from '../scripts/lib/pine-streaming-metrics.mjs';

async function writeFixture(rows) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-streaming-metrics-'));
  const file = path.join(dir, 'fixture.jsonl');
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  return file;
}

test('analyzeJsonlFileStreaming matches full analyzer on compact fixture', async () => {
  const rows = [
    { timestamp: 1, Close: 100, Signal_Long: 1, SL: 95, TP: 110 },
    { timestamp: 2, Close: 105 },
    { timestamp: 3, Close: 110 },
    { timestamp: 4, Close: 120, Signal_Short: 1, SL: 130, TP: 100 },
    { timestamp: 5, Close: 100 },
  ];
  const file = await writeFixture(rows);

  const full = await analyzeJsonlFile(file, { minTrades: 0 });
  const streaming = await analyzeJsonlFileStreaming(file, { minTrades: 0 });

  assert.equal(streaming.rowCount, full.rowCount);
  assert.equal(streaming.metrics.tradeCount, full.metrics.tradeCount);
  assert.equal(Number(streaming.metrics.roiPct.toFixed(6)), Number(full.metrics.roiPct.toFixed(6)));
  assert.equal(Number(streaming.score.toFixed(6)), Number(full.score.toFixed(6)));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-streaming-metrics.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create streaming analyzer**

Create `scripts/lib/pine-streaming-metrics.mjs`. For the first implementation, stream line-by-line with `readline`, feed each parsed row into an incremental simulator, and return the same shape as `analyzeJsonlFile`: `{ filePath, rowCount, metrics, score, breakdown, diagnostics }`.

Required exports:

```js
export async function* iterateJsonlRows(filePath) { /* yields parsed row per non-empty line */ }
export function createIncrementalTradeSimulator(options = {}) { /* accepts rows sequentially and returns closed trades */ }
export async function analyzeJsonlFileStreaming(filePath, options = {}) { /* compact analyzer */ }
```

Use existing `calculateMetrics`, `scoreMetricsBreakdown`, and `scoreMetrics` from `pine-optimizer.mjs` to preserve scoring parity.

- [ ] **Step 4: Export optional streaming path from optimizer**

In `scripts/lib/pine-optimizer.mjs`, export a wrapper without changing current behavior:

```js
export { analyzeJsonlFileStreaming } from './pine-streaming-metrics.mjs';
```

If this creates a circular import, move shared metric math into a small helper module `scripts/lib/pine-metric-core.mjs` in this same task and update both analyzers to import it. Keep tests proving full analyzer still passes.

- [ ] **Step 5: Run focused tests**

```bash
node --test tests/pine-streaming-metrics.test.mjs tests/pine-optimizer.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add scripts/lib/pine-streaming-metrics.mjs scripts/lib/pine-optimizer.mjs tests/pine-streaming-metrics.test.mjs
git commit -m "feat(pine): add streaming metric analyzer"
```

---

## Task 6: Worker Isolation

**Files:**
- Create: `scripts/lib/pine-worker-runner.mjs`
- Create: `scripts/pine-evaluate-candidate-worker.mjs`
- Create: `tests/pine-worker-runner.test.mjs`

- [ ] **Step 1: Write worker runner tests**

Create `tests/pine-worker-runner.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runEvaluationWorker } from '../scripts/lib/pine-worker-runner.mjs';

test('runEvaluationWorker returns parsed bounded JSON summary', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-worker-'));
  const worker = path.join(dir, 'worker.mjs');
  await fs.writeFile(worker, "console.log(JSON.stringify({ ok: true, metrics: { roiPct: 42 } }))", 'utf8');

  const result = await runEvaluationWorker({ workerPath: worker, payload: { a: 1 }, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, true);
  assert.equal(result.summary.metrics.roiPct, 42);
});

test('runEvaluationWorker marks timeout as workerTimeout', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-worker-timeout-'));
  const worker = path.join(dir, 'worker.mjs');
  await fs.writeFile(worker, "setTimeout(() => console.log(JSON.stringify({ ok: true })), 1000)", 'utf8');

  const result = await runEvaluationWorker({ workerPath: worker, payload: {}, timeoutMs: 10, maxOldSpaceMb: 128 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerTimeout');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-worker-runner.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create worker runner**

Create `scripts/lib/pine-worker-runner.mjs` using `child_process.spawn(process.execPath, ['--max-old-space-size=...', workerPath])`. Pass payload on stdin as JSON. Parse stdout as JSON. Kill on timeout. Return `{ ok:false, reason:'workerTimeout' }` on timeout and `{ ok:false, reason:'workerFailed', stderr }` on non-zero exit.

- [ ] **Step 4: Create worker entry point**

Create `scripts/pine-evaluate-candidate-worker.mjs` that reads JSON payload from stdin and returns a bounded summary. Initial supported command:

```json
{ "command": "analyze-jsonl-streaming", "filePath": "...", "options": {} }
```

For that command, call `analyzeJsonlFileStreaming(filePath, options)` and print JSON with fields:

```js
{
  ok: true,
  metrics: analysis.metrics,
  score: analysis.score,
  breakdown: analysis.breakdown,
  diagnostics: analysis.diagnostics,
  rowCount: analysis.rowCount
}
```

- [ ] **Step 5: Run worker tests**

```bash
node --test tests/pine-worker-runner.test.mjs tests/pine-streaming-metrics.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add scripts/lib/pine-worker-runner.mjs scripts/pine-evaluate-candidate-worker.mjs tests/pine-worker-runner.test.mjs
git commit -m "feat(pine): isolate heavy evaluation workers"
```

---

## Task 7: Checkpoint And Resume State

**Files:**
- Create: `scripts/lib/pine-checkpoint-state.mjs`
- Create: `tests/pine-checkpoint-state.test.mjs`

- [ ] **Step 1: Write checkpoint tests**

Create `tests/pine-checkpoint-state.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildCheckpointKey, appendCheckpointEvent, readCheckpointState, selectIncompleteStages } from '../scripts/lib/pine-checkpoint-state.mjs';

test('checkpoint state records completed and failed stages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-checkpoint-'));
  const file = path.join(dir, 'checkpoint.jsonl');
  const key = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary', stage: 'matrix' });

  await appendCheckpointEvent(file, { key, status: 'started', at: '2026-05-05T00:00:00.000Z' });
  await appendCheckpointEvent(file, { key, status: 'completed', artifactRef: { path: '/a.json', sha256: 'abc', bytes: 3, schemaVersion: 1 }, at: '2026-05-05T00:01:00.000Z' });

  const state = await readCheckpointState(file);
  assert.equal(state.get(key).status, 'completed');
  assert.equal(selectIncompleteStages([{ key }], state).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-checkpoint-state.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create checkpoint helper**

Create `scripts/lib/pine-checkpoint-state.mjs` with append-only JSONL events. Export:

```js
export function buildCheckpointKey({ runId, lane, candidateId, labId, stage }) { return [runId, lane, candidateId, labId, stage].join('|'); }
export async function appendCheckpointEvent(filePath, event) { /* append JSONL */ }
export async function readCheckpointState(filePath) { /* return Map latest event by key */ }
export function selectIncompleteStages(plannedStages, state) { /* return stages without completed status */ }
```

- [ ] **Step 4: Run checkpoint tests**

```bash
node --test tests/pine-checkpoint-state.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add scripts/lib/pine-checkpoint-state.mjs tests/pine-checkpoint-state.test.mjs
git commit -m "feat(pine): add autoresearch checkpoints"
```

---

## Task 8: Regime Slice Model

**Files:**
- Create: `scripts/lib/pine-regime-slices.mjs`
- Create: `tests/pine-regime-slices.test.mjs`

- [ ] **Step 1: Write regime slice tests**

Create `tests/pine-regime-slices.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRegimeSlice, summarizeRegimeSliceMetrics, freezeRegimeThresholds } from '../scripts/lib/pine-regime-slices.mjs';

test('classifyRegimeSlice labels trend high-vol long-favored rows deterministically', () => {
  const thresholds = freezeRegimeThresholds({ atrPctMedian: 2, trendStrengthMedian: 25, longShortEdgeDelta: 0.1 });
  const label = classifyRegimeSlice({ atrPct: 3, trendStrength: 40, side: 'long', sideEdge: 0.2 }, thresholds);

  assert.deepEqual(label.sort(), ['high-vol', 'long-favored', 'trend'].sort());
});

test('summarizeRegimeSliceMetrics blocks low trade count slices', () => {
  const summary = summarizeRegimeSliceMetrics({ regimeSliceId: 'trend', trades: [{ pnl: 1 }, { pnl: -1 }], minTrades: 10 });

  assert.equal(summary.promotionEligible, false);
  assert.equal(summary.reason, 'insufficientRegimeTrades');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-regime-slices.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create regime slice helper**

Create deterministic thresholds and labels. Keep thresholds frozen from primary/training data. Export:

```js
export function freezeRegimeThresholds(raw = {}) { /* returns finite threshold object */ }
export function classifyRegimeSlice(row = {}, thresholds = {}) { /* returns array of labels */ }
export function summarizeRegimeSliceMetrics({ regimeSliceId, trades = [], minTrades = 30 } = {}) { /* compact metrics and eligibility */ }
```

- [ ] **Step 4: Run regime tests**

```bash
node --test tests/pine-regime-slices.test.mjs tests/pine-regime-analysis.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add scripts/lib/pine-regime-slices.mjs tests/pine-regime-slices.test.mjs
git commit -m "feat(pine): add deterministic regime slices"
```

---

## Task 9: Exit Family Generator

**Files:**
- Create: `scripts/lib/pine-exit-generators.mjs`
- Create: `tests/pine-exit-generators.test.mjs`

- [ ] **Step 1: Write exit generator tests**

Create `tests/pine-exit-generators.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExitFamilyCandidates, validateExitPatch } from '../scripts/lib/pine-exit-generators.mjs';

test('buildExitFamilyCandidates creates bounded ATR and trailing stop candidates', () => {
  const candidates = buildExitFamilyCandidates({
    incumbent: { config: { slAtrMult: 0.5, tpAtrMult: 7.6, useTrailingStop: false } },
    regimeSliceId: 'high-vol',
    maxConfigs: 4,
  });

  assert.equal(candidates.length <= 4, true);
  assert.equal(candidates.every((item) => item.family === 'exit-state'), true);
  assert.equal(candidates.every((item) => validateExitPatch(item.patch).ok), true);
});

test('validateExitPatch rejects impossible stop and target values', () => {
  assert.equal(validateExitPatch({ slAtrMult: -1 }).ok, false);
  assert.equal(validateExitPatch({ tpAtrMult: 0 }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-exit-generators.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create exit generator**

Create bounded exit families for:

- ATR stop/take-profit
- trailing stop toggle and distance
- breakeven trigger
- time stop bars
- long/short asymmetric stop/take-profit values

Do not enable partial take-profit until Pine feasibility is verified. Represent it as `status: 'blockedByPineFeasibility'` in generator metadata, not as a candidate patch.

- [ ] **Step 4: Run exit generator tests**

```bash
node --test tests/pine-exit-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 9**

```bash
git add scripts/lib/pine-exit-generators.mjs tests/pine-exit-generators.test.mjs
git commit -m "feat(pine): add exit family generator"
```

---

## Task 10: Global All-Parameter Generator

**Files:**
- Create: `scripts/lib/pine-global-search.mjs`
- Create: `tests/pine-global-search.test.mjs`

- [ ] **Step 1: Write global search tests**

Create `tests/pine-global-search.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGlobalMutationBatch, validateGlobalMutationPatch } from '../scripts/lib/pine-global-search.mjs';

test('buildGlobalMutationBatch touches grouped tunable families and freezes architecture switches', () => {
  const batch = buildGlobalMutationBatch({
    incumbent: { config: { minPredSum: 1.8, slAtrMult: 0.5, tpAtrMult: 7.6, useFusionV4: true } },
    maxConfigs: 6,
    frozenKeys: ['useFusionV4'],
    families: ['entry', 'risk', 'fusion-weight', 'asymmetry', 'exit-state'],
  });

  assert.equal(batch.length <= 6, true);
  assert.equal(batch.every((item) => !Object.hasOwn(item.patch, 'useFusionV4')), true);
  assert.equal(batch.every((item) => validateGlobalMutationPatch(item.patch, { frozenKeys: ['useFusionV4'] }).ok), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-global-search.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create global search helper**

Create grouped mutations for:

- `entry`
- `filters`
- `risk`
- `fusion-weight`
- `asymmetry`
- `exit-state`

Reject patches touching frozen keys. Emit metadata:

```js
{
  lane: 'global-all-parameter',
  mutationFamily: 'risk',
  patch: { slAtrMult: 0.6 },
  touchedKeys: ['slAtrMult']
}
```

- [ ] **Step 4: Run tests**

```bash
node --test tests/pine-global-search.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 10**

```bash
git add scripts/lib/pine-global-search.mjs tests/pine-global-search.test.mjs
git commit -m "feat(pine): add grouped global parameter search"
```

---

## Task 11: Budget Scheduler For Research Lanes

**Files:**
- Create: `scripts/lib/pine-regime-exit-scheduler.mjs`
- Create: `tests/pine-regime-exit-scheduler.test.mjs`

- [ ] **Step 1: Write scheduler tests**

Create `tests/pine-regime-exit-scheduler.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateRegimeExitLaneBudget, selectNextResearchLane } from '../scripts/lib/pine-regime-exit-scheduler.mjs';

test('allocateRegimeExitLaneBudget honors default ratios', () => {
  const budget = allocateRegimeExitLaneBudget({ maxConfigs: 20, lanes: { exploitRatio: 0.25, exitRegimeRatio: 0.35, globalAllParameterRatio: 0.25, robustnessRatio: 0.15 } });

  assert.deepEqual(budget, { exploit: 5, exitRegime: 7, globalAllParameter: 5, robustness: 3 });
});

test('selectNextResearchLane widens global search during stagnation', () => {
  const lane = selectNextResearchLane({ stagnationLevel: 2, budgetDebt: { globalAllParameter: 0, exitRegime: 10 }, lanesEnabled: { globalAllParameter: true, exitRegime: true, exploit: true, robustness: true } });

  assert.equal(lane, 'globalAllParameter');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create scheduler helper**

Create deterministic budget allocation and lane selection. Stagnation level 0 favors `exitRegime`; level 1 favors `globalAllParameter`; level 2 favors `globalAllParameter` and asymmetry metadata; level 3 favors aggressive global search but returns a flag `strictPromotionGates: true`.

- [ ] **Step 4: Run scheduler tests**

```bash
node --test tests/pine-regime-exit-scheduler.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 11**

```bash
git add scripts/lib/pine-regime-exit-scheduler.mjs tests/pine-regime-exit-scheduler.test.mjs
git commit -m "feat(pine): add regime exit research scheduler"
```

---

## Task 12: Staged Integration Into Autoresearch

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Create: `tests/pine-regime-exit-integration.test.mjs`

- [ ] **Step 1: Write feature-flag no-op integration test**

Create `tests/pine-regime-exit-integration.test.mjs` with a test that calls exported pure helpers from `scripts/pine-autoresearch.mjs` rather than running a full CLI cycle. Assert that when `regimeExitResearch.enabled=false`, manifest shape does not require new fields and old promotion decisions still work.

- [ ] **Step 2: Write enabled-path manifest test**

Add a test that builds a fake orchestration state with:

```js
regimeExitResearch: { enabled: true }
```

Expected manifest fields:

```js
assert.equal(result.manifest.researchBudgetMode, 'regime-exit');
assert.equal(result.manifest.resourceBudget.maxConcurrentLabWorkers >= 1, true);
assert.equal(result.manifest.objectiveBreakdown !== undefined, true);
assert.equal(result.manifest.offlineDataSummary !== undefined, true);
assert.equal(result.manifest.shadowRegimeScoreboard !== undefined, true);
```

- [ ] **Step 3: Run integration test to verify it fails**

```bash
node --test tests/pine-regime-exit-integration.test.mjs
```

Expected: FAIL because `buildScoutOrchestrationState` does not emit the new fields yet.

- [ ] **Step 4: Extend `buildScoutOrchestrationState` compactly**

Modify `scripts/pine-autoresearch.mjs` so `buildScoutOrchestrationState` accepts optional state:

```js
regimeExitState = {
  enabled: false,
  researchBudgetMode: null,
  resourceBudget: null,
  resourceUsageSummary: null,
  checkpointState: null,
  objectiveBreakdown: null,
  multipleTestingPenalty: null,
  holdoutVerdict: null,
  offlineDataSummary: null,
  shadowRegimeScoreboard: null,
}
```

When enabled, copy only compact summaries into the manifest. Never copy raw rows or full analysis objects.

- [ ] **Step 5: Add optional staged path in `runScout`**

In `runScout(config)`, branch:

```js
if (config.regimeExitResearch?.enabled) {
  // use new staged path
} else {
  // existing path unchanged
}
```

The first implementation of the staged path can reuse existing primary sweep/matrix execution, but it must:

- run offline preflight first
- allocate budget with `allocateRegimeExitLaneBudget`
- generate exit/global batches based on selected lane
- apply objective/multiple-testing summary to manifest
- write checkpoint events around expensive stages
- use worker runner for streaming analysis where practical
- return hold with diagnostics if resource/offline gates fail

- [ ] **Step 6: Run focused integration tests**

```bash
node --test tests/pine-regime-exit-integration.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 12**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-regime-exit-integration.test.mjs
git commit -m "feat(pine): wire staged regime exit research path"
```

---

## Task 13: Promotion Queue, Manifest Compatibility, And Old Artifact Safety

**Files:**
- Modify: `scripts/lib/pine-promotion-queue.mjs`
- Modify: `tests/pine-promotion-queue.test.mjs`
- Create: `tests/pine-regime-exit-compatibility.test.mjs`

- [ ] **Step 1: Add old manifest compatibility test**

Create `tests/pine-regime-exit-compatibility.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPromotionQueueItem } from '../scripts/lib/pine-promotion-queue.mjs';

test('old manifest without regime exit fields still builds promotion queue item', () => {
  const item = buildPromotionQueueItem({
    manifest: {
      runId: 'old-run',
      generatedAt: '2026-04-30T00:00:00.000Z',
      manifestPath: '/tmp/old-run.json',
      champion: { configId: 'champion' },
      challenger: { configId: 'challenger' },
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger' },
    },
    createdAt: '2026-05-05T00:00:00.000Z',
  });

  assert.equal(item.runId, 'old-run');
  assert.equal(item.regimeExitEvidence, null);
});
```

- [ ] **Step 2: Add new evidence queue test**

In `tests/pine-promotion-queue.test.mjs`, add a test asserting `buildPromotionQueueItem` captures:

```js
regimeExitEvidence: {
  regimeSliceId: 'trend',
  exitFamily: 'trailing-stop',
  objectiveBreakdown: { utility: 123 },
  resourceUsageSummary: { peakRssBytes: 1 },
  holdoutVerdict: { pass: true }
}
```

- [ ] **Step 3: Run tests to verify failure**

```bash
node --test tests/pine-regime-exit-compatibility.test.mjs tests/pine-promotion-queue.test.mjs
```

Expected: FAIL until queue item normalization supports new optional fields.

- [ ] **Step 4: Modify promotion queue normalization**

In `scripts/lib/pine-promotion-queue.mjs`, set:

```js
regimeExitEvidence: manifest.regimeExitEvidence ?? null,
```

If the manifest stores separate fields, build a compact evidence object from those fields:

```js
const regimeExitEvidence = manifest.regimeExitEvidence ?? (manifest.researchBudgetMode === 'regime-exit' ? {
  regimeSliceId: manifest.regimeSliceId ?? null,
  exitFamily: manifest.exitFamily ?? null,
  globalMutationFamily: manifest.globalMutationFamily ?? null,
  objectiveBreakdown: manifest.objectiveBreakdown ?? null,
  multipleTestingPenalty: manifest.multipleTestingPenalty ?? null,
  resourceUsageSummary: manifest.resourceUsageSummary ?? null,
  holdoutVerdict: manifest.holdoutVerdict ?? null,
} : null);
```

- [ ] **Step 5: Run compatibility tests**

```bash
node --test tests/pine-regime-exit-compatibility.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 13**

```bash
git add scripts/lib/pine-promotion-queue.mjs tests/pine-promotion-queue.test.mjs tests/pine-regime-exit-compatibility.test.mjs
git commit -m "feat(pine): preserve regime exit promotion evidence"
```

---

## Task 14: Documentation And Schema Updates

**Files:**
- Modify: `docs/reference/modules.md`
- Modify: `docs/reference/schemas.md`
- Modify: `docs/pine-autoresearch.md`
- Modify: `docs/artifacts-and-state.md`
- Modify: `docs/pine-tooling.md`

- [ ] **Step 1: Update module reference**

Add rows for new modules in `docs/reference/modules.md` under autoresearch internals. Each row must list responsibility and test file.

Required rows:

```markdown
| `scripts/lib/pine-regime-exit-config.mjs` | Feature flags, offline mode, lane ratios, resource caps, and objective policy normalization | `tests/pine-regime-exit-config.test.mjs` |
| `scripts/lib/pine-offline-data-plan.mjs` | Offline-strict dataset/cache preflight summaries | `tests/pine-offline-data-plan.test.mjs` |
| `scripts/lib/pine-objective-function.mjs` | Candidate utility, hard objective gates, multiple-testing penalty | `tests/pine-objective-function.test.mjs` |
| `scripts/lib/pine-resource-budget.mjs` | Resource caps, manifest spill checks, artifact references, usage summaries | `tests/pine-resource-budget.test.mjs` |
| `scripts/lib/pine-streaming-metrics.mjs` | Streaming JSONL analysis and bounded metric summaries | `tests/pine-streaming-metrics.test.mjs` |
| `scripts/lib/pine-checkpoint-state.mjs` | Append-only checkpoint/resume state | `tests/pine-checkpoint-state.test.mjs` |
| `scripts/lib/pine-regime-slices.mjs` | Deterministic regime labels and slice metrics | `tests/pine-regime-slices.test.mjs` |
| `scripts/lib/pine-exit-generators.mjs` | Bounded exit-family candidate patches | `tests/pine-exit-generators.test.mjs` |
| `scripts/lib/pine-global-search.mjs` | Grouped all-parameter mutations with frozen architecture enforcement | `tests/pine-global-search.test.mjs` |
| `scripts/lib/pine-regime-exit-scheduler.mjs` | Lane budget allocation and stagnation widening | `tests/pine-regime-exit-scheduler.test.mjs` |
| `scripts/lib/pine-worker-runner.mjs` | Child-process worker execution with timeout/memory diagnostics | `tests/pine-worker-runner.test.mjs` |
```

- [ ] **Step 2: Update schema reference**

In `docs/reference/schemas.md`, add optional manifest fields:

```markdown
- `researchBudgetMode`
- `budgetAllocation`
- `offlineDataSummary`
- `resourceBudget`
- `resourceUsageSummary`
- `checkpointState`
- `objectiveBreakdown`
- `multipleTestingPenalty`
- `holdoutVerdict`
- `shadowRegimeScoreboard`
- `regimeExitEvidence`
```

Mark each field optional for old manifests.

- [ ] **Step 3: Update operator docs**

In `docs/pine-autoresearch.md`, add an operator section:

```markdown
## Regime-conditioned exit research

The feature is controlled by `config.pine-autoresearch.default.json` under `regimeExitResearch`. Keep `enabled=false` until dataset verification, focused tests, and a micro cycle pass.

Safe activation flow:
1. `npm run pine:dataset:verify`
2. `npm run pine:autoresearch:micro`
3. inspect latest manifest fields `offlineDataSummary`, `resourceUsageSummary`, `objectiveBreakdown`, and `promotionGateBreakdown`
4. enable full scheduled cycle only after micro artifacts look sane
```

- [ ] **Step 4: Update artifact docs**

In `docs/artifacts-and-state.md`, document checkpoint JSONL and heavy artifact references. State that raw/cleaned/signals JSONL are operational and prunable after summaries/hashes are written.

- [ ] **Step 5: Update tooling docs**

In `docs/pine-tooling.md`, add offline strict command flow:

```bash
npm run pine:dataset:verify
npm run pine:autoresearch:micro
```

Explain that refresh/pin commands are the only intended network path.

- [ ] **Step 6: Run docs grep self-check**

```bash
node -e "const fs=require('fs'); const files=['docs/reference/modules.md','docs/reference/schemas.md','docs/pine-autoresearch.md','docs/artifacts-and-state.md','docs/pine-tooling.md']; for (const f of files) { const s=fs.readFileSync(f,'utf8'); if(!/regime|offline|resource|checkpoint|objective/i.test(s)) throw new Error(f+' missing new docs signal'); } console.log('docs ok')"
```

Expected:

```text
docs ok
```

- [ ] **Step 7: Commit Task 14**

```bash
git add docs/reference/modules.md docs/reference/schemas.md docs/pine-autoresearch.md docs/artifacts-and-state.md docs/pine-tooling.md
git commit -m "docs(pine): document regime exit research operations"
```

---

## Task 15: Hard Verification And Micro Cycle

**Files:**
- Modify only if verification finds a defect.

- [ ] **Step 1: Run focused unit suite**

```bash
node --test \
  tests/pine-regime-exit-config.test.mjs \
  tests/pine-offline-data-plan.test.mjs \
  tests/pine-objective-function.test.mjs \
  tests/pine-resource-budget.test.mjs \
  tests/pine-streaming-metrics.test.mjs \
  tests/pine-checkpoint-state.test.mjs \
  tests/pine-regime-slices.test.mjs \
  tests/pine-exit-generators.test.mjs \
  tests/pine-global-search.test.mjs \
  tests/pine-regime-exit-scheduler.test.mjs \
  tests/pine-worker-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run integration and compatibility suite**

```bash
node --test \
  tests/pine-regime-exit-integration.test.mjs \
  tests/pine-regime-exit-compatibility.test.mjs \
  tests/pine-autoresearch.test.mjs \
  tests/pine-promotion-queue.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run LLM no-regression suite**

```bash
node --test tests/pine-autoresearch-llm-no-regression.test.mjs tests/pine-autoresearch-llm-scheduler.test.mjs
```

Expected: PASS. Non-LLM additions must not change LLM lock/task namespace behavior.

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 5: Verify offline data coverage**

```bash
npm run pine:dataset:verify
```

Expected: PASS. If it fails, do not run research. Record missing lab/candle details.

- [ ] **Step 6: Enable feature only for micro profile**

Use a temporary config copy, not the default production config:

```bash
node -e "const fs=require('fs'); const cfg=JSON.parse(fs.readFileSync('config/pine-autoresearch.default.json','utf8')); cfg.regimeExitResearch.enabled=true; cfg.regimeExitResearch.resource.maxCandidateBatchSize=3; fs.writeFileSync('tmp/regime-exit-micro-config.json', JSON.stringify(cfg,null,2));"
```

Expected: file `tmp/regime-exit-micro-config.json` exists.

- [ ] **Step 7: Run micro cycle**

```bash
node ./scripts/pine-autoresearch.mjs cycle --config ./tmp/regime-exit-micro-config.json --profile micro
```

Expected:

- command exits `0`
- no unhandled exception
- no implicit network fetch
- manifest includes `offlineDataSummary`, `resourceUsageSummary`, `objectiveBreakdown`, and `promotionGateBreakdown`
- worker timeout/memory failure produces a hold decision with clear diagnostics

- [ ] **Step 8: Inspect latest manifest compactness**

Run:

```bash
node - <<'NODE'
const fs=require('fs');
const latest='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json';
const s=fs.readFileSync(latest,'utf8');
const j=JSON.parse(s);
const required=['offlineDataSummary','resourceUsageSummary','objectiveBreakdown','promotionGateBreakdown'];
for (const key of required) if (!(key in j)) throw new Error(`missing ${key}`);
if (s.length > (j.resourceBudget?.maxManifestBytes ?? 512000)) throw new Error(`manifest too large: ${s.length}`);
if (JSON.stringify(j).includes('Feature_RawLongPrediction')) throw new Error('manifest appears to contain raw row diagnostics');
console.log(JSON.stringify({ bytes: s.length, promotionEligible: j.promotionEligible, reason: j.promotionEligibleReason }, null, 2));
NODE
```

Expected: JSON summary printed; no error.

- [ ] **Step 9: Run diff check**

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 10: Inspect dirty tree**

```bash
git status --short
```

Expected: only intentional source/docs/test changes plus ignored runtime artifacts. Do not commit generated runtime artifacts under `pine/autoresearch`, `pine/sweeps`, `pine/dump`, `report`, or `tmp` unless repository rules explicitly track them.

- [ ] **Step 11: Final commit**

```bash
git add scripts config tests docs
git commit -m "feat(pine): add regime conditioned exit research"
```

Expected: final implementation commit.

---

## Self-Review Checklist

### Spec coverage

- Objective function: Task 3.
- Leakage and walk-forward controls: Tasks 2, 8, 12, 15.
- Multiple-testing / overfit controls: Task 3 and Task 12.
- Offline/connectivity model: Task 2 and Task 15.
- Resource architecture: Tasks 4, 5, 6, 7, 12, 15.
- Streaming metrics: Task 5 and Task 6.
- Staged evaluation ladder: Task 12 and Task 15.
- Child-process isolation: Task 6 and Task 12.
- Checkpoint/resume: Task 7 and Task 12.
- Artifact diet: Task 4, Task 12, Task 14, Task 15.
- Rollback/kill switch: Task 1 and Task 12.
- Backward compatibility/migration: Task 13 and Task 14.
- Regime slices: Task 8.
- Exit family generation: Task 9.
- Global all-parameter search: Task 10.
- Scheduler/budget allocation: Task 11.
- Promotion evidence and queueing: Task 13.
- Hard verification: Task 15.

### Verification gates

Do not call the implementation complete unless all pass:

1. focused unit suite passes
2. integration/compatibility suite passes
3. LLM no-regression suite passes
4. full `npm test` passes
5. `npm run pine:dataset:verify` passes
6. feature-enabled micro cycle exits 0
7. latest manifest compactness check passes
8. `git diff --check` passes
9. dirty tree contains no generated runtime artifacts staged for commit

### Safety invariants

- Feature disabled path preserves existing behavior.
- Offline strict cycle never silently fetches network data.
- Stagnation widens search but never loosens promotion gates.
- Old manifests and queue items remain readable.
- Heavy rows and full lab analysis objects stay out of manifests.
- Worker failure produces hold/diagnostic, not scheduler crash.
- LLM lane remains isolated.
