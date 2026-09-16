# Google Play — App Access / Review Instructions

## Access model

BLOFY PLAYER does not require an email/password account to open the app. On a fresh install the app creates its BLOFY Device ID/pairing credential locally and the activation service registers the normal evaluation period on first check. No OTP is required.

The app is a media player and does not bundle channels, movies, or a content subscription. Reviewers can test playback with the public review playlist below; it contains Apple's developer HLS test stream only.

## Reviewer test playlist

M3U URL:

`https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/docs/google-play/reviewer-sample.m3u`

The playlist contains Apple's HLS Bip Bop developer test stream. It is supplied only to let the reviewer exercise BLOFY's player/navigation without using customer credentials or paid third-party content.

## Review steps

1. Launch BLOFY PLAYER. No email/password/OTP is required.
2. Allow the initial activation check to complete. A fresh review installation receives the normal evaluation access shown by the app.
3. Open Playlists / Servers and choose Add playlist.
4. Select M3U and paste the reviewer M3U URL above.
5. Connect/save the playlist and open the test item to verify playback.
6. Device/playlist management through BLOFY's connection portal is optional for the review and is not required to start the supplied test stream.

## Billing note

The Google Play build is consumption-only. It does not show license plans, price selection, checkout, or external payment buttons inside the app. Existing activation status/recovery remains available. A BLOFY player license never includes content.

## If Google requests access after the evaluation period

Do not use a real customer's account and do not add a hidden reviewer bypass. Extend or create a dedicated review license through the normal BLOFY administration flow for the review Device ID shown by the installed app, then provide only the minimum review instructions required by Play Console.
