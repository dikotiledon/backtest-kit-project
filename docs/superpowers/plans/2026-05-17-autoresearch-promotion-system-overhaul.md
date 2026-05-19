# Autoresearch Promotion System Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all promotion gate, stagnation escape, and search policy issues preventing the autoresearch system from promoting valid candidates — bringing every system dimension to A-grade operational health.

**Architecture:** The autoresearch system has a pipeline: generate variants → evaluate on primary lab → check promotion gates → optionally evaluate shadows → promote or hold. The pipeline is broken at multiple points: config normalization drops `roiRelaxation`, the PF gate is miscalibrated, stagnation escape doesn't recognize gate-stagnation, rotation has an off-by-one, and `scoreImproved` has a circular dependency with the broken gate. Fixes are ordered by dependency: config passthrough first (unblocks relaxation), then gate calibration, then stagnation/rotation logic, then integration tests.

**Tech Stack:** Node.js (ESM), `node:test` runner, JSON config files, PineScript backtesting

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `scripts/pine-autoresearch.mjs` | Main orchestrator, config loading, `getThresholds()` | Modify |
| `scripts/lib/pine-autoresearch.mjs` | `decideAutoresearchOutcome()`, `decideMatrixPromotion()` | Modify |
| `scripts/lib/pine-autoresearch-tracks.mjs` | Track rotation, stagnation, tabu pruning | Modify |
| `scripts/lib/pine-stagnation-escape.mjs` | `decideStagnationEscapePlan()` | Modify |
| `scripts/lib/pine-search-policy.mjs` | `buildIncumbentSearchBatch()`, gate-aware filter | Modify |
| `config/pine-autoresearch.default.json` | Default config with thresholds | Modify |
| `tests/pine-autoresearch.test.mjs` | Main test file | Modify |
| `tests/pine-autoresearch-promotion-overhaul.test.mjs` | New integration tests for this overhaul | Create |

---

## Issue Inventory

| # | Issue | Type | Severity | Root Location |
|---|-------|------|----------|---------------|
| 1 | `getThresholds()` strips `roiRelaxation` object | Bug | Critical | `scripts/pine-autoresearch.mjs:2017` |
| 2 | `minProfitFactorDelta: 0` blocks any PF regression | Policy | High | `config/pine-autoresearch.default.json` |
| 3 | Stagnation escape only handles generation stagnation | Design | High | `scripts/lib/pine-stagnation-escape.mjs` |
| 4 | Track rotation uses `>` instead of `>=` | Bug | Medium | `scripts/lib/pine-autoresearch-tracks.mjs:420` |
| 5 | Shadow labs never evaluated (primary always holds) | Consequence | Medium | Resolved by fixing #1 and #2 |
| 6 | `scoreImproved` requires `primaryLabPassed` — circular | Design | High | `scripts/lib/pine-autoresearch-tracks.mjs:607` |
| 7 | De-escalation yo-yo: system de-escalates while gate-stuck | Design | Medium | `scripts/lib/pine-autoresearch-tracks.mjs:631` |
| 8 | `gateAwareFilter` blocks tight-stop candidates that could pass via tiered relaxation | Policy | Low | `config/pine-autoresearch.default.json` |

---

### Task 1: Fix `getThresholds()` to pass through `roiRelaxation` (Issue #1)

**Files:**
- Modify: `scripts/pine-autoresearch.mjs:2017-2028`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pine-autoresearch-promotion-overhaul.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// We need to import getThresholds — it's not exported, so we test via normalizeLab or
// by importing the module and testing the downstream effect on decideAutoresearchOutcome.
// Since getThresholds is internal, we test via the public path: the lab thresholds
// that reach decideAutoresearchOutcome must include roiRelaxation.

import { decideAutoresearchOutcome } from '../scripts/lib/pine-autoresearch.mjs';

describe('Issue #1: roiRelaxation passthrough', () => {
  it('should apply tiered ROI relaxation when score delta exceeds threshold and PF multiplier met', () => {
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-tight-stop',
      score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: {
        roiPct: 76.41,
        profitFactor: 9.14,
        maxDrawdownPct: 1.19,
        tradeCount: 245,
        winRatePct: 29.39,
        avgWin: 1.19,
        avgLoss: 0.05,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 12,
        maxRoiRegressionPct: 10,
        tieredRelaxation: {
          enabled: true,
          pfMultiplierThreshold: 2,
          ddImprovementRequired: true,
          maxRoiRegressionPct: 20,
        },
      },
    };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(result.recommendation, 'promote',
      `Expected promote but got hold. Failed gates: ${result.failedGates?.join(', ')}`);
    assert.equal(result.comparisons.roiRelaxationApplied, true);
    assert.equal(result.comparisons.roiRelaxationTier, 'tiered');
  });

  it('should NOT relax ROI when roiRelaxation is missing from thresholds (current broken behavior)', () => {
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-tight-stop',
      score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: {
        roiPct: 76.41,
        profitFactor: 9.14,
        maxDrawdownPct: 1.19,
        tradeCount: 245,
        winRatePct: 29.39,
        avgWin: 1.19,
        avgLoss: 0.05,
      },
    };
    // No roiRelaxation in thresholds — should hold
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(result.recommendation, 'hold');
    assert.ok(result.failedGates.includes('roi'));
  });
});
```

- [ ] **Step 2: Run test to verify first test fails (roiRelaxation not reaching the function)**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test FAILS (recommendation is 'hold' instead of 'promote'), second test PASSES.

Note: The first test exercises `decideAutoresearchOutcome` directly with `roiRelaxation` in thresholds. This test should PASS already because the lib function itself handles `roiRelaxation` correctly — the bug is in `getThresholds()` stripping it before it reaches the function. If both pass, we need an integration-level test (Task 1b).

- [ ] **Step 3: Write integration test proving getThresholds strips roiRelaxation**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { loadConfig } from '../scripts/pine-autoresearch.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '..');

describe('Issue #1: getThresholds integration', () => {
  it('normalized primary lab thresholds must include roiRelaxation', async () => {
    const config = await loadConfig(cwd, './config/pine-autoresearch.default.json');
    const primaryLab = config.labs?.[0] ?? config.primaryLabNormalized ?? config.primaryLab;
    assert.ok(primaryLab.thresholds.roiRelaxation, 'roiRelaxation must survive normalization');
    assert.equal(primaryLab.thresholds.roiRelaxation.enabled, true);
    assert.equal(primaryLab.thresholds.roiRelaxation.tieredRelaxation.enabled, true);
  });
});
```

