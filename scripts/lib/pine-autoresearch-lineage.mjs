function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (isPlainObject(value)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function buildCandidateFamilyKey({ config = {}, familyKeys = [] } = {}) {
  const safeConfig = isPlainObject(config) ? config : {};
  const keys = Array.isArray(familyKeys) && familyKeys.length > 0
    ? familyKeys
    : [
        'useSignalFusion',
        'useFusionV2',
        'useFusionV3',
        'useFusionV4',
        'useDivergenceContext',
        'useSqueezeContext',
        'useSupertrendFilter',
        'useTrailingStop',
        'useStopsTP',
      ];

  const family = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(safeConfig, key)) {
      family[key] = safeConfig[key];
    }
  }
  return JSON.stringify(stableValue(family));
}

export function summarizePromotionLineage({ historyEvents = [], limit = 12 } = {}) {
  const safeHistoryEvents = Array.isArray(historyEvents) ? historyEvents : [];

  const promotions = safeHistoryEvents
    .filter((event) => event?.type === 'promote' || event?.type === 'autopromote')
    .filter((event) => event.toFingerprint || event.toConfigFingerprint || event.championFingerprint || event.toConfigId)
    .map((event) => ({
      timestamp: event.timestamp ?? null,
      mode: event.type,
      fromFingerprint: event.fromFingerprint ?? event.fromConfigFingerprint ?? null,
      toFingerprint: event.toFingerprint ?? event.toConfigFingerprint ?? event.championFingerprint ?? null,
      fromFamilyKey: event.fromFamilyKey ?? null,
      toFamilyKey: event.toFamilyKey ?? null,
      fromConfigId: event.fromConfigId ?? null,
      toConfigId: event.toConfigId ?? event.championConfigId ?? null,
      sourceRunId: event.runId ?? event.sourceRunId ?? null,
      fromConfig: event.fromConfig ?? null,
      toConfig: event.toConfig ?? null,
    }))
    .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)))
    .slice(0, Math.max(1, Number(limit) || 12));

  return {
    recentTransitions: promotions,
    recentPromotedFingerprints: promotions.map((event) => event.toFingerprint).filter(Boolean),
    recentDemotedFingerprints: promotions.map((event) => event.fromFingerprint).filter(Boolean),
    recentPromotedFamilies: promotions.map((event) => event.toFamilyKey).filter(Boolean),
    recentDemotedFamilies: promotions.map((event) => event.fromFamilyKey).filter(Boolean),
  };
}

function normalizeNumericConfigValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numericKeysMatch(left, right, numericKeys = []) {
  if (!isPlainObject(left) || !isPlainObject(right) || !Array.isArray(numericKeys) || numericKeys.length === 0) return false;
  for (const key of numericKeys) {
    const leftValue = normalizeNumericConfigValue(left?.[key]);
    const rightValue = normalizeNumericConfigValue(right?.[key]);
    if (leftValue === null || rightValue === null) return false;
    if (leftValue !== rightValue) return false;
  }
  return true;
}

