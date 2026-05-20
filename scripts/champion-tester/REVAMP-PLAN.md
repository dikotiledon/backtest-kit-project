# Crypto Trader — Production-Grade Revamp Plan

## Executive Summary

Rebrand "Champion Tester" → **Crypto Trader**.
Transform from backtest GUI into a production-grade multi-symbol automated trading platform.
Spot + USD-M Futures + COIN-M Futures. Real-time. Robust. Professional.

---

## Current State Assessment

### What Exists (Working)
- Binance Spot connector with full order management
- Binance Futures connector (USD-M + COIN-M)
- Base HTTP client with rate limiting, retries, clock sync
- Trade executor with risk limits (single-signal execution)
- Trading routes (30+ endpoints)
- Frontend TradingPanel with tabs (Overview, Orders, Futures, Positions, Settings)
- WebSocket real-time updates
- Encrypted credential storage

### Critical Flaws
1. **Executor is passive** — only executes when manually sent a signal via API. No auto-trading loop.
2. **No symbol watchlist** — can't select/manage multiple symbols to trade
3. **No strategy engine integration** — executor disconnected from champion strategies
4. **No real-time price feeds** — no Binance WebSocket market streams
5. **No trade automation** — no scheduler, no continuous monitoring
6. **Branding still says "Champion Tester"**
7. **No error recovery** — if WS drops or order fails, no retry/reconnect
8. **No PnL tracking dashboard** — daily stats reset on restart
9. **No symbol search/browser** — must type symbols manually
10. **No position monitoring** — no auto SL/TP adjustment, no trailing logic

---

## Architecture (Target)

```
┌─────────────────────────────────────────────────────┐
│                  CRYPTO TRADER                        │
├─────────────────────────────────────────────────────┤
│  Frontend (React + Vite + Tailwind)                  │
│  ├── Dashboard (PnL, equity curve, active bots)      │
│  ├── Market Browser (search Binance symbols)         │
│  ├── Bot Manager (multi-symbol auto-trading)         │
│  ├── Manual Trading (spot + futures order forms)     │
│  ├── Positions & Orders (live monitoring)            │
│  ├── Trade History & Analytics                       │
│  ├── Settings (credentials, risk, preferences)       │
│  └── Backtest (legacy champion test integration)     │
├─────────────────────────────────────────────────────┤
│  Backend (Express + WebSocket)                       │
│  ├── Trading Engine (multi-symbol bot orchestrator)  │
│  ├── Market Data Service (Binance WS streams)        │
│  ├── Order Manager (placement, tracking, lifecycle)  │
│  ├── Risk Manager (global + per-bot limits)          │
│  ├── Position Tracker (real-time PnL, liquidation)   │
│  ├── Trade Logger (persistent, queryable history)    │
│  ├── Strategy Bridge (champion → live signals)       │
│  └── Notification Service (alerts on events)         │
├─────────────────────────────────────────────────────┤
│  Connectors                                          │
│  ├── Binance Spot REST + WS                          │
│  ├── Binance USD-M Futures REST + WS                 │
│  └── Binance COIN-M Futures REST + WS                │
└─────────────────────────────────────────────────────┘
```

---

## Phase 1: Rebrand + Fix Foundation

### 1.1 Rebrand (All Files)
| File | Change |
|------|--------|
| `package.json` | name → `crypto-trader`, update description |
| `web/src/components/Layout.jsx` | Logo "CT" → "CT" (Crypto Trader), title, subtitle |
| `server.mjs` | Console logs, health endpoint service name |
| `README.md` | Full rewrite as Crypto Trader |
| `web/index.html` | `<title>` tag |
| `vite.config.mjs` | No change needed |

