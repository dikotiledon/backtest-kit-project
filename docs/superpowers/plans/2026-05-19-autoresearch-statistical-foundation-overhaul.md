# Autoresearch Statistical Foundation Overhaul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the fundamental statistical and simulation flaws in the pine-autoresearch system so that promoted champions represent genuine trading edge rather than curve-fitted noise. Includes migration infrastructure for safe transition of the actively-running research system.

**Architecture:** Bottom-up rebuild with migration safety. Phase 0 establishes feature flags and config versioning so the system can run old and new paths in parallel. Then fix the simulator (entry timing, slippage, costs), metrics (compounded returns, realistic drawdown), scoring (scale-invariant, statistically grounded), validation framework (walk-forward, significance testing), and finally wire everything into the live pipeline with end-to-end comparison. Each layer builds on the previous. Existing 58-file test suite provides regression safety with mandatory full-suite gates between phases.

**Tech Stack:** Node.js ESM, native `node:test` runner, existing modules: `pine-optimizer.mjs`, `pine-metric-core.mjs`, `pine-significance-gate.mjs`, `pine-objective-function.mjs`, `pine-autoresearch.mjs`, `pine-search-policy.mjs`, `pine-stagnation-escape.mjs`, `pine-autoresearch-tracks.mjs`, `pine-streaming-metrics.mjs`, `pine-evaluation-cache.mjs`, `pine-regime-analysis.mjs`, `pine-regime-slices.mjs`.

**Audit Findings Addressed:**
1. Additive ROI (not compounded)
2. Entry at close price (look-ahead bias)
3. No slippage/transaction cost model
4. Drawdown on additive sum (not equity curve)
5. Significance gate is not statistical
6. Scoring function arbitrary/gameable
7. Dual scoring functions with different weights
8. Fixed test windows (no walk-forward)
9. Stagnation escape = overfitting accelerator
10. Tabu reset on champion change
11. Multiple testing penalty too weak
12. Duplicate `calculateMetrics` implementations
13. `tradePenalty` inconsistency between files
14. No data quality validation
15. No transaction cost model
16. Annealing maxTemperature too high

**Additional Issues Addressed (not in original audit):**
17. No migration/feature-flag strategy for live system transition
18. Evaluation cache invalidation on metric changes
19. Walk-forward not wired into promotion pipeline
20. Statistical tests non-deterministic (no seeded RNG)
21. Streaming metrics inconsistency with new simulator
22. No regime-aware walk-forward (existing regime modules unused)
23. Convergence acceptance not quality-aware
24. No end-to-end validation comparing old vs new

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `scripts/lib/pine-feature-flags.mjs` | Feature flag registry for gradual rollout | Create |
| `scripts/lib/pine-config-version.mjs` | Config versioning and migration | Create |
| `scripts/lib/pine-cost-model.mjs` | Transaction cost / slippage model | Create |
| `scripts/lib/pine-data-quality.mjs` | OHLC validation, gap detection | Create |
| `scripts/lib/pine-simulator.mjs` | Trade simulation engine (next-bar-open, cost-aware) | Create |
| `scripts/lib/pine-statistical-significance.mjs` | Bootstrap/permutation significance with seeded RNG | Create |
| `scripts/lib/pine-walk-forward.mjs` | Rolling/anchored walk-forward with regime awareness | Create |
| `scripts/lib/pine-metric-core.mjs` | Add `calculateCompoundedMetrics`, equity-curve drawdown | Modify |
| `scripts/lib/pine-optimizer.mjs` | Delegate to pine-simulator, remove duplicate metrics | Modify |
| `scripts/lib/pine-streaming-metrics.mjs` | Align with new simulator output format | Modify |
| `scripts/lib/pine-significance-gate.mjs` | Add statistical mode using bootstrap+permutation | Modify |
| `scripts/lib/pine-objective-function.mjs` | Unify scoring via `scoreMetrics` base, strengthen MTP | Modify |
| `scripts/lib/pine-search-policy.mjs` | Cap annealing temperature, reduce growth factor | Modify |
| `scripts/lib/pine-stagnation-escape.mjs` | Add quality-aware convergence acceptance | Modify |
| `scripts/lib/pine-autoresearch-tracks.mjs` | Fix tabu retention on champion change | Modify |
| `scripts/lib/pine-autoresearch.mjs` | Wire walk-forward, data quality, new significance into promotion | Modify |
| `scripts/lib/pine-evaluation-cache.mjs` | Add cache version key, invalidation on metric change | Modify |
| `config/pine-autoresearch.default.json` | Update thresholds, add feature flags, version field | Modify |
| `tests/pine-feature-flags.test.mjs` | Feature flag tests | Create |
| `tests/pine-config-version.test.mjs` | Config versioning tests | Create |
| `tests/pine-cost-model.test.mjs` | Cost model unit tests | Create |
| `tests/pine-data-quality.test.mjs` | Data quality validation tests | Create |
| `tests/pine-simulator.test.mjs` | Simulator unit tests | Create |
| `tests/pine-statistical-significance.test.mjs` | Significance testing (seeded, deterministic) | Create |
| `tests/pine-walk-forward.test.mjs` | Walk-forward validation tests | Create |
| `tests/pine-metric-core-v2.test.mjs` | Compounded metrics tests | Create |
| `tests/pine-integration-e2e.test.mjs` | End-to-end pipeline validation | Create |

---

## Regression Gate Protocol

**Between every phase**, run the full test suite as a gate:

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL existing tests PASS. If any fail, fix before proceeding to next phase. This is non-negotiable — the system is actively running research.

---

## Phase 0: Foundation & Migration Infrastructure

### Task 1: Create Feature Flag System

**Files:**
- Create: `scripts/lib/pine-feature-flags.mjs`
- Create: `tests/pine-feature-flags.test.mjs`

- [ ] **Step 1: Write failing tests for feature flags**

```javascript
// tests/pine-feature-flags.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFlagRegistry,
  getFlag,
  setFlag,
  withFlag,
  KNOWN_FLAGS,
} from '../scripts/lib/pine-feature-flags.mjs';

describe('pine-feature-flags', () => {
  describe('createFlagRegistry', () => {
    it('returns registry with all known flags defaulting to false', () => {
      const registry = createFlagRegistry();
      assert.equal(registry.get('USE_NEXT_BAR_OPEN_ENTRY'), false);
      assert.equal(registry.get('USE_COMPOUNDED_METRICS'), false);
      assert.equal(registry.get('USE_COST_MODEL'), false);
      assert.equal(registry.get('USE_STATISTICAL_SIGNIFICANCE'), false);
      assert.equal(registry.get('USE_WALK_FORWARD_GATE'), false);
      assert.equal(registry.get('USE_DATA_QUALITY_GATE'), false);
    });

    it('accepts initial overrides', () => {
      const registry = createFlagRegistry({ USE_COST_MODEL: true });
      assert.equal(registry.get('USE_COST_MODEL'), true);
      assert.equal(registry.get('USE_NEXT_BAR_OPEN_ENTRY'), false);
    });

    it('ignores unknown flags in overrides', () => {
      const registry = createFlagRegistry({ UNKNOWN_FLAG: true });
      assert.equal(registry.get('UNKNOWN_FLAG'), false);
    });
  });

  describe('getFlag / setFlag', () => {
    it('setFlag updates value', () => {
      const registry = createFlagRegistry();
      setFlag(registry, 'USE_COST_MODEL', true);
      assert.equal(getFlag(registry, 'USE_COST_MODEL'), true);
    });

    it('getFlag returns false for unknown flags', () => {
      const registry = createFlagRegistry();
      assert.equal(getFlag(registry, 'NONEXISTENT'), false);
    });
  });

  describe('withFlag', () => {
    it('executes fn only when flag is true', () => {
      const registry = createFlagRegistry({ USE_COST_MODEL: true });
      let called = false;
      const result = withFlag(registry, 'USE_COST_MODEL', () => { called = true; return 42; }, () => 0);
      assert.equal(called, true);
      assert.equal(result, 42);
    });

    it('executes fallback when flag is false', () => {
      const registry = createFlagRegistry();
      const result = withFlag(registry, 'USE_COST_MODEL', () => 42, () => 0);
      assert.equal(result, 0);
    });

    it('returns fallback value directly if not a function', () => {
      const registry = createFlagRegistry();
      const result = withFlag(registry, 'USE_COST_MODEL', () => 42, 99);
      assert.equal(result, 99);
    });
  });

  describe('KNOWN_FLAGS', () => {
    it('exports all flag names as frozen array', () => {
      assert.ok(Array.isArray(KNOWN_FLAGS));
      assert.ok(KNOWN_FLAGS.includes('USE_NEXT_BAR_OPEN_ENTRY'));
      assert.ok(KNOWN_FLAGS.includes('USE_COMPOUNDED_METRICS'));
      assert.ok(KNOWN_FLAGS.includes('USE_COST_MODEL'));
      assert.ok(KNOWN_FLAGS.includes('USE_STATISTICAL_SIGNIFICANCE'));
      assert.ok(KNOWN_FLAGS.includes('USE_WALK_FORWARD_GATE'));
      assert.ok(KNOWN_FLAGS.includes('USE_DATA_QUALITY_GATE'));
      assert.ok(Object.isFrozen(KNOWN_FLAGS));
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-feature-flags.test.mjs`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement feature flag system**

```javascript
// scripts/lib/pine-feature-flags.mjs

export const KNOWN_FLAGS = Object.freeze([
  'USE_NEXT_BAR_OPEN_ENTRY',
  'USE_COMPOUNDED_METRICS',
  'USE_COST_MODEL',
  'USE_STATISTICAL_SIGNIFICANCE',
  'USE_WALK_FORWARD_GATE',
  'USE_DATA_QUALITY_GATE',
  'USE_UNIFIED_SCORING',
]);

const FLAG_SET = new Set(KNOWN_FLAGS);

export function createFlagRegistry(overrides = {}) {
  const flags = new Map();
  for (const flag of KNOWN_FLAGS) {
    flags.set(flag, false);
  }
  if (overrides && typeof overrides === 'object') {
    for (const [key, value] of Object.entries(overrides)) {
      if (FLAG_SET.has(key)) {
        flags.set(key, Boolean(value));
      }
    }
  }
  return flags;
}

export function getFlag(registry, name) {
  if (!registry || !FLAG_SET.has(name)) return false;
  return registry.get(name) ?? false;
}

export function setFlag(registry, name, value) {
  if (!registry || !FLAG_SET.has(name)) return;
  registry.set(name, Boolean(value));
}

export function withFlag(registry, name, enabledFn, fallback) {
  if (getFlag(registry, name)) {
    return typeof enabledFn === 'function' ? enabledFn() : enabledFn;
  }
  return typeof fallback === 'function' ? fallback() : fallback;
}

export function registryFromConfig(config = {}) {
  const featureFlags = config?.featureFlags ?? config?.statisticalOverhaul?.featureFlags ?? {};
  return createFlagRegistry(featureFlags);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-feature-flags.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-feature-flags.mjs tests/pine-feature-flags.test.mjs
git commit -m "feat: add feature flag system for gradual statistical overhaul rollout"
```

---

### Task 2: Create Config Versioning & Migration

**Files:**
- Create: `scripts/lib/pine-config-version.mjs`
- Create: `tests/pine-config-version.test.mjs`

- [ ] **Step 1: Write failing tests for config versioning**

