import { useState, useEffect } from 'react';
import api from '../api.js';
import BotCreateModal from './BotCreateModal.jsx';
import {
  Search, RefreshCw, Loader2, Plus, TrendingUp, TrendingDown,
  Star, Filter, Zap, AlertCircle,
} from 'lucide-react';

/**
 * MarketBrowser — search and browse Binance symbols.
 * "+ Bot" button opens bot creation modal pre-filled with selected symbol.
 * Auto-refreshes symbol registry when connected.
 */
export default function MarketBrowser() {
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState('usdm');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [quoteFilter, setQuoteFilter] = useState('USDT');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [error, setError] = useState(null);

  // Load market stats + auto-refresh on mount
  useEffect(() => {
    loadStats();
    autoRefreshIfNeeded();
  }, []);

  // Search with debounce
  useEffect(() => {
    const timer = setTimeout(() => loadSymbols(), 300);
    return () => clearTimeout(timer);
  }, [query, market, quoteFilter]);

  async function loadStats() {
    try {
      const s = await api.getMarketStats();
      setStats(s);
    } catch {}
  }

  async function autoRefreshIfNeeded() {
    try {
      const s = await api.getMarketStats();
      setStats(s);
      // Auto-refresh if no symbols loaded yet
      const hasData = (s.spot?.count || 0) + (s.usdm?.count || 0) + (s.coinm?.count || 0) > 0;
      if (!hasData) {
        setLoading(true);
        setError(null);
        try {
          await api.refreshMarkets('all');
          await loadStats();
          await loadSymbols();
        } catch (err) {
          setError('Could not load symbols. Make sure Binance is connected (go to Trade → Settings).');
        }
        setLoading(false);
      }
    } catch {}
  }

  async function loadSymbols() {
    setLoading(true);
    setError(null);
    try {
      let data;
      if (query.length >= 2) {
        data = await api.searchSymbols(query, market);
        setResults(data.results || []);
      } else {
        data = await api.getMarketSymbols(market, { quoteAsset: quoteFilter || undefined, limit: 50 });
        setResults(data.symbols || []);
      }
    } catch (err) {
      if (results.length === 0) {
        setError('Could not load symbols. Connect to Binance and click Refresh.');
      }
    }
    setLoading(false);
  }

  async function handleRefresh() {
    setLoading(true);
    setError(null);
    try {
      await api.refreshMarkets(market);
      await loadStats();
      await loadSymbols();
    } catch (err) {
      setError(`Refresh failed: ${err.message}. Ensure Binance is connected.`);
    }
    setLoading(false);
  }

  function handleAddBot(symbol) {
    setSelectedSymbol({ ...symbol, market: symbol.market || market });
    setShowCreate(true);
  }

  function handleBotCreated() {
    setShowCreate(false);
    setSelectedSymbol(null);
  }

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <StatBox label="Spot Symbols" value={stats.spot?.count || 0} sub={stats.spot?.lastRefresh ? `Updated ${timeAgo(stats.spot.lastRefresh)}` : 'Not loaded'} />
          <StatBox label="USD-M Futures" value={stats.usdm?.count || 0} sub={stats.usdm?.lastRefresh ? `Updated ${timeAgo(stats.usdm.lastRefresh)}` : 'Not loaded'} />
          <StatBox label="COIN-M Futures" value={stats.coinm?.count || 0} sub={stats.coinm?.lastRefresh ? `Updated ${timeAgo(stats.coinm.lastRefresh)}` : 'Not loaded'} />
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-warning shrink-0" />
          <p className="text-xs text-warning">{error}</p>
        </div>
      )}

      {/* Search + Filters */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex gap-1">
            {[
              { id: 'usdm', label: 'USD-M Futures' },
              { id: 'spot', label: 'Spot' },
              { id: 'coinm', label: 'COIN-M' },
            ].map(m => (
              <button key={m.id} onClick={() => setMarket(m.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  market === m.id ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface-2 text-gray-400 border-border-subtle hover:text-gray-200'
                }`}>{m.label}</button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select value={quoteFilter} onChange={e => setQuoteFilter(e.target.value)}
              className="bg-surface-2 border border-border-default rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none">
              <option value="USDT">USDT</option>
              <option value="BUSD">BUSD</option>
              <option value="BTC">BTC</option>
              <option value="">All</option>
            </select>
            <button onClick={handleRefresh} disabled={loading}
              className="p-2 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
              title="Refresh symbols from Binance">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Search input */}
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search symbols (BTC, ETH, SOL, DOGE...)"
            className="w-full bg-surface-2 border border-border-default rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
          {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />}
        </div>

        {/* Results Table */}
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          {results.length === 0 && !loading ? (
            <div className="text-center py-12">
              <Search size={32} className="mx-auto text-gray-700 mb-3" />
              <p className="text-sm text-gray-400">
                {query ? 'No symbols found for this query' : 'No symbols loaded yet'}
              </p>
              <p className="text-xs text-gray-600 mt-2">
                Click the <RefreshCw size={10} className="inline" /> button above to load symbols from Binance.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-2 sticky top-0">
                <tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Base</th>
                  <th className="px-4 py-3">Quote</th>
                  <th className="px-4 py-3">Market</th>
                  {market !== 'spot' && <th className="px-4 py-3">Contract</th>}
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {results.map(s => (
                  <tr key={`${s.market || market}-${s.symbol}`} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-4 py-2.5 font-mono font-medium text-gray-100">{s.symbol}</td>
                    <td className="px-4 py-2.5 text-gray-400">{s.baseAsset}</td>
                    <td className="px-4 py-2.5 text-gray-400">{s.quoteAsset}</td>
                    <td className="px-4 py-2.5">
                      <MarketBadge market={s.market || market} />
                    </td>
                    {market !== 'spot' && <td className="px-4 py-2.5 text-gray-500 text-xs">{s.contractType || '-'}</td>}
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => handleAddBot(s)}
                        className="px-2.5 py-1 text-[10px] font-medium bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-md transition-colors inline-flex items-center gap-1">
                        <Plus size={10} /> Create Bot
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {results.length > 0 && (
          <p className="text-[10px] text-gray-500 mt-3 text-right">{results.length} symbols shown</p>
        )}
      </div>

      {/* Bot Create Modal — pre-filled with selected symbol */}
      <BotCreateModal
        open={showCreate}
        onClose={() => { setShowCreate(false); setSelectedSymbol(null); }}
        onCreated={handleBotCreated}
        prefillSymbol={selectedSymbol}
        prefillMarket={selectedSymbol?.market || market}
      />
    </div>
  );
}

function StatBox({ label, value, sub }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className="text-xl font-bold font-mono text-gray-200">{value}</p>
      <p className="text-[10px] text-gray-600 mt-1">{sub}</p>
    </div>
  );
}

function MarketBadge({ market }) {
  const colors = {
    spot: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    usdm: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    coinm: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${colors[market] || colors.spot}`}>
      {market === 'usdm' ? 'USD-M' : market === 'coinm' ? 'COIN-M' : 'SPOT'}
    </span>
  );
}

function timeAgo(timestamp) {
  if (!timestamp) return 'never';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
