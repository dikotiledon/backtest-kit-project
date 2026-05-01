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
