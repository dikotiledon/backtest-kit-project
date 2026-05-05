# Pine Autoresearch Elite Autonomous Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the non-LLM Pine autoresearch loop from guarded hill-climber to elite autonomous research by adding promotion lineage, anti-ping-pong gates, N-run escape escalation, and stronger operator controls while keeping matrix-gated autopromote safe.

**Architecture:** Keep the current promotion queue, exact-manifest autopromote, locks, matrix gates, and expectancy gates. Add a compact lineage layer that records champion transitions and family history, then use it to block direct reversals, repeated near-family promotions, and stale queued promotions unless extra margin evidence is present. Add a separate N-run escape controller that escalates search temperature/fallback families after repeated same-data/same-challenger/hold loops, without adding regime-aware champion portfolios yet.

**Tech Stack:** Node.js ESM, `node:test`, existing Pine autoresearch modules in `scripts/`, append-only JSONL promotion queue/history, JSON scheduler state, markdown docs.

---

## Scope Boundary

Included:
- Same-data/same-challenger escape hardening.
- Ping-pong prevention between recent champion families.
- Ping-pong-after-N-runs / stagnation escalation.
- Safer guarded autopromote policy and docs.
- Tests proving no promotion without matrix evidence, no direct reversal without margin, and no endless local-loop replay.

Excluded for now:
- Regime-aware champion portfolio.
- Multi-champion live router.
- Live trading execution changes.
- LLM lane changes.
- Any weakening of matrix/expectancy gates.

---

## Existing Baseline To Preserve

Current non-LLM autoresearch already has:
- `cycle` writes exact manifest and queues promotion only for matrix `promote` decisions.
- `autopromote` consumes oldest pending queue item and uses the exact queued manifest, not mutable `latest.json`.
- Queue item stores `championFingerprintAtDecision`, so autopromote marks stale when champion changed since queue time.
- `candidateChanged`, matrix policy, expectancy policy, cooldown, and daily quota gates exist.
- Scheduler state has `noChangeStreak`, `noNewCandidateStreak`, `sameTrackCycleStreak`, `lastNoveltySignature`, and `tabuRejectedFingerprints`.
- Self-loop escape exists through `searchPolicy.selfLoopEscape`, annealing, fallback families, and tabu skip.

This plan strengthens the above. It must not remove or bypass those controls.

---

## File Map

- Create: `scripts/lib/pine-autoresearch-lineage.mjs`
  - Pure functions for promotion lineage, candidate family identity, anti-ping-pong detection, and promotion eligibility overlay.

- Modify: `scripts/lib/pine-autoresearch.mjs`
  - Extend `decideAutoPromotionAction()` with optional lineage policy gates.
  - Keep defaults backward-compatible and fail closed for risky reversal patterns.

- Modify: `scripts/pine-autoresearch.mjs`
  - Import lineage helpers.
  - Add lineage metadata to promotion history events.
  - Pass lineage context into `decideAutoPromotionAction()` from `runAutopromote()`.
  - Add N-run escape trigger metadata into manifest/scheduler update.

- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
  - Add escalation fields to scheduler state: `stagnationLevel`, `stagnationReason`, `lastEscalatedAt`, `blockedPromotionFingerprints`.
  - Escalate after repeated holds/no-new/similarity loops.

- Modify: `scripts/lib/pine-track-generators.mjs`
  - Use scheduler `stagnationLevel` to increase exploration pressure and diversify fallback families.
  - Keep tabu and champion-fingerprint exclusion.

- Modify: `config/pine-autoresearch.default.json`
  - Add explicit `autoPromotion.lineagePolicy` and `rotationPolicy.stagnation` defaults.
  - Keep `requireMatrixPromotion: true`.

- Modify: `docs/pine-autoresearch.md`
  - Document promotion lineage, anti-ping-pong gates, N-run escape, and recommended autopromote profiles.

- Test: `tests/pine-autoresearch-lineage.test.mjs`
  - New unit tests for lineage helpers.

- Test: `tests/pine-autoresearch.test.mjs`
  - Existing autopromote/queue/orchestration tests plus new integration-style pure tests.

- Test: `tests/pine-autoresearch-tracks.test.mjs`
  - Scheduler escalation tests.

- Test: `tests/pine-track-generators.test.mjs`
  - Stagnation-level exploration pressure tests.

---

## Design Rules

1. **Autopromote remains a consumer, not a researcher.** It can only promote queued exact manifests.
2. **Matrix promote remains mandatory.** No lineage or escape logic can convert a matrix `hold` into a promotion.
3. **Ping-pong prevention is a promotion gate, not a search ban.** Research can evaluate reverse candidates; unattended shipping needs extra proof.
4. **Stagnation escape changes exploration, not promotion gates.** It widens search after repeated loops; it does not lower promotion thresholds.
5. **Everything important is inspectable.** Manifests/history must say why a candidate was blocked or why search escalated.
6. **Fail closed.** Missing lineage data should not block first-ever promotion, but malformed/inconsistent queued lineage should block unattended autopromote.

---

## Task 1: Add Promotion Lineage Helper Module

**Files:**
- Create: `scripts/lib/pine-autoresearch-lineage.mjs`
- Test: `tests/pine-autoresearch-lineage.test.mjs`

- [ ] **Step 1: Create failing lineage tests**

