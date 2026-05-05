function finiteNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLaneRatios(raw = {}) {
  const base = {
    exploitRatio: clamp(finiteNumber(raw.exploitRatio, 0.25), 0, 1),
    exitRegimeRatio: clamp(finiteNumber(raw.exitRegimeRatio, 0.35), 0, 1),
    globalAllParameterRatio: clamp(finiteNumber(raw.globalAllParameterRatio, 0.25), 0, 1),
    robustnessRatio: clamp(finiteNumber(raw.robustnessRatio, 0.15), 0, 1),
  };
  const sum = Object.values(base).reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    return {
      exploitRatio: 0.25,
      exitRegimeRatio: 0.35,
      globalAllParameterRatio: 0.25,
      robustnessRatio: 0.15,
    };
  }
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value / sum]));
}

export function normalizeRegimeExitResearchConfig(raw = {}) {
  return {
    enabled: raw.enabled === true,
    exitRegimeEnabled: raw.exitRegimeEnabled !== false,
    globalAllParameterEnabled: raw.globalAllParameterEnabled !== false,
    robustnessLadderEnabled: raw.robustnessLadderEnabled !== false,
    streamingMetricsEnabled: raw.streamingMetricsEnabled !== false,
    childWorkerIsolationEnabled: raw.childWorkerIsolationEnabled !== false,
    offline: {
      mode: ['offline-strict', 'local-first', 'refresh'].includes(raw.offline?.mode)
        ? raw.offline.mode
        : 'offline-strict',
      allowEmergencyReducedMatrix: raw.offline?.allowEmergencyReducedMatrix === true,
    },
    lanes: normalizeLaneRatios(raw.lanes),
    resource: {
      maxCandidateBatchSize: Math.max(1, Math.floor(finiteNumber(raw.resource?.maxCandidateBatchSize, 8))),
      maxConcurrentLabWorkers: Math.max(1, Math.floor(finiteNumber(raw.resource?.maxConcurrentLabWorkers, 1))),
      maxRowsLoadedPerWorker: Math.max(100, Math.floor(finiteNumber(raw.resource?.maxRowsLoadedPerWorker, 250000))),
      maxManifestBytes: Math.max(16384, Math.floor(finiteNumber(raw.resource?.maxManifestBytes, 512000))),
      maxRetainedJsonlPerRun: Math.max(0, Math.floor(finiteNumber(raw.resource?.maxRetainedJsonlPerRun, 4))),
      softLaneTimeoutMs: Math.max(1000, Math.floor(finiteNumber(raw.resource?.softLaneTimeoutMs, 15 * 60 * 1000))),
      hardWorkerTimeoutMs: Math.max(1000, Math.floor(finiteNumber(raw.resource?.hardWorkerTimeoutMs, 5 * 60 * 1000))),
      maxWorkerOldSpaceMb: Math.max(64, Math.floor(finiteNumber(raw.resource?.maxWorkerOldSpaceMb, 512))),
    },
    objective: {
      minRoiPct: finiteNumber(raw.objective?.minRoiPct, 25),
      minExpectancyDelta: finiteNumber(raw.objective?.minExpectancyDelta, 0),
      maxDrawdownDeltaPct: finiteNumber(raw.objective?.maxDrawdownDeltaPct, 0.75),
      minTradeRatioVsIncumbent: finiteNumber(raw.objective?.minTradeRatioVsIncumbent, 0.8),
      multipleTestingPenaltyBase: finiteNumber(raw.objective?.multipleTestingPenaltyBase, 0.25),
      multipleTestingPenaltyStep: finiteNumber(raw.objective?.multipleTestingPenaltyStep, 0.05),
    },
  };
}

export function isRegimeExitResearchEnabled(config = {}) {
  return config?.enabled === true;
}
