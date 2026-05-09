import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateLatestManifestPointer, findOrphanEvaluationRuns } from '../scripts/lib/pine-autoresearch-artifacts.mjs';
import { buildChampionConfigFingerprint, buildGlobalPatchFingerprint } from '../scripts/lib/pine-global-search.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const configPath = path.join(repoRoot, 'config/pine-autoresearch.default.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveMaybeRelative(baseDir, targetPath) {
  if (!targetPath) return null;
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

function rootsFromConfig(projectRoot) {
  const candidateConfigPath = path.join(projectRoot, 'config/pine-autoresearch.default.json');
  const rawConfig = readJson(candidateConfigPath);
  const baseDir = path.dirname(candidateConfigPath);
  return {
    source: candidateConfigPath,
    researchRoot: resolveMaybeRelative(baseDir, rawConfig.outputs?.researchRoot),
    digestRoot: resolveMaybeRelative(baseDir, rawConfig.outputs?.digestRoot),
  };
}

function parentRepoRootForWorktree(projectRoot) {
  const marker = `${path.sep}.worktrees${path.sep}`;
  const markerIndex = projectRoot.indexOf(marker);
  return markerIndex >= 0 ? projectRoot.slice(0, markerIndex) : null;
}

function hasProductionArtifactEvidence({ researchRoot, digestRoot } = {}) {
  return Boolean(
    researchRoot
      && digestRoot
      && fs.existsSync(path.join(researchRoot, 'latest.json'))
      && fs.existsSync(path.join(researchRoot, 'manifests'))
      && fs.existsSync(path.join(digestRoot, 'latest-digest.md')),
  );
}

function configuredProductionRoots({ env = process.env } = {}) {
  if (env.PINE_AUTORESEARCH_PRODUCTION_ROOT || env.PINE_AUTORESEARCH_PRODUCTION_DIGEST_ROOT) {
    const configRoots = rootsFromConfig(repoRoot);
    return {
      source: 'env',
      researchRoot: env.PINE_AUTORESEARCH_PRODUCTION_ROOT
        ? path.resolve(env.PINE_AUTORESEARCH_PRODUCTION_ROOT)
        : configRoots.researchRoot,
      digestRoot: env.PINE_AUTORESEARCH_PRODUCTION_DIGEST_ROOT
        ? path.resolve(env.PINE_AUTORESEARCH_PRODUCTION_DIGEST_ROOT)
        : configRoots.digestRoot,
    };
  }

  const configRoots = rootsFromConfig(repoRoot);
  const parentRepoRoot = parentRepoRootForWorktree(repoRoot);
  if (parentRepoRoot) {
    const parentRoots = rootsFromConfig(parentRepoRoot);
    if (!hasProductionArtifactEvidence(configRoots) && hasProductionArtifactEvidence(parentRoots)) {
      return parentRoots;
    }
  }
  return configRoots;
}

function productionInvariantMode(env = process.env) {
  if (env.PINE_AUTORESEARCH_PRODUCTION_INVARIANTS === 'required') return 'required';
  if (env.PINE_AUTORESEARCH_PRODUCTION_ROOT || env.PINE_AUTORESEARCH_PRODUCTION_DIGEST_ROOT) return 'required';
  return 'fixture-only';
}

function invariantMessage(result) {
  return JSON.stringify(result.violations, null, 2);
}

function isGlobalAllParameterLane(lane) {
  return lane === 'globalAllParameter' || lane === 'global-all-parameter';
}

function championConfigIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.config && typeof value.config === 'object' && !Array.isArray(value.config)) {
    return buildChampionConfigFingerprint(value.config);
  }
  if (typeof value.championConfigFingerprint === 'string' && value.championConfigFingerprint.length > 0) {
    return value.championConfigFingerprint;
  }
  if (typeof value.metadata?.championConfigFingerprint === 'string' && value.metadata.championConfigFingerprint.length > 0) {
    return value.metadata.championConfigFingerprint;
  }
  return null;
}

