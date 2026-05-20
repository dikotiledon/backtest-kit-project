/**
 * Database migration system for SQLite.
 * Maintains a `migrations` table; runs unapplied migrations in order on startup.
 */

const migrations = [
  {
    version: 1,
    description: 'Initial schema: trades, daily_stats, bots, risk_events',
    up(db) {
      // No-op if tables already exist (backward compat)
      db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
          id TEXT PRIMARY KEY,
          bot_id TEXT,
          symbol TEXT NOT NULL,
          market TEXT NOT NULL,
          side TEXT NOT NULL,
          type TEXT NOT NULL,
          quantity REAL NOT NULL,
          price REAL,
          avg_fill_price REAL,
          status TEXT NOT NULL DEFAULT 'FILLED',
          pnl REAL,
          fees REAL DEFAULT 0,
          strategy TEXT,
          signal_reason TEXT,
          order_id TEXT,
          binance_order_id TEXT,
          created_at TEXT NOT NULL,
          filled_at TEXT,
          closed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
        CREATE INDEX IF NOT EXISTS idx_trades_bot ON trades(bot_id);
        CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
        CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market);

        CREATE TABLE IF NOT EXISTS daily_stats (
          date TEXT PRIMARY KEY,
          total_trades INTEGER DEFAULT 0,
          winning_trades INTEGER DEFAULT 0,
          losing_trades INTEGER DEFAULT 0,
          gross_pnl REAL DEFAULT 0,
          fees REAL DEFAULT 0,
          net_pnl REAL DEFAULT 0,
          max_drawdown REAL DEFAULT 0,
          peak_equity REAL DEFAULT 0,
          end_equity REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS bots (
          id TEXT PRIMARY KEY,
          config TEXT NOT NULL,
          state TEXT,
          stats TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS risk_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          bot_id TEXT,
          details TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_risk_created ON risk_events(created_at);
      `);
    },
  },
  {
    version: 2,
    description: 'Add composite index on trades(symbol, created_at)',
    up(db) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_symbol_created ON trades(symbol, created_at);`);
    },
  },
  {
    version: 3,
    description: 'Add paper column to trades table',
    up(db) {
      // Check if column already exists (idempotent)
      const cols = db.prepare(`PRAGMA table_info(trades)`).all();
      if (!cols.find(c => c.name === 'paper')) {
        db.exec(`ALTER TABLE trades ADD COLUMN paper INTEGER NOT NULL DEFAULT 0;`);
      }
    },
  },
  {
    version: 4,
    description: 'Add alerts table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT NOT NULL,
          acknowledged_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
        CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
      `);
    },
  },
];

/**
 * Run all pending migrations on the given better-sqlite3 database instance.
 * @param {import('better-sqlite3').Database} db
 */
export function runMigrations(db) {
  // Ensure migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at TEXT NOT NULL
    );
  `);

  // Determine already-applied versions
  const applied = new Set(
    db.prepare('SELECT version FROM migrations').all().map(r => r.version)
  );

  // If tables exist but no migrations recorded, mark v1 as applied (backward compat)
  if (applied.size === 0) {
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='trades'`
    ).get();
    if (tables) {
      // Schema already exists from before migration system — mark v1 done
      db.prepare(
        `INSERT INTO migrations (version, description, applied_at) VALUES (?, ?, ?)`
      ).run(1, migrations[0].description, new Date().toISOString());
      applied.add(1);
    }
  }

  // Run unapplied migrations in order
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      m.up(db);
      db.prepare(
        `INSERT INTO migrations (version, description, applied_at) VALUES (?, ?, ?)`
      ).run(m.version, m.description, new Date().toISOString());
    })();
  }
}

export { migrations };
