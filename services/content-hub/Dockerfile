FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# Private sample-only codec checks; Docker build fails if ffprobe is missing.
RUN apk add --no-cache ffmpeg && ffprobe -version >/dev/null && ffmpeg -version >/dev/null
COPY package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY test ./test
# Build is fully offline from provider Xtream / BLOFY live data.
RUN npm test && node --check src/server.mjs && node --check src/private-s3.mjs
USER node
EXPOSE 3000
CMD ["node","src/server.mjs"]
