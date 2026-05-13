import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildNoveltySignature,
  computeConfigSimilarity,
  defaultSchedulerState,
  detectRotationTrigger,
  nextStagnationState,
  nextTrackState,
  normalizeResearchTracks,
  pruneTabuFingerprints,
  readSchedulerState,
  resolveSchedulerStatePath,
  selectActiveTrack,
  summarizeTopCandidateSimilarity,
  writeSchedulerState,
} from '../scripts/lib/pine-autoresearch-tracks.mjs';

const baseTracks = [
  { trackId: 'track-a', name: 'Track A', gridName: 'grid-a', enabled: true },
  { trackId: 'track-b', name: 'Track B', gridName: 'grid-b', enabled: false },
  { trackId: 'track-c', name: 'Track C', gridName: 'grid-c' },
];

test('buildNoveltySignature joins the track, grid, candidate, window, and lab identifiers', () => {
  assert.equal(
    buildNoveltySignature({
      trackId: 'track-a',
      gridName: 'grid-a',
      candidateFingerprint: 'cand-1',
      windowSetId: 'window-1',
      labSetId: 'lab-1',
    }),
    'track-a|grid-a|cand-1|window-1|lab-1',
  );
});

test('resolveSchedulerStatePath places state under the scheduler state folder', () => {
  assert.equal(
    resolveSchedulerStatePath({ researchRoot: 'C:/repo/research', matrixId: 'matrix-7' }),
    path.join('C:/repo/research', 'state', 'scheduler', 'matrix-7.json'),
  );
});

test('normalizeResearchTracks keeps enabled tracks explicit and fills defaults', () => {
  assert.deepEqual(normalizeResearchTracks(baseTracks), [
    {
      trackId: 'track-a',
      name: 'Track A',
      gridName: 'grid-a',
      enabled: true,
      variantMode: 'grid',
      sourceFamily: 'track-a',
      windowSet: null,
      promotionPolicy: {},
      stopPolicy: {},
    },
    {
      trackId: 'track-b',
      name: 'Track B',
      gridName: 'grid-b',
      enabled: false,
      variantMode: 'grid',
      sourceFamily: 'track-b',
      windowSet: null,
      promotionPolicy: {},
      stopPolicy: {},
    },
    {
      trackId: 'track-c',
      name: 'Track C',
      gridName: 'grid-c',
      enabled: true,
      variantMode: 'grid',
      sourceFamily: 'track-c',
      windowSet: null,
      promotionPolicy: {},
      stopPolicy: {},
    },
  ]);
});

test('selectActiveTrack preserves an enabled active track and otherwise rotates through enabled tracks', () => {
  const tracks = normalizeResearchTracks(baseTracks);

  assert.equal(
    selectActiveTrack({ tracks, state: { activeTrackId: 'track-a', cycleIndex: 1 } }).trackId,
    'track-a',
  );

  assert.equal(
    selectActiveTrack({ tracks, state: { activeTrackId: 'track-b', cycleIndex: 1 } }).trackId,
    'track-a',
  );

  assert.equal(
    selectActiveTrack({ tracks, state: { activeTrackId: null, cycleIndex: 4 } }).trackId,
    'track-c',
  );
});

test('readSchedulerState and writeSchedulerState round-trip the explicit scheduler state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-tracks-'));
  const filePath = path.join(dir, 'matrix-1.json');
  const state = {
    ...defaultSchedulerState(),
    activeTrackId: 'track-c',
    cycleIndex: 3,
    noChangeStreak: 2,
    lowEmissionStreak: 4,
    sameTrackCycleStreak: 5,
    lastNoveltySignature: 'sig-1',
    lastChampionFingerprint: 'champ-1',
    lastCandidateFingerprint: 'cand-1',
    lastRotationTrigger: 'steady-state',
    lastPromotionEligibleAt: '2026-04-27T00:00:00.000Z',
  };

  try {
    await writeSchedulerState(filePath, state);
    assert.deepEqual(await readSchedulerState(filePath), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('nextStagnationState escalates after repeated no-new-candidate cycles', () => {
  assert.deepEqual(nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 3,
    promotionEligible: false,
    policy: { noNewCandidateEscalateAfter: 3, maxStagnationLevel: 3 },
  }), {
    stagnationLevel: 1,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: null,
  });
});

test('nextStagnationState advances no-new-candidate escalation only on cadence boundaries', () => {
  const policy = {
    noNewCandidateEscalateAfter: 3,
    maxStagnationLevel: 5,
    currentReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T00:00:00.000Z',
  };

  assert.deepEqual(nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 3,
    policy,
    now: '2026-05-03T00:30:00.000Z',
  }), {
    stagnationLevel: 1,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T00:30:00.000Z',
  });

  for (const noNewCandidateStreak of [4, 5]) {
    assert.deepEqual(nextStagnationState({
      previousLevel: 1,
      noNewCandidateStreak,
      policy,
      now: '2026-05-03T01:00:00.000Z',
    }), {
      stagnationLevel: 1,
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T00:00:00.000Z',
    });
  }

  assert.deepEqual(nextStagnationState({
    previousLevel: 1,
    noNewCandidateStreak: 6,
    policy,
    now: '2026-05-03T01:30:00.000Z',
  }), {
    stagnationLevel: 2,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T01:30:00.000Z',
  });
});

