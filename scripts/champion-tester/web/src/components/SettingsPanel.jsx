import { useState, useEffect } from 'react';
import { useTrading } from '../hooks/useTrading.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import api from '../api.js';
import {
  Shield, Power, PowerOff, Loader2, Eye, EyeOff,
  CheckCircle2, AlertCircle, Zap, Wifi, WifiOff,
  Bot, Layers,
} from 'lucide-react';

/**
 * SettingsPanel — standalone settings page.
 * Manages: Binance credentials, connections, risk limits, futures config.
 */
export default function SettingsPanel() {
  const { status, loading, refresh } = useTrading();
  const { subscribe } = useWebSocket();
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const unsubs = [
      subscribe('trading:connected', () => refresh()),
      subscribe('trading:disconnected', () => refresh()),
      subscribe('trading:futures:connected', () => refresh()),
      subscribe('trading:futures:disconnected', () => refresh()),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe, refresh]);

  const showToast = (msg, type = 'success') => setToast({ msg, type });

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 ${
          toast.type === 'error' ? 'bg-error/90 text-white border border-error/50' : 'bg-success/90 text-white border border-success/50'
        }`} role="alert">
          {toast.type === 'error' && <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}

      {/* Connection Status */}
      <ConnectionSection status={status} showToast={showToast} refresh={refresh} />

      {/* Credentials */}
      <CredentialsSection status={status} showToast={showToast} refresh={refresh} />

      {/* Risk Limits */}
      <RiskLimitsSection status={status} showToast={showToast} refresh={refresh} />

      {/* Bot Manager Settings */}
      <BotManagerSettingsSection showToast={showToast} />

      {/* Position Sizing */}
      <PositionSizingSection showToast={showToast} />
    </div>
  );
}

// ─── Connection Section ───────────────────────────────────────────

function ConnectionSection({ status, showToast, refresh }) {
  const [actionLoading, setActionLoading] = useState(false);
  const spotConnected = status?.spot?.connected;
  const configured = status?.config?.configured;
  const futuresEnabled = status?.config?.futures?.enabled;
  const futuresMarkets = status?.futures?.markets || {};

  const handleConnect = async () => {
    setActionLoading(true);
    try { await api.connectTrading(); showToast('Spot connected'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
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
    try { await api.connectFutures(market); showToast(`${market.toUpperCase()} connected`); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setActionLoading(false); }
  };

  const handleFuturesDisconnect = async (market) => {
    setActionLoading(true);
    try { await api.disconnectFutures(market); showToast(`${market.toUpperCase()} disconnected`); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setActionLoading(false); }
  };

  if (!configured) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-2">
          <Wifi size={14} className="text-gray-500" /> Connections
        </h3>
        <p className="text-xs text-gray-500">Configure API credentials below to connect.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-4">
        <Wifi size={14} className="text-accent" /> Connections
      </h3>
      <div className="space-y-3">
        {/* Spot */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">SPOT</span>
            <span className={`text-xs ${spotConnected ? 'text-success' : 'text-gray-500'}`}>
              {spotConnected ? '● Connected' : '○ Disconnected'}
            </span>
          </div>
          {!spotConnected ? (
            <button onClick={handleConnect} disabled={actionLoading}
              className="px-3 py-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md flex items-center gap-1">
              {actionLoading ? <Loader2 size={10} className="animate-spin" /> : <Power size={10} />} Connect
            </button>
          ) : (
            <button onClick={handleDisconnect} disabled={actionLoading}
              className="px-3 py-1.5 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md flex items-center gap-1">
              <PowerOff size={10} /> Disconnect
            </button>
          )}
        </div>

        {/* Futures */}
        {futuresEnabled && ['usdm', 'coinm'].filter(m => (status?.config?.futures?.markets || ['usdm']).includes(m)).map(m => {
          const connected = futuresMarkets[m]?.initialized;
          return (
            <div key={m} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-bold rounded border bg-amber-500/10 text-amber-400 border-amber-500/20">
                  {m === 'usdm' ? 'USD-M' : 'COIN-M'}
                </span>
                <span className={`text-xs ${connected ? 'text-success' : 'text-gray-500'}`}>
                  {connected ? '● Connected' : '○ Disconnected'}
                </span>
              </div>
              {!connected ? (
                <button onClick={() => handleFuturesConnect(m)} disabled={actionLoading}
                  className="px-3 py-1.5 text-[10px] font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md flex items-center gap-1">
                  {actionLoading ? <Loader2 size={10} className="animate-spin" /> : <Zap size={10} />} Connect
                </button>
              ) : (
                <button onClick={() => handleFuturesDisconnect(m)} disabled={actionLoading}
                  className="px-3 py-1.5 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md flex items-center gap-1">
                  <PowerOff size={10} /> Disconnect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Credentials Section ──────────────────────────────────────────

function CredentialsSection({ status, showToast, refresh }) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [testnet, setTestnet] = useState(true);
  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [futuresEnabled, setFuturesEnabled] = useState(false);
  const [futuresMarkets, setFuturesMarkets] = useState(['usdm']);
  const [showSecrets, setShowSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const configured = status?.config?.configured;

  useEffect(() => {
    if (status?.config) {
      setTestnet(status.config.testnet ?? true);
      setTradingEnabled(status.config.tradingEnabled ?? false);
      setFuturesEnabled(status.config.futures?.enabled ?? false);
      setFuturesMarkets(status.config.futures?.markets || ['usdm']);
    }
  }, [status]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!apiKey.trim() || !apiSecret.trim()) { showToast('API Key and Secret required', 'error'); return; }
    setSaving(true);
    try {
      await api.saveTradingConfig({ apiKey, apiSecret, testnet, tradingEnabled, futures: { enabled: futuresEnabled, markets: futuresMarkets } });
      showToast('Credentials saved'); setApiKey(''); setApiSecret(''); await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      await api.updateTradingConfig({ testnet, tradingEnabled, futures: { enabled: futuresEnabled, markets: futuresMarkets } });
      showToast('Settings updated'); await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirm('Delete all Binance credentials? This cannot be undone.')) return;
    try { await api.deleteTradingConfig(); showToast('Credentials deleted'); await refresh(); }
    catch (err) { showToast(err.message, 'error'); }
  };

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Shield size={14} className="text-accent" /> API Credentials
        {configured && <span className="ml-2 px-2 py-0.5 text-[10px] rounded-full bg-success/10 text-success border border-success/20">Configured</span>}
      </h3>

      {configured && (
        <div className="mb-4 flex items-center gap-3">
          <p className="text-xs text-gray-400">Credentials stored encrypted.</p>
          <button onClick={handleDelete} className="px-3 py-1 text-[10px] font-medium bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded-md">Delete</button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-3 mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase">API Key</label>
            <input type={showSecrets ? 'text' : 'password'} value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder={configured ? '•••• (enter new to replace)' : 'Enter API Key'}
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase">API Secret</label>
            <input type={showSecrets ? 'text' : 'password'} value={apiSecret} onChange={e => setApiSecret(e.target.value)}
              placeholder={configured ? '•••• (enter new to replace)' : 'Enter API Secret'}
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-accent/50" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setShowSecrets(!showSecrets)} className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1">
            {showSecrets ? <EyeOff size={12} /> : <Eye size={12} />} {showSecrets ? 'Hide' : 'Show'}
          </button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Save Credentials
          </button>
        </div>
      </form>

      {/* Toggle settings */}
      <div className="border-t border-border-subtle pt-4 space-y-3">
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={testnet} onChange={e => setTestnet(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-surface-2 text-accent focus:ring-accent/50" />
            <span className="text-xs text-gray-300">Testnet Mode</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={tradingEnabled} onChange={e => setTradingEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-surface-2 text-accent focus:ring-accent/50" />
            <span className="text-xs text-gray-300">Trading Enabled</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={futuresEnabled} onChange={e => setFuturesEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-surface-2 text-accent focus:ring-accent/50" />
            <span className="text-xs text-gray-300">Futures Enabled</span>
          </label>
        </div>
        {futuresEnabled && (
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-500">Markets:</span>
            {['usdm', 'coinm'].map(m => (
              <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={futuresMarkets.includes(m)}
                  onChange={() => setFuturesMarkets(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-surface-2 text-accent" />
                <span className="text-xs text-gray-300">{m === 'usdm' ? 'USD-M' : 'COIN-M'}</span>
              </label>
            ))}
          </div>
        )}
        {configured && (
          <button onClick={handleUpdate} disabled={saving}
            className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Update Settings
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Risk Limits Section ──────────────────────────────────────────

function RiskLimitsSection({ status, showToast, refresh }) {
  const [riskLimits, setRiskLimits] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status?.config?.riskLimits) {
      setRiskLimits(status.config.riskLimits);
    }
  }, [status]);

  const update = (key, value) => setRiskLimits(prev => ({ ...(prev || {}), [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateTradingConfig({ riskLimits });
      showToast('Risk limits updated'); await refresh();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  if (!riskLimits) return null;

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <AlertCircle size={14} className="text-error" /> Risk Limits
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <RiskInput label="Max Position Size (USDT)" value={riskLimits.maxPositionSizeUSDT} onChange={v => update('maxPositionSizeUSDT', Number(v))} />
        <RiskInput label="Max Daily Loss (USDT)" value={riskLimits.maxDailyLossUSDT} onChange={v => update('maxDailyLossUSDT', Number(v))} />
        <RiskInput label="Max Daily Trades" value={riskLimits.maxDailyTrades} onChange={v => update('maxDailyTrades', Number(v))} />
        <RiskInput label="Max Open Positions" value={riskLimits.maxOpenPositions} onChange={v => update('maxOpenPositions', Number(v))} />
        <RiskInput label="Max Slippage %" value={riskLimits.maxSlippagePct} onChange={v => update('maxSlippagePct', Number(v))} step="0.1" />
        <RiskInput label="Loss Cooldown (sec)" value={Math.round((riskLimits.cooldownAfterLossMs || 0) / 1000)} onChange={v => update('cooldownAfterLossMs', Number(v) * 1000)} />
      </div>
      <button onClick={handleSave} disabled={saving}
        className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Save Risk Limits
      </button>
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

// ─── Bot Manager Settings Section ─────────────────────────────────

function BotManagerSettingsSection({ showToast }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.getBotSettings()
      .then(data => setSettings(data.settings || data))
      .catch(err => setLoadError(err.message));
  }, []);

  const update = (key, value) => setSettings(prev => ({ ...(prev || {}), [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateBotSettings(settings);
      showToast('Bot manager settings updated');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  if (loadError) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
          <Bot size={14} className="text-accent" /> Bot Manager Settings
        </h3>
        <p className="text-xs text-gray-500">Could not load settings: {loadError}</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
          <Bot size={14} className="text-accent" /> Bot Manager Settings
        </h3>
        <Loader2 size={16} className="animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Bot size={14} className="text-accent" /> Bot Manager Settings
      </h3>
      <div className="space-y-4">
        {/* Toggles */}
        <div className="flex items-center gap-6 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={settings.paperTrade ?? false} onChange={e => update('paperTrade', e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-surface-2 text-accent focus:ring-accent/50" />
            <span className="text-xs text-gray-300">Paper Trade</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={settings.correlationFilter ?? false} onChange={e => update('correlationFilter', e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-surface-2 text-accent focus:ring-accent/50" />
            <span className="text-xs text-gray-300">Correlation Filter</span>
          </label>
        </div>

        {/* Selects and inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-gray-400 uppercase">Position Sizing Mode</label>
            <select value={settings.positionSizingMode ?? 'fixed'} onChange={e => update('positionSizingMode', e.target.value)}
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50">
              <option value="fixed">Fixed</option>
              <option value="drawdown">Drawdown</option>
              <option value="kelly">Kelly</option>
              <option value="anti-martingale">Anti-Martingale</option>
            </select>
          </div>
          <RiskInput label="Correlation Threshold" value={settings.correlationThreshold ?? 0.7} onChange={v => update('correlationThreshold', Number(v))} step="0.05" />
          <RiskInput label="Max Concurrent Bots" value={settings.maxConcurrentBots ?? 10} onChange={v => update('maxConcurrentBots', Number(v))} step="1" />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="mt-4 px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Save Bot Settings
      </button>
    </div>
  );
}

// ─── Position Sizing Section ──────────────────────────────────────

const DRAWDOWN_TIERS = [
  { tier: 1, drawdown: '0-5%', sizeFactor: '1.0x', label: 'Normal' },
  { tier: 2, drawdown: '5-10%', sizeFactor: '0.75x', label: 'Reduced' },
  { tier: 3, drawdown: '10-15%', sizeFactor: '0.5x', label: 'Conservative' },
  { tier: 4, drawdown: '15-20%', sizeFactor: '0.25x', label: 'Minimal' },
  { tier: 5, drawdown: '>20%', sizeFactor: '0x', label: 'Halted' },
];

function PositionSizingSection({ showToast }) {
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.getPositionSizingConfig()
      .then(data => setConfig(data.config || data))
      .catch(err => setLoadError(err.message));
  }, []);

  const update = (key, value) => setConfig(prev => ({ ...(prev || {}), [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updatePositionSizingConfig(config);
      showToast('Position sizing config updated');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  if (loadError) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
          <Layers size={14} className="text-accent" /> Position Sizing
        </h3>
        <p className="text-xs text-gray-500">Could not load config: {loadError}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2">
          <Layers size={14} className="text-accent" /> Position Sizing
        </h3>
        <Loader2 size={16} className="animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
        <Layers size={14} className="text-accent" /> Position Sizing
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase">Mode</label>
          <select value={config.mode ?? 'fixed'} onChange={e => update('mode', e.target.value)}
            className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50">
            <option value="fixed">Fixed</option>
            <option value="drawdown">Drawdown-Based</option>
            <option value="kelly">Kelly Criterion</option>
            <option value="anti-martingale">Anti-Martingale</option>
          </select>
        </div>
        <RiskInput label="Min Size Factor" value={config.minSizeFactor ?? 0.1} onChange={v => update('minSizeFactor', Number(v))} step="0.05" />
        <RiskInput label="Max Size Factor" value={config.maxSizeFactor ?? 2.0} onChange={v => update('maxSizeFactor', Number(v))} step="0.1" />
      </div>

      {/* Drawdown Tiers Table */}
      <div className="mb-4">
        <p className="text-[10px] font-medium text-gray-400 uppercase mb-2">Drawdown Tiers (reference)</p>
        <div className="bg-surface-2 rounded-lg border border-border-subtle overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-3 py-2 text-left text-gray-500 font-medium">Tier</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">Drawdown</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">Size Factor</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">Label</th>
              </tr>
            </thead>
            <tbody>
              {DRAWDOWN_TIERS.map(t => (
                <tr key={t.tier} className="border-b border-border-subtle last:border-0">
                  <td className="px-3 py-1.5 text-gray-300">{t.tier}</td>
                  <td className="px-3 py-1.5 text-gray-300 font-mono">{t.drawdown}</td>
                  <td className="px-3 py-1.5 text-gray-300 font-mono">{t.sizeFactor}</td>
                  <td className="px-3 py-1.5 text-gray-400">{t.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button onClick={handleSave} disabled={saving}
        className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-lg flex items-center gap-2">
        {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Save Position Sizing
      </button>
    </div>
  );
}
