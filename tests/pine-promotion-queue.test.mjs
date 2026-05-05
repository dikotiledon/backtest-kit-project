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

async function makeTempDir() {
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
  assert.equal(item.championConfigIdAtDecision, 'champion-a');
  assert.equal(item.createdAt, '2026-04-30T00:01:00.000Z');
});

test('buildPromotionQueueItem captures lineage family keys and robustness snapshot', () => {
  const manifest = {
    runId: 'run-lineage-queue',
    generatedAt: '2026-05-03T00:00:00.000Z',
    manifestPath: '/tmp/run-lineage-queue.json',
    candidateFingerprint: 'fp-b',
    championFingerprint: 'fp-a',
    candidateFamilyKey: 'family-b',
    championFamilyKey: 'family-a',
    robustness: { aggregateScoreDelta: 8 },
    challenger: { configId: 'challenger-b' },
    champion: { configId: 'champion-a' },
    matrixDecision: { recommendation: 'promote' },
  };
  const item = buildPromotionQueueItem({ manifest });

  manifest.robustness.aggregateScoreDelta = 99;

  assert.equal(item.candidateFamilyKey, 'family-b');
  assert.equal(item.championFamilyKeyAtDecision, 'family-a');
  assert.deepEqual(item.robustness, { aggregateScoreDelta: 8 });
});

test('buildPromotionQueueItem keeps queue payload compact and ignores heavy regime-exit manifest fields', () => {
  const manifest = {
    runId: 'run-regime-queue',
    generatedAt: '2026-05-04T00:00:00.000Z',
    manifestPath: '/tmp/run-regime-queue.json',
    candidateFingerprint: 'fp-regime-b',
    championFingerprint: 'fp-regime-a',
    candidateFamilyKey: 'family-regime-b',
    championFamilyKey: 'family-regime-a',
    robustness: { aggregateScoreDelta: 4.2 },
    challenger: { configId: 'challenger-regime-b' },
    champion: { configId: 'champion-regime-a' },
    matrixDecision: { recommendation: 'promote' },
    researchBudgetMode: 'regime-exit',
    resourceBudget: { maxConcurrentLabWorkers: 2 },
    objectiveBreakdown: { minRoiPct: 25 },
    offlineDataSummary: { ok: true, mode: 'offline-strict' },
    shadowRegimeScoreboard: {
      selectedLane: 'exitRegime',
      laneBudgetAllocation: { exitRegime: 0.35 },
      heavyRows: Array.from({ length: 2500 }, (_, i) => ({ i, value: `x-${i}` })),
    },
  };

  const item = buildPromotionQueueItem({ manifest });

  assert.equal('researchBudgetMode' in item, false);
  assert.equal('resourceBudget' in item, false);
  assert.equal('objectiveBreakdown' in item, false);
  assert.equal('offlineDataSummary' in item, false);
  assert.equal('shadowRegimeScoreboard' in item, false);
  assert.equal(JSON.stringify(item).includes('heavyRows'), false);
});

test('appendPromotionQueueEvent persists compact queue item without heavy regime fields end-to-end', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'queue.jsonl');
  const manifest = {
    runId: 'run-regime-e2e',
    generatedAt: '2026-05-04T00:00:00.000Z',
    manifestPath: '/tmp/run-regime-e2e.json',
    candidateFingerprint: 'fp-regime-e2e-b',
    championFingerprint: 'fp-regime-e2e-a',
    candidateFamilyKey: 'family-regime-e2e-b',
    championFamilyKey: 'family-regime-e2e-a',
    robustness: { aggregateScoreDelta: 6.4 },
    challenger: { configId: 'challenger-regime-e2e-b' },
    champion: { configId: 'champion-regime-e2e-a' },
    matrixDecision: { recommendation: 'promote' },
    shadowRegimeScoreboard: {
      selectedLane: 'exitRegime',
      heavyRows: Array.from({ length: 1200 }, (_, i) => ({ i, value: `heavy-${i}` })),
      rawMatrix: Array.from({ length: 500 }, (_, i) => [i, i + 1, i + 2]),
    },
    rawRegimeSeries: Array.from({ length: 2000 }, (_, i) => ({ ts: i, signal: `s-${i}` })),
  };

  const item = buildPromotionQueueItem({ manifest, createdAt: '2026-05-04T00:01:00.000Z' });
  await appendPromotionQueueEvent(queuePath, {
    type: 'pending',
    item,
    at: '2026-05-04T00:01:00.000Z',
  });

  const raw = await fs.readFile(queuePath, 'utf8');
  const firstLine = raw.trim().split('\n')[0];

  assert.equal(firstLine.includes('heavyRows'), false);
  assert.equal(firstLine.includes('rawRegimeSeries'), false);
  assert.equal(firstLine.includes('rawMatrix'), false);
  assert.equal(firstLine.includes('heavy-1199'), false);
  assert.equal(firstLine.includes('itemId'), true);
  assert.equal(firstLine.includes('candidateFamilyKey'), true);
  assert.equal(firstLine.includes('robustness'), true);
});

