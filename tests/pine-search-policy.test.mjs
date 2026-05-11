import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIncumbentSearchBatch } from '../scripts/lib/pine-search-policy.mjs';

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

function fingerprint(config) {
  return JSON.stringify(stableValue(config || {}));
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
