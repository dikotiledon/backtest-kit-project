# Pine Autoresearch Closed-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Pine autoresearch into a bounded closed loop with track rotation, novelty detection, strict promotion gates, and track-aware artifacts.

**Architecture:** Keep `pine/test.pine` as the single runtime Pine target. Add a small track/state helper layer so the main scheduler can pick a bounded research track, build a candidate batch, evaluate it, and rotate when novelty stalls. Leave `pine/to-be-implement/*.pine` as mirrors/reference copies only; the scheduler should always point at `pine/test.pine`.

**Tech Stack:** Node.js, JSON config, Pine Script v5, existing `node:test` suite, PowerShell task wrappers.

---

### Task 1: Add track registry and scheduler state helpers

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Create: `scripts/lib/pine-autoresearch-tracks.mjs`
- Create: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNoveltySignature,
  readSchedulerState,
  resolveSchedulerStatePath,
  selectActiveTrack,
  nextTrackState,
  writeSchedulerState,
} from '../scripts/lib/pine-autoresearch-tracks.mjs';

test('buildNoveltySignature is stable and track-specific', () => {
  const signature = buildNoveltySignature({
    trackId: 'squeeze-context',
    gridName: 'squeeze-context',
    candidateFingerprint: '{"useSqueezeContext":true}',
    windowSetId: 'primary-v1',
    labSetId: 'primary-shadow-3',
  });

  assert.equal(signature, 'squeeze-context|squeeze-context|{"useSqueezeContext":true}|primary-v1|primary-shadow-3');
});

test('selectActiveTrack prefers persisted activeTrackId before rotation', () => {
  const track = selectActiveTrack({
    tracks: [
      { trackId: 'squeeze-context', enabled: true },
      { trackId: 'divergence-context', enabled: true },
    ],
    state: { activeTrackId: 'divergence-context', cycleIndex: 4 },
  });

  assert.equal(track.trackId, 'divergence-context');
});

test('nextTrackState rotates after noChangeStreak threshold', () => {
  const next = nextTrackState({
    state: {
      activeTrackId: 'squeeze-context',
      cycleIndex: 3,
      noChangeStreak: 3,
      lastNoveltySignature: 'same',
    },
    policy: {
      noChangeStreakRotateAfter: 3,
      noNoveltyRotateAfter: 2,
      maxCyclesPerTrack: 6,
    },
    manifest: {
      noveltySignature: 'same',
      steadyState: true,
    },
  });

  assert.equal(next.rotationReason, 'noChangeStreak');
  assert.equal(next.nextState.noChangeStreak, 0);
});

test('readSchedulerState and writeSchedulerState round-trip a scheduler state file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-'));
  const file = resolveSchedulerStatePath({ researchRoot: dir, matrixId: 'pine-autoresearch' });
  const state = {
    activeTrackId: 'divergence-context',
    cycleIndex: 11,
    noChangeStreak: 2,
    lastNoveltySignature: 'divergence-context|grid|abc|primary-v1|shadow-v1',
    lastPromotedConfigId: '0002__minPredSum-2',
    lastRotationTrigger: 'noNovelty',
  };

  await writeSchedulerState(file, state);
  const loaded = await readSchedulerState(file);

  assert.match(file, /scheduler-state\.json$/);
  assert.deepEqual(loaded, state);
});
```

Run: `node --test tests/pine-autoresearch-tracks.test.mjs`
Expected: FAIL first with missing module/export, then PASS after implementation.

- [ ] **Step 2: Add the new config shape**

Use this structure in `config/pine-autoresearch.default.json`:

```json
{
  "researchTracks": [
    {
      "trackId": "squeeze-context",
      "name": "Squeeze Context",
      "sourceFamily": "squeeze",
      "gridName": "squeeze-context",
      "variantMode": "grid",
      "windowSetId": "primary-v1",
      "enabled": true,
      "promotionPolicy": { "minScoreDelta": 0.25, "minTradeCount": 100 },
      "stopPolicy": { "cooldownCyclesAfterPromote": 1 }
    },
    {
      "trackId": "divergence-context",
      "name": "Divergence Context",
      "sourceFamily": "divergence",
      "gridName": "divergence-context",
      "variantMode": "grid",
      "windowSetId": "primary-v1",
      "enabled": true,
      "promotionPolicy": { "minScoreDelta": 0.35, "minTradeCount": 100 },
      "stopPolicy": { "cooldownCyclesAfterPromote": 1 }
    }
  ],
  "rotationPolicy": {
    "noChangeStreakRotateAfter": 3,
    "noNoveltyRotateAfter": 2,
    "maxCyclesPerTrack": 6,
    "preferCurrentChampionUntil": 1,
    "cooldownCyclesAfterPromote": 1
  },
  "noveltyPolicy": {
    "enabled": true,
    "signatureFields": ["trackId", "gridName", "candidateFingerprint", "windowSetId", "labSetId"]
  },
  "windowPolicy": {
    "primary": "primary-v1",
    "shadow": ["shadow-v1", "shadow-v2"],
    "rotating": ["primary-v1", "rotating-v2"],
    "minCoverage": 2,
    "maxAge": 30
  },
  "gatePolicy": {
    "requireCandidateChange": true,
    "requireMatrixPromotion": true,
    "minShadowPassCount": 1,
    "minShadowPassRatio": 0.5
  }
}
```

- [ ] **Step 3: Implement the helper module**

Add `scripts/lib/pine-autoresearch-tracks.mjs` with these exports:

```js
export function normalizeResearchTracks(rawTracks = [])
export function buildNoveltySignature({ trackId, gridName, candidateFingerprint, windowSetId, labSetId })
export function resolveSchedulerStatePath({ researchRoot, matrixId })
export async function readSchedulerState(filePath)
export async function writeSchedulerState(filePath, state)
export function defaultSchedulerState()
export function selectActiveTrack({ tracks, state, cycleIndex })
export function nextTrackState({ state, policy, manifest })
```

Rules:
- ignore disabled tracks
- preserve `activeTrackId` when it still points to an enabled track
- otherwise rotate through enabled tracks by `cycleIndex`
- treat repeated novelty signature plus unchanged champion as steady state
- reset `noChangeStreak` only when the candidate truly changes or rotation happens

- [ ] **Step 4: Add the scheduler-state path helper and default state object**

Use a single path convention so later orchestration code does not invent its own file location:

```js
export function resolveSchedulerStatePath({ researchRoot, matrixId }) {
  return path.join(researchRoot, `${matrixId}-scheduler-state.json`);
}

