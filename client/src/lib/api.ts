import type {
  AnalyticsReport,
  AppSettings,
  Canteen,
  CheckoutSettings,
  DashboardStats,
  GatewayOrder,
  InventorySummary,
  KanbanBoard,
  MenuItem,
  Order,
  OrderStatus,
  QRLocation,
  RevenueReport,
  Role,
  User,
  WalletSummary,
  WalletTransaction,
} from '../types';

const BASE = import.meta.env.VITE_API_URL ?? '';
const TOKEN_KEY = 'foodflow.token';
const GUEST_CLAIMS_KEY = 'foodflow.guestClaims';

export class ApiError extends Error {
  status: number;
  name: string;
  details?: unknown;

  constructor(status: number, name: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.name = name;
    this.details = details;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isPaymentError(): boolean {
    return this.name === 'INSUFFICIENT_STOCK' || this.name === 'CANTEEN_CLOSED' || this.name === 'CANTEEN_FULL';
  }
}

export const tokenStore = {
  get: (): string | null => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (token: string): void => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode — session still works in memory */
    }
  },
  clear: (): void => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* noop */
    }
  },
};

/** Per-order bearer secrets for guest (no-account) orders. */
export const guestClaimStore = {
  all: (): Record<string, string> => {
    try {
      return JSON.parse(sessionStorage.getItem(GUEST_CLAIMS_KEY) ?? '{}') as Record<string, string>;
    } catch {
      return {};
    }
  },
  get: (orderId: string): string | null => guestClaimStore.all()[orderId] ?? null,
  set: (orderId: string, claim: string): void => {
    try {
      sessionStorage.setItem(GUEST_CLAIMS_KEY, JSON.stringify({ ...guestClaimStore.all(), [orderId]: claim }));
    } catch {
      /* noop */
    }
  },
  clear: (orderId: string): void => {
    try {
      const claims = guestClaimStore.all();
      delete claims[orderId];
      sessionStorage.setItem(GUEST_CLAIMS_KEY, JSON.stringify(claims));
    } catch {
      /* noop */
    }
  },
};

type Query = Record<string, string | number | boolean | undefined | null>;

function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  token?: string | null;
  signal?: AbortSignal;
}

