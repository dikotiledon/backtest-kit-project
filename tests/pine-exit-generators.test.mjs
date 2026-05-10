import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCKED_EXIT_FAMILIES,
  PARTIAL_TAKE_PROFIT_STATUS,
  SUPPORTED_EXIT_PATCH_KEYS,
  buildExitFamilyCandidates,
  validateExitPatch,
} from '../scripts/lib/pine-exit-generators.mjs';

const SUPPORTED_SET = new Set(SUPPORTED_EXIT_PATCH_KEYS);

test('generated candidates emit only supported patch keys and valid patches', () => {
  const candidates = buildExitFamilyCandidates({
    incumbent: { id: 'cfg-1', config: { slAtrMult: 0.5, tpAtrMult: 7.6, useTrailingStop: false } },
    regimeSliceId: 'high-vol',
    maxConfigs: 4,
  });

  assert.ok(candidates.length > 0);
  assert.equal(candidates.length <= 4, true);
  assert.equal(candidates.every((item) => item.lane === 'exitRegime'), true);
  assert.equal(candidates.every((item) => ['risk', 'exit', 'exit-state'].includes(item.family)), true);

  for (const item of candidates) {
    for (const key of Object.keys(item.patch)) {
      assert.equal(SUPPORTED_SET.has(key), true, `unsupported patch key emitted: ${key}`);
    }
    assert.equal(validateExitPatch(item.patch).ok, true);
    assert.equal(item.metadata.originConfigId, 'cfg-1');
  }
});

test('blocked metadata present and partial TP never patched', () => {
  const candidates = buildExitFamilyCandidates({ regimeSliceId: 'rv', maxConfigs: 5 });
  assert.ok(candidates.length > 0);

  for (const item of candidates) {
    assert.equal(item.metadata.partialTakeProfit, PARTIAL_TAKE_PROFIT_STATUS);
    assert.deepEqual(item.metadata.blockedFamilies, BLOCKED_EXIT_FAMILIES);
    assert.equal('partialTakeProfit' in item.patch, false);
    assert.equal(Object.keys(item.patch).some((key) => key.startsWith('partialDerisk')), false);
    assert.equal('breakevenTriggerAtr' in item.patch, false);
    assert.equal('maxBarsInTrade' in item.patch, false);
    assert.equal('useBreakevenStop' in item.patch, false);
    assert.equal('longSlAtrMult' in item.patch, false);
    assert.equal('shortSlAtrMult' in item.patch, false);
    assert.equal('longTpAtrMult' in item.patch, false);
    assert.equal('shortTpAtrMult' in item.patch, false);
  }
});

test('maxConfigs normalization: default, zero, negative, NaN, numeric string', () => {
  const defaulted = buildExitFamilyCandidates({ regimeSliceId: 'x' });
  assert.ok(defaulted.length > 0);

  const zeroed = buildExitFamilyCandidates({ regimeSliceId: 'x', maxConfigs: 0 });
  assert.equal(zeroed.length, 0);

  const negative = buildExitFamilyCandidates({ regimeSliceId: 'x', maxConfigs: -10 });
  assert.equal(negative.length, 0);

  const nanValue = buildExitFamilyCandidates({ regimeSliceId: 'x', maxConfigs: Number.NaN });
  assert.ok(nanValue.length > 0);

  const asString = buildExitFamilyCandidates({ regimeSliceId: 'x', maxConfigs: '3' });
  assert.equal(asString.length <= 3, true);
});

test('candidateId deterministic and order deterministic', () => {
  const args = {
    incumbent: { id: 'cfg-2', config: { slAtrMult: 1.3, tpAtrMult: 3.2, useTrailingStop: true, trailAtrMult: 1.1 } },
    regimeSliceId: 'slice-1',
    maxConfigs: 5,
  };

  const runA = buildExitFamilyCandidates(args);
  const runB = buildExitFamilyCandidates(args);

  assert.deepEqual(
    runA.map((x) => x.candidateId),
    runB.map((x) => x.candidateId),
  );
  assert.deepEqual(runA, runB);
});

