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
