import type { HydratedDocument, Types } from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { STATUS_TRANSITIONS, type OrderStatus } from '../constants';
import { round2 } from '../utils/money';
import { getSettings } from './settings.service';
import {
  Canteen,
  Counter,
  MenuItem,
  Order,
  QRLocation,
  nextSequence,
  type ICanteen,
  type IQRLocation,
  type IOrder,
  type IOrderItem,
  type IOrderPayment,
} from '../models';
import { commitStock, releaseStock } from './inventory.service';
import { applyWalletMovement } from './wallet.service';
import { providerFor, createGatewayOrder, refundGatewayPayment, type GatewayOrder } from './payment.service';
import { publishOrderEvent, SOCKET_EVENTS, emitToAdmins, emitToUser } from './realtime.service';
import { randomToken, safeEqual } from '../utils/tokens';
import { logger } from '../utils/logger';
import crypto from 'node:crypto';

export interface CreateOrderInput {
  /** Supabase `users.id` (UUID string). */
  userId: string;
  canteenId: Types.ObjectId | string;
  qrLocationId?: Types.ObjectId | string;
  qrLocationCode?: string;
  lines: Array<{ menuItem: string; quantity: number; notes?: string }>;
  paymentMethod: 'razorpay' | 'wallet';
  note?: string;
}

/** Effective open state, honouring the optional opening-hours schedule. */
export function evaluateCanteen(canteen: {
  isOpen: boolean;
  isActive: boolean;
  acceptsOrders: boolean;
  enforceSchedule: boolean;
  openingTime: string;
  closingTime: string;
}): { canOrder: boolean; reason: string | null; withinSchedule: boolean } {
  if (!canteen.isActive) return { canOrder: false, reason: 'This canteen is not currently operating.', withinSchedule: false };
  const withinSchedule = isWithinSchedule(canteen.openingTime, canteen.closingTime, canteen.enforceSchedule);
  if (!canteen.isOpen) return { canOrder: false, reason: canteen.isOpen === false ? 'This canteen is closed right now.' : null, withinSchedule };
  if (canteen.enforceSchedule && !withinSchedule) {
    return { canOrder: false, reason: `The canteen is open from ${canteen.openingTime} to ${canteen.closingTime}.`, withinSchedule };
  }
  if (!canteen.acceptsOrders) return { canOrder: false, reason: 'The canteen has paused new orders.', withinSchedule };
  return { canOrder: true, reason: null, withinSchedule };
}

export function isWithinSchedule(opening: string, closing: string, enforce: boolean, now = new Date()): boolean {
  if (!enforce) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = opening.split(':').map(Number);
  const [ch, cm] = closing.split(':').map(Number);
  const start = oh * 60 + om;
  const end = ch * 60 + cm;
  if (start === end) return true;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Atomically increments the canteen's in-flight order counter. */
async function reserveOrderSlot(canteenId: Types.ObjectId | string): Promise<void> {
  const result = await Canteen.updateOne(
    { _id: canteenId, isActive: true, $expr: { $lt: ['$activeOrderCount', '$maxConcurrentOrders'] } },
    { $inc: { activeOrderCount: 1 } },
  );
  if (result.matchedCount === 0) {
    const canteen = await Canteen.findById(canteenId).lean();
    if (!canteen) throw ApiError.notFound('Canteen not found.');
    throw ApiError.conflict('The kitchen is at capacity right now. Please try again in a few minutes.');
  }
}

async function releaseOrderSlot(canteenId: Types.ObjectId | string): Promise<void> {
  await Canteen.updateOne({ _id: canteenId, activeOrderCount: { $gt: 0 } }, { $inc: { activeOrderCount: -1 } });
}

/** Resets counters that drifted (e.g. server restarted mid-flight) and refreshes on boot. */
export async function syncActiveOrderCounts(): Promise<void> {
  const activeStatuses: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'];
  const counts = await Order.aggregate([
    { $match: { status: { $in: activeStatuses } } },
    { $group: { _id: '$canteen', count: { $sum: 1 } } },
  ]);
  await Canteen.updateMany({}, { $set: { activeOrderCount: 0 } });
  for (const row of counts) {
    await Canteen.updateOne({ _id: row._id }, { $set: { activeOrderCount: row.count } });
  }
}

/** Generates a short, unique, human-friendly pickup token. */
export async function generateUniqueToken(length: number, prefix = ''): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = `${prefix}${randomToken(length)}`;
    const exists = await Order.exists({ token: candidate });
    if (!exists) return candidate;
  }
  // Deterministic fallback that is guaranteed unique by order number.
  const seq = await nextSequence('token_fallback');
  return `${prefix}${String(seq).padStart(length, '0')}`.slice(0, length + prefix.length);
}

