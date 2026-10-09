import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, guestClaimStore, orderApi, paymentApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, Spinner } from '../components/ui';
import { CURRENCY, formatMoney } from '../lib/format';
import { openRazorpayCheckout, type RazorpayResponse } from '../lib/razorpay';
import type { GatewayOrder, Order, WalletSummary } from '../types';

type Method = 'wallet' | 'razorpay';

interface PlacedOrder {
  order: Order;
  gateway: GatewayOrder | null;
  claim: string | null;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { canteen, location, lines, clear, subtotal, tax, total, taxPercent, count } = useCart();
  const locationState = useLocation();
  const placing = useRef(false);

  const [method, setMethod] = useState<Method>('razorpay');
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [provider, setProvider] = useState<'razorpay' | 'sandbox'>('razorpay');
  const [keyId, setKeyId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const note = (locationState.state as { note?: string } | null)?.note;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const config = await paymentApi.config();
        if (!active) return;
        setProvider(config.provider);
        setKeyId(config.keyId);
        if (user) {
          try {
            const walletResult = await paymentApi.wallet();
            if (!active) return;
            setWallet(walletResult.wallet);
            if (walletResult.wallet.balance >= total) setMethod('wallet');
          } catch {
            /* wallet optional — Razorpay still works */
          }
        }
      } catch {
        /* checkout still works with Razorpay only */
      }
    })();
    return () => {
      active = false;
    };
  }, [total, user]);

  if (!canteen || count === 0) {
    return (
      <div className="page__stack">
        <EmptyState title="Nothing to check out" message="Your cart is empty." action={<Button onClick={() => navigate('/scan')}>Back to scan</Button>} />
      </div>
    );
  }

  if (!location) {
    return (
      <div className="page__stack">
        <EmptyState
          title="Scan a QR code first"
          message="Orders need a table or counter code so the kitchen knows where you are."
          action={<Button onClick={() => navigate('/scan')}>Go to scanner</Button>}
        />
      </div>
    );
  }

  const goSuccess = (order: Order, claim: string | null) => {
    clear();
    const params = claim ? `?order=${order.id}&claim=${encodeURIComponent(claim)}` : `?order=${order.id}`;
    navigate(`/order-success${params}`, { replace: true, state: { order, claim } });
  };

  const place = async (selected: Method) => {
    // In-flight guard: no double order creation from double-clicks or retries.
    if (placing.current || busy) return;
    placing.current = true;
    setBusy(true);
    setError(null);
    try {
      let next: PlacedOrder;
      if (user) {
        const created = await orderApi.create({
          canteen: canteen.id,
          qrLocationCode: location.code,
          items: lines.map((line) => ({ menuItem: line.menuItem, quantity: line.quantity })),
          paymentMethod: selected,
          note,
        });
        next = { order: created.order, gateway: created.gateway, claim: null };
      } else {
        if (selected === 'wallet') throw new Error('Wallet is only available to signed-in students.');
        const created = await orderApi.createGuest({
          canteen: canteen.id,
          qrLocationCode: location.code,
          items: lines.map((line) => ({ menuItem: line.menuItem, quantity: line.quantity })),
          note,
        });
        next = { order: created.order, gateway: created.gateway, claim: created.guestClaimToken };
      }

      if (selected === 'wallet' || !next.gateway) {
        placing.current = false;
        goSuccess(next.order, next.claim);
        return;
      }

      setPlaced(next);
      setBusy(false);
      placing.current = false;

      if (provider === 'sandbox') return; // sandbox card below completes the payment.

      const gateway = { ...next.gateway, keyId: next.gateway.keyId ?? keyId ?? null };
      const outcome = await openRazorpayCheckout(
        gateway,
        { name: user?.name ?? 'Guest', email: user?.email ?? '', phone: user?.phone },
        (response) => void verify(next, response),
        () => {
          setBusy(false);
          placing.current = false;
        },
      );

      if (outcome === 'unavailable') {
        setError(
          user
            ? 'Razorpay checkout could not be loaded. Check your connection or try the wallet.'
            : 'Razorpay checkout could not be loaded. Check your connection and try again.',
        );
        setBusy(false);
        placing.current = false;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message || 'Checkout failed. Please try again.');
      setBusy(false);
      placing.current = false;
    }
  };

  const verify = async (next: PlacedOrder, response: RazorpayResponse) => {
    setBusy(true);
    try {
      const result = next.claim
        ? await paymentApi.guestVerify({
            orderId: next.order.id,
            guestClaimToken: next.claim,
            gatewayOrderId: response.razorpay_order_id,
            gatewayPaymentId: response.razorpay_payment_id,
            gatewaySignature: response.razorpay_signature,
          })
        : await paymentApi.verify({
            orderId: next.order.id,
            gatewayOrderId: response.razorpay_order_id,
            gatewayPaymentId: response.razorpay_payment_id,
            gatewaySignature: response.razorpay_signature,
          });
      toast.success('Payment verified — the kitchen has your order!');
      goSuccess(result.order, next.claim);
    } catch (err) {
      // Never claim success: verification is the only thing that marks an order paid.
      setError(err instanceof ApiError ? err.message : 'Payment verification failed.');
      setBusy(false);
    } finally {
      placing.current = false;
    }
  };

  const runSandbox = async () => {
    if (!placed?.gateway) return;
    if (placing.current) return;
    placing.current = true;
    setBusy(true);
    try {
      const paid = await paymentApi.sandboxCheckout(placed.gateway.gatewayOrderId);
      if (!paid.success) {
        setError(paid.message ?? 'Payment declined by the test gateway.');
        setBusy(false);
        placing.current = false;
        return;
      }
      await verify(placed, {
        razorpay_payment_id: paid.gatewayPaymentId,
        razorpay_order_id: placed.gateway.gatewayOrderId,
        razorpay_signature: paid.gatewaySignature,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sandbox checkout failed.');
      setBusy(false);
      placing.current = false;
    }
  };

  const discardPlaced = async () => {
    if (!placed) return;
    try {
      if (placed.claim) await orderApi.guestCancel(placed.order.id, placed.claim, 'Checkout abandoned');
      else await orderApi.cancel(placed.order.id, 'Checkout abandoned');
      toast.push('Order cancelled — nothing was charged.', 'info');
    } catch {
      /* nothing to undo */
    } finally {
      if (placed.claim) guestClaimStore.clear(placed.order.id);
      setPlaced(null);
      setBusy(false);
      placing.current = false;
    }
  };

  const walletEnough = (wallet?.balance ?? 0) >= total;

  return (
    <div className="checkout">
      <div className="checkout__main">
        <header className="page__head">
          <div>
            <h1 className="page__title">Checkout</h1>
            <p className="page__sub">
              {canteen.name} · {count} item{count > 1 ? 's' : ''}
              {!user && ' · ordering as guest'}
            </p>
          </div>
        </header>

        {error && <div className="alert alert--error">{error}</div>}

        {provider === 'sandbox' && !placed && (
          <div className="alert alert--info">
            Razorpay keys are not configured, so this build runs the local gateway emulator. It signs real payloads and exercises the exact same server
            verification path as production Razorpay.
          </div>
        )}

        <Card title="Items">
          <ul className="checkout__items">
            {lines.map((line) => (
              <li key={line.menuItem}>
                <span>
                  {line.quantity}× {line.name}
                </span>
                <span>{formatMoney(line.price * line.quantity)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {note && (
          <Card title="Note for the kitchen">
            <p className="muted">{note}</p>
          </Card>
        )}

        {!placed ? (
          <Card title="Payment method">
            <div className="methods">
              <button
                type="button"
                className={`method ${method === 'razorpay' ? 'is-active' : ''}`}
                onClick={() => setMethod('razorpay')}
              >
                <span className="method__body">
                  <strong>{provider === 'sandbox' ? 'Card / UPI (test gateway)' : 'Razorpay'}</strong>
                  <small>{provider === 'sandbox' ? 'Local emulator — no real money moves' : 'UPI, cards, netbanking and wallets'}</small>
                </span>
              </button>

              {user && (
                <button
                  type="button"
                  className={`method ${method === 'wallet' ? 'is-active' : ''}`}
                  onClick={() => setMethod('wallet')}
                  disabled={!wallet}
                >
                  <span className="method__body">
                    <strong>FoodFlow wallet</strong>
                    <small>
                      Balance {formatMoney(wallet?.balance ?? 0)}
                      {wallet && !walletEnough ? ' · not enough for this order' : ''}
                    </small>
                  </span>
                </button>
              )}
            </div>

            {method === 'wallet' && user && !walletEnough && (
              <Button variant="secondary" size="sm" onClick={() => navigate('/wallet')} className="checkout__topup">
                Top up wallet
              </Button>
            )}
            {!user && (
              <p className="muted">
                Ordering as a guest — <Button variant="ghost" size="sm" onClick={() => navigate('/register')}>create an account</Button> to track
                spending and use the wallet.
              </p>
            )}
          </Card>
        ) : (
          <Card title="Complete your payment">
            <p className="muted">
              Gateway order <code>{placed.gateway?.gatewayOrderId}</code> for {formatMoney(placed.gateway?.amount ?? 0)}.
            </p>
            <div className="checkout__actions">
              <Button onClick={runSandbox} loading={busy}>
                Pay {formatMoney(placed.gateway?.amount ?? 0)}
              </Button>
              <Button variant="ghost" onClick={() => void discardPlaced()}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </div>

      <aside className="checkout__summary">
        <Card title="Order summary">
          <dl className="bill">
            <div>
              <dt>Items</dt>
              <dd>{formatMoney(subtotal)}</dd>
            </div>
            <div>
              <dt>
                {taxPercent}% tax
              </dt>
              <dd>{formatMoney(tax)}</dd>
            </div>
            <div className="bill__total">
              <dt>Total</dt>
              <dd>{formatMoney(total)}</dd>
            </div>
          </dl>
          {method === 'wallet' && wallet && user && (
            <p className="muted checkout__balance">
              Wallet after payment: {formatMoney(Math.max(0, wallet.balance - total))}
            </p>
          )}
          {!placed && (
            <Button variant="flame" full size="lg" loading={busy} disabled={!canteen.canOrder || (method === 'wallet' && !walletEnough)} onClick={() => void place(method)}>
              {method === 'wallet' ? `Pay ${CURRENCY}${total.toFixed(2)} from wallet` : `Pay ${CURRENCY}${total.toFixed(2)}`}
            </Button>
          )}
          <button type="button" className="linkish checkout__back" onClick={() => navigate('/cart')}>
            Edit cart
          </button>
        </Card>
      </aside>

      {busy && !placed && provider === 'razorpay' && <Spinner label="Waiting for the gateway…" />}
    </div>
  );
}
