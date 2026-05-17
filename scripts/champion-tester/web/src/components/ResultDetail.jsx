import MetricsCard from './MetricsCard.jsx';
import EquityChart from './EquityChart.jsx';
import TradeList from './TradeList.jsx';

function getMetricColor(key, value) {
  if (key === 'netProfit' || key === 'avgProfit') {
    return value >= 0 ? 'green' : 'red';
  }
  if (key === 'winRate') return value >= 50 ? 'green' : 'yellow';
  if (key === 'maxDrawdown') return 'red';
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
  if (!result) return null;

  const metrics = result.metrics || {};
  const metricEntries = Object.entries(metrics);

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex justify-center overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="max-w-5xl w-full mx-auto mt-8 bg-gray-900 rounded-lg p-6 max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white text-xl font-bold leading-none"
          aria-label="Close"
        >
          ✕
        </button>

        {/* Header */}
        <div className="mb-6">
          <h2 className="text-xl font-bold text-zinc-100">
            {result.dataset?.symbol || '—'}{' '}
            <span className="text-zinc-400 font-normal text-base">
              {result.dataset?.timeframe || ''}
            </span>
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            {result.timestamp
              ? new Date(result.timestamp).toLocaleString()
              : ''}
          </p>
        </div>

        {/* Section 1: Metrics */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase mb-3">
            Metrics
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {metricEntries.map(([key, value]) => (
              <MetricsCard
                key={key}
                label={formatMetricLabel(key)}
                value={formatMetricValue(key, value)}
                color={getMetricColor(key, value)}
              />
            ))}
          </div>
        </section>

        {/* Section 2: Equity Chart */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase mb-3">
            Equity Curve
          </h3>
          <EquityChart equityCurve={result.equityCurve} />
        </section>

        {/* Section 3: Trade List */}
        <section>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase mb-3">
            Trades
          </h3>
          <TradeList trades={result.trades} />
        </section>
      </div>
    </div>
  );
}
