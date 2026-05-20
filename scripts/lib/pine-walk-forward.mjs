// scripts/lib/pine-walk-forward.mjs

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildWalkForwardWindows({ totalBars, trainRatio = 0.7, folds = 5, stepMode = 'rolling' } = {}) {
  if (totalBars <= 0 || folds <= 0) return [];
  const windows = [];

  if (stepMode === 'anchored') {
    const testSize = Math.floor(totalBars * (1 - trainRatio) / folds);
    for (let i = 0; i < folds; i++) {
      const testEnd = totalBars - (folds - 1 - i) * testSize;
      const testStart = testEnd - testSize;
      const trainEnd = testStart;
      windows.push({
        fold: i, trainStart: 0, trainEnd, testStart,
        testEnd: Math.min(testEnd, totalBars),
      });
    }
  } else {
    const trainSize = Math.floor(totalBars * trainRatio / folds);
    const testSize = Math.floor(totalBars * (1 - trainRatio) / folds);
    const stepSize = Math.floor((totalBars - trainSize - testSize) / Math.max(1, folds - 1));

    for (let i = 0; i < folds; i++) {
      const trainStart = i * stepSize;
      const trainEnd = trainStart + trainSize;
      const testStart = trainEnd;
      const testEnd = Math.min(testStart + testSize, totalBars);
      if (testEnd <= testStart) break;
      windows.push({ fold: i, trainStart, trainEnd, testStart, testEnd });
    }
  }

  return windows;
}

export function buildRegimeAwareWindows({ totalBars, regimeSlices = [], trainRatio = 0.7, folds = 5 } = {}) {
  if (!regimeSlices || regimeSlices.length === 0) {
    return buildWalkForwardWindows({ totalBars, trainRatio, folds, stepMode: 'rolling' });
  }

  const boundaries = [0];
  for (const slice of regimeSlices) {
    if (slice.endBar > 0 && slice.endBar < totalBars && !boundaries.includes(slice.endBar)) {
      boundaries.push(slice.endBar);
    }
  }
  boundaries.push(totalBars);
  boundaries.sort((a, b) => a - b);

  if (boundaries.length - 1 >= folds) {
    const windows = [];
    const step = Math.floor((boundaries.length - 1) / folds);
    for (let i = 0; i < folds; i++) {
      const testBoundaryIdx = Math.min(i * step + step, boundaries.length - 1);
      const testStart = boundaries[Math.max(0, testBoundaryIdx - 1)];
      const testEnd = boundaries[testBoundaryIdx];
      const trainStart = 0;
      const trainEnd = testStart;
      if (trainEnd <= trainStart || testEnd <= testStart) continue;

      const regimes = regimeSlices
        .filter(s => s.startBar < testEnd && s.endBar > testStart)
        .map(s => s.regime);

      windows.push({ fold: windows.length, trainStart, trainEnd, testStart, testEnd, regimes });
    }
    return windows.length > 0 ? windows : buildWalkForwardWindows({ totalBars, trainRatio, folds, stepMode: 'rolling' });
  }

  return buildWalkForwardWindows({ totalBars, trainRatio, folds, stepMode: 'rolling' });
}

export function evaluateWalkForwardFold({ trainTrades = [], testTrades = [] } = {}) {
  const trainSum = trainTrades.reduce((s, t) => s + (t.returnPctExact ?? t.returnPct ?? 0), 0);
  const testSum = testTrades.reduce((s, t) => s + (t.returnPctExact ?? t.returnPct ?? 0), 0);

  const trainAvg = trainTrades.length > 0 ? trainSum / trainTrades.length : 0;
  const testAvg = testTrades.length > 0 ? testSum / testTrades.length : 0;

  const degradationPct = trainAvg !== 0 ? round(((testAvg - trainAvg) / Math.abs(trainAvg)) * 100) : 0;

  return {
    trainRoiPct: round(trainSum),
    testRoiPct: round(testSum),
    trainAvgReturn: round(trainAvg),
    testAvgReturn: round(testAvg),
    trainTradeCount: trainTrades.length,
    testTradeCount: testTrades.length,
    degradationPct,
  };
}

export function summarizeWalkForwardResults(folds = []) {
  if (folds.length === 0) {
    return { foldCount: 0, avgDegradationPct: 0, walkForwardEfficiency: 0 };
  }

  const avgDegradation = folds.reduce((s, f) => s + (f.degradationPct ?? 0), 0) / folds.length;

  const efficiencies = folds
    .filter(f => f.trainRoiPct !== 0)
    .map(f => f.testRoiPct / f.trainRoiPct);
  const avgEfficiency = efficiencies.length > 0
    ? efficiencies.reduce((s, e) => s + e, 0) / efficiencies.length
    : 0;

  return {
    foldCount: folds.length,
    avgDegradationPct: round(avgDegradation),
    walkForwardEfficiency: round(avgEfficiency),
    folds,
  };
}

export function isWalkForwardValid(summary, policy = {}) {
  const minEfficiency = policy.minEfficiency ?? 0.5;
  const maxDegradationPct = policy.maxDegradationPct ?? -50;
  const failedGates = [];

  if (summary.walkForwardEfficiency < minEfficiency) failedGates.push('efficiency');
  if (summary.avgDegradationPct < maxDegradationPct) failedGates.push('degradation');

  return {
    valid: failedGates.length === 0,
    failedGates,
    efficiency: summary.walkForwardEfficiency,
    degradation: summary.avgDegradationPct,
    policy: { minEfficiency, maxDegradationPct },
  };
}
