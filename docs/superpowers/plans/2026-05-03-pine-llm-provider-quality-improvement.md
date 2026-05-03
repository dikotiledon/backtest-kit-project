# Pine LLM Provider Quality Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pine:autoresearch:llm` behave like a matrix-aware research assistant instead of a generic trading-tip generator, while preserving strict isolation from non-LLM autoresearch.

**Architecture:** Add a local quality layer between provider output and matrix execution. Improve prompt/context so providers see champion baseline, latest matrix blocker, recent failures, and anti-generic rules; then add deterministic candidate quality scoring and bounded re-ask before expensive matrix evaluation. Provider transport retries are separate from candidate retries.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON/JSONL state files, current Pine autoresearch matrix evaluator, OpenAI-compatible provider support.

---

## Non-Negotiable Constraints

- Do not change existing non-LLM `pine:autoresearch*` behavior.
- Do not write LLM candidates into existing non-LLM `promotion-queue.jsonl`.
- Do not autopromote LLM output.
- Keep LLM lane state under `pine/autoresearch-llm/llm-<matrix-id>/`.
- Keep provider responses untrusted; local parse/schema/allowlist/fingerprint/quality/evaluator gates decide.
- Keep scheduled `openclaw` provider rejected.
- Avoid network calls in tests; inject provider functions.
- Commit each task after tests pass.

## Current Problem

Observed OpenRouter-style output is syntactically valid but strategically weak:

```json
{"params":{"minPredSum":1.2,"riskRewardRatio":2.5,"stopLossPct":0.5},"rationale":"Lower minPredSum increases entry frequency while staying selective; higher riskRewardRatio improves profit potential; tighter stopLossPct reduces losses, all within allowed ranges and under maxChangedParams."}
```

Why weak:

- generic trading advice, not matrix-aware research;
- no current champion baseline;
- no latest hold/promote blocker;
- no primary/shadow lab tradeoff;
- no awareness of recent duplicate/invalid/rejected fingerprints;
- risky combination: lower threshold + tighter stop can increase noisy chop;
- no falsifiable hypothesis beyond “more entries, better RR, fewer losses”.

## File Structure

### Create

- `scripts/lib/pine-autoresearch-llm-quality.mjs` — deterministic candidate quality scoring, generic-pattern detection, and re-ask feedback builder.
- `tests/pine-autoresearch-llm-quality.test.mjs` — unit tests for quality scoring and feedback prompts.

### Modify

- `scripts/lib/pine-autoresearch-llm-context.mjs` — strengthen hard rules and add matrix-aware prompt sections.
- `scripts/lib/pine-autoresearch-llm-memory.mjs` — store compact failure lessons and recent pattern summaries.
- `scripts/lib/pine-autoresearch-llm-runner.mjs` — run quality preflight after schema validation; re-ask provider once for low-quality candidates; keep matrix execution gated.
- `scripts/lib/pine-autoresearch-llm-openai-provider.mjs` — improve provider instruction to require evidence-bound, falsifiable candidate rationale.
- `config/pine-autoresearch-llm.default.json` — add quality and transport retry knobs with safe defaults.
- `tests/pine-autoresearch-llm-context.test.mjs` — assert prompt includes matrix-aware rules.
- `tests/pine-autoresearch-llm-memory.test.mjs` — assert memory keeps compact failure lessons.
- `tests/pine-autoresearch-llm-runner.test.mjs` — assert low-quality candidate triggers one re-ask and high-quality candidate proceeds.
- `tests/pine-autoresearch-llm-openai-provider.test.mjs` — assert system instruction demands matrix evidence and no generic trading advice.
- `docs/pine-llm-autoresearch.md` — document quality gate, re-ask behavior, and provider retry distinction.

---

## Task 1: Add Candidate Quality Module

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-quality.mjs`
- Create: `tests/pine-autoresearch-llm-quality.test.mjs`

- [ ] **Step 1: Write failing quality tests**

Create `tests/pine-autoresearch-llm-quality.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQualityFeedbackPrompt,
  scoreCandidateQuality,
} from '../scripts/lib/pine-autoresearch-llm-quality.mjs';

const champion = {
  minPredSum: 1.8,
  riskRewardRatio: 2,
  stopLossPct: 1,
  divRsiLen: 21,
};

const memory = {
  latestMatrixBlocker: {
    recommendation: 'hold',
    reason: 'matrix failed primaryPromote gate(s)',
    aggregateScoreDelta: 13.28,
    aggregateRoiDeltaPct: 15.15,
    promotedLabCount: 3,
    labCount: 6,
  },
  recentCandidates: [
    {
      params: { minPredSum: 1.2, riskRewardRatio: 2, stopLossPct: 1 },
      outcome: 'candidate_invalid',
      reason: 'duplicate candidate fingerprint',
    },
  ],
  failureLessons: [
    'Avoid generic lower-threshold plus tighter-stop patches unless matrix evidence supports churn reduction.',
  ],
};

