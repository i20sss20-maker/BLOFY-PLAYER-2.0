# rc07.16 runtime recovery candidate

The rc07.15 recovery build passed automated checks, but device testing still showed
blank catalog screens for minutes after import and slow category selection.
The recovery branch and PR #46 remain experimental and unmerged.

## Catalog changes

- Add database v11 indexes matching the provider/kind/category rowid cursors.
  Preserve all rows, rowids, saved providers, search rows, favorites and resume data.
- Read bounded, indexed Home candidates before loading full stream metadata.
  Retain the existing newest-first, NULL-as-zero date ordering and name tie-break;
  add a stable key tie-break for otherwise identical titles.
- Keep provider decryption off the main thread. Home and poster catalogs use
  stored display metadata/identity without decrypting credentials. Cache only
  successful decryptions by exact ciphertext, with at most 16 entries.
- Increase the experimental app version to 2.0.0-rc07.16 / 2000024.

`tools/check_catalog_queries.py` runs the actual DAO queries against 200,000
synthetic rows, including unrelated providers, rare categories and missing dates.
It checks results against unoptimized reference queries and bounds SQLite VM work.
This check now runs in Android CI; it does not contact any content provider.
Room tests additionally exercise cursor completeness and the v10 -> v11 upgrade.
Synthetic timings are not promises about TV hardware or physical-device acceptance.

## Hidden Host investigation — unresolved

On 2026-09-08, production logs showed 29 HTTP 511 responses from subscriber Live
requests (both TS and HLS). A limited HLS inspection also returned 511 with an
empty response. The account API returned HTTP 200, auth=1, status=Active,
active_cons=0, max_connections=1, and allowed formats m3u8/ts/rtmp.
There were no clustered application runtime exceptions in the inspected window.

These observations establish a playback request failure despite successful account
authentication. They do not establish whether the upstream rejects the hosting
network, request headers, stream entitlement or another provider-specific condition.
Do not relabel 511 as success or expose the private origin to work around it.

Automatic approval review initially rejected a compatibility probe. The user then
explicitly approved the limited test through the existing BLOFY production gateway.
On 2026-09-08 at 22:46-22:48 UTC, three HLS User-Agent variants and HLS/TS without
Range all returned HTTP 511 with zero bytes. The account API remained active.
The user subsequently approved centrally managed direct connections; see
`SUBSCRIBER_DIRECT_CONNECTION.md` for the rc07.17 contract and acceptance gates.
Session tokens, provider hosts, passwords and full credential-bearing URLs are
excluded from this document.

## Delivery and acceptance

Build and verify the experimental APK with the existing production certificate;
retain the native FFmpeg artifact and all playback engines/routes and theme files.
The recovery experiment remains separate from commercial release promotion.
The signed production workflow's branch gate is not changed.
Install over the existing package without clearing app data. The first upgrade
creates three indexes once; confirm subsequent Home/category entry on the TV.
Hidden Host playback remains an explicit unresolved item.
