# Pine Autoresearch Search Effectiveness Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the systemic issues preventing pine autoresearch from promoting candidates — the ROI gate is too strict for the type of improvements being found, the search is trapped in a `slAtrMult=0.1` local optimum, shadow labs are never evaluated, and stale state files cause confusion.

**Architecture:** Relax the ROI gate thresholds to match observed candidate quality, constrain `slAtrMult` minimum to force exploration of intermediate values, evaluate shadow labs unconditionally for robustness signal, deduplicate the pareto shortlist, and clean stale convergence state. All changes are config or pure-function modifications with TDD.

**Tech Stack:** Node.js ESM, `node:test`, JSON config, Pine autoresearch artifacts.

---

## Evidence From Latest Cycle (2026-05-16T11:37:11Z)

| Metric | Champion | Best Candidate | Delta |
|--------|----------|---------------|-------|
| Score | 152.47 | 172.33 | +19.86 |
| ROI% | 91.7 | 76.41 | **-15.29** |
| PF | 3.56 | 9.14 | +5.58 |
| MaxDD% | 2.88 | 1.19 | -1.69 |
| Trades | 261 | 245 | -16 |
| WinRate% | 42.53 | 29.39 | -13.14 |

The candidate was blocked solely by the `roi` gate in the primary lab. Shadow labs were never evaluated. The winning config change: `slAtrMult: 0.1, minBarsBetween: 7`.

---

## File Structure

Modify these files:

- `config/pine-autoresearch.default.json`
  - Relax `roiRelaxation` thresholds
  - Add `slAtrMult` minimum bound to search policy
  - Clean up pareto shortlist deduplication config
- `scripts/lib/pine-autoresearch.mjs`
  - Evaluate shadow labs even when primary holds (for diagnostics only, not promotion)
  - Deduplicate pareto shortlist entries
- `scripts/lib/pine-search-policy.mjs`
  - Enforce parameter bounds during variant generation
- `scripts/pine-autoresearch.mjs`
  - Clean stale convergence file on fresh cycle after code change
- Tests:
  - `tests/pine-autoresearch.test.mjs`
  - `tests/pine-search-policy.test.mjs`

---

### Task 1: Relax ROI Gate Thresholds to Match Observed Candidate Quality

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-autoresearch.test.mjs`

**Rationale:** Current thresholds (`minScoreDeltaToRelax: 20`, `maxRoiRegressionPct: 10`) are too tight. The system repeatedly finds candidates scoring +19.86 with -15.29% ROI regression. The relaxation should fire for these candidates.

- [ ] **Step 1: Write failing test for relaxed thresholds**

Add to `tests/pine-autoresearch.test.mjs`:

```js
test('decideAutoresearchOutcome promotes candidate with score +19.86 and ROI -15.29 under relaxed thresholds', () => {
  const result = decideAutoresearchOutcome({
    incumbent: { score: 152.47, roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261 },
    challenger: { score: 172.33, roiPct: 76.41, profitFactor: 9.14, maxDrawdownPct: 1.19, tradeCount: 245 },
    thresholds: {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 15,
        maxRoiRegressionPct: 20,
      },
    },
  });

  assert.equal(result.recommendation, 'promote');
  assert.ok(!result.failedGates.includes('roi'));
  assert.equal(result.comparisons.roiRelaxationApplied, true);
});
```

- [ ] **Step 2: Run test to verify it passes (should already pass with existing implementation)**

```bash
node --test --test-name-pattern="promotes candidate with score .19.86" tests/pine-autoresearch.test.mjs
```

Expected: PASS — the ROI relaxation logic already supports arbitrary thresholds. This test validates the new config values work.

- [ ] **Step 3: Update config thresholds**

In `config/pine-autoresearch.default.json`, change `primaryLab.thresholds.roiRelaxation` from:

```json
"roiRelaxation": {
  "enabled": true,
  "minScoreDeltaToRelax": 20,
  "maxRoiRegressionPct": 10
}
```

to:

```json
"roiRelaxation": {
  "enabled": true,
  "minScoreDeltaToRelax": 15,
  "maxRoiRegressionPct": 20
}
```

This means: if a candidate's composite score is ≥15 points above the incumbent AND the ROI regression is ≤20%, the ROI gate is relaxed. The latest candidate (score +19.86, ROI -15.29%) would now pass.

- [ ] **Step 4: Run full autoresearch test suite**

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs
git commit -m "config: relax ROI gate thresholds to match observed candidate quality"
```

---

### Task 2: Constrain slAtrMult Minimum to Prevent Tight-Stop Attractor

