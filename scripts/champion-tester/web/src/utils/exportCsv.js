import { normalizeResultMetrics } from './metrics.js';

export function exportResultsCsv(results) {
  const headers = ['Symbol', 'Timeframe', 'Net Profit', 'ROI %', 'Win Rate %', 'Trades', 'Profit Factor', 'Max Drawdown %', 'Duration (s)', 'Date'];

  const rows = results.map((raw) => {
    const r = normalizeResultMetrics(raw);
    return [
      r.dataset?.symbol || '',
      r.dataset?.timeframe || '',
      r.metrics?.netProfit ?? '',
      r.metrics?.roi ?? '',
      r.metrics?.winRate ?? '',
      r.metrics?.totalTrades ?? '',
      r.metrics?.profitFactor ?? '',
      r.metrics?.maxDrawdown ?? '',
      r.durationMs ? (r.durationMs / 1000).toFixed(1) : '',
      r.timestamp || '',
    ];
  });

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `champion-tester-results-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
