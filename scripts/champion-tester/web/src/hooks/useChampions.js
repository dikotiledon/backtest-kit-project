import { useState, useEffect } from 'react';
import { api } from '../api.js';

export function useChampions() {
  const [champions, setChampions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getChampions()
      .then((data) => setChampions(data.champions))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { champions, loading };
}