export function detectPingPongRisk({
  candidateFingerprint,
  candidateFamilyKey,
  currentChampionFingerprint,
  currentChampionFamilyKey,
  candidateConfig,
  currentChampionConfig,
  lineage = summarizePromotionLineage(),
  policy = {},
} = {}) {
  const lookback = Math.max(1, Number(policy.lookbackPromotions ?? 6) || 6);
  const transitions = Array.isArray(lineage.recentTransitions)
    ? lineage.recentTransitions.slice(0, lookback)
    : [];

  const numericKeys = Array.isArray(policy.numericKeys) && policy.numericKeys.length > 0
    ? policy.numericKeys
    : ['tpAtrMult', 'slAtrMult', 'trailAtrMult', 'minPredSum'];
  const numericReversal = transitions.find((event) => (
    event.fromConfig
    && event.toConfig
    && candidateConfig
    && currentChampionConfig
    && numericKeysMatch(event.fromConfig, candidateConfig, numericKeys)
    && numericKeysMatch(event.toConfig, currentChampionConfig, numericKeys)
  ));
  if (numericReversal) {
    return {
      blocked: true,
      level: 'numeric-reversal',
      reason: 'candidate numerics were recently demoted by the current champion numerics',
      matchedTransition: numericReversal,
    };
  }

  const directReversal = transitions.find((event) => (
    event.fromFingerprint
    && event.toFingerprint
    && candidateFingerprint
    && currentChampionFingerprint
    && event.fromFingerprint === candidateFingerprint
    && event.toFingerprint === currentChampionFingerprint
  ));
  if (directReversal) {
    return {
      blocked: true,
      level: 'direct-reversal',
      reason: `candidate ${candidateFingerprint} was recently demoted by current champion ${currentChampionFingerprint}`,
      matchedTransition: directReversal,
    };
  }

  const familyReversal = transitions.find((event) => (
    event.fromFamilyKey
    && event.toFamilyKey
    && candidateFamilyKey
    && currentChampionFamilyKey
    && event.fromFamilyKey === candidateFamilyKey
    && event.toFamilyKey === currentChampionFamilyKey
  ));
  if (familyReversal) {
    return {
      blocked: true,
      level: 'family-reversal',
      reason: 'candidate family was recently demoted by current champion family',
      matchedTransition: familyReversal,
    };
  }

  const recentPromotedRepeat = transitions.find((event) => (
    candidateFingerprint
    && event.toFingerprint === candidateFingerprint
    && event.toFingerprint !== currentChampionFingerprint
  ));
  if (recentPromotedRepeat) {
    return {
      blocked: true,
      level: 'recent-repeat',
      reason: `candidate ${candidateFingerprint} was already promoted recently and then left champion lineage`,
      matchedTransition: recentPromotedRepeat,
    };
  }

  return { blocked: false, level: 'none', reason: 'no lineage ping-pong risk detected', matchedTransition: null };
}

export function decideLineagePromotionGate({
  candidateFingerprint,
  candidateFamilyKey,
  currentChampionFingerprint,
  currentChampionFamilyKey,
  candidateConfig,
  currentChampionConfig,
  lineage = summarizePromotionLineage(),
  matrixDecision = {},
  robustness = {},
  policy = {},
} = {}) {
  const enabled = policy.enabled !== false;
  if (!enabled) {
    return { passed: true, failedGates: [], risk: { level: 'disabled', blocked: false }, summary: 'Lineage gate disabled.' };
  }

  const risk = detectPingPongRisk({
    candidateFingerprint,
    candidateFamilyKey,
    currentChampionFingerprint,
    currentChampionFamilyKey,
    candidateConfig,
    currentChampionConfig,
    lineage,
    policy,
  });
  if (!risk.blocked) {
    return { passed: true, failedGates: [], risk, summary: 'Lineage gate passed.' };
  }

  const counts = matrixDecision?.counts ?? {};
  const shadowPassCount = asNumber(counts.shadowPassCount, 0);
  const minExtraShadowPasses = asNumber(policy.directReversalExtraShadowPasses, 1);
  const requiredShadowPassCount = asNumber(policy.baseShadowPassCount, 3) + minExtraShadowPasses;
  const aggregateScoreDelta = asNumber(robustness.aggregateScoreDelta, 0);
  const minExtraAggregateScoreDelta = asNumber(policy.minExtraAggregateScoreDelta, 5);
  const aggregateRoiDeltaPct = asNumber(robustness.aggregateRoiDeltaPct, 0);
  const minExtraAggregateRoiDeltaPct = asNumber(policy.minExtraAggregateRoiDeltaPct, 0);

  const gates = {
    lineageShadowMargin: shadowPassCount >= requiredShadowPassCount,
    lineageScoreMargin: aggregateScoreDelta >= minExtraAggregateScoreDelta,
    lineageRoiMargin: aggregateRoiDeltaPct >= minExtraAggregateRoiDeltaPct,
  };
  const failedGates = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);

  return {
    passed: failedGates.length === 0,
    failedGates: failedGates.length === 0 ? [] : ['lineagePingPong', ...failedGates],
    risk,
    gates,
    required: {
      requiredShadowPassCount,
      minExtraAggregateScoreDelta,
      minExtraAggregateRoiDeltaPct,
    },
    summary: failedGates.length === 0
      ? `Lineage risk ${risk.level} allowed by extra proof margin.`
      : `Lineage risk ${risk.level} blocked: ${risk.reason}.`,
  };
}
