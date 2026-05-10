export function normalizeVariantRecords(rawVariants = []) {
  return rawVariants.map((item, index) => {
    if (item?.config && typeof item.config === 'object') {
      const record = {
        variantId: item.variantId || `variant-${index + 1}`,
        lane: item.lane || 'legacy',
        family: item.family || 'legacy',
        config: { ...item.config },
      };
      if (item.mutationFamily !== undefined) record.mutationFamily = item.mutationFamily;
      if (item.patch && typeof item.patch === 'object' && !Array.isArray(item.patch)) record.patch = { ...item.patch };
      if (item.patchFingerprint !== undefined) record.patchFingerprint = item.patchFingerprint;
      if (item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)) record.metadata = { ...item.metadata };
      return record;
    }

    return {
      variantId: `variant-${index + 1}`,
      lane: 'legacy',
      family: 'legacy',
      config: { ...item },
    };
  });
}

const SHARED_TRACK_KNOB_KEYS = [
  'useTrendXConf',
  'useAdxFilter',
  'minPredSum',
  'minBarsBetween',
  'slAtrMult',
  'tpAtrMult',
  'trailAtrMult',
  'trailActivateR',
];

const TRACK_OWN_KNOB_KEYS = {
  squeeze: [
    'useSqueezeContext',
    'squeezeLength',
    'squeezeBbMult',
    'squeezeKcMult',
    'squeezeReleaseFreshBars',
    'squeezeBoostValue',
  ],
  divergence: [
    'useDivergenceContext',
    'divRsiLen',
    'divPivotLeft',
    'divPivotRight',
    'divFreshBars',
    'divLongBoostValue',
    'divShortBoostValue',
    'divCautionPenaltyValue',
  ],
  'exit-state': [
    'useFailedFollowThroughTighten',
    'followThroughBars',
    'followThroughMinProgressAtr',
    'followThroughTightenTrailAtrMult',
    'useTimeStop',
    'timeStopBars',
    'timeStopMinUnrealizedAtr',
    'useContextCautionTighten',
    'contextCautionDelta',
    'contextCautionTrailAtrMult',
    'usePartialDerisk',
    'partialDeriskAtR',
    'partialDeriskClosePct',
    'usePostEntrySqueezeCollapseTighten',
    'postEntrySqueezeCollapseBars',
    'postEntrySqueezeCollapseTrailAtrMult',
    'useAdverseDivergenceTighten',
    'adverseDivergenceBars',
    'adverseDivergenceTrailAtrMult',
  ],
  asymmetry: [
    'useRegimeFilter',
    'regimeThreshold',
    'adxThreshold',
  ],
};

function trackFamilyAliases(name = '') {
  const normalized = String(name || '').toLowerCase();
  if (normalized.includes('squeeze')) return 'squeeze';
  if (normalized.includes('divergence')) return 'divergence';
  if (normalized.includes('exit')) return 'exit-state';
  if (normalized.includes('asym')) return 'asymmetry';
  return normalized;
}

export function sharedKnobKeys() {
  return [...SHARED_TRACK_KNOB_KEYS];
}

export function trackOwnKnobKeys(trackId = '') {
  return [...(TRACK_OWN_KNOB_KEYS[trackFamilyAliases(trackId)] || [])];
}

export function cartesianProduct(grid) {
  const entries = Object.entries(grid);
  if (!entries.length) return [{}];

  let combos = [{}];
  for (const [key, values] of entries) {
    const next = [];
    for (const combo of combos) {
      for (const value of values) {
        next.push({ ...combo, [key]: value });
      }
    }
    combos = next;
  }
  return combos;
}

const AVWAP_CONTEXT_KEYS = [
  'avwapSwingPeriod',
  'avwapReclaimFreshBars',
  'avwapMaxDistanceAtr',
  'avwapMaxAnchorAge',
  'avwapRequireReclaimForEntry',
];

const CHANNEL_CONTEXT_KEYS = [
  'channelDetectLength',
  'channelCompressionThreshold',
  'channelBreakoutFreshBars',
  'channelEnableRetest',
  'channelRetestFreshBars',
  'channelHostileBlocksEntry',
];

const CONTEXT_AGGREGATOR_KEYS = [
  'contextStrictRequireChannel',
  'contextBoostAddsToStrength',
  'contextBoostValue',
  'contextHostileBlocksEntry',
];

const CONTEXT_EXIT_SHAPING_KEYS = [
  'contextTightenTrailOnCaution',
  'contextTrailTightenFactor',
  'contextAllowEarlySignalExit',
];

const SQUEEZE_CONTEXT_KEYS = [
  'useSqueezeContext',
  'squeezeLength',
  'squeezeBbMult',
  'squeezeKcMult',
  'squeezeReleaseFreshBars',
  'squeezeBoostValue',
];

const DIVERGENCE_CONTEXT_KEYS = [
  'useDivergenceContext',
  'divRsiLen',
  'divPivotLeft',
  'divPivotRight',
  'divFreshBars',
  'divLongBoostValue',
  'divShortBoostValue',
  'divCautionPenaltyValue',
];

const EXIT_STATE_HYPOTHESIS_KEYS = [
  'useFailedFollowThroughTighten',
  'useTimeStop',
  'useContextCautionTighten',
  'usePartialDerisk',
  'usePostEntrySqueezeCollapseTighten',
  'useAdverseDivergenceTighten',
];

function deleteKeys(target, keys) {
  for (const key of keys) {
    delete target[key];
  }
}