export interface PricedOrder {
  items: IOrderItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  canteenDoc: HydratedDocument<ICanteen>;
  qrDoc: HydratedDocument<IQRLocation>;
}

export type OrderDoc = HydratedDocument<IOrder>;

/**
 * Builds the authoritative price of an order from the database.
 * Client supplied prices / totals are intentionally ignored.
 */
export async function priceOrder(input: CreateOrderInput): Promise<PricedOrder> {
  const settings = await getSettings();

  const canteenDoc = await Canteen.findById(input.canteenId);
  if (!canteenDoc) throw ApiError.notFound('Canteen not found.');

  const open = evaluateCanteen(canteenDoc);
  if (!open.canOrder) throw new ApiError('CANTEEN_CLOSED', open.reason ?? 'This canteen is closed right now.');

  let qrDoc: HydratedDocument<IQRLocation> | null = null;
  if (input.qrLocationId) {
    qrDoc = await QRLocation.findById(input.qrLocationId);
    if (!qrDoc) throw ApiError.notFound('That QR location could not be found.');
    if (!qrDoc.isActive) throw ApiError.badRequest('That QR location has been deactivated.');
    if (String(qrDoc.canteen) !== String(canteenDoc._id)) throw ApiError.badRequest('That QR code belongs to a different canteen.');
  } else if (input.qrLocationCode) {
    qrDoc = await QRLocation.findOne({ code: input.qrLocationCode.toUpperCase() });
    if (!qrDoc) throw ApiError.notFound(`No QR location found for code "${input.qrLocationCode}".`);
    if (!qrDoc.isActive) throw ApiError.badRequest('That QR location has been deactivated.');
    if (String(qrDoc.canteen) !== String(canteenDoc._id)) throw ApiError.badRequest('That QR code belongs to a different canteen.');
  }
  if (!qrDoc) throw ApiError.badRequest('Scan the QR code at your table before ordering.');

  if (input.lines.length > settings.maxItemsPerOrder) {
    throw ApiError.badRequest(`You can order at most ${settings.maxItemsPerOrder} different items per order.`);
  }

  const ids = input.lines.map((l) => l.menuItem);
  const docs = await MenuItem.find({ _id: { $in: ids } }).exec();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  // Merge duplicate lines for the same item.
  const merged = new Map<string, { quantity: number; notes?: string }>();
  for (const line of input.lines) {
    const key = line.menuItem;
    const current = merged.get(key) ?? { quantity: 0, notes: line.notes };
    current.quantity += line.quantity;
    merged.set(key, current);
  }

  const items: IOrderItem[] = [];
  for (const [id, line] of merged.entries()) {
    const doc = byId.get(id);
    if (!doc) throw ApiError.notFound('One of the items in your cart is no longer on the menu.');
    if (String(doc.canteen) !== String(canteenDoc._id)) {
      throw ApiError.badRequest(`"${doc.name}" belongs to a different canteen.`);
    }
    if (!doc.isAvailable) throw ApiError.conflict(`"${doc.name}" is currently unavailable.`);
    if (line.quantity < 1 || line.quantity > 50) throw ApiError.badRequest(`Invalid quantity for "${doc.name}".`);
    if (doc.trackStock && doc.stock !== null && doc.stock < line.quantity) {
      throw new ApiError('INSUFFICIENT_STOCK', `Only ${doc.stock} portion(s) of "${doc.name}" left. Please update your cart.`, {
        itemId: id,
        available: doc.stock,
        requested: line.quantity,
      });
    }

    items.push({
      menuItem: doc._id as Types.ObjectId,
      name: doc.name,
      price: round2(doc.price),
      quantity: line.quantity,
      subtotal: round2(doc.price * line.quantity),
      isVegetarian: doc.isVegetarian,
      ...(line.notes ? { notes: line.notes } : {}),
    });
  }

  const subtotal = round2(items.reduce((sum, i) => sum + i.subtotal, 0));
  const tax = round2((subtotal * settings.taxPercent) / 100);
  const total = round2(subtotal + tax);

  if (total < settings.minOrderValue) {
    throw ApiError.badRequest(`Minimum order value is ${settings.currencySymbol}${settings.minOrderValue.toFixed(2)}.`);
  }

  return { items, subtotal, tax, discount: 0, total, canteenDoc, qrDoc };
}

