import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRegimeExitResearchConfig,
  isRegimeExitResearchEnabled,
} from '../scripts/lib/pine-regime-exit-config.mjs';

test('normalizeRegimeExitResearchConfig defaults to safe disabled mode', () => {
  const config = normalizeRegimeExitResearchConfig({});

  assert.equal(config.enabled, false);
  assert.equal(config.offline.mode, 'offline-strict');
  assert.equal(config.lanes.exploitRatio, 0.25);
  assert.equal(config.lanes.exitRegimeRatio, 0.35);
  assert.equal(config.lanes.globalAllParameterRatio, 0.25);
  assert.equal(config.lanes.robustnessRatio, 0.15);
  assert.equal(config.resource.maxManifestBytes > 0, true);
  assert.equal(config.resource.maxConcurrentLabWorkers >= 1, true);
  assert.equal(config.resourceBudget.maxRowsPerAnalysisChunk, 5000);
  assert.equal(config.resourceBudget.maxRetainedCandidatesPerLane, 25);
  assert.equal(config.resourceBudget.writeFullDebugArtifacts, false);
  assert.equal(config.promotion.allowAutomaticRegimeSwitching, false);
  assert.equal(config.promotion.requireGlobalChampionAnchor, true);
});

test('isRegimeExitResearchEnabled requires strict boolean true', () => {
  assert.equal(isRegimeExitResearchEnabled(normalizeRegimeExitResearchConfig({ enabled: false })), false);
  assert.equal(isRegimeExitResearchEnabled(normalizeRegimeExitResearchConfig({ enabled: true })), true);
  assert.equal(isRegimeExitResearchEnabled({ enabled: 'true' }), false);
  assert.equal(isRegimeExitResearchEnabled({ enabled: 'false' }), false);
});

test('normalizeRegimeExitResearchConfig clamps invalid ratios and caps', () => {
  const config = normalizeRegimeExitResearchConfig({
    enabled: true,
    lanes: {
      exploitRatio: -1,
      exitRegimeRatio: 99,
      globalAllParameterRatio: Number.NaN,
      robustnessRatio: 0,
    },
    resource: {
      maxConcurrentLabWorkers: 0,
      maxManifestBytes: -10,
    },
  });

  const total = config.lanes.exploitRatio + config.lanes.exitRegimeRatio + config.lanes.globalAllParameterRatio + config.lanes.robustnessRatio;
  assert.equal(Math.abs(total - 1) < 0.000001, true);
  assert.equal(config.resource.maxConcurrentLabWorkers, 1);
  assert.equal(config.resource.maxManifestBytes >= 16384, true);
});

test('normalizeRegimeExitResearchConfig falls back invalid offline mode', () => {
  const config = normalizeRegimeExitResearchConfig({
    offline: { mode: 'bad-mode' },
  });

  assert.equal(config.offline.mode, 'offline-strict');
});

test('normalizeRegimeExitResearchConfig defaults subflags true when omitted', () => {
  const config = normalizeRegimeExitResearchConfig({ enabled: true });

  assert.equal(config.exploitEnabled, true);
  assert.equal(config.exitRegimeEnabled, true);
  assert.equal(config.globalAllParameterEnabled, true);
  assert.equal(config.robustnessLadderEnabled, true);
  assert.equal(config.streamingMetricsEnabled, true);
  assert.equal(config.childWorkerIsolationEnabled, true);
});

test('normalizeRegimeExitResearchConfig preserves explicit false subflags', () => {
  const config = normalizeRegimeExitResearchConfig({
    exploitEnabled: false,
    exitRegimeEnabled: false,
    globalAllParameterEnabled: false,
    robustnessLadderEnabled: false,
    streamingMetricsEnabled: false,
    childWorkerIsolationEnabled: false,
  });

  assert.equal(config.exploitEnabled, false);
  assert.equal(config.exitRegimeEnabled, false);
  assert.equal(config.globalAllParameterEnabled, false);
  assert.equal(config.robustnessLadderEnabled, false);
  assert.equal(config.streamingMetricsEnabled, false);
  assert.equal(config.childWorkerIsolationEnabled, false);
});

test('normalizeRegimeExitResearchConfig enables only for boolean true', () => {
  const cases = [
    { value: true, expected: true },
    { value: 'true', expected: false },
    { value: 'false', expected: false },
    { value: 1, expected: false },
    { value: 0, expected: false },
    { value: undefined, expected: false },
  ];

  for (const { value, expected } of cases) {
    const config = normalizeRegimeExitResearchConfig({ enabled: value });
    assert.equal(config.enabled, expected);
    assert.equal(isRegimeExitResearchEnabled(config), expected);
  }
});

test('normalizeRegimeExitResearchConfig allows emergency reduced matrix only for boolean true', () => {
  const cases = [
    { value: true, expected: true },
    { value: 'true', expected: false },
    { value: 'false', expected: false },
    { value: 1, expected: false },
    { value: 0, expected: false },
    { value: undefined, expected: false },
  ];

  for (const { value, expected } of cases) {
    const config = normalizeRegimeExitResearchConfig({
      offline: { allowEmergencyReducedMatrix: value },
    });
    assert.equal(config.offline.allowEmergencyReducedMatrix, expected);
  }
});

test('normalizeRegimeExitResearchConfig supports budget/resourceBudget aliases', () => {
  const config = normalizeRegimeExitResearchConfig({
    budget: {
      exploitRatio: 5,
      exitRegimeRatio: 1,
      globalAllParameterRatio: 1,
      robustnessRatio: 1,
    },
    resourceBudget: {
      maxConcurrentLabWorkers: 2,
      maxRowsPerAnalysisChunk: 7000,
      maxRetainedCandidatesPerLane: 30,
      writeFullDebugArtifacts: true,
    },
    promotion: {
      allowAutomaticRegimeSwitching: true,
      requireGlobalChampionAnchor: false,
    },
  });

  assert.equal(config.resourceBudget.maxConcurrentLabWorkers, 2);
  assert.equal(config.resourceBudget.maxRowsPerAnalysisChunk, 7000);
  assert.equal(config.resourceBudget.maxRetainedCandidatesPerLane, 30);
  assert.equal(config.resourceBudget.writeFullDebugArtifacts, true);
  assert.equal(config.promotion.allowAutomaticRegimeSwitching, true);
  assert.equal(config.promotion.requireGlobalChampionAnchor, false);
  const budgetSum = config.budget.exploitRatio + config.budget.exitRegimeRatio + config.budget.globalAllParameterRatio + config.budget.robustnessRatio;
  assert.equal(Math.abs(budgetSum - 1) < 0.000001, true);
});
