// tests/pine-config-version.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectConfigVersion,
  migrateConfig,
  CURRENT_CONFIG_VERSION,
} from '../scripts/lib/pine-config-version.mjs';

describe('pine-config-version', () => {
  describe('detectConfigVersion', () => {
    it('returns 1 for configs without version field', () => {
      const config = { matrixId: 'test', searchPolicy: { annealing: { maxTemperature: 16 } } };
      assert.equal(detectConfigVersion(config), 1);
    });

    it('returns explicit version when present', () => {
      const config = { configVersion: 2, matrixId: 'test' };
      assert.equal(detectConfigVersion(config), 2);
    });

    it('returns 1 for null/undefined', () => {
      assert.equal(detectConfigVersion(null), 1);
      assert.equal(detectConfigVersion(undefined), 1);
    });
  });

  describe('migrateConfig', () => {
    it('migrates v1 to v2: caps maxTemperature, adds featureFlags', () => {
      const v1 = {
        matrixId: 'test',
        searchPolicy: {
          annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.8, maxTemperature: 16 },
          tabuPolicy: { maxAgeCycles: 20, maxEntries: 40, dropOnChampionChange: true },
        },
        autoPromotion: { enabled: true, cooldownHours: 12, maxPromotionsPerDay: 2 },
      };
      const v2 = migrateConfig(v1);
      assert.equal(v2.configVersion, CURRENT_CONFIG_VERSION);
      assert.equal(v2.searchPolicy.annealing.maxTemperature, 4);
      assert.equal(v2.searchPolicy.annealing.growthFactor, 1.5);
      assert.equal(v2.searchPolicy.tabuPolicy.dropOnChampionChange, false);
      assert.equal(v2.autoPromotion.cooldownHours, 48);
      assert.equal(v2.autoPromotion.maxPromotionsPerDay, 1);
      assert.ok(v2.featureFlags);
      assert.equal(v2.featureFlags.USE_COST_MODEL, false);
    });

    it('returns v2 config unchanged', () => {
      const v2 = { configVersion: 2, matrixId: 'test', featureFlags: { USE_COST_MODEL: true } };
      const result = migrateConfig(v2);
      assert.deepEqual(result, v2);
    });

    it('preserves all existing fields not touched by migration', () => {
      const v1 = {
        matrixId: 'my-matrix',
        scriptPath: '../pine/test.pine',
        grid: 'phase3-core',
        searchPolicy: {
          mode: 'incumbent-local',
          annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.8, maxTemperature: 16 },
          tabuPolicy: { maxAgeCycles: 20, maxEntries: 40, maxSameCycleEntries: 24, dropOnChampionChange: true },
        },
        autoPromotion: { enabled: true, cooldownHours: 12, maxPromotionsPerDay: 2, requireMatrixPromotion: true },
        primaryLab: { labId: 'xrpusdt-15m-primary' },
      };
      const v2 = migrateConfig(v1);
      assert.equal(v2.matrixId, 'my-matrix');
      assert.equal(v2.scriptPath, '../pine/test.pine');
      assert.equal(v2.grid, 'phase3-core');
      assert.equal(v2.searchPolicy.mode, 'incumbent-local');
      assert.equal(v2.searchPolicy.tabuPolicy.maxAgeCycles, 20);
      assert.equal(v2.searchPolicy.tabuPolicy.maxEntries, 40);
      assert.equal(v2.searchPolicy.tabuPolicy.maxSameCycleEntries, 24);
      assert.equal(v2.primaryLab.labId, 'xrpusdt-15m-primary');
      assert.equal(v2.autoPromotion.requireMatrixPromotion, true);
    });
  });

  describe('CURRENT_CONFIG_VERSION', () => {
    it('is 2', () => {
      assert.equal(CURRENT_CONFIG_VERSION, 2);
    });
  });
});
