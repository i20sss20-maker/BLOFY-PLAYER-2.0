# BLOFY PLAYER — Geidea Live operating guide

This guide covers **BLOFY PLAYER application activation and the BLOFY PLAYER website store/cart/renewals**, not the separate BLOFYSAT or Xtream infrastructure. Live API credentials are secret and are only stored as Railway variables on the existing `blofy-activation-portal` service.

## Deployment

1. Ship the audited code while retaining the current payment provider and `BLOFY_GEIDEA_CHECKOUT_ENABLED=false` until the merchant card checkout is verified.
2. **Wallets remain off by default**: unless `BLOFY_GEIDEA_APPLE_PAY_ENABLED=true`, all Geidea sessions pass `hideWallets=["apple-pay"]` and `expressCheckouts=[]`. Google Pay and Samsung Pay are already disabled by the merchant. Do not send them in `hideWallets` as Geidea can reject the session with code 110/112. Once the merchant has approved the verified domain, the Apple Pay flag omits the Apple Pay hide list for the existing HPP modal and website cart/renewal sessions. Do not expose other wallets.
3. Production Railway service: `blofy-activation-portal` in project `BLOFY-Update-Distribution`. Do not put Live keys on `BLOFY-Geidea-Sandbox`. Secret names: `GEIDEA_LIVE_MERCHANT_PUBLIC_KEY` and `GEIDEA_LIVE_API_PASSWORD`.
4. Select exact approved customer prices from `BLOFY_GEIDEA_PLANS_JSON` or the existing `BLOFY_PAYMENT_PLANS_JSON`. These entries require SAR, one device, `priceMinor >= 100`, and explicit duration; an existing `tap-live-...` plan key maps to `geidea-live-...`. Do not substitute the SAR 1.00 sandbox test price. Review pricing/tax/terms before enabling.
5. Inspect outstanding Tap orders and ensure they can complete or be reconciled. After review, enable checkout on the production Railway service with `BLOFY_PAYMENT_PROVIDER=geidea` and `BLOFY_GEIDEA_CHECKOUT_ENABLED=true`. Deploy exactly once. To roll back new checkouts, set `BLOFY_GEIDEA_CHECKOUT_ENABLED=false`, preserving already paid orders and audit records.
6. Verify `GET /api/v1/subscriptions/plans` reports `provider=geidea`, correct prices, `sandbox=false`, and `purchasesAvailable=true`. Verify `/pay` and `/store/cart` continue to work without Apple Pay while the flag is off. After Geidea approves domain registration, enable the flag and check supported Apple Safari devices expose Apple Pay while other wallets stay disabled. Check against a **real, authorized** device only.
7. Make one explicitly authorized small **real** transaction at an approved price; confirm Geidea Live order `isTest=false`, exact currency/amount, signature, signed callback, authenticated provider order lookup, successful Pay capture, and one entitlement extension. Verify duplicate callbacks do not extend twice. Validate failure/cancellation, reconciliation, logs and refunds.
8. Support handling: if a customer is charged but the payment status is pending, do not ask for repeat payment. Reconcile against Geidea using the order reference and production credentials; review refund/chargeback requests manually. The browser return is not proof of payment.

## Routes

- `GET /pay`: BLOFY themed checkout page (the existing UI adapts brand text to Geidea).
- `GET /api/v1/subscriptions/plans`: available active, configured production plans.
- `POST /api/v1/subscriptions/checkout`: device-authorized order and Geidea HPP session.
- `POST /api/v1/payments/geidea/webhook`: signed callback, provider lookup, and idempotent license grant.
- `GET /api/v1/payments/geidea/return?reference=<UUID>`: protected by unguessable order reference; verifies actual provider order and displays safe outcome.
- `GET`/`HEAD /.well-known/apple-developer-merchantid-domain-association`: exact Geidea file (HTTP 200, public, no login, on `blofyplayer.com`, `www.blofyplayer.com` and `api.blofyplayer.com`).

## Security requirements

No card data, full credentials, payment password, or merchant secret should be embedded in HTML, logged, or committed. Never convert TEST credentials into Live by just changing a flag. No entitlement comes from a browser redirect or unsigned callback. A successful callback must match a *non-test* order verified server-to-server with captured amount, zero refund and correct reference, merchant and currency; the actual captured payment method must be an approved card (wallet null) or — **only when** `BLOFY_GEIDEA_APPLE_PAY_ENABLED=true` — an Apple Pay wallet transaction with an approved card brand. Google/Samsung/unknown wallets stay rejected. The database transaction applies fulfillment only once. Production activation remains disabled until release checks and an approved price are present.

## Apple Pay website activation (provider approval required)

1. The **exact 9,119-byte Geidea association file** from the October 26, 2026 merchant email is committed at `web/.well-known/apple-developer-merchantid-domain-association`. Do not regenerate it, change its casing, append HTML, or publish a placeholder.
2. Deploy code while `BLOFY_GEIDEA_APPLE_PAY_ENABLED` is **unset/false**. Verify `https://blofyplayer.com/.well-known/apple-developer-merchantid-domain-association` responds **200 with the exact bytes**; check the www and api host names if submitting those too.
3. Reply to Geidea merchant support with the **verified working HTTPS link**. Request explicit confirmation that Apple Pay for Web is approved for merchant reference B10084145 and the website domain(s).
4. **Only after approval**, change the Railway production variable `BLOFY_GEIDEA_APPLE_PAY_ENABLED=true` for `blofy-activation-portal` and redeploy. The same toggle applies to player activation, store/cart, and same-code renewal; all keep provider-side card capture, server-side verification and idempotency.
5. Test with a supported Apple device and a real approved purchase, confirming the charged payment is marked paid and all cart codes (or renewal entitlements) are delivered exactly once. Do not treat the presence of the Apple Pay button as evidence the payment or merchant setup works.
6. If Apple Pay fails or Geidea rescinds approval, set the flag false again; card payment remains available and existing charged orders must be reconciled, not discarded. Do not change Geidea Live keys.
