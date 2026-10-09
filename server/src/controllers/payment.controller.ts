import type { Request, Response } from 'express';
import { ApiError, asyncHandler } from '../utils/ApiError';
import { Order, WalletTransaction } from '../models';
import {
  createGatewayOrder,
  paymentRuntimeInfo,
  signSandboxPayment,
  verifyGatewaySignature,
} from '../services/payment.service';
import { settleOrderPayment } from '../services/order.service';
import { config } from '../config/env';
import { getSettings } from '../services/settings.service';
import { emitToUser, SOCKET_EVENTS } from '../services/realtime.service';
import { getWalletSummary, applyWalletMovement, getOrCreateWallet } from '../services/wallet.service';
import { logger } from '../utils/logger';

/** Runtime payment configuration for the browser checkout. */
export const getConfig = asyncHandler(async (_req: Request, res: Response) => {
  const settings = await getSettings();
  res.json({
    payment: paymentRuntimeInfo(),
    currency: { code: settings.currency, symbol: settings.currencySymbol },
    minOrderValue: settings.minOrderValue,
    taxPercent: settings.taxPercent,
    taxLabel: settings.taxLabel,
  });
});

/**
 * Creates (or re-uses) the gateway payment intent for an order.
 * The amount always comes from the stored order – never from the request body.
 */
export const createPaymentOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, guestClaimToken } = req.body as { orderId: string; guestClaimToken?: string };

  // Spec guest flow: same endpoint, no auth header, claim token as identity.
  if (!req.user) {
    if (!guestClaimToken) throw ApiError.unauthorized('Sign in or provide your guest claim token.');
    const { loadOrderWithClaim, assertGuestClaim } = await import('../services/order.service');
    const guestOrder = await loadOrderWithClaim(orderId);
    if (!guestOrder.isGuest) throw ApiError.badRequest('This order belongs to a registered account. Please sign in.');
    assertGuestClaim(guestOrder as never, guestClaimToken);
    if (guestOrder.payment.status === 'PAID') throw ApiError.conflict('This order is already paid.');
    if (guestOrder.status !== 'PENDING_PAYMENT') {
      throw new ApiError('INVALID_STATUS_TRANSITION', `Order is ${guestOrder.status.replace(/_/g, ' ').toLowerCase()} and cannot be paid again.`);
    }
    if (guestOrder.payment.gatewayOrderId) {
      const existing = await fetchExistingGatewayAmount(guestOrder.payment.gatewayOrderId);
      if (existing) {
        return res.json({
          gateway: {
            gatewayOrderId: guestOrder.payment.gatewayOrderId,
            provider: guestOrder.payment.provider,
            amount: guestOrder.total,
            currency: 'INR',
            keyId: config.razorpayPublicKey || null,
            checkoutUrl: guestOrder.payment.provider === 'sandbox' ? buildSandboxUrl(String(guestOrder._id), guestOrder.payment.gatewayOrderId) : null,
          },
          order: { id: String(guestOrder._id), token: guestOrder.token, total: guestOrder.total },
        });
      }
    }
    const gateway = await createGatewayOrder({
      amount: guestOrder.total,
      receipt: `ff_${guestOrder.orderNumber}`,
      reference: String(guestOrder._id),
      notes: { foodflow_order: String(guestOrder._id), token: guestOrder.token, user: 'guest' },
    });
    guestOrder.payment.gatewayOrderId = gateway.gatewayOrderId;
    guestOrder.payment.provider = gateway.provider;
    await guestOrder.save();
    res.json({
      gateway: { ...gateway, checkoutUrl: gateway.provider === 'sandbox' ? buildSandboxUrl(String(guestOrder._id), gateway.gatewayOrderId) : gateway.checkoutUrl },
      order: { id: String(guestOrder._id), token: guestOrder.token, total: guestOrder.total },
    });
    return;
  }

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found.');
  if (String(order.user) !== req.user!.id) throw ApiError.forbidden('This order belongs to another account.');

  if (order.payment.status === 'PAID') {
    throw ApiError.conflict('This order is already paid.');
  }
  if (order.status !== 'PENDING_PAYMENT') {
    throw new ApiError('INVALID_STATUS_TRANSITION', `Order is ${order.status.replace(/_/g, ' ').toLowerCase()} and cannot be paid again.`);
  }
  if (order.payment.method !== 'razorpay') {
    throw ApiError.badRequest('This order is not payable through the gateway.');
  }

  if (order.payment.gatewayOrderId) {
    const existing = await fetchExistingGatewayAmount(order.payment.gatewayOrderId);
    if (existing) {
      return res.json({
        gateway: {
          gatewayOrderId: order.payment.gatewayOrderId,
          provider: order.payment.provider,
          amount: order.total,
          currency: 'INR',
          keyId: config.razorpayPublicKey || null,
          checkoutUrl: order.payment.provider === 'sandbox' ? buildSandboxUrl(String(order._id), order.payment.gatewayOrderId) : null,
        },
        order: { id: String(order._id), token: order.token, total: order.total },
      });
    }
  }

  const gateway = await createGatewayOrder({
    amount: order.total,
    receipt: `ff_${order.orderNumber}`,
    reference: String(order._id),
    notes: { foodflow_order: String(order._id), token: order.token, user: String(order.user) },
  });

  order.payment.gatewayOrderId = gateway.gatewayOrderId;
  order.payment.provider = gateway.provider;
  await order.save();

  res.json({
    gateway: { ...gateway, checkoutUrl: gateway.provider === 'sandbox' ? buildSandboxUrl(String(order._id), gateway.gatewayOrderId) : gateway.checkoutUrl },
    order: { id: String(order._id), token: order.token, total: order.total },
  });
});

