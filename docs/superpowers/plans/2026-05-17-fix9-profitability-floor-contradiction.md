# Fix #9: profitabilityFloor Contradiction + Tiered Relaxation Calibration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the profitabilityFloor contradiction that blocks all promotions, and tighten tiered relaxation's ROI regression cap to a more conservative value.

**Architecture:** Two changes: (1) Skip profitabilityFloor when tiered relaxation has already approved the candidate — the relaxation system's multi-condition validation is the safety net, not the floor. (2) Tighten `tieredRelaxation.maxRoiRegressionPct` from 20 to 12 — still allows meaningful ROI regression for exceptional candidates but prevents excessive drops. (3) Lower profitabilityFloor config thresholds for non-relaxed candidates so normal improvements aren't blocked.

**Tech Stack:** Node.js (ESM), `node:test` runner, JSON config

---

## Evidence from production cycles

| Cycle | scoreDelta | roiDelta | pfDelta | Gates passed | Blocked by |
|-------|-----------|----------|---------|--------------|------------|
| 06:30 | +1.16 | +0.69 | +0.02 | all 8 | profitabilityFloor (ROI +0.69 < +3) |
| 10:00 | +19.86 | -15.29 | +5.58 | all 8 via tiered relax | profitabilityFloor (ROI -15.29 < +3) |
| 11:00 | +2.11 | +1.16 | +0.08 | all 8 | profitabilityFloor (ROI +1.16 < +3, PF +0.08 < +0.1) |

**Key insight:** The profitabilityFloor requires `minRoiDeltaPct: 3` and `minProfitFactorDelta: 0.1`. These are STRICTER than the normal gates (`minRoiDeltaPct: 0`, `minProfitFactorDelta: -0.05`). Every candidate that passes normal gates gets blocked here.

---

## Design Decision: Tiered relaxation cap

Current: `maxRoiRegressionPct: 20` (allows champion ROI 91.7% → candidate 71.7%)

**User concern:** -20% is too permissive. A candidate dropping ROI from 91.7% to 71.7% is a significant regression even if other metrics are excellent.

**Proposed: `maxRoiRegressionPct: 12`**

Rationale:
- Champion at 91.7% → minimum allowed: 79.7% ROI (still meaningfully profitable)
- The score-172 candidate (ROI 76.41%, delta -15.29%) would be REJECTED at -12% cap
- This forces the system to find candidates that don't sacrifice too much ROI
- Standard relaxation (`maxRoiRegressionPct: 10`) handles moderate cases
- Tiered adds only 2% more headroom for truly exceptional PF/DD improvements
- If a candidate has PF 2x+ AND DD improved AND score +12, allowing -12% ROI regression is a reasonable trade-off

**Alternative considered:** -15% (would allow score-172 candidate). Rejected because user explicitly said -20% is too high, and -15% is still a large absolute drop.

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `scripts/lib/pine-autoresearch.mjs` | `decideAutoresearchOutcome()` — skip profitabilityFloor when relaxation applied | Modify |
| `config/pine-autoresearch.default.json` | Lower profitabilityFloor thresholds + tighten tiered cap | Modify |
| `tests/pine-autoresearch-promotion-overhaul.test.mjs` | Tests for profitabilityFloor bypass + tiered cap | Modify |

---

