import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, relPath), 'utf8'));
}

async function readText(relPath) {
  return fs.readFile(path.join(repoRoot, relPath), 'utf8');
}

test('existing pine autoresearch package scripts stay unchanged', async () => {
  const pkg = await readJson('package.json');

  assert.equal(pkg.scripts['pine:autoresearch'], 'node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json');
  assert.equal(pkg.scripts['pine:autoresearch:micro'], 'node ./scripts/pine-autoresearch.mjs cycle --config ./config/pine-autoresearch.default.json --profile micro');
  assert.equal(pkg.scripts['pine:autoresearch:digest'], 'node ./scripts/pine-autoresearch.mjs digest --config ./config/pine-autoresearch.default.json');
  assert.equal(pkg.scripts['pine:autoresearch:autopromote'], 'node ./scripts/pine-autoresearch.mjs autopromote --config ./config/pine-autoresearch.default.json');
});

test('existing legacy task scripts do not mention LLM task names', async () => {
  const install = await readText('scripts/ops/install-pine-autoresearch-tasks.ps1');
  const remove = await readText('scripts/ops/remove-pine-autoresearch-tasks.ps1');

  assert.doesNotMatch(install, /BacktestKit-Pine-LLM/);
  assert.doesNotMatch(remove, /BacktestKit-Pine-LLM/);
});
