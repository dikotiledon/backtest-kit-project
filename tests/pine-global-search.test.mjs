import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGlobalMutationBatch,
  buildGlobalPatchFingerprint,
  validateGlobalMutationPatch,
} from '../scripts/lib/pine-global-search.mjs';

test('buildGlobalMutationBatch covers all declared supported families when requested', () => {
  const families = ['entry', 'filters', 'risk', 'fusion-weight', 'asymmetry', 'exit-state'];
  const batch = buildGlobalMutationBatch({
    incumbent: { config: {} },
    maxConfigs: 20,
    families,
  });

  assert.equal(batch.length, families.length);
  assert.deepEqual(batch.map((item) => item.mutationFamily), families);
});

test('buildGlobalMutationBatch skips unsupported family', () => {
  const batch = buildGlobalMutationBatch({
    incumbent: { config: {} },
    maxConfigs: 20,
    families: ['entry', 'unsupported-family', 'risk'],
  });

  assert.deepEqual(batch.map((item) => item.mutationFamily), ['entry', 'risk']);
});

test('validateGlobalMutationPatch rejects frozen key explicitly', () => {
  const result = validateGlobalMutationPatch({ slAtrMult: 1.2 }, { frozenKeys: ['slAtrMult'] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'patch touches frozen key');
});

test('validateGlobalMutationPatch rejects bad boolean values', () => {
  assert.equal(validateGlobalMutationPatch({ useTrailingStop: 'true' }).ok, false);
  assert.equal(validateGlobalMutationPatch({ useTrailingStop: 1 }).ok, false);
  assert.equal(validateGlobalMutationPatch({ useTrailingStop: null }).ok, false);
});

test('validateGlobalMutationPatch rejects non-finite numeric values', () => {
  assert.equal(validateGlobalMutationPatch({ minPredSum: Number.NaN }).ok, false);
  assert.equal(validateGlobalMutationPatch({ minPredSum: Number.POSITIVE_INFINITY }).ok, false);
});

test('maxConfigs edge cases normalized deterministically', () => {
  const baseInput = { incumbent: { config: {} }, families: ['entry', 'filters', 'risk'] };

  assert.equal(buildGlobalMutationBatch({ ...baseInput, maxConfigs: undefined }).length > 0, true);
  assert.equal(buildGlobalMutationBatch({ ...baseInput, maxConfigs: Number.NaN }).length > 0, true);
  assert.equal(buildGlobalMutationBatch({ ...baseInput, maxConfigs: -1 }).length, 0);
  assert.equal(buildGlobalMutationBatch({ ...baseInput, maxConfigs: 0 }).length, 0);
  assert.equal(buildGlobalMutationBatch({ ...baseInput, maxConfigs: 1.9 }).length, 1);
  assert.equal(buildGlobalMutationBatch({ ...baseInput, maxConfigs: '2' }).length, 2);
});

test('buildGlobalMutationBatch deterministic order and stable candidateId across runs', () => {
  const input = {
    incumbent: { configId: 'cfg-1', config: { minPredSum: 1.2, adxThreshold: 18 } },
    families: ['entry', 'filters', 'risk', 'fusion-weight', 'asymmetry', 'exit-state'],
    maxConfigs: 6,
  };

  const first = buildGlobalMutationBatch(input);
  const second = buildGlobalMutationBatch(input);

  assert.deepEqual(first.map((item) => item.mutationFamily), second.map((item) => item.mutationFamily));
  assert.deepEqual(first.map((item) => item.candidateId), second.map((item) => item.candidateId));
  assert.equal(first.every((item) => typeof item.candidateId === 'string' && item.candidateId.length >= 20), true);
});

test('candidate metadata includes originConfigId and generatorVersion', () => {
  const [item] = buildGlobalMutationBatch({
    incumbent: { configId: 'origin-42', config: {} },
    families: ['entry'],
    maxConfigs: 1,
  });

  assert.equal(item.metadata.originConfigId, 'origin-42');
  assert.equal(item.metadata.generatorVersion, 'global-search-v1');
  assert.equal(item.metadata.mutationFamily, 'entry');
});

test('originConfigId falls back to incumbent.config.configId', () => {
  const [item] = buildGlobalMutationBatch({
    incumbent: { config: { configId: 'nested-origin' } },
    families: ['entry'],
    maxConfigs: 1,
  });

  assert.equal(item.metadata.originConfigId, 'nested-origin');
});

test('architecture boolean keys blocked by default but allow explicit override', () => {
  const blocked = validateGlobalMutationPatch({ useFusionV4: true });
  const allowed = validateGlobalMutationPatch({ useFusionV4: true }, { allowArchitectureKeys: true });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'architecture key blocked');
  assert.equal(allowed.ok, true);
});

test('frozen architecture key rejected when explicitly allowed', () => {
  const result = validateGlobalMutationPatch(
    { useFusionV4: true },
    { allowArchitectureKeys: true, frozenKeys: ['useFusionV4'] },
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'patch touches frozen key');
});

test('buildGlobalPatchFingerprint is stable and binds champion lane family and patch', () => {
  const first = buildGlobalPatchFingerprint({
    championId: 'champ-1',
    lane: 'global-all-parameter',
    mutationFamily: 'entry',
    patch: { minPredSum: 2, adxThreshold: 22 },
  });
  const reordered = buildGlobalPatchFingerprint({
    championId: 'champ-1',
    lane: 'global-all-parameter',
    mutationFamily: 'entry',
    patch: { adxThreshold: 22, minPredSum: 2 },
  });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(
    first,
    buildGlobalPatchFingerprint({
      championId: 'champ-2',
      lane: 'global-all-parameter',
      mutationFamily: 'entry',
      patch: { minPredSum: 2, adxThreshold: 22 },
    }),
  );
  assert.notEqual(
    first,
    buildGlobalPatchFingerprint({
      championId: 'champ-1',
      lane: 'local',
      mutationFamily: 'entry',
      patch: { minPredSum: 2, adxThreshold: 22 },
    }),
  );
  assert.notEqual(
    first,
    buildGlobalPatchFingerprint({
      championId: 'champ-1',
      lane: 'global-all-parameter',
      mutationFamily: 'filters',
      patch: { minPredSum: 2, adxThreshold: 22 },
    }),
  );
  assert.notEqual(
    first,
    buildGlobalPatchFingerprint({
      championId: 'champ-1',
      lane: 'global-all-parameter',
      mutationFamily: 'entry',
      patch: { minPredSum: 2.2, adxThreshold: 22 },
    }),
  );
});

