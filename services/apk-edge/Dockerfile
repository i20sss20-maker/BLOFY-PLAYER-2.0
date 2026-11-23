FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs signed-release-policy.mjs stream-feed-cache.mjs ./
RUN node --check server.mjs && node --check signed-release-policy.mjs && node --check stream-feed-cache.mjs
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.mjs"]
