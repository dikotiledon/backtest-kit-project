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
  const safeMaxConfigs = Math.max(0, Math.floor(Number(maxConfigs) || 0));
  const ratioConfig = { ...DEFAULT_RATIOS, ...lanes };

  const specs = [
    { lane: 'exploit', ratio: ratioConfig.exploitRatio },
    { lane: 'exitRegime', ratio: ratioConfig.exitRegimeRatio },
    { lane: 'globalAllParameter', ratio: ratioConfig.globalAllParameterRatio },
    { lane: 'robustness', ratio: ratioConfig.robustnessRatio },
  ].map((entry, index) => {
    const ratio = Number.isFinite(Number(entry.ratio)) ? Number(entry.ratio) : 0;
    const raw = safeMaxConfigs * ratio;
    const floored = Math.floor(raw);

    return { ...entry, index, raw, floored, remainder: raw - floored };
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

export function selectNextResearchLane({ stagnationLevel = 0, budgetDebt = {}, lanesEnabled = {} }) {
  const enabledLanes = LANE_KEYS.filter((lane) => lanesEnabled[lane] !== false);
  if (enabledLanes.length === 0) return null;

  const normalizedStagnation = Math.max(0, Math.floor(Number(stagnationLevel) || 0));
  const metadata = STAGNATION_LANE_METADATA[Math.min(normalizedStagnation, 3)] ?? STAGNATION_LANE_METADATA[0];

  const priorityByStagnation = {
    0: ['exitRegime', 'globalAllParameter', 'exploit', 'robustness'],
    1: ['globalAllParameter', 'exitRegime', 'exploit', 'robustness'],
    2: ['globalAllParameter', 'exitRegime', 'exploit', 'robustness'],
    3: ['globalAllParameter', 'exitRegime', 'robustness', 'exploit'],
  };

  const priority = priorityByStagnation[Math.min(normalizedStagnation, 3)] ?? priorityByStagnation[0];
  const candidates = priority.filter((lane) => enabledLanes.includes(lane));

  if (candidates.length === 0) return enabledLanes.sort()[0];

  candidates.sort((a, b) => {
    const debtA = Number(budgetDebt[a] ?? 0);
    const debtB = Number(budgetDebt[b] ?? 0);
    if (debtB !== debtA) return debtB - debtA;
    return priority.indexOf(a) - priority.indexOf(b);
  });

  if (candidates.includes(metadata.preferredLane)) return metadata.preferredLane;
  return candidates[0] ?? enabledLanes.sort()[0];
}
