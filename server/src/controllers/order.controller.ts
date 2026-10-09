import type { Request, Response } from 'express';
import type { HydratedDocument } from 'mongoose';
import { Canteen, MenuItem, Order, QRLocation, type IOrder } from '../models';
import { ApiError, asyncHandler } from '../utils/ApiError';
import {
  assertGuestClaim,
  createGuestOrder,
  createOrder,
  getOpenOrdersForUser,
  hydrateOrder,
  loadOrderWithClaim,
  payOrderWithWallet,
  sanitizeOrder,
  settleGuestOrderPayment,
  settleOrderPayment,
  transitionOrder,
} from '../services/order.service';
import type { OrderStatus } from '../constants';
import { attachUserProfiles, searchUserIds } from '../services/userStore';

const ACTIVE_STATUSES: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'];
// Accounts live in Supabase now — owner profiles are attached from there
// (attachUserProfiles) instead of Mongoose populate('user').
const POPULATE = [
  { path: 'canteen', select: 'name code block isOpen prepTimeMins' },
  { path: 'qrLocation', select: 'code label block tableHint' },
  { path: 'items.menuItem', select: 'name imageUrl emoji category' },
];

export const placeOrder = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    canteen: string;
    qrLocation?: string;
    qrLocationCode?: string;
    items: Array<{ menuItem: string; quantity: number; notes?: string }>;
    paymentMethod: 'razorpay' | 'wallet';
    note?: string;
  };

  // Spec flow: guests call the SAME POST /api/orders with no auth header.
  // Branch to the guest checkout (Razorpay-only) when there is no session.
  if (!req.user) {
    if (body.paymentMethod === 'wallet') throw ApiError.badRequest('Wallet is only available to signed-in students.');
    const { createGuestOrder: createGuest } = await import('../services/order.service');
    const { order, gateway, guestClaimToken } = await createGuest({
      canteenId: body.canteen,
      qrLocationId: body.qrLocation,
      qrLocationCode: body.qrLocationCode,
      lines: body.items,
      note: body.note,
    });
    const hydrated = await hydrateOrder(order._id);
    const { emitToAdmins, publishOrderEvent, SOCKET_EVENTS } = await import('../services/realtime.service');
    publishOrderEvent(SOCKET_EVENTS.ORDER_NEW, hydrated);
    emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });
    const safe = sanitizeOrder(hydrated);
    res.status(201).json({ order: safe, gateway, guestClaimToken, orderId: String(order._id) });
    return;
  }

  if (req.user.role !== 'student') throw ApiError.forbidden('This endpoint is only available to students.');

  // Frontend prices/totals are ignored entirely; the server prices from the database.
  const { order, gateway } = await createOrder({
    userId: req.user!.id,
    canteenId: body.canteen,
    qrLocationId: body.qrLocation,
    qrLocationCode: body.qrLocationCode,
    lines: body.items,
    paymentMethod: body.paymentMethod,
    note: body.note,
  });

  // Wallet checkout settles immediately: the balance is verified and debited server-side
  // before the order is ever handed to the kitchen.
  if (body.paymentMethod === 'wallet') {
    const paid = await payOrderWithWallet(String(order._id), req.user!.id);
    res.status(201).json({ order: paid, gateway: null });
    return;
  }

  const hydrated = await hydrateOrder(order._id);
  const { emitToAdmins, publishOrderEvent, SOCKET_EVENTS } = await import('../services/realtime.service');
  publishOrderEvent(SOCKET_EVENTS.ORDER_NEW, hydrated);
  emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });

  res.status(201).json({ order: hydrated, gateway });
});

export const payWithWallet = asyncHandler(async (req: Request, res: Response) => {
  const order = await payOrderWithWallet(req.params.id, req.user!.id);
  res.json({ order });
});

/** Student order history with filters and pagination. */
export const myOrders = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as unknown as { status?: string };
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
  const filter: Record<string, unknown> = { user: req.user!.id };

  if (status === 'active') filter.status = { $in: ACTIVE_STATUSES };
  else if (status && status !== 'all') filter.status = status;

  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate(POPULATE).exec(),
    Order.countDocuments(filter),
  ]);

  res.json({
    orders: await attachUserProfiles(orders.map((o) => o.toJSON())),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  });
});

