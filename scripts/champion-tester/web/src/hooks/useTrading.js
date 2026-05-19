import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export function useTrading() {
  const [status, setStatus] = useState(null);
  const [account, setAccount] = useState(null);
  const [positions, setPositions] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [futuresAccount, setFuturesAccount] = useState(null);
  const [futuresPositions, setFuturesPositions] = useState([]);
  const [futuresOrders, setFuturesOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const statusData = await api.getTradingStatus();
      setStatus(statusData);

      // Spot data
      if (statusData.spot?.connected) {
        const [acct, pos, orders] = await Promise.all([
          api.getTradingAccount().catch(() => null),
          api.getTradingPositions().catch(() => ({ positions: [] })),
          api.getOpenOrders().catch(() => ({ orders: [] })),
        ]);
        if (acct?.account) setAccount(acct.account);
        setPositions(pos.positions || []);
        setOpenOrders(orders.orders || []);
      }

      // Futures data
      const futuresMarkets = statusData.futures?.markets || {};
      const initializedMarkets = Object.entries(futuresMarkets)
        .filter(([, v]) => v.initialized)
        .map(([k]) => k);

      if (initializedMarkets.length > 0) {
        const primaryMarket = initializedMarkets[0];
        const [fAcct, fPos, fOrders] = await Promise.all([
          api.getFuturesAccount(primaryMarket).catch(() => null),
          api.getFuturesPositions(primaryMarket).catch(() => ({ positions: [] })),
          api.getFuturesOpenOrders(primaryMarket).catch(() => ({ orders: [] })),
        ]);
        if (fAcct?.account) setFuturesAccount({ ...fAcct.account, market: primaryMarket });
        setFuturesPositions(fPos.positions || []);
        setFuturesOrders(fOrders.orders || []);
      }

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    status, account, positions, openOrders,
    futuresAccount, futuresPositions, futuresOrders,
    loading, error, refresh,
  };
}
