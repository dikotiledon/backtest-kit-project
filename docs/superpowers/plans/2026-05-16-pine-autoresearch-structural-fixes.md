# Pine Autoresearch Structural Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 structural flaws the stagnation recovery plan missed — ROI relaxation dead zone, stagnation de-escalation, shadow lab short-circuit, exit-state patch pool, noScoreImprovementStreak false reset, and gate-aware search filtering — so the autoresearch system can actually promote high-quality candidates instead of cycling indefinitely.

**Architecture:** Each fix targets a specific code path with minimal blast radius. ROI relaxation and stagnation de-escalation are the highest-priority unblocks. Shadow lab evaluation and exit-state patches expand search quality. Gate-aware filtering prevents wasted cycles. All changes preserve existing promotion safety gates.

**Tech Stack:** Node.js ESM, `node:test`, JSON config under `config/pine-autoresearch.default.json`, autoresearch libs under `scripts/lib/`.

---

## Latest Evidence This Plan Targets

Latest cycle: `pine-fusion-v4-core-15m-locked-window-2026-05-16T10-53-52-370Z`

| Metric | Champion | Challenger | Delta |
|---|---|---|---|
| Score | 152.47 | 172.33 | +19.86 |
| ROI % | 91.7 | 76.41 | -15.29 |
| PF | 3.56 | 9.14 | +5.58 |
| DD % | 2.88 | 1.19 | -1.69 |
| Trades | 261 | 245 | -16 |

Gate result: `primaryPromote: false` — ROI regression kills it.
ROI relaxation: `roiRelaxationApplied: false` — `scoreDelta 19.86 < minScoreDeltaToRelax 20`.
Even if relaxation triggered: `roiDeltaPct -15.29 < -maxRoiRegressionPct -10` → still fails.

Scheduler: `stagnationLevel: 3`, all streaks at 0, `noScoreImprovementStreak: 0` (false reset because `bestScoreDelta > 0`).

---

## File Structure

Modify these files:

| File | Responsibility |
|---|---|
| `scripts/lib/pine-autoresearch.mjs` | Lab decision logic, ROI relaxation, gate diagnostics |
| `scripts/lib/pine-autoresearch-tracks.mjs` | Stagnation state machine, de-escalation, streak logic |
| `scripts/lib/pine-track-generators.mjs` | Patch pools for all families |
| `scripts/lib/pine-stagnation-escape.mjs` | Escape plan decision |
| `scripts/pine-autoresearch.mjs` | Shadow lab evaluation flow, manifest assembly |
| `config/pine-autoresearch.default.json` | ROI relaxation thresholds, stagnation de-escalation policy |
| `tests/pine-autoresearch-lab-decision.test.mjs` | ROI relaxation + gate tests |
| `tests/pine-autoresearch-tracks.test.mjs` | Stagnation de-escalation + streak tests |
| `tests/pine-track-generators.test.mjs` | Exit-state patch pool tests |
| `tests/pine-autoresearch-shadow-eval.test.mjs` | Shadow evaluation on primary failure |

---

### Task 1: Fix ROI Relaxation Dead Zone

**Problem:** The current ROI relaxation has two thresholds that create a dead zone:
1. `minScoreDeltaToRelax: 20` — latest candidate scored 19.86, just 0.14 short
2. `maxRoiRegressionPct: 10` — latest candidate regressed 15.29%, exceeds cap even if relaxation triggered

The system finds genuinely better risk-adjusted candidates (PF 9.14 vs 3.56, DD 1.19% vs 2.88%) but the ROI gate kills them because tight stops mechanically reduce ROI while improving all other metrics.

**Fix:**
- Lower `minScoreDeltaToRelax` to 12 (proportional to ~8% of champion score)
- Add a tiered relaxation: if PF improves by >2x AND DD improves, allow up to 20% ROI regression
- Keep the hard floor at 25% regression to prevent degenerate candidates

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `scripts/lib/pine-autoresearch.mjs` (lines 604-610)
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing test for tiered ROI relaxation**

Append near existing lab decision tests in `tests/pine-autoresearch.test.mjs`:

```js
test('lab decision applies tiered ROI relaxation when PF improves >2x and DD improves', async () => {
  const { decideLabResult } = await import('../scripts/lib/pine-autoresearch.mjs');

  const incumbent = {
    configId: 'champion-1',
    config: { slAtrMult: 0.5 },
    score: 152.47,
    metrics: { roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261, winRatePct: 42.53, avgWin: 1.2, avgLoss: 0.5 },
  };
  const challenger = {
    configId: 'challenger-1',
    config: { slAtrMult: 0.1 },
    score: 172.33,
    metrics: { roiPct: 76.41, profitFactor: 9.14, maxDrawdownPct: 1.19, tradeCount: 245, winRatePct: 29.39, avgWin: 3.5, avgLoss: 0.3 },
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

  const result = decideLabResult({ incumbent, challenger, thresholds, complexityPolicy: {} });

  assert.equal(result.decision.comparisons.roiRelaxationApplied, true,
    'tiered relaxation should apply: PF 9.14/3.56 > 2x, DD improved');
  assert.equal(result.decision.recommendation, 'promote',
    'candidate should promote with tiered relaxation');
});

test('lab decision rejects ROI regression beyond tiered hard floor', async () => {
  const { decideLabResult } = await import('../scripts/lib/pine-autoresearch.mjs');

  const incumbent = {
    configId: 'champion-1',
    config: { slAtrMult: 0.5 },
    score: 152.47,
    metrics: { roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261, winRatePct: 42.53, avgWin: 1.2, avgLoss: 0.5 },
  };
  const challenger = {
    configId: 'challenger-2',
    config: { slAtrMult: 0.05 },
    score: 180,
    metrics: { roiPct: 60.0, profitFactor: 12.0, maxDrawdownPct: 0.8, tradeCount: 200, winRatePct: 20, avgWin: 5.0, avgLoss: 0.2 },
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

  const result = decideLabResult({ incumbent, challenger, thresholds, complexityPolicy: {} });

  // ROI regression is 31.7% which exceeds even tiered max of 20%
  assert.equal(result.decision.comparisons.roiRelaxationApplied, false,
    'hard floor should reject: ROI regression 31.7% > tiered max 20%');
  assert.equal(result.decision.recommendation, 'hold');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --test-name-pattern="lab decision applies tiered ROI relaxation|lab decision rejects ROI regression beyond tiered hard floor" tests/pine-autoresearch.test.mjs
```