```javascript
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
      assert.equal(v2.featureFlags.USE_COST_MODEL, false); // off by default for safe rollout
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-config-version.test.mjs`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement config versioning**

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-config-version.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-config-version.mjs tests/pine-config-version.test.mjs
git commit -m "feat: add config versioning with v1->v2 migration (annealing cap, tabu fix, feature flags)"
```

---

### Task 3: Add Cache Invalidation to Evaluation Cache

**Files:**
- Modify: `scripts/lib/pine-evaluation-cache.mjs`
- Modify: `tests/pine-evaluation-cache.test.mjs`

- [ ] **Step 1: Write failing test for cache version awareness**

```javascript
// Append to tests/pine-evaluation-cache.test.mjs
describe('cache version invalidation', () => {
  it('rejects cached entry when cacheVersion differs', () => {
    // This test depends on the existing cache API shape.
    // The cache stores results keyed by config fingerprint.
    // After metric changes, old cached results are invalid.
    const cache = createEvaluationCache({ cacheVersion: 2 });
    cache.set('fingerprint-abc', { score: 50, metrics: { roiPct: 10 }, cacheVersion: 1 });
    const result = cache.get('fingerprint-abc');
    assert.equal(result, null); // rejected due to version mismatch
  });

  it('accepts cached entry when cacheVersion matches', () => {
    const cache = createEvaluationCache({ cacheVersion: 2 });
    cache.set('fingerprint-abc', { score: 50, metrics: { roiPct: 10 }, cacheVersion: 2 });
    const result = cache.get('fingerprint-abc');
    assert.notEqual(result, null);
    assert.equal(result.score, 50);
  });

  it('defaults cacheVersion to 1 when not specified', () => {
    const cache = createEvaluationCache({});
    assert.equal(cache.cacheVersion, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-evaluation-cache.test.mjs`
Expected: FAIL — `createEvaluationCache` does not accept `cacheVersion` or filter by it

- [ ] **Step 3: Add cache version to evaluation cache**

Modify `scripts/lib/pine-evaluation-cache.mjs` — add version field to constructor and filter in `get`:

```javascript
// In the constructor or factory function, add:
this.cacheVersion = Number(options?.cacheVersion) || 1;

// In the get method, add version check:
const entry = this._store.get(key);
if (!entry) return null;
if (entry.cacheVersion !== this.cacheVersion) {
  this._store.delete(key); // evict stale entry
  return null;
}
return entry;

// In the set method, stamp version:
set(key, value) {
  this._store.set(key, { ...value, cacheVersion: this.cacheVersion });
}
```

(Exact modification depends on existing cache structure — read the file and adapt.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-evaluation-cache.test.mjs`
Expected: All tests PASS (both new and existing)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-evaluation-cache.mjs tests/pine-evaluation-cache.test.mjs
git commit -m "feat: add cacheVersion to evaluation cache for metric-change invalidation"
```

---

### Phase 0 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL 58+ test files PASS. No regressions from Phase 0 additions.

---

## Phase 1: Fix the Simulator (Entry Timing + Cost Model)

### Task 4: Create Transaction Cost Model

**Files:**
- Create: `scripts/lib/pine-cost-model.mjs`
- Create: `tests/pine-cost-model.test.mjs`

- [ ] **Step 1: Write failing tests for cost model**

```javascript
// tests/pine-cost-model.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTradeCost,
  computeSlippage,
  buildCostModel,
  applyCostToTrade,
} from '../scripts/lib/pine-cost-model.mjs';

describe('pine-cost-model', () => {
  describe('buildCostModel', () => {
    it('returns default model when no config provided', () => {
      const model = buildCostModel();
      assert.equal(model.commissionPct, 0.04);
      assert.equal(model.slippagePct, 0.02);
      assert.equal(model.spreadPct, 0.01);
      assert.equal(model.enabled, true);
    });

    it('accepts custom config', () => {
      const model = buildCostModel({ commissionPct: 0.1, slippagePct: 0.05, spreadPct: 0 });
      assert.equal(model.commissionPct, 0.1);
      assert.equal(model.slippagePct, 0.05);
      assert.equal(model.spreadPct, 0);
    });

    it('returns disabled model when enabled=false', () => {
      const model = buildCostModel({ enabled: false });
      assert.equal(model.enabled, false);
      assert.equal(model.commissionPct, 0);
      assert.equal(model.slippagePct, 0);
      assert.equal(model.spreadPct, 0);
    });
  });

  describe('computeTradeCost', () => {
    it('computes round-trip cost for normal exit', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      // Entry: commission(0.04) + slippage(0.02) + spread(0.01) = 0.07
      // Exit (takeProfit): commission(0.04) + slippage(0.02) = 0.06
      // Total: 0.07 + 0.06 = 0.13
      const cost = computeTradeCost(model, { exitReason: 'takeProfit' });
      assert.equal(cost, 0.13);
    });

    it('computes higher cost for stop-loss exit due to slippage multiplier', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01, slippageStopMultiplier: 2.5 });
      // Entry: commission(0.04) + slippage(0.02) + spread(0.01) = 0.07
      // Exit (stopLoss): commission(0.04) + slippage(0.02*2.5=0.05) = 0.09
      // Total: 0.07 + 0.09 = 0.16
      const cost = computeTradeCost(model, { exitReason: 'stopLoss' });
      assert.equal(cost, 0.16);
    });

    it('returns 0 for disabled model', () => {
      const model = buildCostModel({ enabled: false });
      assert.equal(computeTradeCost(model), 0);
    });
  });

  describe('computeSlippage', () => {
    it('applies asymmetric slippage for stop-loss exits', () => {
      const model = buildCostModel({ slippagePct: 0.02, slippageStopMultiplier: 2.5 });
      const slippage = computeSlippage(model, { exitReason: 'stopLoss' });
      assert.equal(slippage, 0.05); // 0.02 * 2.5
    });

    it('applies base slippage for normal exits', () => {
      const model = buildCostModel({ slippagePct: 0.02 });
      const slippage = computeSlippage(model, { exitReason: 'takeProfit' });
      assert.equal(slippage, 0.02);
    });
  });

  describe('applyCostToTrade', () => {
    it('reduces returnPct by round-trip cost', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      const trade = { returnPctExact: 1.5, exitReason: 'takeProfit', entryPrice: 100, exitPrice: 101.5 };
      const adjusted = applyCostToTrade(trade, model);
      // grossReturn = 1.5, cost = 0.13, net = 1.37
      assert.equal(adjusted.grossReturnPct, 1.5);
      assert.equal(adjusted.costPct, 0.13);
      assert.equal(adjusted.returnPctExact, 1.37);
    });

    it('turns marginal winners into losers', () => {
      const model = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      const trade = { returnPctExact: 0.05, exitReason: 'takeProfit', entryPrice: 100, exitPrice: 100.05 };
      const adjusted = applyCostToTrade(trade, model);
      // net = 0.05 - 0.13 = -0.08
      assert.ok(adjusted.returnPctExact < 0);
      assert.equal(adjusted.returnPctExact, -0.08);
    });

    it('returns trade unchanged for disabled model', () => {
      const model = buildCostModel({ enabled: false });
      const trade = { returnPctExact: 1.5, exitReason: 'takeProfit' };
      const adjusted = applyCostToTrade(trade, model);
      assert.equal(adjusted.returnPctExact, 1.5);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-cost-model.test.mjs`
Expected: FAIL — module `pine-cost-model.mjs` does not exist

- [ ] **Step 3: Implement cost model**

```javascript
// scripts/lib/pine-cost-model.mjs

function finitePositive(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function buildCostModel(config = {}) {
  if (config?.enabled === false) {
    return { enabled: false, commissionPct: 0, slippagePct: 0, spreadPct: 0, slippageStopMultiplier: 1 };
  }

  return {
    enabled: true,
    commissionPct: finitePositive(config.commissionPct, 0.04),
    slippagePct: finitePositive(config.slippagePct, 0.02),
    spreadPct: finitePositive(config.spreadPct, 0.01),
    slippageStopMultiplier: finitePositive(config.slippageStopMultiplier, 2.5),
  };
}

export function computeSlippage(model, { exitReason } = {}) {
  if (!model?.enabled) return 0;
  const base = model.slippagePct;
  if (exitReason === 'stopLoss') {
    return Number((base * (model.slippageStopMultiplier ?? 2.5)).toFixed(6));
  }
  return base;
}

export function computeTradeCost(model, { exitReason = 'takeProfit' } = {}) {
  if (!model?.enabled) return 0;
  const entrySlippage = model.slippagePct;
  const exitSlippage = computeSlippage(model, { exitReason });
  const entryCost = model.commissionPct + entrySlippage + model.spreadPct;
  const exitCost = model.commissionPct + exitSlippage;
  return Number((entryCost + exitCost).toFixed(6));
}

export function applyCostToTrade(trade, model) {
  if (!model?.enabled) return trade;
  const grossReturn = trade.returnPctExact ?? trade.returnPct ?? 0;
  const costPct = computeTradeCost(model, { exitReason: trade.exitReason });
  const netReturn = Number((grossReturn - costPct).toFixed(6));

  return {
    ...trade,
    grossReturnPct: grossReturn,
    returnPctExact: netReturn,
    returnPct: Number(netReturn.toFixed(2)),
    costPct,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-cost-model.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-cost-model.mjs tests/pine-cost-model.test.mjs
git commit -m "feat: add transaction cost model with slippage and commission"
```

---

### Task 5: Create Data Quality Validation

**Files:**
- Create: `scripts/lib/pine-data-quality.mjs`
- Create: `tests/pine-data-quality.test.mjs`

- [ ] **Step 1: Write failing tests for data quality**

```javascript
// tests/pine-data-quality.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOhlcRow,
  validateDataset,
  detectGaps,
  buildDataQualityReport,
} from '../scripts/lib/pine-data-quality.mjs';

describe('pine-data-quality', () => {
  describe('validateOhlcRow', () => {
    it('passes valid OHLC row', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it('fails when High < Low', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 95, Low: 98, Close: 97 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('High < Low')));
    });

    it('fails when Close outside High/Low range', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 110 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Close')));
    });

    it('fails when Open outside High/Low range', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: 90, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Open')));
    });

    it('fails on missing timestamp', () => {
      const row = { Open: 100, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
    });

    it('fails on non-finite price', () => {
      const row = { timestamp: '2026-01-01T00:00:00Z', Open: NaN, High: 105, Low: 98, Close: 103 };
      const result = validateOhlcRow(row);
      assert.equal(result.valid, false);
    });
  });

  describe('detectGaps', () => {
    it('detects missing bars in time series', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Close: 100 },
        { timestamp: '2026-01-01T00:15:00Z', Close: 101 },
        { timestamp: '2026-01-01T00:45:00Z', Close: 102 },
        { timestamp: '2026-01-01T01:00:00Z', Close: 103 },
      ];
      const gaps = detectGaps(rows, { expectedIntervalMs: 15 * 60 * 1000 });
      assert.equal(gaps.length, 1);
      assert.equal(gaps[0].afterIndex, 1);
      assert.equal(gaps[0].missedBars, 1);
    });

    it('returns empty for continuous data', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Close: 100 },
        { timestamp: '2026-01-01T00:15:00Z', Close: 101 },
        { timestamp: '2026-01-01T00:30:00Z', Close: 102 },
      ];
      const gaps = detectGaps(rows, { expectedIntervalMs: 15 * 60 * 1000 });
      assert.equal(gaps.length, 0);
    });
  });

  describe('validateDataset', () => {
    it('returns summary with error count and gap count', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 103 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 103, High: 95, Low: 98, Close: 100 }, // High<Low
        { timestamp: '2026-01-01T00:45:00Z', Open: 100, High: 102, Low: 99, Close: 101 }, // gap before
      ];
      const report = validateDataset(rows, { timeframeMinutes: 15 });
      assert.equal(report.totalRows, 3);
      assert.equal(report.invalidRows, 1);
      assert.equal(report.gaps, 1);
      assert.equal(report.valid, false);
    });
  });

  describe('buildDataQualityReport', () => {
    it('marks dataset valid when no issues', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 105, Low: 98, Close: 103 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 103, High: 106, Low: 101, Close: 104 },
      ];
      const report = buildDataQualityReport(rows, { timeframeMinutes: 15 });
      assert.equal(report.valid, true);
      assert.equal(report.invalidRows, 0);
      assert.equal(report.gaps, 0);
    });

    it('includes severity level based on error density', () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
        Open: 100, High: 105, Low: 98, Close: 103,
      }));
      // Corrupt 15% of rows
      for (let i = 0; i < 15; i++) {
        rows[i * 6].High = 90; // High < Low
      }
      const report = buildDataQualityReport(rows, { timeframeMinutes: 15 });
      assert.equal(report.valid, false);
      assert.equal(report.severity, 'critical'); // >10% invalid = critical
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-data-quality.test.mjs`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement data quality validation**

```javascript
// scripts/lib/pine-data-quality.mjs

export function validateOhlcRow(row) {
  const errors = [];

  if (!row?.timestamp || typeof row.timestamp !== 'string') {
    errors.push('Missing or invalid timestamp');
  }

  const open = Number(row?.Open);
  const high = Number(row?.High);
  const low = Number(row?.Low);
  const close = Number(row?.Close);

  if (!Number.isFinite(open)) errors.push('Open is not finite');
  if (!Number.isFinite(high)) errors.push('High is not finite');
  if (!Number.isFinite(low)) errors.push('Low is not finite');
  if (!Number.isFinite(close)) errors.push('Close is not finite');

  if (Number.isFinite(high) && Number.isFinite(low) && high < low) {
    errors.push('High < Low');
  }

  if (Number.isFinite(close) && Number.isFinite(high) && Number.isFinite(low)) {
    if (close > high) errors.push('Close > High');
    if (close < low) errors.push('Close < Low');
  }

  if (Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low)) {
    if (open > high) errors.push('Open > High');
    if (open < low) errors.push('Open < Low');
  }

  return { valid: errors.length === 0, errors };
}

export function detectGaps(rows, { expectedIntervalMs } = {}) {
  if (!expectedIntervalMs || rows.length < 2) return [];
  const gaps = [];
  const tolerance = expectedIntervalMs * 1.5;

  for (let i = 1; i < rows.length; i++) {
    const prev = Date.parse(rows[i - 1]?.timestamp);
    const curr = Date.parse(rows[i]?.timestamp);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    const diff = curr - prev;
    if (diff > tolerance) {
      gaps.push({
        afterIndex: i - 1,
        expectedMs: expectedIntervalMs,
        actualMs: diff,
        missedBars: Math.round((diff - expectedIntervalMs) / expectedIntervalMs),
      });
    }
  }

  return gaps;
}

export function validateDataset(rows, { timeframeMinutes = 15 } = {}) {
  let invalidRows = 0;
  const invalidDetails = [];

  for (let i = 0; i < rows.length; i++) {
    const result = validateOhlcRow(rows[i]);
    if (!result.valid) {
      invalidRows++;
      if (invalidDetails.length < 10) {
        invalidDetails.push({ index: i, errors: result.errors });
      }
    }
  }

  const gaps = detectGaps(rows, { expectedIntervalMs: timeframeMinutes * 60 * 1000 });

  return {
    totalRows: rows.length,
    invalidRows,
    invalidDetails,
    gaps: gaps.length,
    gapDetails: gaps.slice(0, 10),
    valid: invalidRows === 0 && gaps.length === 0,
  };
}

