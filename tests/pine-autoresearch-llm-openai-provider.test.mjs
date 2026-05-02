import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const defaultAllowlist = JSON.parse(
  await readFile(new URL('../config/pine-autoresearch-llm-allowlist.default.json', import.meta.url), 'utf8'),
);

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
  assert.match(request.messages[0].content, /no markdown/i);
  assert.match(request.messages[0].content, /No code fences/);
  assert.match(request.messages[0].content, /If you cannot improve the strategy/);
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
  assert.match(request.instructions, /no markdown/i);
  assert.match(request.instructions, /No code fences/);
  assert.match(request.instructions, /If you cannot improve the strategy/);
  assert.equal(request.input, 'candidate prompt');
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
});

test('buildChatCompletionsRequest supports repo default array allowlist', () => {
  const request = buildChatCompletionsRequest({
    provider: { model: 'gpt-test' },
    prompt: 'candidate prompt',
    allowlist: defaultAllowlist,
  });

  const params = request.response_format.json_schema.schema.properties.params.properties;
  assert.deepEqual(Object.keys(params).sort(), ['divRsiLen', 'minPredSum', 'riskRewardRatio', 'stopLossPct']);
  assert.equal(params.useSignalFusion, undefined);
  assert.equal(params.useFusionV4, undefined);
  assert.equal(params.useTrailingStop, undefined);
});

test('extractChatCompletionsText extracts first message content and rejects bad finish reasons', () => {
  const ok = extractChatCompletionsText({
    choices: [{ finish_reason: 'stop', message: { content: '{"params":{"minPredSum":1.8},"rationale":"x"}' } }],
  });
  assert.deepEqual(ok, { ok: true, raw: '{"params":{"minPredSum":1.8},"rationale":"x"}' });

  assert.deepEqual(extractChatCompletionsText({ choices: [] }), { ok: false, reason: 'missing_choice' });
  assert.deepEqual(extractChatCompletionsText({}), { ok: false, reason: 'missing_choice' });
  assert.deepEqual(
    extractChatCompletionsText({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }),
    { ok: false, reason: 'finish_reason:length' },
  );
  assert.deepEqual(
    extractChatCompletionsText({ choices: [
      { finish_reason: 'stop', message: { content: '{"a":1}' } },
      { finish_reason: 'stop', message: { content: '{"b":2}' } },
    ] }),
    { ok: false, reason: 'multiple_choices' },
  );
});

test('extractResponsesText accepts exactly one text payload', () => {
  assert.deepEqual(extractResponsesText({ status: 'completed', output_text: '{"params":{}}' }), {
    ok: true,
    raw: '{"params":{}}',
  });

  assert.deepEqual(
    extractResponsesText({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"params":{"minPredSum":1.8}}' }] }],
    }),
    { ok: true, raw: '{"params":{"minPredSum":1.8}}' },
  );

  assert.deepEqual(
    extractResponsesText({ status: 'completed', output: [{ type: 'message', content: [] }] }),
    { ok: false, reason: 'missing_output_text' },
  );

  assert.deepEqual(
    extractResponsesText({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }, { type: 'output_text', text: '{"b":2}' }] }],
    }),
    { ok: false, reason: 'multiple_output_text' },
  );

  assert.deepEqual(
    extractResponsesText({
      status: 'completed',
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] },
        { type: 'message', content: [{ type: 'output_text', text: '{"b":2}' }] },
      ],
    }),
    { ok: false, reason: 'multiple_output_text' },
  );

  assert.deepEqual(extractResponsesText({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), {
    ok: false,
    reason: 'response_status:incomplete',
    stderr: 'max_output_tokens',
  });
});

test('proposeOpenAiCandidate posts chat completions request and returns raw candidate text', async () => {
  const result = await proposeOpenAiCandidate({
    mode: 'openai-chat-completions',
    provider: { apiBaseUrl: 'https://api.openai.test/v1/', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-test' },
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
    provider: { apiBaseUrl: 'https://api.openai.test/v1/', apiKeyEnv: 'OPENAI_API_KEY', model: 'gpt-test' },
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

test('proposeOpenAiCandidate fails safely on unsupported mode and missing mode', async () => {
  assert.deepEqual(await proposeOpenAiCandidate({
    mode: 'openai-something-else',
    provider: { model: 'gpt-test', apiKeyEnv: 'OPENAI_API_KEY' },
    allowlist,
    prompt: 'p',
    env: { OPENAI_API_KEY: 'sk-test-secret' },
  }), {
    ok: false,
    reason: 'proposal_unavailable',
    stderr: 'unsupported provider mode:openai-something-else',
  });

  assert.deepEqual(await proposeOpenAiCandidate({
    provider: { model: 'gpt-test', apiKeyEnv: 'OPENAI_API_KEY' },
    allowlist,
    prompt: 'p',
    env: { OPENAI_API_KEY: 'sk-test-secret' },
  }), {
    ok: false,
    reason: 'proposal_unavailable',
    stderr: 'unsupported provider mode:undefined',
  });
});

test('proposeOpenAiCandidate propagates postJson failure safely', async () => {
  let called = 0;
  const result = await proposeOpenAiCandidate({
    mode: 'openai-responses',
    provider: { model: 'gpt-test', apiKeyEnv: 'OPENAI_API_KEY' },
    allowlist,
    prompt: 'p',
    env: { OPENAI_API_KEY: 'sk-test-secret' },
    postJson: async () => {
      called += 1;
      return { ok: false, reason: 'network_error', stderr: 'timeout' };
    },
  });

  assert.equal(called, 1);
  assert.deepEqual(result, { ok: false, reason: 'network_error', stderr: 'timeout' });
});

test('proposeOpenAiCandidate propagates extractor failure on malformed responses payload', async () => {
  const result = await proposeOpenAiCandidate({
    mode: 'openai-responses',
    provider: { model: 'gpt-test', apiKeyEnv: 'OPENAI_API_KEY' },
    allowlist,
    prompt: 'p',
    env: { OPENAI_API_KEY: 'sk-test-secret' },
    postJson: async () => ({
      ok: true,
      json: {
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }, { type: 'output_text', text: '{"b":2}' }] },
        ],
      },
    }),
  });

  assert.deepEqual(result, { ok: false, reason: 'multiple_output_text', stderr: '' });
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
