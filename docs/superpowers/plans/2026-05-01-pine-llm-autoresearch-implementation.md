# Pine LLM Autoresearch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the isolated Pine LLM autoresearch lane specified in `docs/superpowers/specs/2026-05-01-pine-openclaw-llm-autoresearch-design.md` without changing existing autoresearch scheduler behavior.

**Architecture:** Add a separate LLM lane with its own config, allowlist, state root, locks, ledger, manual-review queue, provider boundary, runner, and Windows Task Scheduler wrappers. The scheduled path defaults to disabled, allows only `cli` provider, rejects `openclaw`, runs exactly one candidate, reserves before execution, and never auto-promotes.

**Tech Stack:** Node.js ESM modules, `node:test`, JSON/JSONL state files, PowerShell scheduler wrappers, existing Pine autoresearch scripts as read-only execution targets.

---

## Guardrails

- Work from repo root: `D:\Code\Experiment\backtest-kit-project`.
- Do not modify existing `pine:autoresearch*` behavior.
- Do not modify existing Windows task wrappers except via no-regression tests.
- Do not write to existing `promotion-queue.jsonl` from LLM lane.
- Do not use `openclaw` provider in scheduled mode.
- After each task, dispatch a subagent review before starting the next task.
- Commit after each task when tests pass.

## File Structure

### Create
- `config/pine-autoresearch-llm.default.json` — LLM lane config, disabled by default.
- `config/pine-autoresearch-llm-allowlist.default.json` — versioned parameter allowlist and mutability classes.
- `scripts/pine-autoresearch-llm.mjs` — CLI entrypoint for `run`, `propose`, `digest`, `validate`, `enqueue`, `review-status`, `review-resolve`.
- `scripts/lib/pine-autoresearch-llm-paths.mjs` — namespace and state path helpers.
- `scripts/lib/pine-autoresearch-llm-schema.mjs` — candidate parsing, schema validation, canonical fingerprinting.
- `scripts/lib/pine-autoresearch-llm-ledger.mjs` — append-only JSONL ledger.
- `scripts/lib/pine-autoresearch-llm-review-queue.mjs` — manual-review queue lifecycle.
- `scripts/lib/pine-autoresearch-llm-reservation.mjs` — durable reservation gate.
- `scripts/lib/pine-autoresearch-llm-memory.mjs` — compact research memory with caps.
- `scripts/lib/pine-autoresearch-llm-context.mjs` — prompt/context builder with byte caps.
- `scripts/lib/pine-autoresearch-llm-provider.mjs` — `disabled`, `file`, `cli`, and manual-only `openclaw` provider boundary.
- `scripts/lib/pine-autoresearch-llm-process-tree.mjs` — process-tree timeout and verification helpers.
- `scripts/lib/pine-autoresearch-llm-runner.mjs` — orchestration for run/propose/validate/digest.
- `scripts/ops/pine-autoresearch-llm-run.ps1` — scheduled wrapper with separate lock and mutex.
- `scripts/ops/install-pine-autoresearch-llm-tasks.ps1` — installs only `BacktestKit-Pine-LLM-*` tasks.
- `scripts/ops/remove-pine-autoresearch-llm-tasks.ps1` — removes only `BacktestKit-Pine-LLM-*` tasks.
- `tests/pine-autoresearch-llm-schema.test.mjs`
- `tests/pine-autoresearch-llm-ledger.test.mjs`
- `tests/pine-autoresearch-llm-review-queue.test.mjs`
- `tests/pine-autoresearch-llm-reservation.test.mjs`
- `tests/pine-autoresearch-llm-memory.test.mjs`
- `tests/pine-autoresearch-llm-context.test.mjs`
- `tests/pine-autoresearch-llm-provider.test.mjs`
- `tests/pine-autoresearch-llm-process-tree.test.mjs`
- `tests/pine-autoresearch-llm-runner.test.mjs`
- `tests/pine-autoresearch-llm-scheduler.test.mjs`
- `tests/pine-autoresearch-llm-no-regression.test.mjs`

### Modify
- `package.json` — add only LLM lane scripts.

---

### Task 1: Config Skeleton, Paths, Package Scripts

**Files:**
- Create: `config/pine-autoresearch-llm.default.json`
- Create: `config/pine-autoresearch-llm-allowlist.default.json`
- Create: `scripts/lib/pine-autoresearch-llm-paths.mjs`
- Create: `tests/pine-autoresearch-llm-paths.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing path tests**

Create `tests/pine-autoresearch-llm-paths.test.mjs`:

```js
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLlmLaneNamespace,
  buildLlmLanePaths,
  normalizeMatrixId,
} from '../scripts/lib/pine-autoresearch-llm-paths.mjs';

test('normalizeMatrixId keeps safe matrix ids unchanged', () => {
  assert.equal(normalizeMatrixId('pine-fusion-v4-core-15m-locked-window'), 'pine-fusion-v4-core-15m-locked-window');
});

test('normalizeMatrixId rejects path traversal and separators', () => {
  assert.throws(() => normalizeMatrixId('../x'), /unsafe matrixId/);
  assert.throws(() => normalizeMatrixId('a/b'), /unsafe matrixId/);
  assert.throws(() => normalizeMatrixId('a\\b'), /unsafe matrixId/);
});

test('buildLlmLaneNamespace prefixes matrix id', () => {
  assert.equal(
    buildLlmLaneNamespace('pine-fusion-v4-core-15m-locked-window'),
    'llm-pine-fusion-v4-core-15m-locked-window',
  );
});

test('buildLlmLanePaths returns isolated state names', () => {
  const paths = buildLlmLanePaths({
    repoRoot: 'C:/repo',
    matrixId: 'pine-fusion-v4-core-15m-locked-window',
  });

  assert.equal(paths.namespace, 'llm-pine-fusion-v4-core-15m-locked-window');
  assert.equal(paths.root, path.join('C:/repo', 'pine', 'autoresearch-llm', 'llm-pine-fusion-v4-core-15m-locked-window'));
  assert.equal(paths.schedulerLock, path.join(paths.state, 'llm-scheduler.lock'));
  assert.equal(paths.stateLock, path.join(paths.state, 'llm-state.lock'));
  assert.equal(paths.reservationLock, path.join(paths.state, 'llm-reservation.lock'));
  assert.equal(paths.ledger, path.join(paths.state, 'llm-ledger.jsonl'));
  assert.equal(paths.memory, path.join(paths.state, 'llm-research-memory.json'));
  assert.equal(paths.reviewQueue, path.join(paths.state, 'llm-manual-review-queue.jsonl'));
  assert.equal(paths.tabu, path.join(paths.state, 'llm-tabu-fingerprints.json'));
  assert.equal(paths.providerStatus, path.join(paths.state, 'llm-provider-status.json'));
  assert.equal(paths.mutexName, 'Global\\BacktestKit-Pine-LLM-Autoresearch-pine-fusion-v4-core-15m-locked-window');
  assert.ok(!paths.schedulerLock.includes('tmp\\pine-autoresearch-locks'));
  assert.ok(!paths.schedulerLock.includes('tmp/pine-autoresearch-locks'));
});
```

- [ ] **Step 2: Run failing path tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-paths.test.mjs
```

Expected: FAIL with module not found for `pine-autoresearch-llm-paths.mjs`.

- [ ] **Step 3: Implement path helper**

Create `scripts/lib/pine-autoresearch-llm-paths.mjs`:

