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

function getOwnerSnapshot(owner) {
  if (!owner || typeof owner !== 'object') {
    return null;
  }

  return {
    token: owner.token,
    pid: owner.pid,
    acquiredAt: owner.acquiredAt,
    command: owner.command,
    profile: owner.profile,
  };
}

function sameOwnerSnapshot(left, right) {
  const leftSnapshot = getOwnerSnapshot(left);
  const rightSnapshot = getOwnerSnapshot(right);

  if (!leftSnapshot || !rightSnapshot) {
    return false;
  }

  return (
    leftSnapshot.token === rightSnapshot.token
    && leftSnapshot.pid === rightSnapshot.pid
    && leftSnapshot.acquiredAt === rightSnapshot.acquiredAt
    && leftSnapshot.command === rightSnapshot.command
    && leftSnapshot.profile === rightSnapshot.profile
  );
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

async function openExclusiveHandle(filePath) {
  try {
    return await fs.open(filePath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return null;
    }

    throw error;
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
  readLock = readAutoresearchLock,
  unlinkLock = fs.unlink,
}) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const owner = buildOwner({ command, profile, staleMs, now, pid });

  try {
    await writeLock(lockPath, owner);
    return { acquired: true, reclaimed: false, owner };
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error;
    }
  }

  const currentOwner = await readLock(lockPath);
  if (!isLockStale({ owner: currentOwner, now, isPidAlive })) {
    return { acquired: false, reason: 'locked', currentOwner };
  }

  const reclaimPath = `${lockPath}.reclaim`;
  const reclaimHandle = await openExclusiveHandle(reclaimPath);

  if (!reclaimHandle) {
    return { acquired: false, reason: 'reclaim_in_progress', currentOwner };
  }

  try {
    const guardedOwner = await readLock(lockPath);
    if (guardedOwner && (!sameOwnerSnapshot(guardedOwner, currentOwner) || !isLockStale({ owner: guardedOwner, now, isPidAlive }))) {
      return { acquired: false, reason: 'locked', currentOwner: guardedOwner };
    }

    try {
      await unlinkLock(lockPath);
    } catch (unlinkError) {
      if (!isMissingError(unlinkError)) {
        throw unlinkError;
      }
    }

    try {
      await writeLock(lockPath, owner);
      return { acquired: true, reclaimed: true, owner };
    } catch (writeError) {
      if (writeError?.code === 'EEXIST') {
        const winnerOwner = await readLock(lockPath);
        return { acquired: false, reason: 'locked', currentOwner: winnerOwner };
      }

      throw writeError;
    }
  } finally {
    try {
      await reclaimHandle.close();
    } finally {
      try {
        await fs.unlink(reclaimPath);
      } catch (cleanupError) {
        if (!isMissingError(cleanupError)) {
          throw cleanupError;
        }
      }
    }
  }
}

export async function releaseAutoresearchLock({ lockPath, token, readLock = readAutoresearchLock, unlinkLock = fs.unlink }) {
  const currentOwner = await readLock(lockPath);
  if (!currentOwner) {
    return { released: false, reason: 'missing' };
  }

  if (currentOwner.token !== token) {
    return { released: false, reason: 'token_mismatch', currentOwner };
  }

  const latestOwner = await readLock(lockPath);
  if (!latestOwner) {
    return { released: false, reason: 'missing' };
  }

  if (latestOwner.token !== token) {
    return { released: false, reason: 'token_mismatch', currentOwner: latestOwner };
  }

  try {
    await unlinkLock(lockPath);
  } catch (error) {
    if (!isMissingError(error)) {
      throw error;
    }
  }

  return { released: true };
}
