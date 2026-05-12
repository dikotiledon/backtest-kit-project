import fs from 'node:fs/promises';
import path from 'node:path';
import { computeExpectancy, evaluateExpectancyGuard } from './pine-expectancy.mjs';
import { decideLineagePromotionGate, summarizePromotionLineage } from './pine-autoresearch-lineage.mjs';
import { decideSignificanceGate } from './pine-significance-gate.mjs';
import { buildCanonicalConfigFingerprint } from './pine-global-search.mjs';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }

  return value;
}

export function isoNow() {
  return new Date().toISOString();
}

export function timestampId() {
  return isoNow().replace(/[:.]/g, '-');
}

export function configFingerprint(config) {
  return JSON.stringify(stableValue(config || {}));
}

export function sameConfig(left, right) {
  return configFingerprint(left) === configFingerprint(right);
}

export function classifyHoldoutGate(input = {}) {
  const { blindHoldoutLabs = [], holdoutVerdict = null } = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : {};
  const holdoutRequired = Array.isArray(blindHoldoutLabs) && blindHoldoutLabs.length > 0;
  if (!holdoutRequired) {
    return {
      required: false,
      status: 'not_required',
      passed: true,
      reason: 'blind_holdout_not_required',
    };
  }

  const verdict = holdoutVerdict && typeof holdoutVerdict === 'object' && !Array.isArray(holdoutVerdict)
    ? holdoutVerdict
    : null;
  if (!verdict) {
    return {
      required: true,
      status: 'pending',
      passed: false,
      reason: 'blind_holdout_pending',
    };
  }

  if (verdict.passed === true) {
    return {
      required: true,
      status: 'passed',
      passed: true,
      reason: verdict.reason || 'blind_holdout_passed',
    };
  }

  return {
    required: true,
    status: 'failed',
    passed: false,
    reason: verdict.reason || 'blind_holdout_failed',
  };
}

export function resolveManifestHoldoutGate(manifest = {}) {
  const decision = manifest?.matrixDecision || manifest?.decision || null;
  return manifest?.holdoutGate
    ?? decision?.holdoutGate
    ?? classifyHoldoutGate({
      blindHoldoutLabs: manifest?.blindHoldoutLabs ?? [],
      holdoutVerdict: manifest?.holdoutVerdict ?? null,
    });
}

export function assessManifestPromotionReadiness(manifest, {
  championState = null,
  requireMatrixPromotion = true,
  requireCandidateFingerprint = false,
} = {}) {
  const decision = manifest?.matrixDecision || manifest?.decision || null;
  const candidate = manifest?.challenger || null;
  const challengerConfig = Boolean(candidate?.config);
  const matrixReady = requireMatrixPromotion
    ? decision?.recommendation === 'promote'
    : challengerConfig;

  const hasCandidateFingerprint = Boolean(manifest?.candidateFingerprint);
  const fingerprintChanged = hasCandidateFingerprint && manifest.candidateFingerprint !== manifest?.championFingerprint;
  const configChanged = championState?.config && candidate?.config
    ? !sameConfig(championState.config, candidate.config)
    : false;
  const candidateChanged = requireCandidateFingerprint
    ? fingerprintChanged
    : (configChanged || fingerprintChanged);
  const holdoutGate = resolveManifestHoldoutGate(manifest);
  const holdoutReady = holdoutGate?.passed === true;
  const promotionReady = manifest?.promotionReady !== false;

  const gates = {
    matrixReady,
    challengerConfig,
    candidateChanged,
    holdoutReady,
    promotionReady,
  };
  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    ready: failedGates.length === 0,
    gates,
    failedGates,
    holdoutGate,
    reason: failedGates.length === 0
      ? 'promotion_ready'
      : `promotion_not_ready:${failedGates.join(',')}`,
  };
}

export function isManifestPromotionReady(manifest, options = {}) {
  return assessManifestPromotionReadiness(manifest, options).ready;
}

function isActivatedValue(previous, next) {
  return (previous === false || previous == null) && next === true;
}

export function computeParameterComplexityPenalty({ incumbentConfig = {}, challengerConfig = {}, policy = {} } = {}) {
  const enabled = policy.enabled ?? false;
  if (!enabled) {
    return {
      enabled: false,
      activatedKeys: [],
      changedKeys: [],
      activatedCount: 0,
      changedCount: 0,
      scorePenalty: 0,
      roiPenaltyPct: 0,
      profitFactorPenalty: 0,
    };
  }

  const ignoredKeys = new Set(policy.ignoreKeys || ['configId', 'label', 'sourcePath', 'sourceRunId', 'promotedAt', 'configFingerprint']);
  const keys = [...new Set([...Object.keys(incumbentConfig || {}), ...Object.keys(challengerConfig || {})])]
    .filter((key) => !ignoredKeys.has(key))
    .sort();
  const activatedKeys = [];
  const changedKeys = [];

  for (const key of keys) {
    const previous = incumbentConfig?.[key];
    const next = challengerConfig?.[key];
    if (JSON.stringify(stableValue(previous)) !== JSON.stringify(stableValue(next))) {
      changedKeys.push(key);
    }
    if (isActivatedValue(previous, next)) {
      activatedKeys.push(key);
    }
  }

  const activatedCount = activatedKeys.length;
  const changedCount = changedKeys.length;
  const changedOnlyCount = Math.max(0, changedCount - activatedCount);

  return {
    enabled: true,
    activatedKeys,
    changedKeys,
    activatedCount,
    changedCount,
    scorePenalty: round(
      activatedCount * (policy.scorePenaltyPerActivatedParam ?? 0.75)
      + changedOnlyCount * (policy.scorePenaltyPerChangedParam ?? 0),
      4,
    ),
    roiPenaltyPct: round(
      activatedCount * (policy.roiPenaltyPctPerActivatedParam ?? 0.5)
      + changedOnlyCount * (policy.roiPenaltyPctPerChangedParam ?? 0),
      4,
    ),
    profitFactorPenalty: round(
      activatedCount * (policy.profitFactorPenaltyPerActivatedParam ?? 0)
      + changedOnlyCount * (policy.profitFactorPenaltyPerChangedParam ?? 0),
      4,
    ),
  };
}

