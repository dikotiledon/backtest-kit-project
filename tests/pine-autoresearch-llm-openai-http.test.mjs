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
