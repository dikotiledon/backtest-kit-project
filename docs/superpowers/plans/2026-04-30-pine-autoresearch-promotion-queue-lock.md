# Pine Autoresearch Promotion Queue + Scheduler Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Pine autoresearch from missing promotion recommendations or corrupting shared state when micro/full/autopromote scheduler runs overlap.

**Architecture:** Add a single repository-level autoresearch lock around all state-mutating commands (`cycle`, `promote`, `autopromote`) so micro/full/promote cannot run concurrently. Add a durable append-only promotion queue so every `matrixDecision.recommendation: promote` cycle records an exact manifest pointer by `runId`; autopromote consumes queue entries by manifest path instead of mutable `latest.json`. Keep matrix gates strict, keep latest manifest as a display pointer only, and skip new cycles while pending promotions exist unless explicitly forced.

**Tech Stack:** Node.js ESM, `node:test`, JSONL queue artifacts, atomic file creation/rename, existing Pine autoresearch scripts under `scripts/`, Windows Task Scheduler wrappers under `scripts/ops/`.

---

## Non-Negotiable Design Rules

1. Do **not** promote from mutable `latest.json` when a queued promote manifest exists.
2. Do **not** run `micro` and `full` concurrently.
3. Do **not** run `cycle` while `promote` or `autopromote` is mutating `pine/test.pine`, champion state, history, or digest.
4. Do **not** delete or overwrite promotion evidence. Queue is append-only JSONL.
5. Do **not** weaken `matrixDecision` gates. Queue captures candidates; it does not decide promotion by itself.
6. Do **not** silently ignore stale queue entries. Mark them `stale`, `blocked`, `promoted`, or `failed` with reason.
7. Do **not** add broad architecture changes outside the listed files.

## Current Failure Mode

Observed code path:

- `runScout()` writes exact manifest to `manifests/<runId>.json`.
- `runScout()` also overwrites `latest.json`.
- `runPromote()` and `runAutopromote()` read `latest.json`.
- Windows scheduler currently has `BacktestKit-Pine-Micro` and `BacktestKit-Pine-Full` enabled on minute/hour cadence.
- No lock exists in code path.

Race:

1. Cycle A finishes with `matrixDecision.recommendation === 'promote'`.
2. Cycle A writes `manifests/A.json` and `latest.json = A`.
3. Before autopromote runs, Cycle B finishes with `hold`.
4. Cycle B overwrites `latest.json = B`.
5. Autopromote reads B and misses A.

This plan fixes the root cause: mutable latest pointer is not a reliable promotion source, and overlapping writers are unsafe.

## File Map

- Create: `scripts/lib/pine-autoresearch-lock.mjs`
  - Atomic lock acquisition/release helpers.
  - Stale lock detection.
  - Testable pure functions for lock ownership.

- Create: `scripts/lib/pine-promotion-queue.mjs`
  - Queue path resolution.
  - Append-only JSONL event writer.
  - Queue reducer that returns pending/promoted/stale/blocked/failed items.
  - Exact manifest loader/validator helpers.

- Modify: `scripts/pine-autoresearch.mjs`
  - Import lock and queue helpers.
  - Add path helpers for lock and queue artifacts.
  - Wrap `cycle`, `promote`, `autopromote` commands with global autoresearch lock.
  - Enqueue promotion candidates when a cycle emits `recommendation: promote`.
  - Skip cycles when pending promotion exists unless `--force-cycle` is passed.
  - Change autopromote to consume oldest pending queue item by manifest path.
  - Keep manual `promote` behavior compatible, with optional `--run-id` / `--manifest` support.

- Modify: `scripts/lib/pine-autoresearch.mjs`
  - Add pure decision helper for queued promotion validation, or extend `decideAutoPromotionAction()` to accept queue context without changing existing behavior.

- Modify: `tests/pine-autoresearch.test.mjs`
  - Unit tests for lock helper integration, queue enqueue/reduce behavior, stale queue behavior, and autopromote selecting queued manifest instead of overwritten latest.

- Create: `tests/pine-autoresearch-lock.test.mjs`
  - Focused tests for atomic lock acquire/release/stale behavior.

- Create: `tests/pine-promotion-queue.test.mjs`
  - Focused tests for append-only queue events and reducer.

- Modify: `scripts/ops/pine-autoresearch-run.ps1`
  - Optional outer PowerShell lock for scheduler-level short-circuit before Node starts.
  - This is defense-in-depth only; Node lock remains canonical.

- Modify: `scripts/ops/install-pine-autoresearch-tasks.ps1`
  - Ensure Task Scheduler does not launch a new instance while prior instance is running if supported by `schtasks` settings.
  - Keep script command paths unchanged.

---

## Task 1: Add Atomic Autoresearch Lock Helper

**Files:**
- Create: `scripts/lib/pine-autoresearch-lock.mjs`
- Test: `tests/pine-autoresearch-lock.test.mjs`

- [ ] **Step 1: Write failing lock tests**

