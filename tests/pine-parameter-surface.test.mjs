import test from 'node:test';
import assert from 'node:assert/strict';

import {
  __parameterSurfaceInternals,
  buildParameterLadder,
  buildSurfaceMutationCandidates,
  parameterSurfaceCatalog,
  parameterSurfaceKeys,
  strategicParameterFamilies,
} from '../scripts/lib/pine-parameter-surface.mjs';
import { hasPatchSupport } from '../scripts/lib/pine-tuner.mjs';

const champion = {
  configId: 'surface-champion',
  config: {
    neighborsCount: 32,
    h: 8,
    r: 8,
    x: 25,
    lag: 2,
    minPredSum: 1.8,
    minBarsBetween: 1,
    useAdxFilter: true,
    adxThreshold: 20,
    useRegimeFilter: false,
    regimeThreshold: -0.1,
    useFusionV4: true,
    fusionV4LongAtrWeight: -0.25,
    fusionV4ShortAtrWeight: -0.5,
    useSupertrendFilter: true,
    supertrendAtrLen: 10,
    supertrendFactor: 1.5,
    useSqueezeContext: true,
    squeezeLength: 20,
    squeezeBoostValue: 0.25,
    useDivergenceContext: true,
    divRsiLen: 21,
    divLongBoostValue: 0.7,
    useStopsTP: true,
    riskAtrLen: 14,
    slAtrMult: 0.5,
    tpAtrMult: 7.6,
    useTrailingStop: true,
    trailAtrLen: 14,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    useTimeStop: false,
    timeStopBars: 8,
    usePartialDerisk: false,
    partialDeriskAtR: 1,
  },
};

test('parameterSurfaceCatalog contains strategic patchable Pine parameters', () => {
  const keys = parameterSurfaceKeys();

  assert.equal(keys.includes('neighborsCount'), true);
  assert.equal(keys.includes('h'), true);
  assert.equal(keys.includes('minPredSum'), true);
  assert.equal(keys.includes('adxThreshold'), true);
  assert.equal(keys.includes('fusionV4LongAtrWeight'), true);
  assert.equal(keys.includes('supertrendFactor'), true);
  assert.equal(keys.includes('squeezeLength'), true);
  assert.equal(keys.includes('divRsiLen'), true);
  assert.equal(keys.includes('riskAtrLen'), true);
  assert.equal(keys.includes('slAtrMult'), true);
  assert.equal(keys.includes('tpAtrMult'), true);
  assert.equal(keys.includes('trailAtrMult'), true);
  assert.equal(keys.includes('useTimeStop'), true);

  assert.equal(keys.includes('showDash'), false);
  assert.equal(keys.includes('showBarColors'), false);
  assert.equal(keys.includes('text_size'), false);
  assert.equal(keys.includes('delete_boxes'), false);
});

test('all enabled catalog keys have patch support', () => {
  for (const item of parameterSurfaceCatalog()) {
    assert.equal(hasPatchSupport(item.key), true, `missing patch support for ${item.key}`);
  }
});

test('parameter surface code-point comparator differs from locale collation for ambiguous strings', () => {
  const { compareCodePoints } = __parameterSurfaceInternals;

  assert.equal(Math.sign(compareCodePoints('A', 'a')), -1);
  assert.equal(Math.sign('A'.localeCompare('a')), 1);
  assert.equal(Math.sign(compareCodePoints('ä', 'z')), 1);
  assert.equal(Math.sign('ä'.localeCompare('z')), -1);
});

test('parameterSurfaceCatalog uses code-point ordering inside a family', () => {
  const { compareCodePoints } = __parameterSurfaceInternals;
  const fusionKeys = parameterSurfaceCatalog({
    families: ['fusion'],
    includeArchitecture: true,
  }).map((item) => item.key);

  assert.deepEqual(fusionKeys, [...fusionKeys].sort(compareCodePoints));
});

test('strategicParameterFamilies groups broad optimization surface', () => {
  const families = strategicParameterFamilies();

  assert.equal(families.includes('ml-core'), true);
  assert.equal(families.includes('entry'), true);
  assert.equal(families.includes('filters'), true);
  assert.equal(families.includes('fusion'), true);
  assert.equal(families.includes('squeeze'), true);
  assert.equal(families.includes('divergence'), true);
  assert.equal(families.includes('risk'), true);
  assert.equal(families.includes('exit'), true);
  assert.equal(families.includes('exit-state'), true);
});

test('buildParameterLadder returns bounded numeric neighbors around champion value', () => {
  assert.deepEqual(buildParameterLadder({ key: 'slAtrMult', value: 0.5, min: 0.1, max: 20, step: 0.1, levels: 4 }), [0.6, 0.4, 0.7, 0.3]);
  assert.deepEqual(buildParameterLadder({ key: 'adxThreshold', value: 20, min: 0, max: 100, step: 2, levels: 4 }), [22, 18, 24, 16]);
});

test('buildSurfaceMutationCandidates emits broad non-display candidate set', () => {
  const candidates = buildSurfaceMutationCandidates({
    champion,
    maxConfigs: 80,
    levels: 4,
  });

  const keys = new Set(candidates.flatMap((candidate) => Object.keys(candidate.patch)));
  assert.equal(candidates.length >= 50, true);
  assert.equal(keys.has('minPredSum'), true);
  assert.equal(keys.has('neighborsCount'), true);
  assert.equal(keys.has('h'), true);
  assert.equal(keys.has('adxThreshold'), true);
  assert.equal(keys.has('fusionV4LongAtrWeight'), true);
  assert.equal(keys.has('supertrendFactor'), true);
  assert.equal(keys.has('squeezeLength'), true);
  assert.equal(keys.has('divRsiLen'), true);
  assert.equal(keys.has('riskAtrLen'), true);
  assert.equal(keys.has('slAtrMult'), true);
  assert.equal(keys.has('tpAtrMult'), true);
  assert.equal(keys.has('trailAtrMult'), true);
  assert.equal(keys.has('showDash'), false);
});

test('buildSurfaceMutationCandidates interleaves families so small cycles are broad', () => {
  const candidates = buildSurfaceMutationCandidates({
    champion,
    maxConfigs: 8,
    levels: 4,
  });

  const families = new Set(candidates.map((candidate) => candidate.family));
  assert.equal(candidates.length, 8);
  assert.equal(families.size >= 5, true);
  assert.equal(families.has('risk'), true);
  assert.equal(families.has('exit'), true);
});

test('buildSurfaceMutationCandidates keeps deterministic fallback ordering for unknown families', () => {
  const candidates = buildSurfaceMutationCandidates({
    champion,
    maxConfigs: 6,
    levels: 1,
    families: ['avwap-context', 'channel-context', 'context-aggregator'],
  });

  assert.deepEqual(
    candidates.map((candidate) => candidate.family).slice(0, 3),
    ['avwap-context', 'channel-context', 'context-aggregator'],
  );
});

test('surface mutation candidates carry patch metadata and merged config', () => {
  const [candidate] = buildSurfaceMutationCandidates({ champion, maxConfigs: 1, levels: 1 });

  assert.equal(candidate.family, candidate.mutationFamily);
  assert.deepEqual(candidate.touchedKeys, [candidate.axis]);
  assert.deepEqual(Object.keys(candidate.patch), [candidate.axis]);
  assert.equal(candidate.config[candidate.axis], candidate.patch[candidate.axis]);
  assert.equal(candidate.metadata.parameterKey, candidate.axis);
  assert.equal(candidate.metadata.parameterFamily, candidate.family);
  assert.equal(typeof candidate.metadata.parameterType, 'string');
});
