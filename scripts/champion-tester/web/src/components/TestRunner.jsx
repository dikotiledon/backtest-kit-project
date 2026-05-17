import { useState, useEffect, useRef } from 'react';
import { useDatasets } from '../hooks/useDatasets.js';
import { useChampions } from '../hooks/useChampions.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import api from '../api.js';
import MetricsCard from './MetricsCard.jsx';

export default function TestRunner() {
  const [selectedDataset, setSelectedDataset] = useState(null);
  const [selectedChampion, setSelectedChampion] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [elapsedMs, setElapsedMs] = useState(0);

  const { champions } = useChampions();
  const { datasets } = useDatasets();
  const { connected, subscribe } = useWebSocket();
  const intervalRef = useRef(null);

  // Subscribe to WebSocket events
  useEffect(() => {
    const unsubStart = subscribe('test:start', () => {
      setPhase('executing');
      setElapsedMs(0);
      intervalRef.current = setInterval(() => {
        setElapsedMs((prev) => prev + 500);
      }, 500);
    });

    const unsubComplete = subscribe('test:complete', (data) => {
      setPhase('complete');
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (data.result) {
        setResult(data.result);
      }
      setRunning(false);
    });

    return () => {
      unsubStart();
      unsubComplete();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [subscribe]);

  const handleRun = async () => {
    if (!selectedChampion || !selectedDataset) return;

    setRunning(true);
    setResult(null);
    setError(null);
    setPhase('starting');
    setElapsedMs(0);

    try {
      const dataset = datasets.find((d) => d.id === selectedDataset);
      const res = await api.runTest(selectedChampion, dataset.symbol, dataset.timeframe);
      setResult(res);
    } catch (err) {
      setError(err.message || 'Test run failed');
    } finally {
      setRunning(false);
    }
  };

  const formatDuration = (ms) => `${(ms / 1000).toFixed(2)}s`;

  const selectedDatasetObj = datasets?.find((d) => d.id === selectedDataset);

  return (
    <div className="bg-gray-900 text-gray-100 p-6 rounded-lg space-y-6">
      {/* Champion Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">Champion</label>
        <select
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
      </div>

      {/* Dataset Selector */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">Dataset</label>
        <select
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selectedDataset || ''}
          onChange={(e) => setSelectedDataset(e.target.value || null)}
        >
          <option value="">Select a dataset...</option>
          {datasets?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.exchange}:{d.symbol} {d.timeframe} ({d.candles} candles)
            </option>
          ))}
        </select>
      </div>

      {/* Run Button */}
      <div className="flex items-center gap-3">
        <button
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium transition-colors"
          disabled={running || !selectedChampion || !selectedDataset}
          onClick={handleRun}
        >
          {running ? 'Running...' : 'Run Test'}
        </button>
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          title={connected ? 'WebSocket connected' : 'WebSocket disconnected'}
        />
        {phase !== 'idle' && phase !== 'complete' && (
          <span className="text-sm text-gray-400">
            {phase === 'starting' ? 'Starting...' : `Executing... ${(elapsedMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-red-400 text-sm font-medium">{error}</div>
      )}

      {/* Results Display */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MetricsCard
            label="Net Profit"
            value={result.metrics.netProfit}
            color={result.metrics.netProfit >= 0 ? 'green' : 'red'}
          />
          <MetricsCard
            label="Win Rate"
            value={`${result.metrics.winRate}%`}
            color={result.metrics.winRate > 50 ? 'green' : 'red'}
          />
          <MetricsCard
            label="Total Trades"
            value={result.metrics.totalTrades}
            color="blue"
          />
          <MetricsCard
            label="Max Drawdown"
            value={result.metrics.maxDrawdown}
            color="red"
          />
          <MetricsCard
            label="Profit Factor"
            value={result.metrics.profitFactor}
            color={result.metrics.profitFactor > 1 ? 'green' : 'yellow'}
          />
          <MetricsCard
            label="Duration"
            value={formatDuration(result.durationMs)}
            color="blue"
          />
        </div>
      )}
    </div>
  );
}
