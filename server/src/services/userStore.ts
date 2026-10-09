/**
 * Supabase-backed user store.
 *
 * User ACCOUNTS are the one dataset owned by Supabase Postgres (table `public.users`,
 * see server/supabase/schema.sql). Everything else (menu / orders / wallets) stays in
 * MongoDB. Access goes through PostgREST with the server-side service_role key —
 * no new dependencies, works in the CommonJS build, and the API/frontend contracts
 * are unchanged (same field names and shapes the Mongoose model used to return).
 */
import { config } from '../config/env';
import type { UserRole } from '../constants';
import { ApiError } from '../utils/ApiError';

/** Raw Supabase row (snake_case). */
export interface SupaUserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  phone: string | null;
  student_id: string | null;
  role: UserRole;
  is_blocked: boolean;
  blocked_reason: string | null;
  last_login_at: string | null;
  avatar_color: string;
  notification_email: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Public account shape — byte-compatible with what `User.toJSON()` used to return,
 * so every controller response stays identical for the website and mobile app.
 */
export interface PublicUser {
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

/** Full account including the secret hash — server-side only, never serialized. */
export type UserWithSecret = PublicUser & { passwordHash: string };

const PUBLIC_SELECT =
  'id,name,email,phone,student_id,role,is_blocked,blocked_reason,last_login_at,avatar_color,notification_email,created_at,updated_at';
const SECRET_SELECT = `${PUBLIC_SELECT},password_hash`;

function baseUrl(): string {
  const url = config.supabase.url.replace(/\/+$/, '');
  if (!url) throw ApiError.validation('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return `${url}/rest/v1/users`;
}

function headers(prefer?: string): Record<string, string> {
  return {
    apikey: config.supabase.serviceRoleKey,
    Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

function toPublic(row: SupaUserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.student_id ? { studentId: row.student_id } : {}),
    role: row.role,
    isBlocked: row.is_blocked,
    ...(row.blocked_reason ? { blockedReason: row.blocked_reason } : {}),
    ...(row.last_login_at ? { lastLoginAt: row.last_login_at } : {}),
    avatarColor: row.avatar_color,
    notificationEmail: row.notification_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toUserWithSecret(row: SupaUserRow): UserWithSecret {
  return { ...toPublic(row), passwordHash: row.password_hash };
}

async function sb<T>(path: string, init?: { method?: string; body?: unknown; prefer?: string }): Promise<{ data: T; total: number | null }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init?.method ?? 'GET',
      headers: headers(init?.prefer),
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'The account database is unreachable. Please try again in a moment.');
  }
  if (res.status === 409) {
    throw ApiError.conflict('An account with this email already exists. Please sign in instead.');
  }
  if (!res.ok) {
    let message = `Account database request failed (status ${res.status}).`;
    try {
      const err = (await res.json()) as { message?: string; code?: string };
      if (err?.message) message = err.message;
      if (res.status === 404 && /Could not find the table/i.test(message)) {
        message = 'Supabase `users` table is missing. Run server/supabase/schema.sql in the Supabase SQL Editor.';
      }
    } catch {
      /* keep default */
    }
    throw new ApiError('INTERNAL_ERROR', message);
  }
  const range = res.headers.get('content-range');
  const total = range?.includes('/') ? Number(range.split('/')[1]) : null;
  const data = (await res.json()) as T;
  return { data, total: Number.isFinite(total) ? total : null };
}

/** Boot check: proves the project is reachable AND the `users` table exists. */
export async function checkSupabase(): Promise<void> {
  await sb<unknown[]>(`?select=id&limit=1`);
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  const { data } = await sb<SupaUserRow[]>(`?select=${PUBLIC_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return data[0] ? toPublic(data[0]) : null;
}

export async function findUserWithSecretById(id: string): Promise<UserWithSecret | null> {
  const { data } = await sb<SupaUserRow[]>(`?select=${SECRET_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`);
  return data[0] ? toUserWithSecret(data[0]) : null;
}

export async function findUserByEmail(email: string, withSecret: true): Promise<UserWithSecret | null>;
export async function findUserByEmail(email: string, withSecret?: false): Promise<PublicUser | null>;
export async function findUserByEmail(email: string, includeSecret = false): Promise<PublicUser | UserWithSecret | null> {
  const select = includeSecret ? SECRET_SELECT : PUBLIC_SELECT;
  const { data } = await sb<SupaUserRow[]>(`?select=${select}&email=eq.${encodeURIComponent(email.trim().toLowerCase())}&limit=1`);
  if (!data[0]) return null;
  return includeSecret ? toUserWithSecret(data[0]) : toPublic(data[0]);
}

export async function emailExists(email: string): Promise<boolean> {
  const { data } = await sb<Array<Pick<SupaUserRow, 'id'>>>(`?select=id&email=eq.${encodeURIComponent(email.trim().toLowerCase())}&limit=1`);
  return data.length > 0;
}

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  phone?: string;
  studentId?: string;
  role?: UserRole;
  avatarColor?: string;
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const { data } = await sb<SupaUserRow[]>('', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      password_hash: input.passwordHash,
      phone: input.phone?.trim() || null,
      student_id: input.studentId?.trim() || null,
      role: input.role ?? 'student',
      avatar_color: input.avatarColor ?? '#6366f1',
    },
  });
  if (!data[0]) throw new ApiError('INTERNAL_ERROR', 'Account could not be created.');
  return toPublic(data[0]);
}

export interface UpdateUserInput {
  name?: string;
  phone?: string | null;
  studentId?: string | null;
  passwordHash?: string;
  role?: UserRole;
  isBlocked?: boolean;
  blockedReason?: string | null;
  lastLoginAt?: string | null;
  notificationEmail?: boolean;
  avatarColor?: string;
}

/** Returns null when the account does not exist. */
export async function updateUserById(id: string, patch: UpdateUserInput): Promise<PublicUser | null> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.phone !== undefined) body.phone = patch.phone?.trim() || null;
  if (patch.studentId !== undefined) body.student_id = patch.studentId?.trim() || null;
  if (patch.passwordHash !== undefined) body.password_hash = patch.passwordHash;
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.isBlocked !== undefined) body.is_blocked = patch.isBlocked;
  if (patch.blockedReason !== undefined) body.blocked_reason = patch.blockedReason?.trim() || null;
  if (patch.lastLoginAt !== undefined) body.last_login_at = patch.lastLoginAt;
  if (patch.notificationEmail !== undefined) body.notification_email = patch.notificationEmail;
  if (patch.avatarColor !== undefined) body.avatar_color = patch.avatarColor;
  const { data } = await sb<SupaUserRow[]>(`?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body,
  });
  return data[0] ? toPublic(data[0]) : null;
}

/** Upsert by email — used by the seed script so re-seeding never duplicates. */
export async function upsertUserByEmail(input: CreateUserInput & { isBlocked?: boolean }): Promise<PublicUser> {
  const existing = await findUserByEmail(input.email);
  if (!existing) return createUser(input);
  const updated = await updateUserByEmail(input.email, {
    name: input.name,
    passwordHash: input.passwordHash,
    phone: input.phone,
    studentId: input.studentId,
    role: input.role,
    isBlocked: input.isBlocked ?? false,
  });
  if (!updated) throw new ApiError('INTERNAL_ERROR', 'Account could not be updated.');
  return updated;
}

async function updateUserByEmail(email: string, patch: UpdateUserInput): Promise<PublicUser | null> {
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) body.name = patch.name.trim();
  if (patch.phone !== undefined) body.phone = patch.phone?.trim() || null;
  if (patch.studentId !== undefined) body.student_id = patch.studentId?.trim() || null;
  if (patch.passwordHash !== undefined) body.password_hash = patch.passwordHash;
  if (patch.role !== undefined) body.role = patch.role;
  if (patch.isBlocked !== undefined) body.is_blocked = patch.isBlocked;
  const { data } = await sb<SupaUserRow[]>(`?email=eq.${encodeURIComponent(email.trim().toLowerCase())}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body,
  });
  return data[0] ? toPublic(data[0]) : null;
}

export async function deleteUserById(id: string): Promise<PublicUser | null> {
  const existing = await findUserById(id);
  if (!existing) return null;
  await sb(`?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return existing;
}

/** Deletes EVERY account — seed `--reset` only. */
export async function deleteAllUsers(): Promise<number> {
  const { data } = await sb<SupaUserRow[]>(`?select=id`, {});
  await sb(`?id=not.is.null`, { method: 'DELETE' });
  return data.length;
}

function escapeLike(value: string): string {
  return value.replace(/[,()*\\]/g, '').trim().slice(0, 80);
}

export interface ListUsersQuery {
  search?: string;
  role?: UserRole;
  blocked?: boolean;
  page?: number;
  limit?: number;
  sort?: 'newest' | 'name';
}

export async function listUsers(query: ListUsersQuery): Promise<{ users: PublicUser[]; total: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));
  const params = new URLSearchParams();
  params.set('select', PUBLIC_SELECT);
  if (query.role) params.set('role', `eq.${query.role}`);
  if (query.blocked !== undefined) params.set('is_blocked', `is.${query.blocked}`);
  if (query.search) {
    const q = escapeLike(query.search);
    if (q) params.set('or', `(name.ilike.*${q}*,email.ilike.*${q}*,student_id.ilike.*${q}*,phone.ilike.*${q}*)`);
  }
  params.set('order', query.sort === 'name' ? 'name.asc' : 'created_at.desc');
  params.set('limit', String(limit));
  params.set('offset', String((page - 1) * limit));
  const { data, total } = await sb<SupaUserRow[]>(`?${params.toString()}`, { prefer: 'count=exact' });
  return { users: data.map(toPublic), total: total ?? data.length };
}