test('validateExitPatch rejects unsupported keys', () => {
  const bad = validateExitPatch({ useBreakevenStop: true });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'unsupportedExitPatchKey');
  assert.equal(bad.key, 'useBreakevenStop');
  assert.equal(validateExitPatch({ usePartialDerisk: true }).ok, false);
  assert.equal(validateExitPatch({ partialDeriskAtR: 1.25 }).ok, false);
  assert.equal(validateExitPatch({ partialDeriskClosePct: 55 }).ok, false);
});

test('validateExitPatch rejects invalid booleans', () => {
  assert.equal(validateExitPatch({ useTrailingStop: 'true' }).ok, false);
  assert.equal(validateExitPatch({ useTrailingStop: 1 }).ok, false);
  assert.equal(validateExitPatch({ useTrailingStop: null }).ok, false);
  assert.equal(validateExitPatch({ useTimeStop: 'false' }).ok, false);
  assert.equal(validateExitPatch({ useAdverseDivergenceTighten: 0 }).ok, false);
});

test('validateExitPatch rejects non-finite and out-of-range numbers', () => {
  assert.equal(validateExitPatch({ slAtrMult: Number.NaN }).ok, false);
  assert.equal(validateExitPatch({ slAtrMult: Number.POSITIVE_INFINITY }).ok, false);
  assert.equal(validateExitPatch({ slAtrMult: 21 }).ok, false);
  assert.equal(validateExitPatch({ tpAtrMult: 51 }).ok, false);
  assert.equal(validateExitPatch({ trailAtrMult: 0 }).ok, false);
  assert.equal(validateExitPatch({ riskAtrLen: 1.5 }).ok, false);
  assert.equal(validateExitPatch({ timeStopBars: 300.1 }).ok, false);
  assert.equal(validateExitPatch({ trailActivateR: 0 }).ok, true);
});

test('buildExitFamilyCandidates emits progressive exit and exit-state surface beyond two fixed patches', () => {
  const champion = {
    id: 'exit-surface-champ',
    config: {
      useStopsTP: true,
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useSignalExits: false,
      useTrailingStop: true,
      trailAtrLen: 14,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useTimeStop: false,
      timeStopBars: 8,
      usePartialDerisk: false,
      partialDeriskAtR: 1,
      useAdverseDivergenceTighten: false,
      adverseDivergenceBars: 6,
    },
  };

  const candidates = buildExitFamilyCandidates({
    incumbent: champion,
    regimeSliceId: 'all-market',
    maxConfigs: 16,
  });

  const keys = new Set(candidates.flatMap((item) => Object.keys(item.patch)));
  assert.equal(candidates.length > 2, true);
  assert.equal(keys.has('riskAtrLen'), true);
  assert.equal(keys.has('slAtrMult'), true);
  assert.equal(keys.has('tpAtrMult'), true);
  assert.equal(keys.has('trailAtrLen'), true);
  assert.equal(keys.has('trailAtrMult'), true);
  assert.equal(keys.has('trailActivateR'), true);
  assert.equal(keys.has('useTimeStop'), true);
  assert.equal(keys.has('timeStopBars'), true);
  assert.equal([...keys].some((key) => key.startsWith('partialDerisk')), false);
  assert.equal(candidates.every((item) => item.patchFingerprint?.length === 64), true);
});

test('buildExitFamilyCandidates skips tested exit-regime fingerprints and returns next novel candidates', () => {
  const champion = {
    id: 'exit-novelty-champ',
    config: {
      riskAtrLen: 14,
      slAtrMult: 0.5,
      tpAtrMult: 7.6,
      useTrailingStop: true,
      trailAtrLen: 14,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useTimeStop: false,
      timeStopBars: 8,
    },
  };

  const first = buildExitFamilyCandidates({ incumbent: champion, maxConfigs: 4 });
  const second = buildExitFamilyCandidates({
    incumbent: champion,
    maxConfigs: 4,
    testedPatchFingerprints: new Set(first.map((item) => item.patchFingerprint)),
  });

  assert.equal(first.length, 4);
  assert.equal(second.length, 4);
  assert.equal(second.some((item) => first.some((old) => old.patchFingerprint === item.patchFingerprint)), false);
});
