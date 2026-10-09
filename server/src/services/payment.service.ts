import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { config } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { safeEqual } from '../utils/tokens';
import { toPaise } from '../utils/money';

export type Provider = 'razorpay' | 'sandbox' | 'wallet';

export interface GatewayOrder {
  gatewayOrderId: string;
  provider: Provider;
  amount: number;
  currency: string;
  /** Present only for the real Razorpay checkout. */
  keyId: string | null;
  checkoutUrl: string | null;
}

export interface SignatureInput {
  gatewayOrderId: string;
  gatewayPaymentId: string;
  gatewaySignature: string;
}

let razorpayClient: Razorpay | null = null;

function getRazorpay(): Razorpay {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) {
    throw new ApiError(
      'PAYMENT_NOT_CONFIGURED',
      'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to server/.env.',
    );
  }
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
  }
  return razorpayClient;
}

export function isGatewayConfigured(): boolean {
  return config.paymentProvider === 'razorpay' && Boolean(config.razorpay.keyId && config.razorpay.keySecret);
}

/** Secret used to sign/verify. Sandbox derives a stable dev secret from the app secret. */
function signingSecret(): string {
  if (config.paymentProvider === 'razorpay') {
    if (!config.razorpay.keySecret) throw ApiError.validation('Payment gateway is not configured.');
    return config.razorpay.keySecret;
  }
  return crypto.createHash('sha256').update(`${config.jwtSecret}:sandbox-gateway`).digest('hex');
}

export function providerFor(method: 'razorpay' | 'wallet'): Provider {
  if (method === 'wallet') return 'wallet';
  return config.paymentProvider;
}

/**
 * Creates a payment intent at the gateway for the given rupee amount.
 * The amount sent to the gateway is always derived from the database, never from the client.
 */
export async function createGatewayOrder(params: {
  amount: number;
  receipt: string;
  notes: Record<string, string>;
  reference: string;
}): Promise<GatewayOrder> {
  const amountPaise = toPaise(params.amount);
  if (amountPaise <= 0) throw ApiError.badRequest('Payment amount must be greater than zero.');

  if (config.paymentProvider === 'razorpay') {
    const order = await getRazorpay().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: params.receipt.slice(0, 40),
      notes: { ...params.notes, reference: params.reference },
    });
    return {
      gatewayOrderId: order.id,
      provider: 'razorpay',
      amount: params.amount,
      currency: 'INR',
      keyId: config.razorpay.keyId,
      checkoutUrl: null,
    };
  }

  // Sandbox provider: mints an identifier with the same shape as Razorpay's.
  const gatewayOrderId = `order_SBX${crypto.randomBytes(10).toString('hex')}`;
  return {
    gatewayOrderId,
    provider: 'sandbox',
    amount: params.amount,
    currency: 'INR',
    keyId: null,
    checkoutUrl: `/sandbox/checkout?ref=${encodeURIComponent(params.reference)}&order=${encodeURIComponent(gatewayOrderId)}`,
  };
}

/** HMAC-SHA256(order_id + "|" + payment_id, key) – identical contract for both providers. */
function expectedSignature(gatewayOrderId: string, gatewayPaymentId: string): string {
  return crypto.createHmac('sha256', signingSecret()).update(`${gatewayOrderId}|${gatewayPaymentId}`).digest('hex');
}

/** Server-side verification of the gateway callback. Never trusts the client. */
export function verifyGatewaySignature(input: SignatureInput): boolean {
  const expected = expectedSignature(input.gatewayOrderId, input.gatewayPaymentId);
  return safeEqual(expected, input.gatewaySignature);
}

/**
 * Sandbox-only helper used by the local checkout emulator to produce a genuine
 * signature, so that the same server-side verification path is exercised.
 */
export function signSandboxPayment(gatewayOrderId: string, gatewayPaymentId: string): string {
  return expectedSignature(gatewayOrderId, gatewayPaymentId);
}

/** Best-effort refund through Razorpay. Returns true when a refund was issued. */
export async function refundGatewayPayment(gatewayPaymentId: string | undefined, amount: number): Promise<boolean> {
  if (config.paymentProvider !== 'razorpay' || !gatewayPaymentId) return false;
  try {
    await getRazorpay().payments.refund(gatewayPaymentId, { amount: toPaise(amount) });
    return true;
  } catch (error) {
    logger.error('payment', `Gateway refund failed for ${gatewayPaymentId}: ${(error as Error).message}`);
    return false;
  }
}

export async function fetchGatewayPayment(gatewayPaymentId: string): Promise<unknown> {
  if (config.paymentProvider !== 'razorpay') return null;
  try {
    return await getRazorpay().payments.fetch(gatewayPaymentId);
  } catch (error) {
    logger.error('payment', `Gateway fetch failed for ${gatewayPaymentId}: ${(error as Error).message}`);
    return null;
  }
}

export function paymentRuntimeInfo() {
  return {
    provider: config.paymentProvider,
    razorpayKeyId: config.razorpayPublicKey,
    configured: isGatewayConfigured(),
  };
}