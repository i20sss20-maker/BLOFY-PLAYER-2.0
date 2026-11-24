#!/usr/bin/env python3
"""Local-only synthetic physical replication and controlled promotion rehearsal."""
import os
from pathlib import Path
import subprocess
import tempfile
import time

BIN = Path("/usr/lib/postgresql/18/bin")
ENV = {k: v for k, v in os.environ.items() if not k.startswith("PG") and k != "DATABASE_URL"}

def run(name, *args, capture=False, timeout=60):
    result = subprocess.run([str(BIN / name), *map(str, args)], check=True,
        env=ENV, stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=timeout)
    return result.stdout.decode().strip() if capture else None

def sql(sock, port, statement):
    return run("psql", "-X", "-v", "ON_ERROR_STOP=1", "-h", sock, "-p", port,
        "-U", "postgres", "-d", "postgres", "-qAt", "-c", statement, capture=True)

def wait_for(predicate):
    end = time.monotonic() + 30
    while time.monotonic() < end:
        if predicate():
            return
        time.sleep(0.2)
    raise AssertionError("replication condition timed out")

def main():
    with tempfile.TemporaryDirectory(prefix="blofy-ha-") as tmp:
        root = Path(tmp)
        primary, standby = root / "primary", root / "standby"
        ps, ss = root / "p", root / "s"
        ps.mkdir()
        ss.mkdir()
        started = []
        try:
            run("initdb", "-D", primary, "-A", "trust", "--no-instructions")
            # Local replication only, no TCP listener and no customer data.
            with (primary / "pg_hba.conf").open("a") as hba:
                hba.write("\nlocal replication postgres trust\n")
            run("pg_ctl", "-D", primary, "-o",
                f"-c listen_addresses='' -c unix_socket_directories={ps} -p 55432 -c wal_level=replica -c max_wal_senders=4",
                "-w", "start")
            started.append(primary)
            sql(ps, 55432, "CREATE TABLE synthetic_entitlements(id int PRIMARY KEY, active boolean NOT NULL); INSERT INTO synthetic_entitlements VALUES (1,true)")
            run("pg_basebackup", "-h", ps, "-p", 55432, "-U", "postgres", "-D", standby,
                "-X", "stream", "-R", timeout=90)
            run("pg_ctl", "-D", standby, "-o",
                f"-c listen_addresses='' -c unix_socket_directories={ss} -p 55433",
                "-w", "start")
            started.append(standby)
            assert sql(ss, 55433, "SELECT pg_is_in_recovery()") == "t"
            sql(ps, 55432, "INSERT INTO synthetic_entitlements VALUES (2,false)")
            wait_for(lambda: sql(ss, 55433, "SELECT count(*) FROM synthetic_entitlements") == "2")
            # Confirm read-only standby, even before fencing.
            try:
                sql(ss, 55433, "INSERT INTO synthetic_entitlements VALUES (3,true)")
            except subprocess.CalledProcessError:
                pass
            else:
                raise AssertionError("standby accepted a write")
            # Stop and fence primary BEFORE promotion; no split-brain simulation.
            run("pg_ctl", "-D", primary, "-m", "fast", "-w", "stop")
            started.remove(primary)
            assert not (primary / "postmaster.pid").exists()
            started_at = time.monotonic()
            run("pg_ctl", "-D", standby, "-w", "promote")
            wait_for(lambda: sql(ss, 55433, "SELECT pg_is_in_recovery()") == "f")
            assert sql(ss, 55433, "SELECT string_agg(id::text||':'||active::text, ',' ORDER BY id) FROM synthetic_entitlements") == "1:true,2:false"
            sql(ss, 55433, "INSERT INTO synthetic_entitlements VALUES (3,true)")
            assert sql(ss, 55433, "SELECT count(*) FROM synthetic_entitlements") == "3"
            print("PASS: isolated synthetic physical replication, fenced promotion and post-promotion writes; promotion seconds=%.2f" % (time.monotonic()-started_at), flush=True)
        finally:
            for cluster in reversed(started):
                run("pg_ctl", "-D", cluster, "-m", "immediate", "-w", "stop")

if __name__ == "__main__":
    main()
