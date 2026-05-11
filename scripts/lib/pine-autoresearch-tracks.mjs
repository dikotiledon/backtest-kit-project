import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeLaneExhaustions(value = {}) {
  if (!isPlainObject(value)) return {};
  const normalized = {};
  for (const [championConfigFingerprint, lanes] of Object.entries(value)) {
    if (typeof championConfigFingerprint !== 'string' || championConfigFingerprint.length === 0) continue;
    if (!isPlainObject(lanes)) continue;
    const normalizedLanes = {};
    for (const [lane, entry] of Object.entries(lanes)) {
      if (typeof lane !== 'string' || lane.length === 0) continue;
      if (!isPlainObject(entry)) continue;
      normalizedLanes[lane] = {
        ...clone(entry),
        lane: typeof entry.lane === 'string' && entry.lane.length > 0 ? entry.lane : lane,
        championConfigFingerprint: typeof entry.championConfigFingerprint === 'string' && entry.championConfigFingerprint.length > 0
          ? entry.championConfigFingerprint
          : championConfigFingerprint,
      };
    }
    if (Object.keys(normalizedLanes).length > 0) normalized[championConfigFingerprint] = normalizedLanes;
  }
  return normalized;
}

function normalizePositiveInteger(value, fallback) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.floor(numeric));
}

function normalizeKnownFingerprint(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeTabuPrunePolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : {};
  return {
    maxAgeCycles: normalizePositiveInteger(source.maxAgeCycles, 20),
    maxEntries: normalizePositiveInteger(source.maxEntries, 32),
    dropOnChampionChange: source.dropOnChampionChange === false ? false : true,
  };
}

function normalizeTabuEntry(entry, { currentCycle = 0, index = 0 } = {}) {
  if (!isPlainObject(entry)) return null;
  const fingerprint = normalizeKnownFingerprint(entry.fingerprint);
  if (!fingerprint) return null;
  const rawAddedAtCycle = Number(entry.addedAtCycle);
  const addedAtCycle = Number.isFinite(rawAddedAtCycle)
    ? Math.max(0, Math.floor(rawAddedAtCycle))
    : currentCycle;
  return {
    fingerprint,
    addedAtCycle,
    championFingerprint: normalizeKnownFingerprint(entry.championFingerprint),
    index,
  };
}

export function pruneTabuFingerprints(input = {}) {
  if (!isPlainObject(input)) return [];
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const currentCycle = Number.isFinite(Number(input.currentCycle))
    ? Math.max(0, Math.floor(Number(input.currentCycle)))
    : 0;
  const currentChampionFingerprint = normalizeKnownFingerprint(input.currentChampionFingerprint);
  const policy = normalizeTabuPrunePolicy(input.policy);
  const deduped = new Map();

  entries.forEach((entry, index) => {
    const normalized = normalizeTabuEntry(entry, { currentCycle, index });
    if (!normalized) return;
    if (
      policy.dropOnChampionChange
      && currentChampionFingerprint
      && normalized.championFingerprint
      && normalized.championFingerprint !== currentChampionFingerprint
    ) {
      return;
    }
    if (currentCycle - normalized.addedAtCycle > policy.maxAgeCycles) return;

    const existing = deduped.get(normalized.fingerprint);
    if (!existing
      || normalized.addedAtCycle > existing.addedAtCycle
      || (normalized.addedAtCycle === existing.addedAtCycle && normalized.index > existing.index)) {
      deduped.set(normalized.fingerprint, normalized);
    }
  });

  return [...deduped.values()]
    .sort((left, right) => (right.addedAtCycle - left.addedAtCycle) || (right.index - left.index))
    .slice(0, policy.maxEntries)
    .sort((left, right) => (left.addedAtCycle - right.addedAtCycle) || (left.index - right.index))
    .map(({ fingerprint, addedAtCycle, championFingerprint }) => ({ fingerprint, addedAtCycle, championFingerprint }));
}

