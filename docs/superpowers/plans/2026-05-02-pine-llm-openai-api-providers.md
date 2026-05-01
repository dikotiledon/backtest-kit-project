# Pine LLM OpenAI API Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real HTTP LLM providers to the Pine LLM autoresearch lane, supporting OpenAI-style Chat Completions and OpenAI-style Responses APIs while preserving the one-candidate/manual-review safety model.

**Architecture:** Keep `scripts/lib/pine-autoresearch-llm-provider.mjs` as the provider boundary and add small focused helper modules for API config normalization, request construction, HTTP execution, and response extraction. API providers return the same `{ ok, raw, source }` shape as existing `file` and `cli` providers, so runner/schema/reservation/review logic remains authoritative and unchanged. Scheduled mode may use API providers only when explicitly enabled; `openclaw` remains manual/on-demand only and rejected in scheduled mode.

**Tech Stack:** Node.js ESM, built-in `fetch`/`AbortController`, `node:test`, JSON config, OpenAI Chat Completions `/v1/chat/completions`, OpenAI Responses `/v1/responses`, existing Pine LLM schema validator.

---

## Guardrails

- Work from repo root: `D:\Code\Experiment\backtest-kit-project`.
- Create a branch before implementation: `feature/pine-llm-openai-api-providers`.
- Do not change existing non-LLM `pine:autoresearch*` behavior.
- Do not write API keys to config, logs, manifests, provider status, test output, review queue, ledger, or thrown errors.
- Read API key only from environment variable named by config; default `OPENAI_API_KEY`.
- Do not add a runtime SDK dependency unless a later review explicitly approves it; use built-in `fetch` for testability and minimal blast radius.
- Do not support streaming in this implementation. Force non-streaming requests because provider boundary expects exactly one complete candidate object.
- Do not allow `n > 1`, tools, function calls, background mode, or conversation state. One request must produce exactly one candidate object.
- The LLM output is still untrusted. Existing parser/allowlist/fingerprint/reservation/manual-review gates remain the source of truth.
- API providers can be scheduled only behind explicit scheduler enablement already required by the installer.
- Commit after each task when tests pass.

## API Provider Modes

Add two provider modes:

- `openai-chat-completions` — OpenAI Chat Completions style endpoint.
- `openai-responses` — OpenAI Responses style endpoint.

Both modes accept OpenAI-compatible base URLs so local/proxy/OpenRouter-compatible services can be used later without a second design pass.

## File Structure

### Create

- `scripts/lib/pine-autoresearch-llm-openai-schema.mjs` — builds the strict JSON Schema sent to API providers.
- `scripts/lib/pine-autoresearch-llm-openai-http.mjs` — small fetch wrapper with timeout, auth header, JSON parsing, and secret-safe errors.
- `scripts/lib/pine-autoresearch-llm-openai-provider.mjs` — request builders and response extractors for Chat Completions and Responses APIs.
- `tests/pine-autoresearch-llm-openai-schema.test.mjs`
- `tests/pine-autoresearch-llm-openai-http.test.mjs`
- `tests/pine-autoresearch-llm-openai-provider.test.mjs`

### Modify

- `config/pine-autoresearch-llm.default.json` — add disabled-by-default API config fields.
- `scripts/lib/pine-autoresearch-llm-provider.mjs` — dispatch new provider modes.
- `scripts/lib/pine-autoresearch-llm-runner.mjs` — include sanitized API provider metadata in status/manifest if not already captured.
- `scripts/ops/install-pine-autoresearch-llm-tasks.ps1` — treat API providers as schedulable when explicit enablement is present.
- `docs/pine-llm-autoresearch.md` — document API modes, required env vars, examples, and safety constraints.
- `tests/pine-autoresearch-llm-provider.test.mjs` — coverage for dispatch and scheduled behavior.
- `tests/pine-autoresearch-llm-runner.test.mjs` — coverage for provider status/manifest sanitization if runner metadata changes.
- `tests/pine-autoresearch-llm-scheduler.test.mjs` — installer accepts API modes only with explicit enablement.
- `tests/pine-autoresearch-llm-no-regression.test.mjs` — no existing autoresearch scheduler/script regressions.

---

### Task 1: Config Contract and Strict Candidate JSON Schema

**Files:**
- Modify: `config/pine-autoresearch-llm.default.json`
- Create: `scripts/lib/pine-autoresearch-llm-openai-schema.mjs`
- Create: `tests/pine-autoresearch-llm-openai-schema.test.mjs`

- [ ] **Step 1: Write failing schema tests**

