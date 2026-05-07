import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runEvaluationWorker } from '../scripts/lib/pine-worker-runner.mjs';

async function makeWorker(source, prefix = 'pine-worker-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const worker = path.join(dir, 'worker.mjs');
  await fs.writeFile(worker, source, 'utf8');
  return worker;
}

test('runEvaluationWorker returns parsed bounded JSON summary', async () => {
  const worker = await makeWorker("console.log(JSON.stringify({ ok: true, metrics: { roiPct: 42 } }))");

  const result = await runEvaluationWorker({ workerPath: worker, payload: { a: 1 }, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, true);
  assert.equal(result.summary.metrics.roiPct, 42);
});

test('runEvaluationWorker parses last JSON line when logs precede summary', async () => {
  const worker = await makeWorker([
    "console.log('booting worker')",
    "console.log('still running')",
    "console.log(JSON.stringify({ ok: true, score: 99 }))"
  ].join('\n'));

  const result = await runEvaluationWorker({ workerPath: worker, payload: {}, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, true);
  assert.equal(result.summary.score, 99);
});

test('runEvaluationWorker marks timeout as workerTimeout', async () => {
  const worker = await makeWorker("setTimeout(() => console.log(JSON.stringify({ ok: true })), 3000)", 'pine-worker-timeout-');

  const result = await runEvaluationWorker({ workerPath: worker, payload: {}, timeoutMs: 1000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerTimeout');
});

test('runEvaluationWorker returns workerFailed for missing workerPath', async () => {
  const result = await runEvaluationWorker({ workerPath: '', payload: {}, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.match(result.stderr, /workerPath/i);
});

test('runEvaluationWorker returns workerFailed for invalid output JSON', async () => {
  const worker = await makeWorker("console.log('not-json')");

  const result = await runEvaluationWorker({ workerPath: worker, payload: {}, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.match(result.stderr, /Invalid JSON output from worker/i);
});

test('runEvaluationWorker handles non-zero worker with structured JSON failure', async () => {
  const worker = await makeWorker([
    "console.log(JSON.stringify({ ok: false, reason: 'analysisFailed', message: 'bad data' }))",
    'process.exit(1)'
  ].join('\n'));

  const result = await runEvaluationWorker({ workerPath: worker, payload: {}, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.equal(result.summary?.reason, 'analysisFailed');
  assert.match(result.stderr, /bad data/i);
});

test('runEvaluationWorker handles non-zero worker with structured JSON failure on stderr', async () => {
  const worker = await makeWorker([
    "console.error(JSON.stringify({ ok: false, reason: 'analysisFailed', message: 'stderr bad data' }))",
    'process.exit(1)'
  ].join('\n'));

  const result = await runEvaluationWorker({ workerPath: worker, payload: {}, timeoutMs: 5000, maxOldSpaceMb: 128 });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.equal(result.summary?.reason, 'analysisFailed');
  assert.match(result.stderr, /stderr bad data/i);
});

test('runEvaluationWorker caps output buffers and marks truncation', async () => {
  const worker = await makeWorker([
    "console.log('x'.repeat(6000))",
    "console.error('y'.repeat(6000))",
    "console.log(JSON.stringify({ ok: true, done: true }))"
  ].join('\n'));

  const result = await runEvaluationWorker({
    workerPath: worker,
    payload: {},
    timeoutMs: 5000,
    maxOldSpaceMb: 128,
    maxOutputBytes: 1024
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.match(result.stdout ?? '', /truncated/i);
});

test('worker entrypoint unknown command produces structured failure via runner', async () => {
  const workerPath = path.resolve('scripts/pine-evaluate-candidate-worker.mjs');

  const result = await runEvaluationWorker({
    workerPath,
    payload: { command: 'unsupported-command' },
    timeoutMs: 5000,
    maxOldSpaceMb: 128
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.equal(result.summary?.reason, 'unknownCommand');
});

test('worker entrypoint empty object payload returns structured failure', async () => {
  const workerPath = path.resolve('scripts/pine-evaluate-candidate-worker.mjs');

  const result = await runEvaluationWorker({
    workerPath,
    payload: {},
    timeoutMs: 5000,
    maxOldSpaceMb: 128
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.equal(result.summary?.reason, 'unknownCommand');
});

test('worker entrypoint analyze-jsonl-streaming missing filePath returns structured failure', async () => {
  const workerPath = path.resolve('scripts/pine-evaluate-candidate-worker.mjs');

  const result = await runEvaluationWorker({
    workerPath,
    payload: { command: 'analyze-jsonl-streaming' },
    timeoutMs: 5000,
    maxOldSpaceMb: 128
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.equal(result.summary?.reason, 'invalidPayload');
  assert.match(result.summary?.message ?? '', /filePath/i);
});

test('runEvaluationWorker handles stdin EPIPE path without crashing', async () => {
  const worker = await makeWorker('process.exit(0)');

  const result = await runEvaluationWorker({
    workerPath: worker,
    payload: { x: 'y'.repeat(10000) },
    timeoutMs: 5000,
    maxOldSpaceMb: 128
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
});

test('runEvaluationWorker normalizes invalid numeric options to safe bounds', async () => {
  const worker = await makeWorker([
    "console.log('x'.repeat(3000))",
    "console.log(JSON.stringify({ ok: true, done: true }))"
  ].join('\n'));

  const result = await runEvaluationWorker({
    workerPath: worker,
    payload: {},
    timeoutMs: 5000,
    maxOldSpaceMb: 1,
    maxOutputBytes: 1
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'workerFailed');
  assert.match(result.stdout ?? '', /truncated/i);
});
