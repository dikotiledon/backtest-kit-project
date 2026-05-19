import crypto from 'node:crypto';
import { runChampionTest, getRunStatus, cancelRunningTest } from './strategy-runner.mjs';
import { readDataset, datasetPath } from './dataset-manager.mjs';

// Module-level state
let _sweepRunning = false;
let _sweepId = null;
let _sweepProgress = null;
let _sweepCancelled = false;
let _sweepLastResult = null;

/**
 * Get current sweep status.
 */
export function getSweepStatus() {
  if (!_sweepRunning) {
    return _sweepLastResult
      ? { running: false, lastResult: _sweepLastResult }
      : { running: false };
  }
  return {
    running: true,
    sweepId: _sweepId,
    ..._sweepProgress,
    elapsedMs: Date.now() - _sweepProgress.startedAt,
  };
}

/**
 * Cancel the current sweep run.
 */
export async function cancelSweep() {
  _sweepCancelled = true;
  cancelRunningTest();
  return { ok: true };
}

/**
 * Run champion strategy against multiple datasets sequentially.
 */
export async function runSweep({ matrixId, datasets, dataDir, onProgress, timeoutMs = 120_000 }) {
  if (_sweepRunning) {
    const err = new Error('Sweep already in progress');
    err.code = 'SWEEP_IN_PROGRESS';
    throw err;
  }
  if (getRunStatus().running) {
    const err = new Error('A champion test run is already in progress');
    err.code = 'RUN_IN_PROGRESS';
    throw err;
  }

  _sweepRunning = true;
  _sweepCancelled = false;
  _sweepId = crypto.randomUUID();

  const startedAt = Date.now();
  _sweepProgress = { completed: 0, total: datasets.length, current: null, results: [], startedAt };

  try {
    for (let i = 0; i < datasets.length; i++) {
      if (_sweepCancelled) break;

      const d = datasets[i];
      _sweepProgress.current = d;

      try {
        const filePath = datasetPath(dataDir, d.exchange, d.symbol, d.timeframe);
        const dataset = await readDataset(filePath);

        if (dataset == null) {
          _sweepProgress.results.push({ ok: false, error: 'Dataset not found or empty', dataset: d });
        } else {
          const result = await runChampionTest({ matrixId, dataset, timeoutMs });
          _sweepProgress.results.push(result);
        }
      } catch (err) {
        _sweepProgress.results.push({ ok: false, error: err.message, dataset: d });
      }

      _sweepProgress.completed = i + 1;
      if (onProgress) onProgress(getSweepStatus());
    }

    // Build summary
    const totalTime = Date.now() - startedAt;
    const results = _sweepProgress.results;
    // netProfit lives inside result.metrics, not at top level
    const successfulResults = results.filter(r => r.ok !== false && r.metrics?.netProfit != null);

    let avgNetProfit = null;
    let bestSymbol = null;
    let worstSymbol = null;

    if (successfulResults.length > 0) {
      const totalProfit = successfulResults.reduce((sum, r) => sum + r.metrics.netProfit, 0);
      avgNetProfit = totalProfit / successfulResults.length;

      const sorted = [...successfulResults].sort((a, b) => b.metrics.netProfit - a.metrics.netProfit);
      bestSymbol = sorted[0]?.dataset?.symbol ?? null;
      worstSymbol = sorted[sorted.length - 1]?.dataset?.symbol ?? null;
    }

    const finalResult = {
      running: false,
      sweepId: _sweepId,
      totalTime,
      completed: _sweepProgress.completed,
      total: _sweepProgress.total,
      cancelled: _sweepCancelled,
      avgNetProfit,
      bestSymbol,
      worstSymbol,
      results,
    };
    _sweepLastResult = finalResult;
    if (onProgress) onProgress(finalResult);
    return finalResult;
  } finally {
    _sweepRunning = false;
    _sweepId = null;
    _sweepProgress = null;
    _sweepCancelled = false;
  }
}
