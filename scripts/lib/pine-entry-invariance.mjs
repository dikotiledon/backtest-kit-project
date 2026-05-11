export const DEFAULT_ENTRY_PARAMETER_KEYS = [
  'adxThreshold',
  'minPredSum',
  'minBarsBetween',
  'neighborsCount',
  'useSignalFusion',
  'useFusionV4',
];

function normalizeMinCycles(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(2, Math.floor(numeric));
}

function normalizeStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([, enabled]) => enabled !== false && enabled != null)
      .map(([key]) => String(key || '').trim())
      .filter(Boolean);
  }
  return [];
}

function collectTouchedKeys(cycle) {
  const keys = new Set();
  for (const key of normalizeStringList(cycle?.touchedKeys)) keys.add(key);
  for (const key of normalizeStringList(cycle?.entryInvariance?.touchedKeys)) keys.add(key);
  for (const key of normalizeStringList(cycle?.searchPlan?.touchedKeys)) keys.add(key);
  const variants = Array.isArray(cycle?.searchPlan?.variants) ? cycle.searchPlan.variants : [];
  for (const variant of variants) {
    for (const key of normalizeStringList(variant?.touchedKeys)) keys.add(key);
    if (variant?.patch && typeof variant.patch === 'object' && !Array.isArray(variant.patch)) {
      for (const key of Object.keys(variant.patch)) keys.add(key);
    }
  }
  return [...keys];
}

function readNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function challengerTradeCount(cycle) {
  return readNumber(
    cycle?.challenger?.tradeCount,
    cycle?.challengerTradeCount,
    cycle?.metrics?.challenger?.tradeCount,
    cycle?.result?.challenger?.tradeCount,
  );
}

function challengerWinRatePct(cycle) {
  return readNumber(
    cycle?.challenger?.winRatePct,
    cycle?.challengerWinRatePct,
    cycle?.metrics?.challenger?.winRatePct,
    cycle?.result?.challenger?.winRatePct,
  );
}

function allSame(values) {
  if (!values.length || values.some((value) => value === null)) return false;
  return values.every((value) => value === values[0]);
}

function effectivelyConstant(values, tolerance) {
  if (!values.length || values.some((value) => value === null)) return false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (max - min) < tolerance;
}

export function detectEntryParameterInvariance({ recentCycles = [], policy = {} } = {}) {
  const sourceCycles = Array.isArray(recentCycles)
    ? recentCycles.filter((cycle) => cycle && typeof cycle === 'object' && !Array.isArray(cycle))
    : [];
  const minCycles = normalizeMinCycles(policy?.minCycles ?? 5);
  const cycles = sourceCycles.slice(-minCycles);
  const cyclesConsidered = cycles.length;

  if (cyclesConsidered < minCycles) {
    return { flagged: false, reason: 'not_enough_cycles', cyclesConsidered };
  }

  const entryKeys = normalizeStringList(policy?.entryKeys).length
    ? normalizeStringList(policy.entryKeys)
    : DEFAULT_ENTRY_PARAMETER_KEYS;
  const entryKeySet = new Set(entryKeys);
  const touchedKeys = [...new Set(cycles.flatMap((cycle) => collectTouchedKeys(cycle)))];
  const touchedEntryKeys = touchedKeys.filter((key) => entryKeySet.has(key));
  const tradeCounts = cycles.map((cycle) => challengerTradeCount(cycle));
  const winRates = cycles.map((cycle) => challengerWinRatePct(cycle));
  const winRateTolerance = Number.isFinite(Number(policy?.winRateTolerancePct))
    ? Math.max(0, Number(policy.winRateTolerancePct))
    : 0.01;

  if (touchedEntryKeys.length === 0 && allSame(tradeCounts) && effectivelyConstant(winRates, winRateTolerance)) {
    return {
      flagged: true,
      reason: 'exit_only_drift',
      cyclesConsidered,
      untouchedEntryKeys: entryKeys.filter((key) => !touchedEntryKeys.includes(key)),
    };
  }

  return { flagged: false, reason: 'entry_keys_active_or_signal_varying', cyclesConsidered };
}
