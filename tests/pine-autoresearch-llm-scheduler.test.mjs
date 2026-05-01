import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(repoRoot, relPath), 'utf8');
}

test('LLM scheduler wrapper uses isolated lock and mutex names', async () => {
  const script = await read('scripts/ops/pine-autoresearch-llm-run.ps1');

  assert.match(script, /BacktestKit-Pine-LLM/);
  assert.match(script, /llm-scheduler\.lock/);
  assert.match(script, /Global\\BacktestKit-Pine-LLM-Autoresearch/);
  assert.doesNotMatch(script, /tmp\\pine-autoresearch-locks\\scheduler\.lock/);
});

test('LLM task installer and remover keep only LLM task names', async () => {
  const install = await read('scripts/ops/install-pine-autoresearch-llm-tasks.ps1');
  const remove = await read('scripts/ops/remove-pine-autoresearch-llm-tasks.ps1');

  for (const script of [install, remove]) {
    assert.match(script, /BacktestKit-Pine-LLM-Run/);
    assert.match(script, /BacktestKit-Pine-LLM-Digest/);
    assert.doesNotMatch(script, /BacktestKit-Pine-Autoresearch-Micro/);
    assert.doesNotMatch(script, /BacktestKit-Pine-Autoresearch-Full/);
  }
});