```js
import path from 'node:path';

const SAFE_MATRIX_ID = /^[A-Za-z0-9._-]+$/;

export function normalizeMatrixId(matrixId) {
  if (typeof matrixId !== 'string' || !SAFE_MATRIX_ID.test(matrixId) || matrixId.includes('..')) {
    throw new Error(`unsafe matrixId: ${matrixId}`);
  }
  return matrixId;
}

export function buildLlmLaneNamespace(matrixId) {
  return `llm-${normalizeMatrixId(matrixId)}`;
}

export function buildLlmLanePaths({ repoRoot = process.cwd(), matrixId }) {
  const safeMatrixId = normalizeMatrixId(matrixId);
  const namespace = buildLlmLaneNamespace(safeMatrixId);
  const root = path.join(repoRoot, 'pine', 'autoresearch-llm', namespace);
  const state = path.join(root, 'state');
  const manifests = path.join(root, 'manifests');
  const runs = path.join(root, 'runs');
  const archive = path.join(root, 'archive');

  return {
    matrixId: safeMatrixId,
    namespace,
    root,
    state,
    manifests,
    runs,
    archive,
    schedulerLock: path.join(state, 'llm-scheduler.lock'),
    stateLock: path.join(state, 'llm-state.lock'),
    reservationLock: path.join(state, 'llm-reservation.lock'),
    ledger: path.join(state, 'llm-ledger.jsonl'),
    memory: path.join(state, 'llm-research-memory.json'),
    reviewQueue: path.join(state, 'llm-manual-review-queue.jsonl'),
    tabu: path.join(state, 'llm-tabu-fingerprints.json'),
    providerStatus: path.join(state, 'llm-provider-status.json'),
    mutexName: `Global\\BacktestKit-Pine-LLM-Autoresearch-${safeMatrixId}`,
  };
}
```

- [ ] **Step 4: Add config files**

Create `config/pine-autoresearch-llm.default.json`:

```json
{
  "matrixId": "pine-fusion-v4-core-15m-locked-window",
  "baseConfigPath": "./config/pine-autoresearch.default.json",
  "allowlistPath": "./config/pine-autoresearch-llm-allowlist.default.json",
  "stateRoot": "./pine/autoresearch-llm",
  "scheduled": {
    "enabled": false,
    "slotMs": 900000,
    "contextBudgetMs": 120000,
    "executionBudgetMs": 720000,
    "finalizeBudgetMs": 60000
  },
  "provider": {
    "mode": "disabled",
    "cliCommand": null,
    "timeoutMs": 90000
  },
  "candidate": {
    "maxChangedParams": 4,
    "noveltyDistanceMin": 1,
    "allowGuarded": false
  },
  "memory": {
    "maxHotMemoryBytes": 262144,
    "maxPromptBytes": 16384,
    "recentCandidates": 20,
    "tabuFingerprints": 200,
    "topWinners": 10,
    "archiveRetentionDays": 14,
    "keepLatestRuns": 12
  },
  "review": {
    "blockScheduledWhenUnresolved": true
  }
}
```

Create `config/pine-autoresearch-llm-allowlist.default.json`:

```json
{
  "version": 1,
  "freezeArchitecture": true,
  "maxChangedParams": 4,
  "parameters": [
    {
      "key": "minPredSum",
      "type": "float",
      "min": 0,
      "max": 5,
      "step": 0.1,
      "mutability": "tunable",
      "family": "signal",
      "rationale": "Entry score threshold controls selectivity without changing architecture."
    },
    {
      "key": "divRsiLen",
      "type": "int",
      "min": 5,
      "max": 50,
      "step": 1,
      "mutability": "tunable",
      "family": "divergence",
      "rationale": "Divergence lookback sensitivity is a bounded scalar parameter."
    },
    {
      "key": "riskRewardRatio",
      "type": "float",
      "min": 0.5,
      "max": 5,
      "step": 0.1,
      "mutability": "tunable",
      "family": "risk",
      "rationale": "Risk/reward scalar changes trade management without code structure changes."
    },
    {
      "key": "stopLossPct",
      "type": "float",
      "min": 0.1,
      "max": 10,
      "step": 0.1,
      "mutability": "tunable",
      "family": "risk",
      "rationale": "Stop distance is a bounded scalar risk parameter."
    },
    {
      "key": "useSignalFusion",
      "type": "bool",
      "mutability": "forbidden",
      "family": "architecture",
      "rationale": "Architecture toggle is forbidden in scheduled LLM research."
    },
    {
      "key": "useFusionV4",
      "type": "bool",
      "mutability": "forbidden",
      "family": "architecture",
      "rationale": "Architecture toggle is forbidden in scheduled LLM research."
    },
    {
      "key": "useTrailingStop",
      "type": "bool",
      "mutability": "forbidden",
      "family": "architecture",
      "rationale": "Trade-management structure toggle is forbidden by default."
    }
  ]
}
```

- [ ] **Step 5: Add package scripts without changing existing scripts**

Modify `package.json` scripts block by adding these entries after `pine:autoresearch:autopromote`:

```json
"pine:autoresearch:llm": "node ./scripts/pine-autoresearch-llm.mjs run --config ./config/pine-autoresearch-llm.default.json",
"pine:autoresearch:llm:propose": "node ./scripts/pine-autoresearch-llm.mjs propose --config ./config/pine-autoresearch-llm.default.json",
"pine:autoresearch:llm:digest": "node ./scripts/pine-autoresearch-llm.mjs digest --config ./config/pine-autoresearch-llm.default.json",
"pine:autoresearch:llm:validate": "node ./scripts/pine-autoresearch-llm.mjs validate --config ./config/pine-autoresearch-llm.default.json",
"pine:ops:install-llm-tasks": "pwsh -NoProfile -File ./scripts/ops/install-pine-autoresearch-llm-tasks.ps1",
"pine:ops:remove-llm-tasks": "pwsh -NoProfile -File ./scripts/ops/remove-pine-autoresearch-llm-tasks.ps1"
```

Keep all existing `pine:autoresearch*` values byte-for-byte identical.

- [ ] **Step 6: Run tests and no-regression script check**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-paths.test.mjs
node -e "const p=require('./package.json'); for (const k of ['pine:autoresearch','pine:autoresearch:micro','pine:autoresearch:digest','pine:autoresearch:autopromote']) console.log(k+'='+p.scripts[k])"
git diff --check
```

Expected: path tests PASS; existing script commands print unchanged values; diff check clean.

- [ ] **Step 7: Commit Task 1**

```bash
git add package.json config/pine-autoresearch-llm.default.json config/pine-autoresearch-llm-allowlist.default.json scripts/lib/pine-autoresearch-llm-paths.mjs tests/pine-autoresearch-llm-paths.test.mjs
git commit -m "feat(pine): add LLM autoresearch config skeleton"
```

- [ ] **Step 8: Subagent review checkpoint**

Dispatch review prompt:

```text
Review Task 1 for Pine LLM autoresearch. Confirm existing pine:autoresearch scripts are unchanged, config defaults provider=disabled, LLM paths use pine/autoresearch-llm/llm-<matrix-id>, and mutex name is distinct. Return APPROVE or required fixes. Do not edit files.
```

---

### Task 2: Allowlist Schema And Candidate Fingerprints

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-schema.mjs`
- Create: `tests/pine-autoresearch-llm-schema.test.mjs`

- [ ] **Step 1: Write failing schema tests**