Create `tests/pine-autoresearch-lock.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireAutoresearchLock,
  isLockStale,
  releaseAutoresearchLock,
  readAutoresearchLock,
} from '../scripts/lib/pine-autoresearch-lock.mjs';

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-lock-'));
}

test('acquireAutoresearchLock creates an exclusive lock with owner metadata', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');

  const lock = await acquireAutoresearchLock({
    lockPath,
    command: 'cycle',
    profile: 'micro',
    staleMs: 60_000,
    now: '2026-04-30T00:00:00.000Z',
    pid: 12345,
  });

  assert.equal(lock.acquired, true);
  assert.equal(lock.owner.command, 'cycle');
  assert.equal(lock.owner.profile, 'micro');
  assert.equal(lock.owner.pid, 12345);

  const saved = await readAutoresearchLock(lockPath);
  assert.equal(saved.command, 'cycle');
  assert.equal(saved.profile, 'micro');
});

test('acquireAutoresearchLock refuses a fresh existing lock', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');

  await acquireAutoresearchLock({
    lockPath,
    command: 'cycle',
    profile: 'full',
    staleMs: 60_000,
    now: '2026-04-30T00:00:00.000Z',
    pid: 100,
  });

  const second = await acquireAutoresearchLock({
    lockPath,
    command: 'cycle',
    profile: 'micro',
    staleMs: 60_000,
    now: '2026-04-30T00:00:10.000Z',
    pid: 101,
    isPidAlive: () => true,
  });

  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'locked');
  assert.equal(second.currentOwner.command, 'cycle');
  assert.equal(second.currentOwner.profile, 'full');
});

test('acquireAutoresearchLock reclaims stale lock when owner pid is dead', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');

  await fs.writeFile(lockPath, JSON.stringify({
    pid: 999999,
    command: 'cycle',
    profile: 'full',
    acquiredAt: '2026-04-30T00:00:00.000Z',
    staleAfterMs: 60_000,
  }, null, 2));

  const lock = await acquireAutoresearchLock({
    lockPath,
    command: 'autopromote',
    staleMs: 60_000,
    now: '2026-04-30T00:02:00.000Z',
    pid: 200,
    isPidAlive: () => false,
  });

  assert.equal(lock.acquired, true);
  assert.equal(lock.reclaimed, true);
  assert.equal(lock.owner.command, 'autopromote');
});

test('releaseAutoresearchLock only removes lock owned by token', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');

  const lock = await acquireAutoresearchLock({
    lockPath,
    command: 'cycle',
    profile: 'micro',
    staleMs: 60_000,
    now: '2026-04-30T00:00:00.000Z',
    pid: 300,
  });

  const wrong = await releaseAutoresearchLock({ lockPath, token: 'wrong-token' });
  assert.equal(wrong.released, false);
  assert.equal(wrong.reason, 'token_mismatch');

  const right = await releaseAutoresearchLock({ lockPath, token: lock.owner.token });
  assert.equal(right.released, true);

  await assert.rejects(() => fs.access(lockPath));
});

test('isLockStale uses time age and pid liveness', () => {
  const owner = {
    pid: 400,
    acquiredAt: '2026-04-30T00:00:00.000Z',
    staleAfterMs: 60_000,
  };

  assert.equal(isLockStale({ owner, now: '2026-04-30T00:00:30.000Z', isPidAlive: () => true }), false);
  assert.equal(isLockStale({ owner, now: '2026-04-30T00:02:00.000Z', isPidAlive: () => true }), false);
  assert.equal(isLockStale({ owner, now: '2026-04-30T00:02:00.000Z', isPidAlive: () => false }), true);
});
```

- [ ] **Step 2: Run failing lock tests**

Run:

```powershell
node --test tests/pine-autoresearch-lock.test.mjs
```

Expected: fails because `scripts/lib/pine-autoresearch-lock.mjs` does not exist.

- [ ] **Step 3: Implement lock helper**

Create `scripts/lib/pine-autoresearch-lock.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function defaultIsPidAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function readAutoresearchLock(lockPath) {
  const raw = await fs.readFile(lockPath, 'utf8');
  return JSON.parse(raw);
}

export function isLockStale({ owner, now = new Date().toISOString(), isPidAlive = defaultIsPidAlive } = {}) {
  if (!owner || typeof owner !== 'object') return true;
  const acquiredMs = Date.parse(owner.acquiredAt || '');
  if (!Number.isFinite(acquiredMs)) return true;
  const staleAfterMs = Number.isFinite(Number(owner.staleAfterMs)) ? Number(owner.staleAfterMs) : 6 * 60 * 60 * 1000;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  const oldEnough = (nowMs - acquiredMs) >= staleAfterMs;
  if (!oldEnough) return false;
  return !isPidAlive(owner.pid);
}

async function writeLockExclusive(lockPath, owner) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const handle = await fs.open(lockPath, 'wx');
  try {
    await handle.writeFile(JSON.stringify(owner, null, 2));
  } finally {
    await handle.close();
  }
}

export async function acquireAutoresearchLock({
  lockPath,
  command,
  profile = null,
  staleMs = 6 * 60 * 60 * 1000,
  now = new Date().toISOString(),
  pid = process.pid,
  isPidAlive = defaultIsPidAlive,
} = {}) {
  const owner = {
    token: crypto.randomUUID(),
    pid,
    command,
    profile,
    acquiredAt: now,
    staleAfterMs: staleMs,
    cwd: process.cwd(),
  };

  try {
    await writeLockExclusive(lockPath, owner);
    return { acquired: true, owner, reclaimed: false };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  let currentOwner = null;
  try {
    currentOwner = await readAutoresearchLock(lockPath);
  } catch {
    currentOwner = null;
  }

  if (!isLockStale({ owner: currentOwner, now, isPidAlive })) {
    return { acquired: false, reason: 'locked', currentOwner };
  }

  try {
    await fs.rm(lockPath, { force: true });
    await writeLockExclusive(lockPath, owner);
    return { acquired: true, owner, reclaimed: true, previousOwner: currentOwner };
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const refreshedOwner = await readAutoresearchLock(lockPath).catch(() => null);
      return { acquired: false, reason: 'locked', currentOwner: refreshedOwner };
    }
    throw error;
  }
}

export async function releaseAutoresearchLock({ lockPath, token } = {}) {
  let currentOwner = null;
  try {
    currentOwner = await readAutoresearchLock(lockPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { released: false, reason: 'missing' };
    throw error;
  }

  if (currentOwner?.token !== token) {
    return { released: false, reason: 'token_mismatch', currentOwner };
  }

  await fs.rm(lockPath, { force: true });
  return { released: true };
}
```

- [ ] **Step 4: Run lock tests**

Run:

```powershell
node --test tests/pine-autoresearch-lock.test.mjs
```

