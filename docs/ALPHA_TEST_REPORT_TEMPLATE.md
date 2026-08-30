# BLOFY PLAYER 2.0 — Alpha Test Report

Copy this template for every test round. Use one report per commit/APK build.

## Build
- Commit SHA:
- APK: standard / FFmpeg
- Artifact name:
- FFmpeg shown in Settings: yes / no
- Test date:

## Device
- Device/model:
- Android version:
- TV / receiver / phone / tablet:
- Network: Wi-Fi / Ethernet / mobile:
- Approx. connection speed if known:

## Provider
- Provider label: Server 1 / Server 2 / Server 3
- Provider type: Xtream / M3U
- Live profile: TS / HLS
- Transport: Cronet / HTTP
- Redirects: on / off

## Startup / local-first
- First sync completed: pass / fail
- Stuck near 95%: no / yes, duration:
- Warm Connect after restart opened local data immediately: pass / fail
- Unexpected catalog reload on ordinary Connect: no / yes

## Live TV
For each tested channel record:

| Channel | SD/HD/FHD/4K | Preview TTFF | Fullscreen TTFF | Result | Buffering | Error |
|---|---|---:|---:|---|---:|---|
| | | | | | | |

- First/saved preview: pass / fail
- CH+/CH-: pass / fail
- Numeric entry: pass / fail
- Return focus/preview: pass / fail
- EPG now/next: pass / fail / unavailable
- Catch-up: pass / fail / unavailable
- Audio tracks: pass / fail
- Subtitles: pass / fail
- Quality selector: pass / fail / unavailable
- 20 rapid switches: pass / fail
- Network disconnect/reconnect: pass / fail

## Movies
| Movie | Resolution/codec | TTFF | Result | Resume | Audio/Subs | Error |
|---|---|---:|---|---|---|---|
| | | | | | | |

- Details before playback: pass / fail
- Start from beginning: pass / fail
- Resume: pass / fail
- 4K/HEVC: pass / fail / unavailable
- Same-URL retry bounded to one: pass / fail / not observed
- External fallback after terminal error: pass / fail / not observed

## Series
- Series tested:
- Seasons ordering: pass / fail
- Episodes ascending: pass / fail
- Episode TTFF:
- Resume: pass / fail
- Previous/Next: pass / fail
- Auto Next after natural completion: pass / fail
- Continue Watching points to correct episode: pass / fail
- 4K/HEVC episode: pass / fail / unavailable

## FFmpeg audio validation
Use the FFmpeg APK only.

| Codec | Sample | Audible audio | A/V sync | Result |
|---|---|---|---|---|
| AAC | | | | |
| AC3 | | | | |
| EAC3 | | | | |
| DTS/dca | | | | |
| TrueHD | | | | |

## Remote / focus
- Home D-pad/OK/Back: pass / fail
- Browser fast scroll: pass / fail
- No invisible/dead-end focus: pass / fail
- Details buttons: pass / fail
- Seasons/Episodes navigation: pass / fail
- Settings restores last focus: pass / fail
- Provider Manager restores provider/action focus: pass / fail
- Player HUD controls: pass / fail

## Activation / portal
- Fresh-device trial: pass / fail / backend not deployed
- Active: pass / fail
- Expired denied: pass / fail
- Blocked denied: pass / fail
- Wrong activation code denied: pass / fail
- Valid offline cached entitlement: pass / fail
- Expired cached entitlement denied: pass / fail
- Portal playlist sync: pass / fail
- Remote provider profile applied only to this provider: pass / fail

## Stability
- 10-minute Live session buffering count:
- 200+ item scroll: pass / fail
- 30 player enter/exit cycles: pass / fail
- Background/resume: pass / fail
- Force-stop/cold start: pass / fail
- Crash/freeze observed: no / yes

## Failure record
Duplicate this section for each issue.

- ID:
- Screen/content:
- Exact steps:
- Expected:
- Actual:
- TTFF / buffering:
- Error text/code:
- Reproducible: always / sometimes / once
- Same item works in another IPTV app: yes / no / not tested
- Screenshot/video/log available: yes / no
- Notes:

## Final result
- Server 1 core Live/Movie/Series: pass / partial / fail
- Server 2 core Live/Movie/Series: pass / partial / fail
- Server 3 core Live/Movie/Series: pass / partial / fail
- Standard APK recommendation: pass / hold
- FFmpeg APK recommendation: pass / hold
- Blocking issues before wider Alpha:
