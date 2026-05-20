// scripts/lib/pine-config-version.mjs

export const CURRENT_CONFIG_VERSION = 2;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function detectConfigVersion(config) {
  if (!config || typeof config !== 'object') return 1;
  const explicit = Number(config.configVersion);
  return Number.isFinite(explicit) && explicit >= 1 ? explicit : 1;
}

function migrateV1ToV2(config) {
  const migrated = clone(config);
  migrated.configVersion = 2;

  // Cap annealing temperature
  if (migrated.searchPolicy?.annealing) {
    migrated.searchPolicy.annealing.maxTemperature = Math.min(
      migrated.searchPolicy.annealing.maxTemperature ?? 16,
      4
    );
    migrated.searchPolicy.annealing.growthFactor = Math.min(
      migrated.searchPolicy.annealing.growthFactor ?? 1.8,
      1.5
    );
  }

  // Retain tabu on champion change
  if (migrated.searchPolicy?.tabuPolicy) {
    migrated.searchPolicy.tabuPolicy.dropOnChampionChange = false;
  }

  // Conservative promotion
  if (migrated.autoPromotion) {
    migrated.autoPromotion.cooldownHours = Math.max(migrated.autoPromotion.cooldownHours ?? 12, 48);
    migrated.autoPromotion.maxPromotionsPerDay = 1;
    migrated.autoPromotion.requireStatisticalSignificance = true;
    migrated.autoPromotion.requireWalkForward = true;
  }

  // Feature flags — all off by default for safe rollout
  if (!migrated.featureFlags) {
    migrated.featureFlags = {
      USE_NEXT_BAR_OPEN_ENTRY: false,
      USE_COMPOUNDED_METRICS: false,
      USE_COST_MODEL: false,
      USE_STATISTICAL_SIGNIFICANCE: false,
      USE_WALK_FORWARD_GATE: false,
      USE_DATA_QUALITY_GATE: false,
      USE_UNIFIED_SCORING: false,
    };
  }

  // Cost model defaults
  if (!migrated.costModel) {
    migrated.costModel = {
      enabled: false,
      commissionPct: 0.04,
      slippagePct: 0.02,
      spreadPct: 0.01,
      slippageStopMultiplier: 2.5,
    };
  }

  // Walk-forward policy
  if (!migrated.walkForwardPolicy) {
    migrated.walkForwardPolicy = {
      enabled: false,
      folds: 5,
      trainRatio: 0.7,
      stepMode: 'rolling',
      minEfficiency: 0.5,
      maxDegradationPct: -50,
      regimeAware: true,
    };
  }

  // Multiple testing penalty update
  if (!migrated.multipleTestingPolicy) {
    migrated.multipleTestingPolicy = { base: 1.0, step: 0.3 };
  }

  // Cache version for invalidation
  if (!migrated.cacheVersion) {
    migrated.cacheVersion = 1;
  }

  return migrated;
}

export function migrateConfig(config) {
  if (!config || typeof config !== 'object') return { configVersion: CURRENT_CONFIG_VERSION };
  const version = detectConfigVersion(config);
  if (version >= CURRENT_CONFIG_VERSION) return config;
  if (version === 1) return migrateV1ToV2(config);
  return config;
}
