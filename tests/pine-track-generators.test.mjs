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

function configFingerprint(config) {
  return JSON.stringify(stableValue(config || {}));
}

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

test('track batch skips tabu rejected candidate fingerprints instead of replaying ping-pong losers', () => {
  const track = { trackId: 'squeeze-context', sourceFamily: 'squeeze' };
  const baseline = buildTrackCandidateBatch({ track, incumbent, maxConfigs: 5, historyEvents: [], budgetPolicy: {} });
  const rejectedFingerprint = configFingerprint(baseline[0].config);

  const filtered = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs: 5,
    historyEvents: [],
    budgetPolicy: {},
    schedulerState: { tabuRejectedFingerprints: [rejectedFingerprint] },
  });

  assert.equal(filtered.length, 4);
  assert.equal(filtered.some((item) => configFingerprint(item.config) === rejectedFingerprint), false);
  assert.equal(filtered[0].tabuSkipped, 1);
});

test('track batch returns no variants when every track candidate is tabu', () => {
  const track = { trackId: 'divergence-context', sourceFamily: 'divergence' };
  const baseline = buildTrackCandidateBatch({ track, incumbent, maxConfigs: 5, historyEvents: [], budgetPolicy: {} });
  const rejectedFingerprints = baseline.map((item) => configFingerprint(item.config));

  const filtered = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs: 5,
    historyEvents: [],
    budgetPolicy: {},
    schedulerState: { tabuRejectedFingerprints: rejectedFingerprints },
  });

  assert.deepEqual(filtered, []);
});

test('track batch includes fallback candidates when nested config activates self-loop escape', () => {
  const track = { trackId: 'divergence-context', sourceFamily: 'divergence' };
  const maxConfigs = 8;

  const batch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        includeFallback: true,
        activateAfter: 1,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 3,
        temperatureBoost: 1.5,
      },
    },
    schedulerState: { noNewCandidateStreak: 2 },
  });

  const fallback = batch.filter((item) => item.lane === 'self-loop-fallback');
  const fingerprints = batch.map((item) => configFingerprint(item.config));

  assert.ok(batch.length <= maxConfigs);
  assert.ok(fallback.length > 0);
  assert.ok(fallback.length >= 3);
  assert.ok(batch.every((item) => item.temperature >= 1));
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test('self-loop fallback signal pool emits valid incumbent-local patches without validation skips', () => {
  const track = { trackId: 'divergence-context', sourceFamily: 'divergence' };
  const maxConfigs = 16;

  const batch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        includeFallback: true,
        activateAfter: 1,
        fallbackFamilies: ['signal'],
        minFallbackConfigs: 6,
        temperatureBoost: 1.5,
      },
    },
    schedulerState: { noNewCandidateStreak: 2 },
  });

  const fallback = batch.filter((item) => item.lane === 'self-loop-fallback');

  assert.ok(fallback.length > 0);
  assert.equal(fallback.length, 6);
  assert.ok(fallback.every((item) => item.tabuSkipped === 0));
  assert.ok(fallback.every((item) => !Object.hasOwn(item.patch, 'adxThreshold')));
});

