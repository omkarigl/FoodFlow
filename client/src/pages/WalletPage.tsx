import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, paymentApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorNote, Skeleton, StatCard } from '../components/ui';
import { CURRENCY, formatDate, formatMoney } from '../lib/format';
import { openRazorpayCheckout } from '../lib/razorpay';
import type { GatewayOrder, WalletSummary, WalletTransaction } from '../types';

const PRESETS = [100, 200, 500, 1000];

const REASON_LABELS: Record<string, string> = {
  GATEWAY_TOPUP: 'Top-up',
  ORDER_PAYMENT: 'Order payment',
  ORDER_REFUND: 'Order refund',
  ADMIN_CREDIT: 'Admin credit',
  ADMIN_DEBIT: 'Admin debit',
};

export function WalletPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const { subscribe } = useRealtime();

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [amount, setAmount] = useState(200);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<GatewayOrder | null>(null);
  const [provider, setProvider] = useState<'razorpay' | 'sandbox'>('razorpay');

  const load = useCallback(async () => {
    try {
      const [walletResult, list, config] = await Promise.all([
        paymentApi.wallet(),
        paymentApi.walletTransactions({ limit: 25 }),
        paymentApi.config(),
      ]);
      setWallet(walletResult.wallet);
      setTransactions(list.transactions);
      setProvider(config.provider);
      setPending(walletResult.wallet.pendingTopup ? { amount: walletResult.wallet.pendingTopup.amount, gatewayOrderId: walletResult.wallet.pendingTopup.gatewayOrderId, currency: config.currency, provider: config.provider } : null);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your wallet.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = subscribe((event) => {
      if (event.type === 'wallet:updated') void load();
    });
    return unsubscribe;
  }, [subscribe, load]);

  const startTopup = async () => {
    if (amount < 10 || amount > 10000) {
      toast.error('Top up between ₹10 and ₹10,000.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await paymentApi.walletTopup(amount);
      if (provider === 'sandbox') {
        setPending(result.gateway);
        setBusy(false);
        return;
      }

      const outcome = await openRazorpayCheckout(
        result.gateway,
        { name: user?.name ?? 'Student', email: user?.email ?? '', phone: user?.phone },
        async (response) => {
          try {
            const verified = await paymentApi.walletTopupVerify({
              gatewayOrderId: response.razorpay_order_id,
              gatewayPaymentId: response.razorpay_payment_id,
              gatewaySignature: response.razorpay_signature,
            });
            toast.success(verified.message);
            setPending(null);
            await load();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Top-up verification failed.');
          } finally {
            setBusy(false);
          }
        },
        () => setBusy(false),
      );

      if (outcome === 'unavailable') {
        setError('Razorpay checkout could not load. Try again once you are back online.');
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the top-up.');
      setBusy(false);
    }
  };

  const completeSandboxTopup = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const paid = await paymentApi.sandboxCheckout(pending.gatewayOrderId);
      const result = await paymentApi.walletTopupVerify({
        gatewayOrderId: pending.gatewayOrderId,
        gatewayPaymentId: paid.gatewayPaymentId,
        gatewaySignature: paid.gatewaySignature,
      });
      toast.success(result.message);
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Top-up failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={5} />;

  return (
    <div className="page__stack page__stack--narrow">
      <header className="page__head">
        <div>
          <h1 className="page__title">FoodFlow wallet</h1>
          <p className="page__sub">Top up once, then check out in a single tap.</p>
        </div>
      </header>

      {error && <ErrorNote message={error} onRetry={() => void load()} />}

      <div className="wallet-hero">
        <span className="wallet-hero__label">Available balance</span>
        <strong className="wallet-hero__amount">{formatMoney(wallet?.balance ?? 0)}</strong>
        <div className="wallet-hero__stats">
          <span>
            Added <strong>{formatMoney(wallet?.lifetimeCredited ?? 0)}</strong>
          </span>
          <span>
            Spent <strong>{formatMoney(wallet?.lifetimeDebited ?? 0)}</strong>
          </span>
          <span>
            Transactions <strong>{wallet?.transactionCount ?? 0}</strong>
          </span>
        </div>
      </div>

      <Card title="Top up" subtitle="Payments go through Razorpay and are verified server-side before any credit.">
        <div className="amounts">
          {PRESETS.map((preset) => (
            <button key={preset} type="button" className={`amount ${amount === preset ? 'is-active' : ''}`} onClick={() => setAmount(preset)}>
              {CURRENCY}
              {preset}
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">Custom amount</span>
          <input className="input" type="number" min={10} max={10000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        </label>

        {pending ? (
          <div className="alert alert--info">
            <div>
              <strong>Top-up of {formatMoney(pending.amount)} pending</strong>
              <p className="mono">{pending.gatewayOrderId}</p>
            </div>
            {provider === 'sandbox' ? (
              <Button size="sm" onClick={completeSandboxTopup} loading={busy}>
                Complete test payment
              </Button>
            ) : (
              <Button size="sm" onClick={startTopup} loading={busy}>
                Resume payment
              </Button>
            )}
          </div>
        ) : (
          <Button full onClick={startTopup} loading={busy}>
            Top up {formatMoney(amount)}
          </Button>
        )}
      </Card>

      <Card title="Transaction history">
        {transactions.length === 0 ? (
          <EmptyState title="No transactions yet" message="Top up or place an order and it shows up here." />
        ) : (
          <ul className="txn-list">
            {transactions.map((txn) => (
              <li key={txn.id} className="txn">
                <div className={`txn__icon txn__icon--${txn.type === 'CREDIT' ? 'in' : 'out'}`} aria-hidden="true">
                  {txn.type === 'CREDIT' ? '↓' : '↑'}
                </div>
                <div className="txn__body">
                  <strong>{REASON_LABELS[txn.reason] ?? txn.reason.replace(/_/g, ' ').toLowerCase()}</strong>
                  <small>
                    {formatDate(txn.createdAt)}
                    {txn.description ? ` · ${txn.description}` : ''}
                  </small>
                </div>
                <div className="txn__amount">
                  <strong className={txn.type === 'CREDIT' ? 'up' : 'down'}>
                    {txn.type === 'CREDIT' ? '+' : '−'}
                    {formatMoney(txn.amount).replace(CURRENCY, '')}
                  </strong>
                  <small>bal {formatMoney(txn.balanceAfter)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <StatCard label="Fast checkout" value="1 tap" hint="Wallet orders settle instantly and reach the kitchen with a token." tone="emerald" />

      <Button variant="ghost" onClick={() => navigate('/scan')}>
        Order something tasty
      </Button>
    </div>
  );
}