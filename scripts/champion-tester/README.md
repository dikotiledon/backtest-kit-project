# Crypto Trader

Production-grade multi-symbol automated crypto trading platform.  
Spot + USD-M Futures + COIN-M Futures via Binance.

## Features

### Automated Trading (Bot Engine)
- **Master Start/Stop** — one-click control for all trading bots
- **Multi-symbol bots** — run independent bots on different symbols simultaneously
- **4 built-in strategies** — Momentum, Breakout, Trend Follow, Scalp
- **Per-bot configuration** — leverage, allocation, SL/TP, timeframe, cooldown
- **Auto risk management** — global limits, kill switch, cooldown after losses

### Market Data
- **Real-time WebSocket streams** — live prices from Binance
- **Symbol browser** — search and filter all Binance symbols (spot + futures)
- **Symbol registry** — cached exchange info with auto-refresh

### Manual Trading
- **Spot orders** — market, limit, stop-loss, take-profit, OCO
- **Futures orders** — market, limit, stop market, trailing stop
- **Leverage & margin control** — per-symbol configuration
- **Position management** — close individual or all positions

### Analytics & Monitoring
- **Dashboard** — equity curve, PnL, win rate, risk status
- **Trade history** — paginated, filterable, exportable
- **Position monitor** — real-time unrealized PnL, liquidation warnings
- **Risk dashboard** — drawdown tracking, kill switch, event log

### Backtesting (Legacy)
- Champion strategy testing
- Parameter sweep
- Multi-dataset comparison

## Architecture

```
Backend:  Express + WebSocket + SQLite
Frontend: React 19 + Vite 6 + Tailwind 4 + Zustand + Recharts
Trading:  @binance/connector + custom WS streams
```

## Quick Start

```bash
# Install dependencies
npm install

# Development (API + Vite dev server)
npm run dev

# Production build
npm run build
npm start
```

**Environment:**
- `CRYPTO_TRADER_PORT` — server port (default: 3847)

## Configuration

1. Open the app at `http://localhost:3847`
2. Go to **Settings** tab
3. Enter Binance API key and secret
4. Enable trading + futures as needed
5. Configure risk limits

API keys are encrypted at rest (AES-256-GCM).

## Creating a Bot

1. Go to **Bots** tab
2. Click **+ Add Bot**
3. Search and select a symbol (e.g. BTCUSDT)
4. Choose a strategy (Momentum, Breakout, etc.)
5. Configure leverage, allocation, SL/TP
6. Click **Create Bot**
7. Click **START ALL BOTS** to begin trading

## Project Structure

```
lib/
  binance-base-client.mjs     HTTP client (rate limit, retry, signing)
  binance-config.mjs          Encrypted credential storage
  binance-connector.mjs       Spot REST API
  binance-futures-connector.mjs  Futures REST API
  market-stream.mjs           Binance WebSocket stream handler
  market-data-service.mjs     Multi-stream orchestrator
  symbol-registry.mjs         Symbol catalog + search
  trading-bot.mjs             Individual bot instance
  bot-manager.mjs             Multi-bot orchestrator
  risk-manager.mjs            Centralized risk enforcement
  trade-db.mjs                SQLite persistence
  bot-routes.mjs              Bot + analytics API endpoints
  market-routes.mjs           Symbol search API endpoints
  trading-routes.mjs          Manual trading API endpoints
  strategies/                 Pluggable strategy framework
    index.mjs                 Strategy registry
    base-strategy.mjs         Abstract base class
    momentum.mjs              RSI + MACD
    breakout.mjs              Bollinger Band squeeze
    trend-follow.mjs          EMA crossover + ADX
    scalp.mjs                 VWAP deviation

web/src/
  stores/                     Zustand state management
  components/
    BotManager.jsx            Master controls + bot grid
    BotCard.jsx               Individual bot display
    BotCreateModal.jsx        Bot creation wizard
    MarketBrowser.jsx         Symbol search + browse
    DashboardPro.jsx          PnL dashboard + equity curve
    PositionsView.jsx         Live position monitoring
    TradeHistory.jsx          Paginated trade log
    TradingPanel.jsx          Manual trading interface
    Layout.jsx                Navigation shell
```

## Risk Management

- Max daily loss limit (USDT)
- Max global drawdown (%)
- Max concurrent positions
- Max position size per trade
- Max leverage enforcement
- Cooldown after consecutive losses
- Cooldown after liquidation
- **Kill switch** — auto-stops all bots on threshold breach

## License

Private — not for redistribution.