function readErrorMessage(data: unknown, status: number): { name: string; message: string; details?: unknown } {
  const root = (data ?? {}) as { error?: unknown };
  if (typeof root.error === 'string') {
    return { name: 'REQUEST_FAILED', message: root.error };
  }
  const err = (root.error ?? {}) as { name?: string; message?: string; errors?: unknown };
  return {
    name: err.name ?? 'REQUEST_FAILED',
    message: err.message ?? `Request failed with status ${status}.`,
    details: err.errors,
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options;
  // Guests never send auth headers: explicit null opts out, undefined falls back to storage.
  const token = options.token === undefined ? tokenStore.get() : options.token;

  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}${buildQuery(query)}`, {
      method,
      credentials: 'include',
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the FoodFlow server. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: { message: 'The server returned an unexpected response.' } };
    }
  }

  if (!response.ok) {
    const err = readErrorMessage(data, response.status);
    throw new ApiError(response.status, err.name, err.message, err.details);
  }

  return data as T;
}

/* ------------------------------------------------------------ normalizers */

type Raw = Record<string, unknown>;

function idOf(raw: Raw): string {
  return String(raw.id ?? raw._id ?? '');
}

export function normCanteen(raw: Raw): Canteen {
  const reason = (raw.reason as string | undefined) ?? null;
  return {
    id: idOf(raw),
    name: String(raw.name ?? ''),
    code: String(raw.code ?? ''),
    description: (raw.description as string | undefined) ?? undefined,
    block: String(raw.block ?? ''),
    isOpen: Boolean(raw.isOpen ?? true),
    acceptsOrders: Boolean(raw.acceptsOrders ?? true),
    canOrder: Boolean(raw.canOrder ?? raw.isOpen ?? true),
    reason,
    closedMessage: (raw.closedMessage as string | undefined) ?? reason ?? undefined,
    openingTime: String(raw.openingTime ?? '07:00'),
    closingTime: String(raw.closingTime ?? '21:00'),
    prepTimeMins: Number(raw.prepTimeMins ?? 12),
    activeOrderCount: Number(raw.activeOrderCount ?? 0),
    maxConcurrentOrders: Number(raw.maxConcurrentOrders ?? raw.maxActiveOrders ?? 40),
    withinSchedule: (raw.withinSchedule as boolean | undefined) ?? undefined,
  };
}

export function normLocation(raw: Raw, canteenName?: string): QRLocation {
  const canteen = raw.canteen as unknown;
  const canteenId =
    typeof canteen === 'string' ? canteen : canteen && typeof canteen === 'object' ? idOf(canteen as Raw) : '';
  const populated = canteen && typeof canteen === 'object' ? (canteen as Raw) : null;
  return {
    id: idOf(raw),
    canteen: canteenId,
    canteenName: canteenName ?? (populated?.name as string | undefined),
    code: String(raw.code ?? ''),
    label: String(raw.label ?? ''),
    block: (raw.block as string | undefined) ?? undefined,
    description: (raw.description as string | undefined) ?? undefined,
    tableHint: (raw.tableHint as string | undefined) ?? undefined,
    isActive: raw.isActive === undefined ? true : Boolean(raw.isActive),
    scanCount: (raw.scanCount as number | undefined) ?? undefined,
  };
}

export function normMenuItem(raw: Raw): MenuItem {
  const canteen = raw.canteen as unknown;
  const canteenName =
    canteen && typeof canteen === 'object' ? (((canteen as Raw).name as string | undefined) ?? undefined) : undefined;
  const isVegetarian = Boolean(raw.isVegetarian ?? raw.isVeg ?? false);
  const isAvailable = raw.isAvailable === undefined ? true : Boolean(raw.isAvailable);
  const trackStock = raw.trackStock === undefined ? false : Boolean(raw.trackStock);
  const stock = raw.stock === null || raw.stock === undefined ? null : Number(raw.stock);
  const threshold = Number(raw.lowStockThreshold ?? 5);
  const outOfStock = !isAvailable || (trackStock && stock !== null && stock <= 0);
  const lowStock = !outOfStock && trackStock && stock !== null && stock <= threshold;
  const isPopular = Boolean(raw.isPopular ?? raw.popularity ?? false);
  return {
    id: idOf(raw),
    canteen: typeof canteen === 'string' ? canteen : canteen && typeof canteen === 'object' ? idOf(canteen as Raw) : '',
    canteenName,
    name: String(raw.name ?? ''),
    description: (raw.description as string | undefined) ?? undefined,
    category: String(raw.category ?? 'Other'),
    price: Number(raw.price ?? 0),
    imageUrl: (raw.imageUrl as string | undefined) || undefined,
    emoji: (raw.emoji as string | undefined) ?? undefined,
    isAvailable,
    unavailableReason: (raw.unavailableReason as string | undefined) ?? undefined,
    isVegetarian,
    isVeg: isVegetarian,
    isSpicy: Boolean(raw.isSpicy ?? false),
    isPopular,
    trackStock,
    stock,
    lowStockThreshold: threshold,
    lowStock,
    outOfStock,
    popularity: isPopular ? 1 : 0,
    prepTimeMins: (raw.prepTimeMins as number | undefined) ?? undefined,
    tags: (raw.tags as string[] | undefined) ?? undefined,
  };
}

function normOrderItem(raw: Raw): Order['items'][number] {
  const menuItem = raw.menuItem as unknown;
  const menuId = typeof menuItem === 'string' ? menuItem : menuItem && typeof menuItem === 'object' ? idOf(menuItem as Raw) : '';
  const populated = menuItem && typeof menuItem === 'object' ? (menuItem as Raw) : null;
  const price = Number(raw.price ?? 0);
  const quantity = Number(raw.quantity ?? 0);
  const subtotal = Number(raw.subtotal ?? price * quantity);
  return {
    menuItem: menuId,
    name: String(raw.name ?? ''),
    emoji: (raw.emoji as string | undefined) ?? (populated?.emoji as string | undefined),
    imageUrl: (populated?.imageUrl as string | undefined) ?? undefined,
    quantity,
    price,
    unitPrice: price,
    subtotal,
    lineTotal: subtotal,
    isVegetarian: (raw.isVegetarian as boolean | undefined) ?? undefined,
    notes: (raw.notes as string | undefined) ?? undefined,
  };
}

export function normOrder(raw: Raw): Order {
  const user = raw.user as unknown;
  const userObj = user && typeof user === 'object' ? (user as Raw) : null;
  const canteen = raw.canteen as unknown;
  const canteenObj = canteen && typeof canteen === 'object' ? (canteen as Raw) : null;
  const qr = raw.qrLocation as unknown;
  const qrObj = qr && typeof qr === 'object' ? (qr as Raw) : null;
  return {
    ...(raw as object),
    id: idOf(raw),
    orderNumber: Number(raw.orderNumber ?? 0),
    token: String(raw.token ?? ''),
    status: (raw.status as Order['status']) ?? 'PENDING_PAYMENT',
    user: typeof user === 'string' ? user : (userObj ? ({ ...userObj, id: idOf(userObj) } as never) : undefined),
    isGuest: Boolean(raw.isGuest ?? false),
    userName: (userObj?.name as string | undefined) ?? undefined,
    studentId: (userObj?.studentId as string | undefined) ?? undefined,
    canteen: typeof canteen === 'string' ? canteen : (canteenObj as never) ?? '',
    canteenName: (canteenObj?.name as string | undefined) ?? undefined,
    canteenCode: (canteenObj?.code as string | undefined) ?? undefined,
    qrLocation: typeof qr === 'string' ? qr : ((qrObj as never) ?? undefined),
    qrLocationCode: (raw.qrLocationCode as string | undefined) ?? (qrObj?.code as string | undefined),
    qrLocationLabel: (qrObj?.label as string | undefined) ?? undefined,
    items: Array.isArray(raw.items) ? (raw.items as Raw[]).map(normOrderItem) : [],
    subtotal: Number(raw.subtotal ?? 0),
    discount: Number(raw.discount ?? 0),
    tax: Number(raw.tax ?? 0),
    total: Number(raw.total ?? 0),
    note: (raw.note as string | undefined) ?? undefined,
    closeReason: (raw.closeReason as string | undefined) ?? undefined,
    placedAt: String(raw.placedAt ?? raw.createdAt ?? ''),
    estimatedReadyAt: (raw.estimatedReadyAt as string | undefined) ?? undefined,
    acceptedAt: (raw.acceptedAt as string | undefined) ?? undefined,
    preparingAt: (raw.preparingAt as string | undefined) ?? undefined,
    readyAt: (raw.readyAt as string | undefined) ?? undefined,
    completedAt: (raw.completedAt as string | undefined) ?? undefined,
    closedAt: (raw.closedAt as string | undefined) ?? undefined,
    createdAt: (raw.createdAt as string | undefined) ?? undefined,
    payment: {
      method: ((raw as Raw).payment as Order['payment'])?.method ?? 'razorpay',
      status: ((raw as Raw).payment as Order['payment'])?.status ?? 'PENDING',
      provider: ((raw as Raw).payment as Order['payment'])?.provider,
      gatewayOrderId: ((raw as Raw).payment as Order['payment'])?.gatewayOrderId,
      gatewayPaymentId: ((raw as Raw).payment as Order['payment'])?.gatewayPaymentId,
      paidAt: ((raw as Raw).payment as Order['payment'])?.paidAt,
      failureReason: ((raw as Raw).payment as Order['payment'])?.failureReason,
    },
    statusHistory: (raw.statusHistory as Order['statusHistory']) ?? undefined,
  } as Order;
}

function normUser(raw: Raw): User {
  return {
    id: idOf(raw),
    name: String(raw.name ?? ''),
    email: String(raw.email ?? ''),
    phone: (raw.phone as string | undefined) ?? undefined,
    role: (raw.role as Role) ?? 'student',
    studentId: (raw.studentId as string | undefined) ?? undefined,
    avatarColor: (raw.avatarColor as string | undefined) ?? undefined,
    isBlocked: (raw.isBlocked as boolean | undefined) ?? undefined,
    createdAt: String(raw.createdAt ?? ''),
  };
}

/* ------------------------------------------------------------------ auth */
export const authApi = {
  login: async (email: string, password: string, role?: Role) => {
    const result = await request<{ user: Raw; token?: string; access_token?: string }>('/auth/login', {
      method: 'POST',
      body: role ? { email, password, role } : { email, password },
      token: null,
    });
    return { user: normUser(result.user), token: result.token ?? result.access_token ?? '' };
  },
  register: async (body: { name: string; email: string; password: string; phone?: string; studentId?: string }) => {
    const result = await request<{ user: Raw; token?: string; access_token?: string }>('/auth/register', { method: 'POST', body, token: null });
    return { user: normUser(result.user), token: result.token ?? result.access_token ?? '' };
  },
  me: async () => {
    const result = await request<{ user: Raw }>('/auth/me');
    return { user: normUser(result.user) };
  },
  updateProfile: async (body: { name?: string; phone?: string; studentId?: string }) => {
    const result = await request<{ user: Raw }>('/auth/me', { method: 'PATCH', body });
    return { user: normUser(result.user) };
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ message: string }>('/auth/me/password', { method: 'PATCH', body: { currentPassword, newPassword } }),
  logout: () => request<{ message: string }>('/auth/logout', { method: 'POST' }),
  checkEmail: (email: string) => request<{ available: boolean | null }>('/auth/check-email', { query: { email } }),
};

/* --------------------------------------------------------------- canteen */
export const canteenApi = {
  status: async () => {
    const result = await request<{ canteens: Raw[] }>(
      '/canteen/status',
      tokenStore.get() ? {} : { token: null },
    );
    return { canteens: result.canteens.map(normCanteen) };
  },
  categories: () => request<{ categories: string[] }>('/canteen/categories', tokenStore.get() ? {} : { token: null }),
  qrLocations: async (canteen?: string) => {
    const result = await request<{ locations: Raw[] }>(
      '/canteen/qr-locations',
      tokenStore.get() ? { query: { canteen } } : { query: { canteen }, token: null },
    );
    return { locations: result.locations.map((l) => normLocation(l)) };
  },
  resolve: async (code: string) => {
    const result = await request<{ canteen: Raw; location: Raw }>(
      '/canteen/resolve',
      tokenStore.get() ? { query: { location: code } } : { query: { location: code }, token: null },
    );
    const canteen = normCanteen(result.canteen);
    const location = normLocation(result.location, canteen.name);
    return { canteen, location: { ...location, canteen: canteen.id, canteenName: canteen.name } };
  },
  /** Admin-only: pause/resume a canteen. */
  setStatus: async (canteenId: string, body: Record<string, unknown>) => {
    const result = await request<{ canteen: Raw }>(`/canteen/status/${canteenId}`, { method: 'PATCH', body });
    return { canteen: normCanteen(result.canteen) };
  },
  /** Admin-only: QR location management (server enforces admin). */
  createQrLocation: (body: Record<string, unknown>) => request<{ location: Raw }>('/canteen/qr-locations', { method: 'POST', body }),
  updateQrLocation: (id: string, body: Record<string, unknown>) =>
    request<{ location: Raw }>(`/canteen/qr-locations/${id}`, { method: 'PATCH', body }),
  deleteQrLocation: (id: string) => request<{ success: boolean; message: string }>(`/canteen/qr-locations/${id}`, { method: 'DELETE' }),
};

/* ------------------------------------------------------------------ menu */
export const menuApi = {
  list: async (query?: Query & { canteen?: string }, signal?: AbortSignal) => {
    const result = await request<{ items: Raw[]; total: number; page: number; limit: number; pages: number }>(
      '/menu',
      tokenStore.get() ? { query, signal } : { query, signal, token: null },
    );
    const items = result.items.map(normMenuItem);
    const categories = Array.from(new Set(items.map((i) => i.category))).sort();
    return { items, categories, total: result.total, page: result.page, limit: result.limit, pages: result.pages };
  },
  item: async (id: string) => {
    const result = await request<{ item: Raw }>(`/menu/${id}`, tokenStore.get() ? {} : { token: null });
    return { item: normMenuItem(result.item) };
  },
  inventory: async (query?: Query) => {
    const result = await request<{ items: Raw[]; summary: InventorySummary }>('/menu/inventory', { query });
    return {
      items: result.items.map((raw) => {
        const item = normMenuItem(raw);
        return { ...item, stockValue: Math.round((item.price * (item.stock ?? 0)) * 100) / 100 };
      }),
      summary: result.summary,
    };
  },
  inventoryHistory: (id: string) => request<{ movements: Array<Record<string, unknown>> }>(`/menu/${id}/inventory-history`),
  create: async (body: Record<string, unknown>) => {
    const result = await request<{ item: Raw }>('/menu', { method: 'POST', body });
    return { item: normMenuItem(result.item) };
  },
  update: async (id: string, body: Record<string, unknown>) => {
    const result = await request<{ item: Raw }>(`/menu/${id}`, { method: 'PATCH', body });
    return { item: normMenuItem(result.item) };
  },
  setAvailability: async (id: string, isAvailable: boolean, reason?: string) => {
    const result = await request<{ item: Raw }>(`/menu/${id}/availability`, {
      method: 'PATCH',
      body: { isAvailable, reason },
    });
    return { item: normMenuItem(result.item) };
  },
  bulkAvailability: (ids: string[], isAvailable: boolean) =>
    request<{ success: boolean; updated: number }>('/menu/bulk/availability', {
      method: 'POST',
      body: { itemIds: ids, isAvailable },
    }),
  adjustInventory: (body: { itemId: string; mode: 'set' | 'add' | 'subtract'; quantity: number; reason?: string }) =>
    request<{ item: Raw; message: string }>('/menu/inventory/adjust', { method: 'POST', body }),
  bulkInventory: (body: { updates: Array<{ itemId: string; quantity: number }> }) =>
    request<{ updated: Array<unknown>; message: string }>('/menu/inventory/bulk-set', { method: 'POST', body }),
  remove: (id: string) => request<{ success: boolean; message: string }>(`/menu/${id}`, { method: 'DELETE' }),
};

/* ---------------------------------------------------------------- orders */
export interface ValidateLine {
  menuItem: string;
  ok: boolean;
  reason?: string;
  available: number | null;
  price?: number;
  name?: string;
}

export const orderApi = {
  create: async (body: {
    canteen: string;
    qrLocationCode: string;
    items: Array<{ menuItem: string; quantity: number; notes?: string }>;
    paymentMethod: 'razorpay' | 'wallet';
    note?: string;
  }) => {
    const result = await request<{ order: Raw; gateway: GatewayOrder | null }>('/orders', { method: 'POST', body });
    return { order: normOrder(result.order), gateway: result.gateway };
  },
  createGuest: async (body: {
    canteen: string;
    qrLocationCode: string;
    items: Array<{ menuItem: string; quantity: number; notes?: string }>;
    note?: string;
  }) => {
    const result = await request<{ order: Raw; gateway: GatewayOrder | null; guestClaimToken: string; orderId: string }>(
      '/orders/guest',
      { method: 'POST', body, token: null },
    );
    guestClaimStore.set(result.orderId, result.guestClaimToken);
    return { order: normOrder(result.order), gateway: result.gateway, guestClaimToken: result.guestClaimToken, orderId: result.orderId };
  },
  validateCart: async (body: { items: Array<{ menuItem: string; quantity: number }> }) => {
    const result = await request<{ lines: ValidateLine[]; ok: boolean }>(
      '/orders/validate-cart',
      tokenStore.get() ? { method: 'POST', body } : { method: 'POST', body, token: null },
    );
    const issues = result.lines.filter((l) => !l.ok).map((l) => l.reason ?? 'An item in your cart is unavailable.');
    return { ok: result.ok && issues.length === 0, issues, lines: result.lines };
  },
  checkoutContext: async (canteen: string, location?: string) => {
    const result = await request<{ canteen: Raw; qrLocation: Raw | null; settings: CheckoutSettings }>(
      '/orders/checkout-context',
      tokenStore.get() ? { query: { canteen, location } } : { query: { canteen, location }, token: null },
    );
    return {
      canteen: normCanteen(result.canteen),
      qrLocation: result.qrLocation ? normLocation(result.qrLocation) : null,
      settings: result.settings,
    };
  },
  mine: async (query?: Query) => {
    const result = await request<{ orders: Raw[]; total: number; page: number; limit: number; pages: number }>('/orders/my', {
      query,
    });
    return { orders: result.orders.map(normOrder), total: result.total, page: result.page, limit: result.limit, pages: result.pages };
  },
  history: async (query?: Query) => {
    const result = await request<{ orders: Raw[]; total: number; page: number; limit: number; pages: number }>(
      '/orders/my-history',
      { query },
    );
    return { orders: result.orders.map(normOrder), total: result.total, page: result.page, limit: result.limit, pages: result.pages };
  },
  current: async () => {
    const result = await request<{ orders: Raw[] }>('/orders/current');
    return { orders: result.orders.map(normOrder) };
  },
  one: async (id: string, claim?: string | null) => {
    const headers: Record<string, string> = {};
    const effectiveClaim = claim ?? guestClaimStore.get(id) ?? undefined;
    const result = await request<{ order: Raw }>(
      `/orders/${id}`,
      tokenStore.get()
        ? { query: effectiveClaim ? { claim: effectiveClaim } : undefined }
        : { query: effectiveClaim ? { claim: effectiveClaim } : undefined, token: null },
    );
    void headers;
    return { order: normOrder(result.order) };
  },
  guestOne: async (id: string, claim?: string | null) => {
    const effectiveClaim = claim ?? guestClaimStore.get(id) ?? '';
    const result = await request<{ order: Raw }>(`/orders/guest/${id}`, { query: { claim: effectiveClaim }, token: null });
    return { order: normOrder(result.order) };
  },
  cancel: async (id: string, reason?: string) => {
    const result = await request<{ order: Raw; message: string }>(`/orders/${id}/cancel`, { method: 'POST', body: { reason } });
    return { order: normOrder(result.order), message: result.message };
  },
  guestCancel: async (id: string, claim: string, reason?: string) => {
    const result = await request<{ order: Raw; message: string }>(`/orders/guest/${id}/cancel`, {
      method: 'POST',
      body: { guestClaimToken: claim, reason },
      token: null,
    });
    return { order: normOrder(result.order), message: result.message };
  },
  adminList: async (query?: Query) => {
    const result = await request<{ orders: Raw[]; total: number; page: number; limit: number; pages: number; counts: Record<string, number> }>(
      '/orders/admin',
      { query },
    );
    return {
      orders: result.orders.map(normOrder),
      total: result.total,
      page: result.page,
      limit: result.limit,
      pages: result.pages,
      counts: result.counts,
    };
  },
  queue: async (canteen?: string) => {
    const result = await request<{ columns: Record<string, Raw[]>; total: number; generatedAt: string }>('/orders/queue', {
      query: { canteen },
    });
    const columns = Object.fromEntries(
      Object.entries(result.columns).map(([k, v]) => [k, (v as Raw[]).map(normOrder)]),
    ) as KanbanBoard['columns'];
    return { columns, total: result.total, generatedAt: result.generatedAt };
  },
  setStatus: async (id: string, status: OrderStatus, note?: string) => {
    const result = await request<{ order: Raw; message: string }>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: { status, note },
    });
    return { order: normOrder(result.order), message: result.message };
  },
};

/* --------------------------------------------------------------- payment */
export const paymentApi = {
  config: async () => {
    const result = await request<{
      payment: { provider: string; razorpayKeyId?: string | null; configured: boolean };
      currency: { code: string; symbol: string };
      minOrderValue: number;
      taxPercent: number;
      taxLabel: string;
    }>(`/payment/config`, tokenStore.get() ? {} : { token: null });
    return {
      provider: (result.payment.provider === 'razorpay' ? 'razorpay' : 'sandbox') as 'razorpay' | 'sandbox',
      keyId: result.payment.razorpayKeyId ?? undefined,
      currency: result.currency.code,
      currencySymbol: result.currency.symbol,
      minOrderValue: result.minOrderValue,
      taxPercent: result.taxPercent,
      taxLabel: result.taxLabel,
      configured: result.payment.configured,
    };
  },
  createOrder: async (orderId: string) => {
    const result = await request<{ gateway: GatewayOrder; order: { id: string; token: string; total: number } }>(
      '/payment/create-order',
      { method: 'POST', body: { orderId } },
    );
    return result;
  },
  verify: async (body: { orderId: string; gatewayOrderId: string; gatewayPaymentId: string; gatewaySignature: string }) => {
    const result = await request<{ order: Raw; wallet: WalletSummary; message: string }>('/payment/verify', {
      method: 'POST',
      body,
    });
    return { order: normOrder(result.order), wallet: result.wallet, message: result.message };
  },
  guestCreateOrder: async (orderId: string, guestClaimToken: string) => {
    const result = await request<{ gateway: GatewayOrder; order: { id: string; token: string; total: number } }>(
      '/payment/guest/create-order',
      { method: 'POST', body: { orderId, guestClaimToken }, token: null },
    );
    return result;
  },
  guestVerify: async (body: {
    orderId: string;
    guestClaimToken: string;
    gatewayOrderId: string;
    gatewayPaymentId: string;
    gatewaySignature: string;
  }) => {
    const result = await request<{ order: Raw; message: string }>('/payment/guest/verify', {
      method: 'POST',
      body,
      token: null,
    });
    return { order: normOrder(result.order), message: result.message };
  },
  guestSettleById: async (
    id: string,
    body: { guestClaimToken: string; gatewayOrderId: string; gatewayPaymentId: string; gatewaySignature: string },
  ) => {
    const result = await request<{ order: Raw; message: string }>(`/orders/guest/${id}/verify`, {
      method: 'POST',
      body,
      token: null,
    });
    return { order: normOrder(result.order), message: result.message };
  },
  sandboxCheckout: (gatewayOrderId: string, outcome: 'success' | 'failure' = 'success') =>
    request<{ success: boolean; gatewayPaymentId: string; gatewaySignature: string; message?: string }>(
      '/payment/sandbox/checkout',
      { method: 'POST', body: { gatewayOrderId, outcome } },
    ),
  wallet: async () => {
    const result = await request<{ wallet: WalletSummary }>('/payment/wallet');
    return { wallet: result.wallet };
  },
  walletTransactions: (query?: Query) =>
    request<{ transactions: WalletTransaction[]; total: number; page: number; limit: number; pages: number }>(
      '/payment/wallet/transactions',
      { query },
    ),
  walletTopup: (amount: number) =>
    request<{ wallet: WalletSummary; gateway: GatewayOrder }>('/payment/wallet/topup', { method: 'POST', body: { amount } }),
  walletTopupVerify: (body: { gatewayOrderId: string; gatewayPaymentId: string; gatewaySignature: string }) =>
    request<{ wallet: WalletSummary; alreadyApplied: boolean; message: string }>('/payment/wallet/topup/verify', {
      method: 'POST',
      body,
    }),
};

/* ----------------------------------------------------------------- admin */
export const adminApi = {
  dashboard: async (canteen?: string) => {
    const result = await request<DashboardStats>('/admin/dashboard', { query: { canteen } });
    return { ...result, recentOrders: (result.recentOrders as unknown as Raw[]).map(normOrder) };
  },
  analytics: (query?: Query) => request<AnalyticsReport>('/admin/analytics', { query }),
  revenue: async (from: string, to: string, canteen?: string) => {
    const result = await request<RevenueReport>('/reports/revenue', { query: { from, to, canteen } });
    return { ...result, orders: result.orders.map((o) => normOrder(o as unknown as Raw)) };
  },
  health: () => request<{ payment: unknown; counts: Record<string, number>; environment: string; time: string }>('/admin/health'),
  users: (query?: Query) =>
    request<{ users: Array<User & { orders: number; spend: number; walletBalance: number }>; total: number; page: number; limit: number; pages: number }>(
      '/admin/users',
      { query },
    ),
  user: (id: string) => request<{ user: User; wallet: WalletSummary; orders: Order[] }>(`/admin/users/${id}`),
  updateUser: (id: string, body: Record<string, unknown>) => request<{ user: User; message: string }>(`/admin/users/${id}`, { method: 'PATCH', body }),
  removeUser: (id: string) => request<{ success: boolean; message: string }>(`/admin/users/${id}`, { method: 'DELETE' }),
  createStaff: (body: { name: string; email: string; password: string; phone?: string }) =>
    request<{ user: Raw }>('/admin/users/staff', { method: 'POST', body }),
  settings: () => request<{ settings: AppSettings; categories: string[]; payment: unknown }>('/admin/settings'),
  updateSettings: (body: Partial<AppSettings>) => request<{ settings: AppSettings; message: string }>('/admin/settings', { method: 'PATCH', body }),
  tokens: () =>
    request<{
      format: string;
      length: number;
      prefix: string;
      preview: string[];
      issuedToday: number;
      recent: Array<{ id: string; token: string; orderNumber: number; status: string; student: string; canteen: string; createdAt: string }>;
    }>('/admin/tokens'),
  syncCounters: () => request<{ success: boolean; message: string; canteens: unknown }>('/admin/sync-counters', { method: 'POST' }),
  adjustWallet: (body: { user: string; amount: number; type: 'credit' | 'debit'; reason?: string }) =>
    request<{ wallet: WalletSummary; message: string; balance: number }>('/admin/wallet/adjust', { method: 'POST', body }),
  canteens: async () => {
    const result = await request<{ canteens: Raw[] }>('/canteen');
    return { canteens: result.canteens.map(normCanteen) };
  },
  createCanteen: (body: Record<string, unknown>) => request<{ canteen: Raw }>('/canteen', { method: 'POST', body }),
  setCanteenStatus: (canteenId: string, body: Record<string, unknown>) =>
    request<{ canteen: Raw }>(`/canteen/status/${canteenId}`, { method: 'PATCH', body }),
  createQrLocation: (body: Record<string, unknown>) => request<{ location: Raw }>('/canteen/qr-locations', { method: 'POST', body }),
  updateQrLocation: (id: string, body: Record<string, unknown>) =>
    request<{ location: Raw }>(`/canteen/qr-locations/${id}`, { method: 'PATCH', body }),
  deleteQrLocation: (id: string) => request<{ success: boolean; message: string }>(`/canteen/qr-locations/${id}`, { method: 'DELETE' }),
};
