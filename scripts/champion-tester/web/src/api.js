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
  getTimeframes: () => request('GET', '/timeframes'),
  getDatasets: () => request('GET', '/datasets'),
  fetchDataset: (symbol, timeframe, initialLimit) =>
    request('POST', '/datasets/fetch', { symbol, timeframe, initialLimit }),
  deleteDataset: (exchange, symbol, timeframe) =>
    request('DELETE', `/datasets/${exchange}/${symbol}/${timeframe}`),
  getChampions: () => request('GET', '/champions'),
  runTest: (matrixId, symbol, timeframe, slice) =>
    request('POST', '/test/run', { matrixId, symbol, timeframe, slice }),
  getResults: (params = {}) =>
    request('GET', `/results?${new URLSearchParams(params)}`),
  deleteResult: (runId) => request('DELETE', `/results/${runId}`),
  runSweep: (matrixId, datasets) => request('POST', '/sweep/run', { matrixId, datasets }),
  getSweepStatus: () => request('GET', '/sweep/status'),
  cancelSweep: () => request('POST', '/sweep/cancel'),
};

export { api };
export default api;
