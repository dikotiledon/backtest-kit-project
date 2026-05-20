/**
 * PositionSizer — dynamic position sizing based on account performance.
 * Reduces size during drawdowns, increases during equity growth.
 * Singleton via getPositionSizer().
 */

const MODES = ['fixed', 'drawdown', 'kelly', 'anti-martingale'];

const DEFAULT_CONFIG = {
  mode: 'drawdown',
  minSizeFactor: 0.1,       // never go below 10% of base
  maxSizeFactor: 1.5,       // never exceed 150% of base
  drawdownTiers: [5, 10, 15, 20],           // pct thresholds
  drawdownFactors: [1.0, 0.75, 0.5, 0.25, 0.1], // corresponding factors (one more than tiers)
};

class PositionSizer {
  constructor() {
    this._config = { ...DEFAULT_CONFIG };
  }

  // ─── Public API ─────────────────────────────────────────────────

  /**
   * Calculate adjusted position size based on current mode and account state.
   * @param {number} baseAllocation - The base allocation amount (e.g. USDT)
   * @param {object} options - Account state for sizing decision
   * @param {number} options.equity - Current account equity
   * @param {number} options.peakEquity - Peak equity (high-water mark)
   * @param {number} options.dailyPnl - Today's PnL
   * @param {number} options.consecutiveLosses - Number of consecutive losing trades
   * @param {number} options.winRate - Win rate 0-1
   * @param {number} options.avgWinLossRatio - Average win / average loss ratio
   * @param {number} options.riskPerTrade - Risk per trade fraction (optional)
   * @returns {{ adjustedAllocation: number, sizeFactor: number, reason: string }}
   */
  calculateSize(baseAllocation, options = {}) {
    const mode = this._config.mode;
    let sizeFactor = 1.0;
    let reason = '';

    switch (mode) {
      case 'fixed':
        sizeFactor = 1.0;
        reason = 'Fixed mode — no adjustment';
        break;

      case 'drawdown':
        ({ sizeFactor, reason } = this._calcDrawdown(options));
        break;

      case 'kelly':
        ({ sizeFactor, reason } = this._calcKelly(options));
        break;

      case 'anti-martingale':
        ({ sizeFactor, reason } = this._calcAntiMartingale(options));
        break;

      default:
        sizeFactor = 1.0;
        reason = `Unknown mode '${mode}', defaulting to fixed`;
    }

    // Clamp to configured bounds
    sizeFactor = Math.max(this._config.minSizeFactor, Math.min(this._config.maxSizeFactor, sizeFactor));

    const adjustedAllocation = baseAllocation * sizeFactor;

    return { adjustedAllocation, sizeFactor, reason };
  }

  getMode() {
    return this._config.mode;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) {
      throw new Error(`Invalid mode '${mode}'. Valid: ${MODES.join(', ')}`);
    }
    this._config.mode = mode;
  }

  getConfig() {
    return { ...this._config };
  }

  updateConfig(patch) {
    if (patch.mode !== undefined) {
      if (!MODES.includes(patch.mode)) {
        throw new Error(`Invalid mode '${patch.mode}'. Valid: ${MODES.join(', ')}`);
      }
    }
    Object.assign(this._config, patch);
  }

  // ─── Sizing Modes (Private) ────────────────────────────────────

  _calcDrawdown({ equity, peakEquity }) {
    if (!peakEquity || peakEquity <= 0 || !equity) {
      return { sizeFactor: 1.0, reason: 'No equity data — full size' };
    }

    const drawdownPct = ((peakEquity - equity) / peakEquity) * 100;

    if (drawdownPct <= 0) {
      return { sizeFactor: 1.0, reason: 'At or above peak equity — full size' };
    }

    const tiers = this._config.drawdownTiers;
    const factors = this._config.drawdownFactors;

    // Walk through tiers to find the matching factor
    let sizeFactor = factors[factors.length - 1]; // default to minimum (last factor)
    for (let i = 0; i < tiers.length; i++) {
      if (drawdownPct <= tiers[i]) {
        sizeFactor = factors[i];
        break;
      }
    }

    return {
      sizeFactor,
      reason: `Drawdown ${drawdownPct.toFixed(1)}% — factor ${sizeFactor}`,
    };
  }

  _calcKelly({ winRate, avgWinLossRatio }) {
    if (!winRate || winRate <= 0 || !avgWinLossRatio || avgWinLossRatio <= 0) {
      return { sizeFactor: 0.25, reason: 'Insufficient stats for Kelly — using conservative 0.25' };
    }

    let kellyFraction = winRate - (1 - winRate) / avgWinLossRatio;

    // Clamp kelly fraction
    kellyFraction = Math.max(0.05, Math.min(0.5, kellyFraction));

    // 2x because base allocation is already conservative
    const sizeFactor = kellyFraction * 2;

    return {
      sizeFactor,
      reason: `Kelly fraction ${kellyFraction.toFixed(3)} (winRate=${(winRate * 100).toFixed(1)}%, W/L ratio=${avgWinLossRatio.toFixed(2)}) — factor ${sizeFactor.toFixed(3)}`,
    };
  }

  _calcAntiMartingale({ consecutiveLosses, lastTradeWin }) {
    const losses = consecutiveLosses || 0;
    let sizeFactor;
    let reason;

    if (losses >= 3) {
      sizeFactor = 0.5;
      reason = `${losses} consecutive losses — half size`;
    } else if (losses >= 2) {
      sizeFactor = 0.75;
      reason = `${losses} consecutive losses — 75% size`;
    } else if (losses >= 1) {
      sizeFactor = 0.9;
      reason = `${losses} consecutive loss — 90% size`;
    } else if (lastTradeWin) {
      sizeFactor = 1.1;
      reason = 'Last trade was a win — 110% size';
    } else {
      sizeFactor = 1.0;
      reason = 'No streak — full size';
    }

    return { sizeFactor, reason };
  }
}

// ─── Singleton ──────────────────────────────────────────────────

let _instance = null;

export function getPositionSizer() {
  if (!_instance) {
    _instance = new PositionSizer();
  }
  return _instance;
}

export { PositionSizer, MODES, DEFAULT_CONFIG };
