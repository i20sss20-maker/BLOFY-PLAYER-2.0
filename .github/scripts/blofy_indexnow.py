"""Select only changed, public, canonical BLOFY URLs for IndexNow.

IndexNow is not Google indexing and does not guarantee a crawl or ranking.
No devices, admin endpoints, API calls, or customer data are submitted.
"""
import argparse
import json
from pathlib import Path
import re

HOST = "blofyplayer.com"
BASE = f"https://{HOST}"
CANONICAL_PAGES = ("/", "/downloads", "/privacy", "/status")
PER_FILE = {
    "services/activation/web/index.html": ("/",),
    "services/activation/web/privacy.html": ("/privacy",),
    "services/activation/web/status.html": ("/status",),
    "services/activation/src/public-downloads.mjs": ("/downloads",),
    "services/activation/src/release-catalog.mjs": ("/downloads",),
    "services/activation/web/manifest.webmanifest": ("/",),
    "services/activation/web/blofy-logo.png": ("/", "/downloads"),
}

def pages_for_changes(paths, submit_all=False):
    if submit_all:
        return [BASE + path for path in CANONICAL_PAGES]
    wanted = set()
    for path in paths:
        path = str(path).strip()
        wanted.update(PER_FILE.get(path, ()))
        if re.fullmatch(r"services/activation/src/approved-release-rc07[0-9a-z-]+\.mjs", path):
            wanted.add("/downloads")
    return [BASE + path for path in CANONICAL_PAGES if path in wanted]

def extract_key(source):
    # Read from the key-file handler. Do not store a second inconsistent copy.
    match = re.search(r"export const INDEXNOW_KEY = '([A-Za-z0-9-]{8,128})';", source)
    if not match:
        raise ValueError("Missing IndexNow key in public key-file handler")
    return match.group(1)

def make_payload(urls, key):
    if any(url not in {BASE + path for path in CANONICAL_PAGES} for url in urls):
        raise ValueError("Only approved canonical BLOFY pages can be submitted")
    return {"host": HOST, "key": key, "keyLocation": BASE + f"/{key}.txt", "urlList": urls}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--changed", help="newline-delimited paths from git diff")
    parser.add_argument("--all", action="store_true", help="manual initial launch only")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if not args.all and not args.changed:
        parser.error("provide --changed or --all")
    changes = Path(args.changed).read_text(encoding="utf-8").splitlines() if args.changed else []
    urls = pages_for_changes(changes, submit_all=args.all)
    output = Path(args.output)
    if not urls:
        output.unlink(missing_ok=True)
        print("No changed canonical public pages; IndexNow skipped.")
        return
    key_source = Path("services/activation/src/indexnow-key.mjs").read_text(encoding="utf-8")
    payload = make_payload(urls, extract_key(key_source))
    output.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Prepared {len(urls)} changed public BLOFY URL(s) for IndexNow.")

if __name__ == "__main__":
    main()
