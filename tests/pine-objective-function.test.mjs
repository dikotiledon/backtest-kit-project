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
  assert.equal(Number.isFinite(result.components.baseScore), true);
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

  // scoreMetrics handles clamping internally; just verify finite output
  assert.equal(Number.isFinite(result.utility), true);
  assert.equal(Number.isFinite(result.components.baseScore), true);
});

// === Task 12+13 Tests ===

import { describe, it } from 'node:test';

describe('scoring unification (Task 12)', () => {
  it('computeCandidateUtility uses scoreMetrics as base when no adjustments', () => {
    const metrics = { roiPct: 30, winRatePct: 55, profitFactor: 1.8, maxDrawdownPct: 10, tradeCount: 150, expectancy: 0.3 };
    const { utility, components } = computeCandidateUtility(metrics);
    assert.ok(Number.isFinite(components.baseScore));
    assert.equal(utility, components.baseScore); // no adjustments = utility equals base
  });

  it('adjustments modify utility relative to base', () => {
    const metrics = { roiPct: 30, winRatePct: 55, profitFactor: 1.8, maxDrawdownPct: 10, tradeCount: 150, expectancy: 0.3 };
    const { utility: base } = computeCandidateUtility(metrics);
    const { utility: adjusted } = computeCandidateUtility(metrics, {
      robustnessBonus: 5,
      multipleTestingPenalty: 3,
    });
    assert.equal(adjusted, base + 5 - 3);
  });

  it('higher ROI candidate gets higher utility', () => {
    const metricsA = { roiPct: 20, winRatePct: 55, profitFactor: 1.5, maxDrawdownPct: 10, tradeCount: 150 };
    const metricsB = { roiPct: 40, winRatePct: 55, profitFactor: 1.5, maxDrawdownPct: 10, tradeCount: 150 };
    const { utility: utilA } = computeCandidateUtility(metricsA);
    const { utility: utilB } = computeCandidateUtility(metricsB);
    assert.ok(utilB > utilA, `higher ROI should give higher utility: ${utilB} vs ${utilA}`);
  });
});

describe('computeMultipleTestingPenalty v2 (Task 13)', () => {
  it('penalty at 100 candidates with 5 families is meaningful', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 100, mutationFamilyCount: 5, regimeSliceCount: 1, exitFamilyCount: 3 },
      { base: 1.0, step: 0.3 },
    );
    // log2(100) = 6.64, familyBreadth = (5-1)+(1-1)+(3-1) = 6
    // penalty = 1.0 + (6.64 + 6) * 0.3 = 4.79
    assert.ok(penalty >= 4, `penalty ${penalty} should be >= 4`);
    assert.ok(penalty <= 6, `penalty ${penalty} should be <= 6`);
  });

  it('penalty at 500 candidates with 8 families is substantial', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 500, mutationFamilyCount: 8, regimeSliceCount: 3, exitFamilyCount: 5 },
      { base: 1.0, step: 0.3 },
    );
    // log2(500) = 8.97, familyBreadth = (8-1)+(3-1)+(5-1) = 13
    // penalty = 1.0 + (8.97 + 13) * 0.3 = 7.59
    assert.ok(penalty >= 7, `penalty ${penalty} should be >= 7`);
    assert.ok(penalty <= 9, `penalty ${penalty} should be <= 9`);
  });

  it('penalty at 1 candidate is minimal', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 1, mutationFamilyCount: 1, regimeSliceCount: 1, exitFamilyCount: 1 },
      { base: 1.0, step: 0.3 },
    );
    // log2(1) = 0, familyBreadth = 0
    // penalty = 1.0
    assert.ok(penalty >= 1);
    assert.ok(penalty <= 1.5);
  });

  it('uses new defaults (base 1.0, step 0.3) when no policy provided', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 100, mutationFamilyCount: 3, regimeSliceCount: 1, exitFamilyCount: 2 },
    );
    // With new defaults: base=1.0, step=0.3
    // log2(100)=6.64, familyBreadth=(3-1)+(1-1)+(2-1)=3
    // penalty = 1.0 + (6.64+3)*0.3 = 3.89
    assert.ok(penalty >= 3, `penalty ${penalty} should be >= 3 with new defaults`);
  });
});
