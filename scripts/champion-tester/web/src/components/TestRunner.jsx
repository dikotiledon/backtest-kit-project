import { useState, useEffect, useRef } from 'react';
import { useDatasets } from '../hooks/useDatasets.js';
import { useChampions } from '../hooks/useChampions.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { Play, Clock, AlertCircle, CheckCircle2, Loader2, Zap, Scissors, XCircle } from 'lucide-react';
import api from '../api.js';
import MetricsCard from './MetricsCard.jsx';
import { formatNumber, formatPercent, normalizeResultMetrics } from '../utils/metrics.js';

export default function TestRunner() {
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [selectedChampion, setSelectedChampion] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [elapsedMs, setElapsedMs] = useState(0);

  // Slice controls
  const [sliceMode, setSliceMode] = useState('lastN'); // 'all' | 'lastN' | 'range'
  const [lastN, setLastN] = useState(2000);
  const [fromIndex, setFromIndex] = useState(0);
  const [toIndex, setToIndex] = useState(0);

  const { champions, loading: champLoading } = useChampions();
  const { datasets, loading: dsLoading } = useDatasets();
  const { connected, subscribe } = useWebSocket();
  const intervalRef = useRef(null);

  // Start elapsed timer
  const startTimer = (initialMs = 0) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setElapsedMs(initialMs);
    const startedAt = Date.now() - initialMs;
    intervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);
  };

  const stopTimer = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    // On WebSocket connect, recover running state
    const unsubConnected = subscribe('connected', (data) => {
      const runStatus = data.data?.runStatus;
      if (runStatus?.running) {
        setRunning(true);
        setPhase('executing');
        setError(null);
        startTimer(runStatus.elapsedMs || 0);
      } else if (runStatus?.lastResult) {
        // Show last result if available
        const normalized = normalizeResultMetrics(runStatus.lastResult);
        setResult(normalized);
        setPhase(normalized.ok ? 'complete' : 'idle');
      }
    });

    const unsubStart = subscribe('test:start', () => {
      setPhase('executing');
      setError(null);
      startTimer(0);
    });

    const unsubComplete = subscribe('test:complete', (data) => {
      setPhase('complete');
      stopTimer();
      if (data.data?.result) {
        const normalized = normalizeResultMetrics(data.data.result);
        setResult(normalized);
        if (!normalized.ok) {
          setError(normalized.error || 'Test failed');
        }
      }
      setRunning(false);
    });

    const unsubError = subscribe('test:error', (data) => {
      setPhase('idle');
      stopTimer();
      setError(data.data?.error || 'Test run failed');
      setRunning(false);
    });

    return () => {
      unsubConnected();
      unsubStart();
      unsubComplete();
      unsubError();
      stopTimer();
    };
  }, [subscribe]);

  // Also poll status on mount to catch running state before WS connects
  useEffect(() => {
    api.getTestStatus().then((status) => {
      if (status.running) {
        setRunning(true);
        setPhase('executing');
        startTimer(status.elapsedMs || 0);
      } else if (status.lastResult) {
        const normalized = normalizeResultMetrics(status.lastResult);
        setResult(normalized);
        setPhase(normalized.ok ? 'complete' : 'idle');
      }
    }).catch(() => {});
  }, []);

  const handleRun = async () => {
    if (!selectedChampion || !selectedDataset) return;

    setRunning(true);
    setResult(null);
    setError(null);
    setPhase('starting');
    setElapsedMs(0);

    try {
      const dataset = datasets.find((d) => d.id === selectedDataset);
      const symbol = dataset.tvSymbol || `${dataset.exchange}:${dataset.symbol}`;

      // Build slice from controls
      let slice = {};
      if (sliceMode === 'lastN') {
        slice = { lastN: Number(lastN) || 2000 };
      } else if (sliceMode === 'range') {
        slice = { fromIndex: Number(fromIndex) || 0, toIndex: Number(toIndex) || (dataset.candles - 1) };
      }
      // 'all' = empty slice = use all candles
      // 'all' = empty slice = use all candles

      await api.runTest(selectedChampion, symbol, dataset.timeframe, slice);
      setPhase('executing');
      startTimer(0);
    } catch (err) {
      setError(err.message || 'Test run failed');
      setPhase('idle');
      setRunning(false);
      stopTimer();
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancelTest();
      setPhase('idle');
      setRunning(false);
      stopTimer();
      setError('Test cancelled by user');
    } catch (err) {
      setError(err.message || 'Failed to cancel');
    }
  };

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const selectedDatasetObj = datasets?.find((d) => d.id === selectedDataset);
  const loading = champLoading || dsLoading;

  // Reset slice range when dataset changes
  useEffect(() => {
    if (selectedDatasetObj) {
      setToIndex((selectedDatasetObj.candles || 1) - 1);
      setFromIndex(0);
    }
  }, [selectedDataset]);

  return (
    <div className="space-y-6">
      {/* Configuration Panel */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-6">
        <h3 className="text-sm font-semibold text-gray-200 mb-5 flex items-center gap-2">
          <Zap size={14} className="text-accent" />
          Test Configuration
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Champion Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Champion Strategy</label>
            {champLoading ? (
              <div className="skeleton h-10 rounded-lg" />
            ) : (
              <select
                className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                value={selectedChampion}
                onChange={(e) => setSelectedChampion(e.target.value)}
              >
                <option value="">Select a champion...</option>
                {champions?.map((c) => (
                  <option key={c.matrixId} value={c.matrixId}>
                    {c.matrixId}
                  </option>
                ))}
              </select>
            )}
            {champions?.length === 0 && !champLoading && (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertCircle size={12} />
                No champions available
              </p>
            )}
          </div>

          {/* Dataset Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Dataset</label>
            {dsLoading ? (
              <div className="skeleton h-10 rounded-lg" />
            ) : (
              <select
                className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                value={selectedDataset || ''}
                onChange={(e) => setSelectedDataset(e.target.value || null)}
              >
                <option value="">Select a dataset...</option>
                {datasets?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.exchange}:{d.symbol} {d.timeframe} ({d.candles?.toLocaleString()} candles)
                  </option>
                ))}
              </select>
            )}
            {datasets?.length === 0 && !dsLoading && (
              <p className="text-xs text-warning flex items-center gap-1">
                <AlertCircle size={12} />
                No datasets available. Fetch one first.
              </p>
            )}
          </div>
        </div>

        {/* Selected dataset info */}
        {selectedDatasetObj && (
          <div className="mt-4 p-3 rounded-lg bg-surface-2 border border-border-subtle flex items-center gap-4 text-xs text-gray-400">
            <span className="font-mono text-gray-300">{selectedDatasetObj.exchange}:{selectedDatasetObj.symbol}</span>
            <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">{selectedDatasetObj.timeframe}</span>
            <span>{selectedDatasetObj.candles?.toLocaleString()} candles</span>
            {selectedDatasetObj.lastUpdated && (
              <span className="text-gray-500">Updated: {new Date(selectedDatasetObj.lastUpdated).toLocaleDateString()}</span>
            )}
          </div>
        )}

        {/* Slice Controls */}
        {selectedDatasetObj && (
          <div className="mt-4 p-4 rounded-lg bg-surface-2 border border-border-subtle space-y-3">
            <div className="flex items-center gap-4">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Data Range</label>
              <div className="flex gap-2">
                {['lastN', 'range', 'all'].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSliceMode(mode)}
                    className={`px-3 py-1 text-xs rounded-md border transition-all ${
                      sliceMode === mode
                        ? 'bg-accent/20 border-accent/40 text-accent'
                        : 'bg-surface-3 border-border-subtle text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {mode === 'lastN' ? 'Last N' : mode === 'range' ? 'Index Range' : 'All'}
                  </button>
                ))}
              </div>
            </div>

            {sliceMode === 'lastN' && (
              <div className="flex items-center gap-3">
                <label className="text-xs text-gray-400 w-24">Last candles:</label>
                <input
                  type="number"
                  min={100}
                  max={selectedDatasetObj.candles || 50000}
                  value={lastN}
                  onChange={(e) => setLastN(e.target.value)}
                  className="w-32 bg-surface-3 border border-border-default rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <span className="text-xs text-gray-500">of {selectedDatasetObj.candles?.toLocaleString()}</span>
              </div>
            )}

            {sliceMode === 'range' && (
              <div className="flex items-center gap-3 flex-wrap">
                <label className="text-xs text-gray-400 w-24">From index:</label>
                <input
                  type="number"
                  min={0}
                  max={(selectedDatasetObj.candles || 1) - 1}
                  value={fromIndex}
                  onChange={(e) => setFromIndex(e.target.value)}
                  className="w-28 bg-surface-3 border border-border-default rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <label className="text-xs text-gray-400">To:</label>
                <input
                  type="number"
                  min={0}
                  max={(selectedDatasetObj.candles || 1) - 1}
                  value={toIndex}
                  onChange={(e) => setToIndex(e.target.value)}
                  className="w-28 bg-surface-3 border border-border-default rounded-md px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <span className="text-xs text-gray-500">
                  = {Math.max(0, (Number(toIndex) || 0) - (Number(fromIndex) || 0) + 1)} candles
                </span>
              </div>
            )}

            {sliceMode === 'all' && (
              <p className="text-xs text-gray-500">Using all {selectedDatasetObj.candles?.toLocaleString()} candles</p>
            )}
          </div>
        )}

        {/* Run Button */}
        <div className="mt-5 flex items-center gap-4">
          <button
            className="px-6 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all shadow-sm shadow-accent/20 hover:shadow-md hover:shadow-accent/30 flex items-center gap-2"
            disabled={running || !selectedChampion || !selectedDataset}
            onClick={handleRun}
          >
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play size={14} />
                Run Test
              </>
            )}
          </button>

          {/* Cancel Button */}
          {running && (
            <button
              className="px-4 py-2.5 bg-error/10 hover:bg-error/20 border border-error/30 text-error text-sm font-medium rounded-lg transition-all flex items-center gap-2"
              onClick={handleCancel}
            >
              <XCircle size={14} />
              Cancel
            </button>
          )}

          {/* Status indicator */}
          {phase !== 'idle' && (
            <div className="flex items-center gap-2 text-sm">
              {phase === 'starting' && (
                <>
                  <Loader2 size={14} className="animate-spin text-accent" />
                  <span className="text-gray-400">Starting...</span>
                </>
              )}
              {phase === 'executing' && (
                <>
                  <Loader2 size={14} className="animate-spin text-warning" />
                  <span className="text-warning">Executing</span>
                  <span className="font-mono text-gray-400">{formatDuration(elapsedMs)}</span>
                </>
              )}
              {phase === 'complete' && (
                <>
                  <CheckCircle2 size={14} className="text-success" />
                  <span className="text-success">Complete</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-error/5 border border-error/20">
          <AlertCircle size={16} className="text-error shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-error">Test Failed</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Results Display */}
      {result && result.ok && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-success" />
              Test Results
            </h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Clock size={12} />
              {formatDuration(result.durationMs)}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricsCard
              label="Net Profit"
              value={formatNumber(result.metrics?.netProfit)}
              color={(result.metrics?.netProfit ?? 0) >= 0 ? 'green' : 'red'}
              compact
            />
            <MetricsCard
              label="Win Rate"
              value={formatPercent(result.metrics?.winRate)}
              color={(result.metrics?.winRate ?? 0) > 50 ? 'green' : 'yellow'}
              compact
            />
            <MetricsCard
              label="Total Trades"
              value={result.metrics?.totalTrades ?? '—'}
              color="blue"
              compact
            />
            <MetricsCard
              label="Max Drawdown"
              value={formatNumber(result.metrics?.maxDrawdown)}
              color="red"
              compact
            />
            <MetricsCard
              label="Profit Factor"
              value={formatNumber(result.metrics?.profitFactor)}
              color={(result.metrics?.profitFactor ?? 0) > 1 ? 'green' : 'yellow'}
              compact
            />
            <MetricsCard
              label="Sharpe Ratio"
              value={formatNumber(result.metrics?.sharpeRatio)}
              color="cyan"
              compact
            />
          </div>
        </div>
      )}
    </div>
  );
}
