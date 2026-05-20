/**
 * Config validation — hand-rolled, no external deps.
 * Validates Binance config shape and values.
 */

const VALID_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];

/**
 * Validate a config object.
 * @param {object} config - The loaded config
 * @param {object} [opts] - Options
 * @param {boolean} [opts.tradingEnabled] - Whether trading is active (apiKey required if true)
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(config, opts = {}) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be a non-null object'] };
  }

  const tradingEnabled = opts.tradingEnabled ?? config.tradingEnabled ?? false;

  // API credentials — required only when trading is enabled
  if (tradingEnabled) {
    if (!config.apiKey || typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
      errors.push('apiKey is required when trading is enabled (must be non-empty string)');
    }
    if (!config.apiSecret || typeof config.apiSecret !== 'string' || config.apiSecret.trim().length === 0) {
      errors.push('apiSecret is required when trading is enabled (must be non-empty string)');
    }
  }

  // testnet — must be boolean if present
  if (config.testnet !== undefined && typeof config.testnet !== 'boolean') {
    errors.push('testnet must be a boolean');
  }

  // riskLimits validation
  if (config.riskLimits) {
    const rl = config.riskLimits;
    validateNumber(errors, rl.maxPositionSizeUSDT, 'riskLimits.maxPositionSizeUSDT', 1, 1_000_000);
    validateNumber(errors, rl.maxDailyLossUSDT, 'riskLimits.maxDailyLossUSDT', 1, 1_000_000);
    validateNumber(errors, rl.maxDailyTrades, 'riskLimits.maxDailyTrades', 1, 10_000);
    validateNumber(errors, rl.maxOpenPositions, 'riskLimits.maxOpenPositions', 1, 1000);
    validateNumber(errors, rl.maxSlippagePct, 'riskLimits.maxSlippagePct', 0, 100);
    validateNumber(errors, rl.cooldownAfterLossMs, 'riskLimits.cooldownAfterLossMs', 0, 86_400_000);
  }

  // Futures config validation
  if (config.futures && config.futures.enabled) {
    const f = config.futures;
    if (f.markets) {
      if (!Array.isArray(f.markets)) {
        errors.push('futures.markets must be an array');
      } else {
        for (const m of f.markets) {
          if (!['usdm', 'coinm'].includes(m)) {
            errors.push(`futures.markets contains invalid market: "${m}" (valid: usdm, coinm)`);
          }
        }
      }
    }
    if (f.defaultLeverage !== undefined) {
      validateNumber(errors, f.defaultLeverage, 'futures.defaultLeverage', 1, 125);
    }
    if (f.defaultMarginType !== undefined) {
      if (!['CROSSED', 'ISOLATED'].includes(f.defaultMarginType)) {
        errors.push('futures.defaultMarginType must be "CROSSED" or "ISOLATED"');
      }
    }
    if (f.positionMode !== undefined) {
      if (!['one-way', 'hedge'].includes(f.positionMode)) {
        errors.push('futures.positionMode must be "one-way" or "hedge"');
      }
    }
    if (f.riskLimits) {
      const frl = f.riskLimits;
      validateNumber(errors, frl.maxLeverage, 'futures.riskLimits.maxLeverage', 1, 125);
      validateNumber(errors, frl.maxPositionSizeUSDT, 'futures.riskLimits.maxPositionSizeUSDT', 1, 10_000_000);
      validateNumber(errors, frl.maxDailyLossUSDT, 'futures.riskLimits.maxDailyLossUSDT', 1, 10_000_000);
      validateNumber(errors, frl.maxDrawdownPct, 'futures.riskLimits.maxDrawdownPct', 0.1, 100);
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateNumber(errors, value, fieldName, min, max) {
  if (value === undefined || value === null) return; // optional
  if (typeof value !== 'number' || isNaN(value)) {
    errors.push(`${fieldName} must be a number`);
    return;
  }
  if (value < min || value > max) {
    errors.push(`${fieldName} must be between ${min} and ${max} (got ${value})`);
  }
}

export { VALID_TIMEFRAMES };
