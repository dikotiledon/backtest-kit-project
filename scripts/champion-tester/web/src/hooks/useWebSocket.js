import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const handlersRef = useRef(new Map());

  const subscribe = useCallback((type, handler) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type).add(handler);

    return () => {
      const set = handlersRef.current.get(type);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          handlersRef.current.delete(type);
        }
      }
    };
  }, []);

  useEffect(() => {
    function connect() {
      const url = `ws://${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
        // Emit synthetic 'connected' event so subscribers (e.g. TestRunner) can recover state
        if (handlersRef.current.has('connected')) {
          handlersRef.current.get('connected').forEach((handler) => handler({ type: 'connected', data: {} }));
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
        reconnectAttemptRef.current++;
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          setLastEvent(msg);

          const type = msg.type;
          if (type && handlersRef.current.has(type)) {
            // Pass only the data payload to handlers, not the full envelope
            handlersRef.current.get(type).forEach((handler) => handler(msg.data || msg));
          }
        } catch {
          // ignore non-JSON messages
        }
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { connected, lastEvent, subscribe };
}