test('nextStagnationState escalates high-similarity holds on cadence boundaries', () => {
  const policy = {
    holdEscalateAfter: 5,
    highSimilarityThreshold: 0.9,
    maxStagnationLevel: 3,
    currentReason: 'highSimilarityHold',
    lastEscalatedAt: '2026-05-03T00:00:00.000Z',
  };

  assert.deepEqual(nextStagnationState({
    previousLevel: 0,
    noChangeStreak: 5,
    promotionEligible: false,
    topCandidateSimilarity: 0.9,
    policy,
    now: '2026-05-03T00:30:00.000Z',
  }), {
    stagnationLevel: 1,
    stagnationReason: 'highSimilarityHold',
    lastEscalatedAt: '2026-05-03T00:30:00.000Z',
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 1,
    noChangeStreak: 6,
    promotionEligible: false,
    topCandidateSimilarity: 0.95,
    policy,
    now: '2026-05-03T01:00:00.000Z',
  }), {
    stagnationLevel: 1,
    stagnationReason: 'highSimilarityHold',
    lastEscalatedAt: '2026-05-03T00:00:00.000Z',
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 1,
    noChangeStreak: 10,
    promotionEligible: false,
    topCandidateSimilarity: 0.95,
    policy,
    now: '2026-05-03T01:30:00.000Z',
  }), {
    stagnationLevel: 2,
    stagnationReason: 'highSimilarityHold',
    lastEscalatedAt: '2026-05-03T01:30:00.000Z',
  });
});

test('nextStagnationState resets when promotion becomes eligible', () => {
  assert.deepEqual(nextStagnationState({
    previousLevel: 2,
    noNewCandidateStreak: 0,
    promotionEligible: true,
    policy: { noNewCandidateEscalateAfter: 3, maxStagnationLevel: 3 },
  }), {
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
  });
});

test('nextStagnationState escalates after lowEmissionStreak meets threshold', () => {
  const result = nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 0,
    noChangeStreak: 0,
    topCandidateSimilarity: 0.5,
    promotionEligible: false,
    lowEmissionStreak: 3,
    policy: {
      noNewCandidateEscalateAfter: 2,
      holdEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 2,
      lowEmissionEscalateAfter: 3,
      lowEmissionThreshold: 3,
    },
  });
  assert.equal(result.stagnationLevel, 1);
  assert.equal(result.stagnationReason, 'lowEmissionStreak');
});

test('nextStagnationState does not escalate when lowEmissionStreak is below threshold', () => {
  const result = nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 0,
    noChangeStreak: 0,
    topCandidateSimilarity: 0.5,
    promotionEligible: false,
    lowEmissionStreak: 2,
    policy: {
      noNewCandidateEscalateAfter: 2,
      holdEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 2,
      lowEmissionEscalateAfter: 3,
      lowEmissionThreshold: 3,
    },
  });
  assert.equal(result.stagnationLevel, 0);
  assert.equal(result.stagnationReason, null);
});

test('nextStagnationState resets stagnation when promotion becomes eligible regardless of lowEmissionStreak', () => {
  const result = nextStagnationState({
    previousLevel: 2,
    noNewCandidateStreak: 0,
    noChangeStreak: 0,
    topCandidateSimilarity: 0.5,
    promotionEligible: true,
    lowEmissionStreak: 10,
    policy: {
      noNewCandidateEscalateAfter: 2,
      holdEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 2,
      lowEmissionEscalateAfter: 3,
      lowEmissionThreshold: 3,
    },
  });
  assert.equal(result.stagnationLevel, 0);
  assert.equal(result.stagnationReason, null);
});

test('nextTrackState tracks and persists lowEmissionStreak across low-emission cycles', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      lowEmissionStreak: 2,
    },
    policy: {
      stagnation: {
        lowEmissionEscalateAfter: 3,
        lowEmissionThreshold: 3,
      },
    },
    manifest: {
      searchEfficiency: { emittedVariantCount: 3 },
      promotionEligible: false,
    },
  });

  assert.equal(next.lowEmissionStreak, 3);
  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'lowEmissionStreak');
});

