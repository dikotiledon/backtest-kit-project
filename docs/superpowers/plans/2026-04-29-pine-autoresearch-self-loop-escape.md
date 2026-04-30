# Pine Autoresearch Self-Loop Escape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Pine autoresearch from repeatedly selecting the current champion as the challenger after all track candidates lose, and force the system to escalate into broader exploration instead of producing no-op self-validation cycles.

**Architecture:** Keep promotion gates strict, but separate “champion validation” from “candidate discovery.” If the best ranked result equals the current champion, the cycle should mark this as `noNewCandidate`, skip matrix work against the unchanged champion, increase exploration pressure, and generate a broader fallback batch on the next cycle. The scheduler should track self-loop streaks and activate fallback/temperature behavior until a changed candidate is found.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine autoresearch modules under `scripts/`, JSON manifest/history artifacts, config-driven search policy.

---

## Problem Summary

Current observed state after force-promoting robust-shadow challenger `7a9589f6`:

- Latest cycles selected the **current champion itself** as challenger.
- Latest manifest `2026-04-29T14-30-12-449Z`:
  - `candidateHash = 7a9589f6`
  - `champHash = 7a9589f6`
  - `candidateChanged = false`
  - failed gates: `candidateChanged`, `primaryPromote`, `shadowPassCount`, `shadowPassRatio`
  - summary: current champion remains best
- Search did test changed variants, but their primary sweep scores ranked below the champion.
- The pipeline then fell back to champion and ran a full matrix anyway, causing repeated no-op cycles.

The old two-candidate ping-pong was fixed. This is a new **champion self-loop** failure mode.

## Desired Behavior

When the best available candidate equals champion:

1. Do not treat champion as a real challenger.
2. Do not waste full matrix evaluations on unchanged champion unless explicitly requested as validation.
3. Record `noNewCandidate: true` in manifest/history.
4. Increment a scheduler `selfLoopStreak` / `noNewCandidateStreak`.
5. Use that streak to escalate next-cycle exploration:
   - larger mutation temperature,
   - include incumbent-local fallback,
   - include additional research families,
   - optionally expand track batch limit beyond the current tiny 3-candidate pool.
6. Reset streak once a changed candidate is selected.
7. Keep promotion gates unchanged.

## File Map

- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
  - Extend scheduler state with `noNewCandidateStreak` and `lastNoNewCandidateAt`.
  - Update `nextTrackState()` to increment/reset the streak.

- Modify: `scripts/lib/pine-track-generators.mjs`
  - Add fallback exploration support when scheduler says self-loop/no-new-candidate streak is active.
  - Ensure fallback variants exclude champion and tabu fingerprints.

- Modify: `scripts/pine-autoresearch.mjs`
  - Detect unchanged champion before matrix evaluation is treated as a real candidate.
  - Add `noNewCandidate` manifest/history fields.
  - Pass scheduler self-loop context into batch generation.
  - Avoid selecting champion as `selectedCandidate` unless no-challenger validation mode is explicitly enabled.

- Modify: `config/pine-autoresearch.default.json`
  - Add explicit self-loop escape config under `searchPolicy.selfLoopEscape`.

- Modify: `tests/pine-autoresearch-tracks.test.mjs`
  - Cover streak increment/reset behavior.

- Modify: `tests/pine-track-generators.test.mjs`
  - Cover fallback exploration when track pool is exhausted or no-new-candidate streak is active.

- Modify: `tests/pine-autoresearch.test.mjs`
  - Cover manifest/history behavior and no matrix-promotion false positive when candidate is unchanged.

---

