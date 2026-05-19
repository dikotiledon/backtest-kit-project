import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

function normalizeDataset(d) {
  return {
    ...d,
    id: `${d.exchange}:${d.symbol}:${d.timeframe}`,
    candles: d.candleCount ?? d.candles ?? 0,
    lastUpdated: d.updatedAt ?? d.lastUpdated ?? null,
  };
}

export function useDatasets() {
  const [datasets, setDatasets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDatasets();
      setDatasets(data.datasets.map(normalizeDataset));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { datasets, loading, error, refresh };
}
