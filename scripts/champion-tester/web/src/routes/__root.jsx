import {
  Outlet,
  Link,
  useRouterState,
} from '@tanstack/react-router';
import {
  LayoutDashboard, Database, Play, Layers, BarChart3, GitCompare, Coins,
  Activity, Wifi, WifiOff, ChevronLeft, ChevronRight, Bot, Search,
  ArrowLeftRight, TrendingUp, History, Settings, FlaskConical, Terminal,
  Menu, X
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useWebSocket } from '../hooks/useWebSocket.js';

const TABS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/markets', label: 'Markets', icon: Search },
  { to: '/bots', label: 'Bots', icon: Bot },
  { to: '/trading', label: 'Trade', icon: ArrowLeftRight },
  { to: '/positions', label: 'Positions', icon: TrendingUp },
  { to: '/history', label: 'History', icon: History },
  { to: '/logs', label: 'System Logs', icon: Terminal },
  { to: '/backtest/datasets', label: 'Backtest', icon: FlaskConical, children: [
    { to: '/backtest/datasets', label: 'Datasets', icon: Database },
    { to: '/backtest/test', label: 'Run Test', icon: Play },
    { to: '/backtest/sweep', label: 'Sweep', icon: Layers },
    { to: '/backtest/results', label: 'Results', icon: BarChart3 },
    { to: '/backtest/compare', label: 'Compare', icon: GitCompare },
  ]},
  { to: '/settings', label: 'Settings', icon: Settings },
];

// Bottom nav items for mobile
const BOTTOM_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/bots', label: 'Bots', icon: Bot },
  { to: '/trading', label: 'Trade', icon: ArrowLeftRight },
  { to: '/positions', label: 'Positions', icon: TrendingUp },
  { to: '/history', label: 'History', icon: History },
];

export default function RootLayout() {
  const { connected } = useWebSocket();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paperMode, setPaperMode] = useState(true);
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  useEffect(() => {
    fetch('/api/bots/settings/global').then(r => r.json()).then(d => setPaperMode(d.settings?.paperTrade ?? true)).catch(() => {});
  }, []);

  // Find current tab label for header
  const allTabs = TABS.flatMap(t => t.children ? [t, ...t.children] : [t]);
  const currentTab = allTabs.find(t => currentPath.startsWith(t.to));

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-surface-1 border-r border-border-subtle transition-all duration-200
          ${collapsed ? 'w-16' : 'w-60'}
          ${mobileOpen
            ? 'fixed inset-y-0 left-0 z-40 w-60 translate-x-0'
            : '-translate-x-full'
          } md:translate-x-0 md:relative md:flex
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-border-subtle shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-blue-400 flex items-center justify-center text-white font-bold text-sm shrink-0">
            CT
          </div>
          {!collapsed && (
            <div className="animate-fade-in">
              <h1 className="text-sm font-semibold text-gray-100 leading-tight">Crypto Trader</h1>
              <p className="text-[10px] text-gray-500 leading-tight">Automated Trading</p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = currentPath.startsWith(t.to);
            const isExpanded = t.children && currentPath.startsWith('/backtest');
            return (
              <div key={t.to}>
                <Link
                  to={t.to}
                  onClick={() => setMobileOpen(false)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                    isActive
                      ? 'bg-accent/10 text-accent border border-accent/20 shadow-sm shadow-accent/5'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-surface-2 border border-transparent'
                  }`}
                  title={collapsed ? t.label : undefined}
                >
                  <Icon size={18} className={`shrink-0 ${isActive ? 'text-accent' : 'text-gray-500 group-hover:text-gray-300'}`} />
                  {!collapsed && <span>{t.label}</span>}
                </Link>
                {/* Sub-items */}
                {!collapsed && isExpanded && t.children && (
                  <div className="ml-6 mt-1 space-y-0.5">
                    {t.children.map(child => {
                      const ChildIcon = child.icon;
                      const childActive = currentPath === child.to;
                      return (
                        <Link
                          key={child.to}
                          to={child.to}
                          onClick={() => setMobileOpen(false)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                            childActive
                              ? 'text-accent bg-accent/5'
                              : 'text-gray-500 hover:text-gray-300 hover:bg-surface-2'
                          }`}
                        >
                          <ChildIcon size={14} className={childActive ? 'text-accent' : 'text-gray-600'} />
                          <span>{child.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
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
      <main className="flex-1 overflow-y-auto bg-surface-0 pb-16 md:pb-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 bg-surface-0/80 backdrop-blur-md border-b border-border-subtle px-4 md:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-surface-2 transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
            <h2 className="text-lg font-semibold text-gray-100">
              {currentTab?.label || 'Dashboard'}
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {paperMode && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/20">
                <span className="text-[10px] font-bold text-warning uppercase">Paper Mode</span>
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-border-subtle">
              <Activity size={12} className={`${connected ? 'text-success animate-pulse-glow' : 'text-error'}`} />
              <span className="text-xs text-gray-400">Live</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-4 md:p-6 animate-fade-in">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-surface-1 border-t border-border-subtle md:hidden">
        <div className="flex items-center justify-around h-16">
          {BOTTOM_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = currentPath.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-md transition-colors ${
                  isActive ? 'text-accent' : 'text-gray-500'
                }`}
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
