import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeResourceBudget,
  shouldSpillManifestSection,
  buildArtifactRef,
  createResourceUsageSummary,
} from '../scripts/lib/pine-resource-budget.mjs';

test('normalizeResourceBudget clamps unsafe values', () => {
  const budget = normalizeResourceBudget({ maxConcurrentLabWorkers: 0, maxManifestBytes: 10, maxWorkerOldSpaceMb: 1 });
  assert.equal(budget.maxConcurrentLabWorkers, 1);
  assert.equal(budget.maxManifestBytes >= 16384, true);
  assert.equal(budget.maxWorkerOldSpaceMb >= 64, true);
});

test('shouldSpillManifestSection returns true when serialized section is too large', () => {
  const result = shouldSpillManifestSection({ huge: 'x'.repeat(1000) }, { maxSectionBytes: 100 });
  assert.equal(result.spill, true);
  assert.equal(result.bytes > 100, true);
});

test('buildArtifactRef records path hash bytes and schema version', () => {
  const ref = buildArtifactRef({ path: '/tmp/a.json', bytes: 12, sha256: 'abc', schemaVersion: 1 });
  assert.deepEqual(ref, { path: '/tmp/a.json', bytes: 12, sha256: 'abc', schemaVersion: 1 });
});

test('createResourceUsageSummary records skipped candidates and artifact bytes', () => {
  const summary = createResourceUsageSummary({ peakRssBytes: 100, artifactBytesWritten: 200, skippedByResourceCap: 3, prunedFiles: 4 });
  assert.equal(summary.peakRssBytes, 100);
  assert.equal(summary.artifactBytesWritten, 200);
  assert.equal(summary.skippedByResourceCap, 3);
  assert.equal(summary.prunedFiles, 4);
});
