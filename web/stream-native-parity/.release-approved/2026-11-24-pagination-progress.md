# STREAM Web catalog pagination — 2026-11-24

Scope: official Web service f109c5f9-b81d-460d-81e5-175cc9b3df18 only. No Android, media worker, subscription or database changes.

PR #865 merged at 09e94b8efc513f889b44ce9ef0581e07ee98cdf9. Keep pagination progressing on duplicate-only pages with an advancing cursor. Reject invalid or stalled cursors and preserve existing content and retry controls.

PR CI: official Web 45378345541 SUCCESS, fast first picture 45378345704 SUCCESS, dual engine 45378345487 SUCCESS, encoder capacity 45378345577 SUCCESS, media backpressure 45378345821 SUCCESS, VOD slot handoff 45378345591 SUCCESS. Android CI 45378345579 FAILED and is outside this Web-only rollout. Docker must pass all nineteen regression tests before promotion. Physical-device performance remains unverified.
