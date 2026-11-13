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
COPY test/stream-media-quality.test.mjs ./test/stream-media-quality.test.mjs
RUN node --test test/xtream-licensed-live-fanout.test.mjs test/xtream-shared-pilot-registry.test.mjs test/xtream-playback-metrics.test.mjs
RUN node --test test/stream-media-quality.test.mjs
# Same-code device re-entry must not create new accounts or extend expiry.
COPY test/xtream-code-commercial.test.mjs ./test/xtream-code-commercial.test.mjs
COPY test/xtream-duration-codes.test.mjs ./test/xtream-duration-codes.test.mjs
COPY test/xtream-code-relogin.test.mjs ./test/xtream-code-relogin.test.mjs
RUN node --test test/xtream-code-commercial.test.mjs test/xtream-duration-codes.test.mjs test/xtream-code-relogin.test.mjs
# Validate multi-season Xtream episode normalization before deploying.
# This diagnostic must agree with the playable episode resolver.
COPY test/xtream-series-resolver.test.mjs ./test/xtream-series-resolver.test.mjs
COPY test/xtream-series-probe-normalization.test.mjs ./test/xtream-series-probe-normalization.test.mjs
RUN node --test test/xtream-series-resolver.test.mjs test/xtream-series-probe-normalization.test.mjs
# No distributor deployment unless credit, auth and ownership tests pass.
COPY test/stream-distributors.test.mjs ./test/stream-distributors.test.mjs
RUN node --check src/stream-distributors.mjs && node --check src/xtream-admin-hook.mjs && node --test test/stream-distributors.test.mjs
# Ship no experimental catalog enforcement without scoped auth, bounded
# hidden selections, and backward-compatible disabled-by-default checks.
COPY test/xtream-distributor-customer-catalog.test.mjs ./test/xtream-distributor-customer-catalog.test.mjs
RUN node --check src/xtream-distributor-customer-catalog.mjs && node --check src/xtream-gateway-hook.mjs && node --test test/xtream-distributor-customer-catalog.test.mjs
# Bounded one-shot saleh media feasibility diagnostic must pass safety tests;
# this never fetches provider data during Docker build.
COPY test/xtream-saleh-copy-capability.test.mjs ./test/xtream-saleh-copy-capability.test.mjs
RUN node --check src/xtream-saleh-copy-capability.mjs && node --check src/xtream-gateway-hook.mjs && node --test test/xtream-saleh-copy-capability.test.mjs
EXPOSE 8080
CMD ["npm","start"]
