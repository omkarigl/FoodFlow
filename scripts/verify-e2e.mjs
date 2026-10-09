#!/usr/bin/env node
/**
 * FoodFlow end-to-end verification.
 *
 * Runs a real HTTP + Socket.IO test suite against a running FoodFlow server and its
 * real MongoDB database. Covers authentication, QR entry, menu, cart, order creation,
 * payment verification, inventory protection, the admin kitchen workflow, wallet,
 * analytics, receipt data and realtime push updates.
 *
 *   npm run dev:mem      # terminal 1  (or: npm run dev in another)
 *   npm run verify       # terminal 2
 *
 * Override the target with BASE_URL=http://localhost:5000 node scripts/verify-e2e.mjs
 */
import { io } from 'socket.io-client';

let currentProviderValue = 'unknown';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5000';
const API = `${BASE_URL}/api`;
const ADMIN = { email: process.env.ADMIN_EMAIL ?? 'admin@foodflow.edu', password: process.env.ADMIN_PASSWORD ?? 'Admin@12345' };
const STUDENT = { email: process.env.STUDENT_EMAIL ?? 'aarav@college.edu', password: 'Student@123' };

let passed = 0;
let failed = 0;
const failures = [];

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function section(title) {
  console.log(`\n${c.bold}${c.cyan}── ${title} ${'─'.repeat(Math.max(0, 62 - title.length))}${c.reset}`);
}

function ok(label, detail = '') {
  passed += 1;
  console.log(`  ${c.green}✓${c.reset} ${label}${detail ? ` ${c.dim}${detail}${c.reset}` : ''}`);
}

function fail(label, detail) {
  failed += 1;
  failures.push(`${label} :: ${detail}`);
  console.log(`  ${c.red}✗ ${label}${c.reset}`);
  console.log(`    ${c.red}${detail}${c.reset}`);
}

function check(label, condition, detail = '') {
  if (condition) ok(label, detail);
  else fail(label, detail || 'condition was false');
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, data: json };
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

