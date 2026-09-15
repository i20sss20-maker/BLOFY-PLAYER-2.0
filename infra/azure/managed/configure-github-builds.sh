#!/usr/bin/env bash
set -euo pipefail

RG="${BLOFY_AZURE_RG:-rg-blofy-player}"
PRIMARY_BRANCH="${BLOFY_GITHUB_BRANCH:-main}"
FALLBACK_BRANCH="${BLOFY_GITHUB_FALLBACK_BRANCH:-infra/azure-staging}"
REPO_SLUG="${BLOFY_GITHUB_REPO_SLUG:-i20sss20-maker/BLOFY-PLAYER-2.0}"
IDENTITY_NAME="${BLOFY_GITHUB_IDENTITY:-blofy-github-oidc}"
PRIMARY_FEDERATED_NAME="${BLOFY_GITHUB_FEDERATED_NAME:-blofy-main-branch}"
FALLBACK_FEDERATED_NAME="${BLOFY_GITHUB_FALLBACK_FEDERATED_NAME:-blofy-infra-branch}"
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

# GitHub Actions emits immutable owner/repository IDs in the OIDC subject.
REPO_OWNER="$(gh api "repos/$REPO_SLUG" --jq '.owner.login')"
OWNER_ID="$(gh api "repos/$REPO_SLUG" --jq '.owner.id')"
REPO_NAME="$(gh api "repos/$REPO_SLUG" --jq '.name')"
REPO_ID="$(gh api "repos/$REPO_SLUG" --jq '.id')"

ensure_federated_credential() {
  local credential_name="$1"
  local branch="$2"
  local subject="repo:${REPO_OWNER}@${OWNER_ID}/${REPO_NAME}@${REPO_ID}:ref:refs/heads/${branch}"
  local current
  current="$(az identity federated-credential show \
    --resource-group "$RG" \
    --identity-name "$IDENTITY_NAME" \
    --name "$credential_name" \
    --query subject -o tsv 2>/dev/null || true)"

  if [ -z "$current" ]; then
    printf 'Creating GitHub federated credential %s for %s...\n' "$credential_name" "$branch"
    az identity federated-credential create \
      --resource-group "$RG" \
      --identity-name "$IDENTITY_NAME" \
      --name "$credential_name" \
      --issuer 'https://token.actions.githubusercontent.com' \
      --subject "$subject" \
      --audiences 'api://AzureADTokenExchange' \
      --only-show-errors >/dev/null
  elif [ "$current" != "$subject" ]; then
    printf 'Updating GitHub federated credential %s for %s...\n' "$credential_name" "$branch"
    az identity federated-credential update \
      --resource-group "$RG" \
      --identity-name "$IDENTITY_NAME" \
      --name "$credential_name" \
      --issuer 'https://token.actions.githubusercontent.com' \
      --subject "$subject" \
      --audiences 'api://AzureADTokenExchange' \
      --only-show-errors >/dev/null
  fi

  printf 'OIDC subject (%s): %s\n' "$credential_name" "$subject"
}

# Production deploys from main. Keep the staging subject as an independent rollback credential.
ensure_federated_credential "$PRIMARY_FEDERATED_NAME" "$PRIMARY_BRANCH"
if [ -n "$FALLBACK_BRANCH" ] && [ "$FALLBACK_BRANCH" != "$PRIMARY_BRANCH" ]; then
  ensure_federated_credential "$FALLBACK_FEDERATED_NAME" "$FALLBACK_BRANCH"
fi

printf 'Saving non-secret Azure IDs as GitHub Actions variables...\n'
gh variable set AZURE_CLIENT_ID --repo "$REPO_SLUG" --body "$CLIENT_ID"
gh variable set AZURE_TENANT_ID --repo "$REPO_SLUG" --body "$TENANT_ID"
gh variable set AZURE_SUBSCRIPTION_ID --repo "$REPO_SLUG" --body "$SUBSCRIPTION_ID"
gh variable set BLOFY_AZURE_RG --repo "$REPO_SLUG" --body "$RG"

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$PRIMARY_BRANCH" ]; then
  cat <<EOF
OIDC setup is complete, but the image-build trigger was not pushed because the current branch is:
  $CURRENT_BRANCH
Production deployments now originate from:
  $PRIMARY_BRANCH
Checkout $PRIMARY_BRANCH and run this script again if you need to trigger a build.
EOF
  exit 0
fi

printf 'Triggering GitHub-hosted image build without ACR Tasks...\n'
git pull --ff-only origin "$PRIMARY_BRANCH"
git config user.name 'BLOFY Azure Setup'
git config user.email 'i20sss20-maker@users.noreply.github.com'
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > infra/azure/managed/image-build.trigger
git add infra/azure/managed/image-build.trigger
if ! git diff --cached --quiet; then
  git commit -m 'ci(azure): trigger production image deployment' >/dev/null
  git push origin "HEAD:$PRIMARY_BRANCH"
fi

cat <<EOF

OIDC setup complete — no Azure password is stored in GitHub.
GitHub-hosted runners will build and push BLOFY images to:
  $ACR_LOGIN

Production trigger branch:
  $PRIMARY_BRANCH
Rollback OIDC branch retained:
  $FALLBACK_BRANCH

Next: wait for the workflow named "BLOFY Azure Student Images" to finish, then run:
  git pull --ff-only origin $PRIMARY_BRANCH
  bash infra/azure/managed/verify-deployment.sh
EOF
