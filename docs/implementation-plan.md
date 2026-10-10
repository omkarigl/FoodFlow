# FoodFlow Implementation Plan (Greenfield Approved)

## Audit Summary
- Repository initially contained only `SSGMCE LOGO.svg`.
- User approved greenfield canonical contract/schema definition in-repo.
- Existing SSGMCE logo is reused via app public symlink (`apps/web/public/ssgmce-logo.svg`).

## Incremental Plan and Status
- [x] Scaffold Next.js TypeScript app with Tailwind/ESLint.
- [x] Define canonical contract docs and environment template.
- [x] Add Supabase migration for profiles/menu/orders/payments and status enums/checks.
- [x] Implement API routes for menu, checkout, tracking, history, profile, admin, and Razorpay.
- [x] Implement responsive frontend layout and core flows (menu/cart/checkout/auth/account/admin/report).
- [x] Add focused tests for core pricing behavior.
- [x] Run lint/build/test validation and fix defects.
- [x] Run parallel validation.
- [x] Document blockers and non-live-tested integrations.

## Current Known Constraints
- Live Supabase and Razorpay flows require environment variables and credentials.
- Role elevation to `admin` requires profile data setup in Supabase.
- CodeQL scan execution failed in this environment (no security alerts reported, but analysis did not complete).