function manifestChampionConfigIdentity(manifest) {
  const fromChampion = championConfigIdentity(manifest?.champion ?? manifest?.incumbent);
  if (fromChampion) return fromChampion;
  if (typeof manifest?.championConfigFingerprint === 'string' && manifest.championConfigFingerprint.length > 0) {
    return manifest.championConfigFingerprint;
  }
  if (typeof manifest?.metadata?.championConfigFingerprint === 'string' && manifest.metadata.championConfigFingerprint.length > 0) {
    return manifest.metadata.championConfigFingerprint;
  }
  return null;
}

function manifestChampionConfig(manifest) {
  const champion = manifest?.champion ?? manifest?.incumbent ?? null;
  return champion?.config && typeof champion.config === 'object' && !Array.isArray(champion.config)
    ? champion.config
    : null;
}

function variantChampionConfigIdentity(variant) {
  const value = variant?.metadata?.championConfigFingerprint ?? variant?.championConfigFingerprint ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function variantMutationFamily(variant) {
  const value = variant?.mutationFamily ?? variant?.metadata?.mutationFamily ?? variant?.family ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function variantStoredFingerprints(variant) {
  const version = variant?.patchFingerprintVersion ?? variant?.metadata?.patchFingerprintVersion ?? null;
  if (Number(version) !== 2) return [];
  return [variant?.patchFingerprint, variant?.metadata?.patchFingerprint]
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item));
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value || {}));
}

function variantPatchEvidence(variant) {
  const patch = variant?.patch;
  return patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : null;
}

function patchesEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

function reconstructPatchFromVariantConfig({ variant, championConfig }) {
  const variantConfig = variant?.config;
  if (!championConfig || typeof championConfig !== 'object' || Array.isArray(championConfig)) return null;
  if (!variantConfig || typeof variantConfig !== 'object' || Array.isArray(variantConfig)) return null;
  const patch = {};
  const keys = new Set([...Object.keys(championConfig), ...Object.keys(variantConfig)]);
  for (const key of [...keys].sort()) {
    if (!Object.is(championConfig[key], variantConfig[key])) patch[key] = variantConfig[key];
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function reconstructGlobalPatchFingerprint({ variant, championConfigFingerprint, championConfig }) {
  if (!isGlobalAllParameterLane(variant?.lane)) return null;
  const mutationFamily = variantMutationFamily(variant);
  const patchEvidence = variantPatchEvidence(variant);
  const configPatch = reconstructPatchFromVariantConfig({ variant, championConfig });
  const patch = patchEvidence ?? configPatch;
  if (!championConfigFingerprint || !mutationFamily || !patch) return null;
  if (patchEvidence && configPatch && !patchesEqual(patchEvidence, configPatch)) return null;
  try {
    return buildGlobalPatchFingerprint({
      championConfigFingerprint,
      lane: variant.lane,
      mutationFamily,
      patch,
    });
  } catch {
    return null;
  }
}

function readManifestFiles(manifestDir) {
  if (!fs.existsSync(manifestDir)) return [];
  return fs.readdirSync(manifestDir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      path: path.join(manifestDir, file),
      manifest: readJson(path.join(manifestDir, file)),
    }));
}