### 1.2 Fix Existing Bugs
| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Executor start fails silently if futures not configured | `_executeFuturesSignal` called without null check on connector | Guard with `isInitialized()` check |
| Settings tab doesn't load existing risk limits on first render | `useEffect` depends on `status` but initial fetch races | Add loading guard |
| Spot balance shows ALL assets including zero balances | No filter in `getBalance()` | Filter `free > 0 \|\| locked > 0` |
| WebSocket reconnect doesn't re-auth | `useWebSocket` reconnects but server doesn't re-send state | Send full state on reconnect |
| Order form allows submit without connection | Missing disabled state | Disable form when `!connected` |
| Futures position close uses wrong market | Hardcoded `'usdm'` in PositionsTab | Use position's actual market |

### 1.3 Dependency Audit & Updates
| Action | Detail |
|--------|--------|
| Pin `@binance/connector` | Lock to `3.6.1` exact |
| Add `better-sqlite3` | Persistent trade history DB |
| Add `technical-indicators` | TA library for strategy signals |
| Add `date-fns` | Date formatting (replace raw ISO) |
| Add `zustand` | Lightweight state management (replace prop drilling) |
| Add `react-hot-toast` | Replace custom toast with production lib |
| Add `recharts` | PnL charts, equity curves |
| Remove `lightweight-charts` | Replace with recharts for consistency |

---

## Phase 2: Market Data Service (Binance WS Streams)

### 2.1 New File: `lib/market-data-service.mjs`

Real-time price feeds via Binance WebSocket streams.

**Capabilities:**
- Subscribe to multiple symbol price streams (spot + futures)
- Aggregate trades stream for real-time price
- Kline/candlestick streams (1m, 5m, 15m)
- 24h ticker streams for watchlist
- Mark price stream (futures) for liquidation monitoring
- Auto-reconnect with exponential backoff
- Connection health monitoring (ping/pong)
- Stream multiplexing (combined streams endpoint)

**API:**
```js
class MarketDataService extends EventEmitter {
  subscribe(symbols, streams)    // e.g. ['btcusdt'], ['aggTrade', 'kline_1m']
  unsubscribe(symbols, streams)
  getPrice(symbol)               // last known price (cached)
  getKlines(symbol, interval)    // buffered recent klines
  getTickerAll()                 // all subscribed 24h tickers
  getStatus()                    // connection health
}
```

**Events emitted:**
- `price:update` — { symbol, price, timestamp }
- `kline:update` — { symbol, interval, kline }
- `ticker:update` — { symbol, ticker }
- `markPrice:update` — { symbol, markPrice, fundingRate }
- `stream:error` — { error, stream }
- `stream:reconnect` — { attempt, stream }

### 2.2 New File: `lib/symbol-registry.mjs`

Central symbol catalog pulled from Binance exchange info.

**Capabilities:**
- Fetch all tradeable symbols (spot + usdm + coinm)
- Search/filter by base asset, quote asset, status
- Cache exchange info (refresh every 6h or on-demand)
- Provide symbol metadata: filters, tick size, lot size, min notional
- Categorize: top gainers, top volume, new listings

**API:**
```js
class SymbolRegistry {
  async refresh(market)           // 'spot' | 'usdm' | 'coinm'
  search(query, market, filters)  // fuzzy search
  getSymbol(symbol, market)       // full metadata
  getTopByVolume(market, limit)   // sorted by 24h volume
  getCategories()                 // grouped symbols
  isValid(symbol, market)         // quick validation
}
```

---

## Phase 3: Trading Bot Engine (Core Feature)

### 3.1 New File: `lib/trading-bot.mjs`

Individual bot instance that monitors one symbol and executes trades.

**Bot Lifecycle:**
```
CREATED → STARTING → RUNNING → STOPPING → STOPPED
                         │
                         ├─→ PAUSED (manual or risk limit hit)
                         └─→ ERROR (recoverable, auto-restart)
```

