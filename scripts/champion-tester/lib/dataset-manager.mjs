/**
 * Dataset Manager for Champion Tester
 * 
 * Handles:
 * - Fetching OHLCV data from exchanges via ccxt
 * - TradingView symbol format parsing (e.g. "BINANCE:BTCUSDT" -> exchange=binance, symbol=BTCUSDT)
 * - Incremental dataset updates (only fetch from last known timestamp to now)
 * - Initial fetch of 10000 bars when dataset is empty
 * - Configurable data range for testing
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ccxt from 'ccxt';

const TIMEFRAME_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '45m': 2_700_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

const DEFAULT_INITIAL_LIMIT = 10_000;
const MAX_BATCH = 1000;

/**
 * Parse TradingView-style symbol format.
 * Supports: "BINANCE:BTCUSDT", "BYBIT:ETHUSDT", or plain "BTCUSDT" (defaults to binance)
 */
export function parseSymbol(input) {
  const trimmed = String(input).trim().toUpperCase();

  if (trimmed.includes(':')) {
    const [exchangePart, symbolPart] = trimmed.split(':', 2);
    return {
      exchange: exchangePart.toLowerCase(),
      symbol: symbolPart,
      raw: trimmed,
    };
  }

  return {
    exchange: 'binance',
    symbol: trimmed,
    raw: `BINANCE:${trimmed}`,
  };
}

/**
 * Validate symbol and timeframe inputs before fetch operations.
 */
export function validateSymbolInput(symbol, timeframe) {
  const errors = [];
  if (!symbol || typeof symbol !== 'string' || symbol.trim() === '') {
    errors.push('symbol is required');
  }
  if (!timeframe || !TIMEFRAME_MS[timeframe]) {
    errors.push(`timeframe must be one of: ${Object.keys(TIMEFRAME_MS).join(', ')}`);
  }
  return errors;
}

/**
 * Map TradingView exchange names to ccxt exchange ids
 */
function mapExchangeId(tvExchange) {
  const map = {
    binance: 'binance',
    bybit: 'bybit',
    okx: 'okx',
    kucoin: 'kucoin',
    bitget: 'bitget',
    gate: 'gateio',
    gateio: 'gateio',
    coinbase: 'coinbase',
    kraken: 'kraken',
    htx: 'htx',
    huobi: 'htx',
    mexc: 'mexc',
    bitfinex: 'bitfinex',
  };
  return map[tvExchange] || tvExchange;
}

const exchangeCache = new Map();

async function getExchange(exchangeId) {
  const key = String(exchangeId);
  if (!exchangeCache.has(key)) {
    const ExchangeCtor = ccxt[key];
    if (!ExchangeCtor) {
      throw new Error(`Unsupported exchange: ${key}. Available: ${Object.keys(ccxt).filter(k => typeof ccxt[k] === 'function' && k !== 'Exchange').slice(0, 20).join(', ')}...`);
    }
    const instance = new ExchangeCtor({
      options: { defaultType: 'spot', adjustForTimeDifference: true, recvWindow: 60000 },
      enableRateLimit: true,
    });
    exchangeCache.set(key, instance);
  }

  const exchange = exchangeCache.get(key);
  if (!exchange.markets) {
    await exchange.loadMarkets();
  }
  return exchange;
}

/**
 * Get the dataset file path for a given symbol+timeframe
 */
export function datasetPath(dataDir, exchange, symbol, timeframe) {
  return path.join(dataDir, `${exchange}_${symbol}_${timeframe}.json`);
}

/**
 * Read existing dataset from disk. Returns null if not found.
 */
export async function readDataset(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Write dataset to disk (atomic: write tmp then rename)
 */
export async function writeDataset(filePath, dataset) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(dataset, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

/**
 * Fetch OHLCV candles from exchange.
 * Handles pagination for large requests.
 */
async function fetchCandles({ exchangeId, symbol, timeframe, since, limit }) {
  const exchange = await getExchange(exchangeId);
  const stepMs = TIMEFRAME_MS[timeframe];
  if (!stepMs) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const candles = [];
  let remaining = limit;
  let currentSince = since;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, MAX_BATCH);
    const raw = await exchange.fetchOHLCV(symbol, timeframe, currentSince, batchSize);

    if (!raw || raw.length === 0) break;

    const normalized = raw.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp, open, high, low, close, volume,
    })).filter(c => c.timestamp >= currentSince);

    candles.push(...normalized);

    const lastTs = normalized[normalized.length - 1].timestamp;
    currentSince = lastTs + stepMs;
    remaining -= normalized.length;

    // If we got fewer than requested, we've hit the end of available data
    if (raw.length < batchSize) break;
  }

  // Deduplicate by timestamp
  const seen = new Map();
  for (const c of candles) {
    seen.set(c.timestamp, c);
  }
  return Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetch or update dataset for a symbol.
 * 
 * - If dataset doesn't exist: fetch `initialLimit` bars ending at now
 * - If dataset exists: fetch from last timestamp to now (incremental)
 * 
 * @returns {{ dataset, fetched, isNew }}
 */
