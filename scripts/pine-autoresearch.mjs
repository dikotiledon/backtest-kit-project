import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { analyzeJsonlFile } from './lib/pine-optimizer.mjs';
import {
  appendPromotionQueueEvent,
  buildPromotionQueueItem,
  promotionQueuePath,
  readPromotionQueue,
  selectNextPendingPromotion,
} from './lib/pine-promotion-queue.mjs';
import { classifyPromotionHoldReason, isForceablePromotionStatus, PROMOTION_STATUS } from './lib/pine-promotion-status.mjs';
import { applyPatchPlan, buildPatchPlan } from './lib/pine-tuner.mjs';
import { buildIncumbentSearchBatch, normalizeTabuFingerprintSet } from './lib/pine-search-policy.mjs';
import { detectEntryParameterInvariance } from './lib/pine-entry-invariance.mjs';
import { buildTrackCandidateBatch } from './lib/pine-track-generators.mjs';
import {
  appendJsonl,
  assessManifestPromotionReadiness,
  buildParetoShortlist,
  classifyHoldoutGate,
  computeSweepOffset,
  configFingerprint,
  decideAutoPromotionAction,
  decideAutoresearchOutcome,
  decideMatrixPromotion,
  isoNow,
  partitionLabs,
  planArtifactPrune,
  readJson,
  readJsonl,
  renderDigestMarkdown,
  renderHistoryMarkdown,
  renderScoutMarkdown,
  sameConfig,
  selectChampionBootstrapSource,
  selectRobustMatrixCandidate,
  summarizeDigestAnnouncement,
  summarizeResult,
  timestampId,
  writeJson,
  writeText,
  buildRegimeAnalysisArtifact,
  summarizeSideMetrics,
} from './lib/pine-autoresearch.mjs';
export { isManifestPromotionReady } from './lib/pine-autoresearch.mjs';
import { stagePinnedDatasetForLab, validatePinnedCacheComplete } from './lib/pine-dataset.mjs';
import { buildOfflineDataPlan, summarizeOfflineDataPlan } from './lib/pine-offline-data-plan.mjs';
import {
  acquireAutoresearchLock,
  releaseAutoresearchLock,
} from './lib/pine-autoresearch-lock.mjs';
import {
  beginAutoresearchRunArtifact,
  finalizeAutoresearchManifest,
  markAutoresearchRunIncompleteUnlessManifestExists,
  validateLatestManifestPointer,
  findOrphanEvaluationRuns,
} from './lib/pine-autoresearch-artifacts.mjs';
import {
  buildNoveltySignature,
  nextTrackState,
  normalizeResearchTracks,
  pruneTabuFingerprints,
  readSchedulerState,
  resolveSchedulerStatePath,
  selectActiveTrack,
  summarizeTopCandidateSimilarity,
  writeSchedulerState,
} from './lib/pine-autoresearch-tracks.mjs';
import { buildCandidateFamilyKey, summarizePromotionLineage } from './lib/pine-autoresearch-lineage.mjs';
import { normalizeRegimeExitResearchConfig } from './lib/pine-regime-exit-config.mjs';
import {
  allocateRegimeExitLaneBudget,
  nextLaneBudgetDebt,
  resolveExhaustedResearchLanes,
  selectNextResearchLane,
} from './lib/pine-regime-exit-scheduler.mjs';
import { buildExitFamilyCandidates } from './lib/pine-exit-generators.mjs';
import { buildLanePatchFingerprint, collectTestedLanePatchFingerprints } from './lib/pine-lane-novelty.mjs';
import {
  buildChampionConfigFingerprint,
  buildGlobalMutationBatch,
  buildGlobalPatchFingerprint,
} from './lib/pine-global-search.mjs';

const DEFAULT_REGIME_EXIT_STATE = {
  enabled: false,
  researchBudgetMode: null,
  resourceBudget: null,
  resourceUsageSummary: null,
  checkpointState: null,
  objectiveBreakdown: null,
  multipleTestingPenalty: null,
  holdoutVerdict: null,
  offlineDataSummary: null,
  shadowRegimeScoreboard: null,
};

function resolveRegimeLaneEnabled(regimeConfig = {}) {
  const lanes = regimeConfig.lanes || regimeConfig.budget || {};
  const ratioEnabled = (key) => !Number.isFinite(Number(lanes[key])) || Number(lanes[key]) > 0;
  return {
    exploit: regimeConfig.exploitEnabled !== false && ratioEnabled('exploitRatio'),
    exitRegime: regimeConfig.exitRegimeEnabled !== false && ratioEnabled('exitRegimeRatio'),
    globalAllParameter: regimeConfig.globalAllParameterEnabled !== false && ratioEnabled('globalAllParameterRatio'),
    robustness: regimeConfig.robustnessLadderEnabled !== false && ratioEnabled('robustnessRatio'),
  };
}

function enabledLaneKeys(lanesEnabled = {}) {
  return ['exploit', 'exitRegime', 'globalAllParameter', 'robustness']
    .filter((lane) => lanesEnabled[lane] !== false);
}

const REGIME_BUDGET_LANES = ['exploit', 'exitRegime', 'globalAllParameter', 'robustness'];

function applyEnabledLanesToBudgetAllocation(allocation = {}, lanesEnabled = {}) {
  return Object.fromEntries(REGIME_BUDGET_LANES.map((lane) => [
    lane,
    lanesEnabled[lane] === false ? 0 : allocation?.[lane],
  ]));
}

export function resolveConsumedBudgetLane({ searchBatch = [], selectedLane = null } = {}) {
  if (!Array.isArray(searchBatch) || searchBatch.length === 0) return null;
  const consumedBudgetLanes = new Set(searchBatch
    .map((variant) => variant?.lane)
    .filter((lane) => REGIME_BUDGET_LANES.includes(lane)));
  if (selectedLane && consumedBudgetLanes.has(selectedLane)) return selectedLane;
  if (consumedBudgetLanes.size === 1) return [...consumedBudgetLanes][0];
  return null;
}

export function resolveLaneBudgetDebtAdvance({ config = {}, schedulerState = {}, selectedLane = null } = {}) {
  if (config.regimeExitResearch?.enabled !== true) {
    return { budgetDebt: null, advanced: false };
  }
  if (!selectedLane) {
    return { budgetDebt: schedulerState?.budgetDebt ?? null, advanced: false };
  }
  const rawLaneBudgetAllocation = allocateRegimeExitLaneBudget({
    maxConfigs: config.maxConfigs,
    lanes: config.regimeExitResearch?.lanes,
  });
  const laneBudgetAllocation = applyEnabledLanesToBudgetAllocation(
    rawLaneBudgetAllocation,
    resolveRegimeLaneEnabled(config.regimeExitResearch || {}),
  );
  return {
    budgetDebt: nextLaneBudgetDebt({
      currentDebt: schedulerState?.budgetDebt || {},
      allocation: laneBudgetAllocation,
      selectedLane,
    }),
    advanced: true,
  };
}

function isGeneratedNoveltyLane(lane) {
  return lane === 'globalAllParameter' || lane === 'exitRegime';
}

export function generatedLaneExhaustionReason(lane) {
  if (lane === 'globalAllParameter') return 'global-all-parameter-exhausted';
  if (lane === 'exitRegime') return 'exit-regime-exhausted';
  return 'generated-lane-exhausted';
}

function generatedLaneExhaustionSummary(lane) {
  if (lane === 'globalAllParameter') return 'Hold: globalAllParameter novel patch space exhausted for current champion.';
  if (lane === 'exitRegime') return 'Hold: exitRegime novel patch space exhausted for current champion.';
  return 'Hold: generated lane novel patch space exhausted for current champion.';
}

function generatedLaneStagnationReason(lane) {
  if (lane === 'globalAllParameter') return 'globalAllParameterExhausted';
  if (lane === 'exitRegime') return 'exitRegimeExhausted';
  return 'generatedLaneExhausted';
}

export function buildRegimeAwareSearchBatch({
  selectedLane,
  champion,
  maxConfigs,
  historyEvents = [],
  policy = {},
  schedulerState = {},
  regimeExitResearch = {},
} = {}) {
  const safeMaxConfigs = Math.max(0, Math.floor(Number(maxConfigs) || 0));
  if (!champion || safeMaxConfigs <= 0) return [];

  if (regimeExitResearch?.enabled === true && selectedLane === 'exitRegime') {
    const testedPatchFingerprints = collectTestedLanePatchFingerprints({
      champion,
      lane: 'exitRegime',
      historyEvents,
      manifests: policy?.recentManifestsForNovelty || [],
    });
    const candidates = buildExitFamilyCandidates({
      champion,
      maxConfigs: safeMaxConfigs,
      historyEvents,
      schedulerState,
      policy,
      testedPatchFingerprints,
    });
    return (Array.isArray(candidates) ? candidates : []).slice(0, safeMaxConfigs).map((candidate, index) => ({
      ...candidate,
      lane: 'exitRegime',
      family: candidate.family || 'exit',
      variantId: candidate.variantId || `exit-regime-${String(index + 1).padStart(2, '0')}`,
      index,
    }));
  }

  if (regimeExitResearch?.enabled === true && selectedLane === 'globalAllParameter') {
    const testedPatchFingerprints = collectTestedGlobalPatchFingerprints({
      champion,
      historyEvents,
      manifests: policy?.recentManifestsForNovelty || [],
    });
    const candidates = buildGlobalMutationBatch({
      champion,
      maxConfigs: safeMaxConfigs,
      historyEvents,
      schedulerState,
      policy,
      testedPatchFingerprints,
      variantsPerFamily: policy?.globalAllParameterVariantsPerFamily
        ?? schedulerState?.globalAllParameterVariantsPerFamily
        ?? 4,
    });
    return (Array.isArray(candidates) ? candidates : []).slice(0, safeMaxConfigs).map((candidate, index) => ({
      ...candidate,
      lane: 'globalAllParameter',
      family: candidate.family || 'global',
      variantId: candidate.variantId || `global-all-${String(index + 1).padStart(2, '0')}`,
      index,
      patchFingerprint: candidate.patchFingerprint ?? candidate.metadata?.patchFingerprint ?? null,
    }));
  }

  return buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: safeMaxConfigs,
    historyEvents,
    policy,
    schedulerState,
  });
}

function summarizeRegimeLaneGenerator({
  selectedLane,
  searchBatch = [],
  championState = null,
  historyEvents = [],
  testedPatchFingerprints = null,
  recentManifestsForNovelty = [],
  maxNovelCandidates = null,
} = {}) {
  const generatedForLane = Array.isArray(searchBatch)
    ? searchBatch.filter((variant) => variant?.lane === selectedLane)
    : [];
  const knownFingerprints = testedPatchFingerprints instanceof Set
    ? testedPatchFingerprints
    : Array.isArray(testedPatchFingerprints)
      ? new Set(testedPatchFingerprints.filter(Boolean))
      : selectedLane === 'exitRegime'
        ? collectTestedLanePatchFingerprints({
            champion: championState,
            lane: 'exitRegime',
            historyEvents,
            manifests: recentManifestsForNovelty,
          })
        : selectedLane === 'globalAllParameter'
          ? collectTestedGlobalPatchFingerprints({
              champion: championState,
              historyEvents,
              manifests: recentManifestsForNovelty,
            })
          : new Set();
  const exhausted = isGeneratedNoveltyLane(selectedLane)
    && generatedForLane.length === 0
    && knownFingerprints.size > 0;

  return {
    lane: selectedLane || null,
    laneKind: selectedLane || null,
    candidateCount: generatedForLane.length,
    previewOnly: exhausted ? false : generatedForLane.length === 0,
    countSource: exhausted ? 'exhausted' : (generatedForLane.length > 0 ? 'generatedVariants' : 'none'),
    blockedFamilyCount: null,
    exhausted,
    testedPatchFingerprintCount: knownFingerprints.size,
    maxNovelCandidates,
    variantIds: generatedForLane.map((variant) => variant.variantId).filter(Boolean).slice(0, 20),
    patchFingerprints: generatedForLane.map((variant) => variant.patchFingerprint).filter(Boolean).slice(0, 20),
  };
}

export function buildRegimeExitStateForScout({
  config,
  championState,
  historyEventsBefore = [],
  searchBatch = [],
  offlineDataSummary = null,
  schedulerState = {},
  regimeExitContext = {},
} = {}) {
  if (!config?.regimeExitResearch?.enabled) return null;

  const regimeConfig = config.regimeExitResearch || {};
  const resourceConfig = regimeConfig.resource || {};
  const objectiveConfig = regimeConfig.objective || {};
  const laneBudgetAllocation = allocateRegimeExitLaneBudget({
    maxConfigs: config.maxConfigs,
    lanes: regimeConfig.lanes,
  });
  const lanesEnabled = resolveRegimeLaneEnabled(regimeConfig);
  const championConfigFingerprint = championState?.config
    ? buildChampionConfigFingerprint(championState.config)
    : null;
  const exhaustedLanes = resolveExhaustedResearchLanes({
    schedulerState,
    championConfigFingerprint,
  });
  const selectedLane = selectNextResearchLane({
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    budgetDebt: schedulerState?.budgetDebt || {},
    lanesEnabled,
    schedulerState,
    championConfigFingerprint,
  });
  const enabledLanes = enabledLaneKeys(lanesEnabled);
  const noLaneReason = selectedLane
    ? null
    : enabledLanes.length === 0
      ? 'no-enabled-lanes'
      : enabledLanes.every((lane) => exhaustedLanes.includes(lane))
        ? 'all-enabled-lanes-exhausted'
        : 'no-enabled-non-exhausted-lane';

  const generatorSummary = summarizeRegimeLaneGenerator({
    selectedLane,
    championState,
    config,
    searchBatch,
    historyEvents: historyEventsBefore,
    recentManifestsForNovelty: regimeExitContext?.recentManifestsForNovelty || [],
    testedPatchFingerprints: regimeExitContext?.testedPatchFingerprints || null,
    maxNovelCandidates: config?.maxConfigs ?? null,
  });

  const mode = regimeConfig.offline?.mode || null;
  const compactOfflineDataSummary = offlineDataSummary
    ? {
        ok: offlineDataSummary.ok === true,
        mode: offlineDataSummary.mode || mode,
        requiredLabCount: Array.isArray(offlineDataSummary.requiredLabs) ? offlineDataSummary.requiredLabs.length : undefined,
        missingLabCount: Array.isArray(offlineDataSummary.missingLabs) ? offlineDataSummary.missingLabs.length : undefined,
      }
    : mode
      ? { ok: null, mode }
      : null;

  return {
    enabled: true,
    researchBudgetMode: 'regime-exit',
    resourceBudget: {
      maxConcurrentLabWorkers: Math.max(1, Number(resourceConfig.maxConcurrentLabWorkers) || 1),
      maxCandidateBatchSize: Math.max(1, Number(resourceConfig.maxCandidateBatchSize) || 1),
      maxRowsLoadedPerWorker: Math.max(100, Number(resourceConfig.maxRowsLoadedPerWorker) || 100),
    },
    resourceUsageSummary: {
      configuredWorkerModel: regimeConfig.childWorkerIsolationEnabled === false ? 'shared' : 'isolated',
      workerModelSource: 'configured',
      configuredStreamingMetricsEnabled: regimeConfig.streamingMetricsEnabled !== false,
      streamingMetricsSource: 'configured',
      searchBatchSize: Array.isArray(searchBatch) ? searchBatch.length : 0,
    },
    checkpointState: {
      historyEventCount: Array.isArray(historyEventsBefore) ? historyEventsBefore.length : 0,
      schedulerStagnationLevel: schedulerState?.stagnationLevel ?? 0,
    },
    objectiveBreakdown: {
      minRoiPct: objectiveConfig.minRoiPct ?? null,
      minExpectancyDelta: objectiveConfig.minExpectancyDelta ?? null,
      maxDrawdownDeltaPct: objectiveConfig.maxDrawdownDeltaPct ?? null,
      minTradeRatioVsIncumbent: objectiveConfig.minTradeRatioVsIncumbent ?? null,
    },
    multipleTestingPenalty: {
      base: objectiveConfig.multipleTestingPenaltyBase ?? null,
      step: objectiveConfig.multipleTestingPenaltyStep ?? null,
    },
    holdoutVerdict: null,
    offlineDataSummary: compactOfflineDataSummary,
    shadowRegimeScoreboard: {
      selectedLane,
      laneBudgetAllocation,
      generatorSummary,
      stagnationLevel: schedulerState?.stagnationLevel ?? 0,
      championConfigFingerprint,
      exhaustedLanes,
      enabledLanes,
      noLaneReason,
    },
  };
}