Create `tests/pine-autoresearch-llm-schema.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeJson,
  fingerprintCandidate,
  parseCandidateJson,
  validateCandidate,
} from '../scripts/lib/pine-autoresearch-llm-schema.mjs';

const allowlist = {
  version: 1,
  freezeArchitecture: true,
  maxChangedParams: 2,
  parameters: [
    { key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' },
    { key: 'divRsiLen', type: 'int', min: 5, max: 50, step: 1, mutability: 'tunable', family: 'divergence' },
    { key: 'riskRewardRatio', type: 'float', min: 0.5, max: 5, step: 0.1, mutability: 'guarded', family: 'risk' },
    { key: 'useFusionV4', type: 'bool', mutability: 'forbidden', family: 'architecture' },
  ],
};

const champion = { minPredSum: 1.7, divRsiLen: 14, riskRewardRatio: 2, useFusionV4: true };

test('parseCandidateJson accepts one strict JSON object', () => {
  const parsed = parseCandidateJson('{"hypothesis":"raise threshold","patch":{"minPredSum":1.8},"expectedEffect":"fewer trades","risk":"lower count"}');
  assert.equal(parsed.patch.minPredSum, 1.8);
});

test('parseCandidateJson rejects array batch output', () => {
  assert.throws(() => parseCandidateJson('[{"patch":{"minPredSum":1.8}}]'), /exactly one JSON object/);
});

test('parseCandidateJson rejects fenced markdown', () => {
  assert.throws(() => parseCandidateJson('```json\n{"patch":{"minPredSum":1.8}}\n```'), /JSON object only/);
});

test('validateCandidate accepts valid parameter-only patch', () => {
  const result = validateCandidate({
    candidate: { hypothesis: 'raise threshold', patch: { minPredSum: 1.8, divRsiLen: 21 }, expectedEffect: 'fewer trades', risk: 'count' },
    allowlist,
    champion,
    recentFingerprints: new Set(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.changedKeys.length, 2);
});

test('validateCandidate rejects unknown key', () => {
  const result = validateCandidate({ candidate: { patch: { unknown: 1 } }, allowlist, champion, recentFingerprints: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unknown parameter/);
});

test('validateCandidate rejects out-of-range value', () => {
  const result = validateCandidate({ candidate: { patch: { minPredSum: 9 } }, allowlist, champion, recentFingerprints: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.reason, /outside range/);
});

test('validateCandidate rejects wrong type', () => {
  const result = validateCandidate({ candidate: { patch: { divRsiLen: 21.5 } }, allowlist, champion, recentFingerprints: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.reason, /expected int/);
});

test('validateCandidate rejects too many params', () => {
  const result = validateCandidate({ candidate: { patch: { minPredSum: 1.8, divRsiLen: 21, riskRewardRatio: 2.5 } }, allowlist, champion, recentFingerprints: new Set(), allowGuarded: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /too many/);
});

test('validateCandidate rejects guarded param without manual override', () => {
  const result = validateCandidate({ candidate: { patch: { riskRewardRatio: 2.5 } }, allowlist, champion, recentFingerprints: new Set() });
  assert.equal(result.ok, false);
  assert.match(result.reason, /guarded/);
});

test('validateCandidate rejects forbidden architecture toggle', () => {
  const result = validateCandidate({ candidate: { patch: { useFusionV4: false } }, allowlist, champion, recentFingerprints: new Set(), allowGuarded: true });
  assert.equal(result.ok, false);
  assert.match(result.reason, /forbidden/);
});

test('validateCandidate rejects duplicate fingerprint', () => {
  const fp = fingerprintCandidate({ patch: { minPredSum: 1.8 } });
  const result = validateCandidate({ candidate: { patch: { minPredSum: 1.8 } }, allowlist, champion, recentFingerprints: new Set([fp]) });
  assert.equal(result.ok, false);
  assert.match(result.reason, /duplicate/);
});

test('canonical fingerprint is stable across key order', () => {
  assert.equal(canonicalizeJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(fingerprintCandidate({ patch: { b: 2, a: 1 } }), fingerprintCandidate({ patch: { a: 1, b: 2 } }));
});
```

- [ ] **Step 2: Run failing schema tests**

```bash
npm test -- tests/pine-autoresearch-llm-schema.test.mjs
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement schema module**

Create `scripts/lib/pine-autoresearch-llm-schema.mjs`:

```js
import crypto from 'node:crypto';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintCandidate(candidate) {
  const canonical = canonicalizeJson(candidate.patch ?? candidate);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function parseCandidateJson(raw) {
  const text = String(raw ?? '').trim();
  if (text.startsWith('```')) {
    throw new Error('JSON object only; code fences are rejected');
  }
  const parsed = JSON.parse(text);
  if (!isPlainObject(parsed) || Array.isArray(parsed)) {
    throw new Error('candidate output must be exactly one JSON object');
  }
  if (!isPlainObject(parsed.patch)) {
    throw new Error('candidate patch must be an object');
  }
  return parsed;
}

function isStepAligned(value, step) {
  if (step === undefined || step === null) return true;
  const scaled = Math.round(value / step);
  return Math.abs(value - scaled * step) < 1e-9;
}

export function validateCandidate({ candidate, allowlist, champion = {}, recentFingerprints = new Set(), allowGuarded = false }) {
  if (!isPlainObject(candidate) || !isPlainObject(candidate.patch)) {
    return { ok: false, reason: 'missing patch object' };
  }

  const entries = new Map((allowlist.parameters ?? []).map((entry) => [entry.key, entry]));
  const changedKeys = Object.keys(candidate.patch);
  const maxChanged = allowlist.maxChangedParams ?? changedKeys.length;
  if (changedKeys.length === 0) return { ok: false, reason: 'patch has no changes' };
  if (changedKeys.length > maxChanged) return { ok: false, reason: `too many changed params: ${changedKeys.length} > ${maxChanged}` };

  for (const key of changedKeys) {
    const rule = entries.get(key);
    if (!rule) return { ok: false, reason: `unknown parameter: ${key}` };
    if (rule.mutability === 'forbidden') return { ok: false, reason: `forbidden parameter: ${key}` };
    if (rule.mutability === 'guarded' && !allowGuarded) return { ok: false, reason: `guarded parameter requires manual override: ${key}` };
    if (allowlist.freezeArchitecture && rule.family === 'architecture') return { ok: false, reason: `forbidden architecture parameter: ${key}` };

    const value = candidate.patch[key];
    if (rule.type === 'int' && !Number.isInteger(value)) return { ok: false, reason: `${key} expected int` };
    if (rule.type === 'float' && (typeof value !== 'number' || !Number.isFinite(value))) return { ok: false, reason: `${key} expected float` };
    if (rule.type === 'bool' && typeof value !== 'boolean') return { ok: false, reason: `${key} expected bool` };
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) return { ok: false, reason: `${key} outside range: ${value} < ${rule.min}` };
      if (rule.max !== undefined && value > rule.max) return { ok: false, reason: `${key} outside range: ${value} > ${rule.max}` };
      if (!isStepAligned(value, rule.step)) return { ok: false, reason: `${key} not aligned to step ${rule.step}` };
    }
  }

  const sameAsChampion = changedKeys.every((key) => Object.is(candidate.patch[key], champion[key]));
  if (sameAsChampion) return { ok: false, reason: 'candidate equals current champion' };

  const fingerprint = fingerprintCandidate(candidate);
  if (recentFingerprints.has(fingerprint)) return { ok: false, reason: `duplicate fingerprint: ${fingerprint}` };

  return { ok: true, fingerprint, changedKeys, canonicalPatch: canonicalizeJson(candidate.patch) };
}
```

- [ ] **Step 4: Run schema tests**

```bash
npm test -- tests/pine-autoresearch-llm-schema.test.mjs
git diff --check
```

Expected: PASS; diff check clean.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/lib/pine-autoresearch-llm-schema.mjs tests/pine-autoresearch-llm-schema.test.mjs
git commit -m "feat(pine): validate LLM autoresearch candidates"
```

- [ ] **Step 6: Subagent review checkpoint**

```text
Review Task 2. Confirm schema rejects unknown/out-of-range/wrong type/too many/guarded/forbidden architecture/duplicate/batch/fenced output and fingerprints are canonical. Return APPROVE or required fixes. Do not edit files.
```

---

