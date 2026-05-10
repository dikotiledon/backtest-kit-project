import { hasPatchSupport } from './pine-tuner.mjs';

const FAMILY_PRIORITY = [
  'ml-core',
  'entry',
  'filters',
  'fusion',
  'risk',
  'exit',
  'exit-state',
  'squeeze',
  'divergence',
  'supertrend',
  'avwap-context',
  'channel-context',
  'context-aggregator',
  'context-exit-shaping',
];

const ARCHITECTURE_KEYS = new Set(['useFusionV2', 'useFusionV3', 'useFusionV4']);

const RAW_SURFACE = [
  { key: 'neighborsCount', family: 'ml-core', type: 'int', min: 1, max: 100, step: 8 },
  { key: 'h', family: 'ml-core', type: 'int', min: 3, max: 50, step: 3 },
  { key: 'r', family: 'ml-core', type: 'float', min: 0.25, max: 25, step: 1 },
  { key: 'x', family: 'ml-core', type: 'int', min: 2, max: 25, step: 4 },
  { key: 'lag', family: 'ml-core', type: 'int', min: 1, max: 2, step: 1 },
  { key: 'cap', family: 'ml-core', type: 'int', min: 10, max: 500, step: 25 },
  { key: 'sampleStride', family: 'ml-core', type: 'int', min: 1, max: 20, step: 1 },

  { key: 'useTrendXConf', family: 'entry', type: 'bool' },
  { key: 'minPredSum', family: 'entry', type: 'float', min: 0, max: 10, step: 0.2 },
  { key: 'minBarsBetween', family: 'entry', type: 'int', min: 0, max: 50, step: 1 },

  { key: 'useVolatilityFilter', family: 'filters', type: 'bool' },
  { key: 'useRegimeFilter', family: 'filters', type: 'bool' },
  { key: 'regimeThreshold', family: 'filters', type: 'float', min: -10, max: 10, step: 0.2 },
  { key: 'useAdxFilter', family: 'filters', type: 'bool' },
  { key: 'adxThreshold', family: 'filters', type: 'int', min: 0, max: 100, step: 2 },
  { key: 'useEmaFilter', family: 'filters', type: 'bool' },
  { key: 'emaPeriod', family: 'filters', type: 'int', min: 1, max: 500, step: 25 },
  { key: 'useSmaFilter', family: 'filters', type: 'bool' },
  { key: 'smaPeriod', family: 'filters', type: 'int', min: 1, max: 500, step: 25 },

  { key: 'useSignalFusion', family: 'fusion', type: 'bool' },
  { key: 'minFusionScore', family: 'fusion', type: 'int', min: 0, max: 4, step: 1 },
  { key: 'useAtrFlipConfirm', family: 'fusion', type: 'bool' },
  { key: 'use3LineConfirm', family: 'fusion', type: 'bool' },
  { key: 'useEngulfingConfirm', family: 'fusion', type: 'bool' },
  { key: 'useEmaCrossConfirm', family: 'fusion', type: 'bool' },
  { key: 'useFusionV2', family: 'fusion', type: 'bool', architecture: true },
  { key: 'fusionBonusPerSignal', family: 'fusion', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'fusionMaxBonus', family: 'fusion', type: 'float', min: 0, max: 5, step: 0.1 },
  { key: 'useFusionV3', family: 'fusion', type: 'bool', architecture: true },
  { key: 'fusionPenaltyPerMissing', family: 'fusion', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'useFusionV4', family: 'fusion', type: 'bool', architecture: true },
  { key: 'fusionV4MinAbsPrediction', family: 'fusion', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'fusionV4MaxAbsPrediction', family: 'fusion', type: 'float', min: 0, max: 20, step: 0.5 },
  { key: 'fusionV4LongAtrWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4LongEngulfWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4LongEmaWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4ShortAtrWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4ShortEngulfWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },
  { key: 'fusionV4ShortEmaWeight', family: 'fusion', type: 'float', min: -5, max: 5, step: 0.1 },

  { key: 'useSupertrendFilter', family: 'supertrend', type: 'bool' },
  { key: 'useSupertrendEntryConfirm', family: 'supertrend', type: 'bool' },
  { key: 'supertrendAtrLen', family: 'supertrend', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'supertrendFactor', family: 'supertrend', type: 'float', min: 0.1, max: 10, step: 0.25 },

  { key: 'useAvwapContext', family: 'avwap-context', type: 'bool' },
  { key: 'avwapSwingPeriod', family: 'avwap-context', type: 'int', min: 2, max: 300, step: 8 },
  { key: 'avwapReclaimFreshBars', family: 'avwap-context', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'avwapMaxDistanceAtr', family: 'avwap-context', type: 'float', min: 0, max: 20, step: 0.25 },
  { key: 'avwapMaxAnchorAge', family: 'avwap-context', type: 'int', min: 1, max: 500, step: 10 },
  { key: 'avwapRequireReclaimForEntry', family: 'avwap-context', type: 'bool' },

  { key: 'useChannelContext', family: 'channel-context', type: 'bool' },
  { key: 'channelDetectLength', family: 'channel-context', type: 'int', min: 2, max: 200, step: 4 },
  { key: 'channelCompressionThreshold', family: 'channel-context', type: 'float', min: 0, max: 10, step: 0.1 },
  { key: 'channelBreakoutFreshBars', family: 'channel-context', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'channelEnableRetest', family: 'channel-context', type: 'bool' },
  { key: 'channelRetestFreshBars', family: 'channel-context', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'channelHostileBlocksEntry', family: 'channel-context', type: 'bool' },

  { key: 'useContextAggregator', family: 'context-aggregator', type: 'bool' },
  { key: 'contextStrictRequireChannel', family: 'context-aggregator', type: 'bool' },
  { key: 'contextBoostAddsToStrength', family: 'context-aggregator', type: 'bool' },
  { key: 'contextBoostValue', family: 'context-aggregator', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'contextHostileBlocksEntry', family: 'context-aggregator', type: 'bool' },

  { key: 'useContextExitShaping', family: 'context-exit-shaping', type: 'bool' },
  { key: 'contextTightenTrailOnCaution', family: 'context-exit-shaping', type: 'bool' },
  { key: 'contextTrailTightenFactor', family: 'context-exit-shaping', type: 'float', min: 0.1, max: 1, step: 0.05 },
  { key: 'contextAllowEarlySignalExit', family: 'context-exit-shaping', type: 'bool' },

  { key: 'useSqueezeContext', family: 'squeeze', type: 'bool' },
  { key: 'squeezeLength', family: 'squeeze', type: 'int', min: 2, max: 200, step: 4 },
  { key: 'squeezeBbMult', family: 'squeeze', type: 'float', min: 0.1, max: 10, step: 0.25 },
  { key: 'squeezeKcMult', family: 'squeeze', type: 'float', min: 0.1, max: 10, step: 0.25 },
  { key: 'squeezeReleaseFreshBars', family: 'squeeze', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'squeezeBoostValue', family: 'squeeze', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'squeezePenaltyValue', family: 'squeeze', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'squeezeBlockNewEntries', family: 'squeeze', type: 'bool' },

  { key: 'useDivergenceContext', family: 'divergence', type: 'bool' },
  { key: 'divRsiLen', family: 'divergence', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'divPivotLeft', family: 'divergence', type: 'int', min: 1, max: 20, step: 1 },
  { key: 'divPivotRight', family: 'divergence', type: 'int', min: 1, max: 20, step: 1 },
  { key: 'divFreshBars', family: 'divergence', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'divLongBoostValue', family: 'divergence', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'divShortBoostValue', family: 'divergence', type: 'float', min: 0, max: 3, step: 0.05 },
  { key: 'divCautionPenaltyValue', family: 'divergence', type: 'float', min: 0, max: 3, step: 0.05 },

  { key: 'useStopsTP', family: 'risk', type: 'bool' },
  { key: 'riskAtrLen', family: 'risk', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'slAtrMult', family: 'risk', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'tpAtrMult', family: 'risk', type: 'float', min: 0.1, max: 50, step: 0.5 },

  { key: 'useSignalExits', family: 'exit', type: 'bool' },
  { key: 'useTrailingStop', family: 'exit', type: 'bool' },
  { key: 'trailAtrLen', family: 'exit', type: 'int', min: 1, max: 100, step: 3 },
  { key: 'trailAtrMult', family: 'exit', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'trailActivateR', family: 'exit', type: 'float', min: 0, max: 10, step: 0.25 },

  { key: 'useFailedFollowThroughTighten', family: 'exit-state', type: 'bool' },
  { key: 'followThroughBars', family: 'exit-state', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'followThroughMinProgressAtr', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'followThroughTightenTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'useTimeStop', family: 'exit-state', type: 'bool' },
  { key: 'timeStopBars', family: 'exit-state', type: 'int', min: 1, max: 300, step: 4 },
  { key: 'timeStopMinUnrealizedAtr', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'useContextCautionTighten', family: 'exit-state', type: 'bool' },
  { key: 'contextCautionDelta', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'contextCautionTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'usePartialDerisk', family: 'exit-state', type: 'bool' },
  { key: 'partialDeriskAtR', family: 'exit-state', type: 'float', min: 0, max: 10, step: 0.25 },
  { key: 'partialDeriskClosePct', family: 'exit-state', type: 'float', min: 0, max: 100, step: 5 },
  { key: 'usePostEntrySqueezeCollapseTighten', family: 'exit-state', type: 'bool' },
  { key: 'postEntrySqueezeCollapseBars', family: 'exit-state', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'postEntrySqueezeCollapseTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
  { key: 'useAdverseDivergenceTighten', family: 'exit-state', type: 'bool' },
  { key: 'adverseDivergenceBars', family: 'exit-state', type: 'int', min: 1, max: 100, step: 2 },
  { key: 'adverseDivergenceTrailAtrMult', family: 'exit-state', type: 'float', min: 0.1, max: 20, step: 0.1 },
];

function familyOrderRank(family) {
  const index = FAMILY_PRIORITY.indexOf(family);
  return index === -1 ? FAMILY_PRIORITY.length : index;
}

function compareCodePoints(left, right) {
  if (left === right) return 0;
  const leftPoints = Array.from(String(left));
  const rightPoints = Array.from(String(right));
  const limit = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < limit; index += 1) {
    const leftCodePoint = leftPoints[index].codePointAt(0);
    const rightCodePoint = rightPoints[index].codePointAt(0);
    if (leftCodePoint !== rightCodePoint) return leftCodePoint - rightCodePoint;
  }

  return leftPoints.length - rightPoints.length;
}

function roundNumeric(value, step = 1) {
  const stepText = String(step);
  const decimals = stepText.includes('.') ? stepText.split('.')[1].length : 0;
  return Number(Number(value).toFixed(Math.max(decimals, 6)));
}

function clamp(value, min, max) {
  let out = Number(value);
  if (!Number.isFinite(out)) return null;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function sourceConfig(source) {
  if (source?.config && typeof source.config === 'object' && !Array.isArray(source.config)) return source.config;
  if (source && typeof source === 'object' && !Array.isArray(source)) return source;
  return {};
}

function pushUnique(values, value) {
  if (!values.some((item) => Object.is(item, value))) values.push(value);
}

function mutationValuesForSpec(spec, current, levels) {
  if (spec.type === 'bool') {
    if (typeof current === 'boolean') return [!current];
    return [true, false];
  }
  return buildParameterLadder({ ...spec, value: current, levels });
}

function candidateForSpec(spec, config, value) {
  return {
    family: spec.family,
    mutationFamily: spec.family,
    axis: spec.key,
    patch: { [spec.key]: value },
    config: { ...config, [spec.key]: value },
    touchedKeys: [spec.key],
    metadata: {
      parameterKey: spec.key,
      parameterFamily: spec.family,
      parameterType: spec.type,
    },
  };
}

function familyCandidates(specs, config, levels) {
  const byAxis = [];
  for (const spec of specs) {
    const current = config[spec.key];
    const values = mutationValuesForSpec(spec, current, levels)
      .filter((value) => !Object.is(value, current));
    if (values.length > 0) byAxis.push(values.map((value) => candidateForSpec(spec, config, value)));
  }

  const candidates = [];
  const maxAxisDepth = Math.max(0, ...byAxis.map((items) => items.length));
  for (let depth = 0; depth < maxAxisDepth; depth += 1) {
    for (const axisCandidates of byAxis) {
      if (axisCandidates[depth]) candidates.push(axisCandidates[depth]);
    }
  }
  return candidates;
}

export function parameterSurfaceCatalog({ families = null, includeArchitecture = false } = {}) {
  const familySet = Array.isArray(families) && families.length > 0 ? new Set(families) : null;
  return RAW_SURFACE
    .filter((item) => hasPatchSupport(item.key))
    .filter((item) => !familySet || familySet.has(item.family))
    .filter((item) => includeArchitecture || item.architecture !== true)
    .map((item) => ({ ...item }))
    .sort((a, b) => familyOrderRank(a.family) - familyOrderRank(b.family) || compareCodePoints(a.key, b.key));
}

export function parameterSurfaceKeys(options = {}) {
  return parameterSurfaceCatalog(options).map((item) => item.key);
}

export function strategicParameterFamilies(options = {}) {
  return [...new Set(parameterSurfaceCatalog(options).map((item) => item.family))];
}

export function buildParameterLadder({ value, min = null, max = null, step = 1, levels = 4, type = 'float' } = {}) {
  const base = Number(value);
  const safeStep = Number(step);
  const safeLevels = Math.max(0, Math.floor(Number(levels) || 0));
  if (!Number.isFinite(base) || !Number.isFinite(safeStep) || safeStep <= 0 || safeLevels === 0) return [];

  const values = [];
  for (let level = 1; values.length < safeLevels; level += 1) {
    const magnitude = Math.ceil(level / 2) * safeStep;
    const signed = level % 2 === 1 ? magnitude : -magnitude;
    let next = clamp(base + signed, min, max);
    if (next === null) continue;
    next = type === 'int' ? Math.round(next) : roundNumeric(next, safeStep);
    if (!Object.is(next, base)) pushUnique(values, next);

    const boundDistance = Math.ceil(level / 2);
    if (boundDistance > safeLevels * 4 && values.length === 0) break;
    if (boundDistance > safeLevels * 4 && values.length < safeLevels) break;
  }
  return values;
}

export function buildSurfaceMutationCandidates({ champion, incumbent, maxConfigs = 8, families = null, levels = 4, includeArchitecture = false } = {}) {
  const config = sourceConfig(incumbent ?? champion);
  const limit = Math.max(0, Math.floor(Number(maxConfigs) || 0));
  if (limit === 0) return [];

  const catalog = parameterSurfaceCatalog({ families, includeArchitecture });
  const grouped = new Map();
  for (const spec of catalog) {
    if (!grouped.has(spec.family)) grouped.set(spec.family, []);
    grouped.get(spec.family).push(spec);
  }

  const queues = [...grouped.entries()]
    .sort(([left], [right]) => familyOrderRank(left) - familyOrderRank(right) || compareCodePoints(left, right))
    .map(([family, specs]) => ({ family, candidates: familyCandidates(specs, config, levels) }))
    .filter((queue) => queue.candidates.length > 0);

  const candidates = [];
  while (queues.length > 0 && candidates.length < limit) {
    for (const queue of queues) {
      const next = queue.candidates.shift();
      if (next) candidates.push(next);
      if (candidates.length >= limit) break;
    }
    for (let index = queues.length - 1; index >= 0; index -= 1) {
      if (queues[index].candidates.length === 0) queues.splice(index, 1);
    }
  }

  return candidates;
}

export const __parameterSurfaceInternals = {
  ARCHITECTURE_KEYS,
  FAMILY_PRIORITY,
  RAW_SURFACE,
  compareCodePoints,
};
