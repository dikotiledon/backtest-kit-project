# Pine Autoresearch Comprehensive Fix Plan

> **Status:** Phase 1 COMPLETE. Phases 2-4 pending.

## Problem Statement

The autoresearch system has been stuck for multiple sessions. Each intervention ("plan after plan, patch after patch") added complexity without solving the root cause, making the system harder to reason about and further from its goal.

**Score trajectory:** 153.25 → 147.9 (regression from manual champion downgrade) → stuck at 147.9 for 5+ cycles.

---

## Root Cause (Single Sentence)

The system optimizes a fixed objective on a fixed data window with no mechanism to detect convergence or escape flat parameter regions.

---

## Phase 1: Unblock the System ✅ COMPLETE

| Change | File | Before | After | Rationale |
|--------|------|--------|-------|-----------|
| Score-based stagnation | `scripts/lib/pine-autoresearch-tracks.mjs` | No detection | `noScoreImprovementStreak` escalates after 2 cycles | Detects "different config, same score" trap |
| Significance threshold | `config/pine-autoresearch.default.json` | 0.005 (requires 0.74) | 0.003 (requires 0.44) | Unblocks 148.51 challenger (delta 0.61) |
| Track rotation speed | `config/pine-autoresearch.default.json` | 32 cycles | 4 cycles | Rotates away from inert tracks 8x faster |
| Max cycles per track | `config/pine-autoresearch.default.json` | 63 cycles | 8 cycles | No track monopolizes |
| Scheduler state | State file | 75 tabu, cycle 5 | 0 tabu, cycle 0 | Fresh start with new detection |
| bestScoreDelta wiring | `scripts/pine-autoresearch.mjs` | Not passed | Passed to scheduler | Enables score-based stagnation |

---

## Phase 2: Fix Search Quality

### 2.1 Sweep/Matrix Score Discrepancy

**Problem:** Sweep finds score 149.94, matrix re-evaluation gets 147.9 for the same config.

**Root cause hypothesis:** The sweep runs all variants through `pine-sweep.mjs` which uses a batch evaluation pipeline. The matrix runs each config individually through `pine-import-run-clean.mjs` which flattens imports and re-runs. Different code paths may handle warmup periods, data alignment, or trade counting differently.

**Fix:** Add a consistency check — after sweep, re-evaluate the top-1 config using the matrix pipeline. If scores differ by >1%, log a warning and use the matrix score as ground truth.

**Files:** `scripts/pine-autoresearch.mjs` (after `runPrimarySweep`)

### 2.2 Full Config Fingerprints in Tabu

**Problem:** Tabu entries contain partial configs (only mutated keys), producing fingerprints that never match the full champion fingerprint.

**Fix:** In `buildIncumbentSearchBatch` and `buildTrackCandidateBatch`, ensure every variant's `config` field contains the FULL config (champion + patch), not just the patch keys.

**Files:** `scripts/lib/pine-search-policy.mjs`, `scripts/lib/pine-track-generators.mjs`

### 2.3 Parameter Sensitivity Detection

**Problem:** The system wastes cycles mutating parameters that don't affect the score on this data window (e.g., timeStopBars).

**Fix:** Before generating variants for a family, run a quick ±20% sensitivity check on 2-3 representative parameters. If none change the score, skip that family for this cycle and mark it as "inert."

**Files:** New function in `scripts/lib/pine-search-policy.mjs`

### 2.4 Lower Low-Emission Threshold

**Problem:** `lowEmissionThreshold: 3` means the system doesn't flag low emission until only 3 variants survive. By then, the neighborhood is already exhausted.

**Fix:** Lower to 1. If only 1 variant survives tabu filtering, that's already a crisis.

**Files:** `config/pine-autoresearch.default.json`

---

## Phase 3: Fix Validation Architecture

### 3.1 Convergence Declaration

**Problem:** The system runs forever even when provably at a local optimum.

**Fix:** When `noScoreImprovementStreak >= 6` AND `stagnationLevel >= 3` AND all generated lanes are exhausted, declare convergence. Write a `converged.json` marker and stop running cycles until the champion or data window changes.

