/**
 * Strategy Runner
 * 
 * Executes the champion pine strategy against a dataset slice.
 * Reuses the existing pine-import-run-clean pipeline but with
 * dataset-provided candles written to a temp cache.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sliceDataset } from './dataset-manager.mjs';
import { loadChampion, getScriptPath } from './champion-loader.mjs';
import {
  analyzeJsonlFileStreaming,
  createIncrementalTradeSimulator,
  iterateJsonlRows,
} from '../../lib/pine-streaming-metrics.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

// --- Run status tracking (mutex) ---
let _running = false;
let _runningSymbol = null;
let _runningStartedAt = null;

export function getRunStatus() {
  if (!_running) return { running: false };
  return {
    running: true,
    symbol: _runningSymbol,
    startedAt: _runningStartedAt,
    elapsedMs: Date.now() - _runningStartedAt,
  };
}

/**
 * Apply champion config values to a pine script source.
 * Replaces input declarations with champion values.
 */
function applyConfigToSource(source, config) {
  let patched = source;

  for (const [key, value] of Object.entries(config)) {
    // Match pine input patterns:
    // var_name = input.int(default, ...)
    // var_name = input.float(default, ...)
    // var_name = input.bool(default, ...)
    // var_name = input(default, ...)
    const patterns = [
      // input.type(default, ...) pattern
      new RegExp(
        `(${escapeRegex(key)}\\s*=\\s*input\\.(?:int|float|bool|string)\\s*\\()([^,)]+)`,
        'g'
      ),
      // input(default, ...) pattern
      new RegExp(
        `(${escapeRegex(key)}\\s*=\\s*input\\s*\\()([^,)]+)`,
        'g'
      ),
    ];

    const replacement = typeof value === 'boolean'
      ? String(value)
      : typeof value === 'string'
        ? `"${value}"`
        : String(value);

    for (const pattern of patterns) {
      patched = patched.replace(pattern, `$1${replacement}`);
    }
  }

  return patched;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Write candles to a temporary cache directory that backtest-kit can read.
 * Returns the cache root and exchange name.
 */
async function materializeTempCache(candles, { symbol, timeframe, runId }) {
  const cacheRoot = path.join(PROJECT_ROOT, 'pine', 'dump', 'data', 'candle');
  const exchangeName = 'champion-tester';
  const cacheDir = path.join(cacheRoot, exchangeName, symbol, timeframe);
  await fs.mkdir(cacheDir, { recursive: true });

  // Write each candle as individual file (matching existing cache format)
  for (const candle of candles) {
    const filePath = path.join(cacheDir, `${candle.timestamp}.json`);
    await fs.writeFile(filePath, JSON.stringify(candle, null, 2), 'utf8');
  }

  return { cacheRoot, exchangeName, cacheDir };
}

/**
 * Clean up temp cache files after a run
 */
async function cleanupTempCache(cacheDir) {
  try {
    const files = await fs.readdir(cacheDir);
    for (const file of files) {
      await fs.unlink(path.join(cacheDir, file));
    }
    await fs.rmdir(cacheDir);
  } catch {
    // best effort cleanup
  }
}

/**
 * Run a pine strategy and analyze results.
 * Returns metrics object.
 */
function runNodeScript(args, cwd, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`Process exited with code ${code}\n${stderr}`));
    });
  });
}

/**
 * Run the champion strategy against a dataset.
 * 
 * @param {object} opts
 * @param {string} opts.matrixId - Autoresearch matrix to load champion from
 * @param {object} opts.dataset - Full dataset object
 * @param {object} opts.slice - Slice options: { lastN, fromIndex, toIndex, fromTimestamp, toTimestamp }
 * @param {function} opts.onProgress - Progress callback
 * @returns {object} - { metrics, score, diagnostics, tradeCount, ... }
 */
