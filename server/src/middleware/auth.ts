import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { safeEqual } from '../utils/tokens';
import type { TokenPayload } from '../utils/auth';
import type { AuthenticatedUser } from '../utils/auth';
import { findUserById } from '../services/userStore';

const TOKEN_COOKIE = 'foodflow_token';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[TOKEN_COOKIE];
  if (cookie) return cookie;
  const q = req.query.accessToken;
  if (typeof q === 'string' && q) return q;
  return null;
}

function decode(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    return null;
  }
}

export const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    signed: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
};

export const clearAuthCookie = (res: Response): void => {
  res.clearCookie(TOKEN_COOKIE, { path: '/' });
};

/** Requires a valid, unblocked user. Loads the fresh DB record (never trusts the token alone). */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized();

  const payload = decode(token);
  if (!payload?.sub) throw ApiError.unauthorized('Your session is invalid or has expired.');

  // Accounts live in Supabase — always load fresh, never trust the token alone.
  const user = await findUserById(payload.sub);
  if (!user) throw ApiError.unauthorized('Your account no longer exists.');
  if (user.isBlocked) throw ApiError.forbidden(user.blockedReason || 'Your account has been suspended by the canteen admin.');
  if (user.role !== payload.role) throw ApiError.unauthorized('Session role mismatch, please sign in again.');

  req.user = {
    id: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  } satisfies AuthenticatedUser;
  next();
});

/** Attaches req.user when a valid token exists but never rejects. */
export const optionalAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractToken(req);
  if (!token) return next();
  const payload = decode(token);
  if (!payload?.sub) return next();
  const user = await findUserById(payload.sub);
  if (!user || user.isBlocked) return next();
  req.user = { id: user.id, role: user.role as 'student' | 'admin', email: user.email, name: user.name };
  next();
});

type Next = (err?: unknown) => void;

export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  requireAuth(req, res, ((err?: unknown) => {
    if (err) return next(err as Error);
    if (req.user?.role !== 'admin') return next(ApiError.forbidden('Admin access required.'));
    next();
  }) as Next);
};

export const requireStudent = (req: Request, res: Response, next: NextFunction): void => {
  requireAuth(req, res, ((err?: unknown) => {
    if (err) return next(err as Error);
    if (req.user?.role !== 'student') return next(ApiError.forbidden('This endpoint is only available to students.'));
    next();
  }) as Next);
};

/** Used by the Socket.IO handshake. */
export function authenticateTokenValue(token: string | undefined): TokenPayload | null {
  if (!token) return null;
  const payload = decode(token);
  if (!payload?.sub) return null;
  if (!safeEqual(payload.sub, payload.sub)) return null;
  return payload;
}

export { TOKEN_COOKIE };