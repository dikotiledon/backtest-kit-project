import fs from 'node:fs/promises';
import path from 'node:path';
import ccxt from 'ccxt';

const TIMEFRAME_MINUTES = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '45m': 45,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '6h': 360,
  '8h': 480,
  '12h': 720,
  '1d': 1440,
};

function roundTripJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function timeframeToMinutes(timeframe) {
  const minutes = TIMEFRAME_MINUTES[String(timeframe)];
  if (!minutes) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }
  return minutes;
}

export function alignWhenToInterval(when, timeframe) {
  const whenMs = typeof when === 'string' ? Date.parse(when) : Number(when);
  if (!Number.isFinite(whenMs)) {
    throw new Error(`Invalid when value: ${when}`);
  }
  const stepMs = timeframeToMinutes(timeframe) * 60_000;
  return Math.floor(whenMs / stepMs) * stepMs;
}

export function getPinnedWindow({ timeframe, limit, when }) {
  const stepMs = timeframeToMinutes(timeframe) * 60_000;
  const alignedWhenMs = alignWhenToInterval(when, timeframe);
  const sinceMs = alignedWhenMs - (Number(limit) * stepMs);
  return {
    stepMs,
    alignedWhenMs,
    sinceMs,
    untilMsExclusive: alignedWhenMs,
  };
}

export function expectedCandleTimestamps({ timeframe, limit, when }) {
  const { stepMs, sinceMs } = getPinnedWindow({ timeframe, limit, when });
  return Array.from({ length: Number(limit) }, (_, index) => sinceMs + (index * stepMs));
}

export function datasetFilePath(datasetsRoot, lab) {
  return path.join(datasetsRoot, `${String(lab.labId)}.json`);
}

export function cacheCandlePath(cacheRoot, exchangeName, symbol, timeframe, timestamp) {
  return path.join(cacheRoot, String(exchangeName), String(symbol), String(timeframe), `${timestamp}.json`);
}

export function normalizeFetchedCandles(rows = []) {
  return rows.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp: Number(timestamp),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
  }));
}