**Bot Config (per symbol):**
```js
{
  id: 'bot_uuid',
  symbol: 'BTCUSDT',
  market: 'usdm',           // 'spot' | 'usdm' | 'coinm'
  strategy: 'momentum',     // strategy type
  strategyParams: {},        // strategy-specific config
  leverage: 10,             // futures only
  marginType: 'ISOLATED',  // futures only
  positionSide: 'BOTH',    // hedge mode support
  allocation: 100,          // USDT allocated to this bot
  maxPositionSize: 50,      // max USDT per trade
  stopLoss: 2.0,           // % from entry
  takeProfit: 4.0,         // % from entry
  trailingStop: null,      // optional trailing %
  cooldownMs: 30000,       // between trades
  enabled: true,
  createdAt: 'ISO',
  updatedAt: 'ISO',
}
```

**Bot Behavior:**
- Subscribes to market data for its symbol
- Runs strategy logic on each new kline close
- Generates BUY/SELL signals based on strategy
- Passes signals through risk manager
- Executes orders via order manager
- Monitors open positions (SL/TP/trailing)
- Logs all decisions and trades
- Auto-pauses on consecutive losses or risk breach

### 3.2 New File: `lib/bot-manager.mjs`

Orchestrates multiple trading bots. This is the "master button" the user wants.

**Capabilities:**
- Create/start/stop/pause/resume/delete bots
- Start ALL bots with one click (master start)
- Stop ALL bots with one click (master stop)
- Global risk enforcement across all bots
- Bot health monitoring (restart crashed bots)
- Persist bot configs to disk (survive restart)
- Real-time status broadcasting via WebSocket

**API:**
```js
class BotManager extends EventEmitter {
  // Master controls
  startAll()                    // THE master button
  stopAll()                     // emergency stop all
  pauseAll()                    // pause without closing positions
  
  // Individual bot CRUD
  createBot(config)             // create + persist
  startBot(botId)               // start single bot
  stopBot(botId)                // stop single bot
  pauseBot(botId)
  resumeBot(botId)
  deleteBot(botId)
  updateBot(botId, patch)       // update config (restarts if running)
  
  // Queries
  listBots(filter)              // all bots with status
  getBot(botId)                 // single bot detail
  getBotStats(botId)            // performance stats
  getGlobalStats()              // aggregate across all bots
  
  // Persistence
  saveState()                   // persist to disk
  loadState()                   // restore on startup
}
```

**Events emitted:**
- `bot:created` / `bot:started` / `bot:stopped` / `bot:paused`
- `bot:signal` — strategy generated a signal
- `bot:trade` — order executed
- `bot:error` — bot encountered error
- `bot:risk-breach` — risk limit hit
- `manager:started` / `manager:stopped` — master state changes

**Persistence file:** `config/bots.json`
```json
{
  "bots": [...],
  "globalSettings": {
    "maxConcurrentBots": 10,
    "maxGlobalDrawdownPct": 15,
    "maxGlobalDailyLossUSDT": 100,
    "autoRestartOnError": true,
    "autoRestartMaxRetries": 3
  }
}
```

### 3.3 New File: `lib/strategies/index.mjs`

Strategy registry — pluggable trading strategies for bots.

**Built-in Strategies:**

| Strategy | Logic | Timeframe |
|----------|-------|-----------|
| `momentum` | RSI + MACD crossover | 5m, 15m |
| `breakout` | Bollinger Band squeeze + volume spike | 15m, 1h |
| `trend-follow` | EMA crossover (9/21/55) + ADX filter | 15m, 1h |
| `scalp` | VWAP deviation + order flow imbalance | 1m, 5m |
| `mean-reversion` | RSI oversold/overbought + support/resistance | 5m, 15m |
| `champion` | Load from backtest champion results | configurable |

