import { createHash } from 'node:crypto';

const GENERATOR_VERSION = 'global-search-v1';
const DEFAULT_FAMILIES = ['entry', 'filters', 'risk', 'fusion-weight', 'asymmetry', 'exit-state'];
const POSITIVE_KEYS = new Set([
  'minPredSum',
  'adxThreshold',
  'slAtrMult',
  'tpAtrMult',
  'trailAtrMult',
  'trailActivateR',
  'fusionV4MinAbsPrediction',
  'fusionV4MaxAbsPrediction',
]);
const BOOLEAN_KEYS = new Set([
  'useAdxFilter',
  'useSupertrendFilter',
  'useSupertrendEntryConfirm',
  'useTrailingStop',
  'useFusionV4',
]);
const ARCHITECTURE_BOOLEAN_KEYS = new Set(['useFusionV4']);
const KNOWN_KEYS = new Set([
  ...POSITIVE_KEYS,
  ...BOOLEAN_KEYS,
  'fusionV4LongAtrWeight',
  'fusionV4LongEngulfWeight',
  'fusionV4LongEmaWeight',
  'fusionV4ShortAtrWeight',
  'fusionV4ShortEngulfWeight',
  'fusionV4ShortEmaWeight',
]);

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMaxConfigs(maxConfigs) {
  if (maxConfigs === undefined || maxConfigs === null) return 8;
  const parsed = Number(maxConfigs);
  if (!Number.isFinite(parsed)) return 8;
  return Math.max(0, Math.floor(parsed));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildGlobalPatchFingerprint({ championId = null, lane, mutationFamily, patch } = {}) {
  return createHash('sha256')
    .update(stableJson({ championId: championId ?? null, lane, mutationFamily, patch: patch || {} }))
    .digest('hex');
}

function toPatchEntries(patch) {
  return Object.entries(patch).sort(([a], [b]) => a.localeCompare(b));
}

function hasFrozenKey(patch, frozenKeys) {
  const frozen = new Set((frozenKeys || []).filter((item) => typeof item === 'string'));
  return Object.keys(patch).some((key) => frozen.has(key));
}

function buildCandidateId({ lane, mutationFamily, patch }) {
  const canonicalPatch = JSON.stringify(Object.fromEntries(toPatchEntries(patch || {})));
  return createHash('sha1').update(`${lane}|${mutationFamily}|${canonicalPatch}`).digest('hex').slice(0, 20);
}

export function validateGlobalMutationPatch(patch, { frozenKeys, allowArchitectureKeys = false } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'patch must be object' };
  }

  const keys = Object.keys(patch);
  if (keys.length === 0) return { ok: false, reason: 'patch must not be empty' };
  if (hasFrozenKey(patch, frozenKeys)) return { ok: false, reason: 'patch touches frozen key' };

  for (const [key, value] of Object.entries(patch)) {
    if (!KNOWN_KEYS.has(key)) return { ok: false, reason: 'unknown key', key };

    if (ARCHITECTURE_BOOLEAN_KEYS.has(key) && !allowArchitectureKeys) {
      return { ok: false, reason: 'architecture key blocked', key };
    }

    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') return { ok: false, reason: 'boolean key must be boolean', key };
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, reason: 'numeric key must be finite number', key };
    }

    if (POSITIVE_KEYS.has(key) && value <= 0) {
      return { ok: false, reason: 'positive key must be > 0', key };
    }
  }

  return { ok: true };
}

function signedStep(level, baseStep) {
  const magnitude = Math.ceil(level / 2) * baseStep;
  return level % 2 === 1 ? magnitude : -magnitude;
}

