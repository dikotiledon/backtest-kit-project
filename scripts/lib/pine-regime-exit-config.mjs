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

function normalizePromotion(raw = {}) {
  return {
    allowAutomaticRegimeSwitching: raw.allowAutomaticRegimeSwitching === true,
    requireGlobalChampionAnchor: raw.requireGlobalChampionAnchor !== false,
    minRoiDeltaPct: finiteNumber(raw.minRoiDeltaPct, 5),
    minProfitFactorDelta: finiteNumber(raw.minProfitFactorDelta, 0.1),
    minTradeCount: Math.max(0, Math.floor(finiteNumber(raw.minTradeCount, 60))),
    requireBlindHoldoutVerdict: raw.requireBlindHoldoutVerdict !== false,
  };
}

export function normalizeRegimeExitResearchConfig(raw = {}) {
  const budget = raw.budget ?? raw.lanes;
  const resourceBudget = raw.resourceBudget ?? raw.resource;
  const promotion = normalizePromotion(raw.promotion);
  return {
    enabled: raw.enabled === true,
    exploitEnabled: raw.exploitEnabled !== false,
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
    lanes: normalizeLaneRatios(budget),
    budget: normalizeLaneRatios(budget),
    resource: {
      maxCandidateBatchSize: Math.max(1, Math.floor(finiteNumber(resourceBudget?.maxCandidateBatchSize, 8))),
      maxConcurrentLabWorkers: Math.max(1, Math.floor(finiteNumber(resourceBudget?.maxConcurrentLabWorkers, 1))),
      maxRowsLoadedPerWorker: Math.max(100, Math.floor(finiteNumber(resourceBudget?.maxRowsLoadedPerWorker, 250000))),
      maxManifestBytes: Math.max(16384, Math.floor(finiteNumber(resourceBudget?.maxManifestBytes, 512000))),
      maxRetainedJsonlPerRun: Math.max(0, Math.floor(finiteNumber(resourceBudget?.maxRetainedJsonlPerRun, 4))),
      softLaneTimeoutMs: Math.max(1000, Math.floor(finiteNumber(resourceBudget?.softLaneTimeoutMs, 15 * 60 * 1000))),
      hardWorkerTimeoutMs: Math.max(1000, Math.floor(finiteNumber(resourceBudget?.hardWorkerTimeoutMs, 5 * 60 * 1000))),
      maxWorkerOldSpaceMb: Math.max(64, Math.floor(finiteNumber(resourceBudget?.maxWorkerOldSpaceMb, 512))),
    },
    resourceBudget: {
      maxConcurrentLabWorkers: Math.max(1, Math.floor(finiteNumber(resourceBudget?.maxConcurrentLabWorkers, 1))),
      maxRowsPerAnalysisChunk: Math.max(100, Math.floor(finiteNumber(resourceBudget?.maxRowsPerAnalysisChunk, 5000))),
      maxRetainedCandidatesPerLane: Math.max(1, Math.floor(finiteNumber(resourceBudget?.maxRetainedCandidatesPerLane, 25))),
      writeFullDebugArtifacts: resourceBudget?.writeFullDebugArtifacts === true,
    },
    objective: {
      minRoiPct: finiteNumber(raw.objective?.minRoiPct, 25),
      minExpectancyDelta: finiteNumber(raw.objective?.minExpectancyDelta, 0),
      maxDrawdownDeltaPct: finiteNumber(raw.objective?.maxDrawdownDeltaPct, 0.75),
      minTradeRatioVsIncumbent: finiteNumber(raw.objective?.minTradeRatioVsIncumbent, 0.8),
      multipleTestingPenaltyBase: finiteNumber(raw.objective?.multipleTestingPenaltyBase, 0.25),
      multipleTestingPenaltyStep: finiteNumber(raw.objective?.multipleTestingPenaltyStep, 0.05),
    },
    promotion,
  };
}

export function isRegimeExitResearchEnabled(config = {}) {
  return config?.enabled === true;
}
