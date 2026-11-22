FROM oven/bun:1-debian
WORKDIR /app
COPY server.ts index.html app.js styles.css manifest.webmanifest /app/
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun","run","/app/server.ts"]
