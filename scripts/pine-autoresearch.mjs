import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { applyPatchPlan, buildPatchPlan } from './lib/pine-tuner.mjs';
import {
  decideAutoresearchOutcome,
  readJson,
  renderDigestMarkdown,
  renderScoutMarkdown,
  summarizeDigestAnnouncement,
  summarizeResult,
  timestampId,
  writeJson,
  writeText,
} from './lib/pine-autoresearch.mjs';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i++;
  }
  return out;
}

function resolveMaybeRelative(baseDir, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

async function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { cwd, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(`node ${args.join(' ')} failed with code ${code}`));
      }
    });
  });
}

async function loadConfig(cwd, configPath, overrides = {}) {
  const resolvedConfigPath = resolveMaybeRelative(cwd, configPath || './config/pine-autoresearch.default.json');
  const raw = await readJson(resolvedConfigPath);
  const baseDir = path.dirname(resolvedConfigPath);

  return {
    ...raw,
    configPath: resolvedConfigPath,
    baseDir,
    projectRoot: cwd,
    scriptPath: resolveMaybeRelative(baseDir, raw.scriptPath),
    incumbentPath: resolveMaybeRelative(baseDir, raw.incumbent?.path),
    researchRoot: resolveMaybeRelative(baseDir, raw.outputs?.researchRoot),
    digestRoot: resolveMaybeRelative(baseDir, raw.outputs?.digestRoot),
    symbol: String(overrides.symbol || raw.symbol),
    timeframe: String(overrides.timeframe || raw.timeframe),
    limit: Number(overrides.limit || raw.limit),
    when: overrides.when || raw.when || null,
    exchange: overrides.exchange || raw.exchange || null,
    grid: String(overrides.grid || raw.grid),
    maxConfigs: overrides.maxConfigs ? Number(overrides.maxConfigs) : (raw.maxConfigs ?? null),
    minTrades: overrides.minTrades ? Number(overrides.minTrades) : (raw.minTrades ?? 10),
  };
}

async function ensureDirs(config) {
  await fs.mkdir(config.researchRoot, { recursive: true });
  await fs.mkdir(config.digestRoot, { recursive: true });
}

function buildRunId(config) {
  return `${config.labId}-${timestampId()}`;
}

function manifestsDir(config) {
  return path.join(config.researchRoot, 'manifests');
}

function latestManifestPath(config) {
  return path.join(config.researchRoot, 'latest.json');
}