Create `tests/pine-autoresearch-lineage.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateFamilyKey,
  summarizePromotionLineage,
  detectPingPongRisk,
  decideLineagePromotionGate,
} from '../scripts/lib/pine-autoresearch-lineage.mjs';

const baseConfig = {
  useSignalFusion: true,
  useFusionV4: true,
  useDivergenceContext: true,
  useSqueezeContext: true,
  minPredSum: 1.8,
  tpAtrMult: 6.85,
  slAtrMult: 0.5,
  trailAtrMult: 1,
};

test('buildCandidateFamilyKey ignores tiny numeric tuning but preserves structural switches', () => {
  const left = buildCandidateFamilyKey({
    config: { ...baseConfig, minPredSum: 1.8, tpAtrMult: 6.85 },
    familyKeys: ['useSignalFusion', 'useFusionV4', 'useDivergenceContext', 'useSqueezeContext'],
  });
  const right = buildCandidateFamilyKey({
    config: { ...baseConfig, minPredSum: 1.6, tpAtrMult: 6.65 },
    familyKeys: ['useSignalFusion', 'useFusionV4', 'useDivergenceContext', 'useSqueezeContext'],
  });
  const structuralChange = buildCandidateFamilyKey({
    config: { ...baseConfig, useSqueezeContext: false },
    familyKeys: ['useSignalFusion', 'useFusionV4', 'useDivergenceContext', 'useSqueezeContext'],
  });

  assert.equal(left, right);
  assert.notEqual(left, structuralChange);
});

test('summarizePromotionLineage returns recent promoted and demoted fingerprints newest first', () => {
  const summary = summarizePromotionLineage({
    historyEvents: [
      { type: 'promote', timestamp: '2026-05-01T00:00:00.000Z', fromFingerprint: 'a', toFingerprint: 'b', fromFamilyKey: 'fam-a', toFamilyKey: 'fam-b' },
      { type: 'autopromote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'b', toFingerprint: 'c', fromFamilyKey: 'fam-b', toFamilyKey: 'fam-c' },
    ],
    limit: 4,
  });

  assert.deepEqual(summary.recentPromotedFingerprints, ['c', 'b']);
  assert.deepEqual(summary.recentDemotedFingerprints, ['b', 'a']);
  assert.deepEqual(summary.recentTransitions.map((item) => `${item.fromFingerprint}->${item.toFingerprint}`), ['b->c', 'a->b']);
});

test('detectPingPongRisk catches direct reversal to recently demoted champion', () => {
  const risk = detectPingPongRisk({
    candidateFingerprint: 'b',
    candidateFamilyKey: 'fam-b',
    currentChampionFingerprint: 'c',
    currentChampionFamilyKey: 'fam-c',
    lineage: summarizePromotionLineage({
      historyEvents: [
        { type: 'autopromote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'b', toFingerprint: 'c', fromFamilyKey: 'fam-b', toFamilyKey: 'fam-c' },
      ],
    }),
    policy: { lookbackPromotions: 5 },
  });

  assert.equal(risk.level, 'direct-reversal');
  assert.equal(risk.blocked, true);
  assert.match(risk.reason, /recently demoted/);
});

test('decideLineagePromotionGate allows risky reversal only with configured extra proof margin', () => {
  const lineage = summarizePromotionLineage({
    historyEvents: [
      { type: 'autopromote', timestamp: '2026-05-02T00:00:00.000Z', fromFingerprint: 'b', toFingerprint: 'c', fromFamilyKey: 'fam-b', toFamilyKey: 'fam-c' },
    ],
  });

  const blocked = decideLineagePromotionGate({
    candidateFingerprint: 'b',
    candidateFamilyKey: 'fam-b',
    currentChampionFingerprint: 'c',
    currentChampionFamilyKey: 'fam-c',
    lineage,
    matrixDecision: { recommendation: 'promote', counts: { shadowPassCount: 3, shadowPassRatio: 0.6 } },
    robustness: { aggregateScoreDelta: 1.2, aggregateRoiDeltaPct: 2.5, aggregateProfitFactorDelta: 0.05 },
    policy: { enabled: true, lookbackPromotions: 5, directReversalExtraShadowPasses: 1, minExtraAggregateScoreDelta: 5 },
  });

  const allowed = decideLineagePromotionGate({
    candidateFingerprint: 'b',
    candidateFamilyKey: 'fam-b',
    currentChampionFingerprint: 'c',
    currentChampionFamilyKey: 'fam-c',
    lineage,
    matrixDecision: { recommendation: 'promote', counts: { shadowPassCount: 5, shadowPassRatio: 1 } },
    robustness: { aggregateScoreDelta: 8, aggregateRoiDeltaPct: 10, aggregateProfitFactorDelta: 0.2 },
    policy: { enabled: true, lookbackPromotions: 5, directReversalExtraShadowPasses: 1, minExtraAggregateScoreDelta: 5 },
  });

  assert.equal(blocked.passed, false);
  assert.equal(blocked.failedGates.includes('lineagePingPong'), true);
  assert.equal(allowed.passed, true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
node --test tests/pine-autoresearch-lineage.test.mjs
```

Expected: FAIL because `scripts/lib/pine-autoresearch-lineage.mjs` does not exist.

- [ ] **Step 3: Implement lineage helpers**

Create `scripts/lib/pine-autoresearch-lineage.mjs`:

```js
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (isPlainObject(value)) {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function buildCandidateFamilyKey({ config = {}, familyKeys = [] } = {}) {
  const keys = Array.isArray(familyKeys) && familyKeys.length > 0
    ? familyKeys
    : [
        'useSignalFusion',
        'useFusionV2',
        'useFusionV3',
        'useFusionV4',
        'useDivergenceContext',
        'useSqueezeContext',
        'useSupertrendFilter',
        'useTrailingStop',
        'useStopsTP',
      ];

  const family = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      family[key] = config[key];
    }
  }
  return JSON.stringify(stableValue(family));
}

export function summarizePromotionLineage({ historyEvents = [], limit = 12 } = {}) {
  const promotions = historyEvents
    .filter((event) => event?.type === 'promote' || event?.type === 'autopromote')
    .filter((event) => event.toFingerprint || event.toConfigFingerprint || event.championFingerprint || event.toConfigId)
    .map((event) => ({
      timestamp: event.timestamp ?? null,
      mode: event.type,
      fromFingerprint: event.fromFingerprint ?? event.fromConfigFingerprint ?? null,
      toFingerprint: event.toFingerprint ?? event.toConfigFingerprint ?? event.championFingerprint ?? null,
      fromFamilyKey: event.fromFamilyKey ?? null,
      toFamilyKey: event.toFamilyKey ?? null,
      fromConfigId: event.fromConfigId ?? null,
      toConfigId: event.toConfigId ?? event.championConfigId ?? null,
      sourceRunId: event.runId ?? event.sourceRunId ?? null,
    }))
    .sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)))
    .slice(0, Math.max(1, Number(limit) || 12));

  return {
    recentTransitions: promotions,
    recentPromotedFingerprints: promotions.map((event) => event.toFingerprint).filter(Boolean),
    recentDemotedFingerprints: promotions.map((event) => event.fromFingerprint).filter(Boolean),
    recentPromotedFamilies: promotions.map((event) => event.toFamilyKey).filter(Boolean),
    recentDemotedFamilies: promotions.map((event) => event.fromFamilyKey).filter(Boolean),
  };
}

export function detectPingPongRisk({
  candidateFingerprint,
  candidateFamilyKey,
  currentChampionFingerprint,
  currentChampionFamilyKey,
  lineage = summarizePromotionLineage(),
  policy = {},
} = {}) {
  const lookback = Math.max(1, Number(policy.lookbackPromotions ?? 6) || 6);
  const transitions = Array.isArray(lineage.recentTransitions)
    ? lineage.recentTransitions.slice(0, lookback)
    : [];

  const directReversal = transitions.find((event) => (
    event.fromFingerprint
    && event.toFingerprint
    && candidateFingerprint
    && currentChampionFingerprint
    && event.fromFingerprint === candidateFingerprint
    && event.toFingerprint === currentChampionFingerprint
  ));
  if (directReversal) {
    return {
      blocked: true,
      level: 'direct-reversal',
      reason: `candidate ${candidateFingerprint} was recently demoted by current champion ${currentChampionFingerprint}`,
      matchedTransition: directReversal,
    };
  }

  const familyReversal = transitions.find((event) => (
    event.fromFamilyKey
    && event.toFamilyKey
    && candidateFamilyKey
    && currentChampionFamilyKey
    && event.fromFamilyKey === candidateFamilyKey
    && event.toFamilyKey === currentChampionFamilyKey
  ));
  if (familyReversal) {
    return {
      blocked: true,
      level: 'family-reversal',
      reason: 'candidate family was recently demoted by current champion family',
      matchedTransition: familyReversal,
    };
  }

  const recentPromotedRepeat = transitions.find((event) => (
    candidateFingerprint
    && event.toFingerprint === candidateFingerprint
    && event.toFingerprint !== currentChampionFingerprint
  ));
  if (recentPromotedRepeat) {
    return {
      blocked: true,
      level: 'recent-repeat',
      reason: `candidate ${candidateFingerprint} was already promoted recently and then left champion lineage`,
      matchedTransition: recentPromotedRepeat,
    };
  }

  return { blocked: false, level: 'none', reason: 'no lineage ping-pong risk detected', matchedTransition: null };
}

export function decideLineagePromotionGate({
  candidateFingerprint,
  candidateFamilyKey,
  currentChampionFingerprint,
  currentChampionFamilyKey,
  lineage = summarizePromotionLineage(),
  matrixDecision = {},
  robustness = {},
  policy = {},
} = {}) {
  const enabled = policy.enabled !== false;
  if (!enabled) {
    return { passed: true, failedGates: [], risk: { level: 'disabled', blocked: false }, summary: 'Lineage gate disabled.' };
  }

  const risk = detectPingPongRisk({
    candidateFingerprint,
    candidateFamilyKey,
    currentChampionFingerprint,
    currentChampionFamilyKey,
    lineage,
    policy,
  });
  if (!risk.blocked) {
    return { passed: true, failedGates: [], risk, summary: 'Lineage gate passed.' };
  }

  const counts = matrixDecision?.counts ?? {};
  const shadowPassCount = asNumber(counts.shadowPassCount, 0);
  const minExtraShadowPasses = asNumber(policy.directReversalExtraShadowPasses, 1);
  const requiredShadowPassCount = asNumber(policy.baseShadowPassCount, 3) + minExtraShadowPasses;
  const aggregateScoreDelta = asNumber(robustness.aggregateScoreDelta, 0);
  const minExtraAggregateScoreDelta = asNumber(policy.minExtraAggregateScoreDelta, 5);
  const aggregateRoiDeltaPct = asNumber(robustness.aggregateRoiDeltaPct, 0);
  const minExtraAggregateRoiDeltaPct = asNumber(policy.minExtraAggregateRoiDeltaPct, 0);

  const gates = {
    lineageShadowMargin: shadowPassCount >= requiredShadowPassCount,
    lineageScoreMargin: aggregateScoreDelta >= minExtraAggregateScoreDelta,
    lineageRoiMargin: aggregateRoiDeltaPct >= minExtraAggregateRoiDeltaPct,
  };
  const failedGates = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);

  return {
    passed: failedGates.length === 0,
    failedGates: failedGates.length === 0 ? [] : ['lineagePingPong', ...failedGates],
    risk,
    gates,
    required: {
      requiredShadowPassCount,
      minExtraAggregateScoreDelta,
      minExtraAggregateRoiDeltaPct,
    },
    summary: failedGates.length === 0
      ? `Lineage risk ${risk.level} allowed by extra proof margin.`
      : `Lineage risk ${risk.level} blocked: ${risk.reason}.`,
  };
}
```

