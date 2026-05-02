import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');

const NON_LLM_FILES = [
  'scripts/pine-autoresearch.mjs',
  'scripts/lib/pine-autoresearch.mjs',
  'scripts/lib/pine-tuner.mjs',
  'scripts/pine-sweep.mjs',
  'scripts/pine-import-run-clean.mjs',
];

test('non-LLM autoresearch files do not import LLM lane modules', async () => {
  const offenders = [];

  for (const relativePath of NON_LLM_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    const source = await fs.readFile(absolutePath, 'utf8');
    const importLines = source
      .split(/\r?\n/)
      .map((line, index) => ({ line, lineNumber: index + 1 }))
      .filter(({ line }) => /^\s*import\s/.test(line) || /from\s+['"]/.test(line));

    for (const { line, lineNumber } of importLines) {
      if (/pine-autoresearch-llm/i.test(line)) {
        offenders.push(`${relativePath}:${lineNumber}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
