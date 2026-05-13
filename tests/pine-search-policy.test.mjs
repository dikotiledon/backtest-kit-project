import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIncumbentSearchBatch, riskPatches, signalPatches } from '../scripts/lib/pine-search-policy.mjs';
import { buildCanonicalConfigFingerprint } from '../scripts/lib/pine-global-search.mjs';
import { buildSearchEfficiency } from '../scripts/pine-autoresearch.mjs';

function fingerprint(config) {
  return buildCanonicalConfigFingerprint(config || {});
}

function configFingerprint(config) {
  return fingerprint(config);
}

function buildBaselineConfig() {
  return {
    adxThreshold: 20,
    minPredSum: 1.8,
    minBarsBetween: 1,
    slAtrMult: 0.5,
    tpAtrMult: 7.6,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    riskAtrLen: 14,
    neighborsCount: 32,
    h: 8,
    r: 8,
    x: 25,
    useTrendXConf: true,
    useSignalFusion: true,
    useFusionV2: false,
    useFusionV3: false,
    useFusionV4: true,
    useSupertrendFilter: true,
    useTrailingStop: true,
    useStopsTP: true,
  };
}


function frozenIncumbent(config) {
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

const incumbent = {
  neighborsCount: 32,
  adxThreshold: 20,
  minPredSum: 2,
  minBarsBetween: 2,
  h: 8,
  r: 8,
  x: 25,
};

const incumbentSignalPatches = signalPatches(incumbent);

const signalFingerprints = incumbentSignalPatches.map((patch) => fingerprint({
  ...frozenIncumbent(incumbent),
  ...patch,
}));

const incumbentRiskPatches = riskPatches(incumbent);

const requiredMinPredSumPatch = { minPredSum: 1.5 };

const riskFingerprints = incumbentRiskPatches.map((patch) => fingerprint({
  ...frozenIncumbent(incumbent),
  ...patch,
}));

const enforcedRiskFingerprints = incumbentRiskPatches.map((patch) => fingerprint({
  ...frozenIncumbent(incumbent),
  ...patch,
  ...requiredMinPredSumPatch,
}));

const firstSignalFingerprint = signalFingerprints[0];

function firstExploitVariantWith(tabuRejectedFingerprints) {
  return buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['signal'] },
    schedulerState: { tabuRejectedFingerprints },
  })[0];
}

test('buildIncumbentSearchBatch keeps legacy string tabu entries blocking candidates', () => {
  const variant = firstExploitVariantWith([firstSignalFingerprint]);

  assert.equal(variant.tabuSkipped, 1);
  assert.equal(variant.patch.neighborsCount, 40);
});

test('buildIncumbentSearchBatch skips previously tested candidate fingerprints', () => {
  const firstBatch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['signal'] },
    schedulerState: {},
  });
  const firstFingerprint = fingerprint(firstBatch[0].config);

  const secondBatch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: {
      exploitFamilies: ['signal'],
      testedCandidateFingerprints: new Set([firstFingerprint]),
    },
    schedulerState: {},
  });

  assert.equal(secondBatch.length, 1);
  assert.notEqual(fingerprint(secondBatch[0].config), firstFingerprint);
  assert.equal(secondBatch[0].patch.neighborsCount, 40);
});

const allExploitFingerprints = [...signalFingerprints, ...riskFingerprints];

test('buildIncumbentSearchBatch fails closed when every exploit-family candidate is tested or tabu', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 4,
    historyEvents: [],
    policy: {
      exploitRatio: 1,
      exploitFamilies: ['signal', 'risk'],
      testedCandidateFingerprints: allExploitFingerprints.slice(0, signalFingerprints.length),
    },
    schedulerState: {
      tabuRejectedFingerprints: allExploitFingerprints.slice(signalFingerprints.length),
    },
  });

  assert.deepEqual(batch.filter((variant) => variant?.lane !== 'exhaustion'), []);
});

const hotAnnealingPolicy = {
  exploitFamilies: ['signal', 'risk'],
  exploreFamilies: ['signal'],
  annealing: {
    enabled: true,
    baseTemperature: 0.5,
    growthFactor: 2,
    maxTemperature: 4,
  },
};