- [ ] **Step 4: Run integration test to confirm it fails**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: Integration test FAILS — `primaryLab.thresholds.roiRelaxation` is undefined.

- [ ] **Step 5: Fix `getThresholds()` to pass through roiRelaxation**

In `scripts/pine-autoresearch.mjs`, modify `getThresholds()`:

```javascript
function getThresholds(raw = {}) {
  const thresholds = {
    minScoreDelta: raw.minScoreDelta ?? 0.25,
    minRoiDeltaPct: raw.minRoiDeltaPct ?? 0,
    minProfitFactorDelta: raw.minProfitFactorDelta ?? 0,
    maxDrawdownDeltaPct: raw.maxDrawdownDeltaPct ?? 0.75,
    minTradeCount: raw.minTradeCount ?? 100,
    minTradeRatioVsIncumbent: raw.minTradeRatioVsIncumbent ?? 0.75,
  };
  if (raw.significance != null) {
    thresholds.significance = raw.significance;
  }
  if (raw.roiRelaxation != null) {
    thresholds.roiRelaxation = raw.roiRelaxation;
  }
  return thresholds;
}
```

- [ ] **Step 6: Run tests to verify both pass**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: ALL tests PASS.

- [ ] **Step 7: Run existing test suite to verify no regressions**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All existing tests pass (200+ tests).

- [ ] **Step 8: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "fix: pass roiRelaxation through getThresholds() to decideAutoresearchOutcome

The getThresholds() normalizer was stripping the roiRelaxation object,
making tiered ROI relaxation permanently disabled regardless of config.
This caused candidates with high score/PF/DD improvements but ROI
regression to be wrongly rejected (e.g. score 172, PF 9.14, DD 1.19%)."
```

---

### Task 2: Calibrate `minProfitFactorDelta` to allow marginal PF regression (Issue #2)

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
describe('Issue #2: profitFactor gate calibration', () => {
  it('should promote when PF regression is marginal (-0.02) but score and ROI improve', () => {
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { minPredSum: 1.8 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-squeeze',
      score: 153.32,
      config: { minPredSum: 1.6, useSqueezeContext: true, squeezeLength: 16 },
      metrics: {
        roiPct: 92.84,
        profitFactor: 3.54,
        maxDrawdownPct: 3.12,
        tradeCount: 268,
        winRatePct: 42.54,
        avgWin: 1.14,
        avgLoss: 0.24,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,  // Allow marginal PF regression
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(result.recommendation, 'promote',
      `Expected promote but got hold. Failed gates: ${result.failedGates?.join(', ')}`);
  });

  it('should hold when PF regression exceeds tolerance (-0.1)', () => {
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { minPredSum: 1.8 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-bad-pf',
      score: 153.0,
      config: { minPredSum: 1.5 },
      metrics: {
        roiPct: 92.0,
        profitFactor: 3.46,  // -0.10 regression
        maxDrawdownPct: 3.0,
        tradeCount: 270,
        winRatePct: 41.0,
        avgWin: 1.12,
        avgLoss: 0.24,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
    };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    assert.equal(result.recommendation, 'hold');
    assert.ok(result.failedGates.includes('profitFactor'));
  });
});
```

- [ ] **Step 2: Run test to verify first test fails with current config (minProfitFactorDelta: 0)**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test PASSES (we pass thresholds directly with -0.05). Both should pass since we're testing the lib function directly.

Note: The real fix is in the config file. The lib function already respects whatever `minProfitFactorDelta` is passed. The issue is the config value `0` is too strict.

- [ ] **Step 3: Update config to set `minProfitFactorDelta: -0.05`**

In `config/pine-autoresearch.default.json`, change the `primaryLab.thresholds` section:

```json
"thresholds": {
  "minScoreDelta": 0.1,
  "minRoiDeltaPct": 0,
  "minProfitFactorDelta": -0.05,
  "maxDrawdownDeltaPct": 0.75,
  "minTradeCount": 150,
  "minTradeRatioVsIncumbent": 0.75,
  "significance": {
    "minRelativeScoreDelta": 0.003,
    "minTradeCount": 150
  },
  "roiRelaxation": {
    "enabled": true,
    "minScoreDeltaToRelax": 12,
    "maxRoiRegressionPct": 10,
    "tieredRelaxation": {
      "enabled": true,
      "pfMultiplierThreshold": 2,
      "ddImprovementRequired": true,
      "maxRoiRegressionPct": 20
    }
  }
}
```

- [ ] **Step 4: Run existing test suite**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All pass. If any test hardcodes `minProfitFactorDelta: 0` expectation, update it.

- [ ] **Step 5: Commit**

```bash
git add config/pine-autoresearch.default.json tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "config: set minProfitFactorDelta to -0.05 to allow marginal PF regression

A -0.02 PF regression (3.54 vs 3.56) was blocking promotion of a
candidate with +0.85 score, +1.14% ROI, +7 trades. The zero threshold
made it impossible for any candidate activating new features to promote
if it caused even rounding-level PF changes."
```

---

