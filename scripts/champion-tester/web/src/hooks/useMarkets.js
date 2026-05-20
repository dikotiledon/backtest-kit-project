import { useQuery } from '@tanstack/react-query';
import api from '../api.js';

export function useSearchSymbols(query, market) {
  return useQuery({
    queryKey: ['markets', 'search', query, market],
    queryFn: () => api.searchSymbols(query, market),
    enabled: !!query && query.length >= 2,
    staleTime: 60 * 1000,
  });
}

export function useMarketSymbols(market, filter) {
  return useQuery({
    queryKey: ['markets', 'symbols', market, filter],
    queryFn: () => api.getMarketSymbols(market, filter),
    enabled: !!market,
  });
}

export function useMarketStats() {
  return useQuery({
    queryKey: ['markets', 'stats'],
    queryFn: () => api.getMarketStats(),
  });
}
