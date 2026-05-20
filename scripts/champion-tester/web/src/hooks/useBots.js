import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api.js';

export function useBots(filter) {
  return useQuery({
    queryKey: ['bots', filter],
    queryFn: () => api.getBots(filter),
  });
}

export function useBotManagerStatus() {
  return useQuery({
    queryKey: ['bots', 'manager-status'],
    queryFn: () => api.getBotManagerStatus(),
  });
}

export function useBotGlobalStats() {
  return useQuery({
    queryKey: ['bots', 'global-stats'],
    queryFn: () => api.getBotGlobalStats(),
  });
}

export function useCreateBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config) => api.createBot(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useStartBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.startBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useStopBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.stopBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function usePauseBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.pauseBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useResumeBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.resumeBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useDeleteBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteBot(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useStartAllBots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.startAllBots(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useStopAllBots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.stopAllBots(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function usePauseAllBots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.pauseAllBots(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useResumeAllBots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.resumeAllBots(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  });
}

export function useStrategies() {
  return useQuery({
    queryKey: ['strategies'],
    queryFn: () => api.getStrategies(),
  });
}
