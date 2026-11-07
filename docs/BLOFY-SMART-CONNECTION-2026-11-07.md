# BLOFY Smart Connection — Official Deployment

## Problem identified
An Xtream provider responds to the customer's separate IPTV player but BLOFY's Railway origin periodically records `xtream_transport_connection_reset`. This does not prove source blocking, account expiry, or a Railway outage. Two different Xtream sources should never be conflated.

## Implemented
- Authorized admin per-source `POST /api/v1/admin/xtream/servers/:id/smart-connection` runs **one read-only account API GET** on the **saved source** from the BLOFY production Railway service. The probe is limited to 8 seconds, does not retry, and is throttled to one per source per 30 seconds.
- Reports a fixed, credential-free Arabic diagnosis for DNS, TCP refusals/resets, timeout, TLS issues, 401/403/404/429/456 and invalid account responses.
- The report explicitly distinguishes API accessibility from playable media, and marks static outbound IP status as **not checked**. No sample video is fetched or republished.
- Works in both `/sources-admin#xtream` (button in each source card) and native `/api/v1/admin/xtream/controls` (form works without JavaScript). Native results are stored only in process memory for up to 10 minutes; they are not saved to subscribers or provider credentials.
- The native controls page also translates known historic raw provider errors into fixed Arabic text.
- All runtime source/account tables, catalog records, media routes, and customer subscriptions stay unchanged.

## Operational test sequence (approved sources only)
1. Open the direct controls page; choose **تشخيص الاتصال الذكي** under the troubled source, not the other source.
2. Compare the returned category with the same account playing in another app; different networks may have different access conditions.
3. If the provider confirms an IP-based allowlist is necessary, choose a supported Railway Pro Static Outbound IP for the activation portal and provide that IP to the provider **for approval**. Do not enable IPv6 egress or proxy rotation as a workaround.
4. After allowlist approval, retest account API, sample live, movie, episode, Range seeking, then monitor connection resets and limits.
5. Only after verified end-to-end playback and re-stream rights, consider routing customer playback through MediaMTX. Its current network listener alone is not a playback test.

## Static outbound IP limitations
Railway documents the feature for Pro customers. No connected Railway action currently available in this conversation can enable or inspect the static IP directly, so **it was not enabled or billed**. A static IP does not itself guarantee source access. Provider consent and real transport tests are necessary.

## Rollback
The previous working production code is pinned at `5cc6547fb933b61ed475c2d8454ceb41b0e42a56`. Re-deploy it to restore the former Xtream control interface without modifying Postgres.

## Test coverage
`services/activation/test/xtream-smart-connection.test.mjs` checks stable error classifications, report sanitation, source-only bounded GET and access protection, both UIs, and clear separation of connectivity from media.