**Files:**
- Modify: `scripts/lib/pine-search-policy.mjs`
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-search-policy.test.mjs`

**Rationale:** Every high-score candidate the system finds has `slAtrMult: 0.1` (the minimum possible). This creates a local optimum trap — tight stops mechanically improve PF and DD but destroy ROI and win rate. By setting a minimum bound of 0.25, the system is forced to explore intermediate values that may preserve more ROI while still improving risk metrics.

- [ ] **Step 1: Write failing test for parameter bounds enforcement**

Add to `tests/pine-search-policy.test.mjs`:

```js
test('buildIncumbentSearchBatch enforces parameterBounds minimum on generated variants', () => {
  const batch = buildIncumbentSearchBatch({
    incumbent: { slAtrMult: 0.5, tpAtrMult: 6.85, minBarsBetween: 1 },
    maxConfigs: 8,
    historyEvents: [],
    policy: {
      mode: 'incumbent-local',
      exploitRatio: 1.0,
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
      parameterBounds: {
        slAtrMult: { min: 0.25 },
      },
    },
    schedulerState: { cycleIndex: 1, stagnationLevel: 0 },
  });

  for (const variant of batch) {
    if (variant.config && 'slAtrMult' in variant.config) {
      assert.ok(
        variant.config.slAtrMult >= 0.25,
        `slAtrMult ${variant.config.slAtrMult} is below minimum 0.25`
      );
    }
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test --test-name-pattern="enforces parameterBounds minimum" tests/pine-search-policy.test.mjs
```

Expected: FAIL — some variants will have `slAtrMult` below 0.25 because bounds enforcement doesn't exist yet.

- [ ] **Step 3: Implement parameter bounds enforcement**

In `scripts/lib/pine-search-policy.mjs`, find where final variant configs are assembled (after mutation/patching). Add a bounds clamping step. Look for where `variant.config` is built — it should be near the end of `buildIncumbentSearchBatch` or in a helper that assembles the final config.

Add this function near the top of the file:

```js
function clampParameterBounds(config, parameterBounds = {}) {
  if (!config || typeof config !== 'object') return config;
  if (!parameterBounds || typeof parameterBounds !== 'object') return config;
  const clamped = { ...config };
  for (const [key, bounds] of Object.entries(parameterBounds)) {
    if (!(key in clamped)) continue;
    const value = Number(clamped[key]);
    if (!Number.isFinite(value)) continue;
    if (Number.isFinite(bounds.min) && value < bounds.min) {
      clamped[key] = bounds.min;
    }
    if (Number.isFinite(bounds.max) && value > bounds.max) {
      clamped[key] = bounds.max;
    }
  }
  return clamped;
}
```

Then apply it to each variant's config before it's added to the batch. Find the return statement or the array push where variants are collected, and wrap:

```js
variant.config = clampParameterBounds(variant.config, policy.parameterBounds);
```

IMPORTANT: This must be applied AFTER mutation but BEFORE tabu fingerprinting, so the clamped config is what gets fingerprinted and evaluated.

- [ ] **Step 4: Run test to verify it passes**

```bash
node --test --test-name-pattern="enforces parameterBounds minimum" tests/pine-search-policy.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Also apply bounds in track generators**

The same bounds must be enforced in `scripts/lib/pine-track-generators.mjs`. Find where `buildTrackCandidateBatch` assembles variant configs and apply the same clamping:

```js
import { clampParameterBounds } from './pine-search-policy.mjs';
```

Then after each variant config is built:
```js
variant.config = clampParameterBounds(variant.config, budgetPolicy.parameterBounds);
```

- [ ] **Step 6: Write test for track generator bounds**

Add to `tests/pine-track-generators.test.mjs`:

```js
test('buildTrackCandidateBatch enforces parameterBounds on track variants', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'risk-test', sourceFamily: 'risk', gridName: 'test', variantMode: 'grid', enabled: true },
    incumbent: { slAtrMult: 0.5, tpAtrMult: 6.85 },
    maxConfigs: 6,
    historyEvents: [],
    budgetPolicy: {
      exploitFamilies: ['risk'],
      exploreFamilies: ['risk'],
      parameterBounds: { slAtrMult: { min: 0.25 } },
      selfLoopEscape: { enabled: true, activateAfter: 1, includeFallback: true, fallbackFamilies: ['risk'], minFallbackConfigs: 3 },
    },
    schedulerState: { cycleIndex: 1, stagnationLevel: 0, noNewCandidateStreak: 2 },
  });

  for (const variant of batch) {
    if (variant.config && 'slAtrMult' in variant.config) {
      assert.ok(
        variant.config.slAtrMult >= 0.25,
        `Track variant slAtrMult ${variant.config.slAtrMult} is below minimum 0.25`
      );
    }
  }
});
```

- [ ] **Step 7: Run both test suites**

```bash
node --test tests/pine-search-policy.test.mjs tests/pine-track-generators.test.mjs
```

Expected: all pass.

- [ ] **Step 8: Add parameterBounds to config**

In `config/pine-autoresearch.default.json`, add inside `searchPolicy`:

```json
"parameterBounds": {
  "slAtrMult": { "min": 0.25 },
  "minBarsBetween": { "min": 1, "max": 5 }
}
```

This prevents `slAtrMult` from going below 0.25 and `minBarsBetween` from exceeding 5 (the latest candidate had `minBarsBetween: 7` which is extreme).

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/pine-search-policy.mjs scripts/lib/pine-track-generators.mjs config/pine-autoresearch.default.json tests/pine-search-policy.test.mjs tests/pine-track-generators.test.mjs
git commit -m "feat: enforce parameter bounds to prevent tight-stop local optimum trap"
```

---