export function defaultSchedulerState() {
  return {
    activeTrackId: null,
    cycleIndex: 0,
    noChangeStreak: 0,
    lastNoveltySignature: null,
    lastPromotedConfigId: null,
    lastRotationTrigger: null,
  };
}
```

Keep the scheduler state shape small and explicit so `scripts/pine-autoresearch.mjs` can consume it in the next task.

- [ ] **Step 5: Commit**

```bash
git add config/pine-autoresearch.default.json scripts/lib/pine-autoresearch-tracks.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "feat: add autoresearch track state model"
```

### Task 2: Add track-specific squeeze and divergence sweep knobs

**Files:**
- Modify: `scripts/lib/pine-tuner.mjs`
- Modify: `tests/pine-tuner.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatchPlan, filterSweepCombos, getCandidateGrid } from '../scripts/lib/pine-tuner.mjs';

test('getCandidateGrid exposes squeeze-context and divergence-context grids', () => {
  assert.ok(getCandidateGrid('squeeze-context').useSqueezeContext);
  assert.ok(getCandidateGrid('divergence-context').useDivergenceContext);
});

test('filterSweepCombos drops squeeze and divergence knobs when modules are disabled', () => {
  const combos = [
    {
      useSqueezeContext: false,
      squeezeLength: 20,
      squeezeBbMult: 2,
      squeezeKcMult: 1.5,
      squeezeReleaseFreshBars: 5,
      squeezeBoostValue: 0.5,
      useDivergenceContext: false,
      divRsiLen: 14,
      divPivotLeft: 5,
      divPivotRight: 5,
      divFreshBars: 5,
      divLongBoostValue: 0.5,
      divShortBoostValue: 0.5,
    },
    {
      useSqueezeContext: false,
      squeezeLength: 34,
      squeezeBbMult: 2.5,
      squeezeKcMult: 2.0,
      squeezeReleaseFreshBars: 8,
      squeezeBoostValue: 0.75,
      useDivergenceContext: false,
      divRsiLen: 21,
      divPivotLeft: 3,
      divPivotRight: 3,
      divFreshBars: 8,
      divLongBoostValue: 0.75,
      divShortBoostValue: 0.75,
    },
  ];

  assert.equal(filterSweepCombos(combos).length, 1);
});

