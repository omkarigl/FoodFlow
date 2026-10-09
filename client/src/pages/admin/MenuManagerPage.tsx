import { useCallback, useEffect, useState } from 'react';
import { ApiError, canteenApi, menuApi } from '../../lib/api';
import { useRealtime } from '../../context/SocketContext';
import { useToast } from '../../context/ToastContext';
import { useAdminContext } from '../../layouts/AdminLayout';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Select, Skeleton, TextArea, Toggle } from '../../components/ui';
import { CURRENCY } from '../../lib/format';
import type { MenuItem } from '../../types';

const CATEGORIES = ['Breakfast', 'Snacks', 'Chaat', 'Main Course', 'Rice & Biryani', 'Bread & Bakery', 'Beverages', 'Desserts', 'Combos'];
const EMOJI = ['🍛', '🥘', '🫓', '🍜', '☕', '🥤', '🍮', '🥟', '🍔', '🥗', '🍕', '🌮'];

interface Draft {
  id?: string;
  name: string;
  description: string;
  category: string;
  price: number;
  emoji: string;
  imageUrl: string;
  isVeg: boolean;
  isAvailable: boolean;
  trackStock: boolean;
  stock: number;
  lowStockThreshold: number;
  prepTimeMins: number;
}

const EMPTY: Draft = {
  name: '',
  description: '',
  category: 'Main Course',
  price: 60,
  emoji: '🍛',
  imageUrl: '',
  isVeg: true,
  isAvailable: true,
  trackStock: true,
  stock: 25,
  lowStockThreshold: 5,
  prepTimeMins: 10,
};

