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

test('normalizeResourceBudget handles NaN Infinity negative and string values defensively', () => {
  const budget = normalizeResourceBudget({
    maxConcurrentLabWorkers: Number.NaN,
    maxManifestBytes: Number.POSITIVE_INFINITY,
    maxWorkerOldSpaceMb: -5,
    maxCandidateBatchSize: '4',
    maxRowsLoadedPerWorker: -10,
    maxRetainedJsonlPerRun: '9',
    softLaneTimeoutMs: Number.NEGATIVE_INFINITY,
    hardWorkerTimeoutMs: '1000',
  });

  assert.equal(budget.maxConcurrentLabWorkers, 1);
  assert.equal(budget.maxManifestBytes, 16384);
  assert.equal(budget.maxWorkerOldSpaceMb, 64);
  assert.equal(budget.maxCandidateBatchSize, 1);
  assert.equal(budget.maxRowsLoadedPerWorker, 1);
  assert.equal(budget.maxRetainedJsonlPerRun, 1);
  assert.equal(budget.softLaneTimeoutMs, 1000);
  assert.equal(budget.hardWorkerTimeoutMs, 1000);
});

test('shouldSpillManifestSection returns true when serialized section is too large', () => {
  const result = shouldSpillManifestSection({ huge: 'x'.repeat(1000) }, { maxSectionBytes: 100 });
  assert.equal(result.spill, true);
  assert.equal(result.bytes > 100, true);
});

test('shouldSpillManifestSection handles unserializable input safely', () => {
  const circular = {};
  circular.self = circular;

  const result = shouldSpillManifestSection(circular, { maxSectionBytes: 100 });
  assert.equal(result.spill, true);
  assert.equal(result.bytes, 0);
  assert.equal(result.maxSectionBytes, 100);
  assert.equal(result.error, 'manifestSectionUnserializable');
});

test('buildArtifactRef records path hash bytes and schema version', () => {
  const ref = buildArtifactRef({ path: '/tmp/a.json', bytes: 12, sha256: 'abc', schemaVersion: 1 });
  assert.deepEqual(ref, { path: '/tmp/a.json', bytes: 12, sha256: 'abc', schemaVersion: 1 });
});

test('buildArtifactRef throws when required identity fields missing', () => {
  assert.throws(() => buildArtifactRef({ path: '', sha256: 'abc' }), /artifact path is required/);
  assert.throws(() => buildArtifactRef({ path: '/tmp/a.json', sha256: '' }), /artifact sha256 is required/);
});

test('buildArtifactRef normalizes invalid bytes and schemaVersion', () => {
  const fromMissingSchema = buildArtifactRef({ path: '/tmp/a.json', bytes: Number.NaN, sha256: 'abc' });
  assert.deepEqual(fromMissingSchema, {
    path: '/tmp/a.json',
    bytes: 0,
    sha256: 'abc',
    schemaVersion: 1,
  });

  const fromInvalid = buildArtifactRef({
    path: '/tmp/a.json',
    bytes: Number.POSITIVE_INFINITY,
    sha256: 'abc',
    schemaVersion: -5,
  });
  assert.deepEqual(fromInvalid, {
    path: '/tmp/a.json',
    bytes: 0,
    sha256: 'abc',
    schemaVersion: 0,
  });
});

test('createResourceUsageSummary records skipped candidates and artifact bytes', () => {
  const summary = createResourceUsageSummary({ peakRssBytes: 100, artifactBytesWritten: 200, skippedByResourceCap: 3, prunedFiles: 4 });
  assert.equal(summary.peakRssBytes, 100);
  assert.equal(summary.artifactBytesWritten, 200);
  assert.equal(summary.skippedByResourceCap, 3);
  assert.equal(summary.prunedFiles, 4);
});

test('createResourceUsageSummary handles NaN Infinity negative and string values defensively', () => {
  const summary = createResourceUsageSummary({
    peakRssBytes: Number.NaN,
    artifactBytesWritten: Number.POSITIVE_INFINITY,
    skippedByResourceCap: -1,
    prunedFiles: '8',
  });

  assert.equal(summary.peakRssBytes, 0);
  assert.equal(summary.artifactBytesWritten, 0);
  assert.equal(summary.skippedByResourceCap, 0);
  assert.equal(summary.prunedFiles, 0);
});