export interface CreatedOrder {
  order: OrderDoc;
  gateway: GatewayOrder | null;
}

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const priced = await priceOrder(input);
  const settings = await getSettings();

  await reserveOrderSlot(priced.canteenDoc._id);

  try {
    const orderNumber = await nextSequence('order');
    const token = await generateUniqueToken(settings.tokenLength, settings.tokenPrefix);
    const provider = providerFor(input.paymentMethod);

    const payment: IOrderPayment = {
      method: input.paymentMethod,
      provider,
      status: 'PENDING',
      amount: priced.total,
    };

    const prepTime = priced.canteenDoc.prepTimeMins || 12;
    const [order] = await Order.create([
      {
        orderNumber,
        token,
        user: input.userId,
        canteen: priced.canteenDoc._id,
        qrLocation: priced.qrDoc._id,
        qrLocationCode: priced.qrDoc.code,
        items: priced.items,
        subtotal: priced.subtotal,
        tax: priced.tax,
        discount: priced.discount,
        total: priced.total,
        status: 'PENDING_PAYMENT',
        payment,
        statusHistory: [{ status: 'PENDING_PAYMENT', at: new Date(), byRole: 'student', by: String(input.userId) }],
        ...(input.note ? { note: input.note } : {}),
        placedAt: new Date(),
        estimatedReadyAt: new Date(Date.now() + prepTime * 60_000),
      },
    ]);

    let gateway: GatewayOrder | null = null;
    if (input.paymentMethod === 'razorpay') {
      gateway = await createGatewayOrder({
        amount: priced.total,
        receipt: `ff_${order.orderNumber}`,
        reference: String(order._id),
        notes: {
          foodflow_order: String(order._id),
          token: order.token,
          user: String(input.userId),
          canteen: String(priced.canteenDoc._id),
        },
      });
      order.payment.gatewayOrderId = gateway.gatewayOrderId;
      await order.save();
    }

    await QRLocation.updateOne({ _id: priced.qrDoc._id }, { $inc: { scanCount: 1 } });

    return { order: order as OrderDoc, gateway };
  } catch (error) {
    await releaseOrderSlot(priced.canteenDoc._id);
    throw error;
  }
}

export interface GuestCreatedOrder extends CreatedOrder {
  guestClaimToken: string;
}

export interface GuestOrderInput {
  canteenId: Types.ObjectId | string;
  qrLocationId?: Types.ObjectId | string;
  qrLocationCode?: string;
  lines: Array<{ menuItem: string; quantity: number; notes?: string }>;
  note?: string;
}

/**
 * Guest (no-account) order. Identical pricing/validation to student orders, but the
 * order carries no user and instead returns a per-order bearer claim token that the
 * guest must present for payment + tracking. Razorpay-only (no wallet).
 */
