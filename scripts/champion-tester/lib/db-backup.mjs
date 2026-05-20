import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '..', 'data', 'trades.db');
const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '..', 'data', 'backups');
const MAX_BACKUPS = 7;

/**
 * Backup the SQLite database using better-sqlite3's .backup() API.
 * @param {string} [destDir] - Directory to store backups
 * @param {string} [dbPath] - Source database path
 * @returns {Promise<{ok: boolean, path: string}>}
 */
export async function backupDatabase(destDir = DEFAULT_BACKUP_DIR, dbPath = DEFAULT_DB_PATH) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const backupFile = path.join(destDir, `trades_${timestamp}.db`);

  // Use better-sqlite3 backup API
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath, { readonly: true });

  try {
    await db.backup(backupFile);
    logger.info('Database backup created', { path: backupFile });
  } finally {
    db.close();
  }

  // Prune old backups
  pruneBackups(destDir);

  return { ok: true, path: backupFile };
}

/**
 * Keep only the last MAX_BACKUPS files, delete older ones.
 */
function pruneBackups(destDir) {
  try {
    const files = fs.readdirSync(destDir)
      .filter(f => f.startsWith('trades_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(destDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    for (let i = MAX_BACKUPS; i < files.length; i++) {
      fs.unlinkSync(path.join(destDir, files[i].name));
      logger.info('Old backup removed', { file: files[i].name });
    }
  } catch (err) {
    logger.warn('Backup prune failed', { error: err.message });
  }
}

/**
 * Schedule periodic backups.
 * @param {number} [intervalMs] - Interval between backups (default: 6 hours)
 * @returns {{ stop: () => void }}
 */
export function scheduleBackups(intervalMs = 6 * 60 * 60 * 1000) {
  const run = () => {
    backupDatabase().catch(err => {
      logger.error('Scheduled backup failed', { error: err.message });
    });
  };

  // Run first backup after a short delay (don't block startup)
  const initialTimeout = setTimeout(run, 30_000);
  const interval = setInterval(run, intervalMs);

  return {
    stop() {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    },
  };
}
