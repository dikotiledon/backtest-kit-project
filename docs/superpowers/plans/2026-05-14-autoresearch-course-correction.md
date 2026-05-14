# Pine Autoresearch Post-Execution Reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile the one failing test left over from the May 11-13 execution, then decide what's next.

**Architecture:** Minimal intervention. The May 11-13 branch (`fix/autoresearch-honesty-and-escape`, 9 commits) was legitimate work that fixed real problems. The single failing test is an edge case in the optimizer's new gap-down logic, not a fundamental flaw. Fix it and move on.

**Tech Stack:** Node.js native test runner, ES modules

---

## What Actually Happened May 11-13

A 9-commit branch `fix/autoresearch-honesty-and-escape` was executed and merged (`eb404a4`):

| Commit | Change | Status |
|--------|--------|--------|
| `2d119c1` | Eliminate same-bar SL/TP look-ahead, add intra-bar exit detection | ✅ Correct fix, but left 1 test failing |
| `21d9043` | Honest matrix decision when shadows not evaluated | ✅ Working |
| `d31638a` | Architecture escape at stagnation level 2 | ✅ Working |
| `486cb48` | Blind holdout labs when matrix recommends promote | ✅ Working |
| `81b36a6` | Unify minTradeCount default to 100 | ✅ Working |
| `f7b5556` | Throw when primaryLab missing but shadowLabs configured | ✅ Working |
| `c18b4a0` | Smooth tradePenalty ramp instead of cliff | ✅ Working |
| `a36b0a2` | Short config labels with legend | ✅ Working |
| `7d82fec` | Widen search basin config | ✅ Working |

**Result: 551 tests pass, 1 fails.** The execution was successful. The one failure is a test that wasn't updated to match the new optimizer behavior.

---

## The One Failing Test

**File:** `tests/pine-phase3.test.mjs:20`
**Test:** "simulateTrades updates active stop from later rows when Feature_SimPos stays open"
**Error:** exitPrice is 102, test expects 103

**Why it fails:** Commit `2d119c1` added gap-down logic: `exitPrice = open < stopLoss ? open : stopLoss`. The test uses Close-only data (no explicit Open/High/Low). When Open defaults to Close (102), the code sees `102 < 103` and fills at 102 instead of the stop level 103.

**The question:** Is the test wrong, or does the code need an edge case fix?

**Answer:** Both are partially right. The gap-down logic is correct for real OHLC data (if a bar gaps below your stop, you get filled at the open, not the stop). But for Close-only data where Open is synthetic (defaulted from Close), gap-down logic shouldn't apply. The test correctly expects fill at the stop level for Close-only data.

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `scripts/lib/pine-optimizer.mjs:91-114` | Exit price calculation | Add `hasExplicitOpen` guard |
| `tests/pine-phase3.test.mjs` | Existing test | Should pass after fix |

---