export function shouldSkipGeneratedLaneSweep({ regimeExitState, searchBatch = [] } = {}) {
  const scoreboard = regimeExitState?.shadowRegimeScoreboard;
  const generatorSummary = scoreboard?.generatorSummary;
  return regimeExitState?.enabled === true
    && isGeneratedNoveltyLane(scoreboard?.selectedLane)
    && Array.isArray(searchBatch)
    && searchBatch.length === 0
    && generatorSummary?.exhausted === true
    && generatorSummary?.countSource === 'exhausted';
}

export function shouldSkipGlobalAllParameterSweep({ regimeExitState, searchBatch = [] } = {}) {
  const scoreboard = regimeExitState?.shadowRegimeScoreboard;
  return scoreboard?.selectedLane === 'globalAllParameter'
    && shouldSkipGeneratedLaneSweep({ regimeExitState, searchBatch });
}

function shouldSkipNoRegimeResearchLane({ regimeExitState } = {}) {
  const scoreboard = regimeExitState?.shadowRegimeScoreboard;
  return regimeExitState?.enabled === true
    && scoreboard?.selectedLane == null
    && typeof scoreboard?.noLaneReason === 'string'
    && scoreboard.noLaneReason.length > 0;
}

function resolveNoLaneFallbackReason({ lanesEnabled = {}, exhaustedLanes = [] } = {}) {
  const enabledLanes = enabledLaneKeys(lanesEnabled);
  if (enabledLanes.length === 0) return 'no-enabled-lanes';
  return enabledLanes.every((lane) => exhaustedLanes.includes(lane))
    ? 'all-enabled-lanes-exhausted'
    : 'no-enabled-non-exhausted-lane';
}

function recordResearchLaneExhaustion({
  state = {},
  lane,
  championConfigFingerprint,
  exhaustedAt,
  runId,
  reason,
  stagnationLevel = 0,
  budgetDebt = {},
  lanesEnabled = {},
} = {}) {
  if (!lane || !championConfigFingerprint) return state;
  const base = clone(state || {});
  const laneExhaustions = {
    ...(base.laneExhaustions || {}),
    [championConfigFingerprint]: {
      ...(base.laneExhaustions?.[championConfigFingerprint] || {}),
    },
  };
  const provisional = {
    lane,
    championConfigFingerprint,
    exhaustedAt: exhaustedAt ?? null,
    runId: runId ?? null,
    reason: reason ?? 'lane-exhausted',
  };
  laneExhaustions[championConfigFingerprint][lane] = provisional;
  const nextState = { ...base, laneExhaustions };
  const nextSelectedLane = selectNextResearchLane({
    stagnationLevel,
    budgetDebt,
    lanesEnabled,
    schedulerState: nextState,
    championConfigFingerprint,
  });
  const exhaustedLanes = resolveExhaustedResearchLanes({ schedulerState: nextState, championConfigFingerprint });
  const entry = {
    ...provisional,
    nextSelectedLane: nextSelectedLane ?? null,
    fallbackReason: nextSelectedLane ? null : resolveNoLaneFallbackReason({ lanesEnabled, exhaustedLanes }),
  };
  laneExhaustions[championConfigFingerprint][lane] = entry;
  return {
    ...nextState,
    lastLaneExhaustion: entry,
  };
}

export function buildGlobalAllParameterExhaustedManifest({
  config = {},
  runId,
  championState,
  regimeExitState = {},
  schedulerState = {},
  trackState = {},
  entryInvariance = null,
} = {}) {
  const championSummary = summarizeResult(championState);
  const normalizedRegimeExitState = { ...DEFAULT_REGIME_EXIT_STATE, ...(regimeExitState || {}) };
  const exhaustedLane = normalizedRegimeExitState.shadowRegimeScoreboard?.selectedLane || 'globalAllParameter';
  const exhaustionReason = generatedLaneExhaustionReason(exhaustedLane);
  const generatedAt = isoNow();

  return {
    generatedAt,
    matrixId: config.matrixId,
    runId,
    profile: config.selectedProfile,
    primaryLab: config.primaryLab ?? null,
    shadowLabs: config.shadowLabs ?? [],
    blindHoldoutLabs: config.blindHoldoutLabs ?? [],
    incumbent: championSummary,
    champion: championSummary,
    challenger: championSummary,
    primarySweep: null,
    searchPlan: {
      mode: config.searchPolicy?.mode ?? null,
      exploitRatio: config.searchPolicy?.exploitRatio ?? null,
      variantCount: 0,
      variants: [],
    },
    paretoShortlist: [],
    matrixCandidates: [],
    labResults: [],
    matrixDecision: {
      recommendation: 'hold',
      reason: exhaustionReason,
      summary: generatedLaneExhaustionSummary(exhaustedLane),
    },
    entryInvariance,
    researchState: {
      steadyState: true,
      noChangeStreak: Number(schedulerState?.noChangeStreak ?? 0) + 1,
    },
    noNewCandidate: true,
    noNewCandidateStreak: Number(schedulerState?.noNewCandidateStreak ?? 0) + 1,
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    stagnationReason: generatedLaneStagnationReason(exhaustedLane),
    globalNoveltyGuardVersion: 1,
    activeTrackId: trackState.activeTrackId ?? null,
    windowSetId: trackState.windowSetId ?? null,
    noveltySignature: trackState.noveltySignature ?? null,
    rotationTrigger: trackState.rotationTrigger ?? null,
    rotationReason: trackState.rotationReason ?? exhaustionReason,
    sameTrackCycleStreak: trackState.sameTrackCycleStreak ?? 0,
    topCandidateSimilarity: null,
    promotionEligible: false,
    promotionEligibleReason: exhaustionReason,
    candidateFingerprint: trackState.candidateFingerprint ?? null,
    rejectedCandidateFingerprint: null,
    championFingerprint: trackState.championFingerprint ?? null,
    labSetId: trackState.labSetId ?? null,
    gridName: trackState.gridName ?? config.grid ?? null,
    researchBudgetMode: normalizedRegimeExitState.researchBudgetMode ?? 'regime-exit',
    resourceBudget: normalizedRegimeExitState.resourceBudget ?? null,
    resourceUsageSummary: normalizedRegimeExitState.resourceUsageSummary ?? null,
    checkpointState: normalizedRegimeExitState.checkpointState ?? null,
    objectiveBreakdown: normalizedRegimeExitState.objectiveBreakdown ?? null,
    multipleTestingPenalty: normalizedRegimeExitState.multipleTestingPenalty ?? null,
    holdoutVerdict: normalizedRegimeExitState.holdoutVerdict ?? null,
    offlineDataSummary: normalizedRegimeExitState.offlineDataSummary ?? null,
    shadowRegimeScoreboard: normalizedRegimeExitState.shadowRegimeScoreboard ?? null,
  };
}

export function buildOfflineDataMissingManifest({
  config = {},
  runId,
  championState,
  offlineDataSummary = null,
  entryInvariance = null,
} = {}) {
  const championSummary = summarizeResult(championState);
  const generatedAt = isoNow();

  return {
    generatedAt,
    matrixId: config.matrixId,
    runId,
    profile: config.selectedProfile,
    primaryLab: config.primaryLab ?? null,
    shadowLabs: config.shadowLabs ?? [],
    blindHoldoutLabs: config.blindHoldoutLabs ?? [],
    incumbent: championSummary,
    champion: championSummary,
    challenger: championSummary,
    primarySweep: null,
    searchPlan: {
      mode: config.searchPolicy?.mode ?? null,
      exploitRatio: config.searchPolicy?.exploitRatio ?? null,
      variantCount: 0,
      variants: [],
    },
    paretoShortlist: [],
    matrixCandidates: [],
    labResults: [],
    matrixDecision: {
      recommendation: 'hold',
      reason: 'offlineDataMissing',
      summary: 'Hold: required offline data is missing for offline-strict autoresearch.',
    },
    entryInvariance,
    researchState: {
      steadyState: true,
      noChangeStreak: 0,
    },
    noNewCandidate: true,
    noNewCandidateStreak: 0,
    stagnationLevel: 0,
    stagnationReason: 'offlineDataMissing',
    globalNoveltyGuardVersion: config.regimeExitResearch?.enabled ? 1 : null,
    activeTrackId: null,
    windowSetId: null,
    noveltySignature: null,
    rotationTrigger: null,
    rotationReason: 'offlineDataMissing',
    sameTrackCycleStreak: 0,
    topCandidateSimilarity: null,
    promotionEligible: false,
    promotionEligibleReason: 'offlineDataMissing',
    candidateFingerprint: championState?.config ? configFingerprint(championState.config) : null,
    rejectedCandidateFingerprint: null,
    championFingerprint: championState?.config ? configFingerprint(championState.config) : null,
    labSetId: null,
    gridName: config.grid ?? null,
    researchBudgetMode: config.regimeExitResearch?.enabled ? 'regime-exit' : null,
    resourceBudget: null,
    resourceUsageSummary: null,
    checkpointState: null,
    objectiveBreakdown: null,
    multipleTestingPenalty: null,
    holdoutVerdict: null,
    offlineDataSummary,
    shadowRegimeScoreboard: null,
  };
}

export function buildNoRegimeResearchLaneManifest({
  config = {},
  runId,
  championState,
  regimeExitState = {},
  schedulerState = {},
  trackState = {},
  entryInvariance = null,
} = {}) {
  const championSummary = summarizeResult(championState);
  const normalizedRegimeExitState = { ...DEFAULT_REGIME_EXIT_STATE, ...(regimeExitState || {}) };
  const generatedAt = isoNow();
  const noLaneReason = normalizedRegimeExitState.shadowRegimeScoreboard?.noLaneReason ?? 'no-enabled-non-exhausted-lane';

  return {
    generatedAt,
    matrixId: config.matrixId,
    runId,
    profile: config.selectedProfile,
    primaryLab: config.primaryLab ?? null,
    shadowLabs: config.shadowLabs ?? [],
    blindHoldoutLabs: config.blindHoldoutLabs ?? [],
    incumbent: championSummary,
    champion: championSummary,
    challenger: championSummary,
    primarySweep: null,
    searchPlan: {
      mode: config.searchPolicy?.mode ?? null,
      exploitRatio: config.searchPolicy?.exploitRatio ?? null,
      variantCount: 0,
      variants: [],
    },
    paretoShortlist: [],
    matrixCandidates: [],
    labResults: [],
    matrixDecision: {
      recommendation: 'hold',
      reason: 'no-regime-research-lane',
      summary: `Hold: no enabled non-exhausted regime research lane is available (${noLaneReason}).`,
    },
    entryInvariance,
    researchState: {
      steadyState: true,
      noChangeStreak: Number(schedulerState?.noChangeStreak ?? 0) + 1,
    },
    noNewCandidate: true,
    noNewCandidateStreak: Number(schedulerState?.noNewCandidateStreak ?? 0) + 1,
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    stagnationReason: 'noRegimeResearchLane',
    globalNoveltyGuardVersion: 1,
    activeTrackId: trackState.activeTrackId ?? null,
    windowSetId: trackState.windowSetId ?? null,
    noveltySignature: trackState.noveltySignature ?? null,
    rotationTrigger: trackState.rotationTrigger ?? null,
    rotationReason: trackState.rotationReason ?? 'no-regime-research-lane',
    sameTrackCycleStreak: trackState.sameTrackCycleStreak ?? 0,
    topCandidateSimilarity: null,
    promotionEligible: false,
    promotionEligibleReason: 'no-regime-research-lane',
    candidateFingerprint: trackState.candidateFingerprint ?? null,
    rejectedCandidateFingerprint: null,
    championFingerprint: trackState.championFingerprint ?? null,
    labSetId: trackState.labSetId ?? null,
    gridName: trackState.gridName ?? config.grid ?? null,
    researchBudgetMode: normalizedRegimeExitState.researchBudgetMode ?? 'regime-exit',
    resourceBudget: normalizedRegimeExitState.resourceBudget ?? null,
    resourceUsageSummary: normalizedRegimeExitState.resourceUsageSummary ?? null,
    checkpointState: normalizedRegimeExitState.checkpointState ?? null,
    objectiveBreakdown: normalizedRegimeExitState.objectiveBreakdown ?? null,
    multipleTestingPenalty: normalizedRegimeExitState.multipleTestingPenalty ?? null,
    holdoutVerdict: normalizedRegimeExitState.holdoutVerdict ?? null,
    offlineDataSummary: normalizedRegimeExitState.offlineDataSummary ?? null,
    shadowRegimeScoreboard: normalizedRegimeExitState.shadowRegimeScoreboard ?? null,
  };
}

