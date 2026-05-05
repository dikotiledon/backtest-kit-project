import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExitFamilyCandidates, validateExitPatch } from '../scripts/lib/pine-exit-generators.mjs';

test('buildExitFamilyCandidates creates bounded ATR and trailing stop candidates', () => {
  const candidates = buildExitFamilyCandidates({
    incumbent: { config: { slAtrMult: 0.5, tpAtrMult: 7.6, useTrailingStop: false } },
    regimeSliceId: 'high-vol',
    maxConfigs: 4,
  });

  assert.equal(candidates.length <= 4, true);
  assert.equal(candidates.every((item) => item.family === 'exit-state'), true);
  assert.equal(candidates.every((item) => validateExitPatch(item.patch).ok), true);
});

test('validateExitPatch rejects impossible stop and target values', () => {
  assert.equal(validateExitPatch({ slAtrMult: -1 }).ok, false);
  assert.equal(validateExitPatch({ tpAtrMult: 0 }).ok, false);
});
