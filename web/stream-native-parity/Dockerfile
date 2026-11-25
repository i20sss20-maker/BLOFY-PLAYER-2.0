FROM oven/bun:1-debian
WORKDIR /app
COPY package.json /app/package.json
RUN bun install --no-save
COPY server.ts web-profile-key.mjs catalog-page-cache.mjs catalog-array-reader.mjs index.html app.js profile-transfer.js playback-acceptance.js styles.css manifest.webmanifest stream-icon.svg sw.js /app/
COPY manual-preview-fix.mjs /app/
RUN bun run ./manual-preview-fix.mjs
COPY poster-recovery.test.mjs catalog-refresh.test.mjs catalog-array-reader.test.mjs search-memory.test.mjs category-cache.test.mjs pagination-progress.test.mjs live-manifest-retry.test.mjs /app/
RUN bun test ./poster-recovery.test.mjs ./catalog-refresh.test.mjs ./catalog-array-reader.test.mjs ./search-memory.test.mjs ./category-cache.test.mjs ./pagination-progress.test.mjs ./live-manifest-retry.test.mjs
COPY qa/live-audio-picture-progress.test.mjs qa/local-engine-qoe.test.mjs qa/visual-outage-qoe.test.mjs qa/fast-start-first-picture.test.mjs qa/logout-media-stop.test.mjs /app/qa/
RUN bun test ./qa/live-audio-picture-progress.test.mjs ./qa/local-engine-qoe.test.mjs ./qa/visual-outage-qoe.test.mjs ./qa/fast-start-first-picture.test.mjs ./qa/logout-media-stop.test.mjs
COPY Dockerfile /app/Dockerfile
COPY qa/playback-acceptance.test.mjs /app/qa/
RUN bun test ./qa/playback-acceptance.test.mjs
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium ffmpeg && rm -rf /var/lib/apt/lists/*
COPY qa/synthetic-direct-browser.mjs /app/qa/
RUN bun run ./qa/synthetic-direct-browser.mjs
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun","run","/app/server.ts"]