export function computeSweepOffset({ historyEvents = [], maxConfigs, totalCombos }) {
  if (!(Number.isFinite(maxConfigs) && maxConfigs > 0 && Number.isFinite(totalCombos) && totalCombos > 0)) {
    return 0;
  }
  const priorCycleCount = historyEvents.filter((event) => event?.type === 'cycle').length;
  return (priorCycleCount * maxConfigs) % totalCombos;
}

export function planArtifactPrune({
  manifestRunIds = [],
  sweepRunIds = [],
  evaluationRunIds = [],
  variantRunIds = [],
  keepLatestRuns = 8,
} = {}) {
  const sortedManifestRunIds = [...manifestRunIds].sort();
  const keepRunIds = keepLatestRuns > 0 ? sortedManifestRunIds.slice(-keepLatestRuns) : [];
  const keepSet = new Set(keepRunIds);
  const manifestSet = new Set(sortedManifestRunIds);

  const partialSweepRunIds = [...sweepRunIds].filter((runId) => !manifestSet.has(runId)).sort();
  const oldSweepRunIds = [...sweepRunIds].filter((runId) => manifestSet.has(runId) && !keepSet.has(runId)).sort();
  const partialEvaluationRunIds = [...evaluationRunIds].filter((runId) => !manifestSet.has(runId)).sort();
  const oldEvaluationRunIds = [...evaluationRunIds].filter((runId) => manifestSet.has(runId) && !keepSet.has(runId)).sort();
  const partialVariantRunIds = [...variantRunIds].filter((runId) => !manifestSet.has(runId)).sort();
  const oldVariantRunIds = [...variantRunIds].filter((runId) => manifestSet.has(runId) && !keepSet.has(runId)).sort();

  return {
    keepRunIds,
    partialSweepRunIds,
    oldSweepRunIds,
    partialEvaluationRunIds,
    oldEvaluationRunIds,
    partialVariantRunIds,
    oldVariantRunIds,
    deleteSweepRunIds: [...new Set([...partialSweepRunIds, ...oldSweepRunIds])].sort(),
    deleteEvaluationRunIds: [...new Set([...partialEvaluationRunIds, ...oldEvaluationRunIds])].sort(),
    deleteVariantRunIds: [...new Set([...partialVariantRunIds, ...oldVariantRunIds])].sort(),
  };
}

function isSteadyStateCandidate(incumbent, challenger) {
  return Boolean(incumbent?.config && challenger?.config && sameConfig(incumbent.config, challenger.config));
}

