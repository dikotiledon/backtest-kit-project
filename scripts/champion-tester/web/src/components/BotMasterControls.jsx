import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { queryClient } from '../queryClient.js';
import api from '../api.js';
import {
  Play, Square, Pause, Plus, Trash2, Settings, RefreshCw,
  Loader2, AlertCircle, TrendingUp, TrendingDown, Bot,
  Zap, Power, RotateCcw, ChevronDown, ChevronUp, Search,
} from 'lucide-react';

// ─── Master Control Bar ───────────────────────────────────────────

function MasterControls({ masterState, stats, onStartAll, onStopAll, onPauseAll, onResumeAll, loading }) {
  const isRunning = masterState === 'running';
  const isPaused = masterState === 'paused';

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Bot size={20} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold text-gray-200">Bot Engine</h3>
            <p className="text-[10px] text-gray-500">
              {stats ? `${stats.runningBots}/${stats.totalBots} running` : 'Loading...'}
            </p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
          isRunning ? 'bg-success/10 text-success border border-success/20' :
          isPaused ? 'bg-warning/10 text-warning border border-warning/20' :
          'bg-gray-500/10 text-gray-400 border border-gray-500/20'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isRunning ? 'bg-success animate-pulse' : isPaused ? 'bg-warning' : 'bg-gray-500'
          }`} />
          {isRunning ? 'Running' : isPaused ? 'Paused' : 'Stopped'}
        </span>
      </div>

      {/* Master Buttons */}
      <div className="flex gap-2 flex-wrap">
        {!isRunning && !isPaused && (
          <button onClick={onStartAll} disabled={loading}
            className="px-5 py-2.5 text-sm font-semibold bg-success hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-success/20">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            START ALL BOTS
          </button>
        )}
        {isRunning && (
          <>
            <button onClick={onPauseAll} disabled={loading}
              className="px-4 py-2.5 text-sm font-medium bg-warning/10 hover:bg-warning/20 text-warning border border-warning/20 rounded-lg transition-colors flex items-center gap-2">
              <Pause size={14} /> Pause All
            </button>
            <button onClick={onStopAll} disabled={loading}
              className="px-4 py-2.5 text-sm font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-lg transition-colors flex items-center gap-2">
              <Square size={14} /> Stop All
            </button>
          </>
        )}
        {isPaused && (
          <>
            <button onClick={onResumeAll} disabled={loading}
              className="px-5 py-2.5 text-sm font-semibold bg-success hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-2">
              <Play size={16} /> Resume All
            </button>
            <button onClick={onStopAll} disabled={loading}
              className="px-4 py-2.5 text-sm font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-lg transition-colors flex items-center gap-2">
              <Square size={14} /> Stop All
            </button>
          </>
        )}
      </div>

      {/* Global Stats */}
      {stats && (
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Total PnL" value={`$${(stats.totalPnl || 0).toFixed(2)}`} positive={stats.totalPnl >= 0} />
          <StatCard label="Win Rate" value={`${stats.winRate || '0.0'}%`} />
          <StatCard label="Trades" value={stats.totalTrades || 0} />
          <StatCard label="Wins" value={stats.wins || 0} positive />
          <StatCard label="Losses" value={stats.losses || 0} negative />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, positive, negative }) {
  let color = 'text-gray-200';
  if (positive) color = 'text-success';
  if (negative) color = 'text-error';
  return (
    <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
      <p className="text-[10px] text-gray-500 uppercase">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}

export default MasterControls;
