import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';

export function useResults() {
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (params = {}) => {
    setLoading(true);
    try {
      const data = await api.getResults(params);
      setResults(data.results);
      setTotal(data.total);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { results, total, loading, refresh };
}