### Task 3: Ledger, Review Queue, Memory, Reservation

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-ledger.mjs`
- Create: `scripts/lib/pine-autoresearch-llm-review-queue.mjs`
- Create: `scripts/lib/pine-autoresearch-llm-memory.mjs`
- Create: `scripts/lib/pine-autoresearch-llm-reservation.mjs`
- Create: `tests/pine-autoresearch-llm-ledger.test.mjs`
- Create: `tests/pine-autoresearch-llm-review-queue.test.mjs`
- Create: `tests/pine-autoresearch-llm-memory.test.mjs`
- Create: `tests/pine-autoresearch-llm-reservation.test.mjs`

- [ ] **Step 1: Write ledger tests**

Create `tests/pine-autoresearch-llm-ledger.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendLlmLedgerEvent, readLlmLedger, summarizeLlmLedgerFingerprints } from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-ledger-'));
  return path.join(dir, 'llm-ledger.jsonl');
}

test('ledger append is append-only JSONL', async () => {
  const file = await tempFile();
  await appendLlmLedgerEvent(file, { type: 'reserved', candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a', at: '2026-05-01T00:00:00.000Z' });
  await appendLlmLedgerEvent(file, { type: 'completed', candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a', at: '2026-05-01T00:01:00.000Z' });
  const raw = await fs.readFile(file, 'utf8');
  assert.equal(raw.trim().split('\n').length, 2);
  const ledger = await readLlmLedger(file);
  assert.equal(ledger.events.length, 2);
  assert.equal(ledger.errors.length, 0);
});

test('ledger read skips malformed lines and reports errors', async () => {
  const file = await tempFile();
  await fs.writeFile(file, '{bad\n{"type":"reserved","candidateFingerprint":"fp-a"}\n', 'utf8');
  const ledger = await readLlmLedger(file);
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.errors.length, 1);
  assert.equal(ledger.errors[0].lineNumber, 1);
});

test('summarizeLlmLedgerFingerprints collects candidate ids and fingerprints', async () => {
  const file = await tempFile();
  await appendLlmLedgerEvent(file, { type: 'reserved', candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a' });
  const summary = summarizeLlmLedgerFingerprints(await readLlmLedger(file));
  assert.equal(summary.candidateIds.has('champ:fp-a'), true);
  assert.equal(summary.fingerprints.has('fp-a'), true);
});
```

- [ ] **Step 2: Write review queue tests**

Create `tests/pine-autoresearch-llm-review-queue.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendReviewQueueEvent,
  buildReviewQueueItem,
  readReviewQueue,
  resolveReviewItem,
  unresolvedReviewItems,
  markStaleReviewItems,
} from '../scripts/lib/pine-autoresearch-llm-review-queue.mjs';

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-review-'));
  return path.join(dir, 'llm-manual-review-queue.jsonl');
}

test('buildReviewQueueItem uses parent:candidate dedupe key', () => {
  const item = buildReviewQueueItem({ parentChampionFingerprint: 'champ', candidateFingerprint: 'cand', runId: 'run-a', manifestPath: 'm/run-a.json', candidateId: 'champ:cand', metricsDelta: { score: 1 }, risk: 'count' });
  assert.equal(item.itemId, 'champ:cand');
  assert.equal(item.status, 'pending_review');
});

test('pending and accepted review items block scheduled research', async () => {
  const file = await tempFile();
  await appendReviewQueueEvent(file, { type: 'pending_review', item: buildReviewQueueItem({ parentChampionFingerprint: 'champ', candidateFingerprint: 'cand', runId: 'run-a', manifestPath: 'm/run-a.json', candidateId: 'champ:cand' }), at: '2026-05-01T00:00:00.000Z' });
  let queue = await readReviewQueue(file);
  assert.equal(unresolvedReviewItems(queue).length, 1);
  await resolveReviewItem(file, { itemId: 'champ:cand', status: 'accepted_for_manual_promotion', reason: 'good', at: '2026-05-01T00:01:00.000Z' });
  queue = await readReviewQueue(file);
  assert.equal(unresolvedReviewItems(queue).length, 1);
});

test('rejected stale superseded and archived unblock scheduled research', async () => {
  for (const status of ['rejected', 'stale', 'superseded', 'archived']) {
    const file = await tempFile();
    await appendReviewQueueEvent(file, { type: 'pending_review', item: buildReviewQueueItem({ parentChampionFingerprint: 'champ', candidateFingerprint: `cand-${status}`, runId: 'run-a', manifestPath: 'm/run-a.json', candidateId: `champ:cand-${status}` }), at: '2026-05-01T00:00:00.000Z' });
    await resolveReviewItem(file, { itemId: `champ:cand-${status}`, status, reason: status, at: '2026-05-01T00:01:00.000Z' });
    const queue = await readReviewQueue(file);
    assert.equal(unresolvedReviewItems(queue).length, 0);
  }
});

test('stale detection unblocks changed parent champion', async () => {
  const file = await tempFile();
  await appendReviewQueueEvent(file, { type: 'pending_review', item: buildReviewQueueItem({ parentChampionFingerprint: 'old-champ', candidateFingerprint: 'cand', runId: 'run-a', manifestPath: 'm/run-a.json', candidateId: 'old-champ:cand' }), at: '2026-05-01T00:00:00.000Z' });
  await markStaleReviewItems(file, { currentChampionFingerprint: 'new-champ', at: '2026-05-01T00:02:00.000Z' });
  const queue = await readReviewQueue(file);
  assert.equal(queue.items[0].status, 'stale');
  assert.equal(unresolvedReviewItems(queue).length, 0);
});
```

- [ ] **Step 3: Write memory and reservation tests**

Create `tests/pine-autoresearch-llm-memory.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneResearchMemory, updateResearchMemory } from '../scripts/lib/pine-autoresearch-llm-memory.mjs';

test('pruneResearchMemory respects count caps', () => {
  const memory = pruneResearchMemory({
    recentCandidates: Array.from({ length: 25 }, (_, i) => ({ id: `c-${i}` })),
    topWinners: Array.from({ length: 12 }, (_, i) => ({ id: `w-${i}` })),
    rejectedFingerprints: Array.from({ length: 60 }, (_, i) => ({ fingerprint: `r-${i}` })),
  }, { recentCandidates: 20, topWinners: 10, tabuFingerprints: 50, maxHotMemoryBytes: 262144 });
  assert.equal(memory.recentCandidates.length, 20);
  assert.equal(memory.topWinners.length, 10);
  assert.equal(memory.rejectedFingerprints.length, 50);
});

test('updateResearchMemory records candidate summaries and unresolved count', () => {
  const memory = updateResearchMemory({}, { candidateId: 'champ:fp', candidateFingerprint: 'fp', result: 'rejected_schema', reason: 'unknown parameter', pendingReviewCount: 2 });
  assert.equal(memory.recentCandidates[0].candidateId, 'champ:fp');
  assert.equal(memory.pendingReviewCount, 2);
});
```

Create `tests/pine-autoresearch-llm-reservation.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveCandidate, finalizeReservation, readActiveReservations } from '../scripts/lib/pine-autoresearch-llm-reservation.mjs';
import { readLlmLedger } from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';

async function tempState() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-reservation-'));
}

