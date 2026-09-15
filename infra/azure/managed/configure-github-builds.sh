#!/usr/bin/env bash
set -euo pipefail

RG="${BLOFY_AZURE_RG:-rg-blofy-player}"
BRANCH="${BLOFY_GITHUB_BRANCH:-infra/azure-staging}"
REPO_URL="${BLOFY_GITHUB_REPO:-https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0}"
SP_NAME="${BLOFY_GITHUB_SP_NAME:-blofy-player-github-actions}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }; }
need az
need gh
need python3

az account show >/dev/null
az extension add --name containerapp --upgrade --only-show-errors >/dev/null

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  cat <<'EOF'
GitHub CLI is not authenticated yet.
Run this command first:

  gh auth login --hostname github.com --git-protocol https --web --scopes workflow

GitHub CLI will print a one-time device code and a github.com login URL. Complete that login, then run this script again.
EOF
  exit 2
fi

# Keep the GitHub token in memory only. Never echo it or persist it to disk.
GITHUB_TOKEN_VALUE="$(gh auth token --hostname github.com)"
if [ -z "$GITHUB_TOKEN_VALUE" ]; then
  echo 'GitHub CLI did not return an authentication token.' >&2
  exit 1
fi
trap 'unset GITHUB_TOKEN_VALUE SP_SECRET SP_JSON' EXIT

RG_ID="$(az group show --name "$RG" --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
ACR="$(az acr list --resource-group "$RG" --query '[0].name' -o tsv)"
if [ -z "$ACR" ]; then
  echo "No Azure Container Registry found in $RG" >&2
  exit 1
fi
ACR_ID="$(az acr show --name "$ACR" --query id -o tsv)"
ACR_LOGIN="$(az acr show --name "$ACR" --query loginServer -o tsv)"

printf 'Preparing a GitHub Actions deployment identity...\n'
APP_ID="$(az ad sp list --display-name "$SP_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)"
if [ -z "$APP_ID" ]; then
  SP_JSON="$(az ad sp create-for-rbac \
    --name "$SP_NAME" \
    --role Contributor \
    --scopes "$RG_ID" \
    --years 1 \
    -o json)"
  APP_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["appId"])' <<<"$SP_JSON")"
  SP_SECRET="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' <<<"$SP_JSON")"
else
  SP_JSON="$(az ad sp credential reset \
    --id "$APP_ID" \
    --append \
    --display-name "blofy-container-build-$(date +%Y%m%d%H%M%S)" \
    --years 1 \
    -o json)"
  SP_SECRET="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' <<<"$SP_JSON")"
fi

# Contributor controls the Container Apps resource. AcrPush is the registry data-plane permission.
az role assignment create \
  --assignee "$APP_ID" \
  --role AcrPush \
  --scope "$ACR_ID" \
  --only-show-errors >/dev/null 2>&1 || true

cat <<EOF

Azure for Students blocks ACR Tasks on this subscription.
BLOFY will use GitHub-hosted runners to build images and push them into:
  $ACR_LOGIN
EOF

configure_app() {
  local app="$1"
  local context="$2"
  printf '\nConfiguring GitHub build for %s...\n' "$app"
  az containerapp github-action add \
    --resource-group "$RG" \
    --name "$app" \
    --repo-url "$REPO_URL" \
    --branch "$BRANCH" \
    --context-path "$context" \
    --registry-url "$ACR_LOGIN" \
    --service-principal-client-id "$APP_ID" \
    --service-principal-client-secret "$SP_SECRET" \
    --service-principal-tenant-id "$TENANT_ID" \
    --token "$GITHUB_TOKEN_VALUE" \
    --only-show-errors
}

configure_app blofy-activation services/activation
configure_app blofy-releases services/update-distribution
configure_app blofy-gateway infra/azure/managed/gateway

cat <<EOF

GitHub build workflows are configured.
They build on GitHub-hosted runners (not ACR Tasks), push into:
  $ACR_LOGIN
and deploy to the existing Azure Container Apps.

Next: wait for the three generated GitHub Actions runs to finish, then run:
  bash infra/azure/managed/verify-deployment.sh
EOF
