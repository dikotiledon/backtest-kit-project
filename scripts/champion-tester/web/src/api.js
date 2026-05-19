class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(method, path, body = null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json();
  if (!data.ok) throw new ApiError(data.error, data.code, res.status);
  return data;
}

const api = {
  ApiError,

  // ─── Core ───────────────────────────────────────────────────────
  getTimeframes: () => request('GET', '/timeframes'),
  getDatasets: () => request('GET', '/datasets'),
  fetchDataset: (symbol, timeframe, initialLimit) =>
    request('POST', '/datasets/fetch', { symbol, timeframe, initialLimit }),
  deleteDataset: (exchange, symbol, timeframe) =>
    request('DELETE', `/datasets/${exchange}/${symbol}/${timeframe}`),
  getChampions: () => request('GET', '/champions'),
  getTestStatus: () => request('GET', '/test/status'),
  cancelTest: () => request('POST', '/test/cancel'),
  runTest: (matrixId, symbol, timeframe, slice) =>
    request('POST', '/test/run', { matrixId, symbol, timeframe, slice }),
  getResults: (params = {}) =>
    request('GET', `/results?${new URLSearchParams(params)}`),
  deleteResult: (runId) => request('DELETE', `/results/${runId}`),
  runSweep: (matrixId, datasets) => request('POST', '/sweep/run', { matrixId, datasets }),
  getSweepStatus: () => request('GET', '/sweep/status'),
  cancelSweep: () => request('POST', '/sweep/cancel'),

  // ─── Trading Config ─────────────────────────────────────────────
  getTradingConfig: () => request('GET', '/trading/config'),
  saveTradingConfig: (config) => request('POST', '/trading/config', config),
  updateTradingConfig: (patch) => request('PATCH', '/trading/config', patch),
  deleteTradingConfig: () => request('DELETE', '/trading/config'),
  getTradingConfigDefaults: () => request('GET', '/trading/config/defaults'),

  // ─── Spot Connection ────────────────────────────────────────────
  connectTrading: () => request('POST', '/trading/connect'),
  disconnectTrading: () => request('POST', '/trading/disconnect'),
  getTradingStatus: () => request('GET', '/trading/status'),

  // ─── Spot Account ───────────────────────────────────────────────
  getTradingAccount: () => request('GET', '/trading/account'),
  getTradingBalance: (asset) => request('GET', `/trading/balance${asset ? `?asset=${asset}` : ''}`),

  // ─── Spot Market Data ───────────────────────────────────────────
  getTradingPrice: (symbol) => request('GET', `/trading/price/${symbol}`),
  getTradingTicker: (symbol) => request('GET', `/trading/ticker/${symbol}`),
  getTradingOrderBook: (symbol, limit) => request('GET', `/trading/orderbook/${symbol}?limit=${limit || 20}`),
  getTradingKlines: (symbol, interval, limit) => request('GET', `/trading/klines/${symbol}?interval=${interval || '15m'}&limit=${limit || 100}`),

  // ─── Spot Orders ────────────────────────────────────────────────
  placeOrder: (params) => request('POST', '/trading/order', params),
  testOrder: (params) => request('POST', '/trading/order/test', params),
  getOpenOrders: (symbol) => request('GET', `/trading/orders/open${symbol ? `?symbol=${symbol}` : ''}`),
  getAllOrders: (symbol, limit) => request('GET', `/trading/orders/${symbol}?limit=${limit || 50}`),
  cancelOrder: (symbol, orderId) => request('DELETE', `/trading/order/${symbol}/${orderId}`),
  cancelAllOrders: (symbol) => request('DELETE', `/trading/orders/${symbol}/all`),
  placeOCO: (params) => request('POST', '/trading/order/oco', params),
  getTrades: (symbol, limit) => request('GET', `/trading/trades/${symbol}?limit=${limit || 50}`),

  // ─── Futures Connection ─────────────────────────────────────────
  connectFutures: (market) => request('POST', '/trading/futures/connect', { market }),
  disconnectFutures: (market) => request('POST', '/trading/futures/disconnect', { market }),

  // ─── Futures Account ────────────────────────────────────────────
  getFuturesAccount: (market) => request('GET', `/trading/futures/account/${market}`),
  getFuturesBalance: (market) => request('GET', `/trading/futures/balance/${market}`),
  getFuturesPositions: (market, symbol) => request('GET', `/trading/futures/positions/${market}${symbol ? `?symbol=${symbol}` : ''}`),

  // ─── Futures Market Data ────────────────────────────────────────
  getFuturesPrice: (market, symbol) => request('GET', `/trading/futures/price/${market}/${symbol}`),
  getFuturesMarkPrice: (market, symbol) => request('GET', `/trading/futures/mark-price/${market}/${symbol}`),
  getFuturesFundingRate: (market, symbol, limit) => request('GET', `/trading/futures/funding-rate/${market}/${symbol}?limit=${limit || 100}`),
  getFuturesOpenInterest: (market, symbol) => request('GET', `/trading/futures/open-interest/${market}/${symbol}`),
  getFuturesOrderBook: (market, symbol, limit) => request('GET', `/trading/futures/orderbook/${market}/${symbol}?limit=${limit || 20}`),
  getFuturesKlines: (market, symbol, interval, limit) => request('GET', `/trading/futures/klines/${market}/${symbol}?interval=${interval || '15m'}&limit=${limit || 100}`),
  getFuturesSymbols: (market, filter) => request('GET', `/trading/futures/symbols/${market}?${new URLSearchParams(filter || {})}`),

  // ─── Futures Leverage & Margin ──────────────────────────────────
  setFuturesLeverage: (market, symbol, leverage) => request('POST', '/trading/futures/leverage', { market, symbol, leverage }),
  setFuturesMarginType: (market, symbol, marginType) => request('POST', '/trading/futures/margin-type', { market, symbol, marginType }),
  setFuturesPositionMode: (market, dualSidePosition) => request('POST', '/trading/futures/position-mode', { market, dualSidePosition }),
  getFuturesPositionMode: (market) => request('GET', `/trading/futures/position-mode/${market}`),

  // ─── Futures Orders ─────────────────────────────────────────────
  placeFuturesOrder: (market, params) => request('POST', '/trading/futures/order', { market, ...params }),
  placeFuturesBatchOrders: (market, orders) => request('POST', '/trading/futures/order/batch', { market, orders }),
  getFuturesOpenOrders: (market, symbol) => request('GET', `/trading/futures/orders/open/${market}${symbol ? `?symbol=${symbol}` : ''}`),
  getFuturesAllOrders: (market, symbol, limit) => request('GET', `/trading/futures/orders/${market}/${symbol}?limit=${limit || 50}`),
  cancelFuturesOrder: (market, symbol, orderId) => request('DELETE', `/trading/futures/order/${market}/${symbol}/${orderId}`),
  cancelAllFuturesOrders: (market, symbol) => request('DELETE', `/trading/futures/orders/${market}/${symbol}/all`),

  // ─── Futures Close ──────────────────────────────────────────────
  closeFuturesPosition: (market, symbol, positionSide) => request('POST', `/trading/futures/close/${market}/${symbol}`, { positionSide }),
  closeAllFuturesPositions: (market) => request('POST', `/trading/futures/close-all/${market}`),

  // ─── Futures History ────────────────────────────────────────────
  getFuturesTrades: (market, symbol, limit) => request('GET', `/trading/futures/trades/${market}/${symbol}?limit=${limit || 50}`),
  getFuturesIncome: (market, opts) => request('GET', `/trading/futures/income/${market}?${new URLSearchParams(opts || {})}`),
  getFuturesCommission: (market, symbol) => request('GET', `/trading/futures/commission/${market}/${symbol}`),

  // ─── Trade Executor ─────────────────────────────────────────────
  startExecutor: () => request('POST', '/trading/executor/start'),
  stopExecutor: () => request('POST', '/trading/executor/stop'),
  getExecutorStatus: () => request('GET', '/trading/executor/status'),
  executeSignal: (signal) => request('POST', '/trading/executor/signal', signal),
  closePosition: (market, symbol, positionSide) => request('POST', `/trading/executor/close/${market}/${symbol}`, { positionSide }),
  closeAllPositions: (market) => request('POST', '/trading/executor/close-all', { market }),
  getTradingPositions: (market) => request('GET', `/trading/executor/positions${market ? `?market=${market}` : ''}`),
  getDailyStats: () => request('GET', '/trading/executor/daily-stats'),
  getTradeHistory: (date, limit) => request('GET', `/trading/executor/history?${date ? `date=${date}` : `limit=${limit || 20}`}`),
};

export { api };
export default api;