export async function createGuestOrder(input: GuestOrderInput): Promise<GuestCreatedOrder> {
  const priced = await priceOrder({
    userId: 'guest',
    canteenId: input.canteenId,
    qrLocationId: input.qrLocationId,
    qrLocationCode: input.qrLocationCode,
    lines: input.lines,
    paymentMethod: 'razorpay',
    note: input.note,
  });
  const settings = await getSettings();

  await reserveOrderSlot(priced.canteenDoc._id);

  try {
    const orderNumber = await nextSequence('order');
    const token = await generateUniqueToken(settings.tokenLength, settings.tokenPrefix);
    const guestClaimToken = crypto.randomBytes(32).toString('hex');
    const provider = providerFor('razorpay');

    const payment: IOrderPayment = { method: 'razorpay', provider, status: 'PENDING', amount: priced.total };
    const prepTime = priced.canteenDoc.prepTimeMins || 12;
    const [order] = await Order.create([
      {
        orderNumber,
        token,
        isGuest: true,
        guestClaimToken,
        guestLabel: 'Guest',
        canteen: priced.canteenDoc._id,
        qrLocation: priced.qrDoc._id,
        qrLocationCode: priced.qrDoc.code,
        items: priced.items,
        subtotal: priced.subtotal,
        tax: priced.tax,
        discount: priced.discount,
        total: priced.total,
        status: 'PENDING_PAYMENT',
        payment,
        statusHistory: [{ status: 'PENDING_PAYMENT', at: new Date(), byRole: 'system', note: 'Guest order placed' }],
        ...(input.note ? { note: input.note } : {}),
        placedAt: new Date(),
        estimatedReadyAt: new Date(Date.now() + prepTime * 60_000),
      },
    ]);

    const gateway = await createGatewayOrder({
      amount: priced.total,
      receipt: `ff_${order.orderNumber}`,
      reference: String(order._id),
      notes: { foodflow_order: String(order._id), token: order.token, user: 'guest', canteen: String(priced.canteenDoc._id) },
    });
    order.payment.gatewayOrderId = gateway.gatewayOrderId;
    await order.save();

    await QRLocation.updateOne({ _id: priced.qrDoc._id }, { $inc: { scanCount: 1 } });
    return { order: order as OrderDoc, gateway, guestClaimToken };
  } catch (error) {
    await releaseOrderSlot(priced.canteenDoc._id);
    throw error;
  }
}

/** Loads an order with its guest claim selected, then enforces owner/admin/claim access. */
export async function loadOrderWithClaim(orderId: string): Promise<OrderDoc> {
  const order = await Order.findById(orderId).select('+guestClaimToken');
  if (!order) throw ApiError.notFound('Order not found.');
  return order as OrderDoc;
}

export function assertGuestClaim(order: OrderDoc, claim: unknown): void {
  const expected = (order as unknown as { guestClaimToken?: string }).guestClaimToken;
  if (!expected || typeof claim !== 'string' || !claim || !safeEqual(claim, expected)) {
    throw ApiError.unauthorized('This order link is invalid or has expired.');
  }
}

export function sanitizeOrder(order: OrderDoc): OrderDoc {
  const raw = order.toObject ? order.toObject() : order;
  const obj = raw as unknown as Record<string, unknown>;
  delete obj.guestClaimToken;
  return obj as unknown as OrderDoc;
}

/**
 * Settles a paid order: verifies the gateway callback signature, commits inventory,
 * debits the wallet when needed and moves the order to PAID. Fully idempotent.
 */