Create `tests/pine-autoresearch-llm-openai-schema.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCandidateJsonSchema, buildStructuredOutputConfig } from '../scripts/lib/pine-autoresearch-llm-openai-schema.mjs';

const allowlist = {
  version: 1,
  parameters: {
    minPredSum: { type: 'number', min: 1.1, max: 3.5, step: 0.1, mutability: 'safe' },
    minBarsBetween: { type: 'integer', min: 1, max: 80, step: 1, mutability: 'safe' },
    useVolatilityFilter: { type: 'boolean', mutability: 'guarded' },
  },
};

test('buildCandidateJsonSchema creates one strict candidate object schema', () => {
  const schema = buildCandidateJsonSchema({ allowlist });

  assert.equal(schema.type, 'object');
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['params', 'rationale']);
  assert.equal(schema.properties.params.type, 'object');
  assert.equal(schema.properties.params.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.params.properties).sort(), [
    'minBarsBetween',
    'minPredSum',
    'useVolatilityFilter',
  ]);
  assert.deepEqual(schema.properties.params.properties.minPredSum, {
    type: 'number',
    minimum: 1.1,
    maximum: 3.5,
    multipleOf: 0.1,
  });
  assert.deepEqual(schema.properties.params.properties.minBarsBetween, {
    type: 'integer',
    minimum: 1,
    maximum: 80,
    multipleOf: 1,
  });
  assert.deepEqual(schema.properties.params.properties.useVolatilityFilter, { type: 'boolean' });
  assert.equal(schema.properties.rationale.type, 'string');
  assert.equal(schema.properties.rationale.maxLength, 2000);
});

test('buildCandidateJsonSchema can exclude guarded parameters by default', () => {
  const schema = buildCandidateJsonSchema({ allowlist, allowGuarded: false });

  assert.deepEqual(Object.keys(schema.properties.params.properties).sort(), ['minBarsBetween', 'minPredSum']);
});

test('buildStructuredOutputConfig returns chat and responses wrappers', () => {
  const chat = buildStructuredOutputConfig({ apiStyle: 'chat-completions', allowlist });
  assert.equal(chat.type, 'json_schema');
  assert.equal(chat.json_schema.name, 'pine_autoresearch_candidate');
  assert.equal(chat.json_schema.strict, true);
  assert.equal(chat.json_schema.schema.type, 'object');

  const responses = buildStructuredOutputConfig({ apiStyle: 'responses', allowlist });
  assert.equal(responses.type, 'json_schema');
  assert.equal(responses.name, 'pine_autoresearch_candidate');
  assert.equal(responses.strict, true);
  assert.equal(responses.schema.type, 'object');
});
```

Run: `npm test -- tests/pine-autoresearch-llm-openai-schema.test.mjs`
Expected: FAIL with module not found.

- [ ] **Step 2: Implement schema builder**

Create `scripts/lib/pine-autoresearch-llm-openai-schema.mjs`:

```js
function toJsonSchemaProperty(definition = {}) {
  const type = definition.type;
  const property = {};

  if (type === 'number') property.type = 'number';
  else if (type === 'integer') property.type = 'integer';
  else if (type === 'boolean') property.type = 'boolean';
  else if (type === 'string') property.type = 'string';
  else throw new Error(`unsupported allowlist parameter type: ${String(type)}`);

  if (Number.isFinite(definition.min)) property.minimum = definition.min;
  if (Number.isFinite(definition.max)) property.maximum = definition.max;
  if (Number.isFinite(definition.step)) property.multipleOf = definition.step;
  if (Number.isInteger(definition.maxLength) && definition.maxLength > 0) property.maxLength = definition.maxLength;

  return property;
}

export function buildCandidateJsonSchema({ allowlist, allowGuarded = false } = {}) {
  const parameters = allowlist?.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('allowlist.parameters object required');
  }

  const paramProperties = {};
  for (const [name, definition] of Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))) {
    if (!allowGuarded && definition?.mutability === 'guarded') continue;
    paramProperties[name] = toJsonSchemaProperty(definition);
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['params', 'rationale'],
    properties: {
      params: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: paramProperties,
      },
      rationale: {
        type: 'string',
        minLength: 1,
        maxLength: 2000,
      },
    },
  };
}

export function buildStructuredOutputConfig({ apiStyle, allowlist, allowGuarded = false } = {}) {
  const schema = buildCandidateJsonSchema({ allowlist, allowGuarded });
  const name = 'pine_autoresearch_candidate';

  if (apiStyle === 'chat-completions') {
    return { type: 'json_schema', json_schema: { name, strict: true, schema } };
  }

  if (apiStyle === 'responses') {
    return { type: 'json_schema', name, strict: true, schema };
  }

  throw new Error(`unknown OpenAI API style: ${String(apiStyle)}`);
}
```

- [ ] **Step 3: Add default config shape without enabling API calls**

Modify `config/pine-autoresearch-llm.default.json` provider block to this exact shape, keeping `mode` disabled:

```json
  "provider": {
    "mode": "disabled",
    "cliCommand": null,
    "candidateFile": null,
    "timeoutMs": 90000,
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": null,
    "temperature": 0.2,
    "topP": 1,
    "maxOutputTokens": 1200,
    "organizationEnv": null,
    "projectEnv": null
  },
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-openai-schema.test.mjs
npm test -- tests/pine-autoresearch-llm-schema.test.mjs tests/pine-autoresearch-llm-provider.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add config/pine-autoresearch-llm.default.json scripts/lib/pine-autoresearch-llm-openai-schema.mjs tests/pine-autoresearch-llm-openai-schema.test.mjs
git commit -m "feat(pine): add LLM API structured output schema"
```

