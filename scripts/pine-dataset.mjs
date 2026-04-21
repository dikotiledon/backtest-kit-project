import path from 'node:path';
import {
  assertDatasetMatchesLab,
  datasetFilePath,
  fetchPinnedCandles,
  readPinnedCandlesFromCache,
  readPinnedDataset,
  stagePinnedDatasetForLab,
  validatePinnedCacheComplete,
  writePinnedDataset,
} from './lib/pine-dataset.mjs';
import { readJson } from './lib/pine-autoresearch.mjs';

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLab(rawLab, index, role) {
  return {
    labId: rawLab.labId || `${role}-${index + 1}`,
    symbol: String(rawLab.symbol),
    timeframe: String(rawLab.timeframe),
    limit: Number(rawLab.limit),
    when: rawLab.when,
    exchange: rawLab.exchange || null,
  };
}

async function loadDatasetConfig(cwd, configPath) {
  const resolvedConfigPath = resolveMaybeRelative(cwd, configPath || './config/pine-autoresearch.default.json');
  const raw = await readJson(resolvedConfigPath);
  const baseDir = path.dirname(resolvedConfigPath);
  const primarySource = raw.primaryLab || {
    labId: raw.labId || raw.matrixId || 'primary',
    symbol: raw.symbol,
    timeframe: raw.timeframe,
    limit: raw.limit,
    when: raw.when,
    exchange: raw.exchange || null,
  };

  const labs = [
    normalizeLab(primarySource, 0, 'primary'),
    ...(raw.shadowLabs || []).map((lab, index) => normalizeLab(lab, index, 'shadow')),
  ];

  const pinnedData = {
    enabled: true,
    datasetsRoot: resolveMaybeRelative(baseDir, raw.pinnedData?.datasetsRoot || `../pine/datasets/${raw.matrixId || 'pine-autoresearch'}`),
    cacheRoot: resolveMaybeRelative(baseDir, raw.pinnedData?.cacheRoot || '../pine/dump/data/candle'),
    exchangeName: raw.pinnedData?.exchangeName || primarySource.exchange || 'ccxt-exchange',
    sourceExchangeId: raw.pinnedData?.sourceExchangeId || 'binance',
    sourceMode: raw.pinnedData?.sourceMode || 'local-cache',
  };

  return {
    configPath: resolvedConfigPath,
    matrixId: raw.matrixId || 'pine-autoresearch',
    pinnedData,
    labs,
  };
}

async function runPin(config, args) {
  const sourceMode = String(args.source || config.pinnedData.sourceMode || 'local-cache');

  for (const lab of config.labs) {
    console.log(`[pin] ${lab.labId} ${lab.symbol} ${lab.timeframe} limit=${lab.limit} when=${lab.when} source=${sourceMode}`);
    let candles;
    let datasetExchangeName = config.pinnedData.exchangeName;
    let datasetSource = sourceMode;

    if (sourceMode === 'local-cache' || sourceMode === 'local-first') {
      const cached = await readPinnedCandlesFromCache({
        cacheRoot: config.pinnedData.cacheRoot,
        exchangeName: lab.exchange || config.pinnedData.exchangeName,
        symbol: lab.symbol,
        timeframe: lab.timeframe,
        limit: lab.limit,
        when: lab.when,
      });
      candles = cached.candles;
      datasetExchangeName = cached.exchangeName;
      datasetSource = 'local-cache';
    }

    if (!candles && (sourceMode === 'network' || sourceMode === 'local-first')) {
      candles = await fetchPinnedCandles({
        symbol: lab.symbol,
        timeframe: lab.timeframe,
        limit: lab.limit,
        when: lab.when,
        exchangeId: config.pinnedData.sourceExchangeId,
      });
      datasetExchangeName = config.pinnedData.exchangeName;
      datasetSource = 'ccxt';
    }

    if (!candles) {
      throw new Error(`Unsupported pin source mode: ${sourceMode}`);
    }

    const filePath = await writePinnedDataset({
      datasetsRoot: config.pinnedData.datasetsRoot,
      lab,
      candles,
      exchangeName: datasetExchangeName,
      exchangeId: config.pinnedData.sourceExchangeId,
      source: datasetSource,
    });
    console.log(`[pin] wrote ${filePath}`);

    if (!args['no-stage']) {
      const staged = await stagePinnedDatasetForLab({
        datasetsRoot: config.pinnedData.datasetsRoot,
        cacheRoot: config.pinnedData.cacheRoot,
        exchangeName: config.pinnedData.exchangeName,
        lab,
      });
      console.log(`[pin] staged ${lab.labId} cacheWritten=${staged.materialized.writtenCount}`);
    }
  }
}

async function runStage(config) {
  for (const lab of config.labs) {
    const staged = await stagePinnedDatasetForLab({
      datasetsRoot: config.pinnedData.datasetsRoot,
      cacheRoot: config.pinnedData.cacheRoot,
      exchangeName: config.pinnedData.exchangeName,
      lab,
    });
    console.log(`[stage] ${lab.labId} cacheWritten=${staged.materialized.writtenCount}`);
  }
}

async function runVerify(config) {
  for (const lab of config.labs) {
    const filePath = datasetFilePath(config.pinnedData.datasetsRoot, lab);
    const dataset = await readPinnedDataset(filePath);
    assertDatasetMatchesLab(dataset, lab);
    const validation = await validatePinnedCacheComplete({
      cacheRoot: config.pinnedData.cacheRoot,
      exchangeName: config.pinnedData.exchangeName,
      symbol: lab.symbol,
      timeframe: lab.timeframe,
      limit: lab.limit,
      when: lab.when,
    });
    console.log(JSON.stringify({
      labId: lab.labId,
      dataset: filePath,
      cacheComplete: validation.complete,
      missingCount: validation.missingCount,
    }));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] || 'verify';
  const config = await loadDatasetConfig(process.cwd(), args.config);

  if (command === 'pin') {
    await runPin(config, args);
    return;
  }

  if (command === 'stage') {
    await runStage(config);
    return;
  }

  if (command === 'verify') {
    await runVerify(config);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
