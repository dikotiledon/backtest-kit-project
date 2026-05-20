import { useState } from 'react';
import { useAnalyticsTrades } from '../hooks/useTrades.js';
import { queryClient } from '../queryClient.js';
import MarketBadge from './ui/MarketBadge.jsx';
import {
  History, Download, Filter, Loader2, TrendingUp, TrendingDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react';

/**
 * TradeHistory — paginated trade history with filters and export.
 */
export default function TradeHistory() {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState({ symbol: '', market: '', botId: '' });
  const pageSize = 25;

  const queryOpts = {
    limit: String(pageSize),
    offset: String(page * pageSize),
  };
  if (filters.symbol) queryOpts.symbol = filters.symbol;
  if (filters.market) queryOpts.market = filters.market;
  if (filters.botId) queryOpts.botId = filters.botId;

  const { data, isLoading: loading } = useAnalyticsTrades(queryOpts);
  const trades = data?.trades || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['trades', 'analytics'] });
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter size={14} className="text-gray-500" />
          <input type="text" placeholder="Symbol" value={filters.symbol}
            onChange={e => { setFilters(f => ({ ...f, symbol: e.target.value.toUpperCase() })); setPage(0); }}
            className="bg-surface-2 border border-border-default rounded-lg px-3 py-1.5 text-xs text-gray-100 placeholder-gray-600 w-32 focus:outline-none focus:ring-2 focus:ring-accent/50" />
          <select value={filters.market} onChange={e => { setFilters(f => ({ ...f, market: e.target.value })); setPage(0); }}
            className="bg-surface-2 border border-border-default rounded-lg px-3 py-1.5 text-xs text-gray-100 focus:outline-none">
            <option value="">All Markets</option>
            <option value="spot">Spot</option>
            <option value="usdm">USD-M</option>
            <option value="coinm">COIN-M</option>
          </select>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] text-gray-500">{total} trades total</span>
            <button onClick={handleRefresh} className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200">
              <Loader2 size={12} className={loading ? 'animate-spin' : 'hidden'} />
              {!loading && <History size={12} />}
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
        {trades.length === 0 && !loading ? (
          <div className="px-5 py-16 text-center">
            <History size={32} className="mx-auto text-gray-700 mb-3" />
            <p className="text-sm text-gray-400">No trades recorded yet</p>
            <p className="text-xs text-gray-600 mt-1">Trades will appear here once bots execute orders</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 sticky top-0">
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Side</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">PnL</th>
                  <th className="px-4 py-3">Strategy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {trades.map(t => (
                  <tr key={t.id} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-2.5 text-[11px] text-gray-400 whitespace-nowrap">
                      {new Date(t.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-medium text-gray-200">{t.symbol}</td>
                    <td className="px-4 py-2.5">
                      <MarketBadge market={t.market} />
                    </td>
                    <td className={`px-4 py-2.5 font-medium ${t.side === 'BUY' ? 'text-success' : 'text-error'}`}>
                      <span className="flex items-center gap-1">
                        {t.side === 'BUY' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {t.side}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{t.type}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-300">{t.quantity?.toFixed(6)}</td>
                    <td className="px-4 py-2.5 font-mono text-gray-300">{t.avg_fill_price?.toFixed(2) || t.price?.toFixed(2) || '-'}</td>
                    <td className={`px-4 py-2.5 font-mono ${
                      t.pnl == null ? 'text-gray-500' : t.pnl >= 0 ? 'text-success' : 'text-error'
                    }`}>
                      {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(4)}` : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-gray-500">{t.strategy || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
            <span className="text-[10px] text-gray-500">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
