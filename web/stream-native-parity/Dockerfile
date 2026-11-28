FROM oven/bun:1-debian
WORKDIR /app
COPY package.json /app/package.json
RUN bun install --production --no-save
COPY server.ts approved-m3u-catalog.mjs approved-m3u-loader.mjs external-playlist-policy.mjs playlist-preview.html playlist-preview.js playlist-preview.css direct-provider-entry.mjs vod-download-policy.mjs ops-dashboard.html ops-dashboard.js catalog-flights.mjs audio-worker-policy.mjs web-security-controls.mjs commentary-catalog.mjs web-profile-key.mjs catalog-page-cache.mjs catalog-array-reader.mjs index.html app.js profile-transfer.js playback-acceptance.js styles.css manifest.webmanifest stream-icon.svg apple-touch-icon.png icon-192.png icon-512.png sw.js /app/
COPY fonts/ /app/fonts/
COPY manual-preview-fix.mjs /app/
RUN bun run ./manual-preview-fix.mjs
COPY poster-recovery.test.mjs catalog-refresh.test.mjs catalog-array-reader.test.mjs search-memory.test.mjs category-cache.test.mjs pagination-progress.test.mjs live-manifest-retry.test.mjs live-finished-session.test.mjs /app/
RUN bun test ./poster-recovery.test.mjs ./catalog-refresh.test.mjs ./catalog-array-reader.test.mjs ./search-memory.test.mjs ./category-cache.test.mjs ./pagination-progress.test.mjs ./live-manifest-retry.test.mjs ./live-finished-session.test.mjs
COPY qa/live-audio-picture-progress.test.mjs qa/local-engine-qoe.test.mjs qa/visual-outage-qoe.test.mjs qa/fast-start-first-picture.test.mjs qa/logout-media-stop.test.mjs /app/qa/
RUN bun test ./qa/live-audio-picture-progress.test.mjs ./qa/local-engine-qoe.test.mjs ./qa/visual-outage-qoe.test.mjs ./qa/fast-start-first-picture.test.mjs ./qa/logout-media-stop.test.mjs
COPY Dockerfile /app/Dockerfile
COPY qa/playback-acceptance.test.mjs /app/qa/
RUN bun test ./qa/playback-acceptance.test.mjs
COPY qa/pwa-shell-assets.test.mjs qa/installed-release.test.mjs /app/qa/
RUN bun test ./qa/pwa-shell-assets.test.mjs ./qa/installed-release.test.mjs
COPY qa/commentary-catalog.test.mjs qa/web-security-controls.test.mjs qa/audio-worker-policy.test.mjs qa/catalog-flights.test.mjs qa/control-plane-burst.test.mjs /app/qa/
RUN bun test ./qa/commentary-catalog.test.mjs ./qa/web-security-controls.test.mjs ./qa/audio-worker-policy.test.mjs ./qa/catalog-flights.test.mjs ./qa/control-plane-burst.test.mjs
COPY qa/native-56-0-3-login.test.mjs qa/native-vod-download.test.mjs qa/direct-provider-entry.test.mjs qa/approved-m3u-catalog.test.mjs qa/approved-m3u-loader.test.mjs qa/external-playlist-policy.test.mjs /app/qa/
RUN bun test ./qa/native-56-0-3-login.test.mjs ./qa/native-vod-download.test.mjs ./qa/direct-provider-entry.test.mjs ./qa/approved-m3u-catalog.test.mjs ./qa/approved-m3u-loader.test.mjs ./qa/external-playlist-policy.test.mjs
COPY audio-worker.ts /app/
RUN bun build audio-worker.ts --target=bun --outfile=/tmp/audio-worker-check.js && rm /tmp/audio-worker-check.js
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun","run","/app/server.ts"]
