import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';
import api from '../api.js';
import {
  Terminal, Filter, Trash2, Download, Pause, Play,
  AlertCircle, AlertTriangle, Info, Bug, Loader2,
} from 'lucide-react';

/**
 * SystemLogs — real-time system log viewer.
 * Shows all bot signals, errors, connections, trades, and internal events.
 */
export default function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [paused, setPaused] = useState(false);
  const [maxLogs] = useState(500);
  const bottomRef = useRef(null);
  const { subscribe } = useWebSocket();

  // Subscribe to all WS events and log them
  useEffect(() => {
    const events = [
      'system:log',
      'bot:started', 'bot:stopped', 'bot:paused', 'bot:resumed',
      'bot:signal', 'bot:error', 'bot:autoPaused',
      'bot:signal:rejected',
      'manager:started', 'manager:stopped',
      'trading:connected', 'trading:disconnected',
      'trading:futures:connected', 'trading:futures:disconnected',
      'trading:order:new', 'trading:order:cancel',
      'trading:signal:executed', 'trading:signal:rejected',
      'trading:futures:order:new', 'trading:futures:order:cancel',
      'trading:futures:position:closed',
      'risk:violation', 'risk:killSwitch',
      'bot:created', 'bot:created:batch',
      'stream:connected', 'stream:disconnected', 'stream:error',
    ];

    const unsubs = events.map(event =>
      subscribe(event, (data) => {
        if (paused) return;
        // system:log events carry their own level/message from backend
        const entry = event === 'system:log' ? {
          id: Date.now() + Math.random(),
          timestamp: new Date(),
          event: 'system',
          level: data.level || 'info',
          message: data.message || JSON.stringify(data),
          data,
        } : {
          id: Date.now() + Math.random(),
          timestamp: new Date(),
          event,
          level: getLevel(event),
          message: formatMessage(event, data),
          data,
        };
        setLogs(prev => [...prev.slice(-(maxLogs - 1)), entry]);
      })
    );

    return () => unsubs.forEach(u => u());
  }, [subscribe, paused, maxLogs]);

  // Auto-scroll
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, paused]);

  // Load initial bot logs from API
  useEffect(() => {
    api.getBotLogs?.()?.then(d => {
      if (d?.logs) {
        setLogs(d.logs.map((l, i) => ({
          id: i,
          timestamp: new Date(l.timestamp),
          event: l.event || 'system',
          level: l.level || 'info',
          message: l.message,
          data: l.data,
        })));
      }
    }).catch(() => {});
  }, []);

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.level === filter);

  const handleClear = () => setLogs([]);
  const handleExport = () => {
    const text = filteredLogs.map(l =>
      `[${l.timestamp.toISOString()}] [${l.level.toUpperCase()}] ${l.event}: ${l.message}`
    ).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `crypto-trader-logs-${Date.now()}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-accent" />
          <h3 className="text-sm font-semibold text-gray-200">System Logs</h3>
          <span className="text-[10px] text-gray-500 ml-2">{logs.length} entries</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPaused(!paused)}
            className={`p-1.5 rounded-md transition-colors ${paused ? 'bg-warning/10 text-warning' : 'hover:bg-surface-2 text-gray-400 hover:text-gray-200'}`}
            title={paused ? 'Resume' : 'Pause'}>
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
          <button onClick={handleExport} className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200" title="Export">
            <Download size={12} />
          </button>
          <button onClick={handleClear} className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200" title="Clear">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Level Filters */}
      <div className="flex items-center gap-1">
        <Filter size={10} className="text-gray-500 mr-1" />
        {['all', 'info', 'warn', 'error', 'debug', 'signal'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
              filter === f ? levelFilterColor(f) : 'text-gray-500 hover:text-gray-300'
            }`}>
            {f === 'all' ? `All (${logs.length})` : `${f} (${logs.filter(l => l.level === f).length})`}
          </button>
        ))}
      </div>

      {/* Log Stream */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
        <div className="max-h-[600px] overflow-y-auto font-mono text-[11px] p-4 space-y-0.5">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-12">
              <Terminal size={28} className="mx-auto text-gray-700 mb-3" />
              <p className="text-sm text-gray-400">No logs yet</p>
              <p className="text-xs text-gray-600 mt-1">Events will appear here in real-time as bots run</p>
            </div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} className="flex items-start gap-2 py-1 hover:bg-surface-2/30 px-2 rounded">
                <LevelIcon level={log.level} />
                <span className="text-gray-600 shrink-0 w-[70px]">
                  {log.timestamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`shrink-0 w-[180px] ${levelTextColor(log.level)}`}>
                  {log.event}
                </span>
                <span className="text-gray-300 break-all">{log.message}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {paused && (
        <div className="bg-warning/5 border border-warning/20 rounded-lg p-3 flex items-center gap-2">
          <Pause size={12} className="text-warning" />
          <p className="text-[11px] text-warning">Log stream paused. New events are being buffered.</p>
        </div>
      )}
    </div>
  );
}