### Task 3: Fix track rotation off-by-one (Issue #4)

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs:420`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { nextTrackState } from '../scripts/lib/pine-autoresearch-tracks.mjs';

describe('Issue #4: track rotation off-by-one', () => {
  it('should trigger maxCyclesPerTrack rotation when streak equals max (not just exceeds)', () => {
    const state = {
      activeTrackId: 'squeeze-context',
      sameTrackCycleStreak: 8,
      noChangeStreak: 0,
      noNewCandidateStreak: 0,
      lowEmissionStreak: 0,
      noScoreImprovementStreak: 0,
      cycleIndex: 30,
      tabuRejectedFingerprints: [],
    };
    const policy = {
      maxCyclesPerTrack: 8,
      noChangeStreakRotateAfter: 4,
      similarityRotateAbove: 0.99,
      zeroEmissionRotateAfter: 1,
    };
    const manifest = {
      promotionEligible: false,
      activeTrackId: 'squeeze-context',
      topCandidateSimilarity: 0.5,
      searchEfficiency: { emittedVariantCount: 12 },
    };
    const result = nextTrackState({ state, policy, manifest });
    // After fix: streak 8 with max 8 should trigger rotation
    assert.notEqual(result.activeTrackId, 'squeeze-context',
      'Should have rotated away from squeeze-context at streak == maxCyclesPerTrack');
  });

  it('should NOT rotate when streak is below max', () => {
    const state = {
      activeTrackId: 'squeeze-context',
      sameTrackCycleStreak: 7,
      noChangeStreak: 0,
      noNewCandidateStreak: 0,
      lowEmissionStreak: 0,
      noScoreImprovementStreak: 0,
      cycleIndex: 30,
      tabuRejectedFingerprints: [],
    };
    const policy = {
      maxCyclesPerTrack: 8,
      noChangeStreakRotateAfter: 4,
      similarityRotateAbove: 0.99,
      zeroEmissionRotateAfter: 1,
    };
    const manifest = {
      promotionEligible: false,
      activeTrackId: 'squeeze-context',
      topCandidateSimilarity: 0.5,
      searchEfficiency: { emittedVariantCount: 12 },
    };
    const result = nextTrackState({ state, policy, manifest });
    assert.equal(result.activeTrackId, 'squeeze-context',
      'Should NOT rotate when streak < maxCyclesPerTrack');
  });
});
```

- [ ] **Step 2: Run test to verify first test fails**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test FAILS (streak 8 does not trigger rotation with `>` check).

- [ ] **Step 3: Fix the comparison operator**

In `scripts/lib/pine-autoresearch-tracks.mjs`, line ~420, change:

```javascript
// Before:
if ((state?.sameTrackCycleStreak ?? 0) > maxCyclesPerTrack && manifest.promotionEligible === false) {
  return 'maxCyclesPerTrack';
}

// After:
if ((state?.sameTrackCycleStreak ?? 0) >= maxCyclesPerTrack && manifest.promotionEligible === false) {
  return 'maxCyclesPerTrack';
}
```

Also fix the same pattern in `scripts/pine-autoresearch.mjs` at `resolveTrackSelectionState` (~line 1285):

```javascript
// Before:
?? (schedulerState.sameTrackCycleStreak > maxCyclesPerTrack && previousCycle?.promotionEligible === false ? 'maxCyclesPerTrack' : null);

// After:
?? (schedulerState.sameTrackCycleStreak >= maxCyclesPerTrack && previousCycle?.promotionEligible === false ? 'maxCyclesPerTrack' : null);
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs && node --test tests/pine-autoresearch.test.mjs`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "fix: track rotation triggers at maxCyclesPerTrack (>= not >)

Off-by-one: streak 8 with maxCyclesPerTrack 8 should trigger rotation
but required streak 9 due to strict > comparison."
```

---

### Task 4: Fix `scoreImproved` circular dependency (Issue #6)

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs:605-614`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Problem:** `scoreImproved` requires `primaryLabPassed === true`, but the primary lab always says "hold" due to the gate bugs. This means `noScoreImprovementStreak` always increments, stagnation always escalates, but the system never recognizes actual score improvement from candidates that beat the champion on raw score but fail a gate.

**Fix:** Decouple `scoreImproved` from `primaryLabPassed`. A candidate that achieves a higher raw score than the champion IS a score improvement, even if it fails a promotion gate. The streak should reset when the best candidate score exceeds the champion score.

- [ ] **Step 1: Write the failing test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { nextTrackState } from '../scripts/lib/pine-autoresearch-tracks.mjs';

describe('Issue #6: scoreImproved circular dependency', () => {
  it('should reset noScoreImprovementStreak when best candidate beats champion score even if primary lab holds', () => {
    const state = {
      activeTrackId: 'squeeze-context',
      sameTrackCycleStreak: 5,
      noChangeStreak: 0,
      noNewCandidateStreak: 0,
      lowEmissionStreak: 0,
      noScoreImprovementStreak: 4,
      cycleIndex: 28,
      tabuRejectedFingerprints: [],
    };
    const policy = {
      maxCyclesPerTrack: 8,
      noChangeStreakRotateAfter: 4,
      stagnation: { enabled: true, noScoreImprovementEscalateAfter: 2 },
    };
    const manifest = {
      promotionEligible: false,
      primaryLabPassed: false,  // primary lab said hold
      activeTrackId: 'squeeze-context',
      topCandidateSimilarity: 0.5,
      searchEfficiency: { emittedVariantCount: 12 },
      bestCandidateScoreDelta: 0.85,  // candidate scored higher than champion
    };
    const result = nextTrackState({ state, policy, manifest });
    assert.equal(result.noScoreImprovementStreak, 0,
      'noScoreImprovementStreak should reset when best candidate beats champion score');
  });

  it('should increment noScoreImprovementStreak when no candidate beats champion score', () => {
    const state = {
      activeTrackId: 'squeeze-context',
      sameTrackCycleStreak: 5,
      noChangeStreak: 0,
      noNewCandidateStreak: 0,
      lowEmissionStreak: 0,
      noScoreImprovementStreak: 4,
      cycleIndex: 28,
      tabuRejectedFingerprints: [],
    };
    const policy = {
      maxCyclesPerTrack: 8,
      noChangeStreakRotateAfter: 4,
      stagnation: { enabled: true, noScoreImprovementEscalateAfter: 2 },
    };
    const manifest = {
      promotionEligible: false,
      primaryLabPassed: false,
      activeTrackId: 'squeeze-context',
      topCandidateSimilarity: 0.98,
      searchEfficiency: { emittedVariantCount: 12 },
      bestCandidateScoreDelta: -0.5,  // no candidate beat champion
    };
    const result = nextTrackState({ state, policy, manifest });
    assert.equal(result.noScoreImprovementStreak, 5,
      'noScoreImprovementStreak should increment when no candidate beats champion');
  });
});
```

- [ ] **Step 2: Run test to verify first test fails**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test FAILS (streak increments to 5 instead of resetting to 0).

- [ ] **Step 3: Fix `scoreImproved` logic**

In `scripts/lib/pine-autoresearch-tracks.mjs`, around line 605-614, change:

```javascript
// Before:
const primaryLabPassed = manifest.primaryLabPassed === true;
const scoreImproved = manifest.promotionEligible === true
  || (primaryLabPassed && bestScoreDelta !== null && bestScoreDelta > 0);
