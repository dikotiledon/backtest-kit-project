# Pine Autoresearch Alpha Discovery Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current Pine autoresearch loop from a safe incumbent-local optimizer into a true alpha-discovery system that can produce structurally different challengers, systematically research exit-state behavior, validate long/short asymmetry, and protect expectancy from fake win-rate improvements.

**Architecture:** Keep `pine/test.pine` as the only runtime Pine source of truth. Refactor scheduler-side research planning so each track owns a distinct candidate generator, rotation is enforced by hard eviction rules, exit-state hypotheses are researched as first-class tracks, and promotion logic uses expectancy-aware gates instead of surface-level win-rate improvement. Preserve the current manifest/digest/history artifact flow so future session agents can recover full state from files instead of chat memory.

**Tech Stack:** Node.js, JSON config, Pine Script v5, `node:test`, existing Pine sweep/import tooling, markdown reports under `report/`, persisted scheduler/champion state under `pine/autoresearch/`.

---

## 0. Context lock — read this first

This roadmap is intentionally self-contained. Any future session agent should treat the points below as the minimum required context before touching code.

### Verified current repo state
- Runtime Pine file: `pine/test.pine`
- Scheduler entry point: `scripts/pine-autoresearch.mjs`
- Scheduler helpers: `scripts/lib/pine-autoresearch.mjs`
- Search batch builder: `scripts/lib/pine-search-policy.mjs`
- Track state helpers: `scripts/lib/pine-autoresearch-tracks.mjs`
- Tuner/grid logic: `scripts/lib/pine-tuner.mjs`
- Primary tests: `tests/pine-autoresearch.test.mjs`, `tests/pine-tuner.test.mjs`
- Current branch during roadmap creation: `main`
- Current working tree dirty/untracked items existed during roadmap creation. Do implementation in a worktree or non-`main` branch, not directly on `main`.

### Verified current champion snapshot
From `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/champion.json`:
- Champion score: `131.19`
- ROI: `81.11%`
- Profit factor: `3.26`
- Max drawdown: `3.34%`
- Win rate: `32.5%`
- Structure: `fusion v4 + ATR flip confirm + engulf confirm + supertrend filter + trailing stop + stop/take-profit`

### Verified current failure mode
The loop is robust but saturated:
- recent challengers are near-duplicates of the champion
- track metadata exists, but search generation still behaves mostly like incumbent-local signal/risk mutation
- persisted `activeTrackId` can keep the loop sticky on one track
- entry stack is already mature; biggest unresearched frontier is exit-state behavior
- current edge is expectancy-driven, not win-rate-driven

### Non-negotiable strategy intent
The note at `to-be-implement/2026-04-27.txt` is now part of plan intent. Its hard requirements are:
1. track search spaces must be isolated
2. rotation must be hard-triggered and clear persisted bias
3. at least 40% of research budget must go to exit-state logic
4. long/short asymmetry must be treated as first-class hypothesis
5. win rate must never override expectancy

### Existing green verification
At roadmap creation time:
- `node --test tests/pine-autoresearch.test.mjs tests/pine-tuner.test.mjs`
- expected and observed: `59 pass / 0 fail`

---

## 1. Scope boundaries

### In scope
- scheduler candidate-generation redesign
- hard rotation semantics
- exit-state research infrastructure
- long/short and regime diagnostics
- expectancy-aware promotion gates
- richer artifacts so future agents can recover intent and state from disk

### Out of scope
- adding unrelated entry indicators
- unbounded parameter Cartesian expansion
- replacing `pine/test.pine` with moduleized runtime sources
- discretionary manual chart review as promotion evidence
- win-rate-first tuning

---

## 2. File responsibility map

### Existing files to modify
- `config/pine-autoresearch.default.json`
  - canonical scheduler/track/rotation/gate budget config
- `scripts/pine-autoresearch.mjs`
  - orchestration, scheduler-state load/save, scout flow, manifest assembly
- `scripts/lib/pine-autoresearch.mjs`
  - promotion decisions, matrix logic, digest/report rendering
- `scripts/lib/pine-autoresearch-tracks.mjs`
  - track normalization, novelty signatures, rotation state transitions
