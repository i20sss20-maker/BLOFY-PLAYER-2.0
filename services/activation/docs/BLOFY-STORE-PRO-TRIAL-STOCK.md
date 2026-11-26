# BLOFY STORE PRO — One-day trial stock for STREAM and Xtream

## What is new

Trial inventory is now isolated from the paid Geidea stock and is deliberately
**not** added to the paid product-price catalog or checkout cart.

- Owner inventory: `/admin/store-inventory` → 1-day trial section.
- Customer page: `/store/trial` (STREAM or Xtream).
- Products: `trial-stream-1d` and `trial-xtream-1d`, each 24 hours after the
  existing voucher's first successful activation, not after generation/claim.
- Each voucher stores an HMAC code proof + encrypted code_vault, one channel,
  one connection, and the approved `saleh` source only.
- Owner can pre-generate 1–30 codes per batch, atomically. No trial has
  a sale price and nothing interacts with the paid checkout/order tables.

## Separate database ledger

`blofy_store_trial_inventory` stores voucher ID, trial SKU,
creation/claim timestamps and the authenticated customer ID. Stock counting
excludes any voucher that is redeemed, revoked, attached to an account or
missing encrypted code. Owner views only inventory counts and masked
code hints, not plaintext codes. The customer can recover their original
claimed voucher by logging into the same email-confirmed account.

## Eligibility and anti-abuse

- Config flag defaults OFF:
  `BLOFY_STORE_TRIALS_ENABLED=true`
- Requires `BLOFY_CUSTOMER_ACCOUNTS_ENABLED=true` and configured Resend
  sender API key + from-address. This is **not** public anonymous issuance.
- First-party browser Origin and `x-blofy-trial: 1` header required for POST.
- One free trial per verified customer ID across **both** channels, enforced
  by a unique PostgreSQL index.
- Database advisory lock guarantees that parallel requests from two tabs
  cannot reserve both STREAM and Xtream.
- Service-wide claim cap defaults to 25 per day, bounded by 1–100:
  `BLOFY_STORE_TRIALS_DAILY_LIMIT=25`
- 6 attempts per network client per 10 minutes on each process; apply
  gateway/WAF rate limits too for multi-replica deployments.
- Note: Email verification alone does not identify unique humans; multiple
  email addresses can bypass per-account limits. For a large public launch,
  add abuse monitoring and stronger independent verification/approvals.
- Existing reseller phone-based one-day trials use a different quota ledger,
  so do **not** call this a cross-platform one-trial-per-person guarantee.

## User experience

- Customers see live ready-stock numbers, but no secret codes.
- The user logs in via `/store/account` with an email OTP, selects one
  product, accepts a confirmation, and gets an encrypted-vault-backed code.
- The same account can return to `/store/trial` to view its code again;
  a subsequent claim for the other product returns the already claimed
  code and does not decrement stock.
- STREAM: enter the code in the app. Xtream: use
  `https://blofyplayer.com/stream/activate` to extract credentials.
- The code duration remains 1 day. It is NOT silently converted into a
  paid subscription and is never advertised as a payment success.

## QA and rollout

1. CI: run `node --test test/store-trial-inventory.test.mjs`, then the
   cart, paid Geidea, bundle and customer-account regression tests.
2. Test in staging with a test customer email (verified OTP), one trial of
   each type, and test that the same account cannot claim two.
3. Confirm real-device first activation for STREAM and Xtream, 24h expiry,
   old-code readback, and expired-code refusal. These are NOT proven by
   simulated DB tests.
4. Review stock quantities, abuse rate and source authorization. Do not
   pre-generate thousands of codes before proving the source's capacity.
5. Enable `BLOFY_STORE_TRIALS_ENABLED=true` only after staging. Rollback by
   setting it FALSE. Paid order delivery and Geidea remain untouched.

**Never** add trial SKUs to `P` in the Geidea paid store module; that could
accidentally expose zero-value payment fulfillment. The system retains a
separate audited flow.