test('buildGlobalMutationBatch exposes stable patchFingerprint independent of object key order', () => {
  const [first] = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-1',
      config: {
        minPredSum: 1.8,
        adxThreshold: 20,
        slAtrMult: 0.5,
        trailAtrMult: 1,
        fusionV4LongAtrWeight: -0.25,
        fusionV4LongEmaWeight: 0,
        fusionV4ShortEmaWeight: 0,
      },
    },
    maxConfigs: 1,
    families: ['entry'],
  });

  const [second] = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-1',
      config: {
        trailAtrMult: 1,
        slAtrMult: 0.5,
        adxThreshold: 20,
        minPredSum: 1.8,
        fusionV4ShortEmaWeight: 0,
        fusionV4LongEmaWeight: 0,
        fusionV4LongAtrWeight: -0.25,
      },
    },
    maxConfigs: 1,
    families: ['entry'],
  });

  assert.equal(typeof first.patchFingerprint, 'string');
  assert.equal(first.patchFingerprint.length, 64);
  assert.equal(first.patchFingerprint, second.patchFingerprint);
  assert.equal(first.metadata.patchFingerprint, first.patchFingerprint);
  assert.equal(first.metadata.mutationFamily, 'entry');
});

test('buildGlobalMutationBatch can emit deterministic ladder variants for one family', () => {
  const batch = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-ladder',
      config: {
        minPredSum: 1.8,
        adxThreshold: 20,
        slAtrMult: 0.5,
        trailAtrMult: 1,
        fusionV4LongAtrWeight: -0.25,
        fusionV4LongEmaWeight: 0,
        fusionV4ShortEmaWeight: 0,
      },
    },
    maxConfigs: 3,
    families: ['entry'],
    variantsPerFamily: 3,
  });

  assert.equal(batch.length, 3);
  assert.deepEqual(batch.map((item) => item.patch), [
    { minPredSum: 2 },
    { minPredSum: 1.6 },
    { minPredSum: 2.2 },
  ]);
  assert.deepEqual(batch.map((item) => item.variantId), [
    'global-all-parameter-entry-p01',
    'global-all-parameter-entry-p02',
    'global-all-parameter-entry-p03',
  ]);
  assert.equal(new Set(batch.map((item) => item.patchFingerprint)).size, 3);
});

test('buildGlobalMutationBatch skips previously tested patch fingerprints', () => {
  const champion = {
    configId: 'champ-novelty',
    config: {
      minPredSum: 1.8,
      adxThreshold: 20,
      slAtrMult: 0.5,
      trailAtrMult: 1,
      fusionV4LongAtrWeight: -0.25,
      fusionV4LongEmaWeight: 0,
      fusionV4ShortEmaWeight: 0,
    },
  };

  const first = buildGlobalMutationBatch({
    champion,
    maxConfigs: 1,
    families: ['entry'],
    variantsPerFamily: 3,
  });

  const second = buildGlobalMutationBatch({
    champion,
    maxConfigs: 2,
    families: ['entry'],
    variantsPerFamily: 3,
    testedPatchFingerprints: new Set([first[0].patchFingerprint]),
  });

  assert.equal(second.length, 2);
  assert.deepEqual(second.map((item) => item.variantId), [
    'global-all-parameter-entry-p02',
    'global-all-parameter-entry-p03',
  ]);
  assert.equal(second.some((item) => item.patchFingerprint === first[0].patchFingerprint), false);
});

test('buildGlobalMutationBatch de-dupes same-batch patches and skips no-op patches', () => {
  const duplicateBatch = buildGlobalMutationBatch({
    champion: {
      configId: 'champ-duplicate-boundary',
      config: { minPredSum: 9.9 },
    },
    maxConfigs: 3,
    families: ['entry'],
    variantsPerFamily: 3,
  });

  assert.deepEqual(duplicateBatch.map((item) => item.variantId), [
    'global-all-parameter-entry-p01',
    'global-all-parameter-entry-p02',
  ]);
  assert.equal(new Set(duplicateBatch.map((item) => item.patchFingerprint)).size, duplicateBatch.length);

  const champion = {
    configId: 'champ-no-op-boundary',
    config: {
      minPredSum: 10,
      adxThreshold: 100,
      slAtrMult: 20,
      trailAtrMult: 20,
      fusionV4LongAtrWeight: 5,
      fusionV4LongEmaWeight: 5,
      fusionV4ShortEmaWeight: -5,
    },
  };
  const noOpSkippedBatch = buildGlobalMutationBatch({
    champion,
    maxConfigs: 20,
    families: ['entry', 'filters', 'risk', 'exit-state', 'asymmetry'],
    variantsPerFamily: 3,
  });

  assert.equal(
    noOpSkippedBatch.every((item) =>
      Object.entries(item.patch).some(([key, value]) => !Object.is(champion.config[key], value)),
    ),
    true,
  );
  assert.equal(new Set(noOpSkippedBatch.map((item) => item.patchFingerprint)).size, noOpSkippedBatch.length);
});
