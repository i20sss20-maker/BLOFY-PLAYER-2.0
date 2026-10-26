FROM node:20-alpine
WORKDIR /app
ENV PUBLIC_ADMIN_PREFIX=/releases-admin
COPY package.json ./
RUN apk add --no-cache unzip && npm install --omit=dev
COPY cinematic-v74.mjs cinematic-v74-patch.mjs cinematic-v74-remote.mjs cinematic-v74-display.mjs server.mjs admin-panel.mjs release-store.mjs app-library.mjs download-metrics.mjs public-site-redirect.mjs public-search-pages.mjs app-download-policy.mjs ./
RUN npm run check:syntax
EXPOSE 3000
CMD ["npm","start"]