export function buildGlobalAllParameterExhaustedSchedulerManifestInput({
  manifest = {},
  championState = {},
  trackState = {},
} = {}) {
  const championFingerprint = trackState.championFingerprint
    ?? (championState?.config ? configFingerprint(championState.config) : manifest.championFingerprint ?? null);
  const candidateFingerprint = trackState.candidateFingerprint ?? championFingerprint;
  return {
    activeTrackId: manifest.activeTrackId ?? trackState.activeTrackId ?? null,
    candidateFingerprint,
    rejectedCandidateFingerprint: null,
    championFingerprint,
    noveltySignature: manifest.noveltySignature ?? trackState.noveltySignature ?? null,
    topCandidateSimilarity: null,
    rotationTrigger: manifest.rotationTrigger ?? trackState.rotationTrigger ?? null,
    rotationReason: manifest.rotationReason ?? trackState.rotationReason ?? manifest.matrixDecision?.reason ?? 'global-all-parameter-exhausted',
    sameTrackCycleStreak: manifest.sameTrackCycleStreak ?? trackState.sameTrackCycleStreak ?? 0,
    promotionEligible: false,
    promotionEligibleReason: manifest.promotionEligibleReason ?? manifest.matrixDecision?.reason ?? 'global-all-parameter-exhausted',
    noNewCandidate: true,
    stagnationLevel: manifest.stagnationLevel ?? 0,
    stagnationReason: manifest.stagnationReason ?? 'globalAllParameterExhausted',
    lastEscalatedAt: manifest.lastEscalatedAt ?? null,
    generatedAt: manifest.generatedAt,
    windowSetId: manifest.windowSetId ?? trackState.windowSetId ?? null,
    labSetId: manifest.labSetId ?? trackState.labSetId ?? null,
    gridName: manifest.gridName ?? trackState.gridName ?? null,
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function isHelpRequest(argv = []) {
  return argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}

function formatAutoresearchHelp() {
  return [
    'Usage: node scripts/pine-autoresearch.mjs <command> [options]',
    '',
    'Commands:',
    '  cycle        Run scout/autoresearch cycle (default)',
    '  scout        Alias for cycle',
    '  digest       Write digest from latest manifest',
    '  promote      Promote queued manifest when gates pass',
    '  autopromote  Evaluate promotion queue',
    '',
    'Options:',
    '  --config <path>       Config file path',
    '  --profile <name>      Profile name',
    '  --force-cycle         Ignore cycle cadence guard',
    '  --force               Operator force for explicitly forceable queue holds only',
    '  --help, -h            Print this help before operational setup',
  ].join('\n');
}

function resolveMaybeRelative(baseDir, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function slug(value) {
  return String(value || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function changedConfigKeys(before = {}, after = {}) {
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function normalizeTouchedKeyList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function summarizeChallengerSignalMetrics(challenger = {}) {
  return {
    configId: challenger?.configId ?? null,
    tradeCount: Number.isFinite(Number(challenger?.tradeCount)) ? Number(challenger.tradeCount) : null,
    winRatePct: Number.isFinite(Number(challenger?.winRatePct)) ? Number(challenger.winRatePct) : null,
    maxDrawdownPct: Number.isFinite(Number(challenger?.maxDrawdownPct)) ? Number(challenger.maxDrawdownPct) : null,
  };
}

export function entryInvarianceCycleFromManifest(manifest = {}) {
  const configDeltaKeys = changedConfigKeys(manifest?.champion?.config ?? manifest?.incumbent?.config, manifest?.challenger?.config);
  const variantPatchKeys = (Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [])
    .flatMap((variant) => [
      ...normalizeTouchedKeyList(variant?.touchedKeys),
      ...Object.keys(variant?.patch || {}),
    ]);
  const touchedKeys = [...new Set([...configDeltaKeys, ...variantPatchKeys])];
  return {
    touchedKeys,
    challenger: summarizeChallengerSignalMetrics(manifest?.challenger || {}),
  };
}

function entryInvarianceCycleFromHistoryEvent(event = {}) {
  return {
    touchedKeys: normalizeTouchedKeyList(event?.touchedKeys),
    challenger: event?.challenger || {
      tradeCount: event?.challengerTradeCount,
      winRatePct: event?.challengerWinRatePct,
      maxDrawdownPct: event?.challengerMaxDrawdownPct,
    },
  };
}

function buildEntryInvarianceRecentCycles({ historyEvents = [], manifests = [] } = {}) {
  const manifestCycles = (Array.isArray(manifests) ? manifests : [])
    .filter((manifest) => manifest && typeof manifest === 'object')
    .map((manifest) => entryInvarianceCycleFromManifest(manifest));
  if (manifestCycles.length) return manifestCycles;
  return (Array.isArray(historyEvents) ? historyEvents : [])
    .filter((event) => event?.type === 'cycle')
    .map((event) => entryInvarianceCycleFromHistoryEvent(event));
}

function buildEntryInvarianceVerdict({ historyEvents = [], manifests = [], policy = {} } = {}) {
  return detectEntryParameterInvariance({
    recentCycles: buildEntryInvarianceRecentCycles({ historyEvents, manifests }),
    policy,
  });
}

function buildForcedEntryMutationPolicy(searchPolicy = {}, entryInvariance = {}) {
  if (entryInvariance?.flagged !== true) return searchPolicy;
  return {
    ...searchPolicy,
    mode: 'force-entry-mutation',
    reason: 'exit_only_drift',
    allowArchitectureKeys: false,
    requiredTouchedKeys: entryInvariance.untouchedEntryKeys || [],
  };
}

function variantTouchesAnyKey(variant = {}, keys = []) {
  const required = new Set(normalizeTouchedKeyList(keys));
  if (!required.size) return false;
  const touched = [
    ...normalizeTouchedKeyList(variant?.touchedKeys),
    ...Object.keys(variant?.patch || {}),
  ];
  return touched.some((key) => required.has(key));
}

function filterPatchToKeys(patch = {}, keys = []) {
  const allowed = new Set(normalizeTouchedKeyList(keys));
  if (!allowed.size || !patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}

function forcedEntryPatchesForBatch({ championConfig, policy = {}, historyEvents = [], schedulerState = {}, requiredTouchedKeys = [] } = {}) {
  const forcedBatch = buildIncumbentSearchBatch({
    incumbent: championConfig,
    maxConfigs: Math.max(1, Math.min(8, Math.max(1, requiredTouchedKeys.length) * 2)),
    historyEvents,
    policy: {
      ...policy,
      mode: 'force-entry-mutation',
      reason: 'exit_only_drift',
      allowArchitectureKeys: false,
      requiredTouchedKeys,
      exploitRatio: 1,
    },
    schedulerState,
  });
  const seen = new Set();
  const patches = [];
  for (const forcedVariant of forcedBatch) {
    if (!variantTouchesAnyKey(forcedVariant, requiredTouchedKeys)) continue;
    const patch = filterPatchToKeys(forcedVariant?.patch, requiredTouchedKeys);
    if (!Object.keys(patch).some((key) => requiredTouchedKeys.includes(key))) continue;
    const fingerprint = configFingerprint(patch);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    patches.push(patch);
  }
  return patches;
}

function buildUpdatedGeneratedPatchFingerprint({ variant = {}, championConfig = {}, patch = {} } = {}) {
  const lane = variant?.lane ?? null;
  const mutationFamily = variant?.mutationFamily ?? variant?.family ?? null;
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig || {});
  if (lane === 'globalAllParameter' || lane === 'global-all-parameter') {
    return buildGlobalPatchFingerprint({ championConfigFingerprint, lane, mutationFamily, patch });
  }
  if (lane === 'exitRegime' || lane === 'exit-regime') {
    return buildLanePatchFingerprint({ championConfigFingerprint, lane, mutationFamily, patch });
  }
  return variant?.patchFingerprint ?? variant?.metadata?.patchFingerprint ?? null;
}

function searchVariantConfigFingerprint({ variant = {}, championConfig = {}, patch = null } = {}) {
  const config = patch
    ? { ...(championConfig || {}), ...patch }
    : (variant?.config || { ...(championConfig || {}), ...(variant?.patch || {}) });
  return configFingerprint(config);
}

function variantIsSchedulerTabu({ variant = {}, championConfig = {}, tabuSet = new Set(), patch = null } = {}) {
  return tabuSet.has(searchVariantConfigFingerprint({ variant, championConfig, patch }));
}

function filterSchedulerTabuVariants({ batch = [], championConfig = {}, schedulerState = {} } = {}) {
  const tabuSet = normalizeTabuFingerprintSet(schedulerState?.tabuRejectedFingerprints);
  if (!tabuSet.size) return batch;
  return batch.filter((variant) => !variantIsSchedulerTabu({ variant, championConfig, tabuSet }));
}

function buildEntryEnforcedVariant({ variant = {}, championConfig = {}, entryPatch = {}, requiredTouchedKeys = [] } = {}) {
  const patch = { ...(variant?.patch || {}), ...entryPatch };
  const patchFingerprint = buildUpdatedGeneratedPatchFingerprint({ variant, championConfig, patch });
  return {
    ...variant,
    patch,
    touchedKeys: [...new Set([...normalizeTouchedKeyList(variant?.touchedKeys), ...Object.keys(patch)])],
    config: { ...(championConfig || {}), ...patch },
    patchFingerprint,
    metadata: {
      ...(variant?.metadata || {}),
      forcedEntryMutation: true,
      forcedEntryMutationSource: 'entry-invariance-post-selection',
      requiredTouchedKeys,
      patchFingerprint,
    },
  };
}

export function enforceEntryInvarianceOnSearchBatch({
  searchBatch = [],
  championConfig = {},
  historyEvents = [],
  policy = {},
  schedulerState = {},
  entryInvariance = null,
} = {}) {
  const batch = Array.isArray(searchBatch) ? searchBatch : [];
  if (entryInvariance?.flagged !== true || batch.length === 0) return batch;

  const requiredTouchedKeys = normalizeTouchedKeyList(entryInvariance.untouchedEntryKeys || policy.requiredTouchedKeys || []);
  const nonTabuBatch = filterSchedulerTabuVariants({ batch, championConfig, schedulerState });
  if (!requiredTouchedKeys.length) return nonTabuBatch;
  if (nonTabuBatch.some((variant) => variantTouchesAnyKey(variant, requiredTouchedKeys))) return nonTabuBatch;

  const entryPatches = forcedEntryPatchesForBatch({
    championConfig,
    policy,
    historyEvents,
    schedulerState,
    requiredTouchedKeys,
  });
  if (!entryPatches.length) return filterSchedulerTabuVariants({ batch, championConfig, schedulerState });

  const tabuSet = normalizeTabuFingerprintSet(schedulerState?.tabuRejectedFingerprints);
  const finalBatch = [];
  let entryMutationEmitted = false;

  for (const variant of batch) {
    if (!entryMutationEmitted) {
      const enforcedVariant = entryPatches
        .map((entryPatch) => buildEntryEnforcedVariant({
          variant,
          championConfig,
          entryPatch,
          requiredTouchedKeys,
        }))
        .find((candidate) => !variantIsSchedulerTabu({ variant: candidate, championConfig, tabuSet }));
      if (!enforcedVariant) continue;
      finalBatch.push(enforcedVariant);
      entryMutationEmitted = true;
      continue;
    }

    if (!variantIsSchedulerTabu({ variant, championConfig, tabuSet })) finalBatch.push(variant);
  }

  return entryMutationEmitted ? finalBatch : [];
}

export function decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction } = {}) {
  if (!queuedItem) return { recommendation: 'hold', status: PROMOTION_STATUS.INVALID, reason: 'No pending promotion item' };
  if (!manifest) return { recommendation: 'hold', status: PROMOTION_STATUS.INVALID, reason: `Queued manifest missing for ${queuedItem.itemId}` };
  if (manifest.runId !== queuedItem.runId) return { recommendation: 'hold', status: PROMOTION_STATUS.INVALID, reason: `Manifest runId ${manifest.runId} does not match queued runId ${queuedItem.runId}` };
  if (manifest.matrixDecision?.recommendation !== 'promote') return { recommendation: 'hold', status: PROMOTION_STATUS.STALE, reason: `Queued manifest recommendation is ${manifest.matrixDecision?.recommendation || 'unknown'}` };
  if (!manifest.challenger?.config) return { recommendation: 'hold', status: PROMOTION_STATUS.INVALID, reason: 'Queued manifest has no challenger config' };
  if (sameConfig(championState?.config, manifest.challenger.config)) return { recommendation: 'hold', status: PROMOTION_STATUS.STALE, reason: `Champion already matches ${manifest.challenger.configId}` };
  const currentChampionFingerprint = championState?.configFingerprint || configFingerprint(championState?.config || {});
  if (!queuedItem.championFingerprintAtDecision) return { recommendation: 'hold', status: PROMOTION_STATUS.STALE, reason: 'Queued champion fingerprint missing at decision' };
  if (currentChampionFingerprint !== queuedItem.championFingerprintAtDecision) return { recommendation: 'hold', status: PROMOTION_STATUS.STALE, reason: 'Current champion changed since queued decision' };
  if (queuedItem.candidateFamilyKey && manifest.candidateFamilyKey && queuedItem.candidateFamilyKey !== manifest.candidateFamilyKey) {
    return { recommendation: 'hold', status: PROMOTION_STATUS.INVALID, reason: 'Queued candidate family does not match manifest family' };
  }
  if (queuedItem.championFamilyKeyAtDecision && manifest.championFamilyKey && queuedItem.championFamilyKeyAtDecision !== manifest.championFamilyKey) {
    return { recommendation: 'hold', status: PROMOTION_STATUS.INVALID, reason: 'Queued champion family does not match manifest family' };
  }
  if (autoAction?.recommendation !== 'promote') {
    const reason = autoAction?.summary || 'Autopromote gates did not pass';
    return {
      recommendation: 'hold',
      status: classifyPromotionHoldReason(reason),
      reason,
    };
  }
  return { recommendation: 'promote', status: PROMOTION_STATUS.PROMOTED, reason: 'Queued promotion guards passed' };
}

export function canForceQueuedPromotion(queuedAction = null) {
  return isForceablePromotionStatus(queuedAction?.status);
}

export function resolveAutopromoteQueueStatus(result = {}) {
  if (result?.promoted) return PROMOTION_STATUS.PROMOTED;
  const reason = String(result?.reason || 'promotion_noop');
  if (/already matches|already promoted/i.test(reason)) return PROMOTION_STATUS.STALE;
  return PROMOTION_STATUS.QUEUE_BLOCKED;
}

async function appendAutopromoteQueueStatus(queuePath, queuedItem, result = {}) {
  await appendPromotionQueueEvent(queuePath, {
    type: 'status',
    itemId: queuedItem.itemId,
    status: resolveAutopromoteQueueStatus(result),
    reason: result.reason || 'promotion_noop',
    appliedConfigId: result.appliedConfigId ?? null,
  });
}

async function withAutoresearchLock(config, { command, profile, staleMs = 12 * 60 * 60 * 1000 }, fn) {
  const lockPath = autoresearchLockPath(config);
  const lock = await acquireAutoresearchLock({ lockPath, command, profile, staleMs });
  if (!lock.acquired) {
    return { skipped: true, reason: lock.reason || 'locked', currentOwner: lock.currentOwner };
  }

  try {
    return await fn();
  } finally {
    await releaseAutoresearchLock({ lockPath, token: lock.owner.token });
  }
}

export function autoresearchLockPath(config) {
  return path.join(config.researchRoot, 'state', 'autoresearch.lock.json');
}

export function shouldUseAutoresearchLock(command) {
  return ['cycle', 'promote', 'autopromote'].includes(command);
}

export function formatAutoresearchLockSkip(command, result = {}) {
  const reason = result.reason || 'locked';
  const owner = result.currentOwner;
  const ownerSuffix = owner
    ? ` owner=${owner.command || 'unknown'} profile=${owner.profile || 'n/a'}`
    : '';
  return `[autoresearch] ${command}=skipped reason=${reason}${ownerSuffix}`;
}

function normalizeCycleIndex(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function normalizeFingerprint(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function normalizeTabuEntries(raw, { currentCycle = 0, championFingerprint = null } = {}) {
  if (!Array.isArray(raw)) return [];
  const resolvedCycle = normalizeCycleIndex(currentCycle);
  const resolvedChampion = normalizeFingerprint(championFingerprint);
  return raw
    .map((entry) => {
      if (typeof entry === 'string') {
        const fingerprint = normalizeFingerprint(entry);
        return fingerprint
          ? { fingerprint, addedAtCycle: resolvedCycle, championFingerprint: resolvedChampion }
          : null;
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const fingerprint = normalizeFingerprint(entry.fingerprint);
      if (!fingerprint) return null;
      return {
        fingerprint,
        addedAtCycle: normalizeCycleIndex(entry.addedAtCycle, resolvedCycle),
        championFingerprint: normalizeFingerprint(entry.championFingerprint) ?? resolvedChampion,
      };
    })
    .filter(Boolean);
}

function resolveTabuMergePolicy({ policy = null, tabuLimit = 128 } = {}) {
  if (policy && typeof policy === 'object' && !Array.isArray(policy)) return policy;
  if (Number.isFinite(tabuLimit)) {
    return { maxAgeCycles: 20, maxEntries: Math.max(1, Math.floor(tabuLimit)), dropOnChampionChange: true };
  }
  return { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true };
}

export function mergeSchedulerTabuFingerprints({
  schedulerState = {},
  recentRejectedFingerprints = [],
  tabuLimit = 128,
  currentCycle = schedulerState?.cycleIndex ?? 0,
  championFingerprint = schedulerState?.lastChampionFingerprint ?? null,
  policy = null,
} = {}) {
  const cycle = normalizeCycleIndex(currentCycle);
  const champion = normalizeFingerprint(championFingerprint);
  const current = normalizeTabuEntries(schedulerState.tabuRejectedFingerprints, {
    currentCycle: cycle,
    championFingerprint: champion,
  });
  const recent = normalizeTabuEntries(recentRejectedFingerprints, {
    currentCycle: cycle,
    championFingerprint: champion,
  });
  return {
    ...schedulerState,
    tabuRejectedFingerprints: pruneTabuFingerprints({
      entries: [...current, ...recent],
      currentCycle: cycle,
      currentChampionFingerprint: champion,
      policy: resolveTabuMergePolicy({ policy, tabuLimit }),
    }),
  };
}

export function resolveTrackSelectionState({ schedulerState = {}, rotationPolicy = {}, researchTracks = [], previousCycle = null } = {}) {
  const enabledTracks = normalizeResearchTracks(researchTracks).filter((track) => track.enabled !== false);
  const noChangeStreakRotateAfter = rotationPolicy.noChangeStreakRotateAfter ?? 3;
  const similarityRotateAbove = rotationPolicy.similarityRotateAbove ?? 0.85;
  const maxCyclesPerTrack = rotationPolicy.maxCyclesPerTrack ?? 8;
  const hardRotationTrigger = (schedulerState.noChangeStreak >= noChangeStreakRotateAfter ? 'noChangeStreak' : null)
    ?? (Number.isFinite(previousCycle?.topCandidateSimilarity) && previousCycle.topCandidateSimilarity > similarityRotateAbove ? 'noveltySimilarity' : null)
    ?? (schedulerState.sameTrackCycleStreak > maxCyclesPerTrack && previousCycle?.promotionEligible === false ? 'maxCyclesPerTrack' : null);

  if (!hardRotationTrigger) {
    return { hardRotationTrigger: null, activeTrackSelectionState: schedulerState };
  }

  const currentCycleIndex = Number.isFinite(schedulerState.cycleIndex) ? schedulerState.cycleIndex : 0;
  let selectionCycleIndex = currentCycleIndex + 1;
  if (enabledTracks.length > 0 && schedulerState.activeTrackId) {
    const currentIndex = enabledTracks.findIndex((track) => track.trackId === schedulerState.activeTrackId);
    if (currentIndex >= 0) {
      const nextIndex = (currentIndex + 1) % enabledTracks.length;
      while (((selectionCycleIndex - 1) % enabledTracks.length + enabledTracks.length) % enabledTracks.length !== nextIndex) {
        selectionCycleIndex += 1;
      }
    }
  }

  return {
    hardRotationTrigger,
    activeTrackSelectionState: {
      ...schedulerState,
      activeTrackId: null,
      cycleIndex: selectionCycleIndex,
    },
  };
}

export function selectChangedMatrixCandidate({ candidates = [], championState = null } = {}) {
  const championConfig = championState?.config;
  const pool = Array.isArray(candidates) ? candidates : [];
  const changed = pool.filter((candidate) => {
    const challengerConfig = candidate?.challenger?.config;
    if (!challengerConfig) return false;
    return championConfig ? !sameConfig(championConfig, challengerConfig) : true;
  });
  return selectRobustMatrixCandidate({ candidates: changed });
}

export function buildScoutOrchestrationState({ config, runId, championState, historyEventsBefore, searchBatch, primarySweep, matrixCandidates, trackState = {}, regimeExitState = DEFAULT_REGIME_EXIT_STATE, entryInvariance = null }) {

  const championSummary = summarizeResult(championState);
  const entryInvarianceVerdict = entryInvariance ?? buildEntryInvarianceVerdict({
    historyEvents: historyEventsBefore,
    policy: config?.searchPolicy?.entryInvariance || config?.entryInvariancePolicy || {},
  });
  const paretoShortlist = buildParetoShortlist({
    champion: championSummary,
    rankedResults: primarySweep.topConfigs,
    limit: config.searchPolicy.paretoShortlistSize,
  });

  const selectedCandidate = selectChangedMatrixCandidate({ candidates: matrixCandidates, championState });
  const challengerSummary = selectedCandidate?.challenger || championSummary;
  const noNewCandidate = sameConfig(championState?.config, challengerSummary?.config);
  const labResults = selectedCandidate?.labResults || [];
  const matrixDecision = selectedCandidate?.matrixDecision || decideMatrixPromotion({
    labResults,
    policy: config.matrixPolicy,
    champion: championState,
    challenger: challengerSummary,
  });
  const steadyState = matrixDecision?.gates?.candidateChanged === false;
  const noChangeStreak = steadyState ? (countTrailingSteadyStateCycles(historyEventsBefore) + 1) : 0;
  const topCandidateSimilaritySummary = summarizeTopCandidateSimilarity({
    championConfig: championState?.config,
    candidates: (primarySweep.topConfigs || [])
      .filter((candidate) => !sameConfig(candidate?.config, championState?.config)),
  });
  const promotionEligible = trackState.promotionEligible ?? Boolean(selectedCandidate?.matrixDecision?.recommendation === 'promote');
  const holdoutGate = selectedCandidate?.holdoutGate
    ?? matrixDecision?.holdoutGate
    ?? classifyHoldoutGate({
      blindHoldoutLabs: config?.blindHoldoutLabs ?? [],
      holdoutVerdict: regimeExitState?.holdoutVerdict ?? config?.holdoutVerdict ?? selectedCandidate?.holdoutVerdict ?? null,
    });
  const promotionReady = promotionEligible && holdoutGate?.passed === true;
  const promotionEligibleReason = trackState.promotionEligibleReason ?? (
    promotionEligible
      ? selectedCandidate?.matrixDecision?.summary || 'Promotion eligible'
      : selectedCandidate?.matrixDecision?.summary || 'No promotion-eligible challenger'
  );
  const rotationTrigger = trackState.rotationTrigger ?? null;
  const rotationReason = trackState.rotationReason ?? rotationTrigger ?? null;
  const sameTrackCycleStreak = Number.isFinite(trackState.sameTrackCycleStreak) ? trackState.sameTrackCycleStreak : 0;
  const expectancyPolicy = {
    enabled: false,
    wrJumpDiagnosticThreshold: 8,
    rejectWrGainAvgWinLoss: true,
    requireExpectancyNonRegression: true,
    ...(config.expectancyPolicy || {}),
  };
  const expectancyChampion = selectedCandidate?.labResults?.[0]?.incumbent || championSummary;
  const expectancyChallenger = selectedCandidate?.labResults?.[0]?.challenger || challengerSummary;
  const expectancyGate = selectedCandidate?.labResults?.[0]?.decision?.expectancyGate || selectedCandidate?.labResults?.[0]?.decision?.expectancy || null;
  const expectancy = {
    champion: {
      winRatePct: expectancyChampion?.winRatePct ?? 0,
      avgWin: expectancyChampion?.avgWin ?? 0,
      avgLoss: expectancyChampion?.avgLoss ?? 0,
      expectancy: expectancyChampion?.expectancy ?? 0,
    },
    challenger: {
      winRatePct: expectancyChallenger?.winRatePct ?? 0,
      avgWin: expectancyChallenger?.avgWin ?? 0,
      avgLoss: expectancyChallenger?.avgLoss ?? 0,
      expectancy: expectancyChallenger?.expectancy ?? 0,
    },
    delta: {
      winRatePct: round((expectancyChallenger?.winRatePct ?? 0) - (expectancyChampion?.winRatePct ?? 0), 2),
      avgWin: round((expectancyChallenger?.avgWin ?? 0) - (expectancyChampion?.avgWin ?? 0), 2),
      avgLoss: round((expectancyChallenger?.avgLoss ?? 0) - (expectancyChampion?.avgLoss ?? 0), 2),
      expectancy: round((expectancyChallenger?.expectancy ?? 0) - (expectancyChampion?.expectancy ?? 0), 4),
    },
    gate: expectancyGate,
    wrDecompositionRequired: Boolean(expectancyGate?.diagnostics?.wrDecompositionRequired),
    policy: expectancyPolicy,
  };
  const manifestLabResults = labResults.map((item) => ({
    lab: item.lab,
    incumbent: item.incumbent,
    challenger: item.challenger,
    decision: item.decision,
  }));

  const normalizedRegimeExitState = { ...DEFAULT_REGIME_EXIT_STATE, ...(regimeExitState || {}) };
  const compactRegimeExitManifest = normalizedRegimeExitState.enabled
    ? {
        researchBudgetMode: normalizedRegimeExitState.researchBudgetMode ?? 'regime-exit',
        resourceBudget: normalizedRegimeExitState.resourceBudget ?? null,
        resourceUsageSummary: normalizedRegimeExitState.resourceUsageSummary ?? null,
        checkpointState: normalizedRegimeExitState.checkpointState ?? null,
        objectiveBreakdown: normalizedRegimeExitState.objectiveBreakdown ?? null,
        multipleTestingPenalty: normalizedRegimeExitState.multipleTestingPenalty ?? null,
        holdoutVerdict: normalizedRegimeExitState.holdoutVerdict ?? null,
        offlineDataSummary: normalizedRegimeExitState.offlineDataSummary ?? null,
        shadowRegimeScoreboard: normalizedRegimeExitState.shadowRegimeScoreboard ?? null,
      }
    : {};

  return {
    variantFilePath: path.join(config.researchRoot, `${runId}-variants.json`),
    paretoShortlist,
    selectedCandidate,
    challengerSummary,
    labResults,
    matrixDecision,
    steadyState,
    noChangeStreak,
    manifest: {
      generatedAt: isoNow(),
      matrixId: config.matrixId,
      runId,
      profile: config.selectedProfile,
      primaryLab: config.primaryLab,
      shadowLabs: config.shadowLabs,
      labTiers: {
        training: partitionLabs(config).trainingLabs.map((lab) => lab.labId),
        selection: partitionLabs(config).selectionLabs.map((lab) => lab.labId),
        blindHoldout: partitionLabs(config).blindHoldoutLabs.map((lab) => lab.labId),
      },
      blindHoldoutLabs: config.blindHoldoutLabs,
      pinnedData: config.pinnedData?.enabled ? {
        enabled: true,
        datasetsRoot: config.pinnedData.datasetsRoot,
        cacheRoot: config.pinnedData.cacheRoot,
        exchangeName: config.pinnedData.exchangeName,
      } : { enabled: false },
      incumbent: championSummary,
      champion: championSummary,
      challenger: challengerSummary,
      primarySweep,
      globalNoveltyGuardVersion: 1,
      searchPlan: {
        mode: config.searchPolicy.mode,
        exploitRatio: config.searchPolicy.exploitRatio,
        variantCount: searchBatch.length,
        variants: searchBatch.map((variant) => ({
          variantId: variant?.variantId,
          lane: variant?.lane,
          family: variant?.family,
          patch: variant?.patch,
          patchFingerprint: variant?.patchFingerprint ?? variant?.metadata?.patchFingerprint ?? null,
          metadata: variant?.metadata,
          config: variant?.config,
        })),
      },
      paretoShortlist,
      matrixCandidates: matrixCandidates.map((item) => ({
        challenger: item.challenger,
        matrixDecision: item.matrixDecision,
        robustness: item.robustness,
        expectancy: item.expectancy ?? null,
      })),
      labResults: manifestLabResults,
      matrixDecision,
      expectancyPolicy,
      expectancy,
      entryInvariance: entryInvarianceVerdict,
      researchState: {
        steadyState,
        noChangeStreak,
      },
      activeTrackId: trackState.activeTrackId ?? null,
      windowSetId: trackState.windowSetId ?? null,
      noveltySignature: trackState.noveltySignature ?? null,
      rotationTrigger,
      rotationReason,
      sameTrackCycleStreak,
      topCandidateSimilarity: topCandidateSimilaritySummary.topCandidateSimilarity,
      promotionEligible,
      promotionReady,
      promotionEligibleReason,
      holdoutGate,
      noNewCandidate,
      noNewCandidateStreak: trackState.noNewCandidateStreak ?? 0,
      laneBudgetDebt: trackState.budgetDebt ?? null,
      stagnationLevel: trackState.stagnationLevel ?? 0,
      stagnationReason: trackState.stagnationReason ?? null,
      lastEscalatedAt: trackState.lastEscalatedAt ?? null,
      candidateFingerprint: trackState.candidateFingerprint ?? null,
      candidateFamilyKey: buildCandidateFamilyKey({ config: challengerSummary?.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys }),
      rejectedCandidateFingerprint: noNewCandidate ? null : (trackState.rejectedCandidateFingerprint ?? null),
      championFingerprint: trackState.championFingerprint ?? null,
      championFamilyKey: buildCandidateFamilyKey({ config: championState?.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys }),
      robustness: selectedCandidate?.robustness ?? null,
      labSetId: trackState.labSetId ?? null,
      gridName: trackState.gridName ?? config.grid ?? null,
      ...compactRegimeExitManifest,
    },
  };
}

export function applySchedulerStateToManifest(manifest = {}, schedulerState = {}) {
  return {
    ...manifest,
    noNewCandidateStreak: schedulerState?.noNewCandidateStreak ?? manifest?.noNewCandidateStreak ?? 0,
    laneBudgetDebt: schedulerState?.budgetDebt ?? manifest?.laneBudgetDebt ?? null,
    stagnationLevel: schedulerState?.stagnationLevel ?? manifest?.stagnationLevel ?? 0,
    stagnationReason: schedulerState?.stagnationReason ?? manifest?.stagnationReason ?? null,
    lastEscalatedAt: schedulerState?.lastEscalatedAt ?? manifest?.lastEscalatedAt ?? null,
  };
}

export function buildScoutRegimeAnalysisArtifact({ matrixId, runId, selectedCandidate = null, matrixCandidates = [] } = {}) {
  const candidatePool = selectedCandidate ? [selectedCandidate] : matrixCandidates;
  const sourceLabResults = candidatePool.flatMap((candidate) => (
    candidate?.labResults || []
  ).map((labResult, labIndex) => ({
    candidate,
    labIndex,
    labResult,
    analysis: labResult?.analysis || null,
  })).filter(({ analysis }) => Boolean(analysis)));

  const analysisSource = sourceLabResults.length > 0
    ? {
        sourceLabCount: sourceLabResults.length,
        sourceLabIds: sourceLabResults.map(({ candidate, labIndex }) => candidate?.labResults?.[labIndex]?.lab?.labId || null),
        analyses: sourceLabResults.map(({ analysis }) => analysis),
        challenger: {
          trades: sourceLabResults.flatMap(({ analysis }) => analysis?.challenger?.trades || []),
          rows: sourceLabResults.flatMap(({ analysis }) => analysis?.challenger?.rows || []),
        },
        incumbent: {
          trades: sourceLabResults.flatMap(({ analysis }) => analysis?.incumbent?.trades || []),
          rows: sourceLabResults.flatMap(({ analysis }) => analysis?.incumbent?.rows || []),
        },
      }
    : null;

  const challengerAnalysis = analysisSource?.challenger || null;
  const incumbentAnalysis = analysisSource?.incumbent || null;
  const trades = challengerAnalysis?.trades || [];
  const featureRows = challengerAnalysis?.rows || [];
  return {
    analysisSource,
    artifact: buildRegimeAnalysisArtifact({
      matrixId,
      runId,
      trades,
      featureRows,
      championMetrics: incumbentAnalysis?.trades?.length ? summarizeSideMetrics({ trades: incumbentAnalysis.trades }) : {},
      candidateMetrics: challengerAnalysis?.trades?.length ? summarizeSideMetrics({ trades: challengerAnalysis.trades }) : null,
    }),
  };
}

export function manifestsDir(config) {
  return path.join(config.researchRoot, 'manifests');
}

function championConfigIdentity(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.config && typeof value.config === 'object' && !Array.isArray(value.config)) {
    return buildChampionConfigFingerprint(value.config);
  }
  if (typeof value.championConfigFingerprint === 'string' && value.championConfigFingerprint.length > 0) {
    return value.championConfigFingerprint;
  }
  if (typeof value.metadata?.championConfigFingerprint === 'string' && value.metadata.championConfigFingerprint.length > 0) {
    return value.metadata.championConfigFingerprint;
  }
  return null;
}

function manifestChampionConfigIdentity(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const championIdentity = championConfigIdentity(manifest.champion ?? manifest.incumbent);
  if (championIdentity !== null) return championIdentity;
  if (typeof manifest.championConfigFingerprint === 'string' && manifest.championConfigFingerprint.length > 0) {
    return manifest.championConfigFingerprint;
  }
  if (typeof manifest.metadata?.championConfigFingerprint === 'string' && manifest.metadata.championConfigFingerprint.length > 0) {
    return manifest.metadata.championConfigFingerprint;
  }
  return null;
}

function manifestChampionConfig(manifest) {
  const value = manifest?.champion ?? manifest?.incumbent ?? null;
  if (value?.config && typeof value.config === 'object' && !Array.isArray(value.config)) return value.config;
  return null;
}

export async function loadRecentCompletedManifestsForNovelty({ config, limit = 24 } = {}) {
  const unbounded = limit === null || limit === undefined || limit === 'all';
  const safeLimit = unbounded ? null : Math.max(0, Math.floor(Number(limit) || 0));
  if (safeLimit === 0) return [];
  const files = await listManifestFiles(config);
  const selectedFiles = unbounded ? files : files.slice(-safeLimit);
  const manifests = [];
  for (const fileName of selectedFiles) {
    try {
      manifests.push(await readJson(path.join(manifestsDir(config), fileName)));
    } catch {
      // Ignore corrupt or concurrently-pruned manifests; current cycle can still proceed.
    }
  }
  return manifests;
}

function isGlobalAllParameterLane(lane) {
  return lane === 'globalAllParameter' || lane === 'global-all-parameter';
}

function variantChampionConfigIdentity(variant) {
  const value = variant?.metadata?.championConfigFingerprint ?? variant?.championConfigFingerprint ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function variantMutationFamily(variant) {
  const value = variant?.mutationFamily ?? variant?.metadata?.mutationFamily ?? variant?.family ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function variantPatchEvidence(variant) {
  const patch = variant?.patch;
  return patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : null;
}

function patchesEqual(left, right) {
  return configFingerprint(left) === configFingerprint(right);
}

function reconstructPatchFromVariantConfig({ variant, championConfig } = {}) {
  const variantConfig = variant?.config;
  if (!championConfig || typeof championConfig !== 'object' || Array.isArray(championConfig)) return null;
  if (!variantConfig || typeof variantConfig !== 'object' || Array.isArray(variantConfig)) return null;
  const patch = {};
  const keys = new Set([...Object.keys(variantConfig), ...Object.keys(championConfig)]);
  for (const key of [...keys].sort()) {
    if (!Object.is(variantConfig[key], championConfig[key])) patch[key] = variantConfig[key];
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function reconstructGlobalPatchFingerprint({ variant, championConfigFingerprint, championConfig = null } = {}) {
  const lane = variant?.lane;
  const mutationFamily = variantMutationFamily(variant);
  const patchEvidence = variantPatchEvidence(variant);
  const configPatch = reconstructPatchFromVariantConfig({ variant, championConfig });
  const patch = patchEvidence ?? configPatch;
  if (!isGlobalAllParameterLane(lane)) return null;
  if (typeof championConfigFingerprint !== 'string' || championConfigFingerprint.length === 0) return null;
  if (!mutationFamily) return null;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  if (patchEvidence && configPatch && !patchesEqual(patchEvidence, configPatch)) return null;
  try {
    return buildGlobalPatchFingerprint({ championConfigFingerprint, lane, mutationFamily, patch });
  } catch {
    return null;
  }
}

function variantStoredV2Fingerprints(variant) {
  const version = variant?.patchFingerprintVersion ?? variant?.metadata?.patchFingerprintVersion ?? null;
  if (Number(version) !== 2) return [];
  return [variant?.patchFingerprint, variant?.metadata?.patchFingerprint]
    .filter((value) => typeof value === 'string' && value.length > 0);
}

export function collectTestedGlobalPatchFingerprints({ champion, historyEvents = [], manifests = [] } = {}) {
  const fingerprints = new Set();
  const currentChampionConfigFingerprint = championConfigIdentity(champion);
  const currentChampionConfig = champion?.config && typeof champion.config === 'object' && !Array.isArray(champion.config)
    ? champion.config
    : null;
  const sources = [
    ...(Array.isArray(manifests) ? manifests : []),
    ...(Array.isArray(historyEvents) ? historyEvents.map((event) => event?.manifest).filter(Boolean) : []),
  ];

  for (const manifest of sources) {
    const manifestChampionConfigFingerprint = manifestChampionConfigIdentity(manifest);
    const manifestMatchesChampion = currentChampionConfigFingerprint !== null
      && manifestChampionConfigFingerprint !== null
      && manifestChampionConfigFingerprint === currentChampionConfigFingerprint;
    const variants = Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [];
    for (const variant of variants) {
      if (!isGlobalAllParameterLane(variant?.lane)) continue;

      const variantChampionConfigFingerprint = variantChampionConfigIdentity(variant);
      const variantMatchesChampion = currentChampionConfigFingerprint !== null
        && variantChampionConfigFingerprint !== null
        && variantChampionConfigFingerprint === currentChampionConfigFingerprint;
      if (!manifestMatchesChampion && !variantMatchesChampion) continue;

      const fingerprintChampionConfig = variantChampionConfigFingerprint
        ?? manifestChampionConfigFingerprint;
      if (fingerprintChampionConfig === null) continue;
      if (fingerprintChampionConfig !== currentChampionConfigFingerprint) continue;

      const manifestConfig = manifestChampionConfig(manifest);
      const reconstructionConfig = manifestMatchesChampion
        ? (manifestConfig ?? currentChampionConfig)
        : (variantMatchesChampion ? currentChampionConfig : null);
      const reconstructed = reconstructGlobalPatchFingerprint({
        variant,
        championConfigFingerprint: fingerprintChampionConfig,
        championConfig: reconstructionConfig,
      });
      if (reconstructed) {
        fingerprints.add(reconstructed);
        continue;
      }

    }
  }

  return fingerprints;
}

function hasUnsafeManifestRunId(runId) {
  const value = String(runId);
  return value.includes('/') || value.includes('\\') || value.includes('..');
}

export function resolvePromotionManifestPath({ config, args = {} } = {}) {
  if (args.manifest) return args.manifest;
  if (args['run-id']) {
    const runId = String(args['run-id']);
    if (hasUnsafeManifestRunId(runId)) {
      throw new Error(`Invalid run-id for manifest lookup: ${runId}`);
    }
    return path.join(manifestsDir(config), `${runId}.json`);
  }
  return null;
}

export function selectPromotionManifestSource({ latest = null, explicitManifestPath = null, manifestOverride = null } = {}) {
  if (manifestOverride) return manifestOverride;
  if (explicitManifestPath && latest && !latest.manifestPath) {
    return { ...latest, manifestPath: explicitManifestPath };
  }
  return latest;
}

export function withManifestPath(manifest, manifestPath) {
  if (!manifest || !manifestPath) return manifest;
  if (manifest.manifestPath === manifestPath) return manifest;
  return { ...manifest, manifestPath };
}

export function latestManifestPath(config) {
  return path.join(config.researchRoot, 'latest.json');
}

function promotionQueueFilePath(config) {
  return promotionQueuePath({ researchRoot: config.researchRoot });
}

export function shouldQueuePromotionManifest(manifest) {
  return assessManifestPromotionReadiness(manifest, { requireCandidateFingerprint: true }).ready;
}

export function decideCycleStartAction({ pendingPromotion = null, forceCycle = false } = {}) {
  if (pendingPromotion && !forceCycle) {
    return {
      recommendation: 'skip',
      reason: 'pending_promotion',
      pendingPromotion,
      summary: `Skip cycle: pending promotion ${pendingPromotion.itemId} from run ${pendingPromotion.runId}`,
    };
  }
  return {
    recommendation: 'run',
    reason: pendingPromotion ? 'forced' : 'no_pending_promotion',
    pendingPromotion,
  };
}

function championPath(config) {
  return path.join(config.researchRoot, 'champion.json');
}

function historyPath(config) {
  return path.join(config.researchRoot, 'history.jsonl');
}

function historyMarkdownPath(config) {
  return path.join(config.digestRoot, 'history.md');
}

function latestDigestPath(config) {
  return path.join(config.digestRoot, 'latest-digest.md');
}

function evaluationsRoot(config) {
  return path.join(config.researchRoot, 'evaluations');
}

function getThresholds(raw = {}) {
  const thresholds = {
    minScoreDelta: raw.minScoreDelta ?? 0.25,
    minRoiDeltaPct: raw.minRoiDeltaPct ?? 0,
    minProfitFactorDelta: raw.minProfitFactorDelta ?? 0,
    maxDrawdownDeltaPct: raw.maxDrawdownDeltaPct ?? 0.75,
    minTradeCount: raw.minTradeCount ?? 100,
    minTradeRatioVsIncumbent: raw.minTradeRatioVsIncumbent ?? 0.75,
  };
  if (raw.significance != null) {
    thresholds.significance = raw.significance;
  }
  return thresholds;
}

function normalizeLab(rawLab, defaults, index, role) {
  const baseId = rawLab.labId || `${role}-${index + 1}`;
  return {
    labId: slug(baseId),
    symbol: String(rawLab.symbol),
    timeframe: String(rawLab.timeframe),
    limit: Number(rawLab.limit),
    when: rawLab.when || null,
    exchange: rawLab.exchange || null,
    thresholds: getThresholds({ ...defaults, ...(rawLab.thresholds || {}) }),
  };
}

async function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`node ${args.join(' ')} failed with code ${code}`));
      }
    });
  });
}

export async function loadConfig(cwd, configPath, overrides = {}) {
  const resolvedConfigPath = resolveMaybeRelative(cwd, configPath || './config/pine-autoresearch.default.json');
  const raw = await readJson(resolvedConfigPath);
  const baseDir = path.dirname(resolvedConfigPath);
  const defaultThresholds = getThresholds(raw.thresholds || {});
  const selectedProfile = overrides.profile || raw.defaultProfile || 'full';
  const profileSettings = raw.scoutProfiles?.[selectedProfile] || null;

  const legacyPrimary = {
    labId: raw.labId || raw.matrixId || 'primary',
    symbol: overrides.symbol || raw.symbol,
    timeframe: overrides.timeframe || raw.timeframe,
    limit: Number(overrides.limit || raw.limit),
    when: overrides.when || raw.when || null,
    exchange: overrides.exchange || raw.exchange || null,
    thresholds: raw.thresholds || {},
  };

  const primarySource = raw.primaryLab || legacyPrimary;
  const shadowSources = raw.shadowLabs || [];
  const matrixId = raw.matrixId || raw.labId || 'pine-autoresearch';

  const config = {
    ...raw,
    configPath: resolvedConfigPath,
    baseDir,
    projectRoot: cwd,
    matrixId,
    scriptPath: resolveMaybeRelative(baseDir, raw.scriptPath),
    researchRoot: resolveMaybeRelative(baseDir, raw.outputs?.researchRoot),
    digestRoot: resolveMaybeRelative(baseDir, raw.outputs?.digestRoot),
    selectedProfile,
    scoutProfiles: raw.scoutProfiles || {},
    grid: String(overrides.grid || profileSettings?.grid || raw.grid),
    maxConfigs: overrides.maxConfigs ? Number(overrides.maxConfigs) : (profileSettings?.maxConfigs ?? raw.maxConfigs ?? null),
    minTrades: overrides.minTrades ? Number(overrides.minTrades) : (profileSettings?.minTrades ?? raw.minTrades ?? 10),
    searchPolicy: {
      mode: raw.searchPolicy?.mode || 'incumbent-local',
      exploitRatio: raw.searchPolicy?.exploitRatio ?? 0.8,
      freezeArchitecture: raw.searchPolicy?.freezeArchitecture ?? true,
      exploitFamilies: raw.searchPolicy?.exploitFamilies || ['signal', 'risk'],
      exploreFamilies: raw.searchPolicy?.exploreFamilies || ['signal'],
      paretoShortlistSize: raw.searchPolicy?.paretoShortlistSize ?? 4,
      matrixCandidateLimit: raw.searchPolicy?.matrixCandidateLimit ?? 3,
      annealing: raw.searchPolicy?.annealing || {},
      selfLoopEscape: raw.searchPolicy?.selfLoopEscape || {},
      ...(raw.searchPolicy?.tabu && typeof raw.searchPolicy.tabu === 'object' && !Array.isArray(raw.searchPolicy.tabu)
        ? { tabu: { ...raw.searchPolicy.tabu } }
        : {}),
    },
    seedChampionPath: resolveMaybeRelative(baseDir, raw.seedChampion?.path || raw.incumbent?.path),
    primaryLab: normalizeLab(primarySource, defaultThresholds, 0, 'primary'),
    shadowLabs: shadowSources.map((lab, index) => normalizeLab(lab, defaultThresholds, index, 'shadow')),
    blindHoldoutLabs: (raw.blindHoldoutLabs || []).map((lab, index) => normalizeLab(lab, defaultThresholds, index, 'blind-holdout')),
    matrixPolicy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 0,
      minShadowPassRatio: 0,
      requireCandidateChange: true,
      ...(raw.matrixPolicy || {}),
    },
    rotationPolicy: {
      ...(raw.rotationPolicy || {}),
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        holdEscalateAfter: 5,
        highSimilarityThreshold: 0.9,
        maxStagnationLevel: 3,
        ...(raw.rotationPolicy?.stagnation || {}),
      },
    },
    expectancyPolicy: {
      enabled: true,
      wrJumpDiagnosticThreshold: 8,
      rejectWrGainAvgWinLoss: true,
      requireExpectancyNonRegression: true,
      ...(raw.expectancyPolicy || {}),
    },
    autoPromotion: {
      enabled: false,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
      ...(raw.autoPromotion || {}),
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 6,
        familyKeys: [
          'useSignalFusion',
          'useFusionV2',
          'useFusionV3',
          'useFusionV4',
          'useDivergenceContext',
          'useSqueezeContext',
          'useSupertrendFilter',
          'useTrailingStop',
          'useStopsTP',
        ],
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
        minExtraAggregateRoiDeltaPct: 0,
        ...(raw.autoPromotion?.lineagePolicy || {}),
      },
    },
    pinnedData: {
      enabled: Boolean(raw.pinnedData?.enabled),
      datasetsRoot: resolveMaybeRelative(baseDir, raw.pinnedData?.datasetsRoot),
      cacheRoot: resolveMaybeRelative(baseDir, raw.pinnedData?.cacheRoot || '../pine/dump/data/candle'),
      exchangeName: raw.pinnedData?.exchangeName || primarySource.exchange || 'ccxt-exchange',
      sourceExchangeId: raw.pinnedData?.sourceExchangeId || 'binance',
    },
    retention: {
      keepLatestRuns: Number(raw.retention?.keepLatestRuns ?? 8),
      pruneSweepRuns: raw.retention?.pruneSweepRuns ?? true,
      pruneEvaluationRuns: raw.retention?.pruneEvaluationRuns ?? true,
      prunePartialRuns: raw.retention?.prunePartialRuns ?? true,
    },
    regimeExitResearch: normalizeRegimeExitResearchConfig(raw.regimeExitResearch || {}),
  };

  return config;
}

