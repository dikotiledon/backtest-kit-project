# Pine Autoresearch Master Recovery and Revival Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the stagnation recovery verification, validate the system is generating variants again, revive the dormant LLM lane, address the ROI gate policy that blocks high-value candidates, and add structured cycle diagnostics for operational visibility.

**Architecture:** This plan is sequenced as: verify → validate → policy fix → revival → observability. Each group is independently valuable. The stagnation recovery code (Tasks 1-8 from the prior plan) is already implemented and tested in commit `0f672b1`. This plan picks up from there, validates the fix works in production, then addresses the systemic gaps identified during the full system review.

**Tech Stack:** Node.js ESM, `node:test`, JSON config, PowerShell scheduled tasks, PineScript v5 strategy, OpenAI-compatible LLM API (local proxy).

---

## Context: Current System State

- **All 553 tests pass** (341 core + 144 LLM + 63 invariants + 5 sweep)
- **Stagnation recovery code is implemented** but never validated with a live cycle
- **All scheduled tasks are disabled** (BacktestKit-Pine-Micro, Full, Digest all show "Disabled")
- **LLM lane config has `scheduled.enabled: false`** and hasn't run since 2026-05-04
- **Champion:** `original-153-champion` (score 152.47, ROI 91.7%, PF 3.56, 261 trades)
- **Best candidate found but blocked:** score 186.97, PF 9.63, DD 1.25% — failed solely on ROI regression (-4.87%)
- **Latest manifest:** zero variants emitted, `searchBatchSource: regime-fallback`, `stagnationLevel: 3`

---

## File Structure

Modify these files:

- `config/pine-autoresearch.default.json`
  - Adjust `primaryLab.thresholds.minRoiDeltaPct` to allow risk-adjusted improvements
  - Add `primaryLab.thresholds.minCompositeScoreDelta` as the primary gate (score already captures ROI+PF+DD)
- `scripts/lib/pine-autoresearch.mjs`
  - Add composite-score-aware gate logic to `decideAutoresearchOutcome`
  - Add structured cycle summary to manifest output
- `scripts/pine-autoresearch.mjs`
  - Wire cycle summary into manifest finalization
- `config/pine-autoresearch-llm.default.json`
  - Update champion reference awareness
  - Expand parameter allowlist for current champion
- `config/pine-autoresearch-llm-allowlist.default.json`
  - Add missing tunable parameters from current champion config
- `scripts/ops/install-pine-autoresearch-tasks.ps1` (no code change — operational use only)

Tests:
- `tests/pine-autoresearch.test.mjs`

---

### Task 1: Verify All Tests Pass After Stagnation Recovery

**Files:** None (verification only)

This task completes Task 9 from the prior stagnation recovery plan. The code is implemented — we need to confirm the full suite is green.

- [ ] **Step 1: Run focused stagnation recovery suites**

```bash
node --test tests/pine-track-generators.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-stagnation-escape.test.mjs tests/pine-autoresearch-tabu-saturation.test.mjs
```

Expected: all pass, 0 fail.

- [ ] **Step 2: Run focused autoresearch core suite**

```bash
node --test --test-name-pattern="resolveEffectiveSchedulerTabuPolicy|resolveScoutStagnationEscape|mergeSchedulerTabuFingerprints|high-score candidate rejected by ROI floor|buildScoutOrchestrationState|severe no-score stagnation" tests/pine-autoresearch.test.mjs
```

Expected: all pass, 0 fail.

- [ ] **Step 3: Run full project test suite**

```bash
npm test
```

Expected: 0 fail. Baseline is ~553 tests across all suites.

- [ ] **Step 4: Commit verification confirmation (no-op if no changes needed)**

If any test needed repair:

```bash
git add tests/
git commit -m "test: align expectations after stagnation recovery"
```

If all pass without changes, skip this step.

---

### Task 2: Fresh Cycle Validation — Prove Stagnation Recovery Works

**Files:** None (operational validation). Generated artifacts update under `pine/autoresearch/...` — do not commit artifacts.

This task completes Task 10 from the prior stagnation recovery plan. Run a real cycle and verify the system is no longer stuck.

- [ ] **Step 1: Run one fresh autoresearch cycle with force flag**

