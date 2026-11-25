# Linode media rollout: remaining production gates

The Railway activation gateway remains authoritative for accounts and catalog IDs.
The existing customer path remains unchanged. No production traffic switches in this PR.

## Evidence and limitations

- Linode heartbeat over HTTPS is an operational signal, not a playback proof.
- The QA catalog mirror published revision 445 with 57,347 live entries,
  185,006 movies and 50,643 series. This is metadata only, not stored video.
- The QA mirror polls once per minute after its previous run, throttles full rebuilds
  to at least 15 minutes apart and keeps the last good snapshot on failed imports.
  It is scoped to one temporary account and is not a production entitlement cache.
- An offline synthetic MPEG-TS timing regression exists; the live recovery path
  must still be tested on the host before activation. No seamless claim.
- A reported source quota of one is not one *available* slot. Existing manual
  approval flags on the legacy relay do not prove the grant covers Linode.

## Go/no-go checklist in order

1. Confirm source-specific distribution permission covers the intended new host
   and test usage. Verify an independently allocated test feed or authoritative
   capacity reservation across all paths. Never open an additional provider feed
   when the only slot is in use, or retry around upstream refusals.
2. Rotate the exposed QA credential through the existing operator flow and replace
   its local secret securely. Use a dedicated scoped account with a known expiry.
   Do not put credentials in shell history, Git, URLs in logs, or chat.
3. Validate the current draft against the target branch with CI. Keep all Linode
   canary flags unset until authorized. The mapping QA endpoint is read-only;
   exercise it with one authorized Xtream account and a separate device-bound
   STREAM test code, covering live/movie/series/episode and hidden/deleted items.
4. Implement and verify the real reservation authority and session lifecycle
   (including revocation, expiry, idempotent release and uncertain outcomes).
   Do not wire the policy-only helpers to actual customer routing until this exists.
5. On synthetic content, confirm rolling playback across forced source recovery
   on actual Linode, HLS client playback, sound/video and monotonic sequence.
   Then verify one permitted real feed only, using the dedicated test allocation.
6. Validate VOD range requests and seeking on an authorized sample; do not infer
   movie or episode media availability from metadata. Check catalog revision
   changes, removal, pause and failed import on the QA mirror.
7. Perform a capped external synthetic load test (1, 10, 25, 50, 100, 150 clients)
   with stop conditions for bandwidth, errors and resource saturation. Local
   HTTP concurrency alone does not establish internet playback capacity.
8. Begin one explicitly selected owner account canary only after the preceding
   gates pass. Do not switch ordinary subscribers until external device playback
   and monitored rollback are verified.

## Rollback

Disable new admissions first. Reconcile any uncertain or committed reservation
with the authoritative capacity owner and confirm release and legacy admission
before opening another feed. Expiry alone is not proof a source connection ended.
Retain the existing customer routes and previous successful catalog snapshot.
No bulk migration, database reset, DNS switch, or provider quota increase is
authorized by this checklist.