export function MenuManagerPage() {
  const { canteens, activeCanteen, setActiveCanteen } = useAdminContext();
  const { subscribe } = useRealtime();
  const toast = useToast();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!canteens.length) return;
    const canteenId = activeCanteen || canteens[0].id;
    setLoading(true);
    try {
      const result = await menuApi.list({ canteen: canteenId, includeUnavailable: 'true' });
      setItems(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the menu.');
    } finally {
      setLoading(false);
    }
  }, [canteens, activeCanteen]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => subscribe((event) => event.type === 'menu:updated' && void load()), [subscribe, load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error('Give the item a name.');
      return;
    }
    const canteenId = activeCanteen || canteens[0]?.id;
    if (!draft.id && !canteenId) {
      toast.error('Pick a canteen first.');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        category: draft.category,
        price: draft.price,
        emoji: draft.emoji || undefined,
        imageUrl: draft.imageUrl.trim() || undefined,
        isVegetarian: draft.isVeg,
        isAvailable: draft.isAvailable,
        trackStock: draft.trackStock,
        stock: draft.trackStock ? draft.stock : null,
        lowStockThreshold: draft.lowStockThreshold,
        prepTimeMins: draft.prepTimeMins || undefined,
      };
      if (draft.id) {
        await menuApi.update(draft.id, body);
        toast.success('Item updated.');
      } else {
        await menuApi.create({ ...body, canteen: canteenId });
        toast.success('Item added to the menu.');
      }
      setDraft(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save that item.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async (item: MenuItem) => {
    try {
      await menuApi.setAvailability(item.id, !item.isAvailable);
      toast.success(`${item.name} is now ${item.isAvailable ? 'hidden' : 'available'}.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update availability.');
    }
  };

  const bulkToggle = async (isAvailable: boolean) => {
    if (selected.length === 0) return;
    try {
      await menuApi.bulkAvailability(selected, isAvailable);
      toast.success(`${selected.length} item(s) updated.`);
      setSelected([]);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Bulk update failed.');
    }
  };

  const remove = async (item: MenuItem) => {
    if (!window.confirm(`Remove "${item.name}" from the menu?`)) return;
    try {
      await menuApi.remove(item.id);
      toast.success('Item removed.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove that item.');
    }
  };

  const visible = items.filter((item) => !search || item.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Menu management</h1>
          <p className="page__sub">Prices, availability and prep times for every counter.</p>
        </div>
        <Button onClick={() => setDraft({ ...EMPTY })}>+ New item</Button>
      </header>

      <Card padded={false}>
        <div className="filters">
          <input className="input filters__search" placeholder="Search the menu" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="filters__sort">
            <Select value={activeCanteen || canteens[0]?.id || ''} onChange={(e) => setActiveCanteen(e.target.value)}>
              {canteens.map((canteen) => (
                <option key={canteen.id} value={canteen.id}>
                  {canteen.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {selected.length > 0 && (
        <div className="bulk-bar">
          <span>{selected.length} selected</span>
          <Button size="sm" variant="secondary" onClick={() => bulkToggle(true)}>
            Mark available
          </Button>
          <Button size="sm" variant="secondary" onClick={() => bulkToggle(false)}>
            Mark unavailable
          </Button>
          <button type="button" className="linkish" onClick={() => setSelected([])}>
            Clear
          </button>
        </div>
      )}

      {error && <ErrorNote message={error} onRetry={() => void load()} />}
      {loading && <Skeleton rows={6} />}

      {!loading && visible.length === 0 && <EmptyState title="No items yet" message="Add your first dish to this canteen." />}

      {visible.length > 0 && (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={selected.length === visible.length && visible.length > 0}
                      onChange={(e) => setSelected(e.target.checked ? visible.map((item) => item.id) : [])}
                    />
                  </th>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="right">Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        checked={selected.includes(item.id)}
                        onChange={(e) => setSelected(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
                      />
                    </td>
                    <td>
                      <div className="cell-item">
                        <span aria-hidden="true">{item.emoji ?? ''}</span>
                        <div>
                          <strong>
                            {item.isVeg && <span className="veg-dot" />} {item.name}
                          </strong>
                          <small>{item.description ?? '—'}</small>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{item.category}</td>
                    <td className="right">
                      <strong>
                        {CURRENCY}
                        {item.price}
                      </strong>
                    </td>
                    <td>
                      {!item.trackStock ? (
                        <span className="muted">Unlimited</span>
                      ) : (
                        <span className={item.outOfStock ? 'stock stock--out' : item.lowStock ? 'stock stock--low' : 'stock'}>
                          {item.stock ?? 0}
                        </span>
                      )}
                    </td>
                    <td>
                      <Toggle checked={item.isAvailable} onChange={() => toggleAvailability(item)} label={item.isAvailable ? 'Available' : 'Hidden'} />
                    </td>
                    <td className="right">
                      <div className="row-actions">
                        <button type="button" className="linkish" onClick={() => setDraft(fromItem(item))}>
                          Edit
                        </button>
                        <button type="button" className="linkish linkish--danger" onClick={() => remove(item)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {draft && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__panel">
            <header className="modal__head">
              <h2>{draft.id ? 'Edit item' : 'New menu item'}</h2>
              <button type="button" className="modal__close" onClick={() => setDraft(null)} aria-label="Close">
                ×
              </button>
            </header>

            <div className="modal__body">
              <Field label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Chicken Biryani" />
              <TextArea label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Spicy, served with raita" />
              <div className="grid-2">
                <label className="field">
                  <span className="field__label">Category</span>
                  <select className="input select" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                    {CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="Price (₹)" type="number" min={1} value={draft.price} onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
              </div>
              <div className="grid-2">
                <Field label="Emoji" value={draft.emoji} maxLength={4} onChange={(e) => setDraft({ ...draft, emoji: e.target.value })} />
                <Field label="Image URL (optional)" value={draft.imageUrl} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="https://…" />
              </div>
              <div className="emoji-row">
                {EMOJI.map((emoji) => (
                  <button key={emoji} type="button" className={`emoji ${draft.emoji === emoji ? 'is-active' : ''}`} onClick={() => setDraft({ ...draft, emoji })}>
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="grid-2">
                <Field label="Prep time (min)" type="number" min={0} value={draft.prepTimeMins} onChange={(e) => setDraft({ ...draft, prepTimeMins: Number(e.target.value) })} />
                <Field label="Low stock threshold" type="number" min={0} value={draft.lowStockThreshold} onChange={(e) => setDraft({ ...draft, lowStockThreshold: Number(e.target.value) })} />
              </div>
              <div className="grid-2">
                <Toggle checked={draft.isVeg} onChange={(next) => setDraft({ ...draft, isVeg: next })} label="Vegetarian" />
                <Toggle checked={draft.isAvailable} onChange={(next) => setDraft({ ...draft, isAvailable: next })} label="Available now" />
              </div>
              <Toggle
                checked={draft.trackStock}
                onChange={(next) => setDraft({ ...draft, trackStock: next })}
                label="Track stock for this item"
                hint={draft.trackStock ? 'Counts down with each paid order.' : 'Always available, never counts down.'}
              />
              {draft.trackStock && (
                <Field label="Units in stock" type="number" min={0} value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: Number(e.target.value) })} />
              )}
            </div>

            <footer className="modal__foot">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button onClick={save} loading={saving}>
                {draft.id ? 'Save changes' : 'Add to menu'}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function fromItem(item: MenuItem): Draft {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    category: item.category,
    price: item.price,
    emoji: item.emoji ?? '',
    imageUrl: item.imageUrl ?? '',
    isVeg: item.isVeg,
    isAvailable: item.isAvailable,
    trackStock: item.trackStock,
    stock: item.stock ?? 0,
    lowStockThreshold: item.lowStockThreshold,
    prepTimeMins: item.prepTimeMins ?? 10,
  };
}

export function CanteenQuickPanel() {
  const toast = useToast();
  const [canteens, setCanteens] = useState<Awaited<ReturnType<typeof canteenApi.status>>['canteens']>([]);

  useEffect(() => {
    canteenApi.status().then((result) => setCanteens(result.canteens)).catch(() => undefined);
  }, []);

  return (
    <div className="canteen-grid">
      {canteens.map((canteen) => (
        <div key={canteen.id} className="canteen-tile">
          <div className="canteen-tile__head">
            <strong>{canteen.name}</strong>
            <Badge tone={canteen.canOrder ? 'emerald' : 'rose'}>{canteen.canOrder ? 'Open' : 'Paused'}</Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await canteenApi.setStatus(canteen.id, { isOpen: !canteen.isOpen });
              toast.success(`${canteen.name} ${canteen.isOpen ? 'paused' : 'resumed'}.`);
            }}
          >
            Toggle
          </Button>
        </div>
      ))}
    </div>
  );
}