Expected: FAIL — tiered relaxation logic doesn't exist yet.

Note: If `decideLabResult` is not a named export, find the correct function name:

```bash
node -e "import('../scripts/lib/pine-autoresearch.mjs').then(m=>console.log(Object.keys(m).filter(k=>k.toLowerCase().includes('decide')||k.toLowerCase().includes('lab'))))"
```

Adapt the test to use the correct function name.

- [ ] **Step 3: Update config with new relaxation thresholds**

In `config/pine-autoresearch.default.json`, update the `primaryLab.thresholds.roiRelaxation` block:

```json
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
```

- [ ] **Step 4: Implement tiered ROI relaxation in lab decision logic**

In `scripts/lib/pine-autoresearch.mjs`, replace lines 604-610 (the existing roiRelaxation block) with:

```js
  const roiRelaxation = thresholds.roiRelaxation || {};
  const roiRelaxationEnabled = roiRelaxation.enabled === true;
  const tieredRelaxation = roiRelaxation.tieredRelaxation || {};
  const tieredEnabled = tieredRelaxation.enabled === true && roiRelaxationEnabled;

  // Standard relaxation: score delta exceeds threshold AND roi regression within standard cap
  const standardRelaxed = roiRelaxationEnabled
    && comparisons.scoreDelta >= (roiRelaxation.minScoreDeltaToRelax ?? Infinity)
    && comparisons.roiDeltaPct >= -(roiRelaxation.maxRoiRegressionPct ?? 0);

  // Tiered relaxation: PF improved by >Nx AND DD improved → allow wider ROI regression
  const pfMultiplier = (incumbent.metrics?.profitFactor ?? 0) > 0
    ? (challenger.metrics?.profitFactor ?? 0) / (incumbent.metrics?.profitFactor ?? 1)
    : 0;
  const ddImproved = comparisons.drawdownDeltaPct < 0;
  const pfThresholdMet = pfMultiplier >= (tieredRelaxation.pfMultiplierThreshold ?? 2);
  const ddRequirementMet = tieredRelaxation.ddImprovementRequired !== true || ddImproved;
  const tieredMaxRegression = tieredRelaxation.maxRoiRegressionPct ?? 20;

  const tieredRelaxed = tieredEnabled
    && comparisons.scoreDelta >= (roiRelaxation.minScoreDeltaToRelax ?? Infinity)
    && pfThresholdMet
    && ddRequirementMet
    && comparisons.roiDeltaPct >= -tieredMaxRegression;

  const roiRelaxed = standardRelaxed || tieredRelaxed;
  const effectiveRoiPass = comparisons.roiDeltaPct >= adjustedThresholds.minRoiDeltaPct || roiRelaxed;
  comparisons.roiRelaxationApplied = roiRelaxed && comparisons.roiDeltaPct < adjustedThresholds.minRoiDeltaPct;
  comparisons.roiRelaxationTier = tieredRelaxed ? 'tiered' : standardRelaxed ? 'standard' : null;
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
node --test --test-name-pattern="lab decision applies tiered ROI relaxation|lab decision rejects ROI regression beyond tiered hard floor" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run full test suite to check for regressions**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: all existing tests pass. If any fail due to new `roiRelaxationTier` field in comparisons, update snapshot expectations to include the new field with value `null` for non-relaxed cases.

- [ ] **Step 7: Commit**

```bash
git add config/pine-autoresearch.default.json scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: add tiered ROI relaxation for high-PF low-DD candidates"
```

---

### Task 2: Add Stagnation De-escalation

**Problem:** The `nextStagnationState()` function only escalates stagnation level or holds it constant. It resets to 0 only on `promotionEligible === true`. When the system recovers from a deadlock (emits variants, finds higher-scoring candidates), stagnation stays at level 3 indefinitely because no candidate can promote (ROI gate). This causes:
1. Tabu pruning stays aggressive (maxAge/4 = 5 cycles)
2. Temperature stays boosted (stagnationTemperatureBoost: 4), pushing search further from promotable territory
3. `progressive-widen` escape stays active when the system isn't actually stuck

**Fix:** Add a de-escalation path: if all escalation streaks are 0 for N consecutive cycles (configurable, default 2), reduce stagnation level by 1. This allows gradual recovery without requiring a full promotion.

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs` (function `nextStagnationState`, lines 436-536)
- Modify: `config/pine-autoresearch.default.json` (add `stagnation.deescalation` policy)
- Test: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Write failing test for stagnation de-escalation**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```js
test('nextStagnationState de-escalates when all streaks are 0 for deescalateAfter cycles', () => {
  const result = nextStagnationState({
    previousLevel: 3,
    noNewCandidateStreak: 0,
    noScoreImprovementStreak: 0,
    noChangeStreak: 0,
    lowEmissionStreak: 0,
    promotionEligible: false,
    topCandidateSimilarity: 0.5,
    policy: {
      enabled: true,
      noNewCandidateEscalateAfter: 2,
      noScoreImprovementEscalateAfter: 2,
      holdEscalateAfter: 3,
      lowEmissionEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 6,
      deescalation: {
        enabled: true,
        deescalateAfter: 2,
        consecutiveHealthyCycles: 2,
      },
      // Simulate that we've been healthy for 2 cycles
      _healthyCycleCount: 2,
    },
  });

  assert.equal(result.stagnationLevel, 2,
    'should de-escalate from 3 to 2 after 2 consecutive healthy cycles');
  assert.equal(result.stagnationReason, 'deescalation');
});

test('nextStagnationState does NOT de-escalate when streaks are 0 but below threshold', () => {
  const result = nextStagnationState({
    previousLevel: 3,
    noNewCandidateStreak: 0,
    noScoreImprovementStreak: 0,
    noChangeStreak: 0,
    lowEmissionStreak: 0,
    promotionEligible: false,
    topCandidateSimilarity: 0.5,
    policy: {
      enabled: true,
      noNewCandidateEscalateAfter: 2,
      noScoreImprovementEscalateAfter: 2,
      holdEscalateAfter: 3,
      lowEmissionEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 6,
      deescalation: {
        enabled: true,
        deescalateAfter: 2,
        consecutiveHealthyCycles: 2,
      },
      _healthyCycleCount: 1,
    },
  });

  assert.equal(result.stagnationLevel, 3,
    'should NOT de-escalate: only 1 healthy cycle, need 2');
});

test('nextStagnationState does NOT de-escalate below 0', () => {
  const result = nextStagnationState({
    previousLevel: 0,
    noNewCandidateStreak: 0,
    noScoreImprovementStreak: 0,
    noChangeStreak: 0,
    lowEmissionStreak: 0,
    promotionEligible: false,
    topCandidateSimilarity: 0.5,
    policy: {
      enabled: true,
      noNewCandidateEscalateAfter: 2,
      noScoreImprovementEscalateAfter: 2,
      holdEscalateAfter: 3,
      lowEmissionEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 6,
      deescalation: {
        enabled: true,
        deescalateAfter: 2,
        consecutiveHealthyCycles: 2,
      },
      _healthyCycleCount: 5,
    },
  });

  assert.equal(result.stagnationLevel, 0,
    'should stay at 0, never go negative');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --test-name-pattern="nextStagnationState de-escalates|nextStagnationState does NOT de-escalate" tests/pine-autoresearch-tracks.test.mjs
```

