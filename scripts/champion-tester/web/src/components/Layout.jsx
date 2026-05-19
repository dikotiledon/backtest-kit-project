import {
  LayoutDashboard, Database, Play, Layers, BarChart3, GitCompare, Coins,
  Activity, Wifi, WifiOff, ChevronLeft, ChevronRight
} from 'lucide-react';
import { useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'datasets', label: 'Datasets', icon: Database },
  { id: 'test', label: 'Run Test', icon: Play },
  { id: 'sweep', label: 'Sweep', icon: Layers },
  { id: 'results', label: 'Results', icon: BarChart3 },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'trading', label: 'Trading', icon: Coins },
];

export default function Layout({ activeTab, onTabChange, children }) {
  const { connected } = useWebSocket();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-surface-1 border-r border-border-subtle transition-all duration-200 ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-border-subtle shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-blue-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
            CT
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <h1 className="text-sm font-semibold text-gray-100 leading-tight">Champion Tester</h1>
              <p className="text-[10px] text-gray-500 leading-tight">Backtest Engine</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onTabChange(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                  isActive
                    ? 'bg-accent/10 text-accent border border-accent/20 shadow-sm shadow-accent/5'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-surface-2 border border-transparent'
                }`}
                title={collapsed ? t.label : undefined}
              >
                <Icon size={18} className={`shrink-0 ${isActive ? 'text-accent' : 'text-gray-500 group-hover:text-gray-300'}`} />
                {!collapsed && <span>{t.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="border-t border-border-subtle p-3 space-y-2 shrink-0">
          {/* Connection status */}
          <div className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${connected ? 'bg-success/5' : 'bg-error/5'}`}>
            {connected ? (
              <Wifi size={14} className="text-success shrink-0" />
            ) : (
              <WifiOff size={14} className="text-error shrink-0" />
            )}
            {!collapsed && (
              <span className={`text-xs ${connected ? 'text-success' : 'text-error'}`}>
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center py-1.5 rounded-md text-gray-500 hover:text-gray-300 hover:bg-surface-2 transition-colors"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-surface-0/80 backdrop-blur-md border-b border-border-subtle px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-100">
              {TABS.find(t => t.id === activeTab)?.label}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-border-subtle">
              <Activity size={12} className={`${connected ? 'text-success animate-pulse-glow' : 'text-error'}`} />
              <span className="text-xs text-gray-400">Live</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-6 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
