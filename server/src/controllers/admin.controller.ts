import type { Request, Response } from 'express';
import { Canteen, MenuItem, Order, QRLocation, Wallet, WalletTransaction, type IUser } from '../models';
import { createUser, deleteUserById, findUserById, listUsers as listSupabaseUsers, updateUserById, attachUserProfiles } from '../services/userStore';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { getDashboardStats, getAnalytics } from '../services/analytics.service';
import { getSettings, updateSettings } from '../services/settings.service';
import { generateUniqueToken, syncActiveOrderCounts } from '../services/order.service';
import { applyWalletMovement } from '../services/wallet.service';
import { getOrCreateWallet } from '../services/wallet.service';
import { hashPassword } from '../utils/auth';
import { emitToAdmins, emitToAll, emitToUser, SOCKET_EVENTS } from '../services/realtime.service';
import { paymentRuntimeInfo } from '../services/payment.service';
import { MENU_CATEGORIES } from '../models/MenuItem';

export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  const canteenId = (req.query.canteen as string) || undefined;
  const stats = await getDashboardStats(canteenId);
  const settings = await getSettings();
  res.json({
    ...stats,
    settings: {
      appName: settings.appName,
      taxPercent: settings.taxPercent,
      currencySymbol: settings.currencySymbol,
      autoAcceptOrders: settings.autoAcceptOrders,
      lowStockAlerts: settings.lowStockAlerts,
    },
    payment: paymentRuntimeInfo(),
  });
});

