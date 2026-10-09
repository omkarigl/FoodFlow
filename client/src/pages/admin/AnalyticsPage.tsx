import { useCallback, useEffect, useState } from 'react';
import { ApiError, adminApi } from '../../lib/api';
import { useAdminContext } from '../../layouts/AdminLayout';
import { Button, Card, EmptyState, ErrorNote, Select, Skeleton, StatCard } from '../../components/ui';
import { formatMoney } from '../../lib/format';
import type { AnalyticsReport } from '../../types';

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 14, label: 'Last 14 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

/** Lightweight SVG line/area chart so analytics works with zero extra dependencies. */
function TrendChart({ data, valueKey, tone = '#2563EB' }: { data: Array<Record<string, unknown>>; valueKey: string; tone?: string }) {
  if (data.length === 0) return null;
  const width = 720;
  const height = 220;
  const pad = 28;
  const values = data.map((row) => Number(row[valueKey] ?? 0));
  const max = Math.max(...values, 1);
  const stepX = (width - pad * 2) / Math.max(data.length - 1, 1);
  const points = data.map((row, index) => {
    const x = pad + index * stepX;
    const y = height - pad - (Number(row[valueKey] ?? 0) / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad},${height - pad} ${points.join(' ')} ${(pad + (data.length - 1) * stepX).toFixed(1)},${height - pad}`;
  const id = `grad-${valueKey}`;

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${valueKey} trend`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tone} stopOpacity="0.32" />
          <stop offset="100%" stopColor={tone} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
        <line key={ratio} x1={pad} x2={width - pad} y1={pad + ratio * (height - pad * 2)} y2={pad + ratio * (height - pad * 2)} className="chart__grid" />
      ))}
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={points.join(' ')} fill="none" stroke={tone} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((row, index) => {
        const value = Number(row[valueKey] ?? 0);
        if (value === 0) return null;
        const x = pad + index * stepX;
        const y = height - pad - (value / max) * (height - pad * 2);
        return <circle key={index} cx={x} cy={y} r="3.5" fill={tone} />;
      })}
      <text x={pad} y={height - 8} className="chart__label">
        {String(data[0]?.date ?? '')}
      </text>
      <text x={width - pad} y={height - 8} textAnchor="end" className="chart__label">
        {String(data[data.length - 1]?.date ?? '')}
      </text>
      <text x={pad - 6} y={pad + 4} textAnchor="end" className="chart__label">
        {max.toLocaleString()}
      </text>
    </svg>
  );
}

