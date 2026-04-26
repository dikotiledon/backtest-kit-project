import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildNoveltySignature,
  defaultSchedulerState,
  nextTrackState,
  normalizeResearchTracks,
  readSchedulerState,
  resolveSchedulerStatePath,
  selectActiveTrack,
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
    lastNoveltySignature: 'sig-1',
    lastChampionFingerprint: 'champ-1',
    lastCandidateFingerprint: 'cand-1',
    lastRotationTrigger: 'steady-state',
  };

  try {
    await writeSchedulerState(filePath, state);
    assert.deepEqual(await readSchedulerState(filePath), state);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test('nextTrackState resets the streak when rotation changes the active track', () => {
  const rotated = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      activeTrackId: 'track-a',
      cycleIndex: 5,
      noChangeStreak: 4,
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