export async function settleOrderPayment(params: {
  orderId: string;
  userId: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
}): Promise<OrderDoc> {
  const { verifyGatewaySignature } = await import('./payment.service');

  const order = await Order.findById(params.orderId);
  if (!order) throw ApiError.notFound('Order not found.');
  if (String(order.user) !== params.userId) throw ApiError.forbidden('This order belongs to another account.');

  // Idempotency: the same gateway payment can only ever settle one order.
  const alreadySettled = await Order.findOne({
    _id: { $ne: order._id },
    'payment.gatewayPaymentId': params.gatewayPaymentId,
  }).lean();
  if (alreadySettled) {
    logger.warn('order', `Duplicate gateway payment ${params.gatewayPaymentId} ignored for order ${order._id}`);
    throw new ApiError('DUPLICATE_PAYMENT', 'This payment has already been applied to another order.');
  }

  if (order.status !== 'PENDING_PAYMENT') {
    if (order.payment.status === 'PAID') return order as OrderDoc;
    throw new ApiError('INVALID_STATUS_TRANSITION', `Order is already ${order.status.toLowerCase().replace(/_/g, ' ')}.`);
  }

  if (order.payment.gatewayOrderId && order.payment.gatewayOrderId !== params.gatewayOrderId) {
    throw ApiError.badRequest('Payment reference does not match this order.');
  }
  if (!verifyGatewaySignature(params)) {
    order.payment.status = 'FAILED';
    order.payment.failureReason = 'Signature verification failed';
    await order.save();
    throw ApiError.validation('Payment verification failed. If money was debited it will be refunded automatically.');
  }

  try {
    await commitStock(order.items.map((i) => ({ menuItem: i.menuItem, quantity: i.quantity })));
    order.inventoryCommitted = true;
  } catch (error) {
    order.payment.status = 'FAILED';
    order.payment.failureReason = (error as Error).message;
    order.status = 'REJECTED';
    order.closeReason = 'Item went out of stock before payment completed';
    order.closedAt = new Date();
    order.statusHistory.push({ status: 'REJECTED', at: new Date(), byRole: 'system', note: order.payment.failureReason });
    await order.save();
    await releaseOrderSlot(order.canteen);
    publishOrderEvent(SOCKET_EVENTS.ORDER_UPDATED, await hydrateOrder(order._id));
    throw error;
  }

  const now = new Date();
  order.payment.status = 'PAID';
  order.payment.gatewayPaymentId = params.gatewayPaymentId;
  order.payment.gatewaySignature = params.gatewaySignature;
  order.payment.paidAt = now;
  order.status = 'PAID';
  order.statusHistory.push({ status: 'PAID', at: now, byRole: 'system', note: 'Payment verified' });
  await order.save();

  if (order.payment.method === 'wallet') {
    await applyWalletMovement({
      userId: order.user!,
      type: 'DEBIT',
      amount: order.total,
      reason: 'ORDER_PAYMENT',
      description: `Order #${order.orderNumber} (token ${order.token})`,
      reference: `order:${order._id}:payment`,
      orderId: order._id,
    });
    const walletBalance = await import('./wallet.service').then((m) => m.getWalletSummary(order.user!));
    emitToUser(String(order.user), SOCKET_EVENTS.WALLET_UPDATED, walletBalance);
  }

  const settings = await getSettings();
  if (settings.autoAcceptOrders) {
    await transitionOrder({
      orderId: String(order._id),
      nextStatus: 'ACCEPTED',
      actorId: undefined,
      actorRole: 'system',
      note: 'Auto-accepted by settings',
    }).catch((err) => logger.warn('order', `Auto-accept failed for ${order._id}: ${(err as Error).message}`));
    return (await Order.findById(order._id)) as OrderDoc;
  }

  const hydrated = await hydrateOrder(order._id);
  publishOrderEvent(SOCKET_EVENTS.ORDER_STATUS, hydrated);
  emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });
  return hydrated;
}

/**
 * Guest variant of settleOrderPayment. Same HMAC verification + stock commit, but
 * ownership is proven with the per-order claim token instead of a user account.
 */