function BarChart({ data, labelKey, valueKey }: { data: Array<Record<string, unknown>>; labelKey: string; valueKey: string }) {
  const rows = data.slice(0, 8);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((row) => Number(row[valueKey] ?? 0)), 1);

  return (
    <ul className="bars">
      {rows.map((row, index) => (
        <li key={`${String(row[labelKey])}-${index}`}>
          <span className="bars__label">{String(row[labelKey] ?? '—')}</span>
          <span className="bars__track">
            <span className="bars__fill" style={{ width: `${(Number(row[valueKey] ?? 0) / max) * 100}%` }} />
          </span>
          <span className="bars__value">
            {valueKey === 'revenue' || valueKey === 'amount' || valueKey === 'total'
              ? formatMoney(Number(row[valueKey] ?? 0))
              : Number(row[valueKey] ?? 0)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AnalyticsPage() {
  const { canteens, activeCanteen, setActiveCanteen } = useAdminContext();
  const [days, setDays] = useState(7);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminApi.analytics({ days, canteen: activeCanteen || undefined });
      setReport(result);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [days, activeCanteen]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Analytics</h1>
          <p className="page__sub">Revenue, demand and mix across the selected window.</p>
        </div>
        <div className="filters__sort">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <Card padded={false}>
        <div className="chips">
          <button type="button" className={`chip ${activeCanteen === '' ? 'is-active' : ''}`} onClick={() => setActiveCanteen('')}>
            All canteens
          </button>
          {canteens.map((canteen) => (
            <button key={canteen.id} type="button" className={`chip ${activeCanteen === canteen.id ? 'is-active' : ''}`} onClick={() => setActiveCanteen(canteen.id)}>
              {canteen.name}
            </button>
          ))}
        </div>
      </Card>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {loading && <Skeleton rows={6} />}
      {!loading && !report && null}

      {report && (
        <>
          <div className="stats-grid">
            <StatCard label="Orders" value={report.summary.totalOrders} hint={`${report.summary.cancellationRate ?? 0}% cancelled`} tone="indigo" />
            <StatCard
              label="Revenue"
              value={formatMoney(report.summary.totalRevenue)}
              hint={report.summary.growthPercent === null ? 'no prior data' : `${report.summary.growthPercent}% second half vs first`}
              tone="emerald"
            />
            <StatCard label="Avg order" value={formatMoney(report.summary.avgOrderValue)} tone="sky" />
            <StatCard label="Lifetime orders" value={report.summary.lifetimeOrders ?? report.summary.totalOrders} tone="slate" />
          </div>

          <Card title="Revenue trend" subtitle="Every day in the window, straight from the orders collection.">
            <TrendChart data={report.daily as unknown as Array<Record<string, unknown>>} valueKey="revenue" />
          </Card>

          <Card title="Order volume">
            <TrendChart data={report.daily as unknown as Array<Record<string, unknown>>} valueKey="orders" tone="#1E3A8A" />
          </Card>

          <div className="admin-cols">
            <Card title="Revenue by category">
              {report.byCategory.length === 0 ? (
                <EmptyState title="No sales in this window" />
              ) : (
                <BarChart data={report.byCategory as unknown as Array<Record<string, unknown>>} labelKey="category" valueKey="revenue" />
              )}
            </Card>

            <Card title="Quantity by category">
              {report.byCategory.length === 0 ? (
                <EmptyState title="Nothing sold yet" />
              ) : (
                <BarChart data={report.byCategory as unknown as Array<Record<string, unknown>>} labelKey="category" valueKey="quantity" />
              )}
            </Card>
          </div>

          <div className="admin-cols">
            <Card title="Orders by status">
              {report.byStatus.length === 0 ? (
                <EmptyState title="No status data" />
              ) : (
                <BarChart data={report.byStatus as unknown as Array<Record<string, unknown>>} labelKey="status" valueKey="count" />
              )}
            </Card>

            <Card title="Payment mix">
              {report.byPaymentMethod.length === 0 ? (
                <EmptyState title="No payments yet" />
              ) : (
                <BarChart data={report.byPaymentMethod as unknown as Array<Record<string, unknown>>} labelKey="method" valueKey="total" />
              )}
            </Card>
          </div>

          <Card title="Top selling items">
            {report.topItems.length === 0 ? (
              <EmptyState title="No sales in this window" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Item</th>
                      <th className="right">Quantity</th>
                      <th className="right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItems.map((item, index) => (
                      <tr key={item.name}>
                        <td>{index + 1}</td>
                        <td>{item.name}</td>
                        <td className="right">{item.quantity}</td>
                        <td className="right">{formatMoney(item.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <RevenueReportSection />
        </>
      )}
    </div>
  );
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formal revenue report: presets + custom range, summary + best sellers + order log, browser-print to PDF. */
function RevenueReportSection() {
  const { activeCanteen } = useAdminContext();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const [from, setFrom] = useState(isoDay(monthStart));
  const [to, setTo] = useState(isoDay(now));
  const [report, setReport] = useState<import('../../types').RevenueReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (fromDate = from, toDate = to) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminApi.revenue(fromDate, toDate, activeCanteen || undefined);
      setReport(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not generate the report.');
    } finally {
      setLoading(false);
    }
  };

  const preset = (kind: 'month' | 'last') => {
    if (kind === 'month') {
      setFrom(isoDay(monthStart));
      setTo(isoDay(now));
      void generate(isoDay(monthStart), isoDay(now));
    } else {
      setFrom(isoDay(lastMonthStart));
      setTo(isoDay(lastMonthEnd));
      void generate(isoDay(lastMonthStart), isoDay(lastMonthEnd));
    }
  };

  return (
    <Card
      title="Revenue report"
      subtitle="Formal summary for the counter records — prints cleanly to PDF."
      action={
        <Button variant="secondary" size="sm" onClick={() => window.print()}>
          Download / Print as PDF
        </Button>
      }
    >
      <div className="report-controls">
        <div className="chips">
          <button type="button" className="chip" onClick={() => preset('month')}>
            This Month
          </button>
          <button type="button" className="chip" onClick={() => preset('last')}>
            Last Month
          </button>
        </div>
        <div className="report-range">
          <label className="field">
            <span className="field__label">From</span>
            <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">To</span>
            <input className="input" type="date" value={to} min={from} max={isoDay(new Date())} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button onClick={() => void generate()} loading={loading}>
            Generate
          </Button>
        </div>
      </div>

      {error && <ErrorNote message={error} onRetry={() => void generate()} />}

      {report && (
        <div className="report">
          <div className="report__head">
            <h3>FoodFlow — Revenue Report</h3>
            <p className="muted">
              {new Date(report.from).toLocaleDateString()} → {new Date(report.to).toLocaleDateString()}
            </p>
          </div>
          <dl className="kv">
            <div>
              <dt>Total orders</dt>
              <dd>{report.summary.orders}</dd>
            </div>
            <div>
              <dt>Paid orders</dt>
              <dd>{report.summary.paidOrders}</dd>
            </div>
            <div>
              <dt>Revenue</dt>
              <dd>{formatMoney(report.summary.revenue)}</dd>
            </div>
            <div>
              <dt>Items sold</dt>
              <dd>{report.summary.itemsSold}</dd>
            </div>
            <div>
              <dt>Average order value</dt>
              <dd>{formatMoney(report.summary.avgOrderValue)}</dd>
            </div>
          </dl>

          <h4>Best-selling items</h4>
          {report.bestSellers.length === 0 ? (
            <EmptyState title="No sales in this range" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Item</th>
                    <th className="right">Quantity</th>
                    <th className="right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bestSellers.map((item, i) => (
                    <tr key={item.name}>
                      <td>{i + 1}</td>
                      <td>{item.name}</td>
                      <td className="right">{item.quantity}</td>
                      <td className="right">{formatMoney(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h4>Order log</h4>
          {report.orders.length === 0 ? (
            <EmptyState title="No orders in this range" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Status</th>
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{order.token}</td>
                      <td className="muted">{new Date(order.placedAt).toLocaleString()}</td>
                      <td>{order.isGuest ? 'Guest' : (order.userName ?? '—')}</td>
                      <td className="muted">{order.items.reduce((s, l) => s + l.quantity, 0)}</td>
                      <td>{order.status.replace(/_/g, ' ').toLowerCase()}</td>
                      <td className="right">{formatMoney(order.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
     