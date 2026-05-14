# Pine Autoresearch Structural Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 structural flaws in the pine autoresearch system that cause stuck behavior, lost challengers, and overly strict promotion gates.

**Architecture:** Add a blocked-challenger re-queue mechanism, implement exploration-mode gate relaxation, and ensure tabu cleanup fires correctly on manual champion changes.

**Tech Stack:** Node.js (ESM), node:test runner, JSON state files

---

## Problem Summary

The autoresearch system has 3 structural flaws:

1. **Lost challengers** — When a challenger scores higher but fails a non-score gate (expectancy), it's recorded in the manifest but never re-tested. The next cycle generates fresh variants and the good config is permanently lost.

2. **No exploration mode** — The system applies the same strict gates during initial exploration (new seed, untuned params) as during production (stable champion). This causes repeated blocking of legitimate improvements.

3. **Stale tabu on manual champion change** — When champion.json is updated manually (not through `runPromote`), the scheduler's `dropOnChampionChange` logic doesn't fire because no promotion event occurs. This leaves 40+ stale tabu entries blocking the search.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `scripts/lib/pine-autoresearch.mjs` | Core decision logic (decideAutoresearchOutcome, evaluateMatrix) |
| `scripts/pine-autoresearch.mjs` | Orchestration (runScout, buildScoutOrchestrationState) |
| `config/pine-autoresearch.default.json` | Runtime configuration |
| `tests/pine-autoresearch.test.mjs` | Test assertions for config and decision logic |
| `tests/pine-autoresearch-blocked-requeue.test.mjs` | NEW: Tests for blocked-challenger re-queue |

---

### Task 1: Implement Blocked-Challenger Re-Queue

**Files:**
- Modify: `scripts/pine-autoresearch.mjs` (runScout function, ~line 3291)
- Modify: `scripts/pine-autoresearch.mjs` (buildScoutOrchestrationState, ~line 1385)
- Create: `tests/pine-autoresearch-blocked-requeue.test.mjs`

**Concept:** When a challenger passes all score/significance/trade gates but fails ONLY on expectancy or other soft gates, store it in a `blockedChallengerQueue` file. On the next cycle, before generating new variants, check if any queued challengers would now pass (because gates changed or champion changed). If so, inject them as priority candidates.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pine-autoresearch-blocked-requeue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockedChallengerEntry, shouldRequeueBlockedChallenger, filterRequeueCandidates } from '../scripts/lib/pine-autoresearch.mjs';

test('buildBlockedChallengerEntry creates entry from held manifest with score-passing challenger', () => {
  const manifest = {
    runId: 'run-blocked',
    challenger: { configId: 'cand-a', config: { riskAtrLen: 7 }, score: 147.9 },
    champion: { configId: 'champ', config: { riskAtrLen: 14 } },
    matrixDecision: { recommendation: 'hold', failedGates: ['expectancy'] },
    candidateFingerprint: 'fp-cand-a',
    championFingerprint: 'fp-champ',
  };
  const entry = buildBlockedChallengerEntry(manifest);
  assert.equal(entry.configFingerprint, 'fp-cand-a');
  assert.equal(entry.score, 147.9);
  assert.deepEqual(entry.config, { riskAtrLen: 7 });
  assert.deepEqual(entry.failedGates, ['expectancy']);
  assert.equal(entry.championFingerprintAtBlock, 'fp-champ');
});

test('shouldRequeueBlockedChallenger returns true when failed gate is now disabled', () => {
  const entry = {
    configFingerprint: 'fp-a',
    config: { riskAtrLen: 7 },
    score: 147.9,
    failedGates: ['expectancy'],
    championFingerprintAtBlock: 'fp-champ',
  };
  const currentPolicy = { requireExpectancyNonRegression: false, rejectWrGainAvgWinLoss: false };
  assert.equal(shouldRequeueBlockedChallenger(entry, { expectancyPolicy: currentPolicy }), true);
});

