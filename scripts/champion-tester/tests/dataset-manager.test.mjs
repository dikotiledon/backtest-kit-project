import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  parseSymbol,
  validateSymbolInput,
  writeDataset,
  readDataset,
  listDatasets,
  datasetPath,
} from '../lib/dataset-manager.mjs';

describe('parseSymbol', () => {
  it('parses "BINANCE:BTCUSDT" into { exchange: "binance", symbol: "BTC/USDT" }', () => {
    const result = parseSymbol('BINANCE:BTCUSDT');
    assert.equal(result.exchange, 'binance');
    assert.equal(result.symbol, 'BTCUSDT');
    assert.equal(result.raw, 'BINANCE:BTCUSDT');
  });

  it('handles lowercase input', () => {
    const result = parseSymbol('binance:btcusdt');
    assert.equal(result.exchange, 'binance');
    assert.equal(result.symbol, 'BTCUSDT');
    assert.equal(result.raw, 'BINANCE:BTCUSDT');
  });
});

describe('validateSymbolInput', () => {
  it('returns empty array for valid input', () => {
    const errors = validateSymbolInput('BINANCE:BTCUSDT', '15m');
    assert.deepEqual(errors, []);
  });

  it('returns errors for empty symbol', () => {
    const errors = validateSymbolInput('', '15m');
    assert.ok(errors.length > 0);
    assert.ok(errors.some(e => e.includes('symbol')));
  });

  it('returns errors for invalid timeframe', () => {
    const errors = validateSymbolInput('BINANCE:BTCUSDT', '99x');
    assert.ok(errors.length > 0);
    assert.ok(errors.some(e => e.includes('timeframe')));
  });
});

describe('writeDataset + readDataset roundtrip', () => {
  let tmpDir;

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('writes and reads back identical data', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ds-test-'));
    const filePath = path.join(tmpDir, 'test_dataset.json');

    const dataset = {
      formatVersion: 2,
      exchange: 'binance',
      symbol: 'BTCUSDT',
      timeframe: '15m',
      candleCount: 2,
      candles: [
        { timestamp: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
        { timestamp: 2000, open: 1.5, high: 3, low: 1, close: 2.5, volume: 200 },
      ],
    };

    await writeDataset(filePath, dataset);
    const read = await readDataset(filePath);

    assert.deepEqual(read, dataset);
  });
});

describe('listDatasets', () => {
  let tmpDir;

  after(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for empty dir', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ds-list-'));
    const result = await listDatasets(tmpDir);
    assert.deepEqual(result, []);
  });
});

describe('datasetPath', () => {
  it('returns expected path format', () => {
    const result = datasetPath('/data', 'binance', 'BTCUSDT', '15m');
    const expected = path.join('/data', 'binance_BTCUSDT_15m.json');
    assert.equal(result, expected);
  });
});
