import { useState, useEffect } from 'react';
import { useTrading } from '../hooks/useTrading.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import api from '../api.js';
import MarketBadge from './ui/MarketBadge.jsx';
import {
  Wallet, Settings, Power, PowerOff, TrendingUp, TrendingDown,
  AlertCircle, CheckCircle2, Loader2, RefreshCw, Shield,
  DollarSign, Activity, Send, X, Eye, EyeOff, Layers, Zap,
} from 'lucide-react';

// ─── Shared Components ────────────────────────────────────────────

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 animate-slide-in ${
      toast.type === 'error' ? 'bg-error/90 text-white border border-error/50' : 'bg-success/90 text-white border border-success/50'
    }`} role="alert">
      {toast.type === 'error' && <AlertCircle size={14} />}
      {toast.msg}
    </div>
  );
}



function ConnectionPanel({ status, onConnect, onDisconnect, onFuturesConnect, onFuturesDisconnect, loading }) {
  const spotConnected = status?.spot?.connected;
  const configured = status?.config?.configured;
  const testnet = status?.config?.testnet;
  const futuresEnabled = status?.config?.futures?.enabled;
  const futuresMarkets = status?.futures?.markets || {};

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <Power size={14} className="text-accent" />
          Connections
        </h3>
        <div className="flex items-center gap-2">
          {testnet && (
            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-warning/10 text-warning border border-warning/20">
              TESTNET
            </span>
          )}
        </div>
      </div>

      {!configured ? (
        <p className="text-xs text-gray-500">Configure API keys in Settings to connect.</p>
      ) : (
        <div className="space-y-3">
          {/* Spot */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MarketBadge market="spot" />
              <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${spotConnected ? 'text-success' : 'text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${spotConnected ? 'bg-success' : 'bg-gray-600'}`} />
                {spotConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {!spotConnected ? (
              <button onClick={onConnect} disabled={loading}
                className="px-3 py-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md transition-colors flex items-center gap-1.5">
                {loading ? <Loader2 size={10} className="animate-spin" /> : <Power size={10} />} Connect
              </button>
            ) : (
              <button onClick={onDisconnect} disabled={loading}
                className="px-3 py-1.5 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md transition-colors flex items-center gap-1.5">
                <PowerOff size={10} /> Disconnect
              </button>
            )}
          </div>

          {/* Futures */}
          {futuresEnabled && (
            <>
              {['usdm', 'coinm'].filter(m => (status?.config?.futures?.markets || ['usdm']).includes(m)).map(m => {
                const connected = futuresMarkets[m]?.initialized;
                return (
                  <div key={m} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MarketBadge market={m} />
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${connected ? 'text-success' : 'text-gray-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-success' : 'bg-gray-600'}`} />
                        {connected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    {!connected ? (
                      <button onClick={() => onFuturesConnect(m)} disabled={loading}
                        className="px-3 py-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md transition-colors flex items-center gap-1.5">
                        {loading ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />} Connect
                      </button>
                    ) : (
                      <button onClick={() => onFuturesDisconnect(m)} disabled={loading}
                        className="px-3 py-1.5 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md transition-colors flex items-center gap-1.5">
                        <PowerOff size={10} /> Disconnect
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BalancePanel({ account, futuresAccount }) {
  const spotBalances = (account?.balances || []).filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  const futuresAssets = (futuresAccount?.assets || []).filter(a => parseFloat(a.walletBalance) > 0 || parseFloat(a.unrealizedProfit) !== 0);

  if (spotBalances.length === 0 && futuresAssets.length === 0) return null;

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
        <Wallet size={14} className="text-info" />
        Balances
      </h3>
      <div className="space-y-2 max-h-56 overflow-y-auto">
        {spotBalances.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] text-gray-500 uppercase mb-1">Spot</p>
            {spotBalances.map(b => (
              <div key={`spot-${b.asset}`} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle mb-1">
                <span className="text-xs font-mono font-medium text-gray-200">{b.asset}</span>
                <div className="text-right">
                  <p className="text-xs font-mono text-gray-300">{parseFloat(b.free).toFixed(6)}</p>
                  {parseFloat(b.locked) > 0 && <p className="text-[10px] text-gray-500">Locked: {parseFloat(b.locked).toFixed(6)}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        {futuresAssets.length > 0 && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase mb-1">Futures</p>
            {futuresAssets.map(a => (
              <div key={`fut-${a.asset}`} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-surface-2 border border-border-subtle mb-1">
                <span className="text-xs font-mono font-medium text-gray-200">{a.asset}</span>
                <div className="text-right">
                  <p className="text-xs font-mono text-gray-300">{parseFloat(a.walletBalance).toFixed(4)}</p>
                  {parseFloat(a.unrealizedProfit) !== 0 && (
                    <p className={`text-[10px] ${parseFloat(a.unrealizedProfit) >= 0 ? 'text-success' : 'text-error'}`}>
                      PnL: {parseFloat(a.unrealizedProfit).toFixed(4)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── TradingPanel Part 2: Main Component + Overview Tab ───────────

export default function TradingPanel() {
  const {
    status, account, positions, openOrders,
    futuresAccount, futuresPositions, futuresOrders,
    loading, error, refresh,
  } = useTrading();
  const { subscribe } = useWebSocket();
  const [tab, setTab] = useState('overview');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const unsubs = [
      subscribe('trading:order:new', () => refresh()),
      subscribe('trading:order:cancel', () => refresh()),
      subscribe('trading:signal:executed', () => refresh()),
      subscribe('trading:connected', () => refresh()),
      subscribe('trading:disconnected', () => refresh()),
      subscribe('trading:futures:connected', () => refresh()),
      subscribe('trading:futures:disconnected', () => refresh()),
      subscribe('trading:futures:order:new', () => refresh()),
      subscribe('trading:futures:order:cancel', () => refresh()),
      subscribe('trading:futures:position:closed', () => refresh()),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe, refresh]);

  const showToast = (msg, type = 'success') => setToast({ msg, type });

  const handleConnect = async () => {
    setActionLoading(true);
    try { await api.connectTrading(); showToast('Spot connected'); await refresh(); }
    catch (err) { showToast(err.message || 'Connection failed', 'error'); }
    finally { setActionLoading(false); }
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    try { await api.disconnectTrading(); showToast('Spot disconnected'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setActionLoading(false); }
  };

  const handleFuturesConnect = async (market) => {
    setActionLoading(true);
    try { await api.connectFutures(market); showToast(`${market.toUpperCase()} futures connected`); await refresh(); }
    catch (err) { showToast(err.message || 'Connection failed', 'error'); }
    finally { setActionLoading(false); }
  };

  const handleFuturesDisconnect = async (market) => {
    setActionLoading(true);
    try { await api.disconnectFutures(market); showToast(`${market.toUpperCase()} futures disconnected`); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setActionLoading(false); }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'spot-order', label: 'Spot Order' },
    { id: 'futures-order', label: 'Futures Order' },
  ];

  return (
    <div className="space-y-6">
      <Toast toast={toast} />

      <div className="flex items-center gap-1 border-b border-border-subtle pb-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>{t.label}</button>
        ))}
        <div className="ml-auto">
          <button onClick={refresh} className="p-2 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {tab === 'overview' && (
        <OverviewTab
          status={status} account={account} futuresAccount={futuresAccount}
          positions={positions} futuresPositions={futuresPositions}
          openOrders={openOrders} futuresOrders={futuresOrders} loading={loading}
          onConnect={handleConnect} onDisconnect={handleDisconnect}
          onFuturesConnect={handleFuturesConnect} onFuturesDisconnect={handleFuturesDisconnect}
          actionLoading={actionLoading} showToast={showToast} refresh={refresh}
        />
      )}
      {tab === 'spot-order' && <OrdersTab status={status} openOrders={openOrders} showToast={showToast} refresh={refresh} />}
      {tab === 'futures-order' && <FuturesTab status={status} futuresPositions={futuresPositions} futuresOrders={futuresOrders} showToast={showToast} refresh={refresh} />}
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────

function OverviewTab({ status, account, futuresAccount, positions, futuresPositions, openOrders, futuresOrders, loading, onConnect, onDisconnect, onFuturesConnect, onFuturesDisconnect, actionLoading, showToast, refresh }) {
  const executor = status?.executor;
  const dailyStats = executor?.dailyStats;

  const handleStartExecutor = async () => {
    try { await api.startExecutor(); showToast('Trade executor started'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const handleStopExecutor = async () => {
    try { await api.stopExecutor(); showToast('Trade executor stopped'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const totalPositions = positions.length + futuresPositions.length;
  const totalOrders = openOrders.length + futuresOrders.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ConnectionPanel
            status={status}
            onConnect={onConnect} onDisconnect={onDisconnect}
            onFuturesConnect={onFuturesConnect} onFuturesDisconnect={onFuturesDisconnect}
            loading={actionLoading}
          />

          {/* Executor Control */}
          {(status?.spot?.connected || Object.values(status?.futures?.markets || {}).some(m => m.initialized)) && (
            <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  <Activity size={14} className="text-warning" />
                  Trade Executor
                </h3>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  executor?.active ? 'bg-success/10 text-success border border-success/20' : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${executor?.active ? 'bg-success animate-pulse' : 'bg-gray-500'}`} />
                  {executor?.active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="flex gap-2">
                {!executor?.active ? (
                  <button onClick={handleStartExecutor}
                    className="px-4 py-2 text-xs font-medium bg-success/10 hover:bg-success/20 text-success border border-success/20 rounded-lg transition-colors flex items-center gap-2">
                    <Power size={12} /> Start Executor
                  </button>
                ) : (
                  <button onClick={handleStopExecutor}
                    className="px-4 py-2 text-xs font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-lg transition-colors flex items-center gap-2">
                    <PowerOff size={12} /> Stop Executor
                  </button>
                )}
              </div>

              {dailyStats && (
                <div className="mt-4 grid grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                    <p className="text-[10px] text-gray-500 uppercase">Trades Today</p>
                    <p className="text-lg font-bold font-mono text-gray-200">{dailyStats.trades}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                    <p className="text-[10px] text-gray-500 uppercase">Daily PnL</p>
                    <p className={`text-lg font-bold font-mono ${dailyStats.pnl >= 0 ? 'text-success' : 'text-error'}`}>
                      {dailyStats.pnl >= 0 ? '+' : ''}{dailyStats.pnl.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                    <p className="text-[10px] text-gray-500 uppercase">Positions</p>
                    <p className="text-lg font-bold font-mono text-gray-200">{totalPositions}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                    <p className="text-[10px] text-gray-500 uppercase">Open Orders</p>
                    <p className="text-lg font-bold font-mono text-gray-200">{totalOrders}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Futures Summary */}
          {futuresAccount && (
            <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
              <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                <Layers size={14} className="text-amber-400" />
                Futures Account
                <MarketBadge market={futuresAccount.market} />
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                  <p className="text-[10px] text-gray-500 uppercase">Wallet Balance</p>
                  <p className="text-sm font-bold font-mono text-gray-200">{parseFloat(futuresAccount.totalWalletBalance || 0).toFixed(4)}</p>
                </div>
                <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                  <p className="text-[10px] text-gray-500 uppercase">Unrealized PnL</p>
                  <p className={`text-sm font-bold font-mono ${parseFloat(futuresAccount.totalUnrealizedProfit || 0) >= 0 ? 'text-success' : 'text-error'}`}>
                    {parseFloat(futuresAccount.totalUnrealizedProfit || 0).toFixed(4)}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
                  <p className="text-[10px] text-gray-500 uppercase">Available</p>
                  <p className="text-sm font-bold font-mono text-gray-200">{parseFloat(futuresAccount.availableBalance || 0).toFixed(4)}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <BalancePanel account={account} futuresAccount={futuresAccount} />

          {openOrders.length > 0 && (
            <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
              <h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
                <Send size={14} className="text-accent" />
                Open Orders ({totalOrders})
              </h3>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {openOrders.slice(0, 5).map(o => (
                  <div key={o.orderId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle text-xs">
                    <div>
                      <span className="font-mono text-gray-200">{o.symbol}</span>
                      <span className={`ml-2 ${o.side === 'BUY' ? 'text-success' : 'text-error'}`}>{o.side}</span>
                    </div>
                    <span className="font-mono text-gray-400">{o.price}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Orders Tab (Spot) ────────────────────────────────────────────

function OrdersTab({ status, openOrders, showToast, refresh }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('BUY');
  const [type, setType] = useState('MARKET');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [placing, setPlacing] = useState(false);
  const connected = status?.spot?.connected;

  const handlePlace = async (e) => {
    e.preventDefault();
    if (!symbol.trim() || !quantity) { showToast('Symbol and quantity required', 'error'); return; }
    setPlacing(true);
    try {
      const params = { symbol: symbol.trim().toUpperCase(), side, type, quantity: String(quantity) };
      if (type === 'LIMIT' && price) { params.price = String(price); params.timeInForce = 'GTC'; }
      if ((type === 'STOP_LOSS_LIMIT' || type === 'TAKE_PROFIT_LIMIT') && price) { params.price = String(price); params.stopPrice = String(price); params.timeInForce = 'GTC'; }
      await api.placeOrder(params);
      showToast('Order placed'); await refresh();
    } catch (err) { showToast(err.message || 'Order failed', 'error'); }
    finally { setPlacing(false); }
  };

  const handleCancel = async (sym, orderId) => {
    try { await api.cancelOrder(sym, orderId); showToast('Order cancelled'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  if (!connected) {
    return (<div className="flex flex-col items-center justify-center py-20"><PowerOff size={36} className="text-gray-700 mb-3" /><p className="text-sm text-gray-400">Connect to Binance to manage orders</p></div>);
  }

  return (
    <div className="space-y-6">
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2"><Send size={14} className="text-accent" />Place Spot Order</h3>
        <form onSubmit={handlePlace} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400 uppercase">Symbol</label>
              <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="BTCUSDT"
                className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400 uppercase">Side</label>
              <div className="flex rounded-lg overflow-hidden border border-border-default">
                <button type="button" onClick={() => setSide('BUY')} className={`flex-1 py-2 text-xs font-medium transition-colors ${side === 'BUY' ? 'bg-success/20 text-success' : 'bg-surface-2 text-gray-400'}`}>BUY</button>
                <button type="button" onClick={() => setSide('SELL')} className={`flex-1 py-2 text-xs font-medium transition-colors ${side === 'SELL' ? 'bg-error/20 text-error' : 'bg-surface-2 text-gray-400'}`}>SELL</button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400 uppercase">Type</label>
              <select value={type} onChange={e => setType(e.target.value)} className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50">
                <option value="MARKET">Market</option><option value="LIMIT">Limit</option><option value="STOP_LOSS_LIMIT">Stop Loss</option><option value="TAKE_PROFIT_LIMIT">Take Profit</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-gray-400 uppercase">Quantity</label>
              <input type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0.001"
                className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
            </div>
          </div>
          {type !== 'MARKET' && (
            <div className="w-48"><label className="text-[10px] font-medium text-gray-400 uppercase">Price</label>
              <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} placeholder="Price"
                className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
            </div>
          )}
          <button type="submit" disabled={placing} className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${side === 'BUY' ? 'bg-success hover:bg-green-600 text-white' : 'bg-error hover:bg-red-600 text-white'} disabled:opacity-50`}>
            {placing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} {side} {type}
          </button>
        </form>
      </div>

      <OpenOrdersTable orders={openOrders} onCancel={handleCancel} title="Spot Open Orders" />
    </div>
  );
}

function OpenOrdersTable({ orders, onCancel, title }) {
  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
      <div className="px-5 py-4 border-b border-border-subtle"><h3 className="text-sm font-semibold text-gray-200">{title} ({orders.length})</h3></div>
      {orders.length === 0 ? (
        <div className="px-5 py-12 text-center"><Send size={24} className="mx-auto text-gray-700 mb-2" /><p className="text-xs text-gray-500">No open orders</p></div>
      ) : (
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 sticky top-0"><tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
              <th className="px-4 py-3">Symbol</th><th className="px-4 py-3">Side</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Qty</th><th className="px-4 py-3">Price</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th>
            </tr></thead>
            <tbody className="divide-y divide-border-subtle">
              {orders.map(o => (
                <tr key={o.orderId} className="hover:bg-surface-2/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-medium text-gray-200">{o.symbol}</td>
                  <td className={`px-4 py-2.5 font-medium ${o.side === 'BUY' ? 'text-success' : 'text-error'}`}>{o.side}</td>
                  <td className="px-4 py-2.5 text-gray-400">{o.type}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-300">{o.origQty || o.quantity}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-300">{o.price}</td>
                  <td className="px-4 py-2.5"><span className="px-2 py-0.5 text-[10px] rounded-full bg-warning/10 text-warning border border-warning/20">{o.status}</span></td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onCancel(o.symbol, o.orderId)} className="p-1.5 rounded-md hover:bg-error/10 text-gray-400 hover:text-error transition-colors" title="Cancel"><X size={14} /></button>
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


// ─── Futures Tab ──────────────────────────────────────────────────

function FuturesTab({ status, futuresPositions, futuresOrders, showToast, refresh }) {
  const [market, setMarket] = useState('usdm');
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('BUY');
  const [type, setType] = useState('MARKET');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [leverage, setLeverage] = useState('10');
  const [placing, setPlacing] = useState(false);

  const futuresMarkets = status?.futures?.markets || {};
  const connected = futuresMarkets[market]?.initialized;

  const handlePlace = async (e) => {
    e.preventDefault();
    if (!symbol.trim() || !quantity) { showToast('Symbol and quantity required', 'error'); return; }
    setPlacing(true);
    try {
      const params = { symbol: symbol.trim().toUpperCase(), side, type, quantity: String(quantity) };
      if (type !== 'MARKET' && price) { params.price = String(price); params.timeInForce = 'GTC'; }
      if (type === 'STOP_MARKET' && price) { params.stopPrice = String(price); delete params.price; }
      if (type === 'TAKE_PROFIT_MARKET' && price) { params.stopPrice = String(price); delete params.price; }
      await api.placeFuturesOrder(market, params);
      showToast('Futures order placed'); await refresh();
    } catch (err) { showToast(err.message || 'Order failed', 'error'); }
    finally { setPlacing(false); }
  };

  const handleSetLeverage = async () => {
    if (!symbol.trim()) { showToast('Enter symbol first', 'error'); return; }
    try {
      await api.setFuturesLeverage(market, symbol.trim().toUpperCase(), Number(leverage));
      showToast(`Leverage set to ${leverage}x`);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancelOrder = async (sym, orderId) => {
    try { await api.cancelFuturesOrder(market, sym, orderId); showToast('Order cancelled'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const handleClosePosition = async (sym, positionSide) => {
    try { await api.closeFuturesPosition(market, sym, positionSide); showToast(`Position closed`); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  if (!Object.values(futuresMarkets).some(m => m.initialized)) {
    return (<div className="flex flex-col items-center justify-center py-20"><Layers size={36} className="text-gray-700 mb-3" /><p className="text-sm text-gray-400">Connect to Futures in Overview tab</p></div>);
  }

  return (
    <div className="space-y-6">
      {/* Market selector */}
      <div className="flex items-center gap-2">
        {Object.entries(futuresMarkets).filter(([,v]) => v.initialized).map(([m]) => (
          <button key={m} onClick={() => setMarket(m)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${market === m ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface-2 text-gray-400 border-border-subtle hover:text-gray-200'}`}>
            {m === 'usdm' ? 'USD-M Futures' : 'COIN-M Futures'}
          </button>
        ))}
      </div>

      {connected && (
        <>
          {/* Leverage + Order Form */}
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2"><Zap size={14} className="text-amber-400" />Place Futures Order</h3>
            <form onSubmit={handlePlace} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-gray-400 uppercase">Symbol</label>
                  <input type="text" value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="BTCUSDT"
                    className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-gray-400 uppercase">Side</label>
                  <div className="flex rounded-lg overflow-hidden border border-border-default">
                    <button type="button" onClick={() => setSide('BUY')} className={`flex-1 py-2 text-xs font-medium ${side === 'BUY' ? 'bg-success/20 text-success' : 'bg-surface-2 text-gray-400'}`}>LONG</button>
                    <button type="button" onClick={() => setSide('SELL')} className={`flex-1 py-2 text-xs font-medium ${side === 'SELL' ? 'bg-error/20 text-error' : 'bg-surface-2 text-gray-400'}`}>SHORT</button>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-gray-400 uppercase">Type</label>
                  <select value={type} onChange={e => setType(e.target.value)} className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50">
                    <option value="MARKET">Market</option><option value="LIMIT">Limit</option><option value="STOP_MARKET">Stop Market</option><option value="TAKE_PROFIT_MARKET">Take Profit</option><option value="TRAILING_STOP_MARKET">Trailing Stop</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-gray-400 uppercase">Quantity</label>
                  <input type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0.001"
                    className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-gray-400 uppercase">Leverage</label>
                  <div className="flex gap-1">
                    <input type="number" min="1" max="125" value={leverage} onChange={e => setLeverage(e.target.value)}
                      className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50" />
                    <button type="button" onClick={handleSetLeverage} className="px-2 py-1 text-[10px] bg-accent/10 text-accent border border-accent/20 rounded-md hover:bg-accent/20">Set</button>
                  </div>
                </div>
              </div>
              {type !== 'MARKET' && (
                <div className="w-48"><label className="text-[10px] font-medium text-gray-400 uppercase">{type.includes('STOP') || type.includes('PROFIT') ? 'Stop Price' : 'Price'}</label>
                  <input type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} placeholder="Price"
                    className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
                </div>
              )}
              <button type="submit" disabled={placing} className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${side === 'BUY' ? 'bg-success hover:bg-green-600 text-white' : 'bg-error hover:bg-red-600 text-white'} disabled:opacity-50`}>
                {placing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} {side === 'BUY' ? 'Long' : 'Short'} {type}
              </button>
            </form>
          </div>

          {/* Futures Positions */}
          {futuresPositions.length > 0 && (
            <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
              <div className="px-5 py-4 border-b border-border-subtle"><h3 className="text-sm font-semibold text-gray-200">Futures Positions ({futuresPositions.length})</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2"><tr className="text-left text-xs text-gray-400 uppercase tracking-wider">
                    <th className="px-4 py-3">Symbol</th><th className="px-4 py-3">Side</th><th className="px-4 py-3">Size</th><th className="px-4 py-3">Entry</th><th className="px-4 py-3">Mark</th><th className="px-4 py-3">PnL</th><th className="px-4 py-3">Lev</th><th className="px-4 py-3 text-right">Action</th>
                  </tr></thead>
                  <tbody className="divide-y divide-border-subtle">
                    {futuresPositions.map((p, i) => (
                      <tr key={`${p.symbol}-${p.positionSide}-${i}`} className="hover:bg-surface-2/50">
                        <td className="px-4 py-2.5 font-mono font-medium text-gray-200">{p.symbol}</td>
                        <td className={`px-4 py-2.5 font-medium ${p.positionAmt > 0 ? 'text-success' : 'text-error'}`}>{p.positionAmt > 0 ? 'LONG' : 'SHORT'}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-300">{Math.abs(p.positionAmt)}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-300">{p.entryPrice?.toFixed(2)}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-300">{p.markPrice?.toFixed(2)}</td>
                        <td className={`px-4 py-2.5 font-mono ${p.unrealizedProfit >= 0 ? 'text-success' : 'text-error'}`}>{p.unrealizedProfit?.toFixed(4)}</td>
                        <td className="px-4 py-2.5 font-mono text-gray-300">{p.leverage}x</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => handleClosePosition(p.symbol, p.positionSide)} className="px-2 py-1 text-[10px] bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md">Close</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Futures Open Orders */}
          {futuresOrders.length > 0 && (
            <OpenOrdersTable orders={futuresOrders} onCancel={handleCancelOrder} title="Futures Open Orders" />
          )}
        </>
      )}
    </div>
  );
}


// ─── Positions Tab ────────────────────────────────────────────────

function PositionsTab({ positions, futuresPositions, status, showToast, refresh }) {
  const spotConnected = status?.spot?.connected;
  const executorActive = status?.executor?.active;

  const handleCloseSpot = async (symbol) => {
    try { await api.closePosition('spot', symbol); showToast(`Position ${symbol} closed`); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const handleCloseFutures = async (market, symbol, positionSide) => {
    try { await api.closeFuturesPosition(market, symbol, positionSide); showToast(`Futures position closed`); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const handleCloseAll = async () => {
    if (!confirm('Close ALL open positions at market?')) return;
    try { await api.closeAllPositions(); showToast('All positions closed'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const totalPositions = positions.length + futuresPositions.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <TrendingUp size={14} className="text-success" />
          All Positions ({totalPositions})
        </h3>
        {totalPositions > 0 && (
          <button onClick={handleCloseAll}
            className="px-3 py-1.5 text-xs font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-lg transition-colors flex items-center gap-1.5">
            <X size={12} /> Close All
          </button>
        )}
      </div>

      {totalPositions === 0 ? (
        <div className="bg-surface-1 rounded-xl border border-border-subtle px-5 py-16 text-center">
          <Activity size={32} className="mx-auto text-gray-700 mb-3" />
          <p className="text-sm text-gray-400">No open positions</p>
          <p className="text-xs text-gray-600 mt-1">{executorActive ? 'Waiting for signals...' : 'Start the executor or place manual orders'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Spot positions */}
          {positions.map(pos => (
            <div key={`spot-${pos.symbol}`} className="bg-surface-1 rounded-xl border border-border-subtle p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MarketBadge market="spot" />
                  <span className="font-mono font-bold text-gray-200">{pos.symbol}</span>
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-success/10 text-success">LONG</span>
                </div>
                <button onClick={() => handleCloseSpot(pos.symbol)}
                  className="px-2.5 py-1 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md">Close</button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><p className="text-gray-500">Entry Price</p><p className="font-mono text-gray-200">{pos.entryPrice?.toFixed(4)}</p></div>
                <div><p className="text-gray-500">Quantity</p><p className="font-mono text-gray-200">{pos.quantity}</p></div>
                {pos.stopLoss && <div><p className="text-gray-500">Stop Loss</p><p className="font-mono text-error">{pos.stopLoss}</p></div>}
                {pos.takeProfit && <div><p className="text-gray-500">Take Profit</p><p className="font-mono text-success">{pos.takeProfit}</p></div>}
              </div>
              {pos.entryTime && <p className="text-[10px] text-gray-600 mt-3">Opened: {new Date(pos.entryTime).toLocaleString()}</p>}
            </div>
          ))}

          {/* Futures positions */}
          {futuresPositions.map((pos, i) => (
            <div key={`fut-${pos.symbol}-${pos.positionSide}-${i}`} className="bg-surface-1 rounded-xl border border-border-subtle p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <MarketBadge market={pos.market || 'usdm'} />
                  <span className="font-mono font-bold text-gray-200">{pos.symbol}</span>
                  <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${pos.positionAmt > 0 ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>
                    {pos.positionAmt > 0 ? 'LONG' : 'SHORT'}
                  </span>
                </div>
                <button onClick={() => handleCloseFutures(pos.market || 'usdm', pos.symbol, pos.positionSide)}
                  className="px-2.5 py-1 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md">Close</button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div><p className="text-gray-500">Entry</p><p className="font-mono text-gray-200">{pos.entryPrice?.toFixed(2)}</p></div>
                <div><p className="text-gray-500">Mark</p><p className="font-mono text-gray-200">{pos.markPrice?.toFixed(2)}</p></div>
                <div><p className="text-gray-500">Size</p><p className="font-mono text-gray-200">{Math.abs(pos.positionAmt)}</p></div>
                <div><p className="text-gray-500">Leverage</p><p className="font-mono text-gray-200">{pos.leverage}x</p></div>
                <div><p className="text-gray-500">Margin</p><p className="font-mono text-gray-200">{pos.marginType}</p></div>
                <div><p className="text-gray-500">PnL</p><p className={`font-mono ${pos.unrealizedProfit >= 0 ? 'text-success' : 'text-error'}`}>{pos.unrealizedProfit?.toFixed(4)}</p></div>
              </div>
              {pos.liquidationPrice > 0 && <p className="text-[10px] text-error/70 mt-3">Liquidation: {pos.liquidationPrice.toFixed(2)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Settings Tab ─────────────────────────────────────────────────

function SettingsTab({ status, showToast, refresh }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [testnet, setTestnet] = useState(true);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [futuresEnabled, setFuturesEnabled] = useState(false);
  const [futuresMarkets, setFuturesMarkets] = useState(['usdm']);
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [riskLimits, setRiskLimits] = useState(null);
  const [futuresRiskLimits, setFuturesRiskLimits] = useState(null);

  useEffect(() => {
    if (status?.config) {
      setTestnet(status.config.testnet ?? true);
      setTradingEnabled(status.config.tradingEnabled ?? false);
      setRiskLimits(status.config.riskLimits || null);
      setFuturesEnabled(status.config.futures?.enabled ?? false);
      setFuturesMarkets(status.config.futures?.markets || ['usdm']);
      setFuturesRiskLimits(status.config.futures?.riskLimits || null);
    }
  }, [status]);

  const handleSaveCredentials = async (e) => {
    e.preventDefault();
    if (!apiKey.trim() || !apiSecret.trim()) { showToast('API Key and Secret required', 'error'); return; }
    setSaving(true);
    try {
      await api.saveTradingConfig({ apiKey, apiSecret, testnet, tradingEnabled, riskLimits, futures: { enabled: futuresEnabled, markets: futuresMarkets, riskLimits: futuresRiskLimits } });
      showToast('Configuration saved'); setApiKey(''); setApiSecret(''); await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleUpdateSettings = async () => {
    setSaving(true);
    try {
      await api.updateTradingConfig({ testnet, tradingEnabled, riskLimits, futures: { enabled: futuresEnabled, markets: futuresMarkets, riskLimits: futuresRiskLimits } });
      showToast('Settings updated'); await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDeleteConfig = async () => {
    if (!confirm('Delete all Binance credentials? This cannot be undone.')) return;
    try { await api.deleteTradingConfig(); showToast('Configuration deleted'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  const updateRiskLimit = (key, value) => setRiskLimits(prev => ({ ...(prev || {}), [key]: value }));
  const updateFuturesRiskLimit = (key, value) => setFuturesRiskLimits(prev => ({ ...(prev || {}), [key]: value }));

  const toggleFuturesMarket = (m) => {
    setFuturesMarkets(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  };

  const configured = status?.config?.configured;

  return (
    <div className="space-y-6">
      {/* API Credentials */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <Shield size={14} className="text-accent" /> API Credentials
          {configured && <span className="ml-2 px-2 py-0.5 text-[10px] rounded-full bg-success/10 text-success border border-success/20">Configured</span>}
        </h3>
        {configured && (
          <div className="space-y-3 mb-4">
            <p className="text-xs text-gray-400">Credentials stored encrypted. Enter new values to replace.</p>
            <button onClick={handleDeleteConfig} className="px-3 py-1.5 text-xs font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-lg">Delete Credentials</button>
          </div>
        )}
        <form onSubmit={handleSaveCredentials} className="space-y-3">
          <div className="space-y-1"><label className="text-[10px] font-medium text-gray-400 uppercase">API Key</label>
            <input type={showSecrets ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={configured ? '•••••••• (enter new to replace)' : 'Enter API Key'}
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" /></div>
          <div className="space-y-1"><label className="text-[10px] font-medium text-gray-400 uppercase">API Secret</label>
            <input type={showSecrets ? 'text' : 'password'} value={apiSecret} onChange={e => setApiSecret(e.target.value)} placeholder={configured ? '•••••••• (enter new to replace)' : 'Enter API Secret'}
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" /></div>
          <button type="button" onClick={() => setShowSecrets(!showSecrets)} className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1">
            {showSecrets ? <EyeOff size={12} /> : <Eye size={12} />} {showSecrets ? 'Hide' : 'Show'}
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Save Credentials
          </button>
        </form>
      </div>

      {/* Trading Settings */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2"><Settings size={14} className="text-warning" />Trading Settings</h3>
        <div className="space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div><p className="text-sm text-gray-200">Testnet Mode</p><p className="text-[10px] text-gray-500">Use Binance testnet (no real funds)</p></div>
            <input type="checkbox" checked={testnet} onChange={e => setTestnet(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <div><p className="text-sm text-gray-200">Enable Trading</p><p className="text-[10px] text-gray-500">Allow placing real orders</p></div>
            <input type="checkbox" checked={tradingEnabled} onChange={e => setTradingEnabled(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <div><p className="text-sm text-gray-200">Enable Futures</p><p className="text-[10px] text-gray-500">USD-M and COIN-M futures trading</p></div>
            <input type="checkbox" checked={futuresEnabled} onChange={e => setFuturesEnabled(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
          </label>
          {futuresEnabled && (
            <div className="ml-4 space-y-2">
              <p className="text-[10px] text-gray-400 uppercase">Futures Markets</p>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={futuresMarkets.includes('usdm')} onChange={() => toggleFuturesMarket('usdm')} className="w-3.5 h-3.5 rounded accent-accent" /> USD-M (USDT settled)
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={futuresMarkets.includes('coinm')} onChange={() => toggleFuturesMarket('coinm')} className="w-3.5 h-3.5 rounded accent-accent" /> COIN-M (Coin settled)
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Spot Risk Limits */}
      {riskLimits && (
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2"><AlertCircle size={14} className="text-error" />Spot Risk Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RiskInput label="Max Position Size (USDT)" value={riskLimits.maxPositionSizeUSDT} onChange={v => updateRiskLimit('maxPositionSizeUSDT', Number(v))} />
            <RiskInput label="Max Daily Loss (USDT)" value={riskLimits.maxDailyLossUSDT} onChange={v => updateRiskLimit('maxDailyLossUSDT', Number(v))} />
            <RiskInput label="Max Daily Trades" value={riskLimits.maxDailyTrades} onChange={v => updateRiskLimit('maxDailyTrades', Number(v))} />
            <RiskInput label="Max Open Positions" value={riskLimits.maxOpenPositions} onChange={v => updateRiskLimit('maxOpenPositions', Number(v))} />
            <RiskInput label="Max Slippage %" value={riskLimits.maxSlippagePct} onChange={v => updateRiskLimit('maxSlippagePct', Number(v))} step="0.1" />
            <RiskInput label="Loss Cooldown (ms)" value={riskLimits.cooldownAfterLossMs} onChange={v => updateRiskLimit('cooldownAfterLossMs', Number(v))} />
          </div>
        </div>
      )}

      {/* Futures Risk Limits */}
      {futuresEnabled && futuresRiskLimits && (
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2"><Zap size={14} className="text-amber-400" />Futures Risk Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RiskInput label="Max Leverage" value={futuresRiskLimits.maxLeverage} onChange={v => updateFuturesRiskLimit('maxLeverage', Number(v))} />
            <RiskInput label="Max Position Size (USDT)" value={futuresRiskLimits.maxPositionSizeUSDT} onChange={v => updateFuturesRiskLimit('maxPositionSizeUSDT', Number(v))} />
            <RiskInput label="Max Daily Loss (USDT)" value={futuresRiskLimits.maxDailyLossUSDT} onChange={v => updateFuturesRiskLimit('maxDailyLossUSDT', Number(v))} />
            <RiskInput label="Max Daily Trades" value={futuresRiskLimits.maxDailyTrades} onChange={v => updateFuturesRiskLimit('maxDailyTrades', Number(v))} />
            <RiskInput label="Max Open Positions" value={futuresRiskLimits.maxOpenPositions} onChange={v => updateFuturesRiskLimit('maxOpenPositions', Number(v))} />
            <RiskInput label="Max Drawdown %" value={futuresRiskLimits.maxDrawdownPct} onChange={v => updateFuturesRiskLimit('maxDrawdownPct', Number(v))} step="0.5" />
            <RiskInput label="Default SL %" value={futuresRiskLimits.defaultStopLossPct} onChange={v => updateFuturesRiskLimit('defaultStopLossPct', Number(v))} step="0.1" />
            <RiskInput label="Default TP %" value={futuresRiskLimits.defaultTakeProfitPct} onChange={v => updateFuturesRiskLimit('defaultTakeProfitPct', Number(v))} step="0.1" />
          </div>
        </div>
      )}

      {configured && (
        <button onClick={handleUpdateSettings} disabled={saving}
          className="px-5 py-2.5 text-sm font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Save Settings
        </button>
      )}
    </div>
  );
}

function RiskInput({ label, value, onChange, step = '1' }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-gray-400 uppercase">{label}</label>
      <input type="number" step={step} value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50" />
    </div>
  );
}
