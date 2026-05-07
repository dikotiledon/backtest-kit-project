import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  beginAutoresearchRunArtifact,
  finalizeAutoresearchManifest,
  markAutoresearchRunIncomplete,
  markAutoresearchRunIncompleteUnlessManifestExists,
  validateLatestManifestPointer,
} from '../scripts/lib/pine-autoresearch-artifacts.mjs';

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
