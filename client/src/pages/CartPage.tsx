import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, TextArea } from '../components/ui';
import { CURRENCY } from '../lib/format';

export function CartPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { canteen, location, lines, setQuantity, remove, clear, subtotal, tax, total, count, taxPercent, validate } = useCart();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);

  if (!canteen || count === 0) {
    return (
      <div className="page__stack">
        <EmptyState
          title="Your cart is empty"
          message="Scan a canteen QR code and add a few dishes to get started."
          action={<Button onClick={() => navigate('/scan')}>Find a canteen</Button>}
        />
      </div>
    );
  }

  const goToCheckout = async () => {
    setBusy(true);
    const result = await validate();
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues.length ? result.issues : ['Some items need attention before checkout.']);
      toast.error('Cart needs attention.');
      return;
    }
    setIssues([]);
    navigate('/checkout', { state: { note } });
  };

  return (
    <div className="cart">
      <div className="cart__main">
        <header className="page__head">
          <div>
            <h1 className="page__title">Your cart</h1>
            <p className="page__sub">
              {canteen.name}
              {location ? ` · ${location.label} (${location.code})` : ''}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </header>

        {issues.length > 0 && (
          <div className="alert alert--error">
            <strong>Before you continue</strong>
            <ul>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        <Card padded={false}>
          <ul className="cart-list">
            {lines.map((line) => (
              <li key={line.menuItem} className="cart-line">
                <div className="cart-line__icon" aria-hidden="true">
                  {line.emoji ?? ''}
                </div>
                <div className="cart-line__body">
                  <strong>{line.name}</strong>
                  <small>
                    {CURRENCY}
                    {line.price} each
                    {line.trackStock && line.stock !== null ? ` · ${line.stock} in stock` : ''}
                  </small>
                </div>
                <div className="stepper">
                  <button type="button" onClick={() => setQuantity(line.menuItem, line.quantity - 1)} aria-label={`Remove one ${line.name}`}>
                    −
                  </button>
                  <span>{line.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(line.menuItem, line.quantity + 1)}
                    aria-label={`Add one ${line.name}`}
                    disabled={line.trackStock && line.quantity >= (line.stock ?? 0)}
                  >
                    +
                  </button>
                </div>
                <span className="cart-line__total">
                  {CURRENCY}
                  {(line.price * line.quantity).toFixed(2)}
                </span>
                <button type="button" className="cart-line__remove" onClick={() => remove(line.menuItem)} aria-label={`Remove ${line.name}`}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Order note (optional)">
          <TextArea
            placeholder="Less spicy, no onion, extra chutney…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            hint="The kitchen sees this on the order screen."
          />
        </Card>
      </div>

      <aside className="cart__summary">
        <Card title="Bill summary">
          <dl className="bill">
            <div>
              <dt>Item total</dt>
              <dd>
                {CURRENCY}
                {subtotal.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt>GST ({taxPercent}%)</dt>
              <dd>
                {CURRENCY}
                {tax.toFixed(2)}
              </dd>
            </div>
            <div className="bill__total">
              <dt>To pay</dt>
              <dd>
                {CURRENCY}
                {total.toFixed(2)}
              </dd>
            </div>
          </dl>
          <Button variant="flame" full size="lg" onClick={goToCheckout} loading={busy} disabled={!canteen.canOrder}>
            {canteen.canOrder ? 'Proceed to checkout' : 'Canteen closed'}
          </Button>
          <p className="cart__note">Prices are confirmed by the server at checkout.</p>
        </Card>
      </aside>
    </div>
  );
}