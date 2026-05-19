import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, '..', 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'binance.json');

// Encryption key derived from machine-specific entropy
const CIPHER_KEY = crypto.scryptSync(
  process.env.BINANCE_ENCRYPTION_KEY || `ct-${process.env.USERNAME || 'default'}-${process.platform}`,
  'champion-tester-salt-v1',
  32
);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', CIPHER_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${tag}:${encrypted}`;
}

function decrypt(payload) {
  const [ivHex, tagHex, encrypted] = payload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', CIPHER_KEY, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Load Binance configuration
 * @returns {object|null} Full config including futures settings
 */
export async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const config = JSON.parse(raw);
    return {
      apiKey: config.apiKey ? decrypt(config.apiKey) : '',
      apiSecret: config.apiSecret ? decrypt(config.apiSecret) : '',
      testnet: config.testnet ?? true,
      tradingEnabled: config.tradingEnabled ?? false,
      riskLimits: config.riskLimits ?? getDefaultRiskLimits(),
      // Futures-specific settings
      futures: config.futures ?? getDefaultFuturesConfig(),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Save Binance configuration (encrypts secrets)
 */
export async function saveConfig(input) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });

  const existing = await loadConfig().catch(() => null);
  const now = new Date().toISOString();

  const config = {
    apiKey: input.apiKey ? encrypt(input.apiKey) : '',
    apiSecret: input.apiSecret ? encrypt(input.apiSecret) : '',
    testnet: input.testnet ?? true,
    tradingEnabled: input.tradingEnabled ?? false,
    riskLimits: input.riskLimits ?? existing?.riskLimits ?? getDefaultRiskLimits(),
    futures: input.futures ?? existing?.futures ?? getDefaultFuturesConfig(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  return { ok: true, testnet: config.testnet, tradingEnabled: config.tradingEnabled };
}

/**
 * Check if config exists and has credentials
 */
export async function hasCredentials() {
  const config = await loadConfig();
  return !!(config?.apiKey && config?.apiSecret);
}

/**
 * Get config status (without exposing secrets)
 */
export async function getConfigStatus() {
  const config = await loadConfig();
  if (!config) return { configured: false };
  return {
    configured: !!(config.apiKey && config.apiSecret),
    testnet: config.testnet,
    tradingEnabled: config.tradingEnabled,
    riskLimits: config.riskLimits,
    futures: config.futures,
    hasApiKey: !!config.apiKey,
    hasApiSecret: !!config.apiSecret,
    updatedAt: config.updatedAt,
  };
}

/**
 * Delete config (wipe credentials)
 */
export async function deleteConfig() {
  try {
    await fs.unlink(CONFIG_FILE);
    return { ok: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true, alreadyDeleted: true };
    throw err;
  }
}

function getDefaultRiskLimits() {
  return {
    maxPositionSizeUSDT: 100,
    maxDailyLossUSDT: 50,
    maxDailyTrades: 20,
    maxOpenPositions: 3,
    maxSlippagePct: 0.5,
    cooldownAfterLossMs: 60000,
    requireConfirmation: true,
  };
}

function getDefaultFuturesConfig() {
  return {
    enabled: false,
    markets: ['usdm'],             // Which futures markets to enable: 'usdm', 'coinm'
    defaultMarket: 'usdm',         // Default market for UI
    defaultLeverage: 10,           // Default leverage for new positions
    defaultMarginType: 'CROSSED',  // CROSSED or ISOLATED
    positionMode: 'one-way',       // 'one-way' or 'hedge'
    riskLimits: getDefaultFuturesRiskLimits(),
  };
}

function getDefaultFuturesRiskLimits() {
  return {
    maxLeverage: 20,               // Max allowed leverage
    maxPositionSizeUSDT: 500,      // Max single position notional
    maxDailyLossUSDT: 100,         // Max daily realized loss
    maxDailyTrades: 50,            // Max trades per day
    maxOpenPositions: 5,           // Max concurrent positions
    cooldownAfterLossMs: 30000,    // Cooldown after loss
    cooldownAfterLiquidation: 300000, // 5 min cooldown after liquidation
    maxDrawdownPct: 10,            // Max portfolio drawdown % before auto-stop
    enableAutoStopLoss: true,      // Auto SL on new positions
    defaultStopLossPct: 2,         // Default SL distance %
    enableAutoTakeProfit: false,   // Auto TP on new positions
    defaultTakeProfitPct: 5,       // Default TP distance %
  };
}

export { getDefaultRiskLimits, getDefaultFuturesConfig, getDefaultFuturesRiskLimits };
