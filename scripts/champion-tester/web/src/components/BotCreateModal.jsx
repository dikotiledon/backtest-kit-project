import { useState, useEffect } from 'react';
import api from '../api.js';
import { Search, X, Loader2, Plus } from 'lucide-react';

/**
 * BotCreateModal — wizard for creating a new trading bot.
 * Steps: 1) Search symbol  2) Select strategy  3) Configure  4) Confirm
 */
export default function BotCreateModal({ open, onClose, onCreated, prefillSymbol, prefillMarket }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Step 1: Symbol
  const [query, setQuery] = useState('');
  const [market, setMarket] = useState(prefillMarket || 'usdm');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState(null);

  // Step 2: Strategy
  const [strategies, setStrategies] = useState([]);
  const [selectedStrategy, setSelectedStrategy] = useState(null);

  // Step 3: Config
  const [config, setConfig] = useState({
    leverage: 10,
    allocation: 100,
    maxPositionSize: 50,
    stopLossPct: 2.0,
    takeProfitPct: 4.0,
    timeframe: '15m',
    cooldownMs: 30000,
  });

  // Load strategies on open
  useEffect(() => {
    if (open) {
      api.getStrategies().then(d => setStrategies(d.strategies || [])).catch(() => {
        // Fallback: hardcoded strategy list if API not ready
        setStrategies([
          { id: 'champion-bridge', name: '⭐ Champion (Autoresearch)', description: 'Live execution of the autoresearch champion — kNN ML model + Signal Fusion V4 + ATR trailing stop. Exact backtest parity via Pine Script runner.', defaultTimeframe: '15m', riskLevel: 'medium' },
          { id: 'momentum', name: 'Momentum', description: 'RSI + MACD crossover momentum strategy', defaultTimeframe: '15m', riskLevel: 'medium' },
          { id: 'breakout', name: 'Breakout', description: 'Bollinger Band squeeze breakout with volume confirmation', defaultTimeframe: '15m', riskLevel: 'medium-high' },
          { id: 'trend-follow', name: 'Trend Follow', description: 'EMA crossover trend following with ADX strength filter', defaultTimeframe: '15m', riskLevel: 'medium' },
          { id: 'scalp', name: 'Scalp', description: 'VWAP deviation scalping with volume imbalance', defaultTimeframe: '5m', riskLevel: 'high' },
        ]);
      });
    }
  }, [open]);

  // If prefillSymbol provided, skip step 1
  useEffect(() => {
    if (open && prefillSymbol) {
      setSelectedSymbol(prefillSymbol);
      setMarket(prefillMarket || prefillSymbol.market || 'usdm');
      setStep(2);
    }
  }, [open, prefillSymbol, prefillMarket]);

  // Symbol search
  useEffect(() => {
    if (query.length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchSymbols(query, market);
        setSearchResults(data.results || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, market]);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const botConfig = {
        symbol: selectedSymbol.symbol,
        market: selectedSymbol.market || market,
        strategy: selectedStrategy.id,
        strategyParams: {},
        ...config,
      };
      const result = await api.createBot(botConfig);
      onCreated?.(result.bot);
      handleClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setQuery('');
    setSelectedSymbol(null);
    setSelectedStrategy(null);
    setError(null);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleClose}>
      <div className="bg-surface-1 rounded-2xl border border-border-subtle w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
          <h2 className="text-base font-semibold text-gray-100 flex items-center gap-2">
            <Plus size={16} className="text-accent" /> Create Trading Bot
          </h2>
          <button onClick={handleClose} className="p-1.5 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200">
            <X size={16} />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="px-6 py-3 flex items-center gap-2 border-b border-border-subtle">
          {['Symbol', 'Strategy', 'Configure', 'Confirm'].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                step > i + 1 ? 'bg-success text-white' : step === i + 1 ? 'bg-accent text-white' : 'bg-surface-2 text-gray-500'
              }`}>{i + 1}</span>
              <span className={`text-xs ${step === i + 1 ? 'text-gray-200' : 'text-gray-500'}`}>{s}</span>
              {i < 3 && <span className="text-gray-700 mx-1">→</span>}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-5 min-h-[280px]">
          {error && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-error/10 border border-error/20 text-xs text-error">{error}</div>
          )}

          {/* Step 1: Symbol Search */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex gap-2 mb-3">
                {['usdm', 'spot', 'coinm'].map(m => (
                  <button key={m} onClick={() => setMarket(m)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                      market === m ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surface-2 text-gray-400 border-border-subtle'
                    }`}>
                    {m === 'usdm' ? 'USD-M Futures' : m === 'coinm' ? 'COIN-M' : 'Spot'}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search symbol (e.g. BTC, ETH, SOL...)"
                  className="w-full bg-surface-2 border border-border-default rounded-lg pl-9 pr-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50"
                  autoFocus />
                {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 animate-spin" />}
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {searchResults.map(s => (
                  <button key={s.symbol} onClick={() => { setSelectedSymbol(s); setStep(2); }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                      selectedSymbol?.symbol === s.symbol ? 'bg-accent/10 border border-accent/20' : 'hover:bg-surface-2 border border-transparent'
                    }`}>
                    <div>
                      <span className="text-sm font-mono font-medium text-gray-100">{s.symbol}</span>
                      <span className="ml-2 text-[10px] text-gray-500">{s.baseAsset}/{s.quoteAsset}</span>
                    </div>
                  </button>
                ))}
                {query.length >= 2 && searchResults.length === 0 && !searching && (
                  <p className="text-xs text-gray-500 text-center py-4">No symbols found. Connect to Binance first.</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Strategy */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400 mb-2">Select a trading strategy for <span className="font-mono text-accent">{selectedSymbol?.symbol}</span></p>
              {strategies.map(s => (
                <button key={s.id} onClick={() => { setSelectedStrategy(s); setStep(3); }}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selectedStrategy?.id === s.id ? 'bg-accent/10 border-accent/20' : 'bg-surface-2 border-border-subtle hover:border-gray-600'
                  }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-100">{s.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      s.riskLevel === 'high' ? 'bg-error/10 text-error' :
                      s.riskLevel === 'medium-high' ? 'bg-warning/10 text-warning' :
                      'bg-success/10 text-success'
                    }`}>{s.riskLevel}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">{s.description}</p>
                  <p className="text-[10px] text-gray-600 mt-1">Default timeframe: {s.defaultTimeframe}</p>
                </button>
              ))}
            </div>
          )}

          {/* Step 3: Configure */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">Configure <span className="font-mono text-accent">{selectedSymbol?.symbol}</span> / {selectedStrategy?.name}</p>
              {selectedStrategy?.id === 'champion-bridge' ? (
                /* Champion strategy: minimal config — SL/TP handled by Pine Script */
                <div className="space-y-3">
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                    <p className="text-[11px] text-amber-400 font-medium">⚡ Champion Strategy</p>
                    <p className="text-[10px] text-gray-400 mt-1">SL/TP/Trailing are managed by the Pine Script signal engine (ATR-based). You only need to set position sizing.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ConfigInput label="Timeframe" value="15m" onChange={() => {}} type="select" options={['15m']} />
                    <ConfigInput label="Leverage" value={config.leverage} onChange={v => setConfig(c => ({...c, leverage: Number(v)}))} type="number" min={1} max={125} />
                    <ConfigInput label="Allocation (USDT)" value={config.allocation} onChange={v => setConfig(c => ({...c, allocation: Number(v)}))} type="number" min={10} />
                    <ConfigInput label="Max Position (USDT)" value={config.maxPositionSize} onChange={v => setConfig(c => ({...c, maxPositionSize: Number(v)}))} type="number" min={5} />
                  </div>
                </div>
              ) : (
                /* Other strategies: full config */
                <div className="grid grid-cols-2 gap-3">
                  <ConfigInput label="Timeframe" value={config.timeframe} onChange={v => setConfig(c => ({...c, timeframe: v}))} type="select"
                    options={['1m','5m','15m','30m','1h','4h']} />
                  <ConfigInput label="Leverage" value={config.leverage} onChange={v => setConfig(c => ({...c, leverage: Number(v)}))} type="number" min={1} max={125} />
                  <ConfigInput label="Allocation (USDT)" value={config.allocation} onChange={v => setConfig(c => ({...c, allocation: Number(v)}))} type="number" min={10} />
                  <ConfigInput label="Max Position (USDT)" value={config.maxPositionSize} onChange={v => setConfig(c => ({...c, maxPositionSize: Number(v)}))} type="number" min={5} />
                  <ConfigInput label="Stop Loss %" value={config.stopLossPct} onChange={v => setConfig(c => ({...c, stopLossPct: Number(v)}))} type="number" step="0.1" min={0.1} />
                  <ConfigInput label="Take Profit %" value={config.takeProfitPct} onChange={v => setConfig(c => ({...c, takeProfitPct: Number(v)}))} type="number" step="0.1" min={0.1} />
                </div>
              )}
              <button onClick={() => setStep(4)} className="w-full px-4 py-2.5 text-sm font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors">
                Review →
              </button>
            </div>
          )}

          {/* Step 4: Confirm */}
          {step === 4 && (
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-200">Review Bot Configuration</h4>
              <div className="bg-surface-2 rounded-lg border border-border-subtle p-4 space-y-2 text-xs">
                <Row label="Symbol" value={selectedSymbol?.symbol} />
                <Row label="Market" value={market === 'usdm' ? 'USD-M Futures' : market === 'coinm' ? 'COIN-M' : 'Spot'} />
                <Row label="Strategy" value={selectedStrategy?.name} />
                <Row label="Timeframe" value={config.timeframe} />
                <Row label="Leverage" value={`${config.leverage}x`} />
                <Row label="Allocation" value={`$${config.allocation}`} />
                <Row label="Max Position" value={`$${config.maxPositionSize}`} />
                <Row label="Stop Loss" value={`${config.stopLossPct}%`} />
                <Row label="Take Profit" value={`${config.takeProfitPct}%`} />
              </div>
              <button onClick={handleCreate} disabled={loading}
                className="w-full px-4 py-2.5 text-sm font-semibold bg-success hover:bg-green-600 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center justify-center gap-2">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create Bot
              </button>
            </div>
          )}
        </div>

        {/* Footer nav */}
        {step > 1 && (
          <div className="px-6 py-3 border-t border-border-subtle">
            <button onClick={() => setStep(s => s - 1)} className="text-xs text-gray-400 hover:text-gray-200">← Back</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-mono text-gray-200">{value}</span>
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
