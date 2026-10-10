'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { StatusCard } from '@/components/status-card';
import { useCartStore } from '@/lib/cart-store';
import { toRupees } from '@/lib/pricing';

type MenuData = {
  categories: { id: string; name: string; sortOrder: number }[];
  items: {
    id: string;
    name: string;
    description: string | null;
    pricePaise: number;
    isAvailable: boolean;
    categoryId: string;
  }[];
};

export default function MenuPage() {
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('all');
  const { cart, setQuantity, totalItems } = useCartStore();

  useEffect(() => {
    fetch('/api/menu')
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? 'Menu load failed');
        return res.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    return category === 'all' ? data.items : data.items.filter((item) => item.categoryId === category);
  }, [data, category]);

  if (loading) return <StatusCard title="Loading menu">Fetching live canteen menu...</StatusCard>;
  if (error) return <StatusCard title="Unable to load menu">{error}</StatusCard>;
  if (!data) return <StatusCard title="No menu">No live menu found.</StatusCard>;

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Today&apos;s Canteen Menu</h1>
        <p className="text-sm text-[var(--cocoa-600)]">Freshly loaded from FoodFlow API.</p>
      </section>

      <section className="flex flex-wrap items-center gap-2">
        <button
          className={`rounded-md px-3 py-2 text-sm ${category === 'all' ? 'bg-[var(--burnt-orange-500)] text-white' : 'bg-white'}`}
          onClick={() => setCategory('all')}
        >
          All
        </button>
        {data.categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`rounded-md px-3 py-2 text-sm ${category === c.id ? 'bg-[var(--burnt-orange-500)] text-white' : 'bg-white'}`}
          >
            {c.name}
          </button>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredItems.length === 0 ? (
          <StatusCard title="No items">No available items in this category.</StatusCard>
        ) : (
          filteredItems.map((item) => {
            const quantity = cart[item.id] ?? 0;
            return (
              <article key={item.id} className="rounded-xl border border-[var(--sand-400)] bg-white p-4 shadow-sm">
                <h2 className="font-semibold">{item.name}</h2>
                <p className="mt-1 text-sm text-[var(--cocoa-600)]">{item.description ?? 'No description'}</p>
                <p className="mt-2 font-semibold text-[var(--terracotta-600)]">{toRupees(item.pricePaise)}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button onClick={() => setQuantity(item.id, quantity - 1)} className="rounded border px-2 py-1" aria-label={`Decrease ${item.name}`}>
                    -
                  </button>
                  <span aria-live="polite" className="min-w-6 text-center">
                    {quantity}
                  </span>
                  <button onClick={() => setQuantity(item.id, quantity + 1)} className="rounded border px-2 py-1" aria-label={`Increase ${item.name}`}>
                    +
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>

      <section className="sticky bottom-4 flex items-center justify-between rounded-xl border border-[var(--sand-400)] bg-[var(--ivory-50)] p-4 shadow-md">
        <p className="text-sm">Cart items: {totalItems}</p>
        <Link href="/checkout" className="rounded-md bg-[var(--terracotta-600)] px-4 py-2 text-sm text-white">
          Go to Checkout
        </Link>
      </section>
    </div>
  );
}