export const analytics = asyncHandler(async (req: Request, res: Response) => {
  const { days, canteen } = req.query as unknown as { days: number; canteen?: string };
  res.json(await getAnalytics(days, canteen));
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const { search, role, status, page, limit, sort } = req.query as unknown as {
    search?: string;
    role?: 'student' | 'admin';
    status: 'all' | 'active' | 'blocked';
    page: number;
    limit: number;
    sort: 'newest' | 'name' | 'orders' | 'spend';
  };

  const { users, total } = await listSupabaseUsers({
    search,
    role,
    blocked: status === 'blocked' ? true : status === 'active' ? false : undefined,
    page,
    limit,
    sort: sort === 'name' ? 'name' : 'newest',
  });

  const userIds = users.map((u) => u.id);
  const [orderAgg, spendAgg, walletAgg] = await Promise.all([
    Order.aggregate([
      { $match: { user: { $in: userIds }, status: { $in: ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'] } } },
      { $group: { _id: '$user', orders: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { user: { $in: userIds }, status: { $in: ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'] } } },
      { $group: { _id: '$user', spend: { $sum: '$total' } } },
    ]),
    Wallet.find({ user: { $in: userIds } }).lean(),
  ]);

  const ordersBy = new Map(orderAgg.map((o) => [String(o._id), o.orders]));
  const spendBy = new Map(spendAgg.map((o) => [String(o._id), o.spend]));
  const walletBy = new Map(walletAgg.map((w) => [String(w.user), w.balance]));

  let enriched = users.map((u) => ({
    ...u,
    orders: ordersBy.get(u.id) ?? 0,
    spend: Math.round((spendBy.get(u.id) ?? 0) * 100) / 100,
    walletBalance: walletBy.get(u.id) ?? 0,
  }));

  if (sort === 'orders') enriched = enriched.sort((a, b) => b.orders - a.orders);
  if (sort === 'spend') enriched = enriched.sort((a, b) => b.spend - a.spend);

  res.json({ users: enriched, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await findUserById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  const [orders, wallet] = await Promise.all([
    Order.find({ user: user.id }).sort({ createdAt: -1 }).limit(20).populate('canteen', 'name code').exec(),
    getOrCreateWallet(user.id),
  ]);
  res.json({
    user,
    wallet: { id: String(wallet._id), balance: wallet.balance },
    orders: orders.map((o) => o.toJSON()),
  });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const { role, isBlocked, blockedReason } = req.body as { role?: 'student' | 'admin'; isBlocked?: boolean; blockedReason?: string };

  if (String(req.params.id) === req.user!.id) {
    if (role && role !== req.user!.role) throw ApiError.badRequest('You cannot change your own role.');
    if (isBlocked) throw ApiError.badRequest('You cannot block your own account.');
  }

  const patch: { role?: 'student' | 'admin'; isBlocked?: boolean; blockedReason?: string | null } = {};
  if (role) patch.role = role;
  if (typeof isBlocked === 'boolean') {
    patch.isBlocked = isBlocked;
    patch.blockedReason = isBlocked ? blockedReason || 'Suspended by canteen admin' : null;
  }
  if (blockedReason !== undefined && isBlocked !== true) patch.blockedReason = blockedReason;

  const user = await updateUserById(req.params.id, patch);
  if (!user) throw ApiError.notFound('User not found.');

  if (patch.role && patch.role !== 'admin') {
    const { emitToUser: toUser } = await import('../services/realtime.service');
    toUser(user.id, 'session:revoked', { message: 'Your account permissions changed. Please sign in again.' });
  }

  res.json({ user, message: `${user.name} updated.` });
});

export const createStaff = asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password, phone } = req.body as { name: string; email: string; password: string; phone?: string };
  const user = await createUser({
    name,
    email: email.toLowerCase(),
    passwordHash: await hashPassword(password),
    phone,
    role: 'admin',
  });
  await getOrCreateWallet(user.id);
  res.status(201).json({ user });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  if (String(req.params.id) === req.user!.id) throw ApiError.badRequest('You cannot delete your own account.');
  const openOrders = await Order.countDocuments({
    user: req.params.id,
    status: { $in: ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'] },
  });
  if (openOrders > 0) throw ApiError.conflict('This user still has active orders.');

  const user = await deleteUserById(req.params.id);
  if (!user) throw ApiError.notFound('User not found.');
  await Promise.all([Wallet.deleteMany({ user: user.id }), WalletTransaction.deleteMany({ user: user.id })]);
  res.json({ success: true, message: `${user.name} removed.` });
});

export const getSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettings();
  res.json({ settings, categories: MENU_CATEGORIES, payment: paymentRuntimeInfo() });
});

export const patchSettings = asyncHandler(async (req: Request, res: Response) => {
  const settings = await updateSettings(req.body as Record<string, never>, req.user!.id);
  emitToAll(SOCKET_EVENTS.CANTEEN_STATUS, { settings: { taxPercent: settings.taxPercent, minOrderValue: settings.minOrderValue, appName: settings.appName } });
  res.json({ settings, message: 'Settings saved.' });
});

/** Token management: shows the format plus a live preview and recent issued tokens. */
export const tokenManagement = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettings();
  const [preview, recent] = await Promise.all([
    Promise.all(Array.from({ length: 5 }, () => generateUniqueToken(settings.tokenLength, settings.tokenPrefix))),
    Order.find({ status: { $in: ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'] } })
      .sort({ createdAt: -1 })
      .limit(15)
      .populate('canteen', 'name code')
      .lean()
      .then((rows) => attachUserProfiles(rows)),
  ]);
  res.json({
    format: `${settings.tokenPrefix || ''}[${settings.tokenLength} random characters]`,
    length: settings.tokenLength,
    prefix: settings.tokenPrefix,
    preview,
    issuedToday: await Order.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
    recent: recent.map((o) => ({
      id: String(o._id),
      token: o.token,
      orderNumber: o.orderNumber,
      status: o.status,
      student: (o.user as unknown as { name?: string })?.name ?? '',
      canteen: (o.canteen as unknown as { name?: string })?.name ?? '',
      createdAt: o.createdAt,
    })),
  });
});

export const adjustWallet = asyncHandler(async (req: Request, res: Response) => {
  const { user, amount, type, reason } = req.body as { user: string; amount: number; type: 'credit' | 'debit'; reason?: string };
  const result = await applyWalletMovement({
    userId: user,
    type: type === 'credit' ? 'CREDIT' : 'DEBIT',
    amount,
    reason: type === 'credit' ? 'ADMIN_CREDIT' : 'ADMIN_DEBIT',
    description: reason || `${type === 'credit' ? 'Credited' : 'Debited'} by canteen admin`,
    reference: `admin:${user}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    performedBy: req.user!.id,
  });
  const summary = await import('../services/wallet.service').then((m) => m.getWalletSummary(user));
  emitToUser(user, SOCKET_EVENTS.WALLET_UPDATED, summary);
  res.json({ wallet: summary, message: `Wallet ${type === 'credit' ? 'credited' : 'debited'} successfully.`, balance: result.balance });
});

export const syncCounters = asyncHandler(async (_req: Request, res: Response) => {
  await syncActiveOrderCounts();
  const canteens = await Canteen.find().select('name code activeOrderCount').lean();
  emitToAdmins(SOCKET_EVENTS.QUEUE, { sync: true, at: new Date().toISOString() });
  res.json({ success: true, message: 'Live order counters resynchronised.', canteens });
});

export const systemHealth = asyncHandler(async (_req: Request, res: Response) => {
  const [menuItems, qrLocations, canteens] = await Promise.all([
    MenuItem.countDocuments(),
    QRLocation.countDocuments(),
    Canteen.countDocuments(),
  ]);
  res.json({
    payment: paymentRuntimeInfo(),
    counts: { menuItems, qrLocations, canteens },
    environment: process.env.NODE_ENV ?? 'development',
    time: new Date().toISOString(),
  });
});