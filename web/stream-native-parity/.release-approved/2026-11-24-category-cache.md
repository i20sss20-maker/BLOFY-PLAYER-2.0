# STREAM Web category memory budget — 2026-11-24

Scope: official Web service f109c5f9-b81d-460d-81e5-175cc9b3df18 only. No Android, media worker, subscription or database changes.

PR #863 merged at affffc7338cfdef0a6dedfd58f574671461215ef. Limit inactive category listings to eight and 576 items, preserve selected categories and pending pagination, and avoid stale page callbacks after a listing is replaced.

CI: official Web 45377129628 SUCCESS, fast first picture 45377129689 SUCCESS, dual engine 45377129606 SUCCESS, encoder capacity 45377129639 SUCCESS, media backpressure 45377129538 SUCCESS. Android CI 45377129508 FAILED and is outside this Web-only rollout. Docker build must pass all sixteen regression tests before promotion. No physical-device performance claim.
