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
