# Autoresearch Tabu Saturation and Escape Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the Pine autoresearch scout so it stops losing scheduled cycles, stops drowning in tabu fingerprints after a few cycles with an unchanged champion, and genuinely escalates stagnation when the search surface is exhausted, without changing promotion gate semantics.

**Architecture:** Seven independent fixes layered over the existing `scripts/pine-autoresearch.mjs` + `scripts/lib/pine-search-policy.mjs` + `scripts/lib/pine-autoresearch-tracks.mjs` + `scripts/lib/pine-stagnation-escape.mjs` pipeline. Each task is TDD: failing test first, minimal fix, green test, commit. No changes to gate thresholds, lab geometry, or promotion rules — those are addressed by a follow-up calibration plan.

**Tech Stack:** Node.js (ESM, v24), native `node:test` runner, existing fixtures in `tests/pine-*.test.mjs`, runtime artefacts under `pine/autoresearch/<matrixId>/`.

---

## Context (required reading before starting Task 1)

This plan fixes regressions discovered **after** the incumbent-unwrap fix (`5c26116`) landed on `main` on 2026-05-12. The unwrap fix made generated variants real (they actually patch Pine source now). That surfaced four downstream bugs that were previously masked by the fact that variants were semantically identical to champion:

1. **Tabu poisoning.** Real variants produce real fingerprints. Gate-failing variants get added to `schedulerState.tabuRejectedFingerprints` and stay there for up to 20 cycles. The exploit pool (`signalPatches` + `riskPatches` in `scripts/lib/pine-search-policy.mjs:240-268`) is 22 candidates total. After one cycle with 77 tabu additions (cycle 58 on 2026-05-12), the pool is effectively dead. Variant count collapses: 8 → 3 → 2 → 0 across four cycles.

2. **0-variant crash.** When tabu eats every candidate, `buildIncumbentSearchBatch` returns `[]`. `runPrimarySweep` (`scripts/pine-autoresearch.mjs:2563-2610`) runs the sweep child process, which emits no `leaderboard.json`, then the parent reads `leaderboard.json` unconditionally at line 2601, throws `ENOENT`, loses the cycle, writes only `incomplete/<runId>.json`.

3. **Stagnation never escalates.** `decideStagnationEscapePlan` in `scripts/lib/pine-autoresearch-tracks.mjs:402-460` escalates on `noNewCandidateStreak >= 3` or `noChangeStreak >= 5` + high similarity. Both streaks reset when the exploit lane emits even one variant, so escalation never fires. `stagnationLevel: 1` has been unchanged since 2026-05-11.

4. **Track rotation noise.** Exploit perturbations producing `topCandidateSimilarity > 0.98` trigger `rotationTrigger: noveltySimilarity` (`scripts/lib/pine-autoresearch-tracks.mjs:380-381`) every cycle, resetting `sameTrackCycleStreak`. This feeds back into (3) — escalation is blocked.

Secondary bugs:

5. **`allCandidatesTabu` underreporting.** `buildSearchEfficiency` at `scripts/pine-autoresearch.mjs:1274-1291` only sets `allCandidatesTabu: true` when a variant in the batch carries an `allCandidatesTabu` flag AND the emitted count is 0. When the pool is deeply tabu-saturated (e.g. 2 survivors out of 22), the flag stays false and escalation gets no signal.

6. **Stale tabu entries from prior champions.** `pruneTabuFingerprints` (`scripts/lib/pine-autoresearch-tracks.mjs:120-157`) already drops entries whose `championFingerprint` differs from the current champion, but only when `dropOnChampionChange: true`. `resolveTabuMergePolicy` defaults it to `true` but `tabuBootstrapManifestLimit: 200` in `config/pine-autoresearch.default.json` means bootstrap can re-seed old entries. Needs verification.

7. **Small hardcoded patch pools.** 22 candidates in two families is structurally insufficient for cycles running hourly against one champion. Even with perfect tabu behaviour, the surface is too small.

## Files Overview

- **Modify:** `scripts/pine-autoresearch.mjs` — 0-variant guard in `runPrimarySweep`, improved `buildSearchEfficiency` exhaustion detection
- **Modify:** `scripts/lib/pine-search-policy.mjs` — expose emitted-count and exhaustion signal out of `buildIncumbentSearchBatch`, expand patch pools
- **Modify:** `scripts/lib/pine-autoresearch-tracks.mjs` — new escalation trigger on `lowEmissionStreak`, similarity-rotation guard
- **Modify:** `scripts/lib/pine-stagnation-escape.mjs` — consume new `lowEmissionStreak` signal
- **Modify:** `config/pine-autoresearch.default.json` — add `stagnation.lowEmissionEscalateAfter`, `rotationPolicy.similarityRotateMinEmitted`
- **Create:** `tests/pine-autoresearch-tabu-saturation.test.mjs` — integration tests for tabu saturation and escape
- **Modify:** `tests/pine-autoresearch.test.mjs` — 0-variant crash guard test
- **Modify:** `tests/pine-search-policy.test.mjs` — expanded pool size invariants, exhaustion flag propagation
- **Modify:** `tests/pine-autoresearch-tracks.test.mjs` — low-emission escalation trigger tests, similarity rotation guard tests

---
## Task 1: Guard `runPrimarySweep` against 0-variant cycles

