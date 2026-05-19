/**
 * Strategy Runner
 * 
 * Executes the champion pine strategy against a dataset slice.
 * Reuses the existing pine-import-run-clean pipeline but with
 * dataset-provided candles written to a temp cache.
 *
 * Key design:
 * - Candles are written to temp cache using aligned timestamps
 *   matching what pine-import-run-clean expects via validatePinnedCacheComplete.
 * - Execution is async: callers get a runId immediately, poll for status.
 * - Run state is persisted to disk so page refresh doesn't lose it.
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
import { normalizeMetrics, normalizeResult } from './metric-normalizer.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const STATE_DIR = path.resolve(import.meta.dirname, '..', '.run-state');

// --- Run status tracking (mutex) ---
let _running = false;
let _runningSymbol = null;
let _runningStartedAt = null;
let _runningRunId = null;
let _lastResult = null;
let _runningChildPid = null;
let _cancelRequested = false;

async function persistRunState(state) {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(STATE_DIR, 'current-run.json'),
      JSON.stringify(state, null, 2), 'utf8'
    );
  } catch { /* best effort */ }
}

async function clearRunState() {
  try {
    await fs.unlink(path.join(STATE_DIR, 'current-run.json'));
  } catch { /* ignore */ }
}

async function persistLastResult(result) {
  try {
    await fs.mkdir(STATE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(STATE_DIR, 'last-result.json'),
      JSON.stringify(result, null, 2), 'utf8'
    );
  } catch { /* best effort */ }
}

export async function loadPersistedState() {
  try {
    const raw = await fs.readFile(path.join(STATE_DIR, 'current-run.json'), 'utf8');
    const state = JSON.parse(raw);
    // If server restarted while a run was in progress, mark it as failed
    if (state && state.running) {
      await clearRunState();
      return { running: false, lastAborted: state };
    }
    return { running: false };
  } catch {
    return { running: false };
  }
}

export async function loadLastResult() {
  try {
    const raw = await fs.readFile(path.join(STATE_DIR, 'last-result.json'), 'utf8');
    const result = JSON.parse(raw);
    _lastResult = result; // Hydrate in-memory state
    return result;
  } catch {
    return null;
  }
}

export function getRunStatus() {
  if (!_running) {
    return { running: false, lastResult: _lastResult };
  }
  return {
    running: true,
    runId: _runningRunId,
    symbol: _runningSymbol,
    startedAt: _runningStartedAt,
    elapsedMs: Date.now() - _runningStartedAt,
  };
}

/**
 * Cancel the currently running test by killing the child process.
 */