test('readPromotionQueue returns empty queue when file is missing', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'missing.jsonl');

  const queue = await readPromotionQueue(queuePath);

  assert.deepEqual(queue, { events: [], items: [], pending: [], errors: [], orphanStatuses: [] });
});

test('readPromotionQueue reduces pending and status events', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'queue.jsonl');

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
    at: '2026-04-30T00:00:00.000Z',
  });
  await appendPromotionQueueEvent(queuePath, {
    type: 'status',
    itemId: 'run-a:fp-a',
    status: 'blocked',
    reason: 'cooldown',
    at: '2026-04-30T00:02:00.000Z',
  });

  const queue = await readPromotionQueue(queuePath);

  assert.equal(queue.events.length, 2);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].status, 'blocked');
  assert.equal(queue.items[0].reason, 'cooldown');
  assert.equal(queue.items[0].statusAt, '2026-04-30T00:02:00.000Z');
  assert.equal(queue.pending.length, 0);
});

test('readPromotionQueue skips malformed lines and records parse errors', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'queue.jsonl');

  await fs.writeFile(
    queuePath,
    [
      JSON.stringify({
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
        at: '2026-04-30T00:00:00.000Z',
      }),
      '{broken json',
      '',
      JSON.stringify({
        type: 'status',
        itemId: 'run-a:fp-a',
        status: 'blocked',
        reason: 'cooldown',
        at: '2026-04-30T00:02:00.000Z',
      }),
    ].join('\n'),
    'utf8',
  );

  const queue = await readPromotionQueue(queuePath);

  assert.equal(queue.events.length, 2);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].status, 'blocked');
  assert.equal(queue.errors.length, 1);
  assert.equal(queue.errors[0].lineNumber, 2);
  assert.match(queue.errors[0].reason, /Unexpected token|JSON/);
  assert.deepEqual(queue.orphanStatuses, []);
});

test('readPromotionQueue surfaces status events before pending as orphan statuses', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'queue.jsonl');

  await fs.writeFile(
    queuePath,
    [
      JSON.stringify({
        type: 'status',
        itemId: 'run-a:fp-a',
        status: 'blocked',
        reason: 'cooldown',
        at: '2026-04-30T00:01:00.000Z',
      }),
      JSON.stringify({
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
        at: '2026-04-30T00:00:00.000Z',
      }),
    ].join('\n'),
    'utf8',
  );

  const queue = await readPromotionQueue(queuePath);

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].status, 'pending');
  assert.equal(queue.orphanStatuses.length, 1);
  assert.deepEqual(queue.orphanStatuses[0], {
    itemId: 'run-a:fp-a',
    status: 'blocked',
    reason: 'cooldown',
    appliedConfigId: null,
    at: '2026-04-30T00:01:00.000Z',
  });
});

test('duplicate pending events are idempotent by itemId during reduction', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'queue.jsonl');
  const item = {
    itemId: 'run-a:fp-a',
    runId: 'run-a',
    manifestPath: 'manifests/run-a.json',
    candidateFingerprint: 'fp-a',
    championFingerprintAtDecision: 'champ-a',
    candidateConfigId: 'candidate-a',
    createdAt: '2026-04-30T00:00:00.000Z',
  };

  await appendPromotionQueueEvent(queuePath, { type: 'pending', item, at: '2026-04-30T00:00:00.000Z' });
  await appendPromotionQueueEvent(queuePath, { type: 'pending', item, at: '2026-04-30T00:00:01.000Z' });

  const queue = await readPromotionQueue(queuePath);

  assert.equal(queue.items.length, 1);
  assert.equal(queue.pending.length, 1);
  assert.equal(queue.pending[0].itemId, 'run-a:fp-a');
});

test('selectNextPendingPromotion returns oldest pending item', async () => {
  const dir = await makeTempDir();
  const queuePath = path.join(dir, 'queue.jsonl');

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
    at: '2026-04-30T00:02:00.000Z',
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
    at: '2026-04-30T00:01:00.000Z',
  });

  const queue = await readPromotionQueue(queuePath);
  const next = selectNextPendingPromotion(queue);

  assert.equal(next.itemId, 'run-a:fp-a');
});