function buildSandboxUrl(reference: string, gatewayOrderId: string): string {
  return `/sandbox/checkout?ref=${encodeURIComponent(reference)}&order=${encodeURIComponent(gatewayOrderId)}`;
}

/** Public guest variant: order id + claim token instead of a session. */
export const createGuestPaymentOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, guestClaimToken } = req.body as { orderId: string; guestClaimToken: string };
  if (!orderId || !guestClaimToken) throw ApiError.badRequest('Order reference and claim token are required.');
  const { loadOrderWithClaim, assertGuestClaim } = await import('../services/order.service');
  const order = await loadOrderWithClaim(orderId);
  if (!order.isGuest) throw ApiError.badRequest('This order belongs to a registered account. Please sign in.');
  assertGuestClaim(order as never, guestClaimToken);

  if (order.payment.status === 'PAID') throw ApiError.conflict('This order is already paid.');
  if (order.status !== 'PENDING_PAYMENT') {
    throw new ApiError('INVALID_STATUS_TRANSITION', `Order is ${order.status.replace(/_/g, ' ').toLowerCase()} and cannot be paid again.`);
  }
  if (order.payment.gatewayOrderId) {
    const existing = await fetchExistingGatewayAmount(order.payment.gatewayOrderId);
    if (existing) {
      return res.json({
        gateway: {
          gatewayOrderId: order.payment.gatewayOrderId,
          provider: order.payment.provider,
          amount: order.total,
          currency: 'INR',
          keyId: config.razorpayPublicKey || null,
          checkoutUrl: order.payment.provider === 'sandbox' ? buildSandboxUrl(String(order._id), order.payment.gatewayOrderId) : null,
        },
        order: { id: String(order._id), token: order.token, total: order.total },
      });
    }
  }

  const gateway = await createGatewayOrder({
    amount: order.total,
    receipt: `ff_${order.orderNumber}`,
    reference: String(order._id),
    notes: { foodflow_order: String(order._id), token: order.token, user: 'guest' },
  });
  order.payment.gatewayOrderId = gateway.gatewayOrderId;
  order.payment.provider = gateway.provider;
  await order.save();
  res.json({
    gateway: { ...gateway, checkoutUrl: gateway.provider === 'sandbox' ? buildSandboxUrl(String(order._id), gateway.gatewayOrderId) : gateway.checkoutUrl },
    order: { id: String(order._id), token: order.token, total: order.total },
  });
});

