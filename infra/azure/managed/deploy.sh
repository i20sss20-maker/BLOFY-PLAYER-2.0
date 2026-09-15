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
providers=(Microsoft.App Microsoft.DBforPostgreSQL Microsoft.ContainerRegistry Microsoft.KeyVault Microsoft.OperationalInsights Microsoft.ManagedIdentity Microsoft.Network Microsoft.Storage)
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
GATEWAY_APP="$(value gatewayApp)"
ACTIVATION_APP="$(value activationApp)"
RELEASES_APP="$(value releasesApp)"

printf 'Trying Azure-native image build in ACR %s...\n' "$ACR"
BUILD_LOG="$(mktemp)"
if az acr build --registry "$ACR" --image "blofy/activation:$TAG" --file services/activation/Dockerfile services/activation 2>&1 | tee "$BUILD_LOG"; then
  az acr build --registry "$ACR" --image "blofy/releases:$TAG" --file services/update-distribution/Dockerfile services/update-distribution
  az acr build --registry "$ACR" --image "blofy/gateway:$TAG" --file infra/azure/managed/gateway/Dockerfile infra/azure/managed/gateway

  printf 'Switching Container Apps from bootstrap images to BLOFY images...\n'
  az containerapp update --resource-group "$RG" --name "$ACTIVATION_APP" --image "$ACR_LOGIN/blofy/activation:$TAG" --only-show-errors >/dev/null
  az containerapp update --resource-group "$RG" --name "$RELEASES_APP" --image "$ACR_LOGIN/blofy/releases:$TAG" --only-show-errors >/dev/null
  az containerapp update --resource-group "$RG" --name "$GATEWAY_APP" --image "$ACR_LOGIN/blofy/gateway:$TAG" --only-show-errors >/dev/null
  rm -f "$BUILD_LOG"
  bash infra/azure/managed/verify-deployment.sh
  exit 0
fi

if grep -q 'TasksOperationsNotAllowed' "$BUILD_LOG"; then
  rm -f "$BUILD_LOG"
  cat <<'EOF'

ACR Tasks are blocked by this Azure for Students subscription.
This does NOT require upgrading or paying. BLOFY will use GitHub-hosted runners to build the same images and push them into the existing Azure Container Registry.
EOF
  bash infra/azure/managed/configure-github-builds.sh
  exit 0
fi

cat "$BUILD_LOG" >&2
rm -f "$BUILD_LOG"
echo 'ACR build failed for a reason other than the student-subscription ACR Tasks restriction.' >&2
exit 1
