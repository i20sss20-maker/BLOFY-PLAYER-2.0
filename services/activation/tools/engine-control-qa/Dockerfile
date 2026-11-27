FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-client ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/activation/src/blofy-engine-status-ssh-qa.mjs services/activation/src/blofy-engine-status-response.mjs ./src/
COPY services/activation/tools/engine-control-qa/run.mjs ./tools/engine-control-qa/run.mjs
USER node
CMD ["node","tools/engine-control-qa/run.mjs"]
