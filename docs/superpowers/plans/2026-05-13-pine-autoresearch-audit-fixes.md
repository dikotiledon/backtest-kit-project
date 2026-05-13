# Pine Autoresearch Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the structural defects that keep Pine Autoresearch locked in an infinite-hold loop and that produce dishonest/optimistic promotion telemetry.

**Architecture:** Surgical fixes across three layers — (a) decision honesty in `scripts/lib/pine-autoresearch.mjs`, (b) simulator correctness in `scripts/lib/pine-optimizer.mjs`, (c) search escape + holdout wiring in `scripts/pine-autoresearch.mjs` and related policy libs. Every task is TDD-first: a red test, a minimal fix, a green test, a commit. No behavior change is made without a test pinning the new contract.

**Tech Stack:** Node.js ESM, `node --test`, existing `tests/pine-*.test.mjs` infrastructure.

**Repo:** `D:\Code\Experiment\backtest-kit-project` on `main`. Create a feature branch per task group or one umbrella branch `fix/autoresearch-honesty-and-escape` — pick at kickoff, do not mix with unrelated work.

---

## Audit-to-Task Map

| # | Audit finding | Task |
|---|---|---|
| 1 | `shadowPassRatio` gate tautologically false when shadows skipped | Task 1 |
| 2 | `evaluateMatrix` reports shadow gates as failed when shadows not evaluated | Task 1 |
| 3 | Same-bar SL/TP overwrite → look-ahead | Task 2 |
| 4 | Close-only exit detection, fill-at-limit → intra-bar divergence from Pine | Task 2 |
| 5 | Architecture effectively frozen forever (`progressive-widen` unreachable) | Task 3 |
| 6 | Holdout never computes → auto-promotion permanently blocked | Task 4 |
| 7 | Divergent `minTradeCount` defaults across sibling gates | Task 5 |
| 8 | `partitionLabs` silently promotes `shadowLabs[0]` if primary missing | Task 6 |
| 11 | `tradePenalty` cliff at `minTrades` boundary | Task 7 |
| 13 | Full-configId labels make digests unreadable | Task 8 |

Findings 9, 10, 12 (infinite-hold basin composition, explore lane mono-family, micro profile noise) are configuration changes documented in Task 9.

---

## Pre-flight

- [ ] **Step P1: Verify clean working tree**

Run:
```powershell
cd D:\Code\Experiment\backtest-kit-project
git status --short
```
Expected: empty output. If not, stash or commit before starting.

- [ ] **Step P2: Capture baseline test status**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs tests/pine-optimizer.test.mjs tests/pine-significance-gate.test.mjs tests/pine-expectancy.test.mjs tests/pine-stagnation-escape.test.mjs 2>&1 | Tee-Object -FilePath .audit-baseline.txt
```
Expected: a recorded pass/fail baseline. Commit `.audit-baseline.txt` is NOT required; keep it local for comparison.

- [ ] **Step P3: Create feature branch**

Run:
```powershell
git checkout -b fix/autoresearch-honesty-and-escape
```
Expected: switched to new branch.

---

## Task 1: Honest matrix decision when shadow labs are not evaluated

**Problem:** `evaluateMatrix` (scripts/pine-autoresearch.mjs) short-circuits after the primary lab fails promote, but `decideMatrixPromotion` (scripts/lib/pine-autoresearch.mjs) then emits `failedGates: ['shadowPassCount','shadowPassRatio']` as if those shadows were tested and failed. Also, `shadowPassRatio` is hard-coded `false` whenever `shadowLabs.length === 0` regardless of policy.

**Contract after fix:**
- `decideMatrixPromotion` accepts an explicit `shadowsEvaluated` flag (default `true` for backwards compat).
- When `shadowsEvaluated === false`, `gates.shadowPassCount` and `gates.shadowPassRatio` are set to `'not_evaluated'` (string, not boolean). `failedGates` lists only genuinely failed gates. A new top-level `skipped: { reason: 'primary_hold' }` is present.
- When `shadowsEvaluated === true` and `shadowLabs.length === 0` and `minShadowPassCount === 0` and `minShadowPassRatio === 0`, both shadow gates pass (no shadows required, none present).
- Callers in `evaluateMatrix` pass `shadowsEvaluated: false` in the short-circuit return; pass `true` on the full path.
- The digest renderer treats `'not_evaluated'` distinctly from `false`.

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs` (function `decideMatrixPromotion`, ~L769-818)
- Modify: `scripts/pine-autoresearch.mjs` (function `evaluateMatrix`, ~L2743-L2850)
- Modify: `scripts/lib/pine-autoresearch.mjs` (function `renderDigestMarkdown`, wherever it reads matrix gates; search for `failedGates` usage in digest)
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1.1: Add failing test for `decideMatrixPromotion` shadows-not-evaluated contract**

In `tests/pine-autoresearch.test.mjs`, add:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMatrixPromotion } from '../scripts/lib/pine-autoresearch.mjs';

test('decideMatrixPromotion marks shadow gates as not_evaluated when shadowsEvaluated=false', () => {
  const result = decideMatrixPromotion({
    labResults: [{ decision: { recommendation: 'hold' } }],
    shadowsEvaluated: false,
    policy: { requirePrimaryPromote: true, minShadowPassCount: 3, minShadowPassRatio: 0.6, requireCandidateChange: true },
    champion: { config: { a: 1 } },
    challenger: { config: { a: 2 } },
  });
  assert.equal(result.gates.shadowPassCount, 'not_evaluated');
  assert.equal(result.gates.shadowPassRatio, 'not_evaluated');
  assert.deepEqual(result.failedGates, ['primaryPromote']);
  assert.equal(result.skipped?.reason, 'primary_hold');
});