export function filterSweepCombos(combos) {
  const seen = new Set();
  const filtered = [];

  for (const combo of combos) {
    const normalized = { ...combo };

    if (normalized.useSignalFusion === false) {
      delete normalized.minFusionScore;
      delete normalized.useAtrFlipConfirm;
      delete normalized.use3LineConfirm;
      delete normalized.useEngulfingConfirm;
      delete normalized.useEmaCrossConfirm;
      delete normalized.useFusionV2;
      delete normalized.fusionBonusPerSignal;
      delete normalized.fusionMaxBonus;
      delete normalized.useFusionV3;
      delete normalized.fusionPenaltyPerMissing;
      delete normalized.useFusionV4;
      delete normalized.fusionV4MinAbsPrediction;
      delete normalized.fusionV4MaxAbsPrediction;
      delete normalized.fusionV4LongAtrWeight;
      delete normalized.fusionV4LongEngulfWeight;
      delete normalized.fusionV4LongEmaWeight;
      delete normalized.fusionV4ShortAtrWeight;
      delete normalized.fusionV4ShortEngulfWeight;
      delete normalized.fusionV4ShortEmaWeight;
    }

    if (normalized.useSignalFusion === true) {
      const enabledFusionCount = [
        normalized.useAtrFlipConfirm,
        normalized.use3LineConfirm,
        normalized.useEngulfingConfirm,
        normalized.useEmaCrossConfirm,
      ].filter(Boolean).length;

      if (enabledFusionCount === 0) {
        delete normalized.minFusionScore;
      }

      if (normalized.useFusionV4 !== true) {
        delete normalized.fusionV4MinAbsPrediction;
        delete normalized.fusionV4MaxAbsPrediction;
        delete normalized.fusionV4LongAtrWeight;
        delete normalized.fusionV4LongEngulfWeight;
        delete normalized.fusionV4LongEmaWeight;
        delete normalized.fusionV4ShortAtrWeight;
        delete normalized.fusionV4ShortEngulfWeight;
        delete normalized.fusionV4ShortEmaWeight;
      } else {
        if (normalized.useAtrFlipConfirm !== true) {
          delete normalized.fusionV4LongAtrWeight;
          delete normalized.fusionV4ShortAtrWeight;
        }
        if (normalized.useEngulfingConfirm !== true) {
          delete normalized.fusionV4LongEngulfWeight;
          delete normalized.fusionV4ShortEngulfWeight;
        }
        if (normalized.useEmaCrossConfirm !== true) {
          delete normalized.fusionV4LongEmaWeight;
          delete normalized.fusionV4ShortEmaWeight;
        }
      }
    }

    if (normalized.useSupertrendFilter !== true) {
      delete normalized.useSupertrendEntryConfirm;
      delete normalized.supertrendAtrLen;
      delete normalized.supertrendFactor;
    }

    if (normalized.useTrailingStop !== true) {
      delete normalized.trailAtrLen;
      delete normalized.trailAtrMult;
      delete normalized.trailActivateR;
    }

    if (normalized.useAvwapContext !== true) {
      deleteKeys(normalized, AVWAP_CONTEXT_KEYS);
    }

    if (normalized.useChannelContext !== true) {
      deleteKeys(normalized, CHANNEL_CONTEXT_KEYS);
    }

    if (normalized.useContextAggregator !== true) {
      deleteKeys(normalized, CONTEXT_AGGREGATOR_KEYS);
    }

    if (normalized.useContextExitShaping !== true) {
      deleteKeys(normalized, CONTEXT_EXIT_SHAPING_KEYS);
    }

    if (normalized.useSqueezeContext !== true) {
      deleteKeys(normalized, SQUEEZE_CONTEXT_KEYS);
    }

    if (normalized.useDivergenceContext !== true) {
      deleteKeys(normalized, DIVERGENCE_CONTEXT_KEYS);
    }

    if (normalized.useFailedFollowThroughTighten !== true) {
      delete normalized.followThroughBars;
      delete normalized.followThroughMinProgressAtr;
      delete normalized.followThroughTightenTrailAtrMult;
    }

    if (normalized.useTimeStop !== true) {
      delete normalized.timeStopBars;
      delete normalized.timeStopMinUnrealizedAtr;
    }

    if (normalized.useContextCautionTighten !== true) {
      delete normalized.contextCautionDelta;
      delete normalized.contextCautionTrailAtrMult;
    }

    if (normalized.usePartialDerisk !== true) {
      delete normalized.partialDeriskAtR;
      delete normalized.partialDeriskClosePct;
    }

    if (normalized.usePostEntrySqueezeCollapseTighten !== true) {
      delete normalized.postEntrySqueezeCollapseBars;
      delete normalized.postEntrySqueezeCollapseTrailAtrMult;
    }

    if (normalized.useAdverseDivergenceTighten !== true) {
      delete normalized.adverseDivergenceBars;
      delete normalized.adverseDivergenceTrailAtrMult;
    }

    const enabledExitStateHypotheses = EXIT_STATE_HYPOTHESIS_KEYS.filter((key) => normalized[key] === true).length;
    if (enabledExitStateHypotheses > 1) continue;

    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(combo);
  }

  return filtered;
}

function explicitVariantCombos(grid) {
  return Array.isArray(grid?.__variants) ? filterSweepCombos(grid.__variants.map((combo) => ({ ...combo }))) : null;
}

export function countSweepCombos(grid) {
  const explicit = explicitVariantCombos(grid);
  if (explicit) return explicit.length;
  return filterSweepCombos(cartesianProduct(grid)).length;
}

export function selectSweepCombos(grid, { maxConfigs = null, offset = 0 } = {}) {
  const combos = explicitVariantCombos(grid) || filterSweepCombos(cartesianProduct(grid));
  if (!combos.length) return [];
  if (maxConfigs == null || maxConfigs >= combos.length) return combos;

  const normalizedOffset = ((Number(offset) || 0) % combos.length + combos.length) % combos.length;
  const batch = [];
  for (let index = 0; index < maxConfigs; index++) {
    batch.push(combos[(normalizedOffset + index) % combos.length]);
  }
  return batch;
}

function toLiteral(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value);
}

function boolInputPatcher(key, title) {
  return (value) => ({
    regex: new RegExp(`(${key}\\s*=\\s*input\\.bool\\()(true|false)(,\\s+title="${title.replace(/[|()]/g, '\\$&')}".*)`),
    replace: `$1${toLiteral(value)}$3`,
  });
}

function intInputPatcher(key, title) {
  return (value) => ({
    regex: new RegExp(`(${key}\\s*=\\s*input\\.int\\()[-\\d.]+(,\\s+title="${title.replace(/[|()]/g, '\\$&')}".*)`),
    replace: `$1${toLiteral(value)}$2`,
  });
}

function floatInputPatcher(key, title) {
  return (value) => ({
    regex: new RegExp(`(${key}\\s*=\\s*input\\.float\\()[-\\d.]+(,\\s+title="${title.replace(/[|()]/g, '\\$&')}".*)`),
    replace: `$1${toLiteral(value)}$2`,
  });
}