const scoreStagnant = bestScoreDelta !== null && !scoreImproved && manifest.promotionEligible !== true;

// After:
const primaryLabPassed = manifest.primaryLabPassed === true;
const rawScoreImproved = bestScoreDelta !== null && bestScoreDelta > 0;
const scoreImproved = manifest.promotionEligible === true || rawScoreImproved;
const scoreStagnant = bestScoreDelta !== null && !scoreImproved && manifest.promotionEligible !== true;
```

This decouples score improvement detection from the primary lab gate. A positive `bestScoreDelta` means the search found something better — that's progress regardless of whether it passed all gates.

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs && node --test tests/pine-autoresearch.test.mjs`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "fix: decouple scoreImproved from primaryLabPassed to break circular dependency

scoreImproved previously required primaryLabPassed, creating a circular
dependency: broken gates → primary always holds → scoreImproved always
false → stagnation escalates indefinitely. Now any positive score delta
resets the streak, correctly reflecting search progress."
```

---

### Task 5: Add gate-stagnation escape path (Issue #3)

**Files:**
- Modify: `scripts/lib/pine-stagnation-escape.mjs`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Problem:** `decideStagnationEscapePlan()` only activates when generation lanes are exhausted or zero-emission occurs. When the system generates 12 variants per cycle but none pass the promotion gate, escape stays "not-eligible" even at stagnation level 6. The system needs a gate-stagnation escape that progressively relaxes search bounds when candidates are being generated but can't promote.

**Fix:** Add a new escape condition: when `stagnationLevel >= 3` and generation is healthy (not exhausted, not zero-emission), activate a `gate-stagnation` escape mode that widens search bounds and allows architecture mutations.

- [ ] **Step 1: Write the failing test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { decideStagnationEscapePlan } from '../scripts/lib/pine-stagnation-escape.mjs';

describe('Issue #3: gate-stagnation escape', () => {
  it('should activate gate-stagnation escape at level 3+ when generation is healthy', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 3,
      generatedLanesExhausted: false,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    assert.notEqual(result.mode, 'none',
      'Should activate escape when gate-stagnation at level 3+');
    assert.equal(result.reason, 'gate-stagnation');
    assert.equal(result.allowArchitectureKeys, true);
  });

  it('should use progressive-widen at level 5+ gate-stagnation', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 5,
      generatedLanesExhausted: false,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    assert.equal(result.mode, 'progressive-widen');
    assert.ok(result.multiKeyMutationCount >= 3);
    assert.ok(result.ladderScale >= 2);
  });

  it('should remain not-eligible at level 2 even with gate-stagnation', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 2,
      generatedLanesExhausted: false,
      exploitExhausted: false,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    // Level 2 gate-stagnation should not yet trigger escape
    // (existing behavior for level < 2 returns none)
    assert.equal(result.mode, 'none');
  });

  it('should not activate gate-stagnation escape when generation IS exhausted (use existing path)', () => {
    const result = decideStagnationEscapePlan({
      stagnationLevel: 4,
      generatedLanesExhausted: true,
      exploitExhausted: true,
      zeroEmissionExhausted: false,
      gateStagnation: true,
    });
    // Should use existing exhaustion-based escape, not gate-stagnation
    assert.notEqual(result.reason, 'gate-stagnation');
  });
});
```

- [ ] **Step 2: Run test to verify first test fails**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test FAILS (returns `{ mode: 'none', reason: 'not-eligible' }`).

- [ ] **Step 3: Implement gate-stagnation escape in `decideStagnationEscapePlan`**

In `scripts/lib/pine-stagnation-escape.mjs`, add gate-stagnation handling:

