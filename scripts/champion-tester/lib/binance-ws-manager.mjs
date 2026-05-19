import { EventEmitter } from 'node:events';

/**
 * BinanceWSManager — robust WebSocket manager with auto-reconnect,
 * heartbeat monitoring, multi-stream support, and graceful degradation.
 *
 * Supports: Spot, USD-M Futures, and COIN-M Futures WebSocket streams.
 */

const WS_ENDPOINTS = {
  spot: 'wss://stream.binance.com:9443/ws',
  spotTestnet: 'wss://testnet.binance.vision/ws',
  usdm: 'wss://fstream.binance.com/ws',
  usdmTestnet: 'wss://stream.binancefuture.com/ws',
  coinm: 'wss://dstream.binance.com/ws',
  coinmTestnet: 'wss://dstream.binancefuture.com/ws',
};

const COMBINED_ENDPOINTS = {
  spot: 'wss://stream.binance.com:9443/stream',
  spotTestnet: 'wss://testnet.binance.vision/stream',
  usdm: 'wss://fstream.binance.com/stream',
  usdmTestnet: 'wss://stream.binancefuture.com/stream',
  coinm: 'wss://dstream.binance.com/stream',
  coinmTestnet: 'wss://dstream.binancefuture.com/stream',
};

export class BinanceWSManager extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.connections = new Map(); // id -> WSConnection
    this.testnet = opts.testnet ?? true;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 10;
    this.reconnectBaseDelay = opts.reconnectBaseDelay ?? 1000;
    this.heartbeatInterval = opts.heartbeatInterval ?? 30000;
    this.pingTimeout = opts.pingTimeout ?? 10000;
  }

  /**
   * Open a WebSocket stream
   * @param {object} opts
   * @param {string} opts.id - Unique connection identifier
   * @param {string} opts.market - 'spot' | 'usdm' | 'coinm'
   * @param {string[]} opts.streams - Stream names (e.g., ['btcusdt@trade', 'btcusdt@kline_1m'])
   * @param {string} [opts.listenKey] - User data stream listen key
   * @param {function} opts.onMessage - Message handler
   */
  open(opts) {
    const { id, market, streams = [], listenKey, onMessage } = opts;

    if (this.connections.has(id)) {
      this.close(id);
    }

    const conn = new WSConnection({
      id,
      market,
      streams,
      listenKey,
      testnet: this.testnet,
      maxReconnectAttempts: this.maxReconnectAttempts,
      reconnectBaseDelay: this.reconnectBaseDelay,
      heartbeatInterval: this.heartbeatInterval,
      pingTimeout: this.pingTimeout,
      onMessage,
      onStateChange: (state) => this.emit('connection:state', { id, state }),
      onError: (err) => this.emit('connection:error', { id, error: err }),
      onReconnect: (attempt) => this.emit('connection:reconnect', { id, attempt }),
    });

    this.connections.set(id, conn);
    conn.connect();
    return conn;
  }

  /**
   * Close a specific connection
   */
  close(id) {
    const conn = this.connections.get(id);
    if (conn) {
      conn.destroy();
      this.connections.delete(id);
    }
  }

  /**
   * Close all connections
   */
  closeAll() {
    for (const [id, conn] of this.connections) {
      conn.destroy();
    }
    this.connections.clear();
  }

  /**
   * Subscribe to additional streams on an existing connection
   */
  subscribe(id, streams) {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection ${id} not found`);
    conn.subscribe(streams);
  }

  /**
   * Unsubscribe from streams on an existing connection
   */
  unsubscribe(id, streams) {
    const conn = this.connections.get(id);
    if (!conn) throw new Error(`Connection ${id} not found`);
    conn.unsubscribe(streams);
  }

  /**
   * Get status of all connections
   */
  getStatus() {
    const status = {};
    for (const [id, conn] of this.connections) {
      status[id] = conn.getStatus();
    }
    return status;
  }

  /**
   * Check if a specific connection is alive
   */
  isAlive(id) {
    const conn = this.connections.get(id);
    return conn ? conn.state === 'connected' : false;
  }
}

/**
 * Individual WebSocket connection with auto-reconnect and heartbeat
 */
class WSConnection {
  constructor(opts) {
    this.id = opts.id;
    this.market = opts.market;
    this.streams = [...opts.streams];
    this.listenKey = opts.listenKey || null;
    this.testnet = opts.testnet;
    this.maxReconnectAttempts = opts.maxReconnectAttempts;
    this.reconnectBaseDelay = opts.reconnectBaseDelay;
    this.heartbeatInterval = opts.heartbeatInterval;
    this.pingTimeout = opts.pingTimeout;
    this.onMessage = opts.onMessage;
    this.onStateChange = opts.onStateChange;
    this.onError = opts.onError;
    this.onReconnect = opts.onReconnect;

    this.ws = null;
    this.state = 'disconnected'; // disconnected | connecting | connected | reconnecting
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.pongTimer = null;
    this.destroyed = false;
    this.lastMessageTime = 0;
    this.messageCount = 0;
    this._subId = 1;
  }

  connect() {
    if (this.destroyed) return;
    this._setState('connecting');

    const url = this._buildURL();

    try {
      // Dynamic import for WebSocket (works in Node.js)
      this._createWebSocket(url);
    } catch (err) {
      this.onError(err);
      this._scheduleReconnect();
    }
  }

  async _createWebSocket(url) {
    // Use the ws package (already a dependency)
    const { default: WebSocket } = await import('ws');

    this.ws = new WebSocket(url, {
      handshakeTimeout: 10000,
      perMessageDeflate: false,
    });

    this.ws.on('open', () => {
      this._setState('connected');
      this.reconnectAttempts = 0;
      this._startHeartbeat();

      // If we have a listenKey, subscribe to user data
      if (this.listenKey && this.streams.length === 0) {
        // Already connected to listenKey endpoint
      }
    });

    this.ws.on('message', (data) => {
      this.lastMessageTime = Date.now();
      this.messageCount++;

      try {
        const parsed = JSON.parse(data.toString());

        // Handle combined stream format
        if (parsed.stream && parsed.data) {
          this.onMessage({ stream: parsed.stream, ...parsed.data });
        } else if (parsed.result === null && parsed.id) {
          // Subscription confirmation — ignore
        } else {
          this.onMessage(parsed);
        }
      } catch (err) {
        this.onError(new Error(`WS parse error: ${err.message}`));
      }
    });

    this.ws.on('pong', () => {
      if (this.pongTimer) {
        clearTimeout(this.pongTimer);
        this.pongTimer = null;
      }
    });

    this.ws.on('close', (code, reason) => {
      this._stopHeartbeat();
      if (!this.destroyed) {
        this._scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      this.onError(err);
    });
  }

  _buildURL() {
    const marketKey = this.testnet ? `${this.market}Testnet` : this.market;

    // User data stream
    if (this.listenKey) {
      const base = WS_ENDPOINTS[marketKey] || WS_ENDPOINTS[this.market];
      return `${base}/${this.listenKey}`;
    }

    // Combined streams
    if (this.streams.length > 1) {
      const base = COMBINED_ENDPOINTS[marketKey] || COMBINED_ENDPOINTS[this.market];
      return `${base}?streams=${this.streams.join('/')}`;
    }

    // Single stream
    if (this.streams.length === 1) {
      const base = WS_ENDPOINTS[marketKey] || WS_ENDPOINTS[this.market];
      return `${base}/${this.streams[0]}`;
    }

    // Base connection (for dynamic subscribe)
    return WS_ENDPOINTS[marketKey] || WS_ENDPOINTS[this.market];
  }

  subscribe(streams) {
    if (!this.ws || this.state !== 'connected') return;
    const newStreams = streams.filter(s => !this.streams.includes(s));
    if (newStreams.length === 0) return;

    this.streams.push(...newStreams);
    this.ws.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: newStreams,
      id: this._subId++,
    }));
  }

  unsubscribe(streams) {
    if (!this.ws || this.state !== 'connected') return;
    this.streams = this.streams.filter(s => !streams.includes(s));
    this.ws.send(JSON.stringify({
      method: 'UNSUBSCRIBE',
      params: streams,
      id: this._subId++,
    }));
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.state === 'connected') {
        this.ws.ping();
        this.pongTimer = setTimeout(() => {
          // No pong received — connection is dead
          this.onError(new Error('Heartbeat timeout — no pong'));
          this.ws?.terminate();
        }, this.pingTimeout);
      }
    }, this.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  _scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this._setState('disconnected');
      this.onError(new Error(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`));
      return;
    }

    this._setState('reconnecting');
    this.reconnectAttempts++;
    this.onReconnect(this.reconnectAttempts);

    const delay = Math.min(
      this.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000,
      30000
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  _setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange(state);
    }
  }

  getStatus() {
    return {
      id: this.id,
      market: this.market,
      state: this.state,
      streams: this.streams,
      reconnectAttempts: this.reconnectAttempts,
      lastMessageTime: this.lastMessageTime,
      messageCount: this.messageCount,
      hasListenKey: !!this.listenKey,
    };
  }

  destroy() {
    this.destroyed = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    this._setState('disconnected');
  }
}

export default BinanceWSManager;
