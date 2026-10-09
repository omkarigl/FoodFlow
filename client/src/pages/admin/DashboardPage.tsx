import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, adminApi } from '../../lib/api';
import { useRealtime } from '../../context/SocketContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { Badge, Card, EmptyState, ErrorNote, OrderToken, Skeleton, StatCard, StatusBadge } from '../../components/ui';
import { formatMoney, timeAgo } from '../../lib/format';
import type { DashboardStats } from '../../types';

function deltaHint(value: number | null, suffix: string): string {
  if (value === null || value === undefined) return `no data ${suffix}`;
  return `${value >= 0 ? '+' : ''}${value}% ${suffix}`;
}

export function DashboardPage() {
  const { activeCanteen, canteens } = useAdminContext();
  const { connected, subscribe } = useRealtime();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const result = await adminApi.dashboard(activeCanteen || undefined);
        setStats(result);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
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
    const events = ['order:new', 'order:status', 'order:updated', 'queue', 'inventory:updated'];
    const unsubscribe = subscribe((event) => {
      if (events.includes(event.type)) void load(true);
    });
    const poll = window.setInterval(() => void load(true), connected ? 30000 : 12000);
    return () => {
      unsubscribe();
      window.clearInterval(poll);
    };
  }, [subscribe, connected, load]);

  if (loading) return <Skeleton rows={6} />;
  if (error) return <ErrorNote message={error} onRetry={() => void load()} />;
  if (!stats) return null;

  const selected = canteens.find((c) => c.id === activeCanteen);

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">{selected ? selected.name : 'All canteens'}</h1>
          <p className="page__sub">Live service snapshot across the counters you run.</p>
        </div>
        <Link className="btn btn--primary" to="/admin/queue">
          Open live queue
        </Link>
      </header>

      <div className="stats-grid">
        <StatCard
          label="Today's orders"
          value={stats.today.orders}
          hint={deltaHint(stats.today.ordersDeltaPercent ?? null, 'vs yesterday')}
          tone="indigo"
        />
        <StatCard
          label="Revenue today"
          value={formatMoney(stats.today.revenue)}
          hint={deltaHint(stats.today.revenueDeltaPercent ?? null, 'vs yesterday')}
          tone="emerald"
        />
        <StatCard label="In flight" value={stats.activeOrderCount} hint="Paid through ready" tone="amber" />
        <StatCard
          label="Avg order value"
          value={formatMoney(stats.today.avgOrderValue)}
          hint={`${stats.today.itemsSold} items sold today`}
          tone="sky"
        />
        <StatCard label="Awaiting action" value={stats.active.PAID ?? 0} hint="Paid, not accepted yet" tone="rose" />
        <StatCard label="Low stock items" value={stats.lowStockCount} hint="At or below threshold" tone="orange" />
      </div>

      <div className="admin-cols">
        <Card
          title="Recent orders"
          action={
            <Link className="linkish" to="/admin/orders">
              View all
            </Link>
          }
        >
          {stats.recentOrders.length === 0 ? (
            <EmptyState title="No orders yet today" message="Orders will appear here the moment payment clears." />
          ) : (
            <ul className="admin-orders">
              {stats.recentOrders.map((order) => (
                <li key={order.id}>
                  <div className="admin-orders__main">
                    <div className="admin-orders__head">
                      <OrderToken token={order.token} size="sm" />
                      <StatusBadge status={order.status} />
                    </div>
                    <small>
                      {order.isGuest ? 'Guest' : (order.userName ?? 'Student')} · {order.items.length} item{order.items.length > 1 ? 's' : ''} ·{' '}
                      {timeAgo(order.placedAt)}
                    </small>
                  </div>
                  <strong>{formatMoney(order.total)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Busiest items today">
          {stats.topItems.length === 0 ? (
            <EmptyState title="Nothing sold yet" />
          ) : (
            <ol className="rank-list">
              {stats.topItems.map((item, index) => (
                <li key={item.name ?? item._id ?? index}>
                  <span className="rank-list__pos">{index + 1}</span>
                  <span className="rank-list__name">{item.name ?? item._id ?? 'Item'}</span>
                  <span className="rank-list__value">{item.quantity} sold</span>
                  <span className="rank-list__rev">{formatMoney(item.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Canteen status">
        <div className="canteen-grid">
          {canteens.map((canteen) => (
            <div key={canteen.id} className="canteen-tile">
              <div className="canteen-tile__head">
                <strong>{canteen.name}</strong>
                <Badge tone={canteen.canOrder ? 'emerald' : 'rose'}>{canteen.canOrder ? 'Open' : 'Paused'}</Badge>
              </div>
              <dl className="kv kv--tight">
                <div>
                  <dt>In flight</dt>
                  <dd>
                    {canteen.activeOrderCount}/{canteen.maxConcurrentOrders}
                  </dd>
                </div>
                <div>
                  <dt>Prep</dt>
                  <dd>~{canteen.prepTimeMins} min</dd>
                </div>
                <div>
                  <dt>Hours</dt>
                  <dd>
                    {canteen.openingTime}–{canteen.closingTime}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