test('self-loop fallback excludes tabu fingerprints and does not duplicate track candidates', () => {
  const track = { trackId: 'squeeze-context', sourceFamily: 'squeeze' };
  const maxConfigs = 8;
  const budgetPolicy = {
    selfLoopEscape: {
      enabled: true,
      includeFallback: true,
      activateAfter: 1,
      fallbackFamilies: ['signal', 'risk'],
      minFallbackConfigs: 3,
      temperatureBoost: 1.5,
    },
  };
  const schedulerState = { noNewCandidateStreak: 2 };

  const firstBatch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy,
    schedulerState,
  });
  const rejectedFingerprint = configFingerprint(firstBatch[0].config);

  const secondBatch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy,
    schedulerState: { ...schedulerState, tabuRejectedFingerprints: [rejectedFingerprint] },
  });
  const fingerprints = secondBatch.map((item) => configFingerprint(item.config));

  assert.ok(secondBatch.length <= maxConfigs);
  assert.equal(fingerprints.includes(rejectedFingerprint), false);
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test('self-loop fallback backfills track candidates when every fallback candidate is tabu', () => {
  const track = { trackId: 'squeeze-context', sourceFamily: 'squeeze' };
  const maxConfigs = 32;
  const budgetPolicy = {
    selfLoopEscape: {
      enabled: true,
      includeFallback: true,
      activateAfter: 1,
      fallbackFamilies: ['signal', 'risk'],
      minFallbackConfigs: 3,
      temperatureBoost: 1.5,
    },
  };
  const schedulerState = { noNewCandidateStreak: 2 };

  const baseline = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy,
    schedulerState,
  });
  const fallbackFingerprints = baseline
    .filter((item) => item.lane === 'self-loop-fallback')
    .map((item) => configFingerprint(item.config));
  const normalTrackBatch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy: {},
  });

  const batch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy,
    schedulerState: { ...schedulerState, tabuRejectedFingerprints: fallbackFingerprints },
  });

  assert.ok(fallbackFingerprints.length > 0);
  assert.ok(batch.length > 0);
  assert.ok(batch.length <= maxConfigs);
  assert.ok(batch.every((item) => item.lane !== 'self-loop-fallback'));
  assert.equal(batch.length, Math.min(maxConfigs, normalTrackBatch.length));
});

test('self-loop fallback temperature never shrinks below normal mutation scale', () => {
  const track = { trackId: 'divergence-context', sourceFamily: 'divergence' };
  const maxConfigs = 8;

  const batch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs,
    historyEvents: [],
    budgetPolicy: {
      annealing: {
        enabled: true,
        baseTemperature: 0.4,
        growthFactor: 1,
        maxTemperature: 1,
      },
      selfLoopEscape: {
        enabled: true,
        includeFallback: true,
        activateAfter: 1,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 3,
        temperatureBoost: 1.5,
      },
    },
    schedulerState: { noNewCandidateStreak: 2, noChangeStreak: 0 },
  });

  const fallback = batch.find((item) => item.lane === 'self-loop-fallback');

  assert.ok(batch.length <= maxConfigs);
  assert.ok(fallback);
  assert.equal(fallback.temperature, 1.5);
});

test('buildTrackCandidateBatch preserves legacy fallback ordering when stagnation is not active', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'squeeze-context', sourceFamily: 'squeeze' },
    incumbent,
    maxConfigs: 8,
    historyEvents: [],
    schedulerState: { noNewCandidateStreak: 2, stagnationLevel: 0, tabuRejectedFingerprints: [] },
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 8,
        temperatureBoost: 1.5,
      },
    },
  });

  const fallbackFamilies = batch
    .filter((item) => item.lane === 'self-loop-fallback')
    .map((item) => item.family);

  assert.deepEqual(fallbackFamilies.slice(0, 8), [
    'signal',
    'signal',
    'signal',
    'signal',
    'signal',
    'signal',
    'risk',
    'risk',
  ]);
});

test('buildTrackCandidateBatch increases fallback diversity at stagnation level two', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'squeeze-context', sourceFamily: 'squeeze' },
    incumbent: {
      minPredSum: 1.8,
      tpAtrMult: 6.85,
      slAtrMult: 0.5,
      useSqueezeContext: true,
      useDivergenceContext: true,
    },
    maxConfigs: 6,
    historyEvents: [],
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: 2, tabuRejectedFingerprints: [] },
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        stagnationFallbackFamilies: ['signal', 'risk', 'exit-state', 'asymmetry'],
        minFallbackConfigs: 4,
        temperatureBoost: 1.5,
      },
    },
  });

  const fallbackFamilies = new Set(batch.filter((item) => item.lane === 'self-loop-fallback').map((item) => item.family));
  assert.equal(batch.length, 6);
  assert.equal(fallbackFamilies.has('exit-state') || fallbackFamilies.has('asymmetry'), true);
});

