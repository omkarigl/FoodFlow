import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ApiError, canteenApi } from '../lib/api';
import { useCart } from '../context/CartContext';
import { useRealtime } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { Card, Badge, Button, EmptyState, ErrorNote, Skeleton } from '../components/ui';
import type { Canteen, QRLocation } from '../types';

export function ScanPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { enter, canteen: activeCanteen } = useCart();
  const { subscribe } = useRealtime();

  const codeFromUrl = params.get('location') ?? '';
  const [manual, setManual] = useState('');
  const [locations, setLocations] = useState<QRLocation[]>([]);
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [scannerHint, setScannerHint] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [qr, status] = await Promise.all([canteenApi.qrLocations(), canteenApi.status()]);
        if (!active) return;
        setLocations(qr.locations);
        setCanteens(status.canteens);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Could not load canteen codes.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [subscribe]);

  const grouped = useMemo(() => {
    const map = new Map<string, QRLocation[]>();
    locations.forEach((location) => {
      const key = location.canteenName ?? location.canteen;
      map.set(key, [...(map.get(key) ?? []), location]);
    });
    return [...map.entries()];
  }, [locations]);

  const resolve = async (code: string) => {
    const clean = code.trim();
    if (!clean) {
      toast.error('Enter or scan a QR code first.');
      return;
    }
    setResolving(true);
    try {
      const result = await canteenApi.resolve(clean);
      enter(result.canteen, result.location, []);
      if (!result.canteen.canOrder) {
        toast.push(result.canteen.closedMessage ?? 'This canteen is not taking orders right now.', 'warn');
      }
      navigate(`/order?location=${encodeURIComponent(result.location.code)}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'That QR code could not be resolved.');
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (!codeFromUrl) return;
    setParams({}, { replace: true });
    void resolve(codeFromUrl);
    // Only react to a code handed over by the scanner deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl]);

  if (loading) {
    return (
      <div className="page__stack">
        <h1 className="page__title">Scan to order</h1>
        <Skeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="page__stack">
      <header className="page__head">
        <div>
          <h1 className="page__title">Scan to order</h1>
          <p className="page__sub">Point your camera at the QR code on the table or counter.</p>
        </div>
        {activeCanteen && (
          <Badge tone="emerald">
            Currently ordering from {activeCanteen.name}
          </Badge>
        )}
      </header>

      {error && <ErrorNote message={error} onRetry={() => window.location.reload()} />}

      <Card title="Enter a code" subtitle="Useful if the printed QR is smudged — codes look like PILLAR_01.">
        <form
          className="scan__manual"
          onSubmit={(e) => {
            e.preventDefault();
            void resolve(manual);
          }}
        >
          <input
            className="input"
            placeholder="PILLAR_01"
            value={manual}
            onChange={(e) => setManual(e.target.value.toUpperCase())}
            aria-label="QR code"
          />
          <Button type="submit" loading={resolving}>
            Find canteen
          </Button>
        </form>
        <button type="button" className="linkish" onClick={() => setScannerHint((v) => !v)}>
          {scannerHint ? 'Hide' : 'How does scanning work?'}
        </button>
        {scannerHint && (
          <ol className="scan__steps">
            <li>Open the camera through your browser's scan button on the printed code.</li>
            <li>Your browser hands the code back to FoodFlow as a link like <code>?location=PILLAR_01</code>.</li>
            <li>We resolve it server-side, pin your cart to that canteen and load the live menu.</li>
          </ol>
        )}
      </Card>

      <Card title="Canteens right now">
        {canteens.length === 0 ? (
          <EmptyState title="No canteens configured" message="Ask the FoodFlow admin to add a canteen." />
        ) : (
          <ul className="canteen-list">
            {canteens.map((canteen) => (
              <li key={canteen.id} className="canteen-list__item">
                <div>
                  <strong>{canteen.name}</strong>
                  <small>
                    {canteen.code} · {canteen.openingTime}–{canteen.closingTime}
                  </small>
                </div>
                <Badge tone={canteen.canOrder ? 'emerald' : 'rose'}>{canteen.canOrder ? 'Taking orders' : 'Closed'}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Table & counter codes" subtitle="Tap any code to jump straight into that canteen.">
        {grouped.length === 0 ? (
          <EmptyState title="No QR codes yet" message="The admin can generate codes from the settings page." />
        ) : (
          <div className="qr-grid">
            {grouped.map(([canteenName, codes]) => (
              <div key={canteenName} className="qr-grid__group">
                <h3 className="qr-grid__title">{canteenName}</h3>
                <div className="qr-grid__codes">
                  {codes.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      className="qr-code"
                      onClick={() => void resolve(location.code)}
                      disabled={resolving}
                    >
                      <QRCodeSVG value={`${window.location.origin}/scan?location=${location.code}`} size={92} level="M" marginSize={1} />
                      <span className="qr-code__code">{location.code}</span>
                      <span className="qr-code__label">{location.label}</span>
                      {location.tableHint && <span className="qr-code__hint">{location.tableHint}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}