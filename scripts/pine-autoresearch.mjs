import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { analyzeJsonlFile } from './lib/pine-optimizer.mjs';
import { applyPatchPlan, buildPatchPlan } from './lib/pine-tuner.mjs';
import {
  appendJsonl,
  configFingerprint,
  decideAutoPromotionAction,
  decideAutoresearchOutcome,
  decideMatrixPromotion,
  isoNow,
  readJson,
  readJsonl,
  renderDigestMarkdown,
  renderHistoryMarkdown,
  renderScoutMarkdown,
  sameConfig,
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

function slug(value) {
  return String(value || 'x').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function manifestsDir(config) {
  return path.join(config.researchRoot, 'manifests');
}

function latestManifestPath(config) {
  return path.join(config.researchRoot, 'latest.json');
}

function championPath(config) {
  return path.join(config.researchRoot, 'champion.json');
}

function historyPath(config) {
  return path.join(config.researchRoot, 'history.jsonl');
}

function historyMarkdownPath(config) {
  return path.join(config.digestRoot, 'history.md');
}

function evaluationsRoot(config) {
  return path.join(config.researchRoot, 'evaluations');
}

function getThresholds(raw = {}) {
  return {
    minScoreDelta: raw.minScoreDelta ?? 0.25,
    minRoiDeltaPct: raw.minRoiDeltaPct ?? 0,
    minProfitFactorDelta: raw.minProfitFactorDelta ?? 0,
    maxDrawdownDeltaPct: raw.maxDrawdownDeltaPct ?? 0.75,
    minTradeCount: raw.minTradeCount ?? 100,
    minTradeRatioVsIncumbent: raw.minTradeRatioVsIncumbent ?? 0.75,
  };
}

function normalizeLab(rawLab, defaults, index, role) {
  const baseId = rawLab.labId || `${role}-${index + 1}`;
  return {
    labId: slug(baseId),
    symbol: String(rawLab.symbol),
    timeframe: String(rawLab.timeframe),
    limit: Number(rawLab.limit),
    when: rawLab.when || null,
    exchange: rawLab.exchange || null,
    thresholds: getThresholds({ ...defaults, ...(rawLab.thresholds || {}) }),
  };
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
  const defaultThresholds = getThresholds(raw.thresholds || {});

  const legacyPrimary = {
    labId: raw.labId || raw.matrixId || 'primary',
    symbol: overrides.symbol || raw.symbol,
    timeframe: overrides.timeframe || raw.timeframe,
    limit: Number(overrides.limit || raw.limit),
    when: overrides.when || raw.when || null,
    exchange: overrides.exchange || raw.exchange || null,
    thresholds: raw.thresholds || {},
  };

  const primarySource = raw.primaryLab || legacyPrimary;
  const shadowSources = raw.shadowLabs || [];
  const matrixId = raw.matrixId || raw.labId || 'pine-autoresearch';

  const config = {
    ...raw,
    configPath: resolvedConfigPath,
    baseDir,
    projectRoot: cwd,
    matrixId,
    scriptPath: resolveMaybeRelative(baseDir, raw.scriptPath),
    researchRoot: resolveMaybeRelative(baseDir, raw.outputs?.researchRoot),
    digestRoot: resolveMaybeRelative(baseDir, raw.outputs?.digestRoot),
    grid: String(overrides.grid || raw.grid),
    maxConfigs: overrides.maxConfigs ? Number(overrides.maxConfigs) : (raw.maxConfigs ?? null),
    minTrades: overrides.minTrades ? Number(overrides.minTrades) : (raw.minTrades ?? 10),
    seedChampionPath: resolveMaybeRelative(baseDir, raw.seedChampion?.path || raw.incumbent?.path),
    primaryLab: normalizeLab(primarySource, defaultThresholds, 0, 'primary'),
    shadowLabs: shadowSources.map((lab, index) => normalizeLab(lab, defaultThresholds, index, 'shadow')),
    matrixPolicy: {
      requirePrimaryPromote: true,
      minShadowPassCount: 0,
      minShadowPassRatio: 0,
      requireCandidateChange: true,
      ...(raw.matrixPolicy || {}),
    },
    autoPromotion: {
      enabled: false,
      cooldownHours: 24,
      maxPromotionsPerDay: 1,
      requireMatrixPromotion: true,
      ...(raw.autoPromotion || {}),
    },
  };

  return config;
}

async function ensureDirs(config) {
  await fs.mkdir(config.researchRoot, { recursive: true });
  await fs.mkdir(config.digestRoot, { recursive: true });
  await fs.mkdir(manifestsDir(config), { recursive: true });
  await fs.mkdir(evaluationsRoot(config), { recursive: true });
}

function buildRunId(config) {
  return `${slug(config.matrixId)}-${timestampId()}`;
}

async function listManifestFiles(config) {
  try {
    const names = await fs.readdir(manifestsDir(config));
    return names.filter((name) => name.endsWith('.json')).sort();
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

async function loadHistoryEvents(config) {
  return readJsonl(historyPath(config));
}

async function rebuildHistoryArtifacts(config, championState) {
  const events = await loadHistoryEvents(config);
  await writeText(historyMarkdownPath(config), renderHistoryMarkdown({ config, championState, historyEvents: events }));
  return events;
}

async function seedChampionState(config) {
  if (!config.seedChampionPath) {
    throw new Error('seedChampion.path (or legacy incumbent.path) is required to initialize champion state');
  }

  const seeded = await readJson(config.seedChampionPath);
  const source = seeded.status ? seeded : seeded.ranked?.[0];
  if (!source?.config) {
    throw new Error(`Could not load seed champion config from ${config.seedChampionPath}`);
  }

  const championState = {
    ...summarizeResult(source),
    configFingerprint: configFingerprint(source.config),
    promotedAt: isoNow(),
    sourcePath: config.seedChampionPath,
    sourceRunId: null,
    mode: 'seed',
  };

  await writeJson(championPath(config), championState);
  await appendJsonl(historyPath(config), {
    timestamp: championState.promotedAt,
    type: 'seedChampion',
    championConfigId: championState.configId,
    summary: `Seeded champion from ${path.basename(config.seedChampionPath)}`,
    recommendation: 'seed',
  });
  return championState;
}

async function ensureChampionState(config) {
  try {
    return await readJson(championPath(config));
  } catch {
    const championState = await seedChampionState(config);
    await rebuildHistoryArtifacts(config, championState);
    return championState;
  }
}

async function runPrimarySweep(config, runId) {
  const lab = config.primaryLab;
  const sweepArgs = [
    path.resolve(config.projectRoot, 'scripts', 'pine-sweep.mjs'),
    '--input', config.scriptPath,
    '--symbol', lab.symbol,
    '--timeframe', lab.timeframe,
    '--limit', String(lab.limit),
    '--grid', config.grid,
    '--run-id', runId,
    '--min-trades', String(config.minTrades),
  ];

  if (config.maxConfigs != null) {
    sweepArgs.push('--max-configs', String(config.maxConfigs));
  }
  if (lab.when) {
    sweepArgs.push('--when', lab.when);
  }
  if (lab.exchange) {
    sweepArgs.push('--exchange', lab.exchange);
  }

  await runNode(sweepArgs, config.projectRoot);

  const runDir = path.resolve(config.projectRoot, 'pine', 'sweeps', runId);
  const leaderboard = await readJson(path.join(runDir, 'leaderboard.json'));

  return {
    runDir,
    gridName: config.grid,
    topConfigs: (leaderboard.ranked || []).slice(0, 5).map((item) => summarizeResult(item)),
    best: leaderboard.ranked?.[0] || null,
  };
}

async function evaluateConfigOnLab({ config, lab, runId, variantKey, candidate }) {
  const evalDir = path.join(evaluationsRoot(config), runId, lab.labId);
  await fs.mkdir(evalDir, { recursive: true });

  const source = await fs.readFile(config.scriptPath, 'utf8');
  const patched = applyPatchPlan(source, buildPatchPlan(candidate.config || {}));
  const variantPath = path.join(evalDir, `${variantKey}.pine`);
  const flattenedPath = path.join(evalDir, `${variantKey}.flattened.pine`);
  const outputBase = `${variantKey}-${lab.labId}`;
  await fs.writeFile(variantPath, patched, 'utf8');

  const args = [
    path.resolve(config.projectRoot, 'scripts', 'pine-import-run-clean.mjs'),
    '--input', variantPath,
    '--flattened', flattenedPath,
    '--symbol', lab.symbol,
    '--timeframe', lab.timeframe,
    '--limit', String(lab.limit),
    '--output', outputBase,
  ];

  if (lab.when) {
    args.push('--when', lab.when);
  }
  if (lab.exchange) {
    args.push('--exchange', lab.exchange);
  }

  await runNode(args, config.projectRoot);

  const cleanedPath = path.join(evalDir, 'dump', `${outputBase}.cleaned.jsonl`);
  const analysis = await analyzeJsonlFile(cleanedPath, { minTrades: config.minTrades });

  return {
    status: 'ok',
    label: candidate.label || candidate.configId,
    configId: candidate.configId,
    config: candidate.config,
    score: analysis.score,
    metrics: analysis.metrics,
    diagnostics: analysis.diagnostics,
    cleanedPath,
    runDir: evalDir,
  };
}

async function evaluateMatrix(config, runId, championState, challengerSummary) {
  const labs = [config.primaryLab, ...config.shadowLabs];
  const sameCandidate = sameConfig(championState.config, challengerSummary?.config);
  const labResults = [];

  for (const lab of labs) {
    const incumbentResult = await evaluateConfigOnLab({
      config,
      lab,
      runId,
      variantKey: 'champion',
      candidate: championState,
    });

    const challengerResult = sameCandidate
      ? {
          ...clone(incumbentResult),
          label: challengerSummary?.label || challengerSummary?.configId || incumbentResult.label,
          configId: challengerSummary?.configId || incumbentResult.configId,
          config: challengerSummary?.config || incumbentResult.config,
        }
      : await evaluateConfigOnLab({
          config,
          lab,
          runId,
          variantKey: 'challenger',
          candidate: challengerSummary,
        });

    const decision = decideAutoresearchOutcome({
      incumbent: incumbentResult,
      challenger: challengerResult,
      thresholds: lab.thresholds,
    });

    labResults.push({
      lab,
      incumbent: summarizeResult(incumbentResult),
      challenger: summarizeResult(challengerResult),
      decision,
    });
  }

  return {
    labResults,
    matrixDecision: decideMatrixPromotion({
      labResults,
      policy: config.matrixPolicy,
      champion: championState,
      challenger: challengerSummary,
    }),
  };
}

async function runScout(config) {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const runId = buildRunId(config);
  const primarySweep = await runPrimarySweep(config, runId);
  const challengerSummary = summarizeResult(primarySweep.best);

  const { labResults, matrixDecision } = await evaluateMatrix(config, runId, championState, challengerSummary);

  const manifest = {
    generatedAt: isoNow(),
    matrixId: config.matrixId,
    runId,
    primaryLab: config.primaryLab,
    shadowLabs: config.shadowLabs,
    incumbent: summarizeResult(championState),
    champion: summarizeResult(championState),
    challenger: challengerSummary,
    primarySweep,
    labResults,
    matrixDecision,
  };

  const manifestName = `${runId}.json`;
  const manifestPath = path.join(manifestsDir(config), manifestName);
  const scoutPath = path.join(config.digestRoot, `${runId}.md`);

  await writeJson(manifestPath, manifest);
  await writeJson(latestManifestPath(config), { ...manifest, manifestPath });
  await writeText(scoutPath, renderScoutMarkdown({ config, manifest }));
  await appendJsonl(historyPath(config), {
    timestamp: manifest.generatedAt,
    type: 'cycle',
    runId,
    championConfigId: manifest.champion?.configId,
    challengerConfigId: manifest.challenger?.configId,
    recommendation: manifest.matrixDecision.recommendation,
    summary: manifest.matrixDecision.summary,
  });
  await rebuildHistoryArtifacts(config, championState);

  return { manifest, manifestPath, scoutPath };
}

async function runDigest(config) {
  await ensureDirs(config);
  const latest = await readLatestManifest(config);
  if (!latest) {
    throw new Error(`No latest manifest found at ${latestManifestPath(config)}`);
  }

  const championState = await ensureChampionState(config);
  const latestName = path.basename(latest.manifestPath || '');
  const previous = await readPreviousManifest(config, latestName);
  const digestId = `digest-${timestampId()}`;
  const digestPath = path.join(config.digestRoot, `${digestId}.md`);
  const historyEvents = await loadHistoryEvents(config);
  const digestText = renderDigestMarkdown({
    config,
    latestManifest: latest,
    previousManifest: previous,
    historyEvents,
    championState,
  });
  await writeText(digestPath, digestText);

  return {
    digestId,
    digestPath,
    summary: summarizeDigestAnnouncement({ latestManifest: latest, previousManifest: previous }),
    latest,
    previous,
  };
}

async function writePromotionNote(config, latest, mode) {
  const notePath = path.join(config.digestRoot, `${mode}-promote-${timestampId()}.md`);
  const lines = [
    '# Pine Autoresearch Promotion',
    '',
    `- Mode: ${mode}`,
    `- Source manifest: \`${latest.manifestPath || latestManifestPath(config)}\``,
    `- Applied config: \`${latest.challenger?.configId}\``,
    `- Matrix decision: ${latest.matrixDecision?.summary || latest.decision?.summary || 'n/a'}`,
    '',
  ];
  await writeText(notePath, `${lines.join('\n')}\n`);
  return notePath;
}

async function runPromote(config, args, mode = 'manual') {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const latest = await readLatestManifest(config);
  if (!latest) {
    throw new Error('No latest manifest to promote');
  }

  const decision = latest.matrixDecision || latest.decision;
  if (decision?.recommendation !== 'promote' && !args.force) {
    throw new Error(`Latest manifest recommendation is ${decision?.recommendation || 'unknown'}, not promote. Use --force to override.`);
  }
  if (!latest.challenger?.config) {
    throw new Error('Latest manifest has no challenger config to promote');
  }
  if (sameConfig(championState.config, latest.challenger.config)) {
    return {
      promoted: false,
      reason: `Champion already matches ${latest.challenger.configId}`,
      appliedConfigId: championState.configId,
      notePath: null,
    };
  }

  const source = await fs.readFile(config.scriptPath, 'utf8');
  const patched = applyPatchPlan(source, buildPatchPlan(latest.challenger.config || {}));
  await fs.writeFile(config.scriptPath, patched, 'utf8');

  const promotedAt = isoNow();
  const nextChampion = {
    ...latest.challenger,
    configFingerprint: configFingerprint(latest.challenger.config),
    promotedAt,
    sourceManifestPath: latest.manifestPath || latestManifestPath(config),
    sourceRunId: latest.runId,
    mode,
  };
  await writeJson(championPath(config), nextChampion);

  const notePath = await writePromotionNote(config, latest, mode);
  await appendJsonl(historyPath(config), {
    timestamp: promotedAt,
    type: mode === 'auto' ? 'autopromote' : 'promote',
    runId: latest.runId,
    fromConfigId: championState.configId,
    toConfigId: latest.challenger.configId,
    championConfigId: latest.challenger.configId,
    challengerConfigId: latest.challenger.configId,
    recommendation: 'promote',
    summary: `Promoted ${latest.challenger.configId} from ${championState.configId}`,
    note: notePath,
  });
  await rebuildHistoryArtifacts(config, nextChampion);

  return { promoted: true, notePath, appliedConfigId: latest.challenger.configId };
}

async function runAutopromote(config, args) {
  await ensureDirs(config);
  const championState = await ensureChampionState(config);
  const latest = await readLatestManifest(config);
  if (!latest) {
    throw new Error('No latest manifest for auto-promotion');
  }

  const historyEvents = await loadHistoryEvents(config);
  const action = decideAutoPromotionAction({
    latestManifest: latest,
    historyEvents,
    championState,
    policy: config.autoPromotion,
  });

  if (action.recommendation !== 'promote' && !args.force) {
    return {
      promoted: false,
      reason: action.summary,
      gates: action.gates,
    };
  }

  return runPromote(config, { ...args, force: true }, 'auto');
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
    console.log(`[autoresearch] recommendation=${result.manifest.matrixDecision.recommendation}`);
    return;
  }

  if (command === 'digest') {
    const result = await runDigest(config);
    console.log(result.summary);
    console.log(`[autoresearch] digest=${result.digestPath}`);
    return;
  }

  if (command === 'promote') {
    const result = await runPromote(config, args, 'manual');
    if (!result.promoted) {
      console.log(`[autoresearch] promote=noop ${result.reason}`);
      return;
    }
    console.log(`[autoresearch] promoted=${result.appliedConfigId}`);
    console.log(`[autoresearch] note=${result.notePath}`);
    return;
  }

  if (command === 'autopromote') {
    const result = await runAutopromote(config, args);
    if (!result.promoted) {
      console.log(`[autoresearch] autopromote=noop ${result.reason}`);
      return;
    }
    console.log(`[autoresearch] autopromoted=${result.appliedConfigId}`);
    console.log(`[autoresearch] note=${result.notePath}`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