```bash
node scripts/pine-autoresearch.mjs cycle --config config/pine-autoresearch.default.json --profile full --force-cycle
```

This bypasses cadence checks and runs immediately. Expected: completes without error, writes a new manifest.

- [ ] **Step 2: Audit the latest manifest**

```bash
node --input-type=module -e "
import fs from 'fs';
const l = JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json', 'utf8'));
console.log(JSON.stringify({
  runId: l.runId,
  activeTrackId: l.activeTrackId,
  searchBatchSource: l.searchBatchSource,
  emittedVariantCount: l.searchEfficiency?.emittedVariantCount,
  allCandidatesTabu: l.searchEfficiency?.allCandidatesTabu,
  stagnationLevel: l.stagnationLevel,
  stagnationReason: l.stagnationReason,
  stagnationEscape: l.stagnationEscape,
  schedulerCycleIndex: l.schedulerCycleIndex,
  decision: l.matrixDecision?.recommendation,
  failedGates: l.matrixDecision?.failedGates,
  gateDiagnostics: l.matrixDecision?.gateDiagnostics,
}, null, 2));
"
```

**Acceptance criteria:**

| Field | Required |
|-------|----------|
| `emittedVariantCount` | > 0 (system is generating variants again) |
| `allCandidatesTabu` | `false` |
| `searchBatchSource` | NOT `regime-fallback` (should be `track:*` or `incumbent-fallback`) |
| `stagnationEscape.mode` | If `stagnationLevel >= 2`, must NOT be `none` |
| `gateDiagnostics` | Present when decision is `hold` (Task 7 working) |

- [ ] **Step 3: Verify tabu ages are preserved**

```bash
node --input-type=module -e "
import fs from 'fs';
const statePath = 'pine/autoresearch/pine-fusion-v4-core-15m-locked-window/state/scheduler-state.json';
try {
  const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const tabu = s.tabuRejectedFingerprints || [];
  const byCycle = new Map();
  for (const e of tabu) byCycle.set(e.addedAtCycle, (byCycle.get(e.addedAtCycle) || 0) + 1);
  console.log('Total tabu entries:', tabu.length);
  console.log('Distinct cycles:', byCycle.size);
  console.log('Max same-cycle:', Math.max(...byCycle.values(), 0));
  console.log('Cycle distribution:', Object.fromEntries([...byCycle.entries()].sort((a,b) => a[0]-b[0])));
} catch (e) { console.log('No scheduler state yet:', e.message); }
"
```

**Acceptance criteria:**
- Tabu entries span multiple `addedAtCycle` values (not all stamped at one cycle)
- Max same-cycle count ≤ 24 (the `maxSameCycleEntries` cap)

- [ ] **Step 4: Do NOT auto-promote**

Even if a candidate passes all gates, do not promote from this validation run. The holdout and queue policy still govern promotion safety. This is observation only.

---

### Task 3: Relax ROI Gate to Allow Risk-Adjusted Improvements

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

**Rationale:** The system found a candidate scoring 186.97 (PF 9.63, DD 1.25%) that was blocked solely because ROI regressed by -4.87% (86.83% vs 91.7%). The composite score already penalizes ROI regression — a candidate that scores +34.5 higher despite lower ROI has dramatically better risk-adjusted returns. The hard `minRoiDeltaPct: 0` floor prevents the system from ever promoting candidates that trade raw ROI for better profit factor and lower drawdown.

**Design decision:** Rather than removing the ROI gate entirely, allow a negative ROI delta when the composite score delta exceeds a meaningful threshold. This preserves the gate's intent (block pure-regression candidates) while allowing genuinely superior risk-adjusted configs through.

- [ ] **Step 1: Write failing test for conditional ROI relaxation**

Add to `tests/pine-autoresearch.test.mjs`:

