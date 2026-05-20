import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

/**
 * MarketDataService — real-time price feeds via Binance WebSocket streams.
 * Supports spot + USD-M + COIN-M combined streams.
 * Auto-reconnect with exponential backoff.
 */

const WS_ENDPOINTS = {
  // Live (production)
  spot: 'wss://stream.binance.com:9443/stream',
  usdm: 'wss://fstream.binance.com/stream',
  coinm: 'wss://dstream.binance.com/stream',
  // Demo Mode (realistic data, fake money, same API key from demo.binance.com)
  spotDemo: 'wss://demo-stream.binance.com:9443/stream',
  usdmDemo: 'wss://fstream.binancefuture.com/stream',
  coinmDemo: 'wss://dstream.binancefuture.com/stream',
  // Testnet (old, separate keys)
  spotTestnet: 'wss://testnet.binance.vision/stream',
  usdmTestnet: 'wss://stream.binancefuture.com/stream',
  coinmTestnet: 'wss://dstream.binancefuture.com/stream',
};

class MarketStream {
  constructor(market, mode = 'live') {
    this.market = market;
    this.mode = mode; // 'live' | 'demo' | 'testnet'
    this.ws = null;
    this.subscriptions = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20;
    this.reconnectDelay = 1000;
    this.pingInterval = null;
    this.lastPong = 0;
    this.connected = false;
    this._reconnectTimer = null;
    this._emitter = null;
  }

  setEmitter(emitter) {
    this._emitter = emitter;
  }

  getEndpoint() {
    if (this.mode === 'demo') {
      const key = `${this.market}Demo`;
      return WS_ENDPOINTS[key] || WS_ENDPOINTS[this.market];
    } else if (this.mode === 'testnet') {
      const key = `${this.market}Testnet`;
      return WS_ENDPOINTS[key] || WS_ENDPOINTS[this.market];
    }
    return WS_ENDPOINTS[this.market];
  }

  connect() {
    if (this.ws && this.connected) return;
    const url = this.getEndpoint();

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this._emitter?.emit('stream:error', { market: this.market, error: err.message });
      this._scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastPong = Date.now();
      this._startPing();
      this._emitter?.emit('stream:connected', { market: this.market });

      // Re-subscribe if we had active subscriptions
      if (this.subscriptions.size > 0) {
        this._sendSubscribe([...this.subscriptions]);
      }
    });

    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.stream && msg.data) {
          this._handleStreamData(msg.stream, msg.data);
        }
      } catch { /* ignore parse errors */ }
    });

    this.ws.on('pong', () => {
      this.lastPong = Date.now();
    });

    this.ws.on('close', (code) => {
      this.connected = false;
      this._stopPing();
      this._emitter?.emit('stream:disconnected', { market: this.market, code });
      this._scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this._emitter?.emit('stream:error', { market: this.market, error: err.message });
    });
  }

  disconnect() {
    this.connected = false;
    this._stopPing();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close(1000);
      this.ws = null;
    }
    this.subscriptions.clear();
    this.reconnectAttempts = 0;
  }

  subscribe(streams) {
    for (const s of streams) this.subscriptions.add(s);
    if (this.connected) this._sendSubscribe(streams);
  }

  unsubscribe(streams) {
    for (const s of streams) this.subscriptions.delete(s);
    if (this.connected) this._sendUnsubscribe(streams);
  }

  _sendSubscribe(streams) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now(),
    }));
  }

  _sendUnsubscribe(streams) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      method: 'UNSUBSCRIBE',
      params: streams,
      id: Date.now(),
    }));
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check if pong was received recently
        if (Date.now() - this.lastPong > 30000) {
          this.ws.terminate();
          return;
        }
        this.ws.ping();
      }
    }, 10000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._emitter?.emit('stream:maxReconnect', { market: this.market });
      return;
    }
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this._emitter?.emit('stream:reconnect', { market: this.market, attempt: this.reconnectAttempts, delayMs: delay });
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _handleStreamData(stream, data) {
    // Parse stream name: e.g. btcusdt@aggTrade, btcusdt@kline_1m
    const atIdx = stream.indexOf('@');
    if (atIdx === -1) return;
    const symbol = stream.slice(0, atIdx).toUpperCase();
    const type = stream.slice(atIdx + 1);

    if (type === 'aggTrade') {
      this._emitter?.emit('price:update', {
        symbol, market: this.market,
        price: parseFloat(data.p),
        quantity: parseFloat(data.q),
        timestamp: data.T,
        isBuyerMaker: data.m,
      });
    } else if (type.startsWith('kline_')) {
      const k = data.k;
      this._emitter?.emit('kline:update', {
        symbol, market: this.market,
        interval: k.i,
        kline: {
          openTime: k.t, closeTime: k.T,
          open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: parseFloat(k.c),
          volume: parseFloat(k.v), quoteVolume: parseFloat(k.q),
          trades: k.n, isClosed: k.x,
        },
      });
    } else if (type === 'miniTicker' || type === '24hrMiniTicker') {
      this._emitter?.emit('ticker:update', {
        symbol, market: this.market,
        price: parseFloat(data.c),
        open: parseFloat(data.o),
        high: parseFloat(data.h),
        low: parseFloat(data.l),
        volume: parseFloat(data.v),
        quoteVolume: parseFloat(data.q),
      });
    } else if (type === 'markPrice') {
      this._emitter?.emit('markPrice:update', {
        symbol, market: this.market,
        markPrice: parseFloat(data.p),
        indexPrice: parseFloat(data.i),
        fundingRate: parseFloat(data.r),
        nextFundingTime: data.T,
      });
    }
  }
}

export default MarketStream;