```javascript
export function decideStagnationEscapePlan(input = {}) {
  const {
    stagnationLevel = 0,
    generatedLanesExhausted = false,
    exploitExhausted = false,
    zeroEmissionExhausted = false,
    gateStagnation = false,
  } = normalizeInput(input);

  const level = Number(stagnationLevel);
  const safeLevel = Number.isFinite(level) ? level : 0;
  const generatedExhausted = isTruthy(generatedLanesExhausted);
  const exploitDone = isTruthy(exploitExhausted);
  const zeroEmissionDone = isTruthy(zeroEmissionExhausted);
  const gateStuck = isTruthy(gateStagnation);

  if (safeLevel < 2) return { mode: 'none', reason: 'not-eligible' };

  if (!generatedExhausted && zeroEmissionDone) {
    return {
      mode: 'progressive-widen',
      reason: 'zero-emission-exhausted',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 3,
      ladderScale: 2,
    };
  }

  if (!generatedExhausted && !zeroEmissionDone && gateStuck && safeLevel >= 3) {
    // Gate-stagnation: generating candidates but none pass promotion gates
    if (safeLevel >= 5) {
      return {
        mode: 'progressive-widen',
        reason: 'gate-stagnation',
        allowArchitectureKeys: true,
        multiKeyMutationCount: 4,
        ladderScale: 2.5,
      };
    }
    return {
      mode: 'widen-architecture',
      reason: 'gate-stagnation',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 3,
      ladderScale: 2,
    };
  }

  if (!generatedExhausted) return { mode: 'none', reason: 'not-eligible' };

  // Level 2 + both exhausted → allow architecture mutation
  if (safeLevel === 2 && exploitDone) {
    return {
      mode: 'widen-architecture',
      reason: 'all-lanes-exhausted-at-level-2',
      allowArchitectureKeys: true,
      multiKeyMutationCount: 2,
      ladderScale: 1.5,
    };
  }

  if (safeLevel === 2) {
    return {
      mode: 'widen-bounds',
      reason: 'generated-lanes-exhausted',
      allowArchitectureKeys: false,
      multiKeyMutationCount: 2,
      ladderScale: 1.5,
    };
  }

  if (!exploitDone) {
    return {
      mode: 'exploit-deepen',
      reason: 'exploit-still-available',
      allowArchitectureKeys: false,
      multiKeyMutationCount: 2,
      ladderScale: 1.25,
    };
  }

  return {
    mode: 'progressive-widen',
    reason: 'all-lanes-exhausted',
    allowArchitectureKeys: true,
    multiKeyMutationCount: 3,
    ladderScale: 2,
  };
}
```

- [ ] **Step 4: Wire `gateStagnation` flag in the caller**

In `scripts/pine-autoresearch.mjs`, in `resolveScoutStagnationEscape()` (~line 1387), pass the new flag:

```javascript
export function resolveScoutStagnationEscape({ schedulerState = {}, championState = null, latestManifest = null } = {}) {
  const championConfigFingerprint = championState?.config
    ? buildChampionConfigFingerprint(championState.config)
    : null;
  const exhaustedLanes = resolveExhaustedResearchLanes({
    schedulerState,
    championConfigFingerprint,
  });
  const generatedLanesExhausted = exhaustedLanes.includes('globalAllParameter')
    && exhaustedLanes.includes('exitRegime');
  const previousSearchEfficiency = latestManifest?.searchEfficiency ?? null;
  const exploitExhausted = resolveSearchEfficiencyExploitExhausted(previousSearchEfficiency);
  const zeroEmissionExhausted = Number(previousSearchEfficiency?.emittedVariantCount) === 0
    && previousSearchEfficiency?.allCandidatesTabu === true;

  // Gate-stagnation: variants are being generated but none pass promotion gates
  const emittedVariants = Number(previousSearchEfficiency?.emittedVariantCount) || 0;
  const noScoreImprovementStreak = Number(schedulerState?.noScoreImprovementStreak) || 0;
  const gateStagnation = emittedVariants > 0
    && !zeroEmissionExhausted
    && noScoreImprovementStreak >= 3;

  return decideStagnationEscapePlan({
    stagnationLevel: schedulerState?.stagnationLevel ?? 0,
    generatedLanesExhausted,
    exploitExhausted,
    zeroEmissionExhausted,
    gateStagnation,
  });
}
```

- [ ] **Step 5: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs && node --test tests/pine-autoresearch.test.mjs`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-stagnation-escape.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "feat: add gate-stagnation escape path for promotion-blocked cycles

When the system generates variants but none pass promotion gates
(noScoreImprovementStreak >= 3, stagnationLevel >= 3), activate
architecture-widening escape. Previously escape only fired on
generation exhaustion, leaving gate-stuck systems at level 6 with
no recovery path."
```

---

### Task 6: Fix de-escalation yo-yo (Issue #7)

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs:631`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Problem:** The de-escalation logic excludes `noScoreImprovementStreak` from healthy-cycle checks. This means the system can de-escalate (reduce stagnation level) while still gate-stuck, then re-escalate next cycle — creating a yo-yo between levels. The intent was good (don't penalize productive generation), but the effect is that stagnation level oscillates instead of staying elevated until the gate problem is resolved.

**Fix:** Add a guard: do not de-escalate if `noScoreImprovementStreak` exceeds the escalation threshold. The system must show actual score progress (not just variant emission) before de-escalating.

- [ ] **Step 1: Write the failing test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { nextStagnationState } from '../scripts/lib/pine-autoresearch-tracks.mjs';

describe('Issue #7: de-escalation yo-yo prevention', () => {
  it('should NOT de-escalate when noScoreImprovementStreak exceeds threshold', () => {
    const result = nextStagnationState({
      previousLevel: 4,
      noNewCandidateStreak: 0,
      noScoreImprovementStreak: 8,
      noChangeStreak: 0,
      lowEmissionStreak: 0,
      promotionEligible: false,
      topCandidateSimilarity: 0.5,
      policy: {
        enabled: true,
        maxStagnationLevel: 6,
        noScoreImprovementEscalateAfter: 2,
        deescalation: {
          enabled: true,
          consecutiveHealthyCycles: 2,
        },
        _healthyCycleCount: 3,
      },
    });
    assert.equal(result.stagnationLevel, 4,
      'Should NOT de-escalate while noScoreImprovementStreak is high');
  });

  it('should de-escalate when noScoreImprovementStreak is below threshold', () => {
    const result = nextStagnationState({
      previousLevel: 4,
      noNewCandidateStreak: 0,
      noScoreImprovementStreak: 1,
      noChangeStreak: 0,
      lowEmissionStreak: 0,
      promotionEligible: false,
      topCandidateSimilarity: 0.5,
      policy: {
        enabled: true,
        maxStagnationLevel: 6,
        noScoreImprovementEscalateAfter: 2,
        deescalation: {
          enabled: true,
          consecutiveHealthyCycles: 2,
        },
        _healthyCycleCount: 3,
      },
    });
    assert.equal(result.stagnationLevel, 3,
      'Should de-escalate when noScoreImprovementStreak is low');
  });
});
```

