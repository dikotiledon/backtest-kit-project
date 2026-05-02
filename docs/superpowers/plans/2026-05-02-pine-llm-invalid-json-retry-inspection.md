# Pine LLM Invalid JSON Retry + Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe inspection artifacts and bounded retry handling for malformed/empty LLM candidate JSON without changing matrix evaluation, review queue, reservation, or existing provider behavior by default.

**Architecture:** Keep provider modules as raw text producers and keep runner/schema as the authoritative validation boundary. Add retry orchestration in `scripts/lib/pine-autoresearch-llm-runner.mjs`, because only the runner can know whether raw provider text failed parse/schema validation and whether retrying is safe. Persist invalid raw-output previews to append-only JSONL state so `llm-provider-status.json` can be overwritten by later commands without losing evidence.

**Tech Stack:** Node.js ESM, `node:test`, filesystem JSON/JSONL state, existing Pine LLM autoresearch runner/provider modules.

---

## Safety Constraints

- Do not commit `.env`.
- Do not commit local dirty provider config unless explicitly requested by user.
- Do not change matrix evaluator logic, reservation semantics, manual review queue semantics, or promotion queue behavior.
- Default retry behavior must preserve existing behavior when config omits retry settings: one attempt only.
- Retry only when provider returned raw text but local parse/schema validation failed (`candidate_invalid`).
- Do not retry non-raw provider failures such as `missing_api_key_env`, `proposal_failed`, `finish_reason:length`, HTTP errors, scheduled `openclaw` rejection, or pending review blockers.
- Raw inspection artifacts must be bounded and append-only. Store preview, length, SHA-256, reason, attempt number, provider mode, source, and timestamp. Do not store unlimited raw text.
- Final successful retry must not erase invalid-attempt history.

## File Structure

- Modify: `scripts/lib/pine-autoresearch-llm-paths.mjs` — add `invalidResponses` path.
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs` — add recorder helpers, retry normalization, retry prompt feedback, and shared parse/validate loop.
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs` — add invalid-response history, retry success, retry exhaustion, and non-retry provider failure tests.
- Modify: `tests/pine-autoresearch-llm-openai-provider.test.mjs` — add request instruction assertions.
- Modify: `scripts/lib/pine-autoresearch-llm-openai-provider.mjs` — strengthen system instruction as secondary defense.
- Create: `docs/2026-05-02-pine-llm-invalid-json-retry-inspection.md` — operator docs.

---

### Task 1: Add invalid-response path

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-paths.mjs:26-43`
- Test: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Add baseline path assertion**

Append this assertion to the end of the existing `openai malformed text is rejected by local validation` test, before the `finally` block removes `dir`:

```js
    const invalidResponsesPath = path.join(
      dir,
      'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl',
    );
    await assert.rejects(fs.access(invalidResponsesPath), /ENOENT/);
```

- [ ] **Step 2: Run focused test**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS. This proves baseline behavior is unchanged.

- [ ] **Step 3: Add path to `buildLlmLanePaths`**

Change `scripts/lib/pine-autoresearch-llm-paths.mjs` return object from:

```js
    providerStatus: path.join(state, 'llm-provider-status.json'),
    mutexName: `Global\BacktestKit-Pine-LLM-Autoresearch-${normalizedMatrixId}`,
```

to:

```js
    providerStatus: path.join(state, 'llm-provider-status.json'),
    invalidResponses: path.join(state, 'llm-invalid-responses.jsonl'),
    mutexName: `Global\BacktestKit-Pine-LLM-Autoresearch-${normalizedMatrixId}`,
