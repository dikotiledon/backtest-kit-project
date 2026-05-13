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

function normalizeNumericPolicyInteger(value, { fallback, min }) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.floor(value));
}

const STAGNATION_POLICY_KEYS = new Set([
  'enabled',
  'noNewCandidateEscalateAfter',
  'holdEscalateAfter',
  'highSimilarityThreshold',
  'maxStagnationLevel',
  'lowEmissionEscalateAfter',
  'lowEmissionThreshold',
]);

function hasStagnationPolicyKeys(value) {
  return isPlainObject(value) && Object.keys(value).some((key) => STAGNATION_POLICY_KEYS.has(key));
}

function isMeaningfulStagnationPolicyValue(key, value) {
  if (key === 'enabled') return typeof value === 'boolean';
  if (!STAGNATION_POLICY_KEYS.has(key)) return false;
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveStagnationPolicy(policy = {}) {
  const nested = isPlainObject(policy?.rotationPolicy?.stagnation)
    ? policy.rotationPolicy.stagnation
    : {};
  const topLevel = isPlainObject(policy?.stagnation) ? policy.stagnation : {};
  const resolved = { ...nested };

  if (!hasStagnationPolicyKeys(topLevel)) return resolved;

  for (const [key, value] of Object.entries(topLevel)) {
    if (isMeaningfulStagnationPolicyValue(key, value)) {
      resolved[key] = value;
    }
  }

  return resolved;
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
  const normalizedCurrentCycle = normalizeNonNegativeInteger(currentCycle, 0);
  const addedAtCycle = Number.isFinite(rawAddedAtCycle)
    ? Math.min(normalizedCurrentCycle, Math.max(0, Math.floor(rawAddedAtCycle)))
    : normalizedCurrentCycle;
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

const DEFAULT_KEY_WEIGHTS = new Map([
  ['tpAtrMult', 3],
  ['slAtrMult', 3],
  ['trailAtrMult', 2],
  ['trailActivateR', 2],
  ['minPredSum', 3],
  ['adxThreshold', 2],
  ['useFusionV4', 2],
  ['useSignalFusion', 2],
  ['useSupertrendFilter', 2],
  ['divPivotLeft', 1],
  ['divPivotRight', 1],
  ['divFreshBars', 1],
]);

function similarityRatio(left, right) {
  if (isPlainObject(left) && isPlainObject(right)) {
    const comparableKeys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    if (comparableKeys.length === 0) return 1;
    let weightedScore = 0;
    let weightedTotal = 0;

    for (const key of comparableKeys) {
      const weight = DEFAULT_KEY_WEIGHTS.get(key) ?? 1;
      const childScore = Object.prototype.hasOwnProperty.call(left, key) && Object.prototype.hasOwnProperty.call(right, key)
        ? similarityRatio(left[key], right[key])
        : 0;
      weightedScore += childScore * weight;
      weightedTotal += weight;
    }

    return Number((weightedScore / weightedTotal).toFixed(3));
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
    lowEmissionStreak: 0,
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

export function detectRotationTrigger({ state = defaultSchedulerState(), policy = {}, manifest = {} } = {}) {
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
  const similarityRotateAbove = Number.isFinite(Number(policy?.similarityRotateAbove))
    ? Number(policy.similarityRotateAbove)
    : 0.98;
  const maxCyclesPerTrack = Number.isFinite(policy.maxCyclesPerTrack)
    ? policy.maxCyclesPerTrack
    : 8;

  if ((state?.noChangeStreak ?? 0) >= noChangeStreakRotateAfter) {
    return 'noChangeStreak';
  }

  const similarityRotateMinEmitted = Number.isFinite(Number(policy?.similarityRotateMinEmitted))
    ? Math.max(0, Math.floor(Number(policy.similarityRotateMinEmitted)))
    : 4;
  const emittedCount = Number(manifest?.searchEfficiency?.emittedVariantCount);
  const emissionBelowGuard = !Number.isFinite(emittedCount) || emittedCount < similarityRotateMinEmitted;
  if (
    Number.isFinite(manifest.topCandidateSimilarity)
    && manifest.topCandidateSimilarity > similarityRotateAbove
    && emissionBelowGuard
  ) {
    return 'noveltySimilarity';
  }

  if ((state?.sameTrackCycleStreak ?? 0) > maxCyclesPerTrack && manifest.promotionEligible === false) {
    return 'maxCyclesPerTrack';
  }

  return null;
}

function resolveRotationTrigger(input = {}) {
  return detectRotationTrigger(input);
}

export function nextStagnationState(input = {}) {
  const {
    previousLevel = 0,
    noNewCandidateStreak = 0,
    noChangeStreak = 0,
    lowEmissionStreak = 0,
    promotionEligible = false,
    topCandidateSimilarity = null,
    policy = {},
    now = null,
  } = isPlainObject(input) ? input : {};
  const sourcePolicy = isPlainObject(policy) ? policy : {};
  const maxStagnationLevel = normalizeNumericPolicyInteger(sourcePolicy.maxStagnationLevel, { fallback: 3, min: 0 });
  const noNewCandidateEscalateAfter = normalizeNumericPolicyInteger(sourcePolicy.noNewCandidateEscalateAfter, { fallback: 3, min: 1 });
  const holdEscalateAfter = normalizeNumericPolicyInteger(sourcePolicy.holdEscalateAfter, { fallback: 5, min: 1 });
  const lowEmissionEscalateAfter = normalizeNumericPolicyInteger(sourcePolicy.lowEmissionEscalateAfter, { fallback: 3, min: 1 });
  const highSimilarityThreshold = typeof sourcePolicy.highSimilarityThreshold === 'number' && Number.isFinite(sourcePolicy.highSimilarityThreshold)
    ? sourcePolicy.highSimilarityThreshold
    : 0.9;
  const normalizedPreviousLevel = Math.min(
    maxStagnationLevel,
    Math.max(0, Math.floor(Number.isFinite(Number(previousLevel)) ? Number(previousLevel) : 0)),
  );
  const normalizedNoNewCandidateStreak = Math.max(
    0,
    Math.floor(Number.isFinite(Number(noNewCandidateStreak)) ? Number(noNewCandidateStreak) : 0),
  );
  const normalizedNoChangeStreak = Math.max(
    0,
    Math.floor(Number.isFinite(Number(noChangeStreak)) ? Number(noChangeStreak) : 0),
  );
  const normalizedLowEmissionStreak = Math.max(
    0,
    Math.floor(Number.isFinite(Number(lowEmissionStreak)) ? Number(lowEmissionStreak) : 0),
  );
  const normalizedTopCandidateSimilarity = typeof topCandidateSimilarity === 'number' && Number.isFinite(topCandidateSimilarity)
    ? topCandidateSimilarity
    : null;

  if (promotionEligible === true) {
    return {
      stagnationLevel: 0,
      stagnationReason: null,
      lastEscalatedAt: null,
    };
  }

  const candidates = [
    {
      reason: 'noNewCandidateStreak',
      anchor: normalizedNoNewCandidateStreak,
      threshold: noNewCandidateEscalateAfter,
      active: normalizedNoNewCandidateStreak >= noNewCandidateEscalateAfter,
    },
    {
      reason: 'highSimilarityHold',
      anchor: normalizedNoChangeStreak,
      threshold: holdEscalateAfter,
      active: promotionEligible === false
        && normalizedNoChangeStreak >= holdEscalateAfter
        && normalizedTopCandidateSimilarity !== null
        && normalizedTopCandidateSimilarity >= highSimilarityThreshold,
    },
    {
      reason: 'lowEmissionStreak',
      anchor: normalizedLowEmissionStreak,
      threshold: lowEmissionEscalateAfter,
      active: promotionEligible === false
        && normalizedLowEmissionStreak >= lowEmissionEscalateAfter,
    },
  ];
  const transition = candidates.find((candidate) => candidate.active);
  const onCadenceBoundary = transition
    ? transition.anchor === transition.threshold
      || (transition.anchor > transition.threshold && transition.anchor % transition.threshold === 0)
    : false;

  if (transition && onCadenceBoundary) {
    const nextLevel = Math.min(maxStagnationLevel, normalizedPreviousLevel + 1);
    return {
      stagnationLevel: nextLevel,
      stagnationReason: transition.reason,
      lastEscalatedAt: nextLevel > normalizedPreviousLevel
        ? (now ?? null)
        : (sourcePolicy.lastEscalatedAt ?? null),
    };
  }

  return {
    stagnationLevel: normalizedPreviousLevel,
    stagnationReason: sourcePolicy.currentReason ?? null,
    lastEscalatedAt: sourcePolicy.lastEscalatedAt ?? null,
  };
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

  const configuredStagnationPolicy = resolveStagnationPolicy(policy);
  const lowEmissionThreshold = normalizeNumericPolicyInteger(
    configuredStagnationPolicy.lowEmissionThreshold,
    { fallback: 3, min: 0 },
  );
  const emittedVariantCount = Number(manifest.searchEfficiency?.emittedVariantCount);
  const lowEmissionStreak = manifest.promotionEligible === true
    ? 0
    : Number.isFinite(emittedVariantCount) && emittedVariantCount <= lowEmissionThreshold
      ? previous.lowEmissionStreak + 1
      : 0;
  const stagnationState = configuredStagnationPolicy.enabled === false
    ? {
        stagnationLevel: previous.stagnationLevel ?? 0,
        stagnationReason: previous.stagnationReason ?? null,
        lastEscalatedAt: previous.lastEscalatedAt ?? null,
      }
    : nextStagnationState({
        previousLevel: previous.stagnationLevel,
        noNewCandidateStreak,
        noChangeStreak,
        lowEmissionStreak,
        promotionEligible: manifest.promotionEligible === true,
        topCandidateSimilarity: manifest.topCandidateSimilarity,
        policy: {
          ...configuredStagnationPolicy,
          currentReason: previous.stagnationReason,
          lastEscalatedAt: previous.lastEscalatedAt,
        },
        now: manifest.generatedAt ?? null,
      });

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
    lowEmissionStreak,
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
    stagnationLevel: stagnationState.stagnationLevel,
    stagnationReason: stagnationState.stagnationReason,
    lastEscalatedAt: stagnationState.lastEscalatedAt,
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
    lowEmissionStreak: Number.isFinite(state.lowEmissionStreak) ? state.lowEmissionStreak : base.lowEmissionStreak,
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
