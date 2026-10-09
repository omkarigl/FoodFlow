import type { Order } from '../types';

const STORE_KEY = 'foodflow.receipt';

interface ReceiptRecord {
  order: Order;
  printedAt: string;
}

/** Stores the receipt so a print from another tab/window still has the full order. */
export function saveReceipt(order: Order): void {
  try {
    const record: ReceiptRecord = { order, printedAt: new Date().toISOString() };
    sessionStorage.setItem(STORE_KEY, JSON.stringify(record));
    localStorage.setItem(STORE_KEY, JSON.stringify(record));
  } catch {
    // Private browsing modes can block storage; the print window still works.
  }
}

export function loadReceipt(): ReceiptRecord | null {
  try {
    const raw = localStorage.getItem(STORE_KEY) ?? sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as ReceiptRecord) : null;
  } catch {
    return null;
  }
}

export function clearReceipt(): void {
  try {
    localStorage.removeItem(STORE_KEY);
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* nothing to clean up */
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

function receiptHtml(order: Order): string {
  const placed = new Date(order.placedAt);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>FoodFlow receipt #${order.orderNumber}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 16px; color: #111; }
      .sheet { width: 302px; margin: 0 auto; }
      header { text-align: center; border-bottom: 1px dashed #999; padding-bottom: 10px; }
      h1 { font-size: 20px; margin: 0 0 4px; }
      .muted { color: #555; font-size: 12px; }
      .token { margin: 12px 0; text-align: center; border: 2px solid #111; padding: 8px; border-radius: 8px; }
      .token span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
      .token strong { font-size: 28px; letter-spacing: .18em; }
      table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px; }
      th, td { padding: 4px 0; text-align: left; }
      th:last-child, td:last-child { text-align: right; }
      .rule { border-top: 1px dashed #999; }
      tfoot td { font-weight: 700; padding-top: 8px; }
      footer { text-align: center; font-size: 11px; color: #555; border-top: 1px dashed #999; padding-top: 10px; margin-top: 8px; }
      @media print { body { padding: 0; } }
    </style>
  </head>
  <body>
    <div class="sheet">
      <header>
        <h1>FoodFlow</h1>
        <div class="muted">${escapeHtml(order.canteenName ?? 'Campus canteen')}</div>
        <div class="muted">${escapeHtml(order.qrLocationLabel ?? '')} ${escapeHtml(order.qrLocationCode ?? '')}</div>
      </header>

      <div class="token">
        <span>Pickup token</span>
        <strong>${escapeHtml(order.token)}</strong>
      </div>

      <table>
        <tbody>
          <tr><td class="muted">Order</td><td class="muted">#${order.orderNumber}</td></tr>
          <tr><td class="muted">Placed</td><td class="muted">${placed.toLocaleString()}</td></tr>
          <tr><td class="muted">Status</td><td class="muted">${escapeHtml(order.status)}</td></tr>
          <tr><td class="muted">Payment</td><td class="muted">${escapeHtml(order.payment.method)} · ${escapeHtml(order.payment.status)}</td></tr>
        </tbody>
      </table>

      <table>
        <thead>
          <tr><th>Item</th><th>Qty</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${order.items
            .map(
              (line) =>
                `<tr><td>${escapeHtml(line.name)}</td><td>${line.quantity}</td><td>₹${line.lineTotal.toFixed(2)}</td></tr>`,
            )
            .join('')}
        </tbody>
        <tfoot>
          <tr class="rule"><td colspan="2">Subtotal</td><td>₹${order.subtotal.toFixed(2)}</td></tr>
          <tr><td colspan="2">GST</td><td>₹${order.tax.toFixed(2)}</td></tr>
          <tr><td colspan="2">Total</td><td>₹${order.total.toFixed(2)}</td></tr>
        </tfoot>
      </table>

      ${order.note ? `<p class="muted">Note: ${escapeHtml(order.note)}</p>` : ''}

      <footer>
        ${order.payment.gatewayPaymentId ? `Ref ${escapeHtml(order.payment.gatewayPaymentId)}<br/>` : ''}
        Thank you for ordering with FoodFlow.
      </footer>
    </div>
    <script>window.addEventListener('load', function () { window.print(); window.addEventListener('afterprint', function () { window.close(); }); });</script>
  </body>
</html>`;
}

/**
 * Opens a dedicated 80mm-friendly print window with the receipt.
 * Works with the browser's "Save as PDF" and with any installed Epson/thermal printer.
 */
export function printReceipt(order: Order): void {
  saveReceipt(order);
  const win = window.open('', '_blank', 'width=380,height=720');
  if (!win) return;
  win.document.write(receiptHtml(order));
  win.document.close();
}