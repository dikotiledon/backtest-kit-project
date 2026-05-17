import { createChart, ColorType } from 'lightweight-charts';
import { useRef, useEffect } from 'react';

export default function EquityChart({ equityCurve = [], height = 300 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !equityCurve.length) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#374151',
      },
    });

    const baselineSeries = chart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22c55e',
      topFillColor1: 'rgba(34, 197, 94, 0.28)',
      topFillColor2: 'rgba(34, 197, 94, 0.05)',
      bottomLineColor: '#ef4444',
      bottomFillColor1: 'rgba(239, 68, 68, 0.05)',
      bottomFillColor2: 'rgba(239, 68, 68, 0.28)',
    });

    const data = equityCurve.map((point) => ({
      time: point.timestamp,
      value: point.equity,
    }));

    baselineSeries.setData(data);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    // Resize observer
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
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1f2937',
          color: '#9ca3af',
          borderRadius: '0.5rem',
        }}
      >
        No equity data
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
