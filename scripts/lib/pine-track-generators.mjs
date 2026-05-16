import { sharedKnobKeys as tunerSharedKnobKeys, trackOwnKnobKeys as tunerTrackOwnKnobKeys } from './pine-tuner.mjs';
import { buildCanonicalConfigFingerprint, buildChampionConfigFingerprint } from './pine-global-search.mjs';
import { computeAnnealingState, normalizeTabuFingerprintSet } from './pine-search-policy.mjs';
import { buildLanePatchFingerprint, LANE_PATCH_FINGERPRINT_VERSION } from './pine-lane-novelty.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configFingerprint(config) {
  return buildCanonicalConfigFingerprint(config || {});
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
  if (candidate.includes('context-exit-shaping') || (candidate.includes('context') && candidate.includes('exit') && candidate.includes('shaping'))) return 'context-exit-shaping';
  if (candidate.includes('exit')) return 'exit-state';
  if (candidate.includes('asym')) return 'asymmetry';
  if (candidate.includes('supertrend')) return 'supertrend';
  if (candidate.includes('ml-core') || candidate.includes('mlcore')) return 'ml-core';
  if (candidate.includes('fusion')) return 'fusion';
  if (candidate.includes('avwap')) return 'avwap-context';
  if (candidate.includes('channel')) return 'channel-context';
  if (candidate.includes('aggregator')) return 'context-aggregator';
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

function patchMinValue(key) {
  const lowerKey = String(key).toLowerCase();
  if (lowerKey.includes('weight')) return Number.NEGATIVE_INFINITY;
  if (key === 'regimeThreshold') return Number.NEGATIVE_INFINITY;
  if (key === 'minBarsBetween' || key === 'trailActivateR') return 0;
  if (key === 'minPredSum') return 0.5;
  if (key === 'r') return 0.1;
  if (lowerKey.includes('absprediction')) return 0;
  if (lowerKey.includes('score') || lowerKey.includes('boost') || lowerKey.includes('penalty')) return 0;
  if (lowerKey.includes('threshold')) return 0;
  if (lowerKey.includes('factor') || lowerKey.includes('distance') || lowerKey.includes('mult')) return 0.1;
  if (
    key === 'h'
    || key === 'x'
    || key === 'lag'
    || lowerKey.includes('len')
    || lowerKey.includes('length')
    || lowerKey.includes('period')
    || lowerKey.includes('bars')
    || lowerKey.includes('fresh')
    || lowerKey.includes('count')
    || lowerKey.includes('left')
    || lowerKey.includes('right')
    || lowerKey.includes('stride')
    || lowerKey.includes('cap')
  ) return 1;
  return Number.NEGATIVE_INFINITY;
}

function scalePatch(base, patch, temperature) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    const baseValue = Number(base[key]);
    if (typeof value !== 'number' || !Number.isFinite(baseValue)) return [key, value];
    const minValue = patchMinValue(key);
    const scaled = Math.max(minValue, baseValue + ((value - baseValue) * temperature));
    const integerLike = Number.isInteger(baseValue) && Number.isInteger(value);
    const rounded = integerLike ? Math.round(scaled) : Number(scaled.toFixed(4));
    return [key, Math.max(minValue, rounded)];
  }));
}

