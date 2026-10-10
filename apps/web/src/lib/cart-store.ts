'use client';

import { useEffect, useMemo, useState } from 'react';

export type CartState = Record<string, number>;
const KEY = 'foodflow-cart-v1';

const initialCart = (): CartState => {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CartState;
  } catch {
    localStorage.removeItem(KEY);
    return {};
  }
};

export function useCartStore() {
  const [cart, setCart] = useState<CartState>(initialCart);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(cart));
  }, [cart]);

  const totalItems = useMemo(() => Object.values(cart).reduce((sum, q) => sum + q, 0), [cart]);

  return {
    cart,
    totalItems,
    setQuantity: (itemId: string, quantity: number) =>
      setCart((prev) => {
        const q = Math.max(0, Math.min(20, Math.floor(quantity || 0)));
        if (q === 0) {
          const next = { ...prev };
          delete next[itemId];
          return next;
        }
        return { ...prev, [itemId]: q };
      }),
    clear: () => setCart({}),
  };
}
