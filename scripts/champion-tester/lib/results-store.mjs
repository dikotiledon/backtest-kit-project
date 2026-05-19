import fs from 'node:fs/promises';
import path from 'node:path';
import { compactMetricEntry, normalizeResult } from './metric-normalizer.mjs';

/**
 * ResultsStore with in-memory index backed by _index.json.
 *
 * The index maps runId → metadata (filename, timestamp, symbol, timeframe,
 * key metrics). This eliminates linear file scans for list/get/delete.
 *
 * On first load, if _index.json is missing or corrupt, the store rebuilds
 * the index by scanning all result files once. After that, save/delete
 * keep the index in sync incrementally.
 */
export class ResultsStore {
  constructor(resultsDir) {
    this.resultsDir = resultsDir;
    this._index = null; // Map<runId, IndexEntry>
    this._indexPath = path.join(resultsDir, '_index.json');
    this._initPromise = null;
    this._persistTimer = null;
  }

  /**
   * Ensure the results directory exists and the index is loaded.
   * Deduplicates concurrent init calls. Resets on failure so retries work.
   */
  async init() {
    if (this._index !== null) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit().catch(err => {
      this._initPromise = null;
      throw err;
    });
    return this._initPromise;
  }

  async _doInit() {
    await fs.mkdir(this.resultsDir, { recursive: true });

    // Try loading existing index
    try {
      const raw = await fs.readFile(this._indexPath, 'utf8');
      const entries = JSON.parse(raw);
      if (Array.isArray(entries)) {
        this._index = new Map(entries.map(e => [e.runId, e]));
        // Validate index isn't stale: quick check file count
        const files = await fs.readdir(this.resultsDir);
        const jsonCount = files.filter(f => f.endsWith('.json') && f !== '_index.json').length;
        if (Math.abs(jsonCount - this._index.size) > 5) {
          // Index is significantly out of sync, rebuild
          this._index = null;
        } else {
          return;
        }
      }
    } catch {
      // Index doesn't exist or is corrupt — rebuild
    }

    await this._rebuildIndex();
  }

  /**
   * Full rebuild: scan all result files and create the index from scratch.
   * Only runs on first startup if _index.json is missing/corrupt.
   */
  async _rebuildIndex() {
    this._index = new Map();
    const files = await fs.readdir(this.resultsDir);

    for (const file of files) {
      if (!file.endsWith('.json') || file === '_index.json') continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (result.runId) {
          this._index.set(result.runId, this._toIndexEntry(result, file));
        }
      } catch { /* skip malformed files */ }
    }

    await this._persistIndex();
  }

  /**
   * Extract lightweight index entry from a full result object.
   */
  _toIndexEntry(result, filename) {
    const normalized = normalizeResult(result);
    const metrics = compactMetricEntry(normalized.metrics);
    return {
      runId: normalized.runId,
      filename,
      timestamp: normalized.timestamp,
      ok: normalized.ok,
      symbol: normalized.dataset?.symbol ?? null,
      exchange: normalized.dataset?.exchange ?? null,
      timeframe: normalized.dataset?.timeframe ?? null,
      tvSymbol: normalized.dataset?.tvSymbol ?? null,
      matrixId: normalized.champion?.matrixId ?? null,
      score: normalized.score ?? null,
      durationMs: normalized.durationMs ?? null,
      // Key metrics for list display without reading full file
      ...metrics,
    };
  }

  /**
   * Persist the index to disk. Best-effort — failures are non-fatal.
   */
  async _persistIndex() {
    try {
      const entries = [...this._index.values()];
      await fs.writeFile(this._indexPath, JSON.stringify(entries), 'utf8');
    } catch { /* best effort */ }
  }

  _filename(result) {
    const ts = result.timestamp.replace(/[:.]/g, '-');
    return `${ts}_${result.dataset.symbol}_${result.dataset.timeframe}.json`;
  }

  /**
   * Save a result and update the index.
   */
  async save(result) {
    await this.init();
    const normalized = normalizeResult(result);
    const filename = this._filename(normalized);
    const filePath = path.join(this.resultsDir, filename);
    await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf8');

    // Update index
    this._index.set(normalized.runId, this._toIndexEntry(normalized, filename));
    await this._persistIndex();

    return { filename, filePath };
  }

  /**
   * List results using the in-memory index.
   * For basic listing (dashboard, results table), returns index entries
   * which contain all the metrics needed for display.
   * Only reads full files if the caller needs trade data or equity curves.
   */
  async list({ symbol, timeframe, limit = 50, sort = 'timestamp', order = 'desc' } = {}) {
    await this.init();

    let entries = [...this._index.values()];

    // Filter
    if (symbol) entries = entries.filter(e => e.symbol === symbol);
    if (timeframe) entries = entries.filter(e => e.timeframe === timeframe);

    // Sort
    entries.sort((a, b) => {
      let aVal, bVal;
      if (sort === 'timestamp') {
        aVal = a.timestamp || '';
        bVal = b.timestamp || '';
      } else {
        // Sort by metric field (netProfit, winRate, etc.)
        aVal = a[sort] ?? 0;
        bVal = b[sort] ?? 0;
      }
      if (order === 'desc') return aVal > bVal ? -1 : 1;
      return aVal < bVal ? -1 : 1;
    });

    const total = entries.length;
    const sliced = entries.slice(0, limit);

    // Hydrate sliced entries with full result data (trades, equity, breakdown)
    const results = await Promise.all(
      sliced.map(async (entry) => {
        try {
          const raw = await fs.readFile(
            path.join(this.resultsDir, entry.filename), 'utf8'
          );
          return normalizeResult(JSON.parse(raw));
        } catch {
          // File missing or corrupt — return index entry as fallback
          return {
            runId: entry.runId,
            timestamp: entry.timestamp,
            ok: entry.ok,
            dataset: { symbol: entry.symbol, exchange: entry.exchange, timeframe: entry.timeframe, tvSymbol: entry.tvSymbol },
            champion: { matrixId: entry.matrixId },
            score: entry.score,
            durationMs: entry.durationMs,
            metrics: {
              netProfit: entry.netProfit,
              winRate: entry.winRate,
              totalTrades: entry.totalTrades,
              maxDrawdown: entry.maxDrawdown,
              profitFactor: entry.profitFactor,
              sharpeRatio: entry.sharpeRatio,
            },
            trades: [],
            equityCurve: [],
          };
        }
      })
    );

    return { total, results };
  }

  /**
   * Get a single result by runId — O(1) index lookup + single file read.
   */
  async get(runId) {
    await this.init();

    const entry = this._index.get(runId);
    if (!entry) return null;

    try {
      const raw = await fs.readFile(
        path.join(this.resultsDir, entry.filename), 'utf8'
      );
      return normalizeResult(JSON.parse(raw));
    } catch {
      // File was deleted externally — clean up index
      this._index.delete(runId);
      await this._persistIndex();
      return null;
    }
  }

  /**
   * Delete a result by runId — O(1) index lookup + single file unlink.
   */
  async delete(runId) {
    await this.init();

    const entry = this._index.get(runId);
    if (!entry) return false;

    try {
      await fs.unlink(path.join(this.resultsDir, entry.filename));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // File already gone — still remove from index
    }

    this._index.delete(runId);
    await this._persistIndex();
    return true;
  }
}
