import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTrackCandidateBatch,
  sharedKnobKeys,
  trackOwnKnobKeys,
  validateTrackPatch,
} from '../scripts/lib/pine-track-generators.mjs';
import {
  defaultSchedulerState,
  normalizeResearchTracks,
  selectActiveTrack,
} from '../scripts/lib/pine-autoresearch-tracks.mjs';
import { resolveTrackSelectionState } from '../scripts/pine-autoresearch.mjs';

const incumbent = {
  useTrendXConf: true,
  minPredSum: 2,
  minBarsBetween: 2,
  slAtrMult: 1,
  tpAtrMult: 2.5,
  trailAtrMult: 1,
  trailActivateR: 0.5,
  useSqueezeContext: false,
  squeezeLength: 20,
  squeezeBbMult: 2,
  squeezeKcMult: 1.5,
  squeezeReleaseFreshBars: 4,
  squeezeBoostValue: 0.25,
  useDivergenceContext: false,
  divRsiLen: 14,
  divPivotLeft: 5,
  divPivotRight: 5,
  divFreshBars: 6,
  divLongBoostValue: 0.25,
  divShortBoostValue: 0.25,
  divCautionPenaltyValue: 0,
  useTimeStop: false,
  timeStopBars: 10,
  useRegimeFilter: false,
  useAdxFilter: false,
  regimeThreshold: -0.1,
  adxThreshold: 20,
};

function changedKeys(candidateConfig) {
  return Object.keys(candidateConfig).filter((key) => JSON.stringify(candidateConfig[key]) !== JSON.stringify(incumbent[key]));
}

function assertTrackBatch(track, family) {
  const batch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs: 3,
    historyEvents: [],
    budgetPolicy: {},
  });

  assert.equal(batch.length, 3);

  const shared = new Set(sharedKnobKeys());
  const own = new Set(trackOwnKnobKeys(family));

  for (const item of batch) {
    const patchKeys = Object.keys(item.patch).sort();
    const changed = changedKeys(item.config).sort();

    assert.equal(item.lane, 'track');
    assert.equal(item.family, family);
    assert.equal(item.variantId.startsWith(`${family}-`), true);
    assert.match(item.variantId.slice(family.length + 1), /^\d{2}$/);
    assert.equal(Object.getPrototypeOf(item.patch), Object.prototype);
    assert.equal(Array.isArray(item.sharedKeys), true);
    assert.equal(Array.isArray(item.ownKeys), true);
    assert.deepEqual(patchKeys, changed);
    assert.deepEqual([...new Set([...item.sharedKeys, ...item.ownKeys])].sort(), patchKeys);
    assert.deepEqual([...item.sharedKeys].sort(), patchKeys.filter((key) => shared.has(key)).sort());
    assert.deepEqual([...item.ownKeys].sort(), patchKeys.filter((key) => own.has(key)).sort());
    assert.deepEqual(item.config, { ...incumbent, ...item.patch });
    assert.ok(item.sharedKeys.every((key) => shared.has(key)));
    assert.ok(item.ownKeys.every((key) => own.has(key)));
    assert.ok(item.sharedKeys.every((key) => key in item.patch));
    assert.ok(item.ownKeys.every((key) => key in item.patch));
  }

  return batch;
}

test('shared and track-owned knob lists are exposed', () => {
  const shared = sharedKnobKeys();
  const squeezeOwn = trackOwnKnobKeys('squeeze-context');
  const divergenceOwn = trackOwnKnobKeys('divergence-context');
  const exitOwn = trackOwnKnobKeys('exit-state-context');

  assert.ok(shared.includes('minPredSum'));
  assert.ok(shared.includes('minBarsBetween'));
  assert.ok(squeezeOwn.includes('squeezeLength'));
  assert.ok(divergenceOwn.includes('divRsiLen'));
  assert.deepEqual(exitOwn, [
    'useFailedFollowThroughTighten',
    'followThroughBars',
    'followThroughMinProgressAtr',
    'followThroughTightenTrailAtrMult',
    'useTimeStop',
    'timeStopBars',
    'timeStopMinUnrealizedAtr',
    'useContextCautionTighten',
    'contextCautionDelta',
    'contextCautionTrailAtrMult',
    'usePartialDerisk',
    'partialDeriskAtR',
    'partialDeriskClosePct',
    'usePostEntrySqueezeCollapseTighten',
    'postEntrySqueezeCollapseBars',
    'postEntrySqueezeCollapseTrailAtrMult',
    'useAdverseDivergenceTighten',
    'adverseDivergenceBars',
    'adverseDivergenceTrailAtrMult',
  ]);
});