## Task 1: Extend scheduler state for no-new-candidate streak

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Test: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Add failing scheduler-state tests**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```js
test('nextTrackState increments no-new-candidate streak when candidate equals champion', () => {
  const next = nextTrackState({
    state: defaultSchedulerState(),
    manifest: {
      activeTrackId: 'divergence-context',
      candidateFingerprint: 'champ-1',
      championFingerprint: 'champ-1',
      noNewCandidate: true,
      generatedAt: '2026-04-29T14:30:00.000Z',
      noveltySignature: 'divergence-context|phase3-core|champ-1|primary|labs',
    },
  });

  assert.equal(next.noNewCandidateStreak, 1);
  assert.equal(next.lastNoNewCandidateAt, '2026-04-29T14:30:00.000Z');
});

test('nextTrackState resets no-new-candidate streak when changed candidate appears', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 3,
      lastNoNewCandidateAt: '2026-04-29T14:30:00.000Z',
    },
    manifest: {
      activeTrackId: 'squeeze-context',
      candidateFingerprint: 'cand-2',
      championFingerprint: 'champ-1',
      noNewCandidate: false,
      generatedAt: '2026-04-29T15:00:00.000Z',
      noveltySignature: 'squeeze-context|phase3-core|cand-2|primary|labs',
    },
  });

  assert.equal(next.noNewCandidateStreak, 0);
  assert.equal(next.lastNoNewCandidateAt, '2026-04-29T14:30:00.000Z');
});
```

- [ ] **Step 2: Run failing tests**

Run:

```powershell
node --test tests/pine-autoresearch-tracks.test.mjs
```

Expected: fails because `noNewCandidateStreak` / `lastNoNewCandidateAt` are missing.

- [ ] **Step 3: Implement scheduler fields**

In `scripts/lib/pine-autoresearch-tracks.mjs`, update `defaultSchedulerState()`:

```js
export function defaultSchedulerState() {
  return {
    activeTrackId: null,
    cycleIndex: 0,
    noChangeStreak: 0,
    sameTrackCycleStreak: 0,
    lastNoveltySignature: null,
    lastChampionFingerprint: null,
    lastCandidateFingerprint: null,
    lastRotationTrigger: null,
    lastPromotionEligibleAt: null,
    tabuRejectedFingerprints: [],
    noNewCandidateStreak: 0,
    lastNoNewCandidateAt: null,
  };
}
```

In `nextTrackState()`, before `return { ...previous, ... }`, compute:

```js
  const noNewCandidate = manifest.noNewCandidate === true
    || (candidateFingerprint != null && championFingerprint != null && candidateFingerprint === championFingerprint);
  const noNewCandidateStreak = noNewCandidate
    ? (previous.noNewCandidateStreak ?? 0) + 1
    : 0;
  const lastNoNewCandidateAt = noNewCandidate
    ? (manifest.generatedAt ?? previous.lastNoNewCandidateAt)
    : previous.lastNoNewCandidateAt;
```

Then include fields in the return object:

```js
    noNewCandidateStreak,
    lastNoNewCandidateAt,
```

In `normalizeSchedulerState()`, add:

```js
    noNewCandidateStreak: Number.isFinite(state.noNewCandidateStreak)
      ? state.noNewCandidateStreak
      : base.noNewCandidateStreak,
    lastNoNewCandidateAt: state.lastNoNewCandidateAt ?? base.lastNoNewCandidateAt,
```

- [ ] **Step 4: Run scheduler tests**

Run:

```powershell
node --test tests/pine-autoresearch-tracks.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/pine-autoresearch-tracks.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix(pine): track autoresearch no-new-candidate streak"
```

---

## Task 2: Add self-loop escape configuration

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing config test**

In `tests/pine-autoresearch.test.mjs`, extend `default autoresearch config enables incumbent-local shortlist policy` expected `searchPolicy` object with:

```js
    selfLoopEscape: {
      enabled: true,
      activateAfter: 1,
      includeFallback: true,
      fallbackFamilies: ['signal', 'risk'],
      minFallbackConfigs: 3,
      temperatureBoost: 1.5,
    },
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: fails because config is missing `selfLoopEscape`.

- [ ] **Step 3: Add config block**

Modify `config/pine-autoresearch.default.json` inside `searchPolicy`:

```json
    "selfLoopEscape": {
      "enabled": true,
      "activateAfter": 1,
      "includeFallback": true,
      "fallbackFamilies": [
        "signal",
        "risk"
      ],
      "minFallbackConfigs": 3,
      "temperatureBoost": 1.5
    },