function findBestAlternative(primarySweep, champion) {
  const topConfigs = primarySweep?.topConfigs || [];
  return topConfigs.find((item) => !sameConfig(item?.config, champion?.config)) || null;
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function appendJsonl(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

export async function readJsonl(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function dominates(left, right) {
  const betterOrEqual =
    (left.score ?? 0) >= (right.score ?? 0) &&
    (left.roiPct ?? 0) >= (right.roiPct ?? 0) &&
    (left.profitFactor ?? 0) >= (right.profitFactor ?? 0) &&
    (left.tradeCount ?? 0) >= (right.tradeCount ?? 0) &&
    (left.maxDrawdownPct ?? Infinity) <= (right.maxDrawdownPct ?? Infinity);

  const strictlyBetter =
    (left.score ?? 0) > (right.score ?? 0) ||
    (left.roiPct ?? 0) > (right.roiPct ?? 0) ||
    (left.profitFactor ?? 0) > (right.profitFactor ?? 0) ||
    (left.tradeCount ?? 0) > (right.tradeCount ?? 0) ||
    (left.maxDrawdownPct ?? Infinity) < (right.maxDrawdownPct ?? Infinity);

  return betterOrEqual && strictlyBetter;
}

function shortlistConfigFingerprint(item) {
  if (item?.config && typeof item.config === 'object' && !Array.isArray(item.config)) {
    return buildCanonicalConfigFingerprint(item.config);
  }

  return typeof item?.configFingerprint === 'string' && item.configFingerprint.length > 0
    ? item.configFingerprint
    : null;
}

function shortlistIdentityKey(item) {
  const fingerprint = shortlistConfigFingerprint(item);
  if (fingerprint) return `config:${fingerprint}`;
  if (item?.configId) return `id:${item.configId}`;
  return `fallback:${JSON.stringify(stableValue(item?.config || item || {}))}`;
}

function sameShortlistConfig(left, right) {
  const leftFingerprint = shortlistConfigFingerprint(left);
  const rightFingerprint = shortlistConfigFingerprint(right);
  return Boolean(leftFingerprint && rightFingerprint && leftFingerprint === rightFingerprint);
}

export function buildParetoShortlist({ champion, rankedResults = [], limit = 4, includeChampion = true }) {
  const sourceResults = Array.isArray(rankedResults) ? rankedResults : [];
  const shortlistResults = includeChampion
    ? sourceResults
    : sourceResults.filter((candidate) => {
      if (!candidate || !champion) return Boolean(candidate);
      return !sameShortlistConfig(champion, candidate);
    });
  const pool = [includeChampion ? champion : null, ...shortlistResults].filter(Boolean);
  const frontier = pool.filter((candidate, index) => {
    return !pool.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate));
  });

  const unique = [];
  const seen = new Set();
  for (const item of frontier) {
    const key = shortlistIdentityKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  if (includeChampion && champion) {
    const championKey = shortlistIdentityKey(champion);
    const championIndex = unique.findIndex((item) => item === champion || shortlistIdentityKey(item) === championKey);
    if (championIndex >= 0) {
      unique.splice(championIndex, 1);
    }
    unique.unshift(champion);
  }

  if (!includeChampion && unique.length < limit) {
    for (const item of shortlistResults) {
      const key = shortlistIdentityKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
      if (unique.length >= limit) break;
    }
  }

  return unique.slice(0, limit);
}

function robustnessScore(candidate) {
  const counts = candidate.matrixDecision?.counts || {};
  const robustness = candidate.robustness || {};
  return (
    (counts.allPassCount || 0) * 100 +
    (counts.shadowPassCount || 0) * 25 +
    (robustness.aggregateScoreDelta || 0) * 2 +
    (robustness.aggregateRoiDeltaPct || 0) * 3 +
    (robustness.aggregateProfitFactorDelta || 0) * 20 -
    (robustness.aggregateDrawdownDeltaPct || 0) * 10
  );
}

export function selectRobustMatrixCandidate({ candidates = [] }) {
  return [...candidates].sort((left, right) => robustnessScore(right) - robustnessScore(left))[0] || null;
}

export function summarizeResult(result) {
  if (!result) return null;
  const tradeCount = result.metrics?.tradeCount ?? result.tradeCount ?? 0;
  const roiPct = round(result.metrics?.roiPct ?? result.roiPct ?? 0, 2);
  const winRatePct = round(result.metrics?.winRatePct ?? result.winRatePct ?? 0, 2);
  const avgWin = round(result.metrics?.avgWin ?? result.avgWin ?? 0, 2);
  const avgLoss = round(result.metrics?.avgLoss ?? result.avgLoss ?? 0, 2);
  const expectancy = computeExpectancy({ winRatePct, avgWin, avgLoss }).expectancy;

  return {
    label: result.label || result.configId || 'unknown',
    configId: result.configId,
    score: round(result.score, 2),
    tradeCount,
    roiPct,
    winRatePct,
    profitFactor: round(result.metrics?.profitFactor ?? result.profitFactor ?? 0, 2),
    maxDrawdownPct: round(result.metrics?.maxDrawdownPct ?? result.maxDrawdownPct ?? 0, 2),
    avgPnl: round(result.metrics?.avgPnl ?? result.avgPnl ?? 0, 2),
    avgWin,
    avgLoss,
    expectancy,
    config: result.config || null,
  };
}

export function extractChampionBootstrapCandidate(payload) {
  if (!payload) return null;
  if (payload.config) return payload;
  if (payload.status?.config) return payload.status;
  if (payload.ranked?.[0]?.config) return payload.ranked[0];
  if (payload.champion?.config) return payload.champion;
  if (payload.incumbent?.config) return payload.incumbent;
  return null;
}

export function selectChampionBootstrapSource({ latestManifest, seedPayload } = {}) {
  const candidates = [];

  if (latestManifest?.matrixDecision?.recommendation === 'promote' && latestManifest?.challenger?.config) {
    candidates.push({ kind: 'latest-promoted-challenger', source: latestManifest.challenger });
  }
  if (latestManifest?.champion?.config) {
    candidates.push({ kind: 'latest-champion', source: latestManifest.champion });
  }
  if (latestManifest?.incumbent?.config) {
    candidates.push({ kind: 'latest-incumbent', source: latestManifest.incumbent });
  }

  const seedSource = extractChampionBootstrapCandidate(seedPayload);
  if (seedSource?.config) {
    candidates.push({ kind: 'seed-file', source: seedSource });
  }

  return candidates[0] || null;
}

export function evaluateProfitabilityFloor({ incumbent, challenger, policy = {} } = {}) {
  const inputs = {
    minRoiDeltaPct: finiteNumberOrNull(policy.minRoiDeltaPct ?? 5),
    minProfitFactorDelta: finiteNumberOrNull(policy.minProfitFactorDelta ?? 0.1),
    minTradeCount: finiteNumberOrNull(policy.minTradeCount ?? 60),
    incumbentRoiPct: finiteNumberOrNull(incumbent?.metrics?.roiPct ?? incumbent?.roiPct),
    challengerRoiPct: finiteNumberOrNull(challenger?.metrics?.roiPct ?? challenger?.roiPct),
    incumbentProfitFactor: finiteNumberOrNull(incumbent?.metrics?.profitFactor ?? incumbent?.profitFactor),
    challengerProfitFactor: finiteNumberOrNull(challenger?.metrics?.profitFactor ?? challenger?.profitFactor),
    challengerTradeCount: finiteNumberOrNull(challenger?.metrics?.tradeCount ?? challenger?.tradeCount),
  };
  const invalidFields = Object.entries(inputs)
    .filter(([, value]) => value === null)
    .map(([name]) => name);
  if (invalidFields.length > 0) {
    return {
      passed: false,
      invalid: true,
      reason: 'non_finite_profitability_input',
      invalidFields,
      roiDelta: null,
      pfDelta: null,
      tradeCount: inputs.challengerTradeCount,
      minRoiDeltaPct: inputs.minRoiDeltaPct,
      minProfitFactorDelta: inputs.minProfitFactorDelta,
      minTradeCount: inputs.minTradeCount,
    };
  }

  const {
    minRoiDeltaPct,
    minProfitFactorDelta,
    minTradeCount,
    incumbentRoiPct,
    challengerRoiPct,
    incumbentProfitFactor,
    challengerProfitFactor,
    challengerTradeCount,
  } = inputs;
  const roiDelta = challengerRoiPct - incumbentRoiPct;
  const pfDelta = challengerProfitFactor - incumbentProfitFactor;
  const tradeCount = challengerTradeCount;

  const passed = roiDelta >= minRoiDeltaPct && pfDelta >= minProfitFactorDelta && tradeCount >= minTradeCount;
  return { passed, roiDelta, pfDelta, tradeCount, minRoiDeltaPct, minProfitFactorDelta, minTradeCount };
}

function summarizeProfitabilityFloorFailure(profitabilityFloor) {
  if (profitabilityFloor.invalid) {
    const invalidFields = profitabilityFloor.invalidFields?.length > 0
      ? ` (${profitabilityFloor.invalidFields.join(', ')})`
      : '';
    return `Profitability floor failed: ${profitabilityFloor.reason}${invalidFields}.`;
  }

  const failures = [];
  if (profitabilityFloor.roiDelta < profitabilityFloor.minRoiDeltaPct) {
    failures.push(`ROI delta ${round(profitabilityFloor.roiDelta)} < ${profitabilityFloor.minRoiDeltaPct}`);
  }
  if (profitabilityFloor.pfDelta < profitabilityFloor.minProfitFactorDelta) {
    failures.push(`profit factor delta ${round(profitabilityFloor.pfDelta, 3)} < ${profitabilityFloor.minProfitFactorDelta}`);
  }
  if (profitabilityFloor.tradeCount < profitabilityFloor.minTradeCount) {
    failures.push(`trade count ${profitabilityFloor.tradeCount} < ${profitabilityFloor.minTradeCount}`);
  }

  return `Profitability floor failed: ${failures.length > 0 ? failures.join('; ') : 'unknown floor component failed'}.`;
}

export function decideAutoresearchOutcome({
  incumbent,
  challenger,
  thresholds = {},
  expectancyPolicy = {},
  complexityPolicy = {},
  holdoutVerdict = null,
  blindHoldoutLabs = [],
  holdoutMode = 'defer',
  promotionPolicy = null,
} = {}) {
  const holdoutGate = classifyHoldoutGate({ blindHoldoutLabs, holdoutVerdict });
  if (!incumbent) {
    throw new Error('Incumbent result is required');
  }

  if (!challenger) {
    return {
      recommendation: 'hold',
      summary: 'No successful challenger found.',
      comparisons: null,
      gates: {
        challengerPresent: false,
      },
      failedGates: ['challengerPresent'],
      expectancy: null,
      expectancyGate: null,
      significanceGate: null,
      holdoutGate,
    };
  }

  const minScoreDelta = thresholds.minScoreDelta ?? 0.25;
  const minRoiDeltaPct = thresholds.minRoiDeltaPct ?? 0;
  const minProfitFactorDelta = thresholds.minProfitFactorDelta ?? 0;
  const maxDrawdownDeltaPct = thresholds.maxDrawdownDeltaPct ?? 0.75;
  const minTradeCount = thresholds.minTradeCount ?? 100;
  const minTradeRatioVsIncumbent = thresholds.minTradeRatioVsIncumbent ?? 0.75;
  const expectancyEnabled = expectancyPolicy.enabled ?? false;
  const wrJumpDiagnosticThreshold = expectancyPolicy.wrJumpDiagnosticThreshold ?? 8;

  const complexity = computeParameterComplexityPenalty({
    incumbentConfig: incumbent.config || {},
    challengerConfig: challenger.config || {},
    policy: complexityPolicy,
  });
  const adjustedThresholds = {
    minScoreDelta: round(minScoreDelta + complexity.scorePenalty, 4),
    minRoiDeltaPct: round(minRoiDeltaPct + complexity.roiPenaltyPct, 4),
    minProfitFactorDelta: round(minProfitFactorDelta + complexity.profitFactorPenalty, 4),
  };

  const comparisons = {
    scoreDelta: round((challenger.score ?? 0) - (incumbent.score ?? 0), 2),
    roiDeltaPct: round((challenger.metrics?.roiPct ?? 0) - (incumbent.metrics?.roiPct ?? 0), 2),
    profitFactorDelta: round((challenger.metrics?.profitFactor ?? 0) - (incumbent.metrics?.profitFactor ?? 0), 2),
    drawdownDeltaPct: round((challenger.metrics?.maxDrawdownPct ?? 0) - (incumbent.metrics?.maxDrawdownPct ?? 0), 2),
    tradeDelta: (challenger.metrics?.tradeCount ?? 0) - (incumbent.metrics?.tradeCount ?? 0),
    tradeRatioVsIncumbent: round((challenger.metrics?.tradeCount ?? 0) / Math.max(1, incumbent.metrics?.tradeCount ?? 0), 3),
    avgWinDelta: round((challenger.metrics?.avgWin ?? 0) - (incumbent.metrics?.avgWin ?? 0), 2),
    avgLossDelta: round((challenger.metrics?.avgLoss ?? 0) - (incumbent.metrics?.avgLoss ?? 0), 2),
    penalizedScoreDelta: round(((challenger.score ?? 0) - (incumbent.score ?? 0)) - complexity.scorePenalty, 4),
    penalizedRoiDeltaPct: round(((challenger.metrics?.roiPct ?? 0) - (incumbent.metrics?.roiPct ?? 0)) - complexity.roiPenaltyPct, 4),
    penalizedProfitFactorDelta: round(((challenger.metrics?.profitFactor ?? 0) - (incumbent.metrics?.profitFactor ?? 0)) - complexity.profitFactorPenalty, 4),
  };

  if (isSteadyStateCandidate(incumbent, challenger)) {
    return {
      recommendation: 'hold',
      summary: `No new candidate on ${incumbent.configId}: challenger matches incumbent, so this run is steady-state validation only.`,
      comparisons,
      gates: {
        candidateChanged: false,
      },
      failedGates: ['candidateChanged'],
      thresholds: {
        minScoreDelta,
        minRoiDeltaPct,
        minProfitFactorDelta,
        maxDrawdownDeltaPct,
        minTradeCount,
        minTradeRatioVsIncumbent,
      },
      expectancy: null,
      expectancyGate: null,
      significanceGate: null,
      holdoutGate,
    };
  }

  const gates = {
    score: comparisons.scoreDelta >= adjustedThresholds.minScoreDelta,
    roi: comparisons.roiDeltaPct >= adjustedThresholds.minRoiDeltaPct,
    profitFactor: comparisons.profitFactorDelta >= adjustedThresholds.minProfitFactorDelta,
    drawdown: comparisons.drawdownDeltaPct <= maxDrawdownDeltaPct,
    tradeFloor: (challenger.metrics?.tradeCount ?? 0) >= minTradeCount,
    tradeRatio: comparisons.tradeRatioVsIncumbent >= minTradeRatioVsIncumbent,
  };

  let expectancyGate = null;
  if (expectancyEnabled) {
    expectancyGate = evaluateExpectancyGuard({
      champion: {
        winRatePct: incumbent.metrics?.winRatePct ?? incumbent.winRatePct ?? 0,
        avgWin: incumbent.metrics?.avgWin ?? incumbent.avgWin ?? 0,
        avgLoss: incumbent.metrics?.avgLoss ?? incumbent.avgLoss ?? 0,
      },
      challenger: {
        winRatePct: challenger.metrics?.winRatePct ?? challenger.winRatePct ?? 0,
        avgWin: challenger.metrics?.avgWin ?? challenger.avgWin ?? 0,
        avgLoss: challenger.metrics?.avgLoss ?? challenger.avgLoss ?? 0,
      },
      wrJumpDiagnosticThreshold,
      policy: expectancyPolicy,
    });
    gates.expectancy = expectancyGate.passed;
  }

  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const significanceGate = decideSignificanceGate({
    incumbent,
    challenger,
    policy: thresholds?.significance || {},
  });
  gates.significance = significanceGate.passed;
  if (significanceGate.passed === false && !failedGates.includes('significance')) {
    failedGates.push('significance');
  }

  if (failedGates.length === 0 && holdoutGate.status === 'failed') {
    return {
      recommendation: 'hold',
      summary: `Blind holdout failed: ${holdoutGate.reason || 'blind_holdout_failed'}`,
      comparisons,
      gates: { ...gates, holdoutVerdict: false },
      failedGates: ['holdoutVerdict'],
      thresholds: {
        minScoreDelta,
        minRoiDeltaPct,
        minProfitFactorDelta,
        maxDrawdownDeltaPct,
        minTradeCount,
        minTradeRatioVsIncumbent,
        adjusted: adjustedThresholds,
      },
      complexity,
      expectancy: expectancyGate,
      expectancyGate,
      significanceGate,
      holdoutGate,
    };
  }
  if (failedGates.length === 0 && holdoutGate.status === 'pending' && holdoutMode === 'require') {
    return {
      recommendation: 'hold',
      summary: 'Blind holdout verdict required before promotion.',
      comparisons,
      gates: { ...gates, holdoutVerdict: false },
      failedGates: ['holdoutVerdict'],
      thresholds: {
        minScoreDelta,
        minRoiDeltaPct,
        minProfitFactorDelta,
        maxDrawdownDeltaPct,
        minTradeCount,
        minTradeRatioVsIncumbent,
        adjusted: adjustedThresholds,
      },
      complexity,
      expectancy: expectancyGate,
      expectancyGate,
      significanceGate,
      holdoutGate,
    };
  }

  let profitabilityFloor = null;
  if (failedGates.length === 0 && promotionPolicy) {
    profitabilityFloor = evaluateProfitabilityFloor({ incumbent, challenger, policy: promotionPolicy });
    if (!profitabilityFloor.passed) {
      return {
        recommendation: 'hold',
        summary: summarizeProfitabilityFloorFailure(profitabilityFloor),
        comparisons,
        gates: { ...gates, profitabilityFloor: false },
        failedGates: ['profitabilityFloor'],
        thresholds: {
          minScoreDelta,
          minRoiDeltaPct,
          minProfitFactorDelta,
          maxDrawdownDeltaPct,
          minTradeCount,
          minTradeRatioVsIncumbent,
          adjusted: adjustedThresholds,
        },
        complexity,
        expectancy: expectancyGate,
        expectancyGate,
        significanceGate,
        profitabilityFloor,
        holdoutGate,
      };
    }
  }

  const recommendation = failedGates.length === 0 ? 'promote' : 'hold';
  const summary = recommendation === 'promote'
    ? `Promote challenger ${challenger.configId}: all promotion gates passed.`
    : expectancyGate && !expectancyGate.passed
      ? `Hold incumbent ${incumbent.configId}: challenger ${challenger.configId} failed expectancy gate (${expectancyGate.failedGates.join(', ')}).`
      : `Hold incumbent ${incumbent.configId}: challenger ${challenger.configId} failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    comparisons,
    gates: profitabilityFloor ? { ...gates, profitabilityFloor: true } : gates,
    failedGates,
    thresholds: {
      minScoreDelta,
      minRoiDeltaPct,
      minProfitFactorDelta,
      maxDrawdownDeltaPct,
      minTradeCount,
      minTradeRatioVsIncumbent,
      adjusted: adjustedThresholds,
    },
    complexity,
    expectancy: expectancyGate,
    expectancyGate,
    significanceGate,
    profitabilityFloor,
    holdoutGate,
  };
}

export function decideMatrixPromotion({ labResults = [], policy = {}, champion, challenger }) {
  const primary = labResults[0] || null;
  const shadowLabs = labResults.slice(1);
  const shadowPassCount = shadowLabs.filter((item) => item.decision?.recommendation === 'promote').length;
  const allPassCount = labResults.filter((item) => item.decision?.recommendation === 'promote').length;
  const shadowPassRatio = shadowLabs.length > 0 ? round(shadowPassCount / shadowLabs.length, 3) : 0;
  const candidateChanged = !sameConfig(champion?.config, challenger?.config);

  const requirePrimaryPromote = policy.requirePrimaryPromote ?? true;
  const minShadowPassCount = policy.minShadowPassCount ?? 0;
  const minShadowPassRatio = policy.minShadowPassRatio ?? 0;
  const requireCandidateChange = policy.requireCandidateChange ?? true;

  const gates = {
    candidateChanged: requireCandidateChange ? candidateChanged : true,
    primaryPromote: requirePrimaryPromote ? primary?.decision?.recommendation === 'promote' : true,
    shadowPassCount: shadowPassCount >= minShadowPassCount,
    shadowPassRatio: shadowLabs.length > 0 && shadowPassRatio >= minShadowPassRatio,
  };

  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const recommendation = failedGates.length === 0 ? 'promote' : 'hold';
  const summary = !candidateChanged
    ? `No new candidate. Current champion ${champion?.configId} remains best on the pinned matrix.`
    : recommendation === 'promote'
      ? `Promote challenger ${challenger?.configId}: matrix guards passed (${allPassCount}/${labResults.length} labs promote).`
      : `Hold champion ${champion?.configId}: matrix failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    gates,
    failedGates,
    counts: {
      totalLabs: labResults.length,
      shadowLabs: shadowLabs.length,
      allPassCount,
      shadowPassCount,
      shadowPassRatio,
    },
    policy: {
      requirePrimaryPromote,
      minShadowPassCount,
      minShadowPassRatio,
      requireCandidateChange,
    },
  };
}

export function partitionLabs({ primaryLab, shadowLabs = [], blindHoldoutLabs = [] } = {}) {
  return {
    trainingLabs: [primaryLab].filter(Boolean),
    selectionLabs: [primaryLab, ...shadowLabs].filter(Boolean),
    blindHoldoutLabs: [...blindHoldoutLabs].filter(Boolean),
  };
}



export function decideAutoPromotionAction({ latestManifest, historyEvents = [], championState, policy = {}, now = isoNow() }) {
  const safePolicy = policy && typeof policy === 'object' ? policy : {};
  const safeHistoryEvents = Array.isArray(historyEvents) ? historyEvents : [];
  const enabled = safePolicy.enabled ?? false;
  const cooldownHours = safePolicy.cooldownHours ?? 24;
  const maxPromotionsPerDay = safePolicy.maxPromotionsPerDay ?? 1;
  const requireMatrixPromotion = safePolicy.requireMatrixPromotion ?? true;
  const decision = latestManifest?.matrixDecision || latestManifest?.decision || null;
  const candidate = latestManifest?.challenger || null;
  const readiness = assessManifestPromotionReadiness(latestManifest, {
    championState,
    requireMatrixPromotion,
  });
  const lineage = summarizePromotionLineage({
    historyEvents: safeHistoryEvents,
    limit: safePolicy.lineagePolicy?.lookbackPromotions ?? 6,
  });
  const lineageGate = decideLineagePromotionGate({
    candidateFingerprint: latestManifest?.candidateFingerprint ?? latestManifest?.challenger?.candidateFingerprint ?? null,
    candidateFamilyKey: latestManifest?.candidateFamilyKey ?? latestManifest?.challenger?.familyKey ?? null,
    currentChampionFingerprint: latestManifest?.championFingerprint ?? championState?.configFingerprint ?? null,
    currentChampionFamilyKey: latestManifest?.championFamilyKey ?? championState?.familyKey ?? null,
    lineage,
    matrixDecision: decision,
    robustness: latestManifest?.robustness ?? latestManifest?.selectedCandidate?.robustness ?? {},
    policy: safePolicy.lineagePolicy ?? { enabled: false },
  });

  const promotionEvents = safeHistoryEvents.filter((event) => event?.type === 'promote' || event?.type === 'autopromote');
  const lastPromotion = promotionEvents.at(-1) || null;
  const nowMs = Date.parse(now);
  const cooldownPassed = !lastPromotion
    ? true
    : ((nowMs - Date.parse(lastPromotion.timestamp)) / 3600000) >= cooldownHours;
  const dayStart = new Date(nowMs);
  dayStart.setUTCHours(0, 0, 0, 0);
  const promotionsToday = promotionEvents.filter((event) => Date.parse(event.timestamp) >= dayStart.getTime()).length;
  const dailyQuotaPassed = promotionsToday < maxPromotionsPerDay;

  const gates = {
    enabled,
    matrixReady: readiness.gates.matrixReady,
    challengerConfig: readiness.gates.challengerConfig,
    holdoutReady: readiness.gates.holdoutReady,
    promotionReady: readiness.gates.promotionReady,
    lineage: lineageGate.passed,
    candidateChanged: readiness.gates.candidateChanged,
    cooldown: cooldownPassed,
    dailyQuota: dailyQuotaPassed,
  };

  const failedGates = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  const recommendation = failedGates.length === 0 ? 'promote' : 'hold';
  const summary = recommendation === 'promote'
    ? `Auto-promote challenger ${candidate?.configId}: guards passed.`
    : `Auto-promote hold: failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    gates,
    failedGates,
    lineage: lineageGate,
    policy: {
      enabled,
      cooldownHours,
      maxPromotionsPerDay,
      requireMatrixPromotion,
    },
  };
}

function renderLabRowTable(labResults) {
  const lines = [
    '| lab | incumbent | challenger | score Δ | ROI Δ | PF Δ | DD Δ | rec |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ];

  for (const item of labResults || []) {
    lines.push(`| ${item.lab.labId} | ${item.incumbent.configId} | ${item.challenger.configId} | ${item.decision.comparisons?.scoreDelta ?? 0} | ${item.decision.comparisons?.roiDeltaPct ?? 0}% | ${item.decision.comparisons?.profitFactorDelta ?? 0} | ${item.decision.comparisons?.drawdownDeltaPct ?? 0}% | ${item.decision.recommendation} |`);
  }

  return `${lines.join('\n')}\n`;
}

function appendTrackDiagnostics(lines, manifest) {
  lines.push('', '## Track rotation', '');
  lines.push(`- topCandidateSimilarity: ${manifest?.topCandidateSimilarity ?? 'n/a'}`);
  lines.push(`- rotationTrigger: ${manifest?.rotationTrigger ?? 'n/a'}`);
  lines.push(`- sameTrackCycleStreak: ${manifest?.sameTrackCycleStreak ?? 0}`);
  lines.push(`- promotionEligible: ${manifest?.promotionEligible ?? false}`);
  lines.push(`- promotionEligibleReason: ${manifest?.promotionEligibleReason ?? 'n/a'}`);
  lines.push(`- rotationReason: ${manifest?.rotationReason ?? 'n/a'}`);
}

function appendExpectancyDiagnostics(lines, manifest) {
  if (!manifest?.expectancy) return;
  const expectancy = manifest.expectancy;
  lines.push('', '## Expectancy', '');
  lines.push(`- championExpectancy: ${expectancy.champion?.expectancy ?? 'n/a'}`);
  lines.push(`- challengerExpectancy: ${expectancy.challenger?.expectancy ?? 'n/a'}`);
  lines.push(`- avgWinDelta: ${expectancy.delta?.avgWin ?? expectancy.comparisons?.avgWinDelta ?? 'n/a'}`);
  lines.push(`- avgLossDelta: ${expectancy.delta?.avgLoss ?? expectancy.comparisons?.avgLossDelta ?? 'n/a'}`);
  lines.push(`- expectancyDelta: ${expectancy.delta?.expectancy ?? expectancy.comparisons?.expectancyDelta ?? 'n/a'}`);
  lines.push(`- expectancyGate: ${expectancy.gate?.passed === false ? 'hold' : 'pass'}`);
  lines.push(`- wrDecompositionRequired: ${Boolean(expectancy.wrDecompositionRequired)}`);
}

export function renderScoutMarkdown({ config, manifest }) {
  const champion = manifest.champion || manifest.incumbent;
  const challenger = manifest.challenger;
  const decision = manifest.matrixDecision || manifest.decision;
  const steadyState = manifest.researchState?.steadyState || isSteadyStateCandidate(champion, challenger);
  const noChangeStreak = manifest.researchState?.noChangeStreak || 0;
  const bestAlternative = findBestAlternative(manifest.primarySweep, champion);
  const primarySweepSkippedReason = manifest.primarySweep === null
    ? (decision?.reason || manifest.stagnationReason || 'skipped')
    : null;
  const gridName = [manifest.primarySweep?.gridName, manifest.gridName]
    .find((value) => value !== undefined && value !== null && value !== '' && value !== 'undefined') || 'n/a';
  const lines = [
    `# Pine Autoresearch Scout - ${config.matrixId}`,
    '',
    `- Generated: ${manifest.generatedAt}`,
    `- Run ID: ${manifest.runId}`,
    primarySweepSkippedReason
      ? `- Primary sweep: **skipped** (reason: ${primarySweepSkippedReason})`
      : `- Primary run dir: \`${manifest.primarySweep?.runDir || manifest.runDir || 'n/a'}\``,
    `- Grid: \`${gridName}\``,
    `- Primary lab: ${manifest.primaryLab?.labId || config.primaryLab.labId}`,
    '',
    '## Champion',
    '',
    champion ? `- ${champion.configId}` : '- none',
    champion ? `- score ${champion.score}, trades ${champion.tradeCount}, ROI ${champion.roiPct}%, PF ${champion.profitFactor}, max DD ${champion.maxDrawdownPct}%` : '',
    '',
    '## Challenger',
    '',
    steadyState ? '- No new candidate. Latest scout matched the current champion.' : (challenger ? `- ${challenger.configId}` : '- none'),
    challenger ? `- score ${challenger.score}, trades ${challenger.tradeCount}, ROI ${challenger.roiPct}%, PF ${challenger.profitFactor}, max DD ${challenger.maxDrawdownPct}%` : '',
    '',
    '## Matrix decision',
    '',
    `- Recommendation: **${decision?.recommendation?.toUpperCase() || 'N/A'}**`,
    `- ${decision?.summary || 'No matrix decision.'}`,
  ];

  if (steadyState) {
    lines.push('- Mode: **STEADY STATE**');
    if (noChangeStreak > 0) {
      lines.push(`- No new candidate streak: ${noChangeStreak} cycle(s)`);
    }
    if (bestAlternative) {
      lines.push(`- Best alternate tested: ${bestAlternative.configId}`);
      lines.push(`- Best alternate metrics: score ${bestAlternative.score}, trades ${bestAlternative.tradeCount}, ROI ${bestAlternative.roiPct}%, PF ${bestAlternative.profitFactor}, max DD ${bestAlternative.maxDrawdownPct}%`);
      lines.push(`- Alternate delta vs champion: score ${round(bestAlternative.score - (champion?.score ?? 0), 2)}, ROI ${round(bestAlternative.roiPct - (champion?.roiPct ?? 0), 2)}%, PF ${round(bestAlternative.profitFactor - (champion?.profitFactor ?? 0), 2)}, DD ${round(bestAlternative.maxDrawdownPct - (champion?.maxDrawdownPct ?? 0), 2)}%`);
    } else {
      lines.push('- No alternate config beat or differentiated from the current champion in this scout window.');
    }
  }

  if (decision?.counts) {
    lines.push(`- Labs promoting: ${decision.counts.allPassCount}/${decision.counts.totalLabs}`);
    lines.push(`- Shadow pass ratio: ${decision.counts.shadowPassRatio}`);
  }

  if (manifest) {
    appendTrackDiagnostics(lines, manifest);
    appendExpectancyDiagnostics(lines, manifest);
  }

  if (manifest.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${manifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${manifest.searchPlan.exploitRatio}`);
  }

  if (manifest.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of manifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  if (manifest.labResults?.length && !(steadyState && noChangeStreak >= 3)) {
    lines.push('', '## Lab matrix', '', renderLabRowTable(manifest.labResults));
  }

  if (manifest.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${manifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${manifest.searchPlan.exploitRatio}`);
  }

  if (manifest.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of manifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  if (manifest.primarySweep?.topConfigs?.length) {
    lines.push('', '## Primary sweep top configs', '');
    for (const item of manifest.primarySweep.topConfigs) {
      lines.push(`- ${item.configId}: score ${item.score}, trades ${item.tradeCount}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  return `${lines.filter(Boolean).join('\n')}\n`;
}

export function renderDigestMarkdown({ config, latestManifest, previousManifest, historyEvents = [], championState }) {
  const champion = latestManifest?.champion || championState || latestManifest?.incumbent;
  const challenger = latestManifest?.challenger;
  const decision = latestManifest?.matrixDecision || latestManifest?.decision;
  const previous = previousManifest?.challenger;
  const recentEvents = historyEvents.slice(-8).reverse();
  const steadyState = latestManifest?.researchState?.steadyState || isSteadyStateCandidate(champion, challenger);
  const noChangeStreak = latestManifest?.researchState?.noChangeStreak || 0;
  const bestAlternative = findBestAlternative(latestManifest?.primarySweep, champion);

  const lines = [
    `# Pine Autoresearch Digest - ${config.matrixId}`,
    '',
    `- Generated: ${isoNow()}`,
    `- Latest run: ${latestManifest?.runId || 'n/a'}`,
    `- Primary lab: ${config.primaryLab.labId}`,
    `- Shadow labs: ${config.shadowLabs.length}`,
    '',
    '## Current state',
    '',
    champion ? `- Champion: ${champion.configId} (score ${champion.score ?? 'n/a'}, ROI ${champion.roiPct ?? 'n/a'}%)` : '- Champion: n/a',
    steadyState
      ? '- Latest challenger: no new candidate, latest scout matched the current champion'
      : challenger ? `- Latest challenger: ${challenger.configId} (score ${challenger.score}, ROI ${challenger.roiPct}%)` : '- Latest challenger: none',
    decision ? `- Matrix recommendation: **${decision.recommendation.toUpperCase()}**` : '- Matrix recommendation: n/a',
  ];

  if (steadyState) {
    lines.push('- State: **STEADY STATE**');
    if (noChangeStreak > 0) {
      lines.push(`- No new candidate streak: ${noChangeStreak} cycle(s)`);
    }
    if (bestAlternative) {
      lines.push(`- Best alternate tested this cycle: ${bestAlternative.configId} (score ${bestAlternative.score}, ROI ${bestAlternative.roiPct}%)`);
      lines.push(`- Alternate delta vs champion: score ${round(bestAlternative.score - (champion?.score ?? 0), 2)}, ROI ${round(bestAlternative.roiPct - (champion?.roiPct ?? 0), 2)}%`);
    }
  }

  if (decision?.counts) {
    lines.push(`- Promote labs: ${decision.counts.allPassCount}/${decision.counts.totalLabs}`);
    lines.push(`- Shadow pass ratio: ${decision.counts.shadowPassRatio}`);
  }

  if (latestManifest) {
    appendTrackDiagnostics(lines, latestManifest);
    lines.push(`- noNewCandidate: ${Boolean(latestManifest.noNewCandidate)}`);
    lines.push(`- noNewCandidateStreak: ${latestManifest.noNewCandidateStreak ?? 0}`);
    appendExpectancyDiagnostics(lines, latestManifest);
  }

  if (latestManifest?.searchPlan) {
    lines.push('', '## Search plan', '');
    lines.push(`- variantCount: ${latestManifest.searchPlan.variantCount}`);
    lines.push(`- exploitRatio: ${latestManifest.searchPlan.exploitRatio}`);
  }

  if (latestManifest?.paretoShortlist?.length) {
    lines.push('', '## Pareto shortlist', '');
    for (const item of latestManifest.paretoShortlist) {
      lines.push(`- ${item.configId}: score ${item.score}, ROI ${item.roiPct}%, PF ${item.profitFactor}, max DD ${item.maxDrawdownPct}%`);
    }
  }

  if (latestManifest?.labResults?.length) {
    lines.push('', '## Latest matrix', '', renderLabRowTable(latestManifest.labResults));
  }

  if (challenger && previous && (!steadyState || !sameConfig(previous?.config, challenger?.config))) {
    lines.push('', '## Change since previous scout', '');
    lines.push(`- previous challenger: ${previous.configId} (score ${previous.score}, ROI ${previous.roiPct}%)`);
    lines.push(`- latest challenger: ${challenger.configId} (score ${challenger.score}, ROI ${challenger.roiPct}%)`);
    lines.push(`- challenger score delta: ${round(challenger.score - previous.score, 2)}`);
    lines.push(`- challenger ROI delta: ${round(challenger.roiPct - previous.roiPct, 2)}%`);
  } else if (steadyState) {
    lines.push('', '## Change since previous scout', '', '- No challenger change. This loop is currently acting as pinned-matrix regression validation.');
  }

  if (recentEvents.length) {
    lines.push('', '## Recent history', '');
    lines.push('| ts | type | detail |');
    lines.push('| --- | --- | --- |');
    for (const event of recentEvents) {
      lines.push(`| ${event.timestamp} | ${event.type} | ${event.summary || event.toConfigId || event.challengerConfigId || 'n/a'} |`);
    }
  }

  lines.push('', '## Recommendation', '', decision?.summary || 'No decision available.', '');
  return `${lines.join('\n')}\n`;
}

export function renderHistoryMarkdown({ config, championState, historyEvents = [] }) {
  const recent = historyEvents.slice(-20).reverse();
  const lines = [
    `# Pine Autoresearch History - ${config.matrixId}`,
    '',
    championState ? `- Champion: ${championState.configId}` : '- Champion: n/a',
    championState?.promotedAt ? `- Promoted at: ${championState.promotedAt}` : '- Promoted at: n/a',
    '',
    '| ts | type | champion | challenger | recommendation | note |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const event of recent) {
    lines.push(`| ${event.timestamp} | ${event.type} | ${event.championConfigId || event.fromConfigId || 'n/a'} | ${event.challengerConfigId || event.toConfigId || 'n/a'} | ${event.recommendation || 'n/a'} | ${event.summary || event.note || 'n/a'} |`);
  }

  return `${lines.join('\n')}\n`;
}

export function summarizeDigestAnnouncement({ latestManifest, previousManifest }) {
  const decision = latestManifest?.matrixDecision || latestManifest?.decision;
  const latest = latestManifest?.challenger;
  const previous = previousManifest?.challenger;
  const champion = latestManifest?.champion || latestManifest?.incumbent;
  const steadyState = latestManifest?.researchState?.steadyState || isSteadyStateCandidate(champion, latest);
  if (!latest || !decision) {
    return 'pine autoresearch digest: no challenger data yet';
  }

  if (steadyState) {
    const parts = [
      'pine autoresearch steady-state',
      `champion ${champion?.configId || 'n/a'}`,
      `score ${champion?.score ?? 'n/a'}`,
      `ROI ${champion?.roiPct ?? 'n/a'}%`,
    ];

    if (latestManifest?.researchState?.noChangeStreak) {
      parts.push(`streak ${latestManifest.researchState.noChangeStreak}`);
    }

    return parts.join(' | ');
  }

  const parts = [
    `pine autoresearch ${decision.recommendation}`,
    `${latest.configId}`,
    `score ${latest.score}`,
    `ROI ${latest.roiPct}%`,
  ];

  if (decision.counts) {
    parts.push(`labs ${decision.counts.allPassCount}/${decision.counts.totalLabs}`);
  }

  if (latestManifest?.expectancy) {
    parts.push(`exp ${latestManifest.expectancy.challenger?.expectancy ?? 'n/a'} vs ${latestManifest.expectancy.champion?.expectancy ?? 'n/a'}`);
  }

  if (previous) {
    parts.push(`prev ${previous.configId} score ${previous.score}`);
  }

  return parts.join(' | ');
}

export {
  buildRegimeAnalysisArtifact,
  buildRegimeAnalysisMarkdown,
  classifyRegimeFromFeatures,
  detectThresholdAsymmetry,
  summarizeRegimeSlices,
  summarizeSideMetrics,
} from './pine-regime-analysis.mjs';
