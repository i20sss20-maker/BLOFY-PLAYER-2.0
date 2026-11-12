# BLOFY STREAM 55.8.14 — Android 9 audio acceptance (owner QA)

This guide is for a **physical Android 9 TV/TV box** owned by the tester and a source the tester is authorized to play. CI/emulator results and the FFmpeg APK build do not establish that audio is audible on the real TV.

## Keep the customer release safe

- Do **not** uninstall or overwrite the installed production `tv.blofy.player.v2.stream`.
- Use the side-by-side `streamCodeDemo` APK from the successful [55.8.14 Android 9 audio QA workflow](https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/actions/workflows/stream-55-8-14-audio-qa.yml). Its package is `tv.blofy.player.v2.stream.qa`.
- APK from Actions is a **debug/QA build**, not the production owner-signed package. Do not publish it to clients.
- Use a test activation code. Do not share the code, upstream URL, playlist, passwords or full logcat.
- Connect ADB only through USB or a trusted local connection. Never expose ADB to the public internet.

## Check on the real device

1. Download the QA workflow artifact, extract the APK, and install on the authorized Android 9 box (Android Platform Tools / `adb install -r path-to-qa.apk`).
2. Launch the **QA** app. Confirm that regular BLOFY STREAM is still installed and that the new app is a separate test package.
3. Play authorized live MPEG-TS and HLS channels for 5–10 minutes each. Include samples known to contain AAC, MP2 and AC3/EAC3 audio where rights permit. Open the audio selector with the D-pad. Listen on the TV, not just for video frames.
4. For each channel record an anonymized label, whether video rendered, whether sound was actually audible, rebuffer/disconnect count, and whether another supported audio track solved it.
5. Also play a permitted movie (seek, resume, subtitles) and permitted series episode (next/previous, autoplay), recording both picture and sound.
6. On the computer with Python 3 and Android Platform Tools, with **exactly one** authorized box connected, run:

   ```shell
   python tools/stream-audio-device-qa.py --out blofy-stream-device-audio-qa.json
   ```

   The JSON intentionally contains **no** device serial, account ID, provider URL, username, password or raw log lines. It reports discovered/selected codec metadata only. `audibleAudioVerified` remains `false` until a technician actually listens.

## Interpret the audio diagnosis

- `NO_AUDIO_TRACK`: no audio track was found; this alone does not prove the upstream never carried audio.
- `UNSUPPORTED_AUDIO_CODEC`: audio exists but the decoder on this installation/device cannot handle it. The detected MIME is reported when Media3 exposes it.
- `SUPPORTED_NOT_SELECTED`: a decoder says a track is supported but not selected. QA may select it **once** without restarting playback or opening another upstream session.
- `PLAYER_VOLUME_MUTED`: check software/hardware volume.
- `AUDIO_TRACK_SELECTED`: a supported track is selected; **audibility still is not verified**. Check HDMI/passthrough/TV settings.

Stop the trial if the source denies access or the subscription limit is exceeded. Never retry provider 401/403/456 as if they were transient networking problems.

## Release gates

Do not mark Android 9 audio fixed until the tester records **actual audible output** on the affected box, and do not publish 55.8.14 until package/signing identity, end-device upgrade/rollback, code activation, remote focus, movie/series audio and previous subscriptions are verified.