/** Matching account ids for the admin order search box (name / email / student id). */
export async function searchUserIds(term: string): Promise<string[]> {
  const q = escapeLike(term);
  if (!q) return [];
  const params = new URLSearchParams({
    select: 'id',
    or: `(name.ilike.*${q}*,email.ilike.*${q}*,student_id.ilike.*${q}*)`,
    limit: '50',
  });
  const { data } = await sb<Array<Pick<SupaUserRow, 'id'>>>(`?${params.toString()}`);
  return data.map((r) => r.id);
}

/** Batch profile lookup for hydrating orders (one round trip, no N+1). */
export async function mapUsersById(ids: string[]): Promise<Map<string, PublicUser>> {  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const params = new URLSearchParams({ select: PUBLIC_SELECT, id: `in.(${unique.map(encodeURIComponent).join(',')})` });
  const { data } = await sb<SupaUserRow[]>(`?${params.toString()}`);
  return new Map(data.map((r) => [r.id, toPublic(r)]));
}

/** Dashboard role counts — same shape the Mongo aggregation used to return. */
export async function countUsersByRole(): Promise<Array<{ _id: string; count: number; blocked: number }>> {
  const [students, admins] = await Promise.all([
    sb<SupaUserRow[]>(`?select=id&role=eq.student`, { prefer: 'count=exact' }),
    sb<SupaUserRow[]>(`?select=id&role=eq.admin`, { prefer: 'count=exact' }),
  ]);
  const [blockedStudents, blockedAdmins] = await Promise.all([
    sb<SupaUserRow[]>(`?select=id&role=eq.student&is_blocked=is.true`, { prefer: 'count=exact' }),
    sb<SupaUserRow[]>(`?select=id&role=eq.admin&is_blocked=is.true`, { prefer: 'count=exact' }),
  ]);
  return [
    { _id: 'student', count: students.total ?? 0, blocked: blockedStudents.total ?? 0 },
    { _id: 'admin', count: admins.total ?? 0, blocked: blockedAdmins.total ?? 0 },
  ];
}

