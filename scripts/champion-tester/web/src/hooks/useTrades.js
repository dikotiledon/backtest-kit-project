import { useQuery } from '@tanstack/react-query';
import api from '../api.js';

export function useTradeHistory(date, limit = 20) {
  return useQuery({
    queryKey: ['trades', 'history', date, limit],
    queryFn: () => api.getTradeHistory(date, limit),
  });
}

export function useAnalyticsTrades(opts = {}) {
  return useQuery({
    queryKey: ['trades', 'analytics', opts],
    queryFn: () => api.getAnalyticsTrades(opts),
  });
}

export function useDailyStats() {
  return useQuery({
    queryKey: ['trades', 'daily-stats'],
    queryFn: () => api.getDailyStats(),
  });
}

export function useTradingPositions(market) {
  return useQuery({
    queryKey: ['trades', 'positions', market],
    queryFn: () => api.getTradingPositions(market),
    refetchInterval: 5000, // positions refresh every 5s
  });
}

export function useAllPositions() {
  return useQuery({
    queryKey: ['trades', 'all-positions'],
    queryFn: async () => {
      const statusData = await api.getTradingStatus();
      let positions = [];
      let futuresPositions = [];

      // Spot data
      if (statusData.spot?.connected) {
        const pos = await api.getTradingPositions().catch(() => ({ positions: [] }));
        positions = pos.positions || [];
      }

      // Futures data
      const futuresMarkets = statusData.futures?.markets || {};
      const initializedMarkets = Object.entries(futuresMarkets)
        .filter(([, v]) => v.initialized)
        .map(([k]) => k);

      if (initializedMarkets.length > 0) {
        const primaryMarket = initializedMarkets[0];
        const fPos = await api.getFuturesPositions(primaryMarket).catch(() => ({ positions: [] }));
        futuresPositions = fPos.positions || [];
      }

      return { status: statusData, positions, futuresPositions };
    },
    refetchInterval: 5000,
  });
}