**Strategy Interface:**
```js
class BaseStrategy {
  constructor(params) {}        // strategy-specific params
  getName()                     // human-readable name
  getRequiredStreams()          // ['kline_15m', 'aggTrade']
  getRequiredHistory()          // min candles needed to warm up
  onKlineClose(kline, state)    // returns signal or null
  onPriceUpdate(price, state)   // for SL/TP/trailing checks
  getState()                    // serializable state for persistence
  reset()                       // clear indicators
}

// Signal format:
{
  action: 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE_LONG' | 'CLOSE_SHORT',
  confidence: 0.85,            // 0-1 signal strength
  reason: 'RSI oversold + MACD bullish cross',
  suggestedEntry: 67500,
  suggestedSL: 66800,
  suggestedTP: 69000,
  metadata: {}                 // strategy-specific debug info
}
```

### 3.4 New File: `lib/risk-manager.mjs`

Centralized risk enforcement. All orders pass through here before execution.

**Rules Engine:**
- Max global daily loss (USDT)
- Max global drawdown from peak equity (%)
- Max concurrent positions (global + per-market)
- Max position size per trade (USDT)
- Max leverage per symbol
- Correlation check (don't over-expose to same sector)
- Cooldown after consecutive losses
- Cooldown after liquidation
- Kill switch: auto-stop all bots if threshold breached
- Time-based rules: no trading during low-liquidity hours (optional)

**API:**
```js
class RiskManager extends EventEmitter {
  checkOrder(order, botId)       // returns { allowed, violations[] }
  registerTrade(trade)           // update running totals
  registerPnL(pnl)              // update daily PnL
  getStatus()                   // current risk state
  getDailyReport()              // summary of risk events
  isKillSwitchActive()          // emergency state
  activateKillSwitch(reason)    // manual or auto
  deactivateKillSwitch()        // resume trading
  updateLimits(newLimits)       // hot-update risk params
}
```

---

## Phase 4: Order & Position Management

### 4.1 Refactor: `lib/trade-executor.mjs` → `lib/order-manager.mjs`

Rename and refactor. Single responsibility: execute orders and track lifecycle.

**Improvements over current:**
- Order state machine: PENDING → SUBMITTED → PARTIAL → FILLED / CANCELLED / REJECTED
- Retry failed orders (network timeout, not rejection)
- Order ID tracking with Binance client order ID
- Fill price averaging for partial fills
- Automatic SL/TP placement after main order fills
- OCO order support for spot
- Batch order support for futures
- Order amendment (cancel + replace)
- Slippage detection and alerting

### 4.2 New File: `lib/position-tracker.mjs`

Real-time position monitoring with mark price updates.

**Capabilities:**
- Track all open positions (spot + futures)
- Real-time unrealized PnL calculation
- Liquidation price monitoring (futures)
- Auto trailing stop adjustment
- Break-even stop move after X% profit
- Partial take-profit (scale out)
- Position aging alerts (stale positions)
- Margin ratio monitoring (futures)

---

## Phase 5: Persistent Storage

### 5.1 New File: `lib/trade-db.mjs`

SQLite database for trade history, bot state, and analytics.

**Tables:**
```sql
-- All executed trades
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  bot_id TEXT,
  symbol TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL,
  avg_fill_price REAL,
  status TEXT NOT NULL,
  pnl REAL,
  fees REAL,
  strategy TEXT,
  signal_reason TEXT,
  order_id TEXT,
  binance_order_id TEXT,
  created_at TEXT NOT NULL,
  filled_at TEXT,
  closed_at TEXT
);

-- Daily performance snapshots
CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  total_trades INTEGER,
  winning_trades INTEGER,
  losing_trades INTEGER,
  gross_pnl REAL,
  fees REAL,
  net_pnl REAL,
  max_drawdown REAL,
  peak_equity REAL,
  end_equity REAL
);

-- Bot configurations (persistent)
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  config TEXT NOT NULL,  -- JSON
  state TEXT,           -- JSON (last known state)
  created_at TEXT,
  updated_at TEXT
);

-- Risk events log
CREATE TABLE risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  bot_id TEXT,
  details TEXT,         -- JSON
  created_at TEXT NOT NULL
);
```

---

## Phase 6: Frontend Revamp

### 6.1 New Navigation Structure

| Tab | Icon | Purpose |
|-----|------|---------|
| Dashboard | `LayoutDashboard` | PnL overview, equity curve, active bots summary |
| Markets | `Search` | Browse/search Binance symbols, add to watchlist |
| Bots | `Bot` | Create, manage, start/stop trading bots (MASTER CONTROL) |
| Trade | `ArrowLeftRight` | Manual spot + futures order placement |
| Positions | `TrendingUp` | All open positions with live PnL |
| Orders | `ClipboardList` | Open + historical orders |
| History | `History` | Trade history, analytics, export |
| Backtest | `FlaskConical` | Legacy champion test runner |
| Settings | `Settings` | Credentials, risk limits, preferences |

### 6.2 New Component: `BotManager.jsx` (Primary Feature)

This is the core UI the user wants. The "master button" for auto-trading.

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [▶ START ALL]  [⏹ STOP ALL]  [⏸ PAUSE ALL]  Status: 3/5 running  │
├─────────────────────────────────────────────────────────┤
│  [+ Add Bot]  [Import from Backtest]  Filter: [All ▾]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Bot Card ─────────────────────────────────────┐     │
│  │ BTCUSDT (USD-M) │ Momentum │ 10x │ ▶ Running  │     │
│  │ PnL: +$45.20 │ Trades: 12 │ Win: 75% │ Alloc: $200 │ │
│  │ [Pause] [Stop] [Edit] [Delete]                 │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
│  ┌─ Bot Card ─────────────────────────────────────┐     │
│  │ ETHUSDT (USD-M) │ Breakout │ 5x │ ⏸ Paused   │     │
│  │ PnL: -$12.30 │ Trades: 8 │ Win: 50% │ Alloc: $150  │ │
│  │ [Resume] [Stop] [Edit] [Delete]                │     │
│  └────────────────────────────────────────────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Bot Creation Flow:**
1. Click "+ Add Bot"
2. Search/select symbol from Binance (autocomplete)
3. Choose market (Spot / USD-M / COIN-M)
4. Select strategy (dropdown with descriptions)
5. Configure: leverage, allocation, SL/TP, timeframe
6. Review summary → Create
7. Bot appears in list, click Start to activate

### 6.3 New Component: `MarketBrowser.jsx`

**Features:**
- Search bar with autocomplete (fetches from Binance exchange info)
- Filter by: market type, quote asset, volume, category
- Show: price, 24h change, volume, market cap rank
- Quick actions: "Add Bot", "Add to Watchlist", "Trade"
- Tabs: Spot | USD-M Futures | COIN-M Futures
- Sort by: name, price, change%, volume
- Pagination for large lists

### 6.4 New Component: `DashboardPro.jsx` (replaces Dashboard)

**Sections:**
- Total equity (spot + futures combined)
- Today's PnL (absolute + %)
- Equity curve chart (7d / 30d / all)
- Active bots summary (running/paused/stopped)
- Recent trades feed (last 10)
- Risk status indicator (green/yellow/red)
- Quick stats: win rate, avg trade, best/worst day

### 6.5 State Management: Zustand Stores

**Stores:**
```
web/src/stores/
  useBotStore.js        // bot list, status, CRUD
  useMarketStore.js     // symbols, prices, tickers
  usePositionStore.js   // open positions, PnL
  useOrderStore.js      // open + historical orders
  useSettingsStore.js   // config, risk limits
  useWsStore.js         // WebSocket connection state
```

Benefits over current prop-drilling:
- No more passing 10+ props through component trees
- Automatic re-render only on relevant state changes
- Persistent state across tab switches
- Easy WebSocket event → store update mapping

### 6.6 WebSocket Event Mapping (Frontend)

| Server Event | Store Update |
|-------------|-------------|
| `bot:started` | `useBotStore.updateBot(id, {status: 'running'})` |
| `bot:stopped` | `useBotStore.updateBot(id, {status: 'stopped'})` |
| `bot:trade` | `usePositionStore.addTrade(trade)` |
| `bot:signal` | `useBotStore.addSignal(botId, signal)` |
| `price:update` | `useMarketStore.setPrice(symbol, price)` |
| `position:update` | `usePositionStore.update(position)` |
| `order:update` | `useOrderStore.update(order)` |
| `risk:breach` | `useSettingsStore.setRiskAlert(alert)` |
| `manager:started` | `useBotStore.setMasterState('running')` |
| `manager:stopped` | `useBotStore.setMasterState('stopped')` |

---

## Phase 7: API Routes Revamp

### 7.1 New Routes (Bot Management)

```
POST   /api/bots                    // create bot
GET    /api/bots                    // list all bots
GET    /api/bots/:id                // get bot detail
PATCH  /api/bots/:id                // update bot config
DELETE /api/bots/:id                // delete bot
POST   /api/bots/:id/start          // start single bot
POST   /api/bots/:id/stop           // stop single bot
POST   /api/bots/:id/pause          // pause single bot
POST   /api/bots/:id/resume         // resume single bot
GET    /api/bots/:id/stats          // bot performance stats
GET    /api/bots/:id/trades         // bot trade history

POST   /api/bots/start-all          // MASTER START
POST   /api/bots/stop-all           // MASTER STOP
POST   /api/bots/pause-all          // MASTER PAUSE
GET    /api/bots/stats/global       // aggregate stats
```

### 7.2 New Routes (Market Data)

```
GET    /api/markets/symbols/:market  // all symbols for market
GET    /api/markets/search           // ?q=BTC&market=usdm
GET    /api/markets/ticker/:market   // all 24h tickers
GET    /api/markets/price/:symbol    // current price
POST   /api/markets/subscribe       // subscribe to WS streams
DELETE /api/markets/subscribe       // unsubscribe
GET    /api/markets/streams          // active stream status
```

### 7.3 New Routes (Analytics)

```
GET    /api/analytics/equity         // equity curve data
GET    /api/analytics/daily          // daily PnL history
GET    /api/analytics/trades         // paginated trade history
GET    /api/analytics/summary        // overall performance
GET    /api/analytics/export         // CSV export
```

### 7.4 Existing Routes (Keep + Fix)

All existing `/api/trading/*` routes remain for manual trading.
Fix error handling consistency across all routes.

---

## Phase 8: Error Handling & Resilience

### 8.1 Global Error Strategy

| Layer | Strategy |
|-------|----------|
| Binance REST | Retry 3x with backoff, classify errors (rate limit vs rejection vs network) |
| Binance WS | Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s) |
| Order execution | Retry on timeout, fail-fast on rejection, alert on partial fill |
| Bot crash | Auto-restart up to 3x, then pause + alert |
| Server crash | Persist state to disk, restore on restart |
| Frontend WS | Auto-reconnect, show connection status, queue actions during disconnect |

