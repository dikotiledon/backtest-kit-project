import { useQuery } from '@tanstack/react-query';
import api from '../api.js';

export function useAnalyticsSummary(botId) {
  return useQuery({
    queryKey: ['analytics', 'summary', botId],
    queryFn: () => api.getAnalyticsSummary(botId),
  });
}

export function useEquityCurve(days = 30) {
  return useQuery({
    queryKey: ['analytics', 'equity', days],
    queryFn: () => api.getEquityCurve(days),
  });
}

export function useRiskStatus() {
  return useQuery({
    queryKey: ['risk', 'status'],
    queryFn: () => api.getRiskStatus(),
    staleTime: 10 * 1000, // refresh more often
  });
}
