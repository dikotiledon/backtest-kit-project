import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGlobalMutationBatch, validateGlobalMutationPatch } from '../scripts/lib/pine-global-search.mjs';

test('buildGlobalMutationBatch touches grouped tunable families and freezes architecture switches', () => {
  const batch = buildGlobalMutationBatch({
    incumbent: { config: { minPredSum: 1.8, slAtrMult: 0.5, tpAtrMult: 7.6, useFusionV4: true } },
    maxConfigs: 6,
    frozenKeys: ['useFusionV4'],
    families: ['entry', 'risk', 'fusion-weight', 'asymmetry', 'exit-state'],
  });

  assert.equal(batch.length <= 6, true);
  assert.equal(batch.every((item) => !Object.hasOwn(item.patch, 'useFusionV4')), true);
  assert.equal(batch.every((item) => validateGlobalMutationPatch(item.patch, { frozenKeys: ['useFusionV4'] }).ok), true);
});
