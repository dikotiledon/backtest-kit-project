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
]);
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

function toPatchEntries(patch) {
  return Object.entries(patch).sort(([a], [b]) => a.localeCompare(b));
}

function hasFrozenKey(patch, frozenKeys) {
  const frozen = new Set((frozenKeys || []).filter((item) => typeof item === 'string'));
  return Object.keys(patch).some((key) => frozen.has(key));
}

export function validateGlobalMutationPatch(patch, { frozenKeys } = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'patch must be object' };
  }

  const keys = Object.keys(patch);
  if (keys.length === 0) return { ok: false, reason: 'patch must not be empty' };
  if (hasFrozenKey(patch, frozenKeys)) return { ok: false, reason: 'patch touches frozen key' };

  for (const [key, value] of Object.entries(patch)) {
    if (!KNOWN_KEYS.has(key)) return { ok: false, reason: 'unknown key', key };

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

function buildFamilyPatch({ family, config }) {
  const c = config || {};

  if (family === 'entry') {
    const minPredSum = clamp(numberOr(c.minPredSum, 2) + 0.2, 0.1, 10);
    return { minPredSum };
  }

  if (family === 'filters') {
    const adxThreshold = clamp(numberOr(c.adxThreshold, 20) + 2, 1, 100);
    return { adxThreshold };
  }

  if (family === 'risk') {
    const slAtrMult = clamp(numberOr(c.slAtrMult, 1) + 0.1, 0.1, 20);
    return { slAtrMult };
  }

  if (family === 'fusion-weight') {
    const fusionV4LongAtrWeight = clamp(numberOr(c.fusionV4LongAtrWeight, -0.25) + 0.1, -5, 5);
    return { fusionV4LongAtrWeight };
  }

  if (family === 'asymmetry') {
    const fusionV4LongEmaWeight = clamp(numberOr(c.fusionV4LongEmaWeight, 0) + 0.1, -5, 5);
    const fusionV4ShortEmaWeight = clamp(numberOr(c.fusionV4ShortEmaWeight, 0) - 0.1, -5, 5);
    return { fusionV4LongEmaWeight, fusionV4ShortEmaWeight };
  }

  if (family === 'exit-state') {
    const trailAtrMult = clamp(numberOr(c.trailAtrMult, 1) + 0.1, 0.1, 20);
    return { trailAtrMult };
  }

  return null;
}

export function buildGlobalMutationBatch({ incumbent, maxConfigs, frozenKeys, families } = {}) {
  const config = incumbent?.config && typeof incumbent.config === 'object' ? incumbent.config : {};
  const selectedFamilies = Array.isArray(families) && families.length > 0 ? families : DEFAULT_FAMILIES;
  const limit = normalizeMaxConfigs(maxConfigs);
  if (limit === 0) return [];

  const out = [];
  for (const family of selectedFamilies) {
    const patch = buildFamilyPatch({ family, config });
    if (!patch || typeof patch !== 'object') continue;
    if (hasFrozenKey(patch, frozenKeys)) continue;

    const normalizedPatch = Object.fromEntries(toPatchEntries(patch));
    const validation = validateGlobalMutationPatch(normalizedPatch, { frozenKeys });
    if (!validation.ok) continue;

    out.push({
      lane: 'global-all-parameter',
      mutationFamily: family,
      patch: normalizedPatch,
      touchedKeys: Object.keys(normalizedPatch),
    });

    if (out.length >= limit) break;
  }

  return out;
}
