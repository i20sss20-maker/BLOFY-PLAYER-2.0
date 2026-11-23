#!/usr/bin/env python3
"""Exec PostgreSQL client with libpq environment parsed from a DATABASE_URL.

No credentials in argv, script output, or generated files. DATABASE_URL is
removed from the spawned process environment. Refuse unsupported URI options
rather than silently downgrade SSL or connection parameters.
"""
import os
import sys
from urllib.parse import parse_qsl, unquote, urlsplit


OPTION_MAP = {
    "sslmode": "PGSSLMODE",
    "sslrootcert": "PGSSLROOTCERT",
    "sslcert": "PGSSLCERT",
    "sslkey": "PGSSLKEY",
    "sslcrl": "PGSSLCRL",
    "connect_timeout": "PGCONNECT_TIMEOUT",
    "target_session_attrs": "PGTARGETSESSIONATTRS",
    "application_name": "PGAPPNAME",
    "channel_binding": "PGCHANNELBINDING",
    "gssencmode": "PGGSSENCMODE",
    "hostaddr": "PGHOSTADDR",
    "options": "PGOPTIONS",
}


def build_env(url, environ=None):
    if not isinstance(url, str) or len(url) > 20000 or any(ord(c) in (0, 10, 13) for c in url):
        raise ValueError("database_url_invalid")
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("postgres", "postgresql"):
            raise ValueError("database_url_scheme_invalid")
        if parsed.fragment or not parsed.hostname or not parsed.path or parsed.path == "/":
            raise ValueError("database_url_missing_host_or_database")
        port = parsed.port or 5432
        if not (1 <= port <= 65535):
            raise ValueError("database_url_port_invalid")
        if not parsed.username:
            raise ValueError("database_url_user_missing")
        dbname = unquote(parsed.path[1:])
        user = unquote(parsed.username)
        password = unquote(parsed.password) if parsed.password is not None else None
        if not dbname or "/" in dbname:
            raise ValueError("database_name_invalid")
        for value in (parsed.hostname, dbname, user, password or ""):
            if any(ord(char) < 32 for char in value):
                raise ValueError("control_characters_not_allowed")
        env = dict(os.environ if environ is None else environ)
        for key in ("DATABASE_URL", "PGSERVICE", "PGSERVICEFILE", "PGDATABASE",
                    "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD"):
            env.pop(key, None)
        env.update(PGHOST=parsed.hostname, PGPORT=str(port), PGUSER=user,
                   PGDATABASE=dbname)
        if password is not None:
            env["PGPASSWORD"] = password
        seen = set()
        for key, value in parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True):
            if key not in OPTION_MAP or key in seen:
                raise ValueError("unsupported_or_duplicate_database_url_option")
            seen.add(key)
            env[OPTION_MAP[key]] = value
        return env
    except (ValueError, UnicodeError) as exc:
        raise ValueError("database_url_invalid_or_unsupported") from None


def main():
    if len(sys.argv) < 2:
        print("usage: exec-with-postgres-dsn.py <pg_dump-or-psql> [args...]", file=sys.stderr)
        return 2
    if os.path.basename(sys.argv[1]) not in ("pg_dump", "pg_restore", "psql", "pg_isready"):
        print("unsupported_postgresql_command", file=sys.stderr)
        return 2
    try:
        env = build_env(os.getenv("DATABASE_URL"))
    except ValueError:
        print("database_url_invalid_or_unsupported", file=sys.stderr)
        return 2
    os.execvpe(sys.argv[1], sys.argv[1:], env)


if __name__ == "__main__":
    raise SystemExit(main())
