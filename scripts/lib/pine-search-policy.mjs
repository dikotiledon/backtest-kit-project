function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function configFingerprint(config) {
  return JSON.stringify(stableValue(config || {}));
}

export function allocateLaneBudget(maxConfigs, exploitRatio = 0.8) {
  const total = Math.max(0, Number(maxConfigs) || 0);
  if (total <= 1) return { exploit: total, explore: 0 };
  const rawExploit = Math.round(total * exploitRatio);
  const exploit = Math.min(total - 1, Math.max(1, rawExploit));
  return { exploit, explore: total - exploit };
}

export function computeAnnealingState({ schedulerState = {}, policy = {} } = {}) {
  const annealing = policy.annealing || {};
  const enabled = annealing.enabled ?? false;
  const noChangeStreak = Math.max(0, Number(schedulerState.noChangeStreak) || 0);
  if (!enabled) return { enabled: false, noChangeStreak, temperature: 1 };
  const baseTemperature = annealing.baseTemperature ?? 0.4;
  const growthFactor = annealing.growthFactor ?? 1.8;
  const maxTemperature = annealing.maxTemperature ?? 4;
  const temperature = Math.min(maxTemperature, baseTemperature * (growthFactor ** noChangeStreak));
  return { enabled: true, noChangeStreak, temperature: Number(temperature.toFixed(4)) };
}

function countCycles(historyEvents = []) {
  return historyEvents.filter((event) => event?.type === 'cycle').length;
}

function withPatch(base, patch, meta) {
  return {
    variantId: `${meta.lane}-${meta.family}-${meta.index}`,
    lane: meta.lane,
    family: meta.family,
    temperature: meta.temperature ?? 1,
    tabuSkipped: meta.tabuSkipped ?? 0,
    config: { ...clone(base), ...patch },
  };
}

function scalePatch(base, patch, temperature) {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    const baseValue = Number(base[key]);
    if (typeof value !== 'number' || !Number.isFinite(baseValue)) return [key, value];
    const minValue = key.toLowerCase().includes('len') || key.toLowerCase().includes('bars') || key === 'neighborsCount' ? 1 : 0;
    const scaled = Math.max(minValue, baseValue + ((value - baseValue) * temperature));
    const integerLike = Number.isInteger(baseValue) && Number.isInteger(value);
    return [key, integerLike ? Math.round(scaled) : Number(scaled.toFixed(4))];
  }));
}

function normalizeTabuCache(value) {
  if (Array.isArray(value)) return new Set(value);
  if (value && typeof value === 'object') return new Set(Object.keys(value));
  return new Set();
}

function pickNonTabuVariant({ base, pool, startIndex, lane, family, batchIndex, tabuSet, temperature }) {
  let tabuSkipped = 0;
  for (let probe = 0; probe < pool.length; probe++) {
    const rawPatch = pool[(startIndex + probe) % pool.length];
    const patch = scalePatch(base, rawPatch, temperature);
    const candidate = { ...clone(base), ...patch };
    if (!tabuSet.has(configFingerprint(candidate))) {
      return { variant: withPatch(base, patch, { lane, family, index: batchIndex, temperature, tabuSkipped }), nextIndex: startIndex + probe + 1 };
    }
    tabuSkipped += 1;
  }
  const patch = scalePatch(base, pool[startIndex % pool.length], temperature);
  return { variant: withPatch(base, patch, { lane, family, index: batchIndex, temperature, tabuSkipped }), nextIndex: startIndex + 1 };
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

export function buildIncumbentSearchBatch({ incumbent, maxConfigs, historyEvents = [], policy = {}, schedulerState = {} }) {
  const base = policy.freezeArchitecture === false ? clone(incumbent) : freezeArchitecture(incumbent);
  const { exploit, explore } = allocateLaneBudget(maxConfigs, policy.exploitRatio ?? 0.8);
  const exploitFamilies = policy.exploitFamilies?.length ? policy.exploitFamilies : ['signal', 'risk'];
  const exploreFamilies = policy.exploreFamilies?.length ? policy.exploreFamilies : ['signal'];
  const cycleCount = countCycles(historyEvents);
  const annealingState = computeAnnealingState({ schedulerState, policy });
  const temperature = annealingState.temperature;
  const tabuSet = normalizeTabuCache(schedulerState.tabuRejectedFingerprints);

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
    const picked = pickNonTabuVariant({
      base,
      pool,
      startIndex: index,
      lane: 'exploit',
      family,
      batchIndex: batch.length + 1,
      tabuSet,
      temperature,
    });
    batch.push(picked.variant);
    index = picked.nextIndex;
  }

  for (let exploreIndex = 0; exploreIndex < explore; exploreIndex++) {
    const family = exploreFamilies[exploreIndex % exploreFamilies.length];
    const pool = familyPatchMap[family];
    const picked = pickNonTabuVariant({
      base,
      pool,
      startIndex: cycleCount + exploreIndex + exploit,
      lane: 'explore',
      family,
      batchIndex: exploreIndex + 1,
      tabuSet,
      temperature,
    });
    batch.push(picked.variant);
  }

  return batch;
}