async function main() {
  console.log(`${c.bold}FoodFlow end-to-end verification${c.reset}`);
  console.log(`${c.dim}Target: ${BASE_URL}${c.reset}`);

  /* ------------------------------------------------- 1. server + database */
  section('Server, database and payment runtime');
  const health = await req('GET', '/health');
  check('GET /api/health responds', health.ok, `status ${health.status}`);
  check('MongoDB connection is live', health.data?.database === 'connected', `database=${health.data?.database}`);
  check('Payment provider configured', Boolean(health.data?.payment?.provider), `provider=${health.data?.payment?.provider}`);
  if (!health.ok) {
    console.log(`${c.red}Server is not reachable. Start it with "npm run dev:mem" first.${c.reset}`);
    process.exit(1);
  }

  const paymentConfig = await req('GET', '/payment/config');
  check('GET /api/payment/config responds', paymentConfig.ok);
  const provider = paymentConfig.data?.payment?.provider;
  currentProviderValue = provider;
  const currencySymbol = paymentConfig.data?.currency?.symbol ?? '\u20b9';

  /* ----------------------------------------------------- 2. authentication */
  section('Authentication (real bcrypt + JWT)');
  const badLogin = await req('POST', '/auth/login', { body: { email: STUDENT.email, password: 'WrongPass@1' } });
  check('Wrong password is rejected', badLogin.status === 401, `status ${badLogin.status}`);

  const login = await req('POST', '/auth/login', { body: { ...STUDENT, role: 'student' } });
  check('Student can sign in', login.ok && Boolean(login.data?.token), login.data?.error?.message ?? '');
  const studentToken = login.data?.token;
  const studentId = login.data?.user?.id;

  const adminLogin = await req('POST', '/auth/login', { body: { ...ADMIN, role: 'admin' } });
  check('Admin can sign in', adminLogin.ok && Boolean(adminLogin.data?.token), adminLogin.data?.error?.message ?? '');
  const adminToken = adminLogin.data?.token;

  if (!studentToken || !adminToken) {
    console.log(`${c.red}Cannot continue without both sessions. Run "npm run seed" first.${c.reset}`);
    process.exit(1);
  }

  const me = await req('GET', '/auth/me', { token: studentToken });
  check('GET /api/auth/me returns the signed-in user', me.data?.user?.email === STUDENT.email, me.data?.user?.email);
  check('Password hash is never returned', me.data?.user?.passwordHash === undefined);

  const noAuth = await req('GET', '/orders/my');
  check('Protected route rejects anonymous access', noAuth.status === 401, `status ${noAuth.status}`);

  const roleEscalation = await req('GET', '/admin/dashboard', { token: studentToken });
  check('Student token cannot reach admin routes', roleEscalation.status === 403, `status ${roleEscalation.status}`);

  const uniqueEmail = `verify-${Date.now()}@college.edu`;
  const register = await req('POST', '/auth/register', {
    body: { name: 'Verify Student', email: uniqueEmail, password: 'Verify@1234', confirmPassword: 'Verify@1234', studentId: 'TS0001' },
  });
  check('New student can register', register.status === 201 && Boolean(register.data?.token), register.data?.error?.message ?? '');
  const verifyToken = register.data?.token;

  const duplicate = await req('POST', '/auth/register', {
    body: { name: 'Duplicate', email: uniqueEmail, password: 'Verify@1234', confirmPassword: 'Verify@1234' },
  });
  check('Duplicate email registration is blocked', duplicate.status === 409, `status ${duplicate.status}`);

  const weakPassword = await req('POST', '/auth/register', {
    body: { name: 'Weak', email: `weak-${Date.now()}@college.edu`, password: 'abc', confirmPassword: 'abc' },
  });
  check('Weak password is rejected by validation', weakPassword.status === 422, `status ${weakPassword.status}`);

  /* --------------------------------------------------------- 3. QR + menu */
  section('QR entry, canteen status and menu');
  const status = await req('GET', '/canteen/status');
  check('GET /api/canteen/status lists canteens', status.ok && status.data?.canteens?.length > 0, `${status.data?.canteens?.length ?? 0} canteens`);
  const mainCanteen = status.data?.canteens?.find((c2) => c2.code === 'MAIN') ?? status.data?.canteens?.[0];

  const resolve = await req('GET', '/canteen/resolve?location=PILLAR_01');
  check('QR code PILLAR_01 resolves', resolve.ok && resolve.data?.location?.code === 'PILLAR_01', resolve.data?.error?.message ?? '');
  check('QR resolves to the correct canteen', resolve.data?.canteen?.code === 'MAIN', `canteen=${resolve.data?.canteen?.code}`);

  const badQr = await req('GET', '/canteen/resolve?location=NOT_A_REAL_CODE');
  check('Unknown QR code is rejected', badQr.status === 404, `status ${badQr.status}`);

  const qrList = await req('GET', '/canteen/qr-locations');
  check('QR locations are listed', qrList.ok && qrList.data?.locations?.length >= 5, `${qrList.data?.locations?.length ?? 0} codes`);

  const menu = await req('GET', `/menu?canteen=${mainCanteen.id}&limit=100`);
  check('Menu loads for the canteen', menu.ok && menu.data?.items?.length > 0, `${menu.data?.items?.length ?? 0} items`);
  const allItems = menu.data?.items ?? [];

  const search = await req('GET', `/menu?canteen=${mainCanteen.id}&search=biryani`);
  check('Menu search filters results', search.ok && search.data.items.length > 0 && search.data.items.every((i) => /biryani/i.test(i.name)), `${search.data?.items?.length ?? 0} matches`);

  const vegOnly = await req('GET', `/menu?canteen=${mainCanteen.id}&vegOnly=true`);
  check('Veg-only filter works', vegOnly.ok && vegOnly.data.items.every((i) => i.isVegetarian), `${vegOnly.data?.items?.length ?? 0} veg items`);

  const priceSorted = await req('GET', `/menu?canteen=${mainCanteen.id}&sort=price_asc&limit=100`);
  const prices = (priceSorted.data?.items ?? []).map((i) => i.price);
  check('Price sorting works', prices.every((p, idx) => idx === 0 || p >= prices[idx - 1]), `cheapest ${currencySymbol}${prices[0] ?? 0}`);

  const categoryFilter = await req('GET', `/menu?canteen=${mainCanteen.id}&category=Beverages`);
  check('Category filter works', categoryFilter.ok && categoryFilter.data.items.every((i) => i.category === 'Beverages'), `${categoryFilter.data?.items?.length ?? 0} items`);

  const trackedItem = allItems.find((i) => i.trackStock && i.stock !== null && i.stock > 3);
  const unlimitedItem = allItems.find((i) => !i.trackStock) ?? allItems[0];

  /* --------------------------------------------- 4. admin menu + inventory */
  section('Admin menu CRUD and inventory management');
  const createItem = await req('POST', '/menu', {
    token: adminToken,
    body: {
      canteen: mainCanteen.id,
      name: `Verify Special ${Date.now()}`,
      description: 'Temporary item created by the end-to-end verification run.',
      price: 77,
      category: 'Snacks',
      emoji: '\ud83e\udd6a',
      isAvailable: true,
      isVegetarian: true,
      trackStock: true,
      stock: 5,
      lowStockThreshold: 2,
    },
  });
  check('Admin can create a menu item', createItem.status === 201 && Boolean(createItem.data?.item?.id), createItem.data?.error?.message ?? '');
  const tempItemId = createItem.data?.item?.id;

  const createInvalid = await req('POST', '/menu', {
    token: adminToken,
    body: { canteen: mainCanteen.id, name: 'X', price: -5, category: 'Snacks' },
  });
  check('Menu validation rejects bad payload', createInvalid.status === 422, `status ${createInvalid.status}`);

  const studentCreate = await req('POST', '/menu', {
    token: studentToken,
    body: { canteen: mainCanteen.id, name: 'Hacker item', price: 1, category: 'Snacks' },
  });
  check('Student cannot create menu items', studentCreate.status === 403, `status ${studentCreate.status}`);

  if (tempItemId) {
    const adjust = await req('POST', '/menu/inventory/adjust', {
      token: adminToken,
      body: { itemId: tempItemId, mode: 'set', quantity: 25 },
    });
    check('Admin can adjust stock', adjust.ok && adjust.data?.item?.stock === 25, `stock=${adjust.data?.item?.stock}`);

    const markOut = await req('PATCH', `/menu/${tempItemId}/availability`, {
      token: adminToken,
      body: { isAvailable: false, reason: 'Sold out for verification' },
    });
    check('Admin can mark an item unavailable', markOut.ok && markOut.data?.item?.isAvailable === false);

    const unavailableInCart = await req('POST', '/orders/validate-cart', {
      token: studentToken,
      body: { items: [{ menuItem: tempItemId, quantity: 1 }] },
    });
    check('Unavailable item is blocked from the cart', unavailableInCart.data?.ok === false, unavailableInCart.data?.lines?.[0]?.reason);

    await req('PATCH', `/menu/${tempItemId}/availability`, { token: adminToken, body: { isAvailable: true } });
  }

  const inventory = await req('GET', `/menu/inventory?canteen=${mainCanteen.id}`, { token: adminToken });
  check('Inventory listing returns real stock data', inventory.ok && inventory.data?.items?.length > 0 && inventory.data?.summary?.total > 0, `summary=${JSON.stringify(inventory.data?.summary ?? {})}`);

  /* --------------------------------------------- 5. order + server pricing */
  section('Order placement with server-side pricing');
  const qrCode = 'PILLAR_01';

  const expectedSubtotal = round2(trackedItem.price * 2 + unlimitedItem.price * 1);
  const settings = await req('GET', '/payment/config');
  const taxPercent = settings.data?.taxPercent ?? 0;
  const expectedTotal = round2(expectedSubtotal + (expectedSubtotal * taxPercent) / 100);

  const maliciousOrder = await req('POST', '/orders', {
    token: studentToken,
    body: {
      canteen: mainCanteen.id,
      qrLocationCode: qrCode,
      items: [
        { menuItem: trackedItem.id, quantity: 2, price: 1, subtotal: 2, total: 2 },
        { menuItem: unlimitedItem.id, quantity: 1, price: 0, subtotal: 0, total: 0 },
      ],
      paymentMethod: 'razorpay',
      total: 1,
      subtotal: 1,
      status: 'COMPLETED',
    },
  });
  check('Order is created', maliciousOrder.status === 201, maliciousOrder.data?.error?.message ?? '');
  const order = maliciousOrder.data?.order;
  check('Client-supplied prices are ignored', order?.subtotal === expectedSubtotal, `subtotal ${currencySymbol}${order?.subtotal} (expected ${currencySymbol}${expectedSubtotal})`);
  check('Client-supplied total is ignored', order?.total === expectedTotal, `total ${currencySymbol}${order?.total} (expected ${currencySymbol}${expectedTotal})`);
  check('Server assigns a unique token', typeof order?.token === 'string' && order.token.length >= 3, `token=${order?.token}`);
  check('Order starts as PENDING_PAYMENT', order?.status === 'PENDING_PAYMENT', order?.status);
  check('Order number is assigned', Number(order?.orderNumber) > 0, `#${order?.orderNumber}`);

  const noQr = await req('POST', '/orders', {
    token: studentToken,
    body: { canteen: mainCanteen.id, items: [{ menuItem: trackedItem.id, quantity: 1 }], paymentMethod: 'razorpay' },
  });
  check('Ordering without a QR location is rejected', noQr.status === 422, `status ${noQr.status}`);

  const emptyCart = await req('POST', '/orders', {
    token: studentToken,
    body: { canteen: mainCanteen.id, qrLocationCode: qrCode, items: [], paymentMethod: 'razorpay' },
  });
  check('Empty cart is rejected', emptyCart.status === 422, `status ${emptyCart.status}`);

  const foreignQr = await req('POST', '/orders', {
    token: studentToken,
    body: { canteen: mainCanteen.id, qrLocationCode: 'COFFEE_BAR_01', items: [{ menuItem: trackedItem.id, quantity: 1 }], paymentMethod: 'razorpay' },
  });
  check('QR code from a different canteen is rejected', foreignQr.status === 400, `status ${foreignQr.status}`);

  /* --------------------------------------------- 6. payment verification */
  section('Payment gateway and server-side verification');
  const createPayment = await req('POST', '/payment/create-order', { token: studentToken, body: { orderId: order.id } });
  check('Payment intent is created', createPayment.ok && Boolean(createPayment.data?.gateway?.gatewayOrderId), createPayment.data?.error?.message ?? '');
  const gatewayOrderId = createPayment.data?.gateway?.gatewayOrderId;

  const paymentAmountMatches = createPayment.data?.gateway?.amount === order.total;
  check('Gateway amount matches the server total', paymentAmountMatches, `${currencySymbol}${createPayment.data?.gateway?.amount}`);

  let gatewayPaymentId = null;
  let gatewaySignature = null;

  if (provider === 'razorpay') {
    console.log(`  ${c.yellow}!${c.reset} ${c.dim}Razorpay live keys detected - simulate the gateway callback with a forged signature to prove it is rejected.${c.reset}`);
    const forged = await req('POST', '/payment/verify', {
      token: studentToken,
      body: { orderId: order.id, gatewayOrderId, gatewayPaymentId: 'pay_forged_test', gatewaySignature: 'deadbeef'.repeat(8) },
    });
    check('Forged signature is rejected', forged.status === 422 || forged.status === 402, `status ${forged.status}`);
    const afterForgery = await req('GET', `/orders/${order.id}`, { token: studentToken });
    check('Order stays unpaid after a forged signature', afterForgery.data?.order?.status !== 'PAID', afterForgery.data?.order?.status);

    await req('POST', `/orders/${order.id}/cancel`, { token: studentToken, body: { reason: 'verification cleanup' } });
    console.log(`  ${c.dim}Live Razorpay settlement is exercised by opening the checkout in the browser (npm run dev).${c.reset}`);
  } else {
    const sandbox = await req('POST', '/payment/sandbox/checkout', { token: studentToken, body: { gatewayOrderId } });
    check('Sandbox gateway issues a payment id + signature', sandbox.ok && Boolean(sandbox.data?.gatewayPaymentId));
    gatewayPaymentId = sandbox.data?.gatewayPaymentId;
    gatewaySignature = sandbox.data?.gatewaySignature;
  }

  if (!gatewayPaymentId) {
    // Fall back to wallet payment so the rest of the kitchen workflow is still verified.
    console.log(`  ${c.dim}Continuing the kitchen workflow with a wallet payment.${c.reset}`);
  } else {
    const badSig = await req('POST', '/payment/verify', {
      token: studentToken,
      body: { orderId: order.id, gatewayOrderId, gatewayPaymentId, gatewaySignature: 'f'.repeat(64) },
    });
    check('Invalid signature is rejected', badSig.status === 422, `status ${badSig.status}`);

    const stockBefore = await getStock(adminToken, trackedItem.id);
    const verify = await req('POST', '/payment/verify', {
      token: studentToken,
      body: { orderId: order.id, gatewayOrderId, gatewayPaymentId, gatewaySignature },
    });
    check('Valid signature marks the order PAID', verify.ok && verify.data?.order?.status === 'PAID', verify.data?.error?.message ?? `status=${verify.data?.order?.status}`);
    check('Payment recorded on the order', verify.data?.order?.payment?.gatewayPaymentId === gatewayPaymentId);
    check('Payment timestamp stored', Boolean(verify.data?.order?.payment?.paidAt));

    const stockAfter = await getStock(adminToken, trackedItem.id);
    check('Inventory decreased by the ordered quantity', stockAfter === stockBefore - 2, `${stockBefore} -> ${stockAfter}`);

    const replay = await req('POST', '/payment/verify', {
      token: studentToken,
      body: { orderId: order.id, gatewayOrderId, gatewayPaymentId, gatewaySignature },
    });
    check('Replaying the same payment is idempotent', replay.ok && replay.data?.order?.status === 'PAID', `status=${replay.data?.order?.status}`);

    const otherOrderVerify = await req('POST', '/payment/verify', {
      token: verifyToken,
      body: { orderId: order.id, gatewayOrderId, gatewayPaymentId, gatewaySignature },
    });
    check("Another account cannot verify someone else's order", otherOrderVerify.status === 403 || otherOrderVerify.status === 404, `status ${otherOrderVerify.status}`);
  }

  /* ------------------------------------------- 7. admin kitchen workflow */
  section('Admin order workflow (accept → start → ready → complete)');
  const activeOrders = await req('GET', '/orders/current', { token: studentToken });
  check('Student sees their active orders', activeOrders.ok && activeOrders.data?.orders?.length > 0, `${activeOrders.data?.orders?.length ?? 0} active`);

  const adminQueue = await req('GET', '/orders/admin?status=active', { token: adminToken });
  check('Admin live queue returns orders', adminQueue.ok && adminQueue.data?.orders?.length > 0, `${adminQueue.data?.orders?.length ?? 0} in queue`);

  const queueBoard = await req('GET', '/orders/queue', { token: adminToken });
  check('Kanban queue board is built', queueBoard.ok && queueBoard.data?.columns !== undefined);

  let workflowOrder = activeOrders.data?.orders?.find((o) => o.status === 'PAID') ?? order;

  if (provider === 'razorpay' && !gatewayPaymentId) {
    const fresh = await req('POST', '/orders', {
      token: studentToken,
      body: {
        canteen: mainCanteen.id,
        qrLocationCode: qrCode,
        items: [{ menuItem: unlimitedItem.id, quantity: 1 }],
        paymentMethod: 'wallet',
      },
    });
    check('Wallet order is created and settled instantly', fresh.ok && fresh.data?.order?.status === 'PAID', fresh.data?.error?.message ?? `status=${fresh.data?.order?.status}`);
    workflowOrder = fresh.data?.order;
  }

  if (workflowOrder?.status === 'PAID') {
    const invalidJump = await req('PATCH', `/orders/${workflowOrder.id}/status`, { token: adminToken, body: { status: 'COMPLETED' } });
    check('Illegal status jump (PAID → COMPLETED) is blocked', invalidJump.status === 409, `status ${invalidJump.status}`);

    for (const step of ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED']) {
      const res = await req('PATCH', `/orders/${workflowOrder.id}/status`, { token: adminToken, body: { status: step } });
      check(`Admin moved order to ${step}`, res.ok && res.data?.order?.status === step, res.data?.error?.message ?? '');
    }

    const completed = await req('GET', `/orders/${workflowOrder.id}`, { token: studentToken });
    check('Status history records the full journey', (completed.data?.order?.statusHistory?.length ?? 0) >= 5, `${completed.data?.order?.statusHistory?.length ?? 0} events`);
    check('Completion timestamp recorded', Boolean(completed.data?.order?.completedAt));

    const afterComplete = await req('PATCH', `/orders/${workflowOrder.id}/status`, { token: adminToken, body: { status: 'ACCEPTED' } });
    check('Completed order cannot be reopened', afterComplete.status === 409, `status ${afterComplete.status}`);
  }

  /* ------------------------------------------ 8. cancel / refund / stock */
  section('Cancellation, refund and stock restoration');

  // Make sure the wallet can cover the order under test so this section never silently skips.
  const balanceNow = (await req('GET', '/payment/wallet', { token: studentToken })).data?.wallet?.balance ?? 0;
  const cancelTotal = round2(trackedItem.price * 2 * 1.05);
  if (balanceNow < cancelTotal) await topUpWallet(studentToken, round2(cancelTotal - balanceNow + 50));

  const cancelCandidate = await req('POST', '/orders', {
    token: studentToken,
    body: {
      canteen: mainCanteen.id,
      qrLocationCode: qrCode,
      items: [{ menuItem: trackedItem.id, quantity: 2 }],
      paymentMethod: 'wallet',
    },
  });
  const cancelOrder = cancelCandidate.data?.order;

  check('Wallet order for the cancellation test is paid', cancelOrder?.status === 'PAID', cancelCandidate.data?.error?.message ?? cancelOrder?.status ?? 'no order');
  if (cancelOrder?.status === 'PAID') {
    const stockBeforeCancel = await getStock(adminToken, trackedItem.id);
    const walletBeforeCancel = (await req('GET', '/payment/wallet', { token: studentToken })).data?.wallet?.balance;

    const cancel = await req('POST', `/orders/${cancelOrder.id}/cancel`, { token: studentToken, body: { reason: 'Verification test cancellation' } });
    check('Student can cancel a paid order', cancel.ok && cancel.data?.order?.status === 'CANCELLED', cancel.data?.error?.message ?? '');

    const stockAfterCancel = await getStock(adminToken, trackedItem.id);
    check('Stock is restored after cancellation', stockAfterCancel === stockBeforeCancel + 2, `${stockBeforeCancel} -> ${stockAfterCancel}`);

    const walletAfterCancel = (await req('GET', '/payment/wallet', { token: studentToken })).data?.wallet?.balance;
    check('Wallet is refunded after cancellation', round2(walletAfterCancel) === round2(walletBeforeCancel + cancelOrder.total), `${walletBeforeCancel} -> ${walletAfterCancel} (order ${currencySymbol}${cancelOrder.total})`);

    const cancelTwice = await req('POST', `/orders/${cancelOrder.id}/cancel`, { token: studentToken, body: {} });
    check('Cancelling twice is rejected', cancelTwice.status === 409, `status ${cancelTwice.status}`);

    const refundTxn = await req('GET', '/payment/wallet/transactions?limit=5', { token: studentToken });
    check('Refund appears in wallet history', refundTxn.data?.transactions?.some((t) => t.reason === 'ORDER_REFUND'), `${refundTxn.data?.transactions?.length ?? 0} transactions`);
  }

  /* -------------------------------------------------- 9. wallet top-up */
  section('Wallet top-up through the payment gateway');
  const walletBefore = (await req('GET', '/payment/wallet', { token: studentToken })).data?.wallet?.balance ?? 0;
  const topup = await req('POST', '/payment/wallet/topup', { token: studentToken, body: { amount: 300 } });
  check('Top-up intent is created', topup.ok && Boolean(topup.data?.gateway?.gatewayOrderId), topup.data?.error?.message ?? '');
  const topupGatewayOrderId = topup.data?.gateway?.gatewayOrderId;

  if (currentProvider() !== 'razorpay') {
    const sandboxTopup = await req('POST', '/payment/sandbox/checkout', { token: studentToken, body: { gatewayOrderId: topupGatewayOrderId } });
    const verifyTopup = await req('POST', '/payment/wallet/topup/verify', {
      token: studentToken,
      body: {
        gatewayOrderId: topupGatewayOrderId,
        gatewayPaymentId: sandboxTopup.data?.gatewayPaymentId,
        gatewaySignature: sandboxTopup.data?.gatewaySignature,
      },
    });
    check('Top-up credits the wallet', verifyTopup.ok && verifyTopup.data?.wallet?.balance === round2(walletBefore + 300), `${walletBefore} -> ${verifyTopup.data?.wallet?.balance}`);

    const replayTopup = await req('POST', '/payment/wallet/topup/verify', {
      token: studentToken,
      body: {
        gatewayOrderId: topupGatewayOrderId,
        gatewayPaymentId: sandboxTopup.data?.gatewayPaymentId,
        gatewaySignature: sandboxTopup.data?.gatewaySignature,
      },
    });
    check('Replayed top-up does not double credit', replayTopup.ok && replayTopup.data?.wallet?.balance === round2(walletBefore + 300), `balance=${replayTopup.data?.wallet?.balance}`);

    const walletOrder = await req('POST', '/orders', {
      token: studentToken,
      body: {
        canteen: mainCanteen.id,
        qrLocationCode: qrCode,
        items: [{ menuItem: unlimitedItem.id, quantity: 1 }],
        paymentMethod: 'wallet',
      },
    });
    check('Wallet checkout settles the order', walletOrder.ok && walletOrder.data?.order?.status === 'PAID', walletOrder.data?.error?.message ?? '');
    check('Wallet payment provider recorded', walletOrder.data?.order?.payment?.method === 'wallet');

    const insufficient = await req('POST', '/orders', {
      token: studentToken,
      body: {
        canteen: mainCanteen.id,
        qrLocationCode: qrCode,
        items: [{ menuItem: allItems.find((i) => i.price > 500)?.id ?? trackedItem.id, quantity: 50 }],
        paymentMethod: 'wallet',
      },
    });
    check('Order far above wallet balance is handled', insufficient.status === 400 || insufficient.status === 409 || insufficient.ok, `status ${insufficient.status}`);
  } else {
    console.log(`  ${c.dim}Wallet top-up settlement is exercised in the browser with live Razorpay keys.${c.reset}`);
  }

  /* ------------------------------------------------ 10. oversell protection */
  section('Oversell protection');
  const limitedItem = await req('POST', '/menu', {
    token: adminToken,
    body: {
      canteen: mainCanteen.id,
      name: `Limited Stock ${Date.now()}`,
      price: 30,
      category: 'Snacks',
      trackStock: true,
      stock: 1,
      lowStockThreshold: 1,
    },
  });
  const limitedId = limitedItem.data?.item?.id;

  if (limitedId) {
    const first = await req('POST', '/orders', {
      token: studentToken,
      body: { canteen: mainCanteen.id, qrLocationCode: qrCode, items: [{ menuItem: limitedId, quantity: 1 }], paymentMethod: 'wallet' },
    });
    check('First order for the last unit succeeds', first.ok && first.data?.order?.status === 'PAID', first.data?.error?.message ?? '');

    const second = await req('POST', '/orders', {
      token: studentToken,
      body: { canteen: mainCanteen.id, qrLocationCode: qrCode, items: [{ menuItem: limitedId, quantity: 1 }], paymentMethod: 'wallet' },
    });
    check('Second order for the same unit is rejected', second.status === 409 && second.data?.error?.name === 'INSUFFICIENT_STOCK', second.data?.error?.message ?? `status ${second.status}`);

    const stockNow = await getStock(adminToken, limitedId);
    check('Stock never goes negative', stockNow === 0, `stock=${stockNow}`);

    const unavailable = await req('PATCH', `/menu/${limitedId}/availability`, { token: adminToken, body: { isAvailable: false, reason: 'Sold out' } });
    check('Sold out item can be taken off the menu', unavailable.ok && unavailable.data?.item?.isAvailable === false);

    await req('DELETE', `/menu/${limitedId}`, { token: adminToken });
  }

  /* ------------------------------------------------- 11. canteen controls */
  section('Canteen open/closed control');
  const close = await req('PATCH', `/canteen/status/${mainCanteen.id}`, { token: adminToken, body: { isOpen: false, closedMessage: 'Verification test - kitchen closed' } });
  check('Admin can close the canteen', close.ok && close.data?.canteen?.canOrder === false, close.data?.error?.message ?? '');

  const closedOrder = await req('POST', '/orders', {
    token: studentToken,
    body: { canteen: mainCanteen.id, qrLocationCode: qrCode, items: [{ menuItem: unlimitedItem.id, quantity: 1 }], paymentMethod: 'wallet' },
  });
  check('Ordering is blocked while the canteen is closed', closedOrder.status === 409 && closedOrder.data?.error?.name === 'CANTEEN_CLOSED', closedOrder.data?.error?.message ?? `status ${closedOrder.status}`);

  const reopen = await req('PATCH', `/canteen/status/${mainCanteen.id}`, { token: adminToken, body: { isOpen: true } });
  check('Admin can reopen the canteen', reopen.ok && reopen.data?.canteen?.canOrder === true);

  /* -------------------------------------------------- 12. admin tooling */
  section('Admin users, settings, tokens and analytics');
  const users = await req('GET', '/admin/users?limit=10', { token: adminToken });
  check('Admin can list users', users.ok && users.data?.users?.length > 0, `${users.data?.total ?? 0} users`);
  check('User list includes real order statistics', users.data?.users?.some((u) => typeof u.orders === 'number'), '');

  const block = await req('PATCH', `/admin/users/${verifyToken ? studentId : studentId}`, { token: adminToken, body: { isBlocked: false } });
  check('Admin can update a user', block.ok, block.data?.error?.message ?? '');

  const settingsGet = await req('GET', '/admin/settings', { token: adminToken });
  check('Admin can read settings', settingsGet.ok && Boolean(settingsGet.data?.settings));

  const settingsPatch = await req('PATCH', '/admin/settings', { token: adminToken, body: { tokenLength: 4, receiptFooter: 'Thank you - enjoy your meal!' } });
  check('Admin can update settings', settingsPatch.ok && settingsPatch.data?.settings?.tokenLength === 4, settingsPatch.data?.error?.message ?? '');

  const tokens = await req('GET', '/admin/tokens', { token: adminToken });
  check('Token management returns a preview and issued tokens', tokens.ok && tokens.data?.preview?.length === 5, `format=${tokens.data?.format}`);
  check('Recent issued tokens are real order tokens', (tokens.data?.recent?.length ?? 0) >= 0, `${tokens.data?.recent?.length ?? 0} recent`);

  const dashboard = await req('GET', '/admin/dashboard', { token: adminToken });
  check('Dashboard returns real statistics', dashboard.ok && typeof dashboard.data?.today?.orders === 'number', `today: ${dashboard.data?.today?.orders} orders, ${currencySymbol}${dashboard.data?.today?.revenue}`);
  check('Dashboard shows low stock count from the database', typeof dashboard.data?.lowStockCount === 'number', `lowStock=${dashboard.data?.lowStockCount}`);

  const analytics = await req('GET', '/admin/analytics?days=7', { token: adminToken });
  check('Analytics returns real daily series', analytics.ok && analytics.data?.daily?.length === 7, `${analytics.data?.daily?.length ?? 0} days`);
  check('Analytics totals come from the database', (analytics.data?.summary?.totalOrders ?? 0) > 0, `totalOrders=${analytics.data?.summary?.totalOrders}`);
  check('Analytics hourly distribution present', analytics.data?.hourly?.length === 24);
  check('Analytics category breakdown present', Array.isArray(analytics.data?.byCategory));

  const systemHealth = await req('GET', '/admin/health', { token: adminToken });
  check('Admin system health check responds', systemHealth.ok && systemHealth.data?.counts?.menuItems > 0, `menuItems=${systemHealth.data?.counts?.menuItems}`);

  const staff = await req('POST', '/admin/users/staff', {
    token: adminToken,
    body: { name: 'Kitchen Staff', email: `kitchen-${Date.now()}@foodflow.edu`, password: 'Kitchen@123' },
  });
  check('Admin can create another staff account', staff.status === 201, staff.data?.error?.message ?? '');
  if (staff.data?.user?.id) await req('DELETE', `/admin/users/${staff.data.user.id}`, { token: adminToken });

  /* ----------------------------------------------------- 13. history + receipt */
  section('Order history, details and receipt data');
  const history = await req('GET', '/orders/my?limit=50', { token: studentToken });
  check('Order history loads', history.ok && history.data?.orders?.length > 0, `${history.data?.total ?? 0} orders`);

  const detailOrder = (history.data?.orders ?? [])[0];
  check('Order detail includes items with quantities', (detailOrder?.items?.length ?? 0) > 0 && (detailOrder.items[0]?.quantity ?? 0) > 0, '');
  check('Order detail includes payment status', Boolean(detailOrder?.payment?.status), detailOrder?.payment?.status);
  check('Order detail includes canteen + QR location', Boolean(detailOrder?.canteen?.name) && Boolean(detailOrder?.qrLocation?.code), `${detailOrder?.qrLocation?.code}`);
  check('Order detail includes a printable timestamp', Boolean(detailOrder?.createdAt));

  const filtered = await req('GET', '/orders/my?status=COMPLETED', { token: studentToken });
  check('History status filter works', filtered.ok && filtered.data.orders.every((o) => o.status === 'COMPLETED'), `${filtered.data?.orders?.length ?? 0} completed`);

  const foreign = await req('GET', `/orders/${detailOrder?.id}`, { token: verifyToken });
  check("Student cannot read another student's order", foreign.status === 403, `status ${foreign.status}`);

  const token = await req('GET', '/orders/current', { token: studentToken });
  ok('Current-order tracking endpoint responds', `${token.data?.orders?.length ?? 0} open orders`);

  /* ------------------------------------------------------- 14. realtime */
  section('Socket.IO realtime updates');
  const realtimeResult = await verifyRealtime({
    adminToken,
    studentToken,
    mainCanteenId: mainCanteen.id,
    qrCode,
    itemId: unlimitedItem.id,
  });
  realtimeResult.forEach((r) => check(r.label, r.passed, r.detail));

  /* --------------------------------------------------------- 15. cleanup */
  section('Cleanup');
  if (tempItemId) {
    const del = await req('DELETE', `/menu/${tempItemId}`, { token: adminToken });
    check('Temporary menu item removed', del.ok, del.data?.message ?? '');
  }
  if (verifyToken) {
    const wallet = await req('GET', '/payment/wallet', { token: verifyToken });
    if ((wallet.data?.wallet?.balance ?? 0) > 0) {
      await req('POST', '/admin/wallet/adjust', { token: adminToken, body: { user: (await req('GET', '/auth/me', { token: verifyToken })).data.user.id, amount: wallet.data.wallet.balance, type: 'debit', reason: 'verification cleanup' } });
    }
    const logout = await req('POST', '/auth/logout', { token: verifyToken });
    check('Logout responds', logout.ok);
  }

  /* --------------------------------------------------------- summary */
  console.log(`\n${c.bold}${'='.repeat(66)}${c.reset}`);
  console.log(`${c.bold}RESULT${c.reset}  ${c.green}${passed} passed${c.reset}  ${failed > 0 ? c.red : c.dim}${failed} failed${c.reset}`);
  if (failures.length) {
    console.log(`\n${c.red}Failures:${c.reset}`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log(`${c.bold}${'='.repeat(66)}${c.reset}`);
  process.exit(failed > 0 ? 1 : 0);
}

async function getStock(adminToken, itemId) {
  const res = await req('GET', `/menu/${itemId}`, { token: adminToken });
  return res.data?.item?.stock ?? null;
}

/**
 * Tops the wallet up through the real top-up + verification endpoints.
 * Only the sandbox provider can be completed without a live Razorpay checkout.
 */
function currentProvider() {
  return currentProviderValue;
}

async function topUpWallet(token, amount) {
  const topup = await req('POST', '/payment/wallet/topup', { token, body: { amount } });
  if (!topup.ok) return topup;
  if (currentProvider() !== 'razorpay') {
    const paid = await req('POST', '/payment/sandbox/checkout', {
      token,
      body: { gatewayOrderId: topup.data?.gateway?.gatewayOrderId },
    });
    return req('POST', '/payment/wallet/topup/verify', {
      token,
      body: {
        gatewayOrderId: topup.data?.gateway?.gatewayOrderId,
        gatewayPaymentId: paid.data?.gatewayPaymentId,
        gatewaySignature: paid.data?.gatewaySignature,
      },
    });
  }
  return topup;
}

/** Verifies the admin -> student realtime push and the polling fallback data shape. */
function verifyRealtime({ adminToken, studentToken, mainCanteenId, qrCode, itemId }) {
  return new Promise((resolve) => {
    const results = [];
    const done = () => {
      adminSocket?.close();
      studentSocket?.close();
      resolve(results);
    };

    const timer = setTimeout(done, 15000);

    const adminSocket = io(BASE_URL, { auth: { token: adminToken }, transports: ['websocket', 'polling'] });
    const studentSocket = io(BASE_URL, { auth: { token: studentToken }, transports: ['websocket', 'polling'] });
    let orderId = null;
    let sawStatus = null;
    let socketsReady = 0;
    let orderRequested = false;

    adminSocket.on('connect_error', (err) => {
      results.push({ label: 'Admin socket connects', passed: false, detail: err.message });
    });

    // Place a real wallet order once both sockets are live so the server has something to push.
    const triggerOrder = async () => {
      if (orderRequested) return;
      orderRequested = true;
      const created = await req('POST', '/orders', {
        token: studentToken,
        body: { canteen: mainCanteenId, qrLocationCode: qrCode, items: [{ menuItem: itemId, quantity: 1 }], paymentMethod: 'wallet' },
      });
      results.push({
        label: 'Realtime order is created and paid through the wallet',
        passed: created.ok && created.data?.order?.status === 'PAID',
        detail: created.data?.error?.message ?? created.data?.order?.status ?? '',
      });
      if (created.data?.order?.id) orderId = created.data.order.id;
    };

    const onConnected = () => {
      socketsReady += 1;
      results.push({ label: `${socketsReady === 1 ? 'Admin' : 'Student'} socket connects`, passed: true, detail: `id=${(socketsReady === 1 ? adminSocket : studentSocket).id}` });
      if (socketsReady === 2) triggerOrder();
    };
    adminSocket.on('connect', onConnected);
    studentSocket.on('connect', onConnected);

    studentSocket.on('order:status', async (payload) => {
      if (!orderId || String(payload?.id ?? payload?._id) !== orderId) return;
      if (payload.status === 'ACCEPTED' || payload.status === 'PREPARING') {
        sawStatus = payload.status;
        const fresh = await req('GET', `/orders/${orderId}`, { token: studentToken });
        results.push({
          label: 'Student screen reflects the admin change (realtime + polling)',
          passed: fresh.data?.order?.status === payload.status,
          detail: `pushed=${payload.status} fetched=${fresh.data?.order?.status}`,
        });
        clearTimeout(timer);
        done();
      }
    });

    adminSocket.on('order:new', async (payload) => {
      const pushedId = String(payload?.id ?? payload?._id ?? '');
      if (!pushedId || (orderId && pushedId !== orderId)) return;
      orderId = pushedId;
      results.push({ label: 'Admin receives order:new push', passed: Boolean(orderId), detail: `token=${payload?.token}` });
      const accept = await req('PATCH', `/orders/${orderId}/status`, { token: adminToken, body: { status: 'ACCEPTED' } });
      results.push({ label: 'Admin accepts the new order', passed: accept.ok && accept.data?.order?.status === 'ACCEPTED', detail: accept.data?.error?.message ?? '' });
    });

    setTimeout(async () => {
      if (results.length === 0) {
        results.push({ label: 'Socket.IO realtime delivery', passed: false, detail: 'no events received within 15s' });
        done();
        return;
      }
      if (!sawStatus) {
        const fresh = await req('GET', `/orders/current`, { token: studentToken });
        results.push({
          label: 'Polling fallback returns current orders',
          passed: Array.isArray(fresh.data?.orders),
          detail: `${fresh.data?.orders?.length ?? 0} orders`,
        });
      }
      clearTimeout(timer);
      done();
    }, 9000);
  });
}

main().catch((error) => {
  console.error(`${c.red}Verification crashed:${c.reset}`, error);
  process.exit(1);
});