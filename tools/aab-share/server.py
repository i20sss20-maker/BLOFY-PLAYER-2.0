import os
import urllib.request
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", "8080"))
ZIP_URL = os.environ["ZIP_URL"]
ROOT = Path("/tmp/blofy-aab-share")
ROOT.mkdir(parents=True, exist_ok=True)
TARGET = "BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED-2000073.aab"
SOURCE_SUFFIX = "BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.aab"
OUT = ROOT / TARGET

if not OUT.exists():
    archive = ROOT / "artifact.zip"
    urllib.request.urlretrieve(ZIP_URL, archive)
    with zipfile.ZipFile(archive) as z:
        matches = [n for n in z.namelist() if n.endswith(SOURCE_SUFFIX)]
        if not matches:
            raise RuntimeError("AAB not found in verified artifact")
        with z.open(matches[0]) as src, OUT.open("wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)
    archive.unlink(missing_ok=True)

os.chdir(ROOT)
print(f"READY {TARGET} {OUT.stat().st_size}", flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), SimpleHTTPRequestHandler).serve_forever()
