import { useCallback, useEffect, useState } from 'react';
import { ApiError, orderApi } from '../../lib/api';
import { useRealtime } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { Badge, Button, Card, EmptyState, ErrorNote, OrderToken, Skeleton } from '../../components/ui';
import { KITCHEN_FLOW, actionLabel, formatMoney, minutesSince, statusLabel, timeAgo } from '../../lib/format';
import { printReceipt } from '../../lib/print';
import type { Order, OrderStatus } from '../../types';

const COLUMNS: Array<{ status: OrderStatus; tone: string }> = [
  { status: 'PAID', tone: 'sky' },
  { status: 'ACCEPTED', tone: 'indigo' },
  { status: 'PREPARING', tone: 'amber' },
  { status: 'READY', tone: 'emerald' },
];

export function QueuePage() {
  const { activeCanteen, canteens } = useAdminContext();
  const { connected, subscribe } = useRealtime();
  const toast = useToast();
  const [board, setBoard] = useState<Record<string, Order[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const result = await orderApi.queue(activeCanteen || undefined);
        setBoard(result.columns as Record<string, Order[]>);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the queue.');
      } finally {
        setLoading(false);
      }
    },
    [activeCanteen],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const events = ['order:new', 'order:status', 'order:updated', 'queue'];
    const unsubscribe = subscribe((event) => {
      if (events.includes(event.type)) void load(true);
    });
    const poll = window.setInterval(() => void load(true), connected ? 20000 : 8000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [subscribe, connected, load]);

  const advance = async (order: Order) => {
    const next = KITCHEN_FLOW[KITCHEN_FLOW.indexOf(order.status as OrderStatus) + 1];
    if (!next) return;
    setBusyId(order.id);
    try {
      await orderApi.setStatus(order.id, next);
      toast.success(`${order.token} is now ${statusLabel(next)}.`);
      await load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update that order.');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (order: Order) => {
    setBusyId(order.id);
    try {
      await orderApi.setStatus(order.id, 'REJECTED', 'Rejected by the counter');
      toast.push(`${order.token} rejected`, 'warn');
      await load(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not reject that order.');
    } finally {
      setBusyId(null);
    }
  };

  const canteen = canteens.find((c) => c.id === activeCanteen);
  const total = Object.values(board).reduce((sum, list) => sum + list.length, 0);

  if (loading) return <Skeleton rows={6} />;

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Live kitchen queue</h1>
          <p className="page__sub">
            {total} order{total === 1 ? '' : 's'} in flight{canteen ? ` · ${canteen.name}` : ' · all canteens'}
            {canteen ? ` · ~${canteen.prepTimeMins} min prep` : ''}
          </p>
        </div>
        <div className="queue__legend">
          {COLUMNS.map((column) => (
            <Badge key={column.status} tone={column.tone}>
              {statusLabel(column.status)} {board[column.status]?.length ?? 0}
            </Badge>
          ))}
        </div>
      </header>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}

      {canteen && !canteen.canOrder && (
        <div className="alert alert--warn">{canteen.closedMessage ?? 'This canteen is paused — new orders are blocked.'}</div>
      )}

      <div className="kanban">
        {COLUMNS.map((column) => {
          const orders = board[column.status] ?? [];
          return (
            <section key={column.status} className="kanban__col">
              <header className="kanban__head">
                <span className={`kanban__dot kanban__dot--${column.tone}`} />
                <strong>{statusLabel(column.status)}</strong>
                <em>{orders.length}</em>
              </header>

              {orders.length === 0 ? (
                <p className="kanban__empty">Nothing here</p>
              ) : (
                <ul className="kanban__list">
                  {orders.map((order) => {
                    const waited = minutesSince(order.placedAt);
                    const late = waited > (canteen?.prepTimeMins ?? 15) + 8;
                    const isOpen = expanded === order.id;
                    return (
                      <li key={order.id} className={`ticket ${late ? 'ticket--late' : ''}`}>
                        <div className="ticket__head">
                          <OrderToken token={order.token} />
                          <Badge tone={order.isGuest ? 'amber' : 'sky'}>{order.isGuest ? 'Guest' : 'Student'}</Badge>
                          <Badge tone={late ? 'rose' : 'slate'}>{waited} min</Badge>
                        </div>
                        <p className="ticket__user">
                          {order.isGuest ? 'Guest' : (order.userName ?? 'Student')}
                          {order.studentId ? ` · ${order.studentId}` : ''} · {formatMoney(order.total)}
                        </p>
                        <ul className="ticket__items">
                          {order.items.map((line) => (
                            <li key={line.menuItem}>
                              <b>{line.quantity}×</b> {line.name}
                            </li>
                          ))}
                        </ul>
                        {order.note && <p className="ticket__note">{order.note}</p>}

                        <div className="ticket__actions">
                          <Button size="sm" onClick={() => advance(order)} loading={busyId === order.id}>
                            {actionLabel(order.status)}
                          </Button>
                          {order.status === 'PAID' && (
                            <Button size="sm" variant="ghost" onClick={() => reject(order)} disabled={busyId === order.id}>
                              Reject
                            </Button>
                          )}
                          <button type="button" className="linkish" onClick={() => setExpanded(isOpen ? null : order.id)}>
                            {isOpen ? 'Less' : 'More'}
                          </button>
                        </div>

                        {isOpen && (
                          <div className="ticket__detail">
                            <p>
                              {order.canteenName} · {order.qrLocationLabel ?? order.qrLocationCode} · {timeAgo(order.placedAt)}
                            </p>
                            <p>
                              Paid via {order.payment.method} · {order.payment.status}
                            </p>
                            <button type="button" className="linkish" onClick={() => printReceipt(order)}>
                              Receipt
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {total === 0 && (
        <Card>
          <EmptyState title="Queue is clear" message="New paid orders drop into the first column automatically." />
        </Card>
      )}
    </div>
  );
}