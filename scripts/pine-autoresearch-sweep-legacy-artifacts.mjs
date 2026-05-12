import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VARIANT_SUFFIX = '-variants.json';
const SAFE_BASE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*-variants\.json$/;
const SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSafeBaseVariantName(name) {
  return typeof name === 'string'
    && name.endsWith(VARIANT_SUFFIX)
    && !name.includes('/')
    && !name.includes('\\')
    && SAFE_BASE_NAME_RE.test(name);
}

function isSafeRunId(runId) {
  return typeof runId === 'string'
    && !runId.includes('/')
    && !runId.includes('\\')
    && SAFE_RUN_ID_RE.test(runId);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function runIdFromVariantName(name) {
  return name.slice(0, -VARIANT_SUFFIX.length);
}

function sanitizeKeep(value) {
  const parsed = Number.parseInt(String(value ?? '3'), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, parsed);
}

function parseArgs(argv) {
  const out = { keep: 3, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const root = argv[++i];
      if (!root) throw new Error('--root requires a value');
      if (root.startsWith('--')) throw new Error('--root value must not start with --');
      out.root = root;
    } else if (arg === '--keep') {
      const keep = argv[++i];
      if (!keep) throw new Error('--keep requires a value');
      if (keep.startsWith('--')) throw new Error('--keep value must not start with --');
      out.keep = sanitizeKeep(keep);
    } else if (arg === '--apply') {
      const apply = argv[++i];
      if (!apply) throw new Error('--apply requires true or false');
      if (apply.startsWith('--')) throw new Error('--apply requires true or false');
      if (apply !== 'true' && apply !== 'false') throw new Error('--apply must be true or false');
      out.apply = apply === 'true';
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!out.root) throw new Error('--root requires a value');
  return out;
}

export function planLegacyVariantSweep({ files = [], retainRunIds = [] } = {}) {
  const variants = uniqueSorted(files.filter(isSafeBaseVariantName));
  const retainNames = new Set(
    retainRunIds
      .filter(isSafeRunId)
      .map((runId) => `${runId}${VARIANT_SUFFIX}`),
  );

  return {
    keep: variants.filter((name) => retainNames.has(name)),
    delete: variants.filter((name) => !retainNames.has(name)),
  };
}

async function listSafeVariantNames(researchRoot, { allowMissing = false } = {}) {
  let entries;
  try {
    entries = await fs.readdir(researchRoot, { withFileTypes: true });
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return { files: [], rootExists: false };
    throw error;
  }
  return {
    files: entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter(isSafeBaseVariantName),
    rootExists: true,
  };
}

function selectRetainedRunIds(files, keepCount) {
  return uniqueSorted(files)
    .slice()
    .sort((a, b) => b.localeCompare(a))
    .slice(0, sanitizeKeep(keepCount))
    .map(runIdFromVariantName);
}

async function runSweep({ root, keep, apply }) {
  const researchRoot = path.resolve(root);
  const { files, rootExists } = await listSafeVariantNames(researchRoot, { allowMissing: !apply });
  const retainRunIds = selectRetainedRunIds(files, keep);
  const plan = planLegacyVariantSweep({ files, retainRunIds });
  const deleted = [];

  if (apply) {
    for (const name of plan.delete) {
      await fs.unlink(path.join(researchRoot, name));
      deleted.push(name);
    }
  }

  return {
    researchRoot,
    rootExists,
    keep: sanitizeKeep(keep),
    dryRun: !apply,
    keepCount: plan.keep.length,
    deleteCount: plan.delete.length,
    deleteSample: plan.delete.slice(0, 10),
    ...(apply ? { deleted } : {}),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await runSweep({ root: args.root, keep: args.keep, apply: args.apply });
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
