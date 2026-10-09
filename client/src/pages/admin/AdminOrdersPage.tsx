import { Fragment, useCallback, useEffect, useState } from 'react';
import { ApiError, orderApi } from '../../lib/api';
import { useRealtime } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { Button, Card, EmptyState, ErrorNote, OrderToken, Select, Skeleton, StatusBadge } from '../../components/ui';
import { formatDateTime, formatMoney } from '../../lib/format';
import { printReceipt } from '../../lib/print';
import type { Order, OrderStatus } from '../../types';

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { value: 'PAID', label: 'Paid' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY', label: 'Ready' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REJECTED', label: 'Rejected' },
];

export function AdminOrdersPage() {
  const { activeCanteen } = useAdminContext();
  const { connected, subscribe } = useRealtime();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const result = await orderApi.adminList({ canteen: activeCanteen || undefined, status: status || undefined, search: search || undefined, page, limit: 20 });
        setOrders(result.orders);
        setCounts(result.counts ?? {});
        setPages(result.pages);
        setTotal(result.total);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load orders.');
      } finally {
        setLoading(false);
      }
    },
    [activeCanteen, status, search, page],
  );

  // Debounced so typing in search doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 400);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const events = ['order:new', 'order:status', 'order:updated'];
    const unsubscribe = subscribe((event) => {
      if (events.includes(event.type)) void load(true);
    });
    const poll = window.setInterval(() => void load(true), connected ? 40000 : 15000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [subscribe, connected, load]);

  const setOrderStatus = async (order: Order, next: OrderStatus) => {
    setBusyId(order.id);
    try {
      await orderApi.setStatus(order.id, next);
      toast.success(`${order.token} is now ${next.toLowerCase()}.`);
      await load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Orders</h1>
          <p className="page__sub">{total} order{total === 1 ? '' : 's'} match your filters.</p>
        </div>
      </header>

      <Card padded={false}>
        <div className="filters">
          <input className="input filters__search" placeholder="Search token, name, email or #number" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} />
          <div className="filters__sort">
            <Select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="chips">
          {Object.entries(counts)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => (
              <button key={key} type="button" className={`chip ${status === key ? 'is-active' : ''}`} onClick={() => setStatus(status === key ? '' : key)}>
                {key.replace(/_/g, ' ').toLowerCase()} <em>{count}</em>
              </button>
            ))}
        </div>
      </Card>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {loading && <Skeleton rows={6} />}

      {!loading && orders.length === 0 && <EmptyState title="No orders match" message="Try clearing the filters." />}

      {orders.length > 0 && (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Customer</th>
                  <th>Type</th>
                  <th>Items</th>
                  <th>Canteen</th>
                  <th>Status</th>
                  <th>Placed</th>
                  <th className="right">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <Fragment key={order.id}>
                    <tr className={expanded === order.id ? 'is-open' : ''}>
                      <td>
                        <OrderToken token={order.token} size="sm" />
                      </td>
                      <td>
                        <strong>{order.isGuest ? 'Guest' : (order.userName ?? '—')}</strong>
                        {order.studentId ? <small> · {order.studentId}</small> : null}
                      </td>
                      <td className="muted">{order.isGuest ? 'Guest' : 'Student'}</td>
                      <td className="muted">{order.items.reduce((sum, line) => sum + line.quantity, 0)} item(s)</td>
                      <td className="muted">{order.canteenName ?? '—'}</td>
                      <td>
                        <StatusBadge status={order.status} />
                      </td>
                      <td className="muted">{formatDateTime(order.placedAt)}</td>
                      <td className="right">
                        <strong>{formatMoney(order.total)}</strong>
                      </td>
                      <td className="right">
                        <div className="row-actions">
                          <button type="button" className="linkish" onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                            {expanded === order.id ? 'Close' : 'Open'}
                          </button>
                          <button type="button" className="linkish" onClick={() => printReceipt(order)}>
                            Receipt
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded === order.id && (
                      <tr className="table__detail">
                        <td colSpan={9}>
                          <div className="order-detail">
                            <div>
                              <h4>Items</h4>
                              <ul>
                                {order.items.map((line) => (
                                  <li key={line.menuItem}>
                                    {line.quantity}× {line.name} — {formatMoney(line.lineTotal)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h4>Details</h4>
                              <ul>
                                <li>
                                  Order #{order.orderNumber}
                                </li>
                                <li>
                                  {order.canteenName} · {order.qrLocationLabel ?? order.qrLocationCode}
                                </li>
                                <li>
                                  {order.payment.method} · {order.payment.status}
                                  {order.payment.gatewayPaymentId ? ` · ${order.payment.gatewayPaymentId}` : ''}
                                </li>
                                {order.note && <li>Note: {order.note}</li>}
                                {order.closeReason && <li>Closed: {order.closeReason}</li>}
                              </ul>
                            </div>
                            <div>
                              <h4>Move to</h4>
                              <div className="row-actions">
                                <Button size="sm" variant="secondary" onClick={() => setOrderStatus(order, 'ACCEPTED')} disabled={busyId === order.id || order.status !== 'PAID'}>
                                  Accept
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setOrderStatus(order, 'PREPARING')} disabled={busyId === order.id || order.status !== 'ACCEPTED'}>
                                  Preparing
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setOrderStatus(order, 'READY')} disabled={busyId === order.id || order.status !== 'PREPARING'}>
                                  Ready
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => setOrderStatus(order, 'COMPLETED')} disabled={busyId === order.id || order.status !== 'READY'}>
                                  Complete
                                </Button>
                                <Button size="sm" variant="danger" onClick={() => setOrderStatus(order, 'REJECTED')} disabled={busyId === order.id || !['PAID'].includes(order.status)}>
                                  Reject
                                </Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pages > 1 && (
        <div className="pager">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {pages}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}