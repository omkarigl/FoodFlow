import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { authenticateTokenValue } from '../middleware/auth';

export const SOCKET_EVENTS = {
  ORDER_NEW: 'order:new',
  ORDER_UPDATED: 'order:updated',
  ORDER_STATUS: 'order:status',
  QUEUE: 'queue:update',
  CANTEEN_STATUS: 'canteen:status',
  MENU_UPDATED: 'menu:updated',
  INVENTORY_UPDATED: 'inventory:updated',
  WALLET_UPDATED: 'wallet:updated',
  DASHBOARD: 'dashboard:stats',
  CONNECTED: 'realtime:ready',
} as const;

let io: IOServer | null = null;

const userRoom = (userId: string) => `user:${userId}`;
const canteenRoom = (canteenId: string) => `canteen:${canteenId}`;
const ADMIN_ROOM = 'admins';

export function initRealtime(httpServer: HttpServer): IOServer {
  io = new IOServer(httpServer, {
    cors: {
      origin: [config.clientUrl, ...config.extraOrigins],
      credentials: true,
    },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.query?.token as string | undefined) ||
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    const payload = authenticateTokenValue(token);
    if (!payload) return next(new Error('unauthorized'));
    socket.data.user = { id: payload.sub, role: payload.role, name: (socket.handshake.auth?.name as string) ?? '' };
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: string; role: 'student' | 'admin' };
    void socket.join(userRoom(user.id));
    if (user.role === 'admin') {
      void socket.join(ADMIN_ROOM);
      // Admins watch every canteen's live queue.
      socket.on('subscribe:canteen', (canteenId: string) => {
        if (typeof canteenId === 'string' && canteenId) void socket.join(canteenRoom(canteenId));
      });
      socket.on('unsubscribe:canteen', (canteenId: string) => {
        if (typeof canteenId === 'string') void socket.leave(canteenRoom(canteenId));
      });
    } else {
      socket.on('subscribe:canteen', (canteenId: string) => {
        if (typeof canteenId === 'string' && canteenId) void socket.join(canteenRoom(canteenId));
      });
    }

    logger.debug('socket', `${user.role} ${user.id} connected (${socket.id})`);
    socket.emit(SOCKET_EVENTS.CONNECTED, { userId: user.id, role: user.role, at: new Date().toISOString() });

    socket.on('disconnect', (reason) => {
      logger.debug('socket', `${user.id} disconnected (${reason})`);
    });
  });

  logger.info('socket', 'Realtime gateway ready on /socket.io');
  return io;
}

export function getIO(): IOServer | null {
  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown): void {
  io?.to(ADMIN_ROOM).emit(event, payload);
}

export function emitToCanteen(canteenId: string, event: string, payload: unknown): void {
  io?.to(canteenRoom(canteenId)).emit(event, payload);
}

export function emitToAll(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

/** Single fan-out helper used by the order service for every state transition. */
export function publishOrderEvent(event: typeof SOCKET_EVENTS.ORDER_NEW | typeof SOCKET_EVENTS.ORDER_UPDATED | typeof SOCKET_EVENTS.ORDER_STATUS, order: unknown): void {
  if (!io) return;
  const payload = order as { user?: unknown; canteen?: unknown };
  const userId = payload.user && typeof payload.user === 'object' ? String((payload.user as { _id?: unknown })._id ?? '') : String(payload.user ?? '');
  const canteenId = payload.canteen && typeof payload.canteen === 'object' ? String((payload.canteen as { _id?: unknown })._id ?? '') : String(payload.canteen ?? '');
  if (userId) emitToUser(userId, event, order);
  if (canteenId) emitToCanteen(canteenId, event, order);
  emitToAdmins(event, order);
}

export function shutdownRealtime(): void {
  io?.close();
  io = null;
}