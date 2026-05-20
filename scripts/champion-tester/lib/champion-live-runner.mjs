import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadChampion, getScriptPath } from './champion-loader.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * ChampionLiveRunner — runs the actual Pine Script on accumulated candles
 * to extract exact entry/exit signals matching the backtest.
 * 
 * This is the production-grade approach: instead of approximating the kNN ML model
 * in JavaScript, we run the real Pine Script and parse its output for signals.
 * 
 * Flow:
 * 1. Accumulate candles from Binance WS
 * 2. On each new closed kline, write candles to temp cache
 * 3. Run pine-import-run-clean on the accumulated data
 * 4. Parse the output JSONL for position state changes
 * 5. Emit entry/exit signals
 * 
 * Optimization: Only re-runs when a new kline closes (every 15m for the champion).
 * Keeps a rolling window of candles to avoid re-downloading.
 */
export class ChampionLiveRunner extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.matrixId = opts.matrixId;
    this.symbol = opts.symbol;
    this.timeframe = opts.timeframe || '15m';
    this.maxCandles = opts.maxCandles || 2000; // kNN needs up to 2000 bars
    this.candles = [];
    this.champion = null;
    this.patchedScript = null;
    this.lastPosition = 0; // 0 = flat, 1 = long, -1 = short
    this.lastSignal = null;
    this.running = false;
    this._runLock = false;
    this._tempDir = null;
  }

  async initialize() {
    this.champion = await loadChampion(this.matrixId);
    const scriptPath = getScriptPath(this.matrixId, PROJECT_ROOT);
    const source = await fs.readFile(scriptPath, 'utf8');
    this.patchedScript = this._applyConfig(source, this.champion.config);

    // Prepare temp directory
    this._tempDir = path.join(PROJECT_ROOT, 'pine', 'dump', 'live-runner', `${this.symbol}-${this.timeframe}`);
    await fs.mkdir(this._tempDir, { recursive: true });

    this.running = true;
    this.emit('initialized', { matrixId: this.matrixId, symbol: this.symbol });
  }

  /**
   * Feed a new closed kline. Triggers signal evaluation.
   * @param {object} kline - { open, high, low, close, volume, openTime, closeTime }
   * @returns {object|null} signal if state changed
   */
  async onKline(kline) {
    if (!this.running) return null;

    // Add to buffer
    this.candles.push({
      timestamp: kline.openTime || kline.closeTime - this._getStepMs(),
      open: kline.open,
      high: kline.high,
      low: kline.low,
      close: kline.close,
      volume: kline.volume,
    });

    // Trim to max
    if (this.candles.length > this.maxCandles) {
      this.candles = this.candles.slice(-this.maxCandles);
    }

    // Need minimum candles for the ML model
    if (this.candles.length < 100) return null;

    // Run the script and extract signal
    return this._evaluate();
  }

  /**
   * Seed historical candles (call before starting live feed).
   */
  seedCandles(candles) {
    this.candles = candles.slice(-this.maxCandles);
  }

  stop() {
    this.running = false;
    this.emit('stopped');
  }

  // ─── Internal ───────────────────────────────────────────────

  async _evaluate() {
    if (this._runLock) return null; // Skip if already running
    this._runLock = true;

    try {
      // Write candles to cache
      const cacheDir = path.join(this._tempDir, 'cache');
      await fs.mkdir(cacheDir, { recursive: true });

      const stepMs = this._getStepMs();
      // Write all candles
      for (const c of this.candles) {
        const aligned = Math.floor(c.timestamp / stepMs) * stepMs;
        const filePath = path.join(cacheDir, `${aligned}.json`);
        await fs.writeFile(filePath, JSON.stringify({ ...c, timestamp: aligned }));
      }

      // Write patched script
      const scriptPath = path.join(this._tempDir, 'live.pine');
      await fs.writeFile(scriptPath, this.patchedScript);

      // Compute "when" boundary
      const lastTs = this.candles[this.candles.length - 1].timestamp;
      const when = new Date(Math.floor(lastTs / stepMs) * stepMs + stepMs).toISOString();

      // Run pine-import-run-clean
      const cliScript = path.resolve(PROJECT_ROOT, 'scripts', 'pine-import-run-clean.mjs');
      const outputBase = 'live-signal';

      const result = await this._runScript([
        cliScript,
        '--input', scriptPath,
        '--symbol', this.symbol,
        '--timeframe', this.timeframe,
        '--limit', String(this.candles.length),
        '--when', when,
        '--cache-root', path.dirname(cacheDir),
        '--cache-exchange', 'live-runner',
        '--output', outputBase,
      ]);

      // Parse output for position state
      const cleanedPath = path.join(this._tempDir, 'dump', `${outputBase}.cleaned.jsonl`);
      const signal = await this._parseSignal(cleanedPath);

      // Cleanup output files
      try {
        const dumpDir = path.join(this._tempDir, 'dump');
        const files = await fs.readdir(dumpDir).catch(() => []);
        for (const f of files) await fs.unlink(path.join(dumpDir, f)).catch(() => {});
      } catch {}

      return signal;
    } catch (err) {
      this.emit('error', { error: err.message });
      return null;
    } finally {
      this._runLock = false;
    }
  }

  async _parseSignal(cleanedPath) {
    try {
      await fs.access(cleanedPath);
    } catch {
      return null; // No output
    }

    // Read last few lines to determine current position state
    const content = await fs.readFile(cleanedPath, 'utf8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    // Parse last row for position state
    const lastRow = JSON.parse(lines[lines.length - 1]);

    // The cleaned JSONL has simPos field (1 = long, -1 = short, 0 = flat)
    // Or we detect from startLongTrade/startShortTrade fields
    let newPosition = 0;
    if (lastRow.startLongTrade) newPosition = 1;
    else if (lastRow.startShortTrade) newPosition = -1;
    else if (lastRow.simPos !== undefined) newPosition = lastRow.simPos;

    // Detect state change
    if (newPosition === this.lastPosition) return null;

    const prevPosition = this.lastPosition;
    this.lastPosition = newPosition;

    const close = lastRow.Close || lastRow.close || this.candles[this.candles.length - 1].close;
    const atrValue = lastRow.atrNow || null;

    let signal = null;

    if (newPosition === 1 && prevPosition <= 0) {
      // New LONG entry
      signal = {
        action: 'OPEN_LONG',
        price: close,
        atr: atrValue,
        sl: atrValue ? close - (this.champion.config.slAtrMult || 0.5) * atrValue : null,
        tp: atrValue ? close + (this.champion.config.tpAtrMult || 6.85) * atrValue : null,
        confidence: 0.85,
        reason: 'Champion kNN signal + fusion pass',
        timestamp: Date.now(),
      };
    } else if (newPosition === -1 && prevPosition >= 0) {
      // New SHORT entry
      signal = {
        action: 'OPEN_SHORT',
        price: close,
        atr: atrValue,
        sl: atrValue ? close + (this.champion.config.slAtrMult || 0.5) * atrValue : null,
        tp: atrValue ? close - (this.champion.config.tpAtrMult || 6.85) * atrValue : null,
        confidence: 0.85,
        reason: 'Champion kNN signal + fusion pass',
        timestamp: Date.now(),
      };
    } else if (newPosition === 0 && prevPosition !== 0) {
      // Position closed
      signal = {
        action: prevPosition === 1 ? 'CLOSE_LONG' : 'CLOSE_SHORT',
        price: close,
        confidence: 0.9,
        reason: 'Champion exit (SL/TP/trail/signal)',
        timestamp: Date.now(),
      };
    }

    if (signal) {
      this.lastSignal = signal;
      this.emit('signal', signal);
    }

    return signal;
  }

  _runScript(args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        shell: false,
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ ok: true });
        else reject(new Error(`Pine runner exited ${code}: ${stderr.slice(0, 200)}`));
      });

      // Timeout: 60s max
      setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Pine runner timeout')); }, 60000);
    });
  }

  _applyConfig(source, config) {
    let patched = source;
    for (const [key, value] of Object.entries(config)) {
      const replacement = typeof value === 'boolean' ? String(value)
        : typeof value === 'string' ? `"${value}"` : String(value);
      const patterns = [
        new RegExp(`(${key}\\s*=\\s*input\\.(?:int|float|bool|string)\\s*\\()([^,)]+)`, 'g'),
        new RegExp(`(${key}\\s*=\\s*input\\s*\\()([^,)]+)`, 'g'),
      ];
      for (const p of patterns) patched = patched.replace(p, `$1${replacement}`);
    }
    return patched;
  }

  _getStepMs() {
    const map = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000 };
    return map[this.timeframe] || 900000;
  }
}
