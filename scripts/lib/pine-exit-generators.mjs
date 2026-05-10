import { createHash } from 'node:crypto';

import { filterNovelLaneCandidates } from './pine-lane-novelty.mjs';
import { buildSurfaceMutationCandidates, parameterSurfaceCatalog } from './pine-parameter-surface.mjs';

export const PARTIAL_TAKE_PROFIT_STATUS = 'blockedByPineFeasibility';

export const SUPPORTED_EXIT_PATCH_KEYS = [
  'useStopsTP', 'riskAtrLen', 'slAtrMult', 'tpAtrMult',
  'useSignalExits', 'useTrailingStop', 'trailAtrLen', 'trailAtrMult', 'trailActivateR',
  'useFailedFollowThroughTighten', 'followThroughBars', 'followThroughMinProgressAtr', 'followThroughTightenTrailAtrMult',
  'useTimeStop', 'timeStopBars', 'timeStopMinUnrealizedAtr',
  'useContextCautionTighten', 'contextCautionDelta', 'contextCautionTrailAtrMult',
  'usePostEntrySqueezeCollapseTighten', 'postEntrySqueezeCollapseBars', 'postEntrySqueezeCollapseTrailAtrMult',
  'useAdverseDivergenceTighten', 'adverseDivergenceBars', 'adverseDivergenceTrailAtrMult',
];

export const BLOCKED_EXIT_FAMILIES = {
  'breakeven-stop': 'unsupportedByPipeline',
  'time-stop': 'unsupportedByPipeline',
  'long-short-asymmetry': 'unsupportedByPipeline',
  'partial-take-profit': PARTIAL_TAKE_PROFIT_STATUS,
};

const EXIT_SURFACE_FAMILIES = ['risk', 'exit', 'exit-state'];
const SUPPORTED_KEYS = new Set(SUPPORTED_EXIT_PATCH_KEYS);
const SURFACE_SPEC_BY_KEY = new Map(
  parameterSurfaceCatalog({ families: EXIT_SURFACE_FAMILIES })
    .filter((spec) => SUPPORTED_KEYS.has(spec.key))
    .map((spec) => [spec.key, spec]),
);
const BOOLEAN_KEYS = new Set(SUPPORTED_EXIT_PATCH_KEYS.filter((key) => key.startsWith('use')));

function compareCodePoints(left, right) {
  if (left === right) return 0;
  const leftPoints = Array.from(String(left));
  const rightPoints = Array.from(String(right));
  const limit = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < limit; index += 1) {
    const leftCodePoint = leftPoints[index].codePointAt(0);
    const rightCodePoint = rightPoints[index].codePointAt(0);
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }

  return leftPoints.length - rightPoints.length;
}

function canonicalPatch(patch) {
  return Object.fromEntries(Object.entries(patch).sort(([left], [right]) => compareCodePoints(left, right)));
}

function buildCandidateId({ exitFamily, regimeSliceId, patch }) {
  const canon = canonicalPatch(patch);
  const payload = JSON.stringify({ exitFamily, regimeSliceId: regimeSliceId ?? null, patch: canon });
  return createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

function normalizeMaxConfigs(maxConfigs) {
  if (maxConfigs === undefined || maxConfigs === null) return 5;
  const parsed = Number(maxConfigs);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(0, Math.floor(parsed));
}

function axisPriority(candidate) {
  const index = SUPPORTED_EXIT_PATCH_KEYS.indexOf(candidate?.metadata?.axis);
  return index === -1 ? SUPPORTED_EXIT_PATCH_KEYS.length : index;
}

function prioritizeFirstPassByAxis(candidates) {
  const remaining = [...candidates];
  const prioritized = [];
  const seenAxes = new Set();

  for (const key of SUPPORTED_EXIT_PATCH_KEYS) {
    const index = remaining.findIndex((candidate) => candidate?.metadata?.axis === key && !seenAxes.has(key));
    if (index === -1) continue;
    const [candidate] = remaining.splice(index, 1);
    prioritized.push(candidate);
    seenAxes.add(key);
  }

  remaining.sort((left, right) => axisPriority(left) - axisPriority(right));
  return [...prioritized, ...remaining];
}

export function validateExitPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'patch must be an object' };
  }

  for (const key of Object.keys(patch)) {
    if (!SUPPORTED_KEYS.has(key) || !SURFACE_SPEC_BY_KEY.has(key)) {
      return { ok: false, reason: 'unsupportedExitPatchKey', key };
    }

    const value = patch[key];
    const spec = SURFACE_SPEC_BY_KEY.get(key);
    if (BOOLEAN_KEYS.has(key) || spec.type === 'bool') {
      if (typeof value !== 'boolean') {
        return { ok: false, reason: `${key} must be boolean` };
      }
      continue;
    }

    if (!Number.isFinite(value)) {
      return { ok: false, reason: `${key} must be finite` };
    }

    if (spec.type === 'int' && !Number.isInteger(value)) {
      return { ok: false, reason: `${key} must be integer` };
    }

    if (Number.isFinite(spec.min) && value < spec.min) {
      return { ok: false, reason: `${key} out of range` };
    }

    if (Number.isFinite(spec.max) && value > spec.max) {
      return { ok: false, reason: `${key} out of range` };
    }
  }

  return { ok: true };
}

function sourceConfig(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) return source.config;
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  return {};
}

function normalizeBase(source) {
  const config = sourceConfig(source);
  return { config };
}

export function buildExitFamilyCandidates({ incumbent, champion, regimeSliceId, maxConfigs, testedPatchFingerprints } = {}) {
  const limit = normalizeMaxConfigs(maxConfigs);
  if (limit === 0) return [];

  const source = incumbent ?? champion;
  const base = normalizeBase(source);
  const rawCandidates = buildSurfaceMutationCandidates({
    champion: source,
    maxConfigs: limit * 6,
    families: EXIT_SURFACE_FAMILIES,
    levels: 6,
  })
    .map((item) => {
      const patch = canonicalPatch(item.patch);
      const exitFamily = item.family === 'risk' ? 'atr-stop-take-profit' : item.family;
      const candidateId = buildCandidateId({ exitFamily, regimeSliceId, patch });
      return {
        candidateId,
        lane: 'exitRegime',
        family: item.family,
        mutationFamily: item.family,
        exitFamily,
        regimeSliceId,
        patch,
        variantId: `exit-regime-${item.family}-${item.axis}-${candidateId}`,
        config: { ...base.config, ...patch },
        metadata: {
          ...(item.metadata || {}),
          axis: item.axis,
          partialTakeProfit: PARTIAL_TAKE_PROFIT_STATUS,
          blockedFamilies: BLOCKED_EXIT_FAMILIES,
          ...(source?.id ? { originConfigId: source.id } : {}),
        },
      };
    })
    .filter((item) => validateExitPatch(item.patch).ok);

  return filterNovelLaneCandidates({
    candidates: prioritizeFirstPassByAxis(rawCandidates),
    champion: source,
    lane: 'exitRegime',
    testedPatchFingerprints,
  }).slice(0, limit);
}