Expected: all lock tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/pine-autoresearch-lock.mjs tests/pine-autoresearch-lock.test.mjs
git commit -m "feat(pine): add autoresearch lock helper"
```

---

## Task 2: Add Durable Promotion Queue Helper

**Files:**
- Create: `scripts/lib/pine-promotion-queue.mjs`
- Test: `tests/pine-promotion-queue.test.mjs`

- [ ] **Step 1: Write failing queue tests**

Create `tests/pine-promotion-queue.test.mjs`:

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPromotionQueueEvent,
  buildPromotionQueueItem,
  promotionQueuePath,
  readPromotionQueue,
  selectNextPendingPromotion,
} from '../scripts/lib/pine-promotion-queue.mjs';

async function makeTempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pine-promotion-queue-'));
}

test('promotionQueuePath stores queue under researchRoot state folder', () => {
  const queuePath = promotionQueuePath({ researchRoot: 'pine/autoresearch/matrix-a' });
  assert.equal(queuePath, path.join('pine/autoresearch/matrix-a', 'state', 'promotion-queue.jsonl'));
});

test('buildPromotionQueueItem captures exact manifest identity and champion fingerprint', () => {
  const item = buildPromotionQueueItem({
    manifest: {
      runId: 'run-a',
      generatedAt: '2026-04-30T00:00:00.000Z',
      manifestPath: 'pine/autoresearch/m/manifests/run-a.json',
      candidateFingerprint: 'candidate-fp',
      championFingerprint: 'champion-fp',
      challenger: { configId: 'candidate-a', config: { a: 2 } },
      champion: { configId: 'champion-a', config: { a: 1 } },
      matrixDecision: { recommendation: 'promote' },
    },
    createdAt: '2026-04-30T00:01:00.000Z',
  });

  assert.equal(item.itemId, 'run-a:candidate-fp');
  assert.equal(item.runId, 'run-a');
  assert.equal(item.manifestPath, 'pine/autoresearch/m/manifests/run-a.json');
  assert.equal(item.candidateFingerprint, 'candidate-fp');
  assert.equal(item.championFingerprintAtDecision, 'champion-fp');
  assert.equal(item.candidateConfigId, 'candidate-a');
});

test('readPromotionQueue reduces pending and status events', async () => {
  const root = await makeTempRoot();
  const queuePath = path.join(root, 'queue.jsonl');

  await appendPromotionQueueEvent(queuePath, {
    type: 'pending',
    item: {
      itemId: 'run-a:fp-a',
      runId: 'run-a',
      manifestPath: 'manifests/run-a.json',
      candidateFingerprint: 'fp-a',
      championFingerprintAtDecision: 'champ-a',
      candidateConfigId: 'candidate-a',
      createdAt: '2026-04-30T00:00:00.000Z',
    },
  });
  await appendPromotionQueueEvent(queuePath, {
    type: 'status',
    itemId: 'run-a:fp-a',
    status: 'blocked',
    reason: 'cooldown',
    at: '2026-04-30T00:02:00.000Z',
  });

  const queue = await readPromotionQueue(queuePath);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].status, 'blocked');
  assert.equal(queue.items[0].reason, 'cooldown');
  assert.equal(queue.pending.length, 0);
});

test('append pending event is idempotent by itemId during queue reduction', async () => {
  const root = await makeTempRoot();
  const queuePath = path.join(root, 'queue.jsonl');
  const item = {
    itemId: 'run-a:fp-a',
    runId: 'run-a',
    manifestPath: 'manifests/run-a.json',
    candidateFingerprint: 'fp-a',
    championFingerprintAtDecision: 'champ-a',
    candidateConfigId: 'candidate-a',
    createdAt: '2026-04-30T00:00:00.000Z',
  };

  await appendPromotionQueueEvent(queuePath, { type: 'pending', item });
  await appendPromotionQueueEvent(queuePath, { type: 'pending', item });

  const queue = await readPromotionQueue(queuePath);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.pending.length, 1);
});

test('selectNextPendingPromotion returns oldest pending item', async () => {
  const root = await makeTempRoot();
  const queuePath = path.join(root, 'queue.jsonl');

  await appendPromotionQueueEvent(queuePath, {
    type: 'pending',
    item: {
      itemId: 'run-b:fp-b',
      runId: 'run-b',
      manifestPath: 'manifests/run-b.json',
      candidateFingerprint: 'fp-b',
      championFingerprintAtDecision: 'champ-b',
      candidateConfigId: 'candidate-b',
      createdAt: '2026-04-30T00:02:00.000Z',
    },
  });
  await appendPromotionQueueEvent(queuePath, {
    type: 'pending',
    item: {
      itemId: 'run-a:fp-a',
      runId: 'run-a',
      manifestPath: 'manifests/run-a.json',
      candidateFingerprint: 'fp-a',
      championFingerprintAtDecision: 'champ-a',
      candidateConfigId: 'candidate-a',
      createdAt: '2026-04-30T00:01:00.000Z',
    },
  });

  const queue = await readPromotionQueue(queuePath);
  const next = selectNextPendingPromotion(queue);
  assert.equal(next.itemId, 'run-a:fp-a');
});
```

- [ ] **Step 2: Run failing queue tests**

Run:

```powershell
node --test tests/pine-promotion-queue.test.mjs
```

Expected: fails because `scripts/lib/pine-promotion-queue.mjs` does not exist.

- [ ] **Step 3: Implement queue helper**

