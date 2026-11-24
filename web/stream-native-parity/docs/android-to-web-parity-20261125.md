# BLOFY STREAM Android → Web parity inventory (2026-11-25)

Source-of-truth Android files checked on the production-web release branch:
- `app/src/main/java/tv/blofy/player/ui/player/PlayerActivity.kt`
- `app/src/main/java/tv/blofy/player/ui/player/StreamArabicAudioCatalog.kt`
- `app/src/main/java/tv/blofy/player/ui/player/StreamArabicAudioSession.kt`
- `app/src/main/java/tv/blofy/player/ui/details/MovieDetailsActivity.kt`
- `app/src/main/java/tv/blofy/player/ui/details/SeriesDetailsActivity.kt`
- `app/src/main/java/tv/blofy/player/ui/library/DownloadsActivity.kt`

## Web parity
| Native capability | Current web status |
| --- | --- |
| Play/pause, 10s seek on VOD, previous/next episode | Already implemented |
| Previous/next LIVE channel, in-player channel list | Already implemented |
| Embedded audio language & subtitle tracks | Already implemented; subject to browser decoder/track APIs |
| Video quality options + source codec compatibility on older TVs | Already implemented; quality menu polished |
| Movie/series description and details, artwork, resume, favourites | Already implemented |
| VOD downloads | Draft download button and `التنزيلات` page; local request history only, backend gate off by default |
| Curated separate Arabic commentary sources | Draft `المعلقين` channel page + in-player choice panel; same activated-session proxy, original audio restore, account-scoped favourites & recently successful voices. Backend gate off by default |
| Original LIVE audio during source failure | Voice sidecar automatically restores primary track on error, end, switch, logout or close |
| Manual per-commentator audio offset, native drift correction | NOT ported; browser progressive companion playback timing differs from Android ExoPlayer |
| Separately sourced HLS commentator feeds | NOT enabled: requires authenticated manifest + segment rewrite, and device/browser acceptance |
| True offline library with download status, pause/resume and stored file player | NOT available from this browser-only implementation; download manager owns file; no false “download complete” badge |

## Production guards
- Current official `blofy-stream-web` Railway service remains on `release/blofy-stream-web-1-0-0-20261124`; do not change production service branch until acceptance.
- Both new backend gates default OFF: `BLOFY_WEB_VOD_DOWNLOAD_ENABLED` and `BLOFY_WEB_COMMENTARY_ENABLED` require explicit value `1`.
- No new third-party audio URL input, bearer leakage, or direct Xtream links in HTML.
- Validate LIVE continuity for 20+ minutes on iOS Safari, Android TV and Chromium while choosing/resetting a commentator, channel zapping, returning to original, and opening an unrelated VOD.
- Verify real licensed/commentary endpoints exist, audio can be decoded, and source-concurrent-connection limits permit the additional companion audio session before enabling.
- Test full-size movie download to an actual device without starving live viewers before enabling the download gate.
- Rollback: preserve active production release and deployment identifiers; no production deployment was performed as part of this draft.