function buildFamilyPatch({ family, config, level = 1 }) {
  const c = config || {};

  if (family === 'entry') {
    const minPredSum = clamp(numberOr(c.minPredSum, 2) + signedStep(level, 0.2), 0.1, 10);
    return { minPredSum };
  }

  if (family === 'filters') {
    const adxThreshold = clamp(numberOr(c.adxThreshold, 20) + signedStep(level, 2), 1, 100);
    return { adxThreshold };
  }

  if (family === 'risk') {
    const slAtrMult = clamp(numberOr(c.slAtrMult, 1) + signedStep(level, 0.1), 0.1, 20);
    return { slAtrMult };
  }

  if (family === 'fusion-weight') {
    const fusionV4LongAtrWeight = clamp(numberOr(c.fusionV4LongAtrWeight, -0.25) + signedStep(level, 0.1), -5, 5);
    return { fusionV4LongAtrWeight };
  }

  if (family === 'asymmetry') {
    const delta = signedStep(level, 0.1);
    const fusionV4LongEmaWeight = clamp(numberOr(c.fusionV4LongEmaWeight, 0) + delta, -5, 5);
    const fusionV4ShortEmaWeight = clamp(numberOr(c.fusionV4ShortEmaWeight, 0) - delta, -5, 5);
    return { fusionV4LongEmaWeight, fusionV4ShortEmaWeight };
  }

  if (family === 'exit-state') {
    const trailAtrMult = clamp(numberOr(c.trailAtrMult, 1) + signedStep(level, 0.1), 0.1, 20);
    return { trailAtrMult };
  }

  return null;
}

function sourceConfig(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) return source.config;
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  return {};
}

export function buildGlobalMutationBatch({
  incumbent,
  champion,
  maxConfigs,
  frozenKeys,
  families,
  variantsPerFamily = 1,
  testedPatchFingerprints,
} = {}) {
  const source = incumbent ?? champion;
  const config = sourceConfig(source);
  const selectedFamilies = Array.isArray(families) && families.length > 0 ? families : DEFAULT_FAMILIES;
  const limit = normalizeMaxConfigs(maxConfigs);
  if (limit === 0) return [];

  const safeVariantsPerFamily = Math.max(1, Math.floor(Number(variantsPerFamily) || 1));
  const testedFingerprints = new Set(
    Array.isArray(testedPatchFingerprints)
      ? testedPatchFingerprints
      : testedPatchFingerprints instanceof Set
        ? [...testedPatchFingerprints]
        : [],
  );
  const emittedFingerprints = new Set();
  const originConfigId = source?.configId ?? source?.config?.configId ?? config?.configId ?? null;
  const out = [];
  const lane = 'global-all-parameter';

  for (const family of selectedFamilies) {
    for (let level = 1; level <= safeVariantsPerFamily; level += 1) {
      const patch = buildFamilyPatch({ family, config, level });
      if (!patch || typeof patch !== 'object') continue;
      if (hasFrozenKey(patch, frozenKeys)) continue;

      const normalizedPatch = Object.fromEntries(toPatchEntries(patch));
      const validation = validateGlobalMutationPatch(normalizedPatch, { frozenKeys });
      if (!validation.ok) continue;

      const patchFingerprint = buildGlobalPatchFingerprint({
        championId: originConfigId,
        lane,
        mutationFamily: family,
        patch: normalizedPatch,
      });
      if (testedFingerprints.has(patchFingerprint)) continue;
      if (emittedFingerprints.has(patchFingerprint)) continue;
      if (Object.entries(normalizedPatch).every(([key, value]) => Object.is(config?.[key], value))) continue;
      emittedFingerprints.add(patchFingerprint);

      const variantId = safeVariantsPerFamily === 1
        ? `${lane}-${family}`
        : `${lane}-${family}-p${String(level).padStart(2, '0')}`;
      out.push({
        candidateId: buildCandidateId({ lane, mutationFamily: family, patch: normalizedPatch }),
        variantId,
        lane,
        family,
        mutationFamily: family,
        axis: family,
        patch: normalizedPatch,
        config: { ...config, ...normalizedPatch },
        touchedKeys: Object.keys(normalizedPatch),
        patchFingerprint,
        metadata: {
          originConfigId,
          generatorVersion: GENERATOR_VERSION,
          mutationFamily: family,
          patchFingerprint,
          ladderLevel: level,
        },
      });

      if (out.length >= limit) return out;
    }
  }

  return out;
}
