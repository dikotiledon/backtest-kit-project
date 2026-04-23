function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function allocateLaneBudget(maxConfigs, exploitRatio = 0.8) {
  const total = Math.max(0, Number(maxConfigs) || 0);
  if (total <= 1) return { exploit: total, explore: 0 };
  const rawExploit = Math.round(total * exploitRatio);
  const exploit = Math.min(total - 1, Math.max(1, rawExploit));
  return { exploit, explore: total - exploit };
}

function countCycles(historyEvents = []) {
  return historyEvents.filter((event) => event?.type === 'cycle').length;
}

function withPatch(base, patch, meta) {
  return {
    variantId: `${meta.lane}-${meta.family}-${meta.index}`,
    lane: meta.lane,
    family: meta.family,
    config: { ...clone(base), ...patch },
  };
}

function signalPatches(base) {
  return [
    { neighborsCount: Math.max(12, (base.neighborsCount || 32) - 8) },
    { neighborsCount: (base.neighborsCount || 32) + 8 },
    { adxThreshold: Math.max(10, (base.adxThreshold || 20) - 5) },
    { adxThreshold: (base.adxThreshold || 20) + 5 },
    { minPredSum: Math.max(1, (base.minPredSum || 2) - 0.5) },
    { minPredSum: (base.minPredSum || 2) + 0.5 },
    { minBarsBetween: Math.max(0, (base.minBarsBetween || 2) - 1) },
    { minBarsBetween: (base.minBarsBetween || 2) + 2 },
    { h: Math.max(4, (base.h || 8) - 2) },
    { h: (base.h || 8) + 2 },
    { r: Math.max(2, (base.r || 8) / 2) },
    { x: Math.max(15, (base.x || 25) - 5) },
  ];
}

function riskPatches(base) {
  return [
    { slAtrMult: Math.max(0.75, (base.slAtrMult || 1) - 0.25) },
    { slAtrMult: (base.slAtrMult || 1) + 0.25 },
    { tpAtrMult: Math.max(1.5, (base.tpAtrMult || 2.5) - 0.5) },
    { tpAtrMult: (base.tpAtrMult || 2.5) + 0.5 },
    { trailAtrMult: Math.max(0.75, (base.trailAtrMult || 1) - 0.25) },
    { trailAtrMult: (base.trailAtrMult || 1) + 0.25 },
    { trailActivateR: Math.max(0, (base.trailActivateR || 0.5) - 0.5) },
    { trailActivateR: (base.trailActivateR || 0.5) + 0.5 },
    { riskAtrLen: Math.max(7, (base.riskAtrLen || 14) - 7) },
    { riskAtrLen: (base.riskAtrLen || 14) + 7 },
  ];
}

function freezeArchitecture(config) {
  return {
    ...config,
    useSignalFusion: true,
    useFusionV2: false,
    useFusionV3: false,
    useFusionV4: true,
    useSupertrendFilter: true,
    useTrailingStop: true,
    useStopsTP: true,
  };
}

export function buildIncumbentSearchBatch({ incumbent, maxConfigs, historyEvents = [], policy = {} }) {
  const base = policy.freezeArchitecture === false ? clone(incumbent) : freezeArchitecture(incumbent);
  const { exploit, explore } = allocateLaneBudget(maxConfigs, policy.exploitRatio ?? 0.8);
  const exploitFamilies = policy.exploitFamilies?.length ? policy.exploitFamilies : ['signal', 'risk'];
  const exploreFamilies = policy.exploreFamilies?.length ? policy.exploreFamilies : ['signal'];
  const cycleCount = countCycles(historyEvents);

  const familyPatchMap = {
    signal: signalPatches(base),
    risk: riskPatches(base),
  };

  const orderedExploitFamilies = exploitFamilies.map((_, index) => exploitFamilies[(cycleCount + index) % exploitFamilies.length]);
  const batch = [];

  let index = 0;
  while (batch.length < exploit) {
    const family = orderedExploitFamilies[batch.length % orderedExploitFamilies.length];
    const pool = familyPatchMap[family];
    const patch = pool[index % pool.length];
    batch.push(withPatch(base, patch, { lane: 'exploit', family, index: batch.length + 1 }));
    index += 1;
  }

  for (let exploreIndex = 0; exploreIndex < explore; exploreIndex++) {
    const family = exploreFamilies[exploreIndex % exploreFamilies.length];
    const pool = familyPatchMap[family];
    const patch = pool[(cycleCount + exploreIndex + exploit) % pool.length];
    batch.push(withPatch(base, patch, { lane: 'explore', family, index: exploreIndex + 1 }));
  }

  return batch;
}