### 8.2 Health Monitoring

- Binance API connectivity check (every 30s)
- WebSocket heartbeat (ping/pong every 10s)
- Bot health check (detect stuck bots)
- Memory/CPU monitoring
- Rate limit usage tracking (warn at 80%)

---

## Phase 9: Security Hardening

| Area | Implementation |
|------|---------------|
| API Keys | AES-256-GCM encrypted at rest (already done) |
| Server access | Bind to localhost only by default |
| CORS | Strict origin policy |
| Rate limiting | Express rate limiter on all endpoints |
| Input validation | Validate all order params before sending to Binance |
| Error messages | Never expose raw Binance errors to frontend (sanitize) |
| Secrets in logs | Mask API keys in all log output |
| Config file perms | Restrict file permissions on binance.json |

---

## Phase 10: Implementation Order (Execution Chunks)

Each chunk is a self-contained unit that can be built and tested independently.
Ordered by dependency: later chunks depend on earlier ones.

### Chunk 1: Rebrand + Bug Fixes
**Files modified:** 6 | **Estimated:** small
1. `package.json` — rename, update description
2. `web/index.html` — title
3. `web/src/components/Layout.jsx` — branding
4. `server.mjs` — health endpoint name, console logs
5. `web/src/components/TradingPanel.jsx` — fix bugs listed in 1.2
6. `README.md` — rewrite

