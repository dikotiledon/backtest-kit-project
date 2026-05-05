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
});

test('isRegimeExitResearchEnabled requires top-level flag', () => {
  assert.equal(isRegimeExitResearchEnabled(normalizeRegimeExitResearchConfig({ enabled: false })), false);
  assert.equal(isRegimeExitResearchEnabled(normalizeRegimeExitResearchConfig({ enabled: true })), true);
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
