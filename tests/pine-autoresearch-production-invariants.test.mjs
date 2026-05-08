import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateLatestManifestPointer, findOrphanEvaluationRuns } from '../scripts/lib/pine-autoresearch-artifacts.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const researchRoot = path.join(repoRoot, 'pine/autoresearch/pine-fusion-v4-core-15m-locked-window');

test('production latest.json points to an existing manifest', () => {
  if (!fs.existsSync(path.join(researchRoot, 'latest.json'))) return;
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

function duplicatePostFixGlobalAllParameterFingerprints(manifests = []) {
  const seen = new Map();
  const duplicates = [];
  for (const { file, manifest } of manifests) {
    if ((manifest?.globalNoveltyGuardVersion ?? 0) < 1) continue;
    const championId = manifest?.champion?.configId ?? manifest?.incumbent?.configId ?? null;
    const variants = Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [];
    for (const variant of variants) {
      if (variant?.lane !== 'globalAllParameter') continue;
      const patchFingerprint = variant?.patchFingerprint ?? variant?.metadata?.patchFingerprint ?? null;
      if (!championId || !patchFingerprint) continue;
      const key = `${championId}:${patchFingerprint}`;
      if (seen.has(key)) duplicates.push({ first: seen.get(key), second: file, championId, patchFingerprint });
      else seen.set(key, file);
    }
  }
  return duplicates;
}

test('globalAllParameter invariant ignores legacy manifests and detects post-fix duplicate patch fingerprints', () => {
  const legacyManifests = [
    {
      file: 'legacy-a.json',
      manifest: {
        champion: { configId: 'champ-legacy' },
        searchPlan: { variants: [{ lane: 'globalAllParameter', patchFingerprint: 'fp-repeat' }] },
      },
    },
    {
      file: 'legacy-b.json',
      manifest: {
        champion: { configId: 'champ-legacy' },
        searchPlan: { variants: [{ lane: 'globalAllParameter', patchFingerprint: 'fp-repeat' }] },
      },
    },
  ];
  assert.deepEqual(duplicatePostFixGlobalAllParameterFingerprints(legacyManifests), []);

  const postFixManifests = legacyManifests.map((item) => ({
    ...item,
    manifest: { ...item.manifest, globalNoveltyGuardVersion: 1 },
  }));
  assert.deepEqual(duplicatePostFixGlobalAllParameterFingerprints(postFixManifests), [{
    first: 'legacy-a.json',
    second: 'legacy-b.json',
    championId: 'champ-legacy',
    patchFingerprint: 'fp-repeat',
  }]);
});

test('post-fix production globalAllParameter manifests do not repeat identical patch fingerprints for same champion', () => {
  const manifestDir = path.join(researchRoot, 'manifests');
  if (!fs.existsSync(manifestDir)) return;
  const manifests = fs.readdirSync(manifestDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      manifest: JSON.parse(fs.readFileSync(path.join(manifestDir, file), 'utf8')),
    }));

  assert.deepEqual(duplicatePostFixGlobalAllParameterFingerprints(manifests), []);
});
