function cloneMemory(memory) {
  return {
    ...(memory ?? {}),
    recentCandidates: Array.isArray(memory?.recentCandidates) ? [...memory.recentCandidates] : [],
    topWinners: Array.isArray(memory?.topWinners) ? [...memory.topWinners] : [],
    rejectedFingerprints: Array.isArray(memory?.rejectedFingerprints) ? [...memory.rejectedFingerprints] : [],
  };
}

function trimToCount(values, limit) {
  if (!Number.isFinite(limit) || limit < 0) {
    return values;
  }

  if (values.length <= limit) {
    return values;
  }

  return values.slice(values.length - limit);
}

function hotMemorySize(memory) {
  return Buffer.byteLength(JSON.stringify(memory), 'utf8');
}

function pruneForBytes(memory, maxHotMemoryBytes) {
  if (!Number.isFinite(maxHotMemoryBytes) || maxHotMemoryBytes <= 0) {
    return memory;
  }

  const next = cloneMemory(memory);
  while (hotMemorySize(next) > maxHotMemoryBytes) {
    if (next.recentCandidates.length > 0) {
      next.recentCandidates.shift();
      continue;
    }

    if (next.topWinners.length > 0) {
      next.topWinners.shift();
      continue;
    }

    if (next.rejectedFingerprints.length > 0) {
      next.rejectedFingerprints.shift();
      continue;
    }

    break;
  }

  return next;
}

export function pruneResearchMemory(memory, caps = {}) {
  const next = cloneMemory(memory);
  next.recentCandidates = trimToCount(next.recentCandidates, caps.recentCandidates ?? 20);
  next.topWinners = trimToCount(next.topWinners, caps.topWinners ?? 10);
  next.rejectedFingerprints = trimToCount(next.rejectedFingerprints, caps.tabuFingerprints ?? 50);
  return pruneForBytes(next, caps.maxHotMemoryBytes);
}

export function updateResearchMemory(memory, event, caps = {}) {
  const next = cloneMemory(memory);

  if (event?.candidateSummary) {
    next.recentCandidates.push({ ...event.candidateSummary });
  }

  if (Number.isFinite(event?.pendingReviewCount)) {
    next.pendingReviewCount = event.pendingReviewCount;
  }

  if (event?.winnerSummary) {
    next.topWinners.push({ ...event.winnerSummary });
  }

  return pruneResearchMemory(next, caps);
}