---

### Task 2: Secret-Safe OpenAI HTTP Client

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-openai-http.mjs`
- Create: `tests/pine-autoresearch-llm-openai-http.test.mjs`

- [ ] **Step 1: Write failing HTTP client tests**

Create `tests/pine-autoresearch-llm-openai-http.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { postOpenAiJson, resolveOpenAiAuth } from '../scripts/lib/pine-autoresearch-llm-openai-http.mjs';

test('resolveOpenAiAuth reads API key from configured env name', () => {
  const env = { OPENAI_API_KEY: 'sk-test-secret' };
  assert.deepEqual(resolveOpenAiAuth({ provider: { apiKeyEnv: 'OPENAI_API_KEY' }, env }), {
    ok: true,
    apiKey: 'sk-test-secret',
    apiKeyEnv: 'OPENAI_API_KEY',
    headers: {},
  });
});

test('resolveOpenAiAuth returns safe missing-key failure', () => {
  const result = resolveOpenAiAuth({ provider: { apiKeyEnv: 'OPENAI_API_KEY' }, env: {} });
  assert.deepEqual(result, { ok: false, reason: 'missing_api_key_env:OPENAI_API_KEY' });
});

test('postOpenAiJson sends bearer token and parses JSON', async () => {
  const calls = [];
  const result = await postOpenAiJson({
    url: 'https://api.openai.test/v1/responses',
    apiKey: 'sk-test-secret',
    body: { model: 'gpt-test', input: 'hello' },
    timeoutMs: 1234,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, 'Bearer sk-test-secret');
      assert.equal(init.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(init.body), { model: 'gpt-test', input: 'hello' });
      return { ok: true, status: 200, json: async () => ({ id: 'resp_1', output_text: '{}' }) };
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result, { ok: true, status: 200, json: { id: 'resp_1', output_text: '{}' } });
});

test('postOpenAiJson includes optional organization and project headers from env', async () => {
  await postOpenAiJson({
    url: 'https://api.openai.test/v1/responses',
    apiKey: 'sk-test-secret',
    headers: { 'openai-organization': 'org_123', 'openai-project': 'proj_123' },
    body: { model: 'gpt-test', input: 'hello' },
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers['openai-organization'], 'org_123');
      assert.equal(init.headers['openai-project'], 'proj_123');
      return { ok: true, status: 200, json: async () => ({ output_text: '{}' }) };
    },
  });
});