const PATCHERS = {
  useTrendXConf: (value) => ({
    regex: /(useTrendXConf\s*=\s*input\.bool\()(true|false)(,\s+title="Require Confirmation Trend \(x\)".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  useSignalFusion: (value) => ({
    regex: /(useSignalFusion\s*=\s*input\.bool\()(true|false)(,\s+title="Use Signal Fusion".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  minFusionScore: (value) => ({
    regex: /(minFusionScore\s*=\s*input\.int\()[-\d.]+(,\s+title="Min Fusion Score".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useAtrFlipConfirm: (value) => ({
    regex: /(useAtrFlipConfirm\s*=\s*input\.bool\()(true|false)(,\s+title="Use ATR Flip Confirm".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  use3LineConfirm: (value) => ({
    regex: /(use3LineConfirm\s*=\s*input\.bool\()(true|false)(,\s+title="Use 3 Line Strike Confirm".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  useEngulfingConfirm: (value) => ({
    regex: /(useEngulfingConfirm\s*=\s*input\.bool\()(true|false)(,\s+title="Use Engulfing Confirm".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  useEmaCrossConfirm: (value) => ({
    regex: /(useEmaCrossConfirm\s*=\s*input\.bool\()(true|false)(,\s+title="Use EMA Cross Confirm".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  useFusionV2: (value) => ({
    regex: /(useFusionV2\s*=\s*input\.bool\()(true|false)(,\s+title="Use Fusion V2 Soft Mode".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  fusionBonusPerSignal: (value) => ({
    regex: /(fusionBonusPerSignal\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion Bonus Per Signal".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionMaxBonus: (value) => ({
    regex: /(fusionMaxBonus\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion Max Bonus".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useFusionV3: (value) => ({
    regex: /(useFusionV3\s*=\s*input\.bool\()(true|false)(,\s+title="Use Fusion V3 Threshold Shaping".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  fusionPenaltyPerMissing: (value) => ({
    regex: /(fusionPenaltyPerMissing\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion Penalty Per Missing Signal".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useFusionV4: (value) => ({
    regex: /(useFusionV4\s*=\s*input\.bool\()(true|false)(,\s+title="Use Fusion V4 Residual Layer".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  fusionV4MinAbsPrediction: (value) => ({
    regex: /(fusionV4MinAbsPrediction\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Min \|Prediction\|".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4MaxAbsPrediction: (value) => ({
    regex: /(fusionV4MaxAbsPrediction\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Max \|Prediction\|".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4LongAtrWeight: (value) => ({
    regex: /(fusionV4LongAtrWeight\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Long ATR Weight".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4LongEngulfWeight: (value) => ({
    regex: /(fusionV4LongEngulfWeight\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Long Engulf Weight".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4LongEmaWeight: (value) => ({
    regex: /(fusionV4LongEmaWeight\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Long EMA Weight".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4ShortAtrWeight: (value) => ({
    regex: /(fusionV4ShortAtrWeight\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Short ATR Weight".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4ShortEngulfWeight: (value) => ({
    regex: /(fusionV4ShortEngulfWeight\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Short Engulf Weight".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  fusionV4ShortEmaWeight: (value) => ({
    regex: /(fusionV4ShortEmaWeight\s*=\s*input\.float\()[-\d.]+(,\s+title="Fusion V4 Short EMA Weight".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  minPredSum: (value) => ({
    regex: /(minPredSum\s*=\s*input\.float\()[-\d.]+(,\s+title="Min Prediction Sum(?: \(strength\))?".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  minBarsBetween: (value) => ({
    regex: /(minBarsBetween\s*=\s*input\.int\()[-\d.]+(,\s*title="Cooldown Bars Between Entries".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useEmaFilter: (value) => ({
    regex: /(useEmaFilter\s*=\s*input\.bool\([^\n]*defval=)(true|false)/,
    replace: `$1${toLiteral(value)}`,
  }),
  emaPeriod: (value) => ({
    regex: /(emaPeriod\s*=\s*input\.int\(title="Period",\s*defval=)\d+(,\s*minval=1,\s*step=1,\s*group="Filters",\s*inline="ema".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useSmaFilter: (value) => ({
    regex: /(useSmaFilter\s*=\s*input\.bool\([^\n]*defval=)(true|false)/,
    replace: `$1${toLiteral(value)}`,
  }),
  smaPeriod: (value) => ({
    regex: /(smaPeriod\s*=\s*input\.int\(title="Period",\s*defval=)\d+(,\s*minval=1,\s*step=1,\s*group="Filters",\s*inline="sma".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  neighborsCount: (value) => ({
    regex: /(title='Neighbors Count',\s*defval=)\d+([^\n)]*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useKernelSmoothing: (value) => ({
    regex: /(useKernelSmoothing\s*=\s*)(true|false)/,
    replace: `$1${toLiteral(value)}`,
  }),
  useDynamicExits: (value) => ({
    regex: /(title="Use Dynamic Exits",\s*defval=)(true|false)(,\s*group="General Settings".*inline="exits"\)\))/, 
    replace: `$1${toLiteral(value)}$3`,
  }),
  h: (value) => ({
    regex: /(h\s*=\s*input\.int\()[-\d.]+(,\s*'Lookback Window'.*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  r: (value) => ({
    regex: /(r\s*=\s*input\.float\()[-\d.]+(,\s*'Relative Weighting'.*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  x: (value) => ({
    regex: /(x\s*=\s*input\.int\()[-\d.]+(,\s*"Regression Level".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  lag: (value) => ({
    regex: /(lag\s*=\s*input\.int\()[-\d.]+(,\s*"Lag".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useSupertrendFilter: (value) => ({
    regex: /(useSupertrendFilter\s*=\s*input\.bool\()(true|false)(,\s+title="Use Supertrend Filter".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  useSupertrendEntryConfirm: (value) => ({
    regex: /(useSupertrendEntryConfirm\s*=\s*input\.bool\()(true|false)(,\s+title="Require Supertrend Flip Confirm".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  supertrendAtrLen: (value) => ({
    regex: /(supertrendAtrLen\s*=\s*input\.int\()[-\d.]+(,\s+title="Supertrend ATR Length".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  supertrendFactor: (value) => ({
    regex: /(supertrendFactor\s*=\s*input\.float\()[-\d.]+(,\s+title="Supertrend Factor".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  slAtrMult: (value) => ({
    regex: /(slAtrMult\s*=\s*input\.float\()[-\d.]+(,\s+title="SL ATR x".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  tpAtrMult: (value) => ({
    regex: /(tpAtrMult\s*=\s*input\.float\()[-\d.]+(,\s+title="TP ATR x \(1:1 R:R by default\)".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useStopsTP: (value) => ({
    regex: /(useStopsTP\s*=\s*input\.bool\()(true|false)(,\s+title="Use ATR Stop\/Target".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  riskAtrLen: (value) => ({
    regex: /(riskAtrLen\s*=\s*input\.int\()[-\d.]+(,\s+title="ATR Length".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useSignalExits: (value) => ({
    regex: /(useSignalExits\s*=\s*input\.bool\()(true|false)(,\s+title="Use Signal-Based Exits \(in addition to SL\/TP\)".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  useTrailingStop: (value) => ({
    regex: /(useTrailingStop\s*=\s*input\.bool\()(true|false)(,\s+title="Use ATR Trailing Stop".*)/,
    replace: `$1${toLiteral(value)}$3`,
  }),
  trailAtrLen: (value) => ({
    regex: /(trailAtrLen\s*=\s*input\.int\()[-\d.]+(,\s+title="Trail ATR Length".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  trailAtrMult: (value) => ({
    regex: /(trailAtrMult\s*=\s*input\.float\()[-\d.]+(,\s+title="Trail ATR x".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  trailActivateR: (value) => ({
    regex: /(trailActivateR\s*=\s*input\.float\()[-\d.]+(,\s+title="Trail Activate at R".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useVolatilityFilter: (value) => ({
    regex: /(Use Volatility Filter",\s*defval=)(true|false)/,
    replace: `$1${toLiteral(value)}`,
  }),
  useRegimeFilter: (value) => ({
    regex: /(Use Regime Filter",\s*defval=)(true|false)/,
    replace: `$1${toLiteral(value)}`,
  }),
  useAdxFilter: (value) => ({
    regex: /(Use ADX Filter",\s*defval=)(true|false)/,
    replace: `$1${toLiteral(value)}`,
  }),
  regimeThreshold: (value) => ({
    regex: /(input\.float\(title="Threshold",\s*defval=)-?[\d.]+([^\n]*inline="regime"[^\n]*\))/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  adxThreshold: (value) => ({
    regex: /(input\.int\(title="Threshold",\s*defval=)\d+([^\n]*inline="adx"[^\n]*\))/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  useAvwapContext: boolInputPatcher('useAvwapContext', 'Use AVWAP Context'),
  avwapSwingPeriod: intInputPatcher('avwapSwingPeriod', 'AVWAP Swing Period'),
  useChannelContext: boolInputPatcher('useChannelContext', 'Use Breakout Context'),
  channelDetectLength: intInputPatcher('channelDetectLength', 'Channel Detect Length'),
  useContextAggregator: boolInputPatcher('useContextAggregator', 'Use Context Aggregator'),
  contextBoostValue: floatInputPatcher('contextBoostValue', 'Context Boost Value'),
  useContextExitShaping: boolInputPatcher('useContextExitShaping', 'Use Context Exit Shaping'),
  contextTrailTightenFactor: floatInputPatcher('contextTrailTightenFactor', 'Context Trail Tighten Factor'),
  useFailedFollowThroughTighten: boolInputPatcher('useFailedFollowThroughTighten', 'Use Failed Follow-Through Tighten'),
  followThroughBars: intInputPatcher('followThroughBars', 'Follow-Through Bars'),
  followThroughMinProgressAtr: floatInputPatcher('followThroughMinProgressAtr', 'Follow-Through Min Progress ATR'),
  followThroughTightenTrailAtrMult: floatInputPatcher('followThroughTightenTrailAtrMult', 'Follow-Through Tighten Trail ATR x'),
  useTimeStop: boolInputPatcher('useTimeStop', 'Use Time Stop'),
  timeStopBars: intInputPatcher('timeStopBars', 'Time Stop Bars'),
  timeStopMinUnrealizedAtr: floatInputPatcher('timeStopMinUnrealizedAtr', 'Time Stop Min Unrealized ATR'),
  useContextCautionTighten: boolInputPatcher('useContextCautionTighten', 'Use Context Caution Tighten'),
  contextCautionDelta: floatInputPatcher('contextCautionDelta', 'Context Caution Delta'),
  contextCautionTrailAtrMult: floatInputPatcher('contextCautionTrailAtrMult', 'Context Caution Trail ATR x'),
  usePartialDerisk: boolInputPatcher('usePartialDerisk', 'Use Partial De-Risk'),
  partialDeriskAtR: floatInputPatcher('partialDeriskAtR', 'Partial De-Risk At R'),
  partialDeriskClosePct: floatInputPatcher('partialDeriskClosePct', 'Partial De-Risk Close Pct'),
  usePostEntrySqueezeCollapseTighten: boolInputPatcher('usePostEntrySqueezeCollapseTighten', 'Use Post-Entry Squeeze Collapse Tighten'),
  postEntrySqueezeCollapseBars: intInputPatcher('postEntrySqueezeCollapseBars', 'Post-Entry Squeeze Collapse Bars'),
  postEntrySqueezeCollapseTrailAtrMult: floatInputPatcher('postEntrySqueezeCollapseTrailAtrMult', 'Post-Entry Squeeze Collapse Trail ATR x'),
  useAdverseDivergenceTighten: boolInputPatcher('useAdverseDivergenceTighten', 'Use Adverse Divergence Tighten'),
  adverseDivergenceBars: intInputPatcher('adverseDivergenceBars', 'Adverse Divergence Bars'),
  adverseDivergenceTrailAtrMult: floatInputPatcher('adverseDivergenceTrailAtrMult', 'Adverse Divergence Trail ATR x'),
  useSqueezeContext: boolInputPatcher('useSqueezeContext', 'Use Squeeze Context'),
  squeezeLength: intInputPatcher('squeezeLength', 'Squeeze Length'),
  squeezeBbMult: floatInputPatcher('squeezeBbMult', 'BB Multiplier'),
  squeezeKcMult: floatInputPatcher('squeezeKcMult', 'KC Multiplier'),
  squeezeReleaseFreshBars: intInputPatcher('squeezeReleaseFreshBars', 'Squeeze Release Fresh Bars'),
  squeezeBoostValue: floatInputPatcher('squeezeBoostValue', 'Squeeze Boost Value'),
  useDivergenceContext: boolInputPatcher('useDivergenceContext', 'Use Divergence Context'),
  divRsiLen: intInputPatcher('divRsiLen', 'Divergence RSI Length'),
  divPivotLeft: intInputPatcher('divPivotLeft', 'Divergence Pivot Left'),
  divPivotRight: intInputPatcher('divPivotRight', 'Divergence Pivot Right'),
  divFreshBars: intInputPatcher('divFreshBars', 'Divergence Fresh Bars'),
  divLongBoostValue: floatInputPatcher('divLongBoostValue', 'Divergence Long Boost'),
  divShortBoostValue: floatInputPatcher('divShortBoostValue', 'Divergence Short Boost'),
  divCautionPenaltyValue: floatInputPatcher('divCautionPenaltyValue', 'Divergence Caution Penalty'),
};

function sortPatchKeys(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function patchableParameterKeys() {
  return Object.keys(PATCHERS).sort(sortPatchKeys);
}

export function hasPatchSupport(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PATCHERS, key);
}

export function buildPatchPlan(config) {
  return Object.entries(config)
    .filter(([key]) => PATCHERS[key])
    .map(([key, value]) => ({ key, value, ...PATCHERS[key](value) }));
}

export function applyPatchPlan(source, plan) {
  let patched = source;
  for (const step of plan) {
    if (!step.regex.test(patched)) {
      throw new Error(`Patch failed for ${step.key}`);
    }
    patched = patched.replace(step.regex, step.replace);
  }
  return patched;
}

export function configIdFromCombo(index, combo) {
  const compact = Object.entries(combo)
    .map(([key, value]) => `${key}-${String(value).replace(/[^a-zA-Z0-9.-]+/g, '_')}`)
    .join('__');
  return `${String(index + 1).padStart(4, '0')}__${compact}`;
}

export function rankSweepResults(results) {
  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.metrics?.roiPct ?? 0) !== (a.metrics?.roiPct ?? 0)) return (b.metrics?.roiPct ?? 0) - (a.metrics?.roiPct ?? 0);
    if ((b.metrics?.winRatePct ?? 0) !== (a.metrics?.winRatePct ?? 0)) return (b.metrics?.winRatePct ?? 0) - (a.metrics?.winRatePct ?? 0);
    return (b.metrics?.tradeCount ?? 0) - (a.metrics?.tradeCount ?? 0);
  });
}

export function defaultCandidateGrid() {
  return {
    neighborsCount: [5, 8, 13],
    minPredSum: [0.5, 1.0, 1.5, 2.5],
    useTrendXConf: [false, true],
    minBarsBetween: [0, 2, 4],
    useEmaFilter: [false, true],
    useSmaFilter: [false, true],
    useKernelSmoothing: [false, true],
  };
}

export function focusedCandidateGrid() {
  return {
    useVolatilityFilter: [false, true],
    useRegimeFilter: [false, true],
    useAdxFilter: [false, true],
    regimeThreshold: [-1.5, -0.5, 0.5],
    adxThreshold: [10, 20],
    minPredSum: [0.5, 1.0],
    useTrendXConf: [false, true],
    minBarsBetween: [0],
  };
}

export function rootCauseCandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false, true],
    useAdxFilter: [false, true],
    adxThreshold: [10, 20],
    minPredSum: [0.5, 1.0, 1.5],
    useTrendXConf: [false, true],
    minBarsBetween: [0, 2],
  };
}

export function profitCandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false, true],
    useAdxFilter: [false, true],
    adxThreshold: [10, 20],
    minPredSum: [0.5, 1.0, 1.5],
    useTrendXConf: [true],
    minBarsBetween: [2],
  };
}

export function exitTuningCandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false],
    useAdxFilter: [true],
    adxThreshold: [20],
    minPredSum: [0.5, 1.0],
    useTrendXConf: [true],
    minBarsBetween: [2],
    slAtrMult: [1.0, 1.25, 1.5, 2.0],
    tpAtrMult: [1.0, 1.5, 2.0, 2.5],
  };
}

function toSweepGrid(config) {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, [value]]));
}

function exitStateBaseConfig() {
  return {
    useFailedFollowThroughTighten: false,
    followThroughBars: 4,
    followThroughMinProgressAtr: 0.75,
    followThroughTightenTrailAtrMult: 0.75,
    useTimeStop: false,
    timeStopBars: 8,
    timeStopMinUnrealizedAtr: 0.5,
    useContextCautionTighten: false,
    contextCautionDelta: 0.5,
    contextCautionTrailAtrMult: 0.75,
    usePartialDerisk: false,
    partialDeriskAtR: 1.0,
    partialDeriskClosePct: 50,
    usePostEntrySqueezeCollapseTighten: false,
    postEntrySqueezeCollapseBars: 4,
    postEntrySqueezeCollapseTrailAtrMult: 0.75,
    useAdverseDivergenceTighten: false,
    adverseDivergenceBars: 6,
    adverseDivergenceTrailAtrMult: 0.75,
  };
}

function exitStateResearchVariants() {
  const base = exitStateBaseConfig();
  return [
    { ...base, variantId: 'exit-state-failed-follow-through', useFailedFollowThroughTighten: true },
    { ...base, variantId: 'exit-state-time-stop', useTimeStop: true },
    { ...base, variantId: 'exit-state-context-caution', useContextCautionTighten: true },
    { ...base, variantId: 'exit-state-partial-derisk', usePartialDerisk: true },
    { ...base, variantId: 'exit-state-post-entry-squeeze', usePostEntrySqueezeCollapseTighten: true },
    { ...base, variantId: 'exit-state-adverse-divergence', useAdverseDivergenceTighten: true },
  ];
}

export function exitStateResearchCandidateGrid() {
  return {
    ...toSweepGrid(exitStateBaseConfig()),
    __variants: exitStateResearchVariants(),
  };
}

export function exitStateTighteningCandidateGrid() {
  return exitStateResearchCandidateGrid();
}

export function exitStateTimeStopCandidateGrid() {
  return {
    ...toSweepGrid(exitStateBaseConfig()),
    useTimeStop: [true],
    timeStopBars: [6, 8, 12],
    timeStopMinUnrealizedAtr: [0.0, 0.5, 1.0],
    useFailedFollowThroughTighten: [false],
    useContextCautionTighten: [false],
    usePartialDerisk: [false],
    usePostEntrySqueezeCollapseTighten: [false],
    useAdverseDivergenceTighten: [false],
  };
}

export function exitStatePartialDeriskCandidateGrid() {
  return {
    ...toSweepGrid(exitStateBaseConfig()),
    usePartialDerisk: [true],
    partialDeriskAtR: [0.75, 1.0, 1.5],
    partialDeriskClosePct: [25, 50],
    useFailedFollowThroughTighten: [false],
    useTimeStop: [false],
    useContextCautionTighten: [false],
    usePostEntrySqueezeCollapseTighten: [false],
    useAdverseDivergenceTighten: [false],
  };
}

export function exitStateContextCautionCandidateGrid() {
  return {
    ...toSweepGrid(exitStateBaseConfig()),
    useContextCautionTighten: [true],
    contextCautionDelta: [0.25, 0.5, 0.75],
    contextCautionTrailAtrMult: [0.5, 0.75],
    useFailedFollowThroughTighten: [false],
    useTimeStop: [false],
    usePartialDerisk: [false],
    usePostEntrySqueezeCollapseTighten: [false],
    useAdverseDivergenceTighten: [false],
  };
}

export function exitStatePostEntrySqueezeCandidateGrid() {
  return {
    ...toSweepGrid(exitStateBaseConfig()),
    usePostEntrySqueezeCollapseTighten: [true],
    postEntrySqueezeCollapseBars: [3, 5, 8],
    postEntrySqueezeCollapseTrailAtrMult: [0.5, 0.75],
    useFailedFollowThroughTighten: [false],
    useTimeStop: [false],
    useContextCautionTighten: [false],
    usePartialDerisk: [false],
    useAdverseDivergenceTighten: [false],
  };
}

export function exitStateAdverseDivergenceCandidateGrid() {
  return {
    ...toSweepGrid(exitStateBaseConfig()),
    useAdverseDivergenceTighten: [true],
    adverseDivergenceBars: [4, 6, 8],
    adverseDivergenceTrailAtrMult: [0.5, 0.75],
    useFailedFollowThroughTighten: [false],
    useTimeStop: [false],
    useContextCautionTighten: [false],
    usePartialDerisk: [false],
    usePostEntrySqueezeCollapseTighten: [false],
  };
}

export function exitStateCandidateGrid() {
  return exitStateResearchCandidateGrid();
}

export function asymmetryCandidateGrid() {
  return {
    useRegimeFilter: [false, true],
    regimeThreshold: [-0.5, 0.5],
    useAdxFilter: [false, true],
    adxThreshold: [15, 25],
  };
}

export function fusionSafeCandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false],
    useAdxFilter: [true],
    adxThreshold: [20],
    minPredSum: [0.5],
    useTrendXConf: [true],
    minBarsBetween: [2],
    slAtrMult: [1.0],
    tpAtrMult: [2.5],
    useSignalFusion: [false, true],
    minFusionScore: [1, 2],
    useAtrFlipConfirm: [false, true],
    use3LineConfirm: [false, true],
    useEngulfingConfirm: [false, true],
    useEmaCrossConfirm: [false, true],
  };
}

export function fusionV2CandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false],
    useAdxFilter: [true],
    adxThreshold: [20],
    minPredSum: [0.5, 0.75, 1.0],
    useTrendXConf: [true],
    minBarsBetween: [2],
    slAtrMult: [1.0],
    tpAtrMult: [2.5],
    useSignalFusion: [true],
    useFusionV2: [true],
    fusionBonusPerSignal: [0.25, 0.5],
    fusionMaxBonus: [0.5, 1.0],
    useAtrFlipConfirm: [true],
    use3LineConfirm: [false, true],
    useEngulfingConfirm: [false],
    useEmaCrossConfirm: [false, true],
  };
}

export function fusionV3CandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false],
    useAdxFilter: [true],
    adxThreshold: [20],
    minPredSum: [0.5, 0.75, 1.0],
    useTrendXConf: [true],
    minBarsBetween: [2],
    slAtrMult: [1.0],
    tpAtrMult: [2.5],
    useSignalFusion: [true],
    useFusionV2: [false],
    useFusionV3: [true],
    fusionBonusPerSignal: [0.25, 0.5],
    fusionMaxBonus: [0.5, 1.0],
    fusionPenaltyPerMissing: [0.25, 0.5],
    useAtrFlipConfirm: [true],
    use3LineConfirm: [false, true],
    useEngulfingConfirm: [false],
    useEmaCrossConfirm: [false, true],
  };
}

export function fusionV4CandidateGrid() {
  return {
    useRegimeFilter: [false],
    useVolatilityFilter: [false],
    useAdxFilter: [true],
    adxThreshold: [20],
    minPredSum: [2.0],
    useTrendXConf: [true],
    minBarsBetween: [2],
    slAtrMult: [1.0],
    tpAtrMult: [2.5],
    useSignalFusion: [true],
    useFusionV2: [false],
    useFusionV3: [false],
    useFusionV4: [true],
    fusionV4MinAbsPrediction: [2.0],
    fusionV4MaxAbsPrediction: [4.0],
    useAtrFlipConfirm: [true],
    use3LineConfirm: [false],
    useEngulfingConfirm: [false, true],
    useEmaCrossConfirm: [false, true],
    fusionV4LongAtrWeight: [-0.25],
    fusionV4LongEngulfWeight: [-0.25],
    fusionV4LongEmaWeight: [0.0],
    fusionV4ShortAtrWeight: [-0.5],
    fusionV4ShortEngulfWeight: [-0.1, 0.0],
    fusionV4ShortEmaWeight: [0.0, 0.25],
  };
}

export function squeezeContextCandidateGrid() {
  return {
    useSqueezeContext: [true],
    squeezeLength: [20, 34],
    squeezeBbMult: [2.0, 2.5],
    squeezeKcMult: [1.5, 2.0],
    squeezeReleaseFreshBars: [4, 8],
    squeezeBoostValue: [0.25, 0.5],
  };
}

export function divergenceContextCandidateGrid() {
  return {
    useDivergenceContext: [true],
    divRsiLen: [14, 21],
    divPivotLeft: [3, 5],
    divPivotRight: [3, 5],
    divFreshBars: [6, 8],
    divLongBoostValue: [0.25, 0.5],
    divShortBoostValue: [0.25, 0.5],
    divCautionPenaltyValue: [0.0, 0.25],
  };
}

function phase3CoreBaseConfig() {
  return {
    neighborsCount: 32,
    useVolatilityFilter: false,
    useRegimeFilter: false,
    useAdxFilter: true,
    regimeThreshold: -0.1,
    adxThreshold: 20,
    useEmaFilter: false,
    emaPeriod: 200,
    useSmaFilter: false,
    smaPeriod: 200,
    h: 8,
    r: 8.0,
    x: 25,
    lag: 2,
    minPredSum: 2.0,
    useTrendXConf: true,
    minBarsBetween: 2,
    useSignalFusion: true,
    minFusionScore: 1,
    useFusionV2: false,
    useFusionV3: false,
    useFusionV4: true,
    fusionV4MinAbsPrediction: 2.0,
    fusionV4MaxAbsPrediction: 4.0,
    useAtrFlipConfirm: true,
    use3LineConfirm: false,
    useEngulfingConfirm: true,
    useEmaCrossConfirm: false,
    fusionV4LongAtrWeight: -0.25,
    fusionV4LongEngulfWeight: -0.25,
    fusionV4LongEmaWeight: 0.0,
    fusionV4ShortAtrWeight: -0.5,
    fusionV4ShortEngulfWeight: -0.1,
    fusionV4ShortEmaWeight: 0.0,
    useSupertrendFilter: true,
    useSupertrendEntryConfirm: false,
    supertrendAtrLen: 10,
    supertrendFactor: 1.5,
    useStopsTP: true,
    riskAtrLen: 14,
    useSignalExits: false,
    slAtrMult: 1.0,
    tpAtrMult: 2.5,
    useTrailingStop: true,
    trailAtrLen: 14,
    trailAtrMult: 1.0,
    trailActivateR: 0.5,
    useAvwapContext: false,
    avwapSwingPeriod: 34,
    avwapReclaimFreshBars: 6,
    avwapMaxDistanceAtr: 1.0,
    avwapMaxAnchorAge: 100,
    avwapRequireReclaimForEntry: false,
    useChannelContext: false,
    channelDetectLength: 18,
    channelCompressionThreshold: 0.35,
    channelBreakoutFreshBars: 4,
    channelEnableRetest: false,
    channelRetestFreshBars: 6,
    channelHostileBlocksEntry: true,
    useContextAggregator: false,
    contextStrictRequireChannel: false,
    contextBoostAddsToStrength: false,
    contextBoostValue: 0.25,
    contextHostileBlocksEntry: true,
    useContextExitShaping: false,
    contextTightenTrailOnCaution: false,
    contextTrailTightenFactor: 0.75,
    contextAllowEarlySignalExit: false,
    useSqueezeContext: true,
    squeezeLength: 20,
    squeezeBbMult: 2.0,
    squeezeKcMult: 1.5,
    squeezeReleaseFreshBars: 4,
    squeezeBoostValue: 0.25,
    useDivergenceContext: true,
    divRsiLen: 14,
    divPivotLeft: 5,
    divPivotRight: 5,
    divFreshBars: 6,
    divLongBoostValue: 0.25,
    divShortBoostValue: 0.25,
    divCautionPenaltyValue: 0.0,
  };
}

function buildPhase3CoreVariants() {
  const base = phase3CoreBaseConfig();
  const contextPatches = [
    { useAvwapContext: true, avwapSwingPeriod: 34, avwapReclaimFreshBars: 6 },
    { useAvwapContext: true, avwapSwingPeriod: 50, avwapMaxDistanceAtr: 1.0 },
    { useChannelContext: true, channelDetectLength: 18, channelCompressionThreshold: 0.35 },
    { useChannelContext: true, channelDetectLength: 24, channelEnableRetest: true, channelRetestFreshBars: 6 },
    {
      useAvwapContext: true,
      useChannelContext: true,
      useContextAggregator: true,
      contextBoostAddsToStrength: true,
      contextBoostValue: 0.5,
    },
    {
      useAvwapContext: true,
      useChannelContext: true,
      useContextAggregator: true,
      useContextExitShaping: true,
      contextTightenTrailOnCaution: true,
      contextTrailTightenFactor: 0.75,
      contextAllowEarlySignalExit: true,
    },
  ];
  const corePatches = [
    { neighborsCount: 24 },
    { neighborsCount: 48 },
    { useVolatilityFilter: true },
    { useRegimeFilter: true, regimeThreshold: -0.5 },
    { useRegimeFilter: true, regimeThreshold: 0.5 },
    { adxThreshold: 15 },
    { adxThreshold: 25 },
    { useEmaFilter: true, emaPeriod: 100 },
    { useEmaFilter: true, emaPeriod: 200 },
    { useSmaFilter: true, smaPeriod: 100 },
    { useSmaFilter: true, smaPeriod: 200 },
    { h: 5 },
    { h: 13 },
    { r: 4.0 },
    { x: 15 },
    { lag: 1 },
    { minPredSum: 1.5 },
    { minPredSum: 2.5 },
    { minBarsBetween: 1 },
    { minBarsBetween: 4 },
    { minFusionScore: 2 },
    { squeezeLength: 34 },
    { squeezeBbMult: 2.5 },
    { squeezeKcMult: 2.0 },
    { squeezeReleaseFreshBars: 8 },
    { squeezeBoostValue: 0.5 },
    { divRsiLen: 21 },
    { divPivotLeft: 3, divPivotRight: 3 },
    { divFreshBars: 8 },
    { divLongBoostValue: 0.5, divShortBoostValue: 0.5 },
    { divCautionPenaltyValue: 0.25 },
    { useSupertrendEntryConfirm: true },
    { supertrendAtrLen: 7 },
    { supertrendAtrLen: 14 },
    { supertrendFactor: 2.0 },
    { supertrendFactor: 2.5 },
    { riskAtrLen: 21 },
    { useSignalExits: true },
    { slAtrMult: 1.25 },
    { tpAtrMult: 3.0 },
    { useTrailingStop: false },
    { trailAtrLen: 7 },
    { trailAtrLen: 21 },
    { trailAtrMult: 1.5 },
    { trailAtrMult: 2.0 },
    { trailActivateR: 1.0 },
    { trailActivateR: 1.5 },
    { useVolatilityFilter: true, adxThreshold: 25 },
    { useEmaFilter: true, emaPeriod: 100, useSmaFilter: true, smaPeriod: 200 },
    { h: 5, lag: 1 },
    { minPredSum: 2.5, minBarsBetween: 4 },
    { useSignalExits: true, useTrailingStop: false },
    { useSupertrendEntryConfirm: true, supertrendFactor: 2.0 },
    { riskAtrLen: 21, slAtrMult: 1.25, tpAtrMult: 3.0 },
  ];

  return [...contextPatches, ...corePatches].map((patch) => ({ ...base, ...patch }));
}

export function phase3CoreCandidateGrid() {
  return {
    neighborsCount: [24, 32, 48],
    useVolatilityFilter: [false, true],
    useRegimeFilter: [false, true],
    regimeThreshold: [-0.5, -0.1, 0.5],
    adxThreshold: [15, 20, 25],
    useEmaFilter: [false, true],
    emaPeriod: [50, 100, 150, 200, 300],
    useSmaFilter: [false, true],
    smaPeriod: [50, 100, 150, 200, 300],
    h: [4, 5, 8, 10, 13, 16, 21],
    r: [0.5, 1.0, 2.0, 4.0, 8.0, 16.0],
    x: [2, 5, 8, 12, 16, 20, 25],
    lag: [1, 2],
    minPredSum: [1.0, 1.5, 2.0, 2.5, 3.0],
    minBarsBetween: [0, 1, 2, 3, 5, 8],
    minFusionScore: [1, 2],
    fusionV4MinAbsPrediction: [2.0],
    fusionV4MaxAbsPrediction: [4.0],
    fusionV4LongAtrWeight: [-0.25],
    fusionV4LongEngulfWeight: [-0.25],
    fusionV4LongEmaWeight: [0.0],
    fusionV4ShortAtrWeight: [-0.5],
    fusionV4ShortEngulfWeight: [-0.1],
    fusionV4ShortEmaWeight: [0.0],
    useSupertrendEntryConfirm: [false, true],
    supertrendAtrLen: [7, 10, 14],
    supertrendFactor: [1.5, 2.0, 2.5],
    riskAtrLen: [7, 10, 14, 21, 28],
    useSignalExits: [false, true],
    slAtrMult: [0.75, 1.0, 1.25, 1.5, 2.0],
    tpAtrMult: [1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
    useTrailingStop: [false, true],
    trailAtrLen: [7, 14, 21],
    trailAtrMult: [1.0, 1.5, 2.0],
    trailActivateR: [0.5, 1.0, 1.5],
    useSqueezeContext: [true],
    squeezeLength: [20, 34],
    squeezeBbMult: [2.0, 2.5],
    squeezeKcMult: [1.5, 2.0],
    squeezeReleaseFreshBars: [4, 8],
    squeezeBoostValue: [0.25, 0.5],
    useDivergenceContext: [true],
    divRsiLen: [14, 21],
    divPivotLeft: [3, 5],
    divPivotRight: [3, 5],
    divFreshBars: [6, 8],
    divLongBoostValue: [0.25, 0.5],
    divShortBoostValue: [0.25, 0.5],
    divCautionPenaltyValue: [0.0, 0.25],
    useAvwapContext: [false, true],
    avwapSwingPeriod: [21, 34, 50],
    avwapReclaimFreshBars: [4, 6, 10],
    avwapMaxDistanceAtr: [0.75, 1.0, 1.5],
    avwapMaxAnchorAge: [50, 100, 200],
    avwapRequireReclaimForEntry: [false, true],
    useChannelContext: [false, true],
    channelDetectLength: [14, 18, 24],
    channelCompressionThreshold: [0.25, 0.35, 0.5],
    channelBreakoutFreshBars: [2, 4, 6],
    channelEnableRetest: [false, true],
    channelRetestFreshBars: [4, 6],
    channelHostileBlocksEntry: [false, true],
    useContextAggregator: [false, true],
    contextStrictRequireChannel: [false, true],
    contextBoostAddsToStrength: [false, true],
    contextBoostValue: [0.25, 0.5],
    contextHostileBlocksEntry: [false, true],
    useContextExitShaping: [false, true],
    contextTightenTrailOnCaution: [false, true],
    contextTrailTightenFactor: [0.5, 0.75],
    contextAllowEarlySignalExit: [false, true],
    __variants: buildPhase3CoreVariants(),
  };
}

export function getCandidateGrid(name = 'default') {
  if (name === 'focused') return focusedCandidateGrid();
  if (name === 'root-cause') return rootCauseCandidateGrid();
  if (name === 'profit-candidate') return profitCandidateGrid();
  if (name === 'exit-tuning' || name === 'exit-side') return exitTuningCandidateGrid();
  if (name === 'exit-state-tightening' || name === 'exit-state-research' || name === 'exit-state' || name === 'exit-state-context') return exitStateCandidateGrid();
  if (name === 'exit-state-time-stop') return exitStateTimeStopCandidateGrid();
  if (name === 'exit-state-partial-derisk') return exitStatePartialDeriskCandidateGrid();
  if (name === 'exit-state-context-caution') return exitStateContextCautionCandidateGrid();
  if (name === 'exit-state-post-entry-squeeze') return exitStatePostEntrySqueezeCandidateGrid();
  if (name === 'exit-state-adverse-divergence') return exitStateAdverseDivergenceCandidateGrid();
  if (name === 'asymmetry' || name === 'asymmetry-context') return asymmetryCandidateGrid();
  if (name === 'fusion-safe') return fusionSafeCandidateGrid();
  if (name === 'fusion-v2') return fusionV2CandidateGrid();
  if (name === 'fusion-v3') return fusionV3CandidateGrid();
  if (name === 'fusion-v4') return fusionV4CandidateGrid();
  if (name === 'squeeze-context') return squeezeContextCandidateGrid();
  if (name === 'divergence-context') return divergenceContextCandidateGrid();
  if (name === 'phase3-core') return phase3CoreCandidateGrid();
  return defaultCandidateGrid();
}

export function leaderboardMarkdown(results, limit = 20) {
  const top = rankSweepResults(results).slice(0, limit);
  const lines = [
    '| rank | configId | score | trades | roiPct | winRatePct | baseLong | baseShort | startLong | startShort |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];

  top.forEach((item, idx) => {
    lines.push(`| ${idx + 1} | ${item.configId} | ${item.score} | ${item.metrics.tradeCount} | ${item.metrics.roiPct} | ${item.metrics.winRatePct} | ${item.diagnostics?.baseStartLongCount ?? 0} | ${item.diagnostics?.baseStartShortCount ?? 0} | ${item.diagnostics?.startLongCount ?? 0} | ${item.diagnostics?.startShortCount ?? 0} |`);
  });

  return `${lines.join('\n')}\n`;
}
