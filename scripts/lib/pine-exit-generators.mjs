import { createHash } from 'node:crypto';

export const PARTIAL_TAKE_PROFIT_STATUS = 'blockedByPineFeasibility';

export const SUPPORTED_EXIT_PATCH_KEYS = ['slAtrMult', 'tpAtrMult', 'trailAtrMult', 'useTrailingStop'];

export const BLOCKED_EXIT_FAMILIES = {
  'breakeven-stop': 'unsupportedByPipeline',
  'time-stop': 'unsupportedByPipeline',
  'long-short-asymmetry': 'unsupportedByPipeline',
  'partial-take-profit': PARTIAL_TAKE_PROFIT_STATUS,
};

const NUMERIC_LIMITS = {
  slAtrMult: { minExclusive: 0, maxInclusive: 20 },
  trailAtrMult: { minExclusive: 0, maxInclusive: 20 },
  tpAtrMult: { minExclusive: 0, maxInclusive: 50 },
};

const BOOLEAN_KEYS = new Set(['useTrailingStop']);
const SUPPORTED_KEYS = new Set(SUPPORTED_EXIT_PATCH_KEYS);

function coerceFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback) {
  return Math.max(0.1, coerceFiniteNumber(value, fallback));
}

function canonicalPatch(patch) {
  return Object.fromEntries(Object.entries(patch).sort(([a], [b]) => a.localeCompare(b)));
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

export function validateExitPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'patch must be an object' };
  }

  for (const key of Object.keys(patch)) {
    if (!SUPPORTED_KEYS.has(key)) {
      return { ok: false, reason: 'unsupportedExitPatchKey', key };
    }

    const value = patch[key];
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') {
        return { ok: false, reason: `${key} must be boolean` };
      }
      continue;
    }

    if (!Number.isFinite(value)) {
      return { ok: false, reason: `${key} must be finite` };
    }

    const limits = NUMERIC_LIMITS[key];
    if (!limits || value <= limits.minExclusive || value > limits.maxInclusive) {
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
  return {
    config,
    slAtrMult: positive(config.slAtrMult, 1),
    tpAtrMult: positive(config.tpAtrMult, 2.5),
    useTrailingStop: config.useTrailingStop === true,
    trailAtrMult: positive(config.trailAtrMult, 1),
  };
}

export function buildExitFamilyCandidates({ incumbent, champion, regimeSliceId, maxConfigs } = {}) {
  const limit = normalizeMaxConfigs(maxConfigs);
  if (limit === 0) return [];

  const source = incumbent ?? champion;
  const base = normalizeBase(source);
  const patchPool = [
    {
      exitFamily: 'atr-stop-take-profit',
      patch: {
        slAtrMult: Math.min(20, Math.max(0.1, base.slAtrMult - 0.25)),
        tpAtrMult: Math.min(50, Math.max(0.1, base.tpAtrMult + 0.5)),
      },
      metadata: { axis: 'atr-core' },
    },
    {
      exitFamily: 'trailing-stop',
      patch: {
        useTrailingStop: !base.useTrailingStop,
        trailAtrMult: Math.min(20, Math.max(0.1, base.trailAtrMult)),
      },
      metadata: { axis: 'trailing-toggle' },
    },
  ];

  return patchPool
    .map((item) => {
      const patch = canonicalPatch(item.patch);
      const candidateId = buildCandidateId({ exitFamily: item.exitFamily, regimeSliceId, patch });
      return {
        candidateId,
        lane: 'exit-regime',
        family: 'exit-state',
        exitFamily: item.exitFamily,
        regimeSliceId,
        patch,
        variantId: `exit-regime-${candidateId}`,
        config: { ...base.config, ...patch },
        metadata: {
          ...item.metadata,
          partialTakeProfit: PARTIAL_TAKE_PROFIT_STATUS,
          blockedFamilies: BLOCKED_EXIT_FAMILIES,
          ...(source?.id ? { originConfigId: source.id } : {}),
        },
      };
    })
    .filter((item) => validateExitPatch(item.patch).ok)
    .slice(0, limit);
}
