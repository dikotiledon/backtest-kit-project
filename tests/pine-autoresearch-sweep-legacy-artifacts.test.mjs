import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planLegacyVariantSweep } from '../scripts/pine-autoresearch-sweep-legacy-artifacts.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const sweepCliPath = path.join(repoRoot, 'scripts', 'pine-autoresearch-sweep-legacy-artifacts.mjs');

function runSweepCli(args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [sweepCliPath, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('planLegacyVariantSweep keeps retained runIds and deletes older variant files', () => {
  const files = [
    'x-2026-04-27T00-00-00-000Z-variants.json',
    'x-2026-05-10T00-00-00-000Z-variants.json',
    'x-2026-05-11T00-00-00-000Z-variants.json',
  ];

  const plan = planLegacyVariantSweep({
    files,
    retainRunIds: ['x-2026-05-11T00-00-00-000Z'],
  });

  assert.deepEqual(plan.keep, ['x-2026-05-11T00-00-00-000Z-variants.json']);
  assert.deepEqual(plan.delete, [
    'x-2026-04-27T00-00-00-000Z-variants.json',
    'x-2026-05-10T00-00-00-000Z-variants.json',
  ]);
});

test('planLegacyVariantSweep ignores non-variant files and unsafe path names', () => {
  const plan = planLegacyVariantSweep({
    files: [
      'latest.json',
      'notes.txt',
      'nested/run-2026-05-12T00-00-00-000Z-variants.json',
      '..\\run-2026-05-12T00-00-00-000Z-variants.json',
      '../run-2026-05-12T00-00-00-000Z-variants.json',
      '.hidden-2026-05-12T00-00-00-000Z-variants.json',
      'safe-2026-05-12T00-00-00-000Z-variants.json',
    ],
    retainRunIds: ['safe-2026-05-12T00-00-00-000Z'],
  });

  assert.deepEqual(plan.keep, ['safe-2026-05-12T00-00-00-000Z-variants.json']);
  assert.deepEqual(plan.delete, []);
});

test('planLegacyVariantSweep sanitizes retained runIds and returns deterministic sorted arrays', () => {
  const plan = planLegacyVariantSweep({
    files: [
      'b-2026-05-12T00-00-00-000Z-variants.json',
      'a-2026-05-12T00-00-00-000Z-variants.json',
      'c-2026-05-12T00-00-00-000Z-variants.json',
    ],
    retainRunIds: [
      '../a-2026-05-12T00-00-00-000Z',
      'b-2026-05-12T00-00-00-000Z',
      'nested/c-2026-05-12T00-00-00-000Z',
    ],
  });

  assert.deepEqual(plan.keep, ['b-2026-05-12T00-00-00-000Z-variants.json']);
  assert.deepEqual(plan.delete, [
    'a-2026-05-12T00-00-00-000Z-variants.json',
    'c-2026-05-12T00-00-00-000Z-variants.json',
  ]);
});

test('sweep CLI dry-run reports empty plan when research root is missing', async () => {
  const root = path.join(os.tmpdir(), `pine-legacy-sweep-missing-${Date.now()}-${Math.random()}`);

  const result = await runSweepCli(['--root', root, '--keep', '0']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.code, 0);
  assert.equal(payload.researchRoot, path.resolve(root));
  assert.equal(payload.rootExists, false);
  assert.equal(payload.keep, 1);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.keepCount, 0);
  assert.equal(payload.deleteCount, 0);
  assert.deepEqual(payload.deleteSample, []);
});

test('sweep CLI dry-run keeps files and apply deletes only planned base filenames', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-legacy-sweep-'));
  const older = 'x-2026-05-10T00-00-00-000Z-variants.json';
  const latest = 'x-2026-05-11T00-00-00-000Z-variants.json';
  const ignored = 'latest.json';
  fs.writeFileSync(path.join(root, older), '{}', 'utf8');
  fs.writeFileSync(path.join(root, latest), '{}', 'utf8');
  fs.writeFileSync(path.join(root, ignored), '{}', 'utf8');

  const dryRun = await runSweepCli(['--root', root, '--keep', '1']);
  const dryPayload = JSON.parse(dryRun.stdout);

  assert.equal(dryRun.code, 0);
  assert.equal(dryPayload.dryRun, true);
  assert.equal(dryPayload.keepCount, 1);
  assert.equal(dryPayload.deleteCount, 1);
  assert.deepEqual(dryPayload.deleteSample, [older]);
  assert.equal(fs.existsSync(path.join(root, older)), true);
  assert.equal(fs.existsSync(path.join(root, latest)), true);

  const applied = await runSweepCli(['--root', root, '--keep', '1', '--apply', 'true']);
  const applyPayload = JSON.parse(applied.stdout);

  assert.equal(applied.code, 0);
  assert.equal(applyPayload.dryRun, false);
  assert.deepEqual(applyPayload.deleted, [older]);
  assert.equal(fs.existsSync(path.join(root, older)), false);
  assert.equal(fs.existsSync(path.join(root, latest)), true);
  assert.equal(fs.existsSync(path.join(root, ignored)), true);
});
