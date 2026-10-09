import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { tokenStore } from '../lib/api';
import { useAuth } from './AuthContext';
import type { Order, OrderStatus } from '../types';

export interface RealtimeState {
  connected: boolean;
  transport: string;
  lastOrderEventAt: number | null;
  subscribe: (handler: (event: RealtimeEvent) => void) => () => void;
}

export type RealtimeEvent =
  | { type: 'order:new'; order: Order }
  | { type: 'order:status'; order: Order; status: OrderStatus }
  | { type: 'order:updated'; order: Order }
  | { type: 'canteen:status'; canteen: { id?: string; isOpen: boolean; canOrder: boolean; closedMessage?: string } }
  | { type: 'menu:updated'; payload: Record<string, unknown> }
  | { type: 'inventory:updated'; payload: Record<string, unknown> }
  | { type: 'wallet:updated'; wallet: unknown }
  | { type: 'queue'; payload: Record<string, unknown> }
  | { type: string; payload: unknown };

const SocketContext = createContext<RealtimeState | null>(null);

const SERVER_URL = import.meta.env.VITE_SOCKET_URL ?? undefined;

export function SocketProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [transport, setTransport] = useState('polling');
  const [lastOrderEventAt, setLastOrderEventAt] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const handlersRef = useRef(new Set<(event: RealtimeEvent) => void>());
  // Re-key the connection whenever the session changes so login/logout take
  // effect immediately instead of waiting for a full page refresh.
  const { user } = useAuth();
  const sessionKey = user ? `${user.id}:${user.role}` : 'guest';

  const fanOut = useCallback((event: RealtimeEvent) => {
    if (event.type === 'order:new' || event.type === 'order:status' || event.type === 'order:updated') {
      setLastOrderEventAt(Date.now());
    }
    handlersRef.current.forEach((handler) => handler(event));
  }, []);

  useEffect(() => {
    const token = tokenStore.get();
    if (!enabled || !token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return;
    }

    const socket = io(SERVER_URL ?? window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 800,
      reconnectionDelayMax: 6000,
    });

    socket.on('connect', () => {
      setConnected(true);
      setTransport(socket.io.engine.transport.name);
    });
    socket.on('disconnect', () => setConnected(false));
    socket.io.engine.on('upgrade', (transport) => setTransport(transport.name));

    const forward = (type: string) => (payload: unknown) => {
      if (type === 'canteen:status' || type === 'wallet:updated' || type === 'queue') {
        fanOut({ type, payload });
      } else if (type === 'order:new' || type === 'order:status' || type === 'order:updated') {
        fanOut({ type, order: payload as Order } as RealtimeEvent);
      } else {
        fanOut({ type, payload });
      }
    };

    const events = [
      'order:new',
      'order:status',
      'order:updated',
      'canteen:status',
      'menu:updated',
      'inventory:updated',
      'wallet:updated',
      'queue',
    ];
    events.forEach((type) => socket.on(type, forward(type)));

    socketRef.current = socket;

    return () => {
      events.forEach((type) => socket.off(type, forward(type)));
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionKey, fanOut]);

  const subscribe = useCallback((handler: (event: RealtimeEvent) => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const value = useMemo<RealtimeState>(
    () => ({ connected, transport, lastOrderEventAt, subscribe }),
    [connected, transport, lastOrderEventAt, subscribe],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useRealtime(): RealtimeState {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useRealtime must be used inside <SocketProvider>.');
  return ctx;
}