- [ ] **Step 4: Run lineage tests**

Run:

```powershell
node --test tests/pine-autoresearch-lineage.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add scripts/lib/pine-autoresearch-lineage.mjs tests/pine-autoresearch-lineage.test.mjs
git commit -m "feat(pine): add autoresearch promotion lineage helpers"
```

---

## Task 2: Add Lineage Gate To Autopromote Decision

**Files:**
- Modify: `scripts/lib/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing autopromote lineage gate tests**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('decideAutoPromotionAction blocks direct ping-pong reversal without extra margin', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'old-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      candidateFamilyKey: 'family-b',
      championFingerprint: 'fp-c',
      championFamilyKey: 'family-c',
      matrixDecision: {
        recommendation: 'promote',
        counts: { shadowPassCount: 3, shadowPassRatio: 0.6 },
      },
      robustness: { aggregateScoreDelta: 2, aggregateRoiDeltaPct: 1, aggregateProfitFactorDelta: 0.03 },
    },
    championState: { configId: 'current-c', config: { minPredSum: 1.8 }, configFingerprint: 'fp-c' },
    historyEvents: [
      {
        type: 'autopromote',
        timestamp: '2026-05-03T00:00:00.000Z',
        fromFingerprint: 'fp-b',
        toFingerprint: 'fp-c',
        fromFamilyKey: 'family-b',
        toFamilyKey: 'family-c',
      },
    ],
    policy: {
      enabled: true,
      cooldownHours: 0,
      maxPromotionsPerDay: 10,
      requireMatrixPromotion: true,
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 5,
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
      },
    },
    now: '2026-05-03T06:00:00.000Z',
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.gates.lineage, false);
  assert.equal(result.failedGates.includes('lineage'), true);
  assert.equal(result.lineage.risk.level, 'direct-reversal');
});

test('decideAutoPromotionAction allows direct reversal with extra matrix margin', () => {
  const result = decideAutoPromotionAction({
    latestManifest: {
      challenger: { configId: 'old-b', config: { minPredSum: 1.6 } },
      candidateFingerprint: 'fp-b',
      candidateFamilyKey: 'family-b',
      championFingerprint: 'fp-c',
      championFamilyKey: 'family-c',
      matrixDecision: {
        recommendation: 'promote',
        counts: { shadowPassCount: 5, shadowPassRatio: 1 },
      },
      robustness: { aggregateScoreDelta: 8, aggregateRoiDeltaPct: 6, aggregateProfitFactorDelta: 0.2 },
    },
    championState: { configId: 'current-c', config: { minPredSum: 1.8 }, configFingerprint: 'fp-c' },
    historyEvents: [
      {
        type: 'autopromote',
        timestamp: '2026-05-03T00:00:00.000Z',
        fromFingerprint: 'fp-b',
        toFingerprint: 'fp-c',
        fromFamilyKey: 'family-b',
        toFamilyKey: 'family-c',
      },
    ],
    policy: {
      enabled: true,
      cooldownHours: 0,
      maxPromotionsPerDay: 10,
      requireMatrixPromotion: true,
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 5,
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
      },
    },
    now: '2026-05-03T06:00:00.000Z',
  });

  assert.equal(result.recommendation, 'promote');
  assert.equal(result.gates.lineage, true);
  assert.equal(result.lineage.risk.level, 'direct-reversal');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "lineage|ping-pong"
```

Expected: FAIL because `decideAutoPromotionAction()` does not evaluate lineage.

- [ ] **Step 3: Import lineage gate helper**

At the top of `scripts/lib/pine-autoresearch.mjs`, add:

```js
import { decideLineagePromotionGate } from './pine-autoresearch-lineage.mjs';
```

- [ ] **Step 4: Extend `decideAutoPromotionAction()`**

In `scripts/lib/pine-autoresearch.mjs`, inside `decideAutoPromotionAction()` after `matrixReady`, add:

```js
  const lineageGate = decideLineagePromotionGate({
    candidateFingerprint: latestManifest?.candidateFingerprint ?? latestManifest?.challenger?.candidateFingerprint ?? null,
    candidateFamilyKey: latestManifest?.candidateFamilyKey ?? latestManifest?.challenger?.familyKey ?? null,
    currentChampionFingerprint: latestManifest?.championFingerprint ?? championState?.configFingerprint ?? null,
    currentChampionFamilyKey: latestManifest?.championFamilyKey ?? championState?.familyKey ?? null,
    lineage: policy.lineage ?? null,
    matrixDecision: decision,
    robustness: latestManifest?.robustness ?? latestManifest?.selectedCandidate?.robustness ?? {},
    policy: policy.lineagePolicy ?? { enabled: false },
  });
```

Then extend `gates`:

```js
    lineage: lineageGate.passed,
```

And extend the returned object with:

```js
    lineage: lineageGate,
```

Do not remove existing gates. Existing policies without `lineagePolicy.enabled` must behave as before.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
node --test tests/pine-autoresearch-lineage.test.mjs tests/pine-autoresearch.test.mjs --test-name-pattern "lineage|ping-pong|decideAutoPromotionAction"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add scripts/lib/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): gate autopromote against ping-pong lineage"
```

---

## Task 3: Persist Family And Fingerprint Lineage In Manifests And History

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing orchestration metadata test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('buildScoutOrchestrationState persists candidate and champion lineage keys', () => {
  const championState = {
    configId: 'champion-a',
    score: 100,
    tradeCount: 100,
    roiPct: 50,
    winRatePct: 40,
    profitFactor: 2,
    maxDrawdownPct: 3,
    config: { useFusionV4: true, useDivergenceContext: true, minPredSum: 1.8 },
    configFingerprint: 'fp-a',
  };
  const challenger = {
    configId: 'challenger-b',
    score: 110,
    tradeCount: 120,
    roiPct: 60,
    winRatePct: 42,
    profitFactor: 2.2,
    maxDrawdownPct: 2.5,
    config: { useFusionV4: true, useDivergenceContext: true, minPredSum: 1.6 },
  };

  const result = buildScoutOrchestrationState({
    config: {
      researchRoot: 'pine/autoresearch/test',
      matrixId: 'test-matrix',
      grid: 'phase3-core',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 1, paretoShortlistSize: 2 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 0, minShadowPassRatio: 0, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      blindHoldoutLabs: [],
    },
    runId: 'run-lineage',
    championState,
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [challenger] },
    matrixCandidates: [{
      challenger,
      labResults: [],
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger', counts: { shadowPassCount: 0, shadowPassRatio: 0 } },
      robustness: { aggregateScoreDelta: 10, aggregateRoiDeltaPct: 10 },
    }],
    trackState: { championFingerprint: 'fp-a', candidateFingerprint: 'fp-b' },
  });

  assert.equal(result.manifest.candidateFingerprint, 'fp-b');
  assert.equal(result.manifest.championFingerprint, 'fp-a');
  assert.equal(typeof result.manifest.candidateFamilyKey, 'string');
  assert.equal(typeof result.manifest.championFamilyKey, 'string');
  assert.equal(result.manifest.robustness.aggregateScoreDelta, 10);
});
```