export function cancelRunningTest() {
  if (!_running) return false;
  _cancelRequested = true;
  if (_runningChildPid) {
    try { process.kill(_runningChildPid, 'SIGKILL'); } catch { /* already dead */ }
  }
  return true;
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
 * 
 * CRITICAL: The cache files must be named by the EXACT timestamps that
 * validatePinnedCacheComplete will look for. That function uses
 * expectedCandleTimestamps() which computes:
 *   alignedWhen = floor(when / step) * step
 *   since = alignedWhen - (limit * step)
 *   timestamps = [since, since+step, since+2*step, ...]
 *
 * So we must ensure our candles' timestamps align to the timeframe grid.
 * Dataset candles from ccxt are already aligned, but we verify and re-align
 * to be safe.
 */
async function materializeTempCache(candles, { symbol, timeframe, runId }) {
  const cacheRoot = path.join(PROJECT_ROOT, 'pine', 'dump', 'data', 'candle');
  const exchangeName = 'champion-tester';
  const cacheDir = path.join(cacheRoot, exchangeName, symbol, timeframe);
  await fs.mkdir(cacheDir, { recursive: true });

  const TIMEFRAME_MS_LOCAL = {
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '45m': 2_700_000, '1h': 3_600_000, '2h': 7_200_000,
    '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000, '12h': 43_200_000,
    '1d': 86_400_000, '1w': 604_800_000,
  };
  const stepMs = TIMEFRAME_MS_LOCAL[timeframe] || 900_000;

  // Write each candle, aligning timestamp to the grid
  for (const candle of candles) {
    const alignedTs = Math.floor(candle.timestamp / stepMs) * stepMs;
    const alignedCandle = { ...candle, timestamp: alignedTs };
    const filePath = path.join(cacheDir, `${alignedTs}.json`);
    await fs.writeFile(filePath, JSON.stringify(alignedCandle, null, 2), 'utf8');
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
    _runningChildPid = child.pid;
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

    child.on('error', (err) => { clearTimeout(timer); _runningChildPid = null; reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      _runningChildPid = null;
      if (killed) return;
      if (_cancelRequested) {
        reject(new Error('Test cancelled by user'));
        return;
      }
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

  const runId = randomUUID().slice(0, 8);
  const startTime = Date.now();

  _running = true;
  _runningSymbol = dataset.symbol;
  _runningStartedAt = startTime;
  _runningRunId = runId;

  await persistRunState({
    running: true,
    runId,
    symbol: dataset.symbol,
    startedAt: startTime,
    matrixId,
  });

  let tempScriptPath = null;
  let cacheDir = null;

  try {
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

    // Timeframe step
    const TIMEFRAME_MS = {
      '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
      '30m': 1_800_000, '45m': 2_700_000, '1h': 3_600_000, '2h': 7_200_000,
      '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000, '12h': 43_200_000,
      '1d': 86_400_000, '1w': 604_800_000,
    };
    const stepMs = TIMEFRAME_MS[dataset.timeframe];
    if (!stepMs) throw new Error(`Unsupported timeframe: ${dataset.timeframe}`);

    // Align candles to the timeframe grid (dedup + sort)
    // This ensures cache filenames match what validatePinnedCacheComplete expects.
    const alignedCandles = [];
    const seenTs = new Set();
    for (const c of candles) {
      const aligned = Math.floor(c.timestamp / stepMs) * stepMs;
      if (!seenTs.has(aligned)) {
        seenTs.add(aligned);
        alignedCandles.push({ ...c, timestamp: aligned });
      }
    }
    alignedCandles.sort((a, b) => a.timestamp - b.timestamp);

    if (alignedCandles.length === 0) {
      throw new Error('No valid candles after alignment');
    }

    // Check for gaps in the sequence
    let hasGaps = false;
    for (let i = 1; i < alignedCandles.length; i++) {
      if (alignedCandles[i].timestamp - alignedCandles[i - 1].timestamp !== stepMs) {
        hasGaps = true;
        break;
      }
    }

    // Compute "when" — exclusive end boundary for the pinned window.
    // validatePinnedCacheComplete expects:
    //   alignedWhen = floor(when / step) * step
    //   since = alignedWhen - (limit * step)
    //   expected timestamps = [since, since+step, ..., alignedWhen - step]
    const when = new Date(alignedCandles[alignedCandles.length - 1].timestamp + stepMs).toISOString();

    if (onProgress) onProgress({ phase: 'cache', message: `Materializing ${alignedCandles.length} candles to cache...` });

    // Write patched script to temp file
    const tempDir = path.join(PROJECT_ROOT, 'pine', 'dump', 'champion-tester-runs');
    await fs.mkdir(tempDir, { recursive: true });
    tempScriptPath = path.join(tempDir, `run-${runId}.pine`);
    await fs.writeFile(tempScriptPath, patchedSource, 'utf8');

    // Materialize aligned candles to cache
    const materialized = await materializeTempCache(alignedCandles, {
      symbol: dataset.symbol,
      timeframe: dataset.timeframe,
      runId,
    });
    cacheDir = materialized.cacheDir;

    if (onProgress) onProgress({ phase: 'run', message: `Running strategy on ${dataset.symbol} ${dataset.timeframe} (${alignedCandles.length} bars)...` });

    // Run pine-import-run-clean
    const cliScript = path.resolve(PROJECT_ROOT, 'scripts', 'pine-import-run-clean.mjs');
    const outputBase = `champion-test-${runId}`;

    const cliArgs = [
      cliScript,
      '--input', tempScriptPath,
      '--symbol', dataset.symbol,
      '--timeframe', dataset.timeframe,
      '--limit', String(alignedCandles.length),
      '--when', when,
      '--cache-root', materialized.cacheRoot,
      '--cache-exchange', materialized.exchangeName,
      '--output', outputBase,
    ];

    // Only require cache complete if candles are sequential (no gaps)
    if (!hasGaps) {
      cliArgs.push('--require-cache-complete');
    }

    await runNodeScript(cliArgs, PROJECT_ROOT, timeoutMs);

    // Read and analyze results
    // pine-import-run-clean writes output to {scriptDir}/dump/{outputBase}.*.jsonl
    const dumpDir = path.join(path.dirname(tempScriptPath), 'dump');
    const cleanedPath = path.join(dumpDir, `${outputBase}.cleaned.jsonl`);

    // Verify the cleaned file exists before analyzing
    try {
      await fs.access(cleanedPath);
    } catch {
      throw new Error(`Strategy execution produced no output. Expected: ${cleanedPath}`);
    }

    if (onProgress) onProgress({ phase: 'analyze', message: 'Analyzing results...' });

    // Analyze with streaming metrics
    let analysis;
    try {
      analysis = await analyzeJsonlFileStreaming(cleanedPath, { minTrades: 1 });
    } catch {
      analysis = { metrics: {}, score: 0, breakdown: {}, diagnostics: {}, rowCount: 0 };
    }

    // Extract trades and build equity curve
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
    await cleanupTempCache(cacheDir);
    tempScriptPath = null;
    cacheDir = null;

    const successResult = normalizeResult({
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
        candlesUsed: alignedCandles.length,
        from: new Date(alignedCandles[0].timestamp).toISOString(),
        to: new Date(alignedCandles[alignedCandles.length - 1].timestamp).toISOString(),
      },
      score: analysis.score || 0,
      metrics: normalizeMetrics(analysis.metrics || {}),
      breakdown: analysis.breakdown || {},
      diagnostics: analysis.diagnostics || {},
      rowCount: analysis.rowCount || 0,
      trades,
      equityCurve,
    });

    _lastResult = successResult;
    await persistLastResult(successResult);
    return successResult;

  } catch (err) {
    // Cleanup on failure
    if (tempScriptPath) {
      await safeUnlink(tempScriptPath);
      await safeUnlink(tempScriptPath.replace(/\.pine$/, '.flattened.pine'));
    }
    if (cacheDir) await cleanupTempCache(cacheDir);

    const failResult = {
      ok: false,
      runId,
      timestamp: new Date(startTime).toISOString(),
      durationMs: Date.now() - startTime,
      error: err.message || String(err),
      champion: { matrixId },
      dataset: {
        tvSymbol: dataset.tvSymbol,
        symbol: dataset.symbol,
        timeframe: dataset.timeframe,
      },
      trades: [],
      equityCurve: [],
    };
    _lastResult = failResult;
    await persistLastResult(failResult);
    return failResult;

  } finally {
    _running = false;
    _runningSymbol = null;
    _runningStartedAt = null;
    _runningRunId = null;
    _runningChildPid = null;
    _cancelRequested = false;
    await clearRunState();
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