/** Public guest checkout — no account required. Returns a claim token for tracking/payment. */
export const placeGuestOrder = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    canteen: string;
    qrLocation?: string;
    qrLocationCode?: string;
    items: Array<{ menuItem: string; quantity: number; notes?: string }>;
    note?: string;
  };

  const { order, gateway, guestClaimToken } = await createGuestOrder({
    canteenId: body.canteen,
    qrLocationId: body.qrLocation,
    qrLocationCode: body.qrLocationCode,
    lines: body.items,
    note: body.note,
  });

  const hydrated = await hydrateOrder(order._id);
  const { emitToAdmins, publishOrderEvent, SOCKET_EVENTS } = await import('../services/realtime.service');
  publishOrderEvent(SOCKET_EVENTS.ORDER_NEW, hydrated);
  emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });

  const safe = sanitizeOrder(hydrated);
  res.status(201).json({ order: safe, gateway, guestClaimToken, orderId: String(order._id) });
});

/** Public guest tracking — order id + claim token, no login. */
export const getGuestOrder = asyncHandler(async (req: Request, res: Response) => {
  const claim = (req.query.claim as string) ?? (req.headers['x-guest-claim'] as string) ?? req.body?.guestClaimToken;
  const order = await loadOrderWithClaim(req.params.id);
  assertGuestClaim(order, claim);
  const hydrated = await hydrateOrder(order._id);
  res.json({ order: sanitizeOrder(hydrated) });
});

export const cancelGuestOrder = asyncHandler(async (req: Request, res: Response) => {
  const { guestClaimToken, reason } = req.body as { guestClaimToken?: string; reason?: string };
  const order = await loadOrderWithClaim(req.params.id);
  if (!order.isGuest) throw ApiError.badRequest('This order belongs to a registered account. Please sign in.');
  assertGuestClaim(order, guestClaimToken);
  const updated = await transitionOrder({
    orderId: String(order._id),
    nextStatus: 'CANCELLED',
    actorId: undefined,
    actorRole: 'system',
    reason: reason ?? 'Cancelled during checkout',
  });
  res.json({ order: sanitizeOrder(updated), message: 'Order cancelled.' });
});

export const verifyGuestPaymentController = asyncHandler(async (req: Request, res: Response) => {
  const { guestClaimToken, gatewayOrderId, gatewayPaymentId, gatewaySignature } = req.body as {
    guestClaimToken: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    gatewaySignature: string;
  };
  const order = await settleGuestOrderPayment({
    orderId: req.params.id,
    guestClaimToken,
    gatewayOrderId,
    gatewayPaymentId,
    gatewaySignature,
  });
  res.json({ order, message: 'Payment verified. Your order token is ready.' });
});

export const currentOrders = asyncHandler(async (req: Request, res: Response) => {
  const orders = await getOpenOrdersForUser(req.user!.id);
  res.json({ orders: await attachUserProfiles(orders.map((o) => o.toJSON())) });
});

export const getOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await Order.findById(req.params.id).select('+guestClaimToken').populate(POPULATE).exec();
  if (!order) throw ApiError.notFound('Order not found.');

  // Guest orders: allow the claim token as an alternative to a session.
  // Spec flow polls GET /api/orders/:id with ?claim= and no auth header.
  const raw = order as unknown as { isGuest?: boolean; guestClaimToken?: string };
  if (raw.isGuest) {
    const claim = (req.query.claim as string) ?? (req.headers['x-guest-claim'] as string);
    if (claim && raw.guestClaimToken) {
      const { safeEqual } = await import('../utils/tokens');
      if (safeEqual(String(claim), String(raw.guestClaimToken))) {
        const obj = order.toObject() as unknown as Record<string, unknown>;
        delete obj.guestClaimToken;
        res.json({ order: obj });
        return;
      }
    }
  }

  if (!req.user) throw ApiError.unauthorized('Sign in to view this order, or use your guest tracking link.');

  // Owner is a Supabase account id string (never populated on the document).
  const ownerId = typeof order.user === 'string' ? order.user : String(order.user ?? '');
  if (ownerId !== req.user!.id && req.user!.role !== 'admin') throw ApiError.forbidden('You do not have access to this order.');

  const obj = order.toObject() as unknown as Record<string, unknown>;
  delete obj.guestClaimToken;
  const [withUser] = await attachUserProfiles([obj as { user?: unknown }]);
  res.json({ order: withUser });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { status, note, reason } = req.body as { status: OrderStatus; note?: string; reason?: string };
  const order = await transitionOrder({
    orderId: req.params.id,
    nextStatus: status,
    actorId: req.user!.id,
    actorRole: req.user!.role,
    note,
    reason,
  });
  res.json({ order, message: `Order moved to ${status.replace(/_/g, ' ').toLowerCase()}.` });
});

