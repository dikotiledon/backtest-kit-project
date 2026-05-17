import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock dependencies before importing sweep-runner
const mockRunChampionTest = mock.fn(async () => ({
  ok: true,
  netProfit: 100,
  symbol: 'BTCUSDT',
}));
const mockGetRunStatus = mock.fn(() => ({ running: false }));
const mockReadDataset = mock.fn(async () => [{ open: 1, high: 2, low: 0.5, close: 1.5 }]);
const mockDatasetPath = mock.fn((dir, exchange, symbol, tf) =>
  `${dir}/${exchange}/${symbol}_${tf}.json`
);

await mock.module('../lib/strategy-runner.mjs', {
  namedExports: {
    runChampionTest: mockRunChampionTest,
    getRunStatus: mockGetRunStatus,
  },
});

await mock.module('../lib/dataset-manager.mjs', {
  namedExports: {
    readDataset: mockReadDataset,
    datasetPath: mockDatasetPath,
  },
});

// Import after mocks are registered
const { runSweep, getSweepStatus, cancelSweep } = await import('../lib/sweep-runner.mjs');

function resetMocks() {
  mockRunChampionTest.mock.resetCalls();
  mockGetRunStatus.mock.resetCalls();
  mockReadDataset.mock.resetCalls();
  mockDatasetPath.mock.resetCalls();
  mockGetRunStatus.mock.mockImplementation(() => ({ running: false }));
  mockRunChampionTest.mock.mockImplementation(async () => ({
    ok: true,
    netProfit: 100,
    symbol: 'BTCUSDT',
  }));
  mockReadDataset.mock.mockImplementation(async () => [{ open: 1 }]);
}

test('getSweepStatus returns { running: false } when idle', () => {
  const status = getSweepStatus();
  assert.deepStrictEqual(status, { running: false });
});

test('cancelSweep returns { ok: true }', async () => {
  const result = await cancelSweep();
  assert.deepStrictEqual(result, { ok: true });
});

test('runSweep throws RUN_IN_PROGRESS if a champion test run is active', async () => {
  resetMocks();
  mockGetRunStatus.mock.mockImplementation(() => ({ running: true }));

  await assert.rejects(
    () => runSweep({
      matrixId: 'mx1',
      datasets: [{ exchange: 'binance', symbol: 'BTCUSDT', timeframe: '1h' }],
      dataDir: '/tmp',
    }),
    (err) => {
      assert.equal(err.code, 'RUN_IN_PROGRESS');
      return true;
    }
  );
});

test('runSweep completes with zero results for empty datasets array', async () => {
  resetMocks();
  const result = await runSweep({ matrixId: 'mx1', datasets: [], dataDir: '/tmp' });
  assert.equal(result.completed, 0);
  assert.equal(result.total, 0);
  assert.deepStrictEqual(result.results, []);
  assert.equal(result.cancelled, false);
});

test('runSweep runs champion test for each dataset and returns summary', async () => {
  resetMocks();
  mockRunChampionTest.mock.mockImplementation(async () => ({
    ok: true,
    netProfit: 200,
    symbol: 'ETHUSDT',
  }));

  const datasets = [
    { exchange: 'binance', symbol: 'ETHUSDT', timeframe: '4h' },
    { exchange: 'binance', symbol: 'BTCUSDT', timeframe: '1h' },
  ];

  const result = await runSweep({ matrixId: 'mx1', datasets, dataDir: '/data' });

  assert.equal(result.completed, 2);
  assert.equal(result.total, 2);
  assert.equal(result.results.length, 2);
  assert.equal(result.cancelled, false);
  assert.equal(typeof result.sweepId, 'string');
  assert.equal(typeof result.totalTime, 'number');
  assert.equal(result.avgNetProfit, 200);
  assert.equal(mockRunChampionTest.mock.callCount(), 2);
});

test('runSweep records error result when dataset is not found', async () => {
  resetMocks();
  mockReadDataset.mock.mockImplementation(async () => null);

  const datasets = [
    { exchange: 'binance', symbol: 'MISSING', timeframe: '1h' },
  ];

  const result = await runSweep({ matrixId: 'mx1', datasets, dataDir: '/data' });

  assert.equal(result.completed, 1);
  assert.equal(result.results[0].ok, false);
  assert.match(result.results[0].error, /not found|empty/i);
  assert.equal(mockRunChampionTest.mock.callCount(), 0);
});

test('runSweep stops early when cancelled', async () => {
  resetMocks();
  let callCount = 0;
  mockRunChampionTest.mock.mockImplementation(async () => {
    callCount++;
    if (callCount === 1) await cancelSweep();
    return { ok: true, netProfit: 50, symbol: 'X' };
  });

  const datasets = [
    { exchange: 'binance', symbol: 'A', timeframe: '1h' },
    { exchange: 'binance', symbol: 'B', timeframe: '1h' },
    { exchange: 'binance', symbol: 'C', timeframe: '1h' },
  ];

  const result = await runSweep({ matrixId: 'mx1', datasets, dataDir: '/data' });

  assert.equal(result.cancelled, true);
  assert.ok(result.completed < 3, `expected < 3 completed, got ${result.completed}`);
});

test('runSweep calls onProgress callback during sweep', async () => {
  resetMocks();
  const progressCalls = [];
  const onProgress = (status) => progressCalls.push({ ...status });

  const datasets = [
    { exchange: 'binance', symbol: 'BTCUSDT', timeframe: '1h' },
  ];

  await runSweep({ matrixId: 'mx1', datasets, dataDir: '/data', onProgress });

  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0].running, true);
});

test('runSweep throws SWEEP_IN_PROGRESS if called while already running', async () => {
  resetMocks();
  let resolveFirst;
  mockRunChampionTest.mock.mockImplementation(
    () => new Promise((resolve) => { resolveFirst = resolve; })
  );

  const datasets = [
    { exchange: 'binance', symbol: 'BTCUSDT', timeframe: '1h' },
  ];

  const firstSweep = runSweep({ matrixId: 'mx1', datasets, dataDir: '/tmp' });

  // Wait for the sweep to enter running state
  await new Promise((r) => setTimeout(r, 30));

  await assert.rejects(
    () => runSweep({ matrixId: 'mx2', datasets, dataDir: '/tmp' }),
    (err) => {
      assert.equal(err.code, 'SWEEP_IN_PROGRESS');
      return true;
    }
  );

  // Cleanup: resolve blocked test so module state resets via finally block
  resolveFirst({ ok: true, netProfit: 50, symbol: 'BTCUSDT' });
  await firstSweep;
});
