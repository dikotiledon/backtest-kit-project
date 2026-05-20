import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateDataQualityGate,
  evaluateWalkForwardGate,
  evaluatePromotionSignificance,
  loadAndMigrateConfig,
} from '../scripts/lib/pine-autoresearch.mjs';

describe('evaluateDataQualityGate', () => {
  it('skips when flag disabled', () => {
    const rows = [{ timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 90, Low: 98, Close: 103 }];
    const result = evaluateDataQualityGate(rows, {
      featureFlags: { USE_DATA_QUALITY_GATE: false },
      timeframeMinutes: 15,
    });
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
  });

  it('rejects critical quality issues when flag enabled', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      Open: 100, High: 90, Low: 98, Close: 103,
    }));
    const result = evaluateDataQualityGate(rows, {
      featureFlags: { USE_DATA_QUALITY_GATE: true },
      timeframeMinutes: 15,
    });
    assert.equal(result.passed, false);
    assert.equal(result.severity, 'critical');
  });

  it('passes clean dataset', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      Open: 100, High: 105, Low: 98, Close: 103,
    }));
    const result = evaluateDataQualityGate(rows, {
      featureFlags: { USE_DATA_QUALITY_GATE: true },
      timeframeMinutes: 15,
    });
    assert.equal(result.passed, true);
  });
});

describe('evaluateWalkForwardGate', () => {
  it('skips when flag disabled', () => {
    const result = evaluateWalkForwardGate({ walkForwardEfficiency: 0.1, avgDegradationPct: -80 }, {
      featureFlags: { USE_WALK_FORWARD_GATE: false },
    });
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
  });

  it('fails when efficiency below threshold', () => {
    const result = evaluateWalkForwardGate(
      { walkForwardEfficiency: 0.3, avgDegradationPct: -70, foldCount: 5 },
      { featureFlags: { USE_WALK_FORWARD_GATE: true }, policy: { minEfficiency: 0.5, maxDegradationPct: -50 } },
    );
    assert.equal(result.passed, false);
    assert.ok(result.failedGates.includes('efficiency'));
  });

  it('passes healthy walk-forward', () => {
    const result = evaluateWalkForwardGate(
      { walkForwardEfficiency: 0.75, avgDegradationPct: -20, foldCount: 5 },
      { featureFlags: { USE_WALK_FORWARD_GATE: true }, policy: { minEfficiency: 0.5, maxDegradationPct: -50 } },
    );
    assert.equal(result.passed, true);
  });

  it('fails when no walk-forward data', () => {
    const result = evaluateWalkForwardGate(null, {
      featureFlags: { USE_WALK_FORWARD_GATE: true },
    });
    assert.equal(result.passed, false);
    assert.equal(result.reason, 'no_walk_forward_data');
  });
});

describe('evaluatePromotionSignificance', () => {
  it('uses statistical mode when flag enabled and returns available', () => {
    const incumbent = {
      score: 50, metrics: { tradeCount: 100 },
      tradeReturns: Array.from({ length: 100 }, (_, i) => 0.1 + (i % 10) * 0.01),
    };
    const challenger = {
      score: 55, metrics: { tradeCount: 100 },
      tradeReturns: Array.from({ length: 100 }, (_, i) => 0.5 + (i % 10) * 0.01),
    };
    const result = evaluatePromotionSignificance(incumbent, challenger, {
      featureFlags: { USE_STATISTICAL_SIGNIFICANCE: true },
      policy: { minTradeCount: 20, seed: 42 },
    });
    assert.equal(result.mode, 'statistical');
    assert.equal(result.passed, true);
  });

  it('falls back to legacy when flag disabled', () => {
    const incumbent = { score: 50, metrics: { tradeCount: 100 } };
    const challenger = { score: 55, metrics: { tradeCount: 100 } };
    const result = evaluatePromotionSignificance(incumbent, challenger, {
      featureFlags: { USE_STATISTICAL_SIGNIFICANCE: false },
      policy: { minRelativeScoreDelta: 0.02, minTradeCount: 100 },
    });
    assert.equal(result.mode, 'legacy');
    assert.equal(result.passed, true);
  });
});

describe('loadAndMigrateConfig', () => {
  it('migrates v1 config to v2', () => {
    const v1 = {
      matrixId: 'test',
      searchPolicy: {
        annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.8, maxTemperature: 16 },
        tabuPolicy: { maxAgeCycles: 20, maxEntries: 40, dropOnChampionChange: true },
      },
      autoPromotion: { enabled: true, cooldownHours: 12, maxPromotionsPerDay: 2 },
    };
    const loaded = loadAndMigrateConfig(v1);
    assert.equal(loaded.configVersion, 2);
    assert.equal(loaded.searchPolicy.annealing.maxTemperature, 4);
    assert.ok(loaded.featureFlags);
  });

  it('leaves v2 config unchanged', () => {
    const v2 = { configVersion: 2, matrixId: 'test', featureFlags: { USE_COST_MODEL: true } };
    const loaded = loadAndMigrateConfig(v2);
    assert.deepEqual(loaded, v2);
  });
});
