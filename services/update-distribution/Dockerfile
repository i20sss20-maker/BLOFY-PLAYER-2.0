FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs admin-panel.mjs release-store.mjs ./
EXPOSE 3000
CMD ["npm","start"]
