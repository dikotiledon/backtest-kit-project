import { MomentumStrategy } from './momentum.mjs';
import { BreakoutStrategy } from './breakout.mjs';
import { TrendFollowStrategy } from './trend-follow.mjs';
import { ScalpStrategy } from './scalp.mjs';
import { ChampionBridgeStrategy } from './champion-bridge.mjs';

/**
 * Strategy Registry — central registry of all available strategies.
 * Provides factory methods and metadata for the UI.
 */

const STRATEGIES = {
  momentum: {
    name: 'Momentum',
    description: 'RSI + MACD crossover momentum strategy',
    class: MomentumStrategy,
    defaultTimeframe: '15m',
    riskLevel: 'medium',
  },
  breakout: {
    name: 'Breakout',
    description: 'Bollinger Band squeeze breakout with volume confirmation',
    class: BreakoutStrategy,
    defaultTimeframe: '15m',
    riskLevel: 'medium-high',
  },
  'trend-follow': {
    name: 'Trend Follow',
    description: 'EMA crossover trend following with ADX strength filter',
    class: TrendFollowStrategy,
    defaultTimeframe: '15m',
    riskLevel: 'medium',
  },
  scalp: {
    name: 'Scalp',
    description: 'VWAP deviation scalping with volume imbalance',
    class: ScalpStrategy,
    defaultTimeframe: '5m',
    riskLevel: 'high',
  },
  'champion-bridge': {
    name: 'Champion (Autoresearch)',
    description: 'Live execution of the autoresearch champion strategy with full signal fusion, ATR stops, and trailing',
    class: ChampionBridgeStrategy,
    defaultTimeframe: '15m',
    riskLevel: 'medium',
  },
};

/**
 * Create a strategy instance by name.
 * @param {string} strategyId - e.g. 'momentum', 'breakout'
 * @param {object} params - strategy-specific parameters
 * @returns {BaseStrategy}
 */
export function createStrategy(strategyId, params = {}) {
  const entry = STRATEGIES[strategyId];
  if (!entry) throw new Error(`Unknown strategy: ${strategyId}. Available: ${Object.keys(STRATEGIES).join(', ')}`);
  return new entry.class(params);
}

/**
 * List all available strategies with metadata (for UI).
 */
export function listStrategies() {
  return Object.entries(STRATEGIES).map(([id, entry]) => ({
    id,
    name: entry.name,
    description: entry.description,
    defaultTimeframe: entry.defaultTimeframe,
    riskLevel: entry.riskLevel,
    defaultParams: entry.class.getDefaultParams(),
  }));
}

/**
 * Get strategy metadata by ID.
 */
export function getStrategyInfo(strategyId) {
  const entry = STRATEGIES[strategyId];
  if (!entry) return null;
  return {
    id: strategyId,
    name: entry.name,
    description: entry.description,
    defaultTimeframe: entry.defaultTimeframe,
    riskLevel: entry.riskLevel,
    defaultParams: entry.class.getDefaultParams(),
  };
}

export { STRATEGIES };
