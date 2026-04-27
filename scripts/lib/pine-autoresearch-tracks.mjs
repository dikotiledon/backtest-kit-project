import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function similarityRatio(left, right) {
  if (isPlainObject(left) && isPlainObject(right)) {
    const comparableKeys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    if (comparableKeys.length === 0) return 1;
    const score = comparableKeys.reduce((sum, key) => (
      sum + (Object.prototype.hasOwnProperty.call(left, key) && Object.prototype.hasOwnProperty.call(right, key)
        ? similarityRatio(left[key], right[key])
        : 0)
    ), 0);
    return Number((score / comparableKeys.length).toFixed(3));
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const limit = Math.max(left.length, right.length);
    if (limit === 0) return 1;
    let score = 0;
    for (let i = 0; i < limit; i++) {
      score += i < left.length && i < right.length ? similarityRatio(left[i], right[i]) : 0;
    }
    return Number((score / limit).toFixed(3));
  }

  return Number((stableValue(left) === stableValue(right) ? 1 : 0).toFixed(3));
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

export function computeConfigSimilarity({ left, right }) {
  return similarityRatio(left, right);
}

export function summarizeTopCandidateSimilarity({ championConfig, candidates = [] }) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      similarity: computeConfigSimilarity({ left: championConfig, right: candidate?.config }),
    }))
    .sort((left, right) => right.similarity - left.similarity);

  const top = ranked[0] || null;
  return {
    topCandidateSimilarity: top?.similarity ?? 0,
    topCandidateConfigId: top?.candidate?.configId ?? null,
    topCandidateFingerprint: top?.candidate?.config ? JSON.stringify(stableValue(top.candidate.config)) : null,
    candidates: ranked.map(({ candidate, similarity }) => ({
      configId: candidate?.configId ?? null,
      similarity,
    })),
  };
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
    sameTrackCycleStreak: 0,
    lastNoveltySignature: null,
    lastChampionFingerprint: null,
    lastCandidateFingerprint: null,
    lastRotationTrigger: null,
    lastPromotionEligibleAt: null,
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

function resolveRotationTrigger({ state = defaultSchedulerState(), policy = {}, manifest = {} } = {}) {
  if (manifest.rotationTrigger) {
    return manifest.rotationTrigger;
  }

  const hasPolicyTrigger = Number.isFinite(policy.noChangeStreakRotateAfter)
    || Number.isFinite(policy.similarityRotateAbove)
    || Number.isFinite(policy.maxCyclesPerTrack);
  if (!hasPolicyTrigger) {
    return null;
  }

  const noChangeStreakRotateAfter = Number.isFinite(policy.noChangeStreakRotateAfter)
    ? policy.noChangeStreakRotateAfter
    : 3;
  const similarityRotateAbove = Number.isFinite(policy.similarityRotateAbove)
    ? policy.similarityRotateAbove
    : 0.85;
  const maxCyclesPerTrack = Number.isFinite(policy.maxCyclesPerTrack)
    ? policy.maxCyclesPerTrack
    : 8;

  if ((state?.noChangeStreak ?? 0) >= noChangeStreakRotateAfter) {
    return 'noChangeStreak';
  }

  if (Number.isFinite(manifest.topCandidateSimilarity) && manifest.topCandidateSimilarity > similarityRotateAbove) {
    return 'noveltySimilarity';
  }

  if ((state?.sameTrackCycleStreak ?? 0) > maxCyclesPerTrack && manifest.promotionEligible === false) {
    return 'maxCyclesPerTrack';
  }

  return null;
}

export function nextTrackState({ state = defaultSchedulerState(), policy = {}, manifest = {} } = {}) {
  const previous = normalizeSchedulerState(state);
  const resolvedRotationTrigger = resolveRotationTrigger({ state: previous, policy, manifest });
  const nextActiveTrackId = resolvedRotationTrigger && ['noChangeStreak', 'noveltySimilarity', 'maxCyclesPerTrack'].includes(resolvedRotationTrigger)
    ? null
    : manifest.activeTrackId ?? previous.activeTrackId ?? null;
  const activeTrackChanged = nextActiveTrackId != null
    && previous.activeTrackId != null
    && nextActiveTrackId !== previous.activeTrackId;
  const rotationHappened = Boolean(resolvedRotationTrigger) || activeTrackChanged;
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
  const sameTrackCycleStreak = rotationHappened
    ? (resolvedRotationTrigger && ['noChangeStreak', 'noveltySimilarity', 'maxCyclesPerTrack'].includes(resolvedRotationTrigger)
      ? 0
      : activeTrackChanged
        ? (previous.activeTrackId ? 1 : 0)
        : previous.sameTrackCycleStreak)
    : nextActiveTrackId && nextActiveTrackId === previous.activeTrackId
      ? previous.sameTrackCycleStreak + 1
      : nextActiveTrackId
        ? 1
        : 0;

  return {
    ...previous,
    activeTrackId: nextActiveTrackId,
    cycleIndex: Number.isFinite(manifest.cycleIndex) ? manifest.cycleIndex : previous.cycleIndex + 1,
    noChangeStreak,
    sameTrackCycleStreak,
    lastNoveltySignature: noveltySignature,
    lastChampionFingerprint: championFingerprint ?? previous.lastChampionFingerprint,
    lastCandidateFingerprint: candidateFingerprint ?? previous.lastCandidateFingerprint,
    lastRotationTrigger: resolvedRotationTrigger
      ?? (activeTrackChanged ? 'rotation' : candidateChanged ? 'candidate-changed' : repeatedNovelty ? 'steady-state' : previous.lastRotationTrigger),
    lastPromotionEligibleAt: manifest.promotionEligible === true
      ? (manifest.promotionEligibleAt ?? manifest.generatedAt ?? previous.lastPromotionEligibleAt)
      : previous.lastPromotionEligibleAt,
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
    sameTrackCycleStreak: Number.isFinite(state.sameTrackCycleStreak) ? state.sameTrackCycleStreak : base.sameTrackCycleStreak,
    lastNoveltySignature: state.lastNoveltySignature ?? base.lastNoveltySignature,
    lastChampionFingerprint: state.lastChampionFingerprint ?? base.lastChampionFingerprint,
    lastCandidateFingerprint: state.lastCandidateFingerprint ?? base.lastCandidateFingerprint,
    lastRotationTrigger: state.lastRotationTrigger ?? base.lastRotationTrigger,
    lastPromotionEligibleAt: state.lastPromotionEligibleAt ?? base.lastPromotionEligibleAt,
  };
}
