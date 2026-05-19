import { useState, useEffect, useMemo } from 'react';
import { useDatasets } from '../hooks/useDatasets.js';
import { Database, Plus, RefreshCw, Trash2, Search, Download, AlertCircle } from 'lucide-react';
import api from '../api.js';

function SkeletonTable() {
  return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="skeleton h-12 rounded-lg" />
      ))}
    </div>
  );
}

export default function DatasetPanel() {
  const { datasets, loading, refresh } = useDatasets();
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('15m');
  const [fetching, setFetching] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('symbol');
  const [sortOrder, setSortOrder] = useState('asc');

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
  }

  async function handleFetch(e) {
    e.preventDefault();
    if (!symbol.trim()) {
      showToast('Symbol is required', 'error');
      return;
    }
    setFetching(true);
    try {
      await api.fetchDataset(symbol.trim(), timeframe);
      showToast(`Fetched ${symbol.trim()} ${timeframe} successfully`);
      setSymbol('');
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to fetch dataset', 'error');
    } finally {
      setFetching(false);
    }
  }

  async function handleUpdate(dataset) {
    try {
      await api.fetchDataset(dataset.symbol, dataset.timeframe);
      showToast(`Updated ${dataset.symbol} ${dataset.timeframe}`);
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to update dataset', 'error');
    }
  }

  async function handleDelete(dataset) {
    if (!confirm(`Delete ${dataset.symbol} ${dataset.timeframe}?`)) return;
    try {
      await api.deleteDataset(dataset.exchange, dataset.symbol, dataset.timeframe);
      showToast(`Deleted ${dataset.symbol} ${dataset.timeframe}`);
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to delete dataset', 'error');
    }
  }

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const filteredDatasets = useMemo(() => {
    let filtered = datasets;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(d =>
        d.symbol?.toLowerCase().includes(q) ||
        d.exchange?.toLowerCase().includes(q) ||
        d.timeframe?.toLowerCase().includes(q)
      );
    }
    return [...filtered].sort((a, b) => {
      let aVal = a[sortField] ?? '';
      let bVal = b[sortField] ?? '';
      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [datasets, search, sortField, sortOrder]);

  const sortIndicator = (field) => {
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? ' ↑' : ' ↓';
  };

  const totalCandles = datasets.reduce((sum, d) => sum + (d.candles || 0), 0);

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
          {toast.type === 'error' && <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-accent/10">
            <Database size={18} className="text-accent" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Datasets</p>
            <p className="text-xl font-bold text-gray-100">{datasets.length}</p>
          </div>
        </div>
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-info/10">
            <Download size={18} className="text-info" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Candles</p>
            <p className="text-xl font-bold text-gray-100">{totalCandles.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-4 flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-success/10">
            <RefreshCw size={18} className="text-success" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Timeframes</p>
            <p className="text-xl font-bold text-gray-100">
              {[...new Set(datasets.map(d => d.timeframe))].length}
            </p>
          </div>
        </div>
      </div>

      {/* Fetch Form */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <Plus size={14} className="text-accent" />
          Fetch New Dataset
        </h3>
        <form onSubmit={handleFetch} className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
            <label htmlFor="symbol" className="text-xs font-medium text-gray-400">Symbol</label>
            <input
              id="symbol"
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="BINANCE:BTCUSDT"
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeframe" className="text-xs font-medium text-gray-400">Timeframe</label>
            <select
              id="timeframe"
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
            >
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={fetching}
            className="px-5 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-all shadow-sm shadow-accent/20 hover:shadow-md hover:shadow-accent/30 flex items-center gap-2"
          >
            {fetching ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Fetching...
              </>
            ) : (
              <>
                <Download size={14} />
                Fetch
              </>
            )}
          </button>
        </form>
      </div>

      {/* Dataset Table */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
        {/* Table Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-200">All Datasets</h3>
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-3 text-gray-400 border border-border-subtle">
              {filteredDatasets.length}
            </span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search datasets..."
              className="pl-8 pr-3 py-2 text-xs bg-surface-2 border border-border-default rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50 w-48"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-5">
            <SkeletonTable />
          </div>
        ) : filteredDatasets.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Database size={40} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-400">
              {search ? 'No datasets match your search' : 'No datasets yet'}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              {search ? 'Try a different search term' : 'Use the form above to fetch market data'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto table-sticky-header max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('exchange')}>
                    Exchange{sortIndicator('exchange')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('symbol')}>
                    Symbol{sortIndicator('symbol')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('timeframe')}>
                    TF{sortIndicator('timeframe')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('candles')}>
                    Candles{sortIndicator('candles')}
                  </th>
                  <th className="px-5 py-3 cursor-pointer hover:text-gray-200 select-none" onClick={() => handleSort('lastUpdated')}>
                    Last Updated{sortIndicator('lastUpdated')}
                  </th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredDatasets.map((ds, i) => (
                  <tr
                    key={`${ds.exchange}-${ds.symbol}-${ds.timeframe}-${i}`}
                    className="hover:bg-surface-2/50 transition-colors group"
                  >
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-surface-3 text-gray-400 border border-border-subtle">
                        {ds.exchange}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono font-medium text-gray-200">{ds.symbol}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-accent/10 text-accent border border-accent/20">
                        {ds.timeframe}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-mono text-gray-300">{ds.candles?.toLocaleString() ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {ds.lastUpdated ? new Date(ds.lastUpdated).toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleUpdate(ds)}
                          className="p-1.5 rounded-md hover:bg-accent/10 text-gray-400 hover:text-accent transition-colors"
                          title="Update dataset"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(ds)}
                          className="p-1.5 rounded-md hover:bg-error/10 text-gray-400 hover:text-error transition-colors"
                          title="Delete dataset"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
