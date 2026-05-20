import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './db-migrations.mjs';
import logger from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'trades.db');

/**
 * TradeDB — SQLite persistence for trades, daily stats, bots, and risk events.
 */
class TradeDB {
  constructor(dbPath = DEFAULT_DB_PATH) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    // Run migration system (replaces inline CREATE TABLE)
    runMigrations(this.db);

    // Prune old data on startup
    this.pruneOldData();
  }

  // ─── Data Retention ─────────────────────────────────────────────

  /**
   * Delete old risk_events and daily_stats beyond retention window.
   * Trades are permanent records and never pruned.
   * @param {number} [retentionDays=90] - Days to keep risk_events
   */
  pruneOldData(retentionDays = 90) {
    const riskCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const statsCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const riskDeleted = this.db.prepare(
      'DELETE FROM risk_events WHERE created_at < ?'
    ).run(riskCutoff).changes;

    const statsDeleted = this.db.prepare(
      'DELETE FROM daily_stats WHERE date < ?'
    ).run(statsCutoff).changes;

    if (riskDeleted > 0 || statsDeleted > 0) {
      logger.info('Data retention prune complete', { riskDeleted, statsDeleted });
    }
  }

  /**
   * Run VACUUM to reclaim space after prune.
   */
  vacuum() {
    this.db.exec('VACUUM');
    logger.info('Database VACUUM complete');
  }

  // ─── Trades ─────────────────────────────────────────────────────

  insertTrade(trade) {
    const stmt = this.db.prepare(`
      INSERT INTO trades (id, bot_id, symbol, market, side, type, quantity, price,
        avg_fill_price, status, pnl, fees, strategy, signal_reason,
        order_id, binance_order_id, created_at, filled_at, closed_at, paper)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      trade.id, trade.botId || null, trade.symbol, trade.market,
      trade.side, trade.type, trade.quantity, trade.price || null,
      trade.avgFillPrice || null, trade.status || 'FILLED',
      trade.pnl || null, trade.fees || 0,
      trade.strategy || null, trade.signalReason || null,
      trade.orderId || null, trade.binanceOrderId || null,
      trade.createdAt || new Date().toISOString(),
      trade.filledAt || null, trade.closedAt || null,
      trade.paper ? 1 : 0
    );
  }

  getTrades(opts = {}) {
    const { symbol, market, botId, limit = 50, offset = 0, startDate, endDate } = opts;
    let sql = 'SELECT * FROM trades WHERE 1=1';
    const params = [];

    if (symbol) { sql += ' AND symbol = ?'; params.push(symbol); }
    if (market) { sql += ' AND market = ?'; params.push(market); }
    if (botId) { sql += ' AND bot_id = ?'; params.push(botId); }
    if (startDate) { sql += ' AND created_at >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND created_at <= ?'; params.push(endDate); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params);
  }

  getTradeCount(opts = {}) {
    const { symbol, market, botId } = opts;
    let sql = 'SELECT COUNT(*) as count FROM trades WHERE 1=1';
    const params = [];
    if (symbol) { sql += ' AND symbol = ?'; params.push(symbol); }
    if (market) { sql += ' AND market = ?'; params.push(market); }
    if (botId) { sql += ' AND bot_id = ?'; params.push(botId); }
    return this.db.prepare(sql).get(...params).count;
  }

  // ─── Daily Stats ────────────────────────────────────────────────

  upsertDailyStats(date, stats) {
    const stmt = this.db.prepare(`
      INSERT INTO daily_stats (date, total_trades, winning_trades, losing_trades,
        gross_pnl, fees, net_pnl, max_drawdown, peak_equity, end_equity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        total_trades = excluded.total_trades,
        winning_trades = excluded.winning_trades,
        losing_trades = excluded.losing_trades,
        gross_pnl = excluded.gross_pnl,
        fees = excluded.fees,
        net_pnl = excluded.net_pnl,
        max_drawdown = excluded.max_drawdown,
        peak_equity = excluded.peak_equity,
        end_equity = excluded.end_equity
    `);
    stmt.run(date, stats.totalTrades || 0, stats.winningTrades || 0,
      stats.losingTrades || 0, stats.grossPnl || 0, stats.fees || 0,
      stats.netPnl || 0, stats.maxDrawdown || 0,
      stats.peakEquity || 0, stats.endEquity || 0);
  }

  getDailyStats(startDate, endDate, limit = 30) {
    let sql = 'SELECT * FROM daily_stats WHERE 1=1';
    const params = [];
    if (startDate) { sql += ' AND date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND date <= ?'; params.push(endDate); }
    sql += ' ORDER BY date DESC LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  // ─── Bots ──────────────────────────────────────────────────────

  saveBot(id, config, state = null, stats = null) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO bots (id, config, state, stats, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        config = excluded.config,
        state = excluded.state,
        stats = excluded.stats,
        updated_at = excluded.updated_at
    `);
    stmt.run(id, JSON.stringify(config), state ? JSON.stringify(state) : null,
      stats ? JSON.stringify(stats) : null, now, now);
  }

  getBot(id) {
    const row = this.db.prepare('SELECT * FROM bots WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      config: JSON.parse(row.config),
      state: row.state ? JSON.parse(row.state) : null,
      stats: row.stats ? JSON.parse(row.stats) : null,
    };
  }

  getAllBots() {
    return this.db.prepare('SELECT * FROM bots ORDER BY updated_at DESC').all()
      .map(row => ({
        ...row,
        config: JSON.parse(row.config),
        state: row.state ? JSON.parse(row.state) : null,
        stats: row.stats ? JSON.parse(row.stats) : null,
      }));
  }

  deleteBot(id) {
    return this.db.prepare('DELETE FROM bots WHERE id = ?').run(id).changes > 0;
  }

  // ─── Risk Events ───────────────────────────────────────────────

  logRiskEvent(type, botId, details) {
    this.db.prepare(`
      INSERT INTO risk_events (type, bot_id, details, created_at)
      VALUES (?, ?, ?, ?)
    `).run(type, botId || null, JSON.stringify(details), new Date().toISOString());
  }

  getRiskEvents(limit = 50, botId = null) {
    let sql = 'SELECT * FROM risk_events';
    const params = [];
    if (botId) { sql += ' WHERE bot_id = ?'; params.push(botId); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params);
    return rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  }

  // ─── Analytics ──────────────────────────────────────────────────

  getSummary(botId = null) {
    let where = '';
    const params = [];
    if (botId) { where = ' WHERE bot_id = ?'; params.push(botId); }

    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winning,
        SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losing,
        SUM(CASE WHEN pnl = 0 OR pnl IS NULL THEN 1 ELSE 0 END) as breakeven,
        COALESCE(SUM(pnl), 0) as total_pnl,
        COALESCE(SUM(fees), 0) as total_fees,
        COALESCE(AVG(pnl), 0) as avg_pnl,
        COALESCE(MAX(pnl), 0) as best_trade,
        COALESCE(MIN(pnl), 0) as worst_trade
      FROM trades${where}
    `).get(...params);

    return {
      totalTrades: row.total_trades,
      winning: row.winning || 0,
      losing: row.losing || 0,
      breakeven: row.breakeven || 0,
      winRate: row.total_trades > 0 ? ((row.winning || 0) / row.total_trades * 100).toFixed(1) : '0.0',
      totalPnl: row.total_pnl,
      totalFees: row.total_fees,
      netPnl: row.total_pnl - row.total_fees,
      avgPnl: row.avg_pnl,
      bestTrade: row.best_trade,
      worstTrade: row.worst_trade,
    };
  }

  getEquityCurve(days = 30) {
    return this.db.prepare(`
      SELECT date, end_equity, net_pnl, max_drawdown
      FROM daily_stats
      ORDER BY date DESC LIMIT ?
    `).all(days).reverse();
  }

  // ─── Cleanup ────────────────────────────────────────────────────

  close() {
    this.db.close();
  }
}

// Singleton
let _db = null;
export function getTradeDB() {
  if (!_db) _db = new TradeDB();
  return _db;
}

export function resetTradeDB() {
  if (_db) { _db.close(); _db = null; }
}

export { TradeDB };