test('squeeze track emits plain patch metadata with shared and own keys', () => {
  assertTrackBatch({ trackId: 'squeeze-context', sourceFamily: 'squeeze' }, 'squeeze');
});

test('divergence track emits plain patch metadata with shared and own keys', () => {
  assertTrackBatch({ trackId: 'divergence-context', sourceFamily: 'divergence' }, 'divergence');
});

test('exit-state track emits plain patch metadata with shared and own keys', () => {
  const batch = assertTrackBatch({ trackId: 'exit-state-context', sourceFamily: 'exit-state' }, 'exit-state');
  const candidate = batch[2];

  assert.equal(candidate.variantId, 'exit-state-03');
  assert.deepEqual(candidate.patch, { useTimeStop: true, timeStopBars: 12 });
  assert.deepEqual(candidate.sharedKeys, []);
  assert.deepEqual(candidate.ownKeys, ['useTimeStop', 'timeStopBars']);
});

test('asymmetry track emits plain patch metadata with shared and own keys', () => {
  assertTrackBatch({ trackId: 'asymmetry-context', sourceFamily: 'asymmetry' }, 'asymmetry');
});

test('invalid cross-family mutation is rejected before sweep', () => {
  assert.throws(
    () => validateTrackPatch({
      trackId: 'squeeze-context',
      patch: { divRsiLen: 21, squeezeLength: 34 },
    }),
    /divRsiLen|cross-family/i,
  );
});

test('hard rotation advances to the next enabled track instead of re-picking the same one', () => {
  const tracks = normalizeResearchTracks([
    { trackId: 'track-a', name: 'Track A', gridName: 'grid-a', enabled: true },
    { trackId: 'track-b', name: 'Track B', gridName: 'grid-b', enabled: true },
    { trackId: 'track-c', name: 'Track C', gridName: 'grid-c', enabled: true },
  ]);
  const { activeTrackSelectionState } = resolveTrackSelectionState({
    schedulerState: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-c',
      cycleIndex: 3,
      noChangeStreak: 3,
    },
    rotationPolicy: { noChangeStreakRotateAfter: 3 },
    researchTracks: tracks,
  });

  assert.equal(selectActiveTrack({ tracks, state: activeTrackSelectionState }).trackId, 'track-a');
});

test('novelty and max-cycle hard rotation use prior-cycle evidence before selecting the next track', () => {
  const tracks = normalizeResearchTracks([
    { trackId: 'track-a', name: 'Track A', gridName: 'grid-a', enabled: true },
    { trackId: 'track-b', name: 'Track B', gridName: 'grid-b', enabled: true },
    { trackId: 'track-c', name: 'Track C', gridName: 'grid-c', enabled: true },
  ]);

  const novelty = resolveTrackSelectionState({
    schedulerState: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-b',
      cycleIndex: 5,
      sameTrackCycleStreak: 2,
    },
    rotationPolicy: { similarityRotateAbove: 0.85, maxCyclesPerTrack: 8 },
    researchTracks: tracks,
    previousCycle: { topCandidateSimilarity: 0.91, promotionEligible: false },
  });
  assert.equal(novelty.hardRotationTrigger, 'noveltySimilarity');
  assert.equal(selectActiveTrack({ tracks, state: novelty.activeTrackSelectionState }).trackId, 'track-c');

  const maxCycle = resolveTrackSelectionState({
    schedulerState: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-c',
      cycleIndex: 7,
      sameTrackCycleStreak: 9,
    },
    rotationPolicy: { similarityRotateAbove: 0.85, maxCyclesPerTrack: 8 },
    researchTracks: tracks,
    previousCycle: { topCandidateSimilarity: 0.4, promotionEligible: false },
  });
  assert.equal(maxCycle.hardRotationTrigger, 'maxCyclesPerTrack');
  assert.equal(selectActiveTrack({ tracks, state: maxCycle.activeTrackSelectionState }).trackId, 'track-a');
});
