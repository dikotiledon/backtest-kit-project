import { EventEmitter } from 'node:events';
import { getTradeDB } from './trade-db.mjs';
import logger from './logger.mjs';

const ALERT_TYPES = [
  'kill_switch',
  'signal_executed',
  'signal_rejected',
  'bot_error',
  'connection_lost',
  'daily_report',
];

/**
 * Alerter — event-driven alert system with pluggable notification channels.
 */
class Alerter extends EventEmitter {
  constructor() {
    super();
    this._channels = new Map();

    // Built-in console channel (always active)
    this.addChannel('console', (type, message, metadata) => {
      const prefix = type === 'kill_switch' ? '🚨' :
                     type === 'bot_error' ? '❌' :
                     type === 'signal_executed' ? '✅' :
                     type === 'signal_rejected' ? '🚫' :
                     type === 'connection_lost' ? '📡' : '📋';
      logger.warn(`[ALERT:${type}] ${prefix} ${message}`, metadata || {});
    });

    // Stub: telegram channel
    this.addChannel('telegram', (type, message, _metadata) => {
      logger.debug(`[telegram-stub] would send to telegram: [${type}] ${message}`);
    });

    // Stub: discord channel
    this.addChannel('discord', (type, message, _metadata) => {
      logger.debug(`[discord-stub] would send to discord: [${type}] ${message}`);
    });
  }

  /**
   * Register a notification channel.
   * @param {string} name
   * @param {(type: string, message: string, metadata: object) => void} sendFn
   */
  addChannel(name, sendFn) {
    this._channels.set(name, sendFn);
  }

  /**
   * Remove a notification channel.
   * @param {string} name
   */
  removeChannel(name) {
    this._channels.delete(name);
  }

  /**
   * Send an alert to all registered channels and persist to DB.
   * @param {string} type - One of ALERT_TYPES
   * @param {string} message
   * @param {object} [metadata]
   */
  sendAlert(type, message, metadata = {}) {
    // Persist to DB
    try {
      const db = getTradeDB();
      db.db.prepare(`
        INSERT INTO alerts (type, message, metadata, created_at)
        VALUES (?, ?, ?, ?)
      `).run(type, message, JSON.stringify(metadata), new Date().toISOString());
    } catch (err) {
      logger.error('Failed to persist alert', { error: err.message, type });
    }

    // Route to all channels
    for (const [name, sendFn] of this._channels) {
      try {
        sendFn(type, message, metadata);
      } catch (err) {
        logger.error(`Alert channel "${name}" failed`, { error: err.message });
      }
    }

    // Emit event for programmatic listeners
    this.emit('alert', { type, message, metadata });
  }

  /**
   * Get recent alerts from DB.
   */
  getAlerts(limit = 50, type = null) {
    const db = getTradeDB();
    let sql = 'SELECT * FROM alerts';
    const params = [];
    if (type) { sql += ' WHERE type = ?'; params.push(type); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    return db.db.prepare(sql).all(...params).map(r => ({
      ...r,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
  }

  /**
   * Acknowledge an alert.
   */
  acknowledgeAlert(id) {
    const db = getTradeDB();
    return db.db.prepare(
      'UPDATE alerts SET acknowledged_at = ? WHERE id = ?'
    ).run(new Date().toISOString(), id).changes > 0;
  }
}

// Singleton
let _alerter = null;
export function getAlerter() {
  if (!_alerter) _alerter = new Alerter();
  return _alerter;
}

export { Alerter, ALERT_TYPES };
