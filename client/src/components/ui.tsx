import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { CURRENCY, initials, statusLabel, statusTone } from '../lib/format';
import type { Order, OrderStatus } from '../types';

/* ---------------------------------------------------------------- button */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'flame';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  full?: boolean;
}

export function Button({ variant = 'primary', size = 'md', loading, full, className = '', children, ...rest }: ButtonProps) {
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${full ? 'btn--full' : ''} ${className}`}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading && <span className="btn__spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- badge */
export function StatusBadge({ status }: { status: OrderStatus }) {
  return <span className={`badge badge--${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function Badge({ tone = 'slate', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/* ----------------------------------------------------------------- cards */
export function Card({
  title,
  subtitle,
  action,
  children,
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'card__body' : ''}>{children}</div>
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'slate',
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={`stat stat--${tone}`}>
      {icon && <div className="stat__icon">{icon}</div>}
      <div className="stat__body">
        <span className="stat__label">{label}</span>
        <strong className="stat__value">{value}</strong>
        {hint && <span className="stat__hint">{hint}</span>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- forms */
interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, id, className = '', ...rest }: FieldProps) {
  const inputId = id ?? rest.name;
  return (
    <label className={`field ${className}`} htmlFor={inputId}>
      {label && <span className="field__label">{label}</span>}
      <input id={inputId} className={`input ${error ? 'input--error' : ''}`} {...rest} />
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  error,
  id,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; hint?: string; error?: string }) {
  const inputId = id ?? rest.name;
  return (
    <label className="field" htmlFor={inputId}>
      {label && <span className="field__label">{label}</span>}
      <textarea id={inputId} className={`input textarea ${error ? 'input--error' : ''}`} rows={3} {...rest} />
      {error ? <span className="field__error">{error}</span> : hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

export function Select({
  label,
  hint,
  children,
  id,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }) {
  const inputId = id ?? rest.name;
  return (
    <label className="field" htmlFor={inputId}>
      {label && <span className="field__label">{label}</span>}
      <select id={inputId} className="input select" {...rest}>
        {children}
      </select>
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle ${disabled ? 'toggle--disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className="toggle__text">
        <span className="toggle__label">{label}</span>
        {hint && <span className="toggle__hint">{hint}</span>}
      </span>
    </label>
  );
}

/* --------------------------------------------------------------- avatars */
export function Avatar({ name, color }: { name?: string; color?: string }) {
  return (
    <span className="avatar" style={color ? { background: color } : undefined}>
      {initials(name)}
    </span>
  );
}

/* ----------------------------------------------------------------- misc */
export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      {message && <p className="empty__message">{message}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      <span className="spinner__label">{label}</span>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-wrap" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Money({ value }: { value: number }) {
  return <span className="money">{`${CURRENCY}${value.toFixed(2)}`}</span>;
}

/* ------------------------------------------------------------ order bits */
export function OrderToken({ token, size = 'md' }: { token: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`token token--${size}`}>{token}</span>;
}

export function OrderRow({ order, children }: { order: Order; children?: ReactNode }) {
  return (
    <article className="order-row">
      <div className="order-row__main">
        <div className="order-row__head">
          <OrderToken token={order.token} />
          <StatusBadge status={order.status} />
        </div>
        <p className="order-row__meta">
          #{order.orderNumber} · {order.canteenName ?? 'Canteen'}
          {order.qrLocationLabel ? ` · ${order.qrLocationLabel}` : ''}
        </p>
        <ul className="order-row__items">
          {order.items.map((line) => (
            <li key={line.menuItem}>
              <span>{line.quantity}×</span> {line.name}
            </li>
          ))}
        </ul>
      </div>
      {children && <div className="order-row__side">{children}</div>}
    </article>
  );
}