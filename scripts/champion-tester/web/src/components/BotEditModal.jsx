import { useState, useEffect } from 'react';
import api from '../api.js';
import { X, Loader2, Save, Lock } from 'lucide-react';

/**
 * BotEditModal — edit an existing bot's configuration.
 * Read-only: symbol, market, strategy. Editable: leverage, allocation, etc.
 */
export default function BotEditModal({ open, onClose, bot, onUpdated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState({
    leverage: 10,
    allocation: 100,
    maxPositionSize: 50,
    stopLossPct: 2.0,
    takeProfitPct: 4.0,
    timeframe: '15m',
    cooldownMs: 30000,
  });

  // Sync config from bot prop
  useEffect(() => {
    if (bot) {
      setConfig({
        leverage: bot.leverage ?? bot.config?.leverage ?? 10,
        allocation: bot.allocation ?? bot.config?.allocation ?? 100,
        maxPositionSize: bot.maxPositionSize ?? bot.config?.maxPositionSize ?? 50,
        stopLossPct: bot.stopLossPct ?? bot.config?.stopLossPct ?? 2.0,
        takeProfitPct: bot.takeProfitPct ?? bot.config?.takeProfitPct ?? 4.0,
        timeframe: bot.timeframe ?? bot.config?.timeframe ?? '15m',
        cooldownMs: bot.cooldownMs ?? bot.config?.cooldownMs ?? 30000,
      });
      setError(null);
    }
  }, [bot]);

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.updateBot(bot.id, config);
      onUpdated?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!open || !bot) return null;

  const symbol = bot.symbol || bot.config?.symbol || '—';
  const market = bot.market || bot.config?.market || 'usdm';
  const strategy = bot.strategy || bot.config?.strategy || '—';
  const marketLabel = market === 'usdm' ? 'USD-M Futures' : market === 'coinm' ? 'COIN-M' : 'Spot';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface-1 rounded-2xl border border-border-subtle w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            <Save size={16} className="text-accent" /> Edit Bot Configuration
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {error && (
            <div className="px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-xs text-error">{error}</div>
          )}

          {/* Read-only fields */}
          <div className="space-y-2">
            <p className="text-[10px] font-medium text-gray-500 uppercase flex items-center gap-1">
              <Lock size={10} /> Fixed (not editable)
            </p>
            <div className="bg-surface-2 rounded-lg border border-border-subtle p-3 grid grid-cols-3 gap-3">
              <div>
                <span className="text-[10px] text-gray-500 block">Symbol</span>
                <span className="text-sm font-mono text-gray-300">{symbol}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block">Market</span>
                <span className="text-sm text-gray-300">{marketLabel}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block">Strategy</span>
                <span className="text-sm text-gray-300">{strategy}</span>
              </div>
            </div>
          </div>

          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-3">
            <ConfigInput label="Timeframe" value={config.timeframe} onChange={v => setConfig(c => ({...c, timeframe: v}))} type="select"
              options={['1m','5m','15m','30m','1h','4h']} />
            <ConfigInput label="Leverage" value={config.leverage} onChange={v => setConfig(c => ({...c, leverage: Number(v)}))} type="number" min={1} max={125} />
            <ConfigInput label="Allocation (USDT)" value={config.allocation} onChange={v => setConfig(c => ({...c, allocation: Number(v)}))} type="number" min={10} />
            <ConfigInput label="Max Position (USDT)" value={config.maxPositionSize} onChange={v => setConfig(c => ({...c, maxPositionSize: Number(v)}))} type="number" min={5} />
            <ConfigInput label="Stop Loss %" value={config.stopLossPct} onChange={v => setConfig(c => ({...c, stopLossPct: Number(v)}))} type="number" step="0.1" min={0.1} />
            <ConfigInput label="Take Profit %" value={config.takeProfitPct} onChange={v => setConfig(c => ({...c, takeProfitPct: Number(v)}))} type="number" step="0.1" min={0.1} />
            <ConfigInput label="Cooldown (ms)" value={config.cooldownMs} onChange={v => setConfig(c => ({...c, cooldownMs: Number(v)}))} type="number" min={0} step="1000" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-subtle flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-400 hover:text-gray-200 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={loading}
            className="px-5 py-2.5 text-sm font-semibold bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfigInput({ label, value, onChange, type = 'number', options, ...props }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium text-gray-400 uppercase">{label}</label>
      {type === 'select' ? (
        <select value={value} onChange={e => onChange(e.target.value)}
          className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50">
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input type="number" value={value} onChange={e => onChange(e.target.value)} {...props}
          className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50" />
      )}
    </div>
  );
}
