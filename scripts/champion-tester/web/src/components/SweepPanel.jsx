import { useState, useEffect } from 'react';
import { useDatasets } from '../hooks/useDatasets.js';
import { useChampions } from '../hooks/useChampions.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import api from '../api.js';
import MetricsCard from './MetricsCard.jsx';

export default function SweepPanel() {
  const [selectedChampion, setSelectedChampion] = useState('');
  const [selectedDatasets, setSelectedDatasets] = useState(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const { champions } = useChampions();
  const { datasets } = useDatasets();
  const { connected, subscribe } = useWebSocket();

  // WebSocket subscription for real-time sweep progress
  useEffect(() => {
    const unsub = subscribe('sweep:progress', (data) => {
      setProgress(data);
      if (!data.running) {
        setRunning(false);
        setResults(data.results || []);
      }
    });
    return unsub;
  }, [subscribe]);

  // Fallback polling at reduced interval (5s)
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(async () => {
      try {
        const status = await api.getSweepStatus();
        setProgress(status);
        if (!status.running) {
          setRunning(false);
          setResults(status.results || []);
          clearInterval(interval);
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch sweep status');
        setRunning(false);
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [running]);

  const handleSelectAll = () => {
    if (!datasets) return;
    setSelectedDatasets(new Set(datasets.map((_, i) => i)));
  };

  const handleClear = () => {
    setSelectedDatasets(new Set());
  };

  const toggleDataset = (index) => {
    setSelectedDatasets((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleRunSweep = async () => {
    if (!selectedChampion || selectedDatasets.size === 0) return;

    setRunning(true);
    setProgress(null);
    setResults(null);
    setError(null);

    try {
      const sweepDatasets = [...selectedDatasets].map((i) => datasets[i]);
      await api.runSweep(selectedChampion, sweepDatasets);
    } catch (err) {
      setError(err.message || 'Failed to start sweep');
      setRunning(false);
    }
  };

  const handleCancel = async () => {
    try {
      await api.cancelSweep();
      setRunning(false);
      setError('Sweep cancelled');
    } catch (err) {
      setError(err.message || 'Failed to cancel sweep');
    }
  };

  // Summary calculations
  const summary = results && results.length > 0 ? (() => {
    const profits = results.map((r) => r.metrics?.netProfit ?? 0);
    const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
    const bestIdx = profits.indexOf(Math.max(...profits));
    const worstIdx = profits.indexOf(Math.min(...profits));
    const totalTime = results.reduce((a, r) => a + (r.durationMs || 0), 0);
    return {
      avgProfit: avgProfit.toFixed(2),
      bestSymbol: results[bestIdx]?.symbol || '-',
      bestProfit: profits[bestIdx]?.toFixed(2),
      worstSymbol: results[worstIdx]?.symbol || '-',
      worstProfit: profits[worstIdx]?.toFixed(2),
      totalTime: (totalTime / 1000).toFixed(1) + 's',
    };
  })() : null;

  const progressPct = progress
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

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

      {/* Dataset Checklist */}
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-2">Datasets</label>
        <div className="flex gap-2 mb-2">
          <button
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            onClick={handleSelectAll}
          >
            Select All
          </button>
          <button
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            onClick={handleClear}
          >
            Clear
          </button>
        </div>
        <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-700 rounded p-2">
          {datasets?.map((d, i) => (
            <label key={d.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-800 px-2 py-1 rounded">
              <input
                type="checkbox"
                checked={selectedDatasets.has(i)}
                onChange={() => toggleDataset(i)}
                className="accent-blue-500"
              />
              <span className="text-sm">
                {d.exchange}:{d.symbol} {d.timeframe} ({d.candles} candles)
              </span>
            </label>
          ))}
          {(!datasets || datasets.length === 0) && (
            <p className="text-sm text-gray-500">No datasets available</p>
          )}
        </div>
      </div>

      {/* Run Sweep Button */}
      <div className="flex items-center gap-3">
        <button
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded font-medium transition-colors"
          disabled={running || !selectedChampion || selectedDatasets.size === 0}
          onClick={handleRunSweep}
        >
          {running ? 'Running Sweep...' : 'Run Sweep'}
        </button>
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}
          title={connected ? 'WebSocket connected' : 'WebSocket disconnected'}
        />
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-red-400 text-sm font-medium">{error}</div>
      )}

      {/* Progress Section */}
      {running && progress && (
        <div className="space-y-2">
          <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>{progress.completed}/{progress.total} completed</span>
            {progress.currentSymbol && <span>Current: {progress.currentSymbol}</span>}
          </div>
          <button
            className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 rounded transition-colors"
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Results Section */}
      {summary && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-200">Sweep Results</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricsCard
              label="Avg Net Profit"
              value={summary.avgProfit}
              color={parseFloat(summary.avgProfit) >= 0 ? 'green' : 'red'}
            />
            <MetricsCard
              label="Best Symbol"
              value={summary.bestSymbol}
              subtitle={`Profit: ${summary.bestProfit}`}
              color="green"
            />
            <MetricsCard
              label="Worst Symbol"
              value={summary.worstSymbol}
              subtitle={`Profit: ${summary.worstProfit}`}
              color="red"
            />
            <MetricsCard
              label="Total Time"
              value={summary.totalTime}
              color="blue"
            />
          </div>

          {/* Results Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-400 uppercase border-b border-gray-700">
                <tr>
                  <th className="px-3 py-2">Symbol</th>
                  <th className="px-3 py-2">Timeframe</th>
                  <th className="px-3 py-2">Net Profit</th>
                  <th className="px-3 py-2">Win Rate</th>
                  <th className="px-3 py-2">Trades</th>
                  <th className="px-3 py-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-gray-800 hover:bg-gray-800">
                    <td className="px-3 py-2">{r.symbol}</td>
                    <td className="px-3 py-2">{r.timeframe}</td>
                    <td className={`px-3 py-2 ${(r.metrics?.netProfit ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {r.metrics?.netProfit?.toFixed(2) ?? '-'}
                    </td>
                    <td className="px-3 py-2">{r.metrics?.winRate ?? '-'}%</td>
                    <td className="px-3 py-2">{r.metrics?.totalTrades ?? '-'}</td>
                    <td className="px-3 py-2">{r.durationMs ? (r.durationMs / 1000).toFixed(2) + 's' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
