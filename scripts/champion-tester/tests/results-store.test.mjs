import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ResultsStore } from '../lib/results-store.mjs';

function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'results-store-test-'));
}

function sampleResult(overrides = {}) {
  return {
    runId: 'test-run-001',
    timestamp: '2026-05-17T10:00:00.000Z',
    durationMs: 5000,
    dataset: { symbol: 'BTCUSDT', exchange: 'binance', timeframe: '15m' },
    metrics: { netProfit: 150, winRate: 65, totalTrades: 20 },
    ...overrides,
  };
}

describe('ResultsStore', () => {
  let tmpDir;
  let store;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    store = new ResultsStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('save', () => {
    it('creates file and returns filename/filePath', async () => {
      const result = sampleResult();
      const { filename, filePath } = await store.save(result);

      assert.ok(filename, 'filename should be truthy');
      assert.ok(filePath, 'filePath should be truthy');
      assert.ok(filename.endsWith('.json'));

      const stat = await fs.stat(filePath);
      assert.ok(stat.isFile());
    });

    it('file contains valid JSON matching normalized input', async () => {
      const result = sampleResult();
      const { filePath } = await store.save(result);

      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);

      assert.equal(parsed.runId, result.runId);
      assert.equal(parsed.metrics.netProfit, 150);
      assert.equal(parsed.metrics.winRate, 65);
      assert.equal(parsed.metrics.totalTrades, 20);
      assert.equal(parsed.metrics.roi, 0);
    });

    it('normalizes analyzer metric aliases when saving', async () => {
      const result = sampleResult({
        metrics: { totalPnl: 123.456, roiPct: 4.321, winRatePct: 56.789, tradeCount: 12, maxDrawdownPct: 1.234, profitFactor: 2.345 },
      });
      await store.save(result);

      const found = await store.get(result.runId);

      assert.equal(found.metrics.netProfit, 123.46);
      assert.equal(found.metrics.roi, 4.32);
      assert.equal(found.metrics.winRate, 56.79);
      assert.equal(found.metrics.totalTrades, 12);
      assert.equal(found.metrics.maxDrawdown, 1.23);
      assert.equal(found.metrics.profitFactor, 2.35);
    });
  });

  describe('list', () => {
    it('returns empty when no results', async () => {
      const { total, results } = await store.list();

      assert.equal(total, 0);
      assert.deepEqual(results, []);
    });

    it('returns saved results sorted by timestamp desc', async () => {
      const r1 = sampleResult({ runId: 'run-1', timestamp: '2026-05-17T08:00:00.000Z' });
      const r2 = sampleResult({ runId: 'run-2', timestamp: '2026-05-17T10:00:00.000Z' });
      const r3 = sampleResult({ runId: 'run-3', timestamp: '2026-05-17T09:00:00.000Z' });

      await store.save(r1);
      await store.save(r2);
      await store.save(r3);

      const { total, results } = await store.list();

      assert.equal(total, 3);
      assert.equal(results[0].runId, 'run-2');
      assert.equal(results[1].runId, 'run-3');
      assert.equal(results[2].runId, 'run-1');
    });

    it('filters by symbol', async () => {
      const r1 = sampleResult({ runId: 'run-btc', dataset: { symbol: 'BTCUSDT', exchange: 'binance', timeframe: '15m' } });
      const r2 = sampleResult({ runId: 'run-eth', dataset: { symbol: 'ETHUSDT', exchange: 'binance', timeframe: '15m' } });

      await store.save(r1);
      await store.save(r2);

      const { total, results } = await store.list({ symbol: 'ETHUSDT' });

      assert.equal(total, 1);
      assert.equal(results[0].runId, 'run-eth');
    });

    it('filters by timeframe', async () => {
      const r1 = sampleResult({ runId: 'run-15m', dataset: { symbol: 'BTCUSDT', exchange: 'binance', timeframe: '15m' } });
      const r2 = sampleResult({ runId: 'run-1h', dataset: { symbol: 'BTCUSDT', exchange: 'binance', timeframe: '1h' } });

      await store.save(r1);
      await store.save(r2);

      const { total, results } = await store.list({ timeframe: '1h' });

      assert.equal(total, 1);
      assert.equal(results[0].runId, 'run-1h');
    });

    it('respects limit parameter', async () => {
      const r1 = sampleResult({ runId: 'run-1', timestamp: '2026-05-17T08:00:00.000Z' });
      const r2 = sampleResult({ runId: 'run-2', timestamp: '2026-05-17T09:00:00.000Z' });
      const r3 = sampleResult({ runId: 'run-3', timestamp: '2026-05-17T10:00:00.000Z' });

      await store.save(r1);
      await store.save(r2);
      await store.save(r3);

      const { total, results } = await store.list({ limit: 2 });

      assert.equal(total, 3);
      assert.equal(results.length, 2);
    });
  });

  describe('get', () => {
    it('returns result by runId', async () => {
      const result = sampleResult();
      await store.save(result);

      const found = await store.get('test-run-001');

      assert.equal(found.runId, result.runId);
      assert.equal(found.metrics.netProfit, result.metrics.netProfit);
      assert.equal(found.metrics.winRate, result.metrics.winRate);
      assert.equal(found.metrics.totalTrades, result.metrics.totalTrades);
    });

    it('returns null for unknown runId', async () => {
      const found = await store.get('nonexistent-run');

      assert.equal(found, null);
    });
  });

  describe('delete', () => {
    it('removes result by runId, returns true', async () => {
      const result = sampleResult();
      await store.save(result);

      const deleted = await store.delete('test-run-001');
      assert.equal(deleted, true);

      const found = await store.get('test-run-001');
      assert.equal(found, null);
    });

    it('returns false for unknown runId', async () => {
      const deleted = await store.delete('nonexistent-run');
      assert.equal(deleted, false);
    });
  });
});
