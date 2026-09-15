#!/usr/bin/env sh
set -eu

FQDN="${1:-}"
if [ -z "$FQDN" ]; then
  echo "Usage: ./init-env.sh <azure-fqdn>" >&2
  exit 1
fi

if [ -e .env ]; then
  echo ".env already exists; refusing to overwrite secrets." >&2
  exit 1
fi

POSTGRES_PASSWORD="$(openssl rand -base64 36 | tr -d '\n/=+' | cut -c1-40)"
ADMIN_TOKEN="$(openssl rand -hex 32)"
PLAYLIST_KEY="$(openssl rand -hex 32)"

umask 077
cat > .env <<EOF
AZURE_FQDN=$FQDN
POSTGRES_DB=blofy
POSTGRES_USER=blofy
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
BLOFY_ADMIN_TOKEN=$ADMIN_TOKEN
BLOFY_PLAYLIST_ENCRYPTION_KEY=$PLAYLIST_KEY
BLOFY_TRIAL_DAYS=7
EOF

chmod 600 .env
printf '%s\n' "Created infra/azure/.env with mode 600." "Do not copy this file into Git or chat."
