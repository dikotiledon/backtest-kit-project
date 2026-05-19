import { createChart, ColorType, BaselineSeries } from 'lightweight-charts';
import { useRef, useEffect } from 'react';
import { LineChart } from 'lucide-react';

export default function EquityChart({ equityCurve = [], height = 300 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !equityCurve.length) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0f1629' },
        textColor: '#6b7280',
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2a45', style: 1 },
        horzLines: { color: '#1e2a45', style: 1 },
      },
      crosshair: {
        mode: 0,
        vertLine: {
          color: '#3b82f6',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e40af',
        },
        horzLine: {
          color: '#3b82f6',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e40af',
        },
      },
      timeScale: {
        borderColor: '#1e2a45',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#1e2a45',
      },
    });

    const baselineSeries = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#10b981',
      topFillColor1: 'rgba(16, 185, 129, 0.2)',
      topFillColor2: 'rgba(16, 185, 129, 0.02)',
      bottomLineColor: '#ef4444',
      bottomFillColor1: 'rgba(239, 68, 68, 0.02)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.2)',
      lineWidth: 2,
    });

    const data = equityCurve.map((point) => ({
      time: Math.floor(new Date(point.timestamp).getTime() / 1000),
      value: point.equity,
    }));

    baselineSeries.setData(data);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        chart.applyOptions({ width });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [equityCurve, height]);

  if (!equityCurve.length) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-xl bg-surface-2 border border-border-subtle"
        style={{ height }}
      >
        <LineChart size={24} className="text-gray-700 mb-2" />
        <p className="text-xs text-gray-500">No equity data available</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="rounded-xl overflow-hidden border border-border-subtle"
      style={{ width: '100%' }}
    />
  );
}