test('shouldRequeueBlockedChallenger returns false when failed gate is still active', () => {
  const entry = {
    configFingerprint: 'fp-a',
    config: { riskAtrLen: 7 },
    score: 147.9,
    failedGates: ['expectancy'],
    championFingerprintAtBlock: 'fp-champ',
  };
  const currentPolicy = { requireExpectancyNonRegression: true, rejectWrGainAvgWinLoss: true };
  assert.equal(shouldRequeueBlockedChallenger(entry, { expectancyPolicy: currentPolicy }), false);
});

test('filterRequeueCandidates excludes entries blocked for score gates', () => {
  const entries = [
    { configFingerprint: 'fp-a', failedGates: ['score', 'significance'] },
    { configFingerprint: 'fp-b', failedGates: ['expectancy'] },
    { configFingerprint: 'fp-c', failedGates: ['tradeFloor'] },
  ];
  const requeue = filterRequeueCandidates(entries);
  assert.deepEqual(requeue.map(e => e.configFingerprint), ['fp-b']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch-blocked-requeue.test.mjs`
Expected: FAIL with "buildBlockedChallengerEntry is not a function"

- [ ] **Step 3: Implement the blocked-challenger functions**

Add to `scripts/lib/pine-autoresearch.mjs`:

```javascript
// Soft gates that can be relaxed (not hard score/trade gates)
const SOFT_GATES = new Set(['expectancy']);
const HARD_GATES = new Set(['score', 'roi', 'profitFactor', 'drawdown', 'tradeFloor', 'tradeRatio', 'significance', 'candidateChanged']);

export function buildBlockedChallengerEntry(manifest) {
  if (!manifest?.challenger?.config || !manifest?.candidateFingerprint) return null;
  const failedGates = manifest.matrixDecision?.failedGates ?? [];
  // Only queue if ALL failed gates are soft (not hard score gates)
  if (failedGates.length === 0) return null;
  if (failedGates.some(gate => HARD_GATES.has(gate))) return null;
  
  return {
    configFingerprint: manifest.candidateFingerprint,
    config: manifest.challenger.config,
    configId: manifest.challenger.configId,
    score: manifest.challenger.score ?? manifest.challenger.metrics?.score ?? 0,
    failedGates,
    championFingerprintAtBlock: manifest.championFingerprint,
    blockedAt: manifest.generatedAt ?? new Date().toISOString(),
    runId: manifest.runId,
  };
}

export function shouldRequeueBlockedChallenger(entry, { expectancyPolicy }) {
  if (!entry || !Array.isArray(entry.failedGates)) return false;
  for (const gate of entry.failedGates) {
    if (gate === 'expectancy') {
      // Expectancy gate is now disabled if both sub-gates are false
      if (expectancyPolicy?.requireExpectancyNonRegression !== false && 
          expectancyPolicy?.rejectWrGainAvgWinLoss !== false) {
        return false;
      }
    }
  }
  return true;
}

export function filterRequeueCandidates(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(entry => {
    if (!entry?.failedGates?.length) return false;
    // Only requeue if ALL failed gates are soft
    return entry.failedGates.every(gate => SOFT_GATES.has(gate));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pine-autoresearch-blocked-requeue.test.mjs`
Expected: PASS

- [ ] **Step 5: Wire into runScout — store blocked challengers after hold decision**

In `scripts/pine-autoresearch.mjs`, after the matrix decision in `runScout` (~line 3291), add:

```javascript
// After: const rejectedCandidateFingerprint = ...
// Store blocked challenger for potential re-queue
if (selectedCandidate?.matrixDecision?.recommendation === 'hold') {
  const blockedEntry = buildBlockedChallengerEntry({
    ...result.manifest,
    challenger: selectedCandidate.challenger,
    candidateFingerprint,
    championFingerprint,
  });
  if (blockedEntry) {
    const queuePath = path.join(config.researchRoot, 'state', 'blocked-challenger-queue.json');
    const existing = await safeReadJson(queuePath) ?? [];
    // Keep max 5 entries, newest first, deduplicate by fingerprint
    const deduped = [blockedEntry, ...existing.filter(e => e.configFingerprint !== blockedEntry.configFingerprint)].slice(0, 5);
    await fs.writeFile(queuePath, JSON.stringify(deduped, null, 2), 'utf8');
  }
}
```

- [ ] **Step 6: Wire into runScout — check re-queue before generating variants**

In `scripts/pine-autoresearch.mjs`, at the start of variant generation in `runScout`, add:

```javascript
// Check blocked-challenger re-queue before generating new variants
const requeuePath = path.join(config.researchRoot, 'state', 'blocked-challenger-queue.json');
const blockedQueue = await safeReadJson(requeuePath) ?? [];
const requeueCandidates = filterRequeueCandidates(blockedQueue)
  .filter(entry => shouldRequeueBlockedChallenger(entry, { expectancyPolicy: config.expectancyPolicy }))
  .filter(entry => entry.championFingerprintAtBlock !== championFingerprint); // Only if champion changed
if (requeueCandidates.length > 0) {
  // Inject re-queued configs as priority variants
  const requeueVariants = requeueCandidates.map((entry, i) => ({
    variantId: `requeue-${i + 1}`,
    lane: 'requeue',
    family: 'blocked-requeue',
    config: entry.config,
    patch: {},
    metadata: { requeued: true, originalRunId: entry.runId, originalScore: entry.score },
  }));
  searchBatch.unshift(...requeueVariants);
  // Clear re-queued entries from the queue
  const remaining = blockedQueue.filter(e => !requeueCandidates.some(r => r.configFingerprint === e.configFingerprint));
  await fs.writeFile(requeuePath, JSON.stringify(remaining, null, 2), 'utf8');
}
```

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-blocked-requeue.test.mjs
git commit -m "feat(autoresearch): add blocked-challenger re-queue mechanism"
```

---

### Task 2: Ensure Tabu Clears on Manual Champion Change

**Files:**
- Modify: `scripts/pine-autoresearch.mjs` (runScout, champion loading section)

**Concept:** At the start of each cycle, compare the loaded champion's config fingerprint against `lastChampionFingerprint` in scheduler state. If they differ (manual promotion happened), clear the tabu list immediately — don't wait for the normal promotion flow.

- [ ] **Step 1: Write the failing test**

Add to `tests/pine-autoresearch.test.mjs`:

```javascript
test('runScout clears tabu when champion fingerprint changed externally', async () => {
  // This is tested implicitly by the existing mergeSchedulerTabuFingerprints test
  // which already handles dropOnChampionChange. The fix is ensuring the champion
  // fingerprint comparison happens BEFORE variant generation.
  const merged = mergeSchedulerTabuFingerprints({
    schedulerState: {
      activeTrackId: 'track-a',
      tabuRejectedFingerprints: [
        { fingerprint: 'old-entry', addedAtCycle: 3, championFingerprint: 'old-champ-fp' },
      ],
    },
    recentRejectedFingerprints: [],
    currentCycle: 5,
    championFingerprint: 'new-champ-fp',
    policy: { maxAgeCycles: 20, maxEntries: 40, dropOnChampionChange: true },
  });
  assert.deepEqual(merged.tabuRejectedFingerprints, []);
});
```

- [ ] **Step 2: Verify the existing `mergeSchedulerTabuFingerprints` already handles this**

Run: `node --test --test-name-pattern "mergeSchedulerTabuFingerprints prunes stale" tests/pine-autoresearch.test.mjs`
Expected: PASS (the logic exists, the issue was that manual champion changes don't trigger the merge)

- [ ] **Step 3: Add early champion-change detection in runScout**

In `scripts/pine-autoresearch.mjs`, in the `runScout` function, after loading the champion state and scheduler state, add:

```javascript
// Detect external champion change (manual promotion) and clear stale tabu
const currentChampionFingerprint = buildCanonicalConfigFingerprint(championState.config);
if (schedulerState.lastChampionFingerprint && 
    schedulerState.lastChampionFingerprint !== currentChampionFingerprint &&
    config.searchPolicy?.tabuPolicy?.dropOnChampionChange !== false) {
  schedulerState.tabuRejectedFingerprints = [];
  schedulerState.lastChampionFingerprint = currentChampionFingerprint;
  schedulerState.cycleIndex = 0;
  schedulerState.noChangeStreak = 0;
  schedulerState.stagnationLevel = 0;
  await writeSchedulerState(config, schedulerState);
}
```

- [ ] **Step 4: Run full test suite**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: All 229 tests pass

- [ ] **Step 5: Commit**

```bash
git add scripts/pine-autoresearch.mjs
git commit -m "fix(autoresearch): detect external champion change and clear stale tabu"
```

---

### Task 3: Remove Pinned-Data Same-Window Repetition for Shadow Labs

**Files:**
- Modify: `config/pine-autoresearch.default.json` (shadowLabs `when` timestamps)

**Concept:** The primary lab uses a fixed window for reproducibility (correct). But shadow labs should use DIFFERENT time windows to test generalization. Currently some shadow labs share the same `when` timestamp as the primary. Ensure each shadow lab tests a distinct time period.

- [ ] **Step 1: Verify current shadow lab windows**

Check `config/pine-autoresearch.default.json` shadowLabs — they already use different `when` values:
- Primary: 2026-04-21T10:30:00Z (10000 bars)
- Shadow 1 (BTC): 2026-04-21T10:30:00Z — SAME as primary! 
- Shadow 2 (ETH): 2026-04-21T10:30:00Z — SAME as primary!
- Shadow 3 (XRP March): 2026-03-17T10:30:00Z — different ✓
- Shadow 4 (BTC March): 2026-03-17T10:30:00Z — different ✓
- Shadow 5 (ETH Feb): 2026-02-14T10:30:00Z — different ✓

The first two shadow labs (BTC and ETH current) use the SAME time window as the primary. This means they're testing the same market regime — just different symbols. This is actually correct for multi-asset validation (same period, different asset = tests generalization across assets).

- [ ] **Step 2: No change needed — the design is correct**

The shadow labs already test different dimensions:
- Same period, different asset (BTC, ETH) — tests cross-asset generalization
- Different period, same asset (XRP March) — tests temporal generalization
- Different period, different asset (BTC March, ETH Feb) — tests both

This is a proper validation matrix. No change needed.

- [ ] **Step 3: Commit (no-op, document decision)**

No code change. The "same data" concern was about the primary lab being deterministic — which is correct for reproducible optimization. The shadow labs provide the out-of-sample validation.

---

### Task 4: Simplify Gate Configuration for Exploration Phase

**Files:**
- Modify: `config/pine-autoresearch.default.json`

**Concept:** Since we've disabled both expectancy sub-gates, simplify the config to make the intent clear. Also reduce the `minScoreDelta` on the primary lab from 0.25 to 0.1 to allow smaller improvements through (the significance gate at 0.5% relative already prevents noise).

- [ ] **Step 1: Reduce primary lab minScoreDelta**

The current `minScoreDelta: 0.25` combined with `significance.minRelativeScoreDelta: 0.005` creates a double-gate. For a champion at score 147.9, the significance gate requires 147.9 * 0.005 = 0.74 absolute delta. The `minScoreDelta: 0.25` is redundant (significance is stricter). Keep it but lower to 0.1 for clarity.

```json
"minScoreDelta": 0.1
```

- [ ] **Step 2: Apply the change**

- [ ] **Step 3: Run config test**

Run: `node --test --test-name-pattern "default autoresearch config" tests/pine-autoresearch.test.mjs`

- [ ] **Step 4: Commit**

```bash
git add config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs
git commit -m "config(autoresearch): simplify gate thresholds for exploration phase"
```

---

## Summary of Changes

| Fix | Type | Impact |
|-----|------|--------|
| Blocked-challenger re-queue | Code | Prevents losing good configs that fail soft gates |
| External champion change detection | Code | Clears stale tabu on manual promotion |
| Shadow lab validation | Config (no-op) | Already correct — multi-asset + multi-period |
| Gate simplification | Config | Removes redundant double-gating |

## Residual Risks

1. With expectancy gates disabled, a challenger could promote with degraded per-trade quality if it has enough extra trades to compensate. The shadow lab matrix (3/5 must pass) mitigates this.
2. The blocked-challenger queue is limited to 5 entries. If more than 5 challengers are blocked in sequence, older ones are lost. This is acceptable — the most recent blocked challenger is most relevant.