test('reservation writes reserved before execution and prevents duplicate concurrent execution', async () => {
  const state = await tempState();
  const paths = { ledger: path.join(state, 'llm-ledger.jsonl'), activeReservations: path.join(state, 'llm-active-reservations.json') };
  const first = await reserveCandidate(paths, { candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a', at: '2026-05-01T00:00:00.000Z' });
  assert.equal(first.reserved, true);
  const second = await reserveCandidate(paths, { candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a', at: '2026-05-01T00:00:01.000Z' });
  assert.equal(second.reserved, false);
  assert.equal(second.reason, 'duplicate_candidate');
  const ledger = await readLlmLedger(paths.ledger);
  assert.equal(ledger.events[0].type, 'reserved');
});

test('finalizeReservation appends final event and clears active reservation', async () => {
  const state = await tempState();
  const paths = { ledger: path.join(state, 'llm-ledger.jsonl'), activeReservations: path.join(state, 'llm-active-reservations.json') };
  await reserveCandidate(paths, { candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a', at: '2026-05-01T00:00:00.000Z' });
  await finalizeReservation(paths, { candidateId: 'champ:fp-a', candidateFingerprint: 'fp-a', type: 'completed', at: '2026-05-01T00:01:00.000Z' });
  assert.deepEqual(await readActiveReservations(paths.activeReservations), []);
});
```

- [ ] **Step 4: Run failing state tests**

```bash
npm test -- tests/pine-autoresearch-llm-ledger.test.mjs tests/pine-autoresearch-llm-review-queue.test.mjs tests/pine-autoresearch-llm-memory.test.mjs tests/pine-autoresearch-llm-reservation.test.mjs
```

Expected: FAIL with missing modules.

- [ ] **Step 5: Implement state modules**

Create these modules using the same patterns as `scripts/lib/pine-promotion-queue.mjs`: `fs.mkdir({recursive:true})` before appends, append newline-delimited JSON, skip malformed lines with error records, and reduce status events into current queue items.

Minimum exported signatures:

```js
// scripts/lib/pine-autoresearch-llm-ledger.mjs
export async function appendLlmLedgerEvent(ledgerPath, event) {}
export async function readLlmLedger(ledgerPath) {}
export function summarizeLlmLedgerFingerprints(ledger) {}

// scripts/lib/pine-autoresearch-llm-review-queue.mjs
export function buildReviewQueueItem(input) {}
export async function appendReviewQueueEvent(queuePath, event) {}
export async function readReviewQueue(queuePath) {}
export async function resolveReviewItem(queuePath, input) {}
export function unresolvedReviewItems(queue) {}
export async function markStaleReviewItems(queuePath, input) {}

// scripts/lib/pine-autoresearch-llm-memory.mjs
export function pruneResearchMemory(memory, caps) {}
export function updateResearchMemory(memory, event, caps = {}) {}

// scripts/lib/pine-autoresearch-llm-reservation.mjs
export async function readActiveReservations(activeReservationsPath) {}
export async function reserveCandidate(paths, candidate) {}
export async function finalizeReservation(paths, event) {}
```

Use `activeReservations` file name `llm-active-reservations.json` adjacent to ledger; this is internal hot state and must remain under LLM lane state root.

- [ ] **Step 6: Run state tests**

```bash
npm test -- tests/pine-autoresearch-llm-ledger.test.mjs tests/pine-autoresearch-llm-review-queue.test.mjs tests/pine-autoresearch-llm-memory.test.mjs tests/pine-autoresearch-llm-reservation.test.mjs
git diff --check
```

Expected: PASS; diff check clean.

- [ ] **Step 7: Commit Task 3**

```bash
git add scripts/lib/pine-autoresearch-llm-ledger.mjs scripts/lib/pine-autoresearch-llm-review-queue.mjs scripts/lib/pine-autoresearch-llm-memory.mjs scripts/lib/pine-autoresearch-llm-reservation.mjs tests/pine-autoresearch-llm-ledger.test.mjs tests/pine-autoresearch-llm-review-queue.test.mjs tests/pine-autoresearch-llm-memory.test.mjs tests/pine-autoresearch-llm-reservation.test.mjs
git commit -m "feat(pine): add LLM autoresearch state stores"
```

- [ ] **Step 8: Subagent review checkpoint**

```text
Review Task 3. Confirm ledger append-only behavior, reservation writes reserved before execution and dedupes active/ledger candidates, review lifecycle blocks only unresolved statuses, stale/resolved review resumes research, memory caps prune hot state. Return APPROVE or fixes. Do not edit files.
```

---

### Task 4: Context Builder And Provider Boundary

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-context.mjs`
- Create: `scripts/lib/pine-autoresearch-llm-provider.mjs`
- Create: `tests/pine-autoresearch-llm-context.test.mjs`
- Create: `tests/pine-autoresearch-llm-provider.test.mjs`

- [ ] **Step 1: Write context/provider tests**

Create `tests/pine-autoresearch-llm-context.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLlmResearchContext } from '../scripts/lib/pine-autoresearch-llm-context.mjs';

test('context builder includes champion allowlist memory and hard rules under byte cap', () => {
  const result = buildLlmResearchContext({
    champion: { minPredSum: 1.7, divRsiLen: 14 },
    allowlist: { version: 1, parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' }] },
    memory: { recentCandidates: [{ candidateId: 'c1', result: 'rejected_schema', reason: 'unknown' }], activeHypotheses: [{ family: 'signal', score: 1 }] },
    maxPromptBytes: 4096,
  });
  assert.equal(result.truncated, false);
  assert.match(result.prompt, /exactly one JSON object/);
  assert.match(result.prompt, /minPredSum/);
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 4096);
});

test('context builder truncates recent memory to stay under byte cap', () => {
  const result = buildLlmResearchContext({
    champion: { minPredSum: 1.7 },
    allowlist: { version: 1, parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' }] },
    memory: { recentCandidates: Array.from({ length: 200 }, (_, i) => ({ candidateId: `c-${i}`, reason: 'x'.repeat(200) })) },
    maxPromptBytes: 2000,
  });
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.prompt, 'utf8') <= 2000);
});
```

Create `tests/pine-autoresearch-llm-provider.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeCandidate } from '../scripts/lib/pine-autoresearch-llm-provider.mjs';

test('disabled provider exits with proposal_unavailable', async () => {
  const result = await proposeCandidate({ provider: { mode: 'disabled' }, scheduled: true, prompt: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'proposal_unavailable');
});

test('openclaw provider is rejected in scheduled mode', async () => {
  const result = await proposeCandidate({ provider: { mode: 'openclaw' }, scheduled: true, prompt: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'openclaw_rejected_in_scheduled_mode');
});

test('file provider returns file content', async () => {
  const result = await proposeCandidate({ provider: { mode: 'file', candidateFile: 'ignored.json' }, scheduled: false, prompt: 'x', readFile: async () => '{"patch":{"minPredSum":1.8}}' });
  assert.equal(result.ok, true);
  assert.equal(result.raw, '{"patch":{"minPredSum":1.8}}');
});

test('cli provider returns stdout and requires command', async () => {
  const missing = await proposeCandidate({ provider: { mode: 'cli' }, scheduled: true, prompt: 'x' });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'proposal_unavailable');
  const result = await proposeCandidate({ provider: { mode: 'cli', cliCommand: 'node fake.js' }, scheduled: true, prompt: 'x', execCommand: async () => ({ code: 0, stdout: '{"patch":{"minPredSum":1.8}}', stderr: '' }) });
  assert.equal(result.ok, true);
  assert.equal(result.raw, '{"patch":{"minPredSum":1.8}}');
});
```

- [ ] **Step 2: Run failing context/provider tests**

```bash
npm test -- tests/pine-autoresearch-llm-context.test.mjs tests/pine-autoresearch-llm-provider.test.mjs
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement context and provider modules**

Create `scripts/lib/pine-autoresearch-llm-context.mjs` with deterministic JSON sections and byte-budget trimming. Create `scripts/lib/pine-autoresearch-llm-provider.mjs` with provider modes: `disabled`, `file`, `cli`, `openclaw`; scheduled `openclaw` returns `openclaw_rejected_in_scheduled_mode`; no random fallback.

Use this provider execution shape:

```js
export async function proposeCandidate({ provider, scheduled, prompt, readFile, execCommand }) {
  if (!provider || provider.mode === 'disabled') return { ok: false, reason: 'proposal_unavailable' };
  if (scheduled && provider.mode === 'openclaw') return { ok: false, reason: 'openclaw_rejected_in_scheduled_mode' };
  if (provider.mode === 'openclaw') return { ok: false, reason: 'openclaw_manual_provider_not_implemented' };
  if (provider.mode === 'file') return { ok: true, raw: await readFile(provider.candidateFile, 'utf8'), source: 'file' };
  if (provider.mode === 'cli') {
    if (!provider.cliCommand) return { ok: false, reason: 'proposal_unavailable' };
    const result = await execCommand(provider.cliCommand, { input: prompt, timeoutMs: provider.timeoutMs ?? 90000 });
    if (result.code !== 0) return { ok: false, reason: 'proposal_failed', stderr: result.stderr ?? '' };
    return { ok: true, raw: String(result.stdout ?? '').trim(), source: 'cli' };
  }
  return { ok: false, reason: `unknown_provider_mode:${provider.mode}` };
}
```

- [ ] **Step 4: Run context/provider tests**

```bash
npm test -- tests/pine-autoresearch-llm-context.test.mjs tests/pine-autoresearch-llm-provider.test.mjs
git diff --check
```

Expected: PASS; diff check clean.

- [ ] **Step 5: Commit Task 4**

```bash
git add scripts/lib/pine-autoresearch-llm-context.mjs scripts/lib/pine-autoresearch-llm-provider.mjs tests/pine-autoresearch-llm-context.test.mjs tests/pine-autoresearch-llm-provider.test.mjs
git commit -m "feat(pine): add LLM autoresearch context provider"
```

- [ ] **Step 6: Subagent review checkpoint**

```text
Review Task 4. Confirm prompt budget enforcement, exact one-candidate instructions, disabled/file/cli provider behavior, openclaw rejection in scheduled mode, and no random fallback. Return APPROVE or fixes. Do not edit files.
```

---

### Task 5: Process-Tree Timeout Safety

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-process-tree.mjs`
- Create: `tests/pine-autoresearch-llm-process-tree.test.mjs`

- [ ] **Step 1: Write process-tree tests**

Create `tests/pine-autoresearch-llm-process-tree.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTimeoutTermination, verifyProcessTreeDead } from '../scripts/lib/pine-autoresearch-llm-process-tree.mjs';

test('verifyProcessTreeDead checks parent child and grandchild pids', async () => {
  const calls = [];
  const result = await verifyProcessTreeDead({
    rootPid: 10,
    descendantPids: [11, 12],
    isPidAlive: async (pid) => { calls.push(pid); return false; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [10, 11, 12]);
});

test('verifyProcessTreeDead reports surviving child process', async () => {
  const result = await verifyProcessTreeDead({
    rootPid: 10,
    descendantPids: [11, 12],
    isPidAlive: async (pid) => pid === 12,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.alivePids, [12]);
});

test('classifyTimeoutTermination distinguishes clean forced and failed kill', () => {
  assert.equal(classifyTimeoutTermination({ timedOut: true, forceKillUsed: false, verifyDead: { ok: true } }), 'timeout_clean_exit');
  assert.equal(classifyTimeoutTermination({ timedOut: true, forceKillUsed: true, verifyDead: { ok: true } }), 'timeout_forced_tree_kill');
  assert.equal(classifyTimeoutTermination({ timedOut: true, forceKillUsed: true, verifyDead: { ok: false } }), 'timeout_kill_failed');
});
```

- [ ] **Step 2: Run failing process-tree tests**

```bash
npm test -- tests/pine-autoresearch-llm-process-tree.test.mjs
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement process-tree helper**

Create `scripts/lib/pine-autoresearch-llm-process-tree.mjs`:

```js
export async function verifyProcessTreeDead({ rootPid, descendantPids = [], isPidAlive }) {
  const pids = [rootPid, ...descendantPids].filter((pid) => Number.isInteger(pid) && pid > 0);
  const alivePids = [];
  for (const pid of pids) {
    if (await isPidAlive(pid)) alivePids.push(pid);
  }
  return { ok: alivePids.length === 0, checkedPids: pids, alivePids };
}

export function classifyTimeoutTermination({ timedOut, forceKillUsed, verifyDead }) {
  if (!timedOut) return 'completed';
  if (!verifyDead?.ok) return 'timeout_kill_failed';
  return forceKillUsed ? 'timeout_forced_tree_kill' : 'timeout_clean_exit';
}
```

Implementation note for runner task: Windows process-tree termination must use either PowerShell wrapper `Stop-ProcessTree` with `taskkill /T /F /PID <pid>` or a Node wrapper that delegates to that behavior. The runner must call `verifyProcessTreeDead()` before releasing scheduler lock.

- [ ] **Step 4: Run process-tree tests**

```bash
npm test -- tests/pine-autoresearch-llm-process-tree.test.mjs
git diff --check
```

Expected: PASS; diff check clean.

- [ ] **Step 5: Commit Task 5**

```bash
git add scripts/lib/pine-autoresearch-llm-process-tree.mjs tests/pine-autoresearch-llm-process-tree.test.mjs
git commit -m "feat(pine): add LLM timeout process-tree checks"
```

- [ ] **Step 6: Subagent review checkpoint**

```text
Review Task 5. Confirm timeout terminology and tests cover parent/child/grandchild verification and timeout_kill_failed. Return APPROVE or fixes. Do not edit files.
```

---

### Task 6: Runner And CLI Commands

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Create: `scripts/pine-autoresearch-llm.mjs`
- Create: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Write runner tests**

Create `tests/pine-autoresearch-llm-runner.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLlmAutoresearch } from '../scripts/lib/pine-autoresearch-llm-runner.mjs';
import { readLlmLedger } from '../scripts/lib/pine-autoresearch-llm-ledger.mjs';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-runner-'));
  const configPath = path.join(dir, 'llm.json');
  const allowlistPath = path.join(dir, 'allowlist.json');
  await fs.writeFile(allowlistPath, JSON.stringify({ version: 1, freezeArchitecture: true, maxChangedParams: 2, parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' }, { key: 'useFusionV4', type: 'bool', mutability: 'forbidden', family: 'architecture' }] }), 'utf8');
  await fs.writeFile(configPath, JSON.stringify({ matrixId: 'matrix-a', allowlistPath, provider: { mode: 'disabled' }, memory: { maxPromptBytes: 4096, maxHotMemoryBytes: 262144, recentCandidates: 20, topWinners: 10, tabuFingerprints: 50 }, candidate: { maxChangedParams: 2 } }), 'utf8');
  return { dir, configPath, allowlistPath };
}

test('scheduled disabled provider exits soft-success and writes provider status', async () => {
  const { dir, configPath } = await fixture();
  const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'proposal_unavailable');
  const status = JSON.parse(await fs.readFile(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'), 'utf8'));
  assert.equal(status.reason, 'proposal_unavailable');
});

test('scheduled openclaw provider is hard rejected', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  await fs.writeFile(configPath, JSON.stringify({ matrixId: 'matrix-a', allowlistPath, provider: { mode: 'openclaw' }, memory: { maxPromptBytes: 4096 } }), 'utf8');
  const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'openclaw_rejected_in_scheduled_mode');
});

test('file provider validates reserves and finalizes one candidate', async () => {
  const { dir, configPath, allowlistPath } = await fixture();
  const candidateFile = path.join(dir, 'candidate.json');
  await fs.writeFile(candidateFile, JSON.stringify({ hypothesis: 'raise threshold', patch: { minPredSum: 1.8 }, expectedEffect: 'fewer trades', risk: 'count' }), 'utf8');
  await fs.writeFile(configPath, JSON.stringify({ matrixId: 'matrix-a', allowlistPath, provider: { mode: 'file', candidateFile }, champion: { minPredSum: 1.7, useFusionV4: true }, memory: { maxPromptBytes: 4096, maxHotMemoryBytes: 262144, recentCandidates: 20, topWinners: 10, tabuFingerprints: 50 }, candidate: { maxChangedParams: 2 } }), 'utf8');
  const result = await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: false, executeCandidate: async () => ({ ok: true, runId: 'run-a', manifestPath: path.join(dir, 'manifest.json'), metricsDelta: { score: 1 } }) });
  assert.equal(result.ok, true);
  const ledger = await readLlmLedger(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-ledger.jsonl'));
  assert.deepEqual(ledger.events.map((event) => event.type), ['reserved', 'completed']);
});

test('runner never writes existing promotion queue', async () => {
  const { dir, configPath } = await fixture();
  await runLlmAutoresearch({ configPath, repoRoot: dir, command: 'run', scheduled: true });
  await assert.rejects(() => fs.stat(path.join(dir, 'pine/autoresearch/matrix-a/state/promotion-queue.jsonl')), /ENOENT/);
});
```

- [ ] **Step 2: Run failing runner tests**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: FAIL with missing runner module.

- [ ] **Step 3: Implement runner**

Create `scripts/lib/pine-autoresearch-llm-runner.mjs` that:
- loads config and allowlist JSON
- builds LLM lane paths
- creates `state`, `manifests`, `runs`, `archive`
- rejects scheduled `openclaw`
- checks unresolved review queue before proposing
- builds context
- calls provider
- parses and validates exactly one candidate
- reserves before execution
- executes through injectable `executeCandidate`
- writes immutable manifest for executed candidate
- finalizes ledger
- updates compact memory
- writes provider status
- never writes existing autoresearch promotion queue

Minimal runner export:

```js
export async function runLlmAutoresearch({ configPath, repoRoot = process.cwd(), command = 'run', scheduled = false, executeCandidate } = {}) {}
```

Create `scripts/pine-autoresearch-llm.mjs` CLI that parses these commands:

```bash
run propose digest validate enqueue review-status review-resolve
```

Use nonzero exit only for hard failures. Soft-success reasons exit `0`.

- [ ] **Step 4: Run runner tests and CLI smoke**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
node scripts/pine-autoresearch-llm.mjs run --config config/pine-autoresearch-llm.default.json --scheduled
git diff --check
```

Expected: tests PASS; CLI exits `0` with `proposal_unavailable` because provider is disabled; diff check clean.

- [ ] **Step 5: Commit Task 6**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs scripts/pine-autoresearch-llm.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): add LLM autoresearch runner"
```

- [ ] **Step 6: Subagent review checkpoint**

```text
Review Task 6. Confirm scheduled openclaw is rejected, disabled provider soft-succeeds, one candidate is validated/reserved/finalized, manual queue gate blocks unresolved items, no existing promotion queue write occurs, and CLI exits match hard/soft semantics. Return APPROVE or fixes. Do not edit files.
```

---

### Task 7: Windows Scheduler Wrappers And No-Regression Tests

**Files:**
- Create: `scripts/ops/pine-autoresearch-llm-run.ps1`
- Create: `scripts/ops/install-pine-autoresearch-llm-tasks.ps1`
- Create: `scripts/ops/remove-pine-autoresearch-llm-tasks.ps1`
- Create: `tests/pine-autoresearch-llm-scheduler.test.mjs`
- Create: `tests/pine-autoresearch-llm-no-regression.test.mjs`

- [ ] **Step 1: Write scheduler/no-regression tests**

Create `tests/pine-autoresearch-llm-scheduler.test.mjs`:

```js
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const runScript = 'scripts/ops/pine-autoresearch-llm-run.ps1';
const installScript = 'scripts/ops/install-pine-autoresearch-llm-tasks.ps1';
const removeScript = 'scripts/ops/remove-pine-autoresearch-llm-tasks.ps1';

test('LLM wrapper uses distinct task names lock path and mutex', async () => {
  const text = await fs.readFile(runScript, 'utf8');
  assert.match(text, /BacktestKit-Pine-LLM/);
  assert.match(text, /llm-scheduler\.lock/);
  assert.match(text, /Global\\BacktestKit-Pine-LLM-Autoresearch/);
  assert.doesNotMatch(text, /tmp\\pine-autoresearch-locks\\scheduler\.lock/);
});

test('LLM installer creates only LLM task names', async () => {
  const text = await fs.readFile(installScript, 'utf8');
  assert.match(text, /BacktestKit-Pine-LLM-Run/);
  assert.match(text, /BacktestKit-Pine-LLM-Digest/);
  assert.doesNotMatch(text, /BacktestKit-Pine-Autoresearch-Micro/);
});

test('LLM remover removes only LLM task names', async () => {
  const text = await fs.readFile(removeScript, 'utf8');
  assert.match(text, /BacktestKit-Pine-LLM-Run/);
  assert.match(text, /BacktestKit-Pine-LLM-Digest/);
  assert.doesNotMatch(text, /BacktestKit-Pine-Autoresearch-Full/);
});
```

Create `tests/pine-autoresearch-llm-no-regression.test.mjs`:

```js
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const expectedScripts = {
  'pine:autoresearch': 'node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json',
  'pine:autoresearch:micro': 'node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json --profile micro',
  'pine:autoresearch:digest': 'node ./scripts/pine-autoresearch.mjs digest --config ./config/pine-autoresearch.default.json',
  'pine:autoresearch:autopromote': 'node ./scripts/pine-autoresearch.mjs autopromote --config ./config/pine-autoresearch.default.json',
};

test('existing pine autoresearch package scripts remain unchanged', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  for (const [key, value] of Object.entries(expectedScripts)) {
    assert.equal(pkg.scripts[key], value, key);
  }
});

test('existing task installer/remover do not mention LLM task names', async () => {
  const install = await fs.readFile('scripts/ops/install-pine-autoresearch-tasks.ps1', 'utf8');
  const remove = await fs.readFile('scripts/ops/remove-pine-autoresearch-tasks.ps1', 'utf8');
  assert.doesNotMatch(install, /BacktestKit-Pine-LLM/);
  assert.doesNotMatch(remove, /BacktestKit-Pine-LLM/);
});
```

- [ ] **Step 2: Run failing scheduler tests**

```bash
npm test -- tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs
```

Expected: FAIL because new PowerShell scripts do not exist.

- [ ] **Step 3: Implement PowerShell wrapper and installers**

Create `scripts/ops/pine-autoresearch-llm-run.ps1` based on existing wrapper but with:
- lock path under `pine\autoresearch-llm\llm-<matrix-id>\state\llm-scheduler.lock`
- mutex `Global\BacktestKit-Pine-LLM-Autoresearch-<matrix-id>`
- command `node ./scripts/pine-autoresearch-llm.mjs run --config ./config/pine-autoresearch-llm.default.json --scheduled`
- dry-run output showing lock and mutex
- refusal if config provider mode is `openclaw`

Create installer with only:
- `BacktestKit-Pine-LLM-Run`
- `BacktestKit-Pine-LLM-Digest`

Create remover with only the same names.

- [ ] **Step 4: Run scheduler tests and PowerShell parser checks**

```bash
npm test -- tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs
pwsh -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw ./scripts/ops/pine-autoresearch-llm-run.ps1)) | Out-Null; [scriptblock]::Create((Get-Content -Raw ./scripts/ops/install-pine-autoresearch-llm-tasks.ps1)) | Out-Null; [scriptblock]::Create((Get-Content -Raw ./scripts/ops/remove-pine-autoresearch-llm-tasks.ps1)) | Out-Null"
pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-llm-run.ps1 -DryRun
git diff --check
```

Expected: tests PASS; PowerShell parse succeeds; dry-run prints LLM lock/mutex; diff check clean.

- [ ] **Step 5: Commit Task 7**

```bash
git add scripts/ops/pine-autoresearch-llm-run.ps1 scripts/ops/install-pine-autoresearch-llm-tasks.ps1 scripts/ops/remove-pine-autoresearch-llm-tasks.ps1 tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs
git commit -m "feat(pine): add LLM autoresearch scheduler wrappers"
```

- [ ] **Step 6: Subagent review checkpoint**

```text
Review Task 7. Confirm LLM tasks use only BacktestKit-Pine-LLM-* names, wrapper uses separate lock/mutex, provider=openclaw is refused for scheduled use, existing wrappers/installers/removers are unchanged, and parser/dry-run checks pass. Return APPROVE or fixes. Do not edit files.
```

---

### Task 8: Digest, End-To-End Dry Run, Final Safety Review

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Modify: `scripts/pine-autoresearch-llm.mjs`
- Create: `tests/pine-autoresearch-llm-e2e.test.mjs`
- Create: `docs/pine-llm-autoresearch.md`

- [ ] **Step 1: Write e2e test**

Create `tests/pine-autoresearch-llm-e2e.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runLlmAutoresearch } from '../scripts/lib/pine-autoresearch-llm-runner.mjs';
import { readReviewQueue } from '../scripts/lib/pine-autoresearch-llm-review-queue.mjs';

