import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
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
        // Emit synthetic 'connected' event so subscribers (e.g. TestRunner) can recover state
        if (handlersRef.current.has('connected')) {
          handlersRef.current.get('connected').forEach((handler) => handler({ type: 'connected', data: {} }));
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastEvent(data);

          const type = data.type;
          if (type && handlersRef.current.has(type)) {
            handlersRef.current.get(type).forEach((handler) => handler(data));
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
