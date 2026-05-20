import {
  Play, Square, Pause, RotateCcw, Trash2, Settings,
  TrendingUp, TrendingDown, Zap, AlertCircle,
} from 'lucide-react';

/**
 * BotCard — displays a single bot's status, stats, and controls.
 */
export default function BotCard({ bot, onStart, onStop, onPause, onResume, onDelete, onEdit }) {
  const { config, state, stats, position, winRate } = bot;
  const isRunning = state === 'running';
  const isPaused = state === 'paused';
  const isError = state === 'error';

  const stateColors = {
    running: 'bg-success/10 text-success border-success/20',
    paused: 'bg-warning/10 text-warning border-warning/20',
    stopped: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    error: 'bg-error/10 text-error border-error/20',
    created: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    starting: 'bg-accent/10 text-accent border-accent/20',
  };

  const marketColors = {
    spot: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    usdm: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    coinm: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  };

  return (
    <div className={`bg-surface-1 rounded-xl border p-5 transition-all ${
      isRunning ? 'border-success/20 shadow-sm shadow-success/5' :
      isError ? 'border-error/20' : 'border-border-subtle'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-gray-100 text-sm">{config.symbol}</span>
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${marketColors[config.market] || marketColors.spot}`}>
            {config.market === 'usdm' ? 'USD-M' : config.market === 'coinm' ? 'COIN-M' : 'SPOT'}
          </span>
          <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-surface-2 text-gray-400 border border-border-subtle">
            {config.strategy}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${stateColors[state] || stateColors.stopped}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-success animate-pulse' : isPaused ? 'bg-warning' : isError ? 'bg-error' : 'bg-gray-500'}`} />
          {state}
        </span>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div>
          <p className="text-[9px] text-gray-500 uppercase">PnL</p>
          <p className={`text-xs font-mono font-medium ${(stats?.totalPnl || 0) >= 0 ? 'text-success' : 'text-error'}`}>
            {(stats?.totalPnl || 0) >= 0 ? '+' : ''}{(stats?.totalPnl || 0).toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-gray-500 uppercase">Trades</p>
          <p className="text-xs font-mono font-medium text-gray-200">{stats?.totalTrades || 0}</p>
        </div>
        <div>
          <p className="text-[9px] text-gray-500 uppercase">Win Rate</p>
          <p className="text-xs font-mono font-medium text-gray-200">{winRate || '0.0'}%</p>
        </div>
        <div>
          <p className="text-[9px] text-gray-500 uppercase">Leverage</p>
          <p className="text-xs font-mono font-medium text-gray-200">{config.leverage}x</p>
        </div>
      </div>

      {/* Position indicator */}
      {position && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            {position.side === 'LONG' ? <TrendingUp size={12} className="text-success" /> : <TrendingDown size={12} className="text-error" />}
            <span className="text-[10px] font-medium text-gray-300">Open: {position.entryPrice?.toFixed(2)}</span>
          </div>
          <span className={`text-[10px] font-mono ${(position.unrealizedPnl || 0) >= 0 ? 'text-success' : 'text-error'}`}>
            {(position.unrealizedPnl || 0) >= 0 ? '+' : ''}{(position.unrealizedPnl || 0).toFixed(4)}
          </span>
        </div>
      )}

      {/* Error message */}
      {isError && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-error/5 border border-error/20 flex items-center gap-2">
          <AlertCircle size={12} className="text-error shrink-0" />
          <span className="text-[10px] text-error">Bot encountered an error</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {!isRunning && !isPaused && (
          <button onClick={() => onStart(bot.id)} className="px-3 py-1.5 text-[10px] font-medium bg-success/10 hover:bg-success/20 text-success border border-success/20 rounded-md transition-colors flex items-center gap-1">
            <Play size={10} /> Start
          </button>
        )}
        {isRunning && (
          <button onClick={() => onPause(bot.id)} className="px-3 py-1.5 text-[10px] font-medium bg-warning/10 hover:bg-warning/20 text-warning border border-warning/20 rounded-md transition-colors flex items-center gap-1">
            <Pause size={10} /> Pause
          </button>
        )}
        {isPaused && (
          <button onClick={() => onResume(bot.id)} className="px-3 py-1.5 text-[10px] font-medium bg-success/10 hover:bg-success/20 text-success border border-success/20 rounded-md transition-colors flex items-center gap-1">
            <RotateCcw size={10} /> Resume
          </button>
        )}
        {(isRunning || isPaused) && (
          <button onClick={() => onStop(bot.id)} className="px-3 py-1.5 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md transition-colors flex items-center gap-1">
            <Square size={10} /> Stop
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onEdit(bot.id)} className="p-1.5 rounded-md hover:bg-surface-2 text-gray-500 hover:text-gray-300 transition-colors">
            <Settings size={12} />
          </button>
          <button onClick={() => onDelete(bot.id)} className="p-1.5 rounded-md hover:bg-error/10 text-gray-500 hover:text-error transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Config footer */}
      <div className="mt-3 pt-3 border-t border-border-subtle flex items-center gap-3 text-[9px] text-gray-500">
        <span>TF: {config.timeframe}</span>
        <span>Alloc: ${config.allocation}</span>
        <span>SL: {config.stopLossPct}%</span>
        <span>TP: {config.takeProfitPct}%</span>
      </div>
    </div>
  );
}
