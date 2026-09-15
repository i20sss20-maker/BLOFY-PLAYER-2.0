#!/usr/bin/env bash
set -euo pipefail

RG="${BLOFY_AZURE_RG:-rg-blofy-player}"
BRANCH="${BLOFY_GITHUB_BRANCH:-infra/azure-staging}"
REPO_SLUG="${BLOFY_GITHUB_REPO_SLUG:-i20sss20-maker/BLOFY-PLAYER-2.0}"
IDENTITY_NAME="${BLOFY_GITHUB_IDENTITY:-blofy-github-oidc}"
FEDERATED_NAME="${BLOFY_GITHUB_FEDERATED_NAME:-blofy-infra-branch}"
LEGACY_SP_NAME="${BLOFY_LEGACY_SP_NAME:-blofy-player-github-actions}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }; }
need az
need gh
need git

az account show >/dev/null
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  cat <<'EOF'
GitHub CLI is not authenticated.
Run:
  gh auth login --hostname github.com --git-protocol https --web --scopes workflow
Then run this script again.
EOF
  exit 2
fi

printf 'Configuring passwordless GitHub → Azure OIDC deployment...\n'
RG_ID="$(az group show --name "$RG" --query id -o tsv)"
SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"
ACR="$(az acr list --resource-group "$RG" --query '[0].name' -o tsv)"
if [ -z "$ACR" ]; then
  echo "No Azure Container Registry found in $RG" >&2
  exit 1
fi
ACR_ID="$(az acr show --name "$ACR" --query id -o tsv)"
ACR_LOGIN="$(az acr show --name "$ACR" --query loginServer -o tsv)"

# Clean up the earlier password-based service principal if it was created by a failed setup attempt.
LEGACY_APP_ID="$(az ad sp list --display-name "$LEGACY_SP_NAME" --query '[0].appId' -o tsv 2>/dev/null || true)"
if [ -n "$LEGACY_APP_ID" ]; then
  printf 'Removing unused password-based deployment identity...\n'
  az ad app delete --id "$LEGACY_APP_ID" >/dev/null 2>&1 || az ad sp delete --id "$LEGACY_APP_ID" >/dev/null 2>&1 || true
fi

if ! az identity show --resource-group "$RG" --name "$IDENTITY_NAME" >/dev/null 2>&1; then
  az identity create --resource-group "$RG" --name "$IDENTITY_NAME" --location "$(az group show -n "$RG" --query location -o tsv)" --only-show-errors >/dev/null
fi
CLIENT_ID="$(az identity show --resource-group "$RG" --name "$IDENTITY_NAME" --query clientId -o tsv)"
PRINCIPAL_ID="$(az identity show --resource-group "$RG" --name "$IDENTITY_NAME" --query principalId -o tsv)"

# GitHub Actions may update the three Container Apps and push images, nothing broader than this resource group.
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role Contributor \
  --scope "$RG_ID" \
  --only-show-errors >/dev/null 2>&1 || true
az role assignment create \
  --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "$ACR_ID" \
  --only-show-errors >/dev/null 2>&1 || true

SUBJECT="repo:${REPO_SLUG}:ref:refs/heads/${BRANCH}"
if ! az identity federated-credential show \
  --resource-group "$RG" \
  --identity-name "$IDENTITY_NAME" \
  --name "$FEDERATED_NAME" >/dev/null 2>&1; then
  az identity federated-credential create \
    --resource-group "$RG" \
    --identity-name "$IDENTITY_NAME" \
    --name "$FEDERATED_NAME" \
    --issuer 'https://token.actions.githubusercontent.com' \
    --subject "$SUBJECT" \
    --audiences 'api://AzureADTokenExchange' \
    --only-show-errors >/dev/null
fi

printf 'Saving non-secret Azure IDs as GitHub Actions variables...\n'
gh variable set AZURE_CLIENT_ID --repo "$REPO_SLUG" --body "$CLIENT_ID"
gh variable set AZURE_TENANT_ID --repo "$REPO_SLUG" --body "$TENANT_ID"
gh variable set AZURE_SUBSCRIPTION_ID --repo "$REPO_SLUG" --body "$SUBSCRIPTION_ID"
gh variable set BLOFY_AZURE_RG --repo "$REPO_SLUG" --body "$RG"

printf 'Triggering GitHub-hosted image build without ACR Tasks...\n'
git pull --ff-only origin "$BRANCH"
git config user.name 'BLOFY Azure Setup'
git config user.email 'i20sss20-maker@users.noreply.github.com'
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > infra/azure/managed/image-build.trigger
git add infra/azure/managed/image-build.trigger
if ! git diff --cached --quiet; then
  git commit -m 'ci(azure): trigger student image deployment' >/dev/null
  git push origin "HEAD:$BRANCH"
fi

cat <<EOF

OIDC setup complete — no Azure password is stored in GitHub.
GitHub-hosted runners will build and push BLOFY images to:
  $ACR_LOGIN

The trigger commit was pushed to:
  $BRANCH

Next: wait for the workflow named "BLOFY Azure Student Images" to finish, then run:
  git pull --ff-only origin $BRANCH
  bash infra/azure/managed/verify-deployment.sh
EOF