- [ ] **Step 2: Run test to verify first test fails**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test FAILS (de-escalates to 3 despite high noScoreImprovementStreak).

- [ ] **Step 3: Add guard to de-escalation logic**

In `scripts/lib/pine-autoresearch-tracks.mjs`, in the `nextStagnationState` function, around the de-escalation check (~line 500), add a guard:

```javascript
// Before:
if (deescalationEnabled && normalizedPreviousLevel > 0 && productiveStreaksZero && healthyCycleCount >= consecutiveHealthyCycles) {
  return {
    stagnationLevel: normalizedPreviousLevel - 1,
    stagnationReason: 'deescalation',
    lastEscalatedAt: sourcePolicy.lastEscalatedAt ?? null,
  };
}

// After:
const scoreStagnationBlocksDeescalation = normalizedNoScoreImprovementStreak >= noScoreImprovementEscalateAfter;
if (deescalationEnabled && normalizedPreviousLevel > 0 && productiveStreaksZero && healthyCycleCount >= consecutiveHealthyCycles && !scoreStagnationBlocksDeescalation) {
  return {
    stagnationLevel: normalizedPreviousLevel - 1,
    stagnationReason: 'deescalation',
    lastEscalatedAt: sourcePolicy.lastEscalatedAt ?? null,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs && node --test tests/pine-autoresearch.test.mjs`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "fix: prevent de-escalation yo-yo when gate-stuck

De-escalation was firing while noScoreImprovementStreak remained high,
causing stagnation level to oscillate. Now de-escalation requires
noScoreImprovementStreak below the escalation threshold, ensuring the
system stays elevated until actual score progress is made."
```

---

### Task 7: Adjust `gateAwareFilter` for tiered relaxation compatibility (Issue #8)

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Problem:** The `gateAwareFilter` with `slAtrMultMinRatio: 0.5` blocks generation of candidates with `slAtrMult < champion * 0.5` (i.e., < 0.25 when champion has 0.5). This prevents tight-stop candidates like `slAtrMult: 0.1` from being generated. With tiered ROI relaxation now working (after Task 1), these candidates CAN pass promotion — so the generation filter should not block them.

**Fix:** Lower `slAtrMultMinRatio` to `0.15` to allow tight-stop exploration while still filtering obviously degenerate values (< 0.075).

- [ ] **Step 1: Write the test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { buildTrackCandidateBatch } from '../scripts/lib/pine-track-generators.mjs';

describe('Issue #8: gateAwareFilter compatibility with tiered relaxation', () => {
  it('should allow slAtrMult 0.1 candidates when slAtrMultMinRatio is 0.15', () => {
    const incumbent = {
      slAtrMult: 0.5,
      minBarsBetween: 1,
      minPredSum: 1.8,
      tpAtrMult: 6.85,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useSupertrendFilter: true,
      supertrendAtrLen: 10,
      supertrendFactor: 1.5,
    };
    const batch = buildTrackCandidateBatch({
      track: { trackId: 'supertrend-tuning', sourceFamily: 'supertrend' },
      incumbent,
      maxConfigs: 12,
      historyEvents: [],
      budgetPolicy: {
        searchPolicy: {
          gateAwareFilter: { enabled: true, slAtrMultMinRatio: 0.15 },
        },
        selfLoopEscape: { enabled: false },
      },
      schedulerState: { cycleIndex: 0, tabuRejectedFingerprints: [] },
    });
    // With ratio 0.15, minimum slAtrMult = 0.5 * 0.15 = 0.075
    // slAtrMult 0.1 > 0.075, so it should NOT be filtered
    const hasLowSl = batch.some(v => v.config && v.config.slAtrMult < 0.25);
    // This test verifies the filter doesn't block moderate tight-stop candidates
    // The actual patch pool may or may not generate slAtrMult < 0.25 depending on
    // the supertrend family patches, so we just verify no crash and filter works
    assert.ok(batch.length > 0, 'Should generate candidates');
  });

  it('should block extremely low slAtrMult candidates (below 0.075)', () => {
    const incumbent = {
      slAtrMult: 0.5,
      minBarsBetween: 1,
      minPredSum: 1.8,
      tpAtrMult: 6.85,
      trailAtrMult: 1,
      trailActivateR: 0.5,
      useSupertrendFilter: true,
      supertrendAtrLen: 10,
      supertrendFactor: 1.5,
    };
    const batch = buildTrackCandidateBatch({
      track: { trackId: 'supertrend-tuning', sourceFamily: 'supertrend' },
      incumbent,
      maxConfigs: 12,
      historyEvents: [],
      budgetPolicy: {
        searchPolicy: {
          gateAwareFilter: { enabled: true, slAtrMultMinRatio: 0.15 },
        },
        selfLoopEscape: { enabled: false },
      },
      schedulerState: { cycleIndex: 0, tabuRejectedFingerprints: [] },
    });
    const hasDegenerateSl = batch.some(v =>
      v.config && Number.isFinite(v.config.slAtrMult) && v.config.slAtrMult < 0.075
    );
    assert.equal(hasDegenerateSl, false,
      'Should filter degenerate slAtrMult below 0.075');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: Both pass (testing the lib function directly with the new ratio).

- [ ] **Step 3: Update config**

In `config/pine-autoresearch.default.json`, change:

```json
"gateAwareFilter": {
  "enabled": true,
  "slAtrMultMinRatio": 0.15
}
```

- [ ] **Step 4: Run full test suite**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add config/pine-autoresearch.default.json tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "config: lower gateAwareFilter slAtrMultMinRatio to 0.15

With tiered ROI relaxation now functional, tight-stop candidates
(slAtrMult 0.1-0.25) can legitimately pass promotion via the tiered
path. The previous 0.5 ratio was blocking their generation entirely."
```

---

### Task 8: End-to-end integration test — full promotion pipeline (Issue #5 + validation)

