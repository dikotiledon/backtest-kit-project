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
  return number(policy.base, 0.25) + breadth * number(policy.step, 0.05);
}

export function computeCandidateUtility(metrics = {}, { multipleTestingPenalty = 0, complexityPenalty = 0, robustnessBonus = 0, targetRegimeImprovement = 0 } = {}) {
  const roiComponent = number(metrics.roiPct) * 1.0;
  const expectancyComponent = number(metrics.expectancy) * 25;
  const profitFactorComponent = Math.min(number(metrics.profitFactor), 10) * 8;
  const drawdownPenalty = number(metrics.maxDrawdownPct) * 3;
  const tradeCountComponent = Math.log10(Math.max(1, number(metrics.tradeCount))) * 5;
  const winRateDiagnostic = Math.min(number(metrics.winRatePct), 100) * 0.05;
  const utility = roiComponent + expectancyComponent + profitFactorComponent - drawdownPenalty + tradeCountComponent + robustnessBonus + targetRegimeImprovement + winRateDiagnostic - complexityPenalty - multipleTestingPenalty;
  return { utility, components: { roiComponent, expectancyComponent, profitFactorComponent, drawdownPenalty, tradeCountComponent, winRateDiagnostic, robustnessBonus, targetRegimeImprovement, complexityPenalty, multipleTestingPenalty } };
}

export function evaluateObjectiveGates({ incumbent = {}, candidate = {}, policy = {} } = {}) {
  const failedGates = [];
  const roiPct = number(candidate.roiPct);
  const expectancyDelta = number(candidate.expectancy) - number(incumbent.expectancy);
  const drawdownDeltaPct = number(candidate.maxDrawdownPct) - number(incumbent.maxDrawdownPct);
  const tradeRatioVsIncumbent = number(candidate.tradeCount) / Math.max(1, number(incumbent.tradeCount));

  if (roiPct < number(policy.minRoiPct, 25)) failedGates.push('roiFloor');
  if (expectancyDelta < number(policy.minExpectancyDelta, 0)) failedGates.push('expectancyRegression');
  if (drawdownDeltaPct > number(policy.maxDrawdownDeltaPct, 0.75)) failedGates.push('drawdownRegression');
  if (tradeRatioVsIncumbent < number(policy.minTradeRatioVsIncumbent, 0.8)) failedGates.push('tradeCountRegression');

  return { pass: failedGates.length === 0, failedGates, comparisons: { expectancyDelta, drawdownDeltaPct, tradeRatioVsIncumbent, roiPct } };
}