test('buildPatchPlan patches the new squeeze and divergence inputs', () => {
  const plan = buildPatchPlan({
    useSqueezeContext: true,
    squeezeLength: 34,
    squeezeBbMult: 2.5,
    squeezeKcMult: 2.0,
    squeezeReleaseFreshBars: 8,
    squeezeBoostValue: 0.75,
    useDivergenceContext: true,
    divRsiLen: 21,
    divPivotLeft: 3,
    divPivotRight: 3,
    divFreshBars: 8,
    divLongBoostValue: 0.75,
    divShortBoostValue: 0.75,
  });

  assert.deepEqual(plan.map((step) => step.key), [
    'useSqueezeContext',
    'squeezeLength',
    'squeezeBbMult',
    'squeezeKcMult',
    'squeezeReleaseFreshBars',
    'squeezeBoostValue',
    'useDivergenceContext',
    'divRsiLen',
    'divPivotLeft',
    'divPivotRight',
    'divFreshBars',
    'divLongBoostValue',
    'divShortBoostValue',
  ]);
});
```

Run: `node --test tests/pine-tuner.test.mjs`
Expected: FAIL first on missing grid/patchers, then PASS.

- [ ] **Step 2: Add bounded candidate grids for the new tracks**

Add `getCandidateGrid('squeeze-context')` and `getCandidateGrid('divergence-context')` with small, bounded lists only. Keep the existing `phase3-core` grid untouched.

Use the actual runtime names from `pine/test.pine`:
- `useSqueezeContext`
- `squeezeLength`
- `squeezeBbMult`
- `squeezeKcMult`
- `squeezeReleaseFreshBars`
- `squeezeBoostValue`
- `useDivergenceContext`
- `divRsiLen`
- `divPivotLeft`
- `divPivotRight`
- `divFreshBars`
- `divLongBoostValue`
- `divShortBoostValue`

- [ ] **Step 3: Extend disabled-module pruning**

Update `filterSweepCombos()` so all squeeze-specific knobs are deleted when `useSqueezeContext !== true`, and all divergence-specific knobs are deleted when `useDivergenceContext !== true`.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/pine-tuner.mjs tests/pine-tuner.test.mjs
git commit -m "feat: add squeeze and divergence research knobs"
```

### Task 3: Wire closed-loop orchestration into autoresearch

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoutOrchestrationState } from '../scripts/pine-autoresearch.mjs';

test('buildScoutOrchestrationState records track and novelty metadata', () => {
  const state = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      primaryLab: { labId: 'primary' },
      shadowLabs: [{ labId: 'shadow-1' }],
      pinnedData: { enabled: true, datasetsRoot: '/data', cacheRoot: '/cache', exchangeName: 'binance' },
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 0.5, requireCandidateChange: true },
      rotationPolicy: { noChangeStreakRotateAfter: 3 },
    },
    runId: 'pine-autoresearch-123',
    championState: { configId: 'champion', score: 70, config: { minPredSum: 2 } },
    historyEventsBefore: [{ type: 'cycle', steadyState: true }],
    searchBatch: [{ variantId: 'v1', lane: 'exploit', family: 'signal', config: { minPredSum: 1.5 } }],
    primarySweep: { topConfigs: [{ configId: 'c1', score: 72, roiPct: 48, profitFactor: 1.9, maxDrawdownPct: 4.1, tradeCount: 230 }] },
    matrixCandidates: [{ challenger: { configId: 'c1', config: { minPredSum: 1.5 } }, labResults: [], matrixDecision: { recommendation: 'promote' }, robustness: {} }],
    activeTrack: { trackId: 'squeeze-context', gridName: 'squeeze-context', windowSetId: 'primary-v1' },
    noveltySignature: 'squeeze-context|squeeze-context|abc|primary-v1|primary-shadow-3',
  });

  assert.equal(state.manifest.activeTrackId, 'squeeze-context');
  assert.equal(state.manifest.noveltySignature, 'squeeze-context|squeeze-context|abc|primary-v1|primary-shadow-3');
  assert.ok(state.manifest.researchState);
});
```

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: FAIL first because orchestration state lacks track fields, then PASS.

- [ ] **Step 2: Add track selection and rotation into the runner**

In `scripts/pine-autoresearch.mjs`:
- load scheduler state before choosing the batch
- select `activeTrackId` from persisted state or rotate by `cycleIndex`
- select a bounded candidate grid for the active track
- compute a novelty signature from track + grid + candidate fingerprint + window set + lab set
- pass `activeTrackId`, `windowSetId`, `noveltySignature`, and `rotationReason` into the manifest
- append the `cycle` history event with the same track fields
- write updated scheduler state after manifest write

- [ ] **Step 3: Preserve incumbent promotion gates**

Do not loosen current promotion logic. Keep the current `candidateChanged`, primary lab, shadow lab, cooldown, and daily quota gates intact. The closed loop only changes how the challenger is chosen and how repeat-state is recorded.

- [ ] **Step 4: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: add closed-loop autoresearch orchestration"
```

