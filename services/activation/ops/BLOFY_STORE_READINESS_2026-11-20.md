# BLOFY STORE & BLOFY ONE — production readiness checklist
Date: 2026-11-20 (Asia/Riyadh)
Scope: BLOFY STORE, customer portal, code inventory, BLOFY ONE operator portal, activation/checkout paths and monitored PostgreSQL-backed Xtream gateway.

## Deployment work completed
- Single primary customer purchase journey: STREAM or Xtream → duration/free trial → cart → verified email and profile → zero-price claim or hosted verified payment. Homepage no longer preloads an unused payment SDK; legacy receipt recovery is retained for existing orders.
- Place main products before the secondary annual-two-code offer. Header provides official downloads; hero supports trial selection without an independent, duplicative trial card.
- Responsive touch controls, visible keyboard focus, reduced animation for reduced-motion preferences, clearer subscription steps and accurate canonical homepage.
- Private Xtream credentials are hidden after 90 seconds, on tab backgrounding or navigating away; no local persistence was added.
- Owner portal has direct unified-code navigation and an on-demand read-only PostgreSQL diagnostic panel. Active lock waiters / long transactions are separated from cumulative deadlocks. No source credentials, private SQL, IP addresses or customer codes returned.
- CI tests cover new UX contracts, protected credentials, DB aggregation, admin-only access and UI binding.

## P0 — validation and remediation still required (NOT automatically proven by deployment)
1. Database contention: Railway runtime previously logged repeated PostgreSQL `deadlock detected`, shared-memory resize failures (`No space left on device`), and Node pg shared-client query warnings. **These were detected, not conclusively fixed by diagnostics**. On owner portal, open "تشخيص قاعدة بيانات BLOFY" and record `lockWaiters`, `longestTransactionSeconds`, `deadlocksTotal`, `statisticsResetAt` across several consecutive samples under representative traffic. Get Postgres log context including SQLSTATE 40P01, wait/blocker chain and runtime /dev/shm constraints; identify and fix one source transaction at a time. Do not restart production Postgres or increase storage/memory blindly.
2. Paid production checkout: use one authorized low-value real order; confirm captured Geidea state, cart fulfillment for all line items, code inventory decrement, customer ownership, invoice/order receipt, activation timestamp and expiry. Never trigger a second charge while payment is pending; use existing recovery.
3. STREAM / Xtream playback: on real devices test supported channels and a movie/series sample from licensed sources, including Android 9, home Wi-Fi and mobile hotspot. Distinguish customer-disconnected 499 from upstream 502/503 and run scoped upstream connection diagnostics before changing routing.
4. Backup and restore: verify point-in-time Postgres backup availability, a nonproduction restore, and separation of secrets/production customer records. No backup restore was performed in this change.
5. Rights/compliance: verify source content distribution rights and payment, privacy, refund, Saudi consumer and store-policy documents with appropriate legal owners before large-scale promotion.

## P1 — cross-device / quality acceptance tests
- 360px, 390px, 768px, 1280px, 1920px viewport checks in Chrome, Safari and Android TV browser. Validate sticky nav + WhatsApp don't overlap purchase actions, products-first responsive layout and Arabic RTL focus order.
- Search, coupon, add/remove multiple items, free+paid cart, login invalid OTP/resend, incomplete profile, session expiry, new tab/cart restore, returning purchase receipt, customer renewals, existing-code relogin, Xtream credentials and copy.
- Slow 3G, suspended tab, unreliable DNS and 30s app resume. Confirm no spinner hangs and error messages are actionable. No heavy browser screenshot matrix has yet been executed.
- Lighthouse/Core Web Vitals / keyboard / screenreader audits. Target good LCP/INP/CLS and no horizontal overflow; these are goals, **not** claims of measured performance.
- Run concurrent non-destructive tests against staging first. Do not test unauthorized source media or high-load customer playback in live production.

## P2 — nonbreaking follow-ons
- Gradually migrate old homepage direct-checkout functions and legacy receipt controls only after all historic receipts have a supported recovery route; leave existing backend payment routes for compatibility.
- Lazy-load admin-only modules by section in a feature-flagged staged release; existing scripts depend on DOM timing and must be audited individually.
- Build first-party marketing attribution and verified trial-to-paid conversion reporting, keeping no fabricated counts or reviews.
- Consent-based reminder delivery using the existing email/alert preference machinery; verify provider before enabling automatic campaigns.
- Split operational & sales administration routes once all links, roles, exports and test fixture dependencies are mapped.

## Release gate
Green on unit/CI and Railway startup = deployable code, **not** verified live billing, source delivery capacity or fully audited site. Require explicit P0 acceptance with evidence before calling all of BLOFY production-ready for large-scale sales.
