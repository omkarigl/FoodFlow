# FoodFlow Canonical API Contract (Greenfield)

Base path: `/api`

## Public
- `GET /menu` → categories + available menu items.
- `POST /orders/checkout` → server-authoritative order creation with `idempotencyKey`.
- `GET /orders/track?token=` → token-based order status.

## Student-authenticated (Supabase user session token)
- `GET /orders/history?from=&to=` → own order history.
- `GET /profile` → own profile.
- `PATCH /profile` → update `studentId`.

## Payment
- `POST /payments/razorpay/order` → create Razorpay order server-side for existing FoodFlow order.
- `POST /payments/razorpay/verify` → verify signature and mark payment as verified.

## Admin-authenticated (role = admin)
- `GET /admin/orders` → recent orders.
- `PATCH /admin/orders/:id` → update order status.
- `GET /admin/menu` and `POST /admin/menu` → list/create menu items.
- `GET /admin/reports/revenue?from=&to=` → verified revenue report.

## Statuses
- Order status: `pending | confirmed | preparing | ready | completed | cancelled`
- Payment status: `pending | verified | failed`
- Roles: `student | admin`
