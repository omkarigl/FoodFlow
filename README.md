# FoodFlow

Campus canteen ordering: browse the menu, build a cart, pay by card or UPI, get a token
number, and skip the queue. Includes a canteen admin portal, a coupon engine, and a
co-purchase recommendation engine.

```
student site (React + Vite)  ──►  API (Express)  ──►  Supabase (PostgreSQL + Auth)
                                        │
                                        └──────────►  Razorpay (payments + webhooks)
```

---

## 1. What you need first

| Thing | Where to get it | Used for |
| --- | --- | --- |
| Node.js 18+ | nodejs.org | runs everything |
| A Supabase project | supabase.com → New project | database, tables, student sign-in |
| Supabase keys | Project Settings → API | `service_role` for the API, `anon` for the browser |
| Razorpay account (optional) | razorpay.com → Dashboard → Account & Settings → API Keys | real payments |
| Razorpay webhook secret (optional) | same page → Webhooks | server-to-server payment confirmation |

> **Rotate the leaked key first.** A `service_role` key was committed in this repo's git
> history (`b5814ab`, reintroduced in `b3afdb9`). Generate a new one in Supabase, update
> `server/.env`, and purge the old key from history before going live. The current
> `server/.env.example` is sanitised.

---

## 2. Install

```bash
npm install          # root tooling (dev runner only, zero dependencies)
npm install --prefix server
npm install --prefix client
```

## 3. Configure

**Database** — open the Supabase SQL editor, paste `server/sql/schema.sql`, run it.
It is idempotent: safe to re-run, and it upgrades an older database in place.

**API** — copy `server/.env.example` to `server/.env` and fill in:

```ini
SUPABASE_URL=https://YOUR-REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # never commit, never send to the browser
SUPABASE_ANON_KEY=eyJ...               # used only to verify student JWTs
ADMIN_API_KEY=<long random string>     # shared key for the canteen portal
RAZORPAY_KEY_ID=rzp_test_...           # omit both keys to run in local test mode
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
PACKING_FEE=15
FREE_PACKING_ABOVE=300
```

Generate a strong admin key with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**Client** — copy `client/.env.example` to `client/.env.local`:

```ini
VITE_API_BASE_URL=http://localhost:5000/api
VITE_SUPABASE_URL=https://YOUR-REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

## 4. Load the menu

```bash
npm run seed
```

Idempotent, matched on dish name, so re-running updates prices instead of duplicating
rows. `-- --reset` also removes dishes that are no longer in the catalogue (it warns
first). See `server/scripts/seed.js` for the 27-dish catalogue.

## 5. Run

```bash
npm run dev
```

- web → http://localhost:5173
- api → http://localhost:5000/api/health

Or run them separately: `npm run dev:server`, `npm run dev:client`.

Canteen staff sign in at **/admin** with `ADMIN_API_KEY`. Students can order without an
account; signing in adds order history, per-student coupons and recommendations.

---

## Features

**Students**
- Category-filtered menu with search, veg-only and sold-out filters, four sort orders
- Cart persisted in `localStorage`, quantity steppers, live coupon preview
- Guest checkout or Supabase account, three pickup points, kitchen notes
- Razorpay Checkout (cards, UPI, netbanking, wallets) with server-side signature
  verification — the browser never decides that an order is paid
- Order token number, live status polling, printable/downloadable receipt, barcode
- Track by token + email or phone, order history, cancel while the kitchen is idle
- Reviews (one per student per dish) that update menu card averages via a DB trigger
- Personalised picks from the recommendation engine

**Canteen admin**
- Shared-key sign-in, kept in `sessionStorage` so closing the tab locks the portal
- Dashboard: today's orders/revenue, week totals, average order value, completion and
  cancellation rates, 7-day revenue chart, busiest hour, top sellers, coupon usage
- Order board with legal-transition-only status changes and one-click refund
- Menu manager: create, edit, delete, mark sold out
- Coupon manager: percent / flat / free-packing, min order, category, date window,
  global cap, per-student cap
- Open/closed switch with a message students see immediately
- Recommendation matrix rebuild

**Engines**
- `evaluate_coupon()` — one shared function for preview *and* charge, with row locking
  so concurrent redemptions cannot overshoot a usage cap
- `place_order()` — one transaction: availability, price, coupon, packing, token number
- `rebuild_item_cooccurrence()` — confidence + lift co-purchase pairs, driving both
  "frequently ordered together" and personalised picks

---

## Project layout

```
server/
  config/          env validation, Supabase clients
  lib/errors.js    ApiError, asyncHandler, DB error sanitising
  middleware/      admin key, JWT auth, CORS + error handler
  routes/          auth, menu, canteen, orders, coupons, payment, reviews,
                   recommendations, analytics
  services/        recommendation engine
  sql/schema.sql   tables, triggers, coupon engine, place_order, RLS
  scripts/         seed, smoke, secret scanner