async function ensureDirs(config) {
  await fs.mkdir(config.researchRoot, { recursive: true });
  await fs.mkdir(config.digestRoot, { recursive: true });
  await fs.mkdir(manifestsDir(config), { recursive: true });
  await fs.mkdir(evaluationsRoot(config), { recursive: true });
}

async function stagePinnedData(config, labs) {
  if (!config.pinnedData?.enabled) return [];
  if (!config.pinnedData.datasetsRoot) {
    throw new Error('pinnedData.datasetsRoot is required when pinnedData.enabled=true');
  }

  const staged = [];
  for (const lab of labs) {
    staged.push(await stagePinnedDatasetForLab({
      datasetsRoot: config.pinnedData.datasetsRoot,
      cacheRoot: config.pinnedData.cacheRoot,
      exchangeName: config.pinnedData.exchangeName,
      lab,
    }));
  }
  return staged;
}

function collectOfflinePreflightLabs(config = {}) {
  const labs = [
    config.primaryLab,
    ...(config.shadowLabs || []),
    ...(config.blindHoldoutLabs || []),
  ];
  const uniqueLabs = new Map();
  for (const lab of labs) {
    if (lab?.labId && !uniqueLabs.has(lab.labId)) uniqueLabs.set(lab.labId, lab);
  }
  return [...uniqueLabs.values()];
}