Expected: FAIL — de-escalation logic doesn't exist.

- [ ] **Step 3: Add de-escalation config**

In `config/pine-autoresearch.default.json`, inside `rotationPolicy.stagnation`, add:

```json
"deescalation": {
  "enabled": true,
  "consecutiveHealthyCycles": 2
}
```

- [ ] **Step 4: Implement de-escalation in nextStagnationState**

In `scripts/lib/pine-autoresearch-tracks.mjs`, in the `nextStagnationState` function, after the `promotionEligible` reset block (line 475) and before the escalation candidates array, add:

```js
  // De-escalation: if all escalation streaks are 0 and we've been healthy for N cycles, reduce level by 1
  const deescalationPolicy = isPlainObject(sourcePolicy.deescalation) ? sourcePolicy.deescalation : {};
  const deescalationEnabled = deescalationPolicy.enabled === true;
  const consecutiveHealthyCycles = normalizeNumericPolicyInteger(
    deescalationPolicy.consecutiveHealthyCycles ?? deescalationPolicy.deescalateAfter,
    { fallback: 2, min: 1 },
  );
  const healthyCycleCount = normalizeNonNegativeInteger(sourcePolicy._healthyCycleCount, 0);
  const allStreaksZero = normalizedNoNewCandidateStreak === 0
    && normalizedNoScoreImprovementStreak === 0
    && normalizedNoChangeStreak === 0
    && normalizedLowEmissionStreak === 0;

  if (deescalationEnabled && normalizedPreviousLevel > 0 && allStreaksZero && healthyCycleCount >= consecutiveHealthyCycles) {
    return {
      stagnationLevel: normalizedPreviousLevel - 1,
      stagnationReason: 'deescalation',
      lastEscalatedAt: sourcePolicy.lastEscalatedAt ?? null,
    };
  }
```

Also need to add `normalizedLowEmissionStreak` and `normalizedNoChangeStreak` normalization before this block. Check that these variables are already available at this point in the function. If not, move the normalization up:

```js
  const normalizedLowEmissionStreak = Math.max(
    0,
    Math.floor(Number.isFinite(Number(lowEmissionStreak)) ? Number(lowEmissionStreak) : 0),
  );
  const normalizedNoChangeStreak = Math.max(
    0,
    Math.floor(Number.isFinite(Number(noChangeStreak)) ? Number(noChangeStreak) : 0),
  );
```

Verify these are already normalized at the top of the function (they are — lines 457-464). If so, the de-escalation block can use them directly.

- [ ] **Step 5: Track healthy cycle count in nextTrackState**

In `scripts/lib/pine-autoresearch-tracks.mjs`, in `nextTrackState()`, compute and pass `_healthyCycleCount` into the stagnation policy:

After computing all streaks and before calling `nextStagnationState`, add:

```js
  const allCurrentStreaksZero = noNewCandidateStreak === 0
    && noScoreImprovementStreak === 0
    && noChangeStreak === 0
    && lowEmissionStreak === 0;
  const previousHealthyCycleCount = normalizeNonNegativeInteger(previous._healthyCycleCount, 0);
  const healthyCycleCount = allCurrentStreaksZero ? previousHealthyCycleCount + 1 : 0;
```

Then pass it into the stagnation policy object:

```js
    : nextStagnationState({
        previousLevel: previous.stagnationLevel,
        noNewCandidateStreak,
        noScoreImprovementStreak,
        noChangeStreak,
        lowEmissionStreak,
        promotionEligible: manifest.promotionEligible === true,
        topCandidateSimilarity: manifest.topCandidateSimilarity,
        policy: {
          ...configuredStagnationPolicy,
          currentReason: previous.stagnationReason,
          lastEscalatedAt: previous.lastEscalatedAt,
          _healthyCycleCount: healthyCycleCount,
        },
      });
```

And persist `_healthyCycleCount` in the returned scheduler state:

```js
    _healthyCycleCount: healthyCycleCount,
```

Add it to `defaultSchedulerState()` as well:

```js
    _healthyCycleCount: 0,
```

And to `normalizeSchedulerState()`:

```js
    _healthyCycleCount: normalizeNonNegativeInteger(state._healthyCycleCount, base._healthyCycleCount),
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test --test-name-pattern="nextStagnationState de-escalates|nextStagnationState does NOT de-escalate" tests/pine-autoresearch-tracks.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run full tracks test suite**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs
```

