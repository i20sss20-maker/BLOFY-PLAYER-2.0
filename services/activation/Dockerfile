FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY schema.sql ./schema.sql
COPY src ./src
COPY web ./web
# Block any deployment with broken shared-live licensing, two-code limits,
# redirect grants or source authorization. No provider network calls.
COPY test/xtream-licensed-live-fanout.test.mjs ./test/xtream-licensed-live-fanout.test.mjs
COPY test/xtream-shared-pilot-registry.test.mjs ./test/xtream-shared-pilot-registry.test.mjs
COPY test/xtream-playback-metrics.test.mjs ./test/xtream-playback-metrics.test.mjs
RUN node --test test/xtream-licensed-live-fanout.test.mjs test/xtream-shared-pilot-registry.test.mjs test/xtream-playback-metrics.test.mjs
# Same-code device re-entry must not create new accounts or extend expiry.
COPY test/xtream-code-commercial.test.mjs ./test/xtream-code-commercial.test.mjs
COPY test/xtream-duration-codes.test.mjs ./test/xtream-duration-codes.test.mjs
COPY test/xtream-code-relogin.test.mjs ./test/xtream-code-relogin.test.mjs
RUN node --test test/xtream-code-commercial.test.mjs test/xtream-duration-codes.test.mjs test/xtream-code-relogin.test.mjs
EXPOSE 8080
CMD ["npm","start"]