test('nextTrackState resets lowEmissionStreak when emissions recover or promotion is eligible', () => {
  const baseState = {
    ...defaultSchedulerState(),
    lowEmissionStreak: 3,
  };
  const policy = { stagnation: { lowEmissionThreshold: 3 } };

  assert.equal(nextTrackState({
    state: baseState,
    policy,
    manifest: {
      searchEfficiency: { emittedVariantCount: 4 },
      promotionEligible: false,
    },
  }).lowEmissionStreak, 0);

  assert.equal(nextTrackState({
    state: baseState,
    policy,
    manifest: {
      searchEfficiency: { emittedVariantCount: 1 },
      promotionEligible: true,
    },
  }).lowEmissionStreak, 0);
});

test('nextStagnationState caps escalation and preserves metadata below threshold', () => {
  assert.deepEqual(nextStagnationState({
    previousLevel: 3,
    noNewCandidateStreak: 9,
    policy: {
      noNewCandidateEscalateAfter: 3,
      maxStagnationLevel: 3,
      lastEscalatedAt: '2026-05-03T03:00:00.000Z',
    },
    now: '2026-05-03T04:00:00.000Z',
  }), {
    stagnationLevel: 3,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T03:00:00.000Z',
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 2,
    noNewCandidateStreak: 2,
    policy: {
      noNewCandidateEscalateAfter: 3,
      maxStagnationLevel: 3,
      currentReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T03:00:00.000Z',
    },
  }), {
    stagnationLevel: 2,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T03:00:00.000Z',
  });
});

test('nextStagnationState is safe for malformed input and policy', () => {
  assert.deepEqual(nextStagnationState(null), {
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 'bad',
    noNewCandidateStreak: 1,
    policy: null,
  }), {
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
  });
});

test('nextStagnationState treats malformed numeric policy fields as defaults', () => {
  assert.deepEqual(nextStagnationState({
    previousLevel: 2,
    noNewCandidateStreak: 2,
    policy: {
      maxStagnationLevel: null,
      noNewCandidateEscalateAfter: false,
      currentReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T03:00:00.000Z',
    },
    now: '2026-05-03T04:00:00.000Z',
  }), {
    stagnationLevel: 2,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T03:00:00.000Z',
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 2,
    noNewCandidateStreak: 3,
    policy: {
      maxStagnationLevel: '',
      noNewCandidateEscalateAfter: '',
    },
    now: '2026-05-03T04:00:00.000Z',
  }), {
    stagnationLevel: 3,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T04:00:00.000Z',
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 3,
    noNewCandidateStreak: 9,
    policy: {
      maxStagnationLevel: false,
      noNewCandidateEscalateAfter: [],
      lastEscalatedAt: '2026-05-03T03:00:00.000Z',
    },
    now: '2026-05-03T04:00:00.000Z',
  }), {
    stagnationLevel: 3,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T03:00:00.000Z',
  });

  assert.deepEqual(nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 3,
    policy: {
      maxStagnationLevel: {},
      noNewCandidateEscalateAfter: Number.POSITIVE_INFINITY,
    },
    now: '2026-05-03T04:00:00.000Z',
  }), {
    stagnationLevel: 1,
    stagnationReason: 'noNewCandidateStreak',
    lastEscalatedAt: '2026-05-03T04:00:00.000Z',
  });
});

test('nextTrackState increments no-new-candidate streak when candidate equals champion', () => {
  const next = nextTrackState({
    state: defaultSchedulerState(),
    manifest: {
      activeTrackId: 'divergence-context',
      candidateFingerprint: 'champ-1',
      championFingerprint: 'champ-1',
      noNewCandidate: true,
      generatedAt: '2026-04-29T14:30:00.000Z',
      noveltySignature: 'divergence-context|phase3-core|champ-1|primary|labs',
    },
  });

  assert.equal(next.noNewCandidateStreak, 1);
  assert.equal(next.lastNoNewCandidateAt, '2026-04-29T14:30:00.000Z');
});

test('nextTrackState resets no-new-candidate streak when changed candidate appears', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 3,
      lastNoNewCandidateAt: '2026-04-29T14:30:00.000Z',
    },
    manifest: {
      activeTrackId: 'squeeze-context',
      candidateFingerprint: 'cand-2',
      championFingerprint: 'champ-1',
      noNewCandidate: false,
      generatedAt: '2026-04-29T15:00:00.000Z',
      noveltySignature: 'squeeze-context|phase3-core|cand-2|primary|labs',
    },
  });

  assert.equal(next.noNewCandidateStreak, 0);
  assert.equal(next.lastNoNewCandidateAt, '2026-04-29T14:30:00.000Z');
});

test('nextTrackState treats repeated novelty plus unchanged champion as steady state', () => {
  const state = {
    ...defaultSchedulerState(),
    activeTrackId: 'track-a',
    cycleIndex: 2,
    noChangeStreak: 1,
    lastNoveltySignature: 'track-a|grid-a|cand-1|window-1|lab-1',
    lastChampionFingerprint: 'champ-1',
    lastCandidateFingerprint: 'cand-1',
  };

  const repeated = nextTrackState({
    state,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-1',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-a|grid-a|cand-1|window-1|lab-1',
    },
  });

  assert.equal(repeated.noChangeStreak, 2);
  assert.equal(repeated.lastRotationTrigger, 'steady-state');
  assert.equal(repeated.activeTrackId, 'track-a');

  const changedCandidate = nextTrackState({
    state: repeated,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-2',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-a|grid-a|cand-2|window-1|lab-1',
    },
  });

  assert.equal(changedCandidate.noChangeStreak, 0);
  assert.equal(changedCandidate.lastRotationTrigger, 'candidate-changed');
});

