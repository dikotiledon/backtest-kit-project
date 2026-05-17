import fs from 'node:fs/promises';
import path from 'node:path';

export class ResultsStore {
  constructor(resultsDir) {
    this.resultsDir = resultsDir;
  }

  async init() {
    await fs.mkdir(this.resultsDir, { recursive: true });
  }

  _filename(result) {
    const ts = result.timestamp.replace(/[:.]/g, '-');
    return `${ts}_${result.dataset.symbol}_${result.dataset.timeframe}.json`;
  }

  async save(result) {
    await this.init();
    const filename = this._filename(result);
    const filePath = path.join(this.resultsDir, filename);
    await fs.writeFile(filePath, JSON.stringify(result, null, 2), 'utf8');
    return { filename, filePath };
  }

  async list({ symbol, timeframe, limit = 50, sort = 'timestamp', order = 'desc' } = {}) {
    await this.init();
    const files = await fs.readdir(this.resultsDir);
    const results = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (symbol && result.dataset?.symbol !== symbol) continue;
        if (timeframe && result.dataset?.timeframe !== timeframe) continue;
        results.push(result);
      } catch { /* skip malformed */ }
    }

    results.sort((a, b) => {
      const aVal = sort === 'timestamp' ? a.timestamp : (a.metrics?.[sort] ?? 0);
      const bVal = sort === 'timestamp' ? b.timestamp : (b.metrics?.[sort] ?? 0);
      if (order === 'desc') return aVal > bVal ? -1 : 1;
      return aVal < bVal ? -1 : 1;
    });

    return { total: results.length, results: results.slice(0, limit) };
  }

  async get(runId) {
    await this.init();
    const files = await fs.readdir(this.resultsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (result.runId === runId) return result;
      } catch { /* skip */ }
    }
    return null;
  }

  async delete(runId) {
    await this.init();
    const files = await fs.readdir(this.resultsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.resultsDir, file), 'utf8');
        const result = JSON.parse(raw);
        if (result.runId === runId) {
          await fs.unlink(path.join(this.resultsDir, file));
          return true;
        }
      } catch { /* skip */ }
    }
    return false;
  }
}
