import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, guestClaimStore, orderApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorNote, OrderToken, Skeleton, StatusBadge } from '../components/ui';
import { CURRENCY, formatMoney, formatTime, isTerminal, timeAgo } from '../lib/format';
import { printReceipt } from '../lib/print';
import type { Order } from '../types';

export function OrderSuccessPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { subscribe } = useRealtime();
  const { user } = useAuth();
  const routeLocation = useLocation();
  const [params] = useSearchParams();
  const state = (routeLocation.state as { order?: Order; claim?: string } | null) ?? null;

  const orderId = state?.order?.id ?? params.get('order') ?? '';
  const claim = state?.claim ?? (orderId ? guestClaimStore.get(orderId) : null) ?? params.get('claim');

  const [order, setOrder] = useState<Order | null>(state?.order ?? null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!orderId) return;
    if (state?.order) return; // already have it; polling below keeps it fresh.
    let active = true;
    (async () => {
      try {
        const result = claim ? await orderApi.guestOne(orderId, claim) : await orderApi.one(orderId);
        if (active) setOrder(result.order);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load the order.');
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  useEffect(() => {
    const id = order?.id;
    if (!id) return;

    let active = true;
    const load = async () => {
      try {
        const result = order?.isGuest || claim ? await orderApi.guestOne(id, claim).catch(() => orderApi.one(id, claim)) : await orderApi.one(id);
        if (active) setOrder(result.order);
      } catch {
        /* keep the last known state */
      }
    };

    const unsubscribe = subscribe((event) => {
      if (event.type !== 'order:status' || !('order' in event)) return;
      const next = event.order;
      if (String(next?.id) === id) setOrder(next);
    });

    pollRef.current = window.setInterval(() => {
      if (order && isTerminal(order.status)) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        return;
      }
      void load();
    }, 10000);
    return () => {
      active = false;
      unsubscribe();
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, subscribe]);

  if (!orderId) {
    return (
      <div className="page__stack">
        <EmptyState
          title="No order selected"
          message="Place an order first, or open your tracking link."
          action={<Button onClick={() => navigate('/scan')}>Find a canteen</Button>}
        />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="page__stack">
        <ErrorNote message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page__stack">
        <Skeleton rows={4} />
      </div>
    );
  }

  const pending = order.status === 'PENDING_PAYMENT';
  const trackHref = claim ? `/track/${order.id}?claim=${encodeURIComponent(claim)}` : `/track/${order.id}`;

  return (
    <div className="page__stack page__stack--narrow">
      <div className={`success ${pending ? 'success--pending' : ''}`}>
        <h1 className="success__title">{pending ? 'Waiting for payment' : 'Order placed!'}</h1>
        <p className="success__sub">
          {pending
            ? 'Complete the payment to send this order to the kitchen.'
            : 'The kitchen has your order. Show this token at the counter when ready.'}
        </p>
        <div className="success__token">
          <span>Your pickup token</span>
          <OrderToken token={order.token} size="lg" />
        </div>
        <div className="success__meta">
          <span>#{order.orderNumber}</span>
          <StatusBadge status={order.status} />
          <span>{timeAgo(order.placedAt)}</span>
        </div>
      </div>

      <Card title="Where your order is" subtitle="Updates arrive live, with polling as backup.">
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
          <div>
            <dt>Subtotal</dt>
            <dd>{formatMoney(order.subtotal)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{formatMoney(order.tax)}</dd>
          </div>
          <div className="bill__total">
            <dt>Total</dt>
            <dd>{formatMoney(order.total)}</dd>
          </div>
        </dl>
      </Card>

      <div className="success__actions">
        <Button variant="secondary" onClick={() => printReceipt(order)}>
          Print receipt
        </Button>
        <Link className="btn btn--ghost" to={trackHref}>
          Track order
        </Link>
        {user ? (
          <Button variant="ghost" onClick={() => navigate('/orders')}>
            View all orders
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => navigate('/register')}>
            Save history — register
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            toast.success('Back to the menu!');
            navigate('/order');
          }}
        >
          Order more
        </Button>
      </div>
    </div>
  );
}

const STEPS = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'];

export function OrderProgress({ order }: { order: Order }) {
  if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
    return (
      <div className="progress progress--stopped">
        <p className="alert alert--error">
          This order was {order.status.toLowerCase()}. {order.closeReason ?? ''}
        </p>
      </div>
    );
  }

  const current = STEPS.indexOf(order.status);

  return (
    <ol className="progress">
      {STEPS.map((step, index) => {
        const done = index <= current;
        const stamps: Record<string, string | undefined> = {
          PAID: order.placedAt,
          ACCEPTED: order.acceptedAt,
          PREPARING: order.preparingAt,
          READY: order.readyAt,
          COMPLETED: order.completedAt,
        };
        return (
          <li key={step} className={`progress__step ${done ? 'is-done' : ''} ${index === current ? 'is-current' : ''}`}>
            <span className="progress__dot" aria-hidden="true">
              {done ? '✓' : index + 1}
            </span>
            <span className="progress__label">{step[0] + step.slice(1).toLowerCase()}</span>
            {done && stamps[step] && <small>{formatTime(stamps[step])}</small>}
          </li>
        );
      })}
    </ol>
  );
}

export function receiptTotals(order: Order): string {
  return `Subtotal ${CURRENCY}${order.subtotal.toFixed(2)} · Tax ${CURRENCY}${order.tax.toFixed(2)} · Total ${CURRENCY}${order.total.toFixed(2)}`;
}
