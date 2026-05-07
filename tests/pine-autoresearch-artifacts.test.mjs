import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  beginAutoresearchRunArtifact,
  finalizeAutoresearchManifest,
  markAutoresearchRunIncomplete,
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
