import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildCheckpointKey,
  appendCheckpointEvent,
  readCheckpointState,
  selectIncompleteStages,
} from '../scripts/lib/pine-checkpoint-state.mjs';

async function createTempCheckpointPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-checkpoint-'));
  return path.join(dir, 'checkpoint.jsonl');
}

test('readCheckpointState returns empty map for missing file', async () => {
  const file = await createTempCheckpointPath();
  const state = await readCheckpointState(file);

  assert.equal(state.size, 0);
  assert.deepEqual(state.parseErrors, []);
});

test('latest event wins across mixed keys', async () => {
  const file = await createTempCheckpointPath();

  const keyA = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary', stage: 'matrix' });
  const keyB = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c2', labId: 'primary', stage: 'matrix' });

  await appendCheckpointEvent(file, { key: keyA, status: 'started', at: '2026-05-05T00:00:00.000Z' });
  await appendCheckpointEvent(file, { key: keyB, status: 'started', at: '2026-05-05T00:00:05.000Z' });
  await appendCheckpointEvent(file, { key: keyA, status: 'failed', at: '2026-05-05T00:00:10.000Z' });

  const state = await readCheckpointState(file);

  assert.equal(state.get(keyA).status, 'failed');
  assert.equal(state.get(keyB).status, 'started');
});

test('started and failed stages stay incomplete; completed excluded', () => {
  const startedKey = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary', stage: 'started-stage' });
  const failedKey = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary', stage: 'failed-stage' });
  const completedKey = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary', stage: 'completed-stage' });

  const state = new Map([
    [startedKey, { key: startedKey, status: 'started' }],
    [failedKey, { key: failedKey, status: 'failed' }],
    [completedKey, { key: completedKey, status: 'completed' }],
  ]);

  const incomplete = selectIncompleteStages(
    [{ key: startedKey }, { key: failedKey }, { key: completedKey }],
    state,
  );

  assert.deepEqual(incomplete.map((s) => s.key), [startedKey, failedKey]);
});

test('buildCheckpointKey rejects missing, empty, and pipe-containing parts', () => {
  assert.throws(
    () => buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary' }),
    /stage.*required/i,
  );

  assert.throws(
    () => buildCheckpointKey({ runId: 'run-1', lane: '   ', candidateId: 'c1', labId: 'primary', stage: 'matrix' }),
    /lane.*non-empty/i,
  );

  assert.throws(
    () => buildCheckpointKey({ runId: 'run-1', lane: 'exit\|regime', candidateId: 'c1', labId: 'primary', stage: 'matrix' }),
    /lane.*must not contain/i,
  );
});

test('malformed lines and missing-key events skipped but reported via parseErrors', async () => {
  const file = await createTempCheckpointPath();
  const goodKey = buildCheckpointKey({ runId: 'run-1', lane: 'exit-regime', candidateId: 'c1', labId: 'primary', stage: 'matrix' });

  const lines = [
    '{"key":"k1","status":"started"}',
    '{not-json',
    '{"status":"completed"}',
    JSON.stringify({ key: goodKey, status: 'completed' }),
    '',
  ];

  await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');

  const state = await readCheckpointState(file);

  assert.equal(state.get(goodKey).status, 'completed');
  assert.equal(state.get('k1').status, 'started');
  assert.equal(state.parseErrors.length, 2);
  assert.equal(state.parseErrors[0].lineNumber, 2);
  assert.match(state.parseErrors[0].error, /^invalid-json:/);
  assert.deepEqual(state.parseErrors[1], { lineNumber: 3, error: 'missing-key' });
});
