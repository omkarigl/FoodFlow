import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type PaymentProvider = 'razorpay' | 'sandbox';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `[config] Missing required environment variable "${name}". Copy server/.env.example to server/.env and set it.`,
    );
  }
  return value;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function asBool(value: string, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function asInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const razorpayKeyId = optional('RAZORPAY_KEY_ID');
const razorpayKeySecret = optional('RAZORPAY_KEY_SECRET');
const providerValue = optional('PAYMENT_PROVIDER', razorpayKeyId && razorpayKeySecret ? 'razorpay' : 'sandbox');

const paymentProvider: PaymentProvider =
  providerValue === 'razorpay' && (!razorpayKeyId || !razorpayKeySecret)
    ? ((): PaymentProvider => {
        if (isProd) throw new Error('[config] PAYMENT_PROVIDER=razorpay requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
        console.warn('[config] Razorpay keys are missing - falling back to PAYMENT_PROVIDER=sandbox.');
        return 'sandbox';
      })()
    : providerValue === 'razorpay'
      ? 'razorpay'
      : 'sandbox';

const jwtSecret = required('JWT_SECRET', isProd ? undefined : 'foodflow-development-only-jwt-secret-change-me');

if (isProd && jwtSecret.length < 32) {
  throw new Error('[config] JWT_SECRET must be at least 32 characters in production.');
}

const useLocalDb = process.argv.includes('--local-db') || asBool(optional('USE_LOCAL_DB'), false);

const supabaseUrl = optional('SUPABASE_URL').replace(/\/+$/, '');
const supabaseServiceKey = optional('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    '[config] User accounts now live in Supabase. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env (see server/.env.example).',
  );
}

export const config = {
  nodeEnv,
  isProd,
  isTest,
  port: asInt(optional('PORT', '5000'), 5000),
  clientUrl: optional('CLIENT_URL', 'http://localhost:5173'),
  extraOrigins: optional('EXTRA_ORIGINS')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  mongoUri: optional('MONGODB_URI', 'mongodb://127.0.0.1:27017/foodflow'),
  useLocalDb,

  /** User accounts (Supabase Postgres). The service_role key is server-only. */
  supabase: {
    url: supabaseUrl,
    serviceRoleKey: supabaseServiceKey,
  },

  jwtSecret,
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '7d'),
  cookieSecret: optional('COOKIE_SECRET', jwtSecret),

  admin: {
    name: optional('ADMIN_NAME', 'Canteen Admin'),
    email: optional('ADMIN_EMAIL', 'admin@foodflow.edu').toLowerCase(),
    password: optional('ADMIN_PASSWORD', 'Admin@12345'),
    phone: optional('ADMIN_PHONE', '9000000000'),
  },

  razorpay: {
    keyId: razorpayKeyId,
    keySecret: razorpayKeySecret,
    webhookSecret: optional('RAZORPAY_WEBHOOK_SECRET'),
  },

  paymentProvider,
  /** Public key handed to the browser checkout. Empty string for the sandbox provider. */
  razorpayPublicKey: paymentProvider === 'razorpay' ? razorpayKeyId : '',

  realtimePollInterval: asInt(optional('REALTIME_POLL_INTERVAL', '15000'), 15000),
} as const;

export type AppConfig = typeof config;