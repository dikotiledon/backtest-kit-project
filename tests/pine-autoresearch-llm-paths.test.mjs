import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLlmLaneNamespace,
  buildLlmLanePaths,
  normalizeMatrixId,
} from '../scripts/lib/pine-autoresearch-llm-paths.mjs';

test('normalizeMatrixId keeps safe matrix ids unchanged', () => {
  assert.equal(
    normalizeMatrixId('pine-fusion-v4-core-15m-locked-window'),
    'pine-fusion-v4-core-15m-locked-window',
  );
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
  assert.equal(
    paths.root,
    path.join('C:/repo', 'pine', 'autoresearch-llm', 'llm-pine-fusion-v4-core-15m-locked-window'),
  );
  assert.equal(paths.schedulerLock, path.join(paths.state, 'llm-scheduler.lock'));
  assert.equal(paths.stateLock, path.join(paths.state, 'llm-state.lock'));
  assert.equal(paths.reservationLock, path.join(paths.state, 'llm-reservation.lock'));
  assert.equal(paths.ledger, path.join(paths.state, 'llm-ledger.jsonl'));
  assert.equal(paths.memory, path.join(paths.state, 'llm-research-memory.json'));
  assert.equal(paths.reviewQueue, path.join(paths.state, 'llm-manual-review-queue.jsonl'));
  assert.equal(paths.tabu, path.join(paths.state, 'llm-tabu-fingerprints.json'));
  assert.equal(paths.providerStatus, path.join(paths.state, 'llm-provider-status.json'));
  assert.equal(
    paths.mutexName,
    'Global\\BacktestKit-Pine-LLM-Autoresearch-pine-fusion-v4-core-15m-locked-window',
  );
  assert.ok(!paths.schedulerLock.includes('tmp\\pine-autoresearch-locks'));
  assert.ok(!paths.schedulerLock.includes('tmp/pine-autoresearch-locks'));
});
