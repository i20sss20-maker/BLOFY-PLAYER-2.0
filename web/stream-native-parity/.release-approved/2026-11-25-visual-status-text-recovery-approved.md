# BLOFY STREAM Web — approved visible status text recovery for VOD and live

Date: 2026-11-25 Asia/Riyadh.
Approval: PR #897, merge SHA `fbdb0c1f1976dbc26af2794cc64c760d84a29001`.

## User incident
Subscribers report Arabic loading/reconnection/error copy remaining on top of live TV, episodes, MP4 movies and HLS films while decoded video continues. Safari/TV may resume without another `playing` event, and full/legacy VOD wrote waiting text immediately without a reliable clearing condition. Error notices were also laid out differently from loading text and could obscure video.

## Approved scope
- All full-screen engines share a visual observer based on decoded/presented frames, plus a limited time-and-dimensions fallback only when video-frame APIs are absent. It never initiates another media request/FFmpeg job. Direct HTML5 MP4 uses a local observer record without a media-worker session.
- Clear stale Arabic loading/retry/error overlays **only on proven picture progress**; do not dismiss on mere audio clock updates, paused user, background tab, seek or source switch. Require two evidence samples before clearing a prior error.
- Give VOD HLS 1.6-second transient buffering grace and cancel old buffering timers on a fresh `playing` event or playback teardown.
- Do not let repeated VOD `waiting` events reset the 72-second stuck-source recovery timer forever; only real video progress suppresses fallback.
- On iOS, dismiss the gesture-to-start prompt once pictures actually resume, and stop presenting the preliminary MP4 loading state on moving video.
- Center and limit long status/error overlay text without shifting video. Preserve all playback controls, other engine/session policies, account privacy and Xtream credentials.

## Evidence / QA
PR #897 head `67cef0bc4e07c43cf66c8bf3bcfb8e79dad7103f`:
- Official Web Chrome/TV QA #45495884749 SUCCESS, including new live and VOD overlay recovery test.
- Live-first segment #45495885111 SUCCESS; First picture #45495885147 SUCCESS; Video freeze guard #45495884741 SUCCESS; Dual-engine #45495885335 SUCCESS; VOD handoff #45495884892 SUCCESS; Media backpressure #45495884800 SUCCESS; encoder evidence #45495884820 SUCCESS.
- Android CI #45495885173 FAILED independently, Android code unchanged. No Android production deployment.
- Actual sustained authorized playback on physical iPhone/Toshiba is NOT yet confirmed. Railway HTTP traces also showed real upstream 502/503 in a live manifest and worker `live_source_finished` events: UI fixes do not guarantee source availability. Treat this as a separately monitored origin issue.

## Safe rollout / rollback
Deploy only Railway `blofy-stream-web` service `f109c5f9-b81d-460d-81e5-175cc9b3df18` of `BLOFY-VIDAA-PREVIEW` project `eeff35dc-1754-4f1e-92d7-e28473401453`.
Keep web-media `63d4951c-4cda-4879-97cb-01c6700e02c7`, Xtream upstream, Android, payment, activation and PostgreSQL unchanged.
Last known good Web rollback deployment: `1b827c86-3a34-4507-aae8-04b5a92abafb` at commit `c5de6cf21d22a756e2ad8b697ef014d0321f1f5f`.
