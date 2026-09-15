#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing infra/azure/.env. Run ./init-env.sh <azure-fqdn> first." >&2
  exit 1
fi

set -a
. ./.env
set +a

case "$AZURE_FQDN" in
  ""|*" "*) echo "AZURE_FQDN is invalid" >&2; exit 1 ;;
esac

if [ "${#BLOFY_PLAYLIST_ENCRYPTION_KEY}" -ne 64 ]; then
  echo "BLOFY_PLAYLIST_ENCRYPTION_KEY must be exactly 64 hex characters" >&2
  exit 1
fi

if [ "${#BLOFY_ADMIN_TOKEN}" -lt 24 ]; then
  echo "BLOFY_ADMIN_TOKEN is too short" >&2
  exit 1
fi

docker compose --env-file .env config >/dev/null
docker compose --env-file .env build activation
docker compose --env-file .env up -d --remove-orphans

echo "Waiting for BLOFY health endpoint..."
i=0
while [ "$i" -lt 36 ]; do
  if curl --fail --silent --show-error --max-time 8 "https://$AZURE_FQDN/health" >/tmp/blofy-health.json 2>/dev/null; then
    cat /tmp/blofy-health.json
    echo
    echo "BLOFY Azure staging is healthy: https://$AZURE_FQDN"
    exit 0
  fi
  i=$((i + 1))
  sleep 5
done

echo "Health check did not become ready. Current containers:" >&2
docker compose --env-file .env ps >&2
docker compose --env-file .env logs --tail=120 activation caddy >&2
exit 1
