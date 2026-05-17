import { useState } from 'react';
import { useResults } from '../hooks/useResults.js';
import MetricsCard from './MetricsCard.jsx';
import EquityChart from './EquityChart.jsx';

const METRICS = [
  { key: 'roi', label: 'ROI %', format: (v) => `${v?.toFixed(2)}%`, higher: true },
  { key: 'winRate', label: 'Win Rate', format: (v) => `${v?.toFixed(1)}%`, higher: true },
  { key: 'totalTrades', label: 'Trades', format: (v) => v, higher: true },
  { key: 'profitFactor', label: 'Profit Factor', format: (v) => v?.toFixed(2), higher: true },
  { key: 'maxDrawdown', label: 'Max DD', format: (v) => `${v?.toFixed(2)}%`, higher: false },
  { key: 'sharpeRatio', label: 'Sharpe', format: (v) => v?.toFixed(2), higher: true },
];

function getResultLabel(r) {
  const date = r.createdAt
    ? new Date(r.createdAt).toLocaleDateString()
    : r.runId?.slice(0, 8);
  return `${r.symbol || '?'} ${r.timeframe || '?'} (${date})`;
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
      // Lower is better (e.g. max drawdown)
      leftWins = leftNum < rightNum;
      rightWins = rightNum < leftNum;
    }
  }

  return (
    <div className="grid grid-cols-3 items-center py-2 border-b border-gray-700 last:border-0">
      <div className={`text-right pr-4 ${leftWins ? 'text-green-400 font-bold' : 'text-gray-300'}`}>
        {leftNum !== null ? metric.format(leftNum) : '—'}
        {leftWins && ' ◀'}
      </div>
      <div className="text-center text-xs text-gray-500 uppercase">{metric.label}</div>
      <div className={`text-left pl-4 ${rightWins ? 'text-green-400 font-bold' : 'text-gray-300'}`}>
        {rightWins && '▶ '}
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

  if (loading) {
    return <p className="text-gray-400">Loading results…</p>;
  }

  if (!results.length) {
    return <p className="text-gray-400">No results available. Run some tests first.</p>;
  }

  return (
    <div className="space-y-6">
      {/* Dropdowns */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Left Result</label>
          <select
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-200"
            value={leftId || ''}
            onChange={(e) => setLeftId(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {results.map((r) => (
              <option key={r.runId} value={r.runId}>
                {getResultLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Right Result</label>
          <select
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-gray-200"
            value={rightId || ''}
            onChange={(e) => setRightId(e.target.value || null)}
          >
            <option value="">— Select —</option>
            {results.map((r) => (
              <option key={r.runId} value={r.runId}>
                {getResultLabel(r)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Empty state */}
      {!leftResult && !rightResult && (
        <p className="text-center text-gray-500 py-12">Select two results to compare</p>
      )}

      {/* Comparison content */}
      {(leftResult || rightResult) && (
        <>
          {/* Metrics cards side by side */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              {leftResult ? (
                <>
                  <h3 className="text-sm font-medium text-gray-300">{getResultLabel(leftResult)}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <MetricsCard label="ROI" value={`${leftResult.roi?.toFixed(2)}%`} color={leftResult.roi >= 0 ? 'green' : 'red'} />
                    <MetricsCard label="Win Rate" value={`${leftResult.winRate?.toFixed(1)}%`} color="blue" />
                    <MetricsCard label="Trades" value={leftResult.totalTrades} color="blue" />
                    <MetricsCard label="Profit Factor" value={leftResult.profitFactor?.toFixed(2)} color="yellow" />
                  </div>
                  <EquityChart equityCurve={leftResult.equityCurve || []} height={200} />
                </>
              ) : (
                <p className="text-gray-500 text-center py-8">Select left result</p>
              )}
            </div>
            <div className="space-y-3">
              {rightResult ? (
                <>
                  <h3 className="text-sm font-medium text-gray-300">{getResultLabel(rightResult)}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <MetricsCard label="ROI" value={`${rightResult.roi?.toFixed(2)}%`} color={rightResult.roi >= 0 ? 'green' : 'red'} />
                    <MetricsCard label="Win Rate" value={`${rightResult.winRate?.toFixed(1)}%`} color="blue" />
                    <MetricsCard label="Trades" value={rightResult.totalTrades} color="blue" />
                    <MetricsCard label="Profit Factor" value={rightResult.profitFactor?.toFixed(2)} color="yellow" />
                  </div>
                  <EquityChart equityCurve={rightResult.equityCurve || []} height={200} />
                </>
              ) : (
                <p className="text-gray-500 text-center py-8">Select right result</p>
              )}
            </div>
          </div>

          {/* Comparison row */}
          {leftResult && rightResult && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-400 mb-3 text-center uppercase">Head-to-Head</h3>
              {METRICS.map((m) => (
                <ComparisonRow
                  key={m.key}
                  metric={m}
                  leftVal={leftResult[m.key]}
                  rightVal={rightResult[m.key]}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
