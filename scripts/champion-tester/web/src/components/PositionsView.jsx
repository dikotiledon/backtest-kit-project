import { useState } from 'react';
import { useAllPositions } from '../hooks/useTrades.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { queryClient } from '../queryClient.js';
import MarketBadge from './ui/MarketBadge.jsx';
import api from '../api.js';
import {
  TrendingUp, TrendingDown, X, RefreshCw, Loader2,
  AlertTriangle, Activity, DollarSign,
} from 'lucide-react';
import { useEffect } from 'react';

/**
 * PositionsView — live monitoring of all open positions (spot + futures).
 */
export default function PositionsView() {
  const { data, isLoading: loading } = useAllPositions();
  const status = data?.status || null;
  const positions = data?.positions || [];
  const futuresPositions = data?.futuresPositions || [];

  const { subscribe } = useWebSocket();
  const [closing, setClosing] = useState(null);

  useEffect(() => {
    const unsubs = [
      subscribe('trading:order:new', () => queryClient.invalidateQueries({ queryKey: ['trades', 'all-positions'] })),
      subscribe('trading:signal:executed', () => queryClient.invalidateQueries({ queryKey: ['trades', 'all-positions'] })),
      subscribe('trading:futures:position:closed', () => queryClient.invalidateQueries({ queryKey: ['trades', 'all-positions'] })),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['trades', 'all-positions'] });

  const handleCloseSpot = async (symbol) => {
    setClosing(symbol);
    try {
      await api.closePosition('spot', symbol);
      refresh();
    } catch {}
    finally { setClosing(null); }
  };

  const handleCloseFutures = async (market, symbol, positionSide) => {
    const key = `${market}:${symbol}:${positionSide}`;
    setClosing(key);
    try {
      await api.closeFuturesPosition(market, symbol, positionSide);
      refresh();
    } catch {}
    finally { setClosing(null); }
  };

  const handleCloseAll = async () => {
    if (!confirm('Close ALL open positions at market price?')) return;
    setClosing('all');
    try {
      await api.closeAllPositions();
      refresh();
    } catch {}
    finally { setClosing(null); }
  };

  const allPositions = [
    ...positions.map(p => ({ ...p, _market: 'spot', _key: `spot:${p.symbol}` })),
    ...futuresPositions.map((p, i) => ({ ...p, _market: 'usdm', _key: `usdm:${p.symbol}:${p.positionSide || i}` })),
  ];

  const totalUnrealizedPnl = futuresPositions.reduce((sum, p) => sum + (parseFloat(p.unrealizedProfit) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Activity size={14} className="text-accent" />
            Open Positions ({allPositions.length})
          </h3>
          {futuresPositions.length > 0 && (
            <span className={`text-xs font-mono ${totalUnrealizedPnl >= 0 ? 'text-success' : 'text-error'}`}>
              Unrealized: {totalUnrealizedPnl >= 0 ? '+' : ''}{totalUnrealizedPnl.toFixed(4)} USDT
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {allPositions.length > 0 && (
            <button onClick={handleCloseAll} disabled={!!closing}
              className="px-3 py-1.5 text-xs font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-lg transition-colors flex items-center gap-1.5">
              <X size={12} /> Close All
            </button>
          )}
          <button onClick={refresh} className="p-2 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200 transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Positions Grid */}
      {allPositions.length === 0 ? (
        <div className="bg-surface-1 rounded-xl border border-border-subtle px-5 py-16 text-center">
          <Activity size={36} className="mx-auto text-gray-700 mb-3" />
          <p className="text-sm text-gray-300 font-medium">No open positions</p>
          <p className="text-xs text-gray-500 mt-1">Positions will appear here when bots execute trades or you place manual orders</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {allPositions.map(pos => (
            <PositionCard
              key={pos._key}
              position={pos}
              onClose={() => {
                if (pos._market === 'spot') handleCloseSpot(pos.symbol);
                else handleCloseFutures(pos._market, pos.symbol, pos.positionSide);
              }}
              closing={closing === pos._key || closing === 'all'}
            />
          ))}
        </div>
      )}

      {/* Connection warning */}
      {status && !status?.spot?.connected && !Object.values(status?.futures?.markets || {}).some(m => m.initialized) && (
        <div className="bg-warning/5 border border-warning/20 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={16} className="text-warning shrink-0" />
          <p className="text-xs text-warning">Not connected to Binance. Connect in the Trading tab to see live positions.</p>
        </div>
      )}
    </div>
  );
}

function PositionCard({ position, onClose, closing }) {
  const pos = position;
  const isSpot = pos._market === 'spot';
  const isLong = isSpot ? true : parseFloat(pos.positionAmt) > 0;
  const pnl = isSpot ? null : parseFloat(pos.unrealizedProfit) || 0;
  const entryPrice = isSpot ? pos.entryPrice : parseFloat(pos.entryPrice);
  const markPrice = isSpot ? null : parseFloat(pos.markPrice);
  const size = isSpot ? pos.quantity : Math.abs(parseFloat(pos.positionAmt));
  const leverage = pos.leverage || 1;

  const marketColors = {
    spot: 'border-blue-500/20',
    usdm: 'border-amber-500/20',
    coinm: 'border-purple-500/20',
  };

  return (
    <div className={`bg-surface-1 rounded-xl border p-5 ${marketColors[pos._market] || 'border-border-subtle'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isLong ? <TrendingUp size={14} className="text-success" /> : <TrendingDown size={14} className="text-error" />}
          <span className="font-mono font-bold text-gray-100">{pos.symbol}</span>
          <MarketBadge market={pos._market} />
        </div>
        <button onClick={onClose} disabled={closing}
          className="px-2.5 py-1 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md transition-colors disabled:opacity-50">
          {closing ? <Loader2 size={10} className="animate-spin" /> : 'Close'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-500 text-[9px] uppercase">Side</p>
          <p className={`font-medium ${isLong ? 'text-success' : 'text-error'}`}>{isLong ? 'LONG' : 'SHORT'}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[9px] uppercase">Size</p>
          <p className="font-mono text-gray-200">{size}</p>
        </div>
        <div>
          <p className="text-gray-500 text-[9px] uppercase">Entry</p>
          <p className="font-mono text-gray-200">{entryPrice?.toFixed(2)}</p>
        </div>
        {markPrice && (
          <div>
            <p className="text-gray-500 text-[9px] uppercase">Mark</p>
            <p className="font-mono text-gray-200">{markPrice.toFixed(2)}</p>
          </div>
        )}
        {!isSpot && (
          <div>
            <p className="text-gray-500 text-[9px] uppercase">Leverage</p>
            <p className="font-mono text-gray-200">{leverage}x</p>
          </div>
        )}
        {pnl !== null && (
          <div>
            <p className="text-gray-500 text-[9px] uppercase">PnL</p>
            <p className={`font-mono font-medium ${pnl >= 0 ? 'text-success' : 'text-error'}`}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}
            </p>
          </div>
        )}
      </div>

      {/* Liquidation warning */}
      {pos.liquidationPrice && parseFloat(pos.liquidationPrice) > 0 && (
        <div className="mt-3 pt-2 border-t border-border-subtle">
          <p className="text-[9px] text-error/70 flex items-center gap-1">
            <AlertTriangle size={9} /> Liq: {parseFloat(pos.liquidationPrice).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