test('buildTrackCandidateBatch applies stronger fallback temperature when stagnation boost is active', () => {
  const baseInput = {
    track: { trackId: 'divergence-context', sourceFamily: 'divergence' },
    incumbent: { minPredSum: 1.8, tpAtrMult: 6.85, slAtrMult: 0.5, useDivergenceContext: true },
    maxConfigs: 4,
    historyEvents: [],
    budgetPolicy: {
      annealing: { enabled: true, baseTemperature: 0.5, growthFactor: 1.5, maxTemperature: 3 },
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 2,
        temperatureBoost: 1.5,
        stagnationTemperatureBoost: 2,
      },
    },
  };

  const baselineBatch = buildTrackCandidateBatch({
    ...baseInput,
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: 0, tabuRejectedFingerprints: [] },
  });
  const stagnatedBatch = buildTrackCandidateBatch({
    ...baseInput,
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: 1, tabuRejectedFingerprints: [] },
  });

  const fallbackKey = (item) => `${item.family}:${item.variantId}`;
  const baselineByFingerprint = new Map(
    baselineBatch
      .filter((item) => item.lane === 'self-loop-fallback')
      .map((item) => [fallbackKey(item), item.temperature]),
  );
  const stagnatedByFingerprint = new Map(
    stagnatedBatch
      .filter((item) => item.lane === 'self-loop-fallback')
      .map((item) => [fallbackKey(item), item.temperature]),
  );

  const sharedFingerprints = [...baselineByFingerprint.keys()].filter((key) => stagnatedByFingerprint.has(key));
  assert.ok(sharedFingerprints.length > 0);
  assert.equal(
    sharedFingerprints.some((key) => stagnatedByFingerprint.get(key) > baselineByFingerprint.get(key)),
    true,
  );
});

test('buildTrackCandidateBatch treats malformed stagnation levels as zero', () => {
  const baseInput = {
    track: { trackId: 'divergence-context', sourceFamily: 'divergence' },
    incumbent: { minPredSum: 1.8, tpAtrMult: 6.85, slAtrMult: 0.5, useDivergenceContext: true },
    maxConfigs: 6,
    historyEvents: [],
    budgetPolicy: {
      annealing: { enabled: true, baseTemperature: 1.4, growthFactor: 1, maxTemperature: 4 },
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        stagnationFallbackFamilies: ['signal', 'risk', 'exit-state', 'asymmetry'],
        minFallbackConfigs: 3,
        temperatureBoost: 1.5,
        stagnationTemperatureBoost: 2,
      },
    },
  };

  const baseline = buildTrackCandidateBatch({
    ...baseInput,
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: 0, tabuRejectedFingerprints: [] },
  });
  const infinity = buildTrackCandidateBatch({
    ...baseInput,
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: Number.POSITIVE_INFINITY, tabuRejectedFingerprints: [] },
  });
  const negative = buildTrackCandidateBatch({
    ...baseInput,
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: -1, tabuRejectedFingerprints: [] },
  });
  const nan = buildTrackCandidateBatch({
    ...baseInput,
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: Number.NaN, tabuRejectedFingerprints: [] },
  });

  const summarizeFallback = (items) => items
    .filter((item) => item.lane === 'self-loop-fallback')
    .map((item) => ({ family: item.family, temperature: item.temperature }));

  assert.deepEqual(summarizeFallback(infinity), summarizeFallback(baseline));
  assert.deepEqual(summarizeFallback(negative), summarizeFallback(baseline));
  assert.deepEqual(summarizeFallback(nan), summarizeFallback(baseline));
});

test('buildTrackCandidateBatch caps fallback temperature at annealing maxTemperature', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'divergence-context', sourceFamily: 'divergence' },
    incumbent: { minPredSum: 1.8, tpAtrMult: 6.85, slAtrMult: 0.5, useDivergenceContext: true },
    maxConfigs: 6,
    historyEvents: [],
    schedulerState: { noNewCandidateStreak: 6, stagnationLevel: 4, tabuRejectedFingerprints: [] },
    budgetPolicy: {
      annealing: { enabled: true, baseTemperature: 1.8, growthFactor: 2.5, maxTemperature: 2 },
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 3,
        temperatureBoost: 3,
        stagnationTemperatureBoost: 3,
      },
    },
  });

  const fallbackTemps = batch.filter((item) => item.lane === 'self-loop-fallback').map((item) => item.temperature);
  assert.ok(fallbackTemps.length > 0);
  assert.equal(fallbackTemps.every((value) => value <= 2), true);
  assert.equal(fallbackTemps.some((value) => value === 2), true);
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
