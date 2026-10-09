import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, menuApi, orderApi } from '../lib/api';
import { round2 } from '../lib/format';
import type { Canteen, MenuItem, QRLocation } from '../types';

export interface CartLine {
  menuItem: string;
  name: string;
  emoji?: string;
  price: number;
  quantity: number;
  trackStock: boolean;
  stock: number | null;
  notes?: string;
}

interface CartState {
  canteen: Canteen | null;
  location: QRLocation | null;
  menu: MenuItem[];
  lines: CartLine[];
  taxPercent: number;
  subtotal: number;
  tax: number;
  total: number;
  count: number;
  loadingMenu: boolean;
  menuError: string | null;
  enter: (canteen: Canteen, location: QRLocation | null, menu: MenuItem[]) => void;
  loadMenu: (canteenId: string) => Promise<void>;
  refreshMenu: () => Promise<void>;
  add: (item: MenuItem, quantity?: number) => void;
  decrement: (item: MenuItem) => void;
  setQuantity: (menuItem: string, quantity: number) => void;
  remove: (menuItem: string) => void;
  toggle: (item: MenuItem) => void;
  clear: () => void;
  validate: () => Promise<{ ok: boolean; issues: string[] }>;
}

const CartContext = createContext<CartState | null>(null);
const CART_KEY = 'foodflow.cart';

interface StoredCart {
  canteen: Canteen | null;
  location: QRLocation | null;
  lines: CartLine[];
}

function isCartLine(value: unknown): value is CartLine {
  return !!value && typeof value === 'object' && typeof (value as CartLine).menuItem === 'string' && (value as CartLine).quantity > 0;
}