test('end-to-end file candidate creates manifest and review queue without promotion queue', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-e2e-'));
  const allowlistPath = path.join(dir, 'allowlist.json');
  const candidateFile = path.join(dir, 'candidate.json');
  const configPath = path.join(dir, 'llm.json');
  await fs.writeFile(allowlistPath, JSON.stringify({ version: 1, freezeArchitecture: true, maxChangedParams: 1, parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable', family: 'signal' }] }), 'utf8');
  await fs.writeFile(candidateFile, JSON.stringify({ hypothesis: 'raise threshold', patch: { minPredSum: 1.8 }, expectedEffect: 'fewer trades', risk: 'count' }), 'utf8');
  await fs.writeFile(configPath, JSON.stringify({ matrixId: 'matrix-a', allowlistPath, provider: { mode: 'file', candidateFile }, champion: { minPredSum: 1.7 }, memory: { maxPromptBytes: 4096, maxHotMemoryBytes: 262144, recentCandidates: 20, topWinners: 10, tabuFingerprints: 50 }, candidate: { maxChangedParams: 1 } }), 'utf8');

  const result = await runLlmAutoresearch({
    configPath,
    repoRoot: dir,
    command: 'run',
    scheduled: false,
    executeCandidate: async () => ({ ok: true, runId: 'run-a', promotable: true, metricsDelta: { score: 1 } }),
  });

  assert.equal(result.ok, true);
  assert.match(result.manifestPath, /manifests/);
  await fs.stat(result.manifestPath);
  const queue = await readReviewQueue(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl'));
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].status, 'pending_review');
  await assert.rejects(() => fs.stat(path.join(dir, 'pine/autoresearch/matrix-a/state/promotion-queue.jsonl')), /ENOENT/);
});
```

- [ ] **Step 2: Run failing e2e test**

```bash
npm test -- tests/pine-autoresearch-llm-e2e.test.mjs
```

Expected: FAIL if digest/manifest/review queue integration is incomplete.

- [ ] **Step 3: Complete digest and manifest integration**

Update runner so completed candidates write manifest JSON containing:

```json
{
  "lane": "llm",
  "runId": "run-a",
  "matrixId": "matrix-a",
  "candidateId": "championFingerprint:candidateFingerprint",
  "candidateFingerprint": "...",
  "parentChampionFingerprint": "...",
  "candidate": { "patch": {} },
  "provider": { "mode": "file" },
  "metricsDelta": {},
  "createdAt": "..."
}
```

If `executeCandidate()` returns `promotable: true`, append `pending_review` to LLM manual-review queue only.

Implement `digest` command to print compact JSON:

```json
{
  "matrixId": "matrix-a",
  "pendingReviewCount": 0,
  "recentCandidateCount": 0,
  "lastRunId": null,
  "providerStatus": null
}
```

- [ ] **Step 4: Add operator docs**

Create `docs/pine-llm-autoresearch.md`:

```markdown
# Pine LLM Autoresearch Lane

The LLM lane is isolated from the existing Pine autoresearch scheduler. Existing `pine:autoresearch*` commands and existing Windows tasks remain standalone.

## Defaults

- Scheduled provider defaults to `disabled`.
- Scheduled mode allows `cli` provider only.
- `openclaw` provider is manual/on-demand only and is rejected in scheduled mode.
- Exactly one candidate object is accepted per run.
- Auto-promotion is disabled.

## Safe smoke commands

```bash
npm run pine:autoresearch:llm -- --scheduled
npm run pine:autoresearch:llm:digest
pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-llm-run.ps1 -DryRun
```

## Review queue

Use `review-status` to inspect unresolved candidates. Use `review-resolve` to append immutable resolution events. Unresolved `pending_review` and `accepted_for_manual_promotion` items block scheduled research.

## Enablement

Do not enable the scheduled LLM task until tests pass, provider is configured to `cli`, and subagent safety review approves the implementation.
```

- [ ] **Step 5: Run full verification**

```bash
npm test
node scripts/pine-autoresearch-llm.mjs run --config config/pine-autoresearch-llm.default.json --scheduled
node scripts/pine-autoresearch-llm.mjs digest --config config/pine-autoresearch-llm.default.json
pwsh -NoProfile -File ./scripts/ops/pine-autoresearch-llm-run.ps1 -DryRun
git diff --check
```

Expected: all tests PASS; scheduled disabled run exits soft-success; digest prints compact JSON; dry-run prints LLM lock/mutex; diff check clean.

- [ ] **Step 6: Commit Task 8**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs scripts/pine-autoresearch-llm.mjs tests/pine-autoresearch-llm-e2e.test.mjs docs/pine-llm-autoresearch.md
git commit -m "feat(pine): complete LLM autoresearch dry run"
```

- [ ] **Step 7: Final subagent safety review**

Dispatch review prompt:

```text
Final safety review for Pine LLM autoresearch implementation. Confirm all acceptance criteria in docs/superpowers/specs/2026-05-01-pine-openclaw-llm-autoresearch-design.md are met, tests pass, scheduled path is independent from OpenClaw, openclaw provider is rejected in scheduled mode, one candidate per run is enforced, no existing scheduler behavior changed, no existing promotion queue write occurs, timeout verifies process tree before lock release, and manual review lifecycle unblocks correctly. Return APPROVE or exact required fixes. Do not edit files.
```

- [ ] **Step 8: Record enablement decision**

If final review approves and user wants scheduler installed, run:

```bash
pwsh -NoProfile -File ./scripts/ops/install-pine-autoresearch-llm-tasks.ps1 -DryRun
```

Expected: dry-run lists only `BacktestKit-Pine-LLM-Run` and `BacktestKit-Pine-LLM-Digest`. Do not install real tasks until Diko explicitly asks.

---

## Self-Review Checklist

- Spec coverage: Tasks cover config skeleton, allowlist schema, fingerprinting, ledger, reservation, review queue, compact memory, context builder, provider boundary, runner, scheduler wrappers, no-regression tests, digest/docs, e2e dry run, final subagent review.
- Existing scheduler safety: no task changes existing wrapper behavior; no-regression tests pin existing package script values and existing installer/remover task names.
- OpenClaw safety: scheduled `openclaw` provider is rejected in provider and runner tests.
- Review lifecycle: queue statuses and unblock behavior are tested.
- Timeout safety: process-tree parent/child/grandchild verification is tested.
- Completion gate: final task requires `npm test`, CLI smoke, PowerShell dry-run, `git diff --check`, and subagent review.
