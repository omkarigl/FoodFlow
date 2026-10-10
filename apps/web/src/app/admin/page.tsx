'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useSessionToken } from '@/lib/auth-client';
import { toRupees } from '@/lib/pricing';

type AdminOrder = {
  id: string;
  status: string;
  payment_status: string;
  total_paise: number;
  created_at: string;
};

export default function AdminPage() {
  const { token } = useSessionToken();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [reportTotal, setReportTotal] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');

  const authHeaders = token ? { Authorization: 'Bearer ' + token } : undefined;

  async function loadAdminData() {
    if (!authHeaders) return;
    const [ordersRes, reportRes] = await Promise.all([
      fetch('/api/admin/orders', { headers: authHeaders }),
      fetch('/api/admin/reports/revenue', { headers: authHeaders }),
    ]);

    if (ordersRes.ok) {
      const data = await ordersRes.json();
      setOrders(data.orders ?? []);
    }

    if (reportRes.ok) {
      const data = await reportRes.json();
      setReportTotal(data.grossPaise);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadAdminData();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function setStatus(id: string, status: string) {
    if (!authHeaders) return;
    const res = await fetch(`/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ status }),
    });
    setMessage(res.ok ? 'Order status updated.' : 'Status update failed.');
    await loadAdminData();
  }

  async function onFilter(e: FormEvent) {
    e.preventDefault();
    if (!authHeaders) return;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const reportRes = await fetch(`/api/admin/reports/revenue?${params.toString()}`, { headers: authHeaders });
    if (reportRes.ok) {
      const data = await reportRes.json();
      setReportTotal(data.grossPaise);
    }
  }

  if (!token) {
    return <p className="rounded-xl bg-white p-5">Login as admin to access this page.</p>;
  }

  return (
    <div className="space-y-4 print:space-y-2">
      <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5 print:border-none">
        <h1 className="text-xl font-semibold">Admin Dashboard</h1>
        <p className="text-sm text-[var(--cocoa-600)]">Authoritative role checks are enforced server-side.</p>
        <p className="mt-2 text-sm font-medium">Verified revenue: {reportTotal === null ? '—' : toRupees(reportTotal)}</p>
        <form className="mt-2 flex flex-wrap gap-2 print:hidden" onSubmit={onFilter}>
          <input type="date" className="rounded border p-2" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="rounded border p-2" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="rounded border px-3">Filter report</button>
        </form>
        <p className="mt-2 text-sm">{message}</p>
      </section>

      <section className="rounded-xl border border-[var(--sand-400)] bg-white p-5 print:border-none">
        <h2 className="text-lg font-semibold">Recent Orders</h2>
        <ul className="mt-3 space-y-2">
          {orders.map((order) => (
            <li key={order.id} className="rounded border p-3 text-sm">
              <p>#{order.id.slice(0, 8)} • {new Date(order.created_at).toLocaleString()}</p>
              <p>Status: {order.status} | Payment: {order.payment_status} | Total: {toRupees(order.total_paise)}</p>
              <div className="mt-2 flex flex-wrap gap-2 print:hidden">
                {['confirmed', 'preparing', 'ready', 'completed', 'cancelled'].map((s) => (
                  <button key={s} onClick={() => setStatus(order.id, s)} className="rounded border px-2 py-1 text-xs">
                    Mark {s}
                  </button>
                ))}
              </div>
            </li>
          ))}
          {orders.length === 0 ? <li className="text-sm text-[var(--cocoa-600)]">No orders available.</li> : null}
        </ul>
      </section>
    </div>
  );
}