test('buildIncumbentSearchBatch uses hot annealing for bounded diverse patches', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent: {
      ...incumbent,
      slAtrMult: 1,
      tpAtrMult: 2.5,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      riskAtrLen: 14,
    },
    maxConfigs: 4,
    historyEvents: [],
    policy: hotAnnealingPolicy,
    schedulerState: { noChangeStreak: 4 },
  });

  assert.equal(batch.length, 4);
  assert.ok(batch.some((variant) => Object.keys(variant.patch).length > 1));
  for (const variant of batch) {
    if (Object.hasOwn(variant.patch, 'adxThreshold')) {
      assert.ok(variant.patch.adxThreshold <= 30, `adxThreshold was ${variant.patch.adxThreshold}`);
    }
  }
});

test('buildIncumbentSearchBatch does not replay duplicate final configs within one batch', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 20,
    historyEvents: [],
    policy: { exploitRatio: 1, exploitFamilies: ['signal'] },
    schedulerState: {},
  });
  const emittedBatch = batch.filter((variant) => variant?.lane !== 'exhaustion');
  const fingerprints = emittedBatch.map((variant) => fingerprint(variant.config));

  assert.equal(emittedBatch.length, 12);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test('buildIncumbentSearchBatch hot annealing keeps default signal bounds off reckless edges', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 12,
    historyEvents: [],
    policy: {
      exploitRatio: 1,
      exploitFamilies: ['signal'],
      annealing: { enabled: true, baseTemperature: 0.5, growthFactor: 2, maxTemperature: 4 },
    },
    schedulerState: { noChangeStreak: 4 },
  });

  assert.equal(batch.length, 12);
  for (const variant of batch) {
    if (Object.hasOwn(variant.patch, 'neighborsCount')) {
      assert.ok(variant.patch.neighborsCount >= 12, `neighborsCount was ${variant.patch.neighborsCount}`);
    }
    if (Object.hasOwn(variant.patch, 'minPredSum')) {
      assert.ok(variant.patch.minPredSum >= 1, `minPredSum was ${variant.patch.minPredSum}`);
    }
    if (Object.hasOwn(variant.patch, 'h')) {
      assert.ok(variant.patch.h >= 4, `h was ${variant.patch.h}`);
    }
    if (Object.hasOwn(variant.patch, 'r')) {
      assert.ok(variant.patch.r >= 2, `r was ${variant.patch.r}`);
    }
    if (Object.hasOwn(variant.patch, 'x')) {
      assert.ok(variant.patch.x >= 15, `x was ${variant.patch.x}`);
    }
  }
});

test('buildIncumbentSearchBatch freezes architecture from champion values instead of defaults', () => {
  const champion = {
    ...incumbent,
    useSignalFusion: false,
    useFusionV2: true,
    useFusionV3: true,
    useFusionV4: false,
    useSupertrendFilter: false,
    useTrailingStop: false,
    useStopsTP: false,
  };

  const [variant] = buildIncumbentSearchBatch({
    incumbent: champion,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['signal'] },
    schedulerState: {},
  });

  for (const key of [
    'useSignalFusion',
    'useFusionV2',
    'useFusionV3',
    'useFusionV4',
    'useSupertrendFilter',
    'useTrailingStop',
    'useStopsTP',
  ]) {
    assert.equal(variant.config[key], champion[key], key);
  }
});

test('buildIncumbentSearchBatch fails closed when all signal candidates are tested entries', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: {
      exploitFamilies: ['signal'],
      testedCandidateFingerprints: signalFingerprints,
    },
    schedulerState: {},
  });

  assert.deepEqual(batch.filter((variant) => variant?.lane !== 'exhaustion'), []);
});

test('buildIncumbentSearchBatch reads object tabu entries by fingerprint', () => {
  const variant = firstExploitVariantWith([
    { fingerprint: firstSignalFingerprint, addedAtCycle: 3, championFingerprint: 'champ-1' },
  ]);

  assert.equal(variant.tabuSkipped, 1);
  assert.equal(variant.patch.neighborsCount, 40);
});

test('buildIncumbentSearchBatch fails closed when all signal candidates are legacy tabu entries', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['signal'] },
    schedulerState: { tabuRejectedFingerprints: signalFingerprints },
  });

  assert.deepEqual(batch.filter((variant) => variant?.lane !== 'exhaustion'), []);
});

test('buildIncumbentSearchBatch fails closed when all signal candidates are object tabu entries', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['signal'] },
    schedulerState: {
      tabuRejectedFingerprints: signalFingerprints.map((tabuFingerprint, index) => ({
        fingerprint: tabuFingerprint,
        addedAtCycle: index + 1,
        championFingerprint: `champ-${index + 1}`,
      })),
    },
  });

  assert.deepEqual(batch.filter((variant) => variant?.lane !== 'exhaustion'), []);
});

