import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatDatasetHelp } from '../scripts/pine-dataset.mjs';
import {
  assertDatasetMatchesLab,
  expectedCandleTimestamps,
  getPinnedWindow,
  readPinnedCandlesFromCache,
  stagePinnedDatasetForLab,
  validatePinnedCacheComplete,
  writePinnedDataset,
} from '../scripts/lib/pine-dataset.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runNode(args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function makeLab(overrides = {}) {
  return {
    labId: 'xrpusdt-15m-primary',
    symbol: 'XRPUSDT',
    timeframe: '15m',
    limit: 4,
    when: '2026-04-21T10:30:00.000Z',
    ...overrides,
  };
}

function makeCandles(lab) {
  const timestamps = expectedCandleTimestamps(lab);
  return timestamps.map((timestamp, index) => ({
    timestamp,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1000 + index,
  }));
}

test('dataset preflight command documents autoresearch readiness, not only cache completeness', () => {
  const helpText = formatDatasetHelp();
  assert.match(helpText, /preflight/);
  assert.match(helpText, /same offline preflight used by autoresearch/);
});

test('dataset preflight command returns autoresearch offline readiness JSON', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-dataset-preflight-test-'));
  const configPath = path.join(tempRoot, 'pine-autoresearch.json');

  try {
    await fs.writeFile(configPath, JSON.stringify({
      matrixId: 'dataset-preflight-test',
      scriptPath: 'strategy.pine',
      grid: 'phase3-core',
      outputs: { researchRoot: 'research', digestRoot: 'digest' },
      primaryLab: {
        labId: 'Primary',
        symbol: 'XRPUSDT',
        timeframe: '15m',
        limit: 2,
        when: '2026-04-21T10:30:00.000Z',
      },
      pinnedData: {
        enabled: true,
        cacheRoot: 'cache',
        exchangeName: 'ccxt-exchange',
      },
      regimeExitResearch: {
        offline: { mode: 'offline-strict' },
      },
    }), 'utf8');

    const result = await runNode([
      path.join(repoRoot, 'scripts', 'pine-dataset.mjs'),
      'preflight',
      '--config',
      configPath,
    ], { cwd: tempRoot });

    assert.equal(result.code, 2);
    assert.equal(result.stderr, '');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.ok, false);
    assert.equal(summary.reason, 'offlineDataMissing');
    assert.equal(summary.missingLabs[0].symbol, 'XRPUSDT');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('getPinnedWindow aligns when and computes since correctly', () => {
  const window = getPinnedWindow({
    timeframe: '15m',
    limit: 4,
    when: '2026-04-21T10:37:00.000Z',
  });

  assert.equal(new Date(window.alignedWhenMs).toISOString(), '2026-04-21T10:30:00.000Z');
  assert.equal(new Date(window.sinceMs).toISOString(), '2026-04-21T09:30:00.000Z');
});

test('assertDatasetMatchesLab treats equivalent ISO-8601 when formats as equal', () => {
  const lab = makeLab({ when: '2026-04-21T10:30:00Z' });
  const datasetLab = makeLab({ when: '2026-04-21T10:30:00.000Z' });
  const dataset = { lab: datasetLab, candles: makeCandles(lab) };

  assert.doesNotThrow(() => assertDatasetMatchesLab(dataset, lab));
});

test('assertDatasetMatchesLab rejects different when instants', () => {
  const lab = makeLab({ when: '2026-04-21T10:30:00Z' });
  const datasetLab = makeLab({ when: '2026-04-21T10:45:00.000Z' });
  const dataset = { lab: datasetLab, candles: makeCandles(datasetLab) };

  assert.throws(() => assertDatasetMatchesLab(dataset, lab), /field when expected/);
});

test('readPinnedCandlesFromCache reads complete locked window from existing local cache', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-dataset-test-'));
  const cacheRoot = path.join(tempRoot, 'cache');
  const lab = makeLab();
  const candles = makeCandles(lab);

  try {
    for (const candle of candles) {
      const filePath = path.join(cacheRoot, 'ccxt-exchange', lab.symbol, lab.timeframe, `${candle.timestamp}.json`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(candle), 'utf8');
    }

    const loaded = await readPinnedCandlesFromCache({
      cacheRoot,
      exchangeName: 'ccxt-exchange',
      symbol: lab.symbol,
      timeframe: lab.timeframe,
      limit: lab.limit,
      when: lab.when,
    });

    assert.equal(loaded.exchangeName, 'ccxt-exchange');
    assert.equal(loaded.complete, true);
    assert.deepEqual(loaded.candles, candles);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('stagePinnedDatasetForLab materializes cache and validates completeness', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-dataset-test-'));
  const datasetsRoot = path.join(tempRoot, 'datasets');
  const cacheRoot = path.join(tempRoot, 'cache');
  const lab = makeLab();
  const candles = makeCandles(lab);

  try {
    const filePath = await writePinnedDataset({
      datasetsRoot,
      lab,
      candles,
      exchangeName: 'ccxt-exchange',
      exchangeId: 'binance',
    });

    const staged = await stagePinnedDatasetForLab({
      datasetsRoot,
      cacheRoot,
      exchangeName: 'ccxt-exchange',
      lab,
    });

    assert.equal(staged.filePath, filePath);
    assert.equal(staged.materialized.candleCount, 4);
    assert.equal(staged.validation.complete, true);

    const validation = await validatePinnedCacheComplete({
      cacheRoot,
      exchangeName: 'ccxt-exchange',
      symbol: lab.symbol,
      timeframe: lab.timeframe,
      limit: lab.limit,
      when: lab.when,
    });

    assert.equal(validation.complete, true);
    assert.equal(validation.missingCount, 0);
    assert.doesNotThrow(() => assertDatasetMatchesLab(staged.dataset, lab));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
