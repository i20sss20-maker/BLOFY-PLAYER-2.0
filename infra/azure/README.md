# BLOFY Azure staging

This folder prepares an Azure-hosted BLOFY staging environment without changing the current production routing.

## Architecture (phase 1)

- Ubuntu 24.04 Linux VM
- Docker Compose
- PostgreSQL 16 on a private Docker network
- Existing BLOFY activation/customer/admin Node service
- Caddy HTTPS reverse proxy
- Persistent Docker volumes for PostgreSQL and TLS state

The Android playback engines are not part of this infrastructure migration.

## Why a VM first

The existing backend already uses PostgreSQL. Keeping PostgreSQL and the Node service together avoids a database-engine rewrite while Azure is evaluated. The selected default VM is `Standard_B2ats_v2`, an Azure for Students free-service eligible burstable size when the SKU/quota is available. It has only 1 GiB RAM, so cloud-init adds a 2 GiB swap file for staging. Upgrade the VM before significant production traffic.

## Region

Default: `uaenorth` (Dubai). If the student subscription has zero quota for the free VM family there, deploy the same template in `westeurope` or another region where the free SKU is shown as available in the Azure portal.

## Deploy the Azure host from Cloud Shell

1. Open Azure Portal and start **Cloud Shell (Bash)**.
2. Run:

```bash
git clone --depth 1 --branch infra/azure-staging \
  https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0.git blofy-azure
cd blofy-azure

mkdir -p ~/.ssh
[ -f ~/.ssh/blofy_azure ] || ssh-keygen -t ed25519 -f ~/.ssh/blofy_azure -N ''

LABEL="blofy-staging-$RANDOM$RANDOM"
az deployment sub create \
  --name blofy-staging \
  --location uaenorth \
  --template-file infra/azure/main.bicep \
  --parameters \
      dnsLabelPrefix="$LABEL" \
      sshPublicKey="$(cat ~/.ssh/blofy_azure.pub)"
```

The deployment outputs the FQDN and SSH command.

If `Standard_B2ats_v2` is unavailable, repeat the deployment with a VM SKU shown as free for the student subscription, for example:

```bash
az deployment sub create \
  --name blofy-staging \
  --location westeurope \
  --template-file infra/azure/main.bicep \
  --parameters \
      location=westeurope \
      vmSize=Standard_B1s \
      dnsLabelPrefix="$LABEL" \
      sshPublicKey="$(cat ~/.ssh/blofy_azure.pub)"
```

## Start BLOFY on the VM

SSH from Cloud Shell using the output FQDN:

```bash
ssh -i ~/.ssh/blofy_azure blofyadmin@YOUR_FQDN
cd /opt/blofy/app/infra/azure
sh init-env.sh YOUR_FQDN
sh deploy.sh
```

`init-env.sh` creates the database password, admin token, and 64-hex playlist encryption key locally on the VM with file mode 600. Never commit or paste the generated `.env` file.

## Verify

```bash
curl -fsS https://YOUR_FQDN/health
```

Expected: HTTP 200 with `ok: true`, database ready, and playlist encryption ready.

## Cost safety

- Keep the staging VM on an Azure for Students free-service eligible SKU shown in the portal.
- The public IPv4 and any resource outside the free allowance can consume the $100 credit.
- Create a budget alert in Azure Cost Management immediately after deployment.
- Do not create additional VMs/disks/databases until the first deployment cost is verified.

## Commercial use

Azure for Students is used here for development/test/staging. Before exposing this environment as the paid commercial production service, upgrade/convert the Azure subscription to an appropriate production billing offer. The same VM/resource group can remain in place, so this does not require another provider migration.

## Phase 2

After phase 1 health and portal tests pass:

1. Run the release/update service on the same Azure host.
2. Move `/downloads`, release metadata, and APK update checks from Railway to Azure.
3. Import the current Vercel PostgreSQL data into Azure PostgreSQL on the VM.
4. Point an RC build at Azure for activation + updates and smoke-test it.
5. Only after acceptance, switch production endpoints and retire Vercel/Railway.
