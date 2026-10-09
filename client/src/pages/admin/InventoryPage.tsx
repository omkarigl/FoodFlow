import { useCallback, useEffect, useState } from 'react';
import { ApiError, menuApi } from '../../lib/api';
import { useRealtime } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Select, Skeleton, StatCard } from '../../components/ui';
import { CURRENCY, formatDateTime } from '../../lib/format';
import type { InventoryRow, InventorySummary } from '../../types';

export function InventoryPage() {
  const { canteens, activeCanteen, setActiveCanteen } = useAdminContext();
  const { subscribe } = useRealtime();
  const toast = useToast();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [adjust, setAdjust] = useState<{ item: InventoryRow; mode: 'set' | 'add' | 'subtract'; quantity: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await menuApi.inventory({ canteen: activeCanteen || undefined, search: filter || undefined });
      setRows(result.items);
      setSummary(result.summary);
      setEdits({});
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load inventory.');
    } finally {
      setLoading(false);
    }
  }, [activeCanteen, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribe((event) => event.type === 'inventory:updated' && void load()), [subscribe, load]);

  const saveSingle = async (row: InventoryRow) => {
    const next = edits[row.id];
    if (next === undefined || next === row.stock) return;
    try {
      await menuApi.adjustInventory({ itemId: row.id, mode: 'set', quantity: next, reason: 'Corrected from inventory screen' });
      toast.success(`${row.name} stock set to ${next}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update stock.');
    }
  };

  const saveBulk = async () => {
    const entries = Object.entries(edits).filter(([id, value]) => {
      const row = rows.find((item) => item.id === id);
      return row && value !== row.stock;
    });
    if (entries.length === 0) {
      toast.push('Nothing changed yet.', 'info');
      return;
    }
    try {
      await Promise.all(
        entries.map(([id, value]) => menuApi.adjustInventory({ itemId: id, mode: 'set', quantity: Number(value), reason: 'Bulk inventory update' })),
      );
      toast.success(`${entries.length} item(s) updated.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk update failed.');
    }
  };

  const applyAdjust = async () => {
    if (!adjust) return;
    try {
      await menuApi.adjustInventory({ itemId: adjust.item.id, mode: adjust.mode, quantity: adjust.quantity, reason: 'Counter adjustment' });
      toast.success(`${adjust.item.name} updated.`);
      setAdjust(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Adjustment failed.');
    }
  };

  const changed = Object.keys(edits).filter((id) => {
    const row = rows.find((item) => item.id === id);
    return row && edits[id] !== row.stock;
  }).length;

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Inventory</h1>
          <p className="page__sub">Stock decrements the moment a payment clears and restores itself on cancellation.</p>
        </div>
        {changed > 0 && (
          <Button onClick={saveBulk}>
            Save {changed} change{changed > 1 ? 's' : ''}
          </Button>
        )}
      </header>

      {summary && (
        <div className="stats-grid">
          <StatCard label="Items" value={summary.total} hint={`${summary.tracked} stock tracked`} tone="indigo" />
          <StatCard label="Stock value" value={`${CURRENCY}${summary.stockValue.toFixed(0)}`} hint="At current prices" tone="emerald" />
          <StatCard label="Low stock" value={summary.lowStock} hint="At or below threshold" tone="amber" />
          <StatCard label="Out of stock" value={summary.outOfStock} hint="Hidden from students" tone="rose" />
          <StatCard label="Hidden" value={summary.unavailable} hint="Manually unavailable" tone="slate" />
        </div>
      )}

      <Card padded={false}>
        <div className="filters">
          <input className="input filters__search" placeholder="Search item or category" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="filters__sort">
            <Select value={activeCanteen} onChange={(e) => setActiveCanteen(e.target.value)}>
              <option value="">All canteens</option>
              {canteens.map((canteen) => (
                <option key={canteen.id} value={canteen.id}>
                  {canteen.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {loading && <Skeleton rows={6} />}

      {!loading && rows.length === 0 && <EmptyState title="No items found" message="Try a different search or canteen." />}

      {rows.length > 0 && (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Canteen</th>
                  <th className="right">Price</th>
                  <th>Stock</th>
                  <th>Threshold</th>
                  <th>Value</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const value = edits[row.id] ?? row.stock ?? 0;
                  const dirty = edits[row.id] !== undefined && edits[row.id] !== row.stock;
                  return (
                    <tr key={row.id} className={dirty ? 'is-dirty' : ''}>
                      <td>
                        <div className="cell-item">
                          <span aria-hidden="true">{row.emoji ?? ''}</span>
                          <div>
                            <strong>{row.name}</strong>
                            <small>
                              {row.category} · {row.isAvailable ? 'Available' : 'Hidden'}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="muted">{row.canteenName ?? '—'}</td>
                      <td className="right">
                        {CURRENCY}
                        {row.price}
                      </td>
                      <td>
                        {row.trackStock ? (
                          <div className="stock-edit">
                            <input
                              className="input input--sm"
                              type="number"
                              min={0}
                              value={value}
                              aria-label={`Stock for ${row.name}`}
                              onChange={(e) => setEdits((current) => ({ ...current, [row.id]: Number(e.target.value) }))}
                            />
                            {dirty && (
                              <button type="button" className="linkish" onClick={() => saveSingle(row)}>
                                Save
                              </button>
                            )}
                          </div>
                        ) : (
                          <Badge tone="slate">Unlimited</Badge>
                        )}
                      </td>
                      <td className="muted">{row.lowStockThreshold}</td>
                      <td className="muted">{row.trackStock ? `${CURRENCY}${row.stockValue.toFixed(0)}` : '—'}</td>
                      <td className="right">
                        {row.trackStock && (
                          <button
                            type="button"
                            className="linkish"
                            onClick={() => setAdjust({ item: row, mode: 'add', quantity: 10 })}
                          >
                            Adjust
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Recent movement" subtitle="Stock changes made from the counter.">
        <InventoryHistory rows={rows} />
      </Card>

      {adjust && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__panel modal__panel--sm">
            <header className="modal__head">
              <h2>Adjust {adjust.item.name}</h2>
              <button type="button" className="modal__close" onClick={() => setAdjust(null)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="modal__body">
              <Field
                label="Quantity"
                type="number"
                min={1}
                value={adjust.quantity}
                onChange={(e) => setAdjust({ ...adjust, quantity: Number(e.target.value) })}
              />
              <div className="grid-2">
                {(['add', 'subtract', 'set'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`method method--sm ${adjust.mode === mode ? 'is-active' : ''}`}
                    onClick={() => setAdjust({ ...adjust, mode })}
                  >
                    {mode === 'add' ? '+ Add' : mode === 'subtract' ? '− Subtract' : '= Set to'}
                  </button>
                ))}
              </div>
              <p className="muted">Currently {adjust.item.stock ?? 0} in stock.</p>
            </div>
            <footer className="modal__foot">
              <Button variant="ghost" onClick={() => setAdjust(null)}>
                Cancel
              </Button>
              <Button onClick={applyAdjust}>Apply</Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

interface Movement {
  orderId: string;
  orderNumber: number;
  token: string;
  student: string;
  quantity: number;
  at: string;
}

function InventoryHistory({ rows }: { rows: InventoryRow[] }) {
  const [log, setLog] = useState<Array<Movement & { itemName: string }>>([]);

  useEffect(() => {
    if (!rows.length) return;
    let active = true;
    Promise.all(
      rows.slice(0, 8).map((row) =>
        menuApi
          .inventoryHistory(row.id)
          .then((result) => result.movements.map((m) => ({ ...(m as unknown as Movement), itemName: row.name })))
          .catch(() => [] as Array<Movement & { itemName: string }>),
      ),
    )
      .then((entries) => {
        if (!active) return;
        setLog(entries.flat().slice(0, 12));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rows]);

  if (!log.length) return <p className="muted">No movement recorded yet.</p>;

  return (
    <ul className="txn-list">
      {log.map((entry, index) => (
        <li key={`${entry.orderId}-${index}`} className="txn">
          <div className="txn__body">
            <strong>
              {entry.itemName} × {entry.quantity}
            </strong>
            <small>
              Token {entry.token} · {entry.student} · {formatDateTime(entry.at)}
            </small>
          </div>
          <div className="txn__amount">
            <small>order #{entry.orderNumber}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}