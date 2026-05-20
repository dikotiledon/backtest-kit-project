import { scoreMetrics } from './pine-metric-core.mjs';

function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeMultipleTestingPenalty(context = {}, policy = {}) {
  const attempted = Math.max(1, number(context.attemptedCandidates, 1));
  const familyBreadth =
    Math.max(0, number(context.mutationFamilyCount, 0) - 1) +
    Math.max(0, number(context.regimeSliceCount, 0) - 1) +
    Math.max(0, number(context.exitFamilyCount, 0) - 1);

  const base = Math.max(0, number(policy.base, 1.0));
  const step = Math.max(0, number(policy.step, 0.3));

  const breadth = Math.log2(attempted) + familyBreadth;
  return Math.max(0, Number((base + breadth * step).toFixed(4)));
}

export function computeCandidateUtility(metrics = {}, adjustments = {}) {
  const {
    multipleTestingPenalty = 0,
    complexityPenalty = 0,
    robustnessBonus = 0,
    targetRegimeImprovement = 0,
  } = adjustments;

  // Sanitize metrics before scoring to handle NaN/Infinity defensively
  const sanitized = {
    roiPct: number(metrics.roiPct, 0),
    winRatePct: number(metrics.winRatePct, 0),
    profitFactor: number(metrics.profitFactor, 0),
    maxDrawdownPct: number(metrics.maxDrawdownPct, 0),
    tradeCount: number(metrics.tradeCount, 0),
  };

  const baseScore = scoreMetrics(sanitized);
  const utility = baseScore + robustnessBonus + targetRegimeImprovement - complexityPenalty - multipleTestingPenalty;

  return {
    utility,
    components: {
      baseScore,
      robustnessBonus,
      targetRegimeImprovement,
      complexityPenalty,
      multipleTestingPenalty,
    },
  };
}

export function evaluateObjectiveGates({ incumbent = {}, candidate = {}, policy = {} } = {}) {
  const failedGates = [];
  const roiPct = number(candidate.roiPct);
  const expectancyDelta = number(candidate.expectancy) - number(incumbent.expectancy);
  const drawdownDeltaPct = number(candidate.maxDrawdownPct) - number(incumbent.maxDrawdownPct);
  const candidateTradeCount = Math.max(0, number(candidate.tradeCount));
  const incumbentTradeCount = Math.max(0, number(incumbent.tradeCount));
  const tradeRatioVsIncumbent = incumbentTradeCount <= 0
    ? (candidateTradeCount > 0 ? Number.POSITIVE_INFINITY : 0)
    : candidateTradeCount / incumbentTradeCount;

  if (roiPct < number(policy.minRoiPct, 25)) failedGates.push('roiFloor');
  if (expectancyDelta < number(policy.minExpectancyDelta, 0)) failedGates.push('expectancyRegression');
  if (drawdownDeltaPct > number(policy.maxDrawdownDeltaPct, 0.75)) failedGates.push('drawdownRegression');
  if (tradeRatioVsIncumbent < number(policy.minTradeRatioVsIncumbent, 0.8)) failedGates.push('tradeCountRegression');

  return { pass: failedGates.length === 0, failedGates, comparisons: { expectancyDelta, drawdownDeltaPct, tradeRatioVsIncumbent, roiPct } };
}