### Chunk 2: Symbol Registry
**Files created:** 1 | **Files modified:** 1
1. `lib/symbol-registry.mjs` — full implementation
2. `lib/trading-routes.mjs` — add symbol search routes

### Chunk 3: Market Data Service
**Files created:** 1 | **Files modified:** 1
1. `lib/market-data-service.mjs` — WS stream manager
2. `server.mjs` — initialize on startup, add routes

### Chunk 4: Trade Database
**Files created:** 1 | **Deps added:** 1
1. `lib/trade-db.mjs` — SQLite schema + CRUD
2. `package.json` — add `better-sqlite3`

### Chunk 5: Risk Manager
**Files created:** 1
1. `lib/risk-manager.mjs` — centralized risk engine

### Chunk 6: Strategy Framework
**Files created:** 7
1. `lib/strategies/index.mjs` — registry
2. `lib/strategies/base-strategy.mjs` — abstract class
3. `lib/strategies/momentum.mjs`
4. `lib/strategies/breakout.mjs`
5. `lib/strategies/trend-follow.mjs`
6. `lib/strategies/scalp.mjs`
7. `lib/strategies/champion-bridge.mjs` — load from backtest results

### Chunk 7: Trading Bot + Bot Manager
**Files created:** 2 | **Files modified:** 1
1. `lib/trading-bot.mjs` — individual bot class
2. `lib/bot-manager.mjs` — orchestrator
3. `server.mjs` — register bot routes

