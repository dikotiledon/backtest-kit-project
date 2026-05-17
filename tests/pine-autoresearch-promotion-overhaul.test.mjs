import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideAutoresearchOutcome } from '../scripts/lib/pine-autoresearch.mjs';
import { loadConfig } from '../scripts/pine-autoresearch.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// Real data values from task spec
const champion = {
  configId: 'test-config',
  score: 152.47,
  metrics: {
    roiPct: 91.7,
    profitFactor: 3.56,
    maxDrawdownPct: 2.88,
    tradeCount: 261,
  },
};

const challenger = {
  configId: 'test-config-v2',
  score: 172.33,
  metrics: {
    roiPct: 76.41,
    profitFactor: 9.14,
    maxDrawdownPct: 1.19,
    tradeCount: 245,
  },
};

// Thresholds that include roiRelaxation with tiered config
const thresholdsWithRelaxation = {
  minScoreDelta: 0.1,
  minRoiDeltaPct: 0,
  minProfitFactorDelta: 0,
  maxDrawdownDeltaPct: 0.75,
  minTradeCount: 150,
  minTradeRatioVsIncumbent: 0.75,
  roiRelaxation: {
    enabled: true,
    minScoreDeltaToRelax: 12,
    maxRoiRegressionPct: 20,
    tieredRelaxation: {
      enabled: true,
      pfMultiplierThreshold: 2,
      ddImprovementRequired: true,
      maxRoiRegressionPct: 20,
    },
  },
};

// Same thresholds but without roiRelaxation
const thresholdsWithoutRelaxation = {
  minScoreDelta: 0.1,
  minRoiDeltaPct: 0,
  minProfitFactorDelta: 0,
  maxDrawdownDeltaPct: 0.75,
  minTradeCount: 150,
  minTradeRatioVsIncumbent: 0.75,
};

describe('Promotion Overhaul - roiRelaxation passthrough', () => {
  it('promotes challenger via tiered ROI relaxation when roiRelaxation is present', () => {
    const result = decideAutoresearchOutcome({
      incumbent: champion,
      challenger,
      thresholds: thresholdsWithRelaxation,
    });

    assert.equal(result.recommendation, 'promote',
      `Expected promote but got ${result.recommendation}: ${result.summary}`);
    assert.equal(result.comparisons.roiRelaxationApplied, true,
      'Expected roiRelaxationApplied to be true');
    assert.equal(result.comparisons.roiRelaxationTier, 'tiered',
      'Expected tiered relaxation tier');
  });

  it('holds challenger when roiRelaxation is absent (roi gate fails)', () => {
    const result = decideAutoresearchOutcome({
      incumbent: champion,
      challenger,
      thresholds: thresholdsWithoutRelaxation,
    });

    assert.equal(result.recommendation, 'hold',
      `Expected hold but got ${result.recommendation}: ${result.summary}`);
  });

  it('integration: loadConfig normalizes primaryLab thresholds with roiRelaxation', async () => {
    const config = await loadConfig(projectRoot);
    const primaryThresholds = config.primaryLab.thresholds;

    assert.ok(primaryThresholds.roiRelaxation != null,
      'Expected primaryLab.thresholds.roiRelaxation to be present after loadConfig normalization');
    assert.equal(primaryThresholds.roiRelaxation.enabled, true,
      'Expected roiRelaxation.enabled to be true');
    assert.ok(primaryThresholds.roiRelaxation.tieredRelaxation != null,
      'Expected tieredRelaxation to be present');
    assert.equal(primaryThresholds.roiRelaxation.tieredRelaxation.enabled, true,
      'Expected tieredRelaxation.enabled to be true');
  });
});
