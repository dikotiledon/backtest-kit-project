import { buildCanonicalConfigFingerprint } from './pine-global-search.mjs';

function roundParam(value, precision = 6) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Number(value.toFixed(precision));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function configFingerprint(config) {
  return buildCanonicalConfigFingerprint(config || {});
}

const LEGACY_ARCHITECTURE_DEFAULTS = {
  useSignalFusion: true,
  useFusionV2: false,
  useFusionV3: false,
  useFusionV4: true,
  useSupertrendFilter: true,
  useTrailingStop: true,
  useStopsTP: true,
};

const DEFAULT_FROZEN_ARCHITECTURE_KEYS = Object.keys(LEGACY_ARCHITECTURE_DEFAULTS);

const DEFAULT_PATCH_BOUNDS = {
  neighborsCount: [12, 128],
  adxThreshold: [0, 30],
  minPredSum: [1, 10],
  minBarsBetween: [0, 50],
  h: [4, 128],
  r: [2, 128],
  x: [15, 128],
  slAtrMult: [0.125, 10],
  tpAtrMult: [1, 20],
  trailAtrMult: [0.25, 10],
  trailActivateR: [0, 5],
  riskAtrLen: [5, 200],
};

const CORRELATED_MUTATION_KEYS = {
  slAtrMult: 'tpAtrMult',
  tpAtrMult: 'slAtrMult',
};

export function allocateLaneBudget(maxConfigs, exploitRatio = 0.8) {
  const total = Math.max(0, Number(maxConfigs) || 0);
  if (total <= 1) return { exploit: total, explore: 0 };
  const rawExploit = Math.round(total * exploitRatio);
  const exploit = Math.min(total - 1, Math.max(1, rawExploit));
  return { exploit, explore: total - exploit };
}

export function computeAnnealingState({ schedulerState = {}, policy = {} } = {}) {
  const annealing = policy.annealing || {};
  const enabled = annealing.enabled ?? false;
  const noChangeStreak = Math.max(0, Number(schedulerState.noChangeStreak) || 0);
  if (!enabled) return { enabled: false, noChangeStreak, temperature: 1 };
  const baseTemperature = annealing.baseTemperature ?? 0.4;
  const growthFactor = annealing.growthFactor ?? 1.8;
  const maxTemperature = annealing.maxTemperature ?? 4;
  const temperature = Math.min(maxTemperature, baseTemperature * (growthFactor ** noChangeStreak));
  return { enabled: true, noChangeStreak, temperature: Number(temperature.toFixed(4)) };
}

function countCycles(historyEvents = []) {
  return historyEvents.filter((event) => event?.type === 'cycle').length;
}

function withPatch(base, patch, meta) {
  const touchedKeys = Object.keys(patch || {});
  const roundedPatch = Object.fromEntries(
    Object.entries(patch || {}).map(([key, value]) => [key, roundParam(value)])
  );
  return {
    variantId: `${meta.lane}-${meta.family}-${meta.index}`,
    lane: meta.lane,
    family: meta.family,
    patch: clone(roundedPatch),
    touchedKeys,
    temperature: meta.temperature ?? 1,
    tabuSkipped: meta.tabuSkipped ?? 0,
    metadata: meta.metadata,
    config: Object.fromEntries(
      Object.entries({ ...clone(base), ...roundedPatch }).map(([k, v]) => [k, roundParam(v)])
    ),
  };
}

function normalizeBound(bound) {
  if (Array.isArray(bound) && bound.length >= 2) {
    const min = Number(bound[0]);
    const max = Number(bound[1]);
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  }
  if (bound && typeof bound === 'object') {
    const min = Number(bound.min);
    const max = Number(bound.max);
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  }
  return null;
}

function clampPatchValue(key, value, patchBounds = {}) {
  const bound = normalizeBound(patchBounds[key]) || normalizeBound(DEFAULT_PATCH_BOUNDS[key]);
  if (!bound) return value;
  const min = Math.min(bound.min, bound.max);
  const max = Math.max(bound.min, bound.max);
  return Math.min(max, Math.max(min, value));
}

