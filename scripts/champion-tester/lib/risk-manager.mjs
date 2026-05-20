import { EventEmitter } from 'node:events';
import { getTradeDB } from './trade-db.mjs';

/**
 * RiskManager — centralized risk enforcement.
 * All orders pass through here before execution.
 * Enforces global limits across all bots + per-bot limits.
 */
class RiskManager extends EventEmitter {
  constructor() {
    super();
    this._limits = {
      maxDailyLossUSDT: 100,
      maxGlobalDrawdownPct: 15,
      maxConcurrentPositions: 10,
      maxPositionSizeUSDT: 500,
      maxLeverage: 50,
      maxDailyTrades: 50,
      cooldownAfterLossMs: 30000,
      cooldownAfterLiquidationMs: 300000,
      killSwitchDrawdownPct: 20,
    };
    this._state = {
      dailyPnl: 0,
      dailyTrades: 0,
      dailyLosses: 0,
      peakEquity: 0,
      currentEquity: 0,
      openPositions: 0,
      lastLossTime: 0,
      lastLiquidationTime: 0,
      killSwitchActive: false,
      killSwitchReason: null,
      date: null,
    };
  }

  // ─── Configuration ──────────────────────────────────────────────

  updateLimits(newLimits) {
    this._limits = { ...this._limits, ...newLimits };
    this.emit('limits:updated', this._limits);
  }

  getLimits() {
    return { ...this._limits };
  }

  // ─── Order Check ────────────────────────────────────────────────

  /**
   * Check if an order is allowed by risk rules.
   * @returns {{ allowed: boolean, violations: string[] }}
   */
  checkOrder(order, botId = null) {
    this._resetDailyIfNeeded();
    const violations = [];

    // Kill switch
    if (this._state.killSwitchActive) {
      violations.push(`Kill switch active: ${this._state.killSwitchReason}`);
      return { allowed: false, violations };
    }

    // Max daily trades
    if (this._state.dailyTrades >= this._limits.maxDailyTrades) {
      violations.push(`Daily trade limit reached (${this._limits.maxDailyTrades})`);
    }

    // Max daily loss
    if (this._state.dailyPnl < 0 && Math.abs(this._state.dailyPnl) >= this._limits.maxDailyLossUSDT) {
      violations.push(`Daily loss limit reached ($${this._limits.maxDailyLossUSDT})`);
    }

    // Max position size
    const sizeUSDT = (order.quantity || 0) * (order.price || 0);
    if (sizeUSDT > this._limits.maxPositionSizeUSDT) {
      violations.push(`Position size $${sizeUSDT.toFixed(2)} exceeds max $${this._limits.maxPositionSizeUSDT}`);
    }

    // Max concurrent positions
    if (order.side === 'BUY' && this._state.openPositions >= this._limits.maxConcurrentPositions) {
      violations.push(`Max concurrent positions reached (${this._limits.maxConcurrentPositions})`);
    }

    // Leverage check
    if (order.leverage && order.leverage > this._limits.maxLeverage) {
      violations.push(`Leverage ${order.leverage}x exceeds max ${this._limits.maxLeverage}x`);
    }

    // Cooldown after loss
    if (this._state.lastLossTime > 0) {
      const elapsed = Date.now() - this._state.lastLossTime;
      if (elapsed < this._limits.cooldownAfterLossMs) {
        const remaining = Math.ceil((this._limits.cooldownAfterLossMs - elapsed) / 1000);
        violations.push(`Loss cooldown active (${remaining}s remaining)`);
      }
    }

    // Cooldown after liquidation
    if (this._state.lastLiquidationTime > 0) {
      const elapsed = Date.now() - this._state.lastLiquidationTime;
      if (elapsed < this._limits.cooldownAfterLiquidationMs) {
        const remaining = Math.ceil((this._limits.cooldownAfterLiquidationMs - elapsed) / 1000);
        violations.push(`Liquidation cooldown active (${remaining}s remaining)`);
      }
    }

    // Global drawdown check
    if (this._state.peakEquity > 0 && this._state.currentEquity > 0) {
      const drawdownPct = ((this._state.peakEquity - this._state.currentEquity) / this._state.peakEquity) * 100;
      if (drawdownPct >= this._limits.maxGlobalDrawdownPct) {
        violations.push(`Global drawdown ${drawdownPct.toFixed(1)}% exceeds max ${this._limits.maxGlobalDrawdownPct}%`);
      }
    }

    const allowed = violations.length === 0;

    if (!allowed) {
      this._logRiskEvent('order_rejected', botId, { order, violations });
      this.emit('risk:violation', { botId, order, violations });
    }

    return { allowed, violations };
  }

  // ─── State Updates ──────────────────────────────────────────────

  registerTrade(trade) {
    this._resetDailyIfNeeded();
    this._state.dailyTrades++;

    if (trade.side === 'BUY' || trade.action === 'OPEN') {
      this._state.openPositions++;
    }
  }