export function buildDataQualityReport(rows, options = {}) {
  const base = validateDataset(rows, options);
  const errorDensity = base.totalRows > 0 ? base.invalidRows / base.totalRows : 0;

  let severity = 'ok';
  if (errorDensity > 0.1) severity = 'critical';
  else if (errorDensity > 0.02) severity = 'warning';
  else if (base.invalidRows > 0 || base.gaps > 0) severity = 'minor';

  return { ...base, severity, errorDensity: Number(errorDensity.toFixed(4)) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-data-quality.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-data-quality.mjs tests/pine-data-quality.test.mjs
git commit -m "feat: add data quality validation for OHLC integrity and gap detection"
```

---
### Task 6: Fix Entry Timing — Next-Bar Open Simulator

**Files:**
- Create: `scripts/lib/pine-simulator.mjs`
- Create: `tests/pine-simulator.test.mjs`

- [ ] **Step 1: Write failing tests for next-bar entry**

```javascript
// tests/pine-simulator.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrades } from '../scripts/lib/pine-simulator.mjs';
import { buildCostModel } from '../scripts/lib/pine-cost-model.mjs';

describe('pine-simulator', () => {
  describe('entry timing', () => {
    it('enters at next bar open, not signal bar close', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 100, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 104, High: 106, Low: 103, Close: 105, Signal: -1 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades.length, 1);
      assert.equal(trades[0].entryPrice, 101.5);
      assert.equal(trades[0].side, 'long');
    });

    it('falls back to Close when next bar has no Open', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', High: 105, Low: 100, Close: 104, Signal: 0 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades.length, 1);
      assert.equal(trades[0].entryPrice, 104);
    });

    it('legacy mode enters at signal bar close', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 100, Close: 104, Signal: -1 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'signal-bar-close' });
      assert.equal(trades[0].entryPrice, 101);
    });
  });

  describe('exit mechanics', () => {
    it('exits at SL price when Low breaches stop', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 97, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 101, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 104, High: 104.5, Low: 96, Close: 98, Signal: 0 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades[0].exitReason, 'stopLoss');
      assert.equal(trades[0].exitPrice, 97);
    });

    it('uses open price when bar gaps through stop', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 97, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 101, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 95, High: 96, Low: 93, Close: 94, Signal: 0 },
      ];
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open' });
      assert.equal(trades[0].exitReason, 'stopLoss');
      assert.equal(trades[0].exitPrice, 95);
    });
  });

  describe('cost integration', () => {
    it('applies cost model to each trade', () => {
      const rows = [
        { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
        { timestamp: '2026-01-01T00:15:00Z', Open: 101, High: 105, Low: 100, Close: 104, Signal: 0 },
        { timestamp: '2026-01-01T00:30:00Z', Open: 104, High: 111, Low: 103, Close: 110, Signal: 0 },
      ];
      const costModel = buildCostModel({ commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 });
      const trades = simulateTrades(rows, { entryMode: 'next-bar-open', costModel });
      assert.equal(trades.length, 1);
      assert.ok(trades[0].costPct > 0);
      assert.ok(trades[0].returnPctExact < trades[0].grossReturnPct);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-simulator.test.mjs`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement simulator with next-bar-open entry**

```javascript
// scripts/lib/pine-simulator.mjs
import { applyCostToTrade, buildCostModel } from './pine-cost-model.mjs';

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeRows(rows) {
  return rows.filter((row) => row && row.timestamp && Number.isFinite(row.Close));
}

function inferTimeframeMinutes(rows) {
  const valid = rows.filter((row) => row?.timestamp).slice(0, 10);
  for (let i = 1; i < valid.length; i++) {
    const diffMs = Date.parse(valid[i].timestamp) - Date.parse(valid[i - 1].timestamp);
    if (Number.isFinite(diffMs) && diffMs > 0) return diffMs / 60000;
  }
  return 15;
}

function barsToHold(row, timeframeMinutes) {
  const estimatedMinutes = Number.isFinite(row?.EstimatedTime) && row.EstimatedTime > 0
    ? row.EstimatedTime : 240;
  return Math.max(1, Math.ceil(estimatedMinutes / timeframeMinutes));
}

function barRange(row) {
  return {
    high: Number.isFinite(row.High) ? row.High : row.Close,
    low: Number.isFinite(row.Low) ? row.Low : row.Close,
  };
}

function getOpen(row) {
  return Number.isFinite(row.Open) ? row.Open : row.Close;
}

function excursionPct(position, kind) {
  const entry = position.entryPrice;
  if (!Number.isFinite(entry) || entry === 0) return null;
  if (position.side === 'long') {
    const favorable = position.maxHigh - entry;
    const adverse = entry - position.minLow;
    return round(((kind === 'mfe' ? favorable : adverse) / entry) * 100, 4);
  }
  const favorable = entry - position.minLow;
  const adverse = position.maxHigh - entry;
  return round(((kind === 'mfe' ? favorable : adverse) / entry) * 100, 4);
}

function buildTrade(position, exitRow, exitReason, exitPrice, exitIndex) {
  const rawPnl = position.side === 'long'
    ? exitPrice - position.entryPrice
    : position.entryPrice - exitPrice;
  const returnPctExact = position.entryPrice === 0 ? 0 : (rawPnl / position.entryPrice) * 100;

  return {
    side: position.side,
    entryIndex: position.entryIndex,
    exitIndex,
    entryTime: position.entryTime,
    exitTime: exitRow.timestamp,
    entryPrice: position.entryPrice,
    exitPrice,
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    holdBars: exitIndex - position.entryIndex,
    maxBars: position.maxBars,
    exitReason,
    rawPnlExact: round(rawPnl, 6),
    returnPctExact: round(returnPctExact, 6),
    pnl: round(rawPnl, 2),
    returnPct: round(returnPctExact, 2),
    mfePct: excursionPct(position, 'mfe'),
    maePct: excursionPct(position, 'mae'),
  };
}

export function simulateTrades(rows, options = {}) {
  const normalized = normalizeRows(rows);
  const timeframeMinutes = options.timeframeMinutes || inferTimeframeMinutes(normalized);
  const entryMode = options.entryMode || 'next-bar-open';
  const costModel = options.costModel ?? null;
  const trades = [];
  let position = null;
  let pendingSignal = null;

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    const signal = row.Signal;

    // Process pending entry (next-bar-open mode)
    if (!position && pendingSignal && entryMode === 'next-bar-open') {
      const entryPrice = getOpen(row);
      position = {
        side: pendingSignal.side,
        entryIndex: i,
        entryTime: row.timestamp,
        entryPrice,
        maxHigh: entryPrice,
        minLow: entryPrice,
        stopLoss: pendingSignal.stopLoss,
        takeProfit: pendingSignal.takeProfit,
        maxBars: pendingSignal.maxBars,
      };
      pendingSignal = null;
    }

    // Process open position
    if (position) {
      const close = row.Close;
      const { high, low } = barRange(row);
      const open = getOpen(row);
      const heldBars = i - position.entryIndex;
      let exitReason = null;
      let exitPrice = null;

      position.maxHigh = Math.max(position.maxHigh, high);
      position.minLow = Math.min(position.minLow, low);

      if (position.side === 'long') {
        if (Number.isFinite(position.stopLoss) && low <= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = open < position.stopLoss ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && high >= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = open > position.takeProfit ? open : position.takeProfit;
        } else if (signal === -1) {
          exitReason = 'flip';
          exitPrice = close;
        } else if (heldBars >= position.maxBars) {
          exitReason = 'time';
          exitPrice = close;
        }
      } else {
        if (Number.isFinite(position.stopLoss) && high >= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = open > position.stopLoss ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && low <= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = open < position.takeProfit ? open : position.takeProfit;
        } else if (signal === 1) {
          exitReason = 'flip';
          exitPrice = close;
        } else if (heldBars >= position.maxBars) {
          exitReason = 'time';
          exitPrice = close;
        }
      }

      if (exitReason) {
        let trade = buildTrade(position, row, exitReason, exitPrice, i);
        if (costModel) trade = applyCostToTrade(trade, costModel);
        trades.push(trade);
        position = null;
      } else {
        // Trailing SL/TP updates
        const simPos = Number(row?.Feature_SimPos);
        if (position.side === 'long' && simPos === 1) {
          if (Number.isFinite(row?.StopLoss)) position.stopLoss = row.StopLoss;
          if (Number.isFinite(row?.TakeProfit)) position.takeProfit = row.TakeProfit;
        }
        if (position.side === 'short' && simPos === -1) {
          if (Number.isFinite(row?.StopLoss)) position.stopLoss = row.StopLoss;
          if (Number.isFinite(row?.TakeProfit)) position.takeProfit = row.TakeProfit;
        }
      }
    }

    // Register new signal
    if (!position && (signal === 1 || signal === -1)) {
      if (entryMode === 'next-bar-open') {
        pendingSignal = {
          side: signal === 1 ? 'long' : 'short',
          stopLoss: Number.isFinite(row.StopLoss) ? row.StopLoss : NaN,
          takeProfit: Number.isFinite(row.TakeProfit) ? row.TakeProfit : NaN,
          maxBars: barsToHold(row, timeframeMinutes),
        };
      } else {
        position = {
          side: signal === 1 ? 'long' : 'short',
          entryIndex: i,
          entryTime: row.timestamp,
          entryPrice: row.Close,
          maxHigh: row.Close,
          minLow: row.Close,
          stopLoss: Number.isFinite(row.StopLoss) ? row.StopLoss : NaN,
          takeProfit: Number.isFinite(row.TakeProfit) ? row.TakeProfit : NaN,
          maxBars: barsToHold(row, timeframeMinutes),
        };
      }
    }
  }

  // Close open position at end of data
  if (position && normalized.length) {
    const lastIndex = normalized.length - 1;
    const lastRow = normalized[lastIndex];
    let trade = buildTrade(position, lastRow, 'endOfData', lastRow.Close, lastIndex);
    if (costModel) trade = applyCostToTrade(trade, costModel);
    trades.push(trade);
  }

  return trades;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-simulator.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-simulator.mjs tests/pine-simulator.test.mjs
git commit -m "feat: new simulator with next-bar-open entry and cost model integration"
```

---

### Phase 1 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL existing tests PASS. New modules are additive — no existing code modified yet.

---

## Phase 2: Fix the Metrics (Compounded Returns, Equity-Curve Drawdown)

### Task 7: Implement Compounded Return Calculation

**Files:**
- Modify: `scripts/lib/pine-metric-core.mjs`
- Create: `tests/pine-metric-core-v2.test.mjs`

- [ ] **Step 1: Write failing tests for compounded metrics**

```javascript
// tests/pine-metric-core-v2.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMetrics,
  calculateCompoundedMetrics,
} from '../scripts/lib/pine-metric-core.mjs';

describe('pine-metric-core compounded metrics', () => {
  describe('calculateCompoundedMetrics', () => {
    it('computes compounded ROI correctly', () => {
      // 3 trades: +10%, -5%, +8%
      // Compounded: 1.10 * 0.95 * 1.08 = 1.1286 => 12.86%
      const trades = [
        { returnPctExact: 10 },
        { returnPctExact: -5 },
        { returnPctExact: 8 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(metrics.compoundedRoiPct - 12.86) < 0.01);
    });

    it('handles 50% gain then 50% loss correctly as -25%', () => {
      const trades = [
        { returnPctExact: 50 },
        { returnPctExact: -50 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      // 1.5 * 0.5 = 0.75 => -25%
      assert.ok(Math.abs(metrics.compoundedRoiPct - (-25)) < 0.01);
    });

    it('additive ROI differs from compounded for same trades', () => {
      const trades = [
        { returnPctExact: 50 },
        { returnPctExact: -50 },
      ];
      const additive = calculateMetrics(trades);
      const compounded = calculateCompoundedMetrics(trades);
      // Additive: 50 + (-50) = 0%
      assert.ok(Math.abs(additive.roiPct) < 0.01);
      // Compounded: -25%
      assert.ok(Math.abs(compounded.compoundedRoiPct - (-25)) < 0.01);
    });

    it('computes equity-curve drawdown', () => {
      // Equity: 1.0 -> 1.10 -> 1.045 -> 1.1286
      // Peak at 1.10, trough at 1.045 => DD = (1.10 - 1.045)/1.10 = 5%
      const trades = [
        { returnPctExact: 10 },
        { returnPctExact: -5 },
        { returnPctExact: 8 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(metrics.maxDrawdownPct - 5) < 0.1);
    });

    it('computes equity-curve drawdown for deep loss', () => {
      // 1.0 -> 1.20 -> 0.84 => DD = (1.20 - 0.84)/1.20 = 30%
      const trades = [
        { returnPctExact: 20 },
        { returnPctExact: -30 },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Math.abs(metrics.maxDrawdownPct - 30) < 0.1);
    });

    it('returns zero for empty trades', () => {
      const metrics = calculateCompoundedMetrics([]);
      assert.equal(metrics.compoundedRoiPct, 0);
      assert.equal(metrics.maxDrawdownPct, 0);
    });

    it('includes CAGR when duration info available', () => {
      const trades = [
        { returnPctExact: 5, entryTime: '2026-01-01T00:00:00Z', exitTime: '2026-06-01T00:00:00Z' },
        { returnPctExact: 5, entryTime: '2026-06-02T00:00:00Z', exitTime: '2026-12-01T00:00:00Z' },
      ];
      const metrics = calculateCompoundedMetrics(trades);
      assert.ok(Number.isFinite(metrics.cagrPct));
      assert.ok(metrics.cagrPct > 0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-metric-core-v2.test.mjs`
Expected: FAIL — `calculateCompoundedMetrics` is not exported

- [ ] **Step 3: Implement compounded metrics**

Append to `scripts/lib/pine-metric-core.mjs`:

```javascript
// Append to existing pine-metric-core.mjs

export function calculateCompoundedMetrics(trades) {
  if (!trades || trades.length === 0) {
    return {
      compoundedRoiPct: 0,
      maxDrawdownPct: 0,
      cagrPct: 0,
      equityCurve: [],
      tradeCount: 0,
      finalEquity: 1,
    };
  }

  let equity = 1.0;
  let peak = 1.0;
  let maxDrawdownFraction = 0;
  const equityCurve = [1.0];

  for (const trade of trades) {
    const returnPct = Number.isFinite(trade?.returnPctExact) ? trade.returnPctExact
      : (Number.isFinite(trade?.returnPct) ? trade.returnPct : 0);
    const multiplier = 1 + (returnPct / 100);
    equity *= Math.max(0, multiplier);
    equityCurve.push(equity);

    if (equity > peak) peak = equity;
    const drawdownFraction = peak > 0 ? (peak - equity) / peak : 0;
    if (drawdownFraction > maxDrawdownFraction) maxDrawdownFraction = drawdownFraction;
  }

  const compoundedRoiPct = (equity - 1) * 100;

  // CAGR calculation if time data available
  let cagrPct = 0;
  const firstEntry = trades[0]?.entryTime;
  const lastExit = trades[trades.length - 1]?.exitTime;
  if (firstEntry && lastExit) {
    const durationMs = Date.parse(lastExit) - Date.parse(firstEntry);
    const years = durationMs / (365.25 * 24 * 60 * 60 * 1000);
    if (years > 0 && equity > 0) {
      cagrPct = (Math.pow(equity, 1 / years) - 1) * 100;
    }
  }

  return {
    compoundedRoiPct: Number(compoundedRoiPct.toFixed(4)),
    maxDrawdownPct: Number((maxDrawdownFraction * 100).toFixed(4)),
    cagrPct: Number.isFinite(cagrPct) ? Number(cagrPct.toFixed(4)) : 0,
    equityCurve,
    tradeCount: trades.length,
    finalEquity: Number(equity.toFixed(6)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-metric-core-v2.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Run existing metric tests for regression**

Run: `node --test tests/pine-optimizer.test.mjs`
Expected: All existing tests still PASS (we only added, didn't modify)

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-metric-core.mjs tests/pine-metric-core-v2.test.mjs
git commit -m "feat: add compounded ROI and equity-curve drawdown calculation"
```

---

### Task 8: Consolidate Duplicate Metrics & Fix tradePenalty

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs`
- Modify: `scripts/lib/pine-metric-core.mjs`

- [ ] **Step 1: Write test proving the inconsistency**

```javascript
// Append to tests/pine-metric-core-v2.test.mjs
import { scoreMetricsBreakdown as coreBreakdown } from '../scripts/lib/pine-metric-core.mjs';

describe('tradePenalty consistency after consolidation', () => {
  it('pine-optimizer delegates to pine-metric-core for scoring', async () => {
    // After consolidation, pine-optimizer should re-export from pine-metric-core
    const optimizer = await import('../scripts/lib/pine-optimizer.mjs');
    const metrics = { roiPct: 10, winRatePct: 55, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 5 };
    const coreResult = coreBreakdown(metrics, { minTrades: 10 });
    const optimizerResult = optimizer.scoreMetricsBreakdown(metrics, { minTrades: 10 });
    assert.equal(coreResult.tradePenalty, optimizerResult.tradePenalty);
    assert.equal(coreResult.total, optimizerResult.total);
  });

  it('tradePenalty is linear: 5 points per missing trade', () => {
    const metrics = { roiPct: 10, winRatePct: 55, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 7 };
    const result = coreBreakdown(metrics, { minTrades: 10 });
    // 7 trades, need 10, missing 3 => penalty = 3 * 5 = 15
    assert.equal(result.tradePenalty, -15);
  });

  it('tradePenalty is 0 when tradeCount >= minTrades', () => {
    const metrics = { roiPct: 10, winRatePct: 55, profitFactor: 1.5, maxDrawdownPct: 5, tradeCount: 15 };
    const result = coreBreakdown(metrics, { minTrades: 10 });
    assert.equal(result.tradePenalty, 0);
  });
});
```

- [ ] **Step 2: Run test to confirm inconsistency exists**

Run: `node --test tests/pine-metric-core-v2.test.mjs`
Expected: FAIL — optimizer has its own scoring, tradePenalty formula differs

- [ ] **Step 3: Standardize tradePenalty in pine-metric-core.mjs**

In `scripts/lib/pine-metric-core.mjs`, update `scoreMetricsBreakdown`:

```javascript
// Replace the tradePenalty calculation with:
const tradePenalty = metrics.tradeCount >= minTrades
  ? 0
  : (metrics.tradeCount - minTrades) * 5; // negative: 5 points per missing trade
```

- [ ] **Step 4: Remove duplicate scoring from pine-optimizer.mjs**

In `scripts/lib/pine-optimizer.mjs`, replace local `scoreMetricsBreakdown` and `scoreMetrics` with imports:

```javascript
// At top of pine-optimizer.mjs, add/replace:
import { calculateMetrics, scoreMetrics, scoreMetricsBreakdown } from './pine-metric-core.mjs';

// Remove the local calculateMetrics function definition
// Remove the local scoreMetricsBreakdown function definition
// Remove the local scoreMetrics function definition
// Keep the re-export:
export { calculateMetrics, scoreMetrics, scoreMetricsBreakdown };
```

- [ ] **Step 5: Run all tests**

Run: `node --test tests/pine-metric-core-v2.test.mjs tests/pine-optimizer.test.mjs`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-metric-core.mjs scripts/lib/pine-optimizer.mjs tests/pine-metric-core-v2.test.mjs
git commit -m "fix: consolidate duplicate calculateMetrics, standardize tradePenalty formula"
```

---

### Task 9: Align Streaming Metrics with New Simulator Output

**Files:**
- Modify: `scripts/lib/pine-streaming-metrics.mjs`
- Modify: `tests/pine-streaming-metrics.test.mjs`

- [ ] **Step 1: Write test for streaming/simulator consistency**

```javascript
// Append to tests/pine-streaming-metrics.test.mjs
describe('streaming metrics consistency with pine-simulator', () => {
  it('produces same trade shape fields as pine-simulator', () => {
    // The streaming metrics module processes trades incrementally.
    // After the simulator change, trade objects include:
    // grossReturnPct, costPct, returnPctExact, mfePct, maePct
    // Streaming metrics must handle these fields without error.
    const trade = {
      side: 'long',
      entryPrice: 100,
      exitPrice: 105,
      returnPctExact: 4.87, // after cost
      grossReturnPct: 5.0,
      costPct: 0.13,
      exitReason: 'takeProfit',
      mfePct: 6.2,
      maePct: 1.1,
      holdBars: 5,
      entryTime: '2026-01-01T00:00:00Z',
      exitTime: '2026-01-01T01:15:00Z',
    };
    // Streaming metrics should use returnPctExact (net) for calculations
    const result = processStreamingTrade(trade);
    assert.ok(Number.isFinite(result.cumulativeReturnPct));
    assert.equal(result.lastTradeReturnPct, 4.87); // uses net, not gross
  });

  it('falls back to returnPct when returnPctExact missing', () => {
    const trade = { side: 'long', returnPct: 3.5, exitReason: 'time' };
    const result = processStreamingTrade(trade);
    assert.equal(result.lastTradeReturnPct, 3.5);
  });
});
```

- [ ] **Step 2: Run test to check current behavior**

Run: `node --test tests/pine-streaming-metrics.test.mjs`
Expected: May PASS or FAIL depending on whether `processStreamingTrade` exists. Inspect and adapt.

- [ ] **Step 3: Update streaming metrics to prefer returnPctExact**

In `scripts/lib/pine-streaming-metrics.mjs`, ensure all trade return references use:

```javascript
function getTradeReturn(trade) {
  if (Number.isFinite(trade?.returnPctExact)) return trade.returnPctExact;
  if (Number.isFinite(trade?.returnPct)) return trade.returnPct;
  return 0;
}
```

Replace any direct `trade.returnPct` references with `getTradeReturn(trade)`.

- [ ] **Step 4: Run all streaming metrics tests**

Run: `node --test tests/pine-streaming-metrics.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-streaming-metrics.mjs tests/pine-streaming-metrics.test.mjs
git commit -m "fix: align streaming metrics with new simulator trade shape (returnPctExact)"
```

---

### Phase 2 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL tests PASS. The metric consolidation in Task 8 is the riskiest change — verify carefully.

---

## Phase 3: Fix Statistical Significance & Scoring

### Task 10: Implement Bootstrap Significance with Seeded RNG

**Files:**
- Create: `scripts/lib/pine-statistical-significance.mjs`
- Create: `tests/pine-statistical-significance.test.mjs`

- [ ] **Step 1: Write failing tests for bootstrap significance (deterministic)**

```javascript
// tests/pine-statistical-significance.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapMeanDifference,
  permutationTest,
  isStatisticallySignificant,
  createSeededRng,
} from '../scripts/lib/pine-statistical-significance.mjs';

describe('pine-statistical-significance', () => {
  describe('createSeededRng', () => {
    it('produces deterministic sequence from same seed', () => {
      const rng1 = createSeededRng(42);
      const rng2 = createSeededRng(42);
      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());
      assert.deepEqual(seq1, seq2);
    });

    it('produces different sequence from different seed', () => {
      const rng1 = createSeededRng(42);
      const rng2 = createSeededRng(99);
      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());
      assert.notDeepEqual(seq1, seq2);
    });

    it('produces values in [0, 1) range', () => {
      const rng = createSeededRng(123);
      for (let i = 0; i < 1000; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1);
      }
    });
  });

  describe('bootstrapMeanDifference', () => {
    it('returns significant for clearly different groups (seeded)', () => {
      const groupA = Array.from({ length: 100 }, (_, i) => 1.0 + (i % 10) * 0.02);
      const groupB = Array.from({ length: 100 }, (_, i) => 2.0 + (i % 10) * 0.02);
      const result = bootstrapMeanDifference(groupA, groupB, { iterations: 1000, seed: 42 });
      assert.ok(result.lowerBound > 0);
      assert.ok(result.upperBound > result.lowerBound);
      assert.ok(result.meanDifference > 0.8);
      assert.equal(result.significant, true);
    });

    it('returns non-significant for overlapping distributions (seeded)', () => {
      const groupA = Array.from({ length: 50 }, (_, i) => 1.0 + (i % 50) * 0.1);
      const groupB = Array.from({ length: 50 }, (_, i) => 1.05 + (i % 50) * 0.1);
      const result = bootstrapMeanDifference(groupA, groupB, { iterations: 1000, seed: 42 });
      // Very small difference relative to spread — CI should contain 0
      assert.equal(result.significant, false);
    });

    it('is deterministic with same seed', () => {
      const groupA = Array.from({ length: 30 }, (_, i) => i * 0.1);
      const groupB = Array.from({ length: 30 }, (_, i) => i * 0.1 + 0.5);
      const r1 = bootstrapMeanDifference(groupA, groupB, { iterations: 500, seed: 77 });
      const r2 = bootstrapMeanDifference(groupA, groupB, { iterations: 500, seed: 77 });
      assert.equal(r1.lowerBound, r2.lowerBound);
      assert.equal(r1.upperBound, r2.upperBound);
    });
  });

  describe('permutationTest', () => {
    it('returns low p-value for clearly different groups (seeded)', () => {
      const groupA = Array.from({ length: 50 }, (_, i) => 1.0 + (i % 5) * 0.02);
      const groupB = Array.from({ length: 50 }, (_, i) => 2.0 + (i % 5) * 0.02);
      const result = permutationTest(groupA, groupB, { iterations: 1000, seed: 42 });
      assert.ok(result.pValue < 0.05);
      assert.equal(result.significant, true);
    });

    it('returns high p-value for same distribution (seeded)', () => {
      const all = Array.from({ length: 100 }, (_, i) => i * 0.01);
      const groupA = all.slice(0, 50);
      const groupB = all.slice(50);
      const result = permutationTest(groupA, groupB, { iterations: 1000, seed: 42 });
      // Interleaved values — means are different but it's just ordering
      // Actually slice(0,50) has mean ~0.245, slice(50) has mean ~0.745
      // These ARE different. Use shuffled instead:
      const shuffled = all.sort(() => 0); // same order
      const gA = shuffled.filter((_, i) => i % 2 === 0);
      const gB = shuffled.filter((_, i) => i % 2 === 1);
      const result2 = permutationTest(gA, gB, { iterations: 1000, seed: 42 });
      assert.ok(result2.pValue > 0.05);
      assert.equal(result2.significant, false);
    });

    it('is deterministic with same seed', () => {
      const groupA = [1, 2, 3, 4, 5];
      const groupB = [6, 7, 8, 9, 10];
      const r1 = permutationTest(groupA, groupB, { iterations: 500, seed: 99 });
      const r2 = permutationTest(groupA, groupB, { iterations: 500, seed: 99 });
      assert.equal(r1.pValue, r2.pValue);
    });
  });

  describe('isStatisticallySignificant', () => {
    it('combines bootstrap CI and permutation test', () => {
      const incumbentReturns = Array.from({ length: 80 }, (_, i) => 0.1 + (i % 8) * 0.01);
      const challengerReturns = Array.from({ length: 80 }, (_, i) => 0.3 + (i % 8) * 0.01);
      const result = isStatisticallySignificant(incumbentReturns, challengerReturns, { seed: 42 });
      assert.equal(result.significant, true);
      assert.ok(result.bootstrapCI.lowerBound > 0);
      assert.ok(result.permutation.pValue < 0.05);
    });

    it('rejects when sample too small', () => {
      const result = isStatisticallySignificant([1, 2], [3, 4], { minSampleSize: 10, seed: 42 });
      assert.equal(result.significant, false);
      assert.equal(result.reason, 'insufficient_sample');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-statistical-significance.test.mjs`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement bootstrap and permutation with seeded RNG**

```javascript
// scripts/lib/pine-statistical-significance.mjs

// Mulberry32 — fast, deterministic 32-bit PRNG
export function createSeededRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleWithReplacement(arr, size, rng) {
  const result = new Array(size);
  for (let i = 0; i < size; i++) {
    result[i] = arr[Math.floor(rng() * arr.length)];
  }
  return result;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function bootstrapMeanDifference(groupA, groupB, options = {}) {
  const iterations = options.iterations ?? 2000;
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const alpha = 1 - confidenceLevel;
  const rng = createSeededRng(options.seed ?? Date.now());

  const observedDiff = mean(groupB) - mean(groupA);
  const diffs = new Array(iterations);

  for (let i = 0; i < iterations; i++) {
    const sampleA = sampleWithReplacement(groupA, groupA.length, rng);
    const sampleB = sampleWithReplacement(groupB, groupB.length, rng);
    diffs[i] = mean(sampleB) - mean(sampleA);
  }

  diffs.sort((a, b) => a - b);
  const lowerBound = Number(percentile(diffs, alpha / 2).toFixed(6));
  const upperBound = Number(percentile(diffs, 1 - alpha / 2).toFixed(6));
  const significant = lowerBound > 0 || upperBound < 0;

  return {
    meanDifference: Number(observedDiff.toFixed(6)),
    lowerBound,
    upperBound,
    confidenceLevel,
    iterations,
    significant,
  };
}

export function permutationTest(groupA, groupB, options = {}) {
  const iterations = options.iterations ?? 2000;
  const alpha = options.alpha ?? 0.05;
  const rng = createSeededRng(options.seed ?? Date.now());

  const observedDiff = Math.abs(mean(groupB) - mean(groupA));
  const combined = [...groupA, ...groupB];
  const nA = groupA.length;
  let extremeCount = 0;

  for (let i = 0; i < iterations; i++) {
    // Fisher-Yates partial shuffle
    const shuffled = [...combined];
    for (let j = 0; j < nA; j++) {
      const k = j + Math.floor(rng() * (shuffled.length - j));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const permDiff = Math.abs(mean(shuffled.slice(nA)) - mean(shuffled.slice(0, nA)));
    if (permDiff >= observedDiff) extremeCount++;
  }

  const pValue = Number(((extremeCount + 1) / (iterations + 1)).toFixed(6));
  return {
    pValue,
    observedDifference: Number(observedDiff.toFixed(6)),
    iterations,
    significant: pValue < alpha,
    alpha,
  };
}

export function isStatisticallySignificant(incumbentReturns, challengerReturns, options = {}) {
  const minSampleSize = options.minSampleSize ?? 20;
  const iterations = options.iterations ?? 2000;
  const confidenceLevel = options.confidenceLevel ?? 0.95;
  const alpha = options.alpha ?? 0.05;
  const seed = options.seed ?? Date.now();

  if (incumbentReturns.length < minSampleSize || challengerReturns.length < minSampleSize) {
    return {
      significant: false,
      reason: 'insufficient_sample',
      incumbentN: incumbentReturns.length,
      challengerN: challengerReturns.length,
      minSampleSize,
    };
  }

  const bootstrapCI = bootstrapMeanDifference(incumbentReturns, challengerReturns, {
    iterations, confidenceLevel, seed,
  });

  const permutation = permutationTest(incumbentReturns, challengerReturns, {
    iterations, alpha, seed: seed + 1, // different seed for independence
  });

  const significant = bootstrapCI.significant && permutation.significant;

  return {
    significant,
    reason: significant ? 'statistically_significant' : 'not_significant',
    bootstrapCI,
    permutation,
    incumbentN: incumbentReturns.length,
    challengerN: challengerReturns.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-statistical-significance.test.mjs`
Expected: All tests PASS deterministically (seeded RNG)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-statistical-significance.mjs tests/pine-statistical-significance.test.mjs
git commit -m "feat: add bootstrap CI and permutation test with seeded RNG for determinism"
```

---

### Task 11: Replace Significance Gate with Statistical Mode

**Files:**
- Modify: `scripts/lib/pine-significance-gate.mjs`
- Modify: `tests/pine-significance-gate.test.mjs`

- [ ] **Step 1: Write failing tests for statistical significance gate**

```javascript
// Append to tests/pine-significance-gate.test.mjs
describe('decideSignificanceGate v2 - statistical mode', () => {
  it('passes when trade returns are statistically different (seeded)', () => {
    const incumbent = {
      score: 50,
      metrics: { tradeCount: 100 },
      tradeReturns: Array.from({ length: 100 }, (_, i) => 0.1 + (i % 10) * 0.01),
    };
    const challenger = {
      score: 55,
      metrics: { tradeCount: 100 },
      tradeReturns: Array.from({ length: 100 }, (_, i) => 0.5 + (i % 10) * 0.01),
    };
    const result = decideSignificanceGate({
      incumbent, challenger,
      policy: { mode: 'statistical', minTradeCount: 20, seed: 42 },
    });
    assert.equal(result.passed, true);
    assert.equal(result.reason, 'statistically_significant');
    assert.ok(result.statistical);
    assert.ok(result.statistical.bootstrapCI);
    assert.ok(result.statistical.permutation);
  });

  it('fails when trade returns are not statistically different (seeded)', () => {
    // Interleaved values from same distribution
    const base = Array.from({ length: 80 }, (_, i) => 0.2 + (i % 40) * 0.01);
    const incumbent = {
      score: 50,
      metrics: { tradeCount: 40 },
      tradeReturns: base.filter((_, i) => i % 2 === 0),
    };
    const challenger = {
      score: 51,
      metrics: { tradeCount: 40 },
      tradeReturns: base.filter((_, i) => i % 2 === 1),
    };
    const result = decideSignificanceGate({
      incumbent, challenger,
      policy: { mode: 'statistical', minTradeCount: 20, seed: 42 },
    });
    assert.equal(result.passed, false);
  });

  it('falls back to legacy mode when tradeReturns not provided', () => {
    const incumbent = { score: 50, metrics: { tradeCount: 150 } };
    const challenger = { score: 55, metrics: { tradeCount: 150 } };
    const result = decideSignificanceGate({
      incumbent, challenger,
      policy: { mode: 'statistical', minTradeCount: 100, minRelativeScoreDelta: 0.02 },
    });
    assert.equal(result.passed, true);
  });

  it('legacy mode still works when mode not set', () => {
    const incumbent = { score: 100, metrics: { tradeCount: 200 } };
    const challenger = { score: 103, metrics: { tradeCount: 200 } };
    const result = decideSignificanceGate({
      incumbent, challenger,
      policy: { minRelativeScoreDelta: 0.02, minTradeCount: 100 },
    });
    assert.equal(result.passed, true);
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `node --test tests/pine-significance-gate.test.mjs`
Expected: New `statistical mode` tests FAIL

- [ ] **Step 3: Extend significance gate with statistical mode**

At top of `scripts/lib/pine-significance-gate.mjs`, add import:

```javascript
import { isStatisticallySignificant } from './pine-statistical-significance.mjs';
```

Inside `decideSignificanceGate`, add statistical branch before existing legacy logic:

```javascript
// After normalizing input, before existing logic:
const mode = policy?.mode ?? 'legacy';

if (mode === 'statistical') {
  const incumbentReturns = incumbent.tradeReturns;
  const challengerReturns = challenger.tradeReturns;
  const minTradeCount = policy.minTradeCount ?? 20;

  if (Array.isArray(incumbentReturns) && Array.isArray(challengerReturns)
      && incumbentReturns.length >= minTradeCount
      && challengerReturns.length >= minTradeCount) {
    const result = isStatisticallySignificant(incumbentReturns, challengerReturns, {
      minSampleSize: minTradeCount,
      iterations: policy.bootstrapIterations ?? 2000,
      confidenceLevel: policy.confidenceLevel ?? 0.95,
      alpha: policy.alpha ?? 0.05,
      seed: policy.seed ?? Date.now(),
    });

    return {
      passed: result.significant,
      reason: result.significant ? 'statistically_significant' : 'not_statistically_significant',
      relativeScoreDelta: null,
      statistical: result,
    };
  }
  // Fall through to legacy if tradeReturns not available
}

// --- existing legacy logic below (unchanged) ---
```

- [ ] **Step 4: Run all significance gate tests**

Run: `node --test tests/pine-significance-gate.test.mjs`
Expected: All tests PASS (both legacy and new statistical)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-significance-gate.mjs tests/pine-significance-gate.test.mjs
git commit -m "feat: add statistical significance mode (bootstrap + permutation) to gate"
```

---

### Task 12: Unify Scoring — Single Authoritative Score

**Files:**
- Modify: `scripts/lib/pine-objective-function.mjs`

The problem: `scoreMetrics` (search ranking) and `computeCandidateUtility` (objective gates) use different weights. Search optimizes one thing but promotion checks another. After unification, `computeCandidateUtility` uses `scoreMetrics` as its base, with adjustments layered on top.

- [ ] **Step 1: Write test for unified scoring behavior**

```javascript
// Append to tests/pine-objective-function.test.mjs
describe('scoring unification', () => {
  it('computeCandidateUtility uses scoreMetrics as base component', () => {
    const metrics = { roiPct: 30, winRatePct: 55, profitFactor: 1.8, maxDrawdownPct: 10, tradeCount: 150, expectancy: 0.3 };
    const { utility, components } = computeCandidateUtility(metrics);
    const baseScore = scoreMetrics(metrics);
    assert.equal(components.baseScore, baseScore);
    // utility = baseScore + adjustments (all zero when no adjustments passed)
    assert.equal(utility, baseScore);
  });

  it('adjustments modify utility relative to base', () => {
    const metrics = { roiPct: 30, winRatePct: 55, profitFactor: 1.8, maxDrawdownPct: 10, tradeCount: 150, expectancy: 0.3 };
    const baseScore = scoreMetrics(metrics);
    const { utility } = computeCandidateUtility(metrics, {
      robustnessBonus: 5,
      multipleTestingPenalty: 3,
    });
    assert.equal(utility, baseScore + 5 - 3);
  });

  it('evaluateObjectiveGates uses scoreMetrics for comparison', () => {
    const incumbent = { roiPct: 25, winRatePct: 55, profitFactor: 1.5, maxDrawdownPct: 8, tradeCount: 150 };
    const candidate = { roiPct: 30, winRatePct: 58, profitFactor: 1.8, maxDrawdownPct: 7, tradeCount: 160 };
    const result = evaluateObjectiveGates({ incumbent, candidate, policy: { minRoiPct: 25 } });
    assert.equal(result.pass, true);
    assert.ok(result.comparisons.scoreDelta > 0);
  });
});
```

- [ ] **Step 2: Run test to confirm current divergence**

Run: `node --test tests/pine-objective-function.test.mjs`
Expected: FAIL — `computeCandidateUtility` doesn't have `baseScore` component

- [ ] **Step 3: Refactor computeCandidateUtility to use scoreMetrics as base**

```javascript
// In pine-objective-function.mjs, replace computeCandidateUtility:
import { scoreMetrics } from './pine-metric-core.mjs';

export function computeCandidateUtility(metrics = {}, adjustments = {}) {
  const {
    multipleTestingPenalty = 0,
    complexityPenalty = 0,
    robustnessBonus = 0,
    targetRegimeImprovement = 0,
  } = adjustments;

  const baseScore = scoreMetrics(metrics);
  const utility = baseScore + robustnessBonus + targetRegimeImprovement - complexityPenalty - multipleTestingPenalty;

  return {
    utility,
    components: {
      baseScore,
      robustnessBonus,
      targetRegimeImprovement,
      complexityPenalty,
      multipleTestingPenalty,
    },
  };
}
```

- [ ] **Step 4: Update evaluateObjectiveGates to use scoreMetrics**

```javascript
export function evaluateObjectiveGates({ incumbent = {}, candidate = {}, policy = {} } = {}) {
  const failedGates = [];
  const candidateScore = scoreMetrics(candidate);
  const incumbentScore = scoreMetrics(incumbent);
  const scoreDelta = candidateScore - incumbentScore;

  const roiPct = number(candidate.roiPct);
  const drawdownDeltaPct = number(candidate.maxDrawdownPct) - number(incumbent.maxDrawdownPct);
  const candidateTradeCount = Math.max(0, number(candidate.tradeCount));
  const incumbentTradeCount = Math.max(0, number(incumbent.tradeCount));
  const tradeRatioVsIncumbent = incumbentTradeCount <= 0
    ? (candidateTradeCount > 0 ? Number.POSITIVE_INFINITY : 0)
    : candidateTradeCount / incumbentTradeCount;

  if (roiPct < number(policy.minRoiPct, 25)) failedGates.push('roiFloor');
  if (scoreDelta < number(policy.minScoreDelta, 0)) failedGates.push('scoreRegression');
  if (drawdownDeltaPct > number(policy.maxDrawdownDeltaPct, 0.75)) failedGates.push('drawdownRegression');
  if (tradeRatioVsIncumbent < number(policy.minTradeRatioVsIncumbent, 0.8)) failedGates.push('tradeCountRegression');

  return {
    pass: failedGates.length === 0,
    failedGates,
    comparisons: { scoreDelta, drawdownDeltaPct, tradeRatioVsIncumbent, roiPct },
  };
}
```

- [ ] **Step 5: Run all objective function tests**

Run: `node --test tests/pine-objective-function.test.mjs`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-objective-function.mjs tests/pine-objective-function.test.mjs
git commit -m "feat: unify scoring — computeCandidateUtility delegates to scoreMetrics"
```

---

### Task 13: Strengthen Multiple Testing Penalty

**Files:**
- Modify: `scripts/lib/pine-objective-function.mjs`
- Modify: `tests/pine-objective-function.test.mjs`

Current penalty is negligible (~0.58 after 100 candidates). Needs meaningful scaling.

- [ ] **Step 1: Write test for stronger penalty**

```javascript
// Append to tests/pine-objective-function.test.mjs
describe('computeMultipleTestingPenalty v2', () => {
  it('penalty at 100 candidates with 5 families is meaningful', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 100, mutationFamilyCount: 5, regimeSliceCount: 1, exitFamilyCount: 3 },
      { base: 1.0, step: 0.3 },
    );
    // log2(100) = 6.64, familyBreadth = (5-1)+(1-1)+(3-1) = 6
    // penalty = 1.0 + (6.64 + 6) * 0.3 = 1.0 + 3.79 = 4.79
    assert.ok(penalty >= 4, `penalty ${penalty} should be >= 4`);
    assert.ok(penalty <= 6, `penalty ${penalty} should be <= 6`);
  });

  it('penalty at 500 candidates with 8 families is substantial', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 500, mutationFamilyCount: 8, regimeSliceCount: 3, exitFamilyCount: 5 },
      { base: 1.0, step: 0.3 },
    );
    // log2(500) = 8.97, familyBreadth = (8-1)+(3-1)+(5-1) = 13
    // penalty = 1.0 + (8.97 + 13) * 0.3 = 1.0 + 6.59 = 7.59
    assert.ok(penalty >= 7, `penalty ${penalty} should be >= 7`);
    assert.ok(penalty <= 9, `penalty ${penalty} should be <= 9`);
  });

  it('penalty at 1 candidate is minimal', () => {
    const penalty = computeMultipleTestingPenalty(
      { attemptedCandidates: 1, mutationFamilyCount: 1, regimeSliceCount: 1, exitFamilyCount: 1 },
      { base: 1.0, step: 0.3 },
    );
    // log2(1) = 0, familyBreadth = 0
    // penalty = 1.0 + 0 * 0.3 = 1.0
    assert.ok(penalty >= 1);
    assert.ok(penalty <= 1.5);
  });
});
```

- [ ] **Step 2: Run test to confirm current penalty is too weak**

Run: `node --test tests/pine-objective-function.test.mjs`
Expected: FAIL on "penalty >= 4" (current formula gives ~0.58 with old defaults)

- [ ] **Step 3: Update penalty formula**

```javascript
// In pine-objective-function.mjs, replace computeMultipleTestingPenalty:
export function computeMultipleTestingPenalty(context = {}, policy = {}) {
  const attempted = Math.max(1, number(context.attemptedCandidates, 1));
  const familyBreadth =
    Math.max(0, number(context.mutationFamilyCount, 0) - 1) +
    Math.max(0, number(context.regimeSliceCount, 0) - 1) +
    Math.max(0, number(context.exitFamilyCount, 0) - 1);

  const base = Math.max(0, number(policy.base, 1.0));
  const step = Math.max(0, number(policy.step, 0.3));

  const breadth = Math.log2(attempted) + familyBreadth;
  return Math.max(0, Number((base + breadth * step).toFixed(4)));
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-objective-function.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-objective-function.mjs tests/pine-objective-function.test.mjs
git commit -m "fix: strengthen multiple testing penalty to meaningful levels"
```

---

### Phase 3 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL tests PASS. The scoring unification (Task 12) and penalty change (Task 13) may require updating existing test expectations that relied on old scoring weights.

---

## Phase 4: Fix Search Policy & Overfitting Defenses

### Task 14: Cap Annealing Temperature & Fix Tabu Reset

**Files:**
- Modify: `scripts/lib/pine-search-policy.mjs`
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `config/pine-autoresearch.default.json`

- [ ] **Step 1: Write test for annealing temperature cap**

```javascript
// Append to tests/pine-search-policy.test.mjs
describe('annealing temperature cap (v2 config)', () => {
  it('temperature never exceeds 4 regardless of streak', () => {
    const state = computeAnnealingState({
      schedulerState: { noChangeStreak: 50 },
      policy: { annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.5, maxTemperature: 4 } },
    });
    assert.ok(state.temperature <= 4, `temperature ${state.temperature} exceeds cap`);
  });

  it('temperature at streak 5 is capped at 4', () => {
    const state = computeAnnealingState({
      schedulerState: { noChangeStreak: 5 },
      policy: { annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.5, maxTemperature: 4 } },
    });
    // 0.4 * 1.5^5 = 3.04 (under cap)
    assert.ok(state.temperature > 2.5 && state.temperature < 4);
  });

  it('temperature at streak 8 is capped at 4', () => {
    const state = computeAnnealingState({
      schedulerState: { noChangeStreak: 8 },
      policy: { annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.5, maxTemperature: 4 } },
    });
    // 0.4 * 1.5^8 = 10.25, capped at 4
    assert.equal(state.temperature, 4);
  });
});
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `node --test tests/pine-search-policy.test.mjs`
Expected: Tests PASS (code already caps at maxTemperature — the issue is the config value of 16)

- [ ] **Step 3: Write test for tabu retention on champion change**

```javascript
// Append to tests/pine-autoresearch-tracks.test.mjs
describe('tabu retention on champion change (v2 policy)', () => {
  it('retains all tabu entries when dropOnChampionChange=false', () => {
    const entries = [
      { fingerprint: 'aaa', addedAtCycle: 5, championFingerprint: 'old-champ' },
      { fingerprint: 'bbb', addedAtCycle: 6, championFingerprint: 'old-champ' },
      { fingerprint: 'ccc', addedAtCycle: 7, championFingerprint: 'old-champ' },
    ];
    const result = pruneTabuFingerprints({
      entries,
      currentCycle: 8,
      currentChampionFingerprint: 'new-champ',
      policy: { maxAgeCycles: 20, maxEntries: 40, dropOnChampionChange: false },
    });
    assert.equal(result.length, 3);
  });

  it('still respects maxAgeCycles even with retention', () => {
    const entries = [
      { fingerprint: 'old', addedAtCycle: 1, championFingerprint: 'old-champ' },
      { fingerprint: 'recent', addedAtCycle: 18, championFingerprint: 'old-champ' },
    ];
    const result = pruneTabuFingerprints({
      entries,
      currentCycle: 22,
      currentChampionFingerprint: 'new-champ',
      policy: { maxAgeCycles: 20, maxEntries: 40, dropOnChampionChange: false },
    });
    // 'old' is 21 cycles old (> maxAgeCycles=20), should be pruned
    assert.equal(result.length, 1);
    assert.equal(result[0].fingerprint, 'recent');
  });
});
```

- [ ] **Step 4: Run tabu tests**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs`
Expected: Tests should PASS if `pruneTabuFingerprints` already respects `dropOnChampionChange`. If not, implement the flag check.

- [ ] **Step 5: Update config defaults**

In `config/pine-autoresearch.default.json`, update:

```json
"annealing": {
  "enabled": true,
  "baseTemperature": 0.4,
  "growthFactor": 1.5,
  "maxTemperature": 4
},
"tabuPolicy": {
  "maxAgeCycles": 30,
  "maxEntries": 60,
  "maxSameCycleEntries": 24,
  "dropOnChampionChange": false
}
```

Also add config version and feature flags:

```json
"configVersion": 2,
"featureFlags": {
  "USE_NEXT_BAR_OPEN_ENTRY": false,
  "USE_COMPOUNDED_METRICS": false,
  "USE_COST_MODEL": false,
  "USE_STATISTICAL_SIGNIFICANCE": false,
  "USE_WALK_FORWARD_GATE": false,
  "USE_DATA_QUALITY_GATE": false,
  "USE_UNIFIED_SCORING": false
},
"costModel": {
  "enabled": false,
  "commissionPct": 0.04,
  "slippagePct": 0.02,
  "spreadPct": 0.01,
  "slippageStopMultiplier": 2.5
},
"multipleTestingPolicy": {
  "base": 1.0,
  "step": 0.3
}
```

- [ ] **Step 6: Verify config is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('./config/pine-autoresearch.default.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 7: Run all affected tests**

Run: `node --test tests/pine-search-policy.test.mjs tests/pine-autoresearch-tracks.test.mjs`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pine-search-policy.mjs scripts/lib/pine-autoresearch-tracks.mjs config/pine-autoresearch.default.json
git commit -m "fix: cap annealing at 4, retain tabu on champion change, add v2 config fields"
```

---

### Task 15: Add Quality-Aware Convergence to Stagnation Escape

**Files:**
- Modify: `scripts/lib/pine-stagnation-escape.mjs`
- Modify: `tests/pine-stagnation-escape.test.mjs`

The current stagnation escape only widens search — it never concludes "the champion is near-optimal." This task adds convergence acceptance that also checks champion absolute quality (a converged bad strategy should NOT be accepted).

- [ ] **Step 1: Write failing tests for quality-aware convergence**

```javascript
// Append to tests/pine-stagnation-escape.test.mjs
describe('stagnation escape - quality-aware convergence', () => {
  it('returns converged when at max level, all exhausted, and champion quality sufficient', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 6,
      generatedLanesExhausted: true,
      exploitExhausted: true,
      zeroEmissionExhausted: true,
      gateStagnation: true,
      convergencePolicy: { enabled: true, maxStagnationLevel: 6 },
      championQuality: { roiPct: 35, profitFactor: 1.8, maxDrawdownPct: 12, tradeCount: 200 },
      qualityFloors: { minRoiPct: 15, minProfitFactor: 1.2, maxDrawdownPct: 25, minTradeCount: 50 },
    });
    assert.equal(result.mode, 'converged');
    assert.equal(result.reason, 'convergence-accepted');
    assert.equal(result.recommendation, 'stop-research');
  });

  it('does NOT converge when champion quality is below floors', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 6,
      generatedLanesExhausted: true,
      exploitExhausted: true,
      zeroEmissionExhausted: true,
      gateStagnation: true,
      convergencePolicy: { enabled: true, maxStagnationLevel: 6 },
      championQuality: { roiPct: 5, profitFactor: 0.9, maxDrawdownPct: 30, tradeCount: 200 },
      qualityFloors: { minRoiPct: 15, minProfitFactor: 1.2, maxDrawdownPct: 25, minTradeCount: 50 },
    });
    assert.notEqual(result.mode, 'converged');
    // Should continue searching despite exhaustion — champion is bad
    assert.ok(result.qualityGatesFailed);
    assert.ok(result.qualityGatesFailed.includes('roiFloor'));
    assert.ok(result.qualityGatesFailed.includes('profitFactorFloor'));
  });

  it('does not converge below max stagnation level', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 4,
      generatedLanesExhausted: true,
      exploitExhausted: true,
      zeroEmissionExhausted: true,
      convergencePolicy: { enabled: true, maxStagnationLevel: 6 },
      championQuality: { roiPct: 35, profitFactor: 1.8, maxDrawdownPct: 12, tradeCount: 200 },
      qualityFloors: { minRoiPct: 15, minProfitFactor: 1.2, maxDrawdownPct: 25, minTradeCount: 50 },
    });
    assert.notEqual(result.mode, 'converged');
  });

  it('does not converge when convergence policy disabled', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 6,
      generatedLanesExhausted: true,
      exploitExhausted: true,
      zeroEmissionExhausted: true,
      convergencePolicy: { enabled: false },
      championQuality: { roiPct: 35, profitFactor: 1.8, maxDrawdownPct: 12, tradeCount: 200 },
      qualityFloors: { minRoiPct: 15, minProfitFactor: 1.2, maxDrawdownPct: 25, minTradeCount: 50 },
    });
    assert.notEqual(result.mode, 'converged');
  });

  it('does not converge when trade count below floor', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 6,
      generatedLanesExhausted: true,
      exploitExhausted: true,
      zeroEmissionExhausted: true,
      convergencePolicy: { enabled: true, maxStagnationLevel: 6 },
      championQuality: { roiPct: 35, profitFactor: 1.8, maxDrawdownPct: 12, tradeCount: 30 },
      qualityFloors: { minRoiPct: 15, minProfitFactor: 1.2, maxDrawdownPct: 25, minTradeCount: 50 },
    });
    assert.notEqual(result.mode, 'converged');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-stagnation-escape.test.mjs`
Expected: FAIL — `converged` mode not implemented, `championQuality` not accepted

- [ ] **Step 3: Add quality-aware convergence to stagnation escape**

Modify `scripts/lib/pine-stagnation-escape.mjs`:

```javascript
function checkQualityFloors(championQuality, qualityFloors) {
  if (!championQuality || !qualityFloors) return { passed: true, failed: [] };
  const failed = [];
  const q = championQuality;
  const f = qualityFloors;

  if (Number.isFinite(f.minRoiPct) && (q.roiPct ?? 0) < f.minRoiPct) failed.push('roiFloor');
  if (Number.isFinite(f.minProfitFactor) && (q.profitFactor ?? 0) < f.minProfitFactor) failed.push('profitFactorFloor');
  if (Number.isFinite(f.maxDrawdownPct) && (q.maxDrawdownPct ?? 100) > f.maxDrawdownPct) failed.push('drawdownCeiling');
  if (Number.isFinite(f.minTradeCount) && (q.tradeCount ?? 0) < f.minTradeCount) failed.push('tradeCountFloor');

  return { passed: failed.length === 0, failed };
}

export function decideStagnationEscapePlan(input = {}) {
  const {
    stagnationLevel = 0,
    generatedLanesExhausted = false,
    exploitExhausted = false,
    zeroEmissionExhausted = false,
    gateStagnation = false,
    convergencePolicy = {},
    championQuality = null,
    qualityFloors = null,
  } = normalizeInput(input);

  const level = Number(stagnationLevel);
  const safeLevel = Number.isFinite(level) ? level : 0;
  const generatedExhausted = isTruthy(generatedLanesExhausted);
  const exploitDone = isTruthy(exploitExhausted);
  const zeroEmissionDone = isTruthy(zeroEmissionExhausted);
  const gateStuck = isTruthy(gateStagnation);

  // Quality-aware convergence acceptance
  const convergenceEnabled = convergencePolicy?.enabled === true;
  const maxLevel = Number(convergencePolicy?.maxStagnationLevel ?? 6);
  if (convergenceEnabled && safeLevel >= maxLevel && generatedExhausted && exploitDone) {
    const qualityCheck = checkQualityFloors(championQuality, qualityFloors);
    if (qualityCheck.passed) {
      return {
        mode: 'converged',
        reason: 'convergence-accepted',
        recommendation: 'stop-research',
        allowArchitectureKeys: false,
        multiKeyMutationCount: 0,
        ladderScale: 0,
      };
    }
    // Champion quality insufficient — continue with progressive widen
    return {
      mode: 'progressive-widen',
      reason: 'convergence-blocked-by-quality',
      qualityGatesFailed: qualityCheck.failed,
      allowArchitectureKeys: true,
      multiKeyMutationCount: 4,
      ladderScale: 3,
    };
  }

  // --- existing logic below (unchanged) ---
  if (safeLevel < 2) return { mode: 'none', reason: 'not-eligible' };

  // ... rest of existing function unchanged ...
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-stagnation-escape.test.mjs`
Expected: All PASS (both new convergence tests and existing escape tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-stagnation-escape.mjs tests/pine-stagnation-escape.test.mjs
git commit -m "feat: add quality-aware convergence acceptance to stagnation escape"
```

---

### Phase 4 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL tests PASS.

---

## Phase 5: Walk-Forward Validation (Regime-Aware)

### Task 16: Implement Walk-Forward with Regime Awareness

**Files:**
- Create: `scripts/lib/pine-walk-forward.mjs`
- Create: `tests/pine-walk-forward.test.mjs`

- [ ] **Step 1: Write failing tests for walk-forward**

```javascript
// tests/pine-walk-forward.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWalkForwardWindows,
  evaluateWalkForwardFold,
  summarizeWalkForwardResults,
  isWalkForwardValid,
  buildRegimeAwareWindows,
} from '../scripts/lib/pine-walk-forward.mjs';

describe('pine-walk-forward', () => {
  describe('buildWalkForwardWindows', () => {
    it('splits data into train/test folds (rolling)', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 5, stepMode: 'rolling',
      });
      assert.equal(windows.length, 5);
      for (const w of windows) {
        assert.ok(w.trainStart < w.trainEnd);
        assert.ok(w.testStart < w.testEnd);
        assert.equal(w.testStart, w.trainEnd);
      }
    });

    it('rolling windows advance forward in time', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 4, stepMode: 'rolling',
      });
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].trainStart > windows[i - 1].trainStart);
      }
    });

    it('anchored windows keep same start, extend train', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 4, stepMode: 'anchored',
      });
      for (const w of windows) {
        assert.equal(w.trainStart, 0);
      }
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].trainEnd > windows[i - 1].trainEnd);
      }
    });

    it('test windows never overlap', () => {
      const windows = buildWalkForwardWindows({
        totalBars: 10000, trainRatio: 0.7, folds: 5, stepMode: 'rolling',
      });
      for (let i = 1; i < windows.length; i++) {
        assert.ok(windows[i].testStart >= windows[i - 1].testEnd);
      }
    });

    it('returns empty for zero bars', () => {
      const windows = buildWalkForwardWindows({ totalBars: 0, folds: 5 });
      assert.equal(windows.length, 0);
    });
  });

  describe('buildRegimeAwareWindows', () => {
    it('creates windows aligned to regime boundaries', () => {
      // Regime slices: [0-3000] trending, [3000-7000] ranging, [7000-10000] trending
      const regimeSlices = [
        { startBar: 0, endBar: 3000, regime: 'trending' },
        { startBar: 3000, endBar: 7000, regime: 'ranging' },
        { startBar: 7000, endBar: 10000, regime: 'trending' },
      ];
      const windows = buildRegimeAwareWindows({
        totalBars: 10000, regimeSlices, trainRatio: 0.7, folds: 3,
      });
      assert.ok(windows.length >= 1);
      // Each window should have regime metadata
      for (const w of windows) {
        assert.ok(w.trainStart < w.trainEnd);
        assert.ok(w.testStart < w.testEnd);
        assert.ok(Array.isArray(w.regimes));
      }
    });

    it('falls back to standard rolling when no regime slices', () => {
      const windows = buildRegimeAwareWindows({
        totalBars: 10000, regimeSlices: [], trainRatio: 0.7, folds: 5,
      });
      assert.equal(windows.length, 5);
    });
  });

  describe('evaluateWalkForwardFold', () => {
    it('returns metrics for train and test periods', () => {
      const fold = evaluateWalkForwardFold({
        trainTrades: [{ returnPctExact: 1.5 }, { returnPctExact: -0.5 }, { returnPctExact: 2.0 }],
        testTrades: [{ returnPctExact: 0.8 }, { returnPctExact: -1.2 }, { returnPctExact: 0.5 }],
      });
      assert.ok(Number.isFinite(fold.trainRoiPct));
      assert.ok(Number.isFinite(fold.testRoiPct));
      assert.ok(Number.isFinite(fold.degradationPct));
      assert.equal(fold.trainTradeCount, 3);
      assert.equal(fold.testTradeCount, 3);
    });

    it('degradation is negative when test worse than train', () => {
      const fold = evaluateWalkForwardFold({
        trainTrades: [{ returnPctExact: 5 }, { returnPctExact: 3 }],
        testTrades: [{ returnPctExact: -1 }, { returnPctExact: -2 }],
      });
      assert.ok(fold.degradationPct < 0);
    });
  });

  describe('summarizeWalkForwardResults', () => {
    it('computes average degradation and efficiency', () => {
      const folds = [
        { trainRoiPct: 10, testRoiPct: 8, degradationPct: -20 },
        { trainRoiPct: 12, testRoiPct: 7, degradationPct: -41.67 },
        { trainRoiPct: 8, testRoiPct: 6, degradationPct: -25 },
      ];
      const summary = summarizeWalkForwardResults(folds);
      assert.equal(summary.foldCount, 3);
      assert.ok(summary.avgDegradationPct < 0);
      assert.ok(summary.walkForwardEfficiency > 0 && summary.walkForwardEfficiency < 1);
    });
  });

  describe('isWalkForwardValid', () => {
    it('passes when efficiency above threshold', () => {
      const summary = { walkForwardEfficiency: 0.7, avgDegradationPct: -30, foldCount: 5 };
      const result = isWalkForwardValid(summary, { minEfficiency: 0.5, maxDegradationPct: -50 });
      assert.equal(result.valid, true);
    });

    it('fails when efficiency below threshold', () => {
      const summary = { walkForwardEfficiency: 0.3, avgDegradationPct: -70, foldCount: 5 };
      const result = isWalkForwardValid(summary, { minEfficiency: 0.5, maxDegradationPct: -50 });
      assert.equal(result.valid, false);
      assert.ok(result.failedGates.includes('efficiency'));
    });

    it('fails when degradation too severe', () => {
      const summary = { walkForwardEfficiency: 0.6, avgDegradationPct: -60, foldCount: 5 };
      const result = isWalkForwardValid(summary, { minEfficiency: 0.5, maxDegradationPct: -50 });
      assert.equal(result.valid, false);
      assert.ok(result.failedGates.includes('degradation'));
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/pine-walk-forward.test.mjs`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement walk-forward validation with regime awareness**

```javascript
// scripts/lib/pine-walk-forward.mjs

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildWalkForwardWindows({ totalBars, trainRatio = 0.7, folds = 5, stepMode = 'rolling' } = {}) {
  if (totalBars <= 0 || folds <= 0) return [];
  const windows = [];

  if (stepMode === 'anchored') {
    const testSize = Math.floor(totalBars * (1 - trainRatio) / folds);
    for (let i = 0; i < folds; i++) {
      const testEnd = totalBars - (folds - 1 - i) * testSize;
      const testStart = testEnd - testSize;
      const trainEnd = testStart;
      windows.push({
        fold: i, trainStart: 0, trainEnd, testStart,
        testEnd: Math.min(testEnd, totalBars),
      });
    }
  } else {
    const trainSize = Math.floor(totalBars * trainRatio / folds);
    const testSize = Math.floor(totalBars * (1 - trainRatio) / folds);
    const stepSize = Math.floor((totalBars - trainSize - testSize) / Math.max(1, folds - 1));

    for (let i = 0; i < folds; i++) {
      const trainStart = i * stepSize;
      const trainEnd = trainStart + trainSize;
      const testStart = trainEnd;
      const testEnd = Math.min(testStart + testSize, totalBars);
      if (testEnd <= testStart) break;
      windows.push({ fold: i, trainStart, trainEnd, testStart, testEnd });
    }
  }

  return windows;
}

export function buildRegimeAwareWindows({ totalBars, regimeSlices = [], trainRatio = 0.7, folds = 5 } = {}) {
  if (!regimeSlices || regimeSlices.length === 0) {
    return buildWalkForwardWindows({ totalBars, trainRatio, folds, stepMode: 'rolling' });
  }

  // Build windows that respect regime boundaries
  // Strategy: use regime transitions as natural fold boundaries
  const boundaries = [0];
  for (const slice of regimeSlices) {
    if (slice.endBar > 0 && slice.endBar < totalBars && !boundaries.includes(slice.endBar)) {
      boundaries.push(slice.endBar);
    }
  }
  boundaries.push(totalBars);
  boundaries.sort((a, b) => a - b);

  // If we have enough boundaries, use them as fold points
  if (boundaries.length - 1 >= folds) {
    const windows = [];
    const step = Math.floor((boundaries.length - 1) / folds);
    for (let i = 0; i < folds; i++) {
      const testBoundaryIdx = Math.min(i * step + step, boundaries.length - 1);
      const testStart = boundaries[Math.max(0, testBoundaryIdx - 1)];
      const testEnd = boundaries[testBoundaryIdx];
      const trainStart = 0;
      const trainEnd = testStart;
      if (trainEnd <= trainStart || testEnd <= testStart) continue;

      // Determine regimes covered by this window
      const regimes = regimeSlices
        .filter(s => s.startBar < testEnd && s.endBar > testStart)
        .map(s => s.regime);

      windows.push({ fold: windows.length, trainStart, trainEnd, testStart, testEnd, regimes });
    }
    return windows.length > 0 ? windows : buildWalkForwardWindows({ totalBars, trainRatio, folds, stepMode: 'rolling' });
  }

  // Not enough regime boundaries — fall back to standard rolling
  return buildWalkForwardWindows({ totalBars, trainRatio, folds, stepMode: 'rolling' });
}

export function evaluateWalkForwardFold({ trainTrades = [], testTrades = [] } = {}) {
  const trainSum = trainTrades.reduce((s, t) => s + (t.returnPctExact ?? t.returnPct ?? 0), 0);
  const testSum = testTrades.reduce((s, t) => s + (t.returnPctExact ?? t.returnPct ?? 0), 0);

  const trainAvg = trainTrades.length > 0 ? trainSum / trainTrades.length : 0;
  const testAvg = testTrades.length > 0 ? testSum / testTrades.length : 0;

  const degradationPct = trainAvg !== 0 ? round(((testAvg - trainAvg) / Math.abs(trainAvg)) * 100) : 0;

  return {
    trainRoiPct: round(trainSum),
    testRoiPct: round(testSum),
    trainAvgReturn: round(trainAvg),
    testAvgReturn: round(testAvg),
    trainTradeCount: trainTrades.length,
    testTradeCount: testTrades.length,
    degradationPct,
  };
}

export function summarizeWalkForwardResults(folds = []) {
  if (folds.length === 0) {
    return { foldCount: 0, avgDegradationPct: 0, walkForwardEfficiency: 0 };
  }

  const avgDegradation = folds.reduce((s, f) => s + (f.degradationPct ?? 0), 0) / folds.length;

  const efficiencies = folds
    .filter(f => f.trainRoiPct !== 0)
    .map(f => f.testRoiPct / f.trainRoiPct);
  const avgEfficiency = efficiencies.length > 0
    ? efficiencies.reduce((s, e) => s + e, 0) / efficiencies.length
    : 0;

  return {
    foldCount: folds.length,
    avgDegradationPct: round(avgDegradation),
    walkForwardEfficiency: round(avgEfficiency),
    folds,
  };
}

export function isWalkForwardValid(summary, policy = {}) {
  const minEfficiency = policy.minEfficiency ?? 0.5;
  const maxDegradationPct = policy.maxDegradationPct ?? -50;
  const failedGates = [];

  if (summary.walkForwardEfficiency < minEfficiency) failedGates.push('efficiency');
  if (summary.avgDegradationPct < maxDegradationPct) failedGates.push('degradation');

  return {
    valid: failedGates.length === 0,
    failedGates,
    efficiency: summary.walkForwardEfficiency,
    degradation: summary.avgDegradationPct,
    policy: { minEfficiency, maxDegradationPct },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pine-walk-forward.test.mjs`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-walk-forward.mjs tests/pine-walk-forward.test.mjs
git commit -m "feat: add walk-forward validation with rolling/anchored/regime-aware windows"
```

---

### Phase 5 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL tests PASS. Walk-forward is additive — no existing code modified.

---

## Phase 6: Pipeline Integration

This is the critical phase — wiring all new modules into the live autoresearch pipeline. Feature flags control activation so the system can run old and new paths in parallel.

### Task 17: Wire Simulator into pine-optimizer.mjs

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs`

- [ ] **Step 1: Write test for feature-flag-controlled simulator switch**

```javascript
// Append to tests/pine-optimizer.test.mjs
describe('simulator feature flag integration', () => {
  it('uses legacy simulateTrades when USE_NEXT_BAR_OPEN_ENTRY is false', async () => {
    const { simulateTrades } = await import('../scripts/lib/pine-optimizer.mjs');
    const rows = [
      { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
      { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 100, Close: 104, Signal: -1 },
    ];
    // Default (no flags) = legacy behavior = entry at signal bar close
    const trades = simulateTrades(rows);
    assert.equal(trades[0].entryPrice, 101); // signal bar close
  });

  it('uses new simulator when USE_NEXT_BAR_OPEN_ENTRY is true', async () => {
    const { simulateTrades } = await import('../scripts/lib/pine-optimizer.mjs');
    const rows = [
      { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
      { timestamp: '2026-01-01T00:15:00Z', Open: 101.5, High: 105, Low: 100, Close: 104, Signal: -1 },
    ];
    const trades = simulateTrades(rows, {
      featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
    });
    assert.equal(trades[0].entryPrice, 101.5); // next bar open
  });

  it('applies cost model when USE_COST_MODEL is true', async () => {
    const { simulateTrades } = await import('../scripts/lib/pine-optimizer.mjs');
    const rows = [
      { timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 102, Low: 99, Close: 101, Signal: 1, StopLoss: 95, TakeProfit: 110 },
      { timestamp: '2026-01-01T00:15:00Z', Open: 101, High: 111, Low: 100, Close: 110, Signal: 0 },
    ];
    const trades = simulateTrades(rows, {
      featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true, USE_COST_MODEL: true },
      costModel: { commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 },
    });
    assert.ok(trades[0].costPct > 0);
    assert.ok(trades[0].grossReturnPct > trades[0].returnPctExact);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-optimizer.test.mjs`
Expected: FAIL — `featureFlags` option not recognized

- [ ] **Step 3: Add feature-flag routing to pine-optimizer.mjs simulateTrades**

In `scripts/lib/pine-optimizer.mjs`, modify `simulateTrades` to accept feature flags:

```javascript
import { simulateTrades as newSimulateTrades } from './pine-simulator.mjs';
import { buildCostModel } from './pine-cost-model.mjs';
import { getFlag, createFlagRegistry } from './pine-feature-flags.mjs';

// Wrap existing simulateTrades as legacySimulateTrades (rename internal function)
// Then export a router:

export function simulateTrades(rows, options = {}) {
  const flags = options.featureFlags
    ? createFlagRegistry(options.featureFlags)
    : createFlagRegistry();

  if (getFlag(flags, 'USE_NEXT_BAR_OPEN_ENTRY')) {
    const costModel = getFlag(flags, 'USE_COST_MODEL') && options.costModel
      ? buildCostModel(options.costModel)
      : null;
    return newSimulateTrades(rows, {
      entryMode: 'next-bar-open',
      costModel,
      timeframeMinutes: options.timeframeMinutes,
    });
  }

  // Legacy path — existing behavior unchanged
  return legacySimulateTrades(rows, options);
}
```

- [ ] **Step 4: Run all optimizer tests**

Run: `node --test tests/pine-optimizer.test.mjs`
Expected: All PASS (legacy path unchanged, new tests pass with flags)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-optimizer.mjs tests/pine-optimizer.test.mjs
git commit -m "feat: wire new simulator into optimizer with feature flag routing"
```

---

### Task 18: Wire Data Quality Gate into Autoresearch Pipeline

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`

- [ ] **Step 1: Write test for data quality gate in pipeline**

```javascript
// Append to tests/pine-autoresearch.test.mjs
describe('data quality gate integration', () => {
  it('rejects dataset with critical quality issues when flag enabled', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      Open: 100, High: 90, Low: 98, Close: 103, // High < Low = invalid
    }));
    const result = evaluateDataQualityGate(rows, {
      featureFlags: { USE_DATA_QUALITY_GATE: true },
      timeframeMinutes: 15,
    });
    assert.equal(result.passed, false);
    assert.equal(result.severity, 'critical');
  });

  it('passes clean dataset', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      Open: 100, High: 105, Low: 98, Close: 103,
    }));
    const result = evaluateDataQualityGate(rows, {
      featureFlags: { USE_DATA_QUALITY_GATE: true },
      timeframeMinutes: 15,
    });
    assert.equal(result.passed, true);
  });

  it('skips validation when flag disabled (always passes)', () => {
    const rows = [{ timestamp: '2026-01-01T00:00:00Z', Open: 100, High: 90, Low: 98, Close: 103 }];
    const result = evaluateDataQualityGate(rows, {
      featureFlags: { USE_DATA_QUALITY_GATE: false },
      timeframeMinutes: 15,
    });
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: FAIL — `evaluateDataQualityGate` not exported

- [ ] **Step 3: Add data quality gate function to autoresearch**

In `scripts/lib/pine-autoresearch.mjs`, add:

```javascript
import { buildDataQualityReport } from './pine-data-quality.mjs';
import { getFlag, createFlagRegistry } from './pine-feature-flags.mjs';

export function evaluateDataQualityGate(rows, options = {}) {
  const flags = options.featureFlags
    ? createFlagRegistry(options.featureFlags)
    : createFlagRegistry();

  if (!getFlag(flags, 'USE_DATA_QUALITY_GATE')) {
    return { passed: true, skipped: true, reason: 'flag_disabled' };
  }

  const report = buildDataQualityReport(rows, {
    timeframeMinutes: options.timeframeMinutes ?? 15,
  });

  if (report.severity === 'critical') {
    return {
      passed: false,
      skipped: false,
      severity: report.severity,
      reason: 'critical_data_quality',
      invalidRows: report.invalidRows,
      gaps: report.gaps,
      totalRows: report.totalRows,
    };
  }

  return {
    passed: true,
    skipped: false,
    severity: report.severity,
    invalidRows: report.invalidRows,
    gaps: report.gaps,
    totalRows: report.totalRows,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: wire data quality gate into autoresearch pipeline (flag-controlled)"
```

---

### Task 19: Wire Walk-Forward into Promotion Pipeline

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`

- [ ] **Step 1: Write test for walk-forward promotion gate**

```javascript
// Append to tests/pine-autoresearch.test.mjs
describe('walk-forward promotion gate', () => {
  it('blocks promotion when walk-forward efficiency is below threshold', () => {
    const walkForwardResult = {
      foldCount: 5,
      avgDegradationPct: -60,
      walkForwardEfficiency: 0.3,
    };
    const result = evaluateWalkForwardGate(walkForwardResult, {
      featureFlags: { USE_WALK_FORWARD_GATE: true },
      policy: { minEfficiency: 0.5, maxDegradationPct: -50 },
    });
    assert.equal(result.passed, false);
    assert.ok(result.failedGates.includes('efficiency'));
    assert.ok(result.failedGates.includes('degradation'));
  });

  it('passes promotion when walk-forward is healthy', () => {
    const walkForwardResult = {
      foldCount: 5,
      avgDegradationPct: -20,
      walkForwardEfficiency: 0.75,
    };
    const result = evaluateWalkForwardGate(walkForwardResult, {
      featureFlags: { USE_WALK_FORWARD_GATE: true },
      policy: { minEfficiency: 0.5, maxDegradationPct: -50 },
    });
    assert.equal(result.passed, true);
  });

  it('skips when flag disabled (always passes)', () => {
    const walkForwardResult = {
      foldCount: 5,
      avgDegradationPct: -80,
      walkForwardEfficiency: 0.1,
    };
    const result = evaluateWalkForwardGate(walkForwardResult, {
      featureFlags: { USE_WALK_FORWARD_GATE: false },
      policy: { minEfficiency: 0.5, maxDegradationPct: -50 },
    });
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
  });

  it('skips when no walk-forward result provided', () => {
    const result = evaluateWalkForwardGate(null, {
      featureFlags: { USE_WALK_FORWARD_GATE: true },
      policy: { minEfficiency: 0.5, maxDegradationPct: -50 },
    });
    assert.equal(result.passed, false);
    assert.equal(result.reason, 'no_walk_forward_data');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: FAIL — `evaluateWalkForwardGate` not exported

- [ ] **Step 3: Add walk-forward gate to autoresearch**

In `scripts/lib/pine-autoresearch.mjs`, add:

```javascript
import { isWalkForwardValid } from './pine-walk-forward.mjs';

export function evaluateWalkForwardGate(walkForwardResult, options = {}) {
  const flags = options.featureFlags
    ? createFlagRegistry(options.featureFlags)
    : createFlagRegistry();

  if (!getFlag(flags, 'USE_WALK_FORWARD_GATE')) {
    return { passed: true, skipped: true, reason: 'flag_disabled' };
  }

  if (!walkForwardResult || !Number.isFinite(walkForwardResult.walkForwardEfficiency)) {
    return { passed: false, skipped: false, reason: 'no_walk_forward_data', failedGates: ['missing_data'] };
  }

  const policy = options.policy ?? {};
  const validation = isWalkForwardValid(walkForwardResult, policy);

  return {
    passed: validation.valid,
    skipped: false,
    failedGates: validation.failedGates,
    efficiency: validation.efficiency,
    degradation: validation.degradation,
    policy: validation.policy,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: wire walk-forward validation into promotion pipeline (flag-controlled)"
```

---

### Task 20: Wire Statistical Significance into Promotion Flow

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`

- [ ] **Step 1: Write test for statistical significance in promotion**

```javascript
// Append to tests/pine-autoresearch.test.mjs
describe('statistical significance in promotion flow', () => {
  it('uses statistical mode when flag enabled and tradeReturns available', () => {
    const incumbent = {
      score: 50,
      metrics: { tradeCount: 100 },
      tradeReturns: Array.from({ length: 100 }, (_, i) => 0.1 + (i % 10) * 0.01),
    };
    const challenger = {
      score: 55,
      metrics: { tradeCount: 100 },
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

  it('falls back to legacy when tradeReturns not available', () => {
    const incumbent = { score: 50, metrics: { tradeCount: 100 } };
    const challenger = { score: 55, metrics: { tradeCount: 100 } };
    const result = evaluatePromotionSignificance(incumbent, challenger, {
      featureFlags: { USE_STATISTICAL_SIGNIFICANCE: true },
      policy: { minRelativeScoreDelta: 0.02, minTradeCount: 100 },
    });
    assert.equal(result.mode, 'legacy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: FAIL — `evaluatePromotionSignificance` not exported

- [ ] **Step 3: Add promotion significance wrapper**

In `scripts/lib/pine-autoresearch.mjs`, add:

```javascript
import { decideSignificanceGate } from './pine-significance-gate.mjs';

export function evaluatePromotionSignificance(incumbent, challenger, options = {}) {
  const flags = options.featureFlags
    ? createFlagRegistry(options.featureFlags)
    : createFlagRegistry();

  const useStatistical = getFlag(flags, 'USE_STATISTICAL_SIGNIFICANCE');
  const hasReturns = Array.isArray(incumbent?.tradeReturns) && Array.isArray(challenger?.tradeReturns);

  const policy = {
    ...options.policy,
    mode: (useStatistical && hasReturns) ? 'statistical' : 'legacy',
  };

  const gateResult = decideSignificanceGate({ incumbent, challenger, policy });

  return {
    mode: policy.mode,
    passed: gateResult.passed,
    reason: gateResult.reason,
    details: gateResult,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: wire statistical significance into promotion flow (flag-controlled)"
```

---

### Task 21: Wire Config Migration into Autoresearch Startup

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`

- [ ] **Step 1: Write test for config auto-migration on load**

```javascript
// Append to tests/pine-autoresearch.test.mjs
describe('config auto-migration', () => {
  it('migrates v1 config to v2 on load', () => {
    const v1Config = {
      matrixId: 'test',
      searchPolicy: {
        annealing: { enabled: true, baseTemperature: 0.4, growthFactor: 1.8, maxTemperature: 16 },
        tabuPolicy: { maxAgeCycles: 20, maxEntries: 40, dropOnChampionChange: true },
      },
      autoPromotion: { enabled: true, cooldownHours: 12, maxPromotionsPerDay: 2 },
    };
    const loaded = loadAndMigrateConfig(v1Config);
    assert.equal(loaded.configVersion, 2);
    assert.equal(loaded.searchPolicy.annealing.maxTemperature, 4);
    assert.equal(loaded.searchPolicy.tabuPolicy.dropOnChampionChange, false);
    assert.ok(loaded.featureFlags);
  });

  it('leaves v2 config unchanged', () => {
    const v2Config = {
      configVersion: 2,
      matrixId: 'test',
      featureFlags: { USE_COST_MODEL: true },
    };
    const loaded = loadAndMigrateConfig(v2Config);
    assert.deepEqual(loaded, v2Config);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: FAIL — `loadAndMigrateConfig` not exported

- [ ] **Step 3: Add config migration wrapper**

In `scripts/lib/pine-autoresearch.mjs`, add:

```javascript
import { migrateConfig, detectConfigVersion } from './pine-config-version.mjs';

export function loadAndMigrateConfig(config) {
  const version = detectConfigVersion(config);
  if (version < 2) {
    return migrateConfig(config);
  }
  return config;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: auto-migrate v1 config to v2 on autoresearch startup"
```

---

### Phase 6 Regression Gate

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL tests PASS. This is the highest-risk phase — pine-optimizer.mjs and pine-autoresearch.mjs are modified. Verify carefully.

---

## Phase 7: End-to-End Validation & Comparison

### Task 22: Create End-to-End Integration Test

**Files:**
- Create: `tests/pine-integration-e2e.test.mjs`

This test runs a mini autoresearch cycle with both old and new paths, comparing outputs to verify no regression and validate the new foundation produces meaningful differences.

- [ ] **Step 1: Write end-to-end integration test**

```javascript
// tests/pine-integration-e2e.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrades, calculateMetrics } from '../scripts/lib/pine-optimizer.mjs';
import { calculateCompoundedMetrics } from '../scripts/lib/pine-metric-core.mjs';
import { buildCostModel, applyCostToTrade } from '../scripts/lib/pine-cost-model.mjs';
import { buildDataQualityReport } from '../scripts/lib/pine-data-quality.mjs';
import { isStatisticallySignificant } from '../scripts/lib/pine-statistical-significance.mjs';
import { buildWalkForwardWindows, evaluateWalkForwardFold, summarizeWalkForwardResults, isWalkForwardValid } from '../scripts/lib/pine-walk-forward.mjs';
import { decideSignificanceGate } from '../scripts/lib/pine-significance-gate.mjs';
import { computeCandidateUtility, computeMultipleTestingPenalty } from '../scripts/lib/pine-objective-function.mjs';
import { createFlagRegistry } from '../scripts/lib/pine-feature-flags.mjs';
import { migrateConfig } from '../scripts/lib/pine-config-version.mjs';

// Generate synthetic OHLC data with a known edge
function generateSyntheticData(bars, { winRate = 0.55, avgWinPct = 1.5, avgLossPct = 1.0, seed = 42 } = {}) {
  let s = seed;
  function rng() {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const rows = [];
  let price = 100;
  for (let i = 0; i < bars; i++) {
    const open = price;
    const move = (rng() - 0.5) * 2;
    const high = open + Math.abs(move) + rng() * 0.5;
    const low = open - Math.abs(move) - rng() * 0.5;
    const close = open + move;
    price = close;

    // Generate signal every ~20 bars
    let signal = 0;
    let stopLoss = NaN;
    let takeProfit = NaN;
    if (i % 20 === 0 && i > 0) {
      const isWin = rng() < winRate;
      signal = 1;
      if (isWin) {
        takeProfit = close * (1 + avgWinPct / 100);
        stopLoss = close * (1 - avgLossPct * 2 / 100);
      } else {
        takeProfit = close * (1 + avgWinPct * 3 / 100);
        stopLoss = close * (1 - avgLossPct / 100);
      }
    }

    rows.push({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
      Open: Number(open.toFixed(4)),
      High: Number(high.toFixed(4)),
      Low: Number(low.toFixed(4)),
      Close: Number(close.toFixed(4)),
      Signal: signal,
      StopLoss: Number.isFinite(stopLoss) ? Number(stopLoss.toFixed(4)) : undefined,
      TakeProfit: Number.isFinite(takeProfit) ? Number(takeProfit.toFixed(4)) : undefined,
    });
  }
  return rows;
}

describe('end-to-end integration', () => {
  const syntheticData = generateSyntheticData(2000, { winRate: 0.55, seed: 123 });

  describe('data quality gate', () => {
    it('synthetic data passes quality check', () => {
      const report = buildDataQualityReport(syntheticData, { timeframeMinutes: 15 });
      assert.equal(report.valid, true);
      assert.equal(report.severity, 'ok');
    });
  });

  describe('legacy vs new simulator comparison', () => {
    it('both simulators produce trades from same data', () => {
      const legacyTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: false },
      });
      const newTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      assert.ok(legacyTrades.length > 0, 'legacy should produce trades');
      assert.ok(newTrades.length > 0, 'new should produce trades');
    });

    it('new simulator entry prices differ from legacy (next-bar vs signal-bar)', () => {
      const legacyTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: false },
      });
      const newTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      // At least some entry prices should differ
      let diffCount = 0;
      const minLen = Math.min(legacyTrades.length, newTrades.length);
      for (let i = 0; i < minLen; i++) {
        if (legacyTrades[i].entryPrice !== newTrades[i].entryPrice) diffCount++;
      }
      assert.ok(diffCount > 0, 'entry prices should differ between modes');
    });

    it('cost model reduces net returns', () => {
      const noCostTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true, USE_COST_MODEL: false },
      });
      const costTrades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true, USE_COST_MODEL: true },
        costModel: { commissionPct: 0.04, slippagePct: 0.02, spreadPct: 0.01 },
      });
      const noCostRoi = calculateMetrics(noCostTrades).roiPct;
      const costRoi = calculateMetrics(costTrades).roiPct;
      assert.ok(costRoi < noCostRoi, `cost ROI (${costRoi}) should be less than no-cost (${noCostRoi})`);
    });
  });

  describe('compounded vs additive metrics', () => {
    it('compounded metrics differ from additive for same trades', () => {
      const trades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      const additive = calculateMetrics(trades);
      const compounded = calculateCompoundedMetrics(trades);
      // They should differ (compounding effect)
      assert.ok(Math.abs(additive.roiPct - compounded.compoundedRoiPct) > 0.01,
        'compounded and additive ROI should differ');
    });
  });

  describe('walk-forward validation', () => {
    it('runs walk-forward on synthetic data and produces valid result', () => {
      const trades = simulateTrades(syntheticData, {
        featureFlags: { USE_NEXT_BAR_OPEN_ENTRY: true },
      });
      const windows = buildWalkForwardWindows({ totalBars: syntheticData.length, trainRatio: 0.7, folds: 3 });
      const foldResults = windows.map(w => {
        const trainTrades = trades.filter(t => t.entryIndex >= w.trainStart && t.entryIndex < w.trainEnd);
        const testTrades = trades.filter(t => t.entryIndex >= w.testStart && t.entryIndex < w.testEnd);
        return evaluateWalkForwardFold({ trainTrades, testTrades });
      });
      const summary = summarizeWalkForwardResults(foldResults);
      assert.equal(summary.foldCount, 3);
      assert.ok(Number.isFinite(summary.walkForwardEfficiency));
      assert.ok(Number.isFinite(summary.avgDegradationPct));
    });
  });

  describe('full promotion pipeline', () => {
    it('config migration produces valid v2 config', () => {
      const v1 = {
        matrixId: 'test',
        searchPolicy: { annealing: { enabled: true, maxTemperature: 16, growthFactor: 1.8, baseTemperature: 0.4 }, tabuPolicy: { dropOnChampionChange: true, maxAgeCycles: 20, maxEntries: 40 } },
        autoPromotion: { enabled: true, cooldownHours: 12, maxPromotionsPerDay: 2 },
      };
      const v2 = migrateConfig(v1);
      assert.equal(v2.configVersion, 2);
      assert.equal(v2.searchPolicy.annealing.maxTemperature, 4);
      assert.ok(v2.featureFlags);
      assert.ok(v2.costModel);
      assert.ok(v2.walkForwardPolicy);
    });

    it('feature flags default to all-off for safe rollout', () => {
      const registry = createFlagRegistry();
      const flags = Object.fromEntries(registry);
      for (const value of Object.values(flags)) {
        assert.equal(value, false);
      }
    });

    it('multiple testing penalty scales with candidates', () => {
      const p10 = computeMultipleTestingPenalty({ attemptedCandidates: 10 }, { base: 1.0, step: 0.3 });
      const p100 = computeMultipleTestingPenalty({ attemptedCandidates: 100 }, { base: 1.0, step: 0.3 });
      const p1000 = computeMultipleTestingPenalty({ attemptedCandidates: 1000 }, { base: 1.0, step: 0.3 });
      assert.ok(p10 < p100);
      assert.ok(p100 < p1000);
      assert.ok(p100 > 2); // meaningful at 100
    });
  });
});
```

- [ ] **Step 2: Run end-to-end test**

Run: `node --test tests/pine-integration-e2e.test.mjs`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/pine-integration-e2e.test.mjs
git commit -m "feat: add end-to-end integration test comparing old vs new pipeline"
```

---

### Task 23: Update Promotion Config for Conservative Rollout

**Files:**
- Modify: `config/pine-autoresearch.default.json`

- [ ] **Step 1: Update autoPromotion section**

```json
"autoPromotion": {
  "enabled": true,
  "cooldownHours": 48,
  "maxPromotionsPerDay": 1,
  "requireMatrixPromotion": true,
  "requireStatisticalSignificance": true,
  "requireWalkForward": true,
  "lineagePolicy": {
    "enabled": true,
    "lookbackPromotions": 6,
    "familyKeys": [
      "useSignalFusion",
      "useFusionV2",
      "useFusionV3",
      "useFusionV4",
      "useDivergenceContext",
      "useSqueezeContext",
      "useSupertrendFilter",
      "useTrailingStop",
      "useStopsTP"
    ],
    "baseShadowPassCount": 3,
    "directReversalExtraShadowPasses": 1,
    "minExtraAggregateScoreDelta": 5,
    "minExtraAggregateRoiDeltaPct": 0
  }
}
```

- [ ] **Step 2: Add walkForwardPolicy section**

```json
"walkForwardPolicy": {
  "enabled": true,
  "folds": 5,
  "trainRatio": 0.7,
  "stepMode": "rolling",
  "minEfficiency": 0.5,
  "maxDegradationPct": -50,
  "regimeAware": true
}
```

- [ ] **Step 3: Add convergence policy to rotation stagnation**

```json
"stagnation": {
  "enabled": true,
  "noNewCandidateEscalateAfter": 2,
  "holdEscalateAfter": 3,
  "highSimilarityThreshold": 0.8,
  "maxStagnationLevel": 6,
  "lowEmissionEscalateAfter": 3,
  "lowEmissionThreshold": 3,
  "noScoreImprovementConvergeAfter": 12,
  "requireEscapeExhaustion": true,
  "convergencePolicy": {
    "enabled": true,
    "maxStagnationLevel": 6
  },
  "qualityFloors": {
    "minRoiPct": 15,
    "minProfitFactor": 1.2,
    "maxDrawdownPct": 25,
    "minTradeCount": 50
  },
  "deescalation": {
    "enabled": true,
    "consecutiveHealthyCycles": 2
  }
}
```

- [ ] **Step 4: Verify config is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('./config/pine-autoresearch.default.json','utf8')); console.log('valid')"`
Expected: `valid`

- [ ] **Step 5: Commit**

```bash
git add config/pine-autoresearch.default.json
git commit -m "feat: update config for conservative promotion (48h cooldown, walk-forward, convergence)"
```

---

### Task 24: Final Full Regression Gate

- [ ] **Step 1: Run complete test suite**

```bash
node --test tests/pine-*.test.mjs
```

Expected: ALL tests PASS

- [ ] **Step 2: Verify test count increased**

```bash
node --test tests/pine-*.test.mjs 2>&1 | tail -5
```

Expected: Test count should be significantly higher than the original 58 files (new test files added: pine-feature-flags, pine-config-version, pine-cost-model, pine-data-quality, pine-simulator, pine-statistical-significance, pine-walk-forward, pine-metric-core-v2, pine-integration-e2e = 9 new files)

- [ ] **Step 3: Commit final state**

```bash
git add -A
git commit -m "chore: final regression gate — all tests pass with statistical foundation overhaul"
```

---

## Rollout Strategy

After all phases complete and tests pass:

### Stage 1: Shadow Mode (Week 1-2)
Enable feature flags one at a time in config, starting with lowest risk:
1. `USE_DATA_QUALITY_GATE: true` — only logs warnings, doesn't block
2. `USE_COST_MODEL: true` — observe how ROI changes with costs applied
3. `USE_COMPOUNDED_METRICS: true` — compare compounded vs additive in logs

### Stage 2: Validation Mode (Week 3-4)
4. `USE_STATISTICAL_SIGNIFICANCE: true` — observe how many promotions would be blocked
5. `USE_WALK_FORWARD_GATE: true` — observe walk-forward efficiency scores
6. `USE_UNIFIED_SCORING: true` — verify scoring consistency

### Stage 3: Full Activation (Week 5+)
7. `USE_NEXT_BAR_OPEN_ENTRY: true` — this changes trade results fundamentally
   - **WARNING:** Invalidates evaluation cache (cacheVersion bump required)
   - Compare champion quality before/after
   - May need to re-run research from scratch with new simulator

### Cache Invalidation Protocol
When enabling `USE_NEXT_BAR_OPEN_ENTRY` or `USE_COST_MODEL`:
1. Bump `cacheVersion` in config (e.g., 1 → 2)
2. Old cached evaluations will be automatically rejected
3. Research will re-evaluate all candidates with new simulator

### Rollback
If any flag causes issues:
1. Set the flag back to `false` in config
2. System immediately reverts to legacy behavior
3. No data loss — feature flags are pure routing switches

---

## Summary of Changes vs Original Plan

| Issue | Original Plan | This Plan |
|-------|--------------|-----------|
| Math errors in tests | Acknowledged but unfixed | Fixed: `computeTradeCost` correctly asserts 0.13 |
| Migration strategy | None | Feature flags + config versioning + staged rollout |
| Integration tasks | None (unit-level only) | Phase 6: full pipeline wiring with flag control |
| Non-deterministic tests | `Math.random()` | Seeded Mulberry32 PRNG, deterministic assertions |
| Scoring unification test | Impossible assertion (same rank for all inputs) | Tests base-score delegation, not universal rank equality |
| Regression safety | "Existing tests provide safety" | Mandatory full-suite gate between every phase |
| Config versioning | None | `pine-config-version.mjs` with v1→v2 migration |
| Cache invalidation | Not addressed | `cacheVersion` field, auto-reject stale entries |
| Walk-forward integration | Standalone module | Wired into promotion pipeline via `evaluateWalkForwardGate` |
| Streaming metrics | Not addressed | Aligned to use `returnPctExact` consistently |
| Regime-aware walk-forward | Not addressed | `buildRegimeAwareWindows` using existing regime slices |
| Convergence quality | Simple level check | Quality floors (ROI, PF, DD, trade count) |
| Data quality integration | Created but never called | Wired into pipeline via `evaluateDataQualityGate` |
| End-to-end validation | None | `pine-integration-e2e.test.mjs` comparing old vs new |
| Duplicate code | Full implementation repeated | Single implementation, referenced once |
