import { useState } from 'react';
import { useResults } from '../hooks/useResults.js';
import { exportResultsCsv } from '../utils/exportCsv.js';
import api from '../api.js';
import ResultDetail from './ResultDetail.jsx';

function formatDuration(ms) {
  if (ms == null) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export default function ResultsTable() {
  const { results, loading, refresh } = useResults();
  const [toast, setToast] = useState(null);
  const [selectedResult, setSelectedResult] = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleDelete(runId) {
    try {
      await api.deleteResult(runId);
      showToast('Result deleted', 'success');
      refresh();
    } catch (err) {
      showToast(err.message || 'Delete failed', 'error');
    }
  }

  if (loading) {
    return (
      <div className="text-zinc-400 text-center py-8">Loading results...</div>
    );
  }

  return (
    <div className="relative">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-2 rounded shadow-lg text-sm font-medium ${
            toast.type === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-green-600 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">Results</h2>
        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-zinc-700 text-zinc-300">
          {results.length}
        </span>
        <button
          onClick={() => exportResultsCsv(results)}
          disabled={results.length === 0}
          className="px-2 py-1 text-xs font-medium text-gray-400 hover:text-white border border-gray-600 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>

      {/* Table */}
      {results.length === 0 ? (
        <div className="text-zinc-500 text-center py-8">
          No results yet. Run a test first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-700">
          <table className="w-full text-sm text-left text-zinc-300">
            <thead className="text-xs uppercase bg-zinc-800 text-zinc-400">
              <tr>
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Timeframe</th>
                <th className="px-4 py-3">Net Profit</th>
                <th className="px-4 py-3">Win Rate</th>
                <th className="px-4 py-3">Trades</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr
                  key={result.runId}
                  className="border-t border-zinc-700 hover:bg-gray-700/50 cursor-pointer"
                  onClick={() => setSelectedResult(result)}
                >
                  <td className="px-4 py-2 font-mono">
                    {result.dataset.symbol}
                  </td>
                  <td className="px-4 py-2">{result.dataset.timeframe}</td>
                  <td
                    className={`px-4 py-2 font-medium ${
                      result.metrics.netProfit >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                    }`}
                  >
                    {result.metrics.netProfit}
                  </td>
                  <td className="px-4 py-2">{result.metrics.winRate}%</td>
                  <td className="px-4 py-2">{result.metrics.totalTrades}</td>
                  <td className="px-4 py-2">
                    {formatDuration(result.durationMs)}
                  </td>
                  <td className="px-4 py-2">
                    {new Date(result.timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => handleDelete(result.runId)}
                      className="px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
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