Expected: all pass. If existing tests fail because they don't expect `_healthyCycleCount` in state, update them to include it.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs config/pine-autoresearch.default.json tests/pine-autoresearch-tracks.test.mjs
git commit -m "feat: add stagnation de-escalation after consecutive healthy cycles"
```

---

### Task 3: Fix noScoreImprovementStreak False Reset

**Problem:** In `nextTrackState()` (line 583-585 of `pine-autoresearch-tracks.mjs`):

```js
const scoreImproved = manifest.promotionEligible === true || (bestScoreDelta !== null && bestScoreDelta > 0);
```

This resets `noScoreImprovementStreak` to 0 whenever a candidate scores higher than the champion — even if that candidate was rejected by the promotion gate. The system thinks "progress is being made" when in reality it's stuck finding unpromatable candidates.

Current state: `noScoreImprovementStreak: 0` despite champion score unchanged for 10+ cycles because `bestScoreDelta: 19.86 > 0`.

**Fix:** Only count score improvement as real when the candidate either:
1. Actually promoted (`promotionEligible === true`), OR
2. Passed the primary lab gate (even if shadows failed) — meaning it's genuinely close to promotable

A candidate that fails `primaryPromote` should NOT reset the streak.

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs` (lines 580-586)
- Modify: `scripts/pine-autoresearch.mjs` (pass `primaryLabPassed` in manifest metadata)
- Test: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Write failing test for streak behavior**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```js
test('nextTrackState does NOT reset noScoreImprovementStreak when bestScoreDelta > 0 but primaryLabPassed is false', () => {
  const state = {
    ...defaultSchedulerState(),
    activeTrackId: 'squeeze-context',
    cycleIndex: 24,
    noScoreImprovementStreak: 3,
    stagnationLevel: 3,
  };
  const manifest = {
    activeTrackId: 'squeeze-context',
    bestScoreDelta: 19.86,
    promotionEligible: false,
    primaryLabPassed: false,
    candidateFingerprint: 'new-fp',
    championFingerprint: 'champ-fp',
    noNewCandidate: false,
    searchEfficiency: { emittedVariantCount: 12 },
  };
  const policy = {
    rotationPolicy: {
      stagnation: { enabled: true, noScoreImprovementEscalateAfter: 2, maxStagnationLevel: 6 },
    },
  };

  const next = nextTrackState({ state, policy, manifest });

  assert.equal(next.noScoreImprovementStreak, 4,
    'streak should increment: score improved but primary lab rejected the candidate');
});

test('nextTrackState resets noScoreImprovementStreak when primaryLabPassed is true', () => {
  const state = {
    ...defaultSchedulerState(),
    activeTrackId: 'squeeze-context',
    cycleIndex: 24,
    noScoreImprovementStreak: 3,
    stagnationLevel: 2,
  };
  const manifest = {
    activeTrackId: 'squeeze-context',
    bestScoreDelta: 19.86,
    promotionEligible: false,
    primaryLabPassed: true,
    candidateFingerprint: 'new-fp',
    championFingerprint: 'champ-fp',
    noNewCandidate: false,
    searchEfficiency: { emittedVariantCount: 12 },
  };
  const policy = {
    rotationPolicy: {
      stagnation: { enabled: true, noScoreImprovementEscalateAfter: 2, maxStagnationLevel: 6 },
    },
  };

  const next = nextTrackState({ state, policy, manifest });

  assert.equal(next.noScoreImprovementStreak, 0,
    'streak should reset: primary lab passed means genuine progress');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --test-name-pattern="nextTrackState does NOT reset noScoreImprovementStreak|nextTrackState resets noScoreImprovementStreak when primaryLabPassed" tests/pine-autoresearch-tracks.test.mjs
```

Expected: FAIL — current code resets on any `bestScoreDelta > 0`.

- [ ] **Step 3: Modify scoreImproved logic in nextTrackState**

In `scripts/lib/pine-autoresearch-tracks.mjs`, replace the `scoreImproved` / `scoreStagnant` block (around line 583-586):

From:
```js
  const scoreImproved = manifest.promotionEligible === true || (bestScoreDelta !== null && bestScoreDelta > 0);
  const scoreStagnant = bestScoreDelta !== null && bestScoreDelta <= 0 && manifest.promotionEligible !== true;
```

To:
```js
  // Only count score improvement as real progress if the candidate passed primary lab
  // or actually promoted. A high-scoring candidate that fails primaryPromote is not progress.
  const primaryLabPassed = manifest.primaryLabPassed === true;
  const scoreImproved = manifest.promotionEligible === true
    || (primaryLabPassed && bestScoreDelta !== null && bestScoreDelta > 0);
  const scoreStagnant = !scoreImproved && manifest.promotionEligible !== true;
```

- [ ] **Step 4: Pass primaryLabPassed in manifest from main autoresearch**

In `scripts/pine-autoresearch.mjs`, in the manifest assembly section (around line 1550-1605), add `primaryLabPassed` to the manifest object:

Find where `matrixDecision` is assembled into the manifest and add:

```js
    primaryLabPassed: labResults?.[0]?.decision?.recommendation === 'promote',
```

This should be added alongside other manifest fields like `matrixDecision`, `labResults`, etc.

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
node --test --test-name-pattern="nextTrackState does NOT reset noScoreImprovementStreak|nextTrackState resets noScoreImprovementStreak when primaryLabPassed" tests/pine-autoresearch-tracks.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Run full test suites**

Run:

```bash
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: all pass. Existing tests that check `noScoreImprovementStreak` behavior may need `primaryLabPassed: true` added to their manifest fixtures if they expect the streak to reset.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix: noScoreImprovementStreak only resets on primary lab pass, not raw score delta"
```

---

### Task 4: Evaluate Shadow Labs Even on Primary Failure (Diagnostic Mode)

**Problem:** In `scripts/pine-autoresearch.mjs` (lines 2952-2966), when `requiresPrimaryPromote` is true and the primary lab rejects the candidate, the function returns immediately without evaluating shadow labs. This means:
1. No cross-asset robustness data is collected for rejected candidates
2. A candidate that fails ROI on XRP but passes on BTC/ETH is invisible
3. The system cannot learn which candidates are "almost promotable"

