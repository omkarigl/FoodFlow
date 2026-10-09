import type { Request, Response } from 'express';
import { Wallet, type IUser } from '../models';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { clearAuthCookie, setAuthCookie } from '../middleware/auth';
import { getOrCreateWallet, getWalletSummary } from '../services/wallet.service';
import { signAccessToken, hashPassword, verifyPassword } from '../utils/auth';
import { randomToken } from '../utils/tokens';
import {
  createUser,
  deleteUserById,
  findUserByEmail,
  findUserById,
  findUserWithSecretById,
  updateUserById,
  type PublicUser,
} from '../services/userStore';

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

function issueSession(res: Response, user: Pick<PublicUser, 'id' | 'role' | 'email' | 'name'>) {
  const token = signAccessToken({ sub: user.id, role: user.role, email: user.email, name: user.name });
  setAuthCookie(res, token);
  return token;
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, phone, studentId } = req.body as {
    name: string;
    email: string;
    password: string;
    phone?: string;
    studentId?: string;
  };

  const existing = await findUserByEmail(email);
  if (existing) throw ApiError.conflict('An account with this email already exists. Please sign in instead.');

  const user = await createUser({
    name,
    email,
    passwordHash: await hashPassword(password),
    phone,
    studentId,
    role: 'student',
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  });

  await getOrCreateWallet(user.id);
  const token = issueSession(res, user);

  res.status(201).json({
    user,
    wallet: await getWalletSummary(user.id),
    token,
    // Spec alias: the PDF/API guide calls this `access_token`.
    access_token: token,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, role } = req.body as { email: string; password: string; role?: 'student' | 'admin' };

  const user = await findUserByEmail(email, true);
  if (!user) {
    // Spend the same time as a real comparison to limit user enumeration via timing.
    await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw ApiError.unauthorized('Incorrect email or password.');
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.unauthorized('Incorrect email or password.');

  // Only enforce the role gate when the client explicitly asked for a role.
  // Spec login sends {email, password} only and must work for both roles.
  if (role && user.role !== role) {
    throw ApiError.forbidden(
      role === 'admin'
        ? 'This account does not have canteen admin access.'
        : 'Please use the canteen admin portal to sign in with this account.',
    );
  }
  if (user.isBlocked) throw ApiError.forbidden(user.blockedReason || 'Your account has been suspended.');

  await updateUserById(user.id, { lastLoginAt: new Date().toISOString() });

  const token = issueSession(res, user);
  const wallet = await getWalletSummary(user.id);

  const { passwordHash: _secret, ...publicUser } = user;
  res.json({ user: publicUser, wallet, token, access_token: token });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await findUserById(req.user!.id);
  if (!user) throw ApiError.notFound('Account not found.');
  res.json({ user, wallet: await getWalletSummary(user.id) });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  res.json({ success: true, message: 'Signed out successfully.' });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  const patch = req.body as Partial<Pick<IUser, 'name' | 'phone' | 'studentId' | 'notificationEmail'>>;
  const user = await updateUserById(req.user!.id, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.studentId !== undefined ? { studentId: patch.studentId } : {}),
    ...(patch.notificationEmail !== undefined ? { notificationEmail: patch.notificationEmail } : {}),
  });
  if (!user) throw ApiError.notFound('Account not found.');
  res.json({ user, message: 'Profile updated.' });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  const user = await findUserWithSecretById(req.user!.id);
  if (!user) throw ApiError.notFound('Account not found.');

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw ApiError.badRequest('Your current password is incorrect.');

  await updateUserById(user.id, { passwordHash: await hashPassword(newPassword) });
  res.json({ success: true, message: 'Password updated successfully.' });
});

export const deleteAccount = asyncHandler(async (req: Request, res: Response) => {
  const { password } = req.body as { password: string };
  const user = await findUserWithSecretById(req.user!.id);
  if (!user) throw ApiError.notFound('Account not found.');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw ApiError.badRequest('Password is incorrect.');

  const { Order } = await import('../models');
  const openOrders = await Order.countDocuments({
    user: user.id,
    status: { $in: ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'] },
  });
  if (openOrders > 0) throw ApiError.conflict('You still have active orders. Please wait until they are completed.');

  const wallet = await Wallet.findOne({ user: user.id }).lean();
  if (wallet && wallet.balance > 0) {
    throw ApiError.conflict('Your wallet still has a balance. Please contact the canteen admin to withdraw it.');
  }

  await Promise.all([deleteUserById(user.id), Wallet.deleteMany({ user: user.id })]);
  clearAuthCookie(res);
  res.json({ success: true, message: 'Your account has been deleted.' });
});

/** Rotates the JWT so the client can silently refresh its session token. */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const user = await findUserById(req.user!.id);
  if (!user) throw ApiError.unauthorized('Account not found.');
  if (user.isBlocked) throw ApiError.forbidden(user.blockedReason || 'Your account has been suspended.');
  const token = issueSession(res, user);
  res.json({ token, access_token: token, user });
});

/** Small helper used by the student profile page to preview a token sample. */
export const sampleToken = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ token: randomToken(4) });
});
