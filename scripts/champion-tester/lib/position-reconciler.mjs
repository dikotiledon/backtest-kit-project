import { EventEmitter } from 'node:events';
import { getFuturesConnector } from './binance-futures-connector.mjs';
import { getConnector } from './binance-connector.mjs';
import { getBotManager } from './bot-manager.mjs';
import { loadConfig } from './binance-config.mjs';

/**
 * PositionReconciler — reconciles exchange positions with bot state.
 * On startup and periodically, queries Binance for open positions
 * and matches them to existing bots. Logs orphan positions.
 */
class PositionReconciler extends EventEmitter {
  constructor() {
    super();
    this._interval = null;
    this._reconcileIntervalMs = 60000; // 60s
    this._running = false;
    this._lastReconcileTime = 0;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  async start() {
    if (this._running) return { ok: true, already: true };
    this._running = true;

    // Initial reconciliation
    await this.reconcile();

    // Periodic reconciliation
    this._interval = setInterval(() => {
      this.reconcile().catch(err => {
        this.emit('error', { message: `Periodic reconcile failed: ${err.message}` });
      });
    }, this._reconcileIntervalMs);

    this.emit('started');
    return { ok: true };
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._running = false;
    this.emit('stopped');
    return { ok: true };
  }

  isRunning() {
    return this._running;
  }

  // ─── Core Reconciliation ────────────────────────────────────────

  async reconcile() {
    const results = {
      futures: { matched: 0, orphans: [], updated: 0 },
      spot: { matched: 0, orphans: [], updated: 0 },
      errors: [],
      timestamp: Date.now(),
    };

    const config = await loadConfig();
    if (!config?.apiKey) {
      this.emit('log', { level: 'warn', message: 'No API credentials — skipping reconciliation' });
      return results;
    }

    // Reconcile futures positions
    if (config.futures?.enabled) {
      const markets = config.futures.markets || ['usdm'];
      for (const market of markets) {
        try {
          const futuresResult = await this._reconcileFutures(market);
          results.futures.matched += futuresResult.matched;
          results.futures.orphans.push(...futuresResult.orphans);
          results.futures.updated += futuresResult.updated;
        } catch (err) {
          results.errors.push({ market, error: err.message });
          this.emit('error', { message: `Futures reconcile (${market}) failed: ${err.message}` });
        }
      }
    }

    // Reconcile spot positions
    try {
      const spotResult = await this._reconcileSpot();
      results.spot = spotResult;
    } catch (err) {
      results.errors.push({ market: 'spot', error: err.message });
      this.emit('error', { message: `Spot reconcile failed: ${err.message}` });
    }

    this._lastReconcileTime = Date.now();
    this.emit('reconciled', results);

    // Log orphans
    const allOrphans = [...results.futures.orphans, ...results.spot.orphans];
    if (allOrphans.length > 0) {
      this.emit('log', {
        level: 'warn',
        message: `Found ${allOrphans.length} orphan position(s) without matching bots`,
        orphans: allOrphans,
      });
    }

    return results;
  }

  // ─── Futures Reconciliation ─────────────────────────────────────

  async _reconcileFutures(market) {
    const fc = getFuturesConnector();
    if (!fc.isInitialized(market)) {
      return { matched: 0, orphans: [], updated: 0 };
    }

    // Query all positions with non-zero amount
    const positions = await fc.getPositions(market);
    const openPositions = (positions || []).filter(p => {
      const amt = parseFloat(p.positionAmt || '0');
      return amt !== 0;
    });

    const botMgr = getBotManager();
    const bots = [...botMgr.bots.values()];
    let matched = 0;
    let updated = 0;
    const orphans = [];

    for (const pos of openPositions) {
      const symbol = pos.symbol;
      const posAmt = parseFloat(pos.positionAmt);
      const entryPrice = parseFloat(pos.entryPrice || '0');
      const side = posAmt > 0 ? 'LONG' : 'SHORT';
      const leverage = parseInt(pos.leverage || '1', 10);

      // Find matching bot by symbol + market
      const matchingBot = bots.find(b =>
        b.config.symbol === symbol &&
        b.config.market === market
      );

      if (matchingBot) {
        matched++;
        // Check if bot position matches exchange
        const botPos = matchingBot.position;
        const exchangePos = {
          market,
          symbol,
          side,
          entryPrice,
          quantity: Math.abs(posAmt),
          leverage,
          unrealizedPnl: parseFloat(pos.unRealizedProfit || '0'),
          liquidationPrice: parseFloat(pos.liquidationPrice || '0'),
          marginType: pos.marginType,
          reconciled: true,
          reconciledAt: Date.now(),
        };

        // Update if different or missing
        if (!botPos || botPos.entryPrice !== entryPrice || botPos.quantity !== Math.abs(posAmt)) {
          matchingBot.setPosition(exchangePos);
          updated++;
          this.emit('log', {
            level: 'info',
            message: `Reconciled bot ${matchingBot.id}: ${symbol} ${side} qty=${Math.abs(posAmt)} @ ${entryPrice}`,
          });
        }
      } else {
        orphans.push({
          market,
          symbol,
          side,
          quantity: Math.abs(posAmt),
          entryPrice,
          leverage,
          unrealizedPnl: parseFloat(pos.unRealizedProfit || '0'),
          liquidationPrice: parseFloat(pos.liquidationPrice || '0'),
        });
      }
    }

    // Clear positions on bots that no longer have exchange positions
    for (const bot of bots) {
      if (bot.config.market !== market) continue;
      if (!bot.position) continue;
      const hasExchangePos = openPositions.some(p =>
        p.symbol === bot.config.symbol && parseFloat(p.positionAmt || '0') !== 0
      );
      if (!hasExchangePos && bot.position.reconciled) {
        this.emit('log', {
          level: 'info',
          message: `Position closed on exchange for bot ${bot.id} (${bot.config.symbol}) — clearing local state`,
        });
        bot.clearPosition();
        updated++;
      }
    }

    return { matched, orphans, updated };
  }

  // ─── Spot Reconciliation ────────────────────────────────────────

  async _reconcileSpot() {
    const connector = getConnector();
    if (!connector.isConnected()) {
      return { matched: 0, orphans: [], updated: 0 };
    }

    let balances;
    try {
      const accountInfo = await connector.getAccount();
      balances = (accountInfo.balances || []).filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0);
    } catch {
      return { matched: 0, orphans: [], updated: 0 };
    }

    const botMgr = getBotManager();
    const bots = [...botMgr.bots.values()].filter(b => b.config.market === 'spot');
    let matched = 0;
    let updated = 0;
    const orphans = [];

    // Stablecoins and base currencies to ignore
    const ignoredAssets = new Set(['USDT', 'BUSD', 'USDC', 'BNB', 'FDUSD']);

    for (const balance of balances) {
      const asset = balance.asset;
      if (ignoredAssets.has(asset)) continue;

      const totalQty = parseFloat(balance.free) + parseFloat(balance.locked);
      if (totalQty <= 0) continue;

      // Try to match to a bot (asset → symbol is typically ASSETUSDT)
      const possibleSymbol = `${asset}USDT`;
      const matchingBot = bots.find(b => b.config.symbol === possibleSymbol);

      if (matchingBot) {
        matched++;
        if (!matchingBot.position || matchingBot.position.quantity !== totalQty) {
          matchingBot.setPosition({
            market: 'spot',
            symbol: possibleSymbol,
            side: 'LONG',
            quantity: totalQty,
            entryPrice: matchingBot.position?.entryPrice || 0, // Can't determine from balance alone
            reconciled: true,
            reconciledAt: Date.now(),
          });
          updated++;
        }
      } else {
        orphans.push({
          market: 'spot',
          asset,
          symbol: possibleSymbol,
          quantity: totalQty,
          side: 'LONG',
        });
      }
    }

    return { matched, orphans, updated };
  }

  // ─── Status ─────────────────────────────────────────────────────

  getStatus() {
    return {
      running: this._running,
      lastReconcileTime: this._lastReconcileTime,
      intervalMs: this._reconcileIntervalMs,
    };
  }
}

// Singleton
let _instance = null;
export function getPositionReconciler() {
  if (!_instance) _instance = new PositionReconciler();
  return _instance;
}

export { PositionReconciler };