export async function settleGuestOrderPayment(params: {
  orderId: string;
  guestClaimToken: string;
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
}): Promise<OrderDoc> {
  const { verifyGatewaySignature } = await import('./payment.service');

  const order = await loadOrderWithClaim(params.orderId);
  if (!order.isGuest) throw ApiError.badRequest('This order belongs to a registered account. Please sign in.');
  assertGuestClaim(order, params.guestClaimToken);

  const alreadySettled = await Order.findOne({
    _id: { $ne: order._id },
    'payment.gatewayPaymentId': params.gatewayPaymentId,
  }).lean();
  if (alreadySettled) {
    throw new ApiError('DUPLICATE_PAYMENT', 'This payment has already been applied to another order.');
  }

  if (order.status !== 'PENDING_PAYMENT') {
    if (order.payment.status === 'PAID') return sanitizeOrder(await hydrateOrder(order._id)) as OrderDoc;
    throw new ApiError('INVALID_STATUS_TRANSITION', `Order is already ${order.status.toLowerCase().replace(/_/g, ' ')}.`);
  }
  if (order.payment.gatewayOrderId && order.payment.gatewayOrderId !== params.gatewayOrderId) {
    throw ApiError.badRequest('Payment reference does not match this order.');
  }
  if (!verifyGatewaySignature(params)) {
    order.payment.status = 'FAILED';
    order.payment.failureReason = 'Signature verification failed';
    await order.save();
    throw ApiError.validation('Payment verification failed. If money was debited it will be refunded automatically.');
  }

  try {
    await commitStock(order.items.map((i) => ({ menuItem: i.menuItem, quantity: i.quantity })));
    order.inventoryCommitted = true;
  } catch (error) {
    order.payment.status = 'FAILED';
    order.payment.failureReason = (error as Error).message;
    order.status = 'REJECTED';
    order.closeReason = 'Item went out of stock before payment completed';
    order.closedAt = new Date();
    order.statusHistory.push({ status: 'REJECTED', at: new Date(), byRole: 'system', note: order.payment.failureReason });
    await order.save();
    await releaseOrderSlot(order.canteen);
    publishOrderEvent(SOCKET_EVENTS.ORDER_UPDATED, await hydrateOrder(order._id));
    throw error;
  }

  const now = new Date();
  order.payment.status = 'PAID';
  order.payment.gatewayPaymentId = params.gatewayPaymentId;
  order.payment.gatewaySignature = params.gatewaySignature;
  order.payment.paidAt = now;
  order.status = 'PAID';
  order.statusHistory.push({ status: 'PAID', at: now, byRole: 'system', note: 'Guest payment verified' });
  await order.save();

  const settings = await getSettings();
  if (settings.autoAcceptOrders) {
    await transitionOrder({
      orderId: String(order._id),
      nextStatus: 'ACCEPTED',
      actorId: undefined,
      actorRole: 'system',
      note: 'Auto-accepted by settings',
    }).catch((err) => logger.warn('order', `Auto-accept failed for ${order._id}: ${(err as Error).message}`));
    return sanitizeOrder((await Order.findById(order._id)) as OrderDoc) as OrderDoc;
  }

  const hydrated = await hydrateOrder(order._id);
  publishOrderEvent(SOCKET_EVENTS.ORDER_STATUS, hydrated);
  emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });
  return sanitizeOrder(hydrated) as OrderDoc;
}