Create `scripts/lib/pine-promotion-queue.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

export function promotionQueuePath({ researchRoot }) {
  return path.join(researchRoot, 'state', 'promotion-queue.jsonl');
}

export function buildPromotionQueueItem({ manifest, createdAt = new Date().toISOString() } = {}) {
  const runId = manifest?.runId;
  const candidateFingerprint = manifest?.candidateFingerprint;
  if (!runId) throw new Error('Cannot queue promotion without manifest.runId');
  if (!candidateFingerprint) throw new Error('Cannot queue promotion without manifest.candidateFingerprint');
  if (manifest?.matrixDecision?.recommendation !== 'promote') {
    throw new Error(`Cannot queue non-promote manifest ${runId}`);
  }
  return {
    itemId: `${runId}:${candidateFingerprint}`,
    runId,
    manifestPath: manifest.manifestPath,
    candidateFingerprint,
    championFingerprintAtDecision: manifest.championFingerprint,
    candidateConfigId: manifest.challenger?.configId ?? null,
    championConfigIdAtDecision: manifest.champion?.configId ?? null,
    createdAt,
  };
}

export async function appendPromotionQueueEvent(queuePath, event) {
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  const record = {
    ...event,
    at: event.at ?? new Date().toISOString(),
  };
  await fs.appendFile(queuePath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function readPromotionQueue(queuePath) {
  let raw = '';
  try {
    raw = await fs.readFile(queuePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { events: [], items: [], pending: [] };
    throw error;
  }

  const events = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const byId = new Map();
  for (const event of events) {
    if (event.type === 'pending' && event.item?.itemId) {
      if (!byId.has(event.item.itemId)) {
        byId.set(event.item.itemId, {
          ...event.item,
          status: 'pending',
          statusAt: event.at,
          reason: null,
        });
      }
      continue;
    }
    if (event.type === 'status' && event.itemId && byId.has(event.itemId)) {
      const current = byId.get(event.itemId);
      byId.set(event.itemId, {
        ...current,
        status: event.status,
        statusAt: event.at,
        reason: event.reason ?? null,
        appliedConfigId: event.appliedConfigId ?? current.appliedConfigId ?? null,
      });
    }
  }

  const items = [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return {
    events,
    items,
    pending: items.filter((item) => item.status === 'pending'),
  };
}

export function selectNextPendingPromotion(queue) {
  return (queue?.pending || [])[0] || null;
}
```

- [ ] **Step 4: Run queue tests**

Run:

```powershell
node --test tests/pine-promotion-queue.test.mjs
```

Expected: all queue tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/pine-promotion-queue.mjs tests/pine-promotion-queue.test.mjs
git commit -m "feat(pine): add durable promotion queue"
```

---

## Task 3: Queue Promotion Recommendations from Cycle

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add pure helper tests for queue eligibility**

Append to `tests/pine-autoresearch.test.mjs` imports from `../scripts/pine-autoresearch.mjs`:

```js
  shouldQueuePromotionManifest,
