import { getSymbolRegistry } from './symbol-registry.mjs';
import { getConnector } from './binance-connector.mjs';
import { getFuturesConnector } from './binance-futures-connector.mjs';

/**
 * Market routes — symbol search, tickers, price data.
 * Separated from trading-routes for clarity.
 */
export function registerMarketRoutes(app) {

  // ═══ SYMBOL REGISTRY ══════════════════════════════════════════════

  app.get('/api/markets/symbols/:market', async (req, res) => {
    try {
      const registry = getSymbolRegistry();
      const { market } = req.params;
      const { quoteAsset, baseAsset, contractType, limit } = req.query;

      // Auto-refresh if stale
      if (registry.needsRefresh(market)) {
        await registry.refresh(market);
      }

      const symbols = registry.search('', market, {
        quoteAsset, baseAsset, contractType,
        limit: Math.min(Number(limit) || 100, 500),
      });

      res.json({
        ok: true,
        market,
        count: symbols.length,
        symbols,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/markets/search', async (req, res) => {
    try {
      const registry = getSymbolRegistry();
      const { q, market, quoteAsset, limit } = req.query;

      if (!q || q.length < 1) {
        return res.status(400).json({ ok: false, error: 'Query param "q" required (min 1 char)' });
      }

      // Auto-refresh if stale
      const targetMarket = market || 'all';
      if (registry.needsRefresh(targetMarket === 'all' ? 'spot' : targetMarket)) {
        await registry.refresh(targetMarket === 'all' ? 'all' : targetMarket);
      }

      const results = registry.search(q, targetMarket, {
        quoteAsset,
        limit: Math.min(Number(limit) || 30, 100),
      });

      res.json({ ok: true, query: q, market: targetMarket, count: results.length, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/markets/stats', (req, res) => {
    try {
      const registry = getSymbolRegistry();
      res.json({ ok: true, ...registry.getStats() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/markets/refresh', async (req, res) => {
    try {
      const { market } = req.body;
      const registry = getSymbolRegistry();
      const result = await registry.refresh(market || 'all');
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══ PRICE SNAPSHOT (multi-symbol) ═══════════════════════════════

  app.post('/api/markets/prices', async (req, res) => {
    try {
      const { symbols, market } = req.body;
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return res.status(400).json({ ok: false, error: 'symbols array required' });
      }
      if (symbols.length > 50) {
        return res.status(400).json({ ok: false, error: 'Max 50 symbols per request' });
      }

      const prices = {};
      const targetMarket = market || 'spot';

      if (targetMarket === 'spot') {
        const c = getConnector();
        if (!c.isConnected()) return res.status(400).json({ ok: false, error: 'Spot not connected' });
        for (const sym of symbols) {
          try {
            const p = await c.getPrice(sym);
            prices[sym] = p.price;
          } catch { prices[sym] = null; }
        }
      } else {
        const fc = getFuturesConnector();
        if (!fc.isInitialized(targetMarket)) {
          return res.status(400).json({ ok: false, error: `${targetMarket} not connected` });
        }
        for (const sym of symbols) {
          try {
            const p = await fc.getPrice(targetMarket, sym);
            prices[sym] = Array.isArray(p) ? p[0]?.price : p.price;
          } catch { prices[sym] = null; }
        }
      }

      res.json({ ok: true, market: targetMarket, prices });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══ MARKET DATA SERVICE STATUS ═══════════════════════════════════

  app.get('/api/markets/stream-status', async (req, res) => {
    try {
      const { getMarketDataService } = await import('./market-data-service.mjs');
      const mds = getMarketDataService();
      res.json({ ok: true, ...mds.getStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}
