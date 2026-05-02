# Pine LLM Autoresearch Evaluator Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run pine:autoresearch:llm` run the full propose → validate → existing Pine matrix evaluation → LLM review queue flow, so manual work remains only final promotion review, not candidate application/backtest wiring.

**Architecture:** Dependency direction is one-way: LLM lane imports neutral/non-LLM Pine autoresearch evaluator seams; existing Pine autoresearch never imports LLM code and must keep working if all `pine-autoresearch-llm*` files are deleted. The bridge evaluates exactly one LLM parameter patch by merging it over the current champion config, running the existing Pine matrix evaluator on primary + shadow selection labs, writing an autoresearch-compatible evaluation manifest plus an LLM lane manifest that references it, then enqueueing manual review only when matrix gates recommend promotion.

**Tech Stack:** Node.js ESM, PowerShell scheduler wrappers, `node:test`, existing Pine sweep/import/evaluator scripts, JSON/JSONL state artifacts.

---

## Current State And Constraints

### Current behavior

- `scripts/lib/pine-autoresearch-llm-runner.mjs` already supports injected `executeCandidate` for tests.
- Production CLI `scripts/pine-autoresearch-llm.mjs` does not inject a real executor.
- Default executor currently returns success with `metricsDelta: {}`, no real backtest, no real matrix decision, and no useful promotion signal.
- Existing non-LLM autoresearch has the evaluator logic: `runPrimarySweep`, `evaluateConfigOnLab`, `evaluateMatrix`, manifest writing, promotion queue, and promotion.

### Required outcome

After implementation:

```powershell
npm run pine:autoresearch:llm
```

must perform:

```text
LLM provider proposes one bounded parameter patch
→ LLM candidate parser/validator checks allowlist
→ bridge merges patch over current champion config
→ existing Pine matrix evaluator runs primary + shadow labs
→ bridge writes evaluation manifest under normal autoresearch research root
→ LLM runner writes LLM lane manifest referencing evaluation manifest
→ if matrix decision is promote, candidate enters LLM manual-review queue
```

### Non-negotiable dependency rule

Allowed:

```text
scripts/lib/pine-autoresearch-llm-evaluator.mjs
  imports ../pine-autoresearch.mjs exports
  imports ./pine-autoresearch-llm-* helpers
```

Forbidden:

```text
scripts/pine-autoresearch.mjs
scripts/lib/pine-autoresearch.mjs
scripts/lib/pine-tuner.mjs
scripts/pine-sweep.mjs
scripts/pine-import-run-clean.mjs
  import anything matching pine-autoresearch-llm
```

Add a test that scans imports and fails if this direction is violated.

### Manual intervention after bridge

Still required:

- human reviews candidate before promotion
- human runs/approves promotion command

No longer required:

- manually copy LLM params into Pine/config
- manually run separate backtest to know whether LLM candidate is good
- manually create evaluator manifest

---

## File Structure

### Create

- `scripts/lib/pine-autoresearch-llm-evaluator.mjs`
  - Production bridge from LLM candidate patch to existing Pine autoresearch matrix evaluator.
  - Owns LLM-specific challenger construction, LLM evaluation manifest shape, metrics delta summary, and safe executor return object.

- `tests/pine-autoresearch-llm-evaluator.test.mjs`
  - Unit tests for patch merge, challenger identity, metrics delta, manifest shape, promotable mapping, and failure handling.

- `tests/pine-autoresearch-dependency-direction.test.mjs`
  - Import-direction guard: non-LLM autoresearch files cannot import `pine-autoresearch-llm` modules.

### Modify

- `scripts/pine-autoresearch.mjs`
  - Export evaluator seams from existing implementation without importing LLM code.
  - Add no behavior change to normal `cycle`, `digest`, `promote`, `autopromote`, or scheduler paths.

- `scripts/lib/pine-autoresearch-llm-runner.mjs`
  - Use production executor when no test executor is injected and `config.execution.mode === "matrix-eval"`.
  - Stop treating executor manifest path as the LLM manifest output path.
  - Store evaluator manifest reference inside LLM lane manifest.

- `config/pine-autoresearch-llm.default.json`
  - Add explicit execution block.

- `package.json`
  - Add review helper scripts if missing.

- `docs/pine-llm-autoresearch.md`
  - Document the new bridge, exactly what is automatic, and what remains manual.

- `tests/pine-autoresearch-llm-runner.test.mjs`
  - Update executor manifest semantics and add production executor injection/selection tests.

- `tests/pine-autoresearch-llm-e2e.test.mjs`
  - Add end-to-end fixture proving LLM candidate can become matrix-evaluated and review-queued without touching existing promotion queue.

---

## Design Details

### Evaluator manifest distinction

Do not overload `manifestPath`.

Use two manifest paths:

```js
{
  manifestPath: "pine/autoresearch-llm/.../manifests/<id>.json",          // LLM lane manifest
  evaluationManifestPath: "pine/autoresearch/.../manifests/<id>.json"     // existing autoresearch-compatible manifest
}
```