/** Public guest verification — same HMAC path, claim token as identity. */
export const verifyGuestPayment = asyncHandler(async (req: Request, res: Response) => {
  const { orderId, guestClaimToken, gatewayOrderId, gatewayPaymentId, gatewaySignature } = req.body as {
    orderId: string;
    guestClaimToken: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    gatewaySignature: string;
  };
  if (!orderId || !guestClaimToken) throw ApiError.badRequest('Order reference and claim token are required.');
  const { settleGuestOrderPayment } = await import('../services/order.service');
  const order = await settleGuestOrderPayment({ orderId, guestClaimToken, gatewayOrderId, gatewayPaymentId, gatewaySignature });
  res.json({ order, message: 'Payment verified. Your order token is ready.' });
});

async function fetchExistingGatewayAmount(gatewayOrderId: string): Promise<number | null> {
  if (config.paymentProvider !== 'razorpay') return 1;
  try {
    const RazorpayModule = require('razorpay') as { default?: new (opts: { key_id: string; key_secret: string }) => { orders: { fetch: (id: string) => Promise<unknown> } } } & (new (opts: { key_id: string; key_secret: string }) => { orders: { fetch: (id: string) => Promise<unknown> } });
    const Client = RazorpayModule.default ?? RazorpayModule;
    const client = new Client({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
    const order = (await client.orders.fetch(gatewayOrderId)) as { amount_paid?: number; amount?: number };
    return order.amount_paid ?? order.amount ?? null;
  } catch (error) {
    logger.warn('payment', `Could not reuse gateway order ${gatewayOrderId}: ${(error as Error).message}`);
    return null;
  }
}

/** Server-side signature verification – the only path that can mark an order as PAID. */
export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body as {
    orderId: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    gatewaySignature: string;
    guestClaimToken?: string;
  };

  // Spec guest flow: same endpoint, claim token as identity.
  if (!req.user) {
    if (!payload.guestClaimToken) throw ApiError.unauthorized('Sign in or provide your guest claim token.');
    const { settleGuestOrderPayment } = await import('../services/order.service');
    const order = await settleGuestOrderPayment({
      orderId: payload.orderId,
      guestClaimToken: payload.guestClaimToken,
      gatewayOrderId: payload.gatewayOrderId,
      gatewayPaymentId: payload.gatewayPaymentId,
      gatewaySignature: payload.gatewaySignature,
    });
    res.json({ order, message: 'Payment verified. Your order token is ready.' });
    return;
  }

  const order = await settleOrderPayment({ userId: req.user!.id, ...payload });
  const wallet = await getWalletSummary(order.user!);
  emitToUser(String(order.user), SOCKET_EVENTS.WALLET_UPDATED, wallet);
  res.json({ order, wallet, message: 'Payment verified. Your order token is ready.' });
});

/**
 * Sandbox gateway checkout emulator. Signs a payment exactly like Razorpay would so the
 * client can complete a full payment + verification flow without live credentials.
 * Only available when PAYMENT_PROVIDER=sandbox.
 */
export const sandboxCheckout = asyncHandler(async (req: Request, res: Response) => {
  if (config.paymentProvider === 'razorpay') throw ApiError.notFound('Sandbox checkout is disabled.');
  const { gatewayOrderId, paymentId, outcome } = req.body as {
    gatewayOrderId: string;
    paymentId?: string;
    outcome?: 'success' | 'failure';
  };
  if (!gatewayOrderId) throw ApiError.badRequest('gatewayOrderId is required.');

  if (outcome === 'failure') {
    res.json({ success: false, message: 'Payment declined by the sandbox gateway.' });
    return;
  }

  const gatewayPaymentId = paymentId ?? `pay_SBX${Math.random().toString(36).slice(2, 14)}`;
  const signature = signSandboxPayment(gatewayOrderId, gatewayPaymentId);
  res.json({ success: true, gatewayPaymentId, gatewaySignature: signature });
});

