FROM node:20-alpine
WORKDIR /app
ENV PUBLIC_ADMIN_PREFIX=/releases-admin
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs admin-panel.mjs release-store.mjs app-library.mjs ./
EXPOSE 3000
CMD ["npm","start"]
