import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, orderApi } from '../lib/api';
import { useRealtime } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorNote, OrderRow, OrderToken, Skeleton, StatusBadge } from '../components/ui';
import { formatDate, formatMoney, timeAgo } from '../lib/format';
import { printReceipt } from '../lib/print';
import { OrderProgress } from './OrderSuccessPage';
import type { Order, OrderStatus } from '../types';

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'all', label: 'All' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

const ACTIVE = new Set(['PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'PREPARING', 'READY']);

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayKey(): string {
  return dayKey(new Date().toISOString());
}

export function MyOrdersPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { connected, subscribe } = useRealtime();
  const [filter, setFilter] = useState('active');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [day, setDay] = useState(todayKey());

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await orderApi.mine({ limit: 100 });
      setOrders(result.orders);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (['order:new', 'order:status', 'order:updated'].includes(event.type)) void load(true);
    });
    const poll = window.setInterval(() => void load(true), connected ? 45000 : 15000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [subscribe, connected, load]);

  const cancel = async (order: Order) => {
    setBusyId(order.id);
    try {
      const result = await orderApi.cancel(order.id, 'Cancelled by student');
      setOrders((current) => current.map((item) => (item.id === order.id ? result.order : item)));
      toast.success(result.message || 'Order cancelled.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not cancel this order.');
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length, active: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const o of orders) {
      if (ACTIVE.has(o.status)) c.active += 1;
      if (o.status === 'COMPLETED') c.COMPLETED += 1;
      if (o.status === 'CANCELLED' || o.status === 'REJECTED') c.CANCELLED += 1;
    }
    return c;
  }, [orders]);

  const visible = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'active') return orders.filter((o) => ACTIVE.has(o.status));
    if (filter === 'CANCELLED') return orders.filter((o) => o.status === 'CANCELLED' || o.status === 'REJECTED');
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const dayOrders = useMemo(() => orders.filter((o) => dayKey(o.placedAt) === day), [orders, day]);
  const daySpend = useMemo(() => dayOrders.reduce((sum, o) => sum + (o.payment.status === 'PAID' ? o.total : 0), 0), [dayOrders]);

  const active = useMemo(() => orders.filter((order) => ACTIVE.has(order.status)), [orders]);

  return (
    <div className="page__stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">My orders</h1>
          <p className="page__sub">
            {active.length > 0 ? `${active.length} order${active.length > 1 ? 's' : ''} in progress` : 'Nothing cooking right now'}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/scan')}>
          New order
        </Button>
      </header>

      <Card title="Spending by day" subtitle="Pick a date to see what you spent that day.">
        <div className="spend-row">
          <input className="input" type="date" value={day} max={todayKey()} onChange={(e) => setDay(e.target.value)} aria-label="Spending date" />
          <div className="spend-total">
            <strong>{formatMoney(daySpend)}</strong>
            <small>
              {dayOrders.length} order{dayOrders.length === 1 ? '' : 's'} on {day || '—'}
            </small>
          </div>
        </div>
      </Card>

      <div className="chips">
        {FILTERS.map((option) => (
          <button key={option.key} type="button" className={`chip ${filter === option.key ? 'is-active' : ''}`} onClick={() => setFilter(option.key)}>
            {option.label}
            {counts[option.key] !== undefined && <em> {counts[option.key]}</em>}
          </button>
        ))}
        <button type="button" className="linkish" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {loading && <Skeleton rows={4} />}

      {!loading && visible.length === 0 && (
        <EmptyState
          title="No orders here"
          message="Once you place an order it will show up with live status updates."
          action={<Button onClick={() => navigate('/scan')}>Scan a canteen QR</Button>}
        />
      )}

      <div className="order-list">
        {visible.map((order) => {
          const cancellable = order.status === 'PENDING_PAYMENT' || order.status === 'PAID' || order.status === 'ACCEPTED' || order.status === 'PREPARING';
          const isOpen = expanded === order.id;
          return (
            <div key={order.id} className="order-card">
              <OrderRow order={order}>
                <div className="order-card__side">
                  <strong className="order-card__total">{formatMoney(order.total)}</strong>
                  <small>{timeAgo(order.placedAt)}</small>
                </div>
              </OrderRow>

              <div className="order-card__progress">
                <OrderProgress order={order} />
              </div>

              <div className="order-card__actions">
                <button type="button" className="linkish" onClick={() => setExpanded(isOpen ? null : order.id)}>
                  {isOpen ? 'Hide details' : 'Details'}
                </button>
                <button type="button" className="linkish" onClick={() => printReceipt(order)}>
                  Receipt
                </button>
                <Link className="linkish" to={`/orders/${order.id}`}>
                  Open
                </Link>
                {cancellable && (
                  <button type="button" className="linkish linkish--danger" disabled={busyId === order.id} onClick={() => cancel(order)}>
                    Cancel
                  </button>
                )}
              </div>

              {isOpen && (
                <div className="order-card__detail">
                  <dl className="kv">
                    <div>
                      <dt>Order number</dt>
                      <dd>#{order.orderNumber}</dd>
                    </div>
                    <div>
                      <dt>Placed</dt>
                      <dd>{formatDate(order.placedAt)}</dd>
                    </div>
                    <div>
                      <dt>Canteen</dt>
                      <dd>{order.canteenName ?? '—'}</dd>
                    </div>
                    <div>
                      <dt>Location</dt>
                      <dd>
                        {order.qrLocationLabel ?? '—'} {order.qrLocationCode ? `(${order.qrLocationCode})` : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Payment</dt>
                      <dd>
                        {order.payment.method} · {order.payment.status}
                      </dd>
                    </div>
                    <div>
                      <dt>Token</dt>
                      <dd>
                        <OrderToken token={order.token} size="sm" />
                      </dd>
                    </div>
                  </dl>
                  {order.note && <p className="muted">Note: {order.note}</p>}
                  {order.closeReason && <p className="alert alert--error">{order.closeReason}</p>}
                  {order.statusHistory && order.statusHistory.length > 0 && (
                    <ol className="timeline">
                      {order.statusHistory.map((entry, index) => (
                        <li key={`${entry.status}-${index}`}>
                          <StatusBadge status={entry.status as OrderStatus} />
                          <span>{timeAgo(entry.at)}</span>
                          {entry.note && <em>{entry.note}</em>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Card title="Pickup tip">
        <p className="muted">
          Show your token at the counter. Orders move through Accepted, Preparing and Ready, and you will see each step here the moment the kitchen
          updates it.
        </p>
      </Card>
    </div>
  );
}
