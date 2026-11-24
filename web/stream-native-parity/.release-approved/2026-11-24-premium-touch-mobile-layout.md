# BLOFY STREAM Web — Premium Phone-first Interface

Approved on 2026-11-24 Asia/Riyadh. PR #888 merged into the release branch as `c70c5c6292e188f79d4557e7d39f8c01cb941b2a`.

## Device-scoped changes
- On narrow **touch** devices only (≤730px), catalog pages (Live, Movies and Series) now retain the same accessible horizontally-scrollable bottom navigation from Home, with aria-current on active section. This is added only for touch mobile at shell creation. Desktop and Toshiba/VIDAA TV catalog DOM retains no rail/sidebar, as confirmed by existing browser regression.
- Mobile toolbar, home hero, quick shortcuts, poster cards, category chips, live channel rows, login input and safe areas are optimized for 320px and 390px and avoid horizontal document overflow.
- The existing live preview moves **above** the channel list on mobile. Its video stays the same 16:9 element; tapping an explicit channel scrolls to that same preview with no extra player, transcoder request or HLS session. The categories remain horizontal and the channel list becomes touch-scrollable.
- Details, episode lists and settings are single-column/phone-friendly; desktop/TV/D-pad/audio/more advanced actions remain unchanged.
- The change is CSS/presentation with two small app shell event/navigation enhancements. It does not alter Xtream credentials, playback authorization, source URLs, HLS/MPEG-TS/VOD engines, FFmpeg worker capacity, activation or payments.

## Verification and limitations
- PR #888 official Web browser+remote release QA **SUCCESS** on exact PR head `c8cb7241dabe2c58572d6fb4d9118e631de0a3cd`. All 35 previous Chrome remote/UI tests and new mobile Chrome 320px/390px, catalog nav, preview ordering, no horizontal overflow and desktop isolation QA PASSED.
- Live first picture, first playable segment, video-freeze guard, dual-engine recovery, VOD transcoder handoff, capacity/backpressure checks all **SUCCESS** on same head.
- Unrelated Android CI **FAILURE** (native Android verification); no Android builds or submissions are touched.
- **No actual 20-minute iPhone/VIDAA/STC Wi-Fi subscribed playback acceptance**; browser QA does not certify device-specific stability or WebKit native fullscreen.

## Production deployment safety
- Deploy only Railway `blofy-stream-web` service id `f109c5f9-b81d-460d-81e5-175cc9b3df18`, project `eeff35dc-1754-4f1e-92d7-e28473401453`, production `a9a26993-0cec-410d-83dc-2f14a2e47045`.
- Leave `blofy-stream-web-media` id `63d4951c-4cda-4879-97cb-01c6700e02c7` and VOD pilot completely untouched. Do not deploy native apps, restart databases or change customer subscriptions.
- Roll back Web-only to last successful commit `7419cd3ecafeac4fdcb79a76e24328d2887cddc6`, deployment `8cece86f-079d-432b-86f3-e959585ddc41`.
