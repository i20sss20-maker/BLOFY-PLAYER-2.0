# BLOFY STORE PRO — optional generative shopping assistant

## Scope and safety

The existing /store/assistant continues to provide verified, deterministic guidance when
generative inference is disabled, rate-limited or offline.

The optional backend exposes only:

- `GET /api/v1/store/assistant/availability` — returns whether generative mode is configured.
- `POST /api/v1/store/assistant/chat` — accepts `{"question":"..."}` only from one of the
  first-party browser origins.

It does not query customers, orders, codes, sessions, or databases; it cannot modify
checkout, discounts, payments, subscriptions, code delivery, or expiry dates. The
text of the question is passed to Google Gemini when enabled; the UI informs users
not to submit personal or secret information. Requests are stateless and aren't
persisted by this service.

## Required opt-in configuration

Set these variables on the BLOFY activation service **only after QA**:

- `BLOFY_STORE_AI_ENABLED=true` — OFF by default.
- `BLOFY_STORE_AI_API_KEY` — dedicated provider credential, stored as a service secret
  (never commit the key or place it in browser JS).
- `BLOFY_STORE_AI_MODEL=gemini-2.5-flash` — optional allowlisted Gemini model name.

The config requires an enabled flag and a plausible API key. An invalid or unsupported
model fails closed to the deterministic guide, not to a payment/issuance endpoint.

## Security and privacy

- API calls are same-origin, JSON-only, and strict first-party Origin checked.
- Questions are limited to 380 characters; likely card numbers, URLs, emails,
  codes and passwords are rejected before network calls.
- In-memory quotas cap usage per client and per service instance; use edge/WAF quotas
  for multi-replica production deployment.
- The provider call is bounded to 8 seconds and 350 output tokens.
- Failure responses disclose no provider error body, prompt content or key.
- Assistant replies are rendered only as text; all available links are local and
  allowlisted. Financial/payment guidance remains verified and deterministic.

## Test and staged rollout

1. Run:
   `cd services/activation && npm ci && node --test test/store-ai-assistant.test.mjs test/store-pro-growth.test.mjs test/store-pro-campaign-center.test.mjs`.
2. Confirm the site continues to support checkout, account recovery, paid-order
   fulfillment and the existing Geidea callbacks unchanged.
3. Validate live inference using a non-sensitive shopping question in a private
   QA environment. Check failure and limit handling, costs and response speed.
4. Only then enable this feature in production, with usage monitoring. Rollback is
   `BLOFY_STORE_AI_ENABLED=false`, which immediately returns users to the
   deterministic guide without touching any paid order.
