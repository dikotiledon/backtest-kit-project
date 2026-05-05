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
