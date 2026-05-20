import { useBots, useBotManagerStatus } from '../hooks/useBots.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useAnalyticsSummary, useEquityCurve, useRiskStatus } from '../hooks/useAnalytics.js';
import { useEffect, useState } from 'react';
import { queryClient } from '../queryClient.js';
import { Link } from '@tanstack/react-router';
import {
  TrendingUp, TrendingDown, Activity, Bot, DollarSign,
  BarChart3, Shield, AlertTriangle, Loader2,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

/**
 * DashboardPro — main dashboard with PnL overview, equity curve, bot summary.
 */

export default function DashboardPro() {
  const { data: botsData } = useBots();
  const { data: statusData } = useBotManagerStatus();

  const bots = botsData?.bots || [];
  const masterState = statusData?.masterState || 'stopped';

  const { data: analyticsData } = useAnalyticsSummary();
  const { data: equityData } = useEquityCurve(30);
  const { data: riskData } = useRiskStatus();

  const analytics = analyticsData || null;
  const equityCurve = equityData?.curve || [];
  const riskStatus = riskData || null;

  const [totalUnrealizedPnl, setTotalUnrealizedPnl] = useState(0);

  const { subscribe } = useWebSocket();
  useEffect(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bots'] });
    const unsubs = [
      subscribe('bot:signal', invalidate),
      subscribe('manager:started', invalidate),
      subscribe('manager:stopped', invalidate),
      subscribe('bots:unrealized-pnl', (data) => {
        const total = (data.positions || []).reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
        setTotalUnrealizedPnl(total);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [subscribe]);

  const runningBots = bots.filter(b => b.state === 'running').length;
  const pausedBots = bots.filter(b => b.state === 'paused').length;

  return (
    <div className="space-y-6">
      {/* Top Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <TopStat
          icon={DollarSign}
          label="Total PnL"
          value={analytics ? `$${(analytics.totalPnl || 0).toFixed(2)}` : '--'}
          color={(analytics?.totalPnl || 0) >= 0 ? 'success' : 'error'}
          sub={totalUnrealizedPnl !== 0
            ? `Unrealized: ${totalUnrealizedPnl >= 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(2)}`
            : (analytics ? `Net: $${(analytics.netPnl || 0).toFixed(2)}` : '')}
        />
        <TopStat
          icon={BarChart3}
          label="Win Rate"
          value={analytics ? `${analytics.winRate}%` : '--'}
          color="accent"
          sub={analytics ? `${analytics.winning}W / ${analytics.losing}L` : ''}
        />
        <TopStat
          icon={Bot}
          label="Active Bots"
          value={`${runningBots}/${bots.length}`}
          color={runningBots > 0 ? 'success' : 'gray'}
          sub={pausedBots > 0 ? `${pausedBots} paused` : masterState}
        />
        <TopStat
          icon={Shield}
          label="Risk Level"
          value={riskStatus?.riskLevel || 'unknown'}
          color={riskStatus?.riskLevel === 'low' ? 'success' : riskStatus?.riskLevel === 'medium' ? 'warning' : 'error'}
          sub={riskStatus?.state?.killSwitchActive ? '⚠️ Kill switch ON' : `DD: ${riskStatus?.drawdownPct || '0'}%`}
        />
      </div>

      {/* Equity Curve */}
      <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <TrendingUp size={14} className="text-success" />
          Equity Curve (30 days)
        </h3>
        {equityCurve.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={equityCurve} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <defs>
                <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#9ca3af' }}
              />
              <Area type="monotone" dataKey="end_equity" stroke="#22c55e" fill="url(#equityGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-[220px] text-gray-600">
            <p className="text-sm">No equity data yet. Start trading to see your curve.</p>
          </div>
        )}
      </div>

      {/* Bot Summary + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bot Summary */}
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <Bot size={14} className="text-accent" /> Bot Summary
            </h3>
            <Link to="/bots" className="text-[10px] text-accent hover:underline">
              View All →
            </Link>
          </div>
          {bots.length === 0 ? (
            <p className="text-xs text-gray-500 py-4 text-center">No bots configured. Go to Bots tab to create one.</p>
          ) : (
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {bots.slice(0, 8).map(bot => (
                <div key={bot.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2 border border-border-subtle">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      bot.state === 'running' ? 'bg-success animate-pulse' :
                      bot.state === 'paused' ? 'bg-warning' : 'bg-gray-500'
                    }`} />
                    <span className="text-xs font-mono font-medium text-gray-200">{bot.config.symbol}</span>
                    <span className="text-[9px] text-gray-500">{bot.config.strategy}</span>
                  </div>
                  <span className={`text-xs font-mono ${(bot.stats?.totalPnl || 0) >= 0 ? 'text-success' : 'text-error'}`}>
                    {(bot.stats?.totalPnl || 0) >= 0 ? '+' : ''}{(bot.stats?.totalPnl || 0).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Performance Stats */}
        <div className="bg-surface-1 rounded-xl border border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
            <Activity size={14} className="text-info" /> Performance
          </h3>
          {analytics ? (
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Total Trades" value={analytics.totalTrades} />
              <MiniStat label="Avg Trade" value={`$${(analytics.avgPnl || 0).toFixed(4)}`} />
              <MiniStat label="Best Trade" value={`$${(analytics.bestTrade || 0).toFixed(4)}`} positive />
              <MiniStat label="Worst Trade" value={`$${(analytics.worstTrade || 0).toFixed(4)}`} negative />
              <MiniStat label="Total Fees" value={`$${(analytics.totalFees || 0).toFixed(4)}`} />
              <MiniStat label="Breakeven" value={analytics.breakeven || 0} />
            </div>
          ) : (
            <p className="text-xs text-gray-500 py-4 text-center">No trade data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TopStat({ icon: Icon, label, value, color, sub }) {
  const colorMap = {
    success: 'text-success',
    error: 'text-error',
    warning: 'text-warning',
    accent: 'text-accent',
    gray: 'text-gray-400',
  };
  return (
    <div className="bg-surface-1 rounded-xl border border-border-subtle p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={colorMap[color] || 'text-gray-400'} />
        <span className="text-[10px] text-gray-500 uppercase">{label}</span>
      </div>
      <p className={`text-lg font-bold font-mono ${colorMap[color] || 'text-gray-200'}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, positive, negative }) {
  let color = 'text-gray-200';
  if (positive) color = 'text-success';
  if (negative) color = 'text-error';
  return (
    <div className="p-3 rounded-lg bg-surface-2 border border-border-subtle">
      <p className="text-[9px] text-gray-500 uppercase">{label}</p>
      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}
