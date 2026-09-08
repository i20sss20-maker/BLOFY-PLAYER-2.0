#!/usr/bin/env python3
"""Exercise the actual DAO SQL on a large, skewed local catalog (no provider access)."""
import json
from pathlib import Path
import re
import sqlite3
import time

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "app/src/main/java/tv/blofy/player/data/local"
dao = (LOCAL / "BlofyDao.kt").read_text()
database = (LOCAL / "BlofyDatabase.kt").read_text()


def query(name):
    pattern = r'@Query\(("""[\s\S]*?"""|"[^"\n]*")\)\s*(?:suspend\s+)?fun\s+(\w+)'
    for match in re.finditer(pattern, dao):
        if match[2] == name:
            return match[1].strip('"').strip()
    raise AssertionError(f"DAO query missing: {name}")


def measure(db, sql, args):
    steps = [0]
    def tick():
        steps[0] += 100
        return 0
    db.set_progress_handler(tick, 100)
    start = time.monotonic()
    rows = db.execute(sql, args).fetchall()
    elapsed = time.monotonic() - start
    db.set_progress_handler(None, 0)
    return rows, {"vm_steps_approx": steps[0], "ms": round(elapsed * 1000, 2)}


def main():
    db = sqlite3.connect(":memory:")
    schema = re.search(r'CREATE TABLE `streams_new` \([\s\S]*?\n\s*\)', database)[0]
    db.execute(schema.replace("streams_new", "streams"))
    indexes = re.findall(r'db.execSQL\("(CREATE INDEX[^"\n]+ ON `streams`[^"\n]+)"\)', database)
    added = {"index_streams_providerId_kind", "index_streams_providerId_kind_categoryId", "index_streams_home_page"}
    for sql in indexes:
        if re.search(r'`([^`]+)`', sql)[1] not in added:
            db.execute(sql.replace("CREATE INDEX `", "CREATE INDEX IF NOT EXISTS `"))

    size = 200_000
    def records():
        for i in range(size):
            kind = ("movie", "movie", "series", "live")[i % 4]
            category = "rare" if i >= size - 20 else f"category-{i % 200}"
            date = None if i % 7 == 0 else (i % 2000) - 2
            yield (str(i), "other" if i % 5 == 0 else "p", str(i), category, kind,
                   ("أفلام " if i % 3 == 0 else "Title ") + str(size - i), date, "metadata " * 128)
    db.executemany("""INSERT INTO streams (`key`,providerId,remoteId,categoryId,kind,name,addedAt,plot,
        archiveEnabled,archiveDurationDays,favorite,locked) VALUES (?,?,?,?,?,?,?,?,0,0,0,0)""", records())
    db.commit()
    metrics = {"rows": size, "sqlite": sqlite3.sqlite_version}
    home_args = {"providerId": "p", "limit": 96}
    baseline = "SELECT * FROM streams WHERE providerId=:providerId AND kind IN ('movie','series') ORDER BY COALESCE(addedAt,0) DESC,name,`key` LIMIT :limit"
    expected, metrics["home_before"] = measure(db, baseline, home_args)
    for sql in indexes:
        if re.search(r'`([^`]+)`', sql)[1] in added:
            db.execute(sql)
    actual, metrics["home_after"] = measure(db, query("latestHomeStreams"), home_args)
    assert actual == expected, "Home ordering/content changed"
    assert metrics["home_after"]["vm_steps_approx"] < 25_000, "Home scans beyond bounded candidates"

    for name, category in [("catalogPageAfterAll", None), ("catalogPageAfterInCategory", "rare")]:
        args = {"providerId": "p", "kind": "movie", "categoryId": category, "afterRowId": 0, "limit": 96}
        actual, metrics[name] = measure(db, query(name), args)
        reference = "SELECT * FROM streams NOT INDEXED WHERE providerId=:providerId AND kind=:kind AND (:categoryId IS NULL OR categoryId=:categoryId) AND rowid>:afterRowId ORDER BY rowid LIMIT :limit"
        assert actual == db.execute(reference, args).fetchall()
        assert metrics[name]["vm_steps_approx"] < 6_000, "Page work grows with unrelated titles"
        plan = db.execute("EXPLAIN QUERY PLAN " + query(name), args).fetchall()
        assert not any("TEMP B-TREE" in row[3] or "SCAN streams" in row[3] for row in plan), plan
        last = db.execute("SELECT rowid FROM streams WHERE `key`=?", (actual[-1][0],)).fetchone()[0]
        args["afterRowId"] = last
        following = db.execute(query(name), args).fetchall()
        assert following == db.execute(reference, args).fetchall(), "Cursor skipped or repeated rows"
    db.execute("ANALYZE")
    actual, metrics["home_after_analyze"] = measure(db, query("latestHomeStreams"), home_args)
    assert actual == expected
    assert metrics["home_after_analyze"]["vm_steps_approx"] < 25_000
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