function validateGlobalAllParameterNovelty(manifests = [], { requireEvidence = false } = {}) {
  const seen = new Map();
  const violations = [];
  let globalManifestCount = 0;
  let evaluatedManifestCount = 0;

  for (const { file, manifest } of manifests) {
    const variants = Array.isArray(manifest?.searchPlan?.variants) ? manifest.searchPlan.variants : [];
    const hasGlobalFingerprintEvidence = variants.some((variant) => (
      isGlobalAllParameterLane(variant?.lane)
        && (Number(variant?.patchFingerprintVersion ?? variant?.metadata?.patchFingerprintVersion ?? 0) === 2
          || typeof variant?.patchFingerprint === 'string'
          || typeof variant?.metadata?.patchFingerprint === 'string')
    ));
    if (variants.some((variant) => isGlobalAllParameterLane(variant?.lane))) globalManifestCount += 1;
    if ((manifest?.globalNoveltyGuardVersion ?? 0) < 1 && !hasGlobalFingerprintEvidence) continue;
    evaluatedManifestCount += 1;
    const manifestIdentity = manifestChampionConfigIdentity(manifest);
    const manifestConfig = manifestChampionConfig(manifest);

    for (const variant of variants) {
      if (!isGlobalAllParameterLane(variant?.lane)) continue;
      const variantIdentity = variantChampionConfigIdentity(variant);
      const championConfigFingerprint = variantIdentity ?? manifestIdentity;
      if (!championConfigFingerprint) {
        violations.push({ code: 'global_patch_champion_fingerprint_missing', file, variantId: variant?.variantId ?? null });
        continue;
      }

      const patchEvidence = variantPatchEvidence(variant);
      const configPatch = reconstructPatchFromVariantConfig({ variant, championConfig: manifestConfig });
      if (patchEvidence && configPatch && !patchesEqual(patchEvidence, configPatch)) {
        violations.push({
          code: 'global_patch_config_mismatch',
          file,
          variantId: variant?.variantId ?? null,
        });
      }
      const fingerprint = reconstructGlobalPatchFingerprint({
        variant,
        championConfigFingerprint,
        championConfig: manifestConfig,
      });
      const storedFingerprints = variantStoredFingerprints(variant);

      if (!fingerprint) {
        if (storedFingerprints.length > 0) {
          violations.push({ code: 'global_patch_stored_only_fingerprint', file, variantId: variant?.variantId ?? null });
        }
        continue;
      }

      const mismatchedStored = storedFingerprints.filter((stored) => stored !== fingerprint);
      if (mismatchedStored.length > 0) {
        violations.push({
          code: 'global_patch_stored_fingerprint_mismatch',
          file,
          variantId: variant?.variantId ?? null,
          expected: fingerprint,
          stored: mismatchedStored,
        });
      }

      const key = `${championConfigFingerprint}:${fingerprint}`;
      if (seen.has(key)) {
        violations.push({
          code: 'duplicate_global_patch_fingerprint',
          first: seen.get(key),
          second: file,
          championConfigFingerprint,
          patchFingerprint: fingerprint,
        });
      } else {
        seen.set(key, file);
      }
    }
  }

  if (requireEvidence && globalManifestCount > 0 && evaluatedManifestCount === 0) {
    violations.push({
      code: 'global_patch_novelty_evidence_missing',
      globalManifestCount,
      evaluatedManifestCount,
    });
  }

  return violations;
}

