import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIncumbentSearchBatch } from '../scripts/lib/pine-search-policy.mjs';
import { buildCanonicalConfigFingerprint } from '../scripts/lib/pine-global-search.mjs';

function fingerprint(config) {
  return buildCanonicalConfigFingerprint(config || {});
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

const signalPatches = [
  { neighborsCount: 24 },
  { neighborsCount: 40 },
  { adxThreshold: 15 },
  { adxThreshold: 25 },
  { minPredSum: 1.5 },
  { minPredSum: 2.5 },
  { minBarsBetween: 1 },
  { minBarsBetween: 4 },
  { h: 6 },
  { h: 10 },
  { r: 4 },
  { x: 20 },
];

const signalFingerprints = signalPatches.map((patch) => fingerprint({
  ...frozenIncumbent(incumbent),
  ...patch,
}));

const riskPatches = [
  { slAtrMult: 0.75 },
  { slAtrMult: 1.25 },
  { tpAtrMult: 2 },
  { tpAtrMult: 3 },
  { trailAtrMult: 0.75 },
  { trailAtrMult: 1.25 },
  { trailActivateR: 0 },
  { trailActivateR: 1 },
  { riskAtrLen: 7 },
  { riskAtrLen: 21 },
];

const requiredMinPredSumPatch = { minPredSum: 1.5 };

const riskFingerprints = riskPatches.map((patch) => fingerprint({
  ...frozenIncumbent(incumbent),
  ...patch,
}));

const enforcedRiskFingerprints = riskPatches.map((patch) => fingerprint({
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

  assert.deepEqual(batch, []);
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
  const fingerprints = batch.map((variant) => fingerprint(variant.config));

  assert.equal(batch.length, 12);
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

  assert.deepEqual(batch, []);
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

  assert.deepEqual(batch, []);
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

  assert.deepEqual(batch, []);
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

  assert.deepEqual(batch, []);
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

  assert.deepEqual(batch, []);
});
