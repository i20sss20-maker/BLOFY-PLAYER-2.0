import http.server, socketserver, os, pathlib

PORT = int(os.environ.get("PORT", "8080"))
UPLOAD_PATH = "/upload-55-5-2000073-8d7c6a4f"
FILENAME = "BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED-2000073.aab"
ROOT = pathlib.Path("/app/share")
ROOT.mkdir(parents=True, exist_ok=True)
TARGET = ROOT / FILENAME

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

    def do_PUT(self):
        if self.path != UPLOAD_PATH:
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            self.send_error(411)
            return
        tmp = TARGET.with_suffix(".tmp")
        remaining = length
        with open(tmp, "wb") as f:
            while remaining:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        if remaining != 0:
            try:
                tmp.unlink()
            except OSError:
                pass
            self.send_error(400)
            return
        tmp.replace(TARGET)
        print(f"UPLOAD_OK bytes={TARGET.stat().st_size}", flush=True)
        self.send_response(201)
        self.end_headers()
        self.wfile.write(b"ok")

    def _serve_file(self, body):
        if self.path != "/" + FILENAME or not TARGET.exists():
            self.send_error(404)
            return
        size = TARGET.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(size))
        self.send_header("Content-Disposition", f'attachment; filename="{FILENAME}"')
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        if body:
            with open(TARGET, "rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)

    def do_GET(self):
        self._serve_file(True)

    def do_HEAD(self):
        self._serve_file(False)

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as server:
    print(f"READY port={PORT}", flush=True)
    server.serve_forever()
