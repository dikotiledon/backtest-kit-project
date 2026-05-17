import { useState, useMemo } from 'react';

export default function TradeList({ trades }) {
  const [sortField, setSortField] = useState(null);
  const [sortOrder, setSortOrder] = useState('asc');

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
    if (!sortField) return trades;

    return [...trades].sort((a, b) => {
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
  }, [trades, sortField, sortOrder]);

  const summary = useMemo(() => {
    if (!trades || trades.length === 0) return null;
    const total = trades.length;
    const avgPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0) / total;
    const avgBars = trades.reduce((sum, t) => sum + (t.barsHeld || 0), 0) / total;
    const longCount = trades.filter((t) => t.side === 'long' || t.side === 'Long').length;
    const shortCount = total - longCount;
    return { total, avgPnl, avgBars, longCount, shortCount };
  }, [trades]);

  if (!trades || trades.length === 0) {
    return (
      <div className="text-gray-400 text-center py-8">
        No trade data available
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
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm text-left text-gray-300">
        <thead className="text-xs uppercase bg-gray-900 text-gray-400">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-4 py-3 cursor-pointer hover:text-gray-200 select-none whitespace-nowrap"
                onClick={() => handleSort(col.key)}
              >
                {col.label}{sortIndicator(col.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedTrades.map((trade, idx) => {
            const isLong = trade.side === 'long' || trade.side === 'Long';
            return (
              <tr
                key={idx}
                className={`border-b border-gray-700 hover:bg-gray-700/50 ${
                  idx % 2 === 1 ? 'bg-gray-800/50' : ''
                }`}
              >
                <td className="px-4 py-2">{idx + 1}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatTime(trade.entryTime)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{formatTime(trade.exitTime)}</td>
                <td className={`px-4 py-2 font-medium ${isLong ? 'text-green-400' : 'text-red-400'}`}>
                  {isLong ? 'Long' : 'Short'}
                </td>
                <td className="px-4 py-2">{formatPrice(trade.entryPrice)}</td>
                <td className="px-4 py-2">{formatPrice(trade.exitPrice)}</td>
                <td className={`px-4 py-2 font-medium ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {trade.pnl != null ? trade.pnl.toFixed(2) : '—'}
                </td>
                <td className="px-4 py-2">{trade.barsHeld ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
        {summary && (
          <tfoot className="bg-gray-900 text-gray-300 font-medium text-xs uppercase">
            <tr className="border-t border-gray-600">
              <td className="px-4 py-3" colSpan={2}>
                Total: {summary.total} trades
              </td>
              <td className="px-4 py-3" colSpan={2}>
                Long: {summary.longCount} / Short: {summary.shortCount}
              </td>
              <td className="px-4 py-3" colSpan={2}>
                Avg PnL: <span className={summary.avgPnl >= 0 ? 'text-green-400' : 'text-red-400'}>{summary.avgPnl.toFixed(2)}</span>
              </td>
              <td className="px-4 py-3" colSpan={2}>
                Avg Bars: {summary.avgBars.toFixed(1)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