## Task 1: Fix the Gap-Down Edge Case for Close-Only Data

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs:91-114`
- Test: `tests/pine-phase3.test.mjs` (existing, should pass after fix)

- [ ] **Step 1: Apply the fix**

In `scripts/lib/pine-optimizer.mjs`, replace the exit detection block (lines 91-129). The only change: add `const hasExplicitOpen = Number.isFinite(row.Open);` and gate the gap logic on it.

Current code (lines 91-129):
```javascript
    if (position) {
      const close = row.Close;
      const high = Number.isFinite(row.High) ? row.High : close;
      const low = Number.isFinite(row.Low) ? row.Low : close;
      const open = Number.isFinite(row.Open) ? row.Open : close;
      const heldBars = i - position.entryIndex;
      let exitReason = null;
      let exitPrice = null;

      // Exit detection uses PREVIOUS bar's SL/TP (already stored in position)
      if (position.side === 'long') {
        if (Number.isFinite(position.stopLoss) && low <= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = open < position.stopLoss ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && high >= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = open > position.takeProfit ? open : position.takeProfit;
        }
```

Fixed code:
```javascript
    if (position) {
      const close = row.Close;
      const hasExplicitOpen = Number.isFinite(row.Open);
      const high = Number.isFinite(row.High) ? row.High : close;
      const low = Number.isFinite(row.Low) ? row.Low : close;
      const open = hasExplicitOpen ? row.Open : close;
      const heldBars = i - position.entryIndex;
      let exitReason = null;
      let exitPrice = null;

      // Exit detection uses PREVIOUS bar's SL/TP (already stored in position)
      if (position.side === 'long') {
        if (Number.isFinite(position.stopLoss) && low <= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = (hasExplicitOpen && open < position.stopLoss) ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && high >= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = (hasExplicitOpen && open > position.takeProfit) ? open : position.takeProfit;
        }
```

Same pattern for the short side:
```javascript
      } else {
        if (Number.isFinite(position.stopLoss) && high >= position.stopLoss) {
          exitReason = 'stopLoss';
          exitPrice = (hasExplicitOpen && open > position.stopLoss) ? open : position.stopLoss;
        } else if (Number.isFinite(position.takeProfit) && low <= position.takeProfit) {
          exitReason = 'takeProfit';
          exitPrice = (hasExplicitOpen && open < position.takeProfit) ? open : position.takeProfit;
        }
```

- [ ] **Step 2: Run the failing test**

Run: `node --test tests/pine-phase3.test.mjs`

Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `node --test`

Expected: 552 pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/pine-optimizer.mjs
git commit -m "fix(optimizer): gate gap-down/up fill logic on explicit Open data

The anti-look-ahead fix (2d119c1) correctly added gap fill logic but
didn't account for Close-only data where Open defaults to Close.
Now gap fills only apply when Open is explicitly provided in the row.
Close-only data fills at the stop/TP level (standard assumption)."
```

---

## What's Actually Next (Post-Fix)

After this one fix, the project is in good shape:
- 552 tests passing
- The May 11-13 execution addressed 9 real issues
- The 21-task comprehensive plan was never executed (checkboxes all unchecked)

**Decision needed from you:**
1. Is the 21-task plan still relevant, or was it superseded by the 9-task branch?
2. Do you want to continue with remaining items from the 21-task plan?
3. Or is the system working well enough now to run actual autoresearch cycles?

---

## The Real Problem: Planning Drift

The technical state is fine (551/552 pass). The process state is not. Here's the accumulated planning debt:

| Document | Date | Status | Problem |
|----------|------|--------|---------|
| `docs/2026-04-21-fusion-v2-plan.md` | Apr 21 | Superseded by v3 | Dead document, never cleaned up |
| `docs/2026-04-21-fusion-v3-plan.md` | Apr 21 | Superseded by v4 | Dead document, never cleaned up |
| `docs/2026-04-21-fusion-v4-plan.md` | Apr 21 | Partially implemented | Unclear what's done vs. not |
| `docs/2026-04-21-signal-fusion-implementation-plan.md` | Apr 21 | Unknown | Overlaps with fusion plans |
| `docs/2026-04-29-pine-autoresearch-anti-curvefit.md` | Apr 29 | Partially implemented | Some gates exist, unclear which |
| `docs/superpowers/plans/2026-05-11-autoresearch-comprehensive-improvement.md` | May 11 | Never executed | 21 tasks, all unchecked, stale |
| The 9-task branch (`fix/autoresearch-honesty-and-escape`) | May 11-13 | Executed & merged | Not documented as a plan, overlaps with 21-task plan |

**7 planning documents, no single source of truth.** This is why it feels like drift — not because the code is bad, but because nobody can tell which plan is active, which is dead, and what's been done.

### Process Fix (Task 2)

After fixing the test (Task 1), the second action is to clean up the planning state:

- [ ] **Step 1: Mark dead plans as superseded**

Add a header to each dead plan:
```markdown
> ⚠️ SUPERSEDED — This plan was replaced by [X]. Do not execute.
```

Apply to: `fusion-v2-plan.md`, `fusion-v3-plan.md`, `signal-fusion-implementation-plan.md`

- [ ] **Step 2: Audit the 21-task plan against what the 9-task branch already did**

The 9-task branch addressed some of the same concerns. Mark which of the 21 tasks are now moot:
- Task 4 (stagnation escape) → Done by `d31638a`
- Task 7 (holdout deadlock) → Partially done by `486cb48`
- Task 19 (significance gate) → Done by `81b36a6`

Update the 21-task plan with `[DONE by commit X]` or `[SUPERSEDED]` annotations.

- [ ] **Step 3: Decide: execute remaining 21-task items, or declare the system ready for cycles?**

This is YOUR decision. The system works. The question is whether you want more hardening or want to run it.

- [ ] **Step 4: Commit the cleanup**

```bash
git add docs/
git commit -m "docs: mark superseded plans, annotate 21-task plan with execution status"
```

---

## Adversarial Self-Review (Steps 1-5 Applied to My Own Process)

**STEP 1 — What's necessarily true vs. assumed:**
- TRUE: 1 test fails due to gap-down edge case. Fix is `hasExplicitOpen` guard.
- TRUE: 551 tests pass. The May 11-13 work was legitimate.
- ASSUMED (by my first plan): "The foundation is broken." FALSE — it's an edge case.
- ASSUMED (by my second plan): "Everything is fine, just fix 1 test." INCOMPLETE — the planning chaos is real.

**STEP 2 — Adversarial cycles on my own answer:**
1. "Just fix the test" → Ignores the user's frustration about drift. The test is a symptom they can see; the planning chaos is the disease they feel.
2. "Rewrite everything with 7 tasks" → Adds to the problem. Another plan on the pile.
3. "Fix the test + clean up dead plans" → Addresses both the technical symptom and the process disease. Minimal intervention, maximum clarity.

**STEP 3 — What would a critic find dishonest:**
- That I swung from "everything is broken" to "everything is fine" in one iteration. The truth: the CODE is fine, the PROCESS has accumulated debt.
- That I'm proposing plan cleanup as a "task" — which is itself more planning. But someone has to break the cycle.

**STEP 4 — Residual uncertainties:**
- I haven't verified whether the autoresearch system actually RUNS successfully end-to-end after the May 11-13 changes. Tests pass ≠ system works in production.
- The 21-task plan may contain insights that are still relevant. I triaged it based on descriptions, not by reading the actual implementation details.
- The Pine transpiler `import` errors in `error.txt` are from April 21 and may be stale (pre-dating the flatten script). I haven't verified if they still occur.

**STEP 5 — Is this structurally different from the obvious answer?**
- Obvious answer: "Here's a plan to fix things." (What I did first — wrong.)
- Second obvious answer: "It's just 1 bug, relax." (What I did second — incomplete.)
- This answer: "1 bug to fix + the real problem is planning chaos, here's how to stop it." Different structure: addresses both layers.
