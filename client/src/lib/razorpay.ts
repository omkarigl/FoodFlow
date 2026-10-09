import type { GatewayOrder } from '../types';

export interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void; on: (event: string, cb: () => void) => void };
  }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Loads the Razorpay checkout script once and resolves when it is ready. */
export function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true));
      existing.addEventListener('error', () => resolve(false));
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

export function openRazorpayCheckout(
  gateway: GatewayOrder,
  user: { name: string; email: string; phone?: string },
  onSuccess: (response: RazorpayResponse) => void,
  onDismiss?: () => void,
): Promise<'opened' | 'unavailable'> {
  const keyId = gateway.keyId;
  if (!keyId) return Promise.resolve('unavailable');
  return loadRazorpay().then((ready) => {
    if (!ready || !window.Razorpay) return 'unavailable' as const;
    const checkout = new window.Razorpay({
      key: keyId,
      order_id: gateway.gatewayOrderId,
      amount: Math.round(gateway.amount * 100),
      currency: gateway.currency || 'INR',
      name: 'FoodFlow',
      description: `Order ${gateway.gatewayOrderId}`,
      prefill: { name: user.name, email: user.email, contact: user.phone },
      theme: { color: '#2563EB' },
      handler: onSuccess,
      modal: { ondismiss: onDismiss },
    });
    checkout.open();
    return 'opened' as const;
  });
}