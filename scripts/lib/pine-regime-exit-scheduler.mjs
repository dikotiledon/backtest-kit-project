const LANE_KEYS = ['exploit', 'exitRegime', 'globalAllParameter', 'robustness'];

const DEFAULT_RATIOS = {
  exploitRatio: 0.25,
  exitRegimeRatio: 0.35,
  globalAllParameterRatio: 0.25,
  robustnessRatio: 0.15,
};

export const STAGNATION_LANE_METADATA = {
  0: { preferredLane: 'exitRegime', strictPromotionGates: false },
  1: { preferredLane: 'globalAllParameter', strictPromotionGates: false },
  2: { preferredLane: 'globalAllParameter', strictPromotionGates: false, asymmetryEnabled: true },
  3: { preferredLane: 'globalAllParameter', strictPromotionGates: true, aggressiveGlobalSearch: true },
};

export function allocateRegimeExitLaneBudget({ maxConfigs, lanes = {} }) {
  const parsedMaxConfigs = Number(maxConfigs);
  const safeMaxConfigs = Number.isFinite(parsedMaxConfigs) ? Math.max(0, Math.floor(parsedMaxConfigs)) : 0;

  const ratioConfig = { ...DEFAULT_RATIOS, ...lanes };

  const baseSpecs = [
    { lane: 'exploit', ratio: ratioConfig.exploitRatio },
    { lane: 'exitRegime', ratio: ratioConfig.exitRegimeRatio },
    { lane: 'globalAllParameter', ratio: ratioConfig.globalAllParameterRatio },
    { lane: 'robustness', ratio: ratioConfig.robustnessRatio },
  ].map((entry, index) => {
    const parsedRatio = Number(entry.ratio);
    const ratio = Number.isFinite(parsedRatio) ? Math.max(0, parsedRatio) : 0;
    return { ...entry, index, ratio };
  });

  const ratioSum = baseSpecs.reduce((sum, spec) => sum + spec.ratio, 0);
  const useDefaultRatios = safeMaxConfigs > 0 && ratioSum <= 0;

  const specs = baseSpecs.map((spec) => {
    const fallbackRatio = DEFAULT_RATIOS[`${spec.lane}Ratio`];
    const effectiveRatio = useDefaultRatios ? fallbackRatio : spec.ratio;
    const normalizedRatio = ratioSum > 0 && !useDefaultRatios
      ? effectiveRatio / ratioSum
      : effectiveRatio;

    const raw = safeMaxConfigs * normalizedRatio;
    const floored = Math.floor(raw);

    return {
      ...spec,
      effectiveRatio,
      normalizedRatio,
      raw,
      floored,
      remainder: raw - floored,
    };
  });

  const budget = Object.fromEntries(LANE_KEYS.map((lane) => [lane, 0]));
  let allocated = 0;

  for (const spec of specs) {
    budget[spec.lane] = spec.floored;
    allocated += spec.floored;
  }

  let leftover = safeMaxConfigs - allocated;
  if (leftover > 0) {
    const ranked = [...specs].sort((a, b) => {
      if (b.remainder !== a.remainder) return b.remainder - a.remainder;
      return a.index - b.index;
    });

    for (let i = 0; i < leftover; i += 1) {
      const target = ranked[i % ranked.length];
      budget[target.lane] += 1;
    }
  }

  return budget;
}

function normalizeBudgetDebt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLaneBudget(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizeLaneKey(lane) {
  if (lane === 'exit-regime') return 'exitRegime';
  if (lane === 'global-all-parameter') return 'globalAllParameter';
  return LANE_KEYS.includes(lane) ? lane : null;
}

export function nextLaneBudgetDebt(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const { currentDebt = {}, allocation = {}, selectedLane = null } = source;
  const debtSource = currentDebt && typeof currentDebt === 'object' ? currentDebt : {};
  const allocationSource = allocation && typeof allocation === 'object' ? allocation : {};
  const nextDebt = Object.fromEntries(LANE_KEYS.map((lane) => [
    lane,
    normalizeBudgetDebt(debtSource[lane]) + normalizeLaneBudget(allocationSource[lane]),
  ]));
  const normalizedSelectedLane = normalizeLaneKey(selectedLane);
  if (normalizedSelectedLane) {
    const totalBudget = LANE_KEYS.reduce((sum, lane) => sum + normalizeLaneBudget(allocationSource[lane]), 0);
    nextDebt[normalizedSelectedLane] -= totalBudget;
  }
  return nextDebt;
}

export function resolveExhaustedResearchLanes({ schedulerState = {}, championConfigFingerprint = null, exhaustedLanes = [] } = {}) {
  const explicit = Array.isArray(exhaustedLanes)
    ? exhaustedLanes.map(normalizeLaneKey).filter(Boolean)
    : [];
  const persisted = championConfigFingerprint && schedulerState?.laneExhaustions?.[championConfigFingerprint]
    ? Object.keys(schedulerState.laneExhaustions[championConfigFingerprint]).map(normalizeLaneKey).filter(Boolean)
    : [];
  const exhausted = new Set([...explicit, ...persisted]);
  return LANE_KEYS.filter((lane) => exhausted.has(lane));
}

export function selectNextResearchLane({
  stagnationLevel = 0,
  budgetDebt = {},
  lanesEnabled = {},
  schedulerState = {},
  championConfigFingerprint = null,
  exhaustedLanes = [],
} = {}) {
  const exhausted = new Set(resolveExhaustedResearchLanes({ schedulerState, championConfigFingerprint, exhaustedLanes }));
  const enabledLanes = LANE_KEYS.filter((lane) => lanesEnabled[lane] !== false);
  if (enabledLanes.length === 0) return null;

  const selectableLanes = enabledLanes.filter((lane) => !exhausted.has(lane));
  if (selectableLanes.length === 0) return null;

  const normalizedStagnation = Math.max(0, Math.floor(Number(stagnationLevel) || 0));
  const metadata = STAGNATION_LANE_METADATA[Math.min(normalizedStagnation, 3)] ?? STAGNATION_LANE_METADATA[0];

  const priorityByStagnation = {
    0: ['exitRegime', 'globalAllParameter', 'exploit', 'robustness'],
    1: ['globalAllParameter', 'exitRegime', 'exploit', 'robustness'],
    2: ['globalAllParameter', 'exitRegime', 'exploit', 'robustness'],
    3: ['globalAllParameter', 'exitRegime', 'robustness', 'exploit'],
  };

  const priority = priorityByStagnation[Math.min(normalizedStagnation, 3)] ?? priorityByStagnation[0];
  const candidates = priority.filter((lane) => selectableLanes.includes(lane));

  if (candidates.length === 0) return selectableLanes.sort()[0];

  const preferredLane = candidates.includes(metadata.preferredLane) ? metadata.preferredLane : null;

  candidates.sort((a, b) => {
    const debtA = normalizeBudgetDebt(budgetDebt[a]);
    const debtB = normalizeBudgetDebt(budgetDebt[b]);

    if (debtB !== debtA) return debtB - debtA;
    if (preferredLane) {
      if (a === preferredLane && b !== preferredLane) return -1;
      if (b === preferredLane && a !== preferredLane) return 1;
    }
    return priority.indexOf(a) - priority.indexOf(b);
  });

  return candidates[0] ?? selectableLanes.sort()[0];
}