function latestHistoryEventForRun(historyPath, runId) {
  if (!fs.existsSync(historyPath)) return null;
  return fs.readFileSync(historyPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .findLast((event) => event?.runId === runId) ?? null;
}

function fileContains(filePath, text) {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes(text);
}

function validateProductionArtifactInvariants({ researchRoot, digestRoot, requireRoot = true } = {}) {
  const violations = [];

  if (!researchRoot || !fs.existsSync(researchRoot)) {
    if (requireRoot) violations.push({ code: 'artifact_root_missing', researchRoot });
    return { ok: violations.length === 0, violations };
  }
  if (!digestRoot || !fs.existsSync(digestRoot)) {
    violations.push({ code: 'digest_root_missing', digestRoot });
  }

  const latestPointer = validateLatestManifestPointer({ root: researchRoot });
  if (!latestPointer.ok) {
    violations.push({ code: 'latest_pointer_invalid', reason: latestPointer.reason, latestPointer });
  }

  const orphanRuns = findOrphanEvaluationRuns({ root: researchRoot });
  if (!orphanRuns.ok) {
    violations.push({ code: 'orphan_evaluation_runs', orphans: orphanRuns.orphans });
  }

  const manifestDir = path.join(researchRoot, 'manifests');
  const manifests = readManifestFiles(manifestDir);
  if (!fs.existsSync(manifestDir)) violations.push({ code: 'manifest_dir_missing', manifestDir });
  if (manifests.length === 0) violations.push({ code: 'manifest_dir_empty', manifestDir });
  violations.push(...validateGlobalAllParameterNovelty(manifests, { requireEvidence: requireRoot }));

  if (latestPointer.ok) {
    const runId = latestPointer.runId;
    const historyJsonlPath = path.join(researchRoot, 'history.jsonl');
    const historyMarkdownPath = digestRoot ? path.join(digestRoot, 'history.md') : null;
    const latestDigestPath = digestRoot ? path.join(digestRoot, 'latest-digest.md') : null;
    const runDigestPath = digestRoot ? path.join(digestRoot, `${runId}.md`) : null;

    const latestHistoryEvent = latestHistoryEventForRun(historyJsonlPath, runId);
    if (!latestHistoryEvent) {
      violations.push({ code: 'latest_run_missing_from_history', runId, historyJsonlPath });
    }
    if (!runDigestPath || !fs.existsSync(runDigestPath)) {
      violations.push({ code: 'run_digest_missing', runId, runDigestPath });
    }
    if (!latestDigestPath || !fileContains(latestDigestPath, runId)) {
      violations.push({ code: 'latest_digest_stale_or_missing', runId, latestDigestPath });
    }
    if (!historyMarkdownPath || !fs.existsSync(historyMarkdownPath)) {
      violations.push({ code: 'history_markdown_missing', historyMarkdownPath });
    } else {
      const renderedHistoryNeedle = latestHistoryEvent?.timestamp ?? latestHistoryEvent?.summary ?? latestHistoryEvent?.note ?? null;
      if (renderedHistoryNeedle && !fileContains(historyMarkdownPath, renderedHistoryNeedle)) {
        violations.push({ code: 'history_markdown_missing_latest_event', runId, renderedHistoryNeedle, historyMarkdownPath });
      }
      if (fs.existsSync(historyJsonlPath)) {
        const historyJsonlMtime = fs.statSync(historyJsonlPath).mtimeMs;
        const historyMarkdownMtime = fs.statSync(historyMarkdownPath).mtimeMs;
        if (historyMarkdownMtime + 1 < historyJsonlMtime) {
          violations.push({ code: 'history_markdown_stale', historyMarkdownPath, historyJsonlPath });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\r\n`, 'utf8');
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function writeManifestFixture({
  researchRoot,
  digestRoot,
  manifest,
  historyRunId = manifest.runId,
  historyTimestamp = '2026-05-09T00:00:00.000Z',
  latest = null,
}) {
  writeJson(path.join(researchRoot, 'manifests', `${manifest.runId}.json`), manifest);
  writeJson(path.join(researchRoot, 'latest.json'), latest ?? {
    ...manifest,
    manifestPath: path.join(researchRoot, 'manifests', `${manifest.runId}.json`),
  });
  writeText(path.join(researchRoot, 'history.jsonl'), `${JSON.stringify({
    timestamp: historyTimestamp,
    type: 'cycle',
    runId: historyRunId,
  })}\r\n`);
  writeText(path.join(digestRoot, `${manifest.runId}.md`), `# ${manifest.runId}\r\n`);
  writeText(path.join(digestRoot, 'history.md'), `# History\r\n${historyTimestamp}\r\n`);
  writeText(path.join(digestRoot, 'latest-digest.md'), `# Latest\r\n${manifest.runId}\r\n`);
}

function setFileTime(filePath, isoString) {
  const time = new Date(isoString);
  fs.utimesSync(filePath, time, time);
}

test('production artifact invariant rejects missing expected artifact root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-prod-invariant-missing-'));
  const result = validateProductionArtifactInvariants({
    researchRoot: path.join(dir, 'missing-research'),
    digestRoot: path.join(dir, 'missing-digest'),
    requireRoot: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.violations[0].code, 'artifact_root_missing');
});

test('production artifact invariant accepts a complete fixture root', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-prod-invariant-pass-'));
  const researchRoot = path.join(dir, 'research');
  const digestRoot = path.join(dir, 'digest');
  const manifest = {
    runId: 'run-good',
    generatedAt: '2026-05-09T00:00:00.000Z',
    champion: { configId: 'champ-good', config: { alpha: 1, beta: true } },
    globalNoveltyGuardVersion: 1,
    searchPlan: {
      variants: [{
        variantId: 'v-entry',
        lane: 'globalAllParameter',
        mutationFamily: 'entry',
        patch: { alpha: 2 },
        patchFingerprintVersion: 2,
        patchFingerprint: buildGlobalPatchFingerprint({
          championConfigFingerprint: buildChampionConfigFingerprint({ alpha: 1, beta: true }),
          lane: 'globalAllParameter',
          mutationFamily: 'entry',
          patch: { alpha: 2 },
        }),
      }],
    },
  };
  writeManifestFixture({ researchRoot, digestRoot, manifest });

  const result = validateProductionArtifactInvariants({ researchRoot, digestRoot, requireRoot: true });
  assert.equal(result.ok, true, invariantMessage(result));
});

test('production artifact invariant catches stale latest pointer, history, and digest fixtures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pine-prod-invariant-stale-'));
  const researchRoot = path.join(dir, 'research');
  const digestRoot = path.join(dir, 'digest');
  const manifest = {
    runId: 'run-new',
    champion: { configId: 'champ-new', config: { alpha: 1 } },
    globalNoveltyGuardVersion: 1,
    searchPlan: { variants: [] },
  };
  writeManifestFixture({
    researchRoot,
    digestRoot,
    manifest,
    historyRunId: 'run-old',
    latest: {
      ...manifest,
      manifestPath: path.join(researchRoot, 'manifests', 'run-old.json'),
    },
  });

  const stalePointerResult = validateProductionArtifactInvariants({ researchRoot, digestRoot, requireRoot: true });
  assert.equal(stalePointerResult.ok, false);
  assert.ok(
    stalePointerResult.violations.map((violation) => violation.code).includes('latest_pointer_invalid'),
    invariantMessage(stalePointerResult),
  );

  writeJson(path.join(researchRoot, 'latest.json'), {
    ...manifest,
    manifestPath: path.join(researchRoot, 'manifests', 'run-new.json'),
  });
  fs.rmSync(path.join(digestRoot, 'run-new.md'));
  writeText(path.join(researchRoot, 'history.jsonl'), `${JSON.stringify({
    timestamp: '2026-05-09T02:00:00.000Z',
    type: 'cycle',
    runId: 'run-new',
  })}\r\n`);
  writeText(path.join(digestRoot, 'latest-digest.md'), '# Latest\r\nrun-old\r\n');
  setFileTime(path.join(researchRoot, 'history.jsonl'), '2026-05-09T02:00:00.000Z');
  setFileTime(path.join(digestRoot, 'history.md'), '2026-05-09T01:00:00.000Z');

  const result = validateProductionArtifactInvariants({ researchRoot, digestRoot, requireRoot: true });
  const codes = result.violations.map((violation) => violation.code);

  assert.equal(result.ok, false);
  assert.ok(codes.includes('run_digest_missing'), invariantMessage(result));
  assert.ok(codes.includes('latest_digest_stale_or_missing'), invariantMessage(result));
  assert.ok(codes.includes('history_markdown_stale'), invariantMessage(result));

  writeText(path.join(digestRoot, 'history.md'), '# History\r\n2026-05-09T01:00:00.000Z\r\n');
  setFileTime(path.join(digestRoot, 'history.md'), '2026-05-09T03:00:00.000Z');
  const touchedStaleHistoryResult = validateProductionArtifactInvariants({ researchRoot, digestRoot, requireRoot: true });
  assert.ok(
    touchedStaleHistoryResult.violations.map((violation) => violation.code).includes('history_markdown_missing_latest_event'),
    invariantMessage(touchedStaleHistoryResult),
  );
});

