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

  const result = await runLlmAutoresearch({
    configPath,
    repoRoot,
    command: command === 'enqueue' ? 'propose' : command,
    scheduled,
  });

  if (result.ok) {
    console.log(`[llm-autoresearch] ${result.reason}`);
    if (result.manifestPath) {
      console.log(`[llm-autoresearch] manifest=${result.manifestPath}`);
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
