import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { analyzeJsonlFile } from '../scripts/lib/pine-optimizer.mjs';
import { analyzeJsonlFileStreaming } from '../scripts/lib/pine-streaming-metrics.mjs';

async function writeFixture(rows) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pine-streaming-metrics-'));
  const file = path.join(dir, 'fixture.jsonl');
  await fs.writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  return file;
}

test('analyzeJsonlFileStreaming matches full analyzer on compact fixture', async () => {
  const rows = [
    { timestamp: 1, Close: 100, Signal_Long: 1, SL: 95, TP: 110 },
    { timestamp: 2, Close: 105 },
    { timestamp: 3, Close: 110 },
    { timestamp: 4, Close: 120, Signal_Short: 1, SL: 130, TP: 100 },
    { timestamp: 5, Close: 100 },
  ];
  const file = await writeFixture(rows);

  const full = await analyzeJsonlFile(file, { minTrades: 0 });
  const streaming = await analyzeJsonlFileStreaming(file, { minTrades: 0 });

  assert.equal(streaming.rowCount, full.rowCount);
  assert.equal(streaming.metrics.tradeCount, full.metrics.tradeCount);
  assert.equal(Number(streaming.metrics.roiPct.toFixed(6)), Number(full.metrics.roiPct.toFixed(6)));
  assert.equal(Number(streaming.score.toFixed(6)), Number(full.score.toFixed(6)));
});