function scalePatch(base, patch, temperature, patchBounds = {}, diversityScale = 1) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    const baseValue = Number(base[key]);
    if (typeof value !== 'number' || !Number.isFinite(baseValue)) return [key, value];
    const minValue = key.toLowerCase().includes('len') || key.toLowerCase().includes('bars') || key === 'neighborsCount' ? 1 : 0;
    const scaled = clampPatchValue(
      key,
      Math.max(minValue, baseValue + ((value - baseValue) * temperature * diversityScale)),
      patchBounds,
    );
    const integerLike = Number.isInteger(baseValue) && Number.isInteger(value);
    return [key, integerLike ? Math.round(scaled) : roundParam(scaled, 4)];
  }));
}

function patchDirection(base, key, targetValue) {
  const baseValue = Number(base[key]);
  if (!Number.isFinite(baseValue) || typeof targetValue !== 'number') return 0;
  return Math.sign(targetValue - baseValue);
}

function findCorrelatedPatch(base, rawPatch, pool = []) {
  const entries = Object.entries(rawPatch || {});
  if (entries.length !== 1) return null;
  const [sourceKey, sourceTarget] = entries[0];
  const pairedKey = CORRELATED_MUTATION_KEYS[sourceKey];
  if (!pairedKey) return null;
  const sourceDirection = patchDirection(base, sourceKey, sourceTarget);
  if (!sourceDirection) return null;
  return pool.find((candidate) => {
    const candidateKeys = Object.keys(candidate || {});
    return candidateKeys.length === 1
      && candidateKeys[0] === pairedKey
      && patchDirection(base, pairedKey, candidate[pairedKey]) === sourceDirection;
  }) || null;
}

function buildDiversePatch({ base, rawPatch, pool, temperature, batchIndex, patchBounds }) {
  const hot = Number(temperature) > 1.5;
  const diversityScale = hot ? 1 + ((Math.max(0, Number(batchIndex) || 0) % 3) * 0.2) : 1;
  const patch = scalePatch(base, rawPatch, temperature, patchBounds, diversityScale);
  if (!hot || Object.keys(rawPatch || {}).length !== 1) return patch;

  const correlatedPatch = findCorrelatedPatch(base, rawPatch, pool);
  if (!correlatedPatch) return patch;
  return {
    ...patch,
    ...scalePatch(base, correlatedPatch, temperature, patchBounds, Math.max(0.75, diversityScale * 0.85)),
  };
}

function normalizeFingerprintEntry(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.fingerprint === 'string') {
    return entry.fingerprint;
  }
  return null;
}

