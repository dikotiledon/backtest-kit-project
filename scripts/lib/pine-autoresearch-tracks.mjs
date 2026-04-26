import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeResearchTracks(rawTracks = []) {
  return rawTracks
    .filter(Boolean)
    .map((track, index) => {
      const trackId = String(track.trackId ?? track.id ?? track.name ?? `track-${index + 1}`);
      return {
        trackId,
        name: String(track.name ?? trackId),
        gridName: String(track.gridName ?? track.grid ?? trackId),
        enabled: track.enabled !== false,
        variantMode: track.variantMode ?? 'grid',
        sourceFamily: String(track.sourceFamily ?? track.source ?? trackId),
        windowSet: track.windowSet ?? null,
        promotionPolicy: isPlainObject(track.promotionPolicy) ? { ...track.promotionPolicy } : {},
        stopPolicy: isPlainObject(track.stopPolicy) ? { ...track.stopPolicy } : {},
      };
    });
}

export function buildNoveltySignature({
  trackId,
  gridName,
  candidateFingerprint,
  windowSetId,
  labSetId,
}) {
  return [trackId, gridName, candidateFingerprint, windowSetId, labSetId]
    .map((value) => String(value ?? ''))
    .join('|');
}

export function resolveSchedulerStatePath({ researchRoot, matrixId }) {
  return join(String(researchRoot), 'state', 'scheduler', `${String(matrixId)}.json`);
}

export async function readSchedulerState(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return normalizeSchedulerState(JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return defaultSchedulerState();
    }
    throw error;
  }
}

export async function writeSchedulerState(filePath, state) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalizeSchedulerState(state), null, 2)}\n`, 'utf8');
}

export function defaultSchedulerState() {
  return {
    activeTrackId: null,
    cycleIndex: 0,
    noChangeStreak: 0,
    lastNoveltySignature: null,
    lastChampionFingerprint: null,
    lastCandidateFingerprint: null,
    lastRotationTrigger: null,
  };
}

export function selectActiveTrack({ tracks = [], state = defaultSchedulerState(), cycleIndex } = {}) {
  const normalizedTracks = normalizeResearchTracks(tracks);
  const enabledTracks = normalizedTracks.filter((track) => track.enabled !== false);
  if (enabledTracks.length === 0) {
    return null;
  }

  const currentActive = state?.activeTrackId
    ? enabledTracks.find((track) => track.trackId === state.activeTrackId)
    : null;
  if (currentActive) {
    return currentActive;
  }

  const resolvedCycleIndex = Number.isFinite(cycleIndex)
    ? cycleIndex
    : Number.isFinite(state?.cycleIndex)
      ? state.cycleIndex
      : 0;
  const rotationIndex = resolvedCycleIndex > 0
    ? (resolvedCycleIndex - 1) % enabledTracks.length
    : 0;
  return enabledTracks[rotationIndex];
}

export function nextTrackState({ state = defaultSchedulerState(), manifest = {} } = {}) {
  const previous = normalizeSchedulerState(state);
  const nextActiveTrackId = manifest.activeTrackId ?? previous.activeTrackId ?? null;
  const rotationHappened = Boolean(
    previous.activeTrackId
    && manifest.activeTrackId != null
    && manifest.activeTrackId !== previous.activeTrackId,
  );
  const candidateFingerprint = manifest.candidateFingerprint ?? null;
  const championFingerprint = manifest.championFingerprint ?? null;
  const noveltySignature = manifest.noveltySignature ?? buildNoveltySignature({
    trackId: nextActiveTrackId,
    gridName: manifest.gridName ?? manifest.gridId ?? '',
    candidateFingerprint,
    windowSetId: manifest.windowSetId ?? manifest.windowSet ?? '',
    labSetId: manifest.labSetId ?? manifest.labId ?? '',
  });
  const repeatedNovelty =
    noveltySignature === previous.lastNoveltySignature
    && championFingerprint === previous.lastChampionFingerprint;
  const candidateChanged = candidateFingerprint != null && candidateFingerprint !== previous.lastCandidateFingerprint;
  const noChangeStreak = rotationHappened
    ? 0
    : candidateChanged
      ? 0
      : previous.noChangeStreak + 1;

  return {
    ...previous,
    activeTrackId: nextActiveTrackId,
    cycleIndex: Number.isFinite(manifest.cycleIndex) ? manifest.cycleIndex : previous.cycleIndex + 1,
    noChangeStreak,
    lastNoveltySignature: noveltySignature,
    lastChampionFingerprint: championFingerprint ?? previous.lastChampionFingerprint,
    lastCandidateFingerprint: candidateFingerprint ?? previous.lastCandidateFingerprint,
    lastRotationTrigger: rotationHappened
      ? 'rotation'
      : candidateChanged
        ? 'candidate-changed'
        : repeatedNovelty
          ? 'steady-state'
          : previous.lastRotationTrigger,
  };
}

function normalizeSchedulerState(state = {}) {
  const base = defaultSchedulerState();
  return {
    ...base,
    ...clone(state),
    activeTrackId: state.activeTrackId ?? base.activeTrackId,
    cycleIndex: Number.isFinite(state.cycleIndex) ? state.cycleIndex : base.cycleIndex,
    noChangeStreak: Number.isFinite(state.noChangeStreak) ? state.noChangeStreak : base.noChangeStreak,
    lastNoveltySignature: state.lastNoveltySignature ?? base.lastNoveltySignature,
    lastChampionFingerprint: state.lastChampionFingerprint ?? base.lastChampionFingerprint,
    lastCandidateFingerprint: state.lastCandidateFingerprint ?? base.lastCandidateFingerprint,
    lastRotationTrigger: state.lastRotationTrigger ?? base.lastRotationTrigger,
  };
}