import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLanePatchFingerprint,
  canonicalGeneratedLane,
  collectTestedLanePatchFingerprints,
  filterNovelLaneCandidates,
} from '../scripts/lib/pine-lane-novelty.mjs';
import { buildChampionConfigFingerprint } from '../scripts/lib/pine-global-search.mjs';

const championConfig = { minPredSum: 1.8, slAtrMult: 0.5, tpAtrMult: 7.6 };
const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);

function candidate(lane, family, patch) {
  return {
    lane,
    family,
    mutationFamily: family,
    patch,
    config: { ...championConfig, ...patch },
    metadata: { championConfigFingerprint },
  };
}

test('buildLanePatchFingerprint binds champion config lane family and patch', () => {
  const first = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const reordered = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });

  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, buildLanePatchFingerprint({ championConfigFingerprint, lane: 'globalAllParameter', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } }));
  assert.notEqual(first, buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'risk', patch: { slAtrMult: 0.4 } }));
  assert.notEqual(first, buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.3 } }));
});

test('buildLanePatchFingerprint canonicalizes generated lane aliases', () => {
  assert.equal(canonicalGeneratedLane('exitRegime'), 'exitRegime');
  assert.equal(canonicalGeneratedLane('exit-regime'), 'exitRegime');
  assert.equal(canonicalGeneratedLane('globalAllParameter'), 'globalAllParameter');
  assert.equal(canonicalGeneratedLane('global-all-parameter'), 'globalAllParameter');
  assert.equal(canonicalGeneratedLane(undefined), null);

  assert.equal(
    buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } }),
    buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exit-regime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } }),
  );
  assert.equal(
    buildLanePatchFingerprint({ championConfigFingerprint, lane: 'globalAllParameter', mutationFamily: 'global', patch: { minPredSum: 1.9 } }),
    buildLanePatchFingerprint({ championConfigFingerprint, lane: 'global-all-parameter', mutationFamily: 'global', patch: { minPredSum: 1.9 } }),
  );
});

test('collectTestedLanePatchFingerprints reads matching lane fingerprints from manifests and history', () => {
  const patchFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 } });
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{ lane: 'exitRegime', mutationFamily: 'exit', patch: { slAtrMult: 0.4 }, patchFingerprint, metadata: { championConfigFingerprint, patchFingerprint } }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
    historyEvents: [{ type: 'cycle', manifest }],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('collectTestedLanePatchFingerprints computes manifest champion fingerprint from config before stale metadata', () => {
  const staleChampionConfigFingerprint = buildChampionConfigFingerprint({ minPredSum: 9.9, slAtrMult: 9.9, tpAtrMult: 9.9 });
  const patch = { slAtrMult: 0.4 };
  const patchFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch });
  const manifest = {
    champion: { config: championConfig },
    metadata: { championConfigFingerprint: staleChampionConfigFingerprint },
    searchPlan: {
      variants: [{ lane: 'exitRegime', mutationFamily: 'exit', patch, patchFingerprint }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('collectTestedLanePatchFingerprints ignores stale variant champion metadata when manifest has config', () => {
  const staleChampionConfigFingerprint = buildChampionConfigFingerprint({ minPredSum: 9.9, slAtrMult: 9.9, tpAtrMult: 9.9 });
  const patch = { slAtrMult: 0.4 };
  const patchFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch });
  const manifest = {
    champion: { config: championConfig },
    metadata: { championConfigFingerprint: staleChampionConfigFingerprint },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        patch,
        patchFingerprint,
        metadata: { championConfigFingerprint: staleChampionConfigFingerprint, patchFingerprint },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('collectTestedLanePatchFingerprints recomputes stale stored patch fingerprint when patch exists', () => {
  const staleChampionConfigFingerprint = buildChampionConfigFingerprint({ minPredSum: 9.9, slAtrMult: 9.9, tpAtrMult: 9.9 });
  const patch = { slAtrMult: 0.4 };
  const stalePatchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint: staleChampionConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'exit',
    patch,
  });
  const authoritativePatchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'exit',
    patch,
  });
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        patch,
        patchFingerprint: stalePatchFingerprint,
        metadata: { championConfigFingerprint: staleChampionConfigFingerprint, patchFingerprint: stalePatchFingerprint },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], [authoritativePatchFingerprint]);
  assert.notDeepEqual([...fingerprints], [stalePatchFingerprint]);
});

