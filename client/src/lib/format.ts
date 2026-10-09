import type { OrderStatus } from '../types';

export const CURRENCY = '₹';

export function formatMoney(value: number | null | undefined): string {
  const amount = Number.isFinite(value ?? NaN) ? (value as number) : 0;
  return `${CURRENCY}${amount.toFixed(2).replace(/\.00$/, '')}`;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(value?: string | null): string {
  if (!value) return '--';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '--';
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export function minutesSince(value?: string | null): number {
  if (!value) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
}

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: string; step: number }> = {
  PENDING_PAYMENT: { label: 'Pending', tone: 'amber', step: 0 },
  PAID: { label: 'Paid', tone: 'emerald', step: 1 },
  ACCEPTED: { label: 'Accepted', tone: 'amber', step: 2 },
  PREPARING: { label: 'Preparing', tone: 'amber', step: 3 },
  READY: { label: 'Ready for pickup', tone: 'emerald', step: 4 },
  COMPLETED: { label: 'Completed', tone: 'slate', step: 5 },
  CANCELLED: { label: 'Cancelled', tone: 'rose', step: -1 },
  REJECTED: { label: 'Rejected', tone: 'rose', step: -1 },
};

export const KITCHEN_FLOW: OrderStatus[] = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED'];

export function statusLabel(status: OrderStatus): string {
  return ORDER_STATUS_META[status]?.label ?? status;
}

export function statusTone(status: OrderStatus): string {
  return ORDER_STATUS_META[status]?.tone ?? 'slate';
}

export function isTerminal(status: OrderStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'REJECTED';
}

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const index = KITCHEN_FLOW.indexOf(status);
  if (index === -1 || index === KITCHEN_FLOW.length - 1) return null;
  return KITCHEN_FLOW[index + 1];
}

export function actionLabel(status: OrderStatus): string {
  switch (nextStatus(status)) {
    case 'ACCEPTED':
      return 'Accept';
    case 'PREPARING':
      return 'Start preparing';
    case 'READY':
      return 'Mark ready';
    case 'COMPLETED':
      return 'Complete & pay out';
    default:
      return statusLabel(status);
  }
}

export function initials(name?: string): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

/** Reads the canteen/location pair out of a scanned QR payload. */
export function parseQrPayload(raw: string): { code: string } | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const code = url.searchParams.get('location') ?? url.searchParams.get('code') ?? url.pathname.replace(/^\/+/, '');
    return code ? { code } : null;
  } catch {
    return /^[A-Za-z0-9_-]{2,32}$/.test(value) ? { code: value } : null;
  }
}

export function buildQrUrl(code: string): string {
  return `${window.location.origin}/scan?location=${encodeURIComponent(code)}`;
}