export async function fetchOrUpdateDataset({
  tvSymbol,
  timeframe,
  dataDir,
  initialLimit = DEFAULT_INITIAL_LIMIT,
  onProgress = null,
}) {
  const parsed = parseSymbol(tvSymbol);
  const exchangeId = mapExchangeId(parsed.exchange);
  const filePath = datasetPath(dataDir, parsed.exchange, parsed.symbol, timeframe);
  const stepMs = TIMEFRAME_MS[timeframe];
  if (!stepMs) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const existing = await readDataset(filePath);

  if (!existing || !existing.candles || existing.candles.length === 0) {
    // Initial fetch: get `initialLimit` bars ending approximately at now
    if (onProgress) onProgress({ phase: 'initial', message: `Fetching ${initialLimit} bars for ${parsed.raw} ${timeframe}...` });

    const now = Date.now();
    const since = now - (initialLimit * stepMs);

    const candles = await fetchCandles({
      exchangeId,
      symbol: parsed.symbol,
      timeframe,
      since,
      limit: initialLimit,
    });

    const dataset = {
      formatVersion: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exchange: parsed.exchange,
      exchangeId,
      symbol: parsed.symbol,
      tvSymbol: parsed.raw,
      timeframe,
      candleCount: candles.length,
      firstTimestamp: candles[0]?.timestamp || null,
      lastTimestamp: candles[candles.length - 1]?.timestamp || null,
      candles,
    };

    await writeDataset(filePath, dataset);
    return { dataset, fetched: candles.length, isNew: true };
  }

  // Incremental update: fetch from last known timestamp to now
  const lastTs = existing.lastTimestamp || existing.candles[existing.candles.length - 1]?.timestamp;
  if (!lastTs) {
    throw new Error(`Dataset exists but has no valid lastTimestamp: ${filePath}`);
  }

  const since = lastTs + stepMs; // Start after the last known candle
  const now = Date.now();
  const estimatedBars = Math.ceil((now - since) / stepMs);

  if (estimatedBars <= 0) {
    if (onProgress) onProgress({ phase: 'upToDate', message: `Dataset already up to date.` });
    return { dataset: existing, fetched: 0, isNew: false };
  }

  if (onProgress) onProgress({ phase: 'update', message: `Fetching ~${estimatedBars} new bars from ${new Date(since).toISOString()}...` });

  const newCandles = await fetchCandles({
    exchangeId,
    symbol: parsed.symbol,
    timeframe,
    since,
    limit: estimatedBars + 100, // small buffer
  });

  // Merge: append new candles, deduplicate
  const allCandles = [...existing.candles, ...newCandles];
  const seen = new Map();
  for (const c of allCandles) {
    seen.set(c.timestamp, c);
  }
  const merged = Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);

  const dataset = {
    ...existing,
    updatedAt: new Date().toISOString(),
    candleCount: merged.length,
    firstTimestamp: merged[0]?.timestamp || null,
    lastTimestamp: merged[merged.length - 1]?.timestamp || null,
    candles: merged,
  };

  await writeDataset(filePath, dataset);
  return { dataset, fetched: newCandles.length, isNew: false };
}

/**
 * List all datasets in the data directory
 */
export async function listDatasets(dataDir) {
  try {
    const files = await fs.readdir(dataDir);
    const datasets = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(dataDir, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const ds = JSON.parse(raw);
        datasets.push({
          file,
          tvSymbol: ds.tvSymbol || `${ds.exchange}:${ds.symbol}`.toUpperCase(),
          exchange: ds.exchange,
          symbol: ds.symbol,
          timeframe: ds.timeframe,
          candleCount: ds.candleCount,
          firstTimestamp: ds.firstTimestamp,
          lastTimestamp: ds.lastTimestamp,
          createdAt: ds.createdAt,
          updatedAt: ds.updatedAt,
        });
      } catch {
        // skip malformed files
      }
    }

    return datasets;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Delete a dataset
 */
export async function deleteDataset(dataDir, exchange, symbol, timeframe) {
  const filePath = datasetPath(dataDir, exchange, symbol, timeframe);
  await fs.unlink(filePath);
}

/**
 * Slice dataset candles for testing.
 * Supports: last N bars, range by index, range by timestamp.
 */
export function sliceDataset(candles, { lastN, fromIndex, toIndex, fromTimestamp, toTimestamp }) {
  if (lastN && lastN > 0) {
    return candles.slice(-lastN);
  }
  if (fromTimestamp || toTimestamp) {
    return candles.filter(c => {
      if (fromTimestamp && c.timestamp < fromTimestamp) return false;
      if (toTimestamp && c.timestamp > toTimestamp) return false;
      return true;
    });
  }
  if (fromIndex !== undefined || toIndex !== undefined) {
    const start = fromIndex || 0;
    const end = toIndex !== undefined ? toIndex + 1 : candles.length;
    return candles.slice(start, end);
  }
  return candles;
}

export { TIMEFRAME_MS, DEFAULT_INITIAL_LIMIT };