async function buildOfflineDataPreflight(config) {
  const plan = buildOfflineDataPlan({
    matrixId: config.matrixId,
    pinnedData: config.pinnedData,
    labs: collectOfflinePreflightLabs(config),
    offline: config.regimeExitResearch?.offline,
  });

  const requiredLabs = await Promise.all((plan.requiredLabs || []).map(async (lab) => {
    if (!lab.requiresCacheComplete) return lab;
    if (!config.pinnedData?.cacheRoot) {
      return {
        ...lab,
        complete: false,
        missingCount: Number(lab.limit || 1),
      };
    }
    const validation = await validatePinnedCacheComplete({
      cacheRoot: config.pinnedData.cacheRoot,
      exchangeName: lab.exchangeName,
      symbol: lab.symbol,
      timeframe: lab.timeframe,
      limit: lab.limit,
      when: lab.when,
    });
    return {
      ...lab,
      complete: validation.complete,
      missingCount: validation.missingCount,
      missingTimestamps: validation.missingTimestamps,
    };
  }));

  const checkedPlan = { ...plan, requiredLabs };
  return summarizeOfflineDataPlan(checkedPlan);
}

// Exported as pure test seam for runScout offline-missing payload shape.
export function buildOfflineDataMissingCycleEvent({ runId, offlineDataSummary } = {}) {
  return {
    timestamp: isoNow(),
    type: 'cycle',
    runId,
    promotionEligible: false,
    promotionEligibleReason: 'offlineDataMissing',
    offlineDataSummary,
    recommendation: 'hold',
    summary: 'offlineDataMissing',
  };
}

export function resolveEffectiveRuntimeExchange({ pinnedData = {}, lab = {} } = {}) {
  return pinnedData?.enabled ? (pinnedData.exchangeName || lab.exchange || null) : (lab.exchange || null);
}

// Exported as pure test seam for runScout offline-missing payload shape.
export function buildOfflineDataMissingSkipResult({ offlineDataSummary } = {}) {
  return {
    skipped: true,
    reason: 'offlineDataMissing',
    promotionEligible: false,
    promotionEligibleReason: 'offlineDataMissing',
    offlineDataSummary,
  };
}

async function appendOfflineDataMissingEvent(config, runId, offlineDataSummary) {
  await appendJsonl(historyPath(config), buildOfflineDataMissingCycleEvent({ runId, offlineDataSummary }));
}

function buildRunId(config) {
  return `${slug(config.matrixId)}-${timestampId()}`;
}

async function listManifestFiles(config) {
  try {
    const names = await fs.readdir(manifestsDir(config));
    return names.filter((name) => name.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

async function readLatestManifest(config) {
  const pointer = validateLatestManifestPointer({ root: config.researchRoot });
  if (!pointer.ok) {
    const error = new Error(`Invalid latest manifest pointer at ${latestManifestPath(config)}: ${pointer.reason}`);
    error.latestManifestPointer = pointer;
    throw error;
  }
  return pointer.manifest;
}

async function tryReadLatestManifest(config) {
  try {
    return await readLatestManifest(config);
  } catch {
    return null;
  }
}

async function readManifestByPath(manifestPath) {
  if (!manifestPath) return null;
  return readJson(manifestPath);
}

async function listRunDirectories(rootDir, prefix = null) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !prefix || name.startsWith(prefix))
      .sort();
  } catch {
    return [];
  }
}

async function pruneRunArtifacts(config) {
  const keepLatestRuns = Number(config.retention?.keepLatestRuns ?? 8);
  if (!(keepLatestRuns >= 0)) return null;

  const manifestRunIds = (await listManifestFiles(config)).map((name) => name.replace(/\.json$/, ''));
  const sweepRunIds = await listRunDirectories(path.resolve(config.projectRoot, 'pine', 'sweeps'), `${slug(config.matrixId)}-`);
  const evaluationRunIds = await listRunDirectories(evaluationsRoot(config));
  const plan = planArtifactPrune({
    manifestRunIds,
    sweepRunIds,
    evaluationRunIds,
    keepLatestRuns,
  });

  const deleteSweepRunIds = config.retention?.pruneSweepRuns
    ? (config.retention?.prunePartialRuns ? plan.deleteSweepRunIds : plan.oldSweepRunIds)
    : [];
  const deleteEvaluationRunIds = config.retention?.pruneEvaluationRuns
    ? (config.retention?.prunePartialRuns ? plan.deleteEvaluationRunIds : plan.oldEvaluationRunIds)
    : [];
  const deleteFailures = [];
  const deletedSweepRunIds = [];
  const deletedEvaluationRunIds = [];

  for (const runId of deleteSweepRunIds) {
    try {
      await fs.rm(path.resolve(config.projectRoot, 'pine', 'sweeps', runId), { recursive: true, force: true });
      deletedSweepRunIds.push(runId);
    } catch (error) {
      deleteFailures.push({ kind: 'sweep', runId, error: error?.message || String(error) });
    }
  }
  for (const runId of deleteEvaluationRunIds) {
    try {
      await fs.rm(path.join(evaluationsRoot(config), runId), { recursive: true, force: true });
      deletedEvaluationRunIds.push(runId);
    } catch (error) {
      deleteFailures.push({ kind: 'evaluation', runId, error: error?.message || String(error) });
    }
  }

  return {
    ...plan,
    deletedSweepRunIds,
    deletedEvaluationRunIds,
    deleteFailures,
  };
}