- `scripts/lib/pine-search-policy.mjs`
  - incumbent-local mutation engine; will be narrowed to shared/fallback role only
- `scripts/lib/pine-tuner.mjs`
  - track-specific grids, explicit variants, pruning rules, patch plan order
- `pine/test.pine`
  - runtime strategy inputs, feature exports, exit-state logic, regime/audit outputs
- `tests/pine-autoresearch.test.mjs`
  - scheduler/promotion/report regression tests
- `tests/pine-tuner.test.mjs`
  - track/grid/pruning/patch-plan tests

### New files to create
- `scripts/lib/pine-track-generators.mjs`
  - track-owned candidate generators; zero shared ambiguity
- `tests/pine-track-generators.test.mjs`
  - direct validation that each track mutates only its allowed family
- `scripts/lib/pine-expectancy.mjs`
  - expectancy decomposition helpers for promotion gates and reports
- `tests/pine-expectancy.test.mjs`
  - expectancy gate rules, avg-win regression rejection, WR jump rejection flow
- `scripts/lib/pine-regime-analysis.mjs`
  - long/short split and regime-slice post-analysis helpers
- `tests/pine-regime-analysis.test.mjs`
  - long/short metrics and regime partition calculations
- `docs/superpowers/specs/2026-04-27-pine-autoresearch-alpha-discovery-spec.md`
  - compact design/source-of-truth companion for future agents
- `report/pine-autoresearch/<matrixId>/analysis/` artifacts
  - asymmetry and expectancy reports emitted by the scheduler or support scripts

### Optional new helper script if needed after Task 4
- `scripts/pine-autoresearch-analyze.mjs`
  - one-shot offline analyzer for trade exports if analysis logic does not fit cleanly into the scheduler

---

## 3. Research budget policy to encode in config

Use these target allocations as code-level scheduler policy, not just documentation:
- `40%` exit-state exploration
- `25%` true track isolation (`squeeze`, `divergence`)
- `20%` long/short asymmetry and regime-conditioned thresholds
- `15%` rotation hygiene and novelty enforcement
- `0%` cosmetic incumbent-neighbor farming as a primary research lane

Implementation rule:
- incumbent-local search may remain as a fallback lane for continuity, but it cannot dominate the cycle budget once the new track system lands

---

## 4. Milestone sequence

1. Freeze intent and create a machine-readable alpha-discovery spec
2. Replace cosmetic tracks with real track-owned candidate generators
3. Repair rotation semantics and novelty enforcement
4. Build exit-state hypothesis surface in Pine and tuner
5. Add asymmetry/regime diagnostics and reporting
6. Add expectancy-aware promotion gates
7. Rebalance scheduler budget and artifact reporting
8. Run validation matrix and write operator handoff notes

Do milestones in this order. Later work depends on earlier structural cleanup.

---

## 5. Detailed implementation tasks

### Task 1: Freeze intent into repo-local spec and config schema comments

**Files:**
- Create: `docs/superpowers/specs/2026-04-27-pine-autoresearch-alpha-discovery-spec.md`
- Modify: `config/pine-autoresearch.default.json`

- [ ] **Step 1: Write the spec file with exact problem statement**

Include these sections:
- Current champion snapshot
- Why incumbent-local polish is insufficient
- Track isolation rules
- Rotation hard-trigger rules
- Exit-state research hypotheses
- Long/short asymmetry requirements
- Expectancy-over-win-rate promotion policy
- Artifact/report requirements

Use this exact opening skeleton:

```md
# Pine Autoresearch Alpha Discovery Spec

## Status
Approved for implementation

## Objective
Replace incumbent-local hill-climbing behavior with structurally distinct alpha discovery.

## Source Of Truth
- Runtime strategy: `pine/test.pine`
- Scheduler: `scripts/pine-autoresearch.mjs`
- Track generators: `scripts/lib/pine-track-generators.mjs`
```

- [ ] **Step 2: Add explicit config comment blocks or ordering to reflect the new policy**

Ensure `config/pine-autoresearch.default.json` groups fields in this order:
1. matrix/script/search basics
2. `researchBudget`
3. `researchTracks`
4. `rotationPolicy`
5. `noveltyPolicy`
6. `gatePolicy`
7. labs / matrix / autopromotion / outputs

