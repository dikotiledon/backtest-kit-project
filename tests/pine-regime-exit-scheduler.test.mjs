import test from 'node:test';
import assert from 'node:assert/strict';

import { allocateRegimeExitLaneBudget, selectNextResearchLane } from '../scripts/lib/pine-regime-exit-scheduler.mjs';

test('allocateRegimeExitLaneBudget honors default ratios', () => {
  const budget = allocateRegimeExitLaneBudget({ maxConfigs: 20, lanes: { exploitRatio: 0.25, exitRegimeRatio: 0.35, globalAllParameterRatio: 0.25, robustnessRatio: 0.15 } });

  assert.deepEqual(budget, { exploit: 5, exitRegime: 7, globalAllParameter: 5, robustness: 3 });
});

test('selectNextResearchLane widens global search during stagnation', () => {
  const lane = selectNextResearchLane({ stagnationLevel: 2, budgetDebt: { globalAllParameter: 0, exitRegime: 10 }, lanesEnabled: { globalAllParameter: true, exitRegime: true, exploit: true, robustness: true } });

  assert.equal(lane, 'globalAllParameter');
});
