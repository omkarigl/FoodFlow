import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, guestClaimStore, orderApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/SocketContext';
import { Button, Card, EmptyState, ErrorNote, OrderToken, Skeleton, StatusBadge } from '../components/ui';
import { formatMoney, isTerminal, statusLabel, timeAgo } from '../lib/format';
import { OrderProgress } from './OrderSuccessPage';
import type { Order } from '../types';

/**
 * Public order tracking for guests (order id + claim token) and students.
 * Guests get here from their confirmation screen; anyone with the link can
 * paste an order id and claim token manually.
 */
export function TrackPage() {
  const { id: paramId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { subscribe } = useRealtime();

  const queryOrder = params.get('order') ?? '';
  const queryClaim = params.get('claim') ?? '';
  const initialId = paramId ?? queryOrder;
  const initialClaim = queryClaim || (initialId ? guestClaimStore.get(initialId) : null) || '';

  const [orderId, setOrderId] = useState(initialId);
  const [claim, setClaim] = useState(initialClaim);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(Boolean(initialId));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(
    async (id: string, token: string, manual: boolean) => {
      if (!id) return;
      if (manual) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        // Prefer the guest endpoint when we carry a claim; fall back to the
        // authenticated endpoint for signed-in students.
        const result = token
          ? await orderApi.guestOne(id.trim(), token.trim()).catch(() => orderApi.one(id.trim(), token.trim()))
          : await orderApi.one(id.trim());
        setOrder(result.order);
        if (token) guestClaimStore.set(id.trim(), token.trim());
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.status === 401 || err.status === 403
              ? 'This tracking link is invalid. Check the order ID and claim token.'
              : err.status === 404
                ? 'Order not found. Check the order ID.'
                : err.message
            : 'Could not load the order.',
        );
        setOrder(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // Auto-load from the link (?order=&claim= or /track/:id).
  useEffect(() => {
    if (initialId) void load(initialId, initialClaim, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live status + gentle polling; stops at terminal states.
  useEffect(() => {
    const id = order?.id;
    if (!id) return;
    const unsubscribe = subscribe((event) => {
      if (event.type !== 'order:status' || !('order' in event)) return;
      if (String(event.order?.id) === id) setOrder(event.order);
    });
    pollRef.current = window.setInterval(() => {
      if (order && isTerminal(order.status)) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        return;
      }
      void load(id, claim || guestClaimStore.get(id) || '', false);
    }, 15000);
    return () => {
      unsubscribe();
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, subscribe]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderId.trim()) return;
    setParams(orderId && claim ? { order: orderId.trim(), claim: claim.trim() } : orderId ? { order: orderId.trim() } : {});
    void load(orderId.trim(), claim.trim(), true);
  };

  return (
    <div className="page__stack page__stack--narrow">
      <header className="page__head">
        <div>
          <h1 className="page__title">Track order</h1>
          <p className="page__sub">Live status from the kitchen — no need to crowd the counter.</p>
        </div>
        {order && (
          <Button variant="secondary" size="sm" loading={refreshing} onClick={() => void load(order.id, claim || guestClaimStore.get(order.id) || '', true)}>
            Refresh
          </Button>
        )}
      </header>

      {!order && (
        <Card title="Find your order" subtitle="Use the tracking link from your confirmation screen.">
          <form className="track__form" onSubmit={submit}>
            <label className="field">
              <span>Order ID</span>
              <input className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="Paste your order ID" autoComplete="off" />
            </label>
            <label className="field">
              <span>Claim token (guests)</span>
              <input
                className="input"
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
                placeholder="From your confirmation screen"
                autoComplete="off"
              />
            </label>
            <Button type="submit" loading={loading}>
              Track
            </Button>
          </form>
        </Card>
      )}

      {loading && !order && <Skeleton rows={4} />}
      {error && !order && <ErrorNote message={error} onRetry={() => orderId && void load(orderId, claim, true)} />}

      {order && (
        <>
          <div className="success">
            <p className="success__sub">
              {order.canteenName ?? ''} · {statusLabel(order.status)} · {timeAgo(order.placedAt)}
            </p>
            <div className="success__token">
              <span>Pickup token</span>
              <OrderToken token={order.token} size="lg" />
            </div>
            <div className="success__meta">
              <span>#{order.orderNumber}</span>
              <StatusBadge status={order.status} />
            </div>
          </div>

          <Card title="Status">
            <OrderProgress order={order} />
          </Card>

          <Card title="Items">
            <ul className="checkout__items">
              {order.items.map((line) => (
                <li key={line.menuItem}>
                  <span>
                    {line.quantity}× {line.name}
                  </span>
                  <span>{formatMoney(line.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="bill">
              <div className="bill__total">
                <dt>Total</dt>
                <dd>{formatMoney(order.total)}</dd>
              </div>
            </dl>
          </Card>

          {user && (
            <Button variant="ghost" onClick={() => navigate(`/orders/${order.id}`)}>
              Open in my orders
            </Button>
          )}
          {!order && (
            <EmptyState title="No order loaded" message="Enter your order ID and claim token above." />
          )}
        </>
      )}
    </div>
  );
}
