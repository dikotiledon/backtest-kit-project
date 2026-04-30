import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function toDate(value) {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  if (typeof value === 'string') {
    return new Date(value);
  }

  return new Date();
}

function toIso(value) {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function isMissingError(error) {
  return error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export function defaultIsPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export async function readAutoresearchLock(lockPath) {
  try {
    const source = await fs.readFile(lockPath, 'utf8');
    if (!source.trim()) {
      return null;
    }

    return JSON.parse(source);
  } catch (error) {
    if (isMissingError(error)) {
      return null;
    }

    return null;
  }
}

export function isLockStale({ owner, now = new Date(), isPidAlive = defaultIsPidAlive }) {
  if (!owner || typeof owner !== 'object') {
    return true;
  }

  const acquiredAt = toDate(owner.acquiredAt);
  const staleAfterMs = Number.isFinite(owner.staleAfterMs) ? owner.staleAfterMs : 0;
  const ageMs = toDate(now).getTime() - acquiredAt.getTime();
  const oldEnough = Number.isFinite(ageMs) && ageMs >= staleAfterMs;
  const pidAlive = typeof isPidAlive === 'function' ? isPidAlive(owner.pid) : defaultIsPidAlive(owner.pid);

  return oldEnough && !pidAlive;
}

function buildOwner({ command, profile, staleMs, now, pid }) {
  return {
    token: randomUUID(),
    pid: Number.isInteger(pid) ? pid : process.pid,
    command,
    profile,
    acquiredAt: toIso(now),
    staleAfterMs: staleMs,
    cwd: process.cwd(),
  };
}

async function writeLock(lockPath, owner) {
  const handle = await fs.open(lockPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(owner, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

export async function acquireAutoresearchLock({
  lockPath,
  command,
  profile,
  staleMs,
  now = new Date(),
  pid,
  isPidAlive = defaultIsPidAlive,
}) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const owner = buildOwner({ command, profile, staleMs, now, pid });
  let reclaimed = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeLock(lockPath, owner);
      return { acquired: true, reclaimed, owner };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const currentOwner = await readAutoresearchLock(lockPath);
      if (!isLockStale({ owner: currentOwner, now, isPidAlive })) {
        return { acquired: false, reason: 'locked', currentOwner };
      }

      reclaimed = true;
      try {
        await fs.unlink(lockPath);
      } catch (unlinkError) {
        if (!isMissingError(unlinkError)) {
          throw unlinkError;
        }
      }
    }
  }

  const currentOwner = await readAutoresearchLock(lockPath);
  if (!isLockStale({ owner: currentOwner, now, isPidAlive })) {
    return { acquired: false, reason: 'locked', currentOwner };
  }

  return { acquired: false, reason: 'reclaim_failed', currentOwner };
}

export async function releaseAutoresearchLock({ lockPath, token }) {
  const currentOwner = await readAutoresearchLock(lockPath);
  if (!currentOwner) {
    return { released: false, reason: 'missing' };
  }

  if (currentOwner.token !== token) {
    return { released: false, reason: 'token_mismatch', currentOwner };
  }

  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if (!isMissingError(error)) {
      throw error;
    }
  }

  return { released: true };
}