/** Admin live queue. */
export const adminOrders = asyncHandler(async (req: Request, res: Response) => {
  const { status, scope, canteen, search } = req.query as unknown as {
    status?: string;
    scope: 'mine' | 'all';
    canteen?: string;
    search?: string;
  };
  const page = Math.max(1, Number(req.query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));

  const filter: Record<string, unknown> = {};
  if (canteen) filter.canteen = canteen;

  if (!status || status === 'active') filter.status = { $in: ACTIVE_STATUSES };
  else if (status !== 'all') filter.status = status;

  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const or: Record<string, unknown>[] = [{ token: rx }, { note: rx }];
    // Accounts live in Supabase — resolve matching account ids first.
    const matchedIds = await searchUserIds(search);
    if (matchedIds.length > 0) or.push({ user: { $in: matchedIds } });
    const asNum = Number(search);
    if (Number.isFinite(asNum)) or.push({ orderNumber: asNum });
    filter.$or = or;
  }

  const [orders, total, counts] = await Promise.all([
    Order.find(filter).sort({ placedAt: -1 }).skip((page - 1) * limit).limit(limit).populate(POPULATE).exec(),
    Order.countDocuments(filter),
    Order.aggregate([{ $match: canteen ? { canteen } : {} }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  res.json({
    orders: await attachUserProfiles(orders.map((o) => o.toJSON())),
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    counts: counts.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c._id]: c.count }), {}),
    scope,
  });
});

/** Compact queue view used by the live dashboard board. */
export const liveQueue = asyncHandler(async (req: Request, res: Response) => {
  const canteenId = (req.query.canteen as string) || undefined;
  const orders = await Order.find({
    ...(canteenId ? { canteen: canteenId } : {}),
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ placedAt: 1 })
    .populate(POPULATE)
    .exec();

  const columns: Record<string, HydratedDocument<IOrder>[]> = { PENDING_PAYMENT: [], PAID: [], ACCEPTED: [], PREPARING: [], READY: [] };
  for (const order of orders) {
    (columns[order.status] ??= []).push(order);
  }

  res.json({
    columns: Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v.map((o) => o.toJSON())])),
    total: orders.length,
    generatedAt: new Date().toISOString(),
  });
});

export const cancelOrder = asyncHandler(async (req: Request, res: Response) => {
  const reason = (req.body?.reason as string | undefined) ?? 'Cancelled by student';
  const order = await transitionOrder({
    orderId: req.params.id,
    nextStatus: 'CANCELLED',
    actorId: req.user!.id,
    actorRole: req.user!.role,
    reason,
  });
  res.json({ order, message: 'Order cancelled.' });
});

/** Lightweight "can I still buy this" check used by the student cart screen. */
export const validateCart = asyncHandler(async (req: Request, res: Response) => {
  const items = req.body?.items as Array<{ menuItem: string; quantity: number }> | undefined;
  if (!Array.isArray(items) || items.length === 0) throw ApiError.badRequest('Send at least one cart line.');

  const docs = await MenuItem.find({ _id: { $in: items.map((i) => i.menuItem) } })
    .populate('canteen', 'name code isOpen')
    .lean({ virtuals: true });
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const lines = items.map((line) => {
    const doc = byId.get(line.menuItem);
    if (!doc) return { menuItem: line.menuItem, ok: false, reason: 'This item is no longer on the menu.', available: 0 };
    if (!doc.isAvailable) return { menuItem: line.menuItem, ok: false, reason: `${doc.name} is currently unavailable.`, available: 0 };
    const tracked = doc.trackStock && doc.stock !== null;
    if (tracked && (doc.stock as number) < line.quantity) {
      return {
        menuItem: line.menuItem,
        ok: false,
        reason: `Only ${doc.stock} portion(s) of ${doc.name} left.`,
        available: doc.stock as number,
      };
    }
    return { menuItem: line.menuItem, ok: true, available: tracked ? (doc.stock as number) : null, price: doc.price, name: doc.name };
  });

  res.json({ lines, ok: lines.every((l) => l.ok) });
});

/** Static reference data the checkout screen needs. */
export const checkoutContext = asyncHandler(async (req: Request, res: Response) => {
  const canteen = await Canteen.findById(req.query.canteen).lean();
  if (!canteen) throw ApiError.notFound('Canteen not found.');
  const qrLocation = req.query.location ? await QRLocation.findOne({ code: String(req.query.location).toUpperCase() }).lean() : null;
  const { getSettings } = await import('../services/settings.service');
  const settings = await getSettings();
  res.json({
    canteen: { ...canteen, id: String(canteen._id) },
    qrLocation: qrLocation ? { ...qrLocation, id: String(qrLocation._id) } : null,
    settings: {
      minOrderValue: settings.minOrderValue,
      taxPercent: settings.taxPercent,
      taxLabel: settings.taxLabel,
      currencySymbol: settings.currencySymbol,
      maxItemsPerOrder: settings.maxItemsPerOrder,
    },
  });
});