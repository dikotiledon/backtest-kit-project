import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGlobalMutationBatch, validateGlobalMutationPatch } from '../scripts/lib/pine-global-search.mjs';

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
