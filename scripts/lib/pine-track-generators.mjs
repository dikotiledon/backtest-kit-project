import { sharedKnobKeys as tunerSharedKnobKeys, trackOwnKnobKeys as tunerTrackOwnKnobKeys } from './pine-tuner.mjs';
import { computeAnnealingState } from './pine-search-policy.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (isPlainObject(value)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function configFingerprint(config) {
  return JSON.stringify(stableValue(config || {}));
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

function normalizeTabuCache(value) {
  if (Array.isArray(value)) return new Set(value);
  if (value && typeof value === 'object') return new Set(Object.keys(value));
  return new Set();
}

function scalePatch(base, patch, temperature) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    const baseValue = Number(base[key]);
    if (typeof value !== 'number' || !Number.isFinite(baseValue)) return [key, value];
    const minValue = key.toLowerCase().includes('len') || key.toLowerCase().includes('bars') || key === 'neighborsCount' ? 1 : 0;
    const scaled = Math.max(minValue, baseValue + ((value - baseValue) * temperature));
    const integerLike = Number.isInteger(baseValue) && Number.isInteger(value);
    return [key, integerLike ? Math.round(scaled) : Number(scaled.toFixed(4))];
  }));
}

function buildMetadata({ trackId, family, index, patch, config, lane, temperature = 1, tabuSkipped = 0 }) {
  const shared = sharedKnobKeys();
  const own = trackOwnKnobKeys(family);
  const patchKeys = Object.keys(patch);
  const metadata = {
    variantId: `${String(family || trackId)}-${String(index + 1).padStart(2, '0')}`,
    family,
    lane,
    patch: clone(patch),
    sharedKeys: patchKeys.filter((key) => shared.includes(key)),
    ownKeys: patchKeys.filter((key) => own.includes(key)),
    temperature,
    tabuSkipped,
    config,
  };
  if (lane === 'self-loop-fallback') metadata.trackId = trackId;
  return metadata;
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

function getFallbackPatchPool(families = [], base = {}) {
  const normalizedFamilies = Array.isArray(families) && families.length > 0
    ? families.map((item) => String(item).toLowerCase())
    : ['signal', 'risk'];
  const pools = {
    signal: [
      { minPredSum: lowerBound((base.minPredSum ?? 2) - 0.5, 0.5) },
      { minPredSum: numeric(base.minPredSum ?? 2) + 0.5 },
      { minBarsBetween: lowerBound((base.minBarsBetween ?? 2) - 1, 0) },
      { minBarsBetween: numeric(base.minBarsBetween ?? 2) + 2 },
      {
        minPredSum: lowerBound((base.minPredSum ?? 2) - 0.25, 0.5),
        minBarsBetween: lowerBound((base.minBarsBetween ?? 2) - 1, 0),
      },
      {
        minPredSum: numeric(base.minPredSum ?? 2) + 0.25,
        minBarsBetween: numeric(base.minBarsBetween ?? 2) + 2,
      },
    ],
    risk: [
      { slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25) },
      { slAtrMult: numeric(base.slAtrMult ?? 1) + 0.25 },
      { tpAtrMult: lowerBound((base.tpAtrMult ?? 2.5) - 0.5, 0.5) },
      { tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5 },
      { trailAtrMult: Math.max(0.5, numeric(base.trailAtrMult ?? 1) - 0.25) },
      { trailActivateR: numeric(base.trailActivateR ?? 0.5) + 0.5 },
    ],
  };

  return normalizedFamilies.flatMap((family) => (pools[family] || []).map((patch) => ({ family, patch })));
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
  const batch = [];
  const annealingState = computeAnnealingState({ schedulerState, policy: budgetPolicy });
  const temperature = annealingState.temperature;
  const selfLoopEscape = budgetPolicy.selfLoopEscape || {};
  const includeSelfLoopFallback = selfLoopEscape.includeFallback === true || budgetPolicy.includeFallback === true;
  const includeFallback = budgetPolicy.includeFallback === true;
  const escapeActive = selfLoopEscape.enabled === true
    && (schedulerState.noNewCandidateStreak ?? 0) >= (selfLoopEscape.activateAfter ?? 1);
  const fallbackFamilies = Array.isArray(selfLoopEscape.fallbackFamilies) && selfLoopEscape.fallbackFamilies.length > 0
    ? selfLoopEscape.fallbackFamilies
    : ['signal', 'risk'];
  const minFallbackConfigs = Math.max(0, Number(selfLoopEscape.minFallbackConfigs ?? 3) || 0);
  const selfLoopFallbackPool = escapeActive && includeSelfLoopFallback ? getFallbackPatchPool(fallbackFamilies, base) : [];
  const trackLimit = Math.max(0, Math.min(limit, pool.length));
  const tabuSet = normalizeTabuCache(schedulerState.tabuRejectedFingerprints);
  let tabuSkipped = 0;

  for (let probe = 0; probe < pool.length && batch.length < trackLimit; probe++) {
    const rawPatch = clone(pool[(offset + probe) % pool.length]);
    const patch = scalePatch(base, rawPatch, temperature);
    validateTrackPatch({ trackId, patch });
    const config = applyPatch(base, patch);
    const fingerprint = configFingerprint(config);
    if (tabuSet.has(fingerprint)) {
      tabuSkipped += 1;
      continue;
    }
    tabuSet.add(fingerprint);
    batch.push(buildMetadata({
      trackId,
      family,
      index: batch.length,
      patch,
      lane: 'track',
      temperature,
      tabuSkipped,
      config,
    }));
    tabuSkipped = 0;
  }

  if (escapeActive && includeSelfLoopFallback) {
    const fallbackCandidates = [];
    const temperatureBoost = Number.isFinite(Number(selfLoopEscape.temperatureBoost))
      ? Number(selfLoopEscape.temperatureBoost)
      : 1.5;
    const fallbackTemperature = Number((Math.max(1, temperature) * Math.max(1, temperatureBoost)).toFixed(4));
    let fallbackSkipped = 0;
    for (let probe = 0; probe < selfLoopFallbackPool.length && fallbackCandidates.length < limit; probe++) {
      const { family: fallbackFamily, patch: rawPatch } = selfLoopFallbackPool[(offset + probe) % selfLoopFallbackPool.length];
      const scaledPatch = scalePatch(base, clone(rawPatch), fallbackTemperature);
      let patch;
      try {
        patch = validateTrackPatch({ trackId: 'incumbent-local', patch: scaledPatch });
      } catch {
        continue;
      }
      const config = applyPatch(base, patch);
      const fingerprint = configFingerprint(config);
      if (tabuSet.has(fingerprint)) {
        fallbackSkipped += 1;
        continue;
      }
      tabuSet.add(fingerprint);
      fallbackCandidates.push(buildMetadata({
        trackId: 'incumbent-local',
        family: fallbackFamily,
        index: fallbackCandidates.length,
        patch,
        lane: 'self-loop-fallback',
        temperature: fallbackTemperature,
        tabuSkipped: fallbackSkipped,
        config,
      }));
      fallbackSkipped = 0;
    }

    const fallbackLimit = Math.min(limit, minFallbackConfigs, fallbackCandidates.length);
    const trackCandidates = batch.slice(0, limit - fallbackLimit);
    const preferredFallback = fallbackCandidates.slice(0, fallbackLimit);
    const composed = [...trackCandidates, ...preferredFallback];
    if (composed.length < limit) {
      composed.push(...fallbackCandidates.slice(fallbackLimit, fallbackLimit + limit - composed.length));
    }
    if (composed.length < limit) {
      composed.push(...batch.slice(trackCandidates.length, trackCandidates.length + limit - composed.length));
    }
    return composed.slice(0, limit).map((item, index) => ({ ...item, index }));
  } else if (includeFallback && batch.length < limit) {
    const fallbackPool = incumbentLocalPatches(base);
    const fallbackLimit = Math.min(limit - batch.length, fallbackPool.length);
    let fallbackSkipped = 0;
    for (let probe = 0; probe < fallbackPool.length && batch.filter((item) => item.lane === 'fallback').length < fallbackLimit; probe++) {
      const rawPatch = clone(fallbackPool[(offset + probe) % fallbackPool.length]);
      const patch = scalePatch(base, rawPatch, temperature);
      validateTrackPatch({ trackId: 'incumbent-local', patch });
      const config = applyPatch(base, patch);
      const fingerprint = configFingerprint(config);
      if (tabuSet.has(fingerprint)) {
        fallbackSkipped += 1;
        continue;
      }
      tabuSet.add(fingerprint);
      batch.push(buildMetadata({
        trackId: 'incumbent-local',
        family: 'incumbent-local',
        index: batch.length,
        patch,
        lane: 'fallback',
        temperature,
        tabuSkipped: fallbackSkipped,
        config,
      }));
      fallbackSkipped = 0;
    }
  }

  return batch.slice(0, limit);
}
