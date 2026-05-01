import assert from 'node:assert/strict';
import test from 'node:test';

import { proposeCandidate } from '../scripts/lib/pine-autoresearch-llm-provider.mjs';

test('disabled provider exits proposal unavailable', async () => {
  const result = await proposeCandidate({ provider: { mode: 'disabled' }, scheduled: false, prompt: 'p' });

  assert.deepEqual(result, { ok: false, reason: 'proposal_unavailable' });
});

test('openclaw provider rejected in scheduled mode', async () => {
  const result = await proposeCandidate({ provider: { mode: 'openclaw' }, scheduled: true, prompt: 'p' });

  assert.deepEqual(result, { ok: false, reason: 'openclaw_rejected_in_scheduled_mode' });
});

test('file provider returns file content from injected readFile', async () => {
  const result = await proposeCandidate({
    provider: { mode: 'file', candidateFile: 'candidate.json' },
    scheduled: false,
    prompt: 'p',
    readFile: async (filePath, encoding) => {
      assert.equal(filePath, 'candidate.json');
      assert.equal(encoding, 'utf8');
      return '{"minPredSum":1.8}';
    },
  });

  assert.deepEqual(result, { ok: true, raw: '{"minPredSum":1.8}', source: 'file' });
});

test('file provider readFile rejection returns proposal_failed', async () => {
  const result = await proposeCandidate({
    provider: { mode: 'file', candidateFile: 'candidate.json' },
    scheduled: false,
    prompt: 'p',
    readFile: async () => {
      throw new Error('read boom');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'proposal_failed');
  assert.match(result.stderr, /read boom/);
});

test('cli provider requires command and uses injected execCommand', async () => {
  const missing = await proposeCandidate({ provider: { mode: 'cli' }, scheduled: false, prompt: 'p' });
  assert.deepEqual(missing, { ok: false, reason: 'proposal_unavailable' });

  const result = await proposeCandidate({
    provider: { mode: 'cli', cliCommand: 'run-cli', timeoutMs: 1234 },
    scheduled: false,
    prompt: 'input prompt',
    execCommand: async (command, options) => {
      assert.equal(command, 'run-cli');
      assert.deepEqual(options, { input: 'input prompt', timeoutMs: 1234 });
      return { code: 0, stdout: '  candidate raw  ', stderr: '' };
    },
  });

  assert.deepEqual(result, { ok: true, raw: 'candidate raw', source: 'cli' });
});

test('cli provider execCommand rejection returns proposal_failed', async () => {
  const result = await proposeCandidate({
    provider: { mode: 'cli', cliCommand: 'run-cli' },
    scheduled: false,
    prompt: 'input prompt',
    execCommand: async () => {
      throw new Error('exec boom');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'proposal_failed');
  assert.match(result.stderr, /exec boom/);
});

test('cli provider rejects null code with signal', async () => {
  const result = await proposeCandidate({
    provider: { mode: 'cli', cliCommand: 'run-cli' },
    scheduled: false,
    prompt: 'input prompt',
    execCommand: async () => ({ code: null, stdout: 'candidate raw', stderr: '', signal: 'SIGTERM' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'proposal_failed');
  assert.match(result.stderr, /SIGTERM/);
});

test('cli provider rejects missing code', async () => {
  const result = await proposeCandidate({
    provider: { mode: 'cli', cliCommand: 'run-cli' },
    scheduled: false,
    prompt: 'input prompt',
    execCommand: async () => ({ stdout: 'candidate raw' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'proposal_failed');
  assert.match(result.stderr, /missing exit code/i);
});

test('openai API providers dispatch through injected openai proposer', async () => {
  const calls = [];
  const result = await proposeCandidate({
    provider: { mode: 'openai-responses', model: 'gpt-test' },
    allowlist: { version: 1, parameters: {} },
    scheduled: true,
    prompt: 'input prompt',
    proposeOpenAi: async (options) => {
      calls.push(options);
      return { ok: true, raw: '{\"params\":{},\"rationale\":\"x\"}', source: 'openai-responses' };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mode, 'openai-responses');
  assert.equal(calls[0].provider.model, 'gpt-test');
  assert.equal(calls[0].prompt, 'input prompt');
  assert.deepEqual(result, { ok: true, raw: '{\"params\":{},\"rationale\":\"x\"}', source: 'openai-responses' });
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
