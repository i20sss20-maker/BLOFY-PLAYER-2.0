# BLOFY PLAYER 2.0 — rc07.11 worklog

Branch: `rc07.11-data-remote-stability`
Base: `rc07-commercial-stability` @ `1ebe292bb90d47e9db55d60ee7e1dbc863fe4c24`

## Product constraints
- Keep Media3, FFmpeg, fallback engine routing, and current theme unchanged.
- Poster/content pane may start at the first item; previous poster focus persistence is not required.

## Implemented
- Catalog search installation moved to the resumed/ready screen root so Live, Movies, and Series keep the search control after `setContentView()`.
- TV search focus handoff is integrated with the existing two-pane focus guard without stacking `Window.Callback` wrappers.
- DPAD cross-pane focus keeps first-item behavior and uses a bounded attach wait for slow off-screen RecyclerView binding.
- Added provider-host resolver for M3U/direct-source URLs: only clearly private/local/internal hosts are replaced with the public provider host; public CDN hosts remain untouched.
- M3U `get.php` compatibility now tries bounded `m3u_plus` output variants (`ts` and `m3u8`) only when the supplied URL is genuinely Xtream-style and already contains username/password.
- Added tests for safe internal-host rewriting and safe M3U URL variant generation.
- Added VOD/episode seek-stall recovery around the existing Media3 session. It retries the same MediaItem/engine at the current seek position after a bounded buffering stall; it does not switch engine merely because the user seeks.

## Existing behavior verified and retained
- Catalog refresh is staged under a temporary provider ID and promoted transactionally; failed refreshes discard staging and keep the known-good catalog.
- Large M3U/Xtream imports remain streaming/batched rather than loading whole catalogs into memory.

## Pending device validation
- Real provider that previously returned upstream HTTP 884.
- Real hidden/internal-host streams.
- Exit/re-entry with large Live/Movie/Series catalogs.
- Rapid DPAD navigation and search handoff on Android TV/box.
- Repeated seeks in VOD and episodes.
