function number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function computeMultipleTestingPenalty(context = {}, policy = {}) {
  const attempted = Math.max(1, number(context.attemptedCandidates, 1));
  const breadth =
    Math.log2(attempted) +
    Math.max(0, number(context.mutationFamilyCount, 0) - 1) +
    Math.max(0, number(context.regimeSliceCount, 0) - 1) +
    Math.max(0, number(context.exitFamilyCount, 0) - 1);
  const base = Math.max(0, number(policy.base, 0.25));
  const step = Math.max(0, number(policy.step, 0.05));
  return Math.max(0, base + breadth * step);
}

export function computeCandidateUtility(metrics = {}, { multipleTestingPenalty = 0, complexityPenalty = 0, robustnessBonus = 0, targetRegimeImprovement = 0 } = {}) {
  const roiPct = number(metrics.roiPct, 0);
  const expectancy = number(metrics.expectancy, 0);
  const profitFactor = Math.min(10, Math.max(0, number(metrics.profitFactor, 0)));
  const maxDrawdownPct = Math.max(0, number(metrics.maxDrawdownPct, 0));
  const tradeCount = Math.max(0, number(metrics.tradeCount, 0));
  const winRatePct = Math.min(100, Math.max(0, number(metrics.winRatePct, 0)));

  const roiComponent = roiPct * 1.0;
  const expectancyComponent = expectancy * 25;
  const profitFactorComponent = profitFactor * 8;
  const drawdownPenalty = maxDrawdownPct * 3;
  const tradeCountComponent = Math.log10(Math.max(1, tradeCount)) * 5;
  const winRateDiagnostic = winRatePct * 0.05;
  const utility = roiComponent + expectancyComponent + profitFactorComponent - drawdownPenalty + tradeCountComponent + robustnessBonus + targetRegimeImprovement + winRateDiagnostic - complexityPenalty - multipleTestingPenalty;
  return { utility, components: { roiComponent, expectancyComponent, profitFactorComponent, drawdownPenalty, tradeCountComponent, winRateDiagnostic, robustnessBonus, targetRegimeImprovement, complexityPenalty, multipleTestingPenalty } };
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