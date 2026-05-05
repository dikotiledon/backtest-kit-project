export const PARTIAL_TAKE_PROFIT_STATUS = 'blockedByPineFeasibility';

const POSITIVE_KEYS = [
  'slAtrMult',
  'tpAtrMult',
  'trailAtrMult',
  'breakevenTriggerAtr',
  'maxBarsInTrade',
  'longSlAtrMult',
  'shortSlAtrMult',
  'longTpAtrMult',
  'shortTpAtrMult',
];

const BOOLEAN_KEYS = ['useTrailingStop', 'useBreakevenStop'];

function numeric(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
}

function positive(value, fallback) {
  return Math.max(0.1, numeric(value, fallback));
}

export function validateExitPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, reason: 'patch must be an object' };
  }

  for (const key of POSITIVE_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, reason: `${key} must be finite and > 0` };
    }
  }

  for (const key of BOOLEAN_KEYS) {
    if (!(key in patch)) continue;
    if (typeof patch[key] !== 'boolean') {
      return { ok: false, reason: `${key} must be boolean` };
    }
  }

  return { ok: true };
}

function normalizeBase(incumbent) {
  const config = incumbent?.config && typeof incumbent.config === 'object' ? incumbent.config : {};
  return {
    slAtrMult: positive(config.slAtrMult, 1),
    tpAtrMult: positive(config.tpAtrMult, 2.5),
    useTrailingStop: config.useTrailingStop === true,
    trailAtrMult: positive(config.trailAtrMult, 1),
    useBreakevenStop: config.useBreakevenStop === true,
    breakevenTriggerAtr: positive(config.breakevenTriggerAtr, 1),
    maxBarsInTrade: positive(config.maxBarsInTrade, 24),
    longSlAtrMult: positive(config.longSlAtrMult ?? config.slAtrMult, 1),
    shortSlAtrMult: positive(config.shortSlAtrMult ?? config.slAtrMult, 1),
    longTpAtrMult: positive(config.longTpAtrMult ?? config.tpAtrMult, 2.5),
    shortTpAtrMult: positive(config.shortTpAtrMult ?? config.tpAtrMult, 2.5),
  };
}

export function buildExitFamilyCandidates({ incumbent, regimeSliceId, maxConfigs } = {}) {
  const limit = Math.max(0, Math.floor(Number(maxConfigs) || 0));
  if (limit === 0) return [];

  const base = normalizeBase(incumbent);
  const patchPool = [
    {
      exitFamily: 'atr-stop-take-profit',
      patch: { slAtrMult: Math.max(0.1, base.slAtrMult - 0.25), tpAtrMult: base.tpAtrMult + 0.5 },
      metadata: { axis: 'atr-core' },
    },
    {
      exitFamily: 'trailing-stop',
      patch: { useTrailingStop: !base.useTrailingStop, trailAtrMult: base.trailAtrMult },
      metadata: { axis: 'trailing-toggle' },
    },
    {
      exitFamily: 'breakeven-stop',
      patch: { useBreakevenStop: !base.useBreakevenStop, breakevenTriggerAtr: base.breakevenTriggerAtr + 0.5 },
      metadata: { axis: 'breakeven' },
    },
    {
      exitFamily: 'time-stop',
      patch: { maxBarsInTrade: base.maxBarsInTrade + 6 },
      metadata: { axis: 'time-stop' },
    },
    {
      exitFamily: 'long-short-asymmetry',
      patch: {
        longSlAtrMult: Math.max(0.1, base.longSlAtrMult - 0.2),
        shortSlAtrMult: base.shortSlAtrMult + 0.2,
        longTpAtrMult: base.longTpAtrMult + 0.3,
        shortTpAtrMult: Math.max(0.1, base.shortTpAtrMult - 0.3),
      },
      metadata: { axis: 'asymmetry' },
    },
  ];

  const bounded = patchPool
    .map((item) => ({
      lane: 'exit-regime',
      family: 'exit-state',
      exitFamily: item.exitFamily,
      regimeSliceId,
      patch: item.patch,
      metadata: {
        ...item.metadata,
        partialTakeProfit: PARTIAL_TAKE_PROFIT_STATUS,
      },
    }))
    .filter((item) => validateExitPatch(item.patch).ok)
    .slice(0, limit);

  return bounded;
}
