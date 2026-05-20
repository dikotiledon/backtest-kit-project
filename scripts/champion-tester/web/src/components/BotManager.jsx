import { useState, useEffect } from 'react';
import {
  useBots, useBotManagerStatus, useBotGlobalStats,
  useStartBot, useStopBot, usePauseBot, useResumeBot, useDeleteBot,
  useStartAllBots, useStopAllBots, usePauseAllBots, useResumeAllBots,
  useStrategies,
} from '../hooks/useBots.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { queryClient } from '../queryClient.js';
import BotMasterControls from './BotMasterControls.jsx';
import BotCard from './BotCard.jsx';
import BotCreateModal from './BotCreateModal.jsx';
import BotEditModal from './BotEditModal.jsx';
import { useConfirm } from './ui/ConfirmDialog.jsx';
import api from '../api.js';
import { Plus, RefreshCw, Filter, Loader2, Star, Zap } from 'lucide-react';

/**
 * BotManager — main page for multi-symbol automated trading.
 * Features the master start/stop button and bot grid.
 */
export default function BotManager() {
  const { data: botsData, isLoading: loading, error: botsError } = useBots();
  const { data: statusData } = useBotManagerStatus();
  const { data: globalStats } = useBotGlobalStats();
  const { data: strategiesData } = useStrategies();

  const bots = botsData?.bots || [];
  const masterState = statusData?.masterState || 'stopped';
  const error = botsError?.message || null;

  const startBotMut = useStartBot();
  const stopBotMut = useStopBot();
  const pauseBotMut = usePauseBot();
  const resumeBotMut = useResumeBot();
  const deleteBotMut = useDeleteBot();
  const startAllMut = useStartAllBots();
  const stopAllMut = useStopAllBots();
  const pauseAllMut = usePauseAllBots();
  const resumeAllMut = useResumeAllBots();

  const { subscribe } = useWebSocket();
  const [showCreate, setShowCreate] = useState(false);
  const [editBot, setEditBot] = useState(null);
  const [filter, setFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(false);
  const [champion, setChampion] = useState(null);
  const [deployingChampion, setDeployingChampion] = useState(false);

  // Load champion info
  useEffect(() => {
    api.getChampions().then(d => {
      if (d.champions?.length > 0) setChampion(d.champions[0]);
    }).catch(() => {});
  }, []);

  // WebSocket events — invalidate queries instead of manual refetch
  useEffect(() => {
    const invalidateBots = () => queryClient.invalidateQueries({ queryKey: ['bots'] });
    const unsubs = [
      subscribe('bot:started', invalidateBots),
      subscribe('bot:stopped', invalidateBots),
      subscribe('bot:paused', invalidateBots),
      subscribe('bot:signal', () => queryClient.invalidateQueries({ queryKey: ['bots', 'global-stats'] })),
      subscribe('bot:error', invalidateBots),
      subscribe('bot:autoPaused', invalidateBots),
      subscribe('manager:started', invalidateBots),
      subscribe('manager:stopped', invalidateBots),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe]);

  // Master control handlers
  const handleStartAll = async () => {
    setActionLoading(true);
    try { await startAllMut.mutateAsync(); } catch {}
    finally { setActionLoading(false); }
  };
  const handleStopAll = async () => {
    setActionLoading(true);
    try { await stopAllMut.mutateAsync(); } catch {}
    finally { setActionLoading(false); }
  };
  const handlePauseAll = async () => {
    setActionLoading(true);
    try { await pauseAllMut.mutateAsync(); } catch {}
    finally { setActionLoading(false); }
  };
  const handleResumeAll = async () => {
    setActionLoading(true);
    try { await resumeAllMut.mutateAsync(); } catch {}
    finally { setActionLoading(false); }
  };

  const { confirm } = useConfirm();

  // Bot action handlers
  const handleStart = async (id) => { try { await startBotMut.mutateAsync(id); } catch {} };
  const handleStop = async (id) => { try { await stopBotMut.mutateAsync(id); } catch {} };
  const handlePause = async (id) => { try { await pauseBotMut.mutateAsync(id); } catch {} };
  const handleResume = async (id) => { try { await resumeBotMut.mutateAsync(id); } catch {} };
  const handleDelete = async (id) => {
    const confirmed = await confirm({ title: 'Delete Bot', message: 'Delete this bot? This cannot be undone.', variant: 'danger' });
    if (!confirmed) return;
    try { await deleteBotMut.mutateAsync(id); } catch {}
  };
  const handleEdit = (id) => {
    const bot = bots.find(b => b.id === id);
    setEditBot(bot);
  };

  // Filter bots
  const filteredBots = filter === 'all' ? bots :
    bots.filter(b => b.state === filter);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bots'] });
  };

  return (
    <div className="space-y-6">
      {/* Master Controls */}
      <BotMasterControls
        masterState={masterState}
        stats={globalStats}
        onStartAll={handleStartAll}
        onStopAll={handleStopAll}
        onPauseAll={handlePauseAll}
        onResumeAll={handleResumeAll}
        loading={actionLoading}
      />

      {/* Champion Deploy Card */}
      {champion && (
        <div className="bg-gradient-to-r from-amber-500/5 to-purple-500/5 rounded-xl border border-amber-500/20 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Star size={18} className="text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  Champion Strategy
                  <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    ROI {champion.roiPct}% | PF {champion.profitFactor || '3.68'} | Score {champion.score}
                  </span>
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">{champion.label || champion.configId}</p>
              </div>
            </div>
            <button onClick={() => { setShowCreate(true); }}
              disabled={deployingChampion}
              className="px-4 py-2 text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50">
              {deployingChampion ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
              Deploy Champion Bot
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors flex items-center gap-2">
            <Plus size={14} /> Add Bot
          </button>

          {/* Filter */}
          <div className="flex items-center gap-1 ml-3">
            <Filter size={12} className="text-gray-500" />
            {['all', 'running', 'paused', 'stopped'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                  filter === f ? 'bg-accent/10 text-accent' : 'text-gray-500 hover:text-gray-300'
                }`}>
                {f === 'all' ? `All (${bots.length})` : `${f} (${bots.filter(b => b.state === f).length})`}
              </button>
            ))}
          </div>
        </div>

        <button onClick={handleRefresh}
          className="p-2 rounded-md hover:bg-surface-2 text-gray-400 hover:text-gray-200 transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-3 rounded-lg bg-error/10 border border-error/20 text-xs text-error">{error}</div>
      )}

      {/* Bot Grid */}
      {loading && bots.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-gray-500" />
        </div>
      ) : filteredBots.length === 0 ? (
        <div className="bg-surface-1 rounded-xl border border-border-subtle px-5 py-16 text-center">
          <div className="text-4xl mb-3">🤖</div>
          <p className="text-sm text-gray-300 font-medium">No bots yet</p>
          <p className="text-xs text-gray-500 mt-1">Create your first trading bot to start automated trading</p>
          <button onClick={() => setShowCreate(true)}
            className="mt-4 px-4 py-2 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors inline-flex items-center gap-2">
            <Plus size={12} /> Create Bot
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredBots.map(bot => (
            <BotCard
              key={bot.id}
              bot={bot}
              onStart={handleStart}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <BotCreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['bots'] })}
      />

      {/* Edit Modal */}
      <BotEditModal
        open={!!editBot}
        onClose={() => setEditBot(null)}
        bot={editBot}
        onUpdated={() => queryClient.invalidateQueries({ queryKey: ['bots'] })}
      />
    </div>
  );
}