### Chunk 8: Order Manager Refactor
**Files modified:** 1
1. `lib/trade-executor.mjs` — refactor into order-manager pattern
   (keep backward compat with existing routes)

### Chunk 9: Position Tracker
**Files created:** 1
1. `lib/position-tracker.mjs` — real-time position monitor

### Chunk 10: Bot API Routes
**Files created:** 1
1. `lib/bot-routes.mjs` — all `/api/bots/*` endpoints

### Chunk 11: Analytics Routes
**Files created:** 1
1. `lib/analytics-routes.mjs` — equity, daily, trades, export

### Chunk 12: Frontend — State Management
**Files created:** 6 | **Deps added:** 1
1. `web/src/stores/useBotStore.js`
2. `web/src/stores/useMarketStore.js`
3. `web/src/stores/usePositionStore.js`
4. `web/src/stores/useOrderStore.js`
5. `web/src/stores/useSettingsStore.js`
6. `web/src/stores/useWsStore.js`
7. `package.json` — add `zustand`

### Chunk 13: Frontend — Market Browser
**Files created:** 1
1. `web/src/components/MarketBrowser.jsx`

### Chunk 14: Frontend — Bot Manager UI
**Files created:** 3
1. `web/src/components/BotManager.jsx` — main view with master controls
2. `web/src/components/BotCard.jsx` — individual bot card
3. `web/src/components/BotCreateModal.jsx` — creation wizard

### Chunk 15: Frontend — Dashboard Pro
**Files created:** 1 | **Deps added:** 1
1. `web/src/components/DashboardPro.jsx`
2. `package.json` — add `recharts`

### Chunk 16: Frontend — Trade History & Analytics
**Files created:** 1
1. `web/src/components/TradeHistory.jsx`

### Chunk 17: Frontend — Navigation + App Rewire
**Files modified:** 3
1. `web/src/App.jsx` — new tab routing
2. `web/src/components/Layout.jsx` — new nav structure
3. `web/src/api.js` — add bot/market/analytics endpoints