- [ ] **Step 3: Add initial `researchBudget` block**

Use this exact shape:

```json
"researchBudget": {
  "exitStateRatio": 0.4,
  "trackIsolationRatio": 0.25,
  "asymmetryRatio": 0.2,
  "rotationHygieneRatio": 0.15,
  "maxIncumbentNeighborRatio": 0.2
}
```

- [ ] **Step 4: Verify config still parses**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('config/pine-autoresearch.default.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-27-pine-autoresearch-alpha-discovery-spec.md config/pine-autoresearch.default.json
git commit -m "docs: lock alpha discovery autoresearch intent"
```

### Task 2: Create real track-owned candidate generators

**Files:**
- Create: `scripts/lib/pine-track-generators.mjs`
- Create: `tests/pine-track-generators.test.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-search-policy.mjs`
- Modify: `scripts/lib/pine-tuner.mjs`

- [ ] **Step 1: Write failing tests for track isolation**

Create tests that prove:
- squeeze track mutates only squeeze + shared knobs
- divergence track mutates only divergence + shared knobs
- exit-tightening track mutates only exit-state + shared knobs
- asymmetry track mutates only side/regime threshold knobs + shared knobs
- any invalid cross-family mutation is rejected before sweep

Use this test skeleton:

```js
test('squeeze track never mutates divergence-only keys', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'squeeze-context', sourceFamily: 'squeeze' },
    incumbent: makeIncumbent(),
    maxConfigs: 6,
  });

  assert.equal(batch.some((item) => 'divFreshBars' in item.patch || 'divCautionPenaltyValue' in item.patch), false);
});

test('divergence track never mutates squeeze-only keys', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'divergence-context', sourceFamily: 'divergence' },
    incumbent: makeIncumbent(),
    maxConfigs: 6,
  });

  assert.equal(batch.some((item) => 'squeezeLength' in item.patch || 'squeezeBoostValue' in item.patch), false);
});
```

- [ ] **Step 2: Implement generator module boundary**

Add these exports to `scripts/lib/pine-track-generators.mjs`:

```js
export function sharedKnobKeys()
export function trackOwnKnobKeys()
export function validateTrackPatch({ trackId, patch })
export function buildTrackCandidateBatch({ track, incumbent, maxConfigs, historyEvents = [], budgetPolicy = {} })
```

Track families:
- `squeeze`
- `divergence`
- `exit-state`
- `asymmetry`
- optional fallback: `incumbent-local`

- [ ] **Step 3: Represent patches with explicit metadata**

Each candidate returned by a track generator must include:

```js
{
  variantId: 'exit-state-03',
  lane: 'track',
  family: 'exit-state',
  patch: { timeStopBars: 12, useTimeStop: true },
  sharedKeys: [],
  ownKeys: ['useTimeStop', 'timeStopBars'],
  config: { ...incumbent, useTimeStop: true, timeStopBars: 12 }
}
```

Do not emit raw config-only arrays anymore when track mode is active.

- [ ] **Step 4: Wire scheduler to use track generators first**

In `scripts/pine-autoresearch.mjs`:
- resolve active track
- call `buildTrackCandidateBatch(...)`
- only fall back to `buildIncumbentSearchBatch(...)` when track mode is disabled or explicit fallback requested

- [ ] **Step 5: Keep `pine-search-policy.mjs` as fallback/shared logic only**

Refactor `buildIncumbentSearchBatch` so it no longer pretends to implement distinct research tracks.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/pine-track-generators.test.mjs tests/pine-tuner.test.mjs tests/pine-autoresearch.test.mjs`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-track-generators.mjs tests/pine-track-generators.test.mjs scripts/pine-autoresearch.mjs scripts/lib/pine-search-policy.mjs scripts/lib/pine-tuner.mjs tests/pine-autoresearch.test.mjs tests/pine-tuner.test.mjs
git commit -m "feat: add isolated autoresearch track generators"
```

### Task 3: Repair rotation semantics and novelty enforcement

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`
- Modify: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Write failing tests for hard rotation**

