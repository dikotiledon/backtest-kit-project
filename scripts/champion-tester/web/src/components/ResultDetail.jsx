import { useState, useEffect, useCallback } from 'react';
import { X, TrendingUp, TrendingDown, BarChart3, List, LineChart } from 'lucide-react';
import MetricsCard from './MetricsCard.jsx';
import EquityChart from './EquityChart.jsx';
import TradeList from './TradeList.jsx';
import { formatNumber, formatPercent, normalizeResultMetrics } from '../utils/metrics.js';

function getMetricColor(key, value) {
  if (key === 'netProfit' || key === 'avgProfit' || key === 'roi') {
    return value >= 0 ? 'green' : 'red';
  }
  if (key === 'winRate') return value >= 50 ? 'green' : 'yellow';
  if (key === 'maxDrawdown') return 'red';
  if (key === 'profitFactor') return value > 1 ? 'green' : 'yellow';
  if (key === 'sharpeRatio') return value > 1 ? 'green' : 'blue';
  return 'blue';
}

function formatMetricLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function formatMetricValue(key, value) {
  if (value == null) return '—';
  if (key === 'winRate') return `${value}%`;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  return String(value);
}

export default function ResultDetail({ result, onClose }) {
  const [activeTab, setActiveTab] = useState('metrics');

  if (!result) return null;

  const normalizedResult = normalizeResultMetrics(result);
  const metrics = normalizedResult.metrics || {};
  const metricEntries = Object.entries(metrics);
  const profit = metrics.netProfit ?? 0;
  const isPositive = profit >= 0;

  const tabs = [
    { id: 'metrics', label: 'Metrics', icon: BarChart3 },
    { id: 'equity', label: 'Equity Curve', icon: LineChart },
    { id: 'trades', label: 'Trades', icon: List },
  ];

  // Close on Escape key
  const handleEscape = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center overflow-y-auto p-4 md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Result detail"
    >
      <div
        className="w-full max-w-6xl max-h-[calc(100vh-3rem)] bg-surface-1 rounded-2xl border border-border-subtle shadow-2xl overflow-hidden animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-surface-2 shrink-0">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full ${isPositive ? 'bg-success' : 'bg-error'}`} />
            <div>
              <h2 className="text-lg font-bold text-gray-100 flex items-center gap-2">
                {normalizedResult.dataset?.symbol || '—'}
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-surface-3 text-gray-400 border border-border-subtle">
                  {normalizedResult.dataset?.timeframe || ''}
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {normalizedResult.timestamp ? new Date(normalizedResult.timestamp).toLocaleString() : ''}
                {normalizedResult.durationMs && (
                  <span className="ml-3 text-gray-600">Duration: {(normalizedResult.durationMs / 1000).toFixed(1)}s</span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-3 text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Stats Bar */}
        <div className="px-6 py-3 border-b border-border-subtle bg-surface-1 flex flex-wrap items-center gap-6 shrink-0">
          <div className="flex items-center gap-2">
            {isPositive ? <TrendingUp size={14} className="text-success" /> : <TrendingDown size={14} className="text-error" />}
            <span className={`text-sm font-bold font-mono ${isPositive ? 'text-success' : 'text-error'}`}>
              {isPositive ? '+' : ''}{formatNumber(profit)}
            </span>
            <span className="text-xs text-gray-500">net profit</span>
          </div>
          <div className="text-xs text-gray-400">
            Win Rate: <span className="font-medium text-gray-200">{formatPercent(metrics.winRate)}</span>
          </div>
          <div className="text-xs text-gray-400">
            Trades: <span className="font-medium text-gray-200">{metrics.totalTrades ?? '—'}</span>
          </div>
          <div className="text-xs text-gray-400">
            PF: <span className="font-medium text-gray-200">{formatNumber(metrics.profitFactor)}</span>
          </div>
          <div className="text-xs text-gray-400">
            Max DD: <span className="font-medium text-error">{formatPercent(metrics.maxDrawdown)}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-border-subtle shrink-0">
          <div className="flex gap-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Icon size={13} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {activeTab === 'metrics' && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 animate-fade-in">
              {metricEntries.map(([key, value]) => (
                <MetricsCard
                  key={key}
                  label={formatMetricLabel(key)}
                  value={formatMetricValue(key, value)}
                  color={getMetricColor(key, value)}
                  compact
                />
              ))}
            </div>
          )}

          {activeTab === 'equity' && (
            <div className="animate-fade-in">
              <EquityChart equityCurve={normalizedResult.equityCurve} height={350} />
            </div>
          )}

          {activeTab === 'trades' && (
            <div className="animate-fade-in">
              <TradeList trades={normalizedResult.trades} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
