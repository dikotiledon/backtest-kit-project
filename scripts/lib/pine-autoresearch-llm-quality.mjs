function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textIncludesAny(text, terms) {
  const haystack = String(text ?? '').toLowerCase();
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function changedParamKeys(candidate) {
  if (!isPlainObject(candidate?.params)) return [];
  return Object.keys(candidate.params).sort();
}

function isLowerThanChampion(key, candidate, champion) {
  const next = Number(candidate?.params?.[key]);
  const current = Number(champion?.[key]);
  return Number.isFinite(next) && Number.isFinite(current) && next < current;
}

function isHigherThanChampion(key, candidate, champion) {
  const next = Number(candidate?.params?.[key]);
  const current = Number(champion?.[key]);
  return Number.isFinite(next) && Number.isFinite(current) && next > current;
}

function scorePenalty(result, flag, points, note) {
  result.score -= points;
  result.flags.push(flag);
  result.notes.push(note);
}

export function scoreCandidateQuality({
  candidate,
  champion = {},
  memory = {},
  config = {},
} = {}) {
  const minScore = Number(config?.quality?.minScore ?? 70);
  const result = {
    ok: true,
    score: 100,
    flags: [],
    notes: [],
  };

  const params = changedParamKeys(candidate);
  const rationale = String(candidate?.rationale ?? '');
  const latestBlocker = memory?.latestMatrixBlocker ?? memory?.latestOutcome ?? null;

  if (params.length === 0) {
    scorePenalty(
      result,
      'empty_candidate_params',
      45,
      'Candidate makes no parameter change.',
    );
  }

  if (params.length > 3) {
    scorePenalty(
      result,
      'too_many_changed_params_for_research_quality',
      10,
      'Prefer <= 3 params unless rationale is exceptionally specific.',
    );
  }

  const genericThresholdRrStop =
    params.includes('minPredSum') &&
    params.includes('riskRewardRatio') &&
    params.includes('stopLossPct') &&
    isLowerThanChampion('minPredSum', candidate, champion) &&
    isHigherThanChampion('riskRewardRatio', candidate, champion) &&
    isLowerThanChampion('stopLossPct', candidate, champion);

  if (genericThresholdRrStop) {
    scorePenalty(
      result,
      'generic_threshold_rr_stop_pattern',
      28,
      'Lower threshold + higher RR + tighter stop is common generic patch and needs matrix-specific justification.',
    );
  }

  const championValues = Object.values(champion ?? {})
    .filter((value) => ['number', 'string'].includes(typeof value))
    .map((value) => String(value));
  const referencesChampion =
    textIncludesAny(rationale, [
      'champion',
      'baseline',
      'current value',
      'current config',
    ]) || championValues.some((value) => value.length > 0 && rationale.includes(value));
  if (!referencesChampion) {
    scorePenalty(
      result,
      'missing_champion_baseline_reference',
      16,
      'Rationale must reference current champion or baseline values.',
    );
  }

  const referencesMatrix = textIncludesAny(rationale, [
    'matrix',
    'primary',
    'shadow',
    'promote',
    'hold',
    'gate',
    'roi',
    'drawdown',
    'profit factor',
    'trade count',
  ]);
  if (latestBlocker && !referencesMatrix) {
    scorePenalty(
      result,
      'missing_matrix_blocker_reference',
      18,
      'Rationale must target latest matrix blocker or primary/shadow tradeoff.',
    );
  }

  const referencesNovelty = textIncludesAny(rationale, [
    'avoid',
    'recent',
    'duplicate',
    'rejected',
    'novel',
    'previous',
    'fingerprint',
  ]);
  if ((memory?.recentCandidates?.length ?? 0) > 0 && !referencesNovelty) {
    result.notes.push(
      'Rationale should explain how it avoids recent failed or duplicate candidates.',
    );
  }

  if (String(rationale).length < 140) {
    scorePenalty(
      result,
      'rationale_too_short_for_research_quality',
      10,
      'Rationale too short to be evidence-bound research hypothesis.',
    );
  }

  result.score = Math.max(0, Math.round(result.score));
  result.ok = result.score >= minScore && result.flags.length === 0;
  return result;
}

export function buildQualityFeedbackPrompt(basePrompt, { quality, candidate } = {}) {
  return [
    String(basePrompt ?? ''),
    '',
    'Previous candidate passed JSON schema but failed quality preflight.',
    `Quality score: ${quality?.score ?? 'unknown'}`,
    `Flags: ${(quality?.flags ?? []).join(', ') || 'none'}`,
    `Notes: ${(quality?.notes ?? []).join(' ') || 'none'}`,
    `Rejected candidate preview: ${JSON.stringify(candidate ?? {}).slice(0, 1000)}`,
    '',
    'Revise candidate as matrix-aware research hypothesis:',
    '- reference current champion baseline or current parameter value;',
    '- target latest matrix blocker, primary/shadow imbalance, ROI, drawdown, profit factor, or trade-count issue;',
    '- avoid repeating recent duplicate/rejected candidate families;',
    '- prefer <= 3 changed params;',
    '- do not use generic lower-threshold + higher-RR + tighter-stop logic unless matrix evidence supports it;',
    '- Return exactly one JSON object matching schema. No markdown. No prose. No code fences.',
  ].join('\n');
}
