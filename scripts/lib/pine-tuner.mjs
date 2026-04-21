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

    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(combo);
  }

  return filtered;
}

function toLiteral(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value);
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
  slAtrMult: (value) => ({
    regex: /(slAtrMult\s*=\s*input\.float\()[-\d.]+(,\s+title="SL ATR x".*)/,
    replace: `$1${toLiteral(value)}$2`,
  }),
  tpAtrMult: (value) => ({
    regex: /(tpAtrMult\s*=\s*input\.float\()[-\d.]+(,\s+title="TP ATR x \(1:1 R:R by default\)".*)/,
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
};

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

export function getCandidateGrid(name = 'default') {
  if (name === 'focused') return focusedCandidateGrid();
  if (name === 'root-cause') return rootCauseCandidateGrid();
  if (name === 'profit-candidate') return profitCandidateGrid();
  if (name === 'exit-tuning' || name === 'exit-side') return exitTuningCandidateGrid();
  if (name === 'fusion-safe') return fusionSafeCandidateGrid();
  if (name === 'fusion-v2') return fusionV2CandidateGrid();
  if (name === 'fusion-v3') return fusionV3CandidateGrid();
  if (name === 'fusion-v4') return fusionV4CandidateGrid();
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