### Chunk 18: Frontend — Manual Trading Fixes
**Files modified:** 1
1. `web/src/components/TradingPanel.jsx` — fix all identified bugs

### Chunk 19: Integration Testing
1. Verify all bot lifecycle operations
2. Test WS reconnection scenarios
3. Test risk limit enforcement
4. Test order execution flow
5. Load test with multiple bots

### Chunk 20: Polish & Production Prep
1. Error boundary components
2. Loading skeletons
3. Mobile responsiveness audit
4. Performance optimization (memo, virtualization)
5. Final build verification

---

## File Map (Final State)

```
lib/
  binance-base-client.mjs      (keep - already robust)
  binance-config.mjs           (keep - encrypted storage)
  binance-connector.mjs        (keep - spot REST)
  binance-futures-connector.mjs (keep - futures REST)
  binance-ws-manager.mjs       (keep - base WS, enhance)
  market-data-service.mjs      [NEW] real-time price feeds
  symbol-registry.mjs          [NEW] symbol catalog
  trading-bot.mjs              [NEW] individual bot
  bot-manager.mjs              [NEW] multi-bot orchestrator
  bot-routes.mjs               [NEW] bot API endpoints
  risk-manager.mjs             [NEW] centralized risk
  order-manager.mjs            [REFACTOR from trade-executor]
  position-tracker.mjs         [NEW] position monitoring
  trade-db.mjs                 [NEW] SQLite persistence
  analytics-routes.mjs         [NEW] analytics endpoints
  trading-routes.mjs           (keep - manual trading)
  strategies/
    index.mjs                  [NEW] strategy registry
    base-strategy.mjs          [NEW] abstract base
    momentum.mjs               [NEW]
    breakout.mjs               [NEW]
    trend-follow.mjs           [NEW]
    scalp.mjs                  [NEW]
    champion-bridge.mjs        [NEW]
  champion-loader.mjs          (keep - backtest integration)
  dataset-manager.mjs          (keep - backtest data)
  metric-normalizer.mjs        (keep)
  results-store.mjs            (keep)
  strategy-runner.mjs          (keep - backtest runner)
  sweep-runner.mjs             (keep - backtest sweep)

web/src/
  stores/
    useBotStore.js             [NEW]
    useMarketStore.js          [NEW]
    usePositionStore.js        [NEW]
    useOrderStore.js           [NEW]
    useSettingsStore.js        [NEW]
    useWsStore.js              [NEW]
  components/
    Layout.jsx                 [MODIFY] new nav
    DashboardPro.jsx           [NEW] replaces Dashboard
    MarketBrowser.jsx          [NEW]
    BotManager.jsx             [NEW] master control
    BotCard.jsx                [NEW]
    BotCreateModal.jsx         [NEW]
    TradingPanel.jsx           [MODIFY] fix bugs
    TradeHistory.jsx           [NEW]
    Dashboard.jsx              (keep as Backtest dashboard)
    ...(other backtest components kept)
  api.js                       [MODIFY] add new endpoints
  App.jsx                      [MODIFY] new routing
```

---

## Key Design Decisions

1. **Keep backtest features** — move to "Backtest" tab, not deleted
2. **SQLite over JSON files** — proper queryable storage, survives crashes
3. **Zustand over Context** — simpler, more performant, less boilerplate
4. **Strategy as plugins** — easy to add new strategies without touching core
5. **Bot = 1 symbol** — simple mental model, compose by adding more bots
6. **Risk manager is global** — all bots share one risk boundary
7. **Market data shared** — multiple bots on same symbol share one WS stream
8. **Backward compatible** — existing manual trading routes unchanged

---

## Ready to Execute

This plan covers 20 implementation chunks.
Each chunk is small enough to implement without hitting provider payload limits.
I will execute them sequentially, verifying each before moving to the next.

**Starting point:** Chunk 1 (Rebrand + Bug Fixes)

Say `go` or `start` to begin execution.
