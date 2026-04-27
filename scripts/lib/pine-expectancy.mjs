function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeWinRate(winRatePct) {
  if (!Number.isFinite(winRatePct)) return 0;
  return winRatePct > 1 ? winRatePct / 100 : winRatePct;
}

export function computeExpectancy({ winRatePct = 0, avgWin = 0, avgLoss = 0 } = {}) {
  const winRate = normalizeWinRate(winRatePct);
  const lossRate = Math.max(0, 1 - winRate);
  const expectancy = (winRate * Math.max(0, avgWin)) - (lossRate * Math.max(0, avgLoss));

  return {
    winRatePct: round(winRate * 100, 4),
    avgWin: round(avgWin, 4),
    avgLoss: round(avgLoss, 4),
    expectancy: round(expectancy, 4),
  };
}

export function evaluateExpectancyGuard({
  champion = null,
  challenger = null,
  wrJumpDiagnosticThreshold = 8,
  policy = {},
} = {}) {
  const championExpectancy = computeExpectancy(champion || {});
  const challengerExpectancy = computeExpectancy(challenger || {});
  const winRateDeltaPct = round((challengerExpectancy.winRatePct ?? 0) - (championExpectancy.winRatePct ?? 0), 4);
  const avgWinDelta = round((challengerExpectancy.avgWin ?? 0) - (championExpectancy.avgWin ?? 0), 4);
  const avgLossDelta = round((challengerExpectancy.avgLoss ?? 0) - (championExpectancy.avgLoss ?? 0), 4);
  const expectancyDelta = round((challengerExpectancy.expectancy ?? 0) - (championExpectancy.expectancy ?? 0), 4);

  const hasInputs = [
    championExpectancy.winRatePct,
    championExpectancy.avgWin,
    championExpectancy.avgLoss,
    challengerExpectancy.winRatePct,
    challengerExpectancy.avgWin,
    challengerExpectancy.avgLoss,
  ].every((value) => Number.isFinite(value));

  const wrDecompositionRequired = Math.abs(winRateDeltaPct) > wrJumpDiagnosticThreshold;
  const rejectWrGainAvgWinLoss = policy.rejectWrGainAvgWinLoss !== false;
  const requireExpectancyNonRegression = policy.requireExpectancyNonRegression !== false;
  const avgWinCompressedOnGain = winRateDeltaPct > 0 && challengerExpectancy.avgWin < championExpectancy.avgWin;
  const avgLossExpandedOnGain = winRateDeltaPct > 0 && challengerExpectancy.avgLoss > championExpectancy.avgLoss;
  const expectancyRegressed = challengerExpectancy.expectancy < championExpectancy.expectancy;

  const gates = {
    hasInputs,
    avgWinCompression: !avgWinCompressedOnGain,
    avgLossExpansion: !avgLossExpandedOnGain,
    expectancyNonRegression: !expectancyRegressed,
  };

  const failedGates = [];
  if (!hasInputs) failedGates.push('hasInputs');
  if (rejectWrGainAvgWinLoss && avgWinCompressedOnGain) failedGates.push('avgWinCompression');
  if (rejectWrGainAvgWinLoss && avgLossExpandedOnGain) failedGates.push('avgLossExpansion');
  if (requireExpectancyNonRegression && expectancyRegressed) failedGates.push('expectancyNonRegression');

  const passed = failedGates.length === 0;
  const summary = passed
    ? `Expectancy gate passed: challenger expectancy ${challengerExpectancy.expectancy} vs champion ${championExpectancy.expectancy}.`
    : `Expectancy gate failed: ${failedGates.join(', ')}.`;

  return {
    passed,
    recommendation: passed ? 'promote' : 'hold',
    summary,
    failedGates,
    champion: championExpectancy,
    challenger: challengerExpectancy,
    comparisons: {
      winRateDeltaPct,
      avgWinDelta,
      avgLossDelta,
      expectancyDelta,
    },
    gates,
    diagnostics: {
      wrJumpDiagnosticThreshold,
      wrDecompositionRequired,
      rejectWrGainAvgWinLoss,
      requireExpectancyNonRegression,
      avgWinCompressedOnGain,
      avgLossExpandedOnGain,
      expectancyRegressed,
    },
  };
}
