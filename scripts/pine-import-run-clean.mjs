import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { validatePinnedCacheComplete } from './lib/pine-dataset.mjs';

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

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(' ')}`));
    });
  });
}

async function flattenImports({ inputPath, flattenedPath, libsDir }) {
  const source = await fs.readFile(inputPath, 'utf8');
  const lines = source.split(/\r?\n/);

  const importRegex = /^\s*import\s+([\w.-]+)\/([\w.-]+)\/\d+\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;
  const imports = [];
  const mainLines = [];

  for (const line of lines) {
    const m = line.match(importRegex);
    if (m) {
      imports.push({ vendor: m[1], lib: m[2], alias: m[3] });
    } else {
      mainLines.push(line);
    }
  }

  if (imports.length === 0) {
    await fs.writeFile(flattenedPath, source, 'utf8');
    console.log(`[flatten] no import lines found, copied as-is -> ${flattenedPath}`);
    return { imports: [] };
  }

  const libBlocks = [];
  for (const imp of imports) {
    const libPath = path.join(libsDir, `${imp.lib}.pine`);
    let libSource;
    try {
      libSource = await fs.readFile(libPath, 'utf8');
    } catch {
      throw new Error(`Missing local library for import ${imp.vendor}/${imp.lib}: ${libPath}`);
    }

    const libLines = libSource.split(/\r?\n/);
    const cleaned = [];
    let cutExamples = false;

    for (let line of libLines) {
      if (/^\s*\/\/\s*Examples\s*:/i.test(line)) {
        cutExamples = true;
      }
      if (cutExamples) continue;
      if (/^\s*\/\/@version\s*=/.test(line)) continue;
      if (/^\s*library\s*\(/.test(line)) continue;

      line = line.replace(/^\s*export\s+/, '');
      cleaned.push(line);
    }

    libBlocks.push(`\n// ===== BEGIN inlined ${imp.vendor}/${imp.lib} as ${imp.alias} =====\n${cleaned.join('\n')}\n// ===== END inlined ${imp.vendor}/${imp.lib} =====\n`);
  }

  let mainSource = mainLines.join('\n');
  for (const imp of imports) {
    const aliasRegex = new RegExp(`\\b${imp.alias}\\.`, 'g');
    mainSource = mainSource.replace(aliasRegex, '');
  }

  await fs.writeFile(flattenedPath, `${libBlocks.join('\n')}\n${mainSource}`, 'utf8');
  console.log(`[flatten] inlined ${imports.length} import(s) -> ${flattenedPath}`);
  for (const imp of imports) {
    console.log(`  - ${imp.vendor}/${imp.lib} as ${imp.alias}`);
  }
  return { imports };
}

function toJsonl(rows) {
  if (!rows.length) return '';
  return `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

async function cleanupJsonl(rawJsonlPath, cleanedPath, signalsPath) {
  const raw = await fs.readFile(rawJsonlPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);

  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }

  const cleaned = parsed.filter((r) => r && r.timestamp && Number.isFinite(r.Close));
  const signals = cleaned.filter((r) => r.Signal === 1 || r.Signal === -1);

  await fs.writeFile(cleanedPath, toJsonl(cleaned), 'utf8');
  await fs.writeFile(signalsPath, toJsonl(signals), 'utf8');

  console.log(`[cleanup] raw=${parsed.length} cleaned=${cleaned.length} signals=${signals.length}`);
  console.log(`[cleanup] saved cleaned -> ${cleanedPath}`);
  console.log(`[cleanup] saved signals -> ${signalsPath}`);
}

async function main() {
  const cwd = process.cwd();
  const args = parseArgs(process.argv.slice(2));

  const input = args.input || args._[0] || './pine/test.pine';
  const symbol = args.symbol || args._[1] || 'BTCUSDT';
  const timeframe = args.timeframe || args._[2] || '15m';
  const limit = String(args.limit || args._[3] || '500');
  const libs = args.libs || './pine/scripts';
  const when = args.when ? String(args.when) : null;
  const exchange = args.exchange ? String(args.exchange) : null;
  const noCache = Boolean(args['no-cache']);
  const requireCacheComplete = Boolean(args['require-cache-complete']);
  const cacheRoot = path.resolve(cwd, String(args['cache-root'] || './pine/dump/data/candle'));
  const cacheExchange = String(args['cache-exchange'] || exchange || 'ccxt-exchange');

  const inputPath = path.resolve(cwd, input);
  const libsDir = path.resolve(cwd, libs);

  const flattenedPath = args.flattened
    ? path.resolve(cwd, String(args.flattened))
    : inputPath.replace(/\.pine$/i, '.flattened.pine');

  const outputBase = args.output
    ? String(args.output)
    : path.basename(flattenedPath, path.extname(flattenedPath));

  await flattenImports({ inputPath, flattenedPath, libsDir });

  if (requireCacheComplete) {
    if (!when) {
      throw new Error('--require-cache-complete requires --when');
    }
    const validation = await validatePinnedCacheComplete({
      cacheRoot,
      exchangeName: cacheExchange,
      symbol,
      timeframe,
      limit: Number(limit),
      when,
    });
    if (!validation.complete) {
      const preview = validation.missingTimestamps.slice(0, 5).join(', ');
      throw new Error(`Pinned cache incomplete for ${symbol} ${timeframe}: missing ${validation.missingCount} candle(s). First missing timestamps: ${preview}`);
    }
  }

  const cliPath = await fs.realpath(path.resolve(cwd, 'node_modules/@backtest-kit/cli/build/index.mjs'));
  const runArgs = [
    cliPath,
    '--symbol', symbol,
    '--pine', flattenedPath,
    '--timeframe', timeframe,
    '--limit', limit,
    '--jsonl',
    '--output', outputBase,
  ];

  if (when) {
    runArgs.push('--when', when);
  }
  if (exchange && !noCache) {
    runArgs.push('--exchange', exchange);
  }
  if (noCache) {
    runArgs.push('--noCache');
  }

  const pineDir = path.dirname(flattenedPath);
  console.log(`[run] node ${runArgs.join(' ')}`);
  await runProcess('node', runArgs, pineDir);

  const dumpDir = path.join(pineDir, 'dump');
  const rawJsonlPath = path.join(dumpDir, `${outputBase}.jsonl`);
  const cleanedPath = path.join(dumpDir, `${outputBase}.cleaned.jsonl`);
  const signalsPath = path.join(dumpDir, `${outputBase}.signals.jsonl`);

  await cleanupJsonl(rawJsonlPath, cleanedPath, signalsPath);
}

main().catch((err) => {
  console.error(`[error] ${err?.message || err}`);
  process.exit(1);
});
