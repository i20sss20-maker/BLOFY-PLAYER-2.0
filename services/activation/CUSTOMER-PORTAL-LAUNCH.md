# BLOFY Store — Customer Accounts + Commerce Launch QA

## Scope

- Optional, email-verified customer accounts at /store/account complement guest checkout and /store/orders.
- OTP: 6 digits, valid 10 minutes, max 5 failed attempts, 60-second email cooldown and client rate limiting; challenges hashed in PostgreSQL. Sessions use random 256-bit tokens and Secure/HttpOnly/SameSite=Strict cookies.
- Email verification does NOT grant historical order access by itself. Customers link each order using its private ID + 256-bit guest access token. A single order may only belong to one account.
- Only verified, paid, linked orders may reveal codes; voucher integrity and revocation are checked. Pending orders cannot reveal codes.
- Dashboard shows near-expiry based on first successful activation, not checkout. "Renew same code" contacts WhatsApp support; a fresh purchase issues a fresh code, NOT a renewal.
- An email expiry worker is now implemented **disabled by default**, sends at most one email per qualifying voucher with explicit customer opt-in, checks redeemed codes expiring within seven days, leases jobs across replicas and passes Resend idempotency keys. No WhatsApp messages are sent.
- NOT IMPLEMENTED: automatic paid same-code renewal, and production verification of customer email deliverability. A default-false consent setting must be actively selected by the customer.
- No card details, WhatsApp Cloud API tokens, or third-party login keys are stored in this repository.

## Railway configuration

Deploy with customer accounts disabled initially. Verify sender identity in Resend, then set private environment variables on blofy-activation-portal:
- BLOFY_CUSTOMER_RESEND_API_KEY: restricted production sender API key.
- BLOFY_CUSTOMER_MAIL_FROM: verified sender address, e.g. BLOFY <support@verified-domain.example>.
- BLOFY_CUSTOMER_ACCOUNTS_ENABLED=true: only after confirming real email delivery and login.
- BLOFY_CUSTOMER_REMINDERS_ENABLED=true: separate explicit flag, only AFTER customer consent capture, sender verification, and a safe test of the deduplicated worker. Off by default.
- Existing BLOFY_PLAYLIST_ENCRYPTION_KEY remains necessary to protect proofs and codes.

Customer account enrollment does not change device activation or enable checkout. A checkout initiated in a logged-in session is automatically attached to the verified account; guest links remain usable. The owner-only /api/v1/admin/store/customer-accounts/summary endpoint shows account/email/reminder readiness and counts, never emails or raw codes. BLOFY_STORE_GEIDEA_ENABLED remains independent.

## Real payment acceptance test (requires permission and a real card)

No real payment is performed by this PR. Before testing, verify source rights, approved pricing, site health, sufficient inventory and payment-provider credentials.

1. Cart: one 6-month STREAM code plus a mixed annual bundle (STREAM + Xtream). Approved gross = SAR 270 for 3 codes, unless a deliberate coupon is applied.
2. Confirm server cart quote, exactly ONE Geidea session, one order reference, card-only modal, exact SAR 270.00 amount.
3. Complete ONE authorized real payment. If an error occurs, reconcile with provider before retrying.
4. Confirm signed callback plus authoritative non-test captured Pay on the Geidea server, matching reference, merchant, amount, currency, card method and refunded amount.
5. Use private guest order link: exactly 3 unique codes, correct channels (STREAM, STREAM, Xtream) and durations (180, 365, 365 days). Compare with BLOFY ONE admin and merchant records.
6. Replay callback; payment capture must not grant extra codes, create extra orders or double-sell inventory.
7. Sign in to customer account, import guest order, retrieve the same 3 codes. Another account, an invalid OTP and an invalid guest token must all be denied.
8. Test cancelled/rejected payments, bad signatures, insufficient inventory, server timeouts and partial fulfillment. A paid-but-undelivered order is an incident, NOT a reason to ask customer to pay twice.
9. Store provider reference, payment confirmation, order number and QA evidence in private operator systems; follow refund policy where applicable.

## Release gates

- Run npm run check and npm test from services/activation. Verify stored consent, failed email delivery, leased retry, and operator-only status.
- GitHub verify, admin-session-persistence and downloads-browser CI must pass before merging.
- Verify actual Railway service/deployment logs and production health. Do not deploy through retired Vercel.
- Do not advertise commercial go-live until real-payment and multi-voucher delivery acceptance passes.
- To pause new payments on failure, use existing Geidea checkout flags without deleting paid-order receipts.