test('collectTestedLanePatchFingerprints rejects stored-only fingerprints without patch or config evidence', () => {
  const storedOnlyFingerprint = 'a'.repeat(64);
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        patchFingerprint: storedOnlyFingerprint,
        metadata: { championConfigFingerprint, patchFingerprint: storedOnlyFingerprint },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], []);
});

test('collectTestedLanePatchFingerprints reconstructs patch fingerprints from full config evidence', () => {
  const patch = { slAtrMult: 0.4 };
  const patchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'exit',
    patch,
  });
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        config: { ...championConfig, ...patch },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('collectTestedLanePatchFingerprints rejects partial config-only evidence', () => {
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        config: { slAtrMult: 0.4 },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], []);
});

test('collectTestedLanePatchFingerprints rejects malformed stored fingerprint when reconstruction disagrees', () => {
  const patch = { slAtrMult: 0.4 };
  const wrongStoredFingerprint = 'b'.repeat(64);
  const authoritativePatchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'exit',
    patch,
  });
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        patch,
        patchFingerprint: wrongStoredFingerprint,
        metadata: { championConfigFingerprint, patchFingerprint: wrongStoredFingerprint },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], [authoritativePatchFingerprint]);
});

test('collectTestedLanePatchFingerprints rejects variant patch and config disagreement', () => {
  const patch = { slAtrMult: 0.4 };
  const patchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'exit',
    patch,
  });
  const manifest = {
    champion: { config: championConfig },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        patch,
        config: { ...championConfig, slAtrMult: 0.9 },
        patchFingerprint,
        metadata: { championConfigFingerprint, patchFingerprint },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], []);
});

test('collectTestedLanePatchFingerprints does not let stale manifest metadata override current variant metadata', () => {
  const staleChampionConfigFingerprint = buildChampionConfigFingerprint({ minPredSum: 9.9, slAtrMult: 9.9, tpAtrMult: 9.9 });
  const patch = { slAtrMult: 0.4 };
  const patchFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch });
  const manifest = {
    metadata: { championConfigFingerprint: staleChampionConfigFingerprint },
    searchPlan: {
      variants: [{
        lane: 'exitRegime',
        mutationFamily: 'exit',
        patch,
        metadata: { championConfigFingerprint, patchFingerprint },
      }],
    },
  };

  const fingerprints = collectTestedLanePatchFingerprints({
    champion: { config: championConfig },
    lane: 'exitRegime',
    manifests: [manifest],
  });

  assert.deepEqual([...fingerprints], [patchFingerprint]);
});

test('filterNovelLaneCandidates annotates and removes known lane fingerprints', () => {
  const oldCandidate = candidate('exitRegime', 'exit', { slAtrMult: 0.4 });
  const newCandidate = candidate('exitRegime', 'exit', { tpAtrMult: 8.1 });
  const oldFingerprint = buildLanePatchFingerprint({ championConfigFingerprint, lane: 'exitRegime', mutationFamily: 'exit', patch: oldCandidate.patch });

  const novel = filterNovelLaneCandidates({
    candidates: [oldCandidate, newCandidate],
    champion: { config: championConfig },
    lane: 'exitRegime',
    testedPatchFingerprints: new Set([oldFingerprint]),
  });

  assert.equal(novel.length, 1);
  assert.deepEqual(novel[0].patch, { tpAtrMult: 8.1 });
  assert.equal(novel[0].patchFingerprint.length, 64);
  assert.equal(novel[0].metadata.patchFingerprint, novel[0].patchFingerprint);
  assert.equal(novel[0].metadata.patchFingerprintVersion, 3);
});

test('filterNovelLaneCandidates computes champion fingerprint from config before stale inherited metadata', () => {
  const staleChampionConfigFingerprint = buildChampionConfigFingerprint({ minPredSum: 9.9, slAtrMult: 9.9, tpAtrMult: 9.9 });
  const novel = filterNovelLaneCandidates({
    candidates: [candidate('exitRegime', 'exit', { slAtrMult: 0.4 })],
    champion: {
      config: championConfig,
      metadata: { championConfigFingerprint: staleChampionConfigFingerprint },
    },
    lane: 'exitRegime',
  });

  const expectedPatchFingerprint = buildLanePatchFingerprint({
    championConfigFingerprint,
    lane: 'exitRegime',
    mutationFamily: 'exit',
    patch: { slAtrMult: 0.4 },
  });

  assert.equal(novel[0].metadata.championConfigFingerprint, championConfigFingerprint);
  assert.notEqual(novel[0].metadata.championConfigFingerprint, staleChampionConfigFingerprint);
  assert.equal(novel[0].patchFingerprint, expectedPatchFingerprint);
});
