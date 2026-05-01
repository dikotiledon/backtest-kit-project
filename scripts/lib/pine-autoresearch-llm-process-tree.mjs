export async function verifyProcessTreeDead({ rootPid, descendantPids = [], isPidAlive }) {
  const pids = [rootPid, ...descendantPids].filter((pid) => Number.isInteger(pid) && pid > 0);
  const alivePids = [];
  for (const pid of pids) {
    if (await isPidAlive(pid)) alivePids.push(pid);
  }
  return { ok: alivePids.length === 0, checkedPids: pids, alivePids };
}

export function classifyTimeoutTermination({ timedOut, forceKillUsed, verifyDead }) {
  if (!timedOut) return 'completed';
  if (!verifyDead?.ok) return 'timeout_kill_failed';
  return forceKillUsed ? 'timeout_forced_tree_kill' : 'timeout_clean_exit';
}
