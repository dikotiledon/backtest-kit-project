import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '..', 'data', 'logs');
const RETENTION_DAYS = 14;
const LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_INDEX = Object.fromEntries(LEVELS.map((l, i) => [l, i]));

class Logger {
  constructor(opts = {}) {
    this.minLevel = LEVEL_INDEX[opts.minLevel || 'debug'] ?? 0;
    this._stream = null;
    this._currentDate = null;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  _getDateStr() {
    return new Date().toISOString().slice(0, 10);
  }

  _getStream() {
    const dateStr = this._getDateStr();
    if (this._currentDate !== dateStr) {
      if (this._stream) {
        this._stream.end();
      }
      this._currentDate = dateStr;
      const logFile = path.join(LOG_DIR, `crypto-trader-${dateStr}.log`);
      this._stream = fs.createWriteStream(logFile, { flags: 'a' });
    }
    return this._stream;
  }

  _write(level, msg, meta = {}) {
    if (LEVEL_INDEX[level] < this.minLevel) return;

    const entry = { ts: new Date().toISOString(), level, msg, ...meta };
    const line = JSON.stringify(entry);

    // Write to file
    try {
      const stream = this._getStream();
      stream.write(line + '\n');
    } catch {
      // Fallback: don't crash if file write fails
    }

    // Console output
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    const prefix = level === 'error' || level === 'fatal' ? '❌' :
                   level === 'warn' ? '⚠️' :
                   level === 'debug' ? '🔍' : '📡';
    console.log(`[${entry.ts}] [${level}] ${prefix} ${msg}${metaStr}`);
  }

  debug(msg, meta) { this._write('debug', msg, meta); }
  info(msg, meta) { this._write('info', msg, meta); }
  warn(msg, meta) { this._write('warn', msg, meta); }
  error(msg, meta) { this._write('error', msg, meta); }
  fatal(msg, meta) { this._write('fatal', msg, meta); }

  /**
   * Remove log files older than RETENTION_DAYS.
   */
  pruneOldLogs() {
    try {
      const files = fs.readdirSync(LOG_DIR);
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

      for (const file of files) {
        if (!file.startsWith('crypto-trader-') || !file.endsWith('.log')) continue;
        const dateStr = file.replace('crypto-trader-', '').replace('.log', '');
        const fileDate = new Date(dateStr).getTime();
        if (isNaN(fileDate)) continue;
        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(LOG_DIR, file));
        }
      }
    } catch {
      // Best-effort cleanup
    }
  }

  close() {
    if (this._stream) {
      this._stream.end();
      this._stream = null;
    }
  }
}

// Singleton
const logger = new Logger();

// Prune old logs on import
logger.pruneOldLogs();

export { logger, Logger };
export default logger;