test('postOpenAiJson redacts API key from HTTP failure text', async () => {
  const result = await postOpenAiJson({
    url: 'https://api.openai.test/v1/responses',
    apiKey: 'sk-test-secret',
    body: { model: 'gpt-test', input: 'hello' },
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'bad key sk-test-secret' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'http_401');
  assert.doesNotMatch(result.stderr, /sk-test-secret/);
  assert.match(result.stderr, /\[redacted\]/);
});
```

Run: `npm test -- tests/pine-autoresearch-llm-openai-http.test.mjs`
Expected: FAIL with module not found.

- [ ] **Step 2: Implement HTTP client**

Create `scripts/lib/pine-autoresearch-llm-openai-http.mjs`:

```js
function readOptionalEnv(env, name) {
  if (!name) return null;
  const value = env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveOpenAiAuth({ provider = {}, env = process.env } = {}) {
  const apiKeyEnv = provider.apiKeyEnv || 'OPENAI_API_KEY';
  const apiKey = readOptionalEnv(env, apiKeyEnv);
  if (!apiKey) return { ok: false, reason: `missing_api_key_env:${apiKeyEnv}` };

  const headers = {};
  const organization = readOptionalEnv(env, provider.organizationEnv);
  const project = readOptionalEnv(env, provider.projectEnv);
  if (organization) headers['openai-organization'] = organization;
  if (project) headers['openai-project'] = project;

  return { ok: true, apiKey, apiKeyEnv, headers };
}

function redact(value, secret) {
  const text = String(value ?? '');
  return secret ? text.split(secret).join('[redacted]') : text;
}

export async function postOpenAiJson({ url, apiKey, headers = {}, body, timeoutMs = 90000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch_unavailable', stderr: 'global fetch unavailable' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response?.ok) {
      const status = response?.status ?? 'unknown';
      const text = typeof response?.text === 'function' ? await response.text() : '';
      return { ok: false, reason: `http_${status}`, status, stderr: redact(text, apiKey).slice(0, 4000) };
    }

    const json = typeof response.json === 'function' ? await response.json() : null;
    return { ok: true, status: response.status ?? 200, json };
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? `request timed out after ${timeoutMs}ms`
      : String(error?.message ?? error ?? 'request failed');
    return { ok: false, reason: error?.name === 'AbortError' ? 'request_timeout' : 'request_failed', stderr: redact(message, apiKey) };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 3: Run tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-openai-http.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add scripts/lib/pine-autoresearch-llm-openai-http.mjs tests/pine-autoresearch-llm-openai-http.test.mjs
git commit -m "feat(pine): add secret-safe LLM API HTTP client"
```

---

### Task 3: OpenAI Chat Completions and Responses Provider Adapter

**Files:**
- Create: `scripts/lib/pine-autoresearch-llm-openai-provider.mjs`
- Create: `tests/pine-autoresearch-llm-openai-provider.test.mjs`

- [ ] **Step 1: Write failing adapter tests**

Create `tests/pine-autoresearch-llm-openai-provider.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChatCompletionsRequest,
  buildResponsesRequest,
  extractChatCompletionsText,
  extractResponsesText,
  proposeOpenAiCandidate,
} from '../scripts/lib/pine-autoresearch-llm-openai-provider.mjs';

const allowlist = {
  version: 1,
  parameters: {
    minPredSum: { type: 'number', min: 1.1, max: 3.5, step: 0.1, mutability: 'safe' },
  },
};

test('buildChatCompletionsRequest creates non-streaming structured JSON request', () => {
  const request = buildChatCompletionsRequest({
    provider: { model: 'gpt-test', temperature: 0.1, topP: 0.9, maxOutputTokens: 777 },
    prompt: 'candidate prompt',
    allowlist,
  });

  assert.equal(request.model, 'gpt-test');
  assert.equal(request.stream, false);
  assert.equal(request.n, 1);
  assert.equal(request.temperature, 0.1);
  assert.equal(request.top_p, 0.9);
  assert.equal(request.max_completion_tokens, 777);
  assert.equal(request.messages[0].role, 'developer');
  assert.match(request.messages[0].content, /Return exactly one JSON object/);
  assert.deepEqual(request.messages[1], { role: 'user', content: 'candidate prompt' });
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.response_format.json_schema.strict, true);
});

test('buildResponsesRequest creates non-streaming structured JSON request', () => {
  const request = buildResponsesRequest({
    provider: { model: 'gpt-test', temperature: 0.1, topP: 0.9, maxOutputTokens: 777 },
    prompt: 'candidate prompt',
    allowlist,
  });

  assert.equal(request.model, 'gpt-test');
  assert.equal(request.stream, false);
  assert.equal(request.store, false);
  assert.equal(request.temperature, 0.1);
  assert.equal(request.top_p, 0.9);
  assert.equal(request.max_output_tokens, 777);
  assert.match(request.instructions, /Return exactly one JSON object/);
  assert.equal(request.input, 'candidate prompt');
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
});

test('extractChatCompletionsText extracts first message content and rejects bad finish reasons', () => {
  const ok = extractChatCompletionsText({
    choices: [{ finish_reason: 'stop', message: { content: '{"params":{"minPredSum":1.8},"rationale":"x"}' } }],
  });
  assert.deepEqual(ok, { ok: true, raw: '{"params":{"minPredSum":1.8},"rationale":"x"}' });

  assert.deepEqual(extractChatCompletionsText({ choices: [] }), { ok: false, reason: 'missing_choice' });
  assert.deepEqual(
    extractChatCompletionsText({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    { ok: false, reason: 'finish_reason:length' },
  );
});

test('extractResponsesText supports output_text and output message content', () => {
  assert.deepEqual(extractResponsesText({ status: 'completed', output_text: '{"params":{}}' }), {
    ok: true,
    raw: '{"params":{}}',
  });

  const nested = extractResponsesText({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: '{"params":{"minPredSum":1.8}}' }] }],
  });
  assert.deepEqual(nested, { ok: true, raw: '{"params":{"minPredSum":1.8}}' });

  assert.deepEqual(extractResponsesText({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), {
    ok: false,
    reason: 'response_status:incomplete',
    stderr: 'max_output_tokens',
  });
});