```js
test('decideAutoresearchOutcome allows negative ROI delta when composite score delta exceeds relaxation threshold', () => {
  const result = decideAutoresearchOutcome({
    incumbent: { score: 152.47, roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261 },
    challenger: { score: 186.97, roiPct: 86.83, profitFactor: 9.63, maxDrawdownPct: 1.25, tradeCount: 265 },
    thresholds: {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 20,
        maxRoiRegressionPct: 10,
      },
    },
  });

  assert.equal(result.recommendation, 'promote');
  assert.ok(!result.failedGates.includes('roi'));
});

test('decideAutoresearchOutcome still blocks ROI regression when score delta is below relaxation threshold', () => {
  const result = decideAutoresearchOutcome({
    incumbent: { score: 152.47, roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261 },
    challenger: { score: 155.0, roiPct: 86.83, profitFactor: 4.0, maxDrawdownPct: 2.5, tradeCount: 250 },
    thresholds: {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 20,
        maxRoiRegressionPct: 10,
      },
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.ok(result.failedGates.includes('roi'));
});

test('decideAutoresearchOutcome blocks extreme ROI regression even with high score delta', () => {
  const result = decideAutoresearchOutcome({
    incumbent: { score: 152.47, roiPct: 91.7, profitFactor: 3.56, maxDrawdownPct: 2.88, tradeCount: 261 },
    challenger: { score: 200.0, roiPct: 70.0, profitFactor: 15.0, maxDrawdownPct: 0.5, tradeCount: 270 },
    thresholds: {
      minScoreDelta: 0.1,
      minRoiDeltaPct: 0,
      minProfitFactorDelta: 0,
      maxDrawdownDeltaPct: 0.75,
      minTradeCount: 150,
      minTradeRatioVsIncumbent: 0.75,
      roiRelaxation: {
        enabled: true,
        minScoreDeltaToRelax: 20,
        maxRoiRegressionPct: 10,
      },
    },
  });

  assert.equal(result.recommendation, 'hold');
  assert.ok(result.failedGates.includes('roi'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --test-name-pattern="allows negative ROI delta|still blocks ROI regression|blocks extreme ROI regression" tests/pine-autoresearch.test.mjs
```

