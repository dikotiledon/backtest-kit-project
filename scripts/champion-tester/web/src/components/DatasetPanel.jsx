import { useState, useEffect } from 'react';
import { useDatasets } from '../hooks/useDatasets.js';
import api from '../api.js';

export default function DatasetPanel() {
  const { datasets, refresh } = useDatasets();
  const [symbol, setSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('15m');
  const [fetching, setFetching] = useState(false);
  const [toast, setToast] = useState(null);

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
      await api.fetchDataset({ symbol: symbol.trim(), timeframe });
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
      await api.fetchDataset({ symbol: dataset.symbol, timeframe: dataset.timeframe });
      showToast(`Updated ${dataset.symbol} ${dataset.timeframe}`);
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to update dataset', 'error');
    }
  }

  async function handleDelete(dataset) {
    if (!confirm(`Delete ${dataset.symbol} ${dataset.timeframe}?`)) return;
    try {
      await api.deleteDataset(dataset);
      showToast(`Deleted ${dataset.symbol} ${dataset.timeframe}`);
      await refresh();
    } catch (err) {
      showToast(err.message || 'Failed to delete dataset', 'error');
    }
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 text-gray-100">
      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 px-4 py-2 rounded text-sm font-medium ${
            toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
          role="alert"
        >
          {toast.msg}
        </div>
      )}

      {/* Fetch Form */}
      <form onSubmit={handleFetch} className="flex flex-wrap gap-3 items-end mb-6">
        <div className="flex flex-col gap-1">
          <label htmlFor="symbol" className="text-sm text-gray-400">Symbol</label>
          <input
            id="symbol"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="BINANCE:BTCUSDT"
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="timeframe" className="text-sm text-gray-400">Timeframe</label>
          <select
            id="timeframe"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-4 py-2 rounded transition-colors"
        >
          {fetching ? 'Fetching...' : 'Fetch'}
        </button>
      </form>

      {/* Dataset Table */}
      {datasets.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No datasets yet. Fetch one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-left text-gray-400">
                <th className="pb-2 pr-4">Symbol</th>
                <th className="pb-2 pr-4">TF</th>
                <th className="pb-2 pr-4">Candles</th>
                <th className="pb-2 pr-4">Last Updated</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((ds, i) => (
                <tr key={`${ds.symbol}-${ds.timeframe}-${i}`} className="border-b border-gray-800">
                  <td className="py-2 pr-4 font-mono">{ds.symbol}</td>
                  <td className="py-2 pr-4">{ds.timeframe}</td>
                  <td className="py-2 pr-4">{ds.candles?.toLocaleString() ?? '—'}</td>
                  <td className="py-2 pr-4 text-gray-400">
                    {ds.lastUpdated ? new Date(ds.lastUpdated).toLocaleString() : '—'}
                  </td>
                  <td className="py-2 flex gap-2">
                    <button
                      onClick={() => handleUpdate(ds)}
                      className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                    >
                      Update
                    </button>
                    <button
                      onClick={() => handleDelete(ds)}
                      className="text-red-400 hover:text-red-300 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
