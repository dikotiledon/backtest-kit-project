import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeJsonlFile } from '../scripts/lib/pine-optimizer.mjs';
import {
  analyzeJsonlFileStreaming,
  createIncrementalTradeSimulator,
} from '../scripts/lib/pine-streaming-metrics.mjs';

async function writeFixture(rows) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-streaming-metrics-'));
  const file = path.join(dir, 'fixture.jsonl');
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  return file;
}

async function writeRawFixture(contents) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-streaming-metrics-'));
  const file = path.join(dir, 'fixture.jsonl');
  await fs.writeFile(file, contents, 'utf8');
  return file;
}

test('analyzeJsonlFileStreaming matches full analyzer on compact fixture', async () => {
  const rows = [
    { timestamp: '2026-01-01T00:00:00.000Z', Close: 100, Signal: 1, StopLoss: 95, TakeProfit: 110 },
    { timestamp: '2026-01-01T00:15:00.000Z', Close: 105 },
    { timestamp: '2026-01-01T00:30:00.000Z', Close: 110 },
    { timestamp: '2026-01-01T00:45:00.000Z', Close: 120, Signal: -1, StopLoss: 130, TakeProfit: 100 },
    { timestamp: '2026-01-01T01:00:00.000Z', Close: 100 },
  ];
  const file = await writeFixture(rows);

  const full = await analyzeJsonlFile(file, { minTrades: 0 });
  const streaming = await analyzeJsonlFileStreaming(file, { minTrades: 0 });

  assert.equal(streaming.rowCount, full.rowCount);
  assert.equal(streaming.metrics.tradeCount, full.metrics.tradeCount);
  assert.equal(Number(streaming.metrics.roiPct.toFixed(6)), Number(full.metrics.roiPct.toFixed(6)));
  assert.equal(Number(streaming.score.toFixed(6)), Number(full.score.toFixed(6)));
});

test('streaming rowCount parity with mixed-validity rows and matching metrics', async () => {
  const rows = [
    { timestamp: '2026-01-01T00:00:00.000Z', Close: 100, Signal: 1, StopLoss: 90, TakeProfit: 130 },
    { timestamp: '2026-01-01T00:15:00.000Z', Close: 105 },
    { timestamp: '2026-01-01T00:30:00.000Z' },
    { Close: 111 },
    { timestamp: '2026-01-01T00:45:00.000Z', Close: 110, Signal: -1 },
    { timestamp: '2026-01-01T01:00:00.000Z', Close: 102 },
  ];
  const file = await writeFixture(rows);

  const full = await analyzeJsonlFile(file, { minTrades: 0 });
  const streaming = await analyzeJsonlFileStreaming(file, { minTrades: 0 });

  assert.equal(streaming.rowCount, full.rowCount);
  assert.equal(streaming.rowCount, rows.length);
  assert.equal(streaming.metrics.tradeCount, full.metrics.tradeCount);
  assert.equal(Number(streaming.metrics.roiPct.toFixed(6)), Number(full.metrics.roiPct.toFixed(6)));
  assert.equal(Number(streaming.score.toFixed(6)), Number(full.score.toFixed(6)));
});

test('incremental streaming simulator records MFE and MAE from OHLC path including exit bar', () => {
  const rows = [
    { timestamp: '2026-01-01T00:00:00.000Z', Close: 100, High: 100, Low: 100, Signal: 1, EstimatedTime: 15 },
    { timestamp: '2026-01-01T00:15:00.000Z', Close: 102, High: 110, Low: 95, Signal: 0 },
  ];
  const simulator = createIncrementalTradeSimulator({ timeframeMinutes: 15 });

  for (const row of rows) simulator.push(row);
  const result = simulator.finalize(rows.at(-1));

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitPrice, 102);
  assert.equal(result.trades[0].mfePct, 10);
  assert.equal(result.trades[0].maePct, 5);
});

test('streaming malformed JSONL throws contextual file and line error', async () => {
  const file = await writeRawFixture([
    JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', Close: 100 }),
    '{"timestamp": "2026-01-01T00:15:00.000Z", "Close": }',
    JSON.stringify({ timestamp: '2026-01-01T00:30:00.000Z', Close: 101 }),
  ].join('\n'));

  await assert.rejects(
    () => analyzeJsonlFileStreaming(file, { minTrades: 0 }),
    (error) => {
      assert.match(error.message, new RegExp(`Invalid JSONL at .*fixture\\.jsonl:2$`));
      return true;
    },
  );
});

test('streaming/full parity on same-bar flip and end-of-data forced close edge', async () => {
  const rows = [
    { timestamp: '2026-01-01T00:00:00.000Z', Close: 100, Signal: 1, EstimatedTime: 9999 },
    { timestamp: '2026-01-01T00:15:00.000Z', Close: 102, Signal: -1, EstimatedTime: 9999 },
    { timestamp: '2026-01-01T00:30:00.000Z', Close: 99, Signal: 1, EstimatedTime: 9999 },
    { timestamp: '2026-01-01T00:45:00.000Z', Close: 105 },
  ];
  const file = await writeFixture(rows);

  const full = await analyzeJsonlFile(file, { minTrades: 0 });
  const streaming = await analyzeJsonlFileStreaming(file, { minTrades: 0 });

  assert.equal(streaming.metrics.tradeCount, full.metrics.tradeCount);
  assert.equal(Number(streaming.metrics.roiPct.toFixed(6)), Number(full.metrics.roiPct.toFixed(6)));
  assert.equal(Number(streaming.score.toFixed(6)), Number(full.score.toFixed(6)));
});
