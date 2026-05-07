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
import { applyPatchPlan, buildPatchPlan } from './lib/pine-tuner.mjs';
import { buildIncumbentSearchBatch } from './lib/pine-search-policy.mjs';
import { buildTrackCandidateBatch } from './lib/pine-track-generators.mjs';
import {
  appendJsonl,
  buildParetoShortlist,
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
import { stagePinnedDatasetForLab, validatePinnedCacheComplete } from './lib/pine-dataset.mjs';
import { buildOfflineDataPlan, summarizeOfflineDataPlan } from './lib/pine-offline-data-plan.mjs';
import {
  acquireAutoresearchLock,
  releaseAutoresearchLock,
} from './lib/pine-autoresearch-lock.mjs';
import {
  buildNoveltySignature,
  nextTrackState,
  normalizeResearchTracks,
  readSchedulerState,
  resolveSchedulerStatePath,
  selectActiveTrack,
  summarizeTopCandidateSimilarity,
  writeSchedulerState,
} from './lib/pine-autoresearch-tracks.mjs';
import { buildCandidateFamilyKey, summarizePromotionLineage } from './lib/pine-autoresearch-lineage.mjs';
import { normalizeRegimeExitResearchConfig } from './lib/pine-regime-exit-config.mjs';
import { allocateRegimeExitLaneBudget, selectNextResearchLane } from './lib/pine-regime-exit-scheduler.mjs';
import { buildExitFamilyCandidates } from './lib/pine-exit-generators.mjs';
import { buildGlobalMutationBatch } from './lib/pine-global-search.mjs';

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


function summarizeRegimeLaneGenerator({ selectedLane, championState, config, searchBatch }) {
  const laneMap = {
    exploit: ['exploit'],
    exitRegime: ['exitRegime', 'exit-regime'],
    globalAllParameter: ['globalAllParameter', 'global-all-parameter'],
    robustness: ['robustness'],
  };
  const laneAliases = laneMap[selectedLane] || [];
  const searchBatchCount = Array.isArray(searchBatch)
    ? searchBatch.filter((item) => laneAliases.includes(item?.lane)).length
    : 0;

  const summary = {
    lane: selectedLane || null,
    laneKind: selectedLane || null,
    candidateCount: searchBatchCount,
    previewOnly: true,
    countSource: 'searchBatch',
    blockedFamilyCount: null,
  };

  return summary;
}

export function buildRegimeExitStateForScout({
  config,
  championState,
  historyEventsBefore = [],
  searchBatch = [],
  offlineDataSummary = null,
  schedulerState = {},
} = {}) {
  if (!config?.regimeExitResearch?.enabled) return null;

  const regimeConfig = config.regimeExitResearch || {};
  const resourceConfig = regimeConfig.resource || {};
  const objectiveConfig = regimeConfig.objective || {};
  const laneBudgetAllocation = allocateRegimeExitLaneBudget({
    maxConfigs: config.maxConfigs,
    lanes: regimeConfig.lanes,
  });
  const selectedLane = selectNextResearchLane({
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    budgetDebt: schedulerState?.budgetDebt || {},
    lanesEnabled: {
      exploit: true,
      exitRegime: regimeConfig.exitRegimeEnabled !== false,
      globalAllParameter: regimeConfig.globalAllParameterEnabled !== false,
      robustness: regimeConfig.robustnessLadderEnabled !== false,
    },
  });

  const generatorSummary = summarizeRegimeLaneGenerator({
    selectedLane,
    championState,
    config,
    searchBatch,
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
    },
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

export function decideQueuedPromotionAction({ queuedItem, manifest, championState, autoAction } = {}) {
  if (!queuedItem) return { recommendation: 'hold', status: 'blocked', reason: 'No pending promotion item' };
  if (!manifest) return { recommendation: 'hold', status: 'failed', reason: `Queued manifest missing for ${queuedItem.itemId}` };
  if (manifest.runId !== queuedItem.runId) return { recommendation: 'hold', status: 'failed', reason: `Manifest runId ${manifest.runId} does not match queued runId ${queuedItem.runId}` };
  if (manifest.matrixDecision?.recommendation !== 'promote') return { recommendation: 'hold', status: 'stale', reason: `Queued manifest recommendation is ${manifest.matrixDecision?.recommendation || 'unknown'}` };
  if (!manifest.challenger?.config) return { recommendation: 'hold', status: 'failed', reason: 'Queued manifest has no challenger config' };
  if (sameConfig(championState?.config, manifest.challenger.config)) return { recommendation: 'hold', status: 'stale', reason: `Champion already matches ${manifest.challenger.configId}` };
  const currentChampionFingerprint = championState?.configFingerprint || configFingerprint(championState?.config || {});
  if (!queuedItem.championFingerprintAtDecision) return { recommendation: 'hold', status: 'stale', reason: 'Queued champion fingerprint missing at decision' };
  if (currentChampionFingerprint !== queuedItem.championFingerprintAtDecision) return { recommendation: 'hold', status: 'stale', reason: 'Current champion changed since queued decision' };
  if (queuedItem.candidateFamilyKey && manifest.candidateFamilyKey && queuedItem.candidateFamilyKey !== manifest.candidateFamilyKey) {
    return { recommendation: 'hold', status: 'failed', reason: 'Queued candidate family does not match manifest family' };
  }
  if (queuedItem.championFamilyKeyAtDecision && manifest.championFamilyKey && queuedItem.championFamilyKeyAtDecision !== manifest.championFamilyKey) {
    return { recommendation: 'hold', status: 'failed', reason: 'Queued champion family does not match manifest family' };
  }
  if (autoAction?.recommendation !== 'promote') return { recommendation: 'hold', status: 'blocked', reason: autoAction?.summary || 'Autopromote gates did not pass' };
  return { recommendation: 'promote', status: 'promoted', reason: 'Queued promotion guards passed' };
}

export function canForceQueuedPromotion(queuedAction = null) {
  return queuedAction?.status === 'blocked';
}

export function resolveAutopromoteQueueStatus(result = {}) {
  if (result?.promoted) return 'promoted';
  const reason = String(result?.reason || 'promotion_noop');
  if (/already matches|already promoted/i.test(reason)) return 'stale';
  return 'blocked';
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

export function mergeSchedulerTabuFingerprints({ schedulerState = {}, recentRejectedFingerprints = [], tabuLimit = 128 } = {}) {
  const limit = Number.isFinite(tabuLimit) ? Math.max(0, tabuLimit) : 128;
  const current = Array.isArray(schedulerState.tabuRejectedFingerprints)
    ? schedulerState.tabuRejectedFingerprints
    : [];
  const merged = [...new Set([...current, ...recentRejectedFingerprints.filter(Boolean)])].slice(-limit);
  return {
    ...schedulerState,
    tabuRejectedFingerprints: merged,
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

export function buildScoutOrchestrationState({ config, runId, championState, historyEventsBefore, searchBatch, primarySweep, matrixCandidates, trackState = {}, regimeExitState = DEFAULT_REGIME_EXIT_STATE }) {

  const championSummary = summarizeResult(championState);
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
      searchPlan: {
        mode: config.searchPolicy.mode,
        exploitRatio: config.searchPolicy.exploitRatio,
        variantCount: searchBatch.length,
        variants: searchBatch.map(({ variantId, lane, family, config: variantConfig }) => ({ variantId, lane, family, config: variantConfig })),
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
      promotionEligibleReason,
      noNewCandidate,
      noNewCandidateStreak: trackState.noNewCandidateStreak ?? 0,
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
  return manifest?.matrixDecision?.recommendation === 'promote'
    && Boolean(manifest?.challenger?.config)
    && Boolean(manifest?.candidateFingerprint)
    && manifest.candidateFingerprint !== manifest.championFingerprint;
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
  return {
    minScoreDelta: raw.minScoreDelta ?? 0.25,
    minRoiDeltaPct: raw.minRoiDeltaPct ?? 0,
    minProfitFactorDelta: raw.minProfitFactorDelta ?? 0,
    maxDrawdownDeltaPct: raw.maxDrawdownDeltaPct ?? 0.75,
    minTradeCount: raw.minTradeCount ?? 100,
    minTradeRatioVsIncumbent: raw.minTradeRatioVsIncumbent ?? 0.75,
  };
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
  try {
    return await readJson(latestManifestPath(config));
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

async function writeCurrentDigest(config, latestManifest, championState, previousManifest, historyEvents) {
  const digestText = renderDigestMarkdown({
    config,
    latestManifest,
    previousManifest,
    historyEvents,
    championState,
  });
  await writeText(latestDigestPath(config), digestText);
  return latestDigestPath(config);
}

async function seedChampionState(config) {
  let latest = null;
  let seedPayload = null;
  let seedReadError = null;

  latest = await readLatestManifest(config);

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

export async function evaluateMatrix(config, runId, championState, challengerSummary) {
  const labs = partitionLabs(config).selectionLabs;
  const sameCandidate = sameConfig(championState.config, challengerSummary?.config);
  const labResults = [];

  for (const lab of labs) {
    const incumbentResult = await evaluateConfigOnLab({
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
      : await evaluateConfigOnLab({
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

export async function runScout(config) {
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
  let offlineDataSummary = null;
  if (config.regimeExitResearch?.enabled) {
    offlineDataSummary = await buildOfflineDataPreflight(config);
    if (!offlineDataSummary.ok && offlineDataSummary.mode === 'offline-strict') {
      await appendOfflineDataMissingEvent(config, runId, offlineDataSummary);
      return buildOfflineDataMissingSkipResult({ offlineDataSummary });
    }
  }
  const historyEventsBefore = await loadHistoryEvents(config);
  const schedulerStatePath = resolveSchedulerStatePath({ researchRoot: config.researchRoot, matrixId: config.matrixId });
  const loadedSchedulerState = await readSchedulerState(schedulerStatePath);
  const schedulerState = mergeSchedulerTabuFingerprints({
    schedulerState: loadedSchedulerState,
    recentRejectedFingerprints: await collectRecentRejectedCandidateFingerprints(config, config.rotationPolicy?.tabuBootstrapManifestLimit ?? 16),
    tabuLimit: config.rotationPolicy?.tabuLimit ?? 128,
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
  const trackedConfig = { ...config, grid: gridName };

  const searchBatch = activeTrack
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

  const searchVariants = searchBatch.length > 0
    ? searchBatch
    : buildIncumbentSearchBatch({
        incumbent: championState.config,
        maxConfigs: trackedConfig.maxConfigs,
        historyEvents: historyEventsBefore,
        policy: trackedConfig.searchPolicy,
        schedulerState,
      });
  const totalCombos = searchVariants.length;
  const sweepOffset = computeSweepOffset({
    historyEvents: historyEventsBefore,
    maxConfigs: trackedConfig.maxConfigs,
    totalCombos,
  });
  const variantFilePath = path.join(trackedConfig.researchRoot, `${runId}-variants.json`);
  await writeJson(variantFilePath, searchVariants);
  const primarySweep = await runPrimarySweep(trackedConfig, runId, { sweepOffset, totalCombos, variantFilePath });
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

  const regimeExitState = buildRegimeExitStateForScout({
    config: trackedConfig,
    championState,
    historyEventsBefore,
    searchBatch: searchVariants,
    offlineDataSummary,
    schedulerState,
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
      stagnationLevel: schedulerState.stagnationLevel ?? 0,
      stagnationReason: schedulerState.stagnationReason ?? null,
      lastEscalatedAt: schedulerState.lastEscalatedAt ?? null,
      championFingerprint,
      labSetId,
      gridName,
    },
    regimeExitState,
  });
  const { steadyState, noChangeStreak, manifest } = orchestration;

  const manifestName = `${runId}.json`;
  const manifestPath = path.join(manifestsDir(trackedConfig), manifestName);
  const scoutPath = path.join(trackedConfig.digestRoot, `${runId}.md`);

  const updatedSchedulerState = nextTrackState({
    state: schedulerState,
    policy: rotationPolicy,
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
  });
  await writeSchedulerState(schedulerStatePath, updatedSchedulerState);

  const finalManifest = applySchedulerStateToManifest(manifest, updatedSchedulerState);

  await writeJson(manifestPath, finalManifest);
  await writeJson(latestManifestPath(trackedConfig), { ...finalManifest, manifestPath });

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

  await appendJsonl(historyPath(trackedConfig), {
    timestamp: finalManifest.generatedAt,
    type: 'cycle',
    runId,
    championConfigId: finalManifest.champion?.configId,
    challengerConfigId: finalManifest.challenger?.configId,
    recommendation: finalManifest.matrixDecision.recommendation,
    summary: finalManifest.matrixDecision.summary,
    steadyState,
    noChangeStreak,
    activeTrackId: finalManifest.activeTrackId,
    windowSetId: finalManifest.windowSetId,
    noveltySignature: finalManifest.noveltySignature,
    rotationTrigger: finalManifest.rotationTrigger,
    rotationReason: finalManifest.rotationReason,
    sameTrackCycleStreak: finalManifest.sameTrackCycleStreak,
    topCandidateSimilarity: finalManifest.topCandidateSimilarity,
    promotionEligible: finalManifest.promotionEligible,
    promotionEligibleReason: finalManifest.promotionEligibleReason,
    noNewCandidate: finalManifest.noNewCandidate,
    noNewCandidateStreak: finalManifest.noNewCandidateStreak,
    stagnationLevel: finalManifest.stagnationLevel,
    stagnationReason: finalManifest.stagnationReason,
    lastEscalatedAt: finalManifest.lastEscalatedAt,
    rejectedCandidateFingerprint: finalManifest.rejectedCandidateFingerprint,
  });

  await writeText(scoutPath, renderScoutMarkdown({ config: trackedConfig, manifest: finalManifest }));

  const asymmetryAnalysis = buildScoutRegimeAnalysisArtifact({
    matrixId: trackedConfig.matrixId,
    runId,
    selectedCandidate,
    matrixCandidates,
  });
  const asymmetryDir = path.join(trackedConfig.digestRoot, 'analysis');
  const asymmetryPath = path.join(asymmetryDir, `${runId}-asymmetry.md`);
  await writeText(asymmetryPath, asymmetryAnalysis.artifact.markdown);

  const updatedHistoryEvents = await rebuildHistoryArtifacts(trackedConfig, championState);
  const previousManifest = await readPreviousManifest(trackedConfig, manifestName);
  const liveDigestPath = await writeCurrentDigest(trackedConfig, { ...finalManifest, manifestPath }, championState, previousManifest, updatedHistoryEvents);
  const pruneResult = await pruneRunArtifacts(trackedConfig);

  return { manifest: finalManifest, manifestPath, scoutPath, liveDigestPath, pruneResult };
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
  const digestText = renderDigestMarkdown({
    config,
    latestManifest: latest,
    previousManifest: previous,
    historyEvents,
    championState,
  });
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
  const payload = {
    generatedAt: isoNow(),
    matrixId: config.matrixId,
    runId,
    sourceManifestPath: latest.manifestPath || latestManifestPath(config),
    status: matrixDecision.recommendation === 'promote' ? 'holdout_pass' : 'premise_burn',
    blindHoldoutOnly: true,
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

