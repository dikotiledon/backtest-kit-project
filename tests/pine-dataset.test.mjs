import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertDatasetMatchesLab,
  expectedCandleTimestamps,
  getPinnedWindow,
  readPinnedCandlesFromCache,
  stagePinnedDatasetForLab,
  validatePinnedCacheComplete,
  writePinnedDataset,
} from '../scripts/lib/pine-dataset.mjs';

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