Reason: current `writeManifest()` writes the LLM lane payload to `executeResult.manifestPath` if present. That is unsafe because it can overwrite a real autoresearch manifest. Fix this before adding real evaluation.

### Promotion behavior

The bridge must not directly call `runPromote()`.

Promotion path stays explicit:

```powershell
node ./scripts/pine-autoresearch.mjs promote --config ./config/pine-autoresearch.default.json --manifest <evaluationManifestPath>
```

Autopromote remains off unless separately enabled by existing non-LLM policy.

### Existing autoresearch remains independent

The safest seam is to export existing functions from `scripts/pine-autoresearch.mjs` and import them from LLM bridge. This avoids copying evaluator logic and keeps all backtest/matrix policy behavior centralized.

Required exports:

```js
export {
  ensureChampionState,
  evaluateMatrix,
  manifestsDir,
  latestManifestPath,
};
```

If direct export of private functions makes the CLI file too broad, create a neutral helper module instead:

```text
scripts/lib/pine-autoresearch-evaluator.mjs
```

Then make both `scripts/pine-autoresearch.mjs` and `scripts/lib/pine-autoresearch-llm-evaluator.mjs` import that neutral helper. Do not create any import from neutral helper to LLM files.

Recommended first implementation: minimal exports from `scripts/pine-autoresearch.mjs`, because it is smaller blast radius than moving evaluator code.

---

## Task 1: Add Dependency Direction Guard

**Files:**
- Create: `tests/pine-autoresearch-dependency-direction.test.mjs`

- [ ] **Step 1: Write failing dependency guard test**

Create `tests/pine-autoresearch-dependency-direction.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

const NON_LLM_FILES = [
  'scripts/pine-autoresearch.mjs',
  'scripts/lib/pine-autoresearch.mjs',
  'scripts/lib/pine-tuner.mjs',
  'scripts/pine-sweep.mjs',
  'scripts/pine-import-run-clean.mjs',
];

test('non-LLM autoresearch files do not import LLM lane modules', async () => {
  const offenders = [];

  for (const relativePath of NON_LLM_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    const source = await fs.readFile(absolutePath, 'utf8');
    const importLines = source
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => /^\s*import\s/.test(line) || /from\s+['"]/.test(line));

    for (const { line, lineNumber } of importLines) {
      if (/pine-autoresearch-llm/i.test(line)) {
        offenders.push(`${relativePath}:${lineNumber}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run test**

Run:

```bash
npm test -- tests/pine-autoresearch-dependency-direction.test.mjs
```

Expected: PASS now. This test protects future tasks.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-autoresearch-dependency-direction.test.mjs
git commit -m "test(pine): guard autoresearch llm dependency direction"
```

---

## Task 2: Export Existing Evaluator Seams Without Behavior Change

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write export smoke test**

In `tests/pine-autoresearch.test.mjs`, extend the existing import from `../scripts/pine-autoresearch.mjs` to include:

```js
  evaluateMatrix,
  ensureChampionState,
  latestManifestPath,
  manifestsDir,