export function normalizeTabuFingerprintSet(value) {
  if (value instanceof Set || Array.isArray(value)) {
    return new Set([...value].map(normalizeFingerprintEntry).filter(Boolean));
  }
  if (value && typeof value === 'object') {
    if (typeof value.fingerprint === 'string') return new Set([value.fingerprint]);
    return new Set(Object.keys(value));
  }
  return new Set();
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function pickNonTabuVariant({
  base,
  pool,
  startIndex,
  lane,
  family,
  batchIndex,
  tabuSet,
  externalTabuFingerprints = tabuSet,
  temperature,
  requiredTouchedKeys,
  enforcementBatchIndex = batchIndex,
  patchBounds = {},
}) {
  if (!Array.isArray(pool) || !pool.length) {
    return {
      variant: null,
      nextIndex: startIndex,
      tabuSkipped: 0,
      externalTabuSkipped: 0,
      batchDedupeSkipped: 0,
      exhausted: true,
      poolSize: 0,
    };
  }

  const enforceRequiredKeys = normalizeStringList(requiredTouchedKeys).length > 0;
  let tabuSkipped = 0;
  let externalTabuSkipped = 0;
  let batchDedupeSkipped = 0;
  const countTabuSkip = (fingerprint) => {
    tabuSkipped += 1;
    if (externalTabuFingerprints.has(fingerprint)) {
      externalTabuSkipped += 1;
    } else {
      batchDedupeSkipped += 1;
    }
  };

  for (let probe = 0; probe < pool.length; probe++) {
    const rawPatch = pool[(startIndex + probe) % pool.length];
    const patch = buildDiversePatch({
      base,
      rawPatch,
      pool,
      temperature,
      batchIndex: enforcementBatchIndex,
      patchBounds,
    });
    const candidate = { ...clone(base), ...patch };
    const candidateFingerprint = configFingerprint(candidate);
    if (!enforceRequiredKeys && tabuSet.has(candidateFingerprint)) {
      countTabuSkip(candidateFingerprint);
      continue;
    }

    const variant = withPatch(base, patch, { lane, family, index: batchIndex, temperature, tabuSkipped });
    const enforcedVariant = enforceRequiredTouchedKeys({
      base,
      variant,
      requiredTouchedKeys,
      batchIndex: enforcementBatchIndex,
      temperature,
      patchBounds,
    });

    const enforcedFingerprint = configFingerprint(enforcedVariant.config);
    if (!tabuSet.has(enforcedFingerprint)) {
      return {
        variant: enforcedVariant,
        nextIndex: startIndex + probe + 1,
        tabuSkipped,
        externalTabuSkipped,
        batchDedupeSkipped,
        exhausted: false,
        poolSize: pool.length,
      };
    }

    countTabuSkip(enforcedFingerprint);
  }

  return {
    variant: null,
    nextIndex: startIndex + pool.length,
    tabuSkipped,
    externalTabuSkipped,
    batchDedupeSkipped,
    exhausted: true,
    poolSize: pool.length,
  };
}

function legacySignalPatches(base) {
  return [
    { neighborsCount: Math.max(12, (base.neighborsCount ?? 32) - 8) },
    { neighborsCount: (base.neighborsCount ?? 32) + 8 },
    { adxThreshold: Math.max(10, (base.adxThreshold ?? 20) - 5) },
    { adxThreshold: (base.adxThreshold ?? 20) + 5 },
    { minPredSum: Math.max(1, roundParam((base.minPredSum ?? 2) - 0.5)) },
    { minPredSum: roundParam((base.minPredSum ?? 2) + 0.5) },
    { minBarsBetween: Math.max(0, (base.minBarsBetween ?? 2) - 1) },
    { minBarsBetween: (base.minBarsBetween ?? 2) + 2 },
    { h: Math.max(4, (base.h ?? 8) - 2) },
    { h: (base.h ?? 8) + 2 },
    { r: Math.max(2, roundParam((base.r ?? 8) / 2)) },
    { x: Math.max(15, (base.x ?? 25) - 5) },
  ];
}

export function signalPatches(base, { temperature = 1 } = {}) {
  const safeTemp = Math.max(1, Number(temperature) || 1);
  const baseNeighbors = base.neighborsCount ?? 32;
  const baseAdx = base.adxThreshold ?? 20;
  const baseMinPred = base.minPredSum ?? 2;
  const baseBars = base.minBarsBetween ?? 2;
  const baseH = base.h ?? 8;
  const baseR = base.r ?? 8;
  const baseX = base.x ?? 25;
  const stepScales = safeTemp >= 3 ? [0.5, 2, 3] : safeTemp >= 2 ? [0.5, 2] : [0.5];
  const targetCount = safeTemp >= 3 ? 36 : safeTemp >= 2 ? 24 : 18;
  const patches = [...legacySignalPatches(base)];
  for (const scale of stepScales) {
    patches.push(
      { neighborsCount: Math.max(12, Math.round(baseNeighbors - 8 * scale)) },
      { neighborsCount: Math.round(baseNeighbors + 8 * scale) },
      { adxThreshold: Math.max(10, Math.round(baseAdx - 5 * scale)) },
      { adxThreshold: Math.round(baseAdx + 5 * scale) },
      { minPredSum: Math.max(1, Number((baseMinPred - 0.5 * scale).toFixed(2))) },
      { minPredSum: Number((baseMinPred + 0.5 * scale).toFixed(2)) },
      { minBarsBetween: Math.max(0, Math.round(baseBars - scale)) },
      { minBarsBetween: Math.round(baseBars + 2 * scale) },
      { h: Math.max(4, Math.round(baseH - 2 * scale)) },
      { h: Math.round(baseH + 2 * scale) },
      { r: Math.max(2, Number((baseR / (1 + scale)).toFixed(2))) },
      { x: Math.max(15, Math.round(baseX - 5 * scale)) },
    );
  }
  return deduplicatePatches(patches, base, targetCount);
}

function legacyRiskPatches(base) {
  return [
    { slAtrMult: Math.max(0.125, roundParam((base.slAtrMult ?? 1) - 0.25)) },
    { slAtrMult: roundParam((base.slAtrMult ?? 1) + 0.25) },
    { tpAtrMult: Math.max(1.0, roundParam((base.tpAtrMult ?? 2.5) - 0.5)) },
    { tpAtrMult: roundParam((base.tpAtrMult ?? 2.5) + 0.5) },
    { trailAtrMult: Math.max(0.25, roundParam((base.trailAtrMult ?? 1) - 0.25)) },
    { trailAtrMult: roundParam((base.trailAtrMult ?? 1) + 0.25) },
    { trailActivateR: Math.max(0, roundParam((base.trailActivateR ?? 0.5) - 0.5)) },
    { trailActivateR: roundParam((base.trailActivateR ?? 0.5) + 0.5) },
    { riskAtrLen: Math.max(7, (base.riskAtrLen ?? 14) - 7) },
    { riskAtrLen: (base.riskAtrLen ?? 14) + 7 },
    // Wide exploration jumps (reach distant optima in single step)
    { trailAtrMult: Math.max(0.25, roundParam((base.trailAtrMult ?? 1) + 1.0)) },
    { trailAtrMult: Math.max(0.25, roundParam((base.trailAtrMult ?? 1) + 2.0)) },
    { slAtrMult: roundParam((base.slAtrMult ?? 1) + 0.5) },
    { tpAtrMult: Math.max(1.0, roundParam((base.tpAtrMult ?? 2.5) - 1.5)) },
    { tpAtrMult: Math.max(1.0, roundParam((base.tpAtrMult ?? 2.5) - 2.5)) },
    { trailActivateR: roundParam((base.trailActivateR ?? 0.5) + 1.0) },
    { trailActivateR: roundParam((base.trailActivateR ?? 0.5) + 1.5) },
  ];
}

export function riskPatches(base, { temperature = 1 } = {}) {
  const safeTemp = Math.max(1, Number(temperature) || 1);
  const baseSl = base.slAtrMult ?? 1;
  const baseTp = base.tpAtrMult ?? 2.5;
  const baseTrail = base.trailAtrMult ?? 1;
  const baseActivate = base.trailActivateR ?? 0.5;
  const baseAtrLen = base.riskAtrLen ?? 14;
  const stepScales = safeTemp >= 3 ? [0.5, 2, 3] : safeTemp >= 2 ? [0.5, 2] : [0.5];
  const targetCount = safeTemp >= 3 ? 40 : safeTemp >= 2 ? 28 : 20;
  const patches = [...legacyRiskPatches(base)];
  for (const scale of stepScales) {
    patches.push(
      { slAtrMult: Math.max(0.125, Number((baseSl - 0.25 * scale).toFixed(3))) },
      { slAtrMult: Number((baseSl + 0.25 * scale).toFixed(3)) },
      { tpAtrMult: Math.max(1.0, Number((baseTp - 1.0 * scale).toFixed(3))) },
      { tpAtrMult: Number((baseTp + 0.5 * scale).toFixed(3)) },
      { trailAtrMult: Math.max(0.25, Number((baseTrail - 0.5 * scale).toFixed(3))) },
      { trailAtrMult: Number((baseTrail + 0.5 * scale).toFixed(3)) },
      { trailActivateR: Math.max(0, Number((baseActivate - 0.25 * scale).toFixed(3))) },
      { trailActivateR: Number((baseActivate + 0.75 * scale).toFixed(3)) },
      { riskAtrLen: Math.max(5, Math.round(baseAtrLen - 7 * scale)) },
      { riskAtrLen: Math.round(baseAtrLen + 7 * scale) },
    );
  }
  return deduplicatePatches(patches, base, targetCount);
}

export function jointPatches(base, { temperature = 1 } = {}) {
  const safeTemp = Math.max(1, Number(temperature) || 1);
  const baseSl = base.slAtrMult ?? 1;
  const baseTp = base.tpAtrMult ?? 2.5;
  const baseTrail = base.trailAtrMult ?? 1;
  const baseActivate = base.trailActivateR ?? 0.5;
  const baseAdx = base.adxThreshold ?? 20;
  const baseMinPred = base.minPredSum ?? 2;
  const baseBars = base.minBarsBetween ?? 2;
  const baseLongAtr = base.fusionV4LongAtrWeight ?? -0.25;
  const baseShortAtr = base.fusionV4ShortAtrWeight ?? -0.5;
  const baseLongEngulf = base.fusionV4LongEngulfWeight ?? -0.25;
  const baseShortEngulf = base.fusionV4ShortEngulfWeight ?? -0.1;

  const patches = [
    // Risk:Reward pairs (SL + TP move together)
    { slAtrMult: roundParam(baseSl * 0.8), tpAtrMult: roundParam(baseTp * 1.2) },
    { slAtrMult: roundParam(baseSl * 1.2), tpAtrMult: roundParam(baseTp * 0.85) },
    { slAtrMult: roundParam(baseSl * 0.6), tpAtrMult: roundParam(baseTp * 1.4) },

    // Trail + TP (exit management as a unit)
    { trailAtrMult: roundParam(baseTrail * 0.75), tpAtrMult: roundParam(baseTp * 1.15) },
    { trailAtrMult: roundParam(baseTrail * 1.3), tpAtrMult: roundParam(baseTp * 0.9) },
    { trailActivateR: roundParam(baseActivate * 0.6), trailAtrMult: roundParam(baseTrail * 0.8) },
    { trailActivateR: roundParam(baseActivate * 1.5), trailAtrMult: roundParam(baseTrail * 1.2) },

    // Signal sensitivity pairs (ADX + minPredSum)
    { adxThreshold: Math.max(10, baseAdx - 2), minPredSum: roundParam(baseMinPred + 0.2) },
    { adxThreshold: Math.min(30, baseAdx + 2), minPredSum: roundParam(Math.max(1, baseMinPred - 0.2)) },
    { adxThreshold: Math.max(10, baseAdx - 3), minPredSum: roundParam(baseMinPred + 0.3) },
    { adxThreshold: Math.min(30, baseAdx + 3), minPredSum: roundParam(Math.max(1, baseMinPred - 0.3)) },

    // Signal + cooldown (entry selectivity)
    { minPredSum: roundParam(baseMinPred + 0.3), minBarsBetween: Math.max(0, baseBars + 1) },
    { minPredSum: roundParam(Math.max(1, baseMinPred - 0.3)), minBarsBetween: Math.max(0, baseBars - 1) },

    // Fusion weight asymmetry (long/short rebalancing)
    { fusionV4LongAtrWeight: roundParam(baseLongAtr - 0.1), fusionV4ShortAtrWeight: roundParam(baseShortAtr + 0.1) },
    { fusionV4LongAtrWeight: roundParam(baseLongAtr + 0.1), fusionV4ShortAtrWeight: roundParam(baseShortAtr - 0.1) },
    { fusionV4LongEngulfWeight: roundParam(baseLongEngulf - 0.1), fusionV4ShortEngulfWeight: roundParam(baseShortEngulf + 0.05) },
    { fusionV4LongEngulfWeight: roundParam(baseLongEngulf + 0.1), fusionV4ShortEngulfWeight: roundParam(baseShortEngulf - 0.05) },
  ];

  // Temperature-scaled wider exploration
  if (safeTemp >= 2) {
    patches.push(
      { slAtrMult: roundParam(baseSl * 0.5), tpAtrMult: roundParam(baseTp * 1.8), trailAtrMult: roundParam(baseTrail * 0.7) },
      { adxThreshold: Math.max(10, baseAdx - 5), minPredSum: roundParam(baseMinPred + 0.5), minBarsBetween: Math.max(0, baseBars + 2) },
      { trailActivateR: roundParam(baseActivate * 2.0), trailAtrMult: roundParam(baseTrail * 0.6), tpAtrMult: roundParam(baseTp * 1.3) },
    );
  }

  if (safeTemp >= 3) {
    patches.push(
      { slAtrMult: roundParam(baseSl * 0.4), tpAtrMult: roundParam(baseTp * 2.0), trailAtrMult: roundParam(baseTrail * 0.5) },
      { adxThreshold: Math.max(10, baseAdx - 7), minPredSum: roundParam(baseMinPred + 0.8), minBarsBetween: Math.max(0, baseBars + 3) },
      { fusionV4LongAtrWeight: roundParam(baseLongAtr - 0.2), fusionV4ShortAtrWeight: roundParam(baseShortAtr + 0.2), fusionV4LongEngulfWeight: roundParam(baseLongEngulf - 0.15) },
    );
  }

  const targetCount = safeTemp >= 3 ? 24 : safeTemp >= 2 ? 20 : 17;
  return deduplicatePatches(patches, base, targetCount);
}

function deduplicatePatches(patches, base, limit = Infinity) {
  const seen = new Set([configFingerprint(base)]);
  const output = [];
  for (const patch of patches) {
    const fp = configFingerprint({ ...base, ...patch });
    if (seen.has(fp)) continue;
    seen.add(fp);
    output.push(patch);
    if (output.length >= limit) break;
  }
  return output;
}

function forcedEntryPatches(base, requiredKeys = []) {
  const required = new Set(requiredKeys);
  return signalPatches(base).filter((patch) => Object.keys(patch).some((key) => required.has(key)));
}

function enforceRequiredTouchedKeys({ base, variant, requiredTouchedKeys = [], batchIndex = 0, temperature = 1, patchBounds = {} }) {
  const required = normalizeStringList(requiredTouchedKeys);
  if (!required.length) return variant;
  const patchKeys = Object.keys(variant?.patch || {});
  if (patchKeys.some((key) => required.includes(key))) return variant;

  const pool = forcedEntryPatches(base, required);
  if (!pool.length) return variant;
  const entryPatch = scalePatch(base, pool[batchIndex % pool.length], temperature, patchBounds);
  const mergedPatch = { ...(variant.patch || {}), ...entryPatch };
  return {
    ...variant,
    family: variant.family || 'entry',
    patch: mergedPatch,
    touchedKeys: Object.keys(mergedPatch),
    metadata: {
      ...(variant.metadata || {}),
      forcedEntryMutation: true,
      requiredTouchedKeys: required,
    },
    config: Object.fromEntries(
      Object.entries({ ...clone(base), ...mergedPatch }).map(([k, v]) => [k, roundParam(v)])
    ),
  };
}

function freezeArchitecture(config, policy = {}) {
  const base = clone(config || {});
  const overrideKeys = normalizeStringList(policy.frozenArchitectureKeys);
  const frozenKeys = overrideKeys.length ? overrideKeys : DEFAULT_FROZEN_ARCHITECTURE_KEYS;
  const frozen = { ...base };
  for (const key of frozenKeys) {
    if (Object.hasOwn(base, key)) {
      frozen[key] = base[key];
    } else if (!overrideKeys.length && Object.hasOwn(LEGACY_ARCHITECTURE_DEFAULTS, key)) {
      frozen[key] = LEGACY_ARCHITECTURE_DEFAULTS[key];
    }
  }
  return frozen;
}

export function buildIncumbentSearchBatch({ incumbent, maxConfigs, historyEvents = [], policy = {}, schedulerState = {} }) {
  const normalizedIncumbent = incumbent && typeof incumbent === 'object' && !Array.isArray(incumbent) && incumbent.config && typeof incumbent.config === 'object' && !Array.isArray(incumbent.config)
    ? incumbent.config
    : incumbent;
  const base = policy.freezeArchitecture === false ? clone(normalizedIncumbent) : freezeArchitecture(normalizedIncumbent, policy);
  const { exploit, explore } = allocateLaneBudget(maxConfigs, policy.exploitRatio ?? 0.8);
  const exploitFamilies = policy.exploitFamilies?.length ? policy.exploitFamilies : ['signal', 'risk', 'joint'];
  const exploreFamilies = policy.exploreFamilies?.length ? policy.exploreFamilies : ['signal'];
  const cycleCount = countCycles(historyEvents);
  const annealingState = computeAnnealingState({ schedulerState, policy });
  const temperature = annealingState.temperature;
  const tabuSet = new Set([
    ...normalizeTabuFingerprintSet(schedulerState.tabuRejectedFingerprints),
    ...normalizeTabuFingerprintSet(policy.testedCandidateFingerprints),
  ]);
  const externalTabuFingerprints = new Set(tabuSet);

  const familyPatchMap = {
    signal: signalPatches(base, { temperature }),
    risk: riskPatches(base, { temperature }),
    joint: jointPatches(base, { temperature }),
  };
  const poolSizes = {
    signal: familyPatchMap.signal.length,
    risk: familyPatchMap.risk.length,
    joint: familyPatchMap.joint.length,
  };
  const familyTabuRejects = {
    signal: 0,
    risk: 0,
    joint: 0,
  };

  const orderedExploitFamilies = exploitFamilies.map((_, index) => exploitFamilies[(cycleCount + index) % exploitFamilies.length]);
  const batch = [];

  let index = 0;
  for (let exploitSlot = 0; exploitSlot < exploit; exploitSlot++) {
    const family = orderedExploitFamilies[exploitSlot % orderedExploitFamilies.length];
    const pool = familyPatchMap[family];
    const picked = pickNonTabuVariant({
      base,
      pool,
      startIndex: index,
      lane: 'exploit',
      family,
      batchIndex: exploitSlot + 1,
      tabuSet,
      externalTabuFingerprints,
      temperature,
      requiredTouchedKeys: policy.requiredTouchedKeys,
      enforcementBatchIndex: batch.length,
      patchBounds: policy.patchBounds,
    });
    index = picked.nextIndex;
    if (family in familyTabuRejects) {
      familyTabuRejects[family] += Number(picked.externalTabuSkipped) || 0;
    }
    if (!picked.variant) continue;
    batch.push(picked.variant);
    tabuSet.add(configFingerprint(picked.variant.config));
  }

  for (let exploreIndex = 0; exploreIndex < explore; exploreIndex++) {
    const family = exploreFamilies[exploreIndex % exploreFamilies.length];
    const pool = familyPatchMap[family];
    const picked = pickNonTabuVariant({
      base,
      pool,
      startIndex: cycleCount + exploreIndex + exploit,
      lane: 'explore',
      family,
      batchIndex: exploreIndex + 1,
      tabuSet,
      externalTabuFingerprints,
      temperature,
      requiredTouchedKeys: policy.requiredTouchedKeys,
      enforcementBatchIndex: batch.length,
      patchBounds: policy.patchBounds,
    });
    if (family in familyTabuRejects) {
      familyTabuRejects[family] += Number(picked.externalTabuSkipped) || 0;
    }
    if (!picked.variant) continue;
    batch.push(picked.variant);
    tabuSet.add(configFingerprint(picked.variant.config));
  }

  const rawPoolExhaustionRatio = Number(policy.poolExhaustionRatio);
  const poolExhaustionRatio = Number.isFinite(rawPoolExhaustionRatio) && rawPoolExhaustionRatio > 0 && rawPoolExhaustionRatio <= 1
    ? rawPoolExhaustionRatio
    : 0.75;
  const exhaustedFamilies = ['signal', 'risk', 'joint'].filter((family) => {
    const size = poolSizes[family];
    if (!size) return false;
    const rejects = familyTabuRejects[family];
    return rejects >= Math.ceil(size * poolExhaustionRatio);
  });
  if (exhaustedFamilies.length > 0) {
    batch.push({
      metadata: {
        allCandidatesTabu: batch.length === 0,
        poolExhaustionRatio,
        exhaustedFamilies,
      },
      allCandidatesTabu: batch.length === 0,
      lane: 'exhaustion',
      family: 'incumbent-search',
    });
  }

  return batch;
}
