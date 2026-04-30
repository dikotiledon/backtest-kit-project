import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireAutoresearchLock,
  defaultIsPidAlive,
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

test('acquireAutoresearchLock skips deleting when stale snapshot changes', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');
  const staleOwner = {
    token: 'stale-token',
    pid: 1,
    command: 'cycle',
    profile: 'full',
    acquiredAt: '2026-04-30T00:00:00.000Z',
    staleAfterMs: 60_000,
  };
  const freshOwner = {
    token: 'fresh-token',
    pid: 2,
    command: 'cycle',
    profile: 'full',
    acquiredAt: '2026-04-30T00:01:30.000Z',
    staleAfterMs: 60_000,
  };
  const calls = [];
  let readCount = 0;

  await fs.writeFile(lockPath, JSON.stringify(staleOwner, null, 2));

  const result = await acquireAutoresearchLock({
    lockPath,
    command: 'autopromote',
    staleMs: 60_000,
    now: '2026-04-30T00:02:00.000Z',
    pid: 300,
    isPidAlive: () => false,
    readLock: async () => {
      readCount += 1;
      return readCount === 1 ? staleOwner : freshOwner;
    },
    unlinkLock: async () => {
      calls.push('unlink');
    },
  });

  assert.equal(result.acquired, false);
  assert.equal(result.reason, 'locked');
  assert.equal(result.currentOwner.token, 'fresh-token');
  assert.deepEqual(calls, []);
});

test('acquireAutoresearchLock serializes concurrent stale reclaim attempts behind guard', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');
  const staleOwner = {
    token: 'stale-token',
    pid: 1,
    command: 'cycle',
    profile: 'full',
    acquiredAt: '2026-04-30T00:00:00.000Z',
    staleAfterMs: 60_000,
  };

  await fs.writeFile(lockPath, JSON.stringify(staleOwner, null, 2));

  let resolveFirstUnlinkEntered;
  const firstUnlinkEntered = new Promise((resolve) => {
    resolveFirstUnlinkEntered = resolve;
  });

  let resolveFirstUnlink;
  const allowFirstUnlink = new Promise((resolve) => {
    resolveFirstUnlink = resolve;
  });

  let unlinkCalls = 0;
  const unlinkLock = async (targetPath) => {
    unlinkCalls += 1;
    assert.equal(targetPath, lockPath);

    if (unlinkCalls === 1) {
      resolveFirstUnlinkEntered();
      await allowFirstUnlink;
    }

    try {
      await fs.unlink(targetPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  };

  const firstAcquire = acquireAutoresearchLock({
    lockPath,
    command: 'autopromote',
    staleMs: 60_000,
    now: '2026-04-30T00:02:00.000Z',
    pid: 300,
    isPidAlive: () => false,
    unlinkLock,
  });

  await firstUnlinkEntered;

  const second = await acquireAutoresearchLock({
    lockPath,
    command: 'cycle',
    staleMs: 60_000,
    now: '2026-04-30T00:02:00.000Z',
    pid: 301,
    isPidAlive: () => false,
    unlinkLock,
  });

  assert.equal(second.acquired, false);
  assert.equal(second.reason, 'reclaim_in_progress');
  assert.equal(unlinkCalls, 1);
  assert.equal((await readAutoresearchLock(lockPath)).token, 'stale-token');

  resolveFirstUnlink();

  const first = await firstAcquire;
  assert.equal(first.acquired, true);
  assert.equal(first.reclaimed, true);
  assert.equal(unlinkCalls, 1);

  const saved = await readAutoresearchLock(lockPath);
  assert.equal(saved.token, first.owner.token);
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

test('releaseAutoresearchLock skips delete when token changes before unlink', async () => {
  const dir = await makeTempDir();
  const lockPath = path.join(dir, 'autoresearch.lock.json');
  const initialOwner = {
    token: 'token-a',
    pid: 1,
    command: 'cycle',
    profile: 'micro',
    acquiredAt: '2026-04-30T00:00:00.000Z',
    staleAfterMs: 60_000,
  };
  const replacedOwner = {
    token: 'token-b',
    pid: 2,
    command: 'cycle',
    profile: 'micro',
    acquiredAt: '2026-04-30T00:00:05.000Z',
    staleAfterMs: 60_000,
  };
  const calls = [];
  let readCount = 0;

  const result = await releaseAutoresearchLock({
    lockPath,
    token: 'token-a',
    readLock: async () => {
      readCount += 1;
      return readCount === 1 ? initialOwner : replacedOwner;
    },
    unlinkLock: async () => {
      calls.push('unlink');
    },
  });

  assert.equal(result.released, false);
  assert.equal(result.reason, 'token_mismatch');
  assert.equal(result.currentOwner.token, 'token-b');
  assert.deepEqual(calls, []);
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

test('defaultIsPidAlive treats invalid pid as dead and EPERM as alive', () => {
  const originalKill = process.kill;
  try {
    process.kill = (pid, signal) => {
      if (pid === 42) {
        const error = new Error('permission');
        error.code = 'EPERM';
        throw error;
      }

      if (pid === 43) {
        const error = new Error('missing');
        error.code = 'ESRCH';
        throw error;
      }

      return originalKill(pid, signal);
    };

    assert.equal(defaultIsPidAlive(0), false);
    assert.equal(defaultIsPidAlive(-1), false);
    assert.equal(defaultIsPidAlive(42), true);
    assert.equal(defaultIsPidAlive(43), false);
  } finally {
    process.kill = originalKill;
  }
});
