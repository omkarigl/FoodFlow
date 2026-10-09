# FoodFlow Implementation Plan (Audit-Driven)

## Repository Audit (2026-10-09)

### Git/Branch State
- Current branch: `copilot/audit-and-implement-foodflow`
- Clean working tree at audit start
- Remote `origin/main` fetched and inspected

### Existing Repository Contents
- `SSGMCE LOGO.svg` (existing logo asset confirmed and preserved)
- No frontend application files
- No backend/API files
- No routes/controllers/services
- No authentication/authorization implementation
- No Supabase configuration or migrations
- No payment integration code (Razorpay)
- No tests, lint, build, or type-check configuration
- No deployment configuration found

### CI/Workflow Audit
- GitHub Actions workflow runs inspected
- No failed jobs detected in current run logs

## Constraint Summary
The implementation brief requires reusing existing API contracts, schemas, roles, statuses, and integrations. This repository currently has no such implementation artifacts beyond the logo asset. To avoid violating the "do not invent contracts/schema/roles/statuses" requirement, foundational contract definitions or an existing codebase are required before safely implementing the requested full platform.

## Minimal Safe Incremental Plan

### Phase 1 — Foundation Confirmation
1. Confirm authoritative backend/API contract source (OpenAPI/docs/existing service branch).
2. Confirm authoritative DB schema/migrations source (Supabase SQL/migrations).
3. Confirm auth role model and order/payment status enums.
4. Confirm deployment/runtime stack expectations (frontend/backend framework).

### Phase 2 — Repository Bootstrap (after contract confirmation)
1. Initialize frontend and backend projects with minimal shared configuration.
2. Add environment templates for Supabase and Razorpay without secrets.
3. Wire shared layout and branding using existing `SSGMCE LOGO.svg`.

### Phase 3 — Contract-Driven Feature Delivery
1. Public menu, categories, availability, cart safety.
2. Auth/session flows and optional Student ID persistence (migration only if required).
3. Guest/student checkout with server-authoritative totals and idempotency support.
4. Razorpay server-order creation + verification-gated success states.
5. Token confirmation, tracking, student history, and admin workflows/reports.

### Phase 4 — Validation and Hardening
1. Add focused tests around pricing, authorization, and checkout/order safety.
2. Run lint/type/test/build checks.
3. Run parallel validation (Code Review + CodeQL), fix findings, rerun.

## Required Inputs to Proceed Safely
- Existing API contract or approval to define a new canonical contract in-repo.
- Existing DB schema/migration source or approval to define initial schema.
- Role/status definitions for student/admin/order/payment lifecycle.
- Environment/provider details for Supabase and Razorpay test credentials.