```

- [ ] **Step 4: Run config test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit**

```powershell
git add config/pine-autoresearch.default.json tests/pine-autoresearch.test.mjs
git commit -m "config(pine): enable self-loop escape policy"
```

---

## Task 3: Make track generator produce fallback candidates during self-loop escape

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs`
- Test: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Add failing test for fallback activation**

Append to `tests/pine-track-generators.test.mjs`:

```js
test('track batch includes fallback candidates when no-new-candidate streak activates self-loop escape', () => {
  const track = { trackId: 'divergence-context', sourceFamily: 'divergence' };

  const batch = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs: 8,
    historyEvents: [],
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 3,
        temperatureBoost: 1.5,
      },
    },
    schedulerState: {
      noNewCandidateStreak: 2,
      tabuRejectedFingerprints: [],
    },
  });

  assert.ok(batch.some((item) => item.lane === 'self-loop-fallback'));
  assert.ok(batch.filter((item) => item.lane === 'self-loop-fallback').length >= 3);
  assert.ok(batch.every((item) => item.temperature >= 1));
});
```

- [ ] **Step 2: Add failing test for champion/tahu exclusion**

Append to `tests/pine-track-generators.test.mjs`:

```js
test('self-loop fallback excludes tabu fingerprints and does not duplicate track candidates', () => {
  const track = { trackId: 'squeeze-context', sourceFamily: 'squeeze' };
  const first = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs: 8,
    historyEvents: [],
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 3,
        temperatureBoost: 1.5,
      },
    },
    schedulerState: { noNewCandidateStreak: 2 },
  });
  const rejected = configFingerprint(first[0].config);

  const second = buildTrackCandidateBatch({
    track,
    incumbent,
    maxConfigs: 8,
    historyEvents: [],
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 3,
        temperatureBoost: 1.5,
      },
    },
    schedulerState: {
      noNewCandidateStreak: 2,
      tabuRejectedFingerprints: [rejected],
    },
  });

  assert.equal(second.some((item) => configFingerprint(item.config) === rejected), false);
  assert.equal(new Set(second.map((item) => configFingerprint(item.config))).size, second.length);
});
```

- [ ] **Step 3: Run failing tests**

Run:

```powershell
node --test tests/pine-track-generators.test.mjs
```

Expected: fails because `selfLoopEscape` is not implemented.

- [ ] **Step 4: Implement fallback patch pools**

In `scripts/lib/pine-track-generators.mjs`, add after `getPatchPool()`:

```js
function getFallbackPatchPool(families = [], base) {
  const familyPatchMap = {
    signal: [
      { minPredSum: lowerBound((base.minPredSum ?? 2) - 0.5, 0.5) },
      { minPredSum: numeric(base.minPredSum ?? 2) + 0.5 },
      { minBarsBetween: lowerBound((base.minBarsBetween ?? 2) - 1, 0) },
      { minBarsBetween: numeric(base.minBarsBetween ?? 2) + 2 },
      { adxThreshold: lowerBound((base.adxThreshold ?? 20) - 5, 1) },
      { adxThreshold: numeric(base.adxThreshold ?? 20) + 5 },
    ],
    risk: [
      { slAtrMult: lowerBound((base.slAtrMult ?? 1) - 0.25, 0.25) },
      { slAtrMult: numeric(base.slAtrMult ?? 1) + 0.25 },
      { tpAtrMult: lowerBound((base.tpAtrMult ?? 2.5) - 0.5, 0.5) },
      { tpAtrMult: numeric(base.tpAtrMult ?? 2.5) + 0.5 },
      { trailAtrMult: Math.max(0.5, numeric(base.trailAtrMult ?? 1) - 0.25) },
      { trailActivateR: numeric(base.trailActivateR ?? 0.5) + 0.5 },
    ],
  };

  return families.flatMap((family) => (familyPatchMap[family] || []).map((patch) => ({ family, patch })));
}
```