Cover these cases:
- rotate after `3` consecutive low-improvement cycles
- rotate when top-3 novelty similarity exceeds `0.85`
- rotate when active track exceeds `8` cycles without promotion-eligible challenger
- on rotation, persisted `activeTrackId` is cleared before next selection

Use this test skeleton:

```js
test('nextTrackState clears sticky activeTrackId when rotation trigger fires', () => {
  const next = nextTrackState({
    state: { activeTrackId: 'squeeze-context', cycleIndex: 8, noChangeStreak: 3 },
    policy: { noChangeStreakRotateAfter: 3, maxCyclesPerTrack: 8, similarityRotateAbove: 0.85 },
    manifest: { rotationTrigger: 'noChangeStreak', topCandidateSimilarity: 0.91 },
  });

  assert.equal(next.activeTrackId, null);
  assert.equal(next.lastRotationTrigger, 'noChangeStreak');
});
```

- [ ] **Step 2: Add similarity helpers**

In `scripts/lib/pine-autoresearch-tracks.mjs`, add:

```js
export function computeConfigSimilarity({ left, right })
export function summarizeTopCandidateSimilarity({ championConfig, candidates = [] })
```

Use normalized key-wise equality ratio across comparable config keys. Hamming-style distance is sufficient. Do not over-engineer a weighted metric in the first pass.

- [ ] **Step 3: Expand scheduler state shape**

Add fields:

```js
{
  activeTrackId: null,
  cycleIndex: 0,
  noChangeStreak: 0,
  sameTrackCycleStreak: 0,
  lastNoveltySignature: null,
  lastChampionFingerprint: null,
  lastCandidateFingerprint: null,
  lastRotationTrigger: null,
  lastPromotionEligibleAt: null
}
```

- [ ] **Step 4: Enforce hard rotation selection flow**

Selection order must become:
1. inspect prior scheduler state
2. inspect prior cycle improvement + similarity summary
3. if rotation trigger fired, clear `activeTrackId`
4. choose next enabled track by policy order
5. record `rotationReason` in manifest and digest

- [ ] **Step 5: Surface rotation diagnostics in artifacts**

Manifest must include:
- `topCandidateSimilarity`
- `rotationTrigger`
- `sameTrackCycleStreak`
- `promotionEligible`
- `promotionEligibleReason`

Digest must print them plainly.

- [ ] **Step 6: Run tests**

Run: `node --test tests/pine-autoresearch.test.mjs tests/pine-track-generators.test.mjs`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs tests/pine-track-generators.test.mjs
git commit -m "feat: enforce hard track rotation and novelty checks"
```

### Task 4: Add exit-state hypothesis surface to the strategy and tuner

**Files:**
- Modify: `pine/test.pine`
- Modify: `scripts/lib/pine-tuner.mjs`
- Modify: `tests/pine-tuner.test.mjs`

- [ ] **Step 1: Add failing tests for exit-state grids and pruning**

Cover distinct hypotheses, one at a time:
- failed follow-through trail tightening
- time-stop
- context-caution trail tightening
- partial de-risk
- post-entry squeeze collapse tightening
- adverse divergence tightening

Use a test skeleton like:

```js
test('getCandidateGrid returns exit-state-tightening variants as isolated hypotheses', () => {
  const grid = getCandidateGrid('exit-state-tightening');
  assert.ok(grid.useTimeStop);
  assert.ok(grid.useFailedFollowThroughTighten);
});

