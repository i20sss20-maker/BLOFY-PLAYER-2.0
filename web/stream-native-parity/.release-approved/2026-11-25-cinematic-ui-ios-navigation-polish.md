# BLOFY STREAM Web — cinematic UI / responsive iPhone and TV polish

Release approved: 2026-11-25 Asia/Riyadh.
PR #898 merged as `40a1ac96e846622b480cdf4811f91ca1dc5d4517`.

## Scope shipped
- First-party nine-route vector navigation icons (no CDN/webfont required), same destinations, clear selected focus and aria labeling.
- iPhone touch bottom tabs styled with readable labels, 44px minimum mobile toolbar touch targets, safe-area boundaries, and active selected-tab scroll into view.
- Consistent ocean/cyan STREAM cinematic palette on the home hero, movies and series poster cards, live categories and channels, metadata/details, search, settings, code-only login and playback HUD.
- iPhone live catalog shows the channel list *before* the optional preview; unused preview video placeholder collapses until manually requested. Existing preview logic, TV automatic previews and controlled live source handling remain unchanged.
- Mobile player visual clutter reduced; diagnostics and subtitle/audio/quality controls remain accessible via their existing buttons.
- RTL/320px narrow viewport, reduced motion, browser remote focus, error/overlay behavior protected.
- Remove inaccurate 'web under development' activation copy; no underlying activation change.

## QA and compatibility
Official Web Release 1.0 GitHub Actions #45498294825 — SUCCESS. Includes Chrome desktop/remote parity, 320/390px mobile layout, mobile preview and 9-route vector tabs, browser resilience, PWA status, CSS shape / safety regressions, iPhone/native HLS / media tests.
Secondary checks at head `4be2e5e56570a44fa8e879cbf97eb4b826323e28` all green for live first picture, freeze guard, VOD handoff, capacity/encoder evidence, dual engine and backpressure.
Independent Android CI FAILED and is not in this Web release; no Android build is touched.
No actual 20-minute iPhone playback acceptance is claimed. Provider-origin 502/503/source finish events are independent of design and remain separately monitored.

## Controlled Web-only rollout
Railway project BLOFY-VIDAA-PREVIEW `eeff35dc-1754-4f1e-92d7-e28473401453`;
only web service `blofy-stream-web` `f109c5f9-b81d-460d-81e5-175cc9b3df18`.
Rollback previous successful Web deployment:
`f069309f-d515-4191-bea4-4f939c70cebd`,
commit `bf799632929a97094f16daa8ea1aacea4aa89d39`.
Keep media worker `63d4951c-4cda-4879-97cb-01c6700e02c7`,
Xtream, Android, Windows, auth, payments and PostgreSQL untouched.