export async function runChampionTest({
  matrixId,
  dataset,
  slice = {},
  onProgress = null,
  timeoutMs = 120_000,
}) {
  // Mutex: only one test at a time
  if (_running) {
    throw Object.assign(
      new Error('A test is already running. Please wait.'),
      { code: 'RUN_IN_PROGRESS' }
    );
  }

  _running = true;
  _runningSymbol = dataset.symbol;
  _runningStartedAt = Date.now();
  const startTime = Date.now();

  try {
  const runId = randomUUID().slice(0, 8);
  const champion = await loadChampion(matrixId);
  const scriptPath = getScriptPath(matrixId, PROJECT_ROOT);

  if (onProgress) onProgress({ phase: 'prepare', message: 'Loading champion and script...' });

  // Read and patch the pine script
  const source = await fs.readFile(scriptPath, 'utf8');
  const patchedSource = applyConfigToSource(source, champion.config);

  // Slice the dataset
  const candles = sliceDataset(dataset.candles, slice);
  if (candles.length === 0) {
    throw new Error('No candles in the selected range');
  }

  if (onProgress) onProgress({ phase: 'cache', message: `Materializing ${candles.length} candles to cache...` });

  // Write patched script to temp file
  const tempDir = path.join(PROJECT_ROOT, 'pine', 'dump', 'champion-tester-runs');
  await fs.mkdir(tempDir, { recursive: true });
  const tempScriptPath = path.join(tempDir, `run-${runId}.pine`);
  await fs.writeFile(tempScriptPath, patchedSource, 'utf8');

  // Materialize candles to cache
  const { cacheRoot, exchangeName, cacheDir } = await materializeTempCache(candles, {
    symbol: dataset.symbol,
    timeframe: dataset.timeframe,
    runId,
  });

  // Compute "when" as the last candle timestamp + 1 step (exclusive end)
  const TIMEFRAME_MS = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '45m': 2_700_000, '1h': 3_600_000, '2h': 7_200_000,
    '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000, '12h': 43_200_000,
    '1d': 86_400_000, '1w': 604_800_000,
  };
  const stepMs = TIMEFRAME_MS[dataset.timeframe];
  const when = new Date(candles[candles.length - 1].timestamp + stepMs).toISOString();

  if (onProgress) onProgress({ phase: 'run', message: `Running strategy on ${dataset.symbol} ${dataset.timeframe} (${candles.length} bars)...` });

  try {
    // Run pine-import-run-clean
    const cliScript = path.resolve(PROJECT_ROOT, 'scripts', 'pine-import-run-clean.mjs');
    const outputBase = `champion-test-${runId}`;

    await runNodeScript([
      cliScript,
      '--input', tempScriptPath,
      '--symbol', dataset.symbol,
      '--timeframe', dataset.timeframe,
      '--limit', String(candles.length),
      '--when', when,
      '--require-cache-complete',
      '--cache-root', cacheRoot,
      '--cache-exchange', exchangeName,
      '--output', outputBase,
    ], PROJECT_ROOT);

    // Read and analyze results
    const dumpDir = path.join(path.dirname(tempScriptPath), 'dump');
    const cleanedPath = path.join(dumpDir, `${outputBase}.cleaned.jsonl`);

    if (onProgress) onProgress({ phase: 'analyze', message: 'Analyzing results...' });

    // Use the worker to analyze
    const workerScript = path.resolve(PROJECT_ROOT, 'scripts', 'pine-evaluate-candidate-worker.mjs');
    const payload = JSON.stringify({
      command: 'analyze-jsonl-streaming',
      filePath: cleanedPath,
      options: { minTrades: 1 },
    });

    const result = await runNodeScript(
      [workerScript],
      PROJECT_ROOT,
    ).catch(async () => {
      // Worker might fail if no trades — try direct read
      return { stdout: '{}', stderr: '' };
    });

    // Use the streaming metrics (statically imported above)

    let analysis;
    try {
      analysis = await analyzeJsonlFileStreaming(cleanedPath, { minTrades: 1 });
    } catch (err) {
      analysis = { metrics: {}, score: 0, breakdown: {}, diagnostics: {}, rowCount: 0 };
    }

    // Extract trades and build equity curve from the streaming analysis.
    // analyzeJsonlFileStreaming uses createIncrementalTradeSimulator which
    // produces full trade objects via buildTrade(). We re-run the simulator
    // to capture the trades array (analyzeJsonlFileStreaming doesn't expose it
    // in its return value — it only passes trades to calculateMetrics).
    let trades = [];
    let equityCurve = [];
    try {
      const tradeSimulator = createIncrementalTradeSimulator({ minTrades: 1 });
      let lastRow = null;
      for await (const row of iterateJsonlRows(cleanedPath)) {
        if (row && row.timestamp && Number.isFinite(row.Close)) {
          lastRow = row;
        }
        tradeSimulator.push(row);
      }
      const simResult = tradeSimulator.finalize(lastRow);
      trades = simResult.trades.map(t => ({
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        side: t.side,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        barsHeld: t.holdBars,
      }));

      // Build equity curve: cumulative PnL at each trade exit
      let cumPnl = 0;
      equityCurve = trades.map(t => {
        cumPnl += t.pnl;
        return { timestamp: t.exitTime, equity: cumPnl };
      });
    } catch {
      // If trade extraction fails, leave empty arrays
      trades = [];
      equityCurve = [];
    }

    // Cleanup temp files
    await safeUnlink(tempScriptPath);
    await safeUnlink(tempScriptPath.replace(/\.pine$/, '.flattened.pine'));
    const dumpFiles = [
      path.join(dumpDir, `${outputBase}.jsonl`),
      path.join(dumpDir, `${outputBase}.cleaned.jsonl`),
      path.join(dumpDir, `${outputBase}.signals.jsonl`),
    ];
    for (const f of dumpFiles) await safeUnlink(f);

    // Cleanup temp cache
    await cleanupTempCache(cacheDir);

    return {
      ok: true,
      runId,
      timestamp: new Date(startTime).toISOString(),
      durationMs: Date.now() - startTime,
      champion: {
        matrixId,
        configId: champion.configId,
        label: champion.label,
      },
      dataset: {
        tvSymbol: dataset.tvSymbol,
        symbol: dataset.symbol,
        exchange: dataset.exchange,
        timeframe: dataset.timeframe,
        candlesUsed: candles.length,
        from: new Date(candles[0].timestamp).toISOString(),
        to: new Date(candles[candles.length - 1].timestamp).toISOString(),
      },
      score: analysis.score || 0,
      metrics: analysis.metrics || {},
      breakdown: analysis.breakdown || {},
      diagnostics: analysis.diagnostics || {},
      rowCount: analysis.rowCount || 0,
      trades,
      equityCurve,
    };
  } catch (err) {
    // Cleanup on failure
    await safeUnlink(tempScriptPath);
    await safeUnlink(tempScriptPath.replace(/\.pine$/, '.flattened.pine'));
    await cleanupTempCache(cacheDir);

    return {
      ok: false,
      runId,
      timestamp: new Date(startTime).toISOString(),
      durationMs: Date.now() - startTime,
      error: err.message || String(err),
      champion: { matrixId, configId: champion.configId },
      dataset: {
        tvSymbol: dataset.tvSymbol,
        symbol: dataset.symbol,
        timeframe: dataset.timeframe,
        candlesUsed: candles.length,
      },
      trades: [],
      equityCurve: [],
    };
  }
  } finally {
    _running = false;
    _runningSymbol = null;
    _runningStartedAt = null;
  }
}

async function safeUnlink(filePath) {
  try { await fs.unlink(filePath); } catch { /* ignore */ }
}

/**
 * Run champion against multiple symbols (batch sweep)
 */
export async function runChampionSweep({
  matrixId,
  datasets,
  slice = {},
  onProgress = null,
}) {
  const results = [];

  for (let i = 0; i < datasets.length; i++) {
    const dataset = datasets[i];
    if (onProgress) onProgress({
      phase: 'sweep',
      message: `Testing ${dataset.tvSymbol} (${i + 1}/${datasets.length})...`,
      current: i + 1,
      total: datasets.length,
    });

    const result = await runChampionTest({ matrixId, dataset, slice, onProgress: null });
    results.push(result);
  }

  return results;
}
