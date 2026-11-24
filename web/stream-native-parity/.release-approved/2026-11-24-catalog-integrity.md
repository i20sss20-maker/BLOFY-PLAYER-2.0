# STREAM Web catalog integrity release — 2026-11-24

Scope: official Web service f109c5f9-b81d-460d-81e5-175cc9b3df18 only. No Android, media worker configuration, account or database changes.

PR #859 merged at 6c7a288c4f06eb0dd3cc3e1e365786c6fcafa805. Incremental page parser rejects malformed, truncated and oversized catalog documents rather than caching incomplete lists. Preserve early termination only after a complete extra matching item proves pagination.

PR CI: official Web release 45374012087 SUCCESS; fast first picture 45374012122 SUCCESS; dual-engine recovery 45374012288 SUCCESS; media backpressure 45374012116 SUCCESS. Android CI 45374012093 FAILED and is outside this web-only rollout; no Android changes in this PR. The Docker build must pass all ten targeted poster, refresh and catalog-parser tests before promotion. Actual production rollout and physical TV playback are not yet verified.