- [ ] **Step 2: Add failing promotion history test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('promotion history event records from/to fingerprints and family keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-lineage-promote-'));
  try {
    const configPath = path.join(dir, 'config.json');
    const scriptPath = path.join(dir, 'strategy.pine');
    await fs.writeFile(scriptPath, 'a = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'lineage-test',
      scriptPath,
      researchRoot: path.join(dir, 'research'),
      digestRoot: path.join(dir, 'digest'),
      baseConfig: { minPredSum: 1.8, useFusionV4: true },
      autoPromotion: { enabled: true, cooldownHours: 0, maxPromotionsPerDay: 10, requireMatrixPromotion: true },
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    await fs.mkdir(autoresearchCli.manifestsDir(config), { recursive: true });
    await fs.writeFile(autoresearchCli.latestManifestPath(config), JSON.stringify({
      runId: 'run-promote-lineage',
      generatedAt: '2026-05-03T00:00:00.000Z',
      champion: { configId: 'champion-a', config: { minPredSum: 1.8, useFusionV4: true }, configFingerprint: 'fp-a' },
      challenger: { configId: 'challenger-b', config: { minPredSum: 1.6, useFusionV4: true } },
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      candidateFamilyKey: 'family-b',
      championFamilyKey: 'family-a',
      matrixDecision: { recommendation: 'promote', summary: 'Promote challenger' },
    }), 'utf8');

    await autoresearchCli.ensureChampionState(config);
    const result = await autoresearchCli.runPromote(config, { force: false }, 'manual');
    assert.equal(result.promoted, true);

    const history = JSON.parse((await fs.readFile(path.join(config.researchRoot, 'history.jsonl'), 'utf8')).trim().split('\n').at(-1));
    assert.equal(history.fromFingerprint, 'fp-a');
    assert.equal(history.toFingerprint, 'fp-b');
    assert.equal(history.fromFamilyKey, 'family-a');
    assert.equal(history.toFamilyKey, 'family-b');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "lineage keys|promotion history event"
```

Expected: FAIL because manifest/history lineage fields are missing.

- [ ] **Step 4: Import family helper in CLI**

In `scripts/pine-autoresearch.mjs`, add:

```js
import { buildCandidateFamilyKey, summarizePromotionLineage } from './lib/pine-autoresearch-lineage.mjs';
```

- [ ] **Step 5: Add lineage fields in `buildScoutOrchestrationState()`**

Inside `buildScoutOrchestrationState()`, after `candidateFingerprint` and `championFingerprint` are known or inside manifest construction, compute:

```js
  const candidateFamilyKey = buildCandidateFamilyKey({ config: challengerSummary?.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys });
  const championFamilyKey = buildCandidateFamilyKey({ config: championState?.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys });
  const selectedRobustness = selectedCandidate?.robustness ?? null;
```

Add to `manifest`:

```js
      candidateFamilyKey,
      championFamilyKey,
      robustness: selectedRobustness,
```

Keep existing `candidateFingerprint` and `championFingerprint` fields.

- [ ] **Step 6: Add lineage fields to promotion history**

In `runPromote()`, before `appendJsonl(historyPath(config), { ... })`, compute:

```js
  const fromFingerprint = latest.championFingerprint ?? championState.configFingerprint ?? configFingerprint(championState.config || {});
  const toFingerprint = latest.candidateFingerprint ?? latest.challenger?.candidateFingerprint ?? configFingerprint(latest.challenger?.config || {});
  const fromFamilyKey = latest.championFamilyKey ?? buildCandidateFamilyKey({ config: championState.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys });
  const toFamilyKey = latest.candidateFamilyKey ?? buildCandidateFamilyKey({ config: latest.challenger?.config, familyKeys: config.autoPromotion?.lineagePolicy?.familyKeys });
```

Add to history event:

```js
    fromFingerprint,
    toFingerprint,
    fromFamilyKey,
    toFamilyKey,
```

- [ ] **Step 7: Pass lineage into autopromote decision**

In `runAutopromote()`, after `const historyEvents = await loadHistoryEvents(config);`, add:

```js
  const lineage = summarizePromotionLineage({
    historyEvents,
    limit: config.autoPromotion?.lineagePolicy?.lookbackPromotions ?? 6,
  });
```

Then call `decideAutoPromotionAction()` with:

```js
    policy: { ...config.autoPromotion, lineage },
```

instead of `policy: config.autoPromotion`.

- [ ] **Step 8: Run focused tests**

Run:

```powershell
node --test tests/pine-autoresearch-lineage.test.mjs tests/pine-autoresearch.test.mjs --test-name-pattern "lineage|promotion history event|decideAutoPromotionAction"
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): persist autoresearch promotion lineage"
```

---

## Task 4: Strengthen Queue Items With Lineage Identity

**Files:**
- Modify: `scripts/lib/pine-promotion-queue.mjs`
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-promotion-queue.test.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing queue identity test**

Append to `tests/pine-promotion-queue.test.mjs`:

```js
test('buildPromotionQueueItem captures lineage family keys and robustness snapshot', () => {
  const item = buildPromotionQueueItem({
    manifest: {
      runId: 'run-lineage-queue',
      generatedAt: '2026-05-03T00:00:00.000Z',
      manifestPath: '/tmp/run-lineage-queue.json',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      candidateFamilyKey: 'family-b',
      championFamilyKey: 'family-a',
      robustness: { aggregateScoreDelta: 8 },
      challenger: { configId: 'challenger-b' },
      champion: { configId: 'champion-a' },
      matrixDecision: { recommendation: 'promote' },
    },
  });

  assert.equal(item.candidateFamilyKey, 'family-b');
  assert.equal(item.championFamilyKeyAtDecision, 'family-a');
  assert.deepEqual(item.robustness, { aggregateScoreDelta: 8 });
});
```

- [ ] **Step 2: Run failing queue tests**

Run:

```powershell
node --test tests/pine-promotion-queue.test.mjs --test-name-pattern "lineage family keys"
```

Expected: FAIL because queue item omits lineage fields.

- [ ] **Step 3: Extend `buildPromotionQueueItem()`**

In `scripts/lib/pine-promotion-queue.mjs`, add fields to returned item:

```js
    candidateFamilyKey: manifest.candidateFamilyKey ?? null,
    championFamilyKeyAtDecision: manifest.championFamilyKey ?? null,
    robustness: manifest.robustness ?? null,
```

No queue reduction logic changes needed; these fields remain part of the original pending item.

- [ ] **Step 4: Validate queued lineage in `decideQueuedPromotionAction()`**

In `scripts/pine-autoresearch.mjs`, inside `decideQueuedPromotionAction()` after champion fingerprint check, add:

```js
  if (queuedItem.candidateFamilyKey && manifest.candidateFamilyKey && queuedItem.candidateFamilyKey !== manifest.candidateFamilyKey) {
    return { recommendation: 'hold', status: 'failed', reason: 'Queued candidate family does not match manifest family' };
  }
  if (queuedItem.championFamilyKeyAtDecision && manifest.championFamilyKey && queuedItem.championFamilyKeyAtDecision !== manifest.championFamilyKey) {
    return { recommendation: 'hold', status: 'failed', reason: 'Queued champion family does not match manifest family' };
  }
```

- [ ] **Step 5: Add queue mismatch test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('decideQueuedPromotionAction fails when queued family identity differs from manifest', () => {
  const result = decideQueuedPromotionAction({
    queuedItem: {
      itemId: 'run-a:fp-b',
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprintAtDecision: 'fp-a',
      candidateFamilyKey: 'family-b-original',
      championFamilyKeyAtDecision: 'family-a',
    },
    manifest: {
      runId: 'run-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      candidateFamilyKey: 'family-b-mutated',
      championFamilyKey: 'family-a',
      challenger: { config: { minPredSum: 1.6 } },
      matrixDecision: { recommendation: 'promote' },
    },
    championState: { config: { minPredSum: 1.8 }, configFingerprint: 'fp-a' },
    autoAction: { recommendation: 'promote' },
  });

  assert.equal(result.recommendation, 'hold');
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /family/);
});
```

- [ ] **Step 6: Run queue tests**

Run:

```powershell
node --test tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs --test-name-pattern "lineage family|queued family"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add scripts/lib/pine-promotion-queue.mjs scripts/pine-autoresearch.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): bind promotion queue to lineage identity"
```

---

## Task 5: Add N-Run Stagnation Escalation State

**Files:**
- Modify: `scripts/lib/pine-autoresearch-tracks.mjs`
- Modify: `tests/pine-autoresearch-tracks.test.mjs`

- [ ] **Step 1: Add failing scheduler escalation tests**

Append to `tests/pine-autoresearch-tracks.test.mjs`:

```js
test('nextTrackState escalates stagnation level after repeated no-new-candidate runs', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noNewCandidateStreak: 2,
      stagnationLevel: 0,
    },
    policy: {
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        maxStagnationLevel: 3,
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-a',
      championFingerprint: 'fp-a',
      noNewCandidate: true,
      generatedAt: '2026-05-03T00:00:00.000Z',
    },
  });

  assert.equal(next.noNewCandidateStreak, 3);
  assert.equal(next.stagnationLevel, 1);
  assert.equal(next.stagnationReason, 'noNewCandidateStreak');
  assert.equal(next.lastEscalatedAt, '2026-05-03T00:00:00.000Z');
});

test('nextTrackState escalates after repeated high-similarity holds', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      noChangeStreak: 4,
      stagnationLevel: 1,
    },
    policy: {
      stagnation: {
        enabled: true,
        holdEscalateAfter: 4,
        highSimilarityThreshold: 0.9,
        maxStagnationLevel: 3,
      },
    },
    manifest: {
      activeTrackId: 'track-a',
      candidateFingerprint: 'fp-b',
      championFingerprint: 'fp-a',
      topCandidateSimilarity: 0.94,
      promotionEligible: false,
      generatedAt: '2026-05-03T01:00:00.000Z',
    },
  });

  assert.equal(next.stagnationLevel, 2);
  assert.equal(next.stagnationReason, 'highSimilarityHold');
});

test('nextTrackState decays stagnation after promotion-eligible candidate appears', () => {
  const next = nextTrackState({
    state: {
      ...defaultSchedulerState(),
      stagnationLevel: 2,
      stagnationReason: 'highSimilarityHold',
    },
    policy: { stagnation: { enabled: true } },
    manifest: {
      activeTrackId: 'track-b',
      candidateFingerprint: 'fp-c',
      championFingerprint: 'fp-a',
      promotionEligible: true,
      generatedAt: '2026-05-03T02:00:00.000Z',
    },
  });

  assert.equal(next.stagnationLevel, 0);
  assert.equal(next.stagnationReason, null);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
node --test tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "stagnation"
```

Expected: FAIL because scheduler state lacks stagnation fields.

- [ ] **Step 3: Add default scheduler fields**

In `scripts/lib/pine-autoresearch-tracks.mjs`, extend `defaultSchedulerState()`:

```js
    stagnationLevel: 0,
    stagnationReason: null,
    lastEscalatedAt: null,
    blockedPromotionFingerprints: [],
```

Extend `normalizeSchedulerState()` with finite/string/array guards for these fields.

- [ ] **Step 4: Add stagnation computation in `nextTrackState()`**

Before return, after `noNewCandidateStreak` and `noChangeStreak` are computed, add:

```js
  const stagnationPolicy = isPlainObject(policy.stagnation) ? policy.stagnation : {};
  const stagnationEnabled = stagnationPolicy.enabled === true;
  const maxStagnationLevel = Math.max(1, Number(stagnationPolicy.maxStagnationLevel ?? 3) || 3);
  const noNewCandidateEscalateAfter = Math.max(1, Number(stagnationPolicy.noNewCandidateEscalateAfter ?? 3) || 3);
  const holdEscalateAfter = Math.max(1, Number(stagnationPolicy.holdEscalateAfter ?? 5) || 5);
  const highSimilarityThreshold = Number.isFinite(Number(stagnationPolicy.highSimilarityThreshold))
    ? Number(stagnationPolicy.highSimilarityThreshold)
    : 0.9;

  let stagnationLevel = previous.stagnationLevel ?? 0;
  let stagnationReason = previous.stagnationReason ?? null;
  let lastEscalatedAt = previous.lastEscalatedAt ?? null;

  if (stagnationEnabled && manifest.promotionEligible === true) {
    stagnationLevel = 0;
    stagnationReason = null;
  } else if (stagnationEnabled) {
    const noNewEscalates = noNewCandidateStreak >= noNewCandidateEscalateAfter;
    const highSimilarityHold = manifest.promotionEligible === false
      && noChangeStreak >= holdEscalateAfter
      && Number.isFinite(manifest.topCandidateSimilarity)
      && manifest.topCandidateSimilarity >= highSimilarityThreshold;
    const nextReason = noNewEscalates ? 'noNewCandidateStreak' : highSimilarityHold ? 'highSimilarityHold' : null;
    if (nextReason) {
      stagnationLevel = Math.min(maxStagnationLevel, stagnationLevel + 1);
      stagnationReason = nextReason;
      lastEscalatedAt = manifest.generatedAt ?? previous.lastEscalatedAt ?? null;
    }
  }
```

Add to return:

```js
    stagnationLevel,
    stagnationReason,
    lastEscalatedAt,
    blockedPromotionFingerprints: Array.isArray(previous.blockedPromotionFingerprints) ? previous.blockedPromotionFingerprints : [],
```

- [ ] **Step 5: Run scheduler tests**

Run:

```powershell
node --test tests/pine-autoresearch-tracks.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```powershell
git add scripts/lib/pine-autoresearch-tracks.mjs tests/pine-autoresearch-tracks.test.mjs
git commit -m "feat(pine): track autoresearch stagnation escalation"
```

---

## Task 6: Use Stagnation Level To Widen Search Safely

**Files:**
- Modify: `scripts/lib/pine-track-generators.mjs`
- Modify: `tests/pine-track-generators.test.mjs`

- [ ] **Step 1: Add failing generator escalation tests**

Append to `tests/pine-track-generators.test.mjs`:

```js
test('buildTrackCandidateBatch increases fallback diversity at stagnation level two', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'squeeze-context', sourceFamily: 'squeeze' },
    incumbent: {
      minPredSum: 1.8,
      tpAtrMult: 6.85,
      slAtrMult: 0.5,
      useSqueezeContext: true,
      useDivergenceContext: true,
    },
    maxConfigs: 6,
    historyEvents: [],
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: 2, tabuRejectedFingerprints: [] },
    budgetPolicy: {
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        stagnationFallbackFamilies: ['signal', 'risk', 'exit-state', 'asymmetry'],
        minFallbackConfigs: 4,
        temperatureBoost: 1.5,
      },
    },
  });

  const fallbackFamilies = new Set(batch.filter((item) => item.lane === 'self-loop-fallback').map((item) => item.family));
  assert.equal(batch.length, 6);
  assert.equal(fallbackFamilies.has('exit-state') || fallbackFamilies.has('asymmetry'), true);
});