- [ ] **Step 5: Wire fallback into `buildTrackCandidateBatch()`**

Inside `buildTrackCandidateBatch()`, after regular track batch construction and before existing `includeFallback` block, add:

```js
  const selfLoopEscape = budgetPolicy.selfLoopEscape || {};
  const escapeActive = selfLoopEscape.enabled === true
    && (schedulerState.noNewCandidateStreak ?? 0) >= (selfLoopEscape.activateAfter ?? 1);

  if (escapeActive && selfLoopEscape.includeFallback === true && batch.length < limit) {
    const fallbackFamilies = selfLoopEscape.fallbackFamilies?.length
      ? selfLoopEscape.fallbackFamilies
      : ['signal', 'risk'];
    const fallbackPool = getFallbackPatchPool(fallbackFamilies, base);
    const minFallbackConfigs = Math.max(0, Number(selfLoopEscape.minFallbackConfigs ?? 3));
    const fallbackTemperature = Number((temperature * (selfLoopEscape.temperatureBoost ?? 1.5)).toFixed(4));
    let fallbackSkipped = 0;

    for (let probe = 0; probe < fallbackPool.length && batch.length < limit; probe++) {
      const { family: fallbackFamily, patch: rawPatch } = fallbackPool[(offset + probe) % fallbackPool.length];
      const patch = scalePatch(base, rawPatch, fallbackTemperature);
      validateTrackPatch({ trackId: 'incumbent-local', patch });
      const config = applyPatch(base, patch);
      const fingerprint = configFingerprint(config);
      if (tabuSet.has(fingerprint)) {
        fallbackSkipped += 1;
        continue;
      }
      tabuSet.add(fingerprint);
      batch.push(buildMetadata({
        trackId: 'incumbent-local',
        family: fallbackFamily,
        index: batch.length,
        patch,
        lane: 'self-loop-fallback',
        temperature: fallbackTemperature,
        tabuSkipped: fallbackSkipped,
        config,
      }));
      fallbackSkipped = 0;
      if (batch.filter((item) => item.lane === 'self-loop-fallback').length >= minFallbackConfigs && batch.length >= limit) {
        break;
      }
    }
  }
```

- [ ] **Step 6: Run generator tests**

Run:

```powershell
node --test tests/pine-track-generators.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/lib/pine-track-generators.mjs tests/pine-track-generators.test.mjs
git commit -m "fix(pine): escalate track search after champion self-loop"
```

---

