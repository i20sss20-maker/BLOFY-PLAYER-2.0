# STREAM Web search memory — 2026-11-24

Web-only release, service f109c5f9-b81d-460d-81e5-175cc9b3df18. No Android, media worker, account, or database changes.

PR #862 merged at 2e1db4a7800e93492a5f24e278fb818f175d52e9. Bound retained search results to 20 per content kind and distinguish failures from genuine empty results. Existing listing caches preserved.

PR CI: official Web 45376452912 SUCCESS, media backpressure 45376452915 SUCCESS, dual engine 45376453399 SUCCESS, first picture 45376452979 SUCCESS, encoder capacity 45376452948 SUCCESS. Android CI 45376453132 FAILED, outside web-only rollout. Docker must pass all thirteen targeted tests before promotion. Physical device performance remains unverified.