/** Debits the wallet for an unpaid order and settles it in one server-side transaction. */
export async function payOrderWithWallet(orderId: string, userId: string): Promise<OrderDoc> {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found.');
  if (String(order.user) !== userId) throw ApiError.forbidden('This order belongs to another account.');
  if (order.status !== 'PENDING_PAYMENT') {
    if (order.payment.status === 'PAID') return order as OrderDoc;
    throw new ApiError('INVALID_STATUS_TRANSITION', `Order is already ${order.status.toLowerCase().replace(/_/g, ' ')}.`);
  }

  // Reserve the balance first so an insufficient balance never burns inventory.
  try {
    await applyWalletMovement({
      userId: order.user!,
      type: 'DEBIT',
      amount: order.total,
      reason: 'ORDER_PAYMENT',
      description: `Order #${order.orderNumber} (token ${order.token})`,
      reference: `order:${order._id}:payment`,
      orderId: order._id,
    });
  } catch (error) {
    // Nothing was consumed, so close the order and give the kitchen slot straight back.
    order.payment.status = 'FAILED';
    order.payment.failureReason = (error as Error).message;
    order.status = 'REJECTED';
    order.closeReason = (error as Error).message;
    order.closedAt = new Date();
    order.statusHistory.push({ status: 'REJECTED', at: new Date(), byRole: 'system', note: order.closeReason });
    await order.save();
    await releaseOrderSlot(order.canteen);
    throw error;
  }

  try {
    await commitStock(order.items.map((i) => ({ menuItem: i.menuItem, quantity: i.quantity })));
    order.inventoryCommitted = true;
  } catch (error) {
    await applyWalletMovement({
      userId: order.user!,
      type: 'CREDIT',
      amount: order.total,
      reason: 'ORDER_REFUND',
      description: `Refund for failed order #${order.orderNumber}`,
      reference: `order:${order._id}:refund:${Date.now()}`,
      orderId: order._id,
    });
    order.payment.status = 'FAILED';
    order.payment.failureReason = (error as Error).message;
    order.status = 'REJECTED';
    order.closeReason = 'Item went out of stock before payment completed';
    order.closedAt = new Date();
    order.statusHistory.push({ status: 'REJECTED', at: new Date(), byRole: 'system', note: order.payment.failureReason });
    await order.save();
    await releaseOrderSlot(order.canteen);
    throw error;
  }

  const now = new Date();
  order.payment.status = 'PAID';
  order.payment.provider = 'wallet';
  order.payment.paidAt = now;
  order.status = 'PAID';
  order.statusHistory.push({ status: 'PAID', at: now, byRole: 'system', note: 'Paid from wallet' });
  await order.save();

  const walletBalance = await import('./wallet.service').then((m) => m.getWalletSummary(order.user!));
  emitToUser(String(order.user), SOCKET_EVENTS.WALLET_UPDATED, walletBalance);

  const hydrated = await hydrateOrder(order._id);
  publishOrderEvent(SOCKET_EVENTS.ORDER_NEW, hydrated);
  publishOrderEvent(SOCKET_EVENTS.ORDER_STATUS, hydrated);
  emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });
  return hydrated;
}

export async function transitionOrder(params: {
  orderId: string;
  nextStatus: OrderStatus;
  actorId?: string;
  actorRole: 'student' | 'admin' | 'system';
  note?: string;
  reason?: string;
}): Promise<OrderDoc> {
  const order = await Order.findById(params.orderId);
  if (!order) throw ApiError.notFound('Order not found.');

  if (params.actorRole === 'student') {
    const owns = String(order.user) === params.actorId;
    if (!owns) throw ApiError.forbidden('This order belongs to another account.');
    if (params.nextStatus !== 'CANCELLED') throw ApiError.forbidden('Students can only cancel their own order.');
  }

  const allowed = STATUS_TRANSITIONS[order.status];
  if (!allowed.includes(params.nextStatus)) {
    throw new ApiError(
      'INVALID_STATUS_TRANSITION',
      `Cannot move an order from ${order.status.replace(/_/g, ' ').toLowerCase()} to ${params.nextStatus.replace(/_/g, ' ').toLowerCase()}.`,
      { from: order.status, to: params.nextStatus, allowed },
    );
  }

  const now = new Date();
  const previous = order.status;
  order.status = params.nextStatus;
  order.statusHistory.push({
    status: params.nextStatus,
    at: now,
    byRole: params.actorRole,
    ...(params.actorId ? { by: params.actorId } : {}),
    ...(params.note ? { note: params.note } : {}),
    ...(params.reason ? { note: params.reason } : {}),
  });

  switch (params.nextStatus) {
    case 'ACCEPTED':
      order.acceptedAt = now;
      break;
    case 'PREPARING':
      order.preparingAt = now;
      break;
    case 'READY':
      order.readyAt = now;
      break;
    case 'COMPLETED':
      order.completedAt = now;
      break;
    case 'CANCELLED':
    case 'REJECTED':
      order.closedAt = now;
      order.closeReason = params.reason ?? params.note ?? (params.nextStatus === 'REJECTED' ? 'Rejected by canteen' : 'Cancelled');
      break;
    default:
      break;
  }

  await order.save();

  if (previous !== 'PENDING_PAYMENT' && ['CANCELLED', 'REJECTED'].includes(params.nextStatus)) {
    await restoreOrderResources(order);
  }
  if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(params.nextStatus)) {
    await releaseOrderSlot(order.canteen);
  }

  const hydrated = await hydrateOrder(order._id);
  publishOrderEvent(SOCKET_EVENTS.ORDER_STATUS, hydrated);
  emitToAdmins(SOCKET_EVENTS.QUEUE, { canteen: String(order.canteen), at: new Date().toISOString() });
  return hydrated;
}

