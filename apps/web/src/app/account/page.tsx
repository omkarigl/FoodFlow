'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useSessionToken } from '@/lib/auth-client';
import { toRupees } from '@/lib/pricing';

type Order = {
  id: string;
  status: string;
  payment_status: string;
  total_paise: number;
  created_at: string;
  tracking_token: string;
};

export default function AccountPage() {
  const { token, supabase } = useSessionToken();
  const [studentId, setStudentId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState('');

  const authHeaders = token ? { Authorization: 'Bearer ' + token } : undefined;

  async function loadOrders() {
    if (!authHeaders) return;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const res = await fetch(`/api/orders/history?${params.toString()}`, {
      headers: authHeaders,
    });
    const data = await res.json();
    if (res.ok) setOrders(data.orders ?? []);
  }

  useEffect(() => {
    if (!authHeaders) return;

    queueMicrotask(() => {
      fetch('/api/profile', { headers: authHeaders })
        .then((res) => res.json())
        .then((data) => setStudentId(data.profile?.student_id ?? ''));
      void loadOrders();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!authHeaders) return;

    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ studentId }),
    });

    setMessage(res.ok ? 'Profile saved.' : 'Unable to save profile.');
  }

  if (!token) {
    return <p className="rounded-xl bg-white p-5">Please login to access your account.</p>;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5">
        <h1 className="text-xl font-semibold">Student Account</h1>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={saveProfile}>
          <input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="Student ID" className="rounded border p-2" />
          <button className="rounded bg-[var(--terracotta-600)] px-4 py-2 text-white">Save</button>
          <button
            type="button"
            className="rounded border px-4 py-2"
            onClick={() => supabase?.auth.signOut()}
          >
            Logout
          </button>
        </form>
        <p className="mt-2 text-sm">{message}</p>
      </section>

      <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5">
        <h2 className="text-lg font-semibold">Order History</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border p-2" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border p-2" />
          <button className="rounded border px-3" onClick={loadOrders}>Filter</button>
        </div>
        <ul className="mt-3 space-y-2">
          {orders.map((o) => (
            <li key={o.id} className="rounded border p-3 text-sm">
              <p>#{o.id.slice(0, 8)} • {new Date(o.created_at).toLocaleString()}</p>
              <p>Status: {o.status} | Payment: {o.payment_status}</p>
              <p>Total: {toRupees(o.total_paise)} | Token: {o.tracking_token}</p>
            </li>
          ))}
          {orders.length === 0 ? <li className="text-sm text-[var(--cocoa-600)]">No orders found.</li> : null}
        </ul>
      </section>
    </div>
  );
}
