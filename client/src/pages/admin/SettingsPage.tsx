import { useCallback, useEffect, useState } from 'react';
import { ApiError, adminApi, canteenApi } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Skeleton, Toggle } from '../../components/ui';
import { CURRENCY } from '../../lib/format';
import type { AppSettings, Canteen, QRLocation } from '../../types';

export function SettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [locations, setLocations] = useState<QRLocation[]>([]);
  const [health, setHealth] = useState<{ payment: unknown; counts: Record<string, number>; environment: string; time: string } | null>(null);
  const [tokens, setTokens] = useState<Awaited<ReturnType<typeof adminApi.tokens>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDraft, setQrDraft] = useState({ canteen: '', code: '', label: '', block: '', tableHint: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResult, status, qr, healthResult, tokenResult] = await Promise.all([
        adminApi.settings(),
        canteenApi.status(),
        canteenApi.qrLocations(),
        adminApi.health().catch(() => null),
        adminApi.tokens().catch(() => null),
      ]);
      setSettings(settingsResult.settings);
      setCanteens(status.canteens);
      setLocations(qr.locations);
      setHealth(healthResult);
      setTokens(tokenResult);
      if (!qrDraft.canteen && status.canteens[0]) setQrDraft((prev) => ({ ...prev, canteen: status.canteens[0].id }));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load settings.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      // Only recognised keys — the server strips anything else.
      const { appName, currency, currencySymbol, taxPercent, taxLabel, minOrderValue, maxItemsPerOrder, tokenLength, tokenPrefix, autoAcceptOrders, supportEmail, supportPhone, lowStockAlerts } = settings;
      const result = await adminApi.updateSettings({
        appName, currency, currencySymbol, taxPercent, taxLabel, minOrderValue, maxItemsPerOrder, tokenLength, tokenPrefix, autoAcceptOrders,
        supportEmail: supportEmail || undefined, supportPhone: supportPhone || undefined, lowStockAlerts,
      });
      setSettings({ ...settings, ...result.settings });
      toast.success('Settings saved.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const toggleCanteen = async (canteen: Canteen) => {
    try {
      await canteenApi.setStatus(canteen.id, {
        isOpen: !canteen.isOpen,
        statusReason: canteen.isOpen ? 'Paused from admin settings' : undefined,
        closedMessage: canteen.isOpen ? 'The counter is paused. Please try again shortly.' : undefined,
      });
      const result = await canteenApi.status();
      setCanteens(result.canteens);
      toast.success(`${canteen.name} ${canteen.isOpen ? 'paused' : 'resumed'}.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update the canteen.');
    }
  };

  const createQr = async () => {
    try {
      await canteenApi.createQrLocation({
        canteen: qrDraft.canteen,
        code: qrDraft.code.trim().toUpperCase(),
        label: qrDraft.label.trim(),
        block: qrDraft.block.trim() || undefined,
        tableHint: qrDraft.tableHint.trim() || undefined,
      });
      toast.success('QR code created.');
      setQrOpen(false);
      setQrDraft({ canteen: qrDraft.canteen, code: '', label: '', block: '', tableHint: '' });
      const qr = await canteenApi.qrLocations();
      setLocations(qr.locations);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create that QR code.');
    }
  };

  const removeQr = async (location: QRLocation) => {
    if (!window.confirm(`Delete QR code ${location.code}?`)) return;
    try {
      await canteenApi.deleteQrLocation(location.id);
      toast.success('QR code removed.');
      const qr = await canteenApi.qrLocations();
      setLocations(qr.locations);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not remove that QR code.');
    }
  };

  if (loading) return <Skeleton rows={6} />;
  if (error) return <ErrorNote message={error} onRetry={() => void load()} />;
  if (!settings) return null;

  return (
    <div className="admin-stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Settings</h1>
          <p className="page__sub">Platform rules, canteen control, QR codes and system health.</p>
        </div>
        <Button onClick={save} loading={saving}>
          Save settings
        </Button>
      </header>

      <Card title="Platform rules">
        <div className="grid-2">
          <Field label="App name" value={settings.appName} onChange={(e) => set('appName', e.target.value)} />
          <Field label="Currency code" value={settings.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} />
          <Field label="Currency symbol" value={settings.currencySymbol} onChange={(e) => set('currencySymbol', e.target.value)} maxLength={4} />
          <Field label="Tax label" value={settings.taxLabel} onChange={(e) => set('taxLabel', e.target.value)} maxLength={16} />
          <Field label="Tax percent" type="number" min={0} max={30} step={0.5} value={settings.taxPercent} onChange={(e) => set('taxPercent', Number(e.target.value))} />
          <Field label="Min order value" type="number" min={0} value={settings.minOrderValue} onChange={(e) => set('minOrderValue', Number(e.target.value))} />
          <Field
            label="Max items per order"
            type="number"
            min={1}
            value={settings.maxItemsPerOrder}
            onChange={(e) => set('maxItemsPerOrder', Number(e.target.value))}
            hint="Caps the cart so the kitchen never drowns."
          />
          <Field label="Support email" value={settings.supportEmail ?? ''} onChange={(e) => set('supportEmail', e.target.value)} />
          <Field label="Support phone" value={settings.supportPhone ?? ''} onChange={(e) => set('supportPhone', e.target.value)} />
        </div>
        <div className="grid-2">
          <Toggle checked={settings.autoAcceptOrders} onChange={(next) => set('autoAcceptOrders', next)} label="Auto-accept paid orders" hint="Skip the manual accept step for speed." />
          <Toggle checked={settings.lowStockAlerts ?? true} onChange={(next) => set('lowStockAlerts', next)} label="Low stock alerts" />
        </div>
      </Card>

      <Card title="Canteens" subtitle="Pause a counter when the kitchen runs out of a key ingredient.">
        {canteens.length === 0 ? (
          <EmptyState title="No canteens yet" />
        ) : (
          <div className="canteen-grid">
            {canteens.map((canteen) => (
              <div key={canteen.id} className="canteen-tile">
                <div className="canteen-tile__head">
                  <strong>{canteen.name}</strong>
                  <Badge tone={canteen.canOrder ? 'emerald' : 'rose'}>{canteen.canOrder ? 'Taking orders' : 'Paused'}</Badge>
                </div>
                <p className="muted">
                  {canteen.block ?? canteen.code} · {canteen.openingTime}–{canteen.closingTime} · {canteen.prepTimeMins} min prep
                </p>
                <dl className="kv kv--tight">
                  <div>
                    <dt>In flight</dt>
                    <dd>
                      {canteen.activeOrderCount}/{canteen.maxConcurrentOrders}
                    </dd>
                  </div>
                  <div>
                    <dt>Hours</dt>
                    <dd>
                      {canteen.openingTime}–{canteen.closingTime}
                    </dd>
                  </div>
                </dl>
                <Button size="sm" variant={canteen.canOrder ? 'danger' : 'success'} onClick={() => toggleCanteen(canteen)}>
                  {canteen.canOrder ? 'Pause orders' : 'Resume orders'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        title="QR codes"
        subtitle="One code per table, counter or zone. Students scan to be pinned to that canteen."
        action={
          <Button size="sm" onClick={() => setQrOpen(true)}>
            + New code
          </Button>
        }
      >
        {locations.length === 0 ? (
          <EmptyState title="No QR codes" message="Create one so students can find this canteen." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Label</th>
                  <th>Canteen</th>
                  <th>Location</th>
                  <th>Scans</th>
                  <th>Status</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((location) => (
                  <tr key={location.id}>
                    <td>
                      <code className="mono">{location.code}</code>
                    </td>
                    <td>
                      <strong>{location.label}</strong>
                    </td>
                    <td className="muted">{location.canteenName ?? location.canteen}</td>
                    <td className="muted">{[location.block, location.tableHint].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="muted">{location.scanCount ?? 0}</td>
                    <td>
                      <Badge tone={location.isActive ? 'emerald' : 'slate'}>{location.isActive ? 'Active' : 'Disabled'}</Badge>
                    </td>
                    <td className="right">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="linkish"
                          onClick={async () => {
                            await canteenApi.updateQrLocation(location.id, { isActive: !location.isActive });
                            const qr = await canteenApi.qrLocations();
                            setLocations(qr.locations);
                          }}
                        >
                          {location.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button type="button" className="linkish linkish--danger" onClick={() => removeQr(location)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {tokens && (
        <Card title="Pickup tokens" subtitle="Format and the tokens issued today.">
          <dl className="kv">
            <div>
              <dt>Format</dt>
              <dd className="mono">{tokens.format}</dd>
            </div>
            <div>
              <dt>Prefix / length</dt>
              <dd className="mono">
                {tokens.prefix || '(none)'} · {tokens.length}
              </dd>
            </div>
            <div>
              <dt>Issued today</dt>
              <dd>{tokens.issuedToday}</dd>
            </div>
          </dl>
          {tokens.recent.length > 0 && (
            <ul className="chips">
              {tokens.recent.map((entry) => (
                <li key={entry.token} className="chip">
                  #{entry.orderNumber} · <strong>{entry.token}</strong> · {String(entry.status).toLowerCase()}
                </li>
              ))}
            </ul>
          )}
          {tokens.preview.length > 0 && (
            <p className="muted">Preview: {tokens.preview.join(' · ')}</p>
          )}
        </Card>
      )}

      <Card title="System health">
        {health ? (
          <>
            <dl className="kv">
              <div>
                <dt>Environment</dt>
                <dd>
                  <Badge tone={health.environment === 'production' ? 'emerald' : 'slate'}>{health.environment}</Badge>
                </dd>
              </div>
              <div>
                <dt>Server time</dt>
                <dd>{new Date(health.time).toLocaleString()}</dd>
              </div>
            </dl>
            <div className="counts">
              {Object.entries(health.counts).map(([key, value]) => (
                <span key={key} className="counts__item">
                  <strong>{value}</strong>
                  <small>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</small>
                </span>
              ))}
            </div>
            <div className="row-actions">
              <Button variant="secondary" onClick={async () => {
                const result = await adminApi.syncCounters();
                toast.success(result.message);
                await load();
              }}>
                Recalculate counters
              </Button>
              <span className="muted">Useful after a manual database edit.</span>
            </div>
          </>
        ) : (
          <p className="muted">Health endpoint unavailable.</p>
        )}
      </Card>

      <Card title="Pricing note">
        <p className="muted">
          Every order total is recalculated on the server from the menu price at the moment of checkout, then {CURRENCY}
          {settings.taxPercent}% GST is applied. Prices sent by a browser are ignored entirely.
        </p>
      </Card>

      {qrOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__panel modal__panel--sm">
            <header className="modal__head">
              <h2>New QR code</h2>
              <button type="button" className="modal__close" onClick={() => setQrOpen(false)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="modal__body">
              <label className="field">
                <span className="field__label">Canteen</span>
                <select className="input select" value={qrDraft.canteen} onChange={(e) => setQrDraft({ ...qrDraft, canteen: e.target.value })}>
                  {canteens.map((canteen) => (
                    <option key={canteen.id} value={canteen.id}>
                      {canteen.name}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Code"
                value={qrDraft.code}
                onChange={(e) => setQrDraft({ ...qrDraft, code: e.target.value.toUpperCase() })}
                placeholder="TABLE_12"
                hint="Printed on the sticker. Keep it short and unique."
              />
              <Field label="Label" value={qrDraft.label} onChange={(e) => setQrDraft({ ...qrDraft, label: e.target.value })} placeholder="Table 12" />
              <div className="grid-2">
                <Field label="Block" value={qrDraft.block} onChange={(e) => setQrDraft({ ...qrDraft, block: e.target.value })} placeholder="A" />
                <Field label="Table hint" value={qrDraft.tableHint} onChange={(e) => setQrDraft({ ...qrDraft, tableHint: e.target.value })} placeholder="Near the window" />
              </div>
            </div>
            <footer className="modal__foot">
              <Button variant="ghost" onClick={() => setQrOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createQr} disabled={!qrDraft.code.trim() || !qrDraft.label.trim()}>
                Create code
              </Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}