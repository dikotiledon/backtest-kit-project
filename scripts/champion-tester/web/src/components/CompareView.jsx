import { useState } from 'react';
import { useResults } from '../hooks/useResults.js';
import { GitCompare, TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import MetricsCard from './MetricsCard.jsx';
import EquityChart from './EquityChart.jsx';

const METRICS = [
  { key: 'roi', label: 'ROI %', format: (v) => `${v?.toFixed(2)}%`, higher: true },
  { key: 'winRate', label: 'Win Rate', format: (v) => `${v?.toFixed(1)}%`, higher: true },
  { key: 'totalTrades', label: 'Trades', format: (v) => v, higher: true },
  { key: 'profitFactor', label: 'Profit Factor', format: (v) => v?.toFixed(2), higher: true },
  { key: 'maxDrawdown', label: 'Max DD', format: (v) => `${v?.toFixed(2)}%`, higher: false },
  { key: 'sharpeRatio', label: 'Sharpe', format: (v) => v?.toFixed(2), higher: true },
  { key: 'netProfit', label: 'Net Profit', format: (v) => v?.toFixed(2), higher: true },
];

function getResultLabel(r) {
  const symbol = r.dataset?.symbol || r.symbol || '?';
  const tf = r.dataset?.timeframe || r.timeframe || '?';
  const date = r.timestamp
    ? new Date(r.timestamp).toLocaleDateString()
    : r.runId?.slice(0, 8);
  return `${symbol} ${tf} (${date})`;
}

function ComparisonRow({ metric, leftVal, rightVal }) {
  const leftNum = typeof leftVal === 'number' ? leftVal : null;
  const rightNum = typeof rightVal === 'number' ? rightVal : null;

  let leftWins = false;
  let rightWins = false;

  if (leftNum !== null && rightNum !== null) {
    if (metric.higher) {
      leftWins = leftNum > rightNum;
      rightWins = rightNum > leftNum;
    } else {
      leftWins = leftNum < rightNum;
      rightWins = rightNum < leftNum;
    }
  }

  return (
    <div className="grid grid-cols-3 items-center py-3 border-b border-border-subtle last:border-0">
      <div className={`text-right pr-4 font-mono text-sm ${leftWins ? 'text-success font-bold' : 'text-gray-300'}`}>
        {leftNum !== null ? metric.format(leftNum) : '—'}
        {leftWins && <TrendingUp size={12} className="inline ml-1.5 text-success" />}
      </div>
      <div className="text-center">
        <span className="text-xs text-gray-500 uppercase tracking-wide font-medium">{metric.label}</span>
      </div>
      <div className={`text-left pl-4 font-mono text-sm ${rightWins ? 'text-success font-bold' : 'text-gray-300'}`}>
        {rightWins && <TrendingUp size={12} className="inline mr-1.5 text-success" />}
        {rightNum !== null ? metric.format(rightNum) : '—'}
      </div>
    </div>
  );
}

export default function CompareView() {
  const { results, loading } = useResults();
  const [leftId, setLeftId] = useState(null);
  const [rightId, setRightId] = useState(null);

  const leftResult = results.find((r) => r.runId === leftId) || null;
  const rightResult = results.find((r) => r.runId === rightId) || null;

  // Get metrics from nested or flat structure
  const getMetric = (result, key) => {
    if (!result) return null;
    return result.metrics?.[key] ?? result[key] ?? null;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-16 rounded-xl" />
        <div className="grid grid-cols-2 gap-6">
          <div className="skeleton h-64 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <GitCompare size={48} className="text-gray-700 mb-4" />
        <p className="text-sm text-gray-400">No results available</p>
        <p className="text-xs text-gray-600 mt-1">Run some tests first to compare results</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Selection Panel */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <GitCompare size={14} className="text-accent" />
          Select Results to Compare
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Result A</label>
            <select
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              value={leftId || ''}
              onChange={(e) => setLeftId(e.target.value || null)}
            >
              <option value="">— Select —</option>
              {results.map((r) => (
                <option key={r.runId} value={r.runId}>{getResultLabel(r)}</option>
              ))}
            </select>
          </div>
          <div className="hidden md:flex items-center justify-center pb-1">
            <div className="w-8 h-8 rounded-full bg-surface-3 border border-border-subtle flex items-center justify-center">
              <ArrowRight size={14} className="text-gray-500" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Result B</label>
            <select
              className="w-full bg-surface-2 border border-border-default rounded-lg px-3 py-2.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
              value={rightId || ''}
              onChange={(e) => setRightId(e.target.value || null)}
            >
              <option value="">— Select —</option>
              {results.map((r) => (
                <option key={r.runId} value={r.runId}>{getResultLabel(r)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {!leftResult && !rightResult && (
        <div className="flex flex-col items-center justify-center py-16 bg-surface-1 rounded-xl border border-border-subtle">
          <GitCompare size={36} className="text-gray-700 mb-3" />
          <p className="text-sm text-gray-400">Select two results to compare</p>
          <p className="text-xs text-gray-600 mt-1">Choose from the dropdowns above</p>
        </div>
      )}

      {/* Comparison content */}
      {(leftResult || rightResult) && (
        <div className="space-y-6 animate-fade-in">
          {/* Metrics cards side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left */}
            <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
              <div className="px-5 py-3 border-b border-border-subtle bg-surface-2">
                <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                  {leftResult ? getResultLabel(leftResult) : 'Result A'}
                </h4>
              </div>
              {leftResult ? (
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricsCard label="Net Profit" value={getMetric(leftResult, 'netProfit')?.toFixed(2)} color={getMetric(leftResult, 'netProfit') >= 0 ? 'green' : 'red'} compact />
                    <MetricsCard label="Win Rate" value={`${getMetric(leftResult, 'winRate')?.toFixed(1)}%`} color="blue" compact />
                    <MetricsCard label="Trades" value={getMetric(leftResult, 'totalTrades')} color="blue" compact />
                    <MetricsCard label="Profit Factor" value={getMetric(leftResult, 'profitFactor')?.toFixed(2)} color="yellow" compact />
                  </div>
                  <EquityChart equityCurve={leftResult.equityCurve || []} height={180} />
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-gray-500">Select a result</div>
              )}
            </div>

            {/* Right */}
            <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
              <div className="px-5 py-3 border-b border-border-subtle bg-surface-2">
                <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                  {rightResult ? getResultLabel(rightResult) : 'Result B'}
                </h4>
              </div>
              {rightResult ? (
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <MetricsCard label="Net Profit" value={getMetric(rightResult, 'netProfit')?.toFixed(2)} color={getMetric(rightResult, 'netProfit') >= 0 ? 'green' : 'red'} compact />
                    <MetricsCard label="Win Rate" value={`${getMetric(rightResult, 'winRate')?.toFixed(1)}%`} color="blue" compact />
                    <MetricsCard label="Trades" value={getMetric(rightResult, 'totalTrades')} color="blue" compact />
                    <MetricsCard label="Profit Factor" value={getMetric(rightResult, 'profitFactor')?.toFixed(2)} color="yellow" compact />
                  </div>
                  <EquityChart equityCurve={rightResult.equityCurve || []} height={180} />
                </div>
              ) : (
                <div className="p-8 text-center text-xs text-gray-500">Select a result</div>
              )}
            </div>
          </div>

          {/* Head-to-Head Comparison */}
          {leftResult && rightResult && (
            <div className="bg-surface-1 rounded-xl border border-border-subtle overflow-hidden">
              <div className="px-5 py-3 border-b border-border-subtle bg-surface-2">
                <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide text-center">
                  Head-to-Head Comparison
                </h4>
              </div>
              <div className="p-5">
                {METRICS.map((m) => (
                  <ComparisonRow
                    key={m.key}
                    metric={m}
                    leftVal={getMetric(leftResult, m.key)}
                    rightVal={getMetric(rightResult, m.key)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
