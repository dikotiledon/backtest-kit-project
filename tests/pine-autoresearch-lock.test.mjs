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
  assert.equal(saved.pid, 12345);
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
