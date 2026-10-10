'use client';

import { FormEvent, useState } from 'react';
import { toRupees } from '@/lib/pricing';

type Tracked = {
  id: string;
  status: string;
  paymentStatus: string;
  totalPaise: number;
  createdAt: string;
};

export default function TrackOrderPage() {
  const [token, setToken] = useState('');
  const [order, setOrder] = useState<Tracked | null>(null);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOrder(null);

    const res = await fetch(`/api/orders/track?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Unable to track order');
      return;
    }
    setOrder(data);
  }

  return (
    <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5">
      <h1 className="text-xl font-semibold">Track Order</h1>
      <form className="mt-3 flex gap-2" onSubmit={onSubmit}>
        <input value={token} onChange={(e) => setToken(e.target.value)} className="w-full rounded border p-2" placeholder="Enter tracking token" required />
        <button className="rounded bg-[var(--terracotta-600)] px-4 py-2 text-white">Track</button>
      </form>
      {error ? <p className="mt-3 text-sm text-[var(--error-600)]">{error}</p> : null}
      {order ? (
        <div className="mt-3 rounded border p-3 text-sm">
          <p>Order #{order.id.slice(0, 8)}</p>
          <p>Status: {order.status}</p>
          <p>Payment: {order.paymentStatus}</p>
          <p>Total: {toRupees(order.totalPaise)}</p>
          <p>Placed: {new Date(order.createdAt).toLocaleString()}</p>
        </div>
      ) : null}
    </section>
  );
}
