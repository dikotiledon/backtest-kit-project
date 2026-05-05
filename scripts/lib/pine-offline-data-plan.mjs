export function buildOfflineDataPlan({ matrixId, pinnedData = {}, labs = [], offline = {} } = {}) {
  const mode = ['offline-strict', 'local-first', 'refresh'].includes(offline.mode) ? offline.mode : 'offline-strict';
  const networkAllowed = mode === 'refresh';
  return {
    matrixId: matrixId ?? 'pine-autoresearch',
    mode,
    networkAllowed,
    cacheRoot: pinnedData.cacheRoot ?? null,
    sourceMode: pinnedData.sourceMode ?? 'local-cache',
    requiredLabs: labs.map((lab) => ({
      labId: lab.labId,
      symbol: lab.symbol,
      timeframe: lab.timeframe,
      limit: lab.limit,
      when: lab.when,
      exchangeName: lab.exchange || pinnedData.exchangeName || 'ccxt-exchange',
      requiresCacheComplete: mode === 'offline-strict',
      complete: lab.complete ?? null,
      missingCount: lab.missingCount ?? 0,
      datasetHash: lab.datasetHash ?? null,
    })),
  };
}

function compactMissingLab(lab = {}, maxPreview = 5) {
  const missingTimestamps = Array.isArray(lab.missingTimestamps)
    ? lab.missingTimestamps.slice(0, Math.max(0, maxPreview))
    : [];
  return {
    labId: lab.labId,
    symbol: lab.symbol,
    timeframe: lab.timeframe,
    limit: lab.limit,
    when: lab.when,
    exchangeName: lab.exchangeName,
    requiresCacheComplete: lab.requiresCacheComplete,
    complete: lab.complete,
    missingCount: Number(lab.missingCount || 0),
    missingTimestamps,
  };
}

export function summarizeOfflineDataPlan(plan = {}) {
  const missingLabs = (plan.requiredLabs || [])
    .filter((lab) => lab.complete === false || Number(lab.missingCount || 0) > 0)
    .map((lab) => compactMissingLab(lab));
  return {
    ok: missingLabs.length === 0,
    reason: missingLabs.length ? 'offlineDataMissing' : 'offlineDataReady',
    mode: plan.mode ?? 'offline-strict',
    networkAllowed: Boolean(plan.networkAllowed),
    cacheRoot: plan.cacheRoot ?? null,
    sourceMode: plan.sourceMode ?? null,
    missingLabs,
  };
}
