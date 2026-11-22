FROM oven/bun:1-debian
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY index.ts /app/index.ts
ENV PORT=8080
EXPOSE 8080
USER bun
CMD ["bun","run","/app/index.ts"]