```

- [ ] **Step 4: Run focused test**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit path-only change**

```bash
git add scripts/lib/pine-autoresearch-llm-paths.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): add llm invalid response state path"
```

---

### Task 2: Persist bounded invalid raw-output history

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs:1-120`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs:730-757`

- [ ] **Step 1: Replace baseline assertion with failing recorder expectation**

In `tests/pine-autoresearch-llm-runner.test.mjs`, replace the invalid path `assert.rejects` from Task 1 with:

```js
    const invalidRows = (await fs.readFile(invalidResponsesPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(invalidRows.length, 1);
    assert.equal(invalidRows[0].attempt, 1);
    assert.equal(invalidRows[0].maxAttempts, 1);
    assert.equal(invalidRows[0].reason, 'candidate_invalid');
    assert.match(invalidRows[0].error, /Invalid JSON|unknownParam/);
    assert.equal(invalidRows[0].providerMode, 'openai-responses');
    assert.equal(invalidRows[0].source, 'openai-responses');
    assert.equal(invalidRows[0].rawLength, 'Here is a candidate:\n{"params":{"unknownParam":999}}'.length);
    assert.match(invalidRows[0].rawSha256, /^[a-f0-9]{64}$/);
    assert.match(invalidRows[0].rawPreview, /Here is a candidate/);

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.details.invalidAttempts.length, 1);
    assert.equal(status.details.invalidAttempts[0].attempt, 1);
    assert.equal(status.details.invalidAttempts[0].maxAttempts, 1);
    assert.equal(status.details.invalidAttempts[0].rawPreviewPath.endsWith('llm-invalid-responses.jsonl'), true);
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: FAIL with `ENOENT` for `llm-invalid-responses.jsonl` or missing `invalidAttempts`.

- [ ] **Step 3: Add imports and recorder helpers**

At top of `scripts/lib/pine-autoresearch-llm-runner.mjs`, add:

```js
import crypto from 'node:crypto';
```

Insert below `writeProviderStatus`:

```js
const INVALID_RESPONSE_PREVIEW_BYTES = 16 * 1024;

function byteBoundedPreview(value, maxBytes = INVALID_RESPONSE_PREVIEW_BYTES) {
  const text = String(value ?? '');
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  return buffer.subarray(0, maxBytes).toString('utf8');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

async function appendInvalidResponse(paths, { attempt, maxAttempts, command, scheduled, matrixId, providerMode, source = null, reason, error, raw }) {
  const entry = {
    at: isoNow(), attempt, maxAttempts, command, scheduled: Boolean(scheduled), matrixId,
    providerMode: providerMode ?? null, source: source ?? null, reason,
    error: String(error ?? ''), rawLength: String(raw ?? '').length,
    rawSha256: sha256Text(raw), rawPreview: byteBoundedPreview(raw),
  };
  await fs.appendFile(paths.invalidResponses, `${JSON.stringify(entry)}\n`, 'utf8');
  return { attempt, maxAttempts, reason, error: entry.error, rawLength: entry.rawLength, rawSha256: entry.rawSha256, rawPreviewPath: paths.invalidResponses };
}
```

- [ ] **Step 4: Wire recorder into current parse/validate catch blocks without retry yet**

In both parse/validate `catch (error)` blocks (`runProposalOnly` and main `run` path), before `writeProviderStatus`, add:

```js
    const invalidAttempts = [await appendInvalidResponse(paths, {
      attempt: 1,
      maxAttempts: 1,
      command,
      scheduled,
      matrixId: paths.matrixId,
      providerMode: config?.provider?.mode,
      source: proposal.source ?? null,
      reason: 'candidate_invalid',
      error: String(error?.message ?? error),
      raw: proposal.raw,
    })];
```

Then add `invalidAttempts` to each `details` object:

```js
      details: {
        reviewSummary,
        invalidAttempts,
        error: String(error?.message ?? error),
      },
```

- [ ] **Step 5: Run focused test**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit inspection persistence**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): persist invalid llm response previews"
```

---

### Task 3: Add bounded retry config and retry prompt feedback

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Add failing retry-success test**

Append this test after `openai malformed text is rejected by local validation`:

```js
test('openai malformed candidate retries once and succeeds with feedback prompt', async () => {
  const { dir, configPath } = await openAiFixture();
  const reviewQueuePath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-manual-review-queue.jsonl');
  const invalidResponsesPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl');
  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({ ...baseConfig, provider: { ...baseConfig.provider, maxCandidateAttempts: 2 } }), 'utf8');
    const prompts = [];
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath, repoRoot: dir, command: 'run', scheduled: false,
      proposeOpenAi: async (options) => {
        prompts.push(options.prompt);
        if (prompts.length === 1) return { ok: true, raw: '{}', source: 'openai-responses' };
        return { ok: true, raw: '{"params":{"minPredSum":1.8},"rationale":"retry candidate"}', source: 'openai-responses' };
      },
      executeCandidate: async () => { executeCalled = true; return { ok: true, runId: 'retry-run', promotable: true, metricsDelta: { score: 1 } }; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'candidate_enqueued_for_review');
    assert.equal(executeCalled, true);
    assert.equal(prompts.length, 2);
    assert.doesNotMatch(prompts[0], /Previous candidate output was invalid/);
    assert.match(prompts[1], /Previous candidate output was invalid/);
    assert.match(prompts[1], /Attempt 2 of 2/);
    assert.match(prompts[1], /Return exactly one JSON object/);
    const invalidRows = (await fs.readFile(invalidResponsesPath, 'utf8')).trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(invalidRows.length, 1);
    assert.equal(invalidRows[0].rawPreview, '{}');
    assert.equal(invalidRows[0].attempt, 1);
    assert.equal(invalidRows[0].maxAttempts, 2);
    const reviewItems = (await readReviewQueue(reviewQueuePath)).items;
    assert.equal(reviewItems.length, 1);
    assert.equal(reviewItems[0].candidate.params.minPredSum, 1.8);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: FAIL because runner calls provider once and returns `candidate_invalid`.

- [ ] **Step 3: Add retry helpers**

Insert below invalid response helpers in `scripts/lib/pine-autoresearch-llm-runner.mjs`:

```js
function normalizeMaxCandidateAttempts(provider = {}) {
  const value = Number(provider.maxCandidateAttempts ?? 1);
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function buildRetryPrompt(basePrompt, { attempt, maxAttempts, lastError, lastRawPreview }) {
  if (attempt <= 1) return basePrompt;
  return [
    basePrompt,
    '',
    'Previous candidate output was invalid.',
    `Attempt ${attempt} of ${maxAttempts}.`,
    `Validation error: ${String(lastError ?? '').slice(0, 1000)}`,
    `Invalid output preview: ${String(lastRawPreview ?? '').slice(0, 1000)}`,
    'Return exactly one JSON object matching the schema. No markdown. No prose. No code fences.',
  ].join('\n');
}

function parseAndValidateProposal({ proposal, allowlist, config, ledger, memory }) {
  const parsed = parseCandidateJson(proposal.raw);
  const validation = validateCandidate({
    candidate: normalizeApiCandidate(parsed),
    allowlist: resolveEffectiveAllowlist(allowlist, config.candidate),
    champion: config.champion ?? {},
    recentFingerprints: buildRecentFingerprintSet({ ledger, memory }),
    allowGuarded: Boolean(config?.candidate?.allowGuarded),
  });
  return { parsed, validation };
}
```

- [ ] **Step 4: Refactor runner to use retry loop**

In `runLlmAutoresearch`, replace the single `proposeCandidate` call and duplicate parse/validate blocks with a loop that keeps these exact variables:

```js
  const maxCandidateAttempts = normalizeMaxCandidateAttempts(baseProvider);
  const invalidAttempts = [];
  let proposal = null;
  let parsed = null;
  let validation = null;
  let lastError = null;
  let lastRawPreview = null;
```

The loop must call `proposeCandidate` up to `maxCandidateAttempts`, build retry prompt only for attempts after the first, append invalid responses on parse/schema failure, and break immediately on provider failure (`!proposal.ok`).

Update `runProposalOnly` to accept `parsed`, `validation`, and `invalidAttempts`; remove its duplicate parse/validate block. In main run path, remove duplicate parse/validate block and use loop results.

- [ ] **Step 5: Add exhausted invalid handling**

After provider failure handling and before reservation, add status return for `proposal?.ok && (!parsed || !validation)` with `reason: 'candidate_invalid'`, `details.invalidAttempts`, and `details.error: lastError`.

- [ ] **Step 6: Run focused test**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit retry success behavior**

```bash
git add scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): retry invalid llm candidate json"
```

---

### Task 4: Verify retry exhaustion and non-retry failures

**Files:**
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`
- Modify only if test exposes a real implementation bug: `scripts/lib/pine-autoresearch-llm-runner.mjs`

- [ ] **Step 1: Add retry-exhaustion test**

Append after retry-success test:

```js
test('openai malformed candidate stops after configured attempts', async () => {
  const { dir, configPath } = await openAiFixture();
  const invalidResponsesPath = path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl');

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxCandidateAttempts: 3 },
    }), 'utf8');

    let calls = 0;
    let executeCalled = false;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return { ok: true, raw: '{}', source: 'openai-responses' };
      },
      executeCandidate: async () => {
        executeCalled = true;
        return { ok: true, runId: 'must-not-run' };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'candidate_invalid');
    assert.equal(calls, 3);
    assert.equal(executeCalled, false);

    const invalidRows = (await fs.readFile(invalidResponsesPath, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.deepEqual(invalidRows.map((row) => row.attempt), [1, 2, 3]);
    assert.deepEqual(invalidRows.map((row) => row.maxAttempts), [3, 3, 3]);

    const status = JSON.parse(await fs.readFile(
      path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-provider-status.json'),
      'utf8',
    ));
    assert.equal(status.reason, 'candidate_invalid');
    assert.equal(status.details.invalidAttempts.length, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add provider-failure non-retry test**

Append after retry-exhaustion test:

```js
test('openai provider failure is not retried as candidate invalid', async () => {
  const { dir, configPath } = await openAiFixture();

  try {
    const baseConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.writeFile(configPath, JSON.stringify({
      ...baseConfig,
      provider: { ...baseConfig.provider, maxCandidateAttempts: 3 },
    }), 'utf8');

    let calls = 0;
    const result = await runLlmAutoresearch({
      configPath,
      repoRoot: dir,
      command: 'run',
      scheduled: false,
      proposeOpenAi: async () => {
        calls += 1;
        return { ok: false, reason: 'missing_api_key_env:OPENAI_API_KEY', stderr: 'missing key' };
      },
      executeCandidate: async () => ({ ok: true, runId: 'must-not-run' }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing_api_key_env:OPENAI_API_KEY');
    assert.equal(calls, 1);
    await assert.rejects(
      () => fs.access(path.join(dir, 'pine/autoresearch-llm/llm-matrix-a/state/llm-invalid-responses.jsonl')),
      /ENOENT/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run focused tests**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit coverage**

```bash
git add tests/pine-autoresearch-llm-runner.test.mjs scripts/lib/pine-autoresearch-llm-runner.mjs
git commit -m "test(pine): cover llm retry exhaustion"
```

---

### Task 5: Add provider request hardening without relying on it for correctness

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-openai-provider.mjs:3-15`
- Modify: `tests/pine-autoresearch-llm-openai-provider.test.mjs:24-60`

- [ ] **Step 1: Add failing system instruction assertions**

In chat and responses request tests, assert instruction includes `Return exactly one JSON object`, `No markdown`, `No code fences`, and `If you cannot improve the strategy`.

- [ ] **Step 2: Run provider test to verify it fails on the new sentence**

```bash
npm test -- tests/pine-autoresearch-llm-openai-provider.test.mjs
```

Expected: FAIL because current instruction lacks `If you cannot improve the strategy`.

- [ ] **Step 3: Strengthen `systemInstruction`**

Change `systemInstruction` in `scripts/lib/pine-autoresearch-llm-openai-provider.mjs` to:

```js
function systemInstruction() {
  return [
    'You are optimizing a Pine Script trading-strategy parameter patch.',
    'Return exactly one JSON object and no markdown.',
    'No prose. No code fences. No comments. No trailing explanation.',
    'The JSON object must match the provided schema.',
    'If you cannot improve the strategy, return a valid JSON object with an empty params object and a concise rationale.',
  ].join('\n');
}
```

- [ ] **Step 4: Run provider tests**

```bash
npm test -- tests/pine-autoresearch-llm-openai-provider.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit provider prompt hardening**

```bash
git add scripts/lib/pine-autoresearch-llm-openai-provider.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs
git commit -m "fix(pine): harden llm candidate json instructions"
```

---

### Task 6: Document inspection and retry operation

**Files:**
- Create: `docs/2026-05-02-pine-llm-invalid-json-retry-inspection.md`

- [ ] **Step 1: Create operator doc**

Create doc with these sections: Problem, Behavior, Config, Inspection, Status Details, Recommended Local LLM Setting.

It must include:

```text
pine/autoresearch-llm/llm-<matrix-id>/state/llm-invalid-responses.jsonl
provider.maxCandidateAttempts
rawPreview is capped at 16 KiB
Provider failures are not retried
```

- [ ] **Step 2: Run markdown sanity check**

```bash
node -e "const fs=require('fs'); const p='docs/2026-05-02-pine-llm-invalid-json-retry-inspection.md'; const s=fs.readFileSync(p,'utf8'); if(!s.includes('llm-invalid-responses.jsonl')) throw new Error('missing invalid response path'); if(!s.includes('maxCandidateAttempts')) throw new Error('missing retry config'); console.log('doc ok')"
```

Expected output: `doc ok`.

- [ ] **Step 3: Commit docs**

```bash
git add docs/2026-05-02-pine-llm-invalid-json-retry-inspection.md
git commit -m "docs(pine): document llm invalid json retry"
```

---

### Task 7: Full verification gate

**Files:**
- No code edits unless verification exposes a real bug.

- [ ] **Step 1: Run exact focused suite**

```bash
npm test -- tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs tests/pine-autoresearch-llm-provider.test.mjs tests/pine-autoresearch-llm-evaluator.test.mjs tests/pine-autoresearch-llm-e2e.test.mjs tests/pine-autoresearch-dependency-direction.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run whitespace/conflict check**

```bash
git diff --check
```

Expected: no output, exit code 0.

- [ ] **Step 3: Inspect git status**

```bash
git status --short --branch
```

Expected: only user-owned local config/secrets/artifacts should remain dirty. If code/docs files are dirty after commits, stop and inspect before continuing.

- [ ] **Step 4: Optional live rerun with `.env` loaded**

Use only after tests pass. Do not print secret values.

```bash
node scripts/pine-autoresearch-llm.mjs run --config config/pine-autoresearch-llm.default.json
```

Expected outcomes:

- Valid JSON on attempt 1: run proceeds to reservation/matrix eval/review flow.
- Invalid JSON then valid JSON: `llm-invalid-responses.jsonl` gets one row, run proceeds.
- All attempts invalid: run exits `candidate_invalid`; JSONL has one row per attempt; status details point to JSONL history.

---

## Self-Review

### Spec Coverage

- Inspection method: Task 2 adds append-only `llm-invalid-responses.jsonl`, Task 6 documents it.
- Retry method: Task 3 adds bounded retry with config, Task 4 covers exhaustion and non-retry provider failures.
- Existing behavior safety: retry default remains one attempt; provider failures do not retry; matrix/review/reservation logic untouched.
- User's observed empty-JSON then success case: Task 3 retry-success test reproduces `{}` first, valid JSON second.
- Fragile overwritten status: invalid JSONL history persists after `llm-provider-status.json` is overwritten.

### Placeholder Scan

No placeholder markers or deferred implementation notes remain. Code-changing tasks include code blocks and commands; retry behavior is specified with exact assertions and verification gates.

### Type Consistency

- Config field: `provider.maxCandidateAttempts`.
- State path: `paths.invalidResponses` -> `llm-invalid-responses.jsonl`.
- Status detail field: `details.invalidAttempts`.
- Raw metadata fields: `rawLength`, `rawSha256`, `rawPreview`, `rawPreviewPath`.

---

## Execution Recommendation

Use subagent-driven development for Tasks 1-7. Each task is independently testable and commit-sized. Main session should review each commit before moving to the next task because retry logic touches the runner control path.
