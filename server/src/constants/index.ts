export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for pickup',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

/**
 * Allowed status transitions. The kitchen flow is strictly forward:
 * PENDING_PAYMENT -> PAID -> ACCEPTED -> PREPARING -> READY -> COMPLETED
 * Admin may cancel / reject while the order is still actionable.
 */
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED', 'REJECTED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** Statuses the admin can still act on from the live queue. */
export const ADMIN_ACTIONABLE_STATUSES: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY'];

export const PAYMENT_METHODS = ['razorpay', 'wallet'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const USER_ROLES = ['student', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

export const AUDIT_ACTIONS = {
  ORDER_CREATED: 'ORDER_CREATED',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  WALLET_CREDIT: 'WALLET_CREDIT',
  WALLET_DEBIT: 'WALLET_DEBIT',
  WALLET_TOPUP: 'WALLET_TOPUP',
} as const;