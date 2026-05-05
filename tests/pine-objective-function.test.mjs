import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeMultipleTestingPenalty,
  computeCandidateUtility,
  evaluateObjectiveGates,
} from '../scripts/lib/pine-objective-function.mjs';

test('computeMultipleTestingPenalty increases with search breadth', () => {
  const small = computeMultipleTestingPenalty({ attemptedCandidates: 4, mutationFamilyCount: 1, regimeSliceCount: 1, exitFamilyCount: 1 }, { base: 0.25, step: 0.05 });
  const wide = computeMultipleTestingPenalty({ attemptedCandidates: 64, mutationFamilyCount: 6, regimeSliceCount: 4, exitFamilyCount: 5 }, { base: 0.25, step: 0.05 });

  assert.equal(wide > small, true);
});

test('computeMultipleTestingPenalty clamps negative policy and stays monotonic', () => {
  const small = computeMultipleTestingPenalty(
    { attemptedCandidates: 4, mutationFamilyCount: 1, regimeSliceCount: 1, exitFamilyCount: 1 },
    { base: -1, step: -0.5 },
  );
  const wide = computeMultipleTestingPenalty(
    { attemptedCandidates: 64, mutationFamilyCount: 6, regimeSliceCount: 4, exitFamilyCount: 5 },
    { base: -1, step: -0.5 },
  );

  assert.equal(small >= 0, true);
  assert.equal(wide >= 0, true);
  assert.equal(wide >= small, true);
});

test('evaluateObjectiveGates rejects win-rate-only improvement with expectancy regression', () => {
  const result = evaluateObjectiveGates({
    incumbent: { roiPct: 80, winRatePct: 40, profitFactor: 3, maxDrawdownPct: 3, tradeCount: 250, expectancy: 1.2 },
    candidate: { roiPct: 50, winRatePct: 70, profitFactor: 1.2, maxDrawdownPct: 5, tradeCount: 250, expectancy: 0.5 },
    policy: { minRoiPct: 25, minExpectancyDelta: 0, maxDrawdownDeltaPct: 0.75, minTradeRatioVsIncumbent: 0.8 },
  });

  assert.equal(result.pass, false);
  assert.equal(result.failedGates.includes('expectancyRegression'), true);
  assert.equal(result.failedGates.includes('drawdownRegression'), true);
});

test('computeCandidateUtility prioritizes ROI and expectancy over win rate', () => {
  const highExpectancy = computeCandidateUtility({ roiPct: 90, expectancy: 1.5, profitFactor: 3, maxDrawdownPct: 3, tradeCount: 260, winRatePct: 42 }, { multipleTestingPenalty: 0 });
  const highWinRate = computeCandidateUtility({ roiPct: 20, expectancy: 0.3, profitFactor: 1.1, maxDrawdownPct: 8, tradeCount: 260, winRatePct: 80 }, { multipleTestingPenalty: 0 });

  assert.equal(highExpectancy.utility > highWinRate.utility, true);
});

test('computeCandidateUtility handles NaN/Infinity defensively with finite output', () => {
  const result = computeCandidateUtility({
    roiPct: Number.POSITIVE_INFINITY,
    expectancy: Number.NaN,
    profitFactor: Number.NEGATIVE_INFINITY,
    maxDrawdownPct: Number.POSITIVE_INFINITY,
    tradeCount: Number.NEGATIVE_INFINITY,
    winRatePct: Number.NaN,
  });

  assert.equal(Number.isFinite(result.utility), true);
  assert.equal(Number.isFinite(result.components.roiComponent), true);
  assert.equal(Number.isFinite(result.components.expectancyComponent), true);
  assert.equal(Number.isFinite(result.components.profitFactorComponent), true);
  assert.equal(Number.isFinite(result.components.drawdownPenalty), true);
  assert.equal(Number.isFinite(result.components.tradeCountComponent), true);
  assert.equal(Number.isFinite(result.components.winRateDiagnostic), true);
});

test('negative tradeCount does not produce NaN utility', () => {
  const result = computeCandidateUtility({
    roiPct: 10,
    expectancy: 0.2,
    profitFactor: 1.4,
    maxDrawdownPct: 5,
    tradeCount: -100,
    winRatePct: 45,
  });

  assert.equal(Number.isNaN(result.utility), false);
  assert.equal(Number.isFinite(result.utility), true);
  assert.equal(result.components.tradeCountComponent, 0);
});

test('zero incumbent trade count uses defined trade ratio behavior', () => {
  const candidateHasTrades = evaluateObjectiveGates({
    incumbent: { tradeCount: 0, roiPct: 30, expectancy: 1, maxDrawdownPct: 2 },
    candidate: { tradeCount: 10, roiPct: 30, expectancy: 1, maxDrawdownPct: 2 },
    policy: { minTradeRatioVsIncumbent: 0.8, minRoiPct: 0, minExpectancyDelta: -999, maxDrawdownDeltaPct: 999 },
  });

  const bothZero = evaluateObjectiveGates({
    incumbent: { tradeCount: 0, roiPct: 30, expectancy: 1, maxDrawdownPct: 2 },
    candidate: { tradeCount: 0, roiPct: 30, expectancy: 1, maxDrawdownPct: 2 },
    policy: { minTradeRatioVsIncumbent: 0.8, minRoiPct: 0, minExpectancyDelta: -999, maxDrawdownDeltaPct: 999 },
  });

  assert.equal(candidateHasTrades.failedGates.includes('tradeCountRegression'), false);
  assert.equal(candidateHasTrades.comparisons.tradeRatioVsIncumbent, Number.POSITIVE_INFINITY);
  assert.equal(bothZero.failedGates.includes('tradeCountRegression'), true);
  assert.equal(bothZero.comparisons.tradeRatioVsIncumbent, 0);
});

test('negative winRate/profitFactor are clamped safely', () => {
  const result = computeCandidateUtility({
    roiPct: 0,
    expectancy: 0,
    profitFactor: -2,
    maxDrawdownPct: 0,
    tradeCount: 10,
    winRatePct: -50,
  });

  assert.equal(result.components.profitFactorComponent, 0);
  assert.equal(result.components.winRateDiagnostic, 0);
  assert.equal(Number.isFinite(result.utility), true);
});
