FROM oven/bun:1-debian
WORKDIR /app
COPY package.json /app/package.json
RUN bun install --production --no-save
COPY server.ts web-profile-key.mjs catalog-page-cache.mjs index.html app.js profile-transfer.js playback-acceptance.js styles.css manifest.webmanifest stream-icon.svg sw.js /app/
COPY poster-recovery.test.mjs /app/
RUN bun test ./poster-recovery.test.mjs
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun","run","/app/server.ts"]
