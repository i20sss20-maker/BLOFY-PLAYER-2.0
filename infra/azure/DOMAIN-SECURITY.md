# BLOFY PLAYER domain security baseline

Target brand domain: `blofyplayer.com`.

> Do not change public DNS until the domain is confirmed under BLOFY control and Azure staging has passed health checks.

## Hostnames

| Host | Purpose | Phase 1 target |
| --- | --- | --- |
| `blofyplayer.com` | Public site + customer portal | Azure static public IP |
| `www.blofyplayer.com` | Compatibility only | Azure static public IP, then HTTPS redirect to apex |
| `api.blofyplayer.com` | Android/iOS API | Azure static public IP |
| `admin.blofyplayer.com` | Administration | Azure static public IP |
| `downloads.blofyplayer.com` | Release/download URL | Azure static public IP; Caddy temporarily redirects to verified Railway releases |

Do not create wildcard (`*.blofyplayer.com`) DNS. Explicit records limit accidental exposure of future hostnames.

## DNS records after Azure acceptance

Use A records pointing at the Azure static public IPv4 address:

```text
@          A      <AZURE_STATIC_IPV4>
www        A      <AZURE_STATIC_IPV4>
api        A      <AZURE_STATIC_IPV4>
admin      A      <AZURE_STATIC_IPV4>
downloads  A      <AZURE_STATIC_IPV4>
```

Recommended starting TTL: `300` seconds during migration. Raise to `3600` after cutover is stable.

## Certificate Authority Authorization

Caddy obtains HTTPS certificates automatically. Once we lock Caddy to Let's Encrypt for production, publish CAA records that allow only the selected certificate authority. Do not publish restrictive CAA records before certificate issuance has been verified end-to-end.

## Registrar protection

Enable all of these at the registrar before production cutover:

- Registrar/domain transfer lock.
- Two-factor authentication; passkey or security key preferred.
- Auto-renew with a valid backup payment method.
- WHOIS/contact privacy where supported.
- Registry lock if the registrar offers it at a reasonable cost.
- A recovery email outside `@blofyplayer.com`; do not make domain recovery depend on the domain itself.
- Unique password stored in a password manager; never reuse the Azure/GitHub password.

## DNSSEC

Enable DNSSEC after authoritative DNS is finalized. Confirm the DS record is visible at the `.com` registry before considering the change complete. Do not rotate nameservers and DNSSEC keys at the same time.

## Azure origin protection

- PostgreSQL has no host port and cannot be reached from the public Internet.
- NSG exposes only TCP 80/443 and key-only SSH 22.
- Restrict SSH source CIDR to the administrator's current public IP whenever practical.
- Root/password SSH login is disabled.
- Fail2ban protects repeated SSH authentication attempts.
- Automatic security updates are enabled.
- Docker runs with `no-new-privileges` and bounded local logs.
- Application secrets live only in a mode-600 `.env` on the Azure host and are not committed to Git.

## HTTPS baseline

The custom-domain Caddy profile enforces:

- HTTP → HTTPS via Caddy automatic HTTPS.
- HSTS for one year with subdomains after custom-domain cutover.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- strict referrer policy.
- browser permission restrictions for camera/microphone/geolocation/payment/USB.
- server fingerprint removal.

Do not add HSTS preload until every BLOFY PLAYER subdomain is permanently HTTPS-only and we explicitly decide the preload commitment is appropriate.

## Admin exposure

`admin.blofyplayer.com` is a separate origin from the public site. Application-level admin authentication/session protection remains mandatory. Later production hardening can add Azure Front Door WAF or IP/identity-gated admin access if traffic/risk justifies the additional Azure cost.

## Backups

Before switching production data from Vercel to Azure:

1. Create an encrypted PostgreSQL dump from the current production database.
2. Restore it into the Azure PostgreSQL container.
3. Run schema/integrity checks.
4. Keep at least one encrypted backup outside the VM disk (Azure Blob Storage is the intended phase-2 target).
5. Test a restore, not just backup creation.

## Cutover rule

Never point `blofyplayer.com` at Azure merely because the VM is running. Cutover requires all of the following:

- `/health` is healthy over HTTPS.
- Customer portal works.
- Admin login and device management work.
- Android RC build can activate and sync through `api.blofyplayer.com`.
- Database import/integrity checks pass.
- Release/update flow is verified.
- Rollback target (current Vercel/Railway endpoints) remains available during acceptance.