**Files:** `scripts/pine-autoresearch.mjs` (new early-exit in `runScout`)

### 3.2 Fix Blind Holdout Thresholds

**Problem:** `minRoiDeltaPct: 5` requires the challenger to have 5% MORE ROI than the champion on holdout data. For a champion at 82% ROI, this means the challenger needs 87% ROI on unseen data — essentially impossible for incremental improvements.

**Fix:** Change to `minRoiDeltaPct: 0` (just require non-regression on holdout).

**Files:** `config/pine-autoresearch.default.json` (blindHoldoutLabs thresholds)

### 3.3 Temporal Validation

**Problem:** All improvements are validated on the same fixed 10000-bar window. This is textbook overfitting.

**Fix:** Add a "temporal shift" validation — before promoting, re-evaluate the challenger on a 5000-bar window shifted 2500 bars forward. If it regresses by more than 10% relative, block promotion.

**Files:** New validation step in `evaluateMatrix`

### 3.4 Champion Regression Test

**Problem:** After promoting a new champion, there's no verification that the old champion was actually worse.

**Fix:** After each promotion, re-evaluate the OLD champion on the current data window. Log the comparison. If the old champion scores higher, flag a warning.

**Files:** `scripts/pine-autoresearch.mjs` (after `runPromote`)

---

## Phase 4: Simplify the System

### 4.1 Remove Blocked-Challenger Re-Queue

**Rationale:** Added in a previous session to "prevent losing good configs." But the stagnation detection now handles this — if a good config was blocked, the system will find it again when stagnation escalates and widens the search. The re-queue mechanism adds complexity without proven benefit.

**Files:** Remove from `scripts/lib/pine-autoresearch.mjs`, `scripts/pine-autoresearch.mjs`, `tests/pine-autoresearch-blocked-requeue.test.mjs`

### 4.2 Remove Entry-Invariance Enforcement

**Rationale:** Forces mutations on "entry" parameters even when the system is exploring exit-state parameters. This adds noise and conflicts with the track-based research design.

**Files:** Remove `enforceEntryInvarianceOnSearchBatch` calls from `scripts/pine-autoresearch.mjs`

### 4.3 Consolidate Research Tracks

**Current:** 5 tracks (squeeze-context, divergence-context, exit-state-research, ml-core-tuning, supertrend-tuning)

**Proposed:** 2 tracks:
- `exploit` — mutate the champion's most impactful parameters (signal, risk, fusion weights)
- `explore` — try fundamentally different architecture combinations (toggle features on/off)

**Rationale:** 5 tracks with 8 max cycles each = 40 cycles before full rotation. With 2 tracks = 16 cycles. Faster exploration of the full parameter space.

### 4.4 Remove Regime-Exit Research Lanes

**Rationale:** The regime-exit system (budget debt, lane exhaustion, generated novelty guards) adds ~500 lines of complexity for a system that's already near-optimal on a fixed window. It was designed for a future where the system would switch between market regimes — a feature that doesn't exist yet.

**Risk:** This is the largest simplification. Should be done last, after confirming Phases 1-3 produce stable improvements.

---

## Execution Priority

1. **Run Phase 1 (done)** → verify system finds and promotes the 148.51 challenger
2. **Phase 2.4** (config change, 1 minute) → lower lowEmissionThreshold
3. **Phase 3.2** (config change, 1 minute) → fix blind holdout thresholds
4. **Phase 2.1** (code change, 30 minutes) → fix sweep/matrix discrepancy
5. **Phase 3.1** (code change, 20 minutes) → add convergence declaration
6. **Phase 4.1-4.2** (code removal, 15 minutes each) → simplify
7. **Phase 2.2-2.3, 3.3-3.4** (deeper changes) → only if system still stuck after above

---

## Success Criteria

- [ ] System promotes a challenger within 5 cycles of Phase 1 deployment
- [ ] Score improves from 147.9 to ≥148.5
- [ ] Stagnation detection fires correctly when score plateaus
- [ ] Track rotation happens within 4 cycles of no improvement
- [ ] No manual intervention needed for 20+ cycles