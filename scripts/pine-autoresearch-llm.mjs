import path from 'node:path';

import { runLlmAutoresearch } from './lib/pine-autoresearch-llm-runner.mjs';

function parseArgs(argv) {
  const out = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    index += 1;
  }

  return out;
}

function resolveRepoRoot(value) {
  if (!value) {
    return process.cwd();
  }

  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function normalizeScheduled(value) {
  return value === true || value === 'true' || value === '1';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'run';
  const repoRoot = resolveRepoRoot(args['repo-root']);
  const configPath = args.config || './config/pine-autoresearch-llm.default.json';
  const scheduled = normalizeScheduled(args.scheduled);

  if (!['run', 'propose', 'digest', 'validate', 'enqueue', 'review-status', 'review-resolve'].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const reviewResolve = command === 'review-resolve'
    ? {
      itemId: args.itemId || args['item-id'],
      status: args.status,
      reason: args.reason,
    }
    : null;

  const result = await runLlmAutoresearch({
    configPath,
    repoRoot,
    command: command === 'enqueue' ? 'propose' : command,
    scheduled,
    configOverrides: reviewResolve ? { reviewResolve } : null,
  });

  if (result.ok) {
    if (command === 'digest') {
      console.log(JSON.stringify(result.digest ?? {}));
      return;
    }

    console.log(`[llm-autoresearch] ${result.reason}`);
    if (command === 'review-status') {
      const items = result.reviewSummary?.unresolvedItems ?? [];
      console.log(JSON.stringify({ unresolvedCount: result.reviewSummary?.unresolvedCount ?? 0, items }, null, 2));
    }
    if (command === 'review-resolve' && result.itemId) {
      console.log(`[llm-autoresearch] item=${result.itemId}`);
      console.log(`[llm-autoresearch] reviewStatus=${result.reviewStatus}`);
    }
    if (result.manifestPath) {
      console.log(`[llm-autoresearch] manifest=${result.manifestPath}`);
    }
    if (result.evaluationManifestPath) {
      console.log(`[llm-autoresearch] evaluationManifest=${result.evaluationManifestPath}`);
    }
    if (result.status?.reason && result.status.reason !== result.reason) {
      console.log(`[llm-autoresearch] status=${result.status.reason}`);
    }
    return;
  }

  console.error(`[llm-autoresearch] ${result.reason}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

function pathToFileURL(filePath) {
  return new URL(`file://${path.resolve(filePath).replace(/\\/g, '/')}`);
}