async function readPreviousManifest(config, latestFileName) {
  const files = await listManifestFiles(config);
  const filtered = latestFileName ? files.filter((name) => name !== latestFileName) : files;
  if (!filtered.length) return null;
  return readJson(path.join(manifestsDir(config), filtered.at(-1)));
}

function inferRejectedCandidateFingerprint(manifest) {
  const recommendation = manifest?.matrixDecision?.recommendation ?? manifest?.recommendation ?? null;
  const candidateFingerprint = manifest?.rejectedCandidateFingerprint ?? (recommendation === 'hold' ? manifest?.candidateFingerprint : null);
  const championFingerprint = manifest?.championFingerprint ?? null;
  return candidateFingerprint && candidateFingerprint !== championFingerprint ? candidateFingerprint : null;
}

async function collectRecentRejectedCandidateFingerprints(config, limit = 16) {
  const files = (await listManifestFiles(config)).slice(-Math.max(0, limit));
  const fingerprints = [];
  for (const fileName of files) {
    try {
      const manifest = await readJson(path.join(manifestsDir(config), fileName));
      const fingerprint = inferRejectedCandidateFingerprint(manifest);
      if (fingerprint) fingerprints.push(fingerprint);
    } catch {
      // Ignore corrupt or concurrently-pruned manifests; current cycle can still proceed.
    }
  }
  return [...new Set(fingerprints)];
}

async function loadHistoryEvents(config) {
  return readJsonl(historyPath(config));
}

function countTrailingSteadyStateCycles(events = []) {
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    const legacySteadyState = typeof event?.summary === 'string' && event.summary.includes('candidateChanged');
    if (event?.type !== 'cycle' || !(event?.steadyState || legacySteadyState)) {
      break;
    }
    count += 1;
  }
  return count;
}

async function rebuildHistoryArtifacts(config, championState) {
  const events = await loadHistoryEvents(config);
  await writeText(historyMarkdownPath(config), renderHistoryMarkdown({ config, championState, historyEvents: events }));
  return events;
}

function buildAutoresearchArtifactWarnings(config) {
  const warnings = [];
  const latestPointer = validateLatestManifestPointer({ root: config.researchRoot });
  if (!latestPointer.ok && latestPointer.reason !== 'latest_missing') {
    warnings.push(`Latest manifest pointer validation failed: ${latestPointer.reason}.`);
  }

  const orphanRuns = findOrphanEvaluationRuns({ root: config.researchRoot });
  if (!orphanRuns.ok) {
    warnings.push(`Found ${orphanRuns.orphans.length} evaluation run(s) without manifest or incomplete marker.`);
  }

  return warnings;
}

function appendDigestWarnings(digestText, warnings = []) {
  if (!warnings.length) return digestText;
  const warningLines = [
    '',
    '## Warnings',
    '',
    ...warnings.map((warning) => `- ${warning}`),
    '',
  ];
  return `${digestText.trimEnd()}\n${warningLines.join('\n')}`;
}

async function writeCurrentDigest(config, latestManifest, championState, previousManifest, historyEvents) {
  const warnings = buildAutoresearchArtifactWarnings(config);
  const digestText = appendDigestWarnings(renderDigestMarkdown({
    config,
    latestManifest,
    previousManifest,
    historyEvents,
    championState,
  }), warnings);
  await writeText(latestDigestPath(config), digestText);
  return latestDigestPath(config);
}

function buildCycleHistoryEvent(manifest = {}) {
  const entryInvarianceCycle = entryInvarianceCycleFromManifest(manifest);
  return {
    timestamp: manifest.generatedAt,
    type: 'cycle',
    runId: manifest.runId,
    championConfigId: manifest.champion?.configId,
    challengerConfigId: manifest.challenger?.configId,
    touchedKeys: entryInvarianceCycle.touchedKeys,
    challenger: entryInvarianceCycle.challenger,
    entryInvariance: manifest.entryInvariance ?? null,
    recommendation: manifest.matrixDecision?.recommendation,
    summary: manifest.matrixDecision?.summary,
    steadyState: manifest.researchState?.steadyState ?? false,
    noChangeStreak: manifest.researchState?.noChangeStreak ?? 0,
    activeTrackId: manifest.activeTrackId ?? null,
    windowSetId: manifest.windowSetId ?? null,
    noveltySignature: manifest.noveltySignature ?? null,
    rotationTrigger: manifest.rotationTrigger ?? null,
    rotationReason: manifest.rotationReason ?? null,
    sameTrackCycleStreak: manifest.sameTrackCycleStreak ?? 0,
    topCandidateSimilarity: manifest.topCandidateSimilarity ?? null,
    promotionEligible: manifest.promotionEligible ?? false,
    promotionEligibleReason: manifest.promotionEligibleReason ?? null,
    noNewCandidate: manifest.noNewCandidate ?? false,
    noNewCandidateStreak: manifest.noNewCandidateStreak ?? 0,
    stagnationLevel: manifest.stagnationLevel ?? 0,
    stagnationReason: manifest.stagnationReason ?? null,
    lastEscalatedAt: manifest.lastEscalatedAt ?? null,
    rejectedCandidateFingerprint: manifest.rejectedCandidateFingerprint ?? null,
    candidateFingerprint: manifest.candidateFingerprint ?? null,
    championFingerprint: manifest.championFingerprint ?? null,
    globalNoveltyGuardVersion: manifest.globalNoveltyGuardVersion ?? null,
    noLaneReason: manifest.shadowRegimeScoreboard?.noLaneReason ?? null,
    offlineDataSummary: manifest.offlineDataSummary ?? null,
  };
}

async function writeScoutCycleArtifacts({ config, championState, manifest, manifestPath }) {
  const scoutPath = path.join(config.digestRoot, `${manifest.runId}.md`);
  await appendJsonl(historyPath(config), buildCycleHistoryEvent(manifest));
  await writeText(scoutPath, renderScoutMarkdown({ config, manifest }));
  const updatedHistoryEvents = await rebuildHistoryArtifacts(config, championState);
  const previousManifest = await readPreviousManifest(config, path.basename(manifestPath));
  const liveDigestPath = await writeCurrentDigest(config, { ...manifest, manifestPath }, championState, previousManifest, updatedHistoryEvents);
  const pruneResult = await pruneRunArtifacts(config);
  return { scoutPath, liveDigestPath, pruneResult };
}

async function seedChampionState(config) {
  let latest = null;
  let seedPayload = null;
  let seedReadError = null;

  try {
    latest = await tryReadLatestManifest(config);
  } catch {
    latest = null;
  }

  if (config.seedChampionPath) {
    try {
      seedPayload = await readJson(config.seedChampionPath);
    } catch (error) {
      seedReadError = error;
    }
  }

  const bootstrap = selectChampionBootstrapSource({ latestManifest: latest, seedPayload });
  if (!bootstrap?.source?.config) {
    const attempts = [];
    if (latest) attempts.push(`latest manifest at ${latestManifestPath(config)}`);
    if (config.seedChampionPath) attempts.push(`seed file at ${config.seedChampionPath}`);
    const suffix = seedReadError?.message ? ` Last seed read error: ${seedReadError.message}` : '';
    throw new Error(`Could not initialize champion state from available bootstrap sources (${attempts.join(', ') || 'none'}).${suffix}`);
  }

  const source = bootstrap.source;
  const championState = {
    ...summarizeResult(source),
    configFingerprint: configFingerprint(source.config),
    promotedAt: isoNow(),
    sourcePath: bootstrap.kind === 'seed-file' ? config.seedChampionPath : (latest?.manifestPath || latestManifestPath(config)),
    sourceRunId: latest?.runId || source.sourceRunId || null,
    mode: 'seed',
    bootstrapKind: bootstrap.kind,
  };

  await writeJson(championPath(config), championState);
  await appendJsonl(historyPath(config), {
    timestamp: championState.promotedAt,
    type: 'seedChampion',
    championConfigId: championState.configId,
    summary: `Seeded champion from ${bootstrap.kind}`,
    recommendation: 'seed',
  });
  return championState;
}

export async function ensureChampionState(config) {
  try {
    return await readJson(championPath(config));
  } catch {
    const championState = await seedChampionState(config);
    await rebuildHistoryArtifacts(config, championState);
    return championState;
  }
}

async function runPrimarySweep(config, runId, { sweepOffset = 0, totalCombos = null, variantFilePath = null } = {}) {
  const lab = config.primaryLab;
  const effectiveExchange = resolveEffectiveRuntimeExchange({ pinnedData: config.pinnedData, lab });
  await stagePinnedData(config, [lab]);

  const sweepArgs = [
    path.resolve(config.projectRoot, 'scripts', 'pine-sweep.mjs'),
    '--input', config.scriptPath,
    '--symbol', lab.symbol,
    '--timeframe', lab.timeframe,
    '--limit', String(lab.limit),
    '--grid', config.grid,
    '--run-id', runId,
    '--min-trades', String(config.minTrades),
  ];

  if (config.maxConfigs != null) {
    sweepArgs.push('--max-configs', String(config.maxConfigs));
  }
  if (variantFilePath) {
    sweepArgs.push('--variant-file', variantFilePath);
  }
  if (sweepOffset) {
    sweepArgs.push('--offset', String(sweepOffset));
  }
  if (lab.when) {
    sweepArgs.push('--when', lab.when);
  }
  if (effectiveExchange) {
    sweepArgs.push('--exchange', effectiveExchange);
  }
  if (config.pinnedData?.enabled) {
    sweepArgs.push('--no-cache', '--require-cache-complete', '--cache-root', config.pinnedData.cacheRoot, '--cache-exchange', config.pinnedData.exchangeName);
  }

  await runNode(sweepArgs, config.projectRoot);

  const runDir = path.resolve(config.projectRoot, 'pine', 'sweeps', runId);
  const leaderboard = await readJson(path.join(runDir, 'leaderboard.json'));

  return {
    runDir,
    gridName: config.grid,
    totalCombos,
    sweepOffset,
    topConfigs: (leaderboard.ranked || []).slice(0, 5).map((item) => summarizeResult(item)),
    best: leaderboard.ranked?.[0] || null,
  };
}

async function evaluateConfigOnLab({ config, lab, runId, variantKey, candidate }) {
  const evalDir = path.join(evaluationsRoot(config), runId, lab.labId);
  const effectiveExchange = resolveEffectiveRuntimeExchange({ pinnedData: config.pinnedData, lab });
  await fs.mkdir(evalDir, { recursive: true });
  await stagePinnedData(config, [lab]);

  const source = await fs.readFile(config.scriptPath, 'utf8');
  const patched = applyPatchPlan(source, buildPatchPlan(candidate.config || {}));
  const variantPath = path.join(evalDir, `${variantKey}.pine`);
  const flattenedPath = path.join(evalDir, `${variantKey}.flattened.pine`);
  const outputBase = `${variantKey}-${lab.labId}`;
  await fs.writeFile(variantPath, patched, 'utf8');

  const args = [
    path.resolve(config.projectRoot, 'scripts', 'pine-import-run-clean.mjs'),
    '--input', variantPath,
    '--flattened', flattenedPath,
    '--symbol', lab.symbol,
    '--timeframe', lab.timeframe,
    '--limit', String(lab.limit),
    '--output', outputBase,
  ];

  if (lab.when) {
    args.push('--when', lab.when);
  }
  if (effectiveExchange) {
    args.push('--exchange', effectiveExchange);
  }
  if (config.pinnedData?.enabled) {
    args.push('--no-cache', '--require-cache-complete', '--cache-root', config.pinnedData.cacheRoot, '--cache-exchange', config.pinnedData.exchangeName);
  }

  await runNode(args, config.projectRoot);

  const cleanedPath = path.join(evalDir, 'dump', `${outputBase}.cleaned.jsonl`);
  const analysis = await analyzeJsonlFile(cleanedPath, { minTrades: config.minTrades });

  return {
    status: 'ok',
    label: candidate.label || candidate.configId,
    configId: candidate.configId,
    config: candidate.config,
    score: analysis.score,
    metrics: analysis.metrics,
    diagnostics: analysis.diagnostics,
    trades: analysis.trades,
    rows: analysis.rows,
    cleanedPath,
    runDir: evalDir,
  };
}

export async function evaluateMatrix(config, runId, championState, challengerSummary, dependencies = {}) {
  const evaluateConfigOnLabFn = dependencies.evaluateConfigOnLab || evaluateConfigOnLab;
  const labs = partitionLabs(config).selectionLabs;
  const sameCandidate = sameConfig(championState.config, challengerSummary?.config);
  const labResults = [];

  for (const lab of labs) {
    const incumbentResult = await evaluateConfigOnLabFn({
      config,
      lab,
      runId,
      variantKey: 'champion',
      candidate: championState,
    });

    const challengerResult = sameCandidate
      ? {
          ...clone(incumbentResult),
          label: challengerSummary?.label || challengerSummary?.configId || incumbentResult.label,
          configId: challengerSummary?.configId || incumbentResult.configId,
          config: challengerSummary?.config || incumbentResult.config,
        }
      : await evaluateConfigOnLabFn({
          config,
          lab,
          runId,
          variantKey: 'challenger',
          candidate: challengerSummary,
        });

    const decision = decideAutoresearchOutcome({
      incumbent: incumbentResult,
      challenger: challengerResult,
      thresholds: lab.thresholds,
      expectancyPolicy: config.expectancyPolicy,
      complexityPolicy: config.complexityPolicy,
      holdoutVerdict: config.holdoutVerdict ?? null,
      blindHoldoutLabs: config.blindHoldoutLabs ?? [],
      holdoutMode: config.holdoutMode,
      promotionPolicy: config.regimeExitResearch?.enabled ? config.regimeExitResearch?.promotion : null,
    });

    labResults.push({
      lab,
      incumbent: summarizeResult(incumbentResult),
      challenger: summarizeResult(challengerResult),
      decision,
      analysis: {
        incumbent: {
          trades: incumbentResult.trades,
          rows: incumbentResult.rows,
        },
        challenger: {
          trades: challengerResult.trades,
          rows: challengerResult.rows,
        },
      },
    });
  }

  return {
    labResults,
    matrixDecision: decideMatrixPromotion({
      labResults,
      policy: config.matrixPolicy,
      champion: championState,
      challenger: challengerSummary,
    }),
  };
}