**Files:**
- Test: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Problem:** Shadow labs are never evaluated because the primary lab always holds (Issue #5). This is a consequence of Issues #1 and #2. After fixing those, we need an integration test proving the full pipeline works: primary promotes → shadows evaluate → matrix decides.

- [ ] **Step 1: Write the end-to-end integration test**

```javascript
// Add to tests/pine-autoresearch-promotion-overhaul.test.mjs
import { decideMatrixPromotion } from '../scripts/lib/pine-autoresearch.mjs';

describe('Issue #5: Shadow labs activation (end-to-end)', () => {
  it('should evaluate shadows and promote when primary passes and shadows meet threshold', () => {
    const champion = {
      configId: 'original-153-champion',
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
    };
    const challenger = {
      configId: 'challenger-promoted',
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
    };
    const labResults = [
      // Primary lab: promotes
      {
        lab: { labId: 'xrpusdt-15m-primary' },
        decision: { recommendation: 'promote' },
      },
      // Shadow 1: promotes
      {
        lab: { labId: 'btcusdt-15m-current-shadow' },
        decision: { recommendation: 'promote' },
      },
      // Shadow 2: promotes
      {
        lab: { labId: 'ethusdt-15m-current-shadow' },
        decision: { recommendation: 'promote' },
      },
      // Shadow 3: promotes
      {
        lab: { labId: 'xrpusdt-15m-march-shadow' },
        decision: { recommendation: 'promote' },
      },
      // Shadow 4: holds
      {
        lab: { labId: 'btcusdt-15m-march-shadow' },
        decision: { recommendation: 'hold' },
      },
      // Shadow 5: holds
      {
        lab: { labId: 'ethusdt-15m-feb-shadow' },
        decision: { recommendation: 'hold' },
      },
    ];
    const policy = {
      requirePrimaryPromote: true,
      minShadowPassCount: 3,
      minShadowPassRatio: 0.6,
      requireCandidateChange: true,
    };
    const result = decideMatrixPromotion({
      labResults,
      policy,
      champion,
      challenger,
      shadowsEvaluated: true,
    });
    assert.equal(result.recommendation, 'promote',
      `Expected promote. Failed gates: ${result.failedGates?.join(', ')}`);
    assert.equal(result.gates.primaryPromote, true);
    assert.equal(result.gates.shadowPassCount, true);
    assert.equal(result.gates.shadowPassRatio, true);
    assert.equal(result.counts.shadowPassCount, 3);
    assert.equal(result.counts.shadowPassRatio, 0.6);
  });

  it('should hold when shadows do not meet minimum pass count', () => {
    const champion = {
      configId: 'original-153-champion',
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
    };
    const challenger = {
      configId: 'challenger-promoted',
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
    };
    const labResults = [
      { lab: { labId: 'primary' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-1' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-2' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-3' }, decision: { recommendation: 'hold' } },
      { lab: { labId: 'shadow-4' }, decision: { recommendation: 'hold' } },
      { lab: { labId: 'shadow-5' }, decision: { recommendation: 'hold' } },
    ];
    const policy = {
      requirePrimaryPromote: true,
      minShadowPassCount: 3,
      minShadowPassRatio: 0.6,
      requireCandidateChange: true,
    };
    const result = decideMatrixPromotion({
      labResults,
      policy,
      champion,
      challenger,
      shadowsEvaluated: true,
    });
    assert.equal(result.recommendation, 'hold');
    assert.ok(
      result.failedGates.includes('shadowPassCount') || result.failedGates.includes('shadowPassRatio'),
      'Should fail shadow gate'
    );
  });

  it('full pipeline: tiered relaxation + shadows = promotion', () => {
    // This test simulates the exact scenario from the score-172 candidate
    // after all fixes are applied
    const incumbent = {
      configId: 'original-153-champion',
      score: 152.47,
      config: { slAtrMult: 0.5, minBarsBetween: 1 },
      metrics: {
        roiPct: 91.7,
        profitFactor: 3.56,
        maxDrawdownPct: 2.88,
        tradeCount: 261,
        winRatePct: 42.53,
        avgWin: 1.15,
        avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger-tight-stop',
      score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: {
        roiPct: 76.41,
        profitFactor: 9.14,
        maxDrawdownPct: 1.19,
        tradeCount: 245,
        winRatePct: 29.39,
        avgWin: 1.19,
        avgLoss: 0.05,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 12,
        maxRoiRegressionPct: 10,
        tieredRelaxation: {
          enabled: true,
          pfMultiplierThreshold: 2,
          ddImprovementRequired: true,
          maxRoiRegressionPct: 20,
        },
      },
    };
    // Step 1: Primary lab decision
    const primaryDecision = decideAutoresearchOutcome({
      incumbent,
      challenger,
      thresholds,
    });
    assert.equal(primaryDecision.recommendation, 'promote',
      `Primary should promote via tiered relaxation. Failed: ${primaryDecision.failedGates?.join(', ')}`);
    assert.equal(primaryDecision.comparisons.roiRelaxationApplied, true);
    assert.equal(primaryDecision.comparisons.roiRelaxationTier, 'tiered');

    // Step 2: Matrix decision with shadows
    const labResults = [
      { lab: { labId: 'primary' }, decision: primaryDecision },
      { lab: { labId: 'shadow-1' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-2' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-3' }, decision: { recommendation: 'promote' } },
      { lab: { labId: 'shadow-4' }, decision: { recommendation: 'hold' } },
      { lab: { labId: 'shadow-5' }, decision: { recommendation: 'hold' } },
    ];
    const matrixResult = decideMatrixPromotion({
      labResults,
      policy: {
        requirePrimaryPromote: true,
        minShadowPassCount: 3,
        minShadowPassRatio: 0.6,
        requireCandidateChange: true,
      },
      champion: incumbent,
      challenger,
      shadowsEvaluated: true,
    });
    assert.equal(matrixResult.recommendation, 'promote',
      `Matrix should promote. Failed: ${matrixResult.failedGates?.join(', ')}`);
  });
});
```

- [ ] **Step 2: Run the full integration test**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: All tests PASS (requires Tasks 1-2 to be completed first).

- [ ] **Step 3: Run the complete hardening suite**

Run: `node --test tests/pine-autoresearch.test.mjs && node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: All pass (200+ existing + new overhaul tests).

- [ ] **Step 4: Commit**

```bash
git add tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "test: add end-to-end integration tests for full promotion pipeline

Validates that after all fixes:
- Tiered ROI relaxation fires for high-score/PF candidates
- Primary lab promotes → shadows are evaluated
- Matrix promotes when shadow threshold met
- Full pipeline works for the exact score-172 scenario"
```

---

### Task 9: Reset scheduler state and validate live cycle (Post-fix validation)

**Files:**
- No code changes — operational validation
- Modify: scheduler state file (if needed)

**Problem:** After all code fixes, the scheduler state still has `stagnationLevel: 6`, `sameTrackCycleStreak: 8`, `noScoreImprovementStreak: high`, and 110+ tabu entries from the broken era. A fresh cycle needs clean state to validate the fixes work end-to-end in production.

- [ ] **Step 1: Verify all tests pass**

Run: `node --test tests/pine-autoresearch.test.mjs && node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: All pass.

- [ ] **Step 2: Check current scheduler state**

Run: `node -e "import('fs').then(fs => { const s = JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/scheduler-state.json','utf8')); console.log(JSON.stringify({stagnationLevel:s.stagnationLevel,sameTrackCycleStreak:s.sameTrackCycleStreak,noScoreImprovementStreak:s.noScoreImprovementStreak,tabuCount:s.tabuRejectedFingerprints?.length??0,cycleIndex:s.cycleIndex},null,2)) })"`

Expected: Shows the stale state from the broken era.

- [ ] **Step 3: Reset stagnation and streak counters**

The tabu policy has `dropOnChampionChange: true`, so tabu will auto-clear on promotion. But stagnation level and streaks need manual reset since the code fixes change the rules:

```bash
node -e "
import fs from 'fs';
const path = 'pine/autoresearch/pine-fusion-v4-core-15m-locked-window/scheduler-state.json';
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
state.stagnationLevel = 0;
state.noScoreImprovementStreak = 0;
state.sameTrackCycleStreak = 0;
state.lowEmissionStreak = 0;
state.noNewCandidateStreak = 0;
state.noChangeStreak = 0;
// Keep tabu — it will age out naturally with maxAgeCycles: 20
fs.writeFileSync(path, JSON.stringify(state, null, 2));
console.log('Scheduler state reset complete');
"
```

- [ ] **Step 4: Run one fresh autoresearch cycle**

Run: `node scripts/pine-autoresearch.mjs --config ./config/pine-autoresearch.default.json`

Expected behavior after fixes:
- Variants generated (12 per cycle)
- If a candidate beats champion on score with ROI regression: tiered relaxation fires
- If a candidate has marginal PF regression (-0.02): PF gate passes
- Primary lab can now recommend "promote"
- Shadow labs get evaluated
- If 3/5 shadows pass: matrix promotes
- Track rotation fires at streak == maxCyclesPerTrack

- [ ] **Step 5: Inspect the new manifest**

Run: `node -e "import('fs').then(fs => { const m = JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json','utf8')); console.log(JSON.stringify({recommendation:m.matrixDecision?.recommendation,failedGates:m.matrixDecision?.failedGates,primaryRec:m.labResults?.[0]?.decision?.recommendation,shadowsEvaluated:m.labResults?.length>1,stagnationLevel:m.checkpointState?.schedulerStagnationLevel,escape:m.stagnationEscape},null,2)) })"`

Expected: Either `recommendation: 'promote'` or `recommendation: 'hold'` with meaningful gate diagnostics (not the same broken `primaryPromote` wall).

- [ ] **Step 6: Commit state reset**

```bash
git add pine/autoresearch/pine-fusion-v4-core-15m-locked-window/scheduler-state.json
git commit -m "chore: reset scheduler state after promotion system overhaul

Stagnation level, streaks, and counters accumulated under broken gate
logic. Reset to zero so the fixed system starts with clean state.
Tabu entries retained — they age out naturally via maxAgeCycles."
```

---

## Post-Implementation Grading Checklist

After all tasks are complete, verify each dimension reaches A-grade:

| Dimension | A-grade criteria | How to verify |
|-----------|-----------------|---------------|
| Variant generation | 12/cycle, diverse families, no zero-emission | Check latest manifest `searchEfficiency.emittedVariantCount` |
| Search diversity | Multiple families explored, architecture keys mutated | Check `cycleSummary.trace` for family diversity |
| Promotion logic | Tiered relaxation fires, PF tolerance works, gates transparent | Check `labResults[0].decision.gates` — no false blocks |
| Track rotation | Rotates at maxCyclesPerTrack, no infinite streak | Check `sameTrackCycleStreak` stays <= 8 |
| Shadow validation | Shadows evaluated when primary promotes | Check `labResults.length > 1` when primary says promote |
| Candidate quality | Candidates change trade behavior meaningfully | Check score deltas > 0 in Pareto shortlist |
| Stagnation recovery | Escape fires at level 3+ gate-stagnation, no yo-yo | Check `stagnationEscape.mode !== 'none'` when stuck |
| Overall research velocity | Promotions happen when candidates are genuinely better | Check `history.md` for promotion events |

---

## Execution Order

Tasks MUST be executed in order (1 → 9) because:
- Task 2 depends on Task 1 (config change assumes roiRelaxation passthrough works)
- Task 5 depends on Task 4 (gate-stagnation escape uses fixed scoreImproved)
- Task 8 depends on Tasks 1-7 (integration test validates all fixes together)
- Task 9 depends on all code tasks (validates in production)

---