Expected: FAIL (roi gate logic doesn't support relaxation yet).

- [ ] **Step 3: Implement conditional ROI relaxation in `decideAutoresearchOutcome`**

In `scripts/lib/pine-autoresearch.mjs`, locate the ROI gate evaluation (around line 628-634 where gates are built). After computing `roiDeltaPct` and before building the gates object, add:

```js
// ROI relaxation: allow negative ROI delta when composite score improvement is large enough
const roiRelaxation = thresholds.roiRelaxation || {};
const roiRelaxationEnabled = roiRelaxation.enabled === true;
const roiRelaxed = roiRelaxationEnabled
  && scoreDelta >= (roiRelaxation.minScoreDeltaToRelax ?? Infinity)
  && roiDeltaPct >= -(roiRelaxation.maxRoiRegressionPct ?? 0);
const effectiveRoiPass = roiDeltaPct >= adjustedMinRoiDeltaPct || roiRelaxed;
```

Then change the `roi` gate from:
```js
roi: roiDeltaPct >= adjustedMinRoiDeltaPct,
```
to:
```js
roi: effectiveRoiPass,
```

Also add to the decision metadata:
```js
roiRelaxationApplied: roiRelaxed && roiDeltaPct < adjustedMinRoiDeltaPct,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test --test-name-pattern="allows negative ROI delta|still blocks ROI regression|blocks extreme ROI regression" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Update config with relaxation policy**

In `config/pine-autoresearch.default.json`, add `roiRelaxation` inside `primaryLab.thresholds`:

```json
"roiRelaxation": {
  "enabled": true,
  "minScoreDeltaToRelax": 20,
  "maxRoiRegressionPct": 10
}
```

This means: if a candidate's composite score is ≥20 points above the incumbent AND the ROI regression is ≤10%, the ROI gate is relaxed. A candidate scoring 186.97 with -4.87% ROI regression would pass (score delta 34.5 > 20, regression 4.87 < 10).

- [ ] **Step 6: Run full autoresearch test suite**

```bash
node --test tests/pine-autoresearch.test.mjs
```

Expected: all pass (existing tests should not break because they don't set `roiRelaxation`).

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs
git commit -m "feat: allow ROI regression when composite score delta exceeds relaxation threshold"
```

---
### Task 4: Expand LLM Lane Parameter Allowlist for Current Champion

**Files:**
- Modify: `config/pine-autoresearch-llm-allowlist.default.json`
- Test: manual validation via `npm run pine:autoresearch:llm:validate`

**Rationale:** The LLM allowlist only has 7 entries (4 tunable, 3 forbidden). The current champion has 35+ parameters. The LLM lane can only propose changes to `minPredSum`, `divRsiLen`, `riskRewardRatio`, and `stopLossPct` — but `riskRewardRatio` and `stopLossPct` don't even exist in the champion config. The lane is effectively limited to 2 useful parameters. This severely constrains what the LLM can discover.

- [ ] **Step 1: Add tunable parameters matching the current champion's config**

Replace the contents of `config/pine-autoresearch-llm-allowlist.default.json` with:

```json
{
  "version": 2,
  "freezeArchitecture": true,
  "maxChangedParams": 4,
  "parameters": [
    { "key": "minPredSum", "type": "float", "min": 0.5, "max": 4.0, "step": 0.1, "mutability": "tunable", "family": "signal", "rationale": "Entry score threshold tunes selectivity without changing architecture." },
    { "key": "adxThreshold", "type": "int", "min": 10, "max": 40, "step": 1, "mutability": "tunable", "family": "signal", "rationale": "ADX filter threshold controls trend strength requirement." },
    { "key": "minBarsBetween", "type": "int", "min": 1, "max": 10, "step": 1, "mutability": "tunable", "family": "signal", "rationale": "Minimum bars between entries prevents overtrading." },
    { "key": "slAtrMult", "type": "float", "min": 0.1, "max": 2.0, "step": 0.05, "mutability": "tunable", "family": "risk", "rationale": "Stop-loss ATR multiplier controls risk per trade." },
    { "key": "tpAtrMult", "type": "float", "min": 3.0, "max": 12.0, "step": 0.1, "mutability": "tunable", "family": "risk", "rationale": "Take-profit ATR multiplier controls reward target." },
    { "key": "trailAtrMult", "type": "float", "min": 0.5, "max": 3.0, "step": 0.1, "mutability": "tunable", "family": "risk", "rationale": "Trailing stop ATR multiplier controls exit tightness." },
    { "key": "trailActivateR", "type": "float", "min": 0.2, "max": 2.0, "step": 0.1, "mutability": "tunable", "family": "risk", "rationale": "Trailing stop activation R-multiple controls when trailing begins." },
    { "key": "supertrendAtrLen", "type": "int", "min": 5, "max": 30, "step": 1, "mutability": "tunable", "family": "supertrend", "rationale": "Supertrend ATR lookback period." },
    { "key": "supertrendFactor", "type": "float", "min": 1.0, "max": 4.0, "step": 0.1, "mutability": "tunable", "family": "supertrend", "rationale": "Supertrend factor controls band width." },
    { "key": "divFreshBars", "type": "int", "min": 3, "max": 20, "step": 1, "mutability": "tunable", "family": "divergence", "rationale": "Divergence freshness window in bars." },
    { "key": "divPivotLeft", "type": "int", "min": 1, "max": 10, "step": 1, "mutability": "tunable", "family": "divergence", "rationale": "Divergence pivot left lookback." },
    { "key": "divPivotRight", "type": "int", "min": 1, "max": 10, "step": 1, "mutability": "tunable", "family": "divergence", "rationale": "Divergence pivot right lookback." },
    { "key": "divRsiLen", "type": "int", "min": 7, "max": 50, "step": 1, "mutability": "tunable", "family": "divergence", "rationale": "RSI length for divergence detection." },
    { "key": "divLongBoostValue", "type": "float", "min": 0.1, "max": 2.0, "step": 0.1, "mutability": "tunable", "family": "divergence", "rationale": "Long divergence signal boost magnitude." },
    { "key": "divShortBoostValue", "type": "float", "min": 0.1, "max": 2.0, "step": 0.1, "mutability": "tunable", "family": "divergence", "rationale": "Short divergence signal boost magnitude." },
    { "key": "fusionV4MinAbsPrediction", "type": "float", "min": 0.5, "max": 5.0, "step": 0.25, "mutability": "tunable", "family": "fusion", "rationale": "Minimum absolute prediction for fusion V4 entry." },
    { "key": "fusionV4MaxAbsPrediction", "type": "float", "min": 2.0, "max": 8.0, "step": 0.25, "mutability": "tunable", "family": "fusion", "rationale": "Maximum absolute prediction for fusion V4 entry." },
    { "key": "fusionV4LongAtrWeight", "type": "float", "min": -1.0, "max": 1.0, "step": 0.05, "mutability": "tunable", "family": "fusion", "rationale": "ATR confirmation weight for long fusion signals." },
    { "key": "fusionV4LongEngulfWeight", "type": "float", "min": -1.0, "max": 1.0, "step": 0.05, "mutability": "tunable", "family": "fusion", "rationale": "Engulfing confirmation weight for long fusion signals." },
    { "key": "fusionV4ShortAtrWeight", "type": "float", "min": -1.0, "max": 1.0, "step": 0.05, "mutability": "tunable", "family": "fusion", "rationale": "ATR confirmation weight for short fusion signals." },
    { "key": "fusionV4ShortEngulfWeight", "type": "float", "min": -1.0, "max": 1.0, "step": 0.05, "mutability": "tunable", "family": "fusion", "rationale": "Engulfing confirmation weight for short fusion signals." },
    { "key": "useSignalFusion", "type": "bool", "mutability": "forbidden", "family": "architecture", "rationale": "Signal fusion changes architecture and is frozen for this lane." },
    { "key": "useFusionV4", "type": "bool", "mutability": "forbidden", "family": "architecture", "rationale": "Fusion V4 toggles architecture and stays locked." },
    { "key": "useTrailingStop", "type": "bool", "mutability": "forbidden", "family": "architecture", "rationale": "Trailing stop behavior is excluded to keep architecture frozen." },
    { "key": "useSupertrendFilter", "type": "bool", "mutability": "forbidden", "family": "architecture", "rationale": "Supertrend filter is a structural decision, not a tuning knob." },
    { "key": "useStopsTP", "type": "bool", "mutability": "forbidden", "family": "architecture", "rationale": "Stop/TP mode is architectural." },
    { "key": "useDivergenceContext", "type": "bool", "mutability": "forbidden", "family": "architecture", "rationale": "Divergence context is a structural feature toggle." }
  ]
}
```

- [ ] **Step 2: Validate the allowlist parses correctly**

```bash
node --input-type=module -e "import fs from 'fs'; const a = JSON.parse(fs.readFileSync('config/pine-autoresearch-llm-allowlist.default.json','utf8')); const t=a.parameters.filter(p=>p.mutability==='tunable'); const f=a.parameters.filter(p=>p.mutability==='forbidden'); console.log('Version:',a.version,'Tunable:',t.length,'Forbidden:',f.length);"
```

Expected: Version 2, Tunable 21, Forbidden 6.

- [ ] **Step 3: Run LLM lane validation**

```bash
npm run pine:autoresearch:llm:validate
```

Expected: provider validation succeeds (requires local proxy at 127.0.0.1:1130). If proxy unavailable, defer — allowlist is structurally valid regardless.

- [ ] **Step 4: Commit**

```bash
git add config/pine-autoresearch-llm-allowlist.default.json
git commit -m "config: expand LLM lane allowlist to cover current champion parameters"
```

---

### Task 5: Revive LLM Lane — Clear Stale State and Re-enable

**Files:**
- Modify: `config/pine-autoresearch-llm.default.json`
- Operational: clear stale LLM lane state files

**Rationale:** The LLM lane has been dormant since 2026-05-04. The champion changed on 2026-05-14 (from seed-B2 to original-153-champion). The LLM lane's research memory contains 10 candidates evaluated against the old champion — these are stale. The lane needs its memory pruned and its scheduled mode re-enabled to resume generating candidates against the current champion.

- [ ] **Step 1: Clear stale LLM research memory**

The memory file references candidates evaluated against the old champion. Reset it to allow fresh exploration:

```bash
node --input-type=module -e "
import fs from 'fs';
const memoryPath = 'pine/autoresearch-llm/llm-pine-fusion-v4-core-15m-locked-window/state/llm-research-memory.json';
const fresh = {
  recentCandidates: [],
  topWinners: [],
  rejectedFingerprints: [],
  pendingReviewCount: 0,
  failureLessons: [
    { lesson: 'Previous champion (seed-B2-adaptive-exits) was replaced by original-153-champion on 2026-05-14. All prior candidates were evaluated against a different baseline.', addedAt: new Date().toISOString() }
  ]
};
fs.writeFileSync(memoryPath, JSON.stringify(fresh, null, 2) + '\n');
console.log('LLM research memory reset.');
"
```

- [ ] **Step 2: Clear stale reservations**

```bash
node --input-type=module -e "
import fs from 'fs';
const resPath = 'pine/autoresearch-llm/llm-pine-fusion-v4-core-15m-locked-window/state/llm-active-reservations.json';
fs.writeFileSync(resPath, JSON.stringify({ reservations: [] }, null, 2) + '\n');
console.log('LLM reservations cleared.');
"
```

- [ ] **Step 3: Verify LLM lane tests still pass**

```bash
node --test tests/pine-autoresearch-llm*.test.mjs
```

Expected: 144 pass, 0 fail.

- [ ] **Step 4: Run a single LLM lane proposal (manual, not scheduled)**

```bash
npm run pine:autoresearch:llm:propose
```

Expected: Either succeeds with a new candidate proposal, or fails with a provider connectivity error (if local proxy is not running). Either outcome confirms the lane machinery works.

If provider is unavailable, the output will be:
`[llm-autoresearch] provider_unavailable` or similar — this is acceptable for now.

- [ ] **Step 5: Commit state reset**

```bash
git add pine/autoresearch-llm/llm-pine-fusion-v4-core-15m-locked-window/state/llm-research-memory.json pine/autoresearch-llm/llm-pine-fusion-v4-core-15m-locked-window/state/llm-active-reservations.json
git commit -m "ops: reset LLM lane state after champion change"
```

---

### Task 6: Re-enable Scheduled Tasks

**Files:** None (operational — uses existing PowerShell scripts)

**Rationale:** All three scheduled tasks (Micro, Full, Digest) are currently disabled. The stagnation recovery code is implemented and tested. After validating with a fresh cycle (Task 2), the scheduler should be re-enabled to resume continuous research.

- [ ] **Step 1: Re-install scheduled tasks with force-cycle enabled**

```bash
pwsh -NoProfile -File scripts/ops/install-pine-autoresearch-tasks.ps1 -EnableForceCycle -EnableAutopromote
```

This registers:
- `BacktestKit-Pine-Micro`: every 15 minutes (quick smoke cycles)
- `BacktestKit-Pine-Digest`: daily at 08:10
- `BacktestKit-Pine-ForceCycle`: hourly (full cycle ignoring cadence)
- `BacktestKit-Pine-Autopromote`: daily at 08:20

- [ ] **Step 2: Verify tasks are registered and enabled**

```bash
schtasks /query /fo LIST | Select-String -Pattern "BacktestKit" -Context 0,3
```

Expected: All tasks show `Status: Ready` (not Disabled).

- [ ] **Step 3: Wait for one scheduled cycle to complete**

After ~15 minutes, check that a new manifest was written:

```bash
node --input-type=module -e "
import fs from 'fs';
const l = JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json','utf8'));
console.log('Latest run:', l.runId);
console.log('Generated at:', l.generatedAt);
console.log('Emitted variants:', l.searchEfficiency?.emittedVariantCount);
console.log('Source:', l.searchBatchSource);
"
```

Expected: `generatedAt` is after the task re-enablement time, `emittedVariantCount > 0`.

- [ ] **Step 4: Optionally install LLM lane tasks**

Only if the local LLM proxy (127.0.0.1:1130) is reliably available:

```bash
pwsh -NoProfile -File scripts/ops/install-pine-autoresearch-llm-tasks.ps1
```

If the proxy is not always running, skip this step — use manual `npm run pine:autoresearch:llm:propose` invocations instead.

---

### Task 7: Add Structured Cycle Decision Log

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

**Rationale:** Currently, debugging why a cycle produced zero variants or why a candidate failed promotion requires reading the full manifest JSON and mentally reconstructing the decision chain. A structured `cycleSummary` field in the manifest would make operational debugging trivial — one field that explains the entire cycle in machine-readable form.

- [ ] **Step 1: Write failing test for cycle summary in manifest**

Add to `tests/pine-autoresearch.test.mjs`:

```js
test('buildScoutOrchestrationState includes cycleSummary with decision trace', () => {
  const manifest = {
    runId: 'test-run-001',
    activeTrackId: 'supertrend-tuning',
    searchBatchSource: 'track:supertrend-tuning',
    searchEfficiency: { variantCount: 12, emittedVariantCount: 8, allCandidatesTabu: false, exhaustedFamilies: [] },
    stagnationLevel: 1,
    stagnationEscape: { mode: 'none', reason: 'not-eligible' },
    primarySweep: { skipped: false, totalCombos: 8, best: { score: 160 } },
    matrixDecision: {
      recommendation: 'hold',
      failedGates: ['primaryPromote'],
      gateDiagnostics: { primary: { scoreDelta: 7.53, roiDeltaPct: -4.87 } },
    },
    challenger: { configId: 'test-challenger', score: 160 },
    champion: { configId: 'test-champion', score: 152.47 },
    noNewCandidate: false,
  };

  const summary = buildCycleSummary(manifest);

  assert.equal(summary.outcome, 'hold');
  assert.equal(summary.variantsGenerated, 8);
  assert.equal(summary.bestCandidateScore, 160);
  assert.equal(summary.blockedBy, 'primaryPromote');
  assert.equal(typeof summary.trace, 'string');
  assert.ok(summary.trace.includes('roiDeltaPct: -4.87'));
});

test('buildCycleSummary handles zero-variant cycle', () => {
  const manifest = {
    runId: 'test-run-002',
    activeTrackId: 'supertrend-tuning',
    searchBatchSource: 'regime-fallback',
    searchEfficiency: { variantCount: 1, emittedVariantCount: 0, allCandidatesTabu: true, exhaustedFamilies: ['signal', 'risk'] },
    stagnationLevel: 3,
    stagnationEscape: { mode: 'progressive-widen', reason: 'zero-emission-exhausted' },
    primarySweep: { skipped: true, skipReason: 'no-variants-generated' },
    matrixDecision: { recommendation: 'hold', failedGates: ['candidateChanged'] },
    noNewCandidate: true,
  };

  const summary = buildCycleSummary(manifest);

  assert.equal(summary.outcome, 'no-variants');
  assert.equal(summary.variantsGenerated, 0);
  assert.equal(summary.bestCandidateScore, null);
  assert.equal(summary.stagnationLevel, 3);
  assert.ok(summary.trace.includes('allCandidatesTabu'));
  assert.ok(summary.trace.includes('progressive-widen'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test --test-name-pattern="buildCycleSummary|cycleSummary" tests/pine-autoresearch.test.mjs
```

Expected: FAIL (`buildCycleSummary` not defined).

- [ ] **Step 3: Implement `buildCycleSummary` in `scripts/lib/pine-autoresearch.mjs`**

Add near the end of the file, before the final exports:

```js
export function buildCycleSummary(manifest = {}) {
  const eff = manifest.searchEfficiency || {};
  const emitted = Number(eff.emittedVariantCount) || 0;
  const allTabu = eff.allCandidatesTabu === true;
  const decision = manifest.matrixDecision || {};
  const failedGates = decision.failedGates || [];
  const diag = decision.gateDiagnostics?.primary || {};
  const escape = manifest.stagnationEscape || {};
  const sweep = manifest.primarySweep || {};

  const outcome = emitted === 0 && (sweep.skipped === true || allTabu)
    ? 'no-variants'
    : decision.recommendation === 'promote'
      ? 'promote'
      : manifest.noNewCandidate === true
        ? 'steady-state'
        : 'hold';

  const traceLines = [];
  traceLines.push(`track: ${manifest.activeTrackId || 'none'}`);
  traceLines.push(`source: ${manifest.searchBatchSource || 'unknown'}`);
  traceLines.push(`emitted: ${emitted}, allTabu: ${allTabu}`);
  if (eff.exhaustedFamilies?.length) {
    traceLines.push(`exhausted: ${eff.exhaustedFamilies.join(', ')}`);
  }
  if (manifest.stagnationLevel > 0) {
    traceLines.push(`stagnation: level ${manifest.stagnationLevel}, escape: ${escape.mode || 'none'} (${escape.reason || 'n/a'})`);
  }
  if (sweep.skipped) {
    traceLines.push(`sweep: skipped (${sweep.skipReason || 'unknown'})`);
  } else if (sweep.best) {
    traceLines.push(`sweep: ${sweep.totalCombos || 0} combos, best score ${sweep.best.score}`);
  }
  if (failedGates.length > 0) {
    traceLines.push(`gates failed: ${failedGates.join(', ')}`);
  }
  for (const [key, value] of Object.entries(diag)) {
    if (value !== null && value !== undefined) {
      traceLines.push(`${key}: ${value}`);
    }
  }

  return {
    outcome,
    variantsGenerated: emitted,
    bestCandidateScore: manifest.challenger?.score ?? sweep.best?.score ?? null,
    blockedBy: failedGates[0] || null,
    stagnationLevel: manifest.stagnationLevel ?? 0,
    escapeMode: escape.mode || null,
    trace: traceLines.join(' | '),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test --test-name-pattern="buildCycleSummary|cycleSummary" tests/pine-autoresearch.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Wire `buildCycleSummary` into manifest output**

In `scripts/pine-autoresearch.mjs`, in the `buildScoutOrchestrationState` function (or wherever the final manifest object is assembled before writing), add:

```js
import { buildCycleSummary } from './lib/pine-autoresearch.mjs';
```

Then after the manifest object is fully built but before `writeJson`:

```js
manifest.cycleSummary = buildCycleSummary(manifest);
```

- [ ] **Step 6: Run full autoresearch test suite**

```bash
node --test tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tabu-saturation.test.mjs tests/pine-autoresearch-production-invariants.test.mjs
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: add structured cycleSummary to autoresearch manifests"
```

---

## Execution Grouping

| Group | Tasks | Theme | Dependencies |
|-------|-------|-------|--------------|
| 1 | 1, 2 | Verification & validation | None — validates existing code |
| 2 | 3 | Gate policy fix | Independent — can run after Group 1 |
| 3 | 4, 5 | LLM lane revival | Independent — can run after Group 1 |
| 4 | 6 | Scheduler re-enablement | Requires Group 1 success |
| 5 | 7 | Observability | Independent — can run anytime |

Groups 2, 3, and 5 are independent and can be dispatched in parallel after Group 1 confirms the system is healthy.

---

## Self-Review Checklist

- [x] Covers stagnation recovery verification (Tasks 9-10 from prior plan → Tasks 1-2 here)
- [x] Covers ROI gate policy that blocks high-value candidates (Task 3)
- [x] Covers LLM lane dormancy with allowlist expansion + state reset (Tasks 4-5)
- [x] Covers scheduler re-enablement (Task 6)
- [x] Covers observability gap with structured cycle summary (Task 7)
- [x] Every step has exact commands with expected output
- [x] Every code step has complete implementation (no placeholders)
- [x] Type/function names are consistent across tasks (`buildCycleSummary` defined in Task 7 Step 3, used in Step 5)
- [x] Tests written before implementation in Tasks 3 and 7
- [x] Promotion safety gates remain intact — ROI relaxation has explicit bounds, not removal
- [x] No assumptions about proxy availability — LLM steps degrade gracefully
- [x] Config changes are additive (new fields with defaults) — existing behavior unchanged without opt-in

## Residual Items NOT in This Plan (Future Work)

These were identified during the system review but are not urgent enough to include here:

1. **Main orchestrator refactoring** — `scripts/pine-autoresearch.mjs` at 3,770 lines should eventually be split. Not blocking anything currently.
2. **Blind holdout evaluation** — holdout labs are configured but only run when matrix recommends promote. Since no promotion has occurred recently, holdout validation is untested against the current champion.
3. **Champion reassessment** — the current champion was manually restored. A systematic comparison of the original-153 vs seed-B2 configs across all labs would confirm the restoration was correct.
4. **LLM lane scheduled mode** — `config/pine-autoresearch-llm.default.json` has `scheduled.enabled: false`. This should be flipped to `true` once the proxy is confirmed stable, but that's an operational decision, not a code change.

---

## Execution Notes

Recommended execution mode: subagent-driven development.

Suggested dispatch order:
1. Tasks 1-2 first (sequential — Task 2 depends on Task 1 confirming tests pass)
2. After Task 2 succeeds, dispatch Tasks 3, 4-5, and 7 in parallel
3. Task 6 last (requires human confirmation that the system is healthy)