client/
  src/components/  Layout, MenuCard, Modal, Receipt, ItemDetail, ReviewForm…
  src/context/     Auth, Cart, Canteen, Toast
  src/pages/       student pages + pages/admin/ portal
  src/styles/      design system
scripts/dev.mjs    runs both dev servers together
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + web dev servers together |
| `npm run build` | production build of the client |
| `npm run seed` | load/refresh the demo menu catalogue |
| `npm run smoke` | boots the API and asserts every route's auth and validation |
| `npm run check:secrets` | fails if a key-shaped string is committed |

---

## API

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/health` | public |
| POST | `/api/auth/signup`, `/api/auth/login` | public |
| GET/PUT | `/api/auth/me` | student |
| GET | `/api/auth/admin-check` | admin |
| GET | `/api/menu`, `/api/menu/categories`, `/api/menu/:id` | public |
| POST/PUT/PATCH/DELETE | `/api/menu…` | admin |
| GET | `/api/canteen` | public |
| PUT | `/api/canteen` | admin |
| POST | `/api/orders` | optional student |
| GET | `/api/orders/track?token&email\|phone` | public |
| GET | `/api/orders/my-history` | student |
| GET/PUT | `/api/orders/:id`, `/api/orders/:id/cancel` | owner or admin |
| GET/PUT | `/api/orders`, `/api/orders/:id/status` | admin |
| GET | `/api/coupons/available` | optional student |
| POST | `/api/coupons/validate` | optional student |
| GET/POST/PUT/DELETE | `/api/coupons…` | admin |
| GET | `/api/payment/config` | public |
| POST | `/api/payment/create-order`, `/verify`, `/simulate` | owner |
| POST | `/api/payment/webhook` | Razorpay signature |
| POST | `/api/payment/refund` | admin |
| GET/PUT | `/api/reviews/item/:menuItemId`, DELETE `/api/reviews/:id` | student |
| GET | `/api/reviews/mine` | admin |
| GET | `/api/recommendations/home`, `/together/:id`, `/for-me` | optional / student |
| POST | `/api/recommendations/rebuild` | admin |
| GET | `/api/analytics/dashboard` | admin |

Errors are always `{ "error": "...", "code": "...", "details": ... }` with a meaningful
status code, and internal database messages never reach the client.

---

## Security notes

- The `service_role` key exists only in `server/.env`. The browser never sees it.
- The `anon` key is public by design and useless on its own: RLS is enabled on every
  table with **zero** policies, so anon/authenticated roles get nothing. All access goes
  through the API.
- Student identity is a Supabase JWT verified per request; expired tokens are refreshed
  client-side and retried once.
- Admin endpoints require the `x-admin-key` header, compared with a constant-time check.
- Prices, discounts, availability, packing fees and token numbers are computed in
  Postgres. Client-supplied totals are ignored.
- Payments: the Razorpay HMAC is recomputed server-side, the payment is re-fetched from
  Razorpay, and the amount must match our order — so a signature cannot be replayed from
  a cheap order onto an expensive one.
- Refunds only ever happen through `POST /api/payment/refund`, which calls Razorpay.
  Cancelling a paid order sets `refund_required` instead of pretending the money is back.
- `.env` files are git-ignored; `npm run check:secrets` fails the build on committed keys.

## Razorpay webhook

Point it at `https://your-api/api/payment/webhook`, subscribe to `payment.captured`,
`payment.failed`, `refund.processed` and `refund.failed`, and paste the webhook secret
into `RAZORPAY_WEBHOOK_SECRET`. The handler verifies the signature over the raw request
body (Razorpay posts form-encoded), then reconciles the order.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Supabase is not configured" | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` missing in `server/.env` |
| "Student accounts are not available" | add `SUPABASE_ANON_KEY` |
| Every admin request is 401 | `ADMIN_API_KEY` unset or different in the browser |
| Menu is empty | run the SQL, then `npm run seed` |
| Payments run in test mode | add `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` and restart the API |
| Orders always fail "canteen is closed" | flip the switch in **/admin/settings** |
| Client cannot reach the API | `VITE_API_BASE_URL` wrong, or API not running |