```

Append tests:

```js
test('shouldQueuePromotionManifest queues changed promote manifests only', () => {
  assert.equal(shouldQueuePromotionManifest({
    matrixDecision: { recommendation: 'promote' },
    candidateFingerprint: 'candidate-a',
    championFingerprint: 'champion-a',
    challenger: { config: { a: 2 } },
  }), true);

  assert.equal(shouldQueuePromotionManifest({
    matrixDecision: { recommendation: 'hold' },
    candidateFingerprint: 'candidate-a',
    championFingerprint: 'champion-a',
    challenger: { config: { a: 2 } },
  }), false);

  assert.equal(shouldQueuePromotionManifest({
    matrixDecision: { recommendation: 'promote' },
    candidateFingerprint: 'champion-a',
    championFingerprint: 'champion-a',
    challenger: { config: { a: 1 } },
  }), false);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern shouldQueuePromotionManifest
```

Expected: fails because helper is not exported.

- [ ] **Step 3: Import queue helpers and add path/helper functions**

In `scripts/pine-autoresearch.mjs`, add imports:

```js
import {
  appendPromotionQueueEvent,
  buildPromotionQueueItem,
  promotionQueuePath,
  readPromotionQueue,
  selectNextPendingPromotion,
} from './lib/pine-promotion-queue.mjs';
```

Add near path helpers:

```js
function promotionQueueFilePath(config) {
  return promotionQueuePath({ researchRoot: config.researchRoot });
}

export function shouldQueuePromotionManifest(manifest) {
  return manifest?.matrixDecision?.recommendation === 'promote'
    && Boolean(manifest?.challenger?.config)
    && Boolean(manifest?.candidateFingerprint)
    && manifest.candidateFingerprint !== manifest.championFingerprint;
}
```

- [ ] **Step 4: Queue promotion after manifest write**

In `runScout(config)`, after these existing lines:

```js
  await writeJson(manifestPath, manifest);
  await writeJson(latestManifestPath(trackedConfig), { ...manifest, manifestPath });
```

Add:

```js
  if (shouldQueuePromotionManifest(manifest)) {
    const queueItem = buildPromotionQueueItem({
      manifest: { ...manifest, manifestPath },
      createdAt: manifest.generatedAt,
    });
    await appendPromotionQueueEvent(promotionQueueFilePath(trackedConfig), {
      type: 'pending',
      item: queueItem,
      at: manifest.generatedAt,
    });
  }
```

This must happen before returning from the cycle. If later digest writing fails, promotion evidence still exists.

- [ ] **Step 5: Run helper test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern shouldQueuePromotionManifest
```

Expected: pass.

- [ ] **Step 6: Run queue and autoresearch tests**

Run:

```powershell
node --test tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): queue promotion recommendations from cycles"
```

---

## Task 4: Skip New Cycles While Promotion Queue Is Pending

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add pure skip-decision tests**

Append import from `../scripts/pine-autoresearch.mjs`:

```js
  decideCycleStartAction,
```

Append tests:

```js
test('decideCycleStartAction skips when pending promotion exists', () => {
  const action = decideCycleStartAction({
    pendingPromotion: { itemId: 'run-a:fp-a', runId: 'run-a' },
    forceCycle: false,
  });

  assert.equal(action.recommendation, 'skip');
  assert.equal(action.reason, 'pending_promotion');
});

test('decideCycleStartAction allows forced cycle with pending promotion', () => {
  const action = decideCycleStartAction({
    pendingPromotion: { itemId: 'run-a:fp-a', runId: 'run-a' },
    forceCycle: true,
  });

  assert.equal(action.recommendation, 'run');
  assert.equal(action.reason, 'forced');
});

test('decideCycleStartAction runs when no pending promotion exists', () => {
  const action = decideCycleStartAction({ pendingPromotion: null, forceCycle: false });

  assert.equal(action.recommendation, 'run');
  assert.equal(action.reason, 'no_pending_promotion');
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern decideCycleStartAction
```

Expected: fails because helper is not exported.

- [ ] **Step 3: Implement skip helper**

In `scripts/pine-autoresearch.mjs`, add:

```js
export function decideCycleStartAction({ pendingPromotion = null, forceCycle = false } = {}) {
  if (pendingPromotion && !forceCycle) {
    return {
      recommendation: 'skip',
      reason: 'pending_promotion',
      pendingPromotion,
      summary: `Skip cycle: pending promotion ${pendingPromotion.itemId} from run ${pendingPromotion.runId}`,
    };
  }
  return {
    recommendation: 'run',
    reason: pendingPromotion ? 'forced' : 'no_pending_promotion',
    pendingPromotion,
  };
}
```

- [ ] **Step 4: Wire skip into `runScout()`**

At the start of `runScout(config)`, immediately after `await ensureDirs(config);`, add:

```js
  const queue = await readPromotionQueue(promotionQueueFilePath(config));
  const pendingPromotion = selectNextPendingPromotion(queue);
  const cycleStartAction = decideCycleStartAction({
    pendingPromotion,
    forceCycle: config.forceCycle === true,
  });
  if (cycleStartAction.recommendation === 'skip') {
    return {
      skipped: true,
      reason: cycleStartAction.reason,
      pendingPromotion: cycleStartAction.pendingPromotion,
    };
  }
```

In `main()`, when building `config`, pass CLI flag for cycle:

```js
  config.forceCycle = args['force-cycle'] === true;
```

In the `cycle` command branch, handle skip result before printing manifest path:

```js
    if (result.skipped) {
      console.log(`[autoresearch] cycle=skipped reason=${result.reason} pending=${result.pendingPromotion?.itemId || 'n/a'}`);
      return;
    }
```

- [ ] **Step 5: Run skip tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern decideCycleStartAction
```

Expected: pass.

- [ ] **Step 6: Run autoresearch tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): pause cycles while promotion is pending"
```

---

## Task 5: Consume Promotion Queue in Autopromote

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add queued promotion validation tests**

Append import from `../scripts/pine-autoresearch.mjs`:

```js
  decideQueuedPromotionAction,
```

Append tests:

```js
test('decideQueuedPromotionAction promotes valid queued manifest', () => {
  const queuedItem = {
    itemId: 'run-a:fp-a',
    runId: 'run-a',
    championFingerprintAtDecision: 'champ-fp',
  };
  const manifest = {
    runId: 'run-a',
    candidateFingerprint: 'cand-fp',
    championFingerprint: 'champ-fp',
    challenger: { configId: 'candidate-a', config: { a: 2 } },
    matrixDecision: { recommendation: 'promote' },
  };
  const championState = { configId: 'champion-a', configFingerprint: 'champ-fp', config: { a: 1 } };
  const autoAction = { recommendation: 'promote', gates: { enabled: true, matrixReady: true, candidateChanged: true, cooldown: true, dailyQuota: true } };

  const action = decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction });

  assert.equal(action.recommendation, 'promote');
  assert.equal(action.status, 'promoted');
});

test('decideQueuedPromotionAction marks queue stale when champion changed since decision', () => {
  const action = decideQueuedPromotionAction({
    queuedItem: { itemId: 'run-a:fp-a', runId: 'run-a', championFingerprintAtDecision: 'old-champ' },
    manifest: {
      runId: 'run-a',
      candidateFingerprint: 'cand-fp',
      championFingerprint: 'old-champ',
      challenger: { configId: 'candidate-a', config: { a: 2 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'new-champion', configFingerprint: 'new-champ', config: { a: 3 } },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(action.recommendation, 'hold');
  assert.equal(action.status, 'stale');
  assert.match(action.reason, /champion changed/i);
});

test('decideQueuedPromotionAction blocks when autopromote gates fail', () => {
  const action = decideQueuedPromotionAction({
    queuedItem: { itemId: 'run-a:fp-a', runId: 'run-a', championFingerprintAtDecision: 'champ-fp' },
    manifest: {
      runId: 'run-a',
      candidateFingerprint: 'cand-fp',
      championFingerprint: 'champ-fp',
      challenger: { configId: 'candidate-a', config: { a: 2 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { configId: 'champion-a', configFingerprint: 'champ-fp', config: { a: 1 } },
    autoAction: { recommendation: 'hold', summary: 'Auto-promote hold: failed cooldown gate(s).' },
  });

  assert.equal(action.recommendation, 'hold');
  assert.equal(action.status, 'blocked');
  assert.match(action.reason, /cooldown/);
});
```

- [ ] **Step 2: Run failing queued action tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern decideQueuedPromotionAction
```

Expected: fails because helper is not exported.

- [ ] **Step 3: Implement queued action helper**

In `scripts/pine-autoresearch.mjs`, add:

```js
export function decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction } = {}) {
  if (!queuedItem) {
    return { recommendation: 'hold', status: 'blocked', reason: 'No pending promotion item' };
  }
  if (!manifest) {
    return { recommendation: 'hold', status: 'failed', reason: `Queued manifest missing for ${queuedItem.itemId}` };
  }
  if (manifest.runId !== queuedItem.runId) {
    return { recommendation: 'hold', status: 'failed', reason: `Manifest runId ${manifest.runId} does not match queued runId ${queuedItem.runId}` };
  }
  if (manifest.matrixDecision?.recommendation !== 'promote') {
    return { recommendation: 'hold', status: 'stale', reason: `Queued manifest recommendation is ${manifest.matrixDecision?.recommendation || 'unknown'}` };
  }
  if (!manifest.challenger?.config) {
    return { recommendation: 'hold', status: 'failed', reason: 'Queued manifest has no challenger config' };
  }
  if (sameConfig(championState?.config, manifest.challenger.config)) {
    return { recommendation: 'hold', status: 'stale', reason: `Champion already matches ${manifest.challenger.configId}` };
  }
  const currentChampionFingerprint = championState?.configFingerprint || configFingerprint(championState?.config || {});
  if (queuedItem.championFingerprintAtDecision && currentChampionFingerprint !== queuedItem.championFingerprintAtDecision) {
    return { recommendation: 'hold', status: 'stale', reason: 'Current champion changed since queued decision' };
  }
  if (autoAction?.recommendation !== 'promote') {
    return { recommendation: 'hold', status: 'blocked', reason: autoAction?.summary || 'Autopromote gates did not pass' };
  }
  return { recommendation: 'promote', status: 'promoted', reason: 'Queued promotion guards passed' };
}
```

- [ ] **Step 4: Add manifest-path reader helper**

In `scripts/pine-autoresearch.mjs`, add near `readLatestManifest(config)`:

```js
async function readManifestByPath(manifestPath) {
  if (!manifestPath) return null;
  return readJson(manifestPath);
}
```

- [ ] **Step 5: Refactor `runPromote()` to accept exact manifest**

Change function signature:

```js
async function runPromote(config, args, mode = 'manual', manifestOverride = null) {
```

Replace:

```js
  const latest = await readLatestManifest(config);
```

with:

```js
  const latest = manifestOverride || await readLatestManifest(config);
```

Keep all existing promotion guards.

- [ ] **Step 6: Refactor `runAutopromote()` to use queue first**

Replace `runAutopromote(config, args)` body with:

```js
async function runAutopromote(config, args) {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const queuePath = promotionQueueFilePath(config);
  const queue = await readPromotionQueue(queuePath);
  const queuedItem = selectNextPendingPromotion(queue);

  if (!queuedItem) {
    return { promoted: false, reason: 'No pending promotion queue item', gates: {} };
  }

  let queuedManifest = null;
  try {
    queuedManifest = await readManifestByPath(queuedItem.manifestPath);
  } catch (error) {
    await appendPromotionQueueEvent(queuePath, {
      type: 'status',
      itemId: queuedItem.itemId,
      status: 'failed',
      reason: `manifest_read_failed:${error?.code || error?.message || 'unknown'}`,
    });
    return { promoted: false, reason: `Queued manifest read failed for ${queuedItem.itemId}`, gates: {} };
  }

  const historyEvents = await loadHistoryEvents(config);
  const action = decideAutoPromotionAction({
    latestManifest: queuedManifest,
    historyEvents,
    championState,
    policy: config.autoPromotion,
  });
  const queuedAction = decideQueuedPromotionAction({
    queuedItem,
    manifest: queuedManifest,
    championState,
    autoAction: action,
  });

  if (queuedAction.recommendation !== 'promote' && !args.force) {
    await appendPromotionQueueEvent(queuePath, {
      type: 'status',
      itemId: queuedItem.itemId,
      status: queuedAction.status,
      reason: queuedAction.reason,
    });
    return {
      promoted: false,
      reason: queuedAction.reason,
      gates: action.gates || {},
      failedGates: action.failedGates || [],
    };
  }

  const result = await runPromote(config, { ...args, force: true }, 'auto', queuedManifest);
  if (result.promoted) {
    await appendPromotionQueueEvent(queuePath, {
      type: 'status',
      itemId: queuedItem.itemId,
      status: 'promoted',
      reason: 'autopromoted',
      appliedConfigId: result.appliedConfigId,
    });
  }
  return result;
}
```

- [ ] **Step 7: Run queued action tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern decideQueuedPromotionAction
```

Expected: pass.

- [ ] **Step 8: Run queue/autoresearch tests**

Run:

```powershell
node --test tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 9: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): autopromote from queued manifests"
```

---

## Task 6: Add Manual Promote by `--run-id` or `--manifest`

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add manifest resolution tests**

Append import from `../scripts/pine-autoresearch.mjs`:

```js
  resolvePromotionManifestPath,
```

Append tests:

```js
test('resolvePromotionManifestPath prefers explicit manifest path', () => {
  const result = resolvePromotionManifestPath({
    config: { researchRoot: 'pine/autoresearch/matrix-a' },
    args: { manifest: 'custom/run-a.json', 'run-id': 'run-b' },
  });

  assert.equal(result, 'custom/run-a.json');
});

test('resolvePromotionManifestPath resolves run-id under manifests directory', () => {
  const result = resolvePromotionManifestPath({
    config: { researchRoot: 'pine/autoresearch/matrix-a' },
    args: { 'run-id': 'run-a' },
  });

  assert.equal(result, path.join('pine/autoresearch/matrix-a', 'manifests', 'run-a.json'));
});

test('resolvePromotionManifestPath returns null without explicit target', () => {
  const result = resolvePromotionManifestPath({
    config: { researchRoot: 'pine/autoresearch/matrix-a' },
    args: {},
  });

  assert.equal(result, null);
});
```

If `path` is not imported in the test file, add:

```js
import path from 'node:path';
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern resolvePromotionManifestPath
```

Expected: fails because helper is not exported.

- [ ] **Step 3: Implement manifest target resolver**

In `scripts/pine-autoresearch.mjs`, add:

```js
export function resolvePromotionManifestPath({ config, args = {} } = {}) {
  if (args.manifest) return args.manifest;
  if (args['run-id']) return path.join(manifestsDir(config), `${args['run-id']}.json`);
  return null;
}
```

- [ ] **Step 4: Wire resolver into `runPromote()`**

At start of `runPromote()`, replace manifest load with:

```js
  const explicitManifestPath = resolvePromotionManifestPath({ config, args });
  const latest = manifestOverride
    || (explicitManifestPath ? await readManifestByPath(explicitManifestPath) : await readLatestManifest(config));
```

After reading explicit manifest, preserve source path if missing:

```js
  if (explicitManifestPath && latest && !latest.manifestPath) {
    latest.manifestPath = explicitManifestPath;
  }
```

- [ ] **Step 5: Run resolver tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern resolvePromotionManifestPath
```

Expected: pass.

- [ ] **Step 6: Run autoresearch tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): allow promotion by exact manifest"
```

---

## Task 7: Wrap Cycle, Promote, and Autopromote with Global Lock

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add lock path and action tests**

Append import from `../scripts/pine-autoresearch.mjs`:

```js
  autoresearchLockPath,
  shouldUseAutoresearchLock,
```

Append tests:

```js
test('autoresearchLockPath stores lock under researchRoot state folder', () => {
  assert.equal(
    autoresearchLockPath({ researchRoot: 'pine/autoresearch/matrix-a' }),
    path.join('pine/autoresearch/matrix-a', 'state', 'autoresearch.lock.json'),
  );
});

test('shouldUseAutoresearchLock protects state-mutating commands', () => {
  assert.equal(shouldUseAutoresearchLock('cycle'), true);
  assert.equal(shouldUseAutoresearchLock('promote'), true);
  assert.equal(shouldUseAutoresearchLock('autopromote'), true);
  assert.equal(shouldUseAutoresearchLock('digest'), false);
  assert.equal(shouldUseAutoresearchLock('holdout'), false);
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern 'autoresearchLockPath|shouldUseAutoresearchLock'
```

Expected: fails because helpers are not exported.

- [ ] **Step 3: Import lock helpers**

In `scripts/pine-autoresearch.mjs`, add imports:

```js
import {
  acquireAutoresearchLock,
  releaseAutoresearchLock,
} from './lib/pine-autoresearch-lock.mjs';
```

- [ ] **Step 4: Add lock helper functions**

Add near path helpers:

```js
export function autoresearchLockPath(config) {
  return path.join(config.researchRoot, 'state', 'autoresearch.lock.json');
}

export function shouldUseAutoresearchLock(command) {
  return ['cycle', 'promote', 'autopromote'].includes(command);
}

async function withAutoresearchLock(config, { command, profile, staleMs = 12 * 60 * 60 * 1000 }, fn) {
  const lock = await acquireAutoresearchLock({
    lockPath: autoresearchLockPath(config),
    command,
    profile,
    staleMs,
  });

  if (!lock.acquired) {
    return {
      skipped: true,
      reason: 'locked',
      currentOwner: lock.currentOwner,
    };
  }

  try {
    return await fn();
  } finally {
    await releaseAutoresearchLock({
      lockPath: autoresearchLockPath(config),
      token: lock.owner.token,
    });
  }
}
```

- [ ] **Step 5: Wrap command branches in `main()`**

In `main()`, for command branches `cycle`, `promote`, and `autopromote`, call through `withAutoresearchLock()`.

For `cycle`, replace direct call:

```js
    const result = await runScout({ ...config, selectedProfile: args.profile || config.selectedProfile });
```

with:

```js
    const result = await withAutoresearchLock(
      config,
      { command: 'cycle', profile: args.profile || config.selectedProfile },
      () => runScout({ ...config, selectedProfile: args.profile || config.selectedProfile }),
    );
    if (result.skipped && result.reason === 'locked') {
      console.log(`[autoresearch] cycle=skipped reason=locked owner=${result.currentOwner?.command || 'unknown'} profile=${result.currentOwner?.profile || 'n/a'}`);
      return;
    }
```

For `promote`, wrap `runPromote()`:

```js
    const result = await withAutoresearchLock(
      config,
      { command: 'promote', profile: null },
      () => runPromote(config, args, 'manual'),
    );
    if (result.skipped && result.reason === 'locked') {
      console.log(`[autoresearch] promote=skipped reason=locked owner=${result.currentOwner?.command || 'unknown'}`);
      return;
    }
```

For `autopromote`, wrap `runAutopromote()`:

```js
    const result = await withAutoresearchLock(
      config,
      { command: 'autopromote', profile: null },
      () => runAutopromote(config, args),
    );
    if (result.skipped && result.reason === 'locked') {
      console.log(`[autoresearch] autopromote=skipped reason=locked owner=${result.currentOwner?.command || 'unknown'}`);
      return;
    }
```

Do not lock `digest`, because digest reads latest/history only and should not block research. If digest corruption appears later, handle separately.

- [ ] **Step 6: Run lock helper tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern 'autoresearchLockPath|shouldUseAutoresearchLock'
```

Expected: pass.

- [ ] **Step 7: Run full targeted suite**

Run:

```powershell
node --test tests/pine-autoresearch-lock.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 8: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): serialize autoresearch state mutations"
```

---

## Task 8: Add Scheduler Wrapper Lock Defense-in-Depth

**Files:**
- Modify: `scripts/ops/pine-autoresearch-run.ps1`
- Modify: `scripts/ops/install-pine-autoresearch-tasks.ps1`

- [ ] **Step 1: Inspect current wrapper**

Run:

```powershell
Get-Content scripts/ops/pine-autoresearch-run.ps1
Get-Content scripts/ops/install-pine-autoresearch-tasks.ps1
```

Expected: wrapper logs command output under `tmp\pine-autoresearch-logs`; install script creates Micro/Full/Digest/Autopromote tasks.

- [ ] **Step 2: Add wrapper-level lock for scheduled tasks**

In `scripts/ops/pine-autoresearch-run.ps1`, after `$logDir` creation, add:

```powershell
$lockDir = Join-Path $RepoRoot 'tmp\pine-autoresearch-locks'
New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
$lockFile = Join-Path $lockDir 'scheduler.lock'
$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open($lockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $payload = [System.Text.Encoding]::UTF8.GetBytes("task=$TaskName`npid=$PID`nstartedAt=$((Get-Date).ToString('o'))`n")
  $lockStream.Write($payload, 0, $payload.Length)
  $lockStream.Flush()
} catch {
  Write-Host "[$TaskName] skipped: scheduler lock exists at $lockFile"
  exit 0
}
```

Wrap the existing body in `try { ... } finally { ... }` so the lock is released:

```powershell
finally {
  if ($lockStream) {
    $lockStream.Close()
    Remove-Item -Force $lockFile -ErrorAction SilentlyContinue
  }
}
```

Keep Node lock canonical; wrapper lock only avoids wasting process startup during scheduler overlap.

- [ ] **Step 3: Update install task settings to avoid parallel instance**

In `scripts/ops/install-pine-autoresearch-tasks.ps1`, after each `schtasks /Create` call in `Register-Task`, add a PowerShell ScheduledTasks update if available:

```powershell
try {
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12)
  Set-ScheduledTask -TaskName "$TaskPrefix-$Name" -Settings $settings | Out-Null
} catch {
  Write-Warning "Could not set MultipleInstances=IgnoreNew for $TaskPrefix-$Name: $($_.Exception.Message)"
}
```

Do not change trigger cadence in this task. Cadence tuning is a separate decision.

- [ ] **Step 4: PowerShell parse check**

Run:

```powershell
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content scripts/ops/pine-autoresearch-run.ps1 -Raw), [ref]$null)
$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content scripts/ops/install-pine-autoresearch-tasks.ps1 -Raw), [ref]$null)
```

Expected: no parse errors.

- [ ] **Step 5: Dry-run wrapper**

Run:

```powershell
pwsh -NoProfile -File scripts/ops/pine-autoresearch-run.ps1 -TaskName pine-autoresearch-dry-run -Command 'node -e "console.log(\"ok\")"' -RepoRoot . -DryRun
```

Expected: prints dry-run repo/command/log info and exits 0.

- [ ] **Step 6: Commit**

```powershell
git add scripts/ops/pine-autoresearch-run.ps1 scripts/ops/install-pine-autoresearch-tasks.ps1
git commit -m "chore(pine): harden scheduled autoresearch overlap"
```

---

## Task 9: Integration Verification Without Long Backtests

**Files:**
- No source changes unless tests reveal failures.

- [ ] **Step 1: Run focused helper tests**

Run:

```powershell
node --test tests/pine-autoresearch-lock.test.mjs tests/pine-promotion-queue.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run autoresearch unit tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Run full targeted suite**

