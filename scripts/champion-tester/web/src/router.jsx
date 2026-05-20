import {
  createRouter,
  createRoute,
  createRootRoute,
  redirect,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { RouteErrorComponent } from './components/ErrorBoundary.jsx';
import { DashboardSkeleton, PageSkeleton } from './components/Skeleton.jsx';
import RootLayout from './routes/__root.jsx';

// Root route
const rootRoute = createRootRoute({
  component: RootLayout,
});

// Index — redirect to /dashboard
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' });
  },
});

// Main routes
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: lazyRouteComponent(() => import('./components/DashboardPro.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: DashboardSkeleton,
});

const marketsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/markets',
  component: lazyRouteComponent(() => import('./components/MarketBrowser.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const botsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bots',
  component: lazyRouteComponent(() => import('./components/BotManager.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const tradingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trading',
  component: lazyRouteComponent(() => import('./components/TradingPanel.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const positionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/positions',
  component: lazyRouteComponent(() => import('./components/PositionsView.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  component: lazyRouteComponent(() => import('./components/TradeHistory.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: lazyRouteComponent(() => import('./components/SystemLogs.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(() => import('./components/SettingsPanel.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

// Backtest parent route (layout-less, just groups paths)
const backtestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backtest',
});

const backtestIndexRoute = createRoute({
  getParentRoute: () => backtestRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/backtest/datasets' });
  },
});

const backtestDatasetsRoute = createRoute({
  getParentRoute: () => backtestRoute,
  path: '/datasets',
  component: lazyRouteComponent(() => import('./components/DatasetPanel.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const backtestTestRoute = createRoute({
  getParentRoute: () => backtestRoute,
  path: '/test',
  component: lazyRouteComponent(() => import('./components/TestRunner.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const backtestSweepRoute = createRoute({
  getParentRoute: () => backtestRoute,
  path: '/sweep',
  component: lazyRouteComponent(() => import('./components/SweepPanel.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const backtestResultsRoute = createRoute({
  getParentRoute: () => backtestRoute,
  path: '/results',
  component: lazyRouteComponent(() => import('./components/ResultsTable.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

const backtestCompareRoute = createRoute({
  getParentRoute: () => backtestRoute,
  path: '/compare',
  component: lazyRouteComponent(() => import('./components/CompareView.jsx')),
  errorComponent: RouteErrorComponent,
  pendingComponent: PageSkeleton,
});

// Build route tree
const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  marketsRoute,
  botsRoute,
  tradingRoute,
  positionsRoute,
  historyRoute,
  logsRoute,
  settingsRoute,
  backtestRoute.addChildren([
    backtestIndexRoute,
    backtestDatasetsRoute,
    backtestTestRoute,
    backtestSweepRoute,
    backtestResultsRoute,
    backtestCompareRoute,
  ]),
]);

// Create router
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});
