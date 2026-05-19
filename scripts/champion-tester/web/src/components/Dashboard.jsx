import { useEffect, useState } from 'react';
import { BarChart3, Database, Activity, TrendingUp, TrendingDown, Clock, Zap, Play, Layers } from 'lucide-react';
import api from '../api.js';
import { useResults } from '../hooks/useResults.js';
import { useDatasets } from '../hooks/useDatasets.js';
import { useChampions } from '../hooks/useChampions.js';
import { formatNumber, formatPercent, normalizeResultMetrics } from '../utils/metrics.js';

function StatCard({ icon: Icon, label, value, subtitle, trend, color = 'accent' }) {
  const colorMap = {
    accent: 'from-accent/20 to-accent/5 border-accent/20 text-accent',
    success: 'from-success/20 to-success/5 border-success/20 text-success',
    error: 'from-error/20 to-error/5 border-error/20 text-error',
    warning: 'from-warning/20 to-warning/5 border-warning/20 text-warning',
    info: 'from-info/20 to-info/5 border-info/20 text-info',
  };
  const classes = colorMap[color] || colorMap.accent;

  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${classes} border p-4 transition-all hover:scale-[1.02] hover:shadow-lg`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-gray-100 mt-1">{value ?? '—'}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="p-2 rounded-lg bg-surface-3/50">
          <Icon size={18} className="text-gray-400" />
        </div>
      </div>
      {trend !== undefined && (
        <div className={`flex items-center gap-1 mt-2 text-xs ${trend >= 0 ? 'text-success' : 'text-error'}`}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          <span>{trend >= 0 ? '+' : ''}{trend}%</span>
        </div>
      )}
    </div>
  );
}

function RecentResultRow({ result, onClick }) {
  const normalized = normalizeResultMetrics(result);
  const profit = normalized.metrics?.netProfit ?? 0;
  const isPositive = profit >= 0;

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-surface-2 cursor-pointer transition-colors border border-transparent hover:border-border-subtle group"
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${isPositive ? 'bg-success' : 'bg-error'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200 truncate">
          {normalized.dataset?.symbol || '—'}
          <span className="text-gray-500 font-normal ml-2">{normalized.dataset?.timeframe}</span>
        </p>
      </div>
      <div className={`text-sm font-mono font-medium ${isPositive ? 'text-success' : 'text-error'}`}>
        {isPositive ? '+' : ''}{formatNumber(profit)}
      </div>
      <div className="text-xs text-gray-500">
        {formatPercent(normalized.metrics?.winRate)}
      </div>
      <div className="text-xs text-gray-600">
        {normalized.timestamp ? new Date(normalized.timestamp).toLocaleDateString() : '—'}
      </div>
    </div>
  );
}

export default function Dashboard({ onNavigate }) {
  const { results: rawResults, loading: resultsLoading } = useResults();
  const { datasets, loading: datasetsLoading } = useDatasets();
  const { champions, loading: championsLoading } = useChampions();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(setHealth)
      .catch(() => {});
  }, []);

  const loading = resultsLoading || datasetsLoading || championsLoading;
  // rawResults already normalized by useResults hook — use directly
  const results = rawResults;

  // Compute aggregate stats
  const totalResults = results.length;
  const profitableRuns = results.filter(r => (r.metrics?.netProfit ?? 0) > 0).length;
  const winRatio = totalResults > 0 ? ((profitableRuns / totalResults) * 100).toFixed(0) : '—';
  const avgProfit = totalResults > 0
    ? (results.reduce((sum, r) => sum + (r.metrics?.netProfit ?? 0), 0) / totalResults).toFixed(2)
    : '—';
  const bestResult = results.length > 0
    ? results.reduce((best, r) => (r.metrics?.netProfit ?? 0) > (best.metrics?.netProfit ?? 0) ? r : best, results[0])
    : null;
  const worstResult = results.length > 0
    ? results.reduce((worst, r) => (r.metrics?.netProfit ?? 0) < (worst.metrics?.netProfit ?? 0) ? r : worst, results[0])
    : null;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 skeleton h-64 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={BarChart3}
          label="Total Runs"
          value={totalResults}
          subtitle={`${profitableRuns} profitable`}
          color="accent"
        />
        <StatCard
          icon={TrendingUp}
          label="Win Ratio"
          value={winRatio !== '—' ? `${winRatio}%` : '—'}
          subtitle="Profitable runs"
          color={Number(winRatio) >= 50 ? 'success' : 'warning'}
        />
        <StatCard
          icon={Activity}
          label="Avg Profit"
          value={avgProfit}
          color={Number(avgProfit) >= 0 ? 'success' : 'error'}
        />
        <StatCard
          icon={Database}
          label="Datasets"
          value={datasets.length}
          subtitle={`${champions.length} champions`}
          color="info"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Results */}
        <div className="lg:col-span-2 bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
            <div>
              <h3 className="text-sm font-semibold text-gray-200">Recent Results</h3>
              <p className="text-xs text-gray-500 mt-0.5">Latest backtest runs</p>
            </div>
            <button
              onClick={() => onNavigate('results')}
              className="text-xs text-accent hover:text-accent-hover font-medium transition-colors"
            >
              View All →
            </button>
          </div>
          <div className="divide-y divide-border-subtle">
            {results.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <BarChart3 size={32} className="mx-auto text-gray-600 mb-3" />
                <p className="text-sm text-gray-400">No results yet</p>
                <p className="text-xs text-gray-600 mt-1">Run a backtest to see results here</p>
                <button
                  onClick={() => onNavigate('test')}
                  className="mt-4 px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
                >
                  Run First Test
                </button>
              </div>
            ) : (
              results.slice(0, 8).map((result) => (
                <RecentResultRow
                  key={result.runId}
                  result={result}
                  onClick={() => onNavigate('results')}
                />
              ))
            )}
          </div>
        </div>

        {/* Quick Stats Panel */}
        <div className="space-y-4">
          {/* Best/Worst */}
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Performance Highlights</h3>
            {bestResult ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-success/5 border border-success/10">
                  <div>
                    <p className="text-xs text-gray-400">Best Run</p>
                    <p className="text-sm font-medium text-gray-200">{bestResult.dataset?.symbol}</p>
                  </div>
                  <span className="text-sm font-mono font-bold text-success">
                    +{formatNumber(bestResult.metrics?.netProfit ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-error/5 border border-error/10">
                  <div>
                    <p className="text-xs text-gray-400">Worst Run</p>
                    <p className="text-sm font-medium text-gray-200">{worstResult?.dataset?.symbol}</p>
                  </div>
                  <span className="text-sm font-mono font-bold text-error">
                    {formatNumber(worstResult?.metrics?.netProfit ?? 0)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500 text-center py-4">No data available</p>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <button
                onClick={() => onNavigate('test')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border-subtle text-sm text-gray-300 hover:text-gray-100 transition-all"
              >
                <Play size={14} className="text-accent" />
                Run Single Test
              </button>
              <button
                onClick={() => onNavigate('sweep')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border-subtle text-sm text-gray-300 hover:text-gray-100 transition-all"
              >
                <Layers size={14} className="text-warning" />
                Run Sweep
              </button>
              <button
                onClick={() => onNavigate('datasets')}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-2 hover:bg-surface-3 border border-border-subtle text-sm text-gray-300 hover:text-gray-100 transition-all"
              >
                <Database size={14} className="text-info" />
                Manage Datasets
              </button>
            </div>
          </div>

          {/* System Info */}
          {health && (
            <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
              <h3 className="text-sm font-semibold text-gray-200 mb-3">System</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Uptime</span>
                  <span className="text-gray-300 font-mono">{Math.floor(health.uptime / 60)}m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Version</span>
                  <span className="text-gray-300 font-mono">{health.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="text-success">Healthy</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