test('computeConfigSimilarity penalizes extra object keys and array length differences', () => {
  assert.equal(
    computeConfigSimilarity({
      left: { a: 1, nested: { b: true, c: 'x' } },
      right: { a: 1, nested: { b: false, c: 'x' }, extra: 9 },
    }),
    0.5,
  );

  assert.equal(
    computeConfigSimilarity({
      left: [1],
      right: [1, 2],
    }),
    0.5,
  );
});

test('computeConfigSimilarity weights high-impact config changes above cosmetic low-weight changes', () => {
  const champion = { tpAtrMult: 7.6, divPivotLeft: 3, useFusionV4: true };

  const cosmeticSimilarity = computeConfigSimilarity({
    left: champion,
    right: { ...champion, divPivotLeft: 5 },
  });
  const materialSimilarity = computeConfigSimilarity({
    left: champion,
    right: { ...champion, tpAtrMult: 10.6 },
  });

  assert.ok(cosmeticSimilarity > materialSimilarity);
});

test('summarizeTopCandidateSimilarity reports the closest candidate to the champion', () => {
  const summary = summarizeTopCandidateSimilarity({
    championConfig: { a: 1, nested: { b: true, c: 'x' }, extra: 9 },
    candidates: [
      { configId: 'far', config: { a: 0, nested: { b: false, c: 'y' } } },
      { configId: 'near', config: { a: 1, nested: { b: false, c: 'x' } } },
      { configId: 'mid', config: { a: 1, nested: { b: true, c: 'y' } } },
    ],
  });

  assert.equal(summary.topCandidateConfigId, 'near');
  assert.equal(summary.topCandidateSimilarity, 0.5);
});

test('nextTrackState rotates on current novelty similarity and max-cycle evidence', () => {
  const noveltyRotated = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-a',
      cycleIndex: 8,
      noChangeStreak: 1,
      sameTrackCycleStreak: 2,
      lastRotationTrigger: 'candidate-changed',
    },
    policy: { noChangeStreakRotateAfter: 3, maxCyclesPerTrack: 8, similarityRotateAbove: 0.85 },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-2',
      championFingerprint: 'champ-1',
      topCandidateSimilarity: 0.91,
      promotionEligible: false,
      noveltySignature: 'track-a|grid-a|cand-2|window-1|lab-1',
    },
  });

  assert.equal(noveltyRotated.activeTrackId, null);
  assert.equal(noveltyRotated.lastRotationTrigger, 'noveltySimilarity');

  const maxCycleRotated = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-a',
      cycleIndex: 9,
      noChangeStreak: 0,
      sameTrackCycleStreak: 9,
      lastRotationTrigger: 'steady-state',
    },
    policy: { noChangeStreakRotateAfter: 3, maxCyclesPerTrack: 8, similarityRotateAbove: 0.85 },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-3',
      championFingerprint: 'champ-1',
      topCandidateSimilarity: 0.2,
      promotionEligible: false,
      noveltySignature: 'track-a|grid-a|cand-3|window-1|lab-1',
    },
  });

  assert.equal(maxCycleRotated.activeTrackId, null);
  assert.equal(maxCycleRotated.lastRotationTrigger, 'maxCyclesPerTrack');
});

test('pruneTabuFingerprints drops stale entries, old champions, and trims to newest entries', () => {
  const pruned = pruneTabuFingerprints({
    currentCycle: 51,
    currentChampionFingerprint: 'champ-current',
    policy: { maxAgeCycles: 20, maxEntries: 2, dropOnChampionChange: true },
    entries: [
      { fingerprint: 'a', addedAtCycle: 1, championFingerprint: 'champ-current' },
      { fingerprint: 'b', addedAtCycle: 35, championFingerprint: 'champ-old' },
      { fingerprint: 'c', addedAtCycle: 40, championFingerprint: 'champ-current' },
      { fingerprint: 'd', addedAtCycle: 51, championFingerprint: 'champ-current' },
    ],
  });

  assert.deepEqual(pruned, [
    { fingerprint: 'c', addedAtCycle: 40, championFingerprint: 'champ-current' },
    { fingerprint: 'd', addedAtCycle: 51, championFingerprint: 'champ-current' },
  ]);
});