test('buildIncumbentSearchBatch emits final non-tabu config when raw required-key candidate is tabu', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['risk'], requiredTouchedKeys: ['minPredSum'] },
    schedulerState: { tabuRejectedFingerprints: riskFingerprints },
  });

  assert.equal(batch.length, 1);
  assert.equal(batch[0].tabuSkipped, 0);
  assert.deepEqual(batch[0].patch, { slAtrMult: 0.75, minPredSum: 1.5 });
  assert.notEqual(fingerprint(batch[0].config), riskFingerprints[0]);
  assert.equal(fingerprint(batch[0].config), enforcedRiskFingerprints[0]);
});

test('buildIncumbentSearchBatch emits final non-tabu config when raw object-shaped tabu entry matches', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['risk'], requiredTouchedKeys: ['minPredSum'] },
    schedulerState: {
      tabuRejectedFingerprints: riskFingerprints.map((tabuFingerprint, index) => ({
        fingerprint: tabuFingerprint,
        addedAtCycle: index + 1,
        championFingerprint: `raw-risk-champ-${index + 1}`,
      })),
    },
  });

  assert.equal(batch.length, 1);
  assert.equal(batch[0].tabuSkipped, 0);
  assert.deepEqual(batch[0].patch, { slAtrMult: 0.75, minPredSum: 1.5 });
  assert.equal(fingerprint(batch[0].config), enforcedRiskFingerprints[0]);
});

test('buildIncumbentSearchBatch rejects tabu final configs after required key enforcement', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['risk'], requiredTouchedKeys: ['minPredSum'] },
    schedulerState: { tabuRejectedFingerprints: enforcedRiskFingerprints },
  });

  assert.deepEqual(batch.filter((variant) => variant?.lane !== 'exhaustion'), []);
});

test('buildIncumbentSearchBatch tries the next candidate when required key enforcement makes the first final config tabu', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['risk'], requiredTouchedKeys: ['minPredSum'] },
    schedulerState: { tabuRejectedFingerprints: [enforcedRiskFingerprints[0]] },
  });

  assert.equal(batch.length, 1);
  assert.equal(batch[0].tabuSkipped, 1);
  assert.deepEqual(batch[0].patch, { slAtrMult: 1.25, minPredSum: 1.5 });
  assert.notEqual(fingerprint(batch[0].config), enforcedRiskFingerprints[0]);
});

test('buildIncumbentSearchBatch rejects object-shaped tabu entries for enforced final configs', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent,
    maxConfigs: 1,
    historyEvents: [],
    policy: { exploitFamilies: ['risk'], requiredTouchedKeys: ['minPredSum'] },
    schedulerState: {
      tabuRejectedFingerprints: enforcedRiskFingerprints.map((tabuFingerprint, index) => ({
        fingerprint: tabuFingerprint,
        addedAtCycle: index + 1,
        championFingerprint: `risk-champ-${index + 1}`,
      })),
    },
  });

  assert.deepEqual(batch.filter((variant) => variant?.lane !== 'exhaustion'), []);
});

test('buildIncumbentSearchBatch reports tabu exhaustion when >75% of pool is rejected', () => {
  const base = buildBaselineConfig();
  const poolSample = [
    ...signalPatches(base),
    ...riskPatches(base),
  ];
  const tabuFingerprints = poolSample
    .slice(0, Math.ceil(poolSample.length * 0.9))
    .map((candidate) => configFingerprint({ ...base, ...candidate }));

  const batch = buildIncumbentSearchBatch({
    incumbent: base,
    maxConfigs: 8,
    historyEvents: [],
    policy: { testedCandidateFingerprints: tabuFingerprints, exploitRatio: 0.5 },
    schedulerState: { tabuRejectedFingerprints: tabuFingerprints.map((fingerprint) => ({ fingerprint })) },
  });

  const markers = batch.filter((variant) => variant?.lane === 'exhaustion');
  assert.ok(markers.length > 0, 'at least one exhaustion marker should be emitted');
  for (const marker of markers) {
    assert.equal(marker.family, 'incumbent-search');
    assert.ok(Array.isArray(marker.metadata?.exhaustedFamilies), 'metadata.exhaustedFamilies must be an array');
    assert.ok(marker.metadata.exhaustedFamilies.length > 0, 'metadata.exhaustedFamilies must be non-empty');
    assert.equal(typeof marker.metadata?.allCandidatesTabu, 'boolean');
  }

  const emittedNonMarkerCount = batch.filter((variant) => variant?.lane !== 'exhaustion' && !variant?.exhaustedFamily).length;
  for (const marker of markers) {
    assert.equal(marker.metadata.allCandidatesTabu, emittedNonMarkerCount === 0,
      'metadata.allCandidatesTabu must be true iff there are no emitted non-marker variants');
  }

  const efficiency = buildSearchEfficiency(batch);
  assert.equal(efficiency.variantCount, batch.length, 'variantCount must include marker entries');
  assert.equal(efficiency.emittedVariantCount, emittedNonMarkerCount, 'emittedVariantCount must exclude markers');
  assert.equal(efficiency.allCandidatesTabu, true, 'allCandidatesTabu must be true when signal and risk are both exhausted');
  const flaggedFamilies = new Set();
  for (const marker of markers) {
    for (const family of marker.metadata.exhaustedFamilies) flaggedFamilies.add(family);
  }
  for (const family of ['signal', 'risk']) {
    assert.ok(flaggedFamilies.has(family), `exhaustion marker must flag ${family}`);
    assert.ok(efficiency.exhaustedFamilies.includes(family), `efficiency.exhaustedFamilies must include ${family}`);
  }
});

