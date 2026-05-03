function cloneMemory(memory) {
  return {
    ...(memory ?? {}),
    recentCandidates: Array.isArray(memory?.recentCandidates) ? [...memory.recentCandidates] : [],
    topWinners: Array.isArray(memory?.topWinners) ? [...memory.topWinners] : [],
    rejectedFingerprints: Array.isArray(memory?.rejectedFingerprints) ? [...memory.rejectedFingerprints] : [],
    failureLessons: Array.isArray(memory?.failureLessons) ? [...memory.failureLessons] : [],
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

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function compactCandidateParams(candidate) {
  if (!isPlainObject(candidate) || !isPlainObject(candidate.params)) {
    return {};
  }

  return { ...candidate.params };
}

function capText(text, max = 500) {
  if (typeof text !== 'string') {
    return text;
  }

  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function compactMatrixBlocker(event) {
  const metricsDelta = event?.metricsDelta;
  if (!isPlainObject(metricsDelta) || metricsDelta.recommendation == null) {
    return null;
  }

  return {
    recommendation: metricsDelta.recommendation,
    reason: metricsDelta.summary ?? metricsDelta.reason ?? null,
    aggregateScoreDelta: metricsDelta.aggregateScoreDelta ?? null,
    aggregateRoiDeltaPct: metricsDelta.aggregateRoiDeltaPct ?? null,
    aggregateProfitFactorDelta: metricsDelta.aggregateProfitFactorDelta ?? null,
    aggregateDrawdownDeltaPct: metricsDelta.aggregateDrawdownDeltaPct ?? null,
    promotedLabCount: metricsDelta.promotedLabCount ?? null,
    labCount: metricsDelta.labCount ?? null,
  };
}

function buildFailureLesson(event) {
  if (event?.type === 'candidate_invalid') {
    const reason = event?.reason ?? 'unknown reason';
    const paramsPreview = JSON.stringify(compactCandidateParams(event?.candidate));
    return capText(`Candidate invalid: ${reason} for params ${paramsPreview}`);
  }

  const metricsDelta = event?.metricsDelta;
  if (metricsDelta?.recommendation === 'hold') {
    const reason = metricsDelta.summary ?? metricsDelta.reason ?? 'no reason';
    const roiDelta = metricsDelta.aggregateRoiDeltaPct ?? null;
    const drawdownDelta = metricsDelta.aggregateDrawdownDeltaPct ?? null;
    const promoted = metricsDelta.promotedLabCount ?? null;
    const totalLabs = metricsDelta.labCount ?? null;
    return capText(`Matrix hold: ${reason} ROI delta ${roiDelta} drawdown delta ${drawdownDelta} promoted labs ${promoted}/${totalLabs}`);
  }

  return null;
}

export function pruneResearchMemory(memory, caps = {}) {
  const next = cloneMemory(memory);
  next.recentCandidates = trimToCount(next.recentCandidates, caps.recentCandidates ?? 20);
  next.topWinners = trimToCount(next.topWinners, caps.topWinners ?? 10);
  next.rejectedFingerprints = trimToCount(next.rejectedFingerprints, caps.tabuFingerprints ?? 50);
  next.failureLessons = trimToCount(next.failureLessons, caps.failureLessons ?? 20);
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

  const matrixBlocker = compactMatrixBlocker(event);
  if (matrixBlocker) {
    next.latestMatrixBlocker = matrixBlocker;
  }

  const failureLesson = buildFailureLesson(event);
  if (failureLesson) {
    next.failureLessons = next.failureLessons.filter((lesson) => lesson !== failureLesson);
    next.failureLessons.unshift(failureLesson);
  }

  if (event?.type === 'candidate' || event?.type === 'candidate_invalid') {
    next.recentCandidates.push({
      at: event?.at ?? new Date().toISOString(),
      fingerprint: event?.fingerprint ?? null,
      params: compactCandidateParams(event?.candidate),
      outcome: event?.type,
      reason: event?.reason ?? null,
    });
  }

  return pruneResearchMemory(next, caps);
}