Run:

```powershell
node --test tests/pine-autoresearch-lock.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-track-generators.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: all tests pass.

- [ ] **Step 4: Verify queue path can be read when absent**

Run:

```powershell
node -e "import('./scripts/lib/pine-promotion-queue.mjs').then(async m => { const q = await m.readPromotionQueue('tmp/nonexistent-promotion-queue.jsonl'); console.log(JSON.stringify(q)); })"
```

Expected output:

```json
{"events":[],"items":[],"pending":[]}
```

- [ ] **Step 5: Verify lock blocks second holder**

Run:

```powershell
node -e "import('./scripts/lib/pine-autoresearch-lock.mjs').then(async m => { const p='tmp/test-autoresearch.lock.json'; await import('node:fs/promises').then(fs=>fs.rm(p,{force:true,recursive:false}).catch(()=>{})); const a=await m.acquireAutoresearchLock({lockPath:p,command:'cycle',profile:'micro'}); const b=await m.acquireAutoresearchLock({lockPath:p,command:'cycle',profile:'full'}); console.log(JSON.stringify({first:a.acquired,second:b.acquired,reason:b.reason})); await m.releaseAutoresearchLock({lockPath:p,token:a.owner.token}); })"
```

Expected output:

```json
{"first":true,"second":false,"reason":"locked"}
```

- [ ] **Step 6: Run full project tests**

Run:

```powershell
node --test (Get-ChildItem tests -Filter *.test.mjs | ForEach-Object { $_.FullName })
```

Expected: all tests pass.

- [ ] **Step 7: Commit only if verification docs changed**

If no files changed, skip. If docs were updated, run:

```powershell
git add docs/superpowers/plans/2026-04-30-pine-autoresearch-promotion-queue-lock.md
git commit -m "docs(pine): plan autoresearch promotion queue lock"
```

---

## Task 10: Optional Live Scheduler Safety Check After Implementation

**Files:**
- No source changes.

- [ ] **Step 1: Query scheduler state**

Run:

```powershell
schtasks /Query /TN BacktestKit-Pine-Micro /FO LIST /V
schtasks /Query /TN BacktestKit-Pine-Full /FO LIST /V
schtasks /Query /TN BacktestKit-Pine-Autopromote /FO LIST /V
```

Expected:

- Micro and Full may be enabled.
- Autopromote may remain disabled until user explicitly enables it.
- MultipleInstances should be `IgnoreNew` if Task Scheduler exposes that setting in query output.

- [ ] **Step 2: Confirm no current autoresearch process is running before scheduler change**

Run:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'pine-autoresearch\.mjs|pine-autoresearch-run\.ps1' } | Select-Object ProcessId,CommandLine
```