test('buildIncumbentSearchBatch falls back to default pool exhaustion ratio for invalid overrides', () => {
  const base = buildBaselineConfig();
  const poolSample = [
    ...signalPatches(base),
    ...riskPatches(base),
  ];
  const tabuFingerprints = poolSample
    .slice(0, Math.ceil(poolSample.length * 0.9))
    .map((candidate) => configFingerprint({ ...base, ...candidate }));

  const batch = buildIncumbentSearchBatch({
    incumbent: base,
    maxConfigs: 8,
    historyEvents: [],
    policy: { testedCandidateFingerprints: tabuFingerprints, exploitRatio: 0.5, poolExhaustionRatio: 0 },
    schedulerState: { tabuRejectedFingerprints: tabuFingerprints.map((fingerprint) => ({ fingerprint })) },
  });

  const marker = batch.find((variant) => variant?.lane === 'exhaustion');
  assert.equal(marker?.metadata?.poolExhaustionRatio, 0.75, 'invalid exhaustion ratios must fall back to default');
});

test('buildIncumbentSearchBatch emits no exhaustion marker when pool has healthy emission', () => {
  const base = buildBaselineConfig();

  const batch = buildIncumbentSearchBatch({
    incumbent: base,
    maxConfigs: 8,
    historyEvents: [],
    policy: { testedCandidateFingerprints: [], exploitRatio: 0.5 },
    schedulerState: { tabuRejectedFingerprints: [] },
  });

  const markers = batch.filter((variant) => variant?.lane === 'exhaustion');
  assert.equal(markers.length, 0, 'no exhaustion marker when pool is healthy');
  assert.equal(batch.filter((variant) => variant?.exhaustedFamily).length, 0, 'no exhaustedFamily marker when pool is healthy');

  const efficiency = buildSearchEfficiency(batch);
  assert.equal(efficiency.allCandidatesTabu, false, 'allCandidatesTabu must be false when pool is healthy');
  assert.equal(efficiency.exhaustedFamilies.length, 0, 'no exhausted families when pool is healthy');
  assert.ok(efficiency.emittedVariantCount > 0, 'emittedVariantCount must be > 0 when pool is healthy');
});

test('buildIncumbentSearchBatch does not report exhaustion from batch de-dupe alone', () => {
  const base = buildBaselineConfig();

  const batch = buildIncumbentSearchBatch({
    incumbent: base,
    maxConfigs: 64,
    historyEvents: [],
    policy: { testedCandidateFingerprints: [], exploitRatio: 0.5 },
    schedulerState: { tabuRejectedFingerprints: [] },
  });

  const markers = batch.filter((variant) => variant?.lane === 'exhaustion');
  assert.equal(markers.length, 0, 'no exhaustion marker when only previous picks in the batch are tabu');

  const efficiency = buildSearchEfficiency(batch);
  assert.equal(efficiency.allCandidatesTabu, false, 'allCandidatesTabu must be false without external tabu pressure');
  assert.equal(efficiency.exhaustedFamilies.length, 0, 'batch de-dupe must not mark families exhausted');
  assert.ok(efficiency.emittedVariantCount > 0, 'healthy pool should emit non-marker variants');
});