test('pruneTabuFingerprints ignores malformed legacy entries and keeps newest when capped', () => {
  const pruned = pruneTabuFingerprints({
    currentCycle: 12,
    currentChampionFingerprint: 'champ-current',
    policy: { maxAgeCycles: 20, maxEntries: 2 },
    entries: [
      'legacy-a',
      { fingerprint: '', addedAtCycle: 11, championFingerprint: 'champ-current' },
      { fingerprint: 'obj-b', addedAtCycle: 10, championFingerprint: 'champ-current' },
      { fingerprint: 'obj-c', addedAtCycle: 11, championFingerprint: 'champ-current' },
      { fingerprint: 'obj-d', addedAtCycle: 12, championFingerprint: 'champ-current' },
      null,
    ],
  });

  assert.deepEqual(pruned, [
    { fingerprint: 'obj-c', addedAtCycle: 11, championFingerprint: 'champ-current' },
    { fingerprint: 'obj-d', addedAtCycle: 12, championFingerprint: 'champ-current' },
  ]);
});

test('pruneTabuFingerprints clamps future addedAtCycle values to current cycle', () => {
  const pruned = pruneTabuFingerprints({
    currentCycle: 12,
    currentChampionFingerprint: 'champ-current',
    policy: { maxAgeCycles: 20, maxEntries: 5 },
    entries: [
      { fingerprint: 'future-cand', addedAtCycle: 999, championFingerprint: 'champ-current' },
    ],
  });

  assert.deepEqual(pruned, [
    { fingerprint: 'future-cand', addedAtCycle: 12, championFingerprint: 'champ-current' },
  ]);
});

test('pruneTabuFingerprints can keep current-age old champion entries when configured', () => {
  const pruned = pruneTabuFingerprints({
    currentCycle: 12,
    currentChampionFingerprint: 'champ-current',
    policy: { maxAgeCycles: 20, maxEntries: 5, dropOnChampionChange: false },
    entries: [
      { fingerprint: 'old-champ', addedAtCycle: 10, championFingerprint: 'champ-old' },
      { fingerprint: 'current-champ', addedAtCycle: 11, championFingerprint: 'champ-current' },
    ],
  });

  assert.deepEqual(pruned, [
    { fingerprint: 'old-champ', addedAtCycle: 10, championFingerprint: 'champ-old' },
    { fingerprint: 'current-champ', addedAtCycle: 11, championFingerprint: 'champ-current' },
  ]);
});

test('pruneTabuFingerprints is robust to null input and clamps invalid policy limits', () => {
  assert.deepEqual(pruneTabuFingerprints(null), []);
  assert.deepEqual(pruneTabuFingerprints({
    currentCycle: 5,
    policy: { maxAgeCycles: 0, maxEntries: 0 },
    entries: [
      { fingerprint: 'stale', addedAtCycle: 3, championFingerprint: 'champ' },
      { fingerprint: 'fresh', addedAtCycle: 5, championFingerprint: 'champ' },
    ],
  }), [
    { fingerprint: 'fresh', addedAtCycle: 5, championFingerprint: 'champ' },
  ]);
});

test('pruneTabuFingerprints at stagnationLevel 0 applies only policy.maxAgeCycles', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 45, championFingerprint }, // age 5
    { fingerprint: 'fp-b', addedAtCycle: 38, championFingerprint }, // age 12
    { fingerprint: 'fp-c', addedAtCycle: 32, championFingerprint }, // age 18
    { fingerprint: 'fp-d', addedAtCycle: 25, championFingerprint }, // age 25
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 0,
  });
  // Returned entries remain ordered by addedAtCycle ascending.
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['fp-c', 'fp-b', 'fp-a']);
});

test('pruneTabuFingerprints halves effective maxAgeCycles when stagnationLevel >= 1', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 45, championFingerprint }, // age 5
    { fingerprint: 'fp-b', addedAtCycle: 38, championFingerprint }, // age 12
    { fingerprint: 'fp-c', addedAtCycle: 32, championFingerprint }, // age 18
    { fingerprint: 'fp-d', addedAtCycle: 25, championFingerprint }, // age 25
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 1,
  });
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['fp-a']);
});

test('pruneTabuFingerprints at stagnationLevel 2 clears entries at or older than maxAge/4', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 45, championFingerprint }, // age 5
    { fingerprint: 'fp-b', addedAtCycle: 38, championFingerprint }, // age 12
    { fingerprint: 'fp-c', addedAtCycle: 32, championFingerprint }, // age 18
    { fingerprint: 'fp-d', addedAtCycle: 25, championFingerprint }, // age 25
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 2,
  });
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), []);
});

test('pruneTabuFingerprints floors effective maxAgeCycles at 2 to avoid wiping everything', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 50, championFingerprint }, // age 0
    { fingerprint: 'fp-b', addedAtCycle: 49, championFingerprint }, // age 1
    { fingerprint: 'fp-c', addedAtCycle: 48, championFingerprint }, // age 2
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 4, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 2,
  });
  // effective = Math.max(2, floor(4/4)) = 2. With >=, ages 2+ pruned, keep 0 and 1.
  // Returned entries remain ordered by addedAtCycle ascending.
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['fp-b', 'fp-a']);
});

