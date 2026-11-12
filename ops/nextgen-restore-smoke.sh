#!/usr/bin/env bash
# BLOFY NextGen: isolated PostgreSQL disaster-recovery pipeline smoke test.
# Never accepts a real Railway DATABASE_URL or mutates production data.
set -Eeuo pipefail
if [[ "${BLOFY_RESTORE_SMOKE_ISOLATED:-}" != "YES" ||
      "${PGHOST:-}" != "127.0.0.1" ||
      "${PGUSER:-}" != "postgres" ||
      "${PGPORT:-}" != "5432" ]]; then
  echo "Refusing: this smoke test requires an isolated local PostgreSQL fixture." >&2
  exit 20
fi
for tool in psql pg_dump pg_restore createdb dropdb; do
  command -v "$tool" >/dev/null || { echo "Missing PostgreSQL client: $tool" >&2; exit 21; }
done
suffix="${RANDOM}${RANDOM}"
source="blofy_nextgen_source_${suffix}"
target="blofy_nextgen_restore_${suffix}"
tmp="$(mktemp -d)"
cleanup(){
  dropdb --if-exists "$target" >/dev/null 2>&1 || true
  dropdb --if-exists "$source" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
createdb "$source"
psql -X -v ON_ERROR_STOP=1 -d "$source" <<'SQL' >/dev/null
CREATE TABLE public.fixture_subscriptions (
 id bigint PRIMARY KEY, status text NOT NULL,
 valid_until timestamptz NOT NULL, credits integer NOT NULL
);
CREATE TABLE public.fixture_events (
 seq bigint PRIMARY KEY, subscription_id bigint NOT NULL
 REFERENCES public.fixture_subscriptions(id),
 action text NOT NULL, credits_delta integer NOT NULL
);
INSERT INTO public.fixture_subscriptions VALUES
(1,'active','2027-05-01T00:00:00Z',12),
(2,'trial','2026-11-13T00:00:00Z',0),
(3,'expired','2026-01-01T00:00:00Z',0);
INSERT INTO public.fixture_events VALUES
(1,1,'issue',-12),(2,2,'trial',0),(3,1,'renew',-12),(4,3,'expire',0);
SQL
pg_dump --no-owner --no-acl -Fc --dbname="$source" --file="$tmp/fixture.dump"
test -s "$tmp/fixture.dump"
pg_restore --list "$tmp/fixture.dump" > "$tmp/toc.txt"
grep -Fq 'fixture_subscriptions' "$tmp/toc.txt"
grep -Fq 'fixture_events' "$tmp/toc.txt"
createdb "$target"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$target" "$tmp/fixture.dump"
before="$(psql -X -v ON_ERROR_STOP=1 -At -d "$source" -c \
 "SELECT COUNT(*) || ':' || SUM(credits) || ':' || (SELECT COUNT(*) FROM fixture_events) FROM fixture_subscriptions;")"
after="$(psql -X -v ON_ERROR_STOP=1 -At -d "$target" -c \
 "SELECT COUNT(*) || ':' || SUM(credits) || ':' || (SELECT COUNT(*) FROM fixture_events) FROM fixture_subscriptions;")"
[[ "$before" == '3:12:4' && "$after" == "$before" ]] || {
 echo 'Restore check failed: row counts or event ledger differ' >&2
 exit 22
}
source_fk="$(psql -X -v ON_ERROR_STOP=1 -At -d "$source" -c \
 "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND conrelid='public.fixture_events'::regclass")"
target_fk="$(psql -X -v ON_ERROR_STOP=1 -At -d "$target" -c \
 "SELECT COUNT(*) FROM pg_constraint WHERE contype='f' AND conrelid='public.fixture_events'::regclass")"
[[ "$source_fk" == '1' && "$target_fk" == '1' ]] || {
 echo 'Restore check failed: referential integrity is not intact' >&2
 exit 23
}
echo "PASS: isolated fixture restore preserved subscriptions, credit ledger and FK."
echo "NOTE: Production volume backups, actual restore and RPO/RTO were NOT tested."
