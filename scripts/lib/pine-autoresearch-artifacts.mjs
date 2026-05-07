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

export async function finalizeAutoresearchManifest({ root, manifest }) {
  if (!manifest?.runId) throw new Error('manifest.runId is required');
  const manifestPath = path.join(root, 'manifests', `${manifest.runId}.json`);
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

export function validateLatestManifestPointer({ root }) {
  const latestPath = path.join(root, 'latest.json');
  if (!fsSync.existsSync(latestPath)) return { ok: false, reason: 'latest_missing' };
  let latest;
  try {
    latest = JSON.parse(fsSync.readFileSync(latestPath, 'utf8'));
  } catch (error) {
    return { ok: false, reason: 'latest_invalid_json', error: String(error?.message || error) };
  }
  const runId = latest?.runId;
  if (!runId) return { ok: false, reason: 'latest_run_id_missing' };
  const manifestPath = path.join(root, 'manifests', `${runId}.json`);
  if (!fsSync.existsSync(manifestPath)) return { ok: false, reason: 'latest_manifest_missing', runId, manifestPath };
  return { ok: true, runId, manifestPath };
}
