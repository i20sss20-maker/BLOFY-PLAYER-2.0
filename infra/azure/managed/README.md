# BLOFY PLAYER — Azure managed stack

This is the target Azure architecture to validate before Google Play production. It does not change Android playback engines.

## Public surface

Only `blofy-gateway` has external ingress.

The generated Azure gateway URL becomes the stable base URL for the Android app until a custom domain is purchased. A future custom domain can point at the same gateway without forcing the installed app to stop using the Azure URL.

Public routes:

- `/` and activation/customer/admin routes → `blofy-activation`
- `/downloads`, `/releases`, `/release.json`, `/download/*` → `blofy-releases`
- `/releases-admin` → release administration

## Private services

- `blofy-activation`: internal Container App, port 8080
- `blofy-releases`: internal Container App, port 3000
- Azure Database for PostgreSQL Flexible Server: VNet private access, B1MS, PostgreSQL 16, 32 GB storage
- Key Vault: secrets, RBAC, purge protection
- Azure Container Registry Standard: private images, local admin disabled
- Storage account: HTTPS only, anonymous blob access disabled
- Log Analytics: Container Apps logs

## Security baseline

- Application/database secrets are stored in Key Vault, not GitHub.
- Container Apps use a user-assigned Managed Identity.
- Managed Identity receives only the required Key Vault, ACR Pull, and Blob roles.
- PostgreSQL is deployed to a delegated private subnet and is not intended to be Internet reachable.
- Activation and release apps are internal-only.
- Gateway adds strict security headers and HTTPS is terminated by Azure Container Apps ingress.
- ACR admin credentials are disabled.
- Key Vault soft-delete + purge protection are enabled.
- Storage denies anonymous blob access.
- Free Defender for Cloud foundational posture management should remain enabled; this repo does not enable paid Defender plans automatically.
- No paid Azure DDoS Network Protection plan is enabled. Azure platform infrastructure protection remains the baseline.

## Student-offer choices

The template intentionally uses:

- Azure Container Registry Standard (student offer includes one Standard registry for 12 months, subject to offer eligibility).
- PostgreSQL Flexible Server `Standard_B1ms`, 32 GB (free-account/student allowance is designed around B1MS/32 GB for 12 months, subject to offer eligibility).
- Azure Container Apps consumption resources with `minReplicas: 0` to reduce idle spend.

Log Analytics, Key Vault, networking, Storage, bandwidth, and usage beyond free allowances can consume the $100 student credit. Do not create duplicate stacks.

## Deploy from Azure Cloud Shell

Open Azure Cloud Shell in **Bash** and run:

```bash
git clone --depth 1 --branch infra/azure-staging \
  https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0.git blofy-azure
cd blofy-azure
bash infra/azure/managed/deploy.sh
```

The script:

1. creates `rg-blofy-player`;
2. generates strong secrets in memory;
3. deploys the managed Bicep stack;
4. sends secrets into Key Vault;
5. builds activation, releases and gateway images in ACR;
6. switches Container Apps from bootstrap images to BLOFY images;
7. waits for `/health` and `/release.json`.

The generated credentials are not written to the repo or a local `.env` file.

## Audit immediately after deploy

```bash
bash infra/azure/managed/security-audit.sh
```

Every line should report `PASS` before any app build is pointed at Azure.

## Before Google Play

Do not publish the Play build yet. Required acceptance order:

1. Azure `/health` passes.
2. Customer/device portal works.
3. Activation works with a test device.
4. Admin session/device management works.
5. Release admin Draft → QA → Public works.
6. `/release.json` and `/download/latest.apk` work.
7. Existing production data is migrated and integrity checked.
8. An Android RC is built with Azure activation + update base URLs.
9. Real Android/TV smoke tests pass.
10. Only then publish through Google Play testing tracks.

Keep Vercel/Railway available as rollback targets until the Azure migration is accepted.