test('buildTrackCandidateBatch applies stronger temperature at higher stagnation level', () => {
  const batch = buildTrackCandidateBatch({
    track: { trackId: 'divergence-context', sourceFamily: 'divergence' },
    incumbent: { minPredSum: 1.8, tpAtrMult: 6.85, slAtrMult: 0.5, useDivergenceContext: true },
    maxConfigs: 4,
    historyEvents: [],
    schedulerState: { noNewCandidateStreak: 4, stagnationLevel: 3, tabuRejectedFingerprints: [] },
    budgetPolicy: {
      annealing: { enabled: true, baseTemperature: 0.5, growthFactor: 1.5, maxTemperature: 3 },
      selfLoopEscape: {
        enabled: true,
        activateAfter: 1,
        includeFallback: true,
        fallbackFamilies: ['signal', 'risk'],
        minFallbackConfigs: 2,
        temperatureBoost: 1.5,
        stagnationTemperatureBoost: 2,
      },
    },
  });

  const fallbackTemps = batch.filter((item) => item.lane === 'self-loop-fallback').map((item) => item.temperature);
  assert.equal(fallbackTemps.every((value) => value >= 1.5), true);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
node --test tests/pine-track-generators.test.mjs --test-name-pattern "stagnation"
```

Expected: FAIL because generator ignores `stagnationLevel`.

- [ ] **Step 3: Update fallback family selection**

In `scripts/lib/pine-track-generators.mjs`, replace fallback family calculation with:

```js
  const stagnationLevel = Math.max(0, Number(schedulerState.stagnationLevel ?? 0) || 0);
  const configuredFallbackFamilies = Array.isArray(selfLoopEscape.fallbackFamilies) && selfLoopEscape.fallbackFamilies.length > 0
    ? selfLoopEscape.fallbackFamilies
    : ['signal', 'risk'];
  const stagnationFallbackFamilies = stagnationLevel >= 2
    && Array.isArray(selfLoopEscape.stagnationFallbackFamilies)
    && selfLoopEscape.stagnationFallbackFamilies.length > 0
    ? selfLoopEscape.stagnationFallbackFamilies
    : configuredFallbackFamilies;
  const fallbackFamilies = stagnationFallbackFamilies;
```

- [ ] **Step 4: Update fallback temperature boost**

Where `temperatureBoost` is computed, change to:

```js
    const baseTemperatureBoost = Number.isFinite(Number(selfLoopEscape.temperatureBoost))
      ? Number(selfLoopEscape.temperatureBoost)
      : 1.5;
    const stagnationTemperatureBoost = Number.isFinite(Number(selfLoopEscape.stagnationTemperatureBoost))
      ? Number(selfLoopEscape.stagnationTemperatureBoost)
      : 1;
    const temperatureBoost = stagnationLevel > 0
      ? Math.max(baseTemperatureBoost, baseTemperatureBoost * Math.max(1, stagnationTemperatureBoost))
      : baseTemperatureBoost;
```

Keep final temperature capped by existing annealing max where applicable if present; if no cap currently exists for fallback, use:

```js
    const maxTemperature = Number.isFinite(Number(budgetPolicy.annealing?.maxTemperature))
      ? Number(budgetPolicy.annealing.maxTemperature)
      : 6;
    const fallbackTemperature = Number(Math.min(maxTemperature, Math.max(1, temperature) * Math.max(1, temperatureBoost)).toFixed(4));
```

- [ ] **Step 5: Run generator tests**

Run:

```powershell
node --test tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```powershell
git add scripts/lib/pine-track-generators.mjs tests/pine-track-generators.test.mjs
git commit -m "feat(pine): widen search on autoresearch stagnation"
```

---

## Task 7: Wire Stagnation Metadata Into Cycle Manifests

**Files:**
- Modify: `scripts/pine-autoresearch.mjs`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add failing manifest test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('buildScoutOrchestrationState exposes stagnation metadata in manifest', () => {
  const result = buildScoutOrchestrationState({
    config: {
      researchRoot: 'pine/autoresearch/test',
      matrixId: 'test-matrix',
      grid: 'phase3-core',
      searchPolicy: { mode: 'incumbent-local', exploitRatio: 1, paretoShortlistSize: 1 },
      matrixPolicy: { requirePrimaryPromote: true, minShadowPassCount: 1, minShadowPassRatio: 1, requireCandidateChange: true },
      primaryLab: { labId: 'primary' },
      shadowLabs: [],
      blindHoldoutLabs: [],
    },
    runId: 'run-stagnation',
    championState: {
      configId: 'champion-a',
      score: 100,
      tradeCount: 100,
      roiPct: 50,
      profitFactor: 2,
      maxDrawdownPct: 3,
      config: { minPredSum: 1.8 },
    },
    historyEventsBefore: [],
    searchBatch: [],
    primarySweep: { topConfigs: [] },
    matrixCandidates: [],
    trackState: {
      activeTrackId: 'track-a',
      noNewCandidateStreak: 3,
      stagnationLevel: 2,
      stagnationReason: 'noNewCandidateStreak',
    },
  });

  assert.equal(result.manifest.noNewCandidateStreak, 3);
  assert.equal(result.manifest.stagnationLevel, 2);
  assert.equal(result.manifest.stagnationReason, 'noNewCandidateStreak');
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "stagnation metadata"
```

Expected: FAIL because manifest omits stagnation metadata.

- [ ] **Step 3: Pass scheduler stagnation into orchestration**

In `runScout()`, when calling `buildScoutOrchestrationState()`, extend `trackState`:

```js
      stagnationLevel: schedulerState.stagnationLevel ?? 0,
      stagnationReason: schedulerState.stagnationReason ?? null,
      lastEscalatedAt: schedulerState.lastEscalatedAt ?? null,
```

In `buildScoutOrchestrationState()`, add to manifest:

```js
      stagnationLevel: trackState.stagnationLevel ?? 0,
      stagnationReason: trackState.stagnationReason ?? null,
      lastEscalatedAt: trackState.lastEscalatedAt ?? null,
```

When calling `nextTrackState()`, pass these fields in the manifest object too:

```js
      stagnationLevel: manifest.stagnationLevel,
      stagnationReason: manifest.stagnationReason,
      lastEscalatedAt: manifest.lastEscalatedAt,
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tracks.test.mjs --test-name-pattern "stagnation|buildScoutOrchestrationState"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7**

```powershell
git add scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): expose autoresearch stagnation state"
```

---

## Task 8: Add Config Defaults For Elite Guardrails

**Files:**
- Modify: `config/pine-autoresearch.default.json`
- Modify: `tests/pine-autoresearch.test.mjs`

- [ ] **Step 1: Add config normalization test**

Append to `tests/pine-autoresearch.test.mjs`:

```js
test('loadConfig exposes lineage and stagnation guardrail defaults', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-elite-config-'));
  try {
    const scriptPath = path.join(dir, 'strategy.pine');
    const configPath = path.join(dir, 'config.json');
    await fs.writeFile(scriptPath, 'x = input.float(1.8, "minPredSum")\n', 'utf8');
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'elite-config-test',
      scriptPath,
      researchRoot: path.join(dir, 'research'),
      digestRoot: path.join(dir, 'digest'),
      baseConfig: { minPredSum: 1.8 },
      autoPromotion: { enabled: true },
      rotationPolicy: {},
    }), 'utf8');

    const config = await autoresearchCli.loadConfig(dir, configPath, {});
    assert.equal(config.autoPromotion.requireMatrixPromotion, true);
    assert.equal(config.autoPromotion.lineagePolicy.enabled, true);
    assert.equal(config.autoPromotion.lineagePolicy.lookbackPromotions, 6);
    assert.equal(config.rotationPolicy.stagnation.enabled, true);
    assert.equal(config.rotationPolicy.stagnation.noNewCandidateEscalateAfter, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "guardrail defaults"
```

Expected: FAIL because defaults are not normalized.

- [ ] **Step 3: Update default config JSON**

In `config/pine-autoresearch.default.json`, set:

```json
"autoPromotion": {
  "enabled": true,
  "cooldownHours": 12,
  "maxPromotionsPerDay": 2,
  "requireMatrixPromotion": true,
  "lineagePolicy": {
    "enabled": true,
    "lookbackPromotions": 6,
    "familyKeys": [
      "useSignalFusion",
      "useFusionV2",
      "useFusionV3",
      "useFusionV4",
      "useDivergenceContext",
      "useSqueezeContext",
      "useSupertrendFilter",
      "useTrailingStop",
      "useStopsTP"
    ],
    "baseShadowPassCount": 3,
    "directReversalExtraShadowPasses": 1,
    "minExtraAggregateScoreDelta": 5,
    "minExtraAggregateRoiDeltaPct": 0
  }
}
```

In `rotationPolicy`, add:

```json
"stagnation": {
  "enabled": true,
  "noNewCandidateEscalateAfter": 3,
  "holdEscalateAfter": 5,
  "highSimilarityThreshold": 0.9,
  "maxStagnationLevel": 3
}
```

In `searchPolicy.selfLoopEscape`, add:

```json
"stagnationFallbackFamilies": ["signal", "risk", "exit-state", "asymmetry"],
"stagnationTemperatureBoost": 2
```

- [ ] **Step 4: Normalize defaults in `loadConfig()`**

In `scripts/pine-autoresearch.mjs`, inside `loadConfig()`, merge defaults so minimal configs get the same shape:

```js
    autoPromotion: {
      enabled: false,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
      lineagePolicy: {
        enabled: true,
        lookbackPromotions: 6,
        familyKeys: [
          'useSignalFusion',
          'useFusionV2',
          'useFusionV3',
          'useFusionV4',
          'useDivergenceContext',
          'useSqueezeContext',
          'useSupertrendFilter',
          'useTrailingStop',
          'useStopsTP',
        ],
        baseShadowPassCount: 3,
        directReversalExtraShadowPasses: 1,
        minExtraAggregateScoreDelta: 5,
        minExtraAggregateRoiDeltaPct: 0,
        ...(raw.autoPromotion?.lineagePolicy || {}),
      },
      ...(raw.autoPromotion || {}),
    },
```

For `rotationPolicy`, merge:

```js
    rotationPolicy: {
      ...(raw.rotationPolicy || {}),
      stagnation: {
        enabled: true,
        noNewCandidateEscalateAfter: 3,
        holdEscalateAfter: 5,
        highSimilarityThreshold: 0.9,
        maxStagnationLevel: 3,
        ...(raw.rotationPolicy?.stagnation || {}),
      },
    },
```

Preserve existing raw config values when explicitly set.

- [ ] **Step 5: Run config tests**

Run:

```powershell
node --test tests/pine-autoresearch.test.mjs --test-name-pattern "guardrail defaults|loadConfig"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 8**

```powershell
git add config/pine-autoresearch.default.json scripts/pine-autoresearch.mjs tests/pine-autoresearch.test.mjs
git commit -m "feat(pine): configure elite autoresearch guardrails"
```

---

## Task 9: Document Elite Autoresearch Operator Model

**Files:**
- Modify: `docs/pine-autoresearch.md`

- [ ] **Step 1: Add documentation section**

Append to `docs/pine-autoresearch.md`:

```md
## Elite autonomous research guardrails

The non-LLM autoresearch lane is designed as a guarded autonomous research system, not a blind optimizer.

Autopromote is allowed only when all layers agree:

1. the cycle wrote an exact manifest
2. matrix decision is `promote`
3. candidate differs from current champion
4. expectancy policy does not reject the improvement
5. promotion queue still matches the exact manifest and champion fingerprint at decision time
6. cooldown and daily quota pass
7. lineage anti-ping-pong gate passes

### Why promotion speed is capped

Research can run often. Promotion is durable champion replacement. Every promotion changes the baseline for future comparisons, so unattended promotion must limit champion churn even when matrix gates are strong.

Recommended profiles:

| Profile | cooldownHours | maxPromotionsPerDay | Use |
|---|---:|---:|---|
| Conservative production | 24 | 1 | safest unattended champion evolution |
| Balanced autonomous | 12 | 2 | recommended default for current system |
| Aggressive lab | 6 | 4 | sandbox or high-observation mode |

Do not use 24 promotions/day for live champion state unless the run is explicitly a lab experiment.

### Anti-ping-pong lineage

Promotion history records from/to fingerprints and family keys. If a candidate tries to reverse a recent promotion, autopromote blocks it unless the new evidence has extra margin.

This prevents A → B → A → B churn caused by micro-regime noise.

### N-run escape

Repeated no-new-candidate, high-similarity hold, or same-track stagnation increases `stagnationLevel` in scheduler state. Higher stagnation level widens fallback families and raises mutation temperature.

Stagnation escape changes search pressure only. It never weakens matrix, expectancy, queue, cooldown, or lineage promotion gates.
```

- [ ] **Step 2: Run markdown/content check**

Run:

```powershell
node -e "const fs=require('fs');const t=fs.readFileSync('docs/pine-autoresearch.md','utf8');for(const s of ['Elite autonomous research guardrails','Anti-ping-pong lineage','N-run escape','Balanced autonomous']){if(!t.includes(s)){console.error('missing '+s);process.exit(1)}}console.log('docs ok')"
```

Expected: prints `docs ok`.

- [ ] **Step 3: Commit Task 9**

```powershell
git add docs/pine-autoresearch.md
git commit -m "docs(pine): explain elite autoresearch guardrails"
```

---

## Task 10: Full Verification And Safety Review

**Files:**
- No code changes unless verification finds a bug.

- [ ] **Step 1: Run targeted autoresearch tests**

Run:

```powershell
node --test tests/pine-autoresearch-lineage.test.mjs tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-track-generators.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-autoresearch-lock.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run non-LLM no-regression focused suite**

Run:

```powershell
npm test -- tests/pine-autoresearch.test.mjs tests/pine-autoresearch-tracks.test.mjs tests/pine-autoresearch-lock.test.mjs tests/pine-promotion-queue.test.mjs tests/pine-track-generators.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run digest smoke check**

Run:

```powershell
npm run pine:autoresearch:digest
```

Expected: exits 0 and writes digest. It may update digest markdown artifacts; do not commit generated runtime/report artifacts unless intentionally changed and reviewed.

- [ ] **Step 4: Run diff check**

Run:

```powershell
git diff --check
```

Expected: exit 0.

- [ ] **Step 5: Inspect dirty tree**

Run:

```powershell
git status --short
```

Expected: only intentional source/test/config/docs files are dirty before commit, or clean after commits. Runtime files under `pine/autoresearch*/.../state`, manifests, report digests, and `pine/test.pine` must not be committed unless explicitly intended.

- [ ] **Step 6: Final safety review checklist**

Verify manually from diff:

```text
- Matrix promote still required by default.
- Autopromote still consumes exact queued manifest.
- Queue stale check still blocks when champion changed since queue decision.
- Lineage gate blocks direct reversal unless extra margin passes.
- Stagnation escape affects search only, not promotion thresholds.
- No LLM lane files changed.
- No runtime artifacts committed.
```

- [ ] **Step 7: Commit fixes only if needed**

If verification required fixes:

```powershell
git add <fixed-files>
git commit -m "fix(pine): stabilize elite autoresearch guardrails"
```

If no fixes required, do not create an empty commit.

---

## Self-Review

### Spec coverage

- Same data / same challenger escape: Tasks 5, 6, 7 strengthen existing no-new-candidate and fallback escalation.
- Ping-pong condition: Tasks 1, 2, 3, 4 add lineage memory and direct reversal gate.
- Ping-pong after N runs: Tasks 5, 6, 7 add N-run stagnation escalation.
- Guarded matrix autopromote: Tasks 2, 3, 4, 8 keep exact queue + matrix + lineage guardrails.
- Bottom-line elite autonomous research: Task 9 documents the operator model and recommended profiles.
- Regime-aware champion portfolio: explicitly excluded.

### Placeholder scan

No placeholder markers remain. Every implementation task names exact files, commands, and expected results.

### Type consistency

New exported functions are consistently named:
- `buildCandidateFamilyKey({ config, familyKeys })`
- `summarizePromotionLineage({ historyEvents, limit })`
- `detectPingPongRisk({ candidateFingerprint, candidateFamilyKey, currentChampionFingerprint, currentChampionFamilyKey, lineage, policy })`
- `decideLineagePromotionGate({ candidateFingerprint, candidateFamilyKey, currentChampionFingerprint, currentChampionFamilyKey, lineage, matrixDecision, robustness, policy })`

Scheduler fields are consistently named:
- `stagnationLevel`
- `stagnationReason`
- `lastEscalatedAt`
- `blockedPromotionFingerprints`

Manifest/history fields are consistently named:
- `candidateFingerprint`
- `championFingerprint`
- `candidateFamilyKey`
- `championFamilyKey`
- `fromFingerprint`
- `toFingerprint`
- `fromFamilyKey`
- `toFamilyKey`