function LevelIcon({ level }) {
  switch (level) {
    case 'error': return <AlertCircle size={11} className="text-error mt-0.5 shrink-0" />;
    case 'warn': return <AlertTriangle size={11} className="text-warning mt-0.5 shrink-0" />;
    case 'signal': return <span className="text-amber-400 mt-0.5 shrink-0">⚡</span>;
    case 'debug': return <Bug size={11} className="text-gray-500 mt-0.5 shrink-0" />;
    default: return <Info size={11} className="text-blue-400 mt-0.5 shrink-0" />;
  }
}

function levelTextColor(level) {
  switch (level) {
    case 'error': return 'text-error';
    case 'warn': return 'text-warning';
    case 'signal': return 'text-amber-400';
    case 'debug': return 'text-gray-500';
    default: return 'text-blue-400';
  }
}

function levelFilterColor(f) {
  switch (f) {
    case 'error': return 'bg-error/10 text-error';
    case 'warn': return 'bg-warning/10 text-warning';
    case 'signal': return 'bg-amber-500/10 text-amber-400';
    case 'debug': return 'bg-gray-500/10 text-gray-400';
    case 'info': return 'bg-blue-500/10 text-blue-400';
    default: return 'bg-accent/10 text-accent';
  }
}

function getLevel(event) {
  if (event.includes('error') || event.includes('Error')) return 'error';
  if (event.includes('signal') || event.includes('Signal')) return 'signal';
  if (event.includes('risk') || event.includes('autoPaused') || event.includes('killSwitch')) return 'warn';
  if (event.includes('debug')) return 'debug';
  return 'info';
}

function formatMessage(event, data) {
  if (!data) return '';
  switch (event) {
    case 'bot:started': return `Bot ${data.id || ''} started on ${data.symbol || ''}`;
    case 'bot:stopped': return `Bot ${data.id || ''} stopped`;
    case 'bot:paused': return `Bot ${data.id || ''} paused`;
    case 'bot:signal': return `${data.action || 'SIGNAL'} ${data.symbol || ''} @ ${data.price || ''} conf=${data.confidence || ''} — ${data.reason || ''}`;
    case 'bot:error': return `Bot ${data.id || ''}: ${data.error || data.message || ''}`;
    case 'bot:autoPaused': return `Bot ${data.id || ''} auto-paused: ${data.reason || ''}`;
    case 'manager:started': return `Bot Manager started (${data.count || 0} bots)`;
    case 'manager:stopped': return 'Bot Manager stopped';
    case 'trading:connected': return `Spot connected (testnet=${data.testnet ?? '?'})`;
    case 'trading:disconnected': return 'Spot disconnected';
    case 'trading:futures:connected': return `Futures connected: ${JSON.stringify(data.markets || [])}`;
    case 'trading:futures:disconnected': return 'Futures disconnected';
    case 'trading:order:new': return `Order: ${data.side} ${data.symbol} qty=${data.quantity} @ ${data.price || 'MARKET'}`;
    case 'trading:signal:executed': return `Signal executed: ${data.side} ${data.symbol} — ${data.orderId || ''}`;
    case 'trading:signal:rejected': return `Signal REJECTED: ${data.reason || ''}`;
    case 'risk:violation': return `Risk violation: ${data.rule || ''} — ${data.detail || ''}`;
    case 'risk:killSwitch': return `KILL SWITCH ${data.active ? 'ACTIVATED' : 'deactivated'}: ${data.reason || ''}`;
    case 'bot:created': return `Bot created: ${data.config?.symbol || ''} / ${data.config?.strategy || ''}`;
    default: return JSON.stringify(data).slice(0, 200);
  }
}