function readStoredCart(): StoredCart {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CART_KEY) ?? '{}');
    if (Array.isArray(raw)) {
      // Legacy shape: bare lines array.
      return { canteen: null, location: null, lines: raw.filter(isCartLine) };
    }
    const obj = (raw ?? {}) as { canteen?: Canteen | null; location?: QRLocation | null; lines?: unknown };
    return {
      canteen: obj.canteen ?? null,
      location: obj.location ?? null,
      lines: Array.isArray(obj.lines) ? obj.lines.filter(isCartLine) : [],
    };
  } catch {
    return { canteen: null, location: null, lines: [] };
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [stored] = useState<StoredCart>(() => readStoredCart());
  const [canteen, setCanteen] = useState<Canteen | null>(stored.canteen);
  const [location, setLocation] = useState<QRLocation | null>(stored.location);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [lines, setLines] = useState<CartLine[]>(stored.lines);
  const [taxPercent, setTaxPercent] = useState(5);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [menuError, setMenuError] = useState<string | null>(null);

  // Persist across refreshes; lines are re-validated against the live menu on load.
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify({ canteen, location, lines }));
    } catch {
      /* noop */
    }
  }, [canteen, location, lines]);

  const enter = useCallback((nextCanteen: Canteen, nextLocation: QRLocation | null, nextMenu: MenuItem[]) => {
    setCanteen((current) => {
      if (!current || current.id !== nextCanteen.id) setLines([]);
      return nextCanteen;
    });
    setLocation(nextLocation);
    setMenu(nextMenu);
  }, []);

  const syncMenu = useCallback(async (canteenId: string) => {
    setLoadingMenu(true);
    setMenuError(null);
    try {
      const result = await menuApi.list({ canteen: canteenId, limit: 100 });
      setMenu(result.items);
    } catch (error) {
      setMenuError(error instanceof ApiError ? error.message : 'Could not load the menu.');
    } finally {
      setLoadingMenu(false);
    }
  }, []);

  const loadMenu = useCallback(
    async (canteenId: string) => {
      await syncMenu(canteenId);
    },
    [syncMenu],
  );

  // Keep cart lines pointing at live prices/stock whenever the menu refreshes.
  useEffect(() => {
    if (!menu.length) return;
    setLines((current) =>
      current.flatMap((line) => {
        const fresh = menu.find((item) => item.id === line.menuItem);
        if (!fresh) return [];
        const max = fresh.trackStock ? (fresh.stock ?? 0) : 20;
        const quantity = Math.min(line.quantity, Math.max(max, 0));
        if (quantity <= 0) return [];
        return [
          {
            ...line,
            price: fresh.price,
            name: fresh.name,
            emoji: fresh.emoji,
            trackStock: fresh.trackStock,
            stock: fresh.stock,
            quantity,
          },
        ];
      }),
    );
  }, [menu]);

  const add = useCallback((item: MenuItem, quantity = 1) => {
    setLines((current) => {
      const existing = current.find((line) => line.menuItem === item.id);
      const cap = item.trackStock ? (item.stock ?? 0) : 20;
      if (existing) {
        if (existing.quantity + quantity > cap) return current;
        return current.map((line) => (line.menuItem === item.id ? { ...line, quantity: line.quantity + quantity } : line));
      }
      if (quantity > cap) return current;
      return [
        ...current,
        {
          menuItem: item.id,
          name: item.name,
          emoji: item.emoji,
          price: item.price,
          quantity,
          trackStock: item.trackStock,
          stock: item.stock,
        },
      ];
    });
  }, []);

  const decrement = useCallback((item: MenuItem) => {
    setLines((current) => {
      const existing = current.find((line) => line.menuItem === item.id);
      if (!existing) return current;
      if (existing.quantity <= 1) return current.filter((line) => line.menuItem !== item.id);
      return current.map((line) => (line.menuItem === item.id ? { ...line, quantity: line.quantity - 1 } : line));
    });
  }, []);

  const setQuantity = useCallback((menuItem: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((line) => line.menuItem !== menuItem)
        : current.map((line) => {
            if (line.menuItem !== menuItem) return line;
            const cap = line.trackStock ? (line.stock ?? 0) : 20;
            return { ...line, quantity: Math.min(quantity, cap) };
          }),
    );
  }, []);

  const remove = useCallback((menuItem: string) => {
    setLines((current) => current.filter((line) => line.menuItem !== menuItem));
  }, []);

  const toggle = useCallback(
    (item: MenuItem) => {
      setLines((current) => {
        const existing = current.find((line) => line.menuItem === item.id);
        if (existing) return current.filter((line) => line.menuItem !== item.id);
        return [
          ...current,
          {
            menuItem: item.id,
            name: item.name,
            emoji: item.emoji,
            price: item.price,
            quantity: 1,
            trackStock: item.trackStock,
            stock: item.stock,
          },
        ];
      });
    },
    [],
  );

  const clear = useCallback(() => setLines([]), []);

  const subtotal = useMemo(() => round2(lines.reduce((sum, line) => sum + line.price * line.quantity, 0)), [lines]);
  const tax = useMemo(() => round2(subtotal * (taxPercent / 100)), [subtotal, taxPercent]);
  const total = useMemo(() => round2(subtotal + tax), [subtotal, tax]);
  const count = useMemo(() => lines.reduce((sum, line) => sum + line.quantity, 0), [lines]);

  const validate = useCallback(async () => {
    if (!lines.length) return { ok: false, issues: ['Your cart is empty.'] };
    try {
      const result = await orderApi.validateCart({
        items: lines.map((line) => ({ menuItem: line.menuItem, quantity: line.quantity })),
      });
      return { ok: result.ok, issues: result.issues };
    } catch (error) {
      return { ok: false, issues: [error instanceof ApiError ? error.message : 'Cart validation failed.'] };
    }
  }, [lines]);

  // Server tax rate follows the active canteen; the server always reprices anyway.
  useEffect(() => {
    if (!canteen) return;
    let active = true;
    (async () => {
      try {
        const { settings } = await orderApi.checkoutContext(canteen.id);
        if (active && typeof settings.taxPercent === 'number') setTaxPercent(settings.taxPercent);
      } catch {
        // Falls back to the default rate; the server always reprices anyway.
      }
    })();
    return () => {
      active = false;
    };
  }, [canteen]);

  const value = useMemo<CartState>(
    () => ({
      canteen,
      location,
      menu,
      lines,
      taxPercent,
      subtotal,
      tax,
      total,
      count,
      loadingMenu,
      menuError,
      enter,
      loadMenu,
      refreshMenu: canteen ? () => syncMenu(canteen.id) : async () => undefined,
      add,
      decrement,
      setQuantity,
      remove,
      toggle,
      clear,
      validate,
    }),
    [
      canteen,
      location,
      menu,
      lines,
      taxPercent,
      subtotal,
      tax,
      total,
      count,
      loadingMenu,
      menuError,
      enter,
      loadMenu,
      syncMenu,
      add,
      decrement,
      setQuantity,
      remove,
      toggle,
      clear,
      validate,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>.');
  return ctx;
}
