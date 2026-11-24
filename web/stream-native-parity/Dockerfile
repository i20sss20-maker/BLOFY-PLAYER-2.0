FROM oven/bun:1-debian
WORKDIR /app
COPY package.json /app/package.json
RUN bun install --production --no-save
COPY server.ts hls-ios-live-profile.mjs web-profile-key.mjs catalog-page-cache.mjs catalog-array-reader.mjs index.html app.js profile-transfer.js playback-acceptance.js styles.css manifest.webmanifest stream-icon.svg sw.js /app/
# iPhone/PWA PNG icons were missing from previous production image despite
# routes and manifest existing in source: ship them with the local brand fonts.
COPY icon-192.png icon-512.png apple-touch-icon.png /app/
COPY fonts/ /app/fonts/
COPY poster-recovery.test.mjs catalog-refresh.test.mjs catalog-array-reader.test.mjs search-memory.test.mjs category-cache.test.mjs pagination-progress.test.mjs /app/
RUN bun test ./poster-recovery.test.mjs ./catalog-refresh.test.mjs ./catalog-array-reader.test.mjs ./search-memory.test.mjs ./category-cache.test.mjs ./pagination-progress.test.mjs
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun","run","/app/server.ts"]