export async function runScout(config, dependencies = {}) {
  const runPrimarySweepFn = dependencies.runPrimarySweep || runPrimarySweep;
  await ensureDirs(config);
  const queue = await readPromotionQueue(promotionQueueFilePath(config));
  const pendingPromotion = selectNextPendingPromotion(queue);
  const cycleStartAction = decideCycleStartAction({ pendingPromotion, forceCycle: config.forceCycle === true });
  if (cycleStartAction.recommendation === 'skip') {
    return {
      skipped: true,
      reason: cycleStartAction.reason,
      pendingPromotion,
    };
  }
  const championState = await ensureChampionState(config);
  const runId = buildRunId(config);
  let manifestFinalized = false;
  let trackedConfig = { ...config };

  try {
    await beginAutoresearchRunArtifact({
      root: trackedConfig.researchRoot,
      runId,
      profile: trackedConfig.selectedProfile,
    });

    const historyEventsBefore = await loadHistoryEvents(config);
    const recentManifestsForNovelty = await loadRecentCompletedManifestsForNovelty({
      config: trackedConfig,
      limit: null,
    });
    const entryInvariance = buildEntryInvarianceVerdict({
      historyEvents: historyEventsBefore,
      manifests: recentManifestsForNovelty,
      policy: trackedConfig.searchPolicy?.entryInvariance || trackedConfig.entryInvariancePolicy || {},
    });

    let offlineDataSummary = null;
  if (config.regimeExitResearch?.enabled) {
    offlineDataSummary = await buildOfflineDataPreflight(config);
    if (!offlineDataSummary.ok && offlineDataSummary.mode === 'offline-strict') {
      const offlineManifest = buildOfflineDataMissingManifest({
        config: trackedConfig,
        runId,
        championState,
        offlineDataSummary,
        entryInvariance,
      });
      const finalizedArtifact = await finalizeAutoresearchManifest({
        root: trackedConfig.researchRoot,
        manifest: offlineManifest,
      });
      manifestFinalized = true;
      const artifactPaths = await writeScoutCycleArtifacts({
        config: trackedConfig,
        championState,
        manifest: offlineManifest,
        manifestPath: finalizedArtifact.manifestPath,
      });
      return {
        ...buildOfflineDataMissingSkipResult({ offlineDataSummary }),
        manifest: offlineManifest,
        manifestPath: finalizedArtifact.manifestPath,
        ...artifactPaths,
      };
    }
  }
  const schedulerStatePath = resolveSchedulerStatePath({ researchRoot: config.researchRoot, matrixId: config.matrixId });
  const loadedSchedulerState = await readSchedulerState(schedulerStatePath);
  const schedulerChampionFingerprint = configFingerprint(championState.config);
  const schedulerTabuPolicy = config.searchPolicy?.tabu
    ?? config.rotationPolicy?.tabu
    ?? {
      maxAgeCycles: 20,
      maxEntries: config.rotationPolicy?.tabuLimit ?? 32,
      dropOnChampionChange: true,
    };
  const schedulerState = mergeSchedulerTabuFingerprints({
    schedulerState: loadedSchedulerState,
    recentRejectedFingerprints: await collectRecentRejectedCandidateFingerprints(config, config.rotationPolicy?.tabuBootstrapManifestLimit ?? 16),
    currentCycle: loadedSchedulerState.cycleIndex ?? 0,
    championFingerprint: schedulerChampionFingerprint,
    policy: schedulerTabuPolicy,
  });
  const researchTracks = normalizeResearchTracks(
    Array.isArray(config.researchTracks) && config.researchTracks.length > 0
      ? config.researchTracks
      : [{
          trackId: config.grid || 'default-track',
          name: config.grid || 'default-track',
          gridName: config.grid || 'default-track',
          windowSet: config.windowPolicy?.primary || 'primary',
          enabled: true,
        }],
  );
  const rotationPolicy = config.rotationPolicy || {};
  const previousCycle = [...historyEventsBefore].reverse().find((event) => event?.type === 'cycle') || null;
  const { hardRotationTrigger, activeTrackSelectionState } = resolveTrackSelectionState({
    schedulerState,
    rotationPolicy,
    researchTracks,
    previousCycle,
  });
  const activeTrack = selectActiveTrack({
    tracks: researchTracks,
    state: activeTrackSelectionState,
    cycleIndex: activeTrackSelectionState.cycleIndex,
  }) || researchTracks[0] || null;
  const activeTrackId = activeTrack?.trackId || null;
  const gridName = activeTrack?.gridName || config.grid;
  const windowSetId = activeTrack?.windowSet || config.windowPolicy?.primary || 'primary';
  const labSetId = [config.primaryLab?.labId, ...(config.shadowLabs || []).map((lab) => lab.labId)].filter(Boolean).join(',');
  trackedConfig = { ...trackedConfig, grid: gridName };

  trackedConfig = {
    ...trackedConfig,
    searchPolicy: buildForcedEntryMutationPolicy(trackedConfig.searchPolicy, entryInvariance),
  };

  const fallbackSearchBatch = entryInvariance.flagged
    ? buildIncumbentSearchBatch({
        incumbent: championState.config,
        maxConfigs: trackedConfig.maxConfigs,
        historyEvents: historyEventsBefore,
        policy: trackedConfig.searchPolicy,
        schedulerState,
      })
    : activeTrack
      ? buildTrackCandidateBatch({
          track: activeTrack,
          incumbent: championState.config,
          maxConfigs: trackedConfig.maxConfigs,
          historyEvents: historyEventsBefore,
          budgetPolicy: trackedConfig.searchPolicy,
          schedulerState,
        })
      : buildIncumbentSearchBatch({
          incumbent: championState.config,
          maxConfigs: trackedConfig.maxConfigs,
          historyEvents: historyEventsBefore,
          policy: trackedConfig.searchPolicy,
          schedulerState,
        });
  const championSource = { configId: championState.configId, config: championState.config };
  const regimeNoveltyContext = {
    recentManifestsForNovelty,
  };
  const searchPolicyWithNovelty = {
    ...trackedConfig.searchPolicy,
    recentManifestsForNovelty,
  };

  const regimeExitStateSeed = buildRegimeExitStateForScout({
    config: trackedConfig,
    championState,
    historyEventsBefore,
    searchBatch: [],
    offlineDataSummary,
    schedulerState,
  });
  const selectedRegimeLane = regimeExitStateSeed?.shadowRegimeScoreboard?.selectedLane || null;

  const regimeAwareSearchBatch = buildRegimeAwareSearchBatch({
    selectedLane: selectedRegimeLane,
    champion: championSource,
    maxConfigs: trackedConfig.maxConfigs,
    historyEvents: historyEventsBefore,
    policy: searchPolicyWithNovelty,
    schedulerState,
    regimeExitResearch: trackedConfig.regimeExitResearch,
  });
  const selectedGeneratedRegimeLane = trackedConfig.regimeExitResearch?.enabled === true
    && isGeneratedNoveltyLane(selectedRegimeLane);
  const generatedRegimeLane = selectedGeneratedRegimeLane;

  const selectedSearchBatch = generatedRegimeLane
    ? regimeAwareSearchBatch
    : fallbackSearchBatch.length > 0
      ? fallbackSearchBatch
      : regimeAwareSearchBatch;
  const searchVariants = enforceEntryInvarianceOnSearchBatch({
    searchBatch: selectedSearchBatch,
    championConfig: championState.config,
    historyEvents: historyEventsBefore,
    policy: trackedConfig.searchPolicy,
    schedulerState,
    entryInvariance,
  });
  const totalCombos = searchVariants.length;
  const sweepOffset = computeSweepOffset({
    historyEvents: historyEventsBefore,
    maxConfigs: trackedConfig.maxConfigs,
    totalCombos,
  });
  const variantFilePath = path.join(trackedConfig.researchRoot, `${runId}-variants.json`);
  const regimeExitStateBeforeSweep = buildRegimeExitStateForScout({
    config: trackedConfig,
    championState,
    historyEventsBefore,
    searchBatch: searchVariants,
    offlineDataSummary,
    schedulerState,
    regimeExitContext: regimeNoveltyContext,
  });

  if (shouldSkipNoRegimeResearchLane({ regimeExitState: regimeExitStateBeforeSweep })) {
    const championFingerprint = configFingerprint(championState.config);
    const noLaneManifest = buildNoRegimeResearchLaneManifest({
      config: trackedConfig,
      runId,
      championState,
      regimeExitState: regimeExitStateBeforeSweep,
      schedulerState,
      entryInvariance,
      trackState: {
        activeTrackId,
        windowSetId,
        rotationTrigger: hardRotationTrigger,
        rotationReason: 'no-regime-research-lane',
        candidateFingerprint: championFingerprint,
        championFingerprint,
        labSetId,
        gridName,
      },
    });
    const updatedSchedulerState = nextTrackState({
      state: schedulerState,
      policy: rotationPolicy,
      manifest: buildGlobalAllParameterExhaustedSchedulerManifestInput({
        manifest: noLaneManifest,
        championState,
      }),
    });
    await writeSchedulerState(schedulerStatePath, updatedSchedulerState);
    const finalNoLaneManifest = applySchedulerStateToManifest(noLaneManifest, updatedSchedulerState);
    const finalizedArtifact = await finalizeAutoresearchManifest({
      root: trackedConfig.researchRoot,
      manifest: finalNoLaneManifest,
    });
    manifestFinalized = true;
    const artifactPaths = await writeScoutCycleArtifacts({
      config: trackedConfig,
      championState,
      manifest: finalNoLaneManifest,
      manifestPath: finalizedArtifact.manifestPath,
    });
    return {
      skipped: true,
      reason: 'no-regime-research-lane',
      manifest: finalNoLaneManifest,
      manifestPath: finalizedArtifact.manifestPath,
      ...artifactPaths,
    };
  }

  if (shouldSkipGeneratedLaneSweep({ regimeExitState: regimeExitStateBeforeSweep, searchBatch: searchVariants })) {
    const championFingerprint = configFingerprint(championState.config);
    const exhaustedLane = regimeExitStateBeforeSweep.shadowRegimeScoreboard?.selectedLane || 'globalAllParameter';
    const exhaustionReason = generatedLaneExhaustionReason(exhaustedLane);
    const exhaustedManifest = buildGlobalAllParameterExhaustedManifest({
      config: trackedConfig,
      runId,
      championState,
      regimeExitState: regimeExitStateBeforeSweep,
      schedulerState,
      entryInvariance,
      trackState: {
        activeTrackId,
        windowSetId,
        rotationTrigger: hardRotationTrigger,
        rotationReason: exhaustionReason,
        candidateFingerprint: championFingerprint,
        championFingerprint,
        labSetId,
        gridName,
      },
    });
    const postExhaustionTrackState = nextTrackState({
      state: schedulerState,
      policy: rotationPolicy,
      manifest: buildGlobalAllParameterExhaustedSchedulerManifestInput({
        manifest: exhaustedManifest,
        championState,
      }),
    });
    const postExhaustionBudgetDebt = resolveLaneBudgetDebtAdvance({
      config: trackedConfig,
      schedulerState: postExhaustionTrackState,
      selectedLane: exhaustedLane,
    });
    const laneConfigFingerprint = buildChampionConfigFingerprint(championState.config);
    const updatedSchedulerState = recordResearchLaneExhaustion({
      state: postExhaustionBudgetDebt.advanced
        ? { ...postExhaustionTrackState, budgetDebt: postExhaustionBudgetDebt.budgetDebt }
        : postExhaustionTrackState,
      lane: exhaustedLane,
      championConfigFingerprint: laneConfigFingerprint,
      exhaustedAt: exhaustedManifest.generatedAt,
      runId,
      reason: exhaustionReason,
      stagnationLevel: postExhaustionTrackState.stagnationLevel ?? schedulerState?.stagnationLevel ?? 0,
      budgetDebt: postExhaustionBudgetDebt.budgetDebt || postExhaustionTrackState.budgetDebt || schedulerState?.budgetDebt || {},
      lanesEnabled: resolveRegimeLaneEnabled(trackedConfig.regimeExitResearch || {}),
    });
    await writeSchedulerState(schedulerStatePath, updatedSchedulerState);
    const finalExhaustedManifest = applySchedulerStateToManifest(exhaustedManifest, updatedSchedulerState);
    const finalizedArtifact = await finalizeAutoresearchManifest({
      root: trackedConfig.researchRoot,
      manifest: finalExhaustedManifest,
    });
    manifestFinalized = true;
    const artifactPaths = await writeScoutCycleArtifacts({
      config: trackedConfig,
      championState,
      manifest: finalExhaustedManifest,
      manifestPath: finalizedArtifact.manifestPath,
    });
    return {
      skipped: true,
      reason: exhaustionReason,
      manifest: finalExhaustedManifest,
      manifestPath: finalizedArtifact.manifestPath,
      ...artifactPaths,
    };
  }

  await writeJson(variantFilePath, searchVariants);
  const primarySweep = await runPrimarySweepFn(trackedConfig, runId, { sweepOffset, totalCombos, variantFilePath });
  const paretoShortlist = buildParetoShortlist({
    champion: summarizeResult(championState),
    rankedResults: primarySweep.topConfigs,
    limit: trackedConfig.searchPolicy.paretoShortlistSize,
  });

  const matrixCandidates = [];
  for (const candidate of paretoShortlist.slice(0, trackedConfig.searchPolicy.matrixCandidateLimit)) {
    const { labResults, matrixDecision } = await evaluateMatrix(trackedConfig, runId, championState, candidate);
    const robustness = {
      aggregateScoreDelta: labResults.reduce((sum, item) => sum + (item.decision.comparisons?.scoreDelta || 0), 0),
      aggregateRoiDeltaPct: labResults.reduce((sum, item) => sum + (item.decision.comparisons?.roiDeltaPct || 0), 0),
      aggregateProfitFactorDelta: labResults.reduce((sum, item) => sum + (item.decision.comparisons?.profitFactorDelta || 0), 0),
      aggregateDrawdownDeltaPct: labResults.reduce((sum, item) => sum + (item.decision.comparisons?.drawdownDeltaPct || 0), 0),
    };
    matrixCandidates.push({ challenger: candidate, labResults, matrixDecision, robustness, expectancy: labResults[0]?.decision?.expectancy || null });
  }

  const selectedCandidate = selectChangedMatrixCandidate({ candidates: matrixCandidates, championState });
  const challengerSummary = selectedCandidate?.challenger || summarizeResult(championState);
  const noNewCandidate = sameConfig(championState.config, challengerSummary.config);
  const candidateFingerprint = configFingerprint(challengerSummary.config);
  const championFingerprint = configFingerprint(championState.config);
  const rejectedCandidateFingerprint = selectedCandidate?.matrixDecision?.recommendation === 'hold'
    && candidateFingerprint !== championFingerprint
    ? candidateFingerprint
    : null;
  const noveltySignature = buildNoveltySignature({
    trackId: activeTrackId,
    gridName,
    candidateFingerprint,
    windowSetId,
    labSetId,
  });
  const rotationReason = hardRotationTrigger
    ?? (schedulerState.activeTrackId && schedulerState.activeTrackId === activeTrackId
      ? 'persisted-state'
      : schedulerState.activeTrackId
        ? 'cycleIndex'
        : 'initial');
  const sameTrackCycleStreak = activeTrackId && activeTrackId === schedulerState.activeTrackId
    ? (schedulerState.sameTrackCycleStreak || 0) + 1
    : activeTrackId
      ? 1
      : 0;

  const regimeExitState = regimeExitStateBeforeSweep;
  const consumedBudgetLane = resolveConsumedBudgetLane({
    searchBatch: searchVariants,
    selectedLane: selectedRegimeLane,
  });
  const laneBudgetDebtAdvance = resolveLaneBudgetDebtAdvance({
    config: trackedConfig,
    schedulerState,
    selectedLane: consumedBudgetLane,
  });

  const orchestration = buildScoutOrchestrationState({
    config: trackedConfig,
    runId,
    championState,
    historyEventsBefore,
    searchBatch: searchVariants,
    primarySweep,
    matrixCandidates,
    trackState: {
      activeTrackId,
      windowSetId,
      noveltySignature,
      rotationTrigger: hardRotationTrigger,
      rotationReason,
      sameTrackCycleStreak,
      candidateFingerprint,
      rejectedCandidateFingerprint,
      noNewCandidate,
      noNewCandidateStreak: schedulerState.noNewCandidateStreak ?? 0,
      budgetDebt: laneBudgetDebtAdvance.budgetDebt,
      stagnationLevel: schedulerState.stagnationLevel ?? 0,
      stagnationReason: schedulerState.stagnationReason ?? null,
      lastEscalatedAt: schedulerState.lastEscalatedAt ?? null,
      championFingerprint,
      labSetId,
      gridName,
    },
    regimeExitState,
    entryInvariance,
  });
  const { manifest } = orchestration;

  const manifestName = `${runId}.json`;
  let manifestPath = path.join(manifestsDir(trackedConfig), manifestName);

  const updatedSchedulerState = {
    ...nextTrackState({
      state: schedulerState,
      policy: { ...rotationPolicy, tabu: schedulerTabuPolicy },
      manifest: {
        activeTrackId: manifest.activeTrackId,
        candidateFingerprint: manifest.candidateFingerprint,
        rejectedCandidateFingerprint: manifest.rejectedCandidateFingerprint,
        championFingerprint: manifest.championFingerprint,
        noveltySignature: manifest.noveltySignature,
        topCandidateSimilarity: manifest.topCandidateSimilarity,
        rotationTrigger: manifest.rotationTrigger,
        rotationReason: manifest.rotationReason,
        sameTrackCycleStreak: manifest.sameTrackCycleStreak,
        promotionEligible: manifest.promotionEligible,
        promotionEligibleReason: manifest.promotionEligibleReason,
        noNewCandidate: manifest.noNewCandidate,
        stagnationLevel: manifest.stagnationLevel,
        stagnationReason: manifest.stagnationReason,
        lastEscalatedAt: manifest.lastEscalatedAt,
        generatedAt: manifest.generatedAt,
        windowSetId: manifest.windowSetId,
        labSetId: manifest.labSetId,
        gridName: manifest.gridName,
      },
    }),
    ...(laneBudgetDebtAdvance.advanced ? { budgetDebt: laneBudgetDebtAdvance.budgetDebt } : {}),
  };
  await writeSchedulerState(schedulerStatePath, updatedSchedulerState);

  const finalManifest = applySchedulerStateToManifest(manifest, updatedSchedulerState);

  const finalizedArtifact = await finalizeAutoresearchManifest({
    root: trackedConfig.researchRoot,
    manifest: finalManifest,
  });
  manifestPath = finalizedArtifact.manifestPath;
  manifestFinalized = true;

  if (shouldQueuePromotionManifest(finalManifest)) {
    const queueItem = buildPromotionQueueItem({
      manifest: { ...finalManifest, manifestPath },
      createdAt: finalManifest.generatedAt,
    });
    await appendPromotionQueueEvent(promotionQueueFilePath(trackedConfig), {
      type: 'pending',
      item: queueItem,
      at: finalManifest.generatedAt,
    });
  }

  const asymmetryAnalysis = buildScoutRegimeAnalysisArtifact({
    matrixId: trackedConfig.matrixId,
    runId,
    selectedCandidate,
    matrixCandidates,
  });
  const asymmetryDir = path.join(trackedConfig.digestRoot, 'analysis');
  const asymmetryPath = path.join(asymmetryDir, `${runId}-asymmetry.md`);
  await writeText(asymmetryPath, asymmetryAnalysis.artifact.markdown);

  const artifactPaths = await writeScoutCycleArtifacts({
    config: trackedConfig,
    championState,
    manifest: finalManifest,
    manifestPath,
  });

  return { manifest: finalManifest, manifestPath, ...artifactPaths };
  } catch (error) {
    if (!manifestFinalized) {
      await markAutoresearchRunIncompleteUnlessManifestExists({
        root: trackedConfig.researchRoot,
        runId,
        reason: 'run_failed_before_manifest',
        error,
      });
    }
    throw error;
  }
}