  registerPnL(pnl, botId = null) {
    this._resetDailyIfNeeded();
    this._state.dailyPnl += pnl;

    if (pnl < 0) {
      this._state.dailyLosses++;
      this._state.lastLossTime = Date.now();
    }

    // Update equity tracking
    if (this._state.currentEquity > 0) {
      this._state.currentEquity += pnl;
      if (this._state.currentEquity > this._state.peakEquity) {
        this._state.peakEquity = this._state.currentEquity;
      }
    }

    // Check kill switch
    if (this._state.peakEquity > 0) {
      const drawdownPct = ((this._state.peakEquity - this._state.currentEquity) / this._state.peakEquity) * 100;
      if (drawdownPct >= this._limits.killSwitchDrawdownPct) {
        this.activateKillSwitch(`Drawdown ${drawdownPct.toFixed(1)}% exceeded kill threshold ${this._limits.killSwitchDrawdownPct}%`);
      }
    }

    this.emit('pnl:update', { pnl, dailyPnl: this._state.dailyPnl, botId });
  }

  registerPositionClose() {
    if (this._state.openPositions > 0) this._state.openPositions--;
  }

  registerLiquidation(botId = null) {
    this._state.lastLiquidationTime = Date.now();
    this._logRiskEvent('liquidation', botId, { timestamp: Date.now() });
    this.emit('risk:liquidation', { botId });
  }

  setEquity(equity) {
    this._state.currentEquity = equity;
    if (equity > this._state.peakEquity) {
      this._state.peakEquity = equity;
    }
  }

  // ─── Kill Switch ────────────────────────────────────────────────

  activateKillSwitch(reason) {
    this._state.killSwitchActive = true;
    this._state.killSwitchReason = reason;
    this._logRiskEvent('kill_switch_activated', null, { reason });
    this.emit('risk:killSwitch', { active: true, reason });
  }

  deactivateKillSwitch() {
    this._state.killSwitchActive = false;
    this._state.killSwitchReason = null;
    this._logRiskEvent('kill_switch_deactivated', null, {});
    this.emit('risk:killSwitch', { active: false });
  }

  isKillSwitchActive() {
    return this._state.killSwitchActive;
  }

  // ─── Status ─────────────────────────────────────────────────────

  getStatus() {
    this._resetDailyIfNeeded();
    const drawdownPct = this._state.peakEquity > 0
      ? ((this._state.peakEquity - this._state.currentEquity) / this._state.peakEquity * 100)
      : 0;

    return {
      limits: this._limits,
      state: { ...this._state },
      drawdownPct: drawdownPct.toFixed(2),
      riskLevel: this._getRiskLevel(drawdownPct),
    };
  }

  getDailyReport() {
    this._resetDailyIfNeeded();
    return {
      date: this._state.date,
      trades: this._state.dailyTrades,
      pnl: this._state.dailyPnl,
      losses: this._state.dailyLosses,
      openPositions: this._state.openPositions,
      killSwitchActive: this._state.killSwitchActive,
    };
  }

  _getRiskLevel(drawdownPct) {
    if (this._state.killSwitchActive) return 'critical';
    if (drawdownPct >= this._limits.maxGlobalDrawdownPct * 0.8) return 'high';
    if (drawdownPct >= this._limits.maxGlobalDrawdownPct * 0.5) return 'medium';
    return 'low';
  }

  // ─── Internal ───────────────────────────────────────────────────

  _resetDailyIfNeeded() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._state.date !== today) {
      // Save yesterday's stats before reset
      if (this._state.date && this._state.dailyTrades > 0) {
        this._saveDailyStats();
      }
      this._state.dailyPnl = 0;
      this._state.dailyTrades = 0;
      this._state.dailyLosses = 0;
      this._state.date = today;
    }
  }

  _saveDailyStats() {
    try {
      const db = getTradeDB();
      db.upsertDailyStats(this._state.date, {
        totalTrades: this._state.dailyTrades,
        winningTrades: this._state.dailyTrades - this._state.dailyLosses,
        losingTrades: this._state.dailyLosses,
        grossPnl: this._state.dailyPnl,
        fees: 0,
        netPnl: this._state.dailyPnl,
        maxDrawdown: 0,
        peakEquity: this._state.peakEquity,
        endEquity: this._state.currentEquity,
      });
    } catch { /* DB may not be initialized yet */ }
  }

  _logRiskEvent(type, botId, details) {
    try {
      const db = getTradeDB();
      db.logRiskEvent(type, botId, details);
    } catch { /* ignore */ }
    this.emit('risk:event', { type, botId, details });
  }
}

// Singleton
let _rm = null;
export function getRiskManager() {
  if (!_rm) _rm = new RiskManager();
  return _rm;
}

export { RiskManager };
