import { loadChampion, listChampionSources } from './champion-loader.mjs';
import { getSymbolRegistry } from './symbol-registry.mjs';

/**
 * Champion Auto-Trader Service
 * 
 * Bridges the autoresearch champion into the bot manager.
 * Provides:
 * - Load champion config from disk
 * - Create bot configs pre-filled with champion parameters
 * - Auto-create bots for multiple symbols using the champion strategy
 */

/**
 * Load the current champion and return a bot-ready config.
 * @param {string} matrixId - autoresearch matrix ID
 * @param {string} symbol - trading symbol (e.g. BTCUSDT)
 * @param {string} market - 'spot' | 'usdm' | 'coinm'
 * @param {object} overrides - override default bot settings
 */
export async function createChampionBotConfig(matrixId, symbol, market = 'usdm', overrides = {}) {
  const champion = await loadChampion(matrixId);

  return {
    symbol,
    market,
    strategy: 'champion-bridge',
    strategyParams: {
      championConfig: champion.config,
      label: champion.label || champion.configId,
      matrixId,
    },
    timeframe: '15m', // Champion is optimized for 15m
    leverage: overrides.leverage || 10,
    allocation: overrides.allocation || 100,
    maxPositionSize: overrides.maxPositionSize || 50,
    stopLossPct: _atrMultToPercent(champion.config.slAtrMult || 1.5),
    takeProfitPct: _atrMultToPercent(champion.config.tpAtrMult || 3.0),
    trailingStopPct: champion.config.useTrailingStop
      ? _atrMultToPercent(champion.config.trailAtrMult || 1.0)
      : null,
    cooldownMs: (champion.config.minBarsBetween || 1) * 15 * 60 * 1000, // bars * timeframe
    enabled: true,
    ...overrides,
    // Always keep strategy params
    strategy: 'champion-bridge',
    strategyParams: {
      championConfig: champion.config,
      label: champion.label || champion.configId,
      matrixId,
    },
  };
}

/**
 * Create champion bots for multiple symbols at once.
 * @param {string} matrixId
 * @param {string[]} symbols - e.g. ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']
 * @param {string} market
 * @param {object} sharedOverrides - applied to all bots
 */
export async function createChampionBotConfigs(matrixId, symbols, market = 'usdm', sharedOverrides = {}) {
  const configs = [];
  for (const symbol of symbols) {
    const config = await createChampionBotConfig(matrixId, symbol, market, sharedOverrides);
    configs.push(config);
  }
  return configs;
}

/**
 * Get champion info for display in the UI.
 */
export async function getChampionInfo(matrixId) {
  try {
    const champion = await loadChampion(matrixId);
    return {
      matrixId,
      configId: champion.configId,
      label: champion.label,
      score: champion.score,
      roiPct: champion.roiPct,
      winRatePct: champion.winRatePct,
      profitFactor: champion.profitFactor,
      maxDrawdownPct: champion.maxDrawdownPct,
      tradeCount: champion.tradeCount,
      config: champion.config,
      promotedAt: champion.raw?.promotedAt,
      mode: champion.raw?.mode,
      reason: champion.raw?.reason,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * List all available champions (matrices with champion.json).
 */
export async function listChampions() {
  return listChampionSources();
}

/**
 * Convert ATR multiplier to approximate percentage for SL/TP.
 * Assumes ~1% ATR on 15m for major crypto pairs.
 */
function _atrMultToPercent(atrMult) {
  // Average ATR on 15m for BTC is roughly 0.3-0.5% of price
  // Use 0.4% as baseline
  return parseFloat((atrMult * 0.4).toFixed(2));
}