async function runDigest(config) {
  await ensureDirs(config);
  const latest = await readLatestManifest(config);
  if (!latest) {
    throw new Error(`No latest manifest found at ${latestManifestPath(config)}`);
  }

  const championState = await ensureChampionState(config);
  const latestName = path.basename(latest.manifestPath || '');
  const previous = await readPreviousManifest(config, latestName);
  const digestId = `digest-${timestampId()}`;
  const digestPath = path.join(config.digestRoot, `${digestId}.md`);
  const historyEvents = await loadHistoryEvents(config);
  const warnings = buildAutoresearchArtifactWarnings(config);
  const digestText = appendDigestWarnings(renderDigestMarkdown({
    config,
    latestManifest: latest,
    previousManifest: previous,
    historyEvents,
    championState,
  }), warnings);
  await writeText(digestPath, digestText);
  await writeText(latestDigestPath(config), digestText);

  return {
    digestId,
    digestPath,
    liveDigestPath: latestDigestPath(config),
    summary: summarizeDigestAnnouncement({ latestManifest: latest, previousManifest: previous }),
    latest,
    previous,
  };
}

async function writePromotionNote(config, latest, mode) {
  const notePath = path.join(config.digestRoot, `${mode}-promote-${timestampId()}.md`);
  const lines = [
    '# Pine Autoresearch Promotion',
    '',
    `- Mode: ${mode}`,
    `- Source manifest: \`${latest.manifestPath || latestManifestPath(config)}\``,
    `- Applied config: \`${latest.challenger?.configId}\``,
    `- Matrix decision: ${latest.matrixDecision?.summary || latest.decision?.summary || 'n/a'}`,
    '',
  ];
  await writeText(notePath, `${lines.join('\n')}\n`);
  return notePath;
}


async function runBlindHoldout(config) {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const latest = await readLatestManifest(config);
  if (!latest?.challenger?.config) {
    throw new Error('No latest challenger available for blind holdout');
  }
  const labs = partitionLabs(config).blindHoldoutLabs;
  if (!labs.length) {
    throw new Error('No blindHoldoutLabs configured');
  }

  const runId = `${buildRunId(config)}-blind-holdout`;
  const labResults = [];
  for (const lab of labs) {
    const incumbentResult = await evaluateConfigOnLab({
      config,
      lab,
      runId,
      variantKey: 'champion',
      candidate: championState,
    });
    const challengerResult = sameConfig(championState.config, latest.challenger.config)
      ? {
          ...clone(incumbentResult),
          label: latest.challenger.label || latest.challenger.configId || incumbentResult.label,
          configId: latest.challenger.configId || incumbentResult.configId,
          config: latest.challenger.config || incumbentResult.config,
        }
      : await evaluateConfigOnLab({
          config,
          lab,
          runId,
          variantKey: 'challenger',
          candidate: latest.challenger,
        });
    const decision = decideAutoresearchOutcome({
      incumbent: incumbentResult,
      challenger: challengerResult,
      thresholds: lab.thresholds,
      expectancyPolicy: config.expectancyPolicy,
      complexityPolicy: config.complexityPolicy,
      holdoutVerdict: latest.holdoutVerdict ?? config.holdoutVerdict ?? null,
      blindHoldoutLabs: [],
      promotionPolicy: config.regimeExitResearch?.enabled ? config.regimeExitResearch?.promotion : null,
    });
    labResults.push({
      lab,
      incumbent: summarizeResult(incumbentResult),
      challenger: summarizeResult(challengerResult),
      decision,
    });
  }

  const matrixDecision = decideMatrixPromotion({
    labResults,
    policy: {
      requirePrimaryPromote: false,
      minShadowPassCount: labs.length,
      minShadowPassRatio: 1,
      requireCandidateChange: true,
      ...(config.blindHoldoutPolicy || {}),
    },
    champion: championState,
    challenger: latest.challenger,
  });
  const championSummary = summarizeResult(championState);
  const challengerSummary = summarizeResult(latest.challenger);
  const championFingerprint = configFingerprint(championState.config || {});
  const candidateFingerprint = configFingerprint(latest.challenger.config || {});
  const holdoutPassed = matrixDecision.recommendation === 'promote';
  const holdoutGate = classifyHoldoutGate({
    blindHoldoutLabs: labs,
    holdoutVerdict: {
      passed: holdoutPassed,
      reason: holdoutPassed ? 'blind_holdout_passed' : (matrixDecision.summary || 'blind_holdout_failed'),
    },
  });
  const payload = {
    generatedAt: isoNow(),
    matrixId: config.matrixId,
    runId,
    sourceManifestPath: latest.manifestPath || latestManifestPath(config),
    status: holdoutPassed ? 'holdout_pass' : 'premise_burn',
    blindHoldoutOnly: true,
    champion: championSummary,
    challenger: challengerSummary,
    championFingerprint,
    candidateFingerprint,
    holdoutGate,
    promotionReady: holdoutPassed,
    labResults,
    matrixDecision,
  };
  const holdoutRoot = path.join(config.researchRoot, 'blind-holdouts');
  const holdoutPath = path.join(holdoutRoot, `${runId}.json`);
  await writeJson(holdoutPath, payload);
  await appendJsonl(historyPath(config), {
    timestamp: payload.generatedAt,
    type: 'blindHoldout',
    runId,
    championConfigId: championState.configId,
    challengerConfigId: latest.challenger.configId,
    recommendation: matrixDecision.recommendation,
    summary: matrixDecision.summary,
    status: payload.status,
  });
  return { holdoutPath, payload };
}

export async function runPromote(config, args, mode = 'manual', manifestOverride = null) {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const explicitManifestPath = resolvePromotionManifestPath({ config, args });
  const loadedLatest = manifestOverride || (explicitManifestPath ? await readManifestByPath(explicitManifestPath) : await readLatestManifest(config));
  const latest = selectPromotionManifestSource({ latest: loadedLatest, explicitManifestPath, manifestOverride });
  if (!latest) {
    throw new Error('No latest manifest to promote');
  }

  const decision = latest.matrixDecision || latest.decision;
  if (decision?.recommendation !== 'promote' && !args.force) {
    throw new Error(`Latest manifest recommendation is ${decision?.recommendation || 'unknown'}, not promote. Use --force to override.`);
  }
  if (!latest.challenger?.config) {
    throw new Error('Latest manifest has no challenger config to promote');
  }
  if (sameConfig(championState.config, latest.challenger.config)) {
    return {
      promoted: false,
      reason: `Champion already matches ${latest.challenger.configId}`,
      appliedConfigId: championState.configId,
      notePath: null,
    };
  }

  const readiness = assessManifestPromotionReadiness(latest, {
    championState,
    requireMatrixPromotion: !args.force,
  });
  if (!readiness.ready) {
    throw new Error(`Latest manifest is not promotion-ready: ${readiness.failedGates.join(', ')}`);
  }

  const source = await fs.readFile(config.scriptPath, 'utf8');
  const patched = applyPatchPlan(source, buildPatchPlan(latest.challenger.config || {}));
  await fs.writeFile(config.scriptPath, patched, 'utf8');

  const promotedAt = isoNow();
  const nextChampion = {
    ...latest.challenger,
    configFingerprint: configFingerprint(latest.challenger.config),
    promotedAt,
    sourceManifestPath: latest.manifestPath || latestManifestPath(config),
    sourceRunId: latest.runId,
    mode,
  };
  await writeJson(championPath(config), nextChampion);

  const notePath = await writePromotionNote(config, latest, mode);
  const fromFingerprint = latest.championFingerprint ?? championState.configFingerprint ?? configFingerprint(championState.config || {});
  const toFingerprint = latest.candidateFingerprint ?? latest.challenger?.candidateFingerprint ?? configFingerprint(latest.challenger?.config || {});
  const fromFamilyKey = latest.championFamilyKey ?? buildCandidateFamilyKey({ config: championState.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys });
  const toFamilyKey = latest.candidateFamilyKey ?? buildCandidateFamilyKey({ config: latest.challenger?.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys });
  await appendJsonl(historyPath(config), {
    timestamp: promotedAt,
    type: mode === 'auto' ? 'autopromote' : 'promote',
    runId: latest.runId,
    fromConfigId: championState.configId,
    toConfigId: latest.challenger.configId,
    fromFingerprint,
    toFingerprint,
    fromFamilyKey,
    toFamilyKey,
    championConfigId: latest.challenger.configId,
    challengerConfigId: latest.challenger.configId,
    recommendation: 'promote',
    summary: `Promoted ${latest.challenger.configId} from ${championState.configId}`,
    note: notePath,
  });
  const updatedHistoryEvents = await rebuildHistoryArtifacts(config, nextChampion);
  const latestName = path.basename(latest.manifestPath || '');
  const previousManifest = await readPreviousManifest(config, latestName);
  await writeCurrentDigest(config, latest, nextChampion, previousManifest, updatedHistoryEvents);

  return { promoted: true, notePath, appliedConfigId: latest.challenger.configId };
}

async function runAutopromote(config, args) {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const queuePath = promotionQueueFilePath(config);
  const queue = await readPromotionQueue(queuePath);
  const queuedItem = selectNextPendingPromotion(queue);
  if (!queuedItem) {
    return { promoted: false, reason: 'No pending promotion queue item', gates: {} };
  }

  let queuedManifest = null;
  try {
    queuedManifest = await readManifestByPath(queuedItem.manifestPath);
  } catch (error) {
    const manifestReadReason = `manifest_read_failed:${error?.code || error?.message || String(error)}`;
    await appendPromotionQueueEvent(queuePath, {
      type: 'status',
      itemId: queuedItem.itemId,
      status: 'failed',
      reason: manifestReadReason,
    });
    return { promoted: false, reason: manifestReadReason, gates: {} };
  }

  if (!queuedManifest) {
    const manifestReadReason = 'manifest_read_failed:missing_path';
    await appendPromotionQueueEvent(queuePath, {
      type: 'status',
      itemId: queuedItem.itemId,
      status: 'failed',
      reason: manifestReadReason,
    });
    return { promoted: false, reason: manifestReadReason, gates: {} };
  }

  const queuedManifestWithPath = withManifestPath(queuedManifest, queuedItem.manifestPath);
  const historyEvents = await loadHistoryEvents(config);
  const lineage = summarizePromotionLineage({
    historyEvents,
    limit: config.autoPromotion?.lineagePolicy?.lookbackPromotions ?? 6,
  });
  const action = decideAutoPromotionAction({
    latestManifest: queuedManifestWithPath,
    historyEvents,
    championState,
    policy: { ...config.autoPromotion, lineage },
  });
  const queuedAction = decideQueuedPromotionAction({
    queuedItem,
    manifest: queuedManifestWithPath,
    championState,
    autoAction: action,
  });

  const forceableQueuedAction = args.force && canForceQueuedPromotion(queuedAction);
  if (queuedAction.recommendation !== 'promote' && !forceableQueuedAction) {
    await appendPromotionQueueEvent(queuePath, {
      type: 'status',
      itemId: queuedItem.itemId,
      status: queuedAction.status,
      reason: queuedAction.reason,
    });
    return {
      promoted: false,
      reason: queuedAction.reason,
      gates: action.gates,
      failedGates: action.failedGates,
    };
  }

  const result = await runPromote(config, { ...args, force: true }, 'auto', queuedManifestWithPath);
  await appendAutopromoteQueueStatus(queuePath, queuedItem, result.promoted ? {
    ...result,
    reason: result.reason || 'autopromoted',
  } : result);
  return result;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (isHelpRequest(rawArgs)) {
    console.log(formatAutoresearchHelp());
    return;
  }

  const args = parseArgs(rawArgs);
  const command = args._[0] || 'cycle';
  const cwd = process.cwd();
  const config = await loadConfig(cwd, args.config, {
    symbol: args.symbol,
    timeframe: args.timeframe,
    limit: args.limit,
    when: args.when,
    exchange: args.exchange,
    grid: args.grid,
    profile: args.profile,
    maxConfigs: args['max-configs'],
    minTrades: args['min-trades'],
  });
  config.forceCycle = args['force-cycle'] === true;

  if (command === 'cycle' || command === 'scout') {
    const selectedProfile = args.profile || config.selectedProfile;
    const result = await withAutoresearchLock(
      { ...config, selectedProfile },
      { command: 'cycle', profile: selectedProfile },
      () => runScout({ ...config, selectedProfile }),
    );
    if (result.skipped && result.currentOwner) {
      console.log(formatAutoresearchLockSkip('cycle', result));
      return;
    }
    if (result.skipped) {
      console.log(`[autoresearch] cycle=skipped reason=${result.reason} pending=${result.pendingPromotion?.itemId || 'n/a'}`);
      return;
    }
    console.log(`\n[autoresearch] manifest=${result.manifestPath}`);
    console.log(`[autoresearch] scout=${result.scoutPath}`);
    console.log(`[autoresearch] recommendation=${result.manifest.matrixDecision.recommendation}`);
    console.log(`[autoresearch] live-digest=${result.liveDigestPath}`);
    if (result.pruneResult) {
      console.log(`[autoresearch] prune sweeps=${result.pruneResult.deletedSweepRunIds.length} evaluations=${result.pruneResult.deletedEvaluationRunIds.length} failures=${result.pruneResult.deleteFailures.length}`);
    }
    return;
  }

  if (command === 'digest') {
    const result = await runDigest(config);
    console.log(result.summary);
    console.log(`[autoresearch] digest=${result.digestPath}`);
    console.log(`[autoresearch] live-digest=${result.liveDigestPath}`);
    return;
  }

  if (command === 'holdout' || command === 'blind-holdout') {
    const result = await runBlindHoldout(config);
    console.log(`[autoresearch] blind-holdout=${result.payload.status}`);
    console.log(`[autoresearch] holdout=${result.holdoutPath}`);
    return;
  }

  if (command === 'promote') {
    const selectedProfile = args.profile || config.selectedProfile;
    const result = await withAutoresearchLock(
      { ...config, selectedProfile },
      { command: 'promote', profile: selectedProfile },
      () => runPromote(config, args, 'manual'),
    );
    if (result.skipped && result.currentOwner) {
      console.log(formatAutoresearchLockSkip('promote', result));
      return;
    }
    if (!result.promoted) {
      console.log(`[autoresearch] promote=noop ${result.reason}`);
      return;
    }
    console.log(`[autoresearch] promoted=${result.appliedConfigId}`);
    console.log(`[autoresearch] note=${result.notePath}`);
    return;
  }

  if (command === 'autopromote') {
    const selectedProfile = args.profile || config.selectedProfile;
    const result = await withAutoresearchLock(
      { ...config, selectedProfile },
      { command: 'autopromote', profile: selectedProfile },
      () => runAutopromote(config, args),
    );
    if (result.skipped && result.currentOwner) {
      console.log(formatAutoresearchLockSkip('autopromote', result));
      return;
    }
    if (!result.promoted) {
      console.log(`[autoresearch] autopromote=noop ${result.reason}`);
      return;
    }
    console.log(`[autoresearch] autopromoted=${result.appliedConfigId}`);
    console.log(`[autoresearch] note=${result.notePath}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}