### Task 10: Skip profitabilityFloor when tiered relaxation fires

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs` — around line 750, the profitabilityFloor evaluation block
- Modify: `tests/pine-autoresearch-promotion-overhaul.test.mjs` — add tests

**Logic:** The profitabilityFloor gate runs at line 750-753 AFTER all other gates pass. It checks `failedGates.length === 0 && promotionPolicy`. The fix: also check if `roiRelaxationApplied` — if tiered relaxation already validated the trade-off, skip the floor.

- [ ] **Step 1: Write the failing test**

```javascript
describe('Issue #9: profitabilityFloor bypass when tiered relaxation fires', () => {
  it('should promote when tiered relaxation applied — skip profitabilityFloor', () => {
    // Score-172 scenario: ROI regression -15.29% but tiered relaxation approved it
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: {
        roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88,
        tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger',
      score: 164.0,  // +11.53 (above minScoreDeltaToRelax: 12? No, need +12)
      config: { slAtrMult: 0.1 },
      metrics: {
        roiPct: 80.0, profitFactor: 8.0, maxDrawdownPct: 1.5,
        tradeCount: 250, winRatePct: 30.0, avgWin: 1.2, avgLoss: 0.06,
      },
    };
    // Score delta = 11.53 — need >= 12 for tiered. Adjust:
    // Use score 165 → delta 12.53
    challenger.score = 165.0;
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
          maxRoiRegressionPct: 12,
        },
      },
    };
    const promotionPolicy = {
      minRoiDeltaPct: 3,
      minProfitFactorDelta: 0.1,
      minTradeCount: 60,
    };
    const result = decideAutoresearchOutcome({
      incumbent, challenger, thresholds, promotionPolicy,
    });
    // ROI delta = -11.7, within -12 cap
    // Tiered relaxation should fire (PF 2.25x, DD improved, score +12.53)
    // profitabilityFloor should be SKIPPED
    assert.equal(result.recommendation, 'promote',
      `Should promote (skip floor after relaxation). Failed: ${result.failedGates?.join(', ')}`);
    assert.equal(result.comparisons.roiRelaxationApplied, true);
  });

  it('should apply profitabilityFloor when relaxation NOT applied', () => {
    // Candidate with positive ROI but below floor threshold
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: {
        roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88,
        tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger',
      score: 154.0,
      config: { slAtrMult: 0.45 },
      metrics: {
        roiPct: 92.5, profitFactor: 3.58, maxDrawdownPct: 2.85,
        tradeCount: 265, winRatePct: 42.8, avgWin: 1.15, avgLoss: 0.24,
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
          maxRoiRegressionPct: 12,
        },
      },
    };
    const promotionPolicy = {
      minRoiDeltaPct: 3,
      minProfitFactorDelta: 0.1,
      minTradeCount: 60,
    };
    const result = decideAutoresearchOutcome({
      incumbent, challenger, thresholds, promotionPolicy,
    });
    // ROI delta = +0.8 (no relaxation needed, but below floor's +3)
    // profitabilityFloor SHOULD apply and block
    assert.equal(result.recommendation, 'hold');
    assert.ok(result.failedGates?.includes('profitabilityFloor'));
  });
});
```

- [ ] **Step 2: Run test — first should FAIL (floor blocks even with relaxation)**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test FAILS (profitabilityFloor blocks), second PASSES.

- [ ] **Step 3: Implement the bypass**

In `scripts/lib/pine-autoresearch.mjs`, around line 750, find:

```javascript
let profitabilityFloor = null;
if (failedGates.length === 0 && promotionPolicy) {
  profitabilityFloor = evaluateProfitabilityFloor({ incumbent, challenger, policy: promotionPolicy });
  if (!profitabilityFloor.passed) {
```

Change to:

```javascript
let profitabilityFloor = null;
const skipProfitabilityFloor = comparisons.roiRelaxationApplied === true;
if (failedGates.length === 0 && promotionPolicy && !skipProfitabilityFloor) {
  profitabilityFloor = evaluateProfitabilityFloor({ incumbent, challenger, policy: promotionPolicy });
  if (!profitabilityFloor.passed) {
```

**Why this is correct:**
- `comparisons.roiRelaxationApplied` is set to `true` only when tiered OR standard relaxation fired AND the ROI would have failed without it
- If relaxation fired, the system already validated: score delta > threshold, PF multiplier > 2x, DD improved, ROI within cap
- The profitabilityFloor's ROI check contradicts this validation — skip it
- For non-relaxed candidates, the floor still applies (second test confirms)

- [ ] **Step 4: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: Both new tests PASS.

- [ ] **Step 5: Run existing suite**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All 249 pass. If any test asserts profitabilityFloor blocks a relaxed candidate, update it.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "fix: skip profitabilityFloor when tiered relaxation already validated the candidate

profitabilityFloor requires ROI >= +3%, which contradicts tiered relaxation
that allows ROI regression up to -12%. When relaxation fires, the system
already validated PF 2x+, DD improved, score +12, ROI within cap — the
floor's ROI check is redundant and contradictory. Skip it."
```

---

### Task 11: Tighten tiered relaxation cap + lower profitabilityFloor config

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Changes:**
1. `primaryLab.thresholds.roiRelaxation.tieredRelaxation.maxRoiRegressionPct`: 20 → 12
2. `regimeExitResearch.promotion.minRoiDeltaPct`: 3 → 0
3. `regimeExitResearch.promotion.minProfitFactorDelta`: 0.1 → -0.05

**Rationale for each:**
- Tiered cap 12%: Champion at 91.7% → minimum 79.7% ROI. Still meaningfully profitable. Prevents excessive drops while allowing genuinely superior candidates.
- Floor minRoiDeltaPct 0: Aligns with normal gate. The normal gate already enforces `minRoiDeltaPct: 0`. Having the floor at +3 makes it stricter than the gate it's supposed to backstop.
- Floor minProfitFactorDelta -0.05: Aligns with Task 2 fix. Same reasoning — floor shouldn't be stricter than the gate.

- [ ] **Step 1: Write tests**

```javascript
describe('Issue #9: profitabilityFloor config calibration', () => {
  it('should promote candidate with ROI +1.16 and PF +0.08 when floor thresholds aligned', () => {
    // Simulates the 11:00 cycle that was blocked
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: {
        roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88,
        tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger',
      score: 154.58,
      config: { slAtrMult: 0.5, useTimeStop: true, timeStopBars: 12 },
      metrics: {
        roiPct: 92.86, profitFactor: 3.64, maxDrawdownPct: 2.85,
        tradeCount: 261, winRatePct: 43.0, avgWin: 1.15, avgLoss: 0.24,
      },
    };
    const thresholds = {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.003, minTradeCount: 150 },
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 12,
        maxRoiRegressionPct: 10,
        tieredRelaxation: {
          enabled: true,
          pfMultiplierThreshold: 2,
          ddImprovementRequired: true,
          maxRoiRegressionPct: 12,
        },
      },
    };
    // Floor with aligned thresholds
    const promotionPolicy = {
      minRoiDeltaPct: 0,
      minProfitFactorDelta: -0.05,
      minTradeCount: 60,
    };
    const result = decideAutoresearchOutcome({
      incumbent, challenger, thresholds, promotionPolicy,
    });
    // ROI +1.16 >= 0, PF +0.08 >= -0.05, trades 261 >= 60
    assert.equal(result.recommendation, 'promote',
      `Should promote with aligned floor. Failed: ${result.failedGates?.join(', ')}`);
  });

  it('should reject tiered relaxation when ROI regression exceeds 12% cap', () => {
    const incumbent = {
      configId: 'champion',
      score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: {
        roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88,
        tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24,
      },
    };
    const challenger = {
      configId: 'challenger',
      score: 172.33,
      config: { slAtrMult: 0.1 },
      metrics: {
        roiPct: 76.41, profitFactor: 9.14, maxDrawdownPct: 1.19,
        tradeCount: 245, winRatePct: 29.39, avgWin: 1.19, avgLoss: 0.05,
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
          maxRoiRegressionPct: 12,  // Tightened from 20
        },
      },
    };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    // ROI delta = -15.29, exceeds -12 cap → tiered relaxation should NOT fire
    assert.equal(result.recommendation, 'hold');
    assert.ok(result.failedGates?.includes('roi'));
    assert.equal(result.comparisons.roiRelaxationApplied, false,
      'Tiered relaxation should NOT fire when ROI regression exceeds 12% cap');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: First test may FAIL (depends on Task 10 being done first). Second test should PASS (lib already respects the cap value passed in thresholds).

- [ ] **Step 3: Update config**

In `config/pine-autoresearch.default.json`:

Change `primaryLab.thresholds.roiRelaxation.tieredRelaxation.maxRoiRegressionPct`:
```json
"maxRoiRegressionPct": 12
```

Change `regimeExitResearch.promotion`:
```json
"promotion": {
  "allowAutomaticRegimeSwitching": false,
  "requireGlobalChampionAnchor": true,
  "minRoiDeltaPct": 0,
  "minProfitFactorDelta": -0.05,
  "minTradeCount": 60,
  "requireBlindHoldoutVerdict": true
}
```

- [ ] **Step 4: Run all tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs && node --test tests/pine-autoresearch.test.mjs`
Expected: All pass. If any existing test asserts on old config values (3, 0.1, 20), update them.

- [ ] **Step 5: Commit**

```bash
git add config/pine-autoresearch.default.json tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "config: tighten tiered relaxation to -12% ROI cap, align profitabilityFloor

- tieredRelaxation.maxRoiRegressionPct: 20 → 12 (champion 91.7% → min 79.7%)
- regimeExitResearch.promotion.minRoiDeltaPct: 3 → 0 (align with normal gate)
- regimeExitResearch.promotion.minProfitFactorDelta: 0.1 → -0.05 (align with Task 2)

The -20% cap was too permissive. The -12% cap still allows meaningful
regression for exceptional PF/DD candidates while keeping ROI strong.
The floor thresholds were stricter than normal gates, blocking every
candidate that passed normal evaluation."
```

---

### Task 12: Validation — verify fix against all 3 blocked production scenarios

**Files:**
- Modify: `tests/pine-autoresearch-promotion-overhaul.test.mjs`

**Purpose:** Replay the exact 3 production scenarios that were blocked and verify each now produces the correct outcome under the new rules.

- [ ] **Step 1: Write replay tests**

```javascript
describe('Issue #9: production scenario replay', () => {
  it('06:30 cycle: scoreDelta +1.16, ROI +0.69, PF +0.02 — should promote with aligned floor', () => {
    const incumbent = {
      configId: 'original-153-champion', score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: { roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24 },
    };
    const challenger = {
      configId: 'challenger-0630', score: 153.63,
      config: { slAtrMult: 0.5, useTimeStop: true },
      metrics: { roiPct: 92.39, profitFactor: 3.58, maxDrawdownPct: 2.85, tradeCount: 261, winRatePct: 42.6, avgWin: 1.15, avgLoss: 0.24 },
    };
    const thresholds = {
      minScoreDelta: 0.1, minRoiDeltaPct: 0, minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75, minTradeCount: 150, minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.003, minTradeCount: 150 },
      roiRelaxation: { enabled: true, minScoreDeltaToRelax: 12, maxRoiRegressionPct: 10,
        tieredRelaxation: { enabled: true, pfMultiplierThreshold: 2, ddImprovementRequired: true, maxRoiRegressionPct: 12 } },
    };
    const promotionPolicy = { minRoiDeltaPct: 0, minProfitFactorDelta: -0.05, minTradeCount: 60 };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds, promotionPolicy });
    assert.equal(result.recommendation, 'promote',
      `06:30 scenario should promote. Failed: ${result.failedGates?.join(', ')}`);
  });

  it('11:00 cycle: scoreDelta +2.11, ROI +1.16, PF +0.08 — should promote with aligned floor', () => {
    const incumbent = {
      configId: 'original-153-champion', score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: { roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24 },
    };
    const challenger = {
      configId: 'challenger-1100', score: 154.58,
      config: { slAtrMult: 0.5, useTimeStop: true, timeStopBars: 8 },
      metrics: { roiPct: 92.86, profitFactor: 3.64, maxDrawdownPct: 2.88, tradeCount: 261, winRatePct: 43.0, avgWin: 1.15, avgLoss: 0.24 },
    };
    const thresholds = {
      minScoreDelta: 0.1, minRoiDeltaPct: 0, minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75, minTradeCount: 150, minTradeRatioVsIncumbent: 0.75,
      significance: { minRelativeScoreDelta: 0.003, minTradeCount: 150 },
      roiRelaxation: { enabled: true, minScoreDeltaToRelax: 12, maxRoiRegressionPct: 10,
        tieredRelaxation: { enabled: true, pfMultiplierThreshold: 2, ddImprovementRequired: true, maxRoiRegressionPct: 12 } },
    };
    const promotionPolicy = { minRoiDeltaPct: 0, minProfitFactorDelta: -0.05, minTradeCount: 60 };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds, promotionPolicy });
    assert.equal(result.recommendation, 'promote',
      `11:00 scenario should promote. Failed: ${result.failedGates?.join(', ')}`);
  });

  it('10:00 cycle: scoreDelta +19.86, ROI -15.29 — should HOLD (exceeds tightened -12% cap)', () => {
    const incumbent = {
      configId: 'original-153-champion', score: 152.47,
      config: { slAtrMult: 0.5 },
      metrics: { roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261, winRatePct: 42.53, avgWin: 1.15, avgLoss: 0.24 },
    };
    const challenger = {
      configId: 'challenger-1000', score: 172.33,
      config: { slAtrMult: 0.1, minBarsBetween: 7 },
      metrics: { roiPct: 76.41, profitFactor: 9.14, maxDrawdownPct: 1.19, tradeCount: 245, winRatePct: 29.39, avgWin: 1.19, avgLoss: 0.05 },
    };
    const thresholds = {
      minScoreDelta: 0.1, minRoiDeltaPct: 0, minProfitFactorDelta: -0.05,
      maxDrawdownDeltaPct: 0.75, minTradeCount: 150, minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: { enabled: true, minScoreDeltaToRelax: 12, maxRoiRegressionPct: 10,
        tieredRelaxation: { enabled: true, pfMultiplierThreshold: 2, ddImprovementRequired: true, maxRoiRegressionPct: 12 } },
    };
    const result = decideAutoresearchOutcome({ incumbent, challenger, thresholds });
    // ROI delta = -15.29, exceeds both standard (-10) and tiered (-12) caps
    assert.equal(result.recommendation, 'hold');
    assert.ok(result.failedGates?.includes('roi'));
    assert.equal(result.comparisons.roiRelaxationApplied, false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `node --test tests/pine-autoresearch-promotion-overhaul.test.mjs`
Expected: All pass (requires Tasks 10-11 completed first).

- [ ] **Step 3: Run full suite**

Run: `node --test tests/pine-autoresearch.test.mjs && node --test tests/pine-autoresearch-tracks.test.mjs`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add tests/pine-autoresearch-promotion-overhaul.test.mjs
git commit -m "test: add production scenario replay tests for profitabilityFloor fix

Replays exact metrics from 06:30, 10:00, and 11:00 production cycles:
- 06:30 (ROI +0.69, PF +0.02): promotes with aligned floor
- 11:00 (ROI +1.16, PF +0.08): promotes with aligned floor
- 10:00 (ROI -15.29): correctly held — exceeds tightened -12% tiered cap"
```

---

## Execution Order

Tasks 10 → 11 → 12 (strict dependency — each builds on the previous).

## Expected outcome after all 3 tasks

| Production scenario | Before fix | After fix |
|---|---|---|
| 06:30 (ROI +0.69, PF +0.02) | BLOCKED by profitabilityFloor | ✅ PROMOTES |
| 11:00 (ROI +1.16, PF +0.08) | BLOCKED by profitabilityFloor | ✅ PROMOTES |
| 10:00 (ROI -15.29, PF +5.58) | BLOCKED by profitabilityFloor | ❌ HELD (correct — exceeds -12% cap) |

The 10:00 candidate with -15.29% ROI regression is correctly rejected under the tightened -12% cap. The system will only promote candidates with ROI regression up to -12% AND all tiered conditions met (PF 2x+, DD improved, score +12).

---