export function normalizeCacheCandle(row = {}) {
  return {
    timestamp: Number(row.timestamp),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

export function validateSequentialCandles(candles, { timeframe, limit, when }) {
  const timestamps = expectedCandleTimestamps({ timeframe, limit, when });
  if (candles.length !== timestamps.length) {
    throw new Error(`Pinned candles count mismatch: expected ${timestamps.length}, got ${candles.length}`);
  }

  for (let index = 0; index < timestamps.length; index++) {
    const expected = timestamps[index];
    const actual = Number(candles[index]?.timestamp);
    if (actual !== expected) {
      throw new Error(`Pinned candle timestamp mismatch at index ${index}: expected ${expected}, got ${actual}`);
    }
  }

  return true;
}

const exchangeCache = new Map();

async function getExchange(exchangeId) {
  const key = String(exchangeId || 'binance');
  if (!exchangeCache.has(key)) {
    const ExchangeCtor = ccxt[key];
    if (!ExchangeCtor) {
      throw new Error(`Unsupported CCXT exchangeId: ${key}`);
    }
    const instance = new ExchangeCtor({
      options: {
        defaultType: 'spot',
        adjustForTimeDifference: true,
        recvWindow: 60000,
      },
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

export async function fetchPinnedCandles({
  symbol,
  timeframe,
  limit,
  when,
  exchangeId = 'binance',
  maxBatch = 1000,
}) {
  const { stepMs, sinceMs } = getPinnedWindow({ timeframe, limit, when });
  const exchange = await getExchange(exchangeId);
  const requestedLimit = Number(limit);
  const candles = [];

  let remaining = requestedLimit;
  let currentSince = sinceMs;

  while (remaining > 0) {
    const chunkLimit = Math.min(remaining, maxBatch);
    const raw = await exchange.fetchOHLCV(symbol, timeframe, currentSince, chunkLimit);
    const normalized = normalizeFetchedCandles(raw)
      .filter((row) => Number.isFinite(row.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((row) => row.timestamp >= currentSince && row.timestamp < currentSince + (chunkLimit * stepMs));

    candles.push(...normalized);
    currentSince += chunkLimit * stepMs;
    remaining -= chunkLimit;
  }

  const deduped = Array.from(new Map(candles.map((row) => [row.timestamp, row])).values())
    .sort((a, b) => a.timestamp - b.timestamp);

  validateSequentialCandles(deduped, { timeframe, limit: requestedLimit, when });
  return deduped;
}

async function tryReadCacheCandles({ cacheRoot, exchangeName, symbol, timeframe, limit, when, batchSize = 256 }) {
  const timestamps = expectedCandleTimestamps({ timeframe, limit, when });
  const candles = [];
  const missing = [];

  for (let start = 0; start < timestamps.length; start += batchSize) {
    const batch = timestamps.slice(start, start + batchSize);
    const results = await Promise.all(batch.map(async (timestamp) => {
      const filePath = cacheCandlePath(cacheRoot, exchangeName, symbol, timeframe, timestamp);
      try {
        const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
        return { timestamp, candle: normalizeCacheCandle(raw) };
      } catch {
        return { timestamp, candle: null };
      }
    }));

    for (const result of results) {
      if (result.candle) candles.push(result.candle);
      else missing.push(result.timestamp);
    }
  }

  return {
    exchangeName,
    candles,
    missing,
    complete: missing.length === 0,
  };
}

export async function readPinnedCandlesFromCache({
  cacheRoot,
  exchangeName,
  symbol,
  timeframe,
  limit,
  when,
  fallbackExchangeNames = [],
}) {
  const candidateExchangeNames = [exchangeName, ...fallbackExchangeNames].filter(Boolean);
  const seen = new Set();
  const ordered = candidateExchangeNames.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  let bestIncompleteResult = null;

  for (const name of ordered) {
    const result = await tryReadCacheCandles({
      cacheRoot,
      exchangeName: name,
      symbol,
      timeframe,
      limit,
      when,
    });
    if (result.complete) {
      validateSequentialCandles(result.candles, { timeframe, limit, when });
      return result;
    }
    if (!bestIncompleteResult || result.missing.length < bestIncompleteResult.missing.length) {
      bestIncompleteResult = result;
    }
  }

  let discoveredExchangeNames = [];
  try {
    discoveredExchangeNames = await fs.readdir(cacheRoot, { withFileTypes: true });
  } catch {
    discoveredExchangeNames = [];
  }

  for (const entry of discoveredExchangeNames) {
    if (!entry.isDirectory()) continue;
    if (seen.has(entry.name)) continue;
    const result = await tryReadCacheCandles({
      cacheRoot,
      exchangeName: entry.name,
      symbol,
      timeframe,
      limit,
      when,
    });
    if (result.complete) {
      validateSequentialCandles(result.candles, { timeframe, limit, when });
      return result;
    }
    if (!bestIncompleteResult || result.missing.length < bestIncompleteResult.missing.length) {
      bestIncompleteResult = result;
    }
  }

  const failed = bestIncompleteResult || {
    exchangeName: ordered[0] || exchangeName || 'unknown-exchange',
    missing: expectedCandleTimestamps({ timeframe, limit, when }),
  };
  const preview = failed.missing.slice(0, 5).join(', ');
  throw new Error(`Local cache incomplete for ${symbol} ${timeframe} on ${failed.exchangeName}: missing ${failed.missing.length} candle(s). First missing timestamps: ${preview}`);
}

export async function writePinnedDataset({
  datasetsRoot,
  lab,
  candles,
  exchangeName,
  exchangeId,
  source = 'ccxt',
}) {
  await fs.mkdir(datasetsRoot, { recursive: true });
  validateSequentialCandles(candles, lab);

  const payload = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    exchangeName,
    exchangeId,
    lab: roundTripJson(lab),
    candleCount: candles.length,
    window: getPinnedWindow(lab),
    candles,
  };

  const filePath = datasetFilePath(datasetsRoot, lab);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

export async function readPinnedDataset(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function normalizeWhenForCompare(value) {
  if (value == null || value === '') return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : String(value);
}

export function assertDatasetMatchesLab(dataset, lab) {
  if (!dataset?.lab) {
    throw new Error('Pinned dataset missing lab metadata');
  }

  const keys = ['labId', 'symbol', 'timeframe', 'limit'];
  for (const key of keys) {
    if (String(dataset.lab[key]) !== String(lab[key])) {
      throw new Error(`Pinned dataset mismatch for ${lab.labId}: field ${key} expected ${lab[key]}, got ${dataset.lab[key]}`);
    }
  }

  if (normalizeWhenForCompare(dataset.lab.when) !== normalizeWhenForCompare(lab.when)) {
    throw new Error(`Pinned dataset mismatch for ${lab.labId}: field when expected ${lab.when}, got ${dataset.lab.when}`);
  }

  validateSequentialCandles(dataset.candles || [], lab);
  return true;
}

export async function materializePinnedCache({ dataset, cacheRoot, exchangeName }) {
  const effectiveExchangeName = exchangeName || dataset.exchangeName;
  if (!effectiveExchangeName) {
    throw new Error('exchangeName is required to materialize pinned cache');
  }

  let writtenCount = 0;
  for (const candle of dataset.candles || []) {
    const filePath = cacheCandlePath(
      cacheRoot,
      effectiveExchangeName,
      dataset.lab.symbol,
      dataset.lab.timeframe,
      candle.timestamp,
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(candle, null, 2), 'utf8');
      writtenCount++;
    }
  }

  return {
    exchangeName: effectiveExchangeName,
    writtenCount,
    candleCount: dataset.candles?.length || 0,
  };
}

export async function validatePinnedCacheComplete({ cacheRoot, exchangeName, symbol, timeframe, limit, when }) {
  const timestamps = expectedCandleTimestamps({ timeframe, limit, when });
  const missing = [];

  for (const timestamp of timestamps) {
    const filePath = cacheCandlePath(cacheRoot, exchangeName, symbol, timeframe, timestamp);
    try {
      await fs.access(filePath);
    } catch {
      missing.push(timestamp);
    }
  }

  return {
    complete: missing.length === 0,
    expectedCount: timestamps.length,
    missingCount: missing.length,
    missingTimestamps: missing,
  };
}

export async function stagePinnedDatasetForLab({ datasetsRoot, cacheRoot, exchangeName, lab }) {
  const filePath = datasetFilePath(datasetsRoot, lab);
  const dataset = await readPinnedDataset(filePath);
  assertDatasetMatchesLab(dataset, lab);
  const materialized = await materializePinnedCache({ dataset, cacheRoot, exchangeName });
  const validation = await validatePinnedCacheComplete({
    cacheRoot,
    exchangeName: materialized.exchangeName,
    symbol: lab.symbol,
    timeframe: lab.timeframe,
    limit: lab.limit,
    when: lab.when,
  });

  if (!validation.complete) {
    throw new Error(`Pinned cache incomplete for ${lab.labId}: missing ${validation.missingCount} candle(s)`);
  }

  return {
    filePath,
    dataset,
    materialized,
    validation,
  };
}
