import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allocateRegimeExitLaneBudget,
  selectNextResearchLane,
  STAGNATION_LANE_METADATA,
} from '../scripts/lib/pine-regime-exit-scheduler.mjs';

const sumBudget = (budget) => Object.values(budget).reduce((sum, value) => sum + value, 0);

test('allocateRegimeExitLaneBudget preserves default 20-config plan', () => {
  const budget = allocateRegimeExitLaneBudget({
    maxConfigs: 20,
    lanes: {
      exploitRatio: 0.25,
      exitRegimeRatio: 0.35,
      globalAllParameterRatio: 0.25,
      robustnessRatio: 0.15,
    },
  });

  assert.deepEqual(budget, { exploit: 5, exitRegime: 7, globalAllParameter: 5, robustness: 3 });
});

test('allocateRegimeExitLaneBudget normalizes maxConfigs and handles edge values', () => {
  assert.deepEqual(
    allocateRegimeExitLaneBudget({ maxConfigs: 0, lanes: DEFAULT_LANES() }),
    { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 0 },
  );

  assert.deepEqual(
    allocateRegimeExitLaneBudget({ maxConfigs: -10, lanes: DEFAULT_LANES() }),
    { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 0 },
  );

  assert.deepEqual(
    allocateRegimeExitLaneBudget({ maxConfigs: Number.NaN, lanes: DEFAULT_LANES() }),
    { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 0 },
  );

  const budgetFromString = allocateRegimeExitLaneBudget({ maxConfigs: '10', lanes: DEFAULT_LANES() });
  assert.equal(sumBudget(budgetFromString), 10);
});

test('allocateRegimeExitLaneBudget normalizes ratios when ratio sum > 1 and keeps invariant', () => {
  const budget = allocateRegimeExitLaneBudget({
    maxConfigs: 10,
    lanes: {
      exploitRatio: 0.5,
      exitRegimeRatio: 0.5,
      globalAllParameterRatio: 0.5,
      robustnessRatio: 0.5,
    },
  });

  assert.deepEqual(budget, { exploit: 3, exitRegime: 3, globalAllParameter: 2, robustness: 2 });
  assert.equal(sumBudget(budget), 10);
});

test('allocateRegimeExitLaneBudget clamps negative and NaN ratios and never returns negative budgets', () => {
  const budget = allocateRegimeExitLaneBudget({
    maxConfigs: 10,
    lanes: {
      exploitRatio: -2,
      exitRegimeRatio: Number.NaN,
      globalAllParameterRatio: 2,
      robustnessRatio: -0.5,
    },
  });

  assert.deepEqual(budget, { exploit: 0, exitRegime: 0, globalAllParameter: 10, robustness: 0 });
  assert.ok(Object.values(budget).every((value) => value >= 0));
  assert.equal(sumBudget(budget), 10);
});

test('allocateRegimeExitLaneBudget falls back to default ratios when all ratios invalid/non-positive', () => {
  const budget = allocateRegimeExitLaneBudget({
    maxConfigs: 20,
    lanes: {
      exploitRatio: Number.NaN,
      exitRegimeRatio: -1,
      globalAllParameterRatio: Number.NEGATIVE_INFINITY,
      robustnessRatio: -5,
    },
  });

  assert.deepEqual(budget, { exploit: 5, exitRegime: 7, globalAllParameter: 5, robustness: 3 });
  assert.equal(sumBudget(budget), 20);
});

test('stagnation metadata strictPromotionGates only enabled at level 3', () => {
  assert.equal(STAGNATION_LANE_METADATA[0].strictPromotionGates, false);
  assert.equal(STAGNATION_LANE_METADATA[1].strictPromotionGates, false);
  assert.equal(STAGNATION_LANE_METADATA[2].strictPromotionGates, false);
  assert.equal(STAGNATION_LANE_METADATA[3].strictPromotionGates, true);
});

test('selectNextResearchLane uses stagnation preferences as zero-debt tie breakers 0/1/2/3', () => {
  const lanesEnabled = { exploit: true, exitRegime: true, globalAllParameter: true, robustness: true };
  const budgetDebt = { exploit: 0, exitRegime: 0, globalAllParameter: 0, robustness: 0 };

  assert.equal(selectNextResearchLane({ stagnationLevel: 0, budgetDebt, lanesEnabled }), 'exitRegime');
  assert.equal(selectNextResearchLane({ stagnationLevel: 1, budgetDebt, lanesEnabled }), 'globalAllParameter');
  assert.equal(selectNextResearchLane({ stagnationLevel: 2, budgetDebt, lanesEnabled }), 'globalAllParameter');
  assert.equal(selectNextResearchLane({ stagnationLevel: 3, budgetDebt, lanesEnabled }), 'globalAllParameter');
});

test('selectNextResearchLane pays highest budget debt before preferred stagnation lane', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: {
      exploit: 0,
      exitRegime: 0,
      globalAllParameter: 9,
      robustness: 2,
    },
    lanesEnabled: {
      exploit: true,
      exitRegime: true,
      globalAllParameter: true,
      robustness: true,
    },
  });

  assert.equal(lane, 'globalAllParameter');
});

test('selectNextResearchLane ignores non-finite budget debt values', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: {
      exploit: 0,
      exitRegime: Number.NaN,
      globalAllParameter: 9,
      robustness: Number.POSITIVE_INFINITY,
    },
    lanesEnabled: {
      exploit: true,
      exitRegime: true,
      globalAllParameter: true,
      robustness: true,
    },
  });

  assert.equal(lane, 'globalAllParameter');
});

test('selectNextResearchLane uses preferred lane as tie-breaker after debt', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: {
      exploit: 0,
      exitRegime: 0,
      globalAllParameter: 0,
      robustness: 0,
    },
    lanesEnabled: {
      exploit: true,
      exitRegime: true,
      globalAllParameter: true,
      robustness: true,
    },
  });

  assert.equal(lane, 'exitRegime');
});

test('selectNextResearchLane preferred disabled fallback deterministic', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: { exploit: 1, robustness: 2 },
    lanesEnabled: { exploit: true, exitRegime: false, globalAllParameter: false, robustness: true },
  });

  assert.equal(lane, 'robustness');
});

test('selectNextResearchLane returns null when all lanes disabled', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 3,
    budgetDebt: { exploit: 10, exitRegime: 10, globalAllParameter: 10, robustness: 10 },
    lanesEnabled: { exploit: false, exitRegime: false, globalAllParameter: false, robustness: false },
  });

  assert.equal(lane, null);
});

test('selectNextResearchLane debt priority wins when preferred lane unavailable', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 0,
    budgetDebt: { exploit: 50, robustness: 1, globalAllParameter: 10 },
    lanesEnabled: { exploit: true, exitRegime: false, globalAllParameter: true, robustness: true },
  });

  assert.equal(lane, 'exploit');
});

test('selectNextResearchLane tie-break deterministic by lane priority', () => {
  const lane = selectNextResearchLane({
    stagnationLevel: 3,
    budgetDebt: { exploit: 7, exitRegime: 7, globalAllParameter: 7, robustness: 7 },
    lanesEnabled: { exploit: true, exitRegime: true, globalAllParameter: false, robustness: true },
  });

  assert.equal(lane, 'exitRegime');
});

function DEFAULT_LANES() {
  return {
    exploitRatio: 0.25,
    exitRegimeRatio: 0.35,
    globalAllParameterRatio: 0.25,
    robustnessRatio: 0.15,
  };
}
