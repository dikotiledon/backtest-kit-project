import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  beginAutoresearchRunArtifact,
  finalizeAutoresearchManifest,
  markAutoresearchRunIncomplete,
  markAutoresearchRunIncompleteUnlessManifestExists,
  validateLatestManifestPointer,
  findOrphanEvaluationRuns,
  repairOrphanEvaluationRuns,
} from '../scripts/lib/pine-autoresearch-artifacts.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..');
const repairCliPath = path.join(repoRoot, 'scripts', 'pine-autoresearch-repair-artifacts.mjs');

function runRepairCli(args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [repairCliPath, ...args], { cwd });
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

test('artifact lifecycle writes incomplete marker when manifest is not finalized', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const runId = 'run-001';
  const started = await beginAutoresearchRunArtifact({ root, runId, profile: 'full' });

  assert.ok(fs.existsSync(started.startedPath));

  const incomplete = await markAutoresearchRunIncomplete({
    root,
    runId,
    reason: 'process_exit_without_manifest',
    error: 'missing manifest',
  });

  assert.ok(fs.existsSync(incomplete.incompletePath));
  const payload = JSON.parse(fs.readFileSync(incomplete.incompletePath, 'utf8'));
  assert.equal(payload.runId, runId);
  assert.equal(payload.reason, 'process_exit_without_manifest');
});

test('finalizeAutoresearchManifest writes manifest then latest pointer atomically', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const manifest = { runId: 'run-002', generatedAt: '2026-05-07T00:00:00.000Z', matrixDecision: { recommendation: 'hold' } };

  const result = await finalizeAutoresearchManifest({ root, manifest });

  assert.ok(fs.existsSync(result.manifestPath));
  assert.ok(fs.existsSync(path.join(root, 'latest.json')));
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'latest.json'), 'utf8'));
  assert.equal(latest.runId, 'run-002');
});

test('validateLatestManifestPointer rejects latest pointer without manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ runId: 'run-missing' }), 'utf8');

  const result = validateLatestManifestPointer({ root });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'latest_manifest_missing');
});

test('validateLatestManifestPointer resolves legacy latest pointer to canonical manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const runId = 'run-legacy';
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ runId, staleSummary: 'ignored' }), 'utf8');
  fs.writeFileSync(path.join(root, 'manifests', `${runId}.json`), JSON.stringify({ runId, canonical: true }), 'utf8');

  const result = validateLatestManifestPointer({ root });

  assert.equal(result.ok, true);
  assert.equal(result.manifest.canonical, true);
  assert.equal(result.manifest.manifestPath, path.join(root, 'manifests', `${runId}.json`));
});

test('validateLatestManifestPointer fails closed on stale pointer and runId mismatch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ runId: 'run-a', manifestPath: path.join(root, 'manifests', 'run-old.json') }), 'utf8');
  fs.writeFileSync(path.join(root, 'manifests', 'run-a.json'), JSON.stringify({ runId: 'run-b' }), 'utf8');

  const mismatch = validateLatestManifestPointer({ root });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'latest_manifest_run_id_mismatch');

  fs.writeFileSync(path.join(root, 'manifests', 'run-a.json'), JSON.stringify({ runId: 'run-a' }), 'utf8');
  const stale = validateLatestManifestPointer({ root });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'latest_manifest_path_stale');
});

test('validateLatestManifestPointer rejects unsafe latest runId paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.mkdirSync(path.join(root, 'manifests', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'latest.json'), JSON.stringify({ runId: 'nested/run-escape' }), 'utf8');
  fs.writeFileSync(path.join(root, 'manifests', 'nested', 'run-escape.json'), JSON.stringify({ runId: 'nested/run-escape' }), 'utf8');

  const result = validateLatestManifestPointer({ root });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'latest_run_id_unsafe');
});

test('incomplete marker failure is recorded without masking original error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const runId = 'run-marker-fails';
  const originalError = new Error('original run failure');
  fs.writeFileSync(path.join(root, 'incomplete'), 'not a directory', 'utf8');

  const result = await markAutoresearchRunIncompleteUnlessManifestExists({
    root,
    runId,
    reason: 'run_failed_before_manifest',
    error: originalError,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'marker_failed');
  assert.ok(result.markerError);
  assert.equal(originalError.autoresearchIncompleteMarkerError, result.markerError);
  assert.equal(originalError.message, 'original run failure');
});

