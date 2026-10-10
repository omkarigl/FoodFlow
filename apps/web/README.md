# FoodFlow Web App

Next.js (App Router) implementation for SSGMCE canteen ordering.

## Setup

1. Copy `.env.example` to `.env.local` and provide values:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
2. Apply Supabase migration:
   - `supabase/migrations/202610100001_init_foodflow.sql`
3. Install and run:

```bash
npm install
npm run dev
```

## Validation

```bash
npm run test
npm run lint
npm run build
```

## Implemented capabilities
- Warm canteen-branded responsive layout with existing SSGMCE logo.
- Public menu from API with category filters and cart quantity controls.
- Checkout with server-side pricing and idempotency key support.
- Razorpay order creation + backend signature verification.
- Token-based order tracking.
- Student login/signup, profile (student ID) and private order history filters.
- Admin-only order/status management, menu management API, and revenue report endpoint.
