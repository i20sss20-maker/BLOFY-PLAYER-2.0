#!/usr/bin/env bash
set -euo pipefail

RG="${BLOFY_AZURE_RG:-rg-blofy-player}"
LOCATION="${BLOFY_AZURE_LOCATION:-uaenorth}"
ENVIRONMENT="${BLOFY_AZURE_ENVIRONMENT:-prod}"
TAG="${BLOFY_IMAGE_TAG:-$(git rev-parse --short=12 HEAD)}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }; }
need az
need openssl
need git
need curl
need python3

az account show >/dev/null
az extension add --name containerapp --upgrade --only-show-errors >/dev/null

printf 'Registering Azure resource providers required by BLOFY...\n'
providers=(
  Microsoft.App
  Microsoft.DBforPostgreSQL
  Microsoft.ContainerRegistry
  Microsoft.KeyVault
  Microsoft.OperationalInsights
  Microsoft.ManagedIdentity
  Microsoft.Network
  Microsoft.Storage
)
for provider in "${providers[@]}"; do
  state="$(az provider show --namespace "$provider" --query registrationState -o tsv 2>/dev/null || true)"
  if [ "$state" != 'Registered' ]; then
    printf '  registering %s...\n' "$provider"
    az provider register --namespace "$provider" --wait --only-show-errors >/dev/null
  fi
done

printf 'Creating/updating resource group %s in %s...\n' "$RG" "$LOCATION"
az group create --name "$RG" --location "$LOCATION" --tags app='BLOFY PLAYER' managedBy=bicep >/dev/null

POSTGRES_PASSWORD="$(openssl rand -base64 36 | tr -d '\n/=+' | cut -c1-40)"
ADMIN_TOKEN="$(openssl rand -hex 32)"
PLAYLIST_KEY="$(openssl rand -hex 32)"
RELEASE_PASSWORD="$(openssl rand -base64 36 | tr -d '\n/=+' | cut -c1-40)"

printf 'Deploying managed Azure resources...\n'
DEPLOYMENT_JSON="$(az deployment group create \
  --resource-group "$RG" \
  --name "blofy-managed-$(date +%Y%m%d%H%M%S)" \
  --template-file infra/azure/managed/main.bicep \
  --parameters \
    location="$LOCATION" \
    environment="$ENVIRONMENT" \
    postgresAdministratorPassword="$POSTGRES_PASSWORD" \
    blofyAdminToken="$ADMIN_TOKEN" \
    blofyPlaylistEncryptionKey="$PLAYLIST_KEY" \
    releaseAdminPassword="$RELEASE_PASSWORD" \
  --query properties.outputs -o json)"

value() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data[sys.argv[1]]["value"])' "$1" <<<"$DEPLOYMENT_JSON"
}

ACR="$(value acrName)"
ACR_LOGIN="$(value acrLoginServer)"
KEY_VAULT="$(value keyVaultName)"
GATEWAY_APP="$(value gatewayApp)"
ACTIVATION_APP="$(value activationApp)"
RELEASES_APP="$(value releasesApp)"

printf 'Building BLOFY images in Azure Container Registry %s...\n' "$ACR"
az acr build --registry "$ACR" --image "blofy/activation:$TAG" --file services/activation/Dockerfile services/activation
az acr build --registry "$ACR" --image "blofy/releases:$TAG" --file services/update-distribution/Dockerfile services/update-distribution
az acr build --registry "$ACR" --image "blofy/gateway:$TAG" --file infra/azure/managed/gateway/Dockerfile infra/azure/managed/gateway

printf 'Switching Container Apps from bootstrap images to BLOFY images...\n'
az containerapp update --resource-group "$RG" --name "$ACTIVATION_APP" --image "$ACR_LOGIN/blofy/activation:$TAG" --only-show-errors >/dev/null
az containerapp update --resource-group "$RG" --name "$RELEASES_APP" --image "$ACR_LOGIN/blofy/releases:$TAG" --only-show-errors >/dev/null
az containerapp update --resource-group "$RG" --name "$GATEWAY_APP" --image "$ACR_LOGIN/blofy/gateway:$TAG" --only-show-errors >/dev/null

GATEWAY_FQDN="$(az containerapp show --resource-group "$RG" --name "$GATEWAY_APP" --query properties.configuration.ingress.fqdn -o tsv)"
GATEWAY_URL="https://$GATEWAY_FQDN"

printf 'Waiting for public gateway health...\n'
for attempt in $(seq 1 36); do
  if curl -fsS --max-time 10 "$GATEWAY_URL/health" >/tmp/blofy-health.json 2>/dev/null; then
    break
  fi
  sleep 5
  if [ "$attempt" -eq 36 ]; then
    echo 'Gateway health did not become ready in time.' >&2
    exit 1
  fi
done

curl -fsS --max-time 10 "$GATEWAY_URL/release.json" >/tmp/blofy-release-health.json

cat <<EOF

BLOFY Azure managed deployment is healthy.

Gateway (use this as the stable Azure base URL):
$GATEWAY_URL

Health:
$GATEWAY_URL/health

Release metadata:
$GATEWAY_URL/release.json

Release downloads:
$GATEWAY_URL/downloads

Release admin:
$GATEWAY_URL/releases-admin
Username: admin
Password retrieval (run only in your private Cloud Shell):
az keyvault secret show --vault-name "$KEY_VAULT" --name release-admin-password --query value -o tsv

IMPORTANT:
- Vercel/Railway have NOT been removed.
- Do not publish a Google Play build until the Azure smoke-test checklist passes.
- Generated passwords/tokens were sent directly into Azure Key Vault and were not written to disk by this script.
EOF
