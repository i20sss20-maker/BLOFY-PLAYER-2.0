# BLOFY production migration audit

These tools are intentionally read-only and privacy-safe. They are for comparing the current production source with Azure before any cutover.

## Rules

- Never paste or commit `DATABASE_URL`, admin passwords, device IDs, activation codes, playlist credentials, or customer data.
- Run database audits against a read-only connection/account where possible.
- `audit-database.mjs` starts a PostgreSQL `READ ONLY` transaction and prints only database identity metadata, table row counts, and a schema fingerprint.
- Remote PostgreSQL uses the same verified-TLS policy as the activation service.
- `audit-legacy-json.mjs` prints aggregate counts and SHA-256 file fingerprints only; it never prints object keys or row values.
- `compare-audits.mjs` compares two safe database audit reports and reports only count/schema differences.
- A matching audit is necessary but not sufficient for cutover; take a source backup and run functional smoke tests before switching Android endpoints.

## Install

```bash
cd tools/migration
npm install --ignore-scripts --no-audit --no-fund
```

## PostgreSQL safe audit

```bash
DATABASE_URL='...' BLOFY_DATABASE_CA='...' npm run audit:db > source-audit.json
```

Run the same command with the Azure database connection and save it as `azure-audit.json`.

Then compare:

```bash
node compare-audits.mjs source-audit.json azure-audit.json
```

Exit code `0` means schema fingerprint and all table counts match. Exit code `1` means review the listed aggregate differences before proceeding.

## Legacy Railway volume audit

For the archived BLOFY-PLAYER-2026 volume:

```bash
node audit-legacy-json.mjs \
  --licenses /data/licenses.json \
  --profiles /data/device-profiles.json
```

The output contains counts/fingerprints only. Keep the original volume untouched until the Azure cutover and rollback window are accepted.
