# BLOFY PLAYER — Geidea Live operating guide

The payment flow belongs to **BLOFY PLAYER application activation**, not BLOFYSAT or any Xtream subscription. Live API credentials are secret and are only stored as Railway variables on the existing `blofy-activation-portal` service.

## Deployment

1. Ship the audited code while retaining the current payment provider and `BLOFY_GEIDEA_CHECKOUT_ENABLED=false` until the merchant card checkout is verified.
2. **Card-only checkout**: Geidea session request specifies `hideWallets=["apple-pay"]`, `expressCheckouts=[]`, and `appearance.uiMode="modal"`. The production Geidea merchant has Google Pay and Samsung Pay disabled already. Explicitly hiding those disabled wallets causes HPP Integration error 110/112, so only Apple Pay must be hidden. The website uses the official KSA Geidea checkout **modal**, not a redirect. On verification, orders funded by wallets are rejected and never grant device activation. **No Apple Pay association file or domain registration is required or published.**
3. Production Railway service: `blofy-activation-portal` in project `BLOFY-Update-Distribution`. Do not put Live keys on `BLOFY-Geidea-Sandbox`. Secret names: `GEIDEA_LIVE_MERCHANT_PUBLIC_KEY` and `GEIDEA_LIVE_API_PASSWORD`.
4. Select exact approved customer prices from `BLOFY_GEIDEA_PLANS_JSON` or the existing `BLOFY_PAYMENT_PLANS_JSON`. These entries require SAR, one device, `priceMinor >= 100`, and explicit duration; an existing `tap-live-...` plan key maps to `geidea-live-...`. Do not substitute the SAR 1.00 sandbox test price. Review pricing/tax/terms before enabling.
5. Inspect outstanding Tap orders and ensure they can complete or be reconciled. After review, enable checkout on the production Railway service with `BLOFY_PAYMENT_PROVIDER=geidea` and `BLOFY_GEIDEA_CHECKOUT_ENABLED=true`. Deploy exactly once. To roll back new checkouts, set `BLOFY_GEIDEA_CHECKOUT_ENABLED=false`, preserving already paid orders and audit records.
6. Verify `GET /api/v1/subscriptions/plans` reports `provider=geidea`, correct prices, `sandbox=false`, and `purchasesAvailable=true`. Verify `/pay` launches the card-only Geidea modal (no wallet buttons) and the homepage payment link. Confirm the merchant Geidea account does not enable any unwanted additional payment methods. Check against a **real, authorized** device only.
7. Make one explicitly authorized small **real** transaction at an approved price; confirm Geidea Live order `isTest=false`, exact currency/amount, signature, signed callback, authenticated provider order lookup, successful Pay capture, and one entitlement extension. Verify duplicate callbacks do not extend twice. Validate failure/cancellation, reconciliation, logs and refunds.
8. Support handling: if a customer is charged but the payment status is pending, do not ask for repeat payment. Reconcile against Geidea using the order reference and production credentials; review refund/chargeback requests manually. The browser return is not proof of payment.

## Routes

- `GET /pay`: BLOFY themed checkout page (the existing UI adapts brand text to Geidea).
- `GET /api/v1/subscriptions/plans`: available active, configured production plans.
- `POST /api/v1/subscriptions/checkout`: device-authorized order and Geidea HPP session.
- `POST /api/v1/payments/geidea/webhook`: signed callback, provider lookup, and idempotent license grant.
- `GET /api/v1/payments/geidea/return?reference=<UUID>`: protected by unguessable order reference; verifies actual provider order and displays safe outcome.
- No Apple Pay verification file or route exists on the public site. The Geidea portal should have wallets disabled in merchant settings where applicable.

## Security requirements

No card data, full credentials, payment password, or merchant secret should be embedded in HTML, logged, or committed. Never convert TEST credentials into Live by just changing a flag. No entitlement comes from a browser redirect or unsigned callback. A successful callback must match a *non-test* order verified server-to-server with captured amount, zero refund and correct reference, merchant and currency; the actual payment method must be a plain card (wallet null). The database transaction applies fulfillment only once. Production activation remains disabled until release checks and an approved price are present.