/** Signups per day — same shape the Mongo aggregation used to return. */
export async function countSignupsByDay(from: Date): Promise<Array<{ _id: string; count: number }>> {
  const { data } = await sb<Array<Pick<SupaUserRow, 'created_at'>>>(`?select=created_at&created_at=gte.${encodeURIComponent(from.toISOString())}&order=created_at.asc&limit=10000`);
  const byDay = new Map<string, number>();
  for (const row of data) {
    const day = String(row.created_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].map(([_id, count]) => ({ _id, count }));
}

export async function countAllUsers(): Promise<number> {
  const { total } = await sb<unknown[]>(`?select=id&limit=1`, { prefer: 'count=exact' });
  return total ?? 0;
}

/**
 * Attaches account profiles to plain (serialized) order objects, replacing the
 * old Mongoose `populate('user')`. Orders whose owner no longer exists keep
 * their raw id string. Shape matches the previously populated subdocument.
 */
export async function attachUserProfiles<T extends { user?: unknown }>(orders: T[]): Promise<T[]> {
  const ids = orders.map((o) => (typeof o.user === 'string' && o.user ? o.user : null)).filter((v): v is string => v !== null);
  if (ids.length === 0) return orders;
  const map = await mapUsersById(ids);
  for (const order of orders) {
    if (typeof order.user === 'string') {
      const profile = map.get(order.user);
      if (profile) {
        order.user = {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          ...(profile.phone ? { phone: profile.phone } : {}),
          ...(profile.studentId ? { studentId: profile.studentId } : {}),
          role: profile.role,
        };
      }
    }
  }
  return orders;
}