### Task 4: Make reports and auto-promotion track-aware

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDigestMarkdown, summarizeDigestAnnouncement } from '../scripts/lib/pine-autoresearch.mjs';

test('renderDigestMarkdown shows active track, novelty, and steady state', () => {
  const markdown = renderDigestMarkdown({
    config: {
      matrixId: 'pine-autoresearch',
      primaryLab: { labId: 'primary' },
      shadowLabs: [{}, {}],
    },
    championState: { configId: 'champion', score: 70.78, roiPct: 47.19 },
    latestManifest: {
      runId: 'run-1',
      activeTrackId: 'divergence-context',
      noveltySignature: 'divergence-context|divergence-context|abc|primary-v1|shadow-v1',
      researchState: { steadyState: true, noChangeStreak: 4 },
      champion: { configId: 'champion', score: 70.78, roiPct: 47.19, config: { minPredSum: 2 } },
      challenger: { configId: 'champion', score: 70.78, roiPct: 47.19, config: { minPredSum: 2 } },
      matrixDecision: { recommendation: 'hold', summary: 'No new candidate.' },
      searchPlan: { variantCount: 2, exploitRatio: 0.8 },
      paretoShortlist: [{ configId: 'champion' }],
      gateResults: { candidateChanged: false },
      rotationReason: 'noChangeStreak',
    },
    previousManifest: null,
    historyEvents: [],
  });

  assert.match(markdown, /Active track/);
  assert.match(markdown, /divergence-context/);
  assert.match(markdown, /steady state/);
});

test('summarizeDigestAnnouncement includes rotation-aware steady state text', () => {
  const text = summarizeDigestAnnouncement({
    latestManifest: {
      activeTrackId: 'squeeze-context',
      researchState: { steadyState: true, noChangeStreak: 4 },
      champion: { configId: 'champion', score: 70.78, roiPct: 47.19, config: { minPredSum: 2 } },
      challenger: { configId: 'champion', score: 70.78, roiPct: 47.19, config: { minPredSum: 2 } },
      matrixDecision: { recommendation: 'hold' },
    },
  });

  assert.match(text, /pine autoresearch steady-state/);
  assert.match(text, /squeeze-context/);
  assert.match(text, /streak 4/);
});
```

Run: `node --test tests/pine-autoresearch.test.mjs`
Expected: FAIL first on missing track-aware report text, then PASS.

- [ ] **Step 2: Thread track metadata through reports and summaries**

Update:
- `renderScoutMarkdown()` to show `activeTrackId`, `windowSetId`, `noveltySignature`, `rotationReason`
- `renderDigestMarkdown()` to show current track, steady state, and next action
- `summarizeDigestAnnouncement()` to emit a concise track-aware summary

- [ ] **Step 3: Keep autopromote strict**

Update `decideAutoPromotionAction()` only if needed to make the track-aware fields visible in its summary. Do not allow autopromote to bypass the existing matrix/candidate-change/cooldown/quota gates.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: make autoresearch reports track-aware"
```

### Task 5: Validate the whole closed-loop path

**Files:**
- Modify: none if all previous tasks land cleanly; otherwise fix the smallest failing file from the above tasks.
- Test: `tests/pine-autoresearch-tracks.test.mjs`
- Test: `tests/pine-tuner.test.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Run the targeted test suite**

Run:
```bash
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-tuner.test.mjs tests/pine-autoresearch.test.mjs
```
Expected:
- all subtests pass
- no steady-state/report regressions
- no broken grid/patcher names

- [ ] **Step 2: Check the scheduler outputs once on a micro cycle**

Run:
```bash
npm run pine:autoresearch:micro
```
Expected:
- the manifest writes `activeTrackId`, `noveltySignature`, and `rotationReason`
- the digest shows the active track and steady-state status when applicable
- the run does not promote unless the normal matrix gates pass

- [ ] **Step 3: Commit the final implementation batch**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/lib/pine-tuner.mjs scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs config/pine-autoresearch.default.json tests/pine-autoresearch-tracks.test.mjs tests/pine-tuner.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat: close the pine autoresearch loop"
```

## Self-review checklist
- Spec coverage: track registry, rotation, novelty, config, artifacts, reporting, fail-closed promotion, and test coverage all map to tasks above.
- Placeholder scan: no TBD/TODO/fill-in text used.
- Type consistency: helper names are consistent across tasks (`buildNoveltySignature`, `selectActiveTrack`, `nextTrackState`).
- Scope: this plan stays on the scheduler/research side; it does not rewrite the Pine strategy itself.
