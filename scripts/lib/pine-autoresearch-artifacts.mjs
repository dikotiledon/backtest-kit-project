import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonAtomic(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function beginAutoresearchRunArtifact({ root, runId, profile, now = new Date() }) {
  const startedPath = path.join(root, 'runs', `${runId}.started.json`);
  await writeJsonAtomic(startedPath, {
    runId,
    profile: profile || null,
    pid: process.pid,
    startedAt: now.toISOString(),
  });
  return { startedPath };
}

export function isSafeAutoresearchRunId(runId) {
  return typeof runId === 'string'
    && runId.length > 0
    && path.basename(runId) === runId
    && !runId.includes('/')
    && !runId.includes('\\')
    && !runId.includes('..');
}

export function autoresearchManifestPath({ root, runId }) {
  if (!isSafeAutoresearchRunId(runId)) throw new Error('runId is invalid');
  return path.join(root, 'manifests', `${runId}.json`);
}

export async function finalizeAutoresearchManifest({ root, manifest }) {
  if (!manifest?.runId) throw new Error('manifest.runId is required');
  const manifestPath = autoresearchManifestPath({ root, runId: manifest.runId });
  const latestPath = path.join(root, 'latest.json');
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(latestPath, { ...manifest, manifestPath });
  return { manifestPath, latestPath };
}

export async function markAutoresearchRunIncomplete({ root, runId, reason, error, now = new Date() }) {
  const incompletePath = path.join(root, 'incomplete', `${runId}.json`);
  await writeJsonAtomic(incompletePath, {
    runId,
    reason: reason || 'unknown',
    error: error ? String(error) : null,
    pid: process.pid,
    endedAt: now.toISOString(),
  });
  return { incompletePath };
}

export async function markAutoresearchRunIncompleteUnlessManifestExists({ root, runId, reason, error, now = new Date() }) {
  const manifestPath = autoresearchManifestPath({ root, runId });
  if (fsSync.existsSync(manifestPath)) {
    return { skipped: true, skipReason: 'manifest_exists', manifestPath, incompletePath: null };
  }

  try {
    const markerErrorText = error?.stack || error?.message || (error ? String(error) : null);
    const marker = await markAutoresearchRunIncomplete({ root, runId, reason, error: markerErrorText, now });
    return { skipped: false, manifestPath, ...marker };
  } catch (markerError) {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      try {
        Object.defineProperty(error, 'autoresearchIncompleteMarkerError', {
          value: markerError,
          enumerable: false,
          configurable: true,
        });
      } catch {
        // Preserve the original failure even if secondary attachment is blocked.
      }
    }
    return {
      skipped: true,
      skipReason: 'marker_failed',
      manifestPath,
      incompletePath: null,
      markerError,
    };
  }
}

export function validateLatestManifestPointer({ root }) {
  const latestPath = path.join(root, 'latest.json');
  if (!fsSync.existsSync(latestPath)) return { ok: false, reason: 'latest_missing', latestPath };
  let latest;
  try {
    latest = JSON.parse(fsSync.readFileSync(latestPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'latest_invalid_json', latestPath, error: String(error?.message || error) };
  }
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)) {
    return { ok: false, reason: 'latest_invalid_shape', latestPath };
  }
  const runId = latest?.runId;
  if (!runId || typeof runId !== 'string') return { ok: false, reason: 'latest_run_id_missing', latestPath };
  if (!isSafeAutoresearchRunId(runId)) return { ok: false, reason: 'latest_run_id_unsafe', latestPath, runId };
  const manifestPath = autoresearchManifestPath({ root, runId });
  if (!fsSync.existsSync(manifestPath)) return { ok: false, reason: 'latest_manifest_missing', latestPath, runId, manifestPath };
  let manifest;
  try {
    manifest = JSON.parse(fsSync.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'latest_manifest_invalid_json', latestPath, runId, manifestPath, error: String(error?.message || error) };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, reason: 'latest_manifest_invalid_shape', latestPath, runId, manifestPath };
  }
  if (manifest.runId !== runId) {
    return { ok: false, reason: 'latest_manifest_run_id_mismatch', latestPath, runId, manifestRunId: manifest.runId, manifestPath };
  }
  if (latest.manifestPath && path.resolve(String(latest.manifestPath)) !== path.resolve(manifestPath)) {
    return { ok: false, reason: 'latest_manifest_path_stale', latestPath, runId, manifestPath, pointerManifestPath: latest.manifestPath };
  }
  return { ok: true, runId, latestPath, manifestPath, latest, manifest: { ...manifest, manifestPath } };
}

export function findOrphanEvaluationRuns({ root }) {
  const evalRoot = path.join(root, 'evaluations');
  if (!fsSync.existsSync(evalRoot)) return { ok: true, orphans: [] };
  const orphans = fsSync.readdirSync(evalRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((runId) => {
      const manifestPath = path.join(root, 'manifests', `${runId}.json`);
      const incompletePath = path.join(root, 'incomplete', `${runId}.json`);
      return !fsSync.existsSync(manifestPath) && !fsSync.existsSync(incompletePath);
    })
    .sort()
    .map((runId) => ({ runId, evaluationDir: path.join(evalRoot, runId) }));

  return { ok: orphans.length === 0, orphans };
}

export async function repairOrphanEvaluationRuns({ root, dryRun = true, reason = 'historical_orphan' }) {
  const scan = findOrphanEvaluationRuns({ root });
  const repaired = [];
  if (!dryRun) {
    for (const orphan of scan.orphans) {
      await markAutoresearchRunIncomplete({ root, runId: orphan.runId, reason });
      repaired.push(orphan.runId);
    }
  }
  return { orphans: scan.orphans, repaired };
}
