import { useState, useMemo } from 'react';
import { Search, ArrowUpDown } from 'lucide-react';

export default function TradeList({ trades }) {
  const [sortField, setSortField] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedTrades = useMemo(() => {
    if (!trades || trades.length === 0) return [];
    let filtered = trades;

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(t =>
        t.side?.toLowerCase().includes(q) ||
        String(t.pnl).includes(q)
      );
    }

    if (!sortField) return filtered;

    return [...filtered].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (sortField === 'entryTime' || sortField === 'exitTime') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [trades, sortField, sortOrder, search]);

  const paginatedTrades = useMemo(() => {
    return sortedTrades.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [sortedTrades, page]);

  const totalPages = Math.ceil(sortedTrades.length / PAGE_SIZE);

  const summary = useMemo(() => {
    if (!trades || trades.length === 0) return null;
    const total = trades.length;
    const avgPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / total;
    const avgBars = trades.reduce((sum, t) => sum + (t.barsHeld || 0), 0) / total;
    const longCount = trades.filter((t) => t.side === 'long' || t.side === 'Long').length;
    const shortCount = total - longCount;
    const winCount = trades.filter(t => (t.pnl || 0) > 0).length;
    return { total, avgPnl, avgBars, longCount, shortCount, winCount };
  }, [trades]);

  if (!trades || trades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-gray-400">No trade data available</p>
      </div>
    );
  }

  const columns = [
    { key: 'index', label: '#' },
    { key: 'entryTime', label: 'Entry Time' },
    { key: 'exitTime', label: 'Exit Time' },
    { key: 'side', label: 'Side' },
    { key: 'entryPrice', label: 'Entry Price' },
    { key: 'exitPrice', label: 'Exit Price' },
    { key: 'pnl', label: 'PnL' },
    { key: 'barsHeld', label: 'Bars Held' },
  ];

  const formatPrice = (price) => {
    if (price == null) return '—';
    if (price >= 1000) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const formatTime = (time) => {
    if (!time) return '—';
    return new Date(time).toLocaleString();
  };

  const sortIndicator = (field) => {
    if (sortField !== field) return null;
    return <span className="ml-1 text-accent">{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {summary && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-lg bg-surface-2 border border-border-subtle text-xs">
          <span className="text-gray-400">
            <span className="font-medium text-gray-200">{summary.total}</span> trades
          </span>
          <span className="text-gray-400">
            Long: <span className="text-success font-medium">{summary.longCount}</span> / Short: <span className="text-error font-medium">{summary.shortCount}</span>
          </span>
          <span className="text-gray-400">
            Win: <span className="text-success font-medium">{summary.winCount}</span> ({((summary.winCount / summary.total) * 100).toFixed(0)}%)
          </span>
          <span className="text-gray-400">
            Avg PnL: <span className={`font-mono font-medium ${summary.avgPnl >= 0 ? 'text-success' : 'text-error'}`}>{summary.avgPnl.toFixed(2)}</span>
          </span>
          <span className="text-gray-400">
            Avg Bars: <span className="font-mono text-gray-300">{summary.avgBars.toFixed(1)}</span>
          </span>
        </div>
      )}

      {/* Search */}
      <div className="relative w-48">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          placeholder="Filter trades..."
          className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface-2 border border-border-default rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border-subtle table-sticky-header max-h-[500px] overflow-y-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-surface-2 text-xs uppercase text-gray-400 tracking-wider">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 cursor-pointer hover:text-gray-200 select-none whitespace-nowrap transition-colors"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}{sortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {paginatedTrades.map((trade, idx) => {
              const isLong = trade.side === 'long' || trade.side === 'Long';
              const realIdx = page * PAGE_SIZE + idx;
              return (
                <tr
                  key={realIdx}
                  className={`hover:bg-surface-2/50 transition-colors ${
                    idx % 2 === 1 ? 'bg-surface-1/50' : ''
                  }`}
                >
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{realIdx + 1}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-300 text-xs">{formatTime(trade.entryTime)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-300 text-xs">{formatTime(trade.exitTime)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      isLong
                        ? 'bg-success/10 text-success border border-success/20'
                        : 'bg-error/10 text-error border border-error/20'
                    }`}>
                      {isLong ? 'Long' : 'Short'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-gray-300 text-xs">{formatPrice(trade.entryPrice)}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-300 text-xs">{formatPrice(trade.exitPrice)}</td>
                  <td className={`px-4 py-2.5 font-mono font-medium text-xs ${trade.pnl >= 0 ? 'text-success' : 'text-error'}`}>
                    {trade.pnl != null ? (trade.pnl >= 0 ? '+' : '') + trade.pnl.toFixed(2) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{trade.barsHeld ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-gray-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, sortedTrades.length)} of {sortedTrades.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 border border-border-subtle rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <span className="px-2 text-xs text-gray-500">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-2.5 py-1 text-xs font-medium text-gray-400 hover:text-gray-200 bg-surface-2 hover:bg-surface-3 border border-border-subtle rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