test('nextTrackState records rejected candidate fingerprints in a bounded tabu list', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      tabuRejectedFingerprints: ['old-cand'],
    },
    policy: { tabuLimit: 2 },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-1',
      rejectedCandidateFingerprint: 'cand-1',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-a|grid-a|cand-1|window-1|lab-1',
    },
  });

  assert.deepEqual(next.tabuRejectedFingerprints, [
    { fingerprint: 'old-cand', addedAtCycle: 0, championFingerprint: 'champ-1' },
    { fingerprint: 'cand-1', addedAtCycle: 1, championFingerprint: 'champ-1' },
  ]);

  const bounded = nextTrackState({
    state: next,
    policy: { tabuLimit: 2 },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-2',
      rejectedCandidateFingerprint: 'cand-2',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-a|grid-a|cand-2|window-1|lab-1',
    },
  });

  assert.deepEqual(bounded.tabuRejectedFingerprints, [
    { fingerprint: 'cand-1', addedAtCycle: 1, championFingerprint: 'champ-1' },
    { fingerprint: 'cand-2', addedAtCycle: 2, championFingerprint: 'champ-1' },
  ]);
});

test('nextTrackState does not tabu the champion fingerprint', () => {
  const next = nextTrackState({
    state: defaultSchedulerState(),
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'champ-1',
      rejectedCandidateFingerprint: 'champ-1',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-a|grid-a|champ-1|window-1|lab-1',
    },
  });

  assert.deepEqual(next.tabuRejectedFingerprints, []);
});

test('nextTrackState clears sticky activeTrackId when rotation trigger fires', () => {
  const next = nextTrackState({
    state: { activeTrackId: 'squeeze-context', cycleIndex: 8, noChangeStreak: 3, sameTrackCycleStreak: 9 },
    policy: { noChangeStreakRotateAfter: 3, maxCyclesPerTrack: 8, similarityRotateAbove: 0.85 },
    manifest: { rotationTrigger: 'noChangeStreak', topCandidateSimilarity: 0.91 },
  });

  assert.equal(next.activeTrackId, null);
  assert.equal(next.lastRotationTrigger, 'noChangeStreak');
});

test('nextTrackState resets the streak when rotation changes the active track', () => {
  const rotated = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-a',
      cycleIndex: 5,
      noChangeStreak: 4,
      sameTrackCycleStreak: 8,
      lastNoveltySignature: 'track-a|grid-a|cand-1|window-1|lab-1',
      lastChampionFingerprint: 'champ-1',
      lastCandidateFingerprint: 'cand-1',
    },
    manifest: {
      activeTrackId: 'track-c',
      candidateFingerprint: 'cand-1',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-c|grid-c|cand-1|window-1|lab-1',
    },
  });

  assert.equal(rotated.noChangeStreak, 0);
  assert.equal(rotated.activeTrackId, 'track-c');
  assert.equal(rotated.lastRotationTrigger, 'rotation');
});

test('nextTrackState escalates stagnation level after repeated no-new-candidate runs', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 2,
      stagnationLevel: 0,
    },
    policy: {
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        maxStagnationLevel: 3,
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T00:00:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 3);
  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T00:00:00.000Z');
});

test('nextTrackState consumes nested rotation stagnation policy', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 1,
      stagnationLevel: 0,
    },
    policy: {
      rotationPolicy: {
        stagnation: {
          noNewCandidateEscalateAfter: 2,
          maxStagnationLevel: 3,
        },
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T00:10:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 2);
  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T00:10:00.000Z');
});

test('nextTrackState preserves stagnation state when no explicit transition applies', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noChangeStreak: 3,
      lastCandidateFingerprint: 'fp-b',
      stagnationLevel: 1,
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T00:00:00.000Z',
    },
    policy: {
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        maxStagnationLevel: 3,
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      topCandidateSimilarity: 0.94,
      promotionEligible: false,
      generatedAt: '2026-05-03T01:00:00.000Z',
    },
  });

  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T00:00:00.000Z');
});