test('incomplete marker is skipped when manifest exists after latest pointer failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  const runId = 'run-latest-fails';
  const latestPath = path.join(root, 'latest.json');
  fs.mkdirSync(latestPath, { recursive: true });

  const manifest = { runId, generatedAt: '2026-05-07T00:00:00.000Z', matrixDecision: { recommendation: 'hold' } };
  let finalizeError = null;
  try {
    await finalizeAutoresearchManifest({ root, manifest });
  } catch (error) {
    finalizeError = error;
  }

  assert.ok(finalizeError);
  const manifestPath = path.join(root, 'manifests', `${runId}.json`);
  assert.ok(fs.existsSync(manifestPath));

  const result = await markAutoresearchRunIncompleteUnlessManifestExists({
    root,
    runId,
    reason: 'run_failed_before_manifest',
    error: finalizeError,
  });

  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'manifest_exists');
  assert.equal(result.manifestPath, manifestPath);
  assert.equal(fs.existsSync(path.join(root, 'incomplete', `${runId}.json`)), false);
});

test('findOrphanEvaluationRuns reports evaluation dirs without manifest or incomplete marker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });
  fs.mkdirSync(path.join(root, 'evaluations', 'run-complete'), { recursive: true });
  fs.mkdirSync(path.join(root, 'evaluations', 'run-incomplete'), { recursive: true });
  fs.mkdirSync(path.join(root, 'manifests'), { recursive: true });
  fs.mkdirSync(path.join(root, 'incomplete'), { recursive: true });
  fs.writeFileSync(path.join(root, 'manifests', 'run-complete.json'), JSON.stringify({ runId: 'run-complete' }), 'utf8');
  fs.writeFileSync(
    path.join(root, 'incomplete', 'run-incomplete.json'),
    JSON.stringify({ runId: 'run-incomplete' }),
    'utf8',
  );

  const result = findOrphanEvaluationRuns({ root });

  assert.deepEqual(result.orphans.map((item) => item.runId), ['run-orphan']);
});

test('repair artifact dry run lists orphan dirs without writing markers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });

  const result = await repairOrphanEvaluationRuns({ root, dryRun: true, reason: 'historical_orphan' });

  assert.deepEqual(result.repaired, []);
  assert.deepEqual(result.orphans.map((item) => item.runId), ['run-orphan']);
  assert.equal(fs.existsSync(path.join(root, 'incomplete', 'run-orphan.json')), false);
});

test('repair CLI dry run exits 2 and does not write markers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-cli-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });

  const result = await runRepairCli(['--root', root]);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.code, 2);
  assert.equal(payload.dryRun, true);
  assert.deepEqual(payload.orphans.map((item) => item.runId), ['run-orphan']);
  assert.equal(fs.existsSync(path.join(root, 'incomplete', 'run-orphan.json')), false);
});

test('repair CLI --write writes incomplete marker for orphan evaluation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-cli-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });

  const result = await runRepairCli(['--write', '--root', root]);
  const payload = JSON.parse(result.stdout);
  const markerPath = path.join(root, 'incomplete', 'run-orphan.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));

  assert.equal(result.code, 0);
  assert.equal(payload.dryRun, false);
  assert.deepEqual(payload.repaired, ['run-orphan']);
  assert.equal(marker.runId, 'run-orphan');
  assert.equal(marker.reason, 'historical_orphan_without_manifest');
});

test('repair CLI --write is idempotent after marker exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-cli-'));
  fs.mkdirSync(path.join(root, 'evaluations', 'run-orphan'), { recursive: true });

  const first = await runRepairCli(['--write', '--root', root]);
  const second = await runRepairCli(['--write', '--root', root]);
  const secondPayload = JSON.parse(second.stdout);
  const markerFiles = fs.readdirSync(path.join(root, 'incomplete'));

  assert.equal(first.code, 0);
  assert.equal(second.code, 0);
  assert.deepEqual(secondPayload.orphans, []);
  assert.deepEqual(secondPayload.repaired, []);
  assert.deepEqual(markerFiles, ['run-orphan.json']);
});

test('repair CLI rejects invalid args before writing markers', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-artifacts-cli-cwd-'));
  const defaultRoot = path.join(cwd, 'pine', 'autoresearch', 'pine-fusion-v4-core-15m-locked-window');
  fs.mkdirSync(path.join(defaultRoot, 'evaluations', 'run-orphan'), { recursive: true });

  const result = await runRepairCli(['--write', '--rot', 'X'], { cwd });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /unknown argument: --rot/);
  assert.equal(fs.existsSync(path.join(defaultRoot, 'incomplete', 'run-orphan.json')), false);
});
