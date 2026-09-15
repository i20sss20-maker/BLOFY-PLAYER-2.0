#!/usr/bin/env bash
set -euo pipefail

RG="${BLOFY_AZURE_RG:-rg-blofy-player}"
GATEWAY_APP="${BLOFY_GATEWAY_APP:-blofy-gateway}"
ACTIVATION_APP="${BLOFY_ACTIVATION_APP:-blofy-activation}"
RELEASES_APP="${BLOFY_RELEASES_APP:-blofy-releases}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }; }
need az
need curl

is_bootstrap() {
  local app="$1"
  az containerapp show --resource-group "$RG" --name "$app" \
    --query 'properties.template.containers[0].image' -o tsv | grep -q 'azuredocs/containerapps-helloworld'
}

printf 'Waiting for GitHub Actions to replace bootstrap images...\n'
for attempt in $(seq 1 60); do
  if ! is_bootstrap "$ACTIVATION_APP" && ! is_bootstrap "$RELEASES_APP" && ! is_bootstrap "$GATEWAY_APP"; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo 'BLOFY images have not reached all Container Apps yet. Check GitHub Actions runs.' >&2
    exit 1
  fi
  sleep 10
done

printf 'Current images:\n'
for app in "$ACTIVATION_APP" "$RELEASES_APP" "$GATEWAY_APP"; do
  image="$(az containerapp show --resource-group "$RG" --name "$app" --query 'properties.template.containers[0].image' -o tsv)"
  printf '  %-18s %s\n' "$app" "$image"
done

GATEWAY_FQDN="$(az containerapp show --resource-group "$RG" --name "$GATEWAY_APP" --query properties.configuration.ingress.fqdn -o tsv)"
GATEWAY_URL="https://$GATEWAY_FQDN"

printf 'Waiting for %s/health...\n' "$GATEWAY_URL"
for attempt in $(seq 1 36); do
  if curl -fsS --max-time 10 "$GATEWAY_URL/health" >/tmp/blofy-health.json 2>/dev/null; then
    break
  fi
  if [ "$attempt" -eq 36 ]; then
    echo 'Gateway health did not become ready in time.' >&2
    exit 1
  fi
  sleep 5
done

curl -fsS --max-time 10 "$GATEWAY_URL/release.json" >/tmp/blofy-release.json

printf '\nRunning Azure security audit...\n'
bash "$(dirname "$0")/security-audit.sh"

cat <<EOF

BLOFY Azure deployment is healthy.

Stable Azure gateway:
$GATEWAY_URL

Health:
$GATEWAY_URL/health

Releases:
$GATEWAY_URL/downloads

Release metadata:
$GATEWAY_URL/release.json

Next step is data migration + real-device smoke testing before changing Google Play endpoints.
EOF
