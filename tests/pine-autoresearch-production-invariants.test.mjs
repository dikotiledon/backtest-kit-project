import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateLatestManifestPointer, findOrphanEvaluationRuns } from '../scripts/lib/pine-autoresearch-artifacts.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const researchRoot = path.join(repoRoot, 'pine/autoresearch/pine-fusion-v4-core-15m-locked-window');

test('production latest.json points to an existing manifest', () => {
  const result = validateLatestManifestPointer({ root: researchRoot });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('production evaluation dirs are finalized or explicitly incomplete', () => {
  const result = findOrphanEvaluationRuns({ root: researchRoot });
  assert.equal(result.ok, true, JSON.stringify(result.orphans, null, 2));
});

test('latest complete manifest does not claim preview-only regime generation as real candidate work', () => {
  const latestPath = path.join(researchRoot, 'latest.json');
  if (!fs.existsSync(latestPath)) return;
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  const scoreboard = latest.shadowRegimeScoreboard;
  if (!scoreboard || scoreboard.selectedLane !== 'exitRegime') return;

  assert.equal(scoreboard.generatorSummary.previewOnly, false);
  assert.ok(scoreboard.generatorSummary.candidateCount > 0);
  assert.equal(scoreboard.generatorSummary.countSource, 'generatedVariants');
});
