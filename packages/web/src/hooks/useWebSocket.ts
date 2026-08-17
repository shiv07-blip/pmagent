import { useEffect, useRef, useCallback, useState } from 'react';

export interface WsEvent {
  tenantId: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

export function useWebSocket(token: string | null, tenantId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WsEvent[]>([]);

  const connect = useCallback(() => {
    if (!token || !tenantId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/api/ws?token=${token}&tenant=${tenantId}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 3000);
    };
    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as WsEvent;
        setEvents((prev) => [event, ...prev].slice(0, 100));
      } catch {}
    };

    wsRef.current = ws;
  }, [token, tenantId]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, events };
}