test('production artifact invariant catches duplicate collapse by champion config fingerprint and stored-only poison', () => {
  const championConfig = { alpha: 1, beta: true };
  const championConfigFingerprint = buildChampionConfigFingerprint(championConfig);
  const patch = { alpha: 2 };
  const expectedFingerprint = buildGlobalPatchFingerprint({
    championConfigFingerprint,
    lane: 'globalAllParameter',
    mutationFamily: 'entry',
    patch,
  });
  const manifests = [
    {
      file: 'run-a.json',
      manifest: {
        runId: 'run-a',
        champion: { configId: 'champ-id-a', config: championConfig },
        globalNoveltyGuardVersion: 1,
        searchPlan: {
          variants: [{
            variantId: 'v-a',
            lane: 'globalAllParameter',
            mutationFamily: 'entry',
            patch,
            patchFingerprintVersion: 2,
            patchFingerprint: expectedFingerprint,
          }],
        },
      },
    },
    {
      file: 'run-b.json',
      manifest: {
        runId: 'run-b',
        champion: { configId: 'champ-id-b', config: championConfig },
        globalNoveltyGuardVersion: 1,
        searchPlan: {
          variants: [{
            variantId: 'v-b',
            lane: 'globalAllParameter',
            mutationFamily: 'entry',
            patch,
            patchFingerprintVersion: 2,
            patchFingerprint: 'poisoned-stored-fingerprint',
          }],
        },
      },
    },
    {
      file: 'run-c.json',
      manifest: {
        runId: 'run-c',
        championConfigFingerprint,
        searchPlan: {
          variants: [{
            variantId: 'v-c',
            lane: 'globalAllParameter',
            mutationFamily: 'risk',
            patchFingerprintVersion: 2,
            patchFingerprint: 'stored-only-without-reconstructable-patch',
          }],
        },
      },
    },
    {
      file: 'run-d.json',
      manifest: {
        runId: 'run-d',
        champion: { configId: 'champ-id-d', config: championConfig },
        globalNoveltyGuardVersion: 1,
        searchPlan: {
          variants: [{
            variantId: 'v-d',
            lane: 'globalAllParameter',
            mutationFamily: 'entry',
            patch: { alpha: 99 },
            config: { alpha: 2, beta: true },
            patchFingerprintVersion: 2,
            patchFingerprint: 'patch-config-disagreement-poison',
          }],
        },
      },
    },
  ];

  const violations = validateGlobalAllParameterNovelty(manifests);
  const codes = violations.map((violation) => violation.code);

  assert.ok(codes.includes('duplicate_global_patch_fingerprint'), JSON.stringify(violations, null, 2));
  assert.ok(codes.includes('global_patch_stored_fingerprint_mismatch'), JSON.stringify(violations, null, 2));
  assert.ok(codes.includes('global_patch_stored_only_fingerprint'), JSON.stringify(violations, null, 2));
  assert.ok(codes.includes('global_patch_config_mismatch'), JSON.stringify(violations, null, 2));
  assert.equal(
    violations.find((violation) => violation.code === 'duplicate_global_patch_fingerprint')?.championConfigFingerprint,
    championConfigFingerprint,
  );
});

test('configured production artifact invariants pass when production mode is required', (t) => {
  if (productionInvariantMode() !== 'required') {
    t.skip('Production artifact root not configured; fixture-mode invariants above remain active. Set PINE_AUTORESEARCH_PRODUCTION_INVARIANTS=required or PINE_AUTORESEARCH_PRODUCTION_ROOT to check real artifacts.');
    return;
  }

  const roots = configuredProductionRoots();
  const result = validateProductionArtifactInvariants({ ...roots, requireRoot: true });
  assert.equal(result.ok, true, invariantMessage(result));
});