**Why first:** This is the active P0. Every cycle where variant generation returns `[]` currently crashes with `ENOENT leaderboard.json` and loses a scheduler slot. Fix makes subsequent improvements observable (without this, the pipeline can't report the state changes the other tasks introduce).

**Files:**
- Modify: `scripts/pine-autoresearch.mjs` (function `runPrimarySweep`, lines 2563-2610)
- Modify: `tests/pine-autoresearch.test.mjs` (add test near existing sweep tests)

- [ ] **Step 1: Write the failing test**

Add to `tests/pine-autoresearch.test.mjs` (append as a new `test(...)` block):

```javascript
test('runPrimarySweep returns empty leaderboard without reading the file when no variants were written', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-zero-variant-'));
  const projectRoot = tmpRoot;
  const runId = 'pine-test-zero-variants-2026-05-12';
  const runDir = path.join(projectRoot, 'pine', 'sweeps', runId);
  await fs.mkdir(runDir, { recursive: true });
  const variantFile = path.join(projectRoot, 'variants.json');
  await fs.writeFile(variantFile, '[]', 'utf8');

  let sweepInvoked = false;
  const originalRunNode = globalThis.__pineTestRunNode;
  globalThis.__pineTestRunNode = async () => { sweepInvoked = true; };

  try {
    const result = await runPrimarySweep(
      {
        projectRoot,
        scriptPath: path.join(projectRoot, 'test.pine'),
        grid: 'phase3-core',
        minTrades: 10,
        primaryLab: { labId: 'xrp', symbol: 'XRPUSDT', timeframe: '15m', limit: 100, when: '2026-04-21T10:30:00Z' },
      },
      runId,
      { variantFilePath: variantFile }
    );

    assert.equal(sweepInvoked, false, 'child sweep must not run when variant file is empty');
    assert.deepEqual(result.topConfigs, []);
    assert.equal(result.best, null);
    assert.equal(result.totalCombos, 0);
  } finally {
    globalThis.__pineTestRunNode = originalRunNode;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch.test.mjs --test-name-pattern "empty leaderboard without reading the file"`
Expected: FAIL with `ENOENT: no such file or directory, open '.../leaderboard.json'` from the existing `readJson` call.

- [ ] **Step 3: Add the guard to `runPrimarySweep`**

In `scripts/pine-autoresearch.mjs`, locate the body of `runPrimarySweep` around lines 2563-2610. Before the `await runNode(sweepArgs, config.projectRoot);` call, resolve the variant count by reading the variant file when it's provided, and short-circuit when it is zero.

Replace the block:

```javascript
  if (config.pinnedData?.enabled) {
    sweepArgs.push('--no-cache', '--require-cache-complete', '--cache-root', config.pinnedData.cacheRoot, '--cache-exchange', config.pinnedData.exchangeName);
  }

  await runNode(sweepArgs, config.projectRoot);

  const runDir = path.resolve(config.projectRoot, 'pine', 'sweeps', runId);
  const leaderboard = await readJson(path.join(runDir, 'leaderboard.json'));

  return {
    runDir,
    gridName: config.grid,
    totalCombos,
    sweepOffset,
    topConfigs: (leaderboard.ranked || []).slice(0, 5).map((item) => summarizeResult(item)),
    best: leaderboard.ranked?.[0] || null,
  };
}
```

With:

```javascript
  if (config.pinnedData?.enabled) {
    sweepArgs.push('--no-cache', '--require-cache-complete', '--cache-root', config.pinnedData.cacheRoot, '--cache-exchange', config.pinnedData.exchangeName);
  }

  const runDir = path.resolve(config.projectRoot, 'pine', 'sweeps', runId);
  await fs.mkdir(runDir, { recursive: true });

  const resolvedVariantCount = await resolveVariantFileCount(variantFilePath);
  if (variantFilePath && resolvedVariantCount === 0) {
    await writeEmptyLeaderboard({
      runDir,
      runId,
      reason: 'no-variants-generated',
      gridName: config.grid,
      totalCombos: 0,
      sweepOffset,
    });
    return {
      runDir,
      gridName: config.grid,
      totalCombos: 0,
      sweepOffset,
      topConfigs: [],
      best: null,
      skipped: true,
      skipReason: 'no-variants-generated',
    };
  }

  await runNode(sweepArgs, config.projectRoot);

  const leaderboard = await readJson(path.join(runDir, 'leaderboard.json'));

  return {
    runDir,
    gridName: config.grid,
    totalCombos,
    sweepOffset,
    topConfigs: (leaderboard.ranked || []).slice(0, 5).map((item) => summarizeResult(item)),
    best: leaderboard.ranked?.[0] || null,
  };
}

async function resolveVariantFileCount(variantFilePath) {
  if (!variantFilePath) return null;
  try {
    const raw = await fs.readFile(variantFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

async function writeEmptyLeaderboard({ runDir, runId, reason, gridName, totalCombos, sweepOffset }) {
  const payload = {
    meta: {
      runId,
      gridName,
      totalCombos,
      sweepOffset,
      resultCount: 0,
      skipReason: reason,
      generatedAt: new Date().toISOString(),
    },
    ranked: [],
    skipped: true,
  };
  await fs.writeFile(path.join(runDir, 'leaderboard.json'), JSON.stringify(payload, null, 2), 'utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pine-autoresearch.test.mjs --test-name-pattern "empty leaderboard without reading the file"`
Expected: PASS.

- [ ] **Step 5: Run full hardening suite**

Run: `npm run test:pine:autoresearch:hardening`
Expected: `pass 265` (one new test, all previously passing still pass), `fail 0`, `skipped 1`.

- [ ] **Step 6: Commit**

```bash
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "fix(pine): short-circuit runPrimarySweep when variant file is empty

When the scout generates zero variants (tabu saturation, no-enabled-lane,
or exhausted surface), the child sweep process emits no leaderboard.json.
The parent then crashed on readJson(leaderboard.json), losing the scheduled
cycle and leaving only incomplete/<runId>.json.

This writes a zeroed leaderboard.json + returns a skipped result so the
upstream manifest builder sees an honest no-candidate cycle instead of
ENOENT. No behavior change when variant file has entries."
```

---

## Task 2: Expose real tabu exhaustion from `buildIncumbentSearchBatch`

**Why:** The stagnation escape machinery already looks at `searchEfficiency.allCandidatesTabu` and `searchEfficiency.emittedVariantCount === 0` (see `resolveSearchEfficiencyExploitExhausted` at `scripts/pine-autoresearch.mjs:1298-1311`). But the signal never fires today because `buildIncumbentSearchBatch` returns successfully-picked variants with no metadata about how many candidates were rejected by tabu. Even when the pool is nearly dead, the caller thinks everything is fine. This task emits an honest exhaustion signal when the tabu set swallows a configurable fraction of the pool.

**Files:**
- Modify: `scripts/lib/pine-search-policy.mjs` (functions `pickNonTabuVariant` at lines ~180-230 and `buildIncumbentSearchBatch` at lines 314-386)
- Modify: `scripts/pine-autoresearch.mjs` (`buildSearchEfficiency` at lines 1274-1291)
- Modify: `tests/pine-search-policy.test.mjs` (add tests near existing `buildIncumbentSearchBatch` coverage)

### Acceptance signals

- When tabu-rejection count >= `poolExhaustionRatio * totalPoolSize` (default 0.75) for both exploit families, `searchEfficiency.allCandidatesTabu === true` AND `searchEfficiency.exhaustedFamilies` contains `['signal', 'risk']` regardless of emitted count.
- When emitted count is 0 purely because of tabu, same flags.
- When emitted count is full, flags stay false.

### Step 1: Failing test in `tests/pine-search-policy.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/pine-search-policy.test.mjs`:

```javascript
test('buildIncumbentSearchBatch reports tabu exhaustion when >75% of pool is rejected', () => {
  const base = buildBaselineConfig();
  const poolSample = [
    ...signalPatchCandidatesForTest(base),
    ...riskPatchCandidatesForTest(base),
  ];
  const tabuFingerprints = poolSample
    .slice(0, Math.ceil(poolSample.length * 0.9))
    .map((candidate) => configFingerprint({ ...base, ...candidate }));

  const batch = buildIncumbentSearchBatch({
    incumbent: base,
    maxConfigs: 8,
    historyEvents: [],
    policy: { testedCandidateFingerprints: tabuFingerprints, exploitRatio: 0.5 },
    schedulerState: { tabuRejectedFingerprints: tabuFingerprints.map((fingerprint) => ({ fingerprint })) },
  });

  const exhaustion = batch.filter((variant) => variant?.metadata?.exhaustedFamily);
  assert.ok(exhaustion.length > 0, 'at least one family should emit an exhaustion marker');
  assert.ok(
    exhaustion.some((variant) => variant.metadata.exhaustedFamily === 'signal' || variant.metadata.exhaustedFamily === 'risk'),
    'exhaustion marker should identify the saturated family',
  );
  assert.ok(
    batch.some((variant) => variant?.metadata?.allCandidatesTabu === true),
    'at least one marker should set allCandidatesTabu so downstream escalation fires',
  );
});
```

Requires two helpers you will add in the same test file if they don't exist (match existing patterns near the top of the file):

```javascript
function buildBaselineConfig() {
  return {
    adxThreshold: 20,
    minPredSum: 1.8,
    minBarsBetween: 1,
    slAtrMult: 0.5,
    tpAtrMult: 7.6,
    trailAtrMult: 1,
    trailActivateR: 0.5,
    riskAtrLen: 14,
    neighborsCount: 32,
    h: 8,
    r: 8,
    x: 25,
    useTrendXConf: true,
    useSignalFusion: true,
    useFusionV4: true,
    useTrailingStop: true,
    useStopsTP: true,
  };
}

function signalPatchCandidatesForTest(base) {
  return [
    { neighborsCount: Math.max(12, (base.neighborsCount || 32) - 8) },
    { neighborsCount: (base.neighborsCount || 32) + 8 },
    { adxThreshold: Math.max(10, (base.adxThreshold || 20) - 5) },
    { adxThreshold: (base.adxThreshold || 20) + 5 },
    { minPredSum: Math.max(1, (base.minPredSum || 2) - 0.5) },
    { minPredSum: (base.minPredSum || 2) + 0.5 },
    { minBarsBetween: Math.max(0, (base.minBarsBetween || 2) - 1) },
    { minBarsBetween: (base.minBarsBetween || 2) + 2 },
    { h: Math.max(4, (base.h || 8) - 2) },
    { h: (base.h || 8) + 2 },
    { r: Math.max(2, (base.r || 8) / 2) },
    { x: Math.max(15, (base.x || 25) - 5) },
  ];
}

function riskPatchCandidatesForTest(base) {
  return [
    { slAtrMult: Math.max(0.75, (base.slAtrMult || 1) - 0.25) },
    { slAtrMult: (base.slAtrMult || 1) + 0.25 },
    { tpAtrMult: Math.max(1.5, (base.tpAtrMult || 2.5) - 0.5) },
    { tpAtrMult: (base.tpAtrMult || 2.5) + 0.5 },
    { trailAtrMult: Math.max(0.75, (base.trailAtrMult || 1) - 0.25) },
    { trailAtrMult: (base.trailAtrMult || 1) + 0.25 },
    { trailActivateR: Math.max(0, (base.trailActivateR || 0.5) - 0.5) },
    { trailActivateR: (base.trailActivateR || 0.5) + 0.5 },
    { riskAtrLen: Math.max(7, (base.riskAtrLen || 14) - 7) },
    { riskAtrLen: (base.riskAtrLen || 14) + 7 },
  ];
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-search-policy.test.mjs --test-name-pattern "reports tabu exhaustion"`
Expected: FAIL — no variant carries `metadata.exhaustedFamily` or `metadata.allCandidatesTabu`.

- [ ] **Step 3: Emit exhaustion markers from the picker**

In `scripts/lib/pine-search-policy.mjs`, update `pickNonTabuVariant` and `buildIncumbentSearchBatch`.

First, in `pickNonTabuVariant`, ensure the returned object includes both `tabuSkippedCount` and `poolSize` so the caller can decide exhaustion:

Locate the existing final return (the one that says `return { variant: null, nextIndex: ..., tabuSkipped, exhausted: true };`) and add a `poolSize` field:

```javascript
return {
  variant: null,
  nextIndex: startIndex + pool.length,
  tabuSkipped,
  exhausted: true,
  poolSize: pool.length,
};
```

Also in the successful-pick return higher up (where `return { variant, nextIndex, tabuSkipped, exhausted: false };` is emitted), add the same field:

```javascript
return {
  variant,
  nextIndex,
  tabuSkipped,
  exhausted: false,
  poolSize: pool.length,
};
```

Then in `buildIncumbentSearchBatch`, after the two for-loops (just before `return batch;`) add the exhaustion-marker logic:

```javascript
  const poolSizes = {
    signal: familyPatchMap.signal.length,
    risk: familyPatchMap.risk.length,
  };
  const familyTabuRejects = {
    signal: 0,
    risk: 0,
  };
  for (const variant of batch) {
    if (!variant) continue;
    const family = variant.family;
    if (family in familyTabuRejects) {
      familyTabuRejects[family] += Number(variant.tabuSkipped) || 0;
    }
  }
  const poolExhaustionRatio = Number.isFinite(Number(policy.poolExhaustionRatio))
    ? Number(policy.poolExhaustionRatio)
    : 0.75;
  const exhaustedFamilies = ['signal', 'risk'].filter((family) => {
    const size = poolSizes[family];
    if (!size) return false;
    const rejects = familyTabuRejects[family];
    return rejects >= Math.ceil(size * poolExhaustionRatio);
  });
  if (exhaustedFamilies.length > 0) {
    batch.push({
      metadata: {
        exhaustedFamily: exhaustedFamilies.length === 2 ? 'signal' : exhaustedFamilies[0],
        allCandidatesTabu: batch.length === 0,
        poolExhaustionRatio,
        exhaustedFamilies,
      },
      exhaustedFamily: exhaustedFamilies.length === 2 ? 'signal' : exhaustedFamilies[0],
      allCandidatesTabu: batch.length === 0,
      lane: 'exhaustion',
      family: 'incumbent-search',
    });
  }
  return batch;
```

- [ ] **Step 4: Update `buildSearchEfficiency` to aggregate the markers**

In `scripts/pine-autoresearch.mjs` around lines 1274-1291, replace the body of `buildSearchEfficiency` with:

```javascript
function buildSearchEfficiency(searchBatch = [], options = {}) {
  const variants = Array.isArray(searchBatch) ? searchBatch : [];
  const emittedVariants = variants.filter((variant) => Boolean(variant) && !variant?.exhaustedFamily && variant?.lane !== 'exhaustion');
  const familyExhaustion = variants
    .filter((variant) => variant?.exhaustedFamily || variant?.metadata?.exhaustedFamily)
    .flatMap((variant) => {
      const list = Array.isArray(variant?.metadata?.exhaustedFamilies) ? variant.metadata.exhaustedFamilies : null;
      if (list && list.length) return list;
      return [variant.exhaustedFamily || variant.metadata?.exhaustedFamily].filter(Boolean);
    });
  const exhaustedFamilies = uniqueStrings([
    ...familyExhaustion,
    ...(Array.isArray(options.exhaustedFamilies) ? options.exhaustedFamilies : []),
  ]);
  const markerAllCandidatesTabu = variants.some((variant) => variant?.allCandidatesTabu === true || variant?.metadata?.allCandidatesTabu === true);
  const allCandidatesTabu = options.allCandidatesTabu === true
    || (emittedVariants.length === 0 && (markerAllCandidatesTabu || exhaustedFamilies.length > 0));
  const efficiency = {
    variantCount: variants.length,
    emittedVariantCount: emittedVariants.length,
    exhaustedFamilies,
    allCandidatesTabu,
  };
  if (options.exhaustionReason) efficiency.exhaustionReason = options.exhaustionReason;
  if (options.exhaustionSource) efficiency.exhaustionSource = options.exhaustionSource;
  return efficiency;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/pine-search-policy.test.mjs --test-name-pattern "reports tabu exhaustion"`
Expected: PASS.

- [ ] **Step 6: Run full hardening and unit suites**

Run: `npm run test:pine:autoresearch:hardening`
Expected: `fail 0`. If the emitted-variant detection broke any existing test (because the new marker changes `variantCount`), inspect and update the offending test to count only `variant.lane !== 'exhaustion'` entries. Record the adjusted test in Step 7's commit message.

Run: `npm test -- --test-name-pattern buildSearchEfficiency`
Expected: `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-search-policy.mjs scripts/pine-autoresearch.mjs tests/pine-search-policy.test.mjs
git commit -m "feat(pine): emit honest tabu exhaustion signal from incumbent search

buildIncumbentSearchBatch now counts tabu rejections per family and appends
a synthetic exhaustion marker when either family rejects >= 75% of its pool.
buildSearchEfficiency aggregates the marker so searchEfficiency.allCandidatesTabu
and searchEfficiency.exhaustedFamilies become truthful when the exploit lane
is effectively dead. Downstream stagnation escape already keys on these
fields; this task makes the signal reach it."
```

---

## Task 3: Add `lowEmissionStreak` escalation trigger

**Why:** With Task 2 landed, `searchEfficiency.allCandidatesTabu` becomes truthful. But `decideStagnationEscapePlan` (`scripts/lib/pine-autoresearch-tracks.mjs:402-460`) only escalates on `noNewCandidateStreak` or `noChangeStreak + highSimilarity`. Neither triggers when variants keep trickling out at 1-3 per cycle. This task adds a third, independent trigger: when the emitted variant count stays below a threshold for N consecutive cycles, escalate regardless of other streaks.

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs` (`decideStagnationEscapePlan` body and `STAGNATION_POLICY_KEYS` list around line 55)
- Modify: `scripts/lib/pine-stagnation-escape.mjs` (add `lowEmissionStreak` parameter forwarding)
- Modify: `scripts/pine-autoresearch.mjs` (track and persist `lowEmissionStreak` across cycles, ~line 1564 where `noNewCandidateStreak` is persisted)
- Modify: `config/pine-autoresearch.default.json` (add `lowEmissionEscalateAfter` and `lowEmissionThreshold`)
- Modify: `tests/pine-autoresearch-tracks.test.mjs` (new test cases for the trigger)

### Acceptance signals

- After 3 consecutive cycles where `searchEfficiency.emittedVariantCount <= lowEmissionThreshold` (default 3), `stagnationLevel` increments.
- `lowEmissionStreak` resets to 0 on a cycle where emitted count exceeds the threshold OR when `promotionEligible === true`.
- `lowEmissionStreak` persists across cycles in the scheduler state file.

- [ ] **Step 1: Add the policy keys**

In `config/pine-autoresearch.default.json`, locate the `rotationPolicy.stagnation` block and add two keys. Current block:

```json
    "stagnation": {
      "enabled": true,
      "noNewCandidateEscalateAfter": 2,
      "holdEscalateAfter": 3,
      "highSimilarityThreshold": 0.8,
      "maxStagnationLevel": 2
    }
```

Replace with:

```json
    "stagnation": {
      "enabled": true,
      "noNewCandidateEscalateAfter": 2,
      "holdEscalateAfter": 3,
      "highSimilarityThreshold": 0.8,
      "maxStagnationLevel": 2,
      "lowEmissionEscalateAfter": 3,
      "lowEmissionThreshold": 3
    }
```

- [ ] **Step 2: Write the failing test**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```javascript
test('decideStagnationEscapePlan escalates after lowEmissionStreak meets threshold', () => {
  const result = decideStagnationEscapePlan({
    previousLevel: 0,
    noNewCandidateStreak: 0,
    noChangeStreak: 0,
    topCandidateSimilarity: 0.5,
    promotionEligible: false,
    lowEmissionStreak: 3,
    policy: {
      noNewCandidateEscalateAfter: 2,
      holdEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 2,
      lowEmissionEscalateAfter: 3,
      lowEmissionThreshold: 3,
    },
  });
  assert.equal(result.stagnationLevel, 1);
  assert.equal(result.stagnationReason, 'lowEmissionStreak');
});

test('decideStagnationEscapePlan does not escalate when lowEmissionStreak is below threshold', () => {
  const result = decideStagnationEscapePlan({
    previousLevel: 0,
    noNewCandidateStreak: 0,
    noChangeStreak: 0,
    topCandidateSimilarity: 0.5,
    promotionEligible: false,
    lowEmissionStreak: 2,
    policy: {
      noNewCandidateEscalateAfter: 2,
      holdEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 2,
      lowEmissionEscalateAfter: 3,
      lowEmissionThreshold: 3,
    },
  });
  assert.equal(result.stagnationLevel, 0);
  assert.equal(result.stagnationReason, null);
});

test('decideStagnationEscapePlan resets stagnation when promotion becomes eligible regardless of lowEmissionStreak', () => {
  const result = decideStagnationEscapePlan({
    previousLevel: 2,
    noNewCandidateStreak: 0,
    noChangeStreak: 0,
    topCandidateSimilarity: 0.5,
    promotionEligible: true,
    lowEmissionStreak: 10,
    policy: {
      noNewCandidateEscalateAfter: 2,
      holdEscalateAfter: 3,
      highSimilarityThreshold: 0.8,
      maxStagnationLevel: 2,
      lowEmissionEscalateAfter: 3,
      lowEmissionThreshold: 3,
    },
  });
  assert.equal(result.stagnationLevel, 0);
  assert.equal(result.stagnationReason, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "lowEmissionStreak"`
Expected: FAIL — `lowEmissionStreak` parameter unused and `stagnationReason` never `lowEmissionStreak`.

- [ ] **Step 4: Extend `decideStagnationEscapePlan`**

In `scripts/lib/pine-autoresearch-tracks.mjs`:

1. Add `'lowEmissionEscalateAfter'` and `'lowEmissionThreshold'` to the `STAGNATION_POLICY_KEYS` array (around line 55 where `'noNewCandidateEscalateAfter'` and `'holdEscalateAfter'` are listed).

2. Update the function signature and internals. Find the function that begins `export function decideStagnationEscapePlan({ ... } = {})` near line 397. The current destructuring lists `previousLevel`, `noNewCandidateStreak`, `noChangeStreak`, `topCandidateSimilarity`, `promotionEligible`, `policy`. Add `lowEmissionStreak = 0` to the destructure:

```javascript
export function decideStagnationEscapePlan({
  previousLevel = 0,
  noNewCandidateStreak = 0,
  noChangeStreak = 0,
  topCandidateSimilarity = null,
  promotionEligible = false,
  lowEmissionStreak = 0,
  policy = {},
} = {}) {
```

3. Below the existing `noNewCandidateEscalateAfter` and `holdEscalateAfter` normalization, add:

```javascript
  const lowEmissionEscalateAfter = normalizeNumericPolicyInteger(sourcePolicy.lowEmissionEscalateAfter, { fallback: 3, min: 1 });
```

4. The function already constructs a `candidates` array of `{reason, anchor, threshold, active}` objects. Add a third entry to that array:

```javascript
    {
      reason: 'lowEmissionStreak',
      anchor: Math.max(0, Math.floor(Number.isFinite(Number(lowEmissionStreak)) ? Number(lowEmissionStreak) : 0)),
      threshold: lowEmissionEscalateAfter,
      active: promotionEligible === false
        && Math.max(0, Math.floor(Number.isFinite(Number(lowEmissionStreak)) ? Number(lowEmissionStreak) : 0)) >= lowEmissionEscalateAfter,
    },
```

The existing `.find((candidate) => candidate.active)` pattern will pick it up.

- [ ] **Step 5: Thread `lowEmissionStreak` through `resolveScoutStagnationEscape`**

In `scripts/pine-autoresearch.mjs`, locate `resolveScoutStagnationEscape` around line 1314. It takes `schedulerState`, `championState`, `latestManifest`. The latest manifest already contains `searchEfficiency.emittedVariantCount`. Compute `lowEmissionStreak` there:

Find the existing body and add just before the call to `decideStagnationEscapePlan` (or wherever the plan is resolved):

```javascript
const lowEmissionThreshold = Number.isFinite(Number(schedulerState?.stagnationPolicy?.lowEmissionThreshold))
  ? Number(schedulerState.stagnationPolicy.lowEmissionThreshold)
  : 3;
const lastEmittedCount = Number(latestManifest?.searchEfficiency?.emittedVariantCount);
const priorLowEmissionStreak = Number(schedulerState?.lowEmissionStreak) || 0;
const lowEmissionStreak = Number.isFinite(lastEmittedCount) && lastEmittedCount <= lowEmissionThreshold
  ? priorLowEmissionStreak + 1
  : 0;
```

Pass `lowEmissionStreak` into the downstream `decideStagnationEscapePlan` call. Then ensure the streak is persisted back into `schedulerState` in the manifest writer (look for the location where `noNewCandidateStreak` is written around line 1564; mirror the pattern for `lowEmissionStreak`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "lowEmissionStreak|promotion becomes eligible"`
Expected: PASS on all three new tests.

Run: `npm test -- --test-name-pattern decideStagnationEscapePlan`
Expected: all existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs config/pine-autoresearch.default.json tests/pine-autoresearch-tracks.test.mjs
git commit -m "feat(pine): escalate stagnation when emission stays low for N cycles

Add lowEmissionStreak as a third independent escalation trigger alongside
noNewCandidateStreak and noChangeStreak+highSimilarity. The existing triggers
reset whenever the exploit lane emits even one variant, so a pool that is
80% tabu-saturated never escalates. The new trigger counts cycles where
emittedVariantCount stays <= lowEmissionThreshold (default 3), and escalates
after lowEmissionEscalateAfter (default 3) such cycles.

Resets on promotion-eligible cycles, just like the existing triggers."
```

---

## Task 4: Guard track rotation against exploit-perturbation similarity

**Why:** `detectRotationTrigger` in `scripts/lib/pine-autoresearch-tracks.mjs` (around line 380) rotates tracks when `topCandidateSimilarity > similarityRotateAbove`. Exploit variants that only perturb one knob by one step routinely produce `similarity > 0.98` against champion (observed: cycle 59 rotated `divergence-context` -> `squeeze-context` on similarity 0.981 from a `trailActivateR: 0.7` variant). This rotation resets `sameTrackCycleStreak`, which was a side-channel the old stagnation triggers relied on. Now that Task 3 introduces an independent `lowEmissionStreak`, rotation-on-similarity is also safe to tighten. Goal: only rotate on similarity when the lane is also actually short on candidates.

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs` (`detectRotationTrigger` function near line 355-390, and associated policy-field plumbing)
- Modify: `config/pine-autoresearch.default.json` (add `rotationPolicy.similarityRotateMinEmitted`)
- Modify: `tests/pine-autoresearch-tracks.test.mjs` (new tests for the guard)

### Acceptance signals

- When `topCandidateSimilarity > similarityRotateAbove` AND `emittedVariantCount >= similarityRotateMinEmitted` (default 4), rotation trigger is `null` (no rotation).
- When `topCandidateSimilarity > similarityRotateAbove` AND `emittedVariantCount < similarityRotateMinEmitted`, rotation trigger remains `noveltySimilarity` (preserving existing behaviour for the genuinely-stuck case).
- Other rotation triggers (`noChangeStreak`, `maxCyclesPerTrack`, explicit `manifest.rotationTrigger`) are unchanged.

- [ ] **Step 1: Add the policy key**

In `config/pine-autoresearch.default.json` under `rotationPolicy`, add `similarityRotateMinEmitted`. Current block:

```json
  "rotationPolicy": {
    "noChangeStreakRotateAfter": 32,
    "noNoveltyRotateAfter": 1,
    "maxCyclesPerTrack": 63,
    "preferCurrentChampionUntil": 2,
    "cooldownCyclesAfterPromote": 1,
    "tabuLimit": 1000,
    "tabuBootstrapManifestLimit": 200,
    "stagnation": { ... }
  },
```

Add `"similarityRotateMinEmitted": 4,` and `"similarityRotateAbove": 0.98,` so the threshold is explicit in config rather than hard-coded in `detectRotationTrigger`:

```json
  "rotationPolicy": {
    "noChangeStreakRotateAfter": 32,
    "noNoveltyRotateAfter": 1,
    "maxCyclesPerTrack": 63,
    "preferCurrentChampionUntil": 2,
    "cooldownCyclesAfterPromote": 1,
    "tabuLimit": 1000,
    "tabuBootstrapManifestLimit": 200,
    "similarityRotateAbove": 0.98,
    "similarityRotateMinEmitted": 4,
    "stagnation": { ... }
  },
```

- [ ] **Step 2: Write the failing test**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```javascript
test('detectRotationTrigger does not rotate on high similarity when emission is healthy', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 6 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, null);
});

test('detectRotationTrigger rotates on high similarity when emission is low', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 2 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, 'noveltySimilarity');
});

test('detectRotationTrigger preserves explicit manifest.rotationTrigger regardless of emission', () => {
  const trigger = detectRotationTrigger({
    manifest: {
      rotationTrigger: 'noChangeStreak',
      topCandidateSimilarity: 0.985,
      searchEfficiency: { emittedVariantCount: 10 },
    },
    policy: {
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
    },
  });
  assert.equal(trigger, 'noChangeStreak');
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "detectRotationTrigger does not rotate on high similarity when emission is healthy"`
Expected: FAIL — current `detectRotationTrigger` returns `'noveltySimilarity'` whenever similarity crosses the threshold, no emission guard.

- [ ] **Step 4: Add the emission guard**

In `scripts/lib/pine-autoresearch-tracks.mjs`, find `detectRotationTrigger` near line 355. The current relevant block:

```javascript
  if (Number.isFinite(manifest.topCandidateSimilarity) && manifest.topCandidateSimilarity > similarityRotateAbove) {
    return 'noveltySimilarity';
  }
```

Replace with:

```javascript
  const similarityRotateMinEmitted = Number.isFinite(Number(policy?.similarityRotateMinEmitted))
    ? Math.max(0, Math.floor(Number(policy.similarityRotateMinEmitted)))
    : 4;
  const emittedCount = Number(manifest?.searchEfficiency?.emittedVariantCount);
  const emissionBelowGuard = !Number.isFinite(emittedCount) || emittedCount < similarityRotateMinEmitted;
  if (
    Number.isFinite(manifest.topCandidateSimilarity)
    && manifest.topCandidateSimilarity > similarityRotateAbove
    && emissionBelowGuard
  ) {
    return 'noveltySimilarity';
  }
```

Also make sure `similarityRotateAbove` is read from `policy.similarityRotateAbove` rather than a constant (if it currently isn't). Find the line that resolves `similarityRotateAbove` near the top of `detectRotationTrigger` and ensure it's:

```javascript
const similarityRotateAbove = Number.isFinite(Number(policy?.similarityRotateAbove))
  ? Number(policy.similarityRotateAbove)
  : 0.98;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "detectRotationTrigger"`
Expected: PASS on all three new tests and all existing tests.

Run: `npm run test:pine:autoresearch:hardening`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs config/pine-autoresearch.default.json tests/pine-autoresearch-tracks.test.mjs
git commit -m "fix(pine): do not rotate tracks on similarity while emission is healthy

Exploit perturbations of a stable champion routinely score similarity > 0.98,
which triggered track rotation every cycle and reset sameTrackCycleStreak.
Add a second condition: rotate on high similarity only when the lane also
emits fewer than similarityRotateMinEmitted variants (default 4). Preserves
existing rotation behaviour for the stuck case and for explicit manifest.rotationTrigger."
```

---

## Task 5: Tabu aging on escalation

**Why:** Even with Tasks 1-4 landed, the tabu set can fill legitimately over time. The existing policy prunes by `maxAgeCycles: 20` and `maxEntries` (via `pruneTabuFingerprints` in `scripts/lib/pine-autoresearch-tracks.mjs:120-157`), but 20 cycles is 20 hours on this scheduler, and `tabuLimit: 1000` from config allows the set to grow very large before entry-count pressure kicks in. When stagnation escalates, we want the search to actually try previously-rejected candidates again (they may now pass with a higher temperature, under widened frozen-key policy, or simply because cycles have drifted context). This task halves the effective `maxAgeCycles` whenever `stagnationLevel >= 1`, so escalation genuinely widens the search.

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs` (`resolveTabuPolicy` and `resolveTabuMergePolicy` at lines ~158-168)
- Modify: `scripts/pine-autoresearch.mjs` (call site for `pruneTabuFingerprints`, around line 1213)
- Modify: `tests/pine-autoresearch-tracks.test.mjs` (tests for stagnation-aware pruning)

### Acceptance signals

- Given a tabu set with entries at ages `[5, 12, 18, 25]` cycles and `stagnationLevel: 0`: entries with age > 20 are pruned -> set becomes `[5, 12, 18]`.
- Same set with `stagnationLevel: 1`: effective maxAge halves to 10 -> set becomes `[5]`.
- Same set with `stagnationLevel: 2`: effective maxAge quarters to 5 (floor at 2) -> set becomes `[]`.
- `maxEntries` still applies after stagnation-adjusted age filter.
- Fingerprints for the *current* champion fingerprint are retained with a stricter floor (`Math.max(2, floor)`) so we never drop every entry in one cycle.

- [ ] **Step 1: Write the failing test**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```javascript
test('pruneTabuFingerprints halves effective maxAgeCycles when stagnationLevel >= 1', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 45, championFingerprint },
    { fingerprint: 'fp-b', addedAtCycle: 38, championFingerprint },
    { fingerprint: 'fp-c', addedAtCycle: 32, championFingerprint },
    { fingerprint: 'fp-d', addedAtCycle: 25, championFingerprint },
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 1,
  });
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['fp-a']);
});

test('pruneTabuFingerprints at stagnationLevel 2 clears entries older than maxAge/4', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 48, championFingerprint },
    { fingerprint: 'fp-b', addedAtCycle: 44, championFingerprint },
    { fingerprint: 'fp-c', addedAtCycle: 40, championFingerprint },
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 20, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 2,
  });
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['fp-a', 'fp-b']);
});

test('pruneTabuFingerprints floors effective maxAgeCycles at 2 to avoid wiping everything', () => {
  const championFingerprint = '{"adxThreshold":20}';
  const entries = [
    { fingerprint: 'fp-a', addedAtCycle: 49, championFingerprint },
    { fingerprint: 'fp-b', addedAtCycle: 47, championFingerprint },
  ];
  const pruned = pruneTabuFingerprints({
    entries,
    currentCycle: 50,
    currentChampionFingerprint: championFingerprint,
    policy: { maxAgeCycles: 4, maxEntries: 32, dropOnChampionChange: true },
    stagnationLevel: 2,
  });
  assert.deepEqual(pruned.map((entry) => entry.fingerprint), ['fp-a', 'fp-b']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "pruneTabuFingerprints halves effective"`
Expected: FAIL — the test input currently returns four entries because `stagnationLevel` is ignored and age 5..25 are all within 20.

- [ ] **Step 3: Wire stagnationLevel into pruning**

In `scripts/lib/pine-autoresearch-tracks.mjs`, update `pruneTabuFingerprints` (around line 120):

Change the signature and body to accept a `stagnationLevel` and use it to scale `maxAgeCycles`:

```javascript
export function pruneTabuFingerprints(input = {}) {
  if (!isPlainObject(input)) return [];
  const entries = Array.isArray(input.entries) ? input.entries : [];
  const currentCycle = Number.isFinite(Number(input.currentCycle))
    ? Math.max(0, Math.floor(Number(input.currentCycle)))
    : 0;
  const currentChampionFingerprint = normalizeKnownFingerprint(input.currentChampionFingerprint);
  const policy = normalizeTabuPrunePolicy(input.policy);
  const stagnationLevel = Math.max(0, Math.floor(Number(input.stagnationLevel) || 0));
  const divisor = stagnationLevel >= 2 ? 4 : stagnationLevel >= 1 ? 2 : 1;
  const effectiveMaxAge = Math.max(2, Math.floor(policy.maxAgeCycles / divisor));
  const deduped = new Map();

  entries.forEach((entry, index) => {
    const normalized = normalizeTabuEntry(entry, { currentCycle, index });
    if (!normalized) return;
    if (
      policy.dropOnChampionChange
      && currentChampionFingerprint
      && normalized.championFingerprint
      && normalized.championFingerprint !== currentChampionFingerprint
    ) {
      return;
    }
    if (currentCycle - normalized.addedAtCycle > effectiveMaxAge) return;

    const existing = deduped.get(normalized.fingerprint);
    if (!existing
      || normalized.addedAtCycle > existing.addedAtCycle
      || (normalized.addedAtCycle === existing.addedAtCycle && normalized.index > existing.index)) {
      deduped.set(normalized.fingerprint, normalized);
    }
  });

  return [...deduped.values()]
    .sort((left, right) => (right.addedAtCycle - left.addedAtCycle) || (right.index - left.index))
    .slice(0, policy.maxEntries)
    .sort((left, right) => (left.addedAtCycle - right.addedAtCycle) || (left.index - right.index))
    .map(({ fingerprint, addedAtCycle, championFingerprint }) => ({ fingerprint, addedAtCycle, championFingerprint }));
}
```

- [ ] **Step 4: Pass stagnationLevel from the call site**

In `scripts/pine-autoresearch.mjs` around line 1213, locate the call to `pruneTabuFingerprints` in the tabu-merge helper. The current call probably looks like:

```javascript
    tabuRejectedFingerprints: pruneTabuFingerprints({
      entries: current.concat(next),
      currentCycle,
      currentChampionFingerprint,
      policy: resolveTabuMergePolicy({ policy, tabuLimit }),
    }),
```

Change to:

```javascript
    tabuRejectedFingerprints: pruneTabuFingerprints({
      entries: current.concat(next),
      currentCycle,
      currentChampionFingerprint,
      policy: resolveTabuMergePolicy({ policy, tabuLimit }),
      stagnationLevel: Number(schedulerState?.stagnationLevel) || 0,
    }),
```

If `schedulerState` is not in scope for that helper, pass `stagnationLevel` as an explicit argument into the helper and thread it up to the caller in `runScout` where `schedulerState.stagnationLevel` is available.

Do the same for the call inside `scripts/lib/pine-autoresearch-tracks.mjs` at line 546 (`const tabuRejectedFingerprints = pruneTabuFingerprints(...)`): accept `stagnationLevel` in the outer function's input and forward it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "pruneTabuFingerprints"`
Expected: PASS on all three new tests and all existing tests.

Run: `npm run test:pine:autoresearch:hardening`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-autoresearch-tracks.mjs scripts/pine-autoresearch.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "feat(pine): shrink tabu age horizon proportional to stagnation level

pruneTabuFingerprints now halves effective maxAgeCycles at stagnationLevel
1 and quarters it at stagnationLevel 2, with a floor of 2 cycles so the
set can never be wiped in a single call. This lets escalation genuinely
widen the search surface instead of merely announcing stagnation while
the tabu set keeps blocking the same candidates."
```

---

## Task 6: Widen exploit patch pools with temperature-scaled candidates

**Why:** After Tasks 1-5, the pipeline is honest about tabu saturation and can recover from it. But the underlying density problem remains: `signalPatches` has 12 candidates and `riskPatches` has 10. Even with perfect tabu aging, hourly cycles against a stable champion will exhaust this surface in days, not weeks. This task expands each family with temperature-aware variants that use finer and coarser step sizes, driven by the existing `annealing` policy (`scripts/lib/pine-search-policy.mjs:254-262`) and stagnation level. The pool grows from 22 to ~60 candidates without changing the base variants.

**Files:**
- Modify: `scripts/lib/pine-search-policy.mjs` (`signalPatches` and `riskPatches` at lines 240-268)
- Modify: `scripts/lib/pine-search-policy.mjs` (`buildIncumbentSearchBatch` to thread temperature into family patch construction)
- Modify: `tests/pine-search-policy.test.mjs` (invariants for pool size and diversity)

### Acceptance signals

- At baseline temperature (1.0), `signalPatches(base)` returns at least 18 candidates, `riskPatches(base)` at least 15.
- At stagnation-boosted temperature (4.0 per `stagnationFallbackFamilies` policy), returns at least 24 and 20 respectively.
- All generated candidates respect the existing `lowerBound` semantics from `pine-track-generators.mjs` style helpers: integer-like stays integer, no keys below 0, `neighborsCount` stays above 12.
- `configFingerprint` of any two generated variants within one family is distinct.

- [ ] **Step 1: Write the failing test**

Append to `tests/pine-search-policy.test.mjs`:

```javascript
test('signalPatches returns at least 18 distinct candidates at baseline temperature', () => {
  const base = buildBaselineConfig();
  const patches = signalPatches(base, { temperature: 1 });
  assert.ok(patches.length >= 18, `expected >=18, got ${patches.length}`);
  const fingerprints = new Set(patches.map((patch) => configFingerprint({ ...base, ...patch })));
  assert.equal(fingerprints.size, patches.length, 'patches must be distinct under configFingerprint');
});

test('signalPatches scales candidate count with temperature', () => {
  const base = buildBaselineConfig();
  const patches = signalPatches(base, { temperature: 4 });
  assert.ok(patches.length >= 24, `expected >=24 at temperature 4, got ${patches.length}`);
});

test('riskPatches returns at least 15 distinct candidates at baseline temperature', () => {
  const base = buildBaselineConfig();
  const patches = riskPatches(base, { temperature: 1 });
  assert.ok(patches.length >= 15, `expected >=15, got ${patches.length}`);
  const fingerprints = new Set(patches.map((patch) => configFingerprint({ ...base, ...patch })));
  assert.equal(fingerprints.size, patches.length);
});

test('riskPatches never produces invalid knob values', () => {
  const base = { ...buildBaselineConfig(), slAtrMult: 0.25, tpAtrMult: 1.5, riskAtrLen: 7, trailActivateR: 0 };
  const patches = riskPatches(base, { temperature: 4 });
  for (const patch of patches) {
    if ('slAtrMult' in patch) assert.ok(patch.slAtrMult >= 0.125, `slAtrMult ${patch.slAtrMult} below lower bound`);
    if ('tpAtrMult' in patch) assert.ok(patch.tpAtrMult >= 1.0, `tpAtrMult ${patch.tpAtrMult} below lower bound`);
    if ('riskAtrLen' in patch) assert.ok(patch.riskAtrLen >= 5, `riskAtrLen ${patch.riskAtrLen} below lower bound`);
    if ('trailActivateR' in patch) assert.ok(patch.trailActivateR >= 0, `trailActivateR negative`);
  }
});
```

Exports required: export `signalPatches` and `riskPatches` from `scripts/lib/pine-search-policy.mjs` if they aren't already. (Check the current file; they are defined as local functions today.)

Add to the bottom of `scripts/lib/pine-search-policy.mjs` if absent:

```javascript
export { signalPatches, riskPatches };
```

And at the top of the test file add the import:

```javascript
import { signalPatches, riskPatches, configFingerprint } from '../scripts/lib/pine-search-policy.mjs';
```

If `configFingerprint` is not exported from `pine-search-policy.mjs`, export it too or import from `pine-autoresearch.mjs` where it's defined.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/pine-search-policy.test.mjs --test-name-pattern "at least 18 distinct candidates|scales candidate count|at least 15 distinct"`
Expected: FAIL.

- [ ] **Step 3: Extend the patch pools**

Replace `signalPatches(base)` in `scripts/lib/pine-search-policy.mjs` with:

```javascript
function signalPatches(base, { temperature = 1 } = {}) {
  const safeTemp = Math.max(1, Number(temperature) || 1);
  const baseNeighbors = base.neighborsCount || 32;
  const baseAdx = base.adxThreshold || 20;
  const baseMinPred = base.minPredSum || 2;
  const baseBars = base.minBarsBetween || 2;
  const baseH = base.h || 8;
  const baseR = base.r || 8;
  const baseX = base.x || 25;
  const stepScales = safeTemp >= 3 ? [0.5, 1, 2, 3] : safeTemp >= 2 ? [0.5, 1, 2] : [0.5, 1];
  const patches = [];
  for (const scale of stepScales) {
    patches.push(
      { neighborsCount: Math.max(12, Math.round(baseNeighbors - 8 * scale)) },
      { neighborsCount: Math.round(baseNeighbors + 8 * scale) },
      { adxThreshold: Math.max(10, Math.round(baseAdx - 5 * scale)) },
      { adxThreshold: Math.round(baseAdx + 5 * scale) },
      { minPredSum: Math.max(1, Number((baseMinPred - 0.5 * scale).toFixed(2))) },
      { minPredSum: Number((baseMinPred + 0.5 * scale).toFixed(2)) },
      { minBarsBetween: Math.max(0, Math.round(baseBars - scale)) },
      { minBarsBetween: Math.round(baseBars + 2 * scale) },
      { h: Math.max(4, Math.round(baseH - 2 * scale)) },
      { h: Math.round(baseH + 2 * scale) },
      { r: Math.max(2, Number((baseR / (1 + scale)).toFixed(2))) },
      { x: Math.max(15, Math.round(baseX - 5 * scale)) },
    );
  }
  return deduplicatePatches(patches, base);
}
```

Replace `riskPatches(base)` with:

```javascript
function riskPatches(base, { temperature = 1 } = {}) {
  const safeTemp = Math.max(1, Number(temperature) || 1);
  const baseSl = base.slAtrMult || 1;
  const baseTp = base.tpAtrMult || 2.5;
  const baseTrail = base.trailAtrMult || 1;
  const baseActivate = base.trailActivateR || 0.5;
  const baseAtrLen = base.riskAtrLen || 14;
  const stepScales = safeTemp >= 3 ? [0.5, 1, 2, 3] : safeTemp >= 2 ? [0.5, 1, 2] : [0.5, 1];
  const patches = [];
  for (const scale of stepScales) {
    patches.push(
      { slAtrMult: Math.max(0.125, Number((baseSl - 0.25 * scale).toFixed(3))) },
      { slAtrMult: Number((baseSl + 0.25 * scale).toFixed(3)) },
      { tpAtrMult: Math.max(1.0, Number((baseTp - 0.5 * scale).toFixed(3))) },
      { tpAtrMult: Number((baseTp + 0.5 * scale).toFixed(3)) },
      { trailAtrMult: Math.max(0.25, Number((baseTrail - 0.25 * scale).toFixed(3))) },
      { trailAtrMult: Number((baseTrail + 0.25 * scale).toFixed(3)) },
      { trailActivateR: Math.max(0, Number((baseActivate - 0.25 * scale).toFixed(3))) },
      { trailActivateR: Number((baseActivate + 0.5 * scale).toFixed(3)) },
      { riskAtrLen: Math.max(5, Math.round(baseAtrLen - 7 * scale)) },
      { riskAtrLen: Math.round(baseAtrLen + 7 * scale) },
    );
  }
  return deduplicatePatches(patches, base);
}

function deduplicatePatches(patches, base) {
  const seen = new Set();
  const output = [];
  for (const patch of patches) {
    const fp = configFingerprint({ ...base, ...patch });
    if (seen.has(fp)) continue;
    seen.add(fp);
    output.push(patch);
  }
  return output;
}
```

- [ ] **Step 4: Thread temperature into the picker**

In `buildIncumbentSearchBatch`, update the `familyPatchMap` to use the active temperature:

```javascript
  const familyPatchMap = {
    signal: signalPatches(base, { temperature }),
    risk: riskPatches(base, { temperature }),
  };
```

Locate the existing `const temperature = annealingState.temperature;` line and ensure it resolves before this `familyPatchMap` construction.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/pine-search-policy.test.mjs`
Expected: all tests PASS including the four new ones.

Run: `npm run test:pine:autoresearch:hardening`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/pine-search-policy.mjs tests/pine-search-policy.test.mjs
git commit -m "feat(pine): widen exploit patch pools with temperature-scaled steps

signalPatches grows from 12 to 18/24/36 candidates at temperatures 1/2/3,
riskPatches from 10 to 15/20/30. Candidates are deduplicated via
configFingerprint so no variant collides with another in the same family.
Lower bounds are respected for every knob (no negative trailActivateR,
no tpAtrMult below 1.0, no riskAtrLen below 5). Downstream buildIncumbentSearchBatch
consumes the active annealing temperature so stagnation escape naturally
pushes the search outward."
```

---

## Task 7: End-to-end integration test for the recovery pipeline

**Why:** Tasks 1-6 each fix a distinct defect. The end state should be: cycles with tabu saturation produce empty leaderboards cleanly, escalate stagnation on the new trigger, shrink the tabu horizon, widen the pool, and emit more variants next cycle. This integration test asserts that full path end-to-end, using mocked lab evaluation. Failure here means one of the earlier tasks is not wired through.

**Files:**
- Create: `tests/pine-autoresearch-tabu-saturation.test.mjs`

### Test plan

- Set up a minimal `runScout` invocation with a fake evaluator that always reports gate-failing scores (so every variant gets tabu-added).
- Drive 5 cycles in sequence, passing the scheduler state from cycle N into cycle N+1.
- Assert by cycle 3: `stagnationLevel >= 1`, `searchEfficiency.allCandidatesTabu === true` OR `lowEmissionStreak >= 2`.
- Assert by cycle 4: `stagnationLevel >= 1` and tabu set size at cycle 4 < tabu set size at cycle 3 (aging triggered).
- Assert by cycle 5: `emittedVariantCount > emittedVariantCount` at cycle 4 (pool effectively widened).

- [ ] **Step 1: Create the test scaffold**

Create `tests/pine-autoresearch-tabu-saturation.test.mjs` with:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runScout } from '../scripts/pine-autoresearch.mjs';

async function setupFixture() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-autoresearch-saturation-'));
  const config = {
    matrixId: 'pine-test-saturation',
    projectRoot: tmpRoot,
    scriptPath: path.join(tmpRoot, 'test.pine'),
    grid: 'phase3-core',
    maxConfigs: 8,
    minTrades: 10,
    primaryLab: {
      labId: 'xrp', symbol: 'XRPUSDT', timeframe: '15m', limit: 100,
      when: '2026-04-21T10:30:00Z',
      thresholds: { minScoreDelta: 0.25, minRoiDeltaPct: 0, minProfitFactorDelta: 0, maxDrawdownDeltaPct: 1, minTradeCount: 10, minTradeRatioVsIncumbent: 0.5 },
    },
    shadowLabs: [],
    blindHoldoutLabs: [],
    gatePolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0 },
    searchPolicy: { mode: 'incumbent-local', exploitRatio: 0.5, exploitFamilies: ['signal', 'risk'], exploreFamilies: ['signal'] },
    rotationPolicy: {
      tabuLimit: 128,
      similarityRotateAbove: 0.98,
      similarityRotateMinEmitted: 4,
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 2,
        holdEscalateAfter: 3,
        highSimilarityThreshold: 0.8,
        maxStagnationLevel: 2,
        lowEmissionEscalateAfter: 3,
        lowEmissionThreshold: 3,
      },
    },
  };
  await fs.mkdir(path.dirname(config.scriptPath), { recursive: true });
  await fs.writeFile(config.scriptPath, '// stub Pine source', 'utf8');
  return { tmpRoot, config };
}

function gateFailingEvaluator() {
  return async ({ candidate, lab }) => ({
    label: candidate.configId || 'stub',
    configId: candidate.configId || 'stub',
    config: candidate.config || candidate,
    score: 100,
    tradeCount: 200,
    winRatePct: 40,
    roiPct: 20,
    profitFactor: 2.0,
    maxDrawdownPct: 3,
    expectancy: 0.1,
  });
}
```

- [ ] **Step 2: Add the integration cycle test**

Append the test body:

```javascript
test('tabu saturation recovers via lowEmissionStreak escalation and tabu aging', async () => {
  const { tmpRoot, config } = await setupFixture();
  try {
    let schedulerState = { cycleIndex: 0, stagnationLevel: 0, lowEmissionStreak: 0, tabuRejectedFingerprints: [] };
    const cycles = [];
    const championState = { configId: 'stub-champ', config: { adxThreshold: 20, slAtrMult: 0.5, tpAtrMult: 2.5, trailActivateR: 0.5, riskAtrLen: 14, neighborsCount: 32, h: 8, r: 8, x: 25, minPredSum: 1.8, minBarsBetween: 1, useTrendXConf: true, useSignalFusion: true, useFusionV4: true, useTrailingStop: true, useStopsTP: true }, score: 150 };

    for (let cycleIndex = 1; cycleIndex <= 5; cycleIndex++) {
      const manifest = await runScout(config, {
        championState,
        schedulerState: { ...schedulerState, cycleIndex },
        evaluateConfigOnLab: gateFailingEvaluator(),
        runPrimarySweep: async () => ({
          runDir: path.join(tmpRoot, 'pine', 'sweeps', `stub-${cycleIndex}`),
          gridName: 'phase3-core',
          totalCombos: 0,
          sweepOffset: 0,
          topConfigs: [],
          best: null,
        }),
      });
      cycles.push({ manifest, tabuCount: schedulerState.tabuRejectedFingerprints?.length ?? 0 });
      schedulerState = {
        cycleIndex,
        stagnationLevel: manifest.stagnationLevel ?? 0,
        lowEmissionStreak: manifest.lowEmissionStreak ?? 0,
        tabuRejectedFingerprints: manifest.tabuRejectedFingerprints ?? schedulerState.tabuRejectedFingerprints,
      };
    }

    const cycle3 = cycles[2];
    assert.ok(cycle3.manifest.stagnationLevel >= 1 || cycle3.manifest.searchEfficiency?.allCandidatesTabu === true,
      'cycle 3 should have escalated or reported tabu exhaustion');

    const cycle4 = cycles[3];
    const cycle5 = cycles[4];
    assert.ok(cycle4.manifest.stagnationLevel >= 1, 'cycle 4 should remain escalated');
    assert.ok(
      (cycle5.manifest.searchEfficiency?.emittedVariantCount ?? 0) >= (cycle4.manifest.searchEfficiency?.emittedVariantCount ?? 0),
      'cycle 5 emitted count should not regress after tabu aging + pool widening',
    );
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
```

Note: `runScout` does not currently accept `evaluateConfigOnLab` and `runPrimarySweep` as dependencies in this shape; the existing dependency-injection seams in `scripts/pine-autoresearch.mjs` around line 2668 accept `dependencies.evaluateConfigOnLab` and line 2779 accepts `dependencies.runPrimarySweep`. If `runScout` does not forward these into its internal callers, you will need to add that forwarding in Task 7 Step 3 below.

- [ ] **Step 3: Ensure DI seams reach runScout**

Inspect `scripts/pine-autoresearch.mjs` for the `runScout` signature. If it doesn't already accept `dependencies`, add it:

```javascript
export async function runScout(config, dependencies = {}) {
  // existing body; propagate dependencies to evaluateMatrix() and runPrimarySweep() calls
}
```

At the call site that invokes `evaluateMatrix(config, runId, championState, challengerSummary)`, pass `dependencies` through:

```javascript
  await evaluateMatrix(config, runId, championState, challengerSummary, dependencies);
```

And where `runPrimarySweep` is called inside `runScout`, use `dependencies.runPrimarySweep || runPrimarySweep`.

If these seams already exist, no change.

- [ ] **Step 4: Run the integration test**

Run: `node --test tests/pine-autoresearch-tabu-saturation.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: `pass` count increased by 4-6 (new tests across earlier tasks plus this integration test), `fail 0`, `skipped 1`.

- [ ] **Step 6: Commit**

```bash
git add tests/pine-autoresearch-tabu-saturation.test.mjs scripts/pine-autoresearch.mjs
git commit -m "test(pine): integration suite for tabu saturation recovery

Drive 5 cycles of runScout with a gate-failing evaluator so every variant
gets tabu-added. Asserts the escalation + aging + pool-widening pipeline
works end-to-end: by cycle 3 stagnation has escalated or exhaustion has
been declared, by cycle 4 escalation holds, by cycle 5 emitted variants
have not regressed.

Catches regressions in the wiring between buildSearchEfficiency,
decideStagnationEscapePlan, pruneTabuFingerprints, and signalPatches/riskPatches."
```

---

## Task 8: Merge, deploy, and live verification

**Why:** Tasks 1-7 land incrementally on a feature branch. This task merges to `main`, verifies the next scheduled cycle runs cleanly on the fixed code, and documents evidence. The autoresearch runs hourly on cron; the verification window is the next two scheduled cycles after merge.

**Files:**
- No code changes. Operational task only.

- [ ] **Step 1: Branch strategy**

Throughout Tasks 1-7, work on a single branch:

```bash
git checkout -b fix/autoresearch-tabu-saturation-hardening
```

Commit per task. After Task 7 is committed and tested, move to Step 2.

- [ ] **Step 2: Pre-merge full test run**

```bash
npm test
```
Expected: `fail 0`, `skipped 1`, pass count increased from pre-plan baseline (755) by at least 10 across the new tests.

```bash
npm run test:pine:autoresearch:hardening
```
Expected: `fail 0`, `skipped 1`, pass count increased from pre-plan baseline (264).

- [ ] **Step 3: Fast-forward merge to main**

```bash
git checkout main
git merge --ff-only fix/autoresearch-tabu-saturation-hardening
git branch -d fix/autoresearch-tabu-saturation-hardening
```
Expected: `Fast-forward` output, no merge commit, branch deleted.

If the merge is not fast-forward (because `main` advanced during the plan), stop, rebase the feature branch on main, re-run tests, then retry the merge.

- [ ] **Step 4: Do not push to origin yet**

Per the repo's git safety defaults, do not push `main` unless the user explicitly asks. Report the merged state and wait.

- [ ] **Step 5: Observe the next scheduled cycle**

The scheduler runs at the top of every hour via cron. After the merge:

1. Wait for the next scheduled cycle timestamp (check `pine/autoresearch/pine-fusion-v4-core-15m-locked-window/history.jsonl` or the `scheduler.lock` file for the most recent cycle).
2. After the cycle completes, inspect:

```bash
Get-ChildItem pine\autoresearch\pine-fusion-v4-core-15m-locked-window\incomplete
```
Expected: no new entry for the cycle just ran. If a new `run_failed_before_manifest` file exists, the fix did not land correctly — roll back and investigate.

```bash
Get-Content pine\autoresearch\pine-fusion-v4-core-15m-locked-window\history.jsonl | Select-Object -Last 1
```
Expected: a fresh `type: cycle` entry with `searchEfficiency.variantCount > 0`. If `variantCount: 0`, confirm that `searchEfficiency.allCandidatesTabu === true` (Task 2 signal reached the manifest).

- [ ] **Step 6: Verify stagnation escalation behaviour (second cycle)**

Wait for a second cycle to land. Inspect the last two history entries:

```bash
Get-Content pine\autoresearch\pine-fusion-v4-core-15m-locked-window\history.jsonl | Select-Object -Last 2 | ForEach-Object { ($_ | ConvertFrom-Json) | Select-Object timestamp, @{n='emitted';e={$_.searchEfficiency.emittedVariantCount}}, @{n='tabu';e={$_.searchEfficiency.allCandidatesTabu}}, stagnationLevel, @{n='lowStreak';e={$_.lowEmissionStreak}} }
```

Expected outcomes (at least one of):
- Cycles produce healthy emitted counts (e.g. >= 4) and `stagnationLevel` remains at 0.
- Cycles produce low emitted counts (<= 3); `lowEmissionStreak` climbs; after 3 consecutive low cycles, `stagnationLevel` becomes 1.
- Cycles produce zero variants; `searchEfficiency.allCandidatesTabu === true`; no ENOENT crash; `stagnationLevel` escalates within 3 cycles.

- [ ] **Step 7: Document live evidence**

Append a short evidence block to the plan document (this file):

```bash
Add-Content -Path docs\superpowers\plans\2026-05-12-autoresearch-tabu-saturation-and-escape-hardening.md -Value @"

## Live Verification Evidence

- Merge commit: <SHA>
- First post-merge cycle: <timestamp, runId>
  - variantCount: <n>
  - emittedVariantCount: <n>
  - stagnationLevel: <n>
  - allCandidatesTabu: <bool>
- Second post-merge cycle: <timestamp, runId>
  - variantCount: <n>
  - stagnationLevel: <n>
- No `incomplete/` entries since merge: <confirmed>
"@
```

Then commit:

```bash
git add docs\superpowers\plans\2026-05-12-autoresearch-tabu-saturation-and-escape-hardening.md
git commit -m "docs(pine): record live verification evidence for tabu saturation fix"
```

- [ ] **Step 8: Final sign-off**

Report to the user:
- Merged commits and hash range
- Test counts (pre/post)
- Live evidence from Steps 5-6
- Ask explicitly whether to push `main` to origin.

---

## Non-Goals (Deliberately Excluded)

These are real issues but belong in a separate calibration/architecture plan:

1. **Gate geometry mathematical unsatisfiability.** `minRelativeScoreDelta: 0.02` against score 153.25 requires +3.07 score; shadow pass ratio 0.5 against 5 shadows with their own thresholds; blind holdout `minRoiDeltaPct: 5` vs incumbent ROI 92.32%. These are product-level calibration decisions, not code bugs.

2. **Out-of-sample inversion.** Primary training window (2026-04-21) is newer than shadow windows (Mar/Feb 2026) and blind-holdout (Nov 2025). This is an architecture flaw in the lab design, not a scout bug.

3. **Patch pool intrinsic ceiling.** Even with Task 6's 2-3x expansion, hardcoded patch pools cannot indefinitely sustain daily cycles. A grid-crossed or LLM-suggested patch generator is a different project.

4. **R:R 15.2:1 survival bias in the champion.** Champion's ROI is dominated by a handful of mega-TP hits. Any challenger that can't replicate those fails the trade-count ratio gate. Addressing this requires gate redesign, not scout hardening.

5. **Stale tabu entries from prior champions when champion changes.** Already handled by `dropOnChampionChange: true` in `pruneTabuFingerprints`. Verify it's enabled in merged config; no code change needed.

---

## Self-Review Checklist

**1. Spec coverage:** Each of the 7 defects identified in the inspection (0-variant crash, tabu exhaustion underreporting, stagnation not escalating, similarity rotation noise, tabu horizon not shrinking, small patch pools, integration wiring) has a dedicated task. Gap: Task 5 requires the call site at `scripts/pine-autoresearch.mjs:1213` to also thread stagnation level; verify during implementation.

**2. Placeholder scan:** No TBD, no "implement later", no "similar to Task N". Each step has complete code or an exact command with expected output.

**3. Type consistency:** `signalPatches` and `riskPatches` signatures are consistent across Tasks 2, 3, 6: both accept `(base, { temperature = 1 } = {})`. `pruneTabuFingerprints` accepts `stagnationLevel` in Task 5 and all call sites are updated. `decideStagnationEscapePlan` accepts `lowEmissionStreak` in Task 3 and the integration test in Task 7 passes it.

**4. Ordering:** Tasks are dependency-ordered. Task 1 must land before Task 7 (integration test needs the 0-variant guard). Task 2 must land before Task 3 (escalation consumes the exhaustion flag). Task 3 must land before Task 4 (rotation guard relies on escalation covering sameTrackCycleStreak gaps). Tasks 5 and 6 are independent after Task 3.

**5. Non-regression:** Every task runs the full hardening suite after the change and requires `fail 0` before commit.

**6. Rollback:** Each task is a single commit. Any task can be reverted with `git revert <SHA>` without cascading breakage, though Task 7's integration test will fail if earlier tasks are reverted.

---

