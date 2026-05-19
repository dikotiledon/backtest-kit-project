import { useState, useEffect } from 'react';
import { useDatasets } from '../hooks/useDatasets.js';
import { useChampions } from '../hooks/useChampions.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { Layers, Play, Square, CheckCircle2, AlertCircle, Loader2, TrendingUp, TrendingDown, Clock, Target } from 'lucide-react';
import api from '../api.js';
import MetricsCard from './MetricsCard.jsx';
import { formatNumber, formatPercent, normalizeResultMetrics } from '../utils/metrics.js';

export default function SweepPanel() {
  const [selectedChampion, setSelectedChampion] = useState('');
  const [selectedDatasets, setSelectedDatasets] = useState(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const { champions } = useChampions();
  const { datasets } = useDatasets();
  const { connected, subscribe } = useWebSocket();

  useEffect(() => {
    const unsub = subscribe('sweep:progress', (data) => {
      const payload = data.data || data;
      setProgress(payload);
      if (!payload.running) {
        setRunning(false);
        setResults((payload.results || []).map(normalizeResultMetrics));
      }
    });
    return unsub;
  }, [subscribe]);

  // Fallback polling only when WS is disconnected
  useEffect(() => {
    if (!running || connected) return;
    const interval = setInterval(async () => {
      try {
        const status = await api.getSweepStatus();
        const payload = status.lastResult && !status.results ? status.lastResult : status;
        setProgress(payload);
        if (!payload.running) {
          setRunning(false);
          setResults((payload.results || []).map(normalizeResultMetrics));
          clearInterval(interval);
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch sweep status');
        setRunning(false);
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [running, connected]);

  const handleSelectAll = () => {
    if (!filteredDs || filteredDs.length === 0) return;
    const indices = new Set();
    for (const d of filteredDs) {
      const idx = datasets.indexOf(d);
      if (idx !== -1) indices.add(idx);
    }
    setSelectedDatasets(indices);
  };

  const handleClear = () => setSelectedDatasets(new Set());

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
      const sweepDatasets = [...selectedDatasets].map((i) => {
        const d = datasets[i];
        return { symbol: d.tvSymbol || `${d.exchange}:${d.symbol}`, timeframe: d.timeframe };
      });
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

  const filteredDs = datasets?.filter(d => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return d.symbol?.toLowerCase().includes(q) || d.exchange?.toLowerCase().includes(q);
  });

  const summary = results && results.length > 0 ? (() => {
    const normalizedResults = results.map(normalizeResultMetrics);
    const profits = normalizedResults.map((r) => r.metrics?.netProfit ?? 0);
    const avgProfit = profits.reduce((a, b) => a + b, 0) / profits.length;
    const bestIdx = profits.indexOf(Math.max(...profits));
    const worstIdx = profits.indexOf(Math.min(...profits));
    const winCount = profits.filter(p => p > 0).length;
    const totalTime = normalizedResults.reduce((a, r) => a + (r.durationMs || 0), 0);
    return {
      avgProfit: formatNumber(avgProfit),
      bestSymbol: normalizedResults[bestIdx]?.dataset?.symbol || normalizedResults[bestIdx]?.symbol || '-',
      bestProfit: formatNumber(profits[bestIdx]),
      worstSymbol: normalizedResults[worstIdx]?.dataset?.symbol || normalizedResults[worstIdx]?.symbol || '-',
      worstProfit: formatNumber(profits[worstIdx]),
      totalTime: (totalTime / 1000).toFixed(1) + 's',
      winRate: ((winCount / normalizedResults.length) * 100).toFixed(0),
    };
  })() : null;

  const progressPct = progress ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Configuration */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-6">
        <h3 className="text-sm font-semibold text-gray-200 mb-5 flex items-center gap-2">
          <Layers size={14} className="text-warning" />
          Sweep Configuration
        </h3>

        <div className="space-y-5">
          {/* Champion Selector */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Champion Strategy</label>
            <select
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              value={selectedChampion}
              onChange={(e) => setSelectedChampion(e.target.value)}
            >
              <option value="">Select a champion...</option>
              {champions?.map((c) => (
                <option key={c.matrixId} value={c.matrixId}>{c.matrixId}</option>
              ))}
            </select>
          </div>

          {/* Dataset Checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                Datasets ({selectedDatasets.size} selected)
              </label>
              <div className="flex gap-2">
                <button
                  className="px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 border border-border-subtle rounded-md transition-colors"
                  onClick={handleSelectAll}
                >
                  Select All
                </button>
                <button
                  className="px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 border border-border-subtle rounded-md transition-colors"
                  onClick={handleClear}
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter datasets..."
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50"
            />

            <div className="max-h-56 overflow-y-auto rounded-lg border border-border-subtle bg-surface-2 divide-y divide-border-subtle">
              {filteredDs?.map((d, fi) => {
                const realIdx = datasets.indexOf(d);
                return (
                  <label
                    key={d.id || `${d.exchange}-${d.symbol}-${d.timeframe}`}
                    className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-3 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedDatasets.has(realIdx)}
                      onChange={() => toggleDataset(realIdx)}
                      className="w-3.5 h-3.5 rounded border-border-default accent-accent"
                    />
                    <span className="text-sm text-gray-300 flex-1">
                      <span className="font-mono font-medium">{d.exchange}:{d.symbol}</span>
                      <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-surface-3 text-gray-500">{d.timeframe}</span>
                    </span>
                    <span className="text-xs text-gray-500">{d.candles?.toLocaleString()} candles</span>
                  </label>
                );
              })}
              {(!filteredDs || filteredDs.length === 0) && (
                <div className="px-3 py-6 text-center text-xs text-gray-500">No datasets available</div>
              )}
            </div>
          </div>
        </div>

        {/* Run Button */}
        <div className="mt-5 flex items-center gap-3">
          <button
            className="px-6 py-2.5 bg-warning hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-lg transition-all shadow-sm shadow-warning/20 flex items-center gap-2"
            disabled={running || !selectedChampion || selectedDatasets.size === 0}
            onClick={handleRunSweep}
          >
            {running ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Running Sweep...
              </>
            ) : (
              <>
                <Play size={14} />
                Run Sweep ({selectedDatasets.size})
              </>
            )}
          </button>
          {running && (
            <button
              className="px-4 py-2.5 bg-error/10 hover:bg-error/20 text-error text-sm font-medium rounded-lg border border-error/20 transition-colors flex items-center gap-2"
              onClick={handleCancel}
            >
              <Square size={12} />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-error/5 border border-error/20">
          <AlertCircle size={16} className="text-error shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-error">Sweep Error</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Progress */}
      {running && progress && (
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-warning" />
              Sweep Progress
            </h3>
            <span className="text-sm font-mono text-gray-400">{progressPct}%</span>
          </div>
          <div className="w-full bg-surface-3 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-warning to-yellow-400 h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{progress.completed}/{progress.total} completed</span>
            {progress.currentSymbol && (
              <span className="flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" />
                {progress.currentSymbol}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {summary && (
        <div className="space-y-4 animate-fade-in">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-success" />
            Sweep Results
          </h3>

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricsCard label="Avg Profit" value={summary.avgProfit} color={parseFloat(summary.avgProfit) >= 0 ? 'green' : 'red'} compact />
            <MetricsCard label="Win Rate" value={formatPercent(summary.winRate, 0)} color={Number(summary.winRate) >= 50 ? 'green' : 'yellow'} compact />
            <MetricsCard label="Best" value={summary.bestSymbol} subtitle={`+${summary.bestProfit}`} color="green" compact />
            <MetricsCard label="Total Time" value={summary.totalTime} color="blue" compact />
          </div>

          {/* Results Table */}
          <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
            <div className="overflow-x-auto table-sticky-header max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-2">
                  <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Symbol</th>
                    <th className="px-4 py-3">TF</th>
                    <th className="px-4 py-3">Net Profit</th>
                    <th className="px-4 py-3">Win Rate</th>
                    <th className="px-4 py-3">Trades</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {results.map((r, i) => {
                    const normalized = normalizeResultMetrics(r);
                    const profit = normalized.metrics?.netProfit ?? 0;
                    return (
                      <tr key={i} className="hover:bg-surface-2/50 transition-colors">
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5 font-mono font-medium text-gray-200">
                          {normalized.dataset?.symbol || normalized.symbol}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-surface-3 text-gray-400">
                            {normalized.dataset?.timeframe || normalized.timeframe}
                          </span>
                        </td>
                        <td className={`px-4 py-2.5 font-mono font-medium ${profit >= 0 ? 'text-success' : 'text-error'}`}>
                          {profit >= 0 ? '+' : ''}{formatNumber(profit)}
                        </td>
                        <td className="px-4 py-2.5 text-gray-300">{formatPercent(normalized.metrics?.winRate)}</td>
                        <td className="px-4 py-2.5 text-gray-300">{normalized.metrics?.totalTrades ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-400 text-xs">
                          {normalized.durationMs ? (normalized.durationMs / 1000).toFixed(1) + 's' : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {profit > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-success/10 text-success border border-success/20">
                              <TrendingUp size={10} /> Profit
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-error/10 text-error border border-error/20">
                              <TrendingDown size={10} /> Loss
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