**Fix:** Add a `diagnosticShadowEvaluation` config option. When enabled, evaluate shadows even on primary failure, but mark the result as diagnostic-only (don't promote). Store the shadow results in the manifest for auditability and future search direction feedback.

**Files:**
- Modify: `scripts/pine-autoresearch.mjs` (lines 2952-2966)
- Modify: `config/pine-autoresearch.default.json` (add `matrixPolicy.diagnosticShadowEvaluation`)
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write failing test for diagnostic shadow evaluation**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('evaluateMatrix runs shadow labs in diagnostic mode when primary fails and diagnosticShadowEvaluation is enabled', async () => {
  const { evaluateMatrix } = await import('../scripts/pine-autoresearch.mjs');

  let shadowCallCount = 0;
  const mockEvaluateLabPair = async (lab) => {
    if (lab.labId === 'primary') {
      return {
        lab,
        labId: 'primary',
        decision: { recommendation: 'hold', comparisons: { scoreDelta: 19.86, roiDeltaPct: -15.29 } },
      };
    }
    shadowCallCount++;
    return {
      lab,
      labId: lab.labId,
      decision: { recommendation: 'promote', comparisons: { scoreDelta: 5, roiDeltaPct: 2 } },
    };
  };

  const config = {
    matrixPolicy: {
      requirePrimaryPromote: true,
      diagnosticShadowEvaluation: true,
      minShadowPassCount: 3,
      minShadowPassRatio: 0.6,
      requireCandidateChange: true,
    },
    shadowLabs: [
      { labId: 'btc-shadow' },
      { labId: 'eth-shadow' },
    ],
  };

  const labs = [
    { labId: 'primary' },
    { labId: 'btc-shadow' },
    { labId: 'eth-shadow' },
  ];

  const result = await evaluateMatrix({
    config,
    labs,
    championState: { config: {}, configId: 'champ' },
    challengerSummary: { config: { slAtrMult: 0.1 }, configId: 'challenger' },
    evaluateLabPair: mockEvaluateLabPair,
  });

  assert.equal(result.matrixDecision.recommendation, 'hold',
    'should still hold: primary failed');
  assert.equal(shadowCallCount, 2,
    'shadows should be evaluated in diagnostic mode');
  assert.equal(result.diagnosticShadowResults?.length, 2,
    'diagnostic shadow results should be present in output');
  assert.equal(result.diagnosticShadowResults[0].decision.recommendation, 'promote');
});
```

Note: If `evaluateMatrix` is not the correct export name, find it:

```bash
node -e "import('../scripts/pine-autoresearch.mjs').then(m=>console.log(Object.keys(m).filter(k=>k.toLowerCase().includes('matrix')||k.toLowerCase().includes('evaluat'))))"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-name-pattern="evaluateMatrix runs shadow labs in diagnostic mode" tests/pine-autoresearch.test.mjs
```

Expected: FAIL — diagnostic shadow evaluation doesn't exist.

- [ ] **Step 3: Add config option**

In `config/pine-autoresearch.default.json`, inside `matrixPolicy`, add:

```json
"diagnosticShadowEvaluation": true
```

- [ ] **Step 4: Implement diagnostic shadow evaluation**

In `scripts/pine-autoresearch.mjs`, modify the primary-failure short-circuit block (lines 2952-2966).

From:
```js
  const requiresPrimaryPromote = config.matrixPolicy?.requirePrimaryPromote !== false;
  if (requiresPrimaryPromote && primaryResult.decision.recommendation !== 'promote') {
    const labResults = [primaryResult];
    return {
      labResults,
      holdoutVerdict: null,
      matrixDecision: decideMatrixPromotion({
        labResults,
        shadowsEvaluated: false,
        policy: config.matrixPolicy,
        champion: championState,
        challenger: challengerSummary,
      }),
    };
  }
```

To:
```js
  const requiresPrimaryPromote = config.matrixPolicy?.requirePrimaryPromote !== false;
  if (requiresPrimaryPromote && primaryResult.decision.recommendation !== 'promote') {
    const labResults = [primaryResult];
    const matrixDecision = decideMatrixPromotion({
      labResults,
      shadowsEvaluated: false,
      policy: config.matrixPolicy,
      champion: championState,
      challenger: challengerSummary,
    });

    // Diagnostic shadow evaluation: collect cross-asset data even on primary failure
    let diagnosticShadowResults = null;
    if (config.matrixPolicy?.diagnosticShadowEvaluation === true && labs.length > 1) {
      const shadowConcurrency = config.regimeExitResearch?.resource?.maxConcurrentLabWorkers ?? 3;
      try {
        diagnosticShadowResults = await mapWithConcurrency(labs.slice(1), shadowConcurrency, evaluateLabPair);
      } catch {
        // Diagnostic evaluation is best-effort; do not fail the cycle
        diagnosticShadowResults = null;
      }
    }

    return {
      labResults,
      holdoutVerdict: null,
      matrixDecision,
      diagnosticShadowResults,
    };
  }
```

- [ ] **Step 5: Persist diagnostic results in manifest**

In the manifest assembly section of `scripts/pine-autoresearch.mjs` (around line 1600), add `diagnosticShadowResults` to the manifest if present:

```js
    diagnosticShadowResults: selectedCandidate?.diagnosticShadowResults?.map(r => ({
      labId: r.labId ?? r.lab?.labId,
      recommendation: r.decision?.recommendation,
      scoreDelta: r.decision?.comparisons?.scoreDelta,
      roiDeltaPct: r.decision?.comparisons?.roiDeltaPct,
    })) ?? null,
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test --test-name-pattern="evaluateMatrix runs shadow labs in diagnostic mode" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run:

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/pine-autoresearch.mjs config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs
git commit -m "feat: add diagnostic shadow evaluation on primary lab failure"
```

---

### Task 5: Expand Exit-State Patch Pool

**Problem:** The `exitStatePatches()` function in `scripts/lib/pine-track-generators.mjs` only generates 3 patches, all for `useTimeStop`:

```js
function exitStatePatches(base) {
  return [
    { useTimeStop: true, timeStopBars: 8 },
    { useTimeStop: true, timeStopBars: 16 },
    { useTimeStop: true, timeStopBars: 12 },
  ];
}
```

The Pine strategy has 10+ exit-state parameters that are never explored:
- `useFailedFollowThroughTighten` + `followThroughBars`, `followThroughMinProgressAtr`, `followThroughTightenTrailAtrMult`
- `usePartialDerisk` + `partialDeriskAtR`, `partialDeriskClosePct`
- `useContextCautionTighten` + `contextCautionDelta`, `contextCautionTrailAtrMult`
- `usePostEntrySqueezeCollapseTighten` + `postEntrySqueezeCollapseBars`, `postEntrySqueezeCollapseTrailAtrMult`
- `useAdverseDivergenceTighten` + `adverseDivergenceBars`, `adverseDivergenceTrailAtrMult`

**Fix:** Expand `exitStatePatches()` to cover all exit-state features with meaningful parameter variations.

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs` (function `exitStatePatches`)
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Write failing test for expanded exit-state patches**

Append to `tests/pine-track-generators.test.mjs`:

```js
test('exitStatePatches generates patches for all exit-state features, not just useTimeStop', () => {
  const { buildTrackVariants } = await import('../scripts/lib/pine-track-generators.mjs');

  const base = {
    useTimeStop: false,
    timeStopBars: 8,
    timeStopMinUnrealizedAtr: 0.5,
    useFailedFollowThroughTighten: false,
    followThroughBars: 4,
    followThroughMinProgressAtr: 0.75,
    followThroughTightenTrailAtrMult: 0.75,
    usePartialDerisk: false,
    partialDeriskAtR: 1.0,
    partialDeriskClosePct: 50.0,
    useContextCautionTighten: false,
    contextCautionDelta: 0.5,
    contextCautionTrailAtrMult: 0.75,
    usePostEntrySqueezeCollapseTighten: false,
    postEntrySqueezeCollapseBars: 4,
    postEntrySqueezeCollapseTrailAtrMult: 0.75,
    useAdverseDivergenceTighten: false,
    adverseDivergenceBars: 6,
    adverseDivergenceTrailAtrMult: 0.75,
    slAtrMult: 0.5,
    tpAtrMult: 6.85,
    trailActivateR: 0.5,
    trailAtrMult: 1,
  };

  const variants = buildTrackVariants({
    trackId: 'exit-state-research',
    family: 'exit-state',
    base,
    limit: 12,
    tabuSet: new Set(),
    temperature: 1,
    offset: 0,
  });

  // Should have patches covering multiple exit-state features
  const families = new Set(variants.map(v => {
    const patch = v.patch || v.metadata?.patch || {};
    if (patch.useTimeStop !== undefined) return 'timeStop';
    if (patch.useFailedFollowThroughTighten !== undefined) return 'followThrough';
    if (patch.usePartialDerisk !== undefined) return 'partialDerisk';
    if (patch.useContextCautionTighten !== undefined) return 'contextCaution';
    if (patch.usePostEntrySqueezeCollapseTighten !== undefined) return 'squeezeTighten';
    if (patch.useAdverseDivergenceTighten !== undefined) return 'adverseDiv';
    return 'other';
  }));

  assert.ok(families.size >= 4,
    `should cover at least 4 exit-state feature families, got: ${[...families].join(', ')}`);
  assert.ok(variants.length >= 8,
    `should generate at least 8 exit-state variants, got: ${variants.length}`);
});
```

Note: If `buildTrackVariants` is not the correct export, find it:

```bash
node -e "import('../scripts/lib/pine-track-generators.mjs').then(m=>console.log(Object.keys(m)))"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-name-pattern="exitStatePatches generates patches for all exit-state features" tests/pine-track-generators.test.mjs
```

Expected: FAIL — only 3 patches generated, all `useTimeStop`.

- [ ] **Step 3: Implement expanded exitStatePatches**

In `scripts/lib/pine-track-generators.mjs`, replace the `exitStatePatches` function:

```js
function exitStatePatches(base) {
  return [
    // Time stop variations
    { useTimeStop: true, timeStopBars: 8, timeStopMinUnrealizedAtr: 0.5 },
    { useTimeStop: true, timeStopBars: 16, timeStopMinUnrealizedAtr: 0.25 },
    { useTimeStop: true, timeStopBars: 12, timeStopMinUnrealizedAtr: 0.75 },

    // Failed follow-through tighten
    {
      useFailedFollowThroughTighten: true,
      followThroughBars: lowerBound((base.followThroughBars ?? 4) - 1, 1),
      followThroughMinProgressAtr: Math.max(0, numeric(base.followThroughMinProgressAtr ?? 0.75) - 0.25),
      followThroughTightenTrailAtrMult: Math.max(0.1, numeric(base.followThroughTightenTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      useFailedFollowThroughTighten: true,
      followThroughBars: numeric(base.followThroughBars ?? 4) + 2,
      followThroughMinProgressAtr: numeric(base.followThroughMinProgressAtr ?? 0.75) + 0.5,
      followThroughTightenTrailAtrMult: numeric(base.followThroughTightenTrailAtrMult ?? 0.75) + 0.1,
    },

    // Partial de-risk
    {
      usePartialDerisk: true,
      partialDeriskAtR: Math.max(0, numeric(base.partialDeriskAtR ?? 1.0) - 0.5),
      partialDeriskClosePct: numeric(base.partialDeriskClosePct ?? 50) + 10,
    },
    {
      usePartialDerisk: true,
      partialDeriskAtR: numeric(base.partialDeriskAtR ?? 1.0) + 0.5,
      partialDeriskClosePct: Math.max(0, numeric(base.partialDeriskClosePct ?? 50) - 15),
    },

    // Context caution tighten
    {
      useContextCautionTighten: true,
      contextCautionDelta: numeric(base.contextCautionDelta ?? 0.5) + 0.25,
      contextCautionTrailAtrMult: Math.max(0.1, numeric(base.contextCautionTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      useContextCautionTighten: true,
      contextCautionDelta: Math.max(0, numeric(base.contextCautionDelta ?? 0.5) - 0.25),
      contextCautionTrailAtrMult: numeric(base.contextCautionTrailAtrMult ?? 0.75) + 0.1,
    },

    // Post-entry squeeze collapse tighten
    {
      usePostEntrySqueezeCollapseTighten: true,
      postEntrySqueezeCollapseBars: lowerBound((base.postEntrySqueezeCollapseBars ?? 4) - 1, 1),
      postEntrySqueezeCollapseTrailAtrMult: Math.max(0.1, numeric(base.postEntrySqueezeCollapseTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      usePostEntrySqueezeCollapseTighten: true,
      postEntrySqueezeCollapseBars: numeric(base.postEntrySqueezeCollapseBars ?? 4) + 2,
      postEntrySqueezeCollapseTrailAtrMult: numeric(base.postEntrySqueezeCollapseTrailAtrMult ?? 0.75) + 0.1,
    },

    // Adverse divergence tighten
    {
      useAdverseDivergenceTighten: true,
      adverseDivergenceBars: lowerBound((base.adverseDivergenceBars ?? 6) - 2, 1),
      adverseDivergenceTrailAtrMult: Math.max(0.1, numeric(base.adverseDivergenceTrailAtrMult ?? 0.75) - 0.15),
    },
    {
      useAdverseDivergenceTighten: true,
      adverseDivergenceBars: numeric(base.adverseDivergenceBars ?? 6) + 3,
      adverseDivergenceTrailAtrMult: numeric(base.adverseDivergenceTrailAtrMult ?? 0.75) + 0.1,
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node --test --test-name-pattern="exitStatePatches generates patches for all exit-state features" tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run full track generators test suite**

Run:

```bash
node --test tests/pine-track-generators.test.mjs
```

Expected: all pass. If existing tests assert exact patch count for exit-state, update them to reflect the new count (13 patches instead of 3).

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-track-generators.mjs tests/pine-track-generators.test.mjs
git commit -m "feat: expand exit-state patch pool to cover all exit features"
```

---

### Task 6: Gate-Aware Search Filtering

**Problem:** The search generates variants that mechanically conflict with the promotion gate. Specifically:
- Reducing `slAtrMult` (tighter stop) mechanically reduces ROI because more trades get stopped out before reaching TP
- The scoring function rewards this (higher PF, lower DD) but the ROI gate rejects it
- The system wastes cycles evaluating candidates that can never promote

Current evidence: challenger has `slAtrMult: 0.1` vs champion `slAtrMult: 0.5` — a 5x tighter stop that guarantees ROI regression.

**Fix:** Add a pre-emission filter that estimates whether a variant's parameter direction is compatible with the ROI gate. Variants that reduce `slAtrMult` below a configurable floor relative to champion (e.g., 50% of champion value) are skipped unless stagnation escape explicitly allows architecture keys.

This is NOT about restricting search — it's about not wasting budget on candidates that will definitely fail the gate.

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs` (add gate-aware filter in variant emission)
- Modify: `config/pine-autoresearch.default.json` (add `searchPolicy.gateAwareFilter`)
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Write failing test for gate-aware filtering**

Append to `tests/pine-track-generators.test.mjs`:

```js
test('buildTrackVariants skips variants that reduce slAtrMult below gate-aware floor', () => {
  const { buildTrackVariants } = await import('../scripts/lib/pine-track-generators.mjs');

  const base = {
    slAtrMult: 0.5,
    tpAtrMult: 6.85,
    trailActivateR: 0.5,
    trailAtrMult: 1,
    minPredSum: 1.8,
    minBarsBetween: 1,
    useSqueezeContext: true,
    squeezeLength: 20,
    squeezeBbMult: 2.0,
    squeezeKcMult: 1.5,
    squeezeReleaseFreshBars: 4,
    squeezeBoostValue: 0.25,
  };

  const gateAwareFilter = {
    enabled: true,
    slAtrMultMinRatio: 0.5,
    roiHostileKeys: ['slAtrMult'],
  };

  const variants = buildTrackVariants({
    trackId: 'squeeze-context',
    family: 'squeeze',
    base,
    limit: 12,
    tabuSet: new Set(),
    temperature: 4,
    offset: 0,
    gateAwareFilter,
  });

  // No variant should have slAtrMult < 0.25 (50% of champion's 0.5)
  const violators = variants.filter(v => {
    const config = v.config || {};
    return typeof config.slAtrMult === 'number' && config.slAtrMult < 0.25;
  });

  assert.equal(violators.length, 0,
    `no variant should reduce slAtrMult below 50% of champion (0.25), found ${violators.length}`);
});

test('buildTrackVariants allows slAtrMult reduction when gateAwareFilter is disabled', () => {
  const { buildTrackVariants } = await import('../scripts/lib/pine-track-generators.mjs');

  const base = {
    slAtrMult: 0.5,
    tpAtrMult: 6.85,
    trailActivateR: 0.5,
    trailAtrMult: 1,
    minPredSum: 1.8,
    minBarsBetween: 1,
    useSqueezeContext: true,
    squeezeLength: 20,
    squeezeBbMult: 2.0,
    squeezeKcMult: 1.5,
    squeezeReleaseFreshBars: 4,
    squeezeBoostValue: 0.25,
  };

  const variants = buildTrackVariants({
    trackId: 'squeeze-context',
    family: 'squeeze',
    base,
    limit: 12,
    tabuSet: new Set(),
    temperature: 4,
    offset: 0,
    gateAwareFilter: { enabled: false },
  });

  // With filter disabled, variants with low slAtrMult are allowed
  assert.ok(variants.length > 0, 'should still generate variants');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test --test-name-pattern="buildTrackVariants skips variants that reduce slAtrMult|buildTrackVariants allows slAtrMult reduction" tests/pine-track-generators.test.mjs
```

Expected: FAIL — gate-aware filter doesn't exist.

- [ ] **Step 3: Add config**

In `config/pine-autoresearch.default.json`, inside `searchPolicy`, add:

```json
"gateAwareFilter": {
  "enabled": true,
  "slAtrMultMinRatio": 0.5,
  "roiHostileKeys": ["slAtrMult"]
}
```

- [ ] **Step 4: Implement gate-aware filter in buildTrackVariants**

In `scripts/lib/pine-track-generators.mjs`, in the `buildTrackVariants` function (or equivalent main variant builder), add a post-scaling filter before adding to the batch:

After `const config = applyPatch(base, patch);` and before `tabuSet.add(fingerprint);`, add:

```js
      // Gate-aware filter: skip variants that mechanically violate promotion gates
      if (gateAwareFilter?.enabled === true) {
        const slAtrMultMinRatio = Number(gateAwareFilter.slAtrMultMinRatio) || 0.5;
        const baseSlAtrMult = Number(base.slAtrMult) || 0;
        const candidateSlAtrMult = Number(config.slAtrMult);
        if (baseSlAtrMult > 0
          && Number.isFinite(candidateSlAtrMult)
          && candidateSlAtrMult < baseSlAtrMult * slAtrMultMinRatio) {
          continue;
        }
      }
```

Also add `gateAwareFilter` to the function signature:

```js
export function buildTrackVariants({ trackId, family, base, limit, tabuSet, temperature, offset, gateAwareFilter, ...rest }) {
```

- [ ] **Step 5: Pass gateAwareFilter from the main autoresearch script**

In `scripts/pine-autoresearch.mjs`, where `buildTrackVariants` or `buildIncumbentSearchBatch` is called, pass the filter from config:

```js
gateAwareFilter: config.searchPolicy?.gateAwareFilter ?? { enabled: false },
```

Find the call site by searching:

```bash
node -e "const fs=require('fs'); const c=fs.readFileSync('scripts/pine-autoresearch.mjs','utf8'); const lines=c.split('\n'); lines.forEach((l,i)=>{if(l.includes('buildTrackVariants')||l.includes('buildIncumbentSearchBatch'))console.log(i+1,l.trim())})"
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
node --test --test-name-pattern="buildTrackVariants skips variants that reduce slAtrMult|buildTrackVariants allows slAtrMult reduction" tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run:

```bash
node --test tests/pine-track-generators.test.mjs
```

Expected: all pass. Existing tests that don't pass `gateAwareFilter` should still work (filter defaults to disabled when not provided).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/pine-track-generators.mjs scripts/pine-autoresearch.mjs config/pine-autoresearch.default.json tests/pine-track-generators.test.mjs
git commit -m "feat: add gate-aware search filter to skip ROI-hostile variants"
```

---

### Task 7: Integration Regression Test

**Problem:** Tasks 1-6 each modify different parts of the autoresearch pipeline. We need to verify they work together without breaking existing behavior.

**Files:** No new source files. Run existing + new tests.

- [ ] **Step 1: Run all focused test suites**

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-track-generators.test.mjs tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch-tabu-saturation.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run full project test suite**

```bash
npm test
```

Expected: `0 fail`. Current known baseline is ~820+ tests. Exact total may increase after new tests from Tasks 1-6.

- [ ] **Step 3: Verify config is valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('config/pine-autoresearch.default.json','utf8')); console.log('valid')"
```

Expected: `valid`.

- [ ] **Step 4: Dry-run one autoresearch cycle (if available)**

Check if a dry-run mode exists:

```bash
node -e "console.log(require('./package.json').scripts)" | grep -i pine
```

If `pine:autoresearch` script exists with a `--dry-run` flag:

```bash
npm run pine:autoresearch -- --profile micro --dry-run
```

Otherwise skip this step — the unit tests are sufficient for code correctness.

- [ ] **Step 5: Commit any test repairs**

If only test expectation repairs are needed:

```bash
git add tests
git commit -m "test: align expectations after structural fixes"
```

---

### Task 8: Fresh Cycle Validation

**Problem:** After all code fixes, run one real autoresearch cycle to verify the system behaves differently.

**Files:** No source edits. Generated artifacts update under `pine/autoresearch/...`.

- [ ] **Step 1: Run one fresh autoresearch cycle**

```bash
npm run pine:autoresearch -- --profile full --force-cycle
```

If the script name differs:

```bash
node -e "console.log(Object.entries(require('./package.json').scripts).filter(([k])=>k.includes('pine')).map(([k,v])=>k+': '+v).join('\n'))"
```

- [ ] **Step 2: Audit latest manifest**

```bash
node -e "const fs=require('fs');const dir='pine/autoresearch/pine-fusion-v4-core-15m-locked-window/manifests';const files=fs.readdirSync(dir).filter(f=>f.endsWith('.json')).sort();const latest=JSON.parse(fs.readFileSync(dir+'/'+files[files.length-1]));console.log(JSON.stringify({runId:latest.runId,stagnation:{level:latest.stagnationLevel,reason:latest.stagnationReason,escape:latest.stagnationEscape},decision:latest.matrixDecision?.recommendation,failedGates:latest.matrixDecision?.failedGates,roiRelaxation:latest.labResults?.[0]?.decision?.comparisons?.roiRelaxationApplied,roiRelaxationTier:latest.labResults?.[0]?.decision?.comparisons?.roiRelaxationTier,primaryLabPassed:latest.primaryLabPassed,diagnosticShadows:latest.diagnosticShadowResults?.length??0,emitted:latest.searchEfficiency?.emittedVariantCount,schedulerCycleIndex:latest.schedulerCycleIndex},null,2))"
```

Expected acceptance criteria:

| Check | Expected |
|---|---|
| `stagnationLevel` | Should be ≤ 3 (de-escalation may have reduced it) |
| `roiRelaxationApplied` | `true` if candidate meets tiered criteria |
| `roiRelaxationTier` | `'tiered'` or `'standard'` if relaxation applied |
| `primaryLabPassed` | Present in manifest (boolean) |
| `diagnosticShadows` | > 0 if primary failed and diagnostic mode active |
| `emittedVariantCount` | > 0 (gate-aware filter should not kill all variants) |
| No `slAtrMult < 0.25` in variants | Gate-aware filter working |

- [ ] **Step 3: Check scheduler state for de-escalation evidence**

```bash
node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler/pine-fusion-v4-core-15m-locked-window.json'));console.log(JSON.stringify({stagnationLevel:s.stagnationLevel,stagnationReason:s.stagnationReason,noScoreImprovementStreak:s.noScoreImprovementStreak,_healthyCycleCount:s._healthyCycleCount,cycleIndex:s.cycleIndex},null,2))"
```

Expected: `_healthyCycleCount` is tracked. If all streaks were 0 for 2+ cycles, `stagnationLevel` should have decreased.

- [ ] **Step 4: Do not auto-promote**

If a candidate promotes on primary, do not auto-promote from this plan. Holdout gates and queue policy still govern promotion safety.

---

## Self-Review Checklist

- [x] Covers all 6 structural flaws identified in the deep audit that the original plan missed
- [x] Each task has exact file paths and line references
- [x] Complete code in every step — no placeholders
- [x] Tests before implementation for each behavior change (TDD)
- [x] Keeps promotion safety gates intact — tiered relaxation has hard floors
- [x] Gate-aware filter is configurable and defaults to safe behavior
- [x] De-escalation is gradual (1 level per N healthy cycles), not abrupt
- [x] Shadow diagnostic evaluation is best-effort and doesn't block cycles
- [x] noScoreImprovementStreak fix uses `primaryLabPassed` which is a clean signal
- [x] Exit-state patches cover all 5 exit features with 2+ variations each
- [x] Integration regression test runs full suite before fresh cycle
- [x] Fresh cycle validation has concrete acceptance criteria

## Execution Notes

Recommended execution mode: subagent-driven development.

Suggested task grouping:

1. **Immediate unblock** (Tasks 1 + 3): ROI relaxation + streak fix — these together may unblock promotion
2. **Stagnation recovery** (Task 2): De-escalation — prevents temperature runaway
3. **Search quality** (Tasks 4 + 5): Shadow diagnostics + exit-state patches — expands useful search surface
4. **Efficiency** (Task 6): Gate-aware filter — prevents wasted cycles
5. **Verification** (Tasks 7 + 8): Integration + fresh cycle

Each group should have: implementation worker, then main-session verification.
