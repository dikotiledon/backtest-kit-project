import { sharedKnobKeys as tunerSharedKnobKeys, trackOwnKnobKeys as tunerTrackOwnKnobKeys } from './pine-tuner.mjs';
import { computeAnnealingState } from './pine-search-policy.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveTrackFamily(track = {}) {
  const trackId = String(track?.trackId ?? track?.id ?? track?.name ?? '').toLowerCase();
  const sourceFamily = String(track?.sourceFamily ?? track?.family ?? '').toLowerCase();
  const candidate = sourceFamily || trackId;
  if (candidate.includes('squeeze')) return 'squeeze';
  if (candidate.includes('divergence')) return 'divergence';
  if (candidate.includes('exit')) return 'exit-state';
  if (candidate.includes('asym')) return 'asymmetry';
  if (candidate.includes('incumbent')) return 'incumbent-local';
  return candidate || 'incumbent-local';
}

function countCycles(historyEvents = []) {
  return historyEvents.filter((event) => event?.type === 'cycle').length;
}

function numeric(value, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function lowerBound(value, minValue) {
  return Math.max(minValue, numeric(value, minValue));
}

function applyPatch(base, patch) {
  return { ...clone(base), ...clone(patch) };
}

function buildMetadata({ trackId, family, index, patch, config, lane }) {
  const shared = sharedKnobKeys();
  const own = trackOwnKnobKeys(family);
  const patchKeys = Object.keys(patch);
  return {
    variantId: `${String(family || trackId)}-${String(index + 1).padStart(2, '0')}`,
    family,
    lane,
    patch: clone(patch),
    sharedKeys: patchKeys.filter((key) => shared.includes(key)),
    ownKeys: patchKeys.filter((key) => own.includes(key)),
    config,
  };
}

function squeezePatches(base) {
  return [
    {
      useSqueezeContext: true,
      squeezeLength: lowerBound((base.squeezeLength ?? 20) - 4, 2),
      minPredSum: lowerBound((base.minPredSum ?? 2) - 0.5, 0.5),
    },
    {
      useSqueezeContext: true,
      squeezeBbMult: numeric(base.squeezeBbMult ?? 2) + 0.5,
      minBarsBetween: lowerBound((base.minBarsBetween ?? 2) + 1, 0),
    },
    {
      useSqueezeContext: true,
      squeezeKcMult: numeric(base.squeezeKcMult ?? 1.5) + 0.5,
      slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25),
    },
    {
      useSqueezeContext: true,
      squeezeReleaseFreshBars: lowerBound((base.squeezeReleaseFreshBars ?? 4) + 2, 1),
      tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5,
    },
    {
      useSqueezeContext: true,
      squeezeBoostValue: numeric(base.squeezeBoostValue ?? 0.25) + 0.25,
      trailActivateR: numeric(base.trailActivateR ?? 0.5) + 0.5,
    },
  ];
}

function divergencePatches(base) {
  return [
    {
      useDivergenceContext: true,
      divRsiLen: lowerBound((base.divRsiLen ?? 14) + 7, 1),
      minPredSum: lowerBound((base.minPredSum ?? 2) - 0.5, 0.5),
    },
    {
      useDivergenceContext: true,
      divPivotLeft: lowerBound((base.divPivotLeft ?? 5) - 2, 1),
      divPivotRight: lowerBound((base.divPivotRight ?? 5) - 2, 1),
      minBarsBetween: lowerBound((base.minBarsBetween ?? 2) + 1, 0),
    },
    {
      useDivergenceContext: true,
      divFreshBars: lowerBound((base.divFreshBars ?? 6) + 2, 1),
      slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25),
    },
    {
      useDivergenceContext: true,
      divLongBoostValue: numeric(base.divLongBoostValue ?? 0.25) + 0.25,
      divShortBoostValue: numeric(base.divShortBoostValue ?? 0.25) + 0.25,
      tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5,
    },
    {
      useDivergenceContext: true,
      divCautionPenaltyValue: numeric(base.divCautionPenaltyValue ?? 0) + 0.25,
      trailActivateR: numeric(base.trailActivateR ?? 0.5) + 0.5,
    },
  ];
}

function exitStatePatches(base) {
  return [
    {
      useTimeStop: true,
      timeStopBars: 8,
    },
    {
      useTimeStop: true,
      timeStopBars: 16,
    },
    {
      useTimeStop: true,
      timeStopBars: 12,
    },
  ];
}

