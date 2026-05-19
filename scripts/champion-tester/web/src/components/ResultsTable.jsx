import { useState, useMemo } from 'react';
import { useResults } from '../hooks/useResults.js';
import { exportResultsCsv } from '../utils/exportCsv.js';
import { BarChart3, Download, Trash2, Search, Eye, AlertCircle, ArrowUpDown, Filter } from 'lucide-react';
import api from '../api.js';
import ResultDetail from './ResultDetail.jsx';
import { formatNumber, formatPercent, normalizeResultMetrics } from '../utils/metrics.js';

function formatDuration(ms) {
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export default function ResultsTable() {
  const { results: rawResults, loading, refresh } = useResults();
  const [toast, setToast] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');
  const [filterProfit, setFilterProfit] = useState('all'); // all, profit, loss
  // rawResults already normalized by useResults hook — use directly
  const results = rawResults;

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleDelete(e, runId) {
    e.stopPropagation();
    try {
      await api.deleteResult(runId);
      showToast('Result deleted', 'success');
      refresh();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const filteredResults = useMemo(() => {
    let filtered = results;

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.dataset?.symbol?.toLowerCase().includes(q) ||
        r.dataset?.timeframe?.toLowerCase().includes(q)
      );
    }

    // Profit filter
    if (filterProfit === 'profit') {
      filtered = filtered.filter(r => (r.metrics?.netProfit ?? 0) > 0);
    } else if (filterProfit === 'loss') {
      filtered = filtered.filter(r => (r.metrics?.netProfit ?? 0) <= 0);
    }

    // Sort
    return [...filtered].sort((a, b) => {
      let aVal, bVal;
      switch (sortField) {
        case 'symbol':
          aVal = a.dataset?.symbol || '';
          bVal = b.dataset?.symbol || '';
          break;
        case 'timeframe':
          aVal = a.dataset?.timeframe || '';
          bVal = b.dataset?.timeframe || '';
          break;
        case 'netProfit':
          aVal = a.metrics?.netProfit ?? 0;
          bVal = b.metrics?.netProfit ?? 0;
          break;
        case 'winRate':
          aVal = a.metrics?.winRate ?? 0;
          bVal = b.metrics?.winRate ?? 0;
          break;
        case 'trades':
          aVal = a.metrics?.totalTrades ?? 0;
          bVal = b.metrics?.totalTrades ?? 0;
          break;
        case 'duration':
          aVal = a.durationMs ?? 0;
          bVal = b.durationMs ?? 0;
          break;
        case 'timestamp':
        default:
          aVal = new Date(a.timestamp || 0).getTime();
          bVal = new Date(b.timestamp || 0).getTime();
          break;
      }
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [results, search, sortField, sortOrder, filterProfit]);

  const sortIndicator = (field) => {
    if (sortField !== field) return null;
    return <span className="ml-1 text-accent">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  // Aggregate stats
  const stats = useMemo(() => {
    if (results.length === 0) return null;
    const profits = results.map(r => r.metrics?.netProfit ?? 0);
    const totalProfit = profits.reduce((a, b) => a + b, 0);
    const avgProfit = totalProfit / profits.length;
    const winCount = profits.filter(p => p > 0).length;
    const avgWinRate = results.reduce((sum, r) => sum + (r.metrics?.winRate ?? 0), 0) / results.length;
    return { totalProfit, avgProfit, winCount, lossCount: results.length - winCount, avgWinRate };
  }, [results]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
        </div>
        <div className="skeleton h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 animate-slide-in ${
            toast.type === 'error'
              ? 'bg-error/90 text-white border border-error/50'
              : 'bg-success/90 text-white border border-success/50'
          }`}
          role="alert"
        >
          {toast.msg}
        </div>
      )}

      {/* Summary Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Profit</p>
            <p className={`text-xl font-bold font-mono mt-1 ${stats.totalProfit >= 0 ? 'text-success' : 'text-error'}`}>
              {stats.totalProfit >= 0 ? '+' : ''}{stats.totalProfit.toFixed(2)}
            </p>
          </div>
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Profit/Run</p>
            <p className={`text-xl font-bold font-mono mt-1 ${stats.avgProfit >= 0 ? 'text-success' : 'text-error'}`}>
              {stats.avgProfit >= 0 ? '+' : ''}{stats.avgProfit.toFixed(2)}
            </p>
          </div>
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Win / Loss</p>
            <p className="text-xl font-bold mt-1">
              <span className="text-success">{stats.winCount}</span>
              <span className="text-gray-600 mx-1">/</span>
              <span className="text-error">{stats.lossCount}</span>
            </p>
          </div>
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Win Rate</p>
            <p className="text-xl font-bold font-mono mt-1 text-gray-200">
              {stats.avgWinRate.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Table Container */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
        {/* Table Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-200">All Results</h3>
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-3 text-gray-400 border border-border-subtle">
              {filteredResults.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Filter */}
            <div className="flex items-center rounded-lg border border-border-subtle overflow-hidden">
              {['all', 'profit', 'loss'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilterProfit(f)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    filterProfit === f
                      ? 'bg-accent/10 text-accent'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-surface-2'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'profit' ? 'Profitable' : 'Losses'}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="pl-8 pr-3 py-2 text-xs bg-surface-2 border border-border-default rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50 w-40"
              />
            </div>

            {/* Export */}
            <button
              onClick={() => exportResultsCsv(results)}
              disabled={results.length === 0}
              className="px-3 py-2 text-xs font-medium text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 border border-border-subtle rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <Download size={12} />
              CSV
            </button>
          </div>
        </div>

        {/* Table */}
        {filteredResults.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <BarChart3 size={40} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-400">
              {search || filterProfit !== 'all' ? 'No results match your filters' : 'No results yet'}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {search || filterProfit !== 'all' ? 'Try adjusting your search or filter' : 'Run a test to see results here'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto table-sticky-header max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('symbol')}>
                    Symbol{sortIndicator('symbol')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('timeframe')}>
                    TF{sortIndicator('timeframe')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('netProfit')}>
                    Net Profit{sortIndicator('netProfit')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('winRate')}>
                    Win Rate{sortIndicator('winRate')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('trades')}>
                    Trades{sortIndicator('trades')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('duration')}>
                    Duration{sortIndicator('duration')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('timestamp')}>
                    Date{sortIndicator('timestamp')}
                  </th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredResults.map((result, idx) => {
                  const profit = result.metrics?.netProfit ?? 0;
                  const isPositive = profit >= 0;
                  return (
                    <tr
                      key={result.runId}
                      className="hover:bg-surface-2/50 cursor-pointer transition-colors group"
                      onClick={() => setSelectedResult(result)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPositive ? 'bg-success' : 'bg-error'}`} />
                          <span className="font-mono font-medium text-gray-200">{result.dataset?.symbol}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-surface-3 text-gray-400 border border-border-subtle">
                          {result.dataset?.timeframe}
                        </span>
                      </td>
                      <td className={`px-5 py-3 font-mono font-medium ${isPositive ? 'text-success' : 'text-error'}`}>
                        {isPositive ? '+' : ''}{formatNumber(profit)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${(result.metrics?.winRate ?? 0) >= 50 ? 'bg-success' : 'bg-warning'}`}
                              style={{ width: `${Math.min(result.metrics?.winRate ?? 0, 100)}%` }}
                            />
                          </div>
                          <span className="text-gray-300 text-xs">{formatPercent(result.metrics?.winRate)}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-gray-300">{result.metrics?.totalTrades}</td>
                      <td className="px-5 py-3 text-gray-400 text-xs">{formatDuration(result.durationMs)}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">
                        {result.timestamp ? new Date(result.timestamp).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedResult(result); }}
                            className="p-1.5 rounded-md hover:bg-accent/10 text-gray-400 hover:text-accent transition-colors"
                            title="View details"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, result.runId)}
                            className="p-1.5 rounded-md hover:bg-error/10 text-gray-400 hover:text-error transition-colors"
                            title="Delete result"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Result Detail Modal */}
      {selectedResult && (
        <ResultDetail
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </div>
  );
}