test('selectSweepCombos does not combine unvalidated exit hypotheses in one candidate', () => {
  const combos = selectSweepCombos({ gridName: 'exit-state-tightening', maxConfigs: 16 });
  assert.equal(combos.some((combo) => combo.useTimeStop && combo.usePartialDerisk), false);
});
```

- [ ] **Step 2: Add Pine inputs for each exit hypothesis**

Add inputs under a new group:
- `Phase 4: Exit-State Research`

Required first-pass inputs:
- `useFailedFollowThroughTighten`
- `followThroughBars`
- `followThroughMinProgressAtr`
- `followThroughTightenTrailAtrMult`
- `useTimeStop`
- `timeStopBars`
- `timeStopMinUnrealizedAtr`
- `useContextCautionTighten`
- `contextCautionDelta`
- `contextCautionTrailAtrMult`
- `usePartialDerisk`
- `partialDeriskAtR`
- `partialDeriskClosePct`
- `usePostEntrySqueezeCollapseTighten`
- `postEntrySqueezeCollapseBars`
- `postEntrySqueezeCollapseTrailAtrMult`
- `useAdverseDivergenceTighten`
- `adverseDivergenceBars`
- `adverseDivergenceTrailAtrMult`

- [ ] **Step 3: Implement each hypothesis independently**

Implementation rule:
- first pass may activate at most one new exit hypothesis per candidate, except shared baseline exits already in champion
- expose a boolean/float feature export for each trigger so post-analysis can explain why a trade exited

- [ ] **Step 4: Extend tuner grids and patch plan order**

Add new candidate grids:
- `exit-state-tightening`
- `exit-state-time-stop`
- `exit-state-partial-derisk`
- `exit-state-context-caution`
- `exit-state-post-entry-squeeze`
- `exit-state-adverse-divergence`

Also add a meta-grid:
- `exit-state-research`

Meta-grid must emit only one hypothesis family at a time.

- [ ] **Step 5: Add feature exports in `pine/test.pine`**

At minimum export:
- trigger flags
- tightened trail multiplier in force
- time-stop trigger flag
- partial de-risk flag
- adverse divergence tighten flag
- squeeze-collapse tighten flag
- live context score delta vs. entry

- [ ] **Step 6: Run tests**

Run: `node --test tests/pine-tuner.test.mjs`
Expected: pass

- [ ] **Step 7: Optional smoke check for Pine patch order**

Run a narrow script patch smoke or existing sweep smoke if available.
Expected: no patch-plan ordering regressions

- [ ] **Step 8: Commit**

```bash
git add pine/test.pine scripts/lib/pine-tuner.mjs tests/pine-tuner.test.mjs
git commit -m "feat: add exit-state research surface"
```

### Task 5: Add long/short asymmetry and regime diagnostics

**Files:**
- Create: `scripts/lib/pine-regime-analysis.mjs`
- Create: `tests/pine-regime-analysis.test.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `pine/test.pine`

- [ ] **Step 1: Write failing analysis tests**

Need tests for:
- partition trades into long vs short
- compute per-side `winRate`, `avgWin`, `avgLoss`, `profitFactor`, `MFE`, `MAE`
- compute regime-sliced metrics using exported features
- flag asymmetry when side-optimal threshold surfaces differ

Use this skeleton:

```js
test('summarizeSideMetrics computes expectancy inputs by side', () => {
  const summary = summarizeSideMetrics({ trades: sampleTrades() });
  assert.equal(summary.long.tradeCount, 3);
  assert.equal(summary.short.tradeCount, 2);
  assert.ok(summary.long.avgWin > 0);
  assert.ok(summary.short.avgLoss > 0);
});
```

- [ ] **Step 2: Implement analysis helpers**

Add exports:

```js
export function summarizeSideMetrics({ trades = [] })
export function classifyRegimeFromFeatures(featureRow)
export function summarizeRegimeSlices({ trades = [], featureRows = [] })
export function detectThresholdAsymmetry({ championMetrics, candidateMetrics })
```

Keep regime set small in first pass:
- `trend`
- `chop`
- `compression`
- `expansion`

- [ ] **Step 3: Add regime-facing feature exports if not already present**

In `pine/test.pine`, ensure exported features can classify those four regimes without hidden chart interpretation.
Examples:
- compression/squeeze state
- post-release expansion state
- trend-strength state
- caution density or filter-passing density

- [ ] **Step 4: Emit analysis artifact after scout cycle**

Write a markdown or JSON artifact to:
- `report/pine-autoresearch/<matrixId>/analysis/<runId>-asymmetry.md`
- or matching JSON sibling if easier for future automation

Must include:
- side-by-side long vs short metrics
- regime slice table
- asymmetry recommendation flags
- suggested next track if asymmetry is large

- [ ] **Step 5: Run tests**

