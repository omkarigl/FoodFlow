import { z } from 'zod';
import { ORDER_STATUSES, PAYMENT_METHODS, USER_ROLES } from '../constants';

export const objectId = z
  .string()
  .trim()
  .min(1)
  .refine((v) => /^[a-f\d]{24}$/i.test(v), { message: 'Invalid identifier' });

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/\d/, 'Password must include a number');

/* ------------------------------------------------------------------ auth */

export const registerSchema = z
  .object({
    name: trimmed(2, 80),
    email: z.string().trim().toLowerCase().email('Enter a valid email address'),
    password: passwordSchema,
    // Spec clients send only {name, studentId, email, password}; the app form also
    // sends confirmPassword. Accept both: validate match only when provided.
    confirmPassword: z.string().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number')
      .optional(),
    studentId: trimmed(2, 40).optional(),
  })
  .refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required').max(128),
  // Spec clients send no role — infer from the account. App clients may send it.
  role: z.enum(USER_ROLES).optional(),
});

export const updateProfileSchema = z
  .object({
    name: trimmed(2, 80).optional(),
    phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number').optional(),
    studentId: trimmed(2, 40).optional(),
    notificationEmail: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current one',
    path: ['newPassword'],
  });

/* --------------------------------------------------------------- canteen */

const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm format');

export const canteenStatusUpdateSchema = z
  .object({
    isOpen: z.boolean().optional(),
    acceptsOrders: z.boolean().optional(),
    closedMessage: z.string().trim().max(200).optional(),
    isActive: z.boolean().optional(),
    enforceSchedule: z.boolean().optional(),
    openingTime: timeString.optional(),
    closingTime: timeString.optional(),
    prepTimeMins: z.coerce.number().int().min(1).max(180).optional(),
    maxConcurrentOrders: z.coerce.number().int().min(1).max(500).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Nothing to update' });

export const canteenCreateSchema = z.object({
  name: trimmed(2, 80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,24}$/, 'Code may contain A-Z, 0-9 and _'),
  block: trimmed(2, 80),
  description: z.string().trim().max(240).optional(),
  openingTime: timeString.default('07:00'),
  closingTime: timeString.default('21:00'),
  prepTimeMins: z.coerce.number().int().min(1).max(180).default(12),
});

/* -------------------------------------------------------------- qr codes */

export const qrLocationCreateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_\-]{2,40}$/, 'Code may contain A-Z, 0-9, _ and -'),
  label: trimmed(2, 80),
  canteen: objectId,
  block: trimmed(2, 80),
  description: z.string().trim().max(240).optional(),
  tableHint: z.string().trim().max(60).optional(),
});

export const qrLocationUpdateSchema = qrLocationCreateSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const resolveQrSchema = z.object({
  location: z.string().trim().toUpperCase().min(2).max(40),
});

/* ------------------------------------------------------------------ menu */

const imageField = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\//i.test(v) || v.startsWith('data:image/'), {
    message: 'Image must be a http(s) URL or a data URI',
  })
  .optional();

export const menuItemCreateSchema = z.object({
  canteen: objectId,
  name: trimmed(2, 90),
  description: z.string().trim().max(300).optional(),
  price: z.coerce.number().min(0, 'Price cannot be negative').max(100000),
  category: trimmed(2, 40),
  imageUrl: imageField,
  emoji: z.string().trim().max(8).optional(),
  isAvailable: z.boolean().default(true),
  isVegetarian: z.boolean().default(false),
  isSpicy: z.boolean().default(false),
  isPopular: z.boolean().default(false),
  prepTimeMins: z.coerce.number().int().min(1).max(180).default(10),
  trackStock: z.boolean().default(true),
  stock: z.coerce.number().int().min(0).max(100000).nullable().default(null),
  lowStockThreshold: z.coerce.number().int().min(0).max(10000).default(5),
  tags: z.array(z.string().trim().max(24)).max(10).default([]),
});

export const menuItemUpdateSchema = menuItemCreateSchema
  .partial()
  .omit({ canteen: true })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const menuItemAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
  reason: z.string().trim().max(160).optional(),
});

export const menuQuerySchema = z.object({
  canteen: objectId.optional(),
  search: z.string().trim().max(80).optional(),
  category: z.string().trim().max(40).optional(),
  vegOnly: z.enum(['true', 'false']).optional(),
  availableOnly: z.enum(['true', 'false']).default('false'),
  // Spec alias: ?is_available=true|false
  is_available: z.enum(['true', 'false']).optional(),
  includeUnavailable: z.enum(['true', 'false']).optional(),
  popular: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(60),
  sort: z.enum(['name', 'price_asc', 'price_desc', 'newest', 'popular']).default('popular'),
});

