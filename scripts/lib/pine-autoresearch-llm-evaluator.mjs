import path from 'node:path';

import {
  ensureChampionState,
  evaluateMatrix,
  loadConfig as loadAutoresearchConfig,
} from '../pine-autoresearch.mjs';
import {
  configFingerprint,
  isoNow,
  timestampId,
  writeJson,
} from './pine-autoresearch.mjs';

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildLlmChallengerSummary({ championState, candidate, candidateFingerprint } = {}) {
  if (!championState?.config || typeof championState.config !== 'object') {
    throw new Error('championState.config required');
  }
  if (!candidate?.patch || typeof candidate.patch !== 'object' || Array.isArray(candidate.patch)) {
    throw new Error('candidate.patch required');
  }
  if (!candidateFingerprint) {
    throw new Error('candidateFingerprint required');
  }

  const patch = { ...candidate.patch };
  const config = { ...championState.config, ...patch };
  const configHash = configFingerprint(config);
  const shortCandidate = String(candidateFingerprint).slice(0, 12);
  const shortConfig = String(configHash).slice(0, 12);

  return {
    label: `llm-${shortCandidate}`,
    configId: `llm-${shortConfig}`,
    source: 'llm',
    parentConfigId: championState.configId ?? championState.label ?? null,
    parentConfigFingerprint: configFingerprint(championState.config),
    candidateFingerprint,
    patch,
    rationale: candidate.rationale ?? candidate.hypothesis ?? null,
    config,
  };
}

export function summarizeLlmMatrixDelta({ labResults = [], matrixDecision = null } = {}) {
  const promotedLabCount = labResults.filter((item) => item?.decision?.recommendation === 'promote').length;

  return {
    recommendation: matrixDecision?.recommendation ?? null,
    summary: matrixDecision?.summary ?? null,
    labCount: labResults.length,
    promotedLabCount,
    aggregateScoreDelta: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.scoreDelta ?? 0), 0)),
    aggregateRoiDeltaPct: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.roiDeltaPct ?? 0), 0)),
    aggregateProfitFactorDelta: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.profitFactorDelta ?? 0), 0)),
    aggregateDrawdownDeltaPct: round(labResults.reduce((sum, item) => sum + (item?.decision?.comparisons?.drawdownDeltaPct ?? 0), 0)),
  };
}

export function shouldEnqueueLlmCandidate({ matrixDecision } = {}) {
  return matrixDecision?.recommendation === 'promote';
}

function summarizeLlmLabResultForManifest(result) {
  if (!result || typeof result !== 'object') return result;
  const { analysis, ...summary } = result;
  return summary;
}

function summarizeLlmLabResultsForManifest(labResults = []) {
  return labResults.map((result) => summarizeLlmLabResultForManifest(result));
}

export async function writeLlmEvaluationManifest({
  baseConfig,
  runId,
  championState,
  challengerSummary,
  labResults,
  matrixDecision,
  evaluationManifestPath,
} = {}) {
  if (!baseConfig?.matrixId) throw new Error('baseConfig.matrixId required');
  if (!baseConfig?.researchRoot) throw new Error('baseConfig.researchRoot required');
  if (!runId) throw new Error('runId required');
  if (!challengerSummary?.config) throw new Error('challengerSummary.config required');

  const manifestPath = evaluationManifestPath
    ?? path.join(baseConfig.researchRoot, 'manifests', `${runId}.json`);

  const generatedAt = isoNow();
  const manifestLabResults = summarizeLlmLabResultsForManifest(labResults);
  const manifest = {
    lane: 'llm-evaluator-bridge',
    generatedAt,
    runId,
    matrixId: baseConfig.matrixId,
    champion: championState,
    challenger: challengerSummary,
    matrixCandidates: [{
      challenger: challengerSummary,
      labResults: manifestLabResults,
      matrixDecision,
      robustness: summarizeLlmMatrixDelta({ labResults, matrixDecision }),
    }],
    labResults: manifestLabResults,
    matrixDecision,
    promotionEligible: shouldEnqueueLlmCandidate({ matrixDecision }),
    promotionEligibleReason: matrixDecision?.summary ?? null,
    noNewCandidate: false,
  };

  await writeJson(manifestPath, manifest);
  return { manifestPath, manifest };
}

export async function executeLlmMatrixCandidate({
  candidate,
  candidateFingerprint,
  config,
  repoRoot = process.cwd(),
  loadBaseConfig = loadAutoresearchConfig,
  loadChampionState = ensureChampionState,
  evaluateMatrixCandidate = evaluateMatrix,
  nowId = timestampId,
} = {}) {
  if (!candidate?.patch || typeof candidate.patch !== 'object') {
    return { ok: false, reason: 'missing_candidate_patch' };
  }
  if (!candidateFingerprint) {
    return { ok: false, reason: 'missing_candidate_fingerprint' };
  }

  const baseConfigPath = config?.baseConfigPath ?? './config/pine-autoresearch.default.json';
  const baseConfig = await loadBaseConfig(repoRoot, baseConfigPath, config?.execution?.baseOverrides ?? {});
  const championState = await loadChampionState(baseConfig);
  const challengerSummary = buildLlmChallengerSummary({ championState, candidate, candidateFingerprint });
  const runId = `llm-${baseConfig.matrixId}-${nowId()}-${String(candidateFingerprint).slice(0, 12)}`;

  const { labResults, matrixDecision } = await evaluateMatrixCandidate(
    baseConfig,
    runId,
    championState,
    challengerSummary,
  );

  const metricsDelta = summarizeLlmMatrixDelta({ labResults, matrixDecision });
  const { manifestPath: evaluationManifestPath } = await writeLlmEvaluationManifest({
    baseConfig,
    runId,
    championState,
    challengerSummary,
    labResults,
    matrixDecision,
  });

  return {
    ok: true,
    runId,
    evaluationManifestPath,
    metricsDelta,
    matrixDecision,
    labResults,
    promotable: shouldEnqueueLlmCandidate({ matrixDecision }),
  };
}