Run: `node --test tests/pine-regime-analysis.test.mjs tests/pine-autoresearch.test.mjs`
Expected: pass

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-regime-analysis.mjs tests/pine-regime-analysis.test.mjs scripts/lib/pine-autoresearch.mjs pine/test.pine tests/pine-autoresearch.test.mjs
git commit -m "feat: add asymmetry and regime diagnostics"
```

### Task 6: Add expectancy-aware promotion gates

**Files:**
- Create: `scripts/lib/pine-expectancy.mjs`
- Create: `tests/pine-expectancy.test.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`
- Modify: `config/pine-autoresearch.default.json`

- [ ] **Step 1: Write failing expectancy tests**

Required cases:
- reject challenger when WR rises and avg win falls below champion
- require expectancy decomposition when WR jump > 8 points
- reject challenger when decomposed expectancy < champion expectancy
- allow challenger when expectancy improves even if WR is unchanged or lower

Use this skeleton:

```js
test('rejects win-rate improvement that compresses avg winner', () => {
  const result = evaluateExpectancyGuard({
    champion: { winRatePct: 32, avgWin: 2.4, avgLoss: 1.0 },
    challenger: { winRatePct: 41, avgWin: 1.7, avgLoss: 0.9 },
  });

  assert.equal(result.passed, false);
  assert.match(result.reason, /avg win/i);
});
```

- [ ] **Step 2: Implement expectancy helpers**

Add exports:

```js
export function computeExpectancy({ winRatePct, avgWin, avgLoss })
export function evaluateExpectancyGuard({ champion, challenger, wrJumpDiagnosticThreshold = 8 })
```

- [ ] **Step 3: Integrate expectancy into promotion order**

In `scripts/lib/pine-autoresearch.mjs`, evaluation order must become:
1. candidate changed
2. primary score / PF / ROI / DD / trade-floor gates
3. shadow / matrix gates
4. expectancy guard
5. win rate as diagnostic only

If expectancy guard fails, recommendation must be `hold` even if matrix looks good.

- [ ] **Step 4: Surface expectancy in digest/manifests**

Manifest/digest must include:
- champion expectancy
- challenger expectancy
- avg win / avg loss deltas
- expectancy gate result
- whether WR decomposition was mandatory

- [ ] **Step 5: Add config knobs for diagnostics, not for weakening the rule**

Use this config shape:

```json
"expectancyPolicy": {
  "enabled": true,
  "wrJumpDiagnosticThreshold": 8,
  "rejectWrGainAvgWinLoss": true,
  "requireExpectancyNonRegression": true
}
```

- [ ] **Step 6: Run tests**

Run: `node --test tests/pine-expectancy.test.mjs tests/pine-autoresearch.test.mjs`
Expected: pass

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-expectancy.mjs tests/pine-expectancy.test.mjs scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs config/pine-autoresearch.default.json
git commit -m "feat: protect autoresearch promotions with expectancy gates"
```

### Task 7: Rebalance scheduler budget and reporting

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Encode per-track budget allocation**

Add track metadata for:
- `budgetClass`: `exit-state | isolation | asymmetry | hygiene | fallback`
- `priority`
- `maxConsecutiveCycles`
- `minCyclesPerDay`

- [ ] **Step 2: Make scheduler choose tracks by budget debt, not just persistence**

Track selection should prefer the most under-served budget class after forced rotations are resolved.

- [ ] **Step 3: Add digest/report sections**

Digest must show:
- cycle budget split achieved over trailing N cycles
- active track family
- why this track was chosen
- whether this cycle was discovery, validation, or hygiene
- top candidate similarity to champion
- whether candidate is structurally different

- [ ] **Step 4: Add tests for budget-aware selection**

Test that after multiple non-exit cycles, the next selection prefers an exit-state track when budget debt is highest.

- [ ] **Step 5: Run tests**

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: pass

- [ ] **Step 6: Commit**

```bash
git add config/pine-autoresearch.default.json scripts/pine-autoresearch.mjs scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: add budget-aware autoresearch scheduling"
```

### Task 8: Validation matrix and operator handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-04-27-pine-autoresearch-alpha-discovery-roadmap.md`
- Create: `report/pine-autoresearch/<matrixId>/analysis/README.md` if missing
- Modify: `SESSION-STATE.md` only in the workspace, not in the repo, after completion