test('scoreCandidateQuality flags generic lower-threshold tighter-stop candidate', () => {
  const result = scoreCandidateQuality({
    candidate: {
      params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
      rationale: 'Lower minPredSum increases entry frequency while staying selective; higher riskRewardRatio improves profit potential; tighter stopLossPct reduces losses.',
    },
    champion,
    memory,
    config: { quality: { minScore: 70 } },
  });

  assert.equal(result.ok, false);
  assert.equal(result.score < 70, true);
  assert.equal(result.flags.includes('generic_threshold_rr_stop_pattern'), true);
  assert.equal(result.flags.includes('missing_matrix_blocker_reference'), true);
  assert.equal(result.flags.includes('missing_champion_baseline_reference'), true);
});

test('scoreCandidateQuality accepts matrix-aware candidate with modest scoped patch', () => {
  const result = scoreCandidateQuality({
    candidate: {
      params: { minPredSum: 1.6, riskRewardRatio: 2.2, divRsiLen: 18 },
      rationale: 'Champion minPredSum 1.8 held because primaryPromote failed despite positive aggregate ROI delta. This patch modestly increases entries without tightening stops, improves reward asymmetry, and shortens divergence sensitivity to test whether primary labs catch more valid reversals while shadow risk stays bounded.',
    },
    champion,
    memory,
    config: { quality: { minScore: 70 } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.score >= 70, true);
  assert.deepEqual(result.flags, []);
});

test('buildQualityFeedbackPrompt gives actionable re-ask instructions', () => {
  const quality = {
    ok: false,
    score: 42,
    flags: [
      'generic_threshold_rr_stop_pattern',
      'missing_matrix_blocker_reference',
      'missing_champion_baseline_reference',
    ],
    notes: [
      'Candidate looks like generic trading advice instead of matrix-aware research.',
    ],
  };

  const prompt = buildQualityFeedbackPrompt('BASE PROMPT', { quality, candidate: { params: { minPredSum: 1.2 } } });

  assert.match(prompt, /Previous candidate passed JSON schema but failed quality preflight/);
  assert.match(prompt, /generic_threshold_rr_stop_pattern/);
  assert.match(prompt, /latest matrix blocker/);
  assert.match(prompt, /current champion baseline/);
  assert.match(prompt, /Return exactly one JSON object/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-quality.test.mjs
```

Expected: FAIL with module not found for `pine-autoresearch-llm-quality.mjs`.

- [ ] **Step 3: Implement quality module**

Create `scripts/lib/pine-autoresearch-llm-quality.mjs`:

```js
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textIncludesAny(text, terms) {
  const haystack = String(text ?? '').toLowerCase();
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function changedParamKeys(candidate) {
  if (!isPlainObject(candidate?.params)) return [];
  return Object.keys(candidate.params).sort();
}

function isLowerThanChampion(key, candidate, champion) {
  const next = Number(candidate?.params?.[key]);
  const current = Number(champion?.[key]);
  return Number.isFinite(next) && Number.isFinite(current) && next < current;
}

function isHigherThanChampion(key, candidate, champion) {
  const next = Number(candidate?.params?.[key]);
  const current = Number(champion?.[key]);
  return Number.isFinite(next) && Number.isFinite(current) && next > current;
}

function scorePenalty(result, flag, points, note) {
  result.score -= points;
  result.flags.push(flag);
  result.notes.push(note);
}

export function scoreCandidateQuality({ candidate, champion = {}, memory = {}, config = {} } = {}) {
  const minScore = Number(config?.quality?.minScore ?? 70);
  const result = {
    ok: true,
    score: 100,
    flags: [],
    notes: [],
  };

  const params = changedParamKeys(candidate);
  const rationale = String(candidate?.rationale ?? '');
  const latestBlocker = memory?.latestMatrixBlocker ?? memory?.latestOutcome ?? null;

  if (params.length === 0) {
    scorePenalty(result, 'empty_candidate_params', 45, 'Candidate makes no parameter change.');
  }

  if (params.length > 3) {
    scorePenalty(result, 'too_many_changed_params_for_research_quality', 10, 'Prefer <= 3 params unless rationale is exceptionally specific.');
  }

  const genericThresholdRrStop = params.includes('minPredSum')
    && params.includes('riskRewardRatio')
    && params.includes('stopLossPct')
    && isLowerThanChampion('minPredSum', candidate, champion)
    && isHigherThanChampion('riskRewardRatio', candidate, champion)
    && isLowerThanChampion('stopLossPct', candidate, champion);

  if (genericThresholdRrStop) {
    scorePenalty(
      result,
      'generic_threshold_rr_stop_pattern',
      28,
      'Lower threshold + higher RR + tighter stop is a common generic patch and needs matrix-specific justification.',
    );
  }

  const referencesChampion = Object.keys(champion ?? {}).some((key) => rationale.includes(key))
    || textIncludesAny(rationale, ['champion', 'baseline', 'current value', 'current config']);
  if (!referencesChampion) {
    scorePenalty(result, 'missing_champion_baseline_reference', 16, 'Rationale must reference current champion or baseline values.');
  }

  const referencesMatrix = textIncludesAny(rationale, [
    'matrix',
    'primary',
    'shadow',
    'promote',
    'hold',
    'gate',
    'roi',
    'drawdown',
    'profit factor',
    'trade count',
  ]);
  if (latestBlocker && !referencesMatrix) {
    scorePenalty(result, 'missing_matrix_blocker_reference', 18, 'Rationale must target latest matrix blocker or primary/shadow tradeoff.');
  }

  const referencesNovelty = textIncludesAny(rationale, [
    'avoid',
    'recent',
    'duplicate',
    'rejected',
    'novel',
    'previous',
    'fingerprint',
  ]);
  if ((memory?.recentCandidates?.length ?? 0) > 0 && !referencesNovelty) {
    scorePenalty(result, 'missing_recent_failure_awareness', 10, 'Rationale should explain how it avoids recent failed or duplicate candidates.');
  }

  if (String(rationale).length < 140) {
    scorePenalty(result, 'rationale_too_short_for_research_quality', 10, 'Rationale is too short to be an evidence-bound research hypothesis.');
  }

  result.score = Math.max(0, Math.round(result.score));
  result.ok = result.score >= minScore && result.flags.length === 0;
  return result;
}

export function buildQualityFeedbackPrompt(basePrompt, { quality, candidate } = {}) {
  return [
    String(basePrompt ?? ''),
    '',
    'Previous candidate passed JSON schema but failed quality preflight.',
    `Quality score: ${quality?.score ?? 'unknown'}`,
    `Flags: ${(quality?.flags ?? []).join(', ') || 'none'}`,
    `Notes: ${(quality?.notes ?? []).join(' ') || 'none'}`,
    `Rejected candidate preview: ${JSON.stringify(candidate ?? {}).slice(0, 1000)}`,
    '',
    'Revise the candidate as a matrix-aware research hypothesis:',
    '- reference the current champion baseline or current parameter value;',
    '- target the latest matrix blocker, primary/shadow imbalance, ROI, drawdown, profit factor, or trade-count issue;',
    '- avoid repeating recent duplicate/rejected candidate families;',
    '- prefer <= 3 changed params;',
    '- do not use generic lower-threshold + higher-RR + tighter-stop logic unless matrix evidence supports it;',
    '- return exactly one JSON object matching the schema. No markdown. No prose. No code fences.',
  ].join('\n');
}
```

- [ ] **Step 4: Run quality tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-quality.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/lib/pine-autoresearch-llm-quality.mjs tests/pine-autoresearch-llm-quality.test.mjs
git commit -m "feat(pine): add llm candidate quality preflight"
```

---

## Task 2: Upgrade Prompt Context For Matrix-Aware Research

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-context.mjs:29-117`
- Modify: `tests/pine-autoresearch-llm-context.test.mjs`

- [ ] **Step 1: Add failing context test**

Append to `tests/pine-autoresearch-llm-context.test.mjs`:

```js
test('buildLlmResearchContext includes matrix-aware research rules and blockers', () => {
  const result = buildLlmResearchContext({
    champion: { minPredSum: 1.8, riskRewardRatio: 2, stopLossPct: 1 },
    allowlist: { parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1 }] },
    memory: {
      latestMatrixBlocker: {
        recommendation: 'hold',
        reason: 'matrix failed primaryPromote gate(s)',
        aggregateRoiDeltaPct: 15.15,
        promotedLabCount: 3,
        labCount: 6,
      },
      failureLessons: [
        'Avoid generic lower-threshold plus tighter-stop patches unless matrix evidence supports churn reduction.',
      ],
    },
    maxPromptBytes: 16384,
  });

  assert.match(result.prompt, /falsifiable candidate patch/i);
  assert.match(result.prompt, /latest matrix blocker/i);
  assert.match(result.prompt, /current champion baseline/i);
  assert.match(result.prompt, /primary\/shadow/i);
  assert.match(result.prompt, /generic lower-threshold/i);
  assert.match(result.prompt, /primaryPromote/);
});
```

- [ ] **Step 2: Run context test to verify it fails**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-context.test.mjs
```

Expected: FAIL because prompt lacks the new research rules.

- [ ] **Step 3: Modify hard rules and payload**

In `scripts/lib/pine-autoresearch-llm-context.mjs`, replace `buildHardRules(maxPromptBytes)` with:

```js
function buildHardRules(maxPromptBytes) {
  return [
    'Return exactly one strict JSON object matching the candidate schema.',
    'No markdown.',
    'No code fences.',
    'No extra commentary.',
    'Propose one falsifiable candidate patch targeting the latest matrix blocker.',
    'Reference the current champion baseline or current parameter values in rationale.',
    'Reference primary/shadow, hold/promote gate, ROI, drawdown, profit factor, or trade-count evidence when available.',
    'Avoid generic lower-threshold + higher-RR + tighter-stop advice unless the matrix evidence specifically supports that tradeoff.',
    'Avoid recent duplicate/rejected candidate families and explain the novelty.',
    'Prefer no more than 3 changed params even if maxChangedParams allows 4.',
    `Keep prompt within ${Number.isFinite(maxPromptBytes) ? maxPromptBytes : 16384} bytes.`,
  ];
}
```

Also ensure `buildFullPromptPayload` includes memory as-is so these fields are visible:

```js
function buildFullPromptPayload({ champion, allowlist, memory, maxPromptBytes }) {
  return {
    instructions: buildHardRules(maxPromptBytes),
    budget: {
      maxPromptBytes,
    },
    requiredOutput: {
      params: 'object of allowlisted parameter changes only',
      rationale: 'concise matrix-aware research hypothesis, not generic trading advice',
    },
    champion: isPlainObject(champion) ? { ...champion } : {},
    allowlist: isPlainObject(allowlist) ? { ...allowlist } : {},
    researchContext: {
      latestMatrixBlocker: memory?.latestMatrixBlocker ?? null,
      recentCandidates: Array.isArray(memory?.recentCandidates) ? memory.recentCandidates : [],
      failureLessons: Array.isArray(memory?.failureLessons) ? memory.failureLessons : [],
      topWinners: Array.isArray(memory?.topWinners) ? memory.topWinners : [],
      rejectedFingerprints: Array.isArray(memory?.rejectedFingerprints) ? memory.rejectedFingerprints : [],
      activeHypotheses: Array.isArray(memory?.activeHypotheses) ? memory.activeHypotheses : [],
    },
  };
}
```

If existing code already uses different helper names, preserve current helper structure and only add equivalent `requiredOutput` + `researchContext` fields.

- [ ] **Step 4: Run context tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-context.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/lib/pine-autoresearch-llm-context.mjs tests/pine-autoresearch-llm-context.test.mjs
git commit -m "feat(pine): make llm research prompt matrix aware"
```

---

## Task 3: Persist Compact Failure Lessons In Research Memory

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-memory.mjs:62-79`
- Modify: `tests/pine-autoresearch-llm-memory.test.mjs`

- [ ] **Step 1: Add failing memory tests**

Append to `tests/pine-autoresearch-llm-memory.test.mjs`:

```js
test('updateResearchMemory records compact matrix blocker and failure lesson', () => {
  const next = updateResearchMemory({}, {
    type: 'completed',
    candidate: { params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 } },
    metricsDelta: {
      recommendation: 'hold',
      summary: 'Hold champion: matrix failed primaryPromote gate(s).',
      aggregateRoiDeltaPct: 15.15,
      aggregateDrawdownDeltaPct: 0.77,
      promotedLabCount: 3,
      labCount: 6,
    },
  }, { recentCandidates: 20, failureLessons: 20 });

  assert.equal(next.latestMatrixBlocker.recommendation, 'hold');
  assert.match(next.latestMatrixBlocker.reason, /primaryPromote/);
  assert.equal(next.latestMatrixBlocker.promotedLabCount, 3);
  assert.equal(next.failureLessons.length, 1);
  assert.match(next.failureLessons[0], /primaryPromote/);
});

test('updateResearchMemory records duplicate invalid response lesson', () => {
  const next = updateResearchMemory({}, {
    type: 'candidate_invalid',
    reason: 'duplicate candidate fingerprint',
    candidate: { params: { minPredSum: 1.2, riskRewardRatio: 2, stopLossPct: 1 } },
  }, { recentCandidates: 20, failureLessons: 20 });

  assert.equal(next.failureLessons.length, 1);
  assert.match(next.failureLessons[0], /duplicate candidate fingerprint/);
  assert.equal(next.recentCandidates[0].outcome, 'candidate_invalid');
});
```

If `tests/pine-autoresearch-llm-memory.test.mjs` lacks imports, ensure it imports:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { updateResearchMemory } from '../scripts/lib/pine-autoresearch-llm-memory.mjs';
```

- [ ] **Step 2: Run memory tests to verify failure**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-memory.test.mjs
```

Expected: FAIL because `latestMatrixBlocker`/`failureLessons` are not maintained yet.

- [ ] **Step 3: Implement memory lesson helpers**

In `scripts/lib/pine-autoresearch-llm-memory.mjs`, add helpers before `updateResearchMemory`:

```js
function compactCandidateParams(candidate) {
  return candidate?.params && typeof candidate.params === 'object' && !Array.isArray(candidate.params)
    ? { ...candidate.params }
    : {};
}

function buildFailureLesson(event) {
  if (event?.type === 'candidate_invalid') {
    return `Candidate invalid: ${event.reason ?? 'unknown'} for params ${JSON.stringify(compactCandidateParams(event.candidate)).slice(0, 240)}`;
  }

  const delta = event?.metricsDelta ?? {};
  if (delta.recommendation === 'hold') {
    return `Matrix hold: ${delta.summary ?? delta.reason ?? 'no summary'} ROI delta ${delta.aggregateRoiDeltaPct ?? 'n/a'} drawdown delta ${delta.aggregateDrawdownDeltaPct ?? 'n/a'} promoted labs ${delta.promotedLabCount ?? 'n/a'}/${delta.labCount ?? 'n/a'}`.slice(0, 500);
  }

  return null;
}

function compactMatrixBlocker(event) {
  const delta = event?.metricsDelta ?? {};
  if (!delta.recommendation) return null;
  return {
    recommendation: delta.recommendation,
    reason: delta.summary ?? delta.reason ?? null,
    aggregateScoreDelta: delta.aggregateScoreDelta ?? null,
    aggregateRoiDeltaPct: delta.aggregateRoiDeltaPct ?? null,
    aggregateProfitFactorDelta: delta.aggregateProfitFactorDelta ?? null,
    aggregateDrawdownDeltaPct: delta.aggregateDrawdownDeltaPct ?? null,
    promotedLabCount: delta.promotedLabCount ?? null,
    labCount: delta.labCount ?? null,
  };
}
```

Then update `updateResearchMemory` so it preserves and caps:

```js
export function updateResearchMemory(memory, event, caps = {}) {
  const next = {
    ...memory,
    recentCandidates: Array.isArray(memory?.recentCandidates) ? [...memory.recentCandidates] : [],
    topWinners: Array.isArray(memory?.topWinners) ? [...memory.topWinners] : [],
    rejectedFingerprints: Array.isArray(memory?.rejectedFingerprints) ? [...memory.rejectedFingerprints] : [],
    activeHypotheses: Array.isArray(memory?.activeHypotheses) ? [...memory.activeHypotheses] : [],
    failureLessons: Array.isArray(memory?.failureLessons) ? [...memory.failureLessons] : [],
  };

  const matrixBlocker = compactMatrixBlocker(event);
  if (matrixBlocker) next.latestMatrixBlocker = matrixBlocker;

  const lesson = buildFailureLesson(event);
  if (lesson && !next.failureLessons.includes(lesson)) {
    next.failureLessons.unshift(lesson);
  }

  if (event?.candidate || event?.candidateFingerprint || event?.reason) {
    next.recentCandidates.unshift({
      at: event?.at ?? new Date(0).toISOString(),
      fingerprint: event?.candidateFingerprint ?? null,
      params: compactCandidateParams(event?.candidate),
      outcome: event?.metricsDelta?.recommendation ?? event?.reason ?? event?.type ?? 'unknown',
      reason: event?.metricsDelta?.summary ?? event?.reason ?? null,
    });
  }

  const maxFailureLessons = Number(caps.failureLessons ?? 20);
  next.failureLessons = next.failureLessons.slice(0, Number.isFinite(maxFailureLessons) ? Math.max(0, maxFailureLessons) : 20);

  return pruneResearchMemory(next, caps);
}
```

If current `updateResearchMemory` already appends candidate/winner fields, merge this logic instead of replacing unrelated behavior.

- [ ] **Step 4: Run memory tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-memory.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/lib/pine-autoresearch-llm-memory.mjs tests/pine-autoresearch-llm-memory.test.mjs
git commit -m "feat(pine): feed llm compact matrix failure lessons"
```

---

## Task 4: Wire Quality Re-Ask Into Runner

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs:190-820`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Add failing runner test for quality re-ask**

Append to `tests/pine-autoresearch-llm-runner.test.mjs`:

```js
test('openai low-quality candidate re-asks once and executes improved candidate', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxCandidateAttempts: 1, maxQualityAttempts: 2 },
      quality: { enabled: true, minScore: 70 },
      champion: { minPredSum: 1.8, riskRewardRatio: 2, stopLossPct: 1, divRsiLen: 21 },
    }), 'utf8');

    const proposals = [
      JSON.stringify({
        params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
        rationale: 'Lower minPredSum increases entry frequency; higher riskRewardRatio improves profit potential; tighter stopLossPct reduces losses.',
      }),
      JSON.stringify({
        params: { minPredSum: 1.6, riskRewardRatio: 2.2, divRsiLen: 18 },
        rationale: 'Champion minPredSum 1.8 held because matrix failed primaryPromote despite positive aggregate ROI delta. This patch modestly increases entries without tightening stops, improves reward asymmetry, and shortens divergence sensitivity while avoiding recent duplicate threshold-stop candidate families.',
      }),
    ];

    const prompts = [];
    let executeCandidate = null;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async ({ prompt }) => {
        prompts.push(prompt);
        return { ok: true, raw: proposals.shift(), source: 'openai-responses' };
      },
      executeCandidate: async ({ candidate }) => {
        executeCandidate = candidate;
        return { ok: true, runId: 'quality-run', metricsDelta: { recommendation: 'hold' } };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /failed quality preflight/);
    assert.deepEqual(executeCandidate.params, { minPredSum: 1.6, riskRewardRatio: 2.2, divRsiLen: 18 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai low-quality candidate stops after configured quality attempts', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxQualityAttempts: 2 },
      quality: { enabled: true, minScore: 70 },
      champion: { minPredSum: 1.8, riskRewardRatio: 2, stopLossPct: 1 },
    }), 'utf8');

    let calls = 0;
    let executed = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return {
          ok: true,
          raw: JSON.stringify({
            params: { minPredSum: 1.2, riskRewardRatio: 2.5, stopLossPct: 0.5 },
            rationale: 'Lower minPredSum increases entry frequency; higher riskRewardRatio improves profit potential; tighter stopLossPct reduces losses.',
          }),
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => {
        executed = true;
        return { ok: true, runId: 'must-not-run' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'candidate_low_quality');
    assert.equal(calls, 2);
    assert.equal(executed, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run runner tests to verify failure**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs --test-name-pattern "quality"
```

Expected: FAIL because quality re-ask is not wired.

- [ ] **Step 3: Import quality helpers**

At top of `scripts/lib/pine-autoresearch-llm-runner.mjs`, add:

```js
import {
  buildQualityFeedbackPrompt,
  scoreCandidateQuality,
} from './pine-autoresearch-llm-quality.mjs';
```

- [ ] **Step 4: Add quality attempt normalizer**

Near `normalizeMaxCandidateAttempts`, add:

```js
function normalizeMaxQualityAttempts(provider = {}, quality = {}) {
  if (quality?.enabled === false) return 1;
  const value = Number(provider.maxQualityAttempts ?? quality.maxAttempts ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(3, Math.floor(value)));
}
```

- [ ] **Step 5: Apply quality preflight after parse/schema validation**

Inside the provider proposal loop, after `parseAndValidateProposal(...)` succeeds but before reservation/execution, add logic equivalent to:

```js
const maxQualityAttempts = normalizeMaxQualityAttempts(baseProvider, config.quality);
let qualityPrompt = prompt;
let qualityResult = null;

for (let qualityAttempt = 1; qualityAttempt <= maxQualityAttempts; qualityAttempt += 1) {
  const proposal = await proposeCandidate({
    provider: { ...baseProvider, prompt: qualityPrompt },
    prompt: qualityPrompt,
    allowlist,
    scheduled,
    allowGuarded: Boolean(config?.candidate?.allowGuarded),
    proposeOpenAi,
  });

  if (!proposal.ok) {
    // keep existing provider failure behavior here
  }

  const parsed = parseAndValidateProposal({ proposal, allowlist, config, ledger, memory });
  qualityResult = scoreCandidateQuality({
    candidate: parsed,
    champion: config.champion ?? {},
    memory,
    config,
  });

  if (qualityResult.ok || config?.quality?.enabled === false) {
    // proceed with existing reservation/execution using parsed
    break;
  }

  if (qualityAttempt >= maxQualityAttempts) {
    await writeProviderStatus(paths, {
      ok: false,
      reason: 'candidate_low_quality',
      details: { quality: qualityResult },
      at: new Date().toISOString(),
    });
    return { ok: false, reason: 'candidate_low_quality', quality: qualityResult };
  }

  qualityPrompt = buildQualityFeedbackPrompt(prompt, { quality: qualityResult, candidate: parsed });
}
```

Do not duplicate provider calls if existing code already loops by `maxCandidateAttempts`. Best implementation: keep existing parse/schema retry as outer loop, then add quality retry as a second bounded loop around validated proposals. Preserve existing invalid-response JSONL behavior for parse/schema failures.

- [ ] **Step 6: Run quality runner tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs --test-name-pattern "quality"
```

Expected: PASS.

- [ ] **Step 7: Run full runner tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): re-ask low-quality llm candidates"
```

---

## Task 5: Harden OpenAI-Compatible Provider Instructions

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-openai-provider.mjs:1-108`
- Modify: `tests/pine-autoresearch-llm-openai-provider.test.mjs`

- [ ] **Step 1: Add failing provider instruction test**

Append to `tests/pine-autoresearch-llm-openai-provider.test.mjs`:

```js
test('chat completions developer instruction demands matrix-aware non-generic candidate', () => {
  const request = buildChatCompletionsRequest({
    provider: { model: 'model-a' },
    prompt: 'prompt-a',
    allowlist: {
      parameters: [{ key: 'minPredSum', type: 'float', min: 0, max: 5, step: 0.1, mutability: 'tunable' }],
    },
  });

  const developer = request.messages.find((message) => message.role === 'developer')?.content ?? '';
  assert.match(developer, /matrix-aware research/i);
  assert.match(developer, /current champion/i);
  assert.match(developer, /latest matrix blocker/i);
  assert.match(developer, /generic trading advice/i);
  assert.match(developer, /falsifiable/i);
});
```

- [ ] **Step 2: Run provider test to verify failure**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-openai-provider.test.mjs --test-name-pattern "developer instruction"
```

Expected: FAIL because instruction lacks new wording.

- [ ] **Step 3: Replace system instruction**

In `scripts/lib/pine-autoresearch-llm-openai-provider.mjs`, replace `systemInstruction()` with:

```js
function systemInstruction() {
  return [
    'You are a matrix-aware research assistant for a Pine Script trading-strategy parameter search.',
    'Return exactly one JSON object and no markdown.',
    'No prose. No code fences. No comments. No trailing explanation.',
    'The JSON object must match the provided schema.',
    'Propose one falsifiable candidate patch, not generic trading advice.',
    'Your rationale must reference the current champion baseline and the latest matrix blocker when those appear in the prompt.',
    'Consider primary/shadow lab balance, hold/promote gates, ROI, drawdown, profit factor, and trade count.',
    'Avoid repeating recent duplicate/rejected candidate families.',
    'Do not default to lower threshold + higher risk/reward + tighter stop unless matrix evidence supports that exact tradeoff.',
    'If you cannot improve the strategy, return a valid JSON object with an empty params object and a concise rationale explaining the blocker.',
  ].join('\n');
}
```

- [ ] **Step 4: Run provider tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-openai-provider.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add scripts/lib/pine-autoresearch-llm-openai-provider.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs
git commit -m "fix(pine): harden llm provider research instruction"
```

---

## Task 6: Add Provider Transport Retry/Backoff

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`
- Modify: `config/pine-autoresearch-llm.default.json`

- [ ] **Step 1: Add failing transport retry tests**

Append to `tests/pine-autoresearch-llm-runner.test.mjs`:

```js
test('openai transient provider failure retries before candidate validation', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxProviderAttempts: 2, providerRetryDelayMs: 0 },
      quality: { enabled: false },
    }), 'utf8');

    let calls = 0;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        if (calls === 1) return { ok: false, reason: 'proposal_failed', error: 'HTTP 502 Bad Gateway', source: 'openai-responses' };
        return {
          ok: true,
          raw: JSON.stringify({
            params: { minPredSum: 1.6 },
            rationale: 'Champion baseline minPredSum 1.8 held at matrix gate; modest threshold test targets trade count without changing stop behavior.',
          }),
          source: 'openai-responses',
        };
      },
      executeCandidate: async () => ({ ok: true, runId: 'provider-retry-run' }),
    });

    assert.equal(result.ok, true);
    assert.equal(calls, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('openai auth provider failure does not retry', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxProviderAttempts: 3, providerRetryDelayMs: 0 },
    }), 'utf8');

    let calls = 0;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return { ok: false, reason: 'proposal_failed', error: '401 Unauthorized invalid API key', source: 'openai-responses' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(calls, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run transport retry tests to verify failure**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs --test-name-pattern "provider failure"
```

Expected: FAIL for transient retry expectation.

- [ ] **Step 3: Implement provider retry helpers**

In `scripts/lib/pine-autoresearch-llm-runner.mjs`, add:

```js
function normalizeMaxProviderAttempts(provider = {}) {
  const value = Number(provider.maxProviderAttempts ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function isTransientProviderError(proposal) {
  const text = `${proposal?.reason ?? ''} ${proposal?.error ?? ''}`.toLowerCase();
  if (/401|403|unauthorized|forbidden|invalid api key|missing api key|schema|unsupported/.test(text)) return false;
  return /timeout|timed out|429|rate limit|temporar|502|503|504|bad gateway|service unavailable|econnreset|network/.test(text);
}

function delay(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, Math.min(value, 30_000)));
}
```

Wrap provider call so `!proposal.ok` transient failures retry up to `maxProviderAttempts`, while auth/config failures do not retry. Preserve existing behavior after attempts exhausted.

- [ ] **Step 4: Add config defaults**

In `config/pine-autoresearch-llm.default.json`, inside `provider`, add:

```json
"maxProviderAttempts": 2,
"providerRetryDelayMs": 1500,
"maxQualityAttempts": 2
```

Inside top-level config, add:

```json
"quality": {
  "enabled": true,
  "minScore": 70,
  "maxAttempts": 2
}
```

Keep JSON valid; do not remove existing provider fields.

- [ ] **Step 5: Run runner tests**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-runner.test.mjs config/pine-autoresearch-llm.default.json
git commit -m "feat(pine): retry transient llm provider failures"
```

---

## Task 7: Documentation And Operator Workflow

**Files:**
- Modify: `docs/pine-llm-autoresearch.md`

- [ ] **Step 1: Add documentation section**

Append to `docs/pine-llm-autoresearch.md`:

```md
## Candidate quality preflight

The LLM lane treats provider output as an untrusted proposal, not a decision.

Validation order:

1. provider returns exactly one JSON object
2. JSON/schema parser accepts it
3. allowlist/range/fingerprint validation accepts it
4. quality preflight scores it against current champion, latest matrix blocker, recent failures, and generic-pattern rules
5. low-quality candidates can be re-asked once with feedback
6. only accepted candidates reach matrix evaluation

The quality gate is intentionally local and deterministic. It catches candidates that are syntactically valid but research-weak, such as generic lower-threshold + higher-RR + tighter-stop patches that do not reference matrix evidence.

Config:

```json
{
  "quality": {
    "enabled": true,
    "minScore": 70,
    "maxAttempts": 2
  },
  "provider": {
    "maxQualityAttempts": 2
  }
}
```

## Provider retry vs candidate retry

There are three different retry paths:

| Retry type | Handles | Does not handle |
|---|---|---|
| Provider retry | timeout, 429, 502, 503, 504, transient network/provider failures | auth errors, missing key, unsupported provider, schema/config errors |
| Candidate JSON retry | malformed JSON, schema-invalid output | provider failures |
| Quality re-ask | valid but generic/low-quality candidate | matrix hold after real evaluation |

Matrix `hold` is not a provider failure. It means the candidate was evaluated and did not earn promotion.
```

- [ ] **Step 2: Verify docs mention commands**

Ensure docs still include:

```md
npm run pine:autoresearch:llm:digest
npm run pine:autoresearch:llm:review-status
npm run pine:autoresearch:llm:validate
```

- [ ] **Step 3: Commit Task 7**

```bash
git add docs/pine-llm-autoresearch.md
git commit -m "docs(pine): explain llm candidate quality gate"
```

---

## Task 8: Full Verification And Safety Review

**Files:**
- No code changes unless verification finds a bug.

- [ ] **Step 1: Run targeted LLM test suite**

Run:

```bash
npm test -- \
  tests/pine-autoresearch-llm-quality.test.mjs \
  tests/pine-autoresearch-llm-context.test.mjs \
  tests/pine-autoresearch-llm-memory.test.mjs \
  tests/pine-autoresearch-llm-provider.test.mjs \
  tests/pine-autoresearch-llm-openai-provider.test.mjs \
  tests/pine-autoresearch-llm-runner.test.mjs \
  tests/pine-autoresearch-llm-evaluator.test.mjs \
  tests/pine-autoresearch-llm-scheduler.test.mjs \
  tests/pine-autoresearch-llm-no-regression.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run non-LLM no-regression focused suite**

Run:

```bash
npm test -- \
  tests/pine-autoresearch.test.mjs \
  tests/pine-autoresearch-tracks.test.mjs \
  tests/pine-autoresearch-lock.test.mjs \
  tests/pine-promotion-queue.test.mjs \
  tests/pine-autoresearch-llm-no-regression.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Validate LLM config**

Run:

```bash
npm run pine:autoresearch:llm:validate
```

Expected: PASS with `[llm-autoresearch] validated`.

- [ ] **Step 4: Check review blockers**

Run:

```bash
npm run pine:autoresearch:llm:review-status
```

Expected: command exits 0 and prints unresolved count. If unresolved count is non-zero, do not run mutating LLM commands until operator resolves items.

- [ ] **Step 5: Run diff check**

Run:

```bash
git diff --check
```

Expected: exit 0.

- [ ] **Step 6: Inspect dirty tree before final commit/merge**

Run:

```bash
git status --short
```

Expected: only intentional code/docs/config/test files changed. Runtime files under `pine/autoresearch-llm/.../state`, manifests, or user-edited `pine/test.pine` must not be committed unless explicitly intended.

- [ ] **Step 7: Commit verification notes if needed**

If Task 8 required fixes:

```bash
git add <fixed-files>
git commit -m "fix(pine): stabilize llm quality gate verification"
```

If no fixes were required, do not create an empty commit.

---

## Self-Review

### Spec coverage

- Matrix-aware prompt/context: Task 2 and Task 5.
- Recent failure memory: Task 3.
- Anti-generic quality gate: Task 1 and Task 4.
- Re-ask low-quality candidate before matrix run: Task 4.
- Provider retry/backoff: Task 6.
- Docs/operator clarity: Task 7.
- Non-LLM isolation verification: Task 8.

### Placeholder scan

No unresolved placeholder markers remain. All tasks include exact files, commands, expected results, and concrete code snippets.

### Type consistency

Functions introduced:

- `scoreCandidateQuality({ candidate, champion, memory, config })`
- `buildQualityFeedbackPrompt(basePrompt, { quality, candidate })`
- `normalizeMaxQualityAttempts(provider, quality)`
- `normalizeMaxProviderAttempts(provider)`
- `isTransientProviderError(proposal)`

These names are used consistently across tests and implementation tasks.