function asymmetryPatches(base) {
  return [
    {
      useRegimeFilter: true,
      regimeThreshold: Math.min(numeric(base.regimeThreshold ?? -0.1) - 0.4, -0.5),
      useAdxFilter: true,
      adxThreshold: lowerBound((base.adxThreshold ?? 20) - 5, 1),
    },
    {
      useRegimeFilter: true,
      regimeThreshold: numeric(base.regimeThreshold ?? -0.1) + 0.4,
      useAdxFilter: true,
      adxThreshold: numeric(base.adxThreshold ?? 20) + 5,
      minPredSum: lowerBound((base.minPredSum ?? 2) - 0.25, 0.5),
    },
    {
      regimeThreshold: 0.5,
      useAdxFilter: true,
      adxThreshold: numeric(base.adxThreshold ?? 20) + 2,
      minBarsBetween: lowerBound((base.minBarsBetween ?? 2) + 1, 0),
    },
  ];
}

function incumbentLocalPatches(base) {
  return [
    {
      minPredSum: lowerBound((base.minPredSum ?? 2) - 0.5, 0.5),
      minBarsBetween: lowerBound((base.minBarsBetween ?? 2) - 1, 0),
    },
    {
      slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25),
      tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5,
    },
    {
      trailAtrMult: Math.max(0.5, numeric(base.trailAtrMult ?? 1) - 0.25),
      trailActivateR: numeric(base.trailActivateR ?? 0.5) + 0.5,
    },
  ];
}

function getPatchPool(family, base) {
  if (family === 'squeeze') return squeezePatches(base);
  if (family === 'divergence') return divergencePatches(base);
  if (family === 'exit-state') return exitStatePatches(base);
  if (family === 'asymmetry') return asymmetryPatches(base);
  return incumbentLocalPatches(base);
}

function extractPatchObject(patch = {}) {
  if (!isPlainObject(patch)) return {};
  if (isPlainObject(patch.values)) return patch.values;
  if (isPlainObject(patch.patch)) return patch.patch;
  if (isPlainObject(patch.changes)) return patch.changes;
  return patch;
}

export function sharedKnobKeys() {
  return tunerSharedKnobKeys();
}

export function trackOwnKnobKeys(trackId) {
  return tunerTrackOwnKnobKeys(trackId);
}

export function validateTrackPatch({ trackId, patch }) {
  const family = resolveTrackFamily({ trackId });
  const allowed = new Set([...sharedKnobKeys(), ...trackOwnKnobKeys(family)]);
  const rawPatch = extractPatchObject(patch);
  const invalid = Object.keys(rawPatch).filter((key) => !allowed.has(key));
  if (invalid.length > 0) {
    throw new Error(`Track ${family} cannot mutate ${invalid.join(', ')}`);
  }
  return rawPatch;
}

export function buildTrackCandidateBatch({ track, incumbent, maxConfigs, historyEvents = [], budgetPolicy = {}, schedulerState = {} }) {
  const normalizedTrack = isPlainObject(track) ? track : { trackId: track };
  const trackId = String(normalizedTrack.trackId ?? normalizedTrack.id ?? normalizedTrack.name ?? 'track');
  const family = resolveTrackFamily(normalizedTrack);
  const base = clone(incumbent || {});
  const limit = Math.max(0, Number(maxConfigs) || 0);
  if (limit === 0) return [];

  const pool = getPatchPool(family, base);
  const offset = countCycles(historyEvents) % Math.max(pool.length, 1);
  const trackLimit = Math.max(0, Math.min(limit, pool.length));
  const batch = [];

  for (let index = 0; index < trackLimit; index++) {
    const patch = clone(pool[(offset + index) % pool.length]);
    validateTrackPatch({ trackId, patch });
    batch.push(buildMetadata({
      trackId,
      family,
      index,
      patch,
      lane: 'track',
      config: applyPatch(base, patch),
    }));
  }

  const includeFallback = budgetPolicy.includeFallback === true && batch.length < limit;
  if (includeFallback) {
    const fallbackPool = incumbentLocalPatches(base);
    const fallbackLimit = Math.min(limit - batch.length, fallbackPool.length);
    for (let index = 0; index < fallbackLimit; index++) {
      const { patch, tabuSkipped } = selectNonTabuPatch({
        base,
        pool: fallbackPool,
        offset,
        index,
        tabuSet,
        temperature: annealingState.temperature,
      });
      validateTrackPatch({ trackId: 'incumbent-local', patch });
      batch.push(buildMetadata({
        trackId: 'incumbent-local',
        family: 'incumbent-local',
        index: batch.length,
        patch,
        lane: 'fallback',
        config: applyPatch(base, patch),
      }));
    }
  }

  return batch.slice(0, limit);
}