```

Add this test near other exported-helper tests:

```js
test('pine autoresearch exposes neutral evaluator seams for external lanes', () => {
  assert.equal(typeof evaluateMatrix, 'function');
  assert.equal(typeof ensureChampionState, 'function');
  assert.equal(typeof latestManifestPath, 'function');
  assert.equal(typeof manifestsDir, 'function');
});
```

- [ ] **Step 2: Run focused test and verify fail**

Run:

```bash
npm test -- tests/pine-autoresearch.test.mjs --test-name-pattern "neutral evaluator seams"
```

Expected: FAIL with missing export errors.

- [ ] **Step 3: Export existing functions**

In `scripts/pine-autoresearch.mjs`, change function declarations from private to exported:

```js
export async function ensureChampionState(config) {
```

```js
export function manifestsDir(config) {
```

```js
export function latestManifestPath(config) {
```

```js
export async function evaluateMatrix(config, runId, championState, challengerSummary) {
```

Do not change function bodies.

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- tests/pine-autoresearch.test.mjs --test-name-pattern "neutral evaluator seams"
npm test -- tests/pine-autoresearch.test.mjs
npm test -- tests/pine-autoresearch-dependency-direction.test.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): expose neutral autoresearch evaluator seams"
```

---

## Task 3: Add LLM Evaluator Adapter Unit Tests

**Files:**
- Create: `tests/pine-autoresearch-llm-evaluator.test.mjs`
- Create later: `scripts/lib/pine-autoresearch-llm-evaluator.mjs`

- [ ] **Step 1: Write tests for pure adapter logic**

Create `tests/pine-autoresearch-llm-evaluator.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLlmChallengerSummary,
  summarizeLlmMatrixDelta,
  shouldEnqueueLlmCandidate,
} from '../scripts/lib/pine-autoresearch-llm-evaluator.mjs';

test('buildLlmChallengerSummary merges LLM patch over champion config', () => {
  const championState = {
    configId: 'champion-a',
    label: 'Champion A',
    config: {
      minPredSum: 2,
      divRsiLen: 14,
      useFusionV4: true,
    },
  };

  const challenger = buildLlmChallengerSummary({
    championState,
    candidate: {
      patch: {
        minPredSum: 2.3,
        divRsiLen: 21,
      },
      rationale: 'Raise selectivity and lengthen divergence lookback.',
    },
    candidateFingerprint: 'abcdef1234567890',
  });

  assert.equal(challenger.label, 'llm-abcdef123456');
  assert.equal(challenger.source, 'llm');
  assert.equal(challenger.parentConfigId, 'champion-a');
  assert.deepEqual(challenger.patch, { minPredSum: 2.3, divRsiLen: 21 });
  assert.deepEqual(challenger.config, {
    minPredSum: 2.3,
    divRsiLen: 21,
    useFusionV4: true,
  });
  assert.notEqual(challenger.configId, 'champion-a');
});

test('summarizeLlmMatrixDelta uses aggregate matrix comparisons', () => {
  const delta = summarizeLlmMatrixDelta({
    labResults: [
      {
        lab: { labId: 'primary' },
        decision: {
          recommendation: 'promote',
          comparisons: {
            scoreDelta: 1.5,
            roiDeltaPct: 4.2,
            profitFactorDelta: 0.3,
            drawdownDeltaPct: -0.5,
          },
        },
      },
      {
        lab: { labId: 'shadow' },
        decision: {
          recommendation: 'hold',
          comparisons: {
            scoreDelta: -0.25,
            roiDeltaPct: 1.1,
            profitFactorDelta: 0.05,
            drawdownDeltaPct: 0.2,
          },
        },
      },
    ],
    matrixDecision: {
      recommendation: 'hold',
      summary: '1/2 labs passed.',
    },
  });

  assert.deepEqual(delta, {
    recommendation: 'hold',
    summary: '1/2 labs passed.',
    labCount: 2,
    promotedLabCount: 1,
    aggregateScoreDelta: 1.25,
    aggregateRoiDeltaPct: 5.3,
    aggregateProfitFactorDelta: 0.35,
    aggregateDrawdownDeltaPct: -0.3,
  });
});

test('shouldEnqueueLlmCandidate only allows matrix promote recommendation', () => {
  assert.equal(shouldEnqueueLlmCandidate({ matrixDecision: { recommendation: 'promote' } }), true);
  assert.equal(shouldEnqueueLlmCandidate({ matrixDecision: { recommendation: 'hold' } }), false);
  assert.equal(shouldEnqueueLlmCandidate({ matrixDecision: null }), false);
});
```

- [ ] **Step 2: Run tests and verify fail**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-evaluator.test.mjs
```

Expected: FAIL because module does not exist.

---

## Task 4: Implement LLM Evaluator Adapter Pure Helpers

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-evaluator.mjs`

- [ ] **Step 1: Add pure helper implementation**

Create `scripts/lib/pine-autoresearch-llm-evaluator.mjs` with:

```js
import path from 'node:path';

import {
  configFingerprint,
  isoNow,
  writeJson,
} from './pine-autoresearch.mjs';

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildLlmChallengerSummary({ championState, candidate, candidateFingerprint } = {}) {
  if (!championState?.config || typeof championState.config !== 'object') {
    throw new Error('championState.config required');
  }
  if (!candidate?.patch || typeof candidate.patch !== 'object' || Array.isArray(candidate.patch)) {
    throw new Error('candidate.patch required');
  }
  if (!candidateFingerprint) {
    throw new Error('candidateFingerprint required');
  }

  const patch = { ...candidate.patch };
  const config = { ...championState.config, ...patch };
  const configHash = configFingerprint(config);
  const shortCandidate = String(candidateFingerprint).slice(0, 12);
  const shortConfig = String(configHash).slice(0, 12);

  return {
    label: `llm-${shortCandidate}`,
    configId: `llm-${shortConfig}`,
    source: 'llm',
    parentConfigId: championState.configId ?? championState.label ?? null,
    parentConfigFingerprint: configFingerprint(championState.config),
    candidateFingerprint,
    patch,
    rationale: candidate.rationale ?? candidate.hypothesis ?? null,
    config,
  };
}

export function summarizeLlmMatrixDelta({ labResults = [], matrixDecision = null } = {}) {
  const promotedLabCount = labResults.filter((item) => item?.decision?.recommendation === 'promote').length;

  return {
    recommendation: matrixDecision?.recommendation ?? null,
    summary: matrixDecision?.summary ?? null,
    labCount: labResults.length,
    promotedLabCount,
    aggregateScoreDelta: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.scoreDelta ?? 0), 0)),
    aggregateRoiDeltaPct: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.roiDeltaPct ?? 0), 0)),
    aggregateProfitFactorDelta: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.profitFactorDelta ?? 0), 0)),
    aggregateDrawdownDeltaPct: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.drawdownDeltaPct ?? 0), 0)),
  };
}

export function shouldEnqueueLlmCandidate({ matrixDecision } = {}) {
  return matrixDecision?.recommendation === 'promote';
}

export async function writeLlmEvaluationManifest({
  baseConfig,
  runId,
  championState,
  challengerSummary,
  labResults,
  matrixDecision,
  evaluationManifestPath,
} = {}) {
  if (!baseConfig?.matrixId) throw new Error('baseConfig.matrixId required');
  if (!baseConfig?.researchRoot) throw new Error('baseConfig.researchRoot required');
  if (!runId) throw new Error('runId required');
  if (!challengerSummary?.config) throw new Error('challengerSummary.config required');

  const manifestPath = evaluationManifestPath
    ?? path.join(baseConfig.researchRoot, 'manifests', `${runId}.json`);

  const generatedAt = isoNow();
  const manifest = {
    lane: 'llm-evaluator-bridge',
    generatedAt,
    runId,
    matrixId: baseConfig.matrixId,
    champion: championState,
    challenger: challengerSummary,
    matrixCandidates: [{
      challenger: challengerSummary,
      labResults,
      matrixDecision,
      robustness: summarizeLlmMatrixDelta({ labResults, matrixDecision }),
    }],
    labResults,
    matrixDecision,
    promotionEligible: shouldEnqueueLlmCandidate({ matrixDecision }),
    promotionEligibleReason: matrixDecision?.summary ?? null,
    noNewCandidate: false,
  };

  await writeJson(manifestPath, manifest);
  return { manifestPath, manifest };
}
```

- [ ] **Step 2: Run pure helper tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-evaluator.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run dependency guard**

Run:

```bash
npm test -- tests/pine-autoresearch-dependency-direction.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/pine-autoresearch-llm-evaluator.mjs tests/pine-autoresearch-llm-evaluator.test.mjs
git commit -m "feat(pine): add llm autoresearch evaluator adapter helpers"
```

---

## Task 5: Add Production Matrix Executor With Injected Test Seams

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-evaluator.mjs`
- Modify: `tests/pine-autoresearch-llm-evaluator.test.mjs`

- [ ] **Step 1: Add executor test with injected dependencies**

Append to `tests/pine-autoresearch-llm-evaluator.test.mjs`:

```js
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

import { executeLlmMatrixCandidate } from '../scripts/lib/pine-autoresearch-llm-evaluator.mjs';

test('executeLlmMatrixCandidate evaluates one LLM patch through injected matrix evaluator', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-evaluator-'));

  try {
    const baseConfig = {
      matrixId: 'matrix-a',
      researchRoot: path.join(dir, 'pine/autoresearch/matrix-a'),
    };
    const championState = {
      configId: 'champion-a',
      config: { minPredSum: 2, divRsiLen: 14, useFusionV4: true },
    };

    const result = await executeLlmMatrixCandidate({
      candidate: { patch: { minPredSum: 2.2 }, rationale: 'raise selectivity' },
      candidateFingerprint: 'abc123def456999',
      config: { baseConfigPath: './config/pine-autoresearch.default.json' },
      repoRoot: dir,
      loadBaseConfig: async () => baseConfig,
      loadChampionState: async () => championState,
      evaluateMatrixCandidate: async ({ challengerSummary }) => ({
        labResults: [{
          lab: { labId: 'primary' },
          decision: {
            recommendation: 'promote',
            comparisons: {
              scoreDelta: 2,
              roiDeltaPct: 3,
              profitFactorDelta: 0.4,
              drawdownDeltaPct: -0.1,
            },
          },
          challenger: { config: challengerSummary.config },
        }],
        matrixDecision: { recommendation: 'promote', summary: 'primary passed' },
      }),
      nowId: () => '2026-05-02T00-00-00-000Z',
    });

    assert.equal(result.ok, true);
    assert.equal(result.promotable, true);
    assert.equal(result.runId, 'llm-matrix-a-2026-05-02T00-00-00-000Z-abc123def456');
    assert.equal(result.metricsDelta.recommendation, 'promote');
    assert.equal(result.metricsDelta.aggregateScoreDelta, 2);
    assert.match(result.evaluationManifestPath, /llm-matrix-a-2026-05-02T00-00-00-000Z-abc123def456\.json$/);

    const manifest = JSON.parse(await fs.readFile(result.evaluationManifestPath, 'utf8'));
    assert.equal(manifest.lane, 'llm-evaluator-bridge');
    assert.equal(manifest.matrixDecision.recommendation, 'promote');
    assert.equal(manifest.challenger.config.minPredSum, 2.2);
    assert.equal(manifest.challenger.config.useFusionV4, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and verify fail**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-evaluator.test.mjs --test-name-pattern executeLlmMatrixCandidate
```

Expected: FAIL because `executeLlmMatrixCandidate` does not exist.

- [ ] **Step 3: Implement production executor**

Append these imports to `scripts/lib/pine-autoresearch-llm-evaluator.mjs`:

```js
import {
  ensureChampionState,
  evaluateMatrix,
  loadConfig as loadAutoresearchConfig,
  timestampId,
} from '../pine-autoresearch.mjs';
```

Append this function:

```js
export async function executeLlmMatrixCandidate({
  candidate,
  candidateFingerprint,
  config,
  repoRoot = process.cwd(),
  loadBaseConfig = loadAutoresearchConfig,
  loadChampionState = ensureChampionState,
  evaluateMatrixCandidate = evaluateMatrix,
  nowId = timestampId,
} = {}) {
  if (!candidate?.patch || typeof candidate.patch !== 'object') {
    return { ok: false, reason: 'missing_candidate_patch' };
  }
  if (!candidateFingerprint) {
    return { ok: false, reason: 'missing_candidate_fingerprint' };
  }

  const baseConfigPath = config?.baseConfigPath ?? './config/pine-autoresearch.default.json';
  const baseConfig = await loadBaseConfig(repoRoot, baseConfigPath, config?.execution?.baseOverrides ?? {});
  const championState = await loadChampionState(baseConfig);
  const challengerSummary = buildLlmChallengerSummary({ championState, candidate, candidateFingerprint });
  const runId = `llm-${baseConfig.matrixId}-${nowId()}-${String(candidateFingerprint).slice(0, 12)}`;

  const { labResults, matrixDecision } = await evaluateMatrixCandidate(
    baseConfig,
    runId,
    championState,
    challengerSummary,
  );

  const metricsDelta = summarizeLlmMatrixDelta({ labResults, matrixDecision });
  const { manifestPath: evaluationManifestPath } = await writeLlmEvaluationManifest({
    baseConfig,
    runId,
    championState,
    challengerSummary,
    labResults,
    matrixDecision,
  });

  return {
    ok: true,
    runId,
    evaluationManifestPath,
    metricsDelta,
    matrixDecision,
    labResults,
    promotable: shouldEnqueueLlmCandidate({ matrixDecision }),
  };
}
```

- [ ] **Step 4: Run evaluator tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-evaluator.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run existing autoresearch tests**

Run:

```bash
npm test -- tests/pine-autoresearch.test.mjs tests/pine-autoresearch-dependency-direction.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch-llm-evaluator.mjs tests/pine-autoresearch-llm-evaluator.test.mjs
git commit -m "feat(pine): evaluate llm candidates through matrix bridge"
```

---

## Task 6: Fix LLM Runner Manifest Semantics Before Wiring Executor

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Add regression test: executor evaluation manifest is referenced, not overwritten**

In `tests/pine-autoresearch-llm-runner.test.mjs`, add a test near executor tests:

```js
test('runner writes LLM manifest separately from executor evaluation manifest', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');
  const evaluationManifestPath = path.join(dir, 'evaluation-manifest.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({
      patch: { minPredSum: 1.8 },
      rationale: 'raise threshold',
    }), 'utf8');
    await fs.writeFile(evaluationManifestPath, JSON.stringify({
      lane: 'llm-evaluator-bridge',
      matrixDecision: { recommendation: 'promote' },
    }), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7 },
      memory: { maxPromptBytes: 4096 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => ({
        ok: true,
        runId: 'eval-run-a',
        evaluationManifestPath,
        metricsDelta: { recommendation: 'promote', aggregateScoreDelta: 1 },
        promotable: true,
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.notEqual(result.manifestPath, evaluationManifestPath);
    assert.equal(result.evaluationManifestPath, evaluationManifestPath);

    const evaluationManifest = JSON.parse(await fs.readFile(evaluationManifestPath, 'utf8'));
    assert.equal(evaluationManifest.lane, 'llm-evaluator-bridge');

    const llmManifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
    assert.equal(llmManifest.lane, 'llm');
    assert.equal(llmManifest.evaluationManifestPath, evaluationManifestPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and verify fail**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs --test-name-pattern "separately from executor evaluation manifest"
```

Expected: FAIL because runner currently treats executor `manifestPath` as LLM output path and does not return `evaluationManifestPath`.

- [ ] **Step 3: Update `writeManifest()` in runner**

In `scripts/lib/pine-autoresearch-llm-runner.mjs`, change `writeManifest()` to always allocate LLM lane path under `paths.manifests`:

```js
async function writeManifest({ paths, candidate, validation, identity, executeResult, config }) {
  const manifestPath = path.join(paths.manifests, `${timestampId()}-${identity.candidateFingerprint}.json`);
  const evaluationManifestPath = executeResult?.evaluationManifestPath ?? executeResult?.manifestPath ?? null;

  const payload = {
    lane: 'llm',
    createdAt: isoNow(),
    runId: executeResult?.runId ?? null,
    matrixId: paths.matrixId,
    candidateId: identity.candidateId,
    candidateFingerprint: identity.candidateFingerprint,
    parentChampionFingerprint: identity.parentChampionFingerprint ?? null,
    candidate,
    provider: { mode: config?.provider?.mode ?? null },
    metricsDelta: executeResult?.metricsDelta ?? null,
    matrixDecision: executeResult?.matrixDecision ?? null,
    evaluationManifestPath,
  };

  await writeJson(manifestPath, payload);
  return { manifestPath, evaluationManifestPath };
}
```

Then update call site:

```js
  const { manifestPath, evaluationManifestPath } = await writeManifest({
    paths,
    candidate: parsed,
    validation,
    identity,
    executeResult: execution,
    config,
  });
```

Update finalized reservation and review item to use both:

```js
manifestPath,
evaluationManifestPath,
```

Return both from `runLlmAutoresearch()`:

```js
return {
  ok: true,
  reason: resultReason,
  status,
  reviewSummary,
  candidateId: identity.candidateId,
  candidateFingerprint: identity.candidateFingerprint,
  runId: execution.runId ?? null,
  manifestPath,
  evaluationManifestPath,
  validation,
  execution,
};
```

- [ ] **Step 4: Run runner tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS after updating older assertions that expected injected `manifestPath` to be LLM output path.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "fix(pine): separate llm and evaluation manifest paths"
```

---

## Task 7: Wire Production Matrix Executor Into LLM Runner

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Modify: `config/pine-autoresearch-llm.default.json`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Add executor selection tests**

In `tests/pine-autoresearch-llm-runner.test.mjs`, add:

```js
test('runner uses injected executor before production matrix executor', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({ params: { minPredSum: 1.8 }, rationale: 'raise threshold' }), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      baseConfigPath: './config/pine-autoresearch.default.json',
      execution: { mode: 'matrix-eval' },
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7 },
      memory: { maxPromptBytes: 4096 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    let injectedCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      executeCandidate: async () => {
        injectedCalled = true;
        return { ok: true, runId: 'injected-run', metricsDelta: { recommendation: 'hold' } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(injectedCalled, true);
    assert.equal(result.runId, 'injected-run');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

Add a second test using a fake production executor option if runner exposes it for tests:

```js
test('runner uses production executor when execution mode is matrix-eval', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');

  try {
    await fs.writeFile(candidateFile, JSON.stringify({ params: { minPredSum: 1.8 }, rationale: 'raise threshold' }), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      allowlistPath,
      baseConfigPath: './config/pine-autoresearch.default.json',
      execution: { mode: 'matrix-eval' },
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 1.7 },
      memory: { maxPromptBytes: 4096 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    let productionCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      productionExecuteCandidate: async () => {
        productionCalled = true;
        return { ok: true, runId: 'production-run', metricsDelta: { recommendation: 'hold' } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(productionCalled, true);
    assert.equal(result.runId, 'production-run');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and verify fail**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs --test-name-pattern "production executor"
```

Expected: FAIL because runner does not accept/use `productionExecuteCandidate` and does not select matrix executor.

- [ ] **Step 3: Import production executor**

In `scripts/lib/pine-autoresearch-llm-runner.mjs`, add:

```js
import { executeLlmMatrixCandidate } from './pine-autoresearch-llm-evaluator.mjs';
```

Update function signature:

```js
export async function runLlmAutoresearch({
  configPath,
  repoRoot = process.cwd(),
  command = 'run',
  scheduled = false,
  executeCandidate,
  productionExecuteCandidate = executeLlmMatrixCandidate,
  proposeOpenAi,
} = {}) {
```

Replace executor resolution:

```js
  const executor = executeCandidate
    ?? (config?.execution?.mode === 'matrix-eval' ? productionExecuteCandidate : defaultExecuteCandidate);
```

When invoking executor, include `repoRoot`:

```js
    repoRoot,
```

- [ ] **Step 4: Add config execution block**

In `config/pine-autoresearch-llm.default.json`, add:

```json
  "execution": {
    "mode": "matrix-eval",
    "baseOverrides": {}
  },
```

Place it near `baseConfigPath`, before `scheduled`.

- [ ] **Step 5: Run runner tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-evaluator.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs config/pine-autoresearch-llm.default.json tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): wire llm runner to matrix evaluator"
```

---

## Task 8: Add E2E Test For Full Bridge Without Real API

**Files:**
- Modify: `tests/pine-autoresearch-llm-e2e.test.mjs`

- [ ] **Step 1: Add E2E test with file provider and injected production executor**

Add:

```js
test('LLM run can evaluate candidate and enqueue review without touching normal promotion queue', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-e2e-bridge-'));

  try {
    const configDir = path.join(dir, 'config');
    await fs.mkdir(configDir, { recursive: true });

    const allowlistPath = path.join(configDir, 'allowlist.json');
    const candidateFile = path.join(dir, 'candidate.json');
    const configPath = path.join(configDir, 'llm.json');
    const evaluationManifestPath = path.join(dir, 'pine/autoresearch/matrix-a/manifests/eval.json');

    await fs.mkdir(path.dirname(evaluationManifestPath), { recursive: true });
    await fs.writeFile(allowlistPath, JSON.stringify({
      version: 1,
      freezeArchitecture: true,
      maxChangedParams: 2,
      parameters: [
        { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
      ],
    }), 'utf8');
    await fs.writeFile(candidateFile, JSON.stringify({
      params: { minPredSum: 2.2 },
      rationale: 'raise selectivity',
    }), 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'matrix-a',
      baseConfigPath: './config/pine-autoresearch.default.json',
      allowlistPath,
      execution: { mode: 'matrix-eval' },
      provider: { mode: 'file', candidateFile },
      champion: { minPredSum: 2 },
      memory: { maxPromptBytes: 4096, maxHotMemoryBytes: 262144, recentCandidates: 20, topWinners: 10, tabuFingerprints: 50 },
      candidate: { maxChangedParams: 2 },
    }), 'utf8');

    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      productionExecuteCandidate: async () => {
        await fs.writeFile(evaluationManifestPath, JSON.stringify({
          lane: 'llm-evaluator-bridge',
          matrixDecision: { recommendation: 'promote', summary: 'fixture promote' },
          challenger: { config: { minPredSum: 2.2 } },
        }), 'utf8');
        return {
          ok: true,
          runId: 'eval-run',
          evaluationManifestPath,
          metricsDelta: { recommendation: 'promote', aggregateScoreDelta: 2 },
          matrixDecision: { recommendation: 'promote', summary: 'fixture promote' },
          promotable: true,
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.equal(result.evaluationManifestPath, evaluationManifestPath);

    const normalPromotionQueue = path.join(dir, 'pine/autoresearch/matrix-a/promotion-queue.jsonl');
    await assert.rejects(fs.readFile(normalPromotionQueue, 'utf8'), /ENOENT/);

    const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/review-queue.jsonl');
    const reviewQueue = await fs.readFile(reviewQueuePath, 'utf8');
    assert.match(reviewQueue, /pending_review/);
    assert.match(reviewQueue, /eval-run/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run E2E test**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-e2e.test.mjs --test-name-pattern "evaluate candidate and enqueue review"
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/pine-autoresearch-llm-e2e.test.mjs
git commit -m "test(pine): cover llm evaluator bridge e2e"
```

---

## Task 9: Add Review Helper Scripts And Docs

**Files:**
- Modify: `package.json`
- Modify: `docs/pine-llm-autoresearch.md`

- [ ] **Step 1: Add package scripts**

In `package.json`, add these scripts beside existing LLM scripts:

```json
"pine:autoresearch:llm:review-status": "node ./scripts/pine-autoresearch-llm.mjs review-status --config ./config/pine-autoresearch-llm.default.json",
"pine:autoresearch:llm:review-resolve": "node ./scripts/pine-autoresearch-llm.mjs review-resolve --config ./config/pine-autoresearch-llm.default.json"
```

- [ ] **Step 2: Update docs**

In `docs/pine-llm-autoresearch.md`, add section:

```md
## Matrix evaluator bridge

`npm run pine:autoresearch:llm` now runs the LLM candidate through the existing Pine autoresearch matrix evaluator when `execution.mode` is `matrix-eval`.

Automatic path:

1. provider returns exactly one JSON candidate
2. LLM allowlist validation accepts or rejects the patch
3. patch is merged over the current Pine autoresearch champion config
4. existing Pine matrix evaluator runs primary + shadow selection labs
5. LLM lane manifest is written under `pine/autoresearch-llm/`
6. evaluator manifest is written under the normal Pine autoresearch research root
7. matrix `promote` recommendation enqueues an LLM manual-review item

This does not make existing Pine autoresearch depend on LLM. Existing `pine:autoresearch`, `pine:autoresearch:promote`, and `pine:autoresearch:autopromote` continue to work without LLM files.

Manual review remains required before promotion. To inspect:

```bash
npm run pine:autoresearch:llm:review-status
```

To promote an accepted candidate, use the evaluator manifest path from the LLM manifest/review item:

```bash
node ./scripts/pine-autoresearch.mjs promote --config ./config/pine-autoresearch.default.json --manifest <evaluationManifestPath>
```
```

- [ ] **Step 3: Run docs grep smoke**

Run:

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('docs/pine-llm-autoresearch.md','utf8'); for (const term of ['Matrix evaluator bridge','evaluationManifestPath','pine:autoresearch:llm:review-status']) if (!s.includes(term)) throw new Error(term); console.log('docs ok')"
```

Expected:

```text
docs ok
```

- [ ] **Step 4: Commit**

```bash
git add package.json docs/pine-llm-autoresearch.md
git commit -m "docs(pine): document llm evaluator bridge workflow"
```

---

## Task 10: Full Regression And Safety Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run targeted LLM bridge suite**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-evaluator.test.mjs tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-e2e.test.mjs tests/pine-autoresearch-dependency-direction.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run existing autoresearch no-regression suite**

Run:

```bash
npm test -- tests/pine-autoresearch.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs tests/pine-autoresearch-llm-scheduler.test.mjs
```

Expected: all PASS.

- [ ] **Step 3: Run provider/schema safety suite**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-provider.test.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs tests/pine-autoresearch-llm-openai-http.test.mjs tests/pine-autoresearch-llm-openai-schema.test.mjs tests/pine-autoresearch-llm-schema.test.mjs
```

Expected: all PASS.

- [ ] **Step 4: Run formatting diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Run dependency grep**

Run:

```bash
node -e "const fs=require('fs'); const files=['scripts/pine-autoresearch.mjs','scripts/lib/pine-autoresearch.mjs','scripts/lib/pine-tuner.mjs','scripts/pine-sweep.mjs','scripts/pine-import-run-clean.mjs']; const bad=[]; for (const f of files) { const s=fs.readFileSync(f,'utf8'); if (/pine-autoresearch-llm/i.test(s)) bad.push(f); } if (bad.length) throw new Error(bad.join(',')); console.log('dependency direction ok')"
```

Expected:

```text
dependency direction ok
```

- [ ] **Step 6: Commit verification-only docs note only if needed**

If no files changed, do not commit. If docs needed correction, commit:

```bash
git add docs/pine-llm-autoresearch.md
git commit -m "docs(pine): clarify llm bridge verification"
```

---

## Task 11: Manual Smoke On Real Repo With File Provider

**Files:**
- Temporary local files only. Do not commit candidate secret files.

- [ ] **Step 1: Create temporary candidate file**

Run:

```bash
node -e "const fs=require('fs'); fs.writeFileSync('pine/tmp-llm-candidate.json', JSON.stringify({ params: { minPredSum: 2.2 }, rationale: 'Smoke test bounded LLM bridge candidate.' }, null, 2));"
```

- [ ] **Step 2: Temporarily switch provider to file for smoke**

Do not commit this config mutation. Use a local copy:

```bash
node - <<'NODE'
const fs = require('fs');
const base = JSON.parse(fs.readFileSync('config/pine-autoresearch-llm.default.json','utf8'));
base.provider = { mode: 'file', candidateFile: './pine/tmp-llm-candidate.json' };
base.execution = { mode: 'matrix-eval', baseOverrides: {} };
fs.writeFileSync('config/pine-autoresearch-llm.local-smoke.json', JSON.stringify(base, null, 2));
NODE
```

- [ ] **Step 3: Run bridge smoke**

Run:

```bash
node ./scripts/pine-autoresearch-llm.mjs run --config ./config/pine-autoresearch-llm.local-smoke.json
```

Expected output includes:

```text
[llm-autoresearch] status=completed
[llm-autoresearch] manifest=...
```

If matrix recommends promotion, output may show review queue status and reason `candidate_enqueued_for_review`.

- [ ] **Step 4: Inspect artifacts**

Run:

```bash
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const root = 'pine/autoresearch-llm';
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/manifest|status|review-queue/.test(entry.name)) files.push(p);
  }
}
walk(root);
console.log(files.slice(-10).join('\n'));
NODE
```

Expected: recent LLM lane manifest/status exists and LLM manifest contains `evaluationManifestPath`.

- [ ] **Step 5: Clean temporary smoke files**

Run:

```bash
rm -f pine/tmp-llm-candidate.json config/pine-autoresearch-llm.local-smoke.json
```

On PowerShell:

```powershell
Remove-Item pine/tmp-llm-candidate.json, config/pine-autoresearch-llm.local-smoke.json -ErrorAction SilentlyContinue
```

- [ ] **Step 6: Verify no temporary files staged**

Run:

```bash
git status --short
```

Expected: no temporary smoke files. Existing unrelated user files may still appear; do not touch them.

---

## Implementation Risk Checklist

- [ ] Existing non-LLM autoresearch imports no LLM code.
- [ ] Existing `pine:autoresearch` behavior unchanged except exported helper symbols.
- [ ] LLM runner no longer overwrites evaluator manifest.
- [ ] LLM candidate patch remains allowlist-bounded before evaluation.
- [ ] Bridge evaluates exactly one LLM candidate, not a batch.
- [ ] Bridge does not call `promote`.
- [ ] Review queue remains LLM-specific.
- [ ] Normal promotion queue is not written by LLM runner.
- [ ] API key values are never printed, stored in manifests, or committed.
- [ ] Scheduled LLM tasks still require explicit enablement.

---

## Self-Review

### Spec coverage

- Bridge into existing Pine evaluator: Tasks 2, 5, 7, 8.
- Keep existing autoresearch independent from LLM: Tasks 1, 2, 10.
- Remove manual candidate application/evaluation: Tasks 5, 7, 8, 11.
- Keep manual promotion review: Tasks 6, 9, risk checklist.
- Avoid bad implementation/logic: manifest separation, dependency guard, no direct promotion, allowlist validation remains before executor.

### Placeholder scan

No unresolved placeholder steps are intentionally present. The only angle-bracket placeholder is `<evaluationManifestPath>` in operator documentation because it is a runtime artifact path printed by the command.

### Type consistency

- Executor returns `evaluationManifestPath` for existing autoresearch-compatible manifest.
- Runner returns `manifestPath` for LLM lane manifest and `evaluationManifestPath` separately.
- Review item should include both paths after Task 6.
- `metricsDelta` is summary object from `summarizeLlmMatrixDelta()`.

---

## Execution Recommendation

Use subagent-driven implementation. This touches cross-cutting evaluator behavior and needs independent review after each task. Do not batch all tasks into one giant edit.
