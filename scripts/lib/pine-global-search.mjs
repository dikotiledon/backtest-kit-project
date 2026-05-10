import { createHash } from 'node:crypto';

import { buildSurfaceMutationCandidates, parameterSurfaceCatalog } from './pine-parameter-surface.mjs';

const GENERATOR_VERSION = 'global-search-v2-parameter-surface';
export const PATCH_FINGERPRINT_VERSION = 2;
const PARAMETER_SURFACE_CATALOG = parameterSurfaceCatalog({ includeArchitecture: true });
const NUMERIC_PARAMETER_BOUNDS = new Map(
  PARAMETER_SURFACE_CATALOG
    .filter((item) => item.type !== 'bool')
    .map((item) => [item.key, { min: item.min, max: item.max, type: item.type }]),
);
const BOOLEAN_KEYS = new Set(
  PARAMETER_SURFACE_CATALOG
    .filter((item) => item.type === 'bool')
    .map((item) => item.key),
);
const ARCHITECTURE_BOOLEAN_KEYS = new Set(
  PARAMETER_SURFACE_CATALOG
    .filter((item) => item.architecture === true)
    .map((item) => item.key),
);
const KNOWN_KEYS = new Set(PARAMETER_SURFACE_CATALOG.map((item) => item.key));

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

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
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

const CONFIG_IDENTITY_KEYS = new Set([
  'configId',
  'id',
  'name',
  'label',
  'sourcePath',
  'sourceRunId',
  'promotedAt',
  'configFingerprint',
  'championConfigFingerprint',
]);

function stripConfigIdentity(value) {
  if (Array.isArray(value)) return value.map((item) => stripConfigIdentity(item));
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        if (CONFIG_IDENTITY_KEYS.has(key)) return acc;
        acc[key] = stripConfigIdentity(value[key]);
        return acc;
      }, {});
  }
  return value;
}

export function buildChampionConfigFingerprint(config = {}) {
  return JSON.stringify(stableValue(stripConfigIdentity(config || {})));
}

function canonicalGlobalLane(lane) {
  if (lane === 'globalAllParameter' || lane === 'global-all-parameter') return 'global-all-parameter';
  return lane ?? null;
}

export function buildGlobalPatchFingerprint({ championConfigFingerprint = null, lane, mutationFamily, patch } = {}) {
  if (typeof championConfigFingerprint !== 'string' || championConfigFingerprint.length === 0) {
    throw new Error('championConfigFingerprint is required for global patch fingerprint v2');
  }
  return createHash('sha256')
    .update(stableJson({
      championConfigFingerprint,
      lane: canonicalGlobalLane(lane),
      mutationFamily,
      patch: Object.fromEntries(toPatchEntries(patch || {})),
    }))
    .digest('hex');
}

export function buildLegacyGlobalPatchFingerprint({ championId = null, lane, mutationFamily, patch } = {}) {
  return createHash('sha256')
    .update(stableJson({
      championConfigFingerprint: null,
      legacyChampionId: championId ?? null,
      lane: canonicalGlobalLane(lane),
      mutationFamily,
      patch: Object.fromEntries(toPatchEntries(patch || {})),
    }))
    .digest('hex');
}

function compareCodePoint(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPatchEntries(patch) {
  return Object.entries(patch).sort(([a], [b]) => compareCodePoint(a, b));
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

    const bounds = NUMERIC_PARAMETER_BOUNDS.get(key);
    if (bounds?.type === 'int' && !Number.isInteger(value)) {
      return { ok: false, reason: 'integer key must be integer', key };
    }
    if (Number.isFinite(bounds?.min) && value < bounds.min) {
      return { ok: false, reason: 'numeric key below minimum', key };
    }
    if (Number.isFinite(bounds?.max) && value > bounds.max) {
      return { ok: false, reason: 'numeric key above maximum', key };
    }
  }

  return { ok: true };
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
  policy,
} = {}) {
  const source = incumbent ?? champion;
  const config = sourceConfig(source);
  const selectedFamilies = Array.isArray(families) && families.length > 0 ? families : null;
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
  const hasExplicitConfig = Boolean(source?.config && typeof source.config === 'object' && !Array.isArray(source.config));
  const hasInheritedConfigFingerprint = typeof source?.championConfigFingerprint === 'string'
    || typeof source?.metadata?.championConfigFingerprint === 'string';
  const championConfigFingerprint = (hasExplicitConfig || !hasInheritedConfigFingerprint)
    ? buildChampionConfigFingerprint(config)
    : (source?.championConfigFingerprint ?? source?.metadata?.championConfigFingerprint ?? null);
  const out = [];
  const lane = 'global-all-parameter';

  const surfaceCandidates = buildSurfaceMutationCandidates({
    champion: source,
    maxConfigs: limit * Math.max(1, safeVariantsPerFamily) * 4,
    families: selectedFamilies,
    levels: safeVariantsPerFamily,
    includeArchitecture: policy?.allowArchitectureKeys === true,
  });

  for (const surfaceCandidate of surfaceCandidates) {
    const family = surfaceCandidate.mutationFamily ?? surfaceCandidate.family;
    if (typeof family !== 'string' || family.length === 0) continue;

    const normalizedPatch = Object.fromEntries(toPatchEntries(surfaceCandidate.patch || {}));
    const validation = validateGlobalMutationPatch(normalizedPatch, {
      frozenKeys,
      allowArchitectureKeys: policy?.allowArchitectureKeys === true,
    });
    if (!validation.ok) continue;

    const patchFingerprint = buildGlobalPatchFingerprint({
      championConfigFingerprint,
      lane,
      mutationFamily: family,
      patch: normalizedPatch,
    });
    if (testedFingerprints.has(patchFingerprint)) continue;
    if (emittedFingerprints.has(patchFingerprint)) continue;
    if (Object.entries(normalizedPatch).every(([key, value]) => Object.is(config?.[key], value))) continue;
    emittedFingerprints.add(patchFingerprint);

    const axis = surfaceCandidate.axis ?? Object.keys(normalizedPatch)[0] ?? family;
    const variantId = `${lane}-${family}-${axis}-p${String(out.length + 1).padStart(3, '0')}`;
    out.push({
      ...surfaceCandidate,
      candidateId: buildCandidateId({ lane, mutationFamily: family, patch: normalizedPatch }),
      variantId,
      lane,
      family,
      mutationFamily: family,
      axis,
      patch: normalizedPatch,
      config: { ...config, ...normalizedPatch },
      touchedKeys: Object.keys(normalizedPatch),
      patchFingerprint,
      metadata: {
        ...(surfaceCandidate.metadata || {}),
        originConfigId,
        generatorVersion: GENERATOR_VERSION,
        mutationFamily: family,
        championConfigFingerprint,
        patchFingerprint,
        patchFingerprintVersion: PATCH_FINGERPRINT_VERSION,
      },
    });

    if (out.length >= limit) return out;
  }

  return out;
}
