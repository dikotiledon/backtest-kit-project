import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relPath) {
  return fs.readFile(path.join(repoRoot, relPath), 'utf8');
}

async function runPwshFile(scriptPath, args = [], cwd = repoRoot) {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', scriptPath, ...args], {
      cwd,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error.message ? `\n${error.message}` : ''}`.trim() }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
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

test('LLM task installer dry-run previews only LLM tasks', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-install-dryrun-'));
  try {
    const configDir = path.join(tempRoot, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'pine-autoresearch-llm.default.json'), JSON.stringify({
      matrixId: 'pine-fusion-v4-core-15m-locked-window',
      provider: { mode: 'disabled' },
    }), 'utf8');

    const result = await runPwshFile(path.join(repoRoot, 'scripts/ops/install-pine-autoresearch-llm-tasks.ps1'), ['-RepoRoot', tempRoot, '-DryRun'], repoRoot);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[dry-run\].*BacktestKit-Pine-LLM-Run/);
    assert.match(result.stdout, /\[dry-run\].*BacktestKit-Pine-LLM-Digest/);
    assert.doesNotMatch(result.stdout, /BacktestKit-Pine-Autoresearch-Micro/);
    assert.doesNotMatch(result.stdout, /BacktestKit-Pine-Autoresearch-Full/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('LLM dry-run does not create runtime dirs', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-llm-dryrun-'));
  try {
    const configDir = path.join(tempRoot, 'config');
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, 'pine-autoresearch-llm.default.json'), JSON.stringify({
      matrixId: 'pine-fusion-v4-core-15m-locked-window',
      provider: { mode: 'disabled' },
    }), 'utf8');

    const result = await runPwshFile(path.join(repoRoot, 'scripts/ops/pine-autoresearch-llm-run.ps1'), ['-RepoRoot', tempRoot, '-DryRun'], repoRoot);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\[dry-run\].*provider=disabled/);
    await assert.rejects(() => fs.stat(path.join(tempRoot, 'pine', 'autoresearch-llm')), /ENOENT/);
    await assert.rejects(() => fs.stat(path.join(tempRoot, 'tmp', 'pine-autoresearch-llm-logs')), /ENOENT/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
