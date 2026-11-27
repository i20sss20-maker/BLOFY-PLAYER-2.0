#!/usr/bin/env python3
"""Fail-closed renewable lease for one already reserved live source.
No source allocation, network request or service start is performed here."""
import base64, json, os, re, stat, subprocess, tempfile, time, threading, signal, socket
from pathlib import Path

FIELDS=("version","engineId","sourceId","channelId","reservationId","sequence","issuedAt","expiresAt")
IDENTITY=("engineId","sourceId","channelId","reservationId")
UUID=re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")
PIN="MCowBQYDK2VwAyEAxtbHHm7Ic1yMvEAldZh36zPYHCvllmh9KqgM6mxS0P4="
class LeaseError(Exception):pass

def read_root_file(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,"rb") as f:
        s=os.fstat(f.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077 or not 0<s.st_size<=4096:
            raise LeaseError("LEASE_FILE_PERMISSIONS")
        data=f.read(4097)
        if len(data)>4096:raise LeaseError("LEASE_FILE_TOO_LARGE")
        return data

def verify_signature(lease,signature):
    if not isinstance(signature,str) or not re.fullmatch(r"[A-Za-z0-9_-]{86}",signature):return False
    sig=base64.urlsafe_b64decode(signature+"==")
    if len(sig)!=64 or base64.urlsafe_b64encode(sig).decode().rstrip("=")!=signature:return False
    with tempfile.TemporaryDirectory() as directory:
        p=Path(directory)
        (p/"key").write_bytes(base64.b64decode(PIN))
        (p/"msg").write_bytes(json.dumps(["BLOFY_LIVE_LEASE_V1",*[lease[k] for k in FIELDS]],separators=(",",":")).encode())
        (p/"sig").write_bytes(sig)
        return subprocess.run(["/usr/bin/openssl","pkeyutl","-verify","-pubin","-keyform","DER","-inkey",str(p/"key"),"-rawin","-in",str(p/"msg"),"-sigfile",str(p/"sig")],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3).returncode==0

class LiveLeaseGuard:
    def __init__(self,path,identity,state_dir,verify=verify_signature,clock=time.time,monotonic=time.monotonic,reader=read_root_file):
        if set(identity)!=set(IDENTITY) or identity["engineId"] not in ("hostbrr","linode") or not all(isinstance(identity[k],str) and UUID.fullmatch(identity[k]) for k in ("sourceId","reservationId")) or not isinstance(identity["channelId"],str) or not re.fullmatch(r"[1-9][0-9]{0,14}",identity["channelId"]):raise LeaseError("LEASE_IDENTITY_INVALID")
        self.path=path;self.identity=dict(identity);self.state_dir=Path(state_dir);self.verify=verify
        self.clock=clock;self.monotonic=monotonic;self.reader=reader
        self._lock=threading.RLock()
        self.seq=0;self.issued=0;self.expires=0;self.deadline=0;self.raw=None;self.started=False
    def refresh(self):
        try:
            now=int(self.clock()*1000);mono=self.monotonic()
            if self.started and (now>=self.expires or mono>=self.deadline):raise LeaseError("LEASE_EXPIRED")
            raw=self.reader(self.path)
            if self.started and raw==self.raw:return
            e=json.loads(raw)
            if set(e)!={"lease","signature"}:raise LeaseError("LEASE_FORMAT")
            p=e["lease"]
            if set(p)!=set(FIELDS) or type(p["version"]) is not int or p["version"]!=1 or any(p[k]!=self.identity[k] for k in IDENTITY):raise LeaseError("LEASE_SCOPE")
            if any(type(p[k]) is not int or p[k]>9007199254740991 for k in ("sequence","issuedAt","expiresAt")):raise LeaseError("LEASE_FORMAT")
            if not (p["sequence"]>self.seq and now-90000<=p["issuedAt"]<=now+2000 and now<p["expiresAt"]<=p["issuedAt"]+90000 and p["expiresAt"]>self.expires and p["issuedAt"]>=self.issued):raise LeaseError("LEASE_STALE")
            if not self.verify(p,e["signature"]):raise LeaseError("LEASE_SIGNATURE")
            # A delayed verification cannot resurrect an expired running lease.
            after=int(self.clock()*1000);end=self.monotonic()
            if after>=p["expiresAt"] or (self.started and (after>=self.expires or end>=self.deadline)):raise LeaseError("LEASE_EXPIRED")
            if not self.started:
                self.state_dir.mkdir(mode=0o700,exist_ok=True)
                st=self.state_dir.lstat()
                if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077:raise LeaseError("LEASE_STATE_PERMISSIONS")
                # One physical run per reservation, even after process failure.
                marker=self.state_dir/(self.identity["reservationId"]+".started")
                fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,"w") as f:
                    f.write(str(p["sequence"]));f.flush();os.fsync(f.fileno())
                fd=os.open(self.state_dir,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
            self.seq=p["sequence"];self.issued=p["issuedAt"];self.expires=p["expiresAt"]
            self.deadline=min(mono+(p["expiresAt"]-now)/1000,end+(p["expiresAt"]-after)/1000)
            self.raw=raw;self.started=True
        except LeaseError:raise
        except Exception as e:raise LeaseError("LEASE_UNAVAILABLE") from e
    def active(self):
        with self._lock:
            self.refresh()
            if self.monotonic()>=self.deadline or int(self.clock()*1000)>=self.expires:raise LeaseError("LEASE_EXPIRED")
            return True


def notify_watchdog():
    # systemd's independent watchdog covers even a frozen interpreter.
    address=os.environ.get("NOTIFY_SOCKET")
    if not address:return
    if address.startswith("@"):address="\0"+address[1:]
    with socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM) as s:
        s.settimeout(0.1)
        s.sendto(b"WATCHDOG=1",address)

class LeaseWatchdog:
    """Independently revoke a blocked source runtime when its lease expires.
    Production runs in a systemd control group; killing the main process
    does not certify provider release. The central ledger must remain held.
    """
    def __init__(self,guard,terminate=None,interval=0.5,notify=notify_watchdog):
        self.guard=guard
        self.terminate=terminate or (lambda:os.kill(os.getpid(),signal.SIGKILL))
        self.interval=interval;self.notify=notify
        self.closed=threading.Event();self.thread=None
    def start(self):
        self.guard.active()
        if self.thread is not None:raise LeaseError("WATCHDOG_ALREADY_STARTED")
        self.thread=threading.Thread(target=self.run,name="blofy-lease-watchdog",daemon=True)
        self.thread.start()
    def run(self):
        while not self.closed.is_set():
            try:
                self.guard.active()
                self.notify()
            except Exception:
                if not self.closed.is_set():self.terminate()
                return
            self.closed.wait(self.interval)
    def stop_after_source_closed(self):
        self.closed.set()
        if self.thread is not None:self.thread.join(timeout=4)