export const inventoryAdjustSchema = z
  .object({
    itemId: objectId,
    mode: z.enum(['set', 'add', 'subtract']).default('set'),
    quantity: z.coerce.number().int().min(0).max(100000),
    trackStock: z.boolean().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((d) => d.mode !== 'set' || d.quantity >= 0, { message: 'Stock cannot be negative' });

export const inventoryBulkSchema = z.object({
  updates: z
    .array(z.object({ itemId: objectId, quantity: z.coerce.number().int().min(0).max(100000), trackStock: z.boolean().optional() }))
    .min(1)
    .max(100),
});

export const bulkAvailabilitySchema = z.object({
  itemIds: z.array(objectId).min(1).max(200),
  isAvailable: z.boolean(),
  reason: z.string().trim().max(160).optional(),
});

/* ---------------------------------------------------------------- orders */

const cartLineSchema = z.object({
  menuItem: objectId,
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(50),
  notes: z.string().trim().max(140).optional(),
});

export const createOrderSchema = z
  .object({
    canteen: objectId,
    qrLocation: objectId.optional(),
    qrLocationCode: z.string().trim().toUpperCase().max(40).optional(),
    items: z.array(cartLineSchema).min(1, 'Your cart is empty').max(50),
    paymentMethod: z.enum(PAYMENT_METHODS).default('razorpay'),
    note: z.string().trim().max(300).optional(),
  })
  .refine((d) => Boolean(d.qrLocation || d.qrLocationCode), {
    message: 'A QR location is required to place an order',
    path: ['qrLocation'],
  });

export const orderQuerySchema = z.object({
  status: z
    .union([z.enum(ORDER_STATUSES), z.literal('active'), z.literal('all')])
    .optional(),
  scope: z.enum(['mine', 'all']).default('mine'),
  canteen: objectId.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(80).optional(),
});

export const updateStatusSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    note: z.string().trim().max(240).optional(),
    reason: z.string().trim().max(240).optional(),
  })
  .refine((d) => d.status !== 'PENDING_PAYMENT', {
    message: 'PENDING_PAYMENT cannot be set manually',
    path: ['status'],
  });

/* -------------------------------------------------------------- payments */

export const createPaymentOrderSchema = z.object({
  orderId: objectId,
  // Spec flow: guests call the SAME endpoint with no auth header and instead
  // present the per-order claim token returned at order creation.
  guestClaimToken: z.string().trim().min(8).max(256).optional(),
});

export const verifyPaymentSchema = z.object({
  orderId: objectId,
  gatewayOrderId: z.string().trim().min(4).max(120),
  gatewayPaymentId: z.string().trim().min(4).max(120),
  gatewaySignature: z.string().trim().min(8).max(256),
  // Guest variant of the same spec endpoint.
  guestClaimToken: z.string().trim().min(8).max(256).optional(),
});

/* ---------------------------------------------------------------- wallet */

export const walletTopupSchema = z.object({
  amount: z.coerce.number().min(10, 'Minimum top-up is 10').max(10000, 'Maximum top-up is 10000'),
});

export const walletTopupVerifySchema = z.object({
  gatewayOrderId: z.string().trim().min(4).max(120),
  gatewayPaymentId: z.string().trim().min(4).max(120),
  gatewaySignature: z.string().trim().min(8).max(256),
});

export const walletAdjustSchema = z.object({
  // Supabase account id (UUID) — accounts no longer live in MongoDB.
  user: z.string().trim().uuid('Invalid user id'),
  amount: z.coerce.number().min(0.01, 'Amount must be positive').max(100000),
  type: z.enum(['credit', 'debit']),
  reason: z.string().trim().max(200).optional(),
});

/* ------------------------------------------------------- admin / settings */

export const adminUsersQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(['all', 'active', 'blocked']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['newest', 'name', 'orders', 'spend']).default('newest'),
});

export const adminUserUpdateSchema = z
  .object({
    role: z.enum(USER_ROLES).optional(),
    isBlocked: z.boolean().optional(),
    blockedReason: z.string().trim().max(300).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const settingsUpdateSchema = z
  .object({
    appName: trimmed(2, 40).optional(),
    currency: z.string().trim().length(3).optional(),
    currencySymbol: z.string().trim().max(4).optional(),
    taxPercent: z.coerce.number().min(0).max(30).optional(),
    taxLabel: trimmed(1, 16).optional(),
    minOrderValue: z.coerce.number().min(0).max(10000).optional(),
    maxItemsPerOrder: z.coerce.number().int().min(1).max(100).optional(),
    tokenLength: z.coerce.number().int().min(3).max(6).optional(),
    tokenPrefix: z
      .string()
      .trim()
      .max(4)
      .regex(/^[A-Za-z0-9]*$/, 'Prefix may only contain letters and digits')
      .optional(),
    autoAcceptOrders: z.boolean().optional(),
    receiptFooter: z.string().trim().max(200).optional(),
    receiptHeaderNote: z.string().trim().max(200).optional(),
    supportEmail: z.string().trim().email().optional(),
    supportPhone: z.string().trim().max(20).optional(),
    lowStockAlerts: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

export const createStaffSchema = z.object({
  name: trimmed(2, 80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: passwordSchema,
  phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number').optional(),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(14),
  canteen: objectId.optional(),
});

export const idParamSchema = z.object({ id: objectId });
/** Supabase account ids (UUID) — admin user routes, wallet adjustments. */
export const userIdParamSchema = z.object({ id: z.string().trim().uuid('Invalid user id') });
export const canteenIdParamSchema = z.object({ canteenId: objectId });