function buildMetadata({ trackId, family, index, patch, config, baseConfig, lane, temperature = 1, tabuSkipped = 0 }) {
  const shared = sharedKnobKeys();
  const own = trackOwnKnobKeys(family);
  const patchKeys = Object.keys(patch);
  const patchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint: buildChampionConfigFingerprint(baseConfig || config || {}),
    lane,
    mutationFamily: family,
    patch,
  });
  const metadata = {
    variantId: `${String(family || trackId)}-${String(index + 1).padStart(2, '0')}`,
    family,
    lane,
    patch: clone(patch),
    patchFingerprint,
    patchFingerprintVersion: LANE_PATCH_FINGERPRINT_VERSION,
    sharedKeys: patchKeys.filter((key) => shared.includes(key)),
    ownKeys: patchKeys.filter((key) => own.includes(key)),
    temperature,
    tabuSkipped,
  };
  if (lane === 'self-loop-fallback') metadata.trackId = trackId;
  return {
    ...metadata,
    config,
    metadata,
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

function supertrendPatches(base) {
  return [
    {
      useSupertrendFilter: true,
      supertrendAtrLen: lowerBound((base.supertrendAtrLen ?? 10) - 3, 1),
      supertrendFactor: Math.max(0.1, numeric(base.supertrendFactor ?? 1.5) - 0.3),
    },
    {
      useSupertrendFilter: true,
      supertrendAtrLen: numeric(base.supertrendAtrLen ?? 10) + 4,
      supertrendFactor: numeric(base.supertrendFactor ?? 1.5) + 0.5,
    },
    {
      useSupertrendFilter: true,
      useSupertrendEntryConfirm: !(base.useSupertrendEntryConfirm === true),
      supertrendFactor: Math.max(0.1, numeric(base.supertrendFactor ?? 1.5) + 0.2),
    },
  ];
}

function mlCorePatches(base) {
  return [
    { neighborsCount: lowerBound((base.neighborsCount ?? 32) - 8, 1) },
    { neighborsCount: numeric(base.neighborsCount ?? 32) + 16 },
    { h: lowerBound((base.h ?? 8) - 2, 1) },
    { h: numeric(base.h ?? 8) + 2 },
    { r: Math.max(0.1, numeric(base.r ?? 8) - 2) },
    { x: lowerBound((base.x ?? 25) - 5, 1) },
    { lag: lowerBound((base.lag ?? 2) - 1, 1) },
    { lag: numeric(base.lag ?? 2) + 1 },
  ];
}

function fusionPatches(base) {
  return [
    { useSignalFusion: true, minFusionScore: lowerBound((base.minFusionScore ?? 1) + 1, 0) },
    { useFusionV4: true, fusionV4MinAbsPrediction: Math.max(0, numeric(base.fusionV4MinAbsPrediction ?? 2) - 0.5) },
    { useFusionV4: true, fusionV4MaxAbsPrediction: numeric(base.fusionV4MaxAbsPrediction ?? 4) + 0.5 },
    {
      useFusionV4: true,
      fusionV4LongAtrWeight: numeric(base.fusionV4LongAtrWeight ?? -0.25) - 0.15,
      fusionV4ShortAtrWeight: numeric(base.fusionV4ShortAtrWeight ?? -0.5) - 0.15,
    },
    {
      useFusionV4: true,
      fusionV4LongEngulfWeight: numeric(base.fusionV4LongEngulfWeight ?? -0.25) + 0.15,
      fusionV4ShortEngulfWeight: numeric(base.fusionV4ShortEngulfWeight ?? -0.1) + 0.15,
    },
    {
      useEmaCrossConfirm: true,
      fusionV4LongEmaWeight: numeric(base.fusionV4LongEmaWeight ?? 0) + 0.15,
      fusionV4ShortEmaWeight: numeric(base.fusionV4ShortEmaWeight ?? 0) + 0.15,
    },
  ];
}

function avwapContextPatches(base) {
  return [
    { useAvwapContext: true, avwapSwingPeriod: lowerBound((base.avwapSwingPeriod ?? 50) - 20, 2) },
    { useAvwapContext: true, avwapSwingPeriod: numeric(base.avwapSwingPeriod ?? 50) + 20 },
    { useAvwapContext: !(base.useAvwapContext === true), avwapSwingPeriod: lowerBound((base.avwapSwingPeriod ?? 50) - 8, 2) },
  ];
}

function channelContextPatches(base) {
  return [
    { useChannelContext: true, channelDetectLength: lowerBound((base.channelDetectLength ?? 18) - 6, 2) },
    { useChannelContext: true, channelDetectLength: numeric(base.channelDetectLength ?? 18) + 6 },
    { useChannelContext: !(base.useChannelContext === true), channelDetectLength: lowerBound((base.channelDetectLength ?? 18) + 2, 2) },
  ];
}

function contextAggregatorPatches(base) {
  return [
    {
      useContextAggregator: true,
      contextBoostValue: numeric(base.contextBoostValue ?? 0.25) + 0.25,
    },
    {
      useContextAggregator: true,
      contextBoostValue: Math.max(0, numeric(base.contextBoostValue ?? 0.25) - 0.1),
    },
    {
      useContextAggregator: !(base.useContextAggregator === true),
      contextBoostValue: numeric(base.contextBoostValue ?? 0.25) + 0.1,
    },
  ];
}

function contextExitShapingPatches(base) {
  return [
    {
      useContextExitShaping: true,
      contextTrailTightenFactor: Math.max(0.1, numeric(base.contextTrailTightenFactor ?? 0.75) - 0.1),
    },
    {
      useContextExitShaping: true,
      contextTrailTightenFactor: numeric(base.contextTrailTightenFactor ?? 0.75) + 0.1,
    },
    {
      useContextExitShaping: !(base.useContextExitShaping === true),
      contextTrailTightenFactor: Math.max(0.1, numeric(base.contextTrailTightenFactor ?? 0.75) - 0.05),
    },
  ];
}

function exitStatePatches(base) {
  return [
    // Time stop variations
    { useTimeStop: true, timeStopBars: 8, timeStopMinUnrealizedAtr: 0.5 },
    { useTimeStop: true, timeStopBars: 16, timeStopMinUnrealizedAtr: 0.25 },
    { useTimeStop: true, timeStopBars: 12, timeStopMinUnrealizedAtr: 0.75 },

    // Failed follow-through tighten
    {
      useFailedFollowThroughTighten: true,
      followThroughBars: lowerBound((base.followThroughBars ?? 4) - 1, 1),
      followThroughMinProgressAtr: Math.max(0, numeric(base.followThroughMinProgressAtr ?? 0.75) - 0.25),
      followThroughTightenTrailAtrMult: Math.max(0.1, numeric(base.followThroughTightenTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      useFailedFollowThroughTighten: true,
      followThroughBars: numeric(base.followThroughBars ?? 4) + 2,
      followThroughMinProgressAtr: numeric(base.followThroughMinProgressAtr ?? 0.75) + 0.5,
      followThroughTightenTrailAtrMult: numeric(base.followThroughTightenTrailAtrMult ?? 0.75) + 0.1,
    },

    // Partial de-risk
    {
      usePartialDerisk: true,
      partialDeriskAtR: Math.max(0, numeric(base.partialDeriskAtR ?? 1.0) - 0.5),
      partialDeriskClosePct: numeric(base.partialDeriskClosePct ?? 50) + 10,
    },
    {
      usePartialDerisk: true,
      partialDeriskAtR: numeric(base.partialDeriskAtR ?? 1.0) + 0.5,
      partialDeriskClosePct: Math.max(0, numeric(base.partialDeriskClosePct ?? 50) - 15),
    },

    // Context caution tighten
    {
      useContextCautionTighten: true,
      contextCautionDelta: numeric(base.contextCautionDelta ?? 0.5) + 0.25,
      contextCautionTrailAtrMult: Math.max(0.1, numeric(base.contextCautionTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      useContextCautionTighten: true,
      contextCautionDelta: Math.max(0, numeric(base.contextCautionDelta ?? 0.5) - 0.25),
      contextCautionTrailAtrMult: numeric(base.contextCautionTrailAtrMult ?? 0.75) + 0.1,
    },

    // Post-entry squeeze collapse tighten
    {
      usePostEntrySqueezeCollapseTighten: true,
      postEntrySqueezeCollapseBars: lowerBound((base.postEntrySqueezeCollapseBars ?? 4) - 1, 1),
      postEntrySqueezeCollapseTrailAtrMult: Math.max(0.1, numeric(base.postEntrySqueezeCollapseTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      usePostEntrySqueezeCollapseTighten: true,
      postEntrySqueezeCollapseBars: numeric(base.postEntrySqueezeCollapseBars ?? 4) + 2,
      postEntrySqueezeCollapseTrailAtrMult: numeric(base.postEntrySqueezeCollapseTrailAtrMult ?? 0.75) + 0.1,
    },

    // Adverse divergence tighten
    {
      useAdverseDivergenceTighten: true,
      adverseDivergenceBars: lowerBound((base.adverseDivergenceBars ?? 6) - 2, 1),
      adverseDivergenceTrailAtrMult: Math.max(0.1, numeric(base.adverseDivergenceTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      useAdverseDivergenceTighten: true,
      adverseDivergenceBars: numeric(base.adverseDivergenceBars ?? 6) + 3,
      adverseDivergenceTrailAtrMult: numeric(base.adverseDivergenceTrailAtrMult ?? 0.75) + 0.1,
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
  if (family === 'supertrend') return supertrendPatches(base);
  if (family === 'ml-core') return mlCorePatches(base);
  if (family === 'fusion') return fusionPatches(base);
  if (family === 'avwap-context') return avwapContextPatches(base);
  if (family === 'channel-context') return channelContextPatches(base);
  if (family === 'context-aggregator') return contextAggregatorPatches(base);
  if (family === 'context-exit-shaping') return contextExitShapingPatches(base);
  if (family === 'exit-state') return exitStatePatches(base);
  if (family === 'asymmetry') return asymmetryPatches(base);
  return incumbentLocalPatches(base);
}

function getFallbackPatchPool(families = [], base = {}, { interleave = false } = {}) {
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
    'exit-state': [
      { minBarsBetween: lowerBound((base.minBarsBetween ?? 2) + 1, 0), slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25) },
      { minPredSum: lowerBound((base.minPredSum ?? 2) - 0.25, 0.5), tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5 },
      { minPredSum: numeric(base.minPredSum ?? 2) + 0.25, trailAtrMult: Math.max(0.5, numeric(base.trailAtrMult ?? 1) - 0.25) },
    ],
    asymmetry: [
      { minPredSum: lowerBound((base.minPredSum ?? 2) - 0.25, 0.5), slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25) },
      { minPredSum: numeric(base.minPredSum ?? 2) + 0.25, tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5 },
      { minBarsBetween: numeric(base.minBarsBetween ?? 2) + 1, trailActivateR: numeric(base.trailActivateR ?? 0.5) + 0.5 },
    ],
    'ml-core': mlCorePatches(base),
    fusion: fusionPatches(base),
    supertrend: supertrendPatches(base),
    'avwap-context': avwapContextPatches(base),
    'channel-context': channelContextPatches(base),
    'context-aggregator': contextAggregatorPatches(base),
    'context-exit-shaping': contextExitShapingPatches(base),
  };

  const familyPools = normalizedFamilies
    .map((family) => ({ family, patches: pools[family] || [] }))
    .filter((entry) => entry.patches.length > 0);

  if (!interleave) {
    return familyPools.flatMap((entry) => entry.patches.map((patch) => ({ family: entry.family, patch })));
  }

  const maxLength = familyPools.reduce((max, entry) => Math.max(max, entry.patches.length), 0);
  const mixed = [];
  for (let index = 0; index < maxLength; index++) {
    for (const entry of familyPools) {
      if (!entry.patches[index]) continue;
      mixed.push({ family: entry.family, patch: entry.patches[index] });
    }
  }
  return mixed;
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

  // Gate-aware filter config
  const gateAwareFilter = budgetPolicy?.searchPolicy?.gateAwareFilter || budgetPolicy?.gateAwareFilter || {};
  const gateAwareEnabled = gateAwareFilter.enabled === true;
  const slAtrMultMinRatio = Number(gateAwareFilter.slAtrMultMinRatio) || 0.5;
  const baseSlAtrMult = Number(base.slAtrMult) || 0;

  const pool = getPatchPool(family, base);
  const offset = countCycles(historyEvents) % Math.max(pool.length, 1);
  const batch = [];
  const annealingState = computeAnnealingState({ schedulerState, policy: budgetPolicy });
  const temperature = annealingState.temperature;
  const selfLoopEscape = budgetPolicy.selfLoopEscape || {};
  const includeSelfLoopFallback = selfLoopEscape.includeFallback === true || budgetPolicy.includeFallback === true;
  const includeFallback = budgetPolicy.includeFallback === true;
  const rawStagnationLevel = Number(schedulerState?.stagnationLevel ?? 0);
  const stagnationLevel = Number.isFinite(rawStagnationLevel) ? Math.max(0, Math.floor(rawStagnationLevel)) : 0;
  const noNewCandidateStreak = Math.max(0, Number(schedulerState.noNewCandidateStreak ?? 0) || 0);
  const lowEmissionStreak = Math.max(0, Number(schedulerState.lowEmissionStreak ?? 0) || 0);
  const activateAfter = Math.max(1, Number(selfLoopEscape.activateAfter ?? 1) || 1);
  const escapeActive = selfLoopEscape.enabled === true
    && (
      noNewCandidateStreak >= activateAfter
      || lowEmissionStreak >= activateAfter
      || stagnationLevel >= 1
    );
  const configuredFallbackFamilies = Array.isArray(selfLoopEscape.fallbackFamilies) && selfLoopEscape.fallbackFamilies.length > 0
    ? selfLoopEscape.fallbackFamilies
    : ['signal', 'risk'];
  const stagnationFallbackFamilies = stagnationLevel >= 2
    && Array.isArray(selfLoopEscape.stagnationFallbackFamilies)
    && selfLoopEscape.stagnationFallbackFamilies.length > 0
    ? selfLoopEscape.stagnationFallbackFamilies
    : configuredFallbackFamilies;
  const fallbackFamilies = stagnationFallbackFamilies;
  const fallbackInterleave = stagnationLevel >= 2;
  const minFallbackConfigs = Math.max(0, Number(selfLoopEscape.minFallbackConfigs ?? 3) || 0);
  const selfLoopFallbackPool = escapeActive && includeSelfLoopFallback
    ? getFallbackPatchPool(fallbackFamilies, base, { interleave: fallbackInterleave })
    : [];
  const trackLimit = Math.max(0, Math.min(limit, pool.length));
  const tabuSet = new Set([
    ...normalizeTabuFingerprintSet(schedulerState.tabuRejectedFingerprints),
    ...(stagnationLevel >= 2 ? [] : normalizeTabuFingerprintSet(budgetPolicy.testedCandidateFingerprints)),
  ]);
  let tabuSkipped = 0;

  for (let probe = 0; probe < pool.length && batch.length < trackLimit; probe++) {
    const rawPatch = clone(pool[(offset + probe) % pool.length]);
    const patch = scalePatch(base, rawPatch, temperature);
    validateTrackPatch({ trackId, patch });
    const config = applyPatch(base, patch);
    // Gate-aware filter: skip variants that mechanically violate promotion gates
    if (gateAwareEnabled && baseSlAtrMult > 0) {
      const candidateSlAtrMult = Number(config.slAtrMult);
      if (Number.isFinite(candidateSlAtrMult) && candidateSlAtrMult < baseSlAtrMult * slAtrMultMinRatio) {
        continue;
      }
    }
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
      baseConfig: base,
    }));
    tabuSkipped = 0;
  }

  if (escapeActive && includeSelfLoopFallback) {
    const fallbackCandidates = [];
    const baseTemperatureBoost = Number.isFinite(Number(selfLoopEscape.temperatureBoost))
      ? Number(selfLoopEscape.temperatureBoost)
      : 1.5;
    const stagnationTemperatureBoost = Number.isFinite(Number(selfLoopEscape.stagnationTemperatureBoost))
      ? Number(selfLoopEscape.stagnationTemperatureBoost)
      : 1;
    const temperatureBoost = stagnationLevel > 0
      ? Math.max(baseTemperatureBoost, baseTemperatureBoost * Math.max(1, stagnationTemperatureBoost))
      : baseTemperatureBoost;
    const maxTemperature = Number.isFinite(Number(budgetPolicy.annealing?.maxTemperature))
      ? Number(budgetPolicy.annealing.maxTemperature)
      : 6;
    const uncappedFallbackTemperature = Math.max(1, temperature) * Math.max(1, temperatureBoost);
    const fallbackTemperature = Number((stagnationLevel > 0
      ? Math.min(maxTemperature, uncappedFallbackTemperature)
      : uncappedFallbackTemperature).toFixed(4));
    let fallbackSkipped = 0;
    for (let probe = 0; probe < selfLoopFallbackPool.length && fallbackCandidates.length < limit; probe++) {
      const { family: fallbackFamily, patch: rawPatch } = selfLoopFallbackPool[(offset + probe) % selfLoopFallbackPool.length];
      const scaledPatch = scalePatch(base, clone(rawPatch), fallbackTemperature);
      let patch;
      try {
        patch = validateTrackPatch({ trackId: fallbackFamily, patch: scaledPatch });
      } catch {
        continue;
      }
      const config = applyPatch(base, patch);
      // Gate-aware filter: skip variants that mechanically violate promotion gates
      if (gateAwareEnabled && baseSlAtrMult > 0) {
        const candidateSlAtrMult = Number(config.slAtrMult);
        if (Number.isFinite(candidateSlAtrMult) && candidateSlAtrMult < baseSlAtrMult * slAtrMultMinRatio) {
          continue;
        }
      }
      const fingerprint = configFingerprint(config);
      if (tabuSet.has(fingerprint)) {
        fallbackSkipped += 1;
        continue;
      }
      tabuSet.add(fingerprint);
      fallbackCandidates.push(buildMetadata({
        trackId: fallbackFamily,
        family: fallbackFamily,
        index: fallbackCandidates.length,
        patch,
        lane: 'self-loop-fallback',
        temperature: fallbackTemperature,
        tabuSkipped: fallbackSkipped,
        config,
        baseConfig: base,
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
      // Gate-aware filter: skip variants that mechanically violate promotion gates
      if (gateAwareEnabled && baseSlAtrMult > 0) {
        const candidateSlAtrMult = Number(config.slAtrMult);
        if (Number.isFinite(candidateSlAtrMult) && candidateSlAtrMult < baseSlAtrMult * slAtrMultMinRatio) {
          continue;
        }
      }
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
        baseConfig: base,
      }));
      fallbackSkipped = 0;
    }
  }

  return batch.slice(0, limit);
}
