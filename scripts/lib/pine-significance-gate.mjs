const DEFAULT_MIN_RELATIVE_SCORE_DELTA = 0.02;
const DEFAULT_MIN_TRADE_COUNT = 150;
const SCORE_DENOMINATOR_FLOOR = 1e-6;

function finiteNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteNonnegativeOrDefault(value, fallback) {
  const parsed = finiteNumberOrNull(value);
  return parsed != null && parsed >= 0 ? parsed : fallback;
}

function minTradeCountFromPolicy(policy) {
  const parsed = finiteNumberOrNull(policy?.minTradeCount);
  const floored = parsed == null ? DEFAULT_MIN_TRADE_COUNT : Math.floor(parsed);
  return Math.max(1, floored);
}

function scoreFromResult(result) {
  return finiteNumberOrNull(result?.score ?? result?.metrics?.score);
}

function tradeCountFromResult(result) {
  return finiteNumberOrNull(result?.metrics?.tradeCount ?? result?.tradeCount);
}

export function decideSignificanceGate({ incumbent = {}, challenger = {}, policy = {} } = {}) {
  const incumbentScore = scoreFromResult(incumbent);
  const challengerScore = scoreFromResult(challenger);

  if (incumbentScore == null || challengerScore == null) {
    return {
      passed: false,
      reason: 'missing_score',
      relativeScoreDelta: null,
    };
  }

  const minRelativeScoreDelta = finiteNonnegativeOrDefault(
    policy?.minRelativeScoreDelta,
    DEFAULT_MIN_RELATIVE_SCORE_DELTA,
  );
  const minTradeCount = minTradeCountFromPolicy(policy);
  const challengerTradeCount = tradeCountFromResult(challenger);

  if (challengerTradeCount == null || challengerTradeCount < minTradeCount) {
    return {
      passed: false,
      reason: 'insufficient_sample',
      relativeScoreDelta: null,
      challengerTradeCount,
      minTradeCount,
    };
  }

  const rawRelativeScoreDelta = (challengerScore - incumbentScore) / Math.max(Math.abs(incumbentScore), SCORE_DENOMINATOR_FLOOR);
  const relativeScoreDelta = round(rawRelativeScoreDelta, 4);

  if (rawRelativeScoreDelta < minRelativeScoreDelta) {
    return {
      passed: false,
      reason: 'score_delta_below_floor',
      relativeScoreDelta,
      minRelativeScoreDelta,
    };
  }

  const incumbentTradeCount = tradeCountFromResult(incumbent);
  if (incumbentTradeCount != null && incumbentTradeCount > 0) {
    const tradeRatio = challengerTradeCount / incumbentTradeCount;
    const driftAdjustedFloor = minRelativeScoreDelta * 2;
    if (tradeRatio < 0.9 && rawRelativeScoreDelta < driftAdjustedFloor) {
      return {
        passed: false,
        reason: 'trade_count_drift_requires_larger_delta',
        relativeScoreDelta,
        minRelativeScoreDelta: driftAdjustedFloor,
        tradeRatio: round(tradeRatio, 3),
      };
    }
  }

  return {
    passed: true,
    reason: 'significant',
    relativeScoreDelta,
    minRelativeScoreDelta,
  };
}