- [ ] **Step 1: Run the full relevant test suite**

Run:
```bash
node --test tests/pine-track-generators.test.mjs tests/pine-expectancy.test.mjs tests/pine-regime-analysis.test.mjs tests/pine-autoresearch.test.mjs tests/pine-tuner.test.mjs
```
Expected: all pass

- [ ] **Step 2: Run a scout cycle on pinned data**

Run the repo’s existing scout command for the default matrix.
Expected:
- manifests write successfully
- digest includes new sections
- scheduler state persists under `pine/autoresearch/<matrixId>/state/scheduler/`
- no invalid cross-family candidates appear

- [ ] **Step 3: Review generated artifacts manually**

Confirm the latest run shows all of:
- active track family
- rotation trigger or reason
- top candidate similarity
- expectancy comparison
- side/regime analysis artifact path
- structural-difference explanation for top challenger

- [ ] **Step 4: Write operator notes**

Append a short completion note to this roadmap with:
- final files changed
- final test command used
- first successful run id
- open risks / follow-up ideas

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-27-pine-autoresearch-alpha-discovery-roadmap.md report/pine-autoresearch
git commit -m "docs: finalize alpha discovery rollout notes"
```

---

## 6. Implementation rules for future agents

1. Do not add new entry filters before exit-state research lands.
2. Do not weaken expectation guards to force promotions.
3. Do not let one track remain active past policy limits just because its candidates look familiar.
4. Do not combine multiple new exit hypotheses in one candidate until each is independently validated.
5. Do not treat win rate as a promotion objective.
6. Do not move runtime strategy logic out of `pine/test.pine` unless a separate approved spec says so.
7. Do all implementation on a worktree or feature branch, not directly on `main`.

---

## 7. Verification checklist

A milestone is not done unless all applicable checks below are true.

### Structural checks
- track generator output is family-isolated
- rotation clears sticky track bias
- exit-state candidates are hypothesis-isolated
- asymmetry analysis artifacts are generated
- expectancy gate can veto superficially attractive challengers

### Research-quality checks
- top candidates differ materially from champion config
- track A and track B candidates do not overlap in forbidden family knobs
- at least `40%` of cycles over the trailing window are exit-state cycles
- digest can explain mechanically why a challenger is better or rejected

### Regression checks
- existing tuner/autoresearch tests still pass
- manifest/digest/history formats remain readable by existing tools where promised
- pinned-data scout cycle still completes

---

## 8. Risks and mitigations

- **Risk:** exit-state logic explodes the search surface
  - **Mitigation:** one hypothesis family per candidate; meta-grid only schedules isolated hypotheses

- **Risk:** similarity metric is noisy
  - **Mitigation:** keep first version simple and transparent; store raw similarity inputs in manifest

- **Risk:** regime classification becomes hand-wavy
  - **Mitigation:** derive only from exported feature fields already visible in `pine/test.pine`

- **Risk:** future agents forget intent and restart local-max tuning
  - **Mitigation:** keep this roadmap + the paired spec + digest artifact sections as on-disk source of truth

---

## 9. Suggested execution order inside a fresh worktree

1. Task 1
2. Task 2
3. Task 3
4. Task 6
5. Task 4
6. Task 5
7. Task 7
8. Task 8

Reason:
- track isolation and rotation must land before new research claims are trusted
- expectancy guard can land before exit-state logic to protect against false promotions during rollout
- exit-state and asymmetry research are most valuable once scheduler semantics are fixed

---

## 10. Handoff note

If a future session agent starts cold, it should read in this order:
1. `docs/superpowers/plans/2026-04-27-pine-autoresearch-alpha-discovery-roadmap.md`
2. `docs/superpowers/specs/2026-04-27-pine-autoresearch-alpha-discovery-spec.md` once created
3. `config/pine-autoresearch.default.json`
4. latest digest under `report/pine-autoresearch/<matrixId>/latest-digest.md`
5. latest manifest and scheduler state under `pine/autoresearch/<matrixId>/`

That sequence is sufficient to recover implementation intent without relying on chat history.