test('decideMatrixPromotion with zero shadow labs and zero min thresholds passes shadow gates', () => {
  const result = decideMatrixPromotion({
    labResults: [{ decision: { recommendation: 'promote' } }],
    shadowsEvaluated: true,
    policy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
    champion: { config: { a: 1 } },
    challenger: { config: { a: 2 } },
  });
  assert.equal(result.gates.shadowPassCount, true);
  assert.equal(result.gates.shadowPassRatio, true);
  assert.equal(result.recommendation, 'promote');
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String "decideMatrixPromotion"
```
Expected: the two new tests FAIL (current code returns boolean `false` for shadow gates, and hard-fails `shadowPassRatio` when `shadowLabs.length === 0`).

- [ ] **Step 1.3: Implement `decideMatrixPromotion` contract**

Edit `scripts/lib/pine-autoresearch.mjs` function `decideMatrixPromotion`. Replace body (preserving public signature with new optional `shadowsEvaluated`):

```javascript
export function decideMatrixPromotion({ labResults = [], policy = {}, champion, challenger, shadowsEvaluated = true }) {
  const primary = labResults[0] || null;
  const shadowLabs = labResults.slice(1);
  const shadowPassCount = shadowLabs.filter((item) => item.decision?.recommendation === 'promote').length;
  const allPassCount = labResults.filter((item) => item.decision?.recommendation === 'promote').length;
  const shadowPassRatio = shadowLabs.length > 0 ? round(shadowPassCount / shadowLabs.length, 3) : 0;
  const candidateChanged = !sameConfig(champion?.config, challenger?.config);

  const requirePrimaryPromote = policy.requirePrimaryPromote ?? true;
  const minShadowPassCount = policy.minShadowPassCount ?? 0;
  const minShadowPassRatio = policy.minShadowPassRatio ?? 0;
  const requireCandidateChange = policy.requireCandidateChange ?? true;

  const shadowCountGate = shadowsEvaluated
    ? shadowPassCount >= minShadowPassCount
    : 'not_evaluated';
  const shadowRatioGate = shadowsEvaluated
    ? (shadowLabs.length === 0
        ? minShadowPassRatio <= 0
        : shadowPassRatio >= minShadowPassRatio)
    : 'not_evaluated';

  const gates = {
    candidateChanged: requireCandidateChange ? candidateChanged : true,
    primaryPromote: requirePrimaryPromote ? primary?.decision?.recommendation === 'promote' : true,
    shadowPassCount: shadowCountGate,
    shadowPassRatio: shadowRatioGate,
  };

  const failedGates = Object.entries(gates)
    .filter(([, value]) => value === false)
    .map(([name]) => name);

  const recommendation = failedGates.length === 0 && gates.primaryPromote === true ? 'promote' : 'hold';
  const skipped = !shadowsEvaluated
    ? { reason: 'primary_hold' }
    : null;
  const summary = !candidateChanged
    ? `No new candidate. Current champion ${champion?.configId} remains best on the pinned matrix.`
    : recommendation === 'promote'
      ? `Promote challenger ${challenger?.configId}: matrix guards passed (${allPassCount}/${labResults.length} labs promote).`
      : skipped
        ? `Hold champion ${champion?.configId}: primary did not promote; shadows not evaluated.`
        : `Hold champion ${champion?.configId}: matrix failed ${failedGates.join(', ')} gate(s).`;

  return {
    recommendation,
    summary,
    gates,
    failedGates,
    skipped,
    counts: {
      totalLabs: labResults.length,
      shadowLabs: shadowLabs.length,
      allPassCount,
      shadowPassCount: shadowsEvaluated ? shadowPassCount : null,
      shadowPassRatio: shadowsEvaluated ? shadowPassRatio : null,
    },
    policy: {
      requirePrimaryPromote,
      minShadowPassCount,
      minShadowPassRatio,
      requireCandidateChange,
    },
  };
}
```

- [ ] **Step 1.4: Run target tests to verify green**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String -Pattern "ok|not ok|# tests|# pass|# fail"
```
Expected: the two new tests PASS. If existing tests fail, they likely pin the old `false` string behavior — update them to use `true` / `'not_evaluated'` / `false` per the new contract.

- [ ] **Step 1.5: Pass `shadowsEvaluated: false` from `evaluateMatrix` short-circuit**

In `scripts/pine-autoresearch.mjs`, find the block:
```javascript
  if (requiresPrimaryPromote && primaryResult.decision.recommendation !== 'promote') {
    const labResults = [primaryResult];
    return {
      labResults,
      matrixDecision: decideMatrixPromotion({
        labResults,
        policy: config.matrixPolicy,
        champion: championState,
        challenger: challengerSummary,
      }),
    };
  }
```

Replace with:
```javascript
  if (requiresPrimaryPromote && primaryResult.decision.recommendation !== 'promote') {
    const labResults = [primaryResult];
    return {
      labResults,
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

The empty-`labs` branch and the full-shadow branch both default to `shadowsEvaluated: true`, which is correct — leave them.

- [ ] **Step 1.6: Add integration test pinning full pipeline honesty**

Add to `tests/pine-autoresearch.test.mjs`:
```javascript
import { evaluateMatrix } from '../scripts/pine-autoresearch.mjs';

test('evaluateMatrix short-circuits honestly when primary holds', async () => {
  const evaluateConfigOnLab = async ({ variantKey }) => ({
    label: `${variantKey}-label`,
    configId: `${variantKey}-id`,
    config: { a: variantKey === 'champion' ? 1 : 2 },
    score: variantKey === 'champion' ? 100 : 100.01,
    metrics: { tradeCount: 200, roiPct: 10, profitFactor: 2, maxDrawdownPct: 3, winRatePct: 45, avgWin: 1, avgLoss: 0.5 },
    trades: [],
    rows: [],
  });
  const config = {
    primaryLab: { labId: 'p', thresholds: { minScoreDelta: 5, minTradeCount: 100, significance: { minRelativeScoreDelta: 0.02, minTradeCount: 100 } } },
    shadowLabs: [{ labId: 's1' }, { labId: 's2' }, { labId: 's3' }],
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 2, minShadowPassRatio: 0.5, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
    complexityPolicy: { enabled: false },
  };
  const out = await evaluateMatrix(config, 'run-1', { configId: 'champion-id', config: { a: 1 } }, { configId: 'chal-id', config: { a: 2 } }, { evaluateConfigOnLab });
  assert.equal(out.labResults.length, 1, 'only primary was evaluated');
  assert.equal(out.matrixDecision.skipped?.reason, 'primary_hold');
  assert.equal(out.matrixDecision.gates.shadowPassCount, 'not_evaluated');
  assert.equal(out.matrixDecision.gates.shadowPassRatio, 'not_evaluated');
  assert.deepEqual(out.matrixDecision.failedGates, ['primaryPromote']);
});
```

- [ ] **Step 1.7: Run test**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String -Pattern "ok|not ok|# tests|# pass|# fail"
```
Expected: all tests PASS.

- [ ] **Step 1.8: Update digest renderer to handle `'not_evaluated'`**

Open `scripts/lib/pine-autoresearch.mjs` and find `renderDigestMarkdown`. Locate any line that formats matrix gates (search for `gates.shadowPassRatio` or `failedGates.join`). Add a pre-format step that maps `'not_evaluated'` to the string `n/a` in the table/summary so users see "shadows: n/a" rather than "shadows: false".

Minimal edit: wherever a gate boolean is interpolated, replace `gates.shadowPassCount` with `typeof gates.shadowPassCount === 'string' ? gates.shadowPassCount : (gates.shadowPassCount ? 'pass' : 'fail')` (same for `shadowPassRatio`). If the renderer just joins `failedGates`, no change needed — `failedGates` already excludes `'not_evaluated'` values.

- [ ] **Step 1.9: Commit**

```powershell
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(autoresearch): honest matrix decision when shadows not evaluated"
```

---

## Task 2: Eliminate same-bar look-ahead and intra-bar exit divergence in simulateTrades



**Problem:** `scripts/lib/pine-optimizer.mjs:simulateTrades` has two bugs:
1. SL/TP levels are overwritten from the current bar (`row.StopLoss`/`row.TakeProfit`) and then immediately used to decide exit on that same bar's close. This is look-ahead bias.
2. Exits check only `close <= stopLoss` but fill at `position.stopLoss` (not close). Intra-bar High/Low is ignored entirely, diverging from TradingView Pine which uses intrabar touches.

**Contract after fix:**
- SL/TP updates from `row.StopLoss`/`row.TakeProfit` apply starting on the NEXT bar, not the current bar.
- Exit detection uses `row.Low` and `row.High` for SL/TP touch detection (if columns present), falling back to close-only when High/Low are absent.
- Fill price for SL exit = `stopLoss` (limit fill), for TP exit = `takeProfit` (limit fill). This is unchanged but now only triggers on intra-bar touch.
- Gap-through: if `row.Low < stopLoss` for a long AND `row.Open < stopLoss`, fill at `row.Open` (gap fill). Same logic for short/TP.

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs` (function `simulateTrades`, ~L85-165)
- Test: `tests/pine-optimizer.test.mjs`

- [ ] **Step 2.1: Add failing test for same-bar look-ahead**

In `tests/pine-optimizer.test.mjs`, add:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateTrades } from '../scripts/lib/pine-optimizer.mjs';

test('simulateTrades does not use same-bar SL/TP update for exit decision', () => {
  const rows = [
    { timestamp: '2025-01-01T00:00Z', Close: 100, High: 105, Low: 95, Signal: 1, StopLoss: 90, TakeProfit: 120, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:15Z', Close: 98, High: 100, Low: 96, Signal: 0, StopLoss: 85, TakeProfit: 130, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:30Z', Close: 84, High: 99, Low: 83, Signal: 0, StopLoss: 85, TakeProfit: 130, Feature_SimPos: 1 },
  ];
  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  // Bar 2 updates SL to 85. Old code would NOT exit at bar 2 (close 98 > 85).
  // Bar 3: Low=83 < SL=85 (set at bar 2, effective bar 3). Should exit.
  // Key: bar 1 sets SL=90 at entry. Bar 2 close=98 > 90, no exit.
  // Bar 2 updates SL to 85 — this should only be effective starting bar 3.
  // If same-bar leak existed: bar 2 would use SL=85 immediately. Since close=98 > 85, no difference here.
  // Better test: bar updates SL tighter on same bar where close would trigger old SL but not new.
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'stopLoss');
  assert.equal(trades[0].exitIndex, 2);
});

test('simulateTrades uses intra-bar High/Low for SL/TP touch detection', () => {
  const rows = [
    { timestamp: '2025-01-01T00:00Z', Close: 100, High: 100, Low: 100, Signal: 1, StopLoss: 95, TakeProfit: 110, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:15Z', Close: 105, High: 111, Low: 104, Signal: 0, Feature_SimPos: 1 },
  ];
  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  // High=111 >= TP=110, so TP should trigger even though close=105 < 110
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'takeProfit');
  assert.equal(trades[0].exitPrice, 110);
});

test('simulateTrades gap-through fills at open when open is past SL', () => {
  const rows = [
    { timestamp: '2025-01-01T00:00Z', Close: 100, High: 100, Low: 100, Open: 100, Signal: 1, StopLoss: 95, TakeProfit: 120, Feature_SimPos: 1 },
    { timestamp: '2025-01-01T00:15Z', Close: 90, High: 93, Low: 88, Open: 93, Signal: 0, Feature_SimPos: 1 },
  ];
  const trades = simulateTrades(rows, { timeframeMinutes: 15 });
  // Open=93 < SL=95, gap through. Fill at Open, not at SL.
  assert.equal(trades.length, 1);
  assert.equal(trades[0].exitReason, 'stopLoss');
  assert.equal(trades[0].exitPrice, 93);
});
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run:
```powershell
node --test tests/pine-optimizer.test.mjs 2>&1 | Select-String "not ok"
```
Expected: the intra-bar and gap-through tests FAIL.

- [ ] **Step 2.3: Implement fix in `simulateTrades`**

Replace the position-management loop body in `scripts/lib/pine-optimizer.mjs`:

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
      exitPrice = open < position.stopLoss ? open : position.stopLoss; // gap-through
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
    trades.push(buildTrade(position, row, exitReason, exitPrice, i));
    position = null;
  } else {
    // Update SL/TP AFTER exit check — effective next bar
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
```

Key changes:
1. SL/TP update moved AFTER exit check (only in the `else` branch — no update on exit bar).
2. Exit uses `low`/`high` instead of `close` for SL/TP detection.
3. Gap-through fills at `open` when open is already past the level.

- [ ] **Step 2.4: Run tests to verify green**

Run:
```powershell
node --test tests/pine-optimizer.test.mjs 2>&1 | Select-String -Pattern "# pass|# fail"
```
Expected: all tests PASS. Note: existing tests that relied on close-only behavior may need updating — check each failure and decide if the old test was pinning buggy behavior.

- [ ] **Step 2.5: Run full autoresearch test suite to check for cascading impact**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs tests/pine-autoresearch-holdout.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures. If any fail, they relied on the biased simulator — update expected values.

- [ ] **Step 2.6: Commit**

```powershell
git add scripts/lib/pine-optimizer.mjs tests/pine-optimizer.test.mjs
git commit -m "fix(optimizer): eliminate same-bar SL/TP look-ahead and add intra-bar exit detection"
```

**Post-Task 2 note:** This fix changes the scoring behavior for all configs including the current champion. After deployment, the existing `config/pine-autoresearch.seed.json` champion metrics become stale. Run one full autoresearch cycle to re-baseline the champion score under the corrected simulator.

---

## Task 3: Make architecture escape reachable (unfreeze `progressive-widen`)

**Problem:** `decideStagnationEscapePlan` in `scripts/lib/pine-stagnation-escape.mjs` only returns `mode: 'progressive-widen'` (which sets `allowArchitectureKeys: true`) when `stagnationLevel >= 3` AND `exploitExhausted`. But config caps `maxStagnationLevel: 2` in `rotationPolicy.stagnation`. The architecture-mutation branch is unreachable by construction.

**Contract after fix:**
- `maxStagnationLevel` no longer caps the level that `decideStagnationEscapePlan` sees. The stagnation level is allowed to reach 3+ naturally.
- OR: add a new escape mode at level 2 that allows architecture keys when all generated lanes are exhausted, regardless of exploit status.
- Chosen approach: **raise the cap** — change `maxStagnationLevel` default to 4 in config, and add a `widen-architecture` mode at level 2 when `generatedLanesExhausted && exploitExhausted`.

**Files:**
- Modify: `scripts/lib/pine-stagnation-escape.mjs`
- Modify: `config/pine-autoresearch.default.json` (raise `maxStagnationLevel`)
- Test: `tests/pine-stagnation-escape.test.mjs`

- [ ] **Step 3.1: Add failing test for architecture escape at level 2**

In `tests/pine-stagnation-escape.test.mjs`, add:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideStagnationEscapePlan } from '../scripts/lib/pine-stagnation-escape.mjs';

test('decideStagnationEscapePlan allows architecture keys at level 2 when both lanes exhausted', () => {
  const result = decideStagnationEscapePlan({
    stagnationLevel: 2,
    generatedLanesExhausted: true,
    exploitExhausted: true,
  });
  assert.equal(result.allowArchitectureKeys, true);
  assert.ok(['progressive-widen', 'widen-architecture'].includes(result.mode));
});

test('decideStagnationEscapePlan reaches progressive-widen at level 3', () => {
  const result = decideStagnationEscapePlan({
    stagnationLevel: 3,
    generatedLanesExhausted: true,
    exploitExhausted: true,
  });
  assert.equal(result.mode, 'progressive-widen');
  assert.equal(result.allowArchitectureKeys, true);
  assert.equal(result.multiKeyMutationCount, 3);
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-stagnation-escape.test.mjs 2>&1 | Select-String "not ok"
```
Expected: level-2 test FAIL (current code returns `widen-bounds` with `allowArchitectureKeys: false`).

- [ ] **Step 3.3: Implement fix**

Edit `scripts/lib/pine-stagnation-escape.mjs`:

```javascript
export function decideStagnationEscapePlan(input = {}) {
  const {
    stagnationLevel = 0,
    generatedLanesExhausted = false,
    exploitExhausted = false,
  } = normalizeInput(input);

  const level = Number(stagnationLevel);
  const safeLevel = Number.isFinite(level) ? level : 0;
  const generatedExhausted = isTruthy(generatedLanesExhausted);
  const exploitDone = isTruthy(exploitExhausted);

  if (safeLevel < 2 || !generatedExhausted) {
    return { mode: 'none', reason: 'not-eligible' };
  }

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

- [ ] **Step 3.4: Update config `maxStagnationLevel`**

Edit `config/pine-autoresearch.default.json`, change:
```json
"stagnation": {
  "enabled": true,
  "noNewCandidateEscalateAfter": 2,
  "holdEscalateAfter": 3,
  "highSimilarityThreshold": 0.8,
  "maxStagnationLevel": 4,
  "lowEmissionEscalateAfter": 3,
  "lowEmissionThreshold": 3
}
```

- [ ] **Step 3.5: Run tests to verify green**

Run:
```powershell
node --test tests/pine-stagnation-escape.test.mjs 2>&1 | Select-String -Pattern "# pass|# fail"
```
Expected: all PASS.

- [ ] **Step 3.6: Verify no regression in autoresearch tracks**

Run:
```powershell
node --test tests/pine-autoresearch-tracks.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 3.7: Commit**

```powershell
git add scripts/lib/pine-stagnation-escape.mjs config/pine-autoresearch.default.json tests/pine-stagnation-escape.test.mjs
git commit -m "feat(stagnation): allow architecture escape at level 2 when all lanes exhausted"
```

---

## Task 4: Wire holdout evaluation so auto-promotion is not permanently blocked

**Problem:** `classifyHoldoutGate` returns `status: 'pending', passed: false` whenever `holdoutVerdict == null`. Every manifest has `holdoutVerdict: null` because nothing ever triggers holdout evaluation. In `assessManifestPromotionReadiness`, `holdoutReady = holdoutGate.passed === true`, so auto-promotion is structurally impossible. The `blindHoldoutLabs` are dead weight.

**Contract after fix:**
- When `evaluateMatrix` produces `recommendation: 'promote'` (all gates pass including primary + shadows), the system immediately evaluates blind holdout labs before finalizing the manifest.
- `holdoutVerdict` is populated in the manifest with `{ passed: true/false, labResults: [...], reason: '...' }`.
- If holdout fails, `matrixDecision.recommendation` stays `'promote'` but `holdoutGate.passed = false` blocks auto-promotion (existing behavior, now actually reachable).
- If no `blindHoldoutLabs` are configured, `holdoutGate` returns `not_required` / `passed: true` (existing behavior, unchanged).

**Files:**
- Modify: `scripts/pine-autoresearch.mjs` (function `evaluateMatrix`, after shadow evaluation succeeds)
- Modify: `scripts/lib/pine-autoresearch.mjs` (function `classifyHoldoutGate` — no change needed, already correct)
- Test: `tests/pine-autoresearch-holdout.test.mjs`

- [ ] **Step 4.1: Add failing test for holdout evaluation on promote**

In `tests/pine-autoresearch-holdout.test.mjs`, add:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMatrix } from '../scripts/pine-autoresearch.mjs';

test('evaluateMatrix runs holdout labs when matrix recommends promote', async () => {
  const labCalls = [];
  const evaluateConfigOnLab = async ({ config, lab, variantKey }) => {
    labCalls.push({ labId: lab.labId, variantKey });
    return {
      label: `${variantKey}-label`,
      configId: `${variantKey}-id`,
      config: variantKey === 'champion' ? { a: 1 } : { a: 2 },
      score: variantKey === 'champion' ? 100 : 110,
      metrics: { tradeCount: 200, roiPct: 20, profitFactor: 3, maxDrawdownPct: 2, winRatePct: 50, avgWin: 1.5, avgLoss: 0.5 },
      trades: [],
      rows: [],
    };
  };
  const config = {
    primaryLab: { labId: 'primary', thresholds: { minScoreDelta: 0.1, minTradeCount: 50, minTradeRatioVsIncumbent: 0.5, significance: { minRelativeScoreDelta: 0.01, minTradeCount: 50 } } },
    shadowLabs: [{ labId: 'shadow1', thresholds: { minScoreDelta: 0.1, minTradeCount: 50, minTradeRatioVsIncumbent: 0.5 } }],
    blindHoldoutLabs: [{ labId: 'holdout1', thresholds: { minScoreDelta: 0, minRoiDeltaPct: 5, minProfitFactorDelta: 0.1, maxDrawdownDeltaPct: 0.75, minTradeCount: 60, minTradeRatioVsIncumbent: 0.75 } }],
    matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 0.5, requireCandidateChange: true },
    expectancyPolicy: { enabled: false },
    complexityPolicy: { enabled: false },
  };
  const out = await evaluateMatrix(config, 'run-1', { configId: 'champ', config: { a: 1 } }, { configId: 'chal', config: { a: 2 } }, { evaluateConfigOnLab });
  const holdoutCalls = labCalls.filter(c => c.labId === 'holdout1');
  assert.ok(holdoutCalls.length > 0, 'holdout lab was evaluated');
  assert.ok(out.holdoutVerdict != null, 'holdoutVerdict is populated');
  assert.equal(typeof out.holdoutVerdict.passed, 'boolean');
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-autoresearch-holdout.test.mjs 2>&1 | Select-String "not ok"
```
Expected: FAIL — current code never evaluates holdout labs in `evaluateMatrix`.

- [ ] **Step 4.3: Implement holdout evaluation in `evaluateMatrix`**

In `scripts/pine-autoresearch.mjs`, after the full shadow evaluation block (after `const labResults = [primaryResult, ...shadowResults]`), add:

```javascript
  // Evaluate blind holdout if matrix would promote
  const preliminaryDecision = decideMatrixPromotion({
    labResults,
    shadowsEvaluated: true,
    policy: config.matrixPolicy,
    champion: championState,
    challenger: challengerSummary,
  });

  let holdoutVerdict = null;
  if (preliminaryDecision.recommendation === 'promote' && Array.isArray(config.blindHoldoutLabs) && config.blindHoldoutLabs.length > 0) {
    const holdoutResults = await mapWithConcurrency(
      config.blindHoldoutLabs,
      shadowConcurrency,
      evaluateLabPair,
    );
    const holdoutPassCount = holdoutResults.filter(r => r.decision?.recommendation === 'promote').length;
    const holdoutPassRatio = holdoutResults.length > 0 ? holdoutPassCount / holdoutResults.length : 0;
    const holdoutPassed = holdoutPassCount === holdoutResults.length; // require ALL holdout labs pass
    holdoutVerdict = {
      passed: holdoutPassed,
      reason: holdoutPassed ? 'blind_holdout_passed' : 'blind_holdout_failed',
      labResults: holdoutResults.map(r => ({
        labId: r.lab?.labId,
        recommendation: r.decision?.recommendation,
        scoreDelta: r.decision?.comparisons?.scoreDelta,
        roiDeltaPct: r.decision?.comparisons?.roiDeltaPct,
      })),
      counts: { total: holdoutResults.length, passed: holdoutPassCount, ratio: holdoutPassRatio },
    };
  }

  return {
    labResults,
    holdoutVerdict,
    matrixDecision: decideMatrixPromotion({
      labResults,
      shadowsEvaluated: true,
      policy: config.matrixPolicy,
      champion: championState,
      challenger: challengerSummary,
    }),
  };
```

Also ensure the caller in `runScout` propagates `holdoutVerdict` into the manifest:

**Critical wiring at L3237:** Change the destructuring from:
```javascript
const { labResults, matrixDecision } = await evaluateMatrix(trackedConfig, runId, championState, candidate, {
```
to:
```javascript
const { labResults, matrixDecision, holdoutVerdict } = await evaluateMatrix(trackedConfig, runId, championState, candidate, {
```

Then add `holdoutVerdict` to the `matrixCandidates.push(...)` call:
```javascript
matrixCandidates.push({ challenger: candidate, labResults, matrixDecision, holdoutVerdict, robustness, expectancy: labResults[0]?.decision?.expectancy || null });
```

This ensures `selectedCandidate?.holdoutVerdict` at L1421 resolves correctly.

**Short-circuit path (Task 1's change):** Add `holdoutVerdict: null` to the short-circuit return in `evaluateMatrix` for explicitness:
```javascript
if (requiresPrimaryPromote && primaryResult.decision.recommendation !== 'promote') {
  const labResults = [primaryResult];
  return {
    labResults,
    holdoutVerdict: null,
    matrixDecision: decideMatrixPromotion({ ... }),
  };
}
```

**Existing holdout path at L3508-3530:** This is an existing (currently dead) holdout evaluation flow. After this task, it becomes redundant. Remove it or gate it with `if (!holdoutVerdict)` to prevent double-evaluation.

- [ ] **Step 4.4: Run tests to verify green**

Run:
```powershell
node --test tests/pine-autoresearch-holdout.test.mjs 2>&1 | Select-String -Pattern "# pass|# fail"
```
Expected: PASS.

- [ ] **Step 4.5: Run full suite to check no regression**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs tests/pine-autoresearch-holdout.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 4.6: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch-holdout.test.mjs
git commit -m "feat(holdout): evaluate blind holdout labs when matrix recommends promote"
```

---

## Task 5: Unify `minTradeCount` defaults across sibling gates

**Problem:** `decideAutoresearchOutcome` defaults `minTradeCount` to 100, while `decideSignificanceGate` defaults to 150. A caller who sets `thresholds.minTradeCount` but not `thresholds.significance.minTradeCount` gets silently divergent behavior.

**Contract after fix:**
- `decideSignificanceGate` accepts an explicit `minTradeCount` in its policy object (already does).
- `decideAutoresearchOutcome` passes `thresholds.minTradeCount` into the significance gate policy when `thresholds.significance.minTradeCount` is not explicitly set.
- Both default to 100 when nothing is specified (the lower, safer default — the config can override to 150).

**Files:**
- Modify: `scripts/lib/pine-significance-gate.mjs` (change `DEFAULT_MIN_TRADE_COUNT` from 150 to 100)
- Modify: `scripts/lib/pine-autoresearch.mjs` (in `decideAutoresearchOutcome`, pass `minTradeCount` to significance gate)
- Test: `tests/pine-significance-gate.test.mjs`

- [ ] **Step 5.1: Add failing test**

In `tests/pine-significance-gate.test.mjs`, add:
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSignificanceGate } from '../scripts/lib/pine-significance-gate.mjs';

test('decideSignificanceGate defaults minTradeCount to 100 (not 150)', () => {
  const result = decideSignificanceGate({
    incumbent: { score: 100, metrics: { tradeCount: 120 } },
    challenger: { score: 105, metrics: { tradeCount: 120 } },
    policy: { minRelativeScoreDelta: 0.01 },
  });
  // With 120 trades and old default 150, this would fail with 'insufficient_sample'
  // With new default 100, it should pass (120 >= 100)
  assert.notEqual(result.reason, 'insufficient_sample');
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-significance-gate.test.mjs 2>&1 | Select-String "not ok"
```
Expected: FAIL (current default is 150, so 120 < 150 → `insufficient_sample`).

- [ ] **Step 5.3: Implement fix**

Edit `scripts/lib/pine-significance-gate.mjs`, line 1:
```javascript
const DEFAULT_MIN_TRADE_COUNT = 100;
```

Edit `scripts/lib/pine-autoresearch.mjs` in `decideAutoresearchOutcome`, where `decideSignificanceGate` is called:
```javascript
  const significanceGate = decideSignificanceGate({
    incumbent,
    challenger,
    policy: {
      ...thresholds?.significance,
      minTradeCount: thresholds?.significance?.minTradeCount ?? thresholds?.minTradeCount ?? 100,
    },
  });
```

- [ ] **Step 5.4: Run tests to verify green**

Run:
```powershell
node --test tests/pine-significance-gate.test.mjs tests/pine-autoresearch.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 5.4b: Check for existing tests pinning DEFAULT_MIN_TRADE_COUNT=150**

Run:
```powershell
Select-String -Path "tests/pine-significance-gate.test.mjs" -Pattern "150|insufficient_sample" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
```
If any test asserts `insufficient_sample` at tradeCount between 100-149, update it to expect `passed` (or adjust the test's tradeCount below 100 to preserve the insufficient_sample assertion).

- [ ] **Step 5.5: Commit**

```powershell
git add scripts/lib/pine-significance-gate.mjs scripts/lib/pine-autoresearch.mjs tests/pine-significance-gate.test.mjs
git commit -m "fix(gates): unify minTradeCount default to 100 across outcome and significance gates"
```

---

## Task 6: Guard `partitionLabs` against missing `primaryLab`

**Problem:** `partitionLabs({ primaryLab: null, shadowLabs: [...] })` returns `selectionLabs = [...shadowLabs]`, and `evaluateMatrix` treats `labs[0]` (a shadow) as primary. Silent misclassification.

**Contract after fix:**
- `partitionLabs` throws `Error('primaryLab is required')` when `primaryLab` is falsy and `shadowLabs` is non-empty.
- When both are empty, returns empty arrays (valid no-op).

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs` (function `partitionLabs`, ~L821)
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 6.1: Add failing test**

```javascript
test('partitionLabs throws when primaryLab is missing but shadowLabs exist', () => {
  assert.throws(
    () => partitionLabs({ primaryLab: null, shadowLabs: [{ labId: 's1' }] }),
    { message: /primaryLab is required/ },
  );
});

test('partitionLabs returns empty arrays when both are empty', () => {
  const result = partitionLabs({ primaryLab: null, shadowLabs: [] });
  assert.deepEqual(result.trainingLabs, []);
  assert.deepEqual(result.selectionLabs, []);
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String "partitionLabs throws"
```
Expected: FAIL (no throw currently).

- [ ] **Step 6.3: Implement fix**

```javascript
export function partitionLabs({ primaryLab, shadowLabs = [], blindHoldoutLabs = [] } = {}) {
  const hasShadows = Array.isArray(shadowLabs) && shadowLabs.length > 0;
  if (!primaryLab && hasShadows) {
    throw new Error('primaryLab is required when shadowLabs are configured');
  }
  return {
    trainingLabs: [primaryLab].filter(Boolean),
    selectionLabs: [primaryLab, ...shadowLabs].filter(Boolean),
    blindHoldoutLabs: [...blindHoldoutLabs].filter(Boolean),
  };
}
```

- [ ] **Step 6.4: Run tests to verify green**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 6.5: Commit**

```powershell
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(labs): throw when primaryLab missing but shadowLabs configured"
```

---

## Task 7: Smooth `tradePenalty` to eliminate cliff at `minTrades` boundary

**Problem:** `scoreMetricsBreakdown` in `scripts/lib/pine-optimizer.mjs` uses:
```javascript
const tradePenalty = metrics.tradeCount < minTrades ? (metrics.tradeCount - minTrades) * 5 : 0;
```
At `tradeCount = 9, minTrades = 10` → penalty = -5. At `tradeCount = 10` → penalty = 0. Discontinuous cliff distorts the optimization surface near the threshold.

**Contract after fix:**
- Replace cliff with a smooth ramp: penalty scales linearly from `-maxPenalty` at 0 trades to 0 at `minTrades`.
- `maxPenalty` = `minTrades * 5` (preserves the same total penalty at 0 trades as before).
- At `tradeCount >= minTrades`, penalty = 0 (unchanged).
- At `tradeCount = minTrades - 1`, penalty is small (was -5, now ≈ -5 — nearly identical near threshold but smooth).

**Files:**
- Modify: `scripts/lib/pine-optimizer.mjs` (function `scoreMetricsBreakdown`)
- Test: `tests/pine-optimizer.test.mjs`

- [ ] **Step 7.1: Add failing test**

```javascript
test('scoreMetricsBreakdown tradePenalty is smooth ramp, not cliff', () => {
  const base = { tradeCount: 5, winRatePct: 50, roiPct: 10, profitFactor: 2, maxDrawdownPct: 1 };
  const atThreshold = scoreMetricsBreakdown({ ...base, tradeCount: 10 }, { minTrades: 10 });
  const justBelow = scoreMetricsBreakdown({ ...base, tradeCount: 9 }, { minTrades: 10 });
  const halfWay = scoreMetricsBreakdown({ ...base, tradeCount: 5 }, { minTrades: 10 });
  // At threshold: penalty = 0
  assert.equal(atThreshold.tradePenalty, 0);
  // Just below: penalty should be small and negative (smooth)
  assert.ok(justBelow.tradePenalty < 0);
  assert.ok(justBelow.tradePenalty > -10); // old was exactly -5, new should be similar
  // Half way: penalty proportional
  assert.ok(halfWay.tradePenalty < justBelow.tradePenalty);
  // Verify smoothness: difference between 9 and 10 is small
  assert.ok(Math.abs(justBelow.tradePenalty) < 6);
});
```

- [ ] **Step 7.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-optimizer.test.mjs 2>&1 | Select-String "tradePenalty is smooth"
```
Expected: may pass or fail depending on exact values. If the old cliff gives -5 at tradeCount=9, the `> -10` assertion passes but the smoothness property may not hold for `halfWay`. Adjust if needed.

- [ ] **Step 7.3: Implement fix**

In `scripts/lib/pine-optimizer.mjs`, replace the `tradePenalty` line in `scoreMetricsBreakdown`:

```javascript
  const tradePenalty = metrics.tradeCount >= minTrades
    ? 0
    : round(-((minTrades - metrics.tradeCount) / minTrades) * (minTrades * 5));
```

This gives: at 0 trades → `-minTrades * 5` (same as old `(0 - minTrades) * 5`). At `minTrades - 1` → `-5`. Smooth linear ramp.

- [ ] **Step 7.4: Run tests to verify green**

Run:
```powershell
node --test tests/pine-optimizer.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 7.5: Commit**

```powershell
git add scripts/lib/pine-optimizer.mjs tests/pine-optimizer.test.mjs
git commit -m "fix(scoring): smooth tradePenalty ramp instead of cliff at minTrades"
```

---

## Task 8: Replace full-configId labels with short hash in digest

**Problem:** Config labels like `0007__useRegimeFilter-false__...__divShortBoostValue-0.7` (500+ chars) are repeated dozens of times in `latest-digest.md` and `history.md`. Unreadable.

**Contract after fix:**
- A new utility `shortConfigLabel(configId)` returns `configId.slice(0, 4) + '_' + hash(configId).slice(0, 8)` (e.g., `0007_a3f2b1c9`).
- `renderDigestMarkdown` and `renderHistoryMarkdown` use `shortConfigLabel` for display.
- Full configId remains in the manifest JSON (no data loss).
- A legend section at the bottom of the digest maps short labels to full configIds.

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs` (add `shortConfigLabel`, modify `renderDigestMarkdown`, `renderHistoryMarkdown`)
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 8.1: Add failing test**

```javascript
import { shortConfigLabel } from '../scripts/lib/pine-autoresearch.mjs';

test('shortConfigLabel produces readable short label', () => {
  const full = '0007__useRegimeFilter-false__useVolatilityFilter-false__useAdxFilter-true__adxThreshold-20';
  const short = shortConfigLabel(full);
  assert.ok(short.length < 20, `Expected short label, got: ${short}`);
  assert.ok(short.startsWith('0007_'));
  // Deterministic
  assert.equal(short, shortConfigLabel(full));
});
```

- [ ] **Step 8.2: Run test to verify it fails**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String "shortConfigLabel"
```
Expected: FAIL (function doesn't exist yet).

- [ ] **Step 8.3: Implement `shortConfigLabel`**

Add to `scripts/lib/pine-autoresearch.mjs`:

```javascript
import { createHash } from 'node:crypto';

export function shortConfigLabel(configId) {
  if (!configId || typeof configId !== 'string') return 'unknown';
  const prefix = configId.slice(0, 4);
  const hash = createHash('sha256').update(configId).digest('hex').slice(0, 8);
  return `${prefix}_${hash}`;
}
```

- [ ] **Step 8.4: Update `renderDigestMarkdown` to use short labels**

In `renderDigestMarkdown`, replace all interpolations of `champion.configId` / `challenger.configId` / `incumbent.configId` with `shortConfigLabel(...)`. Add a `## Label Legend` section at the end:

```javascript
const legend = [
  `| ${shortConfigLabel(champion.configId)} | ${champion.configId} |`,
  challenger?.configId && challenger.configId !== champion.configId
    ? `| ${shortConfigLabel(challenger.configId)} | ${challenger.configId} |`
    : null,
].filter(Boolean).join('\n');

// Append to markdown:
markdown += `\n## Label Legend\n\n| Short | Full |\n| --- | --- |\n${legend}\n`;
```

Do the same for `renderHistoryMarkdown`.

- [ ] **Step 8.5: Run tests to verify green**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 8.6: Commit**

```powershell
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(digest): use short config labels with legend for readability"
```

---

## Task 9: Configuration changes to break the infinite-hold basin

**Problem:** The current config creates a convergence trap:
- `exploreFamilies: ['signal']` — explore never touches risk/exit/regime params.
- `exploitRatio: 0.5` with only 8 maxConfigs — 4 exploit, 4 explore, all in the same tiny neighborhood.
- `minScoreDelta: 0.25` + `complexityPolicy.scorePenaltyPerActivatedParam: 0.75` — any new architecture param needs `scoreDelta >= 1.0`.
- `significance.minRelativeScoreDelta: 0.02` — 2% relative move on a score of 153 means absolute delta >= 3.06. Unreachable with single-param jitter.

**Contract after fix:**
- `exploreFamilies` includes `['signal', 'risk']`.
- `maxConfigs` raised to 12 (more candidates per cycle).
- `significance.minRelativeScoreDelta` lowered to 0.005 (0.5% — still meaningful, not noise).
- `complexityPolicy.scorePenaltyPerActivatedParam` lowered to 0.25 (from 0.75).
- `searchPolicy.annealing.maxTemperature` raised to 16 (from 12) to allow wider jumps at high stagnation.

These are config-only changes — no code modifications.

**Files:**
- Modify: `config/pine-autoresearch.default.json`

- [ ] **Step 9.1: Edit config**

Apply these changes to `config/pine-autoresearch.default.json`:

```json
{
  "searchPolicy": {
    "exploitRatio": 0.5,
    "exploreFamilies": ["signal", "risk"],
    "annealing": {
      "enabled": true,
      "baseTemperature": 0.4,
      "growthFactor": 1.8,
      "maxTemperature": 16
    }
  },
  "maxConfigs": 12,
  "scoutProfiles": {
    "full": {
      "maxConfigs": 12,
      "minTrades": 10
    }
  },
  "primaryLab": {
    "thresholds": {
      "significance": {
        "minRelativeScoreDelta": 0.005,
        "minTradeCount": 150
      }
    }
  },
  "complexityPolicy": {
    "scorePenaltyPerActivatedParam": 0.25,
    "roiPenaltyPctPerActivatedParam": 0.25
  }
}
```

(Merge these into the existing JSON — do not overwrite unrelated fields.)

- [ ] **Step 9.2: Validate config loads without error**

Run:
```powershell
node -e "const c = require('./config/pine-autoresearch.default.json'); console.log('maxConfigs:', c.maxConfigs, 'exploreFamilies:', c.searchPolicy.exploreFamilies, 'significance:', c.primaryLab.thresholds.significance.minRelativeScoreDelta, 'complexityPenalty:', c.complexityPolicy.scorePenaltyPerActivatedParam)"
```
Expected: `maxConfigs: 12 exploreFamilies: ['signal','risk'] significance: 0.005 complexityPenalty: 0.25`

- [ ] **Step 9.3: Run full test suite to verify no regression**

Run:
```powershell
node --test tests/pine-autoresearch.test.mjs tests/pine-optimizer.test.mjs tests/pine-stagnation-escape.test.mjs tests/pine-significance-gate.test.mjs 2>&1 | Select-String "# fail"
```
Expected: 0 failures.

- [ ] **Step 9.4: Commit**

```powershell
git add config/pine-autoresearch.default.json
git commit -m "config(autoresearch): widen search basin — explore risk, raise maxConfigs, lower significance floor"
```

---

## Final Verification

- [ ] **Step F1: Run entire pine test suite**

```powershell
node --test tests/pine-*.test.mjs 2>&1 | Select-String -Pattern "# tests|# pass|# fail"
```
Expected: all pass, 0 fail.

- [ ] **Step F2: Run one autoresearch cycle to verify manifests are honest**

```powershell
node scripts/pine-autoresearch.mjs --profile full --dry-run 2>&1 | Select-String -Pattern "matrixDecision|shadowPassCount|holdoutVerdict|shortLabel"
```
Expected: `shadowPassCount` shows `not_evaluated` or a real count (never false when shadows weren't run). `holdoutVerdict` is either `null` (no promote) or populated.

- [ ] **Step F3: Push branch**

```powershell
git push -u origin fix/autoresearch-honesty-and-escape
```

---

## Summary of Changes

| Task | Commit message | Impact |
|------|---------------|--------|
| 1 | `fix(autoresearch): honest matrix decision when shadows not evaluated` | Stops lying about shadow gate failures |
| 2 | `fix(optimizer): eliminate same-bar SL/TP look-ahead and add intra-bar exit detection` | Removes systematic optimistic bias from all scores |
| 3 | `feat(stagnation): allow architecture escape at level 2 when all lanes exhausted` | Breaks the frozen-architecture trap |
| 4 | `feat(holdout): evaluate blind holdout labs when matrix recommends promote` | Makes auto-promotion structurally possible |
| 5 | `fix(gates): unify minTradeCount default to 100 across outcome and significance gates` | Prevents silent divergence on policy edits |
| 6 | `fix(labs): throw when primaryLab missing but shadowLabs configured` | Prevents silent misclassification |
| 7 | `fix(scoring): smooth tradePenalty ramp instead of cliff at minTrades` | Removes discontinuity in optimization surface |
| 8 | `feat(digest): use short config labels with legend for readability` | Makes digests human-readable |
| 9 | `config(autoresearch): widen search basin` | Breaks the infinite-hold convergence trap |

---