export const sandboxVerifyOnly = asyncHandler(async (req: Request, res: Response) => {
  const { gatewayOrderId, gatewayPaymentId, gatewaySignature } = req.body as {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    gatewaySignature: string;
  };
  const ok = verifyGatewaySignature({ gatewayOrderId, gatewayPaymentId, gatewaySignature });
  res.json({ valid: ok });
});

/* --------------------------------------------------------------- wallet */

export const getWallet = asyncHandler(async (req: Request, res: Response) => {
  res.json({ wallet: await getWalletSummary(req.user!.id) });
});

export const listWalletTransactions = asyncHandler(async (req: Request, res: Response) => {
  const { listTransactions } = await import('../services/wallet.service');
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 20);
  const type = (req.query.type as 'CREDIT' | 'DEBIT' | undefined) ?? undefined;
  const result = await listTransactions(req.user!.id, page, limit, type);
  res.json({ transactions: result.items, total: result.total, page, limit, pages: result.pages });
});

export const walletTopup = asyncHandler(async (req: Request, res: Response) => {
  const { amount } = req.body as { amount: number };
  const wallet = await getOrCreateWallet(req.user!.id);

  const gateway = await createGatewayOrder({
    amount,
    receipt: `topup_${String(wallet._id).slice(-6)}`,
    reference: `TOPUP:${String(wallet._id)}`,
    notes: { foodflow_topup: String(wallet._id), user: String(req.user!.id) },
  });

  wallet.pendingTopup = { amount, gatewayOrderId: gateway.gatewayOrderId, createdAt: new Date() };
  await wallet.save();

  res.json({
    gateway: { ...gateway, checkoutUrl: gateway.provider === 'sandbox' ? `/sandbox/checkout?ref=${encodeURIComponent(`TOPUP:${String(wallet._id)}`)}&order=${encodeURIComponent(gateway.gatewayOrderId)}&type=topup` : null },
    wallet: await getWalletSummary(req.user!.id),
  });
});

export const verifyWalletTopup = asyncHandler(async (req: Request, res: Response) => {
  const { gatewayOrderId, gatewayPaymentId, gatewaySignature } = req.body as {
    gatewayOrderId: string;
    gatewayPaymentId: string;
    gatewaySignature: string;
  };

  const wallet = await getOrCreateWallet(req.user!.id);
  const reference = `TOPUP:${String(wallet._id)}:${gatewayOrderId}`;

  // A gateway will happily deliver the same callback twice. If this exact reference was
  // already credited, return the current balance instead of failing or double-crediting.
  const alreadyCredited = await WalletTransaction.exists({ reference, status: 'SUCCESS' });
  if (alreadyCredited || !wallet.pendingTopup || wallet.pendingTopup.gatewayOrderId !== gatewayOrderId) {
    if (!alreadyCredited) throw ApiError.badRequest('No pending top-up matches this payment reference.');
    emitToUser(req.user!.id, SOCKET_EVENTS.WALLET_UPDATED, await getWalletSummary(req.user!.id));
    res.json({
      wallet: await getWalletSummary(req.user!.id),
      alreadyApplied: true,
      message: 'This top-up was already applied.',
    });
    return;
  }

  if (!verifyGatewaySignature({ gatewayOrderId, gatewayPaymentId, gatewaySignature })) {
    throw ApiError.validation('Top-up verification failed. Your balance was not changed.');
  }

  const result = await applyWalletMovement({
    userId: req.user!.id,
    type: 'CREDIT',
    amount: wallet.pendingTopup.amount,
    reason: 'GATEWAY_TOPUP',
    description: 'Wallet top-up via payment gateway',
    reference,
  });

  wallet.pendingTopup = undefined;
  await wallet.save();

  emitToUser(req.user!.id, SOCKET_EVENTS.WALLET_UPDATED, await getWalletSummary(req.user!.id));
  res.json({
    wallet: await getWalletSummary(req.user!.id),
    alreadyApplied: result.alreadyApplied,
    message: result.alreadyApplied ? 'This top-up was already applied.' : 'Wallet topped up successfully.',
  });
});