async function listManifestFiles(config) {
  const dir = manifestsDir(config);
  try {
    const names = await fs.readdir(dir);
    return names
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

async function readLatestManifest(config) {
  try {
    return await readJson(latestManifestPath(config));
  } catch {
    return null;
  }
}

async function readPreviousManifest(config, latestFileName) {
  const files = await listManifestFiles(config);
  const filtered = latestFileName ? files.filter((name) => name !== latestFileName) : files;
  if (!filtered.length) return null;
  return readJson(path.join(manifestsDir(config), filtered.at(-1)));
}

async function runScout(config) {
  await ensureDirs(config);

  const runId = buildRunId(config);
  const sweepArgs = [
    path.resolve(config.projectRoot, 'scripts', 'pine-sweep.mjs'),
    '--input', config.scriptPath,
    '--symbol', config.symbol,
    '--timeframe', config.timeframe,
    '--limit', String(config.limit),
    '--grid', config.grid,
    '--run-id', runId,
    '--min-trades', String(config.minTrades),
  ];

  if (config.maxConfigs != null) {
    sweepArgs.push('--max-configs', String(config.maxConfigs));
  }
  if (config.when) {
    sweepArgs.push('--when', config.when);
  }
  if (config.exchange) {
    sweepArgs.push('--exchange', config.exchange);
  }

  await runNode(sweepArgs, config.projectRoot);

  const runDir = path.resolve(config.projectRoot, 'pine', 'sweeps', runId);
  const leaderboard = await readJson(path.join(runDir, 'leaderboard.json'));
  const incumbentRaw = await readJson(config.incumbentPath);
  const incumbent = incumbentRaw.status ? incumbentRaw : incumbentRaw.ranked?.[0];
  const challenger = leaderboard.ranked?.[0] || null;
  const decision = decideAutoresearchOutcome({ incumbent, challenger, thresholds: config.thresholds });

  const manifest = {
    generatedAt: new Date().toISOString(),
    labId: config.labId,
    runId,
    runDir,
    symbol: config.symbol,
    timeframe: config.timeframe,
    limit: config.limit,
    when: config.when,
    gridName: config.grid,
    incumbent: summarizeResult(incumbent),
    challenger: summarizeResult(challenger),
    decision,
    topConfigs: (leaderboard.ranked || []).slice(0, 5).map((item) => summarizeResult(item)),
  };

  const manifestName = `${runId}.json`;
  const manifestPath = path.join(manifestsDir(config), manifestName);
  const scoutPath = path.join(config.digestRoot, `${runId}.md`);

  await writeJson(manifestPath, manifest);
  await writeJson(latestManifestPath(config), { ...manifest, manifestPath });
  await writeText(scoutPath, renderScoutMarkdown({ config, manifest }));

  return { manifest, manifestPath, scoutPath };
}

async function runDigest(config) {
  await ensureDirs(config);
  const latest = await readLatestManifest(config);
  if (!latest) {
    throw new Error(`No latest manifest found at ${latestManifestPath(config)}`);
  }

  const latestName = path.basename(latest.manifestPath || '');
  const previous = await readPreviousManifest(config, latestName);
  const digestId = `digest-${timestampId()}`;
  const digestPath = path.join(config.digestRoot, `${digestId}.md`);
  const digestText = renderDigestMarkdown({ config, latestManifest: latest, previousManifest: previous });
  await writeText(digestPath, digestText);

  return {
    digestId,
    digestPath,
    summary: summarizeDigestAnnouncement({ latestManifest: latest, previousManifest: previous }),
    latest,
    previous,
  };
}

async function runPromote(config, args) {
  const latest = await readLatestManifest(config);
  if (!latest) {
    throw new Error('No latest manifest to promote');
  }
  if (latest.decision?.recommendation !== 'promote' && !args.force) {
    throw new Error(`Latest manifest recommendation is ${latest.decision?.recommendation || 'unknown'}, not promote. Use --force to override.`);
  }

  const source = await fs.readFile(config.scriptPath, 'utf8');
  const patched = applyPatchPlan(source, buildPatchPlan(latest.challenger.config || {}));
  await fs.writeFile(config.scriptPath, patched, 'utf8');

  const notePath = path.join(config.digestRoot, `promote-${timestampId()}.md`);
  await writeText(notePath, `# Pine Autoresearch Promote\n\n- Source: \`${latest.manifestPath || latestManifestPath(config)}\`\n- Applied config: \`${latest.challenger.configId}\`\n- Decision: ${latest.decision?.summary || 'manual force'}\n`);

  return { notePath, appliedConfigId: latest.challenger.configId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'cycle';
  const cwd = process.cwd();
  const config = await loadConfig(cwd, args.config, {
    symbol: args.symbol,
    timeframe: args.timeframe,
    limit: args.limit,
    when: args.when,
    exchange: args.exchange,
    grid: args.grid,
    maxConfigs: args['max-configs'],
    minTrades: args['min-trades'],
  });

  if (command === 'cycle' || command === 'scout') {
    const result = await runScout(config);
    console.log(`\n[autoresearch] manifest=${result.manifestPath}`);
    console.log(`[autoresearch] scout=${result.scoutPath}`);
    console.log(`[autoresearch] recommendation=${result.manifest.decision.recommendation}`);
    return;
  }

  if (command === 'digest') {
    const result = await runDigest(config);
    console.log(result.summary);
    console.log(`[autoresearch] digest=${result.digestPath}`);
    return;
  }

  if (command === 'promote') {
    const result = await runPromote(config, args);
    console.log(`[autoresearch] promoted=${result.appliedConfigId}`);
    console.log(`[autoresearch] note=${result.notePath}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
