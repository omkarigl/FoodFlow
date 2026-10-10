'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { useCartStore } from '@/lib/cart-store';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

type PlacedOrder = {
  id: string;
  trackingToken: string;
  totalPaise: number;
};

export default function CheckoutPage() {
  const { cart, clear } = useCartStore();
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<PlacedOrder | null>(null);

  const lines = useMemo(
    () => Object.entries(cart).map(([itemId, quantity]) => ({ itemId, quantity })),
    [cart]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus('');

    const idempotencyKey = crypto.randomUUID();
    const res = await fetch('/api/orders/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lines, guestName, guestPhone, note, idempotencyKey }),
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error ?? 'Checkout failed');
      setLoading(false);
      return;
    }

    setOrder({ id: data.id, trackingToken: data.trackingToken, totalPaise: data.totalPaise });
    setStatus('Order created. Continue to payment and wait for verification.');
    clear();
    setLoading(false);
  }

  async function payNow() {
    if (!order) return;
    const createRes = await fetch('/api/payments/razorpay/order', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      setStatus(createData.error ?? 'Unable to initialize payment');
      return;
    }

    if (!window.Razorpay) {
      setStatus('Razorpay SDK unavailable.');
      return;
    }

    const rzp = new window.Razorpay({
      key: createData.keyId,
      amount: createData.amount,
      currency: createData.currency,
      order_id: createData.razorpayOrderId,
      name: 'FoodFlow',
      description: 'Canteen Order Payment',
      handler: async (response: Record<string, string>) => {
        const verifyRes = await fetch('/api/payments/razorpay/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            orderId: order.id,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          }),
        });

        if (verifyRes.ok) {
          setStatus(`Payment verified. Track token: ${order.trackingToken}`);
        } else {
          const failed = await verifyRes.json();
          setStatus(failed.error ?? 'Payment verification failed');
        }
      },
    });

    rzp.open();
  }

  if (!lines.length && !order) {
    return (
      <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5">
        <h1 className="text-xl font-semibold">Checkout</h1>
        <p className="mt-2 text-sm">Your cart is empty.</p>
        <Link href="/" className="mt-3 inline-block text-sm text-[var(--terracotta-600)] underline">
          Back to menu
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5">
      <h1 className="text-xl font-semibold">Checkout</h1>
      <p className="mt-1 text-sm text-[var(--cocoa-600)]">Server validates live prices and availability.</p>
      {order ? (
        <div className="mt-4 rounded border p-4">
          <p className="text-sm">Order created: #{order.id.slice(0, 8)}</p>
          <p className="text-sm">Amount: ₹{(order.totalPaise / 100).toFixed(2)}</p>
          <button onClick={payNow} className="mt-3 rounded bg-[var(--terracotta-600)] px-4 py-2 text-white">
            Pay with Razorpay
          </button>
        </div>
      ) : (
        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Guest name (if ordering as guest)" className="w-full rounded border p-2" />
          <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="Guest phone" className="w-full rounded border p-2" />
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for canteen" className="w-full rounded border p-2" />
          <button disabled={loading} className="rounded bg-[var(--terracotta-600)] px-4 py-2 text-white disabled:opacity-60">
            {loading ? 'Placing order...' : 'Place Order'}
          </button>
        </form>
      )}
      {status ? <p className="mt-3 text-sm">{status}</p> : null}
    </section>
  );
}
