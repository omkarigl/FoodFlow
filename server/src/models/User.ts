import type { UserRole } from '../constants';
import type { PublicUser } from '../services/userStore';

/**
 * User accounts live in Supabase Postgres (`public.users`), NOT in MongoDB.
 * This module keeps the shared account TYPES and nothing else — there is no
 * Mongoose model anymore. All persistence goes through `services/userStore.ts`.
 */
export interface IUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  studentId?: string;
  role: UserRole;
  isBlocked: boolean;
  blockedReason?: string;
  lastLoginAt?: string;
  avatarColor: string;
  notificationEmail: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The store already returns this exact shape; kept as a named alias for call sites. */
export type UserDocument = PublicUser;
