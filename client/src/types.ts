export type Role = 'student' | 'admin';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';

export type PaymentMethod = 'razorpay' | 'wallet';

/** Plain-language status labels used across student, guest and admin screens. */
export const DISPLAY_STATUS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Pending',
  PAID: 'Paid',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready for pickup',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  studentId?: string;
  avatarColor?: string;
  isBlocked?: boolean;
  createdAt: string;
}

export interface Canteen {
  id: string;
  name: string;
  code: string;
  description?: string;
  block: string;
  isOpen: boolean;
  acceptsOrders: boolean;
  /** Decorated by the backend: can an order be placed right now. */
  canOrder: boolean;
  /** Human-readable reason when canOrder is false. */
  reason?: string | null;
  closedMessage?: string;
  openingTime: string;
  closingTime: string;
  prepTimeMins: number;
  activeOrderCount: number;
  maxConcurrentOrders: number;
  withinSchedule?: boolean;
}

export interface QRLocation {
  id: string;
  canteen: string;
  canteenName?: string;
  code: string;
  label: string;
  block?: string;
  description?: string;
  tableHint?: string;
  isActive: boolean;
  scanCount?: number;
}

export interface MenuItem {
  id: string;
  canteen: string | { id: string; name: string; code: string };
  canteenName?: string;
  name: string;
  description?: string;
  category: string;
  price: number;
  imageUrl?: string;
  emoji?: string;
  isAvailable: boolean;
  unavailableReason?: string;
  isVegetarian: boolean;
  /** Compat alias of isVegetarian used by menu/cart screens. */
  isVeg: boolean;
  isSpicy: boolean;
  isPopular: boolean;
  trackStock: boolean;
  stock: number | null;
  lowStockThreshold: number;
  /** Derived: tracked stock at or below threshold. */
  lowStock: boolean;
  /** Derived: !isAvailable or tracked stock is 0. */
  outOfStock: boolean;
  /** Derived: 1 when popular else 0 (sort helper). */
  popularity: number;
  prepTimeMins?: number;
  tags?: string[];
}

export interface OrderItem {
  menuItem: string;
  name: string;
  emoji?: string;
  imageUrl?: string;
  quantity: number;
  price: number;
  /** Compat aliases for the receipt screens. */
  unitPrice: number;
  subtotal: number;
  lineTotal: number;
  isVegetarian?: boolean;
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: number;
  token: string;
  status: OrderStatus;
  /** Absent for guest orders. */
  user?: string | { id?: string; name?: string; email?: string; studentId?: string; role?: Role };
  isGuest?: boolean;
  userName?: string;
  studentId?: string;
  canteen: string | { id?: string; name?: string; code?: string };
  canteenName?: string;
  canteenCode?: string;
  qrLocation?: string | { code?: string; label?: string };
  qrLocationCode?: string;
  qrLocationLabel?: string;
  items: OrderItem[];
  subtotal: number;
  discount?: number;
  tax: number;
  total: number;
  note?: string;
  closeReason?: string;
  placedAt: string;
  estimatedReadyAt?: string;
  acceptedAt?: string;
  preparingAt?: string;
  readyAt?: string;
  completedAt?: string;
  closedAt?: string;
  createdAt?: string;
  payment: {
    method: PaymentMethod;
    status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
    provider?: string;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    paidAt?: string;
    failureReason?: string;
  };
  statusHistory?: Array<{ status: OrderStatus; at: string; byRole?: string; note?: string }>;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface WalletSummary {
  id?: string;
  balance: number;
  totalCredited?: number;
  totalDebited?: number;
  lifetimeCredited: number;
  lifetimeDebited: number;
  transactionCount?: number;
  lastTransactionAt?: string | null;
  pendingTopup?: { amount: number; gatewayOrderId: string; createdAt: string };
}

export interface WalletTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balanceAfter: number;
  reason: string;
  description?: string;
  status: string;
  createdAt: string;
}

export interface CheckoutSettings {
  minOrderValue: number;
  taxPercent: number;
  taxLabel: string;
  currencySymbol: string;
  maxItemsPerOrder: number;
}

export interface AppSettings {
  appName: string;
  currency: string;
  currencySymbol: string;
  taxPercent: number;
  taxLabel: string;
  minOrderValue: number;
  maxItemsPerOrder: number;
  tokenLength: number;
  tokenPrefix: string;
  autoAcceptOrders: boolean;
  lowStockAlerts?: boolean;
  supportEmail?: string;
  supportPhone?: string;
}

export interface DashboardStats {
  generatedAt: string;
  today: { orders: number; revenue: number; itemsSold: number; avgOrderValue: number; revenueDeltaPercent?: number | null; ordersDeltaPercent?: number | null };
  month: { orders: number; revenue: number };
  totals: { orders: number; revenue: number };
  byStatus: Record<string, { count: number; revenue: number }>;
  active: Record<string, number>;
  activeOrderCount: number;
  lowStockCount: number;
  users: Array<{ _id: string; count: number; blocked?: number }>;
  topItems: Array<{ _id?: string; name?: string; quantity: number; revenue: number }>;
  recentOrders: Order[];
  canteens: Canteen[];
  settings: Partial<AppSettings>;
  payment: { provider: string; razorpayKeyId?: string | null; configured: boolean };
}

export interface AnalyticsReport {
  range: { from: string; to: string; days: number };
  summary: {
    totalOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
    cancellationRate?: number;
    growthPercent?: number | null;
    lifetimeOrders?: number;
  };
  daily: Array<{ date: string; orders: number; revenue: number }>;
  hourly: Array<{ hour: number; orders: number; revenue: number }>;
  byCategory: Array<{ category: string; quantity: number; revenue: number; orders?: number }>;
  byStatus: Array<{ status: string; count: number; revenue?: number }>;
  byPaymentMethod: Array<{ method: string; orders: number; revenue?: number; amount?: number }>;
  topItems: Array<{ name: string; quantity: number; revenue: number }>;
  topCustomers?: Array<{ name?: string; email?: string; orders: number; spend: number }>;
}

export interface RevenueReport {
  from: string;
  to: string;
  summary: { orders: number; paidOrders: number; revenue: number; itemsSold: number; avgOrderValue: number };
  bestSellers: Array<{ name: string; quantity: number; revenue: number }>;
  orders: Order[];
}

export interface InventoryRow extends MenuItem {
  stockValue: number;
}

export interface InventorySummary {
  total: number;
  tracked: number;
  outOfStock: number;
  lowStock: number;
  unavailable: number;
  stockValue: number;
}

export interface KanbanBoard {
  columns: Record<OrderStatus, Order[]> | Record<string, Order[]>;
  total: number;
  generatedAt?: string;
}

export interface GatewayOrder {
  gatewayOrderId: string;
  amount: number;
  currency: string;
  provider: 'razorpay' | 'sandbox' | 'wallet';
  keyId?: string | null;
  checkoutUrl?: string | null;
}
