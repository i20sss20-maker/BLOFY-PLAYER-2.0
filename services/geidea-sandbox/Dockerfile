FROM node:24-alpine
WORKDIR /app
# Build context is the repository root. Copy only the test client and this
# service; the production bootstrap, schema and activation backend are absent.
COPY services/activation/src/geidea-preflight.mjs services/activation/src/geidea-sandbox-client.mjs ./services/activation/src/
COPY services/geidea-sandbox/package.json ./services/geidea-sandbox/package.json
COPY services/geidea-sandbox/src ./services/geidea-sandbox/src
COPY services/geidea-sandbox/web ./services/geidea-sandbox/web
RUN mkdir -p /data
EXPOSE 8080
CMD ["node", "services/geidea-sandbox/src/server.mjs"]
