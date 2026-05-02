import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const scriptsRoot = path.join(repoRoot, 'scripts');
const RELEVANT_FILE_NAME_PATTERNS = [
  /pine-autoresearch/i,
  /pine-tuner/i,
  /pine-sweep/i,
  /pine-import-run-clean/i,
];
const DISALLOWED_DEPENDENCY_PATTERNS = [
  /\bfrom\s+['"][^'"]*pine-autoresearch-llm/i,
  /\bimport\s+['"][^'"]*pine-autoresearch-llm/i,
  /\bimport\s*\(\s*[^)]*pine-autoresearch-llm/i,
];
const EXCLUDED_PATH_SEGMENTS = new Set(['test', 'tests', '__tests__', 'fixtures', 'fixture', 'docs', 'doc', 'config', 'configs', 'generated', 'dist']);

async function listMjsFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMjsFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith('.mjs')) {
      files.push(path.relative(repoRoot, absolutePath).replaceAll('\\', '/'));
    }
  }

  return files;
}

function isRelevantSourceFile(relativePath) {
  if (!relativePath.startsWith('scripts/')) return false;
  if (relativePath.includes('pine-autoresearch-llm')) return false;

  const pathParts = relativePath.split('/');
  if (pathParts.some((part) => EXCLUDED_PATH_SEGMENTS.has(part))) return false;

  const basename = path.basename(relativePath);
  return RELEVANT_FILE_NAME_PATTERNS.some((pattern) => pattern.test(basename) || pattern.test(relativePath));
}

function findOffenders(relativePath, source) {
  const offenders = [];

  source.split(/\r?\n/).forEach((line, index) => {
    if (!DISALLOWED_DEPENDENCY_PATTERNS.some((pattern) => pattern.test(line))) return;
    offenders.push(`${relativePath}:${index + 1}: ${line.trim()}`);
  });

  return offenders;
}

test('non-LLM autoresearch files do not import LLM lane modules', async () => {
  const offenders = [];
  const relativePaths = (await listMjsFiles(scriptsRoot)).filter(isRelevantSourceFile);

  for (const relativePath of relativePaths) {
    const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
    offenders.push(...findOffenders(relativePath, source));
  }

  assert.deepEqual(offenders, []);
});