## Task 4: Stop treating unchanged champion as a real challenger

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing orchestration test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('buildScoutOrchestrationState marks no-new-candidate when selected candidate equals champion', () => {
  const championConfig = { minPredSum: 2, tpAtrMult: 5.5 };

  const result = buildScoutOrchestrationState({
    config: {
      matrixId: 'pine-autoresearch',
      selectedProfile: 'full',
      researchRoot: '/tmp/research',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.8, paretoShortlistSize: 2, matrixCandidateLimit: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [{ labId: 'shadow-1' }],
      pinnedData: { enabled: false },
      researchTracks: [{ trackId: 'divergence-context', gridName: 'phase3-core', windowSet: 'primary', enabled: true }],
    },
    runId: 'pine-autoresearch-self-loop',
    championState: { configId: 'champion', score: 100, roiPct: 50, config: championConfig },
    historyEventsBefore: [],
    searchBatch: [{ variantId: 'v1', lane: 'track', family: 'divergence', config: { minPredSum: 2, tpAtrMult: 6 } }],
    primarySweep: {
      topConfigs: [
        { configId: 'champion', score: 100, roiPct: 50, profitFactor: 3, maxDrawdownPct: 2, tradeCount: 200, config: championConfig },
        { configId: 'weaker', score: 95, roiPct: 48, profitFactor: 2.8, maxDrawdownPct: 2, tradeCount: 200, config: { minPredSum: 2, tpAtrMult: 6 } },
      ],
    },
    matrixCandidates: [{
      challenger: { configId: 'champion', score: 100, roiPct: 50, config: championConfig },
      matrixDecision: { recommendation: 'hold', failedGates: ['candidateChanged'], summary: 'No new candidate' },
      robustness: {},
    }],
    trackState: {
      activeTrackId: 'divergence-context',
      windowSetId: 'primary',
      noveltySignature: 'divergence-context|phase3-core|champion|primary|primary-shadow',
      candidateFingerprint: JSON.stringify({ minPredSum: 2, tpAtrMult: 5.5 }),
      championFingerprint: JSON.stringify({ minPredSum: 2, tpAtrMult: 5.5 }),
      labSetId: 'primary,shadow-1',
      gridName: 'phase3-core',
    },
  });

  assert.equal(result.manifest.noNewCandidate, true);
  assert.equal(result.manifest.rejectedCandidateFingerprint, null);
  assert.match(result.manifest.matrixDecision.summary, /No new candidate/);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: fails because `manifest.noNewCandidate` is missing.

- [ ] **Step 3: Add no-new-candidate manifest fields**

In `buildScoutOrchestrationState()` in `scripts/pine-autoresearch.mjs`, after `const challengerSummary = ...`, add:

```js
  const noNewCandidate = sameConfig(championState?.config, challengerSummary?.config);
```

In the returned `manifest`, add near candidate fingerprints:

```js
      noNewCandidate,
```

Ensure `rejectedCandidateFingerprint` stays null for unchanged champion:

```js
      rejectedCandidateFingerprint: noNewCandidate ? null : (trackState.rejectedCandidateFingerprint ?? null),
```

- [ ] **Step 4: Pass `noNewCandidate` into `nextTrackState()`**

In `runScout()`, when building `trackState`, compute:

```js
  const noNewCandidate = sameConfig(championState.config, challengerSummary.config);
```

Then include in `trackState`:

```js
      noNewCandidate,
```

When calling `nextTrackState()`, include:

```js
      noNewCandidate: manifest.noNewCandidate,
```

When appending history, include:

```js
    noNewCandidate: manifest.noNewCandidate,
```

- [ ] **Step 5: Run orchestration tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): mark no-new-candidate self-loop cycles"
```

---

## Task 5: Escalate to fallback before matrix if all selected candidates equal champion

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add pure helper for candidate selection**

In `scripts/pine-autoresearch.mjs`, export a helper near `buildScoutOrchestrationState()`:

```js
export function selectChangedMatrixCandidate({ candidates = [], championState = null } = {}) {
  const changed = candidates.filter((candidate) => !sameConfig(championState?.config, candidate?.challenger?.config));
  return selectRobustMatrixCandidate({ candidates: changed });
}
```

- [ ] **Step 2: Add helper tests**

Append to `tests/pine-autoresearch.test.mjs` import list:

```js
  selectChangedMatrixCandidate,
```

Add tests:

```js
test('selectChangedMatrixCandidate ignores unchanged champion candidates', () => {
  const championState = { config: { a: 1 } };
  const selected = selectChangedMatrixCandidate({
    championState,
    candidates: [
      { challenger: { configId: 'champion', config: { a: 1 } }, matrixDecision: { recommendation: 'hold' } },
      { challenger: { configId: 'changed', config: { a: 2 } }, matrixDecision: { recommendation: 'hold' }, robustness: { aggregateScoreDelta: -1 } },
    ],
  });

  assert.equal(selected.challenger.configId, 'changed');
});

test('selectChangedMatrixCandidate returns null when only champion is available', () => {
  const selected = selectChangedMatrixCandidate({
    championState: { config: { a: 1 } },
    candidates: [
      { challenger: { configId: 'champion', config: { a: 1 } }, matrixDecision: { recommendation: 'hold' } },
    ],
  });

  assert.equal(selected, null);
});
```

- [ ] **Step 3: Run tests to verify helper behavior**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass after helper is implemented and imported.

- [ ] **Step 4: Replace selection call in orchestration**

In `buildScoutOrchestrationState()`, replace:

```js
  const selectedCandidate = selectRobustMatrixCandidate({ candidates: matrixCandidates });
```

with:

```js
  const selectedCandidate = selectChangedMatrixCandidate({ candidates: matrixCandidates, championState });
```

Keep fallback:

```js
  const challengerSummary = selectedCandidate?.challenger || championSummary;
```

- [ ] **Step 5: Replace selection call in `runScout()`**

In `runScout()`, replace:

```js
  const selectedCandidate = selectRobustMatrixCandidate({ candidates: matrixCandidates });
```

with:

```js
  const selectedCandidate = selectChangedMatrixCandidate({ candidates: matrixCandidates, championState });
```

- [ ] **Step 6: Run tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 7: Commit**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): ignore champion when selecting matrix challenger"
```

---

## Task 6: Add a self-loop escape digest/history signal

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Test: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add digest test**

Append to existing `renderDigestMarkdown includes search-plan, shortlist summary, and rotation diagnostics` test or create new test:

```js
test('renderDigestMarkdown reports no-new-candidate self-loop state', () => {
  const markdown = renderDigestMarkdown({
    config: { matrixId: 'pine-fusion-v4-core-15m-locked-window', primaryLab: { labId: 'xrpusdt-15m-primary' }, shadowLabs: [{}, {}] },
    championState: { configId: 'champion', score: 145.42, roiPct: 84.66 },
    latestManifest: {
      runId: 'run-self-loop',
      champion: { configId: 'champion', score: 145.42, roiPct: 84.66, config: { minPredSum: 2 } },
      challenger: { configId: 'champion', score: 145.42, roiPct: 84.66, config: { minPredSum: 2 } },
      searchPlan: { variantCount: 3, exploitRatio: 0.8 },
      paretoShortlist: [{ configId: 'champion' }],
      matrixDecision: { recommendation: 'hold', failedGates: ['candidateChanged'], counts: { allPassCount: 0, totalLabs: 6, shadowPassRatio: 0 }, summary: 'No new candidate' },
      noNewCandidate: true,
      noNewCandidateStreak: 2,
      topCandidateSimilarity: 1,
      rotationTrigger: 'noveltySimilarity',
      sameTrackCycleStreak: 0,
      promotionEligible: false,
      promotionEligibleReason: 'No changed challenger',
    },
    previousManifest: null,
    historyEvents: [],
  });

  assert.match(markdown, /noNewCandidate: true/);
  assert.match(markdown, /noNewCandidateStreak: 2/);
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: fails until digest includes fields.

- [ ] **Step 3: Update manifest/history writing**

In `runScout()`, add scheduler streak into manifest track state:

```js
      noNewCandidateStreak: schedulerState.noNewCandidateStreak ?? 0,
```

In `buildScoutOrchestrationState()` manifest, add:

```js
      noNewCandidateStreak: trackState.noNewCandidateStreak ?? 0,
```

In `appendJsonl(historyPath(...))`, add:

```js
    noNewCandidateStreak: manifest.noNewCandidateStreak,
```

- [ ] **Step 4: Update digest renderer**

In `scripts/lib/pine-autoresearch.mjs`, inside `renderDigestMarkdown()`, add to rotation/search diagnostics section:

```js
    `- noNewCandidate: ${Boolean(latestManifest.noNewCandidate)}`,
    `- noNewCandidateStreak: ${latestManifest.noNewCandidateStreak ?? 0}`,
```

- [ ] **Step 5: Run digest tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs
```

Expected: pass.

- [ ] **Step 6: Commit**

```powershell
git add scripts/lib/pine-autoresearch.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "chore(pine): expose self-loop diagnostics"
```

---

## Task 7: Run verification suite and one micro cycle

**Files:**
- No source changes unless tests reveal failures.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --test tests/pine-autoresearch-tracks.test.mjs tests/pine-track-generators.test.mjs tests/pine-autoresearch.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run full targeted suite**

Run:

```powershell
node --test (Get-ChildItem tests -Filter *.test.mjs | ForEach-Object { $_.FullName })
```

Expected: all pass. Current baseline before this plan was `127/127` passing.

- [ ] **Step 3: Run one micro autoresearch cycle**

Run:

```powershell
node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json --profile micro
```

Expected outcomes:

- If changed candidate exists:
  - latest manifest has `noNewCandidate: false`
  - `candidateFingerprint !== championFingerprint`
- If no changed candidate beats champion:
  - latest manifest has `noNewCandidate: true`
  - history includes `noNewCandidate: true`
  - scheduler `noNewCandidateStreak` increments
  - next search plan should show fallback/self-loop escalation candidates.

- [ ] **Step 4: Inspect latest manifest**

Run:

```powershell
node -e "const fs=require('fs'); const latest=JSON.parse(fs.readFileSync('pine/autoresearch/pine-fusion-v4-core-15m-locked-window/latest.json','utf8')); console.log(JSON.stringify({runId:latest.runId,noNewCandidate:latest.noNewCandidate,noNewCandidateStreak:latest.noNewCandidateStreak,candidateChanged:latest.matrixDecision?.gates?.candidateChanged,candidateFingerprint:latest.candidateFingerprint,championFingerprint:latest.championFingerprint,variantCount:latest.searchPlan?.variantCount,failed:latest.matrixDecision?.failedGates},null,2));"
```

Expected: values clearly distinguish changed-candidate cycle vs no-new-candidate self-loop cycle.

- [ ] **Step 5: Commit verification notes if docs updated**

If no docs changed, skip commit. If updating operator docs, commit:

```powershell
git add docs/2026-04-29-pine-autoresearch-anti-curvefit.md
git commit -m "docs(pine): document self-loop escape behavior"
```

---

## Task 8: Optional disk guard follow-up

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Optional docs: `docs/2026-04-29-pine-autoresearch-anti-curvefit.md`

This task is optional but recommended because current evaluation retention keeps 8 runs at ~1.35 GB each (~10.8 GB total).

- [ ] **Step 1: Reduce retention if user approves**

Modify `config/pine-autoresearch.default.json`:

```json
  "retention": {
    "keepLatestRuns": 4,
    "pruneSweepRuns": true,
    "pruneEvaluationRuns": true,
    "prunePartialRuns": true
  },
```

- [ ] **Step 2: Run one cycle or explicit prune path**

Run a micro cycle or existing prune command path if available:

```powershell
node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json --profile micro
```

Expected: old evaluations pruned down toward 4 retained runs.

- [ ] **Step 3: Verify disk**

Run:

```powershell
Get-PSDrive D | Select-Object Name,@{n='UsedGB';e={[math]::Round($_.Used/1GB,2)}},@{n='FreeGB';e={[math]::Round($_.Free/1GB,2)}} | Format-Table -AutoSize
```

Expected: free space increases by roughly 5 GB after old evaluation runs are removed.

---

## Self-Review

- Spec coverage: plan addresses champion self-loop detection, scheduler memory, fallback exploration, matrix challenger selection, diagnostics, tests, and verification.
- Placeholder scan: no `TBD`, no vague “add tests” without code, no undefined helper without task.
- Type consistency: uses existing names (`candidateFingerprint`, `championFingerprint`, `matrixDecision`, `searchPlan`, `schedulerState`) and introduces explicit new fields (`noNewCandidate`, `noNewCandidateStreak`, `lastNoNewCandidateAt`).
- Risk: forced robust-shadow promotion made champion lower on primary; this plan does not undo that decision. It only prevents the research loop from wasting cycles validating the same champion.