test('nextTrackState escalates high-similarity holds with cadence', () => {
  const policy = {
    stagnation: {
      enabled: true,
      holdEscalateAfter: 5,
      highSimilarityThreshold: 0.9,
      maxStagnationLevel: 3,
    },
  };
  const firstCycle = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noChangeStreak: 4,
      lastCandidateFingerprint: 'fp-b',
      stagnationLevel: 0,
    },
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      promotionEligible: false,
      topCandidateSimilarity: 0.91,
      generatedAt: '2026-05-03T00:30:00.000Z',
    },
  });

  assert.equal(firstCycle.noChangeStreak, 5);
  assert.equal(firstCycle.stagnationLevel, 1);
  assert.equal(firstCycle.stagnationReason, 'highSimilarityHold');
  assert.equal(firstCycle.lastEscalatedAt, '2026-05-03T00:30:00.000Z');

  const secondCycle = nextTrackState({
    state: firstCycle,
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      promotionEligible: false,
      topCandidateSimilarity: 0.95,
      generatedAt: '2026-05-03T01:00:00.000Z',
    },
  });

  assert.equal(secondCycle.noChangeStreak, 6);
  assert.equal(secondCycle.stagnationLevel, 1);
  assert.equal(secondCycle.stagnationReason, 'highSimilarityHold');
  assert.equal(secondCycle.lastEscalatedAt, '2026-05-03T00:30:00.000Z');

  const thirdCycle = nextTrackState({
    state: {
      ...secondCycle,
      noChangeStreak: 9,
    },
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      promotionEligible: false,
      topCandidateSimilarity: 0.95,
      generatedAt: '2026-05-03T01:30:00.000Z',
    },
  });

  assert.equal(thirdCycle.noChangeStreak, 10);
  assert.equal(thirdCycle.stagnationLevel, 2);
  assert.equal(thirdCycle.stagnationReason, 'highSimilarityHold');
  assert.equal(thirdCycle.lastEscalatedAt, '2026-05-03T01:30:00.000Z');
});

test('nextTrackState treats first observed candidate as changed and resets no-change streak', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noChangeStreak: 3,
      lastCandidateFingerprint: null,
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-first',
      championFingerprint: 'fp-champ',
      noveltySignature: 'track-a|grid-a|fp-first|window-1|lab-1',
    },
  });

  assert.equal(next.noChangeStreak, 0);
  assert.equal(next.lastRotationTrigger, 'candidate-changed');
});

test('nextTrackState advances explicit stagnation state only on no-new-candidate cadence boundaries', () => {
  const policy = {
    stagnation: {
      enabled: true,
      noNewCandidateEscalateAfter: 3,
      maxStagnationLevel: 5,
    },
  };
  const firstCycle = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 2,
      stagnationLevel: 0,
    },
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T00:30:00.000Z',
    },
  });

  assert.equal(firstCycle.noNewCandidateStreak, 3);
  assert.equal(firstCycle.stagnationLevel, 1);
  assert.equal(firstCycle.stagnationReason, 'noNewCandidateStreak');
  assert.equal(firstCycle.lastEscalatedAt, '2026-05-03T00:30:00.000Z');

  const secondCycle = nextTrackState({
    state: firstCycle,
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T01:00:00.000Z',
    },
  });

  assert.equal(secondCycle.noNewCandidateStreak, 4);
  assert.equal(secondCycle.stagnationLevel, 1);
  assert.equal(secondCycle.stagnationReason, 'noNewCandidateStreak');
  assert.equal(secondCycle.lastEscalatedAt, '2026-05-03T00:30:00.000Z');

  const thirdCycle = nextTrackState({
    state: secondCycle,
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T01:30:00.000Z',
    },
  });

  assert.equal(thirdCycle.noNewCandidateStreak, 5);
  assert.equal(thirdCycle.stagnationLevel, 1);
  assert.equal(thirdCycle.stagnationReason, 'noNewCandidateStreak');
  assert.equal(thirdCycle.lastEscalatedAt, '2026-05-03T00:30:00.000Z');

  const fourthCycle = nextTrackState({
    state: thirdCycle,
    policy,
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T02:00:00.000Z',
    },
  });

  assert.equal(fourthCycle.noNewCandidateStreak, 6);
  assert.equal(fourthCycle.stagnationLevel, 2);
  assert.equal(fourthCycle.stagnationReason, 'noNewCandidateStreak');
  assert.equal(fourthCycle.lastEscalatedAt, '2026-05-03T02:00:00.000Z');
});

test('nextTrackState caps stagnation level at maxStagnationLevel', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 2,
      stagnationLevel: 2,
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T02:00:00.000Z',
    },
    policy: {
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        maxStagnationLevel: 2,
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T03:00:00.000Z',
    },
  });

  assert.equal(next.stagnationLevel, 2);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T02:00:00.000Z');
});

test('nextTrackState uses nested rotation stagnation policy when top-level stagnation policy is empty', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 3,
      stagnationLevel: 0,
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T03:00:00.000Z',
    },
    policy: {
      stagnation: {},
      rotationPolicy: {
        stagnation: {
          enabled: true,
          noNewCandidateEscalateAfter: 5,
          maxStagnationLevel: 5,
        },
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T04:00:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 4);
  assert.equal(next.stagnationLevel, 0);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T03:00:00.000Z');
});

test('nextTrackState lets explicit top-level stagnation policy override nested rotation policy', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 2,
      stagnationLevel: 0,
    },
    policy: {
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        maxStagnationLevel: 5,
      },
      rotationPolicy: {
        stagnation: {
          enabled: true,
          noNewCandidateEscalateAfter: 99,
          maxStagnationLevel: 5,
        },
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T04:30:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 3);
  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T04:30:00.000Z');
});

