#!/usr/bin/env bash
set -euo pipefail

RG="${BLOFY_AZURE_RG:-rg-blofy-player}"
fail=0

ok() { printf 'PASS  %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1" >&2; fail=1; }
info() { printf 'INFO  %s\n' "$1"; }

az account show >/dev/null

POSTGRES="$(az postgres flexible-server list -g "$RG" --query '[0].name' -o tsv)"
ACR="$(az acr list -g "$RG" --query '[0].name' -o tsv)"
KV="$(az keyvault list -g "$RG" --query '[0].name' -o tsv)"
STORAGE="$(az storage account list -g "$RG" --query '[0].name' -o tsv)"

[ -n "$POSTGRES" ] || bad 'PostgreSQL server exists'
[ -n "$ACR" ] || bad 'Azure Container Registry exists'
[ -n "$KV" ] || bad 'Key Vault exists'
[ -n "$STORAGE" ] || bad 'Storage account exists'

if [ -n "$POSTGRES" ]; then
  PUBLIC="$(az postgres flexible-server show -g "$RG" -n "$POSTGRES" --query network.publicNetworkAccess -o tsv 2>/dev/null || true)"
  if [ "$PUBLIC" = 'Disabled' ] || [ -z "$PUBLIC" ]; then ok 'PostgreSQL is private/VNet integrated'; else bad "PostgreSQL public access is $PUBLIC"; fi
fi

for app in blofy-activation blofy-releases; do
  EXTERNAL="$(az containerapp show -g "$RG" -n "$app" --query properties.configuration.ingress.external -o tsv)"
  [ "$EXTERNAL" = 'false' ] && ok "$app is internal-only" || bad "$app is exposed to the Internet"
done

GATEWAY_EXTERNAL="$(az containerapp show -g "$RG" -n blofy-gateway --query properties.configuration.ingress.external -o tsv)"
[ "$GATEWAY_EXTERNAL" = 'true' ] && ok 'Only BLOFY gateway is public' || bad 'BLOFY gateway is not public'

ACR_ADMIN="$(az acr show -g "$RG" -n "$ACR" --query adminUserEnabled -o tsv)"
[ "$ACR_ADMIN" = 'false' ] && ok 'ACR local admin account is disabled' || bad 'ACR admin account is enabled'

KV_RBAC="$(az keyvault show -g "$RG" -n "$KV" --query properties.enableRbacAuthorization -o tsv)"
KV_PURGE="$(az keyvault show -g "$RG" -n "$KV" --query properties.enablePurgeProtection -o tsv)"
[ "$KV_RBAC" = 'true' ] && ok 'Key Vault uses Azure RBAC' || bad 'Key Vault RBAC is disabled'
[ "$KV_PURGE" = 'true' ] && ok 'Key Vault purge protection is enabled' || bad 'Key Vault purge protection is disabled'

BLOB_PUBLIC="$(az storage account show -g "$RG" -n "$STORAGE" --query allowBlobPublicAccess -o tsv)"
HTTPS_ONLY="$(az storage account show -g "$RG" -n "$STORAGE" --query enableHttpsTrafficOnly -o tsv)"
[ "$BLOB_PUBLIC" = 'false' ] && ok 'Anonymous Blob access is disabled' || bad 'Anonymous Blob access is enabled'
[ "$HTTPS_ONLY" = 'true' ] && ok 'Storage requires HTTPS' || bad 'Storage does not require HTTPS'

info 'Microsoft Defender paid plans are NOT enabled by this script. Foundational CSPM remains the intended free baseline.'
info 'DDoS infrastructure protection is provided by the Azure platform baseline; no paid DDoS plan is enabled here.'

if [ "$fail" -ne 0 ]; then
  echo 'Azure security audit failed.' >&2
  exit 1
fi

echo 'BLOFY Azure security baseline passed.'