test('proposeOpenAiCandidate posts chat completions request and returns raw candidate text', async () => {
  const result = await proposeOpenAiCandidate({
    mode: 'openai-chat-completions',
    provider: { apiBaseUrl: 'https://api.openai.test/v1', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-test' },
    allowlist,
    prompt: 'candidate prompt',
    env: { OPENAI_API_KEY: 'sk-test-secret' },
    postJson: async ({ url, body, apiKey }) => {
      assert.equal(url, 'https://api.openai.test/v1/chat/completions');
      assert.equal(apiKey, 'sk-test-secret');
      assert.equal(body.model, 'gpt-test');
      return { ok: true, json: { choices: [{ finish_reason: 'stop', message: { content: '{"params":{"minPredSum":1.8},"rationale":"x"}' } }] } };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    raw: '{"params":{"minPredSum":1.8},"rationale":"x"}',
    source: 'openai-chat-completions',
  });
});

test('proposeOpenAiCandidate posts responses request and returns raw candidate text', async () => {
  const result = await proposeOpenAiCandidate({
    mode: 'openai-responses',
    provider: { apiBaseUrl: 'https://api.openai.test/v1', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-test' },
    allowlist,
    prompt: 'candidate prompt',
    env: { OPENAI_API_KEY: 'sk-test-secret' },
    postJson: async ({ url, body }) => {
      assert.equal(url, 'https://api.openai.test/v1/responses');
      assert.equal(body.model, 'gpt-test');
      return { ok: true, json: { status: 'completed', output_text: '{"params":{"minPredSum":1.8},"rationale":"x"}' } };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    raw: '{"params":{"minPredSum":1.8},"rationale":"x"}',
    source: 'openai-responses',
  });
});

test('proposeOpenAiCandidate fails safely when model or API key is missing', async () => {
  assert.deepEqual(await proposeOpenAiCandidate({ mode: 'openai-responses', provider: {}, allowlist, prompt: 'p', env: {} }), {
    ok: false,
    reason: 'proposal_unavailable',
    stderr: 'provider.model required',
  });

  assert.deepEqual(await proposeOpenAiCandidate({
    mode: 'openai-responses',
    provider: { model: 'gpt-test', apiKeyEnv: 'OPENAI_API_KEY' },
    allowlist,
    prompt: 'p',
    env: {},
  }), {
    ok: false,
    reason: 'missing_api_key_env:OPENAI_API_KEY',
  });
});
```

Run: `npm test -- tests/pine-autoresearch-llm-openai-provider.test.mjs`
Expected: FAIL with module not found.

- [ ] **Step 2: Implement OpenAI provider adapter**

Create `scripts/lib/pine-autoresearch-llm-openai-provider.mjs` with these exported functions and behavior:

```js
import { buildStructuredOutputConfig } from './pine-autoresearch-llm-openai-schema.mjs';
import { postOpenAiJson, resolveOpenAiAuth } from './pine-autoresearch-llm-openai-http.mjs';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

function trimTrailingSlash(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function systemInstruction() {
  return [
    'You propose Pine strategy autoresearch candidates.',
    'Return exactly one JSON object and no markdown.',
    'The JSON object must match the provided schema.',
    'Do not include arrays of candidates.',
    'Do not propose code edits, architecture toggles, or parameters outside the schema.',
  ].join(' ');
}

function sampling(provider = {}) {
  const out = {};
  if (Number.isFinite(provider.temperature)) out.temperature = provider.temperature;
  if (Number.isFinite(provider.topP)) out.top_p = provider.topP;
  return out;
}

export function buildChatCompletionsRequest({ provider = {}, prompt, allowlist, allowGuarded = false } = {}) {
  return {
    model: provider.model,
    stream: false,
    n: 1,
    ...sampling(provider),
    max_completion_tokens: provider.maxOutputTokens ?? 1200,
    messages: [
      { role: 'developer', content: systemInstruction() },
      { role: 'user', content: String(prompt ?? '') },
    ],
    response_format: buildStructuredOutputConfig({ apiStyle: 'chat-completions', allowlist, allowGuarded }),
  };
}

export function buildResponsesRequest({ provider = {}, prompt, allowlist, allowGuarded = false } = {}) {
  return {
    model: provider.model,
    stream: false,
    store: false,
    ...sampling(provider),
    max_output_tokens: provider.maxOutputTokens ?? 1200,
    instructions: systemInstruction(),
    input: String(prompt ?? ''),
    text: { format: buildStructuredOutputConfig({ apiStyle: 'responses', allowlist, allowGuarded }) },
  };
}

export function extractChatCompletionsText(json) {
  const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
  if (!choice) return { ok: false, reason: 'missing_choice' };
  if (choice.finish_reason && choice.finish_reason !== 'stop') return { ok: false, reason: `finish_reason:${choice.finish_reason}` };
  const raw = choice.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'missing_message_content' };
  return { ok: true, raw: raw.trim() };
}

export function extractResponsesText(json) {
  if (json?.status && json.status !== 'completed') {
    return { ok: false, reason: `response_status:${json.status}`, stderr: String(json?.incomplete_details?.reason ?? json?.error?.message ?? '') };
  }
  if (typeof json?.output_text === 'string' && json.output_text.trim()) return { ok: true, raw: json.output_text.trim() };

  const parts = [];
  for (const item of Array.isArray(json?.output) ? json.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if ((content?.type === 'output_text' || content?.type === 'text') && typeof content.text === 'string') parts.push(content.text);
    }
  }
  const raw = parts.join('\n').trim();
  if (!raw) return { ok: false, reason: 'missing_output_text' };
  return { ok: true, raw };
}

export async function proposeOpenAiCandidate({ mode, provider = {}, allowlist, allowGuarded = false, prompt, env = process.env, postJson = postOpenAiJson } = {}) {
  if (!provider.model) return { ok: false, reason: 'proposal_unavailable', stderr: 'provider.model required' };

  const auth = resolveOpenAiAuth({ provider, env });
  if (!auth.ok) return auth;

  const apiBaseUrl = trimTrailingSlash(provider.apiBaseUrl);
  const isChat = mode === 'openai-chat-completions';
  const url = `${apiBaseUrl}${isChat ? '/chat/completions' : '/responses'}`;
  const body = isChat
    ? buildChatCompletionsRequest({ provider, prompt, allowlist, allowGuarded })
    : buildResponsesRequest({ provider, prompt, allowlist, allowGuarded });

  const posted = await postJson({ url, apiKey: auth.apiKey, headers: auth.headers, body, timeoutMs: provider.timeoutMs ?? 90000 });
  if (!posted.ok) return { ok: false, reason: posted.reason ?? 'proposal_failed', stderr: posted.stderr ?? '' };

  const extracted = isChat ? extractChatCompletionsText(posted.json) : extractResponsesText(posted.json);
  if (!extracted.ok) return { ok: false, reason: extracted.reason, stderr: extracted.stderr ?? '' };
  return { ok: true, raw: extracted.raw, source: mode };
}
```

- [ ] **Step 3: Run tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-openai-provider.test.mjs tests/pine-autoresearch-llm-openai-http.test.mjs tests/pine-autoresearch-llm-openai-schema.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add scripts/lib/pine-autoresearch-llm-openai-provider.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs
git commit -m "feat(pine): add OpenAI-style LLM API adapters"
```

---

### Task 4: Wire API Modes into Existing Provider Boundary

**Files:**
- Modify: `scripts/lib/pine-autoresearch-llm-provider.mjs`
- Modify: `tests/pine-autoresearch-llm-provider.test.mjs`

- [ ] **Step 1: Add failing dispatch tests**

Append to `tests/pine-autoresearch-llm-provider.test.mjs`:

```js
test('openai API providers dispatch through injected openai proposer', async () => {
  const calls = [];
  const result = await proposeCandidate({
    provider: { mode: 'openai-responses', model: 'gpt-test' },
    allowlist: { version: 1, parameters: {} },
    scheduled: true,
    prompt: 'input prompt',
    proposeOpenAi: async (options) => {
      calls.push(options);
      return { ok: true, raw: '{"params":{},"rationale":"x"}', source: 'openai-responses' };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'openai-responses');
  assert.equal(calls[0].provider.model, 'gpt-test');
  assert.equal(calls[0].prompt, 'input prompt');
  assert.deepEqual(result, { ok: true, raw: '{"params":{},"rationale":"x"}', source: 'openai-responses' });
});

test('openai API providers require allowlist before request construction', async () => {
  const result = await proposeCandidate({
    provider: { mode: 'openai-chat-completions', model: 'gpt-test' },
    scheduled: false,
    prompt: 'input prompt',
    proposeOpenAi: async () => {
      throw new Error('should not call API without allowlist');
    },
  });

  assert.deepEqual(result, { ok: false, reason: 'proposal_unavailable', stderr: 'allowlist required for API provider' });
});
```

Run: `npm test -- tests/pine-autoresearch-llm-provider.test.mjs`
Expected: FAIL because `proposeCandidate` does not accept API modes yet.

- [ ] **Step 2: Wire dispatch**

Modify `scripts/lib/pine-autoresearch-llm-provider.mjs`:

```js
import { proposeOpenAiCandidate } from './pine-autoresearch-llm-openai-provider.mjs';
```

Change function signature:

```js
export async function proposeCandidate({ provider, scheduled, prompt, allowlist, allowGuarded = false, readFile, execCommand, proposeOpenAi } = {}) {
```

Add this branch before the unknown-provider return:

```js
  if (provider.mode === 'openai-chat-completions' || provider.mode === 'openai-responses') {
    if (!allowlist) {
      return { ok: false, reason: 'proposal_unavailable', stderr: 'allowlist required for API provider' };
    }

    const proposer = proposeOpenAi ?? proposeOpenAiCandidate;
    try {
      return await proposer({ mode: provider.mode, provider, allowlist, allowGuarded, prompt });
    } catch (error) {
      return { ok: false, reason: 'proposal_failed', stderr: String(error?.message ?? error ?? '') };
    }
  }
```

- [ ] **Step 3: Pass allowlist from runner**

Find the existing `proposeCandidate(...)` call in `scripts/lib/pine-autoresearch-llm-runner.mjs`. Ensure it passes:

```js
allowlist,
allowGuarded: Boolean(config?.candidate?.allowGuarded),
```

No runner behavior should change for `disabled`, `file`, or `cli` providers.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-provider.test.mjs tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add scripts/lib/pine-autoresearch-llm-provider.mjs scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-provider.test.mjs
git commit -m "feat(pine): wire OpenAI API providers into LLM lane"
```

---

### Task 5: Scheduler Enablement and Secret-Safe Status Metadata

**Files:**
- Modify: `scripts/ops/install-pine-autoresearch-llm-tasks.ps1`
- Modify: `scripts/lib/pine-autoresearch-llm-runner.mjs`
- Modify: `tests/pine-autoresearch-llm-scheduler.test.mjs`
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`

- [ ] **Step 1: Add failing scheduler tests for API providers**

Add to `tests/pine-autoresearch-llm-scheduler.test.mjs` a dry-run test that writes a temp config with:

```json
{
  "scheduled": { "enabled": true },
  "provider": {
    "mode": "openai-responses",
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-test"
  }
}
```

Expected assertions:

```js
assert.equal(result.code, 0);
assert.match(result.stdout, /BacktestKit-Pine-LLM-/);
assert.match(result.stdout, /schtasks/);
assert.doesNotMatch(result.stdout, /OPENAI_API_KEY=.*sk-/);
```

Also add a negative test where `scheduled.enabled=false` and `-Enable` is absent; expected non-zero exit and explicit enablement message remains unchanged.

- [ ] **Step 2: Update installer provider allowlist**

Modify provider validation in `scripts/ops/install-pine-autoresearch-llm-tasks.ps1` so schedulable modes are exactly:

```powershell
$SchedulableProviderModes = @('cli', 'openai-chat-completions', 'openai-responses')
```

Keep `openclaw` rejected in scheduled mode. Keep `disabled` requiring explicit enablement failure for real install. Keep dry-run side-effect-free.

- [ ] **Step 3: Add status/manifest sanitization tests if metadata changes**

If `scripts/lib/pine-autoresearch-llm-runner.mjs` stores provider metadata beyond `mode`, add tests asserting provider status and manifest include only safe fields:

```js
assert.deepEqual(manifest.provider, {
  mode: 'openai-responses',
  model: 'gpt-test',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
});
assert.doesNotMatch(JSON.stringify(manifest), /sk-test-secret/);
```

If no metadata is added, leave runner unchanged and record in commit message that existing mode-only manifest is intentionally preserved.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add scripts/ops/install-pine-autoresearch-llm-tasks.ps1 scripts/lib/pine-autoresearch-llm-runner.mjs tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-runner.test.mjs
git commit -m "feat(pine): allow scheduled LLM API providers safely"
```

---

### Task 6: End-to-End Provider Flow Tests Without Network

**Files:**
- Modify: `tests/pine-autoresearch-llm-runner.test.mjs`
- Modify: `tests/pine-autoresearch-llm-e2e.test.mjs`

- [ ] **Step 1: Add a no-network successful API candidate flow**

Add a runner/e2e test using injected provider proposer or injected fetch so no real HTTP request happens. Expected flow:

1. Config uses `provider.mode=openai-responses` and `model=gpt-test`.
2. Provider returns raw JSON string:

```json
{"params":{"minPredSum":1.8},"rationale":"API candidate"}
```

3. Existing schema validation accepts candidate.
4. Reservation is created.
5. Manifest is written.
6. Manual review queue receives `pending_review` item.
7. No existing non-LLM promotion queue file is written.

Assertions must include:

```js
assert.equal(result.ok, true);
assert.equal(result.reason, 'candidate_enqueued_for_review');
assert.equal(reviewItems.length, 1);
assert.equal(reviewItems[0].status, 'pending_review');
assert.equal(reviewItems[0].candidate.params.minPredSum, 1.8);
```

- [ ] **Step 2: Add API malformed output test**

Add a test where API provider returns:

```text
Here is a candidate:
{"params":{"unknownParam":999}}
```

Expected:

```js
assert.equal(result.ok, false);
assert.equal(result.reason, 'candidate_invalid');
```

The test proves API structured-output hints do not replace local validation.

- [ ] **Step 3: Run tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-e2e.test.mjs tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-provider.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-e2e.test.mjs
git commit -m "test(pine): cover LLM API provider candidate flow"
```

---

### Task 7: Operator Documentation and Example Configs

**Files:**
- Modify: `docs/pine-llm-autoresearch.md`
- Optionally create: `config/pine-autoresearch-llm.openai-responses.example.json`
- Optionally create: `config/pine-autoresearch-llm.openai-chat-completions.example.json`

- [ ] **Step 1: Update docs defaults section**

Replace the old line saying API adapter is future work with:

```md
- Scheduled provider default: `disabled`
- Scheduled provider modes supported after explicit enablement: `cli`, `openai-chat-completions`, `openai-responses`
- `openclaw` provider: manual/on-demand only; rejected in scheduled mode
- API providers are non-streaming and must return exactly one candidate object
```

- [ ] **Step 2: Add OpenAI Responses example**

Add this docs section:

```md
## OpenAI Responses provider

Set the API key outside the repo:

```powershell
setx OPENAI_API_KEY "sk-..."
```

Use config:

```json
{
  "provider": {
    "mode": "openai-responses",
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-5.4",
    "temperature": 0.2,
    "topP": 1,
    "maxOutputTokens": 1200,
    "timeoutMs": 90000
  }
}
```

The request uses `POST /v1/responses` with `text.format.type=json_schema`, `stream=false`, and `store=false`.
```

- [ ] **Step 3: Add Chat Completions example**

Add this docs section:

```md
## OpenAI Chat Completions provider

Use config:

```json
{
  "provider": {
    "mode": "openai-chat-completions",
    "apiBaseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "model": "gpt-4.1-mini",
    "temperature": 0.2,
    "topP": 1,
    "maxOutputTokens": 1200,
    "timeoutMs": 90000
  }
}
```

The request uses `POST /v1/chat/completions` with `response_format.type=json_schema`, `stream=false`, and `n=1`.
```

- [ ] **Step 4: Add safety notes**

Add:

```md
## API provider safety

- Never commit API keys. Use `apiKeyEnv`.
- Provider responses are untrusted. Local candidate parsing, allowlist validation, fingerprinting, reservation, and manual review still gate all output.
- Streaming, tools, function calls, background responses, and conversation persistence are intentionally disabled for this lane.
- API providers can be installed as scheduled tasks only after explicit `-Enable` or `scheduled.enabled=true`.
```

- [ ] **Step 5: Run docs-related tests and commit**

Run:

```bash
npm test -- tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs
 git diff --check
```

Expected: all tests pass; diff check clean.

Commit:

```bash
git add docs/pine-llm-autoresearch.md config/pine-autoresearch-llm.openai-responses.example.json config/pine-autoresearch-llm.openai-chat-completions.example.json
git commit -m "docs(pine): document LLM API providers"
```

If example config files are not created, omit them from `git add` and keep examples inline in docs.

---

### Task 8: Final Verification and Review

**Files:**
- No planned source changes unless verification finds a defect.

- [ ] **Step 1: Run targeted LLM suite**

Run:

```bash
npm test -- \
  tests/pine-autoresearch-llm-openai-schema.test.mjs \
  tests/pine-autoresearch-llm-openai-http.test.mjs \
  tests/pine-autoresearch-llm-openai-provider.test.mjs \
  tests/pine-autoresearch-llm-provider.test.mjs \
  tests/pine-autoresearch-llm-runner.test.mjs \
  tests/pine-autoresearch-llm-e2e.test.mjs \
  tests/pine-autoresearch-llm-scheduler.test.mjs \
  tests/pine-autoresearch-llm-no-regression.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run existing autoresearch no-regression suite**

Run:

```bash
npm test -- tests/pine-autoresearch.test.mjs tests/pine-tuner.test.mjs
```

Expected: all pass.

- [ ] **Step 3: Run diff and secret scans**

Run:

```bash
git diff --check
git grep -n "sk-" -- . ':!node_modules' ':!package-lock.json'
git grep -n "OPENAI_API_KEY=.*sk" -- . ':!node_modules' ':!package-lock.json'
```

Expected: `git diff --check` exits 0; secret scans find no committed secret values.

- [ ] **Step 4: Dispatch final review subagents**

Request two reviews before merge:

1. **Security/API review:** Check API key handling, secret redaction, timeout behavior, non-streaming one-candidate contract, and scheduled enablement.
2. **Regression review:** Check existing non-LLM autoresearch behavior, scheduler wrappers, and promotion queue isolation.

Both reviews must be `APPROVE` or all blocking findings must be fixed before merge.

- [ ] **Step 5: Merge after approval**

Run:

```bash
git switch main
git merge --no-ff feature/pine-llm-openai-api-providers -m "merge: pine LLM OpenAI API providers"
npm test -- tests/pine-autoresearch-llm-openai-schema.test.mjs tests/pine-autoresearch-llm-openai-http.test.mjs tests/pine-autoresearch-llm-openai-provider.test.mjs tests/pine-autoresearch-llm-provider.test.mjs tests/pine-autoresearch-llm-runner.test.mjs tests/pine-autoresearch-llm-e2e.test.mjs tests/pine-autoresearch-llm-scheduler.test.mjs tests/pine-autoresearch-llm-no-regression.test.mjs tests/pine-autoresearch.test.mjs
git diff --check
git status --short --branch
```

Expected: merge succeeds; tests pass; diff check clean; status clean.

---

## Self-Review

- Spec coverage: plan covers OpenAI Chat Completions style, OpenAI Responses style, config, auth, timeout, parsing, scheduler enablement, docs, tests, and final reviews.
- Safety coverage: API keys only from env, no streaming/tools/background/conversation state, exactly one candidate object, local validator remains authoritative, manual review remains required.
- Regression coverage: existing provider modes remain, `openclaw` still rejected in scheduled mode, existing non-LLM autoresearch tests included in final gate.
- Placeholder scan: no `TBD`, no unspecified tests, no deferred error handling. Optional example config files are explicitly optional and have an omit path.