function resolveTabuPolicy(policy = {}) {
  if (isPlainObject(policy?.tabu)) return policy.tabu;
  if (Number.isFinite(policy?.tabuLimit)) {
    return { maxAgeCycles: 20, maxEntries: policy.tabuLimit, dropOnChampionChange: true };
  }
  return {};
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
    noNewCandidateStreak: 0,
    sameTrackCycleStreak: 0,
    lastNoveltySignature: null,
    lastChampionFingerprint: null,
    lastCandidateFingerprint: null,
    lastNoNewCandidateAt: null,
    lastRotationTrigger: null,
    lastPromotionEligibleAt: null,
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
    blockedPromotionFingerprints: [],
    tabuRejectedFingerprints: [],
    laneExhaustions: {},
    lastLaneExhaustion: null,
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
  const noNewCandidate = manifest.noNewCandidate === true
    || (candidateFingerprint != null && championFingerprint != null && candidateFingerprint === championFingerprint);
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
  const candidateChanged = candidateFingerprint != null
    && candidateFingerprint !== previous.lastCandidateFingerprint;
  const noChangeStreak = rotationHappened
    ? 0
    : candidateChanged
      ? 0
      : previous.noChangeStreak + 1;
  const noNewCandidateStreak = noNewCandidate
    ? previous.noNewCandidateStreak + 1
    : 0;

  const stagnationPolicy = isPlainObject(policy.stagnation) ? policy.stagnation : {};
  const stagnationEnabled = stagnationPolicy.enabled === true;
  const maxStagnationLevel = Math.max(1, Number(stagnationPolicy.maxStagnationLevel ?? 3) || 3);
  const noNewCandidateEscalateAfter = Math.max(1, Number(stagnationPolicy.noNewCandidateEscalateAfter ?? 3) || 3);
  const holdEscalateAfter = Math.max(1, Number(stagnationPolicy.holdEscalateAfter ?? 5) || 5);
  const highSimilarityThreshold = Number.isFinite(Number(stagnationPolicy.highSimilarityThreshold))
    ? Number(stagnationPolicy.highSimilarityThreshold)
    : 0.9;

  let stagnationLevel = previous.stagnationLevel ?? 0;
  let stagnationReason = previous.stagnationReason ?? null;
  let lastEscalatedAt = previous.lastEscalatedAt ?? null;

  if (stagnationEnabled && manifest.promotionEligible === true) {
    stagnationLevel = 0;
    stagnationReason = null;
  } else if (stagnationEnabled) {
    const noNewEscalates = noNewCandidateStreak >= noNewCandidateEscalateAfter;
    const highSimilarityHold = manifest.promotionEligible === false
      && noChangeStreak >= holdEscalateAfter
      && Number.isFinite(manifest.topCandidateSimilarity)
      && manifest.topCandidateSimilarity >= highSimilarityThreshold;
    const nextReason = noNewEscalates ? 'noNewCandidateStreak' : highSimilarityHold ? 'highSimilarityHold' : null;
    if (nextReason) {
      const cadenceAnchor = nextReason === 'noNewCandidateStreak'
        ? noNewCandidateStreak
        : noChangeStreak;
      const cadenceThreshold = nextReason === 'noNewCandidateStreak'
        ? noNewCandidateEscalateAfter
        : holdEscalateAfter;
      const thresholdCrossed = cadenceAnchor === cadenceThreshold;
      const cadenceBucketAdvanced = cadenceAnchor > cadenceThreshold
        && cadenceAnchor % cadenceThreshold === 0;
      const reasonTransitioned = previous.stagnationReason !== nextReason;

      if (thresholdCrossed || cadenceBucketAdvanced || reasonTransitioned) {
        stagnationLevel = Math.min(maxStagnationLevel, stagnationLevel + 1);
        stagnationReason = nextReason;
        lastEscalatedAt = manifest.generatedAt ?? previous.lastEscalatedAt ?? null;
      }
    }
  }

  const nextCycleIndex = Number.isFinite(manifest.cycleIndex) ? manifest.cycleIndex : previous.cycleIndex + 1;
  const currentChampionFingerprint = championFingerprint ?? previous.lastChampionFingerprint ?? null;
  const priorTabu = Array.isArray(previous.tabuRejectedFingerprints)
    ? previous.tabuRejectedFingerprints.map((entry) => (typeof entry === 'string'
        ? { fingerprint: entry, addedAtCycle: previous.cycleIndex, championFingerprint: currentChampionFingerprint }
        : entry))
    : [];
  const nextRejected = manifest.rejectedCandidateFingerprint && manifest.rejectedCandidateFingerprint !== championFingerprint
    ? [
        ...priorTabu,
        {
          fingerprint: manifest.rejectedCandidateFingerprint,
          addedAtCycle: nextCycleIndex,
          championFingerprint: currentChampionFingerprint,
        },
      ]
    : priorTabu;
  const tabuRejectedFingerprints = pruneTabuFingerprints({
    entries: nextRejected,
    currentCycle: nextCycleIndex,
    currentChampionFingerprint,
    policy: resolveTabuPolicy(policy),
  });

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
    cycleIndex: nextCycleIndex,
    noChangeStreak,
    noNewCandidateStreak,
    sameTrackCycleStreak,
    lastNoveltySignature: noveltySignature,
    lastChampionFingerprint: championFingerprint ?? previous.lastChampionFingerprint,
    lastCandidateFingerprint: candidateFingerprint ?? previous.lastCandidateFingerprint,
    lastNoNewCandidateAt: noNewCandidate
      ? (manifest.generatedAt ?? previous.lastNoNewCandidateAt)
      : previous.lastNoNewCandidateAt,
    lastRotationTrigger: resolvedRotationTrigger
      ?? (activeTrackChanged ? 'rotation' : candidateChanged ? 'candidate-changed' : repeatedNovelty ? 'steady-state' : previous.lastRotationTrigger),
    lastPromotionEligibleAt: manifest.promotionEligible === true
      ? (manifest.promotionEligibleAt ?? manifest.generatedAt ?? previous.lastPromotionEligibleAt)
      : previous.lastPromotionEligibleAt,
    stagnationLevel,
    stagnationReason,
    lastEscalatedAt,
    blockedPromotionFingerprints: Array.isArray(previous.blockedPromotionFingerprints)
      ? [...previous.blockedPromotionFingerprints]
      : [],
    tabuRejectedFingerprints,
    laneExhaustions: normalizeLaneExhaustions(previous.laneExhaustions),
    lastLaneExhaustion: isPlainObject(previous.lastLaneExhaustion) ? clone(previous.lastLaneExhaustion) : null,
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
    noNewCandidateStreak: Number.isFinite(state.noNewCandidateStreak) ? state.noNewCandidateStreak : base.noNewCandidateStreak,
    sameTrackCycleStreak: Number.isFinite(state.sameTrackCycleStreak) ? state.sameTrackCycleStreak : base.sameTrackCycleStreak,
    lastNoveltySignature: state.lastNoveltySignature ?? base.lastNoveltySignature,
    lastChampionFingerprint: state.lastChampionFingerprint ?? base.lastChampionFingerprint,
    lastCandidateFingerprint: state.lastCandidateFingerprint ?? base.lastCandidateFingerprint,
    lastNoNewCandidateAt: typeof state.lastNoNewCandidateAt === 'string' || state.lastNoNewCandidateAt === null
      ? state.lastNoNewCandidateAt
      : base.lastNoNewCandidateAt,
    lastRotationTrigger: state.lastRotationTrigger ?? base.lastRotationTrigger,
    lastPromotionEligibleAt: state.lastPromotionEligibleAt ?? base.lastPromotionEligibleAt,
    stagnationLevel: normalizeNonNegativeInteger(state.stagnationLevel, base.stagnationLevel),
    stagnationReason: typeof state.stagnationReason === 'string' || state.stagnationReason === null
      ? state.stagnationReason
      : base.stagnationReason,
    lastEscalatedAt: typeof state.lastEscalatedAt === 'string' || state.lastEscalatedAt === null
      ? state.lastEscalatedAt
      : base.lastEscalatedAt,
    blockedPromotionFingerprints: Array.isArray(state.blockedPromotionFingerprints)
      ? state.blockedPromotionFingerprints
        .filter((fingerprint) => typeof fingerprint === 'string')
        .map((fingerprint) => fingerprint)
      : base.blockedPromotionFingerprints,
    tabuRejectedFingerprints: Array.isArray(state.tabuRejectedFingerprints)
      ? [...state.tabuRejectedFingerprints]
      : base.tabuRejectedFingerprints,
    laneExhaustions: normalizeLaneExhaustions(state.laneExhaustions),
    lastLaneExhaustion: isPlainObject(state.lastLaneExhaustion) ? clone(state.lastLaneExhaustion) : base.lastLaneExhaustion,
  };
}
