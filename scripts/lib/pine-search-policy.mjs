import { buildCanonicalConfigFingerprint } from './pine-global-search.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configFingerprint(config) {
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
  neighborsCount: [1, 128],
  adxThreshold: [0, 30],
  minPredSum: [0, 10],
  minBarsBetween: [0, 50],
  h: [1, 128],
  r: [1, 128],
  x: [1, 128],
  slAtrMult: [0.25, 10],
  tpAtrMult: [0.25, 20],
  trailAtrMult: [0.25, 10],
  trailActivateR: [0, 5],
  riskAtrLen: [1, 200],
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
  return {
    variantId: `${meta.lane}-${meta.family}-${meta.index}`,
    lane: meta.lane,
    family: meta.family,
    patch: clone(patch || {}),
    touchedKeys,
    temperature: meta.temperature ?? 1,
    tabuSkipped: meta.tabuSkipped ?? 0,
    metadata: meta.metadata,
    config: { ...clone(base), ...patch },
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
    return [key, integerLike ? Math.round(scaled) : Number(scaled.toFixed(4))];
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
  temperature,
  requiredTouchedKeys,
  enforcementBatchIndex = batchIndex,
  patchBounds = {},
}) {
  if (!Array.isArray(pool) || !pool.length) {
    return { variant: null, nextIndex: startIndex, tabuSkipped: 0, exhausted: true };
  }

  const enforceRequiredKeys = normalizeStringList(requiredTouchedKeys).length > 0;
  let tabuSkipped = 0;
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
    if (!enforceRequiredKeys && tabuSet.has(configFingerprint(candidate))) {
      tabuSkipped += 1;
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

    if (!tabuSet.has(configFingerprint(enforcedVariant.config))) {
      return {
        variant: enforcedVariant,
        nextIndex: startIndex + probe + 1,
        tabuSkipped,
        exhausted: false,
      };
    }

    tabuSkipped += 1;
  }

  return { variant: null, nextIndex: startIndex + pool.length, tabuSkipped, exhausted: true };
}

function signalPatches(base) {
  return [
    { neighborsCount: Math.max(12, (base.neighborsCount || 32) - 8) },
    { neighborsCount: (base.neighborsCount || 32) + 8 },
    { adxThreshold: Math.max(10, (base.adxThreshold || 20) - 5) },
    { adxThreshold: (base.adxThreshold || 20) + 5 },
    { minPredSum: Math.max(1, (base.minPredSum || 2) - 0.5) },
    { minPredSum: (base.minPredSum || 2) + 0.5 },
    { minBarsBetween: Math.max(0, (base.minBarsBetween || 2) - 1) },
    { minBarsBetween: (base.minBarsBetween || 2) + 2 },
    { h: Math.max(4, (base.h || 8) - 2) },
    { h: (base.h || 8) + 2 },
    { r: Math.max(2, (base.r || 8) / 2) },
    { x: Math.max(15, (base.x || 25) - 5) },
  ];
}

function riskPatches(base) {
  return [
    { slAtrMult: Math.max(0.75, (base.slAtrMult || 1) - 0.25) },
    { slAtrMult: (base.slAtrMult || 1) + 0.25 },
    { tpAtrMult: Math.max(1.5, (base.tpAtrMult || 2.5) - 0.5) },
    { tpAtrMult: (base.tpAtrMult || 2.5) + 0.5 },
    { trailAtrMult: Math.max(0.75, (base.trailAtrMult || 1) - 0.25) },
    { trailAtrMult: (base.trailAtrMult || 1) + 0.25 },
    { trailActivateR: Math.max(0, (base.trailActivateR || 0.5) - 0.5) },
    { trailActivateR: (base.trailActivateR || 0.5) + 0.5 },
    { riskAtrLen: Math.max(7, (base.riskAtrLen || 14) - 7) },
    { riskAtrLen: (base.riskAtrLen || 14) + 7 },
  ];
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
    config: { ...clone(base), ...mergedPatch },
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
  const base = policy.freezeArchitecture === false ? clone(incumbent) : freezeArchitecture(incumbent, policy);
  const { exploit, explore } = allocateLaneBudget(maxConfigs, policy.exploitRatio ?? 0.8);
  const exploitFamilies = policy.exploitFamilies?.length ? policy.exploitFamilies : ['signal', 'risk'];
  const exploreFamilies = policy.exploreFamilies?.length ? policy.exploreFamilies : ['signal'];
  const cycleCount = countCycles(historyEvents);
  const annealingState = computeAnnealingState({ schedulerState, policy });
  const temperature = annealingState.temperature;
  const tabuSet = new Set([
    ...normalizeTabuFingerprintSet(schedulerState.tabuRejectedFingerprints),
    ...normalizeTabuFingerprintSet(policy.testedCandidateFingerprints),
  ]);

  const familyPatchMap = {
    signal: signalPatches(base),
    risk: riskPatches(base),
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
      temperature,
      requiredTouchedKeys: policy.requiredTouchedKeys,
      enforcementBatchIndex: batch.length,
      patchBounds: policy.patchBounds,
    });
    index = picked.nextIndex;
    if (!picked.variant) continue;
    batch.push(picked.variant);
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
      temperature,
      requiredTouchedKeys: policy.requiredTouchedKeys,
      enforcementBatchIndex: batch.length,
      patchBounds: policy.patchBounds,
    });
    if (!picked.variant) continue;
    batch.push(picked.variant);
  }

  return batch;
}
