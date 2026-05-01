import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  appendReviewQueueEvent,
  buildReviewQueueItem,
  markStaleReviewItems,
  readReviewQueue,
  resolveReviewItem,
  unresolvedReviewItems,
} from '../scripts/lib/pine-autoresearch-llm-review-queue.mjs';

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-llm-review-'));
}

test('buildReviewQueueItem uses parent:candidate itemId and pending status', () => {
  const item = buildReviewQueueItem({
    parentChampionFingerprint: 'champ',
    candidateFingerprint: 'cand',
    createdAt: '2026-05-01T00:00:00.000Z',
  });

  assert.equal(item.itemId, 'champ:cand');
  assert.equal(item.status, 'pending_review');
});

test('pending and accepted_for_manual_promotion block scheduled research', () => {
  const queue = {
    items: [
      { itemId: 'a', status: 'pending_review' },
      { itemId: 'b', status: 'accepted_for_manual_promotion' },
      { itemId: 'c', status: 'rejected' },
    ],
  };

  assert.deepEqual(unresolvedReviewItems(queue).map((item) => item.itemId), ['a', 'b']);
});

test('resolved review statuses unblock scheduled research', () => {
  const queue = {
    items: [
      { itemId: 'a', status: 'rejected' },
      { itemId: 'b', status: 'stale' },
      { itemId: 'c', status: 'superseded' },
      { itemId: 'd', status: 'archived' },
    ],
  };

  assert.equal(unresolvedReviewItems(queue).length, 0);
});

test('markStaleReviewItems unblocks changed parent champion', async () => {
  const dir = await tempDir();
  const queuePath = path.join(dir, 'llm-manual-review-queue.jsonl');

  try {
    await appendReviewQueueEvent(queuePath, buildReviewQueueItem({
      parentChampionFingerprint: 'old-champ',
      candidateFingerprint: 'cand-1',
      createdAt: '2026-05-01T00:00:00.000Z',
    }));

    await markStaleReviewItems(queuePath, { currentChampionFingerprint: 'new-champ', at: '2026-05-01T01:00:00.000Z' });

    const queue = await readReviewQueue(queuePath);
    assert.equal(unresolvedReviewItems(queue).length, 0);
    assert.equal(queue.items[0].status, 'stale');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveReviewItem appends a status event', async () => {
  const dir = await tempDir();
  const queuePath = path.join(dir, 'llm-manual-review-queue.jsonl');

  try {
    await appendReviewQueueEvent(queuePath, buildReviewQueueItem({
      parentChampionFingerprint: 'champ',
      candidateFingerprint: 'cand',
      createdAt: '2026-05-01T00:00:00.000Z',
    }));

    await resolveReviewItem(queuePath, { itemId: 'champ:cand', status: 'rejected', reason: 'bad', at: '2026-05-01T02:00:00.000Z' });
    const queue = await readReviewQueue(queuePath);
    assert.equal(queue.items[0].status, 'rejected');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