/** Restores stock + refunds the wallet when a paid order is cancelled or rejected. */
async function restoreOrderResources(order: OrderDoc): Promise<void> {
  if (order.inventoryCommitted && !order.inventoryRestored) {
    await releaseStock(order.items.map((i) => ({ menuItem: i.menuItem, quantity: i.quantity })));
    order.inventoryRestored = true;
    await order.save();
  }

  if (order.payment.status === 'PAID') {
    if (order.payment.method === 'wallet') {
      await applyWalletMovement({
        userId: order.user!,
        type: 'CREDIT',
        amount: order.total,
        reason: 'ORDER_REFUND',
        description: `Refund for order #${order.orderNumber}`,
        reference: `order:${order._id}:refund`,
        orderId: order._id,
      });
      const summary = await import('./wallet.service').then((m) => m.getWalletSummary(order.user!));
      emitToUser(String(order.user), SOCKET_EVENTS.WALLET_UPDATED, summary);
    } else {
      const refunded = await refundGatewayPayment(order.payment.gatewayPaymentId, order.total);
      order.payment.status = refunded ? 'REFUNDED' : 'PAID';
      if (refunded) {
        order.payment.refundedAt = new Date();
        order.payment.refundReason = order.closeReason;
      }
      await order.save();
    }
  }
}

export async function hydrateOrder(id: Types.ObjectId | string): Promise<OrderDoc> {
  const order = await Order.findById(id)
    .populate('canteen', 'name code block isOpen prepTimeMins')
    .populate('qrLocation', 'code label block tableHint')
    .populate('items.menuItem', 'name imageUrl emoji category')
    .exec();
  if (!order) throw ApiError.notFound('Order not found.');
  return order;
}

export async function cancelExpiredUnpaidOrders(olderThanMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const stale = await Order.find({ status: 'PENDING_PAYMENT', placedAt: { $lt: cutoff } }).select('_id canteen').lean();
  for (const order of stale) {
    await Order.updateOne(
      { _id: order._id, status: 'PENDING_PAYMENT' },
      {
        $set: { status: 'CANCELLED', closedAt: new Date(), closeReason: 'Payment window expired' },
        $push: { statusHistory: { status: 'CANCELLED', at: new Date(), byRole: 'system', note: 'Payment window expired' } },
      },
    );
    await releaseOrderSlot(order.canteen);
  }
  return stale.length;
}

export async function getOpenOrdersForUser(userId: string) {
  return Order.find({
    user: userId,
    status: { $in: ['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY'] },
  })
    .sort({ placedAt: -1 })
    .populate('canteen', 'name code block')
    .exec();
}

export async function assertUserExists(userId: string): Promise<void> {
  const { findUserById } = await import('./userStore');
  const user = await findUserById(userId);
  if (!user) throw ApiError.notFound('Account not found.');
}