Expected: no running process, or a known current process that should be allowed to finish.

- [ ] **Step 3: Do not enable autopromote automatically**

Autopromote changes external project state (`pine/test.pine`, champion JSON, history). Keep it disabled unless Diko explicitly asks to enable it.

---

## Rollback Plan

If lock or queue behavior breaks scheduled runs:

1. Disable scheduler tasks temporarily:

```powershell
schtasks /Change /TN BacktestKit-Pine-Micro /DISABLE
schtasks /Change /TN BacktestKit-Pine-Full /DISABLE
schtasks /Change /TN BacktestKit-Pine-Autopromote /DISABLE
```

2. Remove stale lock file if no process is alive:

```powershell
Remove-Item -Force pine\autoresearch\pine-fusion-v4-core-15m-locked-window\state\autoresearch.lock.json -ErrorAction SilentlyContinue
Remove-Item -Force tmp\pine-autoresearch-locks\scheduler.lock -ErrorAction SilentlyContinue
```

3. Promotion evidence remains in:

```text
pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/promotion-queue.jsonl
pine/autoresearch/pine-fusion-v4-core-15m-locked-window/manifests/*.json
```

4. Manual recovery promotes an exact manifest:

```powershell
node ./scripts/pine-autoresearch.mjs promote --config ./config/pine-autoresearch.default.json --run-id <runId>
```

Only use `--force` when intentionally overriding matrix decision.

---

## Self-Review

- Spec coverage: Plan addresses missed promote recommendations, mutable `latest.json` risk, micro/full overlap, promote/autopromote overlap, pending-promotion cycle skip, stale champion validation, queue evidence, scheduler wrapper hardening, and tests.
- Placeholder scan: No placeholder markers, no vague “add tests”, no undefined helper without a task defining it.
- Type consistency: Queue fields use consistent names: `itemId`, `runId`, `manifestPath`, `candidateFingerprint`, `championFingerprintAtDecision`, `candidateConfigId`, `status`, `reason`.
- Drift control: No changes to strategy logic, scoring, matrix gates, Pine script behavior, dataset generation, or search policy. This plan only protects orchestration state and promotion delivery.
- Risk: Skipping cycles while promotion is pending can reduce research throughput. This is intended; promoting a valid winner is higher priority than generating more candidates against an obsolete champion.
