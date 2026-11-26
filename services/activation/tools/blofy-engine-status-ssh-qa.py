#!/usr/bin/env python3
"""Read-only status command over an already authenticated SSH session (QA only)."""
import base64, json, re, socket, subprocess, sys, tempfile, time
from pathlib import Path

def active(unit):
    p = subprocess.run(["/usr/bin/systemctl", "is-active", "--quiet", unit],
                       timeout=5, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if p.returncode not in (0, 3):
        raise RuntimeError("unit_status_unavailable")
    return p.returncode == 0

def main():
    if len(sys.argv) != 2 or not re.fullmatch(r"[a-f0-9]{32}", sys.argv[1]):
        raise SystemExit("invalid_challenge")
    engines = {
        "blofy-engine-01": ("linode", "blofy-real-live-delivery.service", "blofy-heartbeat-v2.timer"),
        "blofy-engine-02": ("hostbrr", "blofy-hoster-private-delivery.service", "hostbrr-heartbeat.timer"),
    }
    engine, delivery, heartbeat = engines[socket.gethostname().split(".")[0]]
    s = dict(version=1, engineId=engine, challenge=sys.argv[1],
             observedAt=0, deliveryActive=active(delivery), heartbeatActive=active(heartbeat))
    s["observedAt"] = time.time_ns() // 1000000
    payload = json.dumps(["BLOFY_WORKER_STATUS_V1", *s.values()], separators=(",", ":")).encode()
    key = Path("/root/blofy-engine-control-qa/worker.pem")
    with tempfile.TemporaryDirectory(prefix="blofy-status-") as tmp:
        p = Path(tmp) / "payload"
        p.write_bytes(payload)
        sig = subprocess.check_output(["/usr/bin/openssl","pkeyutl","-sign","-rawin",
                                       "-inkey",str(key),"-in",str(p)], timeout=5)
    print(json.dumps({"status":s,"signature":base64.urlsafe_b64encode(sig).decode().rstrip("=")},
                     separators=(",", ":")))

if __name__ == "__main__":
    main()