test('nextTrackState merges partial top-level stagnation policy over nested defaults', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 1,
      stagnationLevel: 4,
      stagnationReason: 'noNewCandidateStreak',
      lastEscalatedAt: '2026-05-03T04:00:00.000Z',
    },
    policy: {
      stagnation: {
        maxStagnationLevel: 5,
      },
      rotationPolicy: {
        stagnation: {
          enabled: true,
          noNewCandidateEscalateAfter: 2,
          maxStagnationLevel: 4,
        },
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T04:45:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 2);
  assert.equal(next.stagnationLevel, 5);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T04:45:00.000Z');
});

test('nextTrackState ignores malformed top-level stagnation values when nested defaults are valid', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 1,
      stagnationLevel: 0,
    },
    policy: {
      stagnation: {
        enabled: null,
        noNewCandidateEscalateAfter: '',
        maxStagnationLevel: false,
      },
      rotationPolicy: {
        stagnation: {
          enabled: true,
          noNewCandidateEscalateAfter: 2,
          maxStagnationLevel: 4,
        },
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T05:00:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 2);
  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T05:00:00.000Z');
});

test('nextTrackState does not escalate when stagnation policy disabled', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 2,
      noChangeStreak: 4,
      stagnationLevel: 1,
      stagnationReason: 'highSimilarityHold',
    },
    policy: {
      stagnation: {
        enabled: false,
        noNewCandidateEscalateAfter: 3,
        holdEscalateAfter: 5,
        highSimilarityThreshold: 0.9,
        maxStagnationLevel: 3,
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      promotionEligible: false,
      topCandidateSimilarity: 0.95,
      generatedAt: '2026-05-03T03:30:00.000Z',
    },
  });

  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'highSimilarityHold');
});

test('nextTrackState clones blocked promotion fingerprints output array', () => {
  const blockedPromotionFingerprints = ['fp-1', 'fp-2'];
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      blockedPromotionFingerprints,
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'cand-1',
      championFingerprint: 'champ-1',
      noveltySignature: 'track-a|grid-a|cand-1|window-1|lab-1',
    },
  });

  assert.notEqual(next.blockedPromotionFingerprints, blockedPromotionFingerprints);
  assert.deepEqual(next.blockedPromotionFingerprints, blockedPromotionFingerprints);
});

test('readSchedulerState normalizes malformed persisted stagnation and blocked fingerprint fields', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-tracks-normalize-'));
  const filePath = path.join(dir, 'matrix-malformed.json');

  const malformed = {
    ...defaultSchedulerState(),
    stagnationLevel: -2.75,
    stagnationReason: ['bad'],
    lastEscalatedAt: { bad: true },
    blockedPromotionFingerprints: ['fp-1', 42, null, 'fp-2'],
  };

  try {
    await writeSchedulerState(filePath, malformed);
    const normalized = await readSchedulerState(filePath);
    assert.equal(normalized.stagnationLevel, 0);
    assert.equal(normalized.stagnationReason, null);
    assert.equal(normalized.lastEscalatedAt, null);
    assert.deepEqual(normalized.blockedPromotionFingerprints, ['fp-1', 'fp-2']);

    await writeFile(filePath, `${JSON.stringify({ ...malformed, stagnationLevel: 4.9 })}\n`, 'utf8');
    const decimalNormalized = await readSchedulerState(filePath);
    assert.equal(decimalNormalized.stagnationLevel, 4);

    await writeFile(filePath, `${JSON.stringify({ ...malformed, stagnationLevel: '9' })}\n`, 'utf8');
    const stringNormalized = await readSchedulerState(filePath);
    assert.equal(stringNormalized.stagnationLevel, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('nextTrackState decays stagnation after promotion-eligible candidate appears', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      stagnationLevel: 2,
      stagnationReason: 'highSimilarityHold',
    },
    policy: { stagnation: { enabled: true } },
    manifest: {
      activeTrackId: 'track-b',
      candidateFingerprint: 'fp-c',
      championFingerprint: 'fp-a',
      promotionEligible: true,
      generatedAt: '2026-05-03T02:00:00.000Z',
    },
  });

  assert.equal(next.stagnationLevel, 0);
  assert.equal(next.stagnationReason, null);
});

test('detectRotationTrigger does not rotate on high similarity when emission is healthy', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 6 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, null);
});

test('detectRotationTrigger rotates on high similarity when emission is low', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 2 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, 'noveltySimilarity');
});

test('detectRotationTrigger does not rotate when emittedVariantCount equals similarityRotateMinEmitted boundary', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 4 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, null);
});

test('detectRotationTrigger preserves explicit manifest.rotationTrigger regardless of emission', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      rotationTrigger: 'noChangeStreak',
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 10 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, 'noChangeStreak');
});
