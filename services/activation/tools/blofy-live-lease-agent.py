#!/usr/bin/env python3
"""Pull only fixed, signed live leases. Never accept arbitrary commands."""
import fcntl,json,os,re,secrets,socket,stat,subprocess,sys,tempfile,time
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
from blofy_live_lease_guard import FIELDS, UUID, verify_signature,read_root_file
ENGINE,RUNTIME={
 "blofy-engine-01":("linode","/opt/blofy/source-transport-v3/live_runtime_leased_candidate.py"),
 "blofy-engine-02":("hostbrr","/opt/blofy/hostbrr-stage-v1/live_runtime_leased_candidate.py"),
}[socket.gethostname().split(".")[0]]
UNIT="blofy-leased-live.service"
RUN=Path("/run/blofy-live-lease")
BASE=Path("/var/lib/blofy-real-live/lease-reservations")
CONFIG=Path("/etc/blofy-security/leased-source-id")
URL="https://blofy-engine-control-qa-production.up.railway.app/control/lease/poll"
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def systemctl(*args):
    return subprocess.check_output(["/usr/bin/systemctl",*args,UNIT],text=True,timeout=10).strip()
def poll():
    status=json.loads(subprocess.check_output(["/usr/sbin/runuser","-u","blofycontrolqa","--","/usr/bin/env","SSH_ORIGINAL_COMMAND=status "+secrets.token_hex(16),"/usr/bin/python3","-I","/var/lib/blofy-control-qa/control.py"],timeout=12))
    req=Request(URL,data=json.dumps(status).encode(),headers={"Content-Type":"application/json"},method="POST")
    with build_opener(ProxyHandler({}),NoRedirect()).open(req,timeout=8) as r:
        data=r.read(4097)
        if len(data)>4096:raise RuntimeError("response_too_large")
        return json.loads(data)
def atomic_file(path,data):
    fd,name=tempfile.mkstemp(prefix=".lease-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(name,path)
        d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
    finally:
        if os.path.exists(name):os.unlink(name)
def validate(e,source):
    p=e["lease"];now=time.time_ns()//1000000
    if set(e)!={"ok","lease","signature"} or e["ok"] is not True or set(p)!=set(FIELDS) or type(p["version"]) is not int or p["version"]!=1 or p["engineId"]!=ENGINE or p["sourceId"]!=source or not UUID.fullmatch(p["reservationId"]) or not re.fullmatch(r"[1-9][0-9]{0,14}",p["channelId"]):raise RuntimeError("invalid_identity")
    if any(type(p[k]) is not int or p[k]>9007199254740991 for k in ("sequence","issuedAt","expiresAt")) or p["sequence"]<1 or not now-90000<=p["issuedAt"]<=now+2000 or not now+15000<p["expiresAt"]<=p["issuedAt"]+90000:raise RuntimeError("invalid_time")
    if not verify_signature(p,e["signature"]):raise RuntimeError("invalid_signature")
    if p["expiresAt"]<=time.time_ns()//1000000+15000:raise RuntimeError("lease_too_short")
    return p
def main():
    if os.getuid()!=0:raise RuntimeError("root_required")
    if sys.argv[1:] not in ([],["--check"]):raise RuntimeError("invalid_argument")
    os.umask(0o077)
    check=sys.argv[1:]==["--check"]
    # Installation is inert until the operator explicitly configures the
    # exact source and the controller has the authoritative all-paths fence.
    if not check and not CONFIG.exists():return
    e=poll()
    if e.get("ok") is not True:raise RuntimeError("poll_failed")
    if e.get("lease") is None:
        print("BLOFY_LEASE_STANDBY",ENGINE,flush=True);return
    if check:raise RuntimeError("check_mode_lease_present_no_execution")
    source=read_root_file(CONFIG).decode().strip()
    if not UUID.fullmatch(source):raise RuntimeError("source_config_invalid")
    p=validate(e,source)
    RUN.mkdir(mode=0o700,exist_ok=True)
    st=RUN.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_mode&0o077:raise RuntimeError("run_permissions")
    fd=os.open(RUN/"agent.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if systemctl("show","-p","LoadState","--value")!="loaded" or systemctl("show","-p","Restart","--value")!="no" or systemctl("show","-p","KillMode","--value")!="control-group" or RUNTIME not in systemctl("show","-p","ExecStart","--value"):raise RuntimeError("unit_not_ready")
        state=systemctl("show","-p","ActiveState","--value")
        path=RUN/"lease.json";old=None
        if path.exists():old=json.loads(read_root_file(path))["lease"]
        same=old and all(old[k]==p[k] for k in ("engineId","sourceId","channelId","reservationId"))
        if state in ("active","activating"):
            if not same:raise RuntimeError("different_live_reservation")
            if p["sequence"]<=old["sequence"] or p["expiresAt"]<=old["expiresAt"]:return
        elif state not in ("inactive","failed"):raise RuntimeError("unit_state_uncertain")
        else:
            if same or (BASE/(p["reservationId"]+".started")).exists():raise RuntimeError("reservation_cannot_restart")
            if old and old["expiresAt"]>time.time_ns()//1000000:raise RuntimeError("previous_lease_not_expired")
            env="BLOFY_LIVE_MODE=lease\nBLOFY_EXCLUSIVE_SOURCE_WINDOW=1\nBLOFY_LIVE_CHANNEL_ID="+p["channelId"]+"\nBLOFY_LIVE_SOURCE_ID="+source+"\nBLOFY_LIVE_RESERVATION_ID="+p["reservationId"]+"\n"
            atomic_file(RUN/"runtime.env",env.encode())
        if p["expiresAt"]<=time.time_ns()//1000000+15000:raise RuntimeError("expired_before_dispatch")
        atomic_file(path,json.dumps({"lease":p,"signature":e["signature"]},separators=(",",":")).encode())
        if state in ("inactive","failed"):
            subprocess.run(["/usr/bin/systemctl","reset-failed",UNIT],check=True,timeout=10)
            subprocess.run(["/usr/bin/systemctl","start","--no-block",UNIT],check=True,timeout=10)
            print("BLOFY_LEASE_STARTED",ENGINE,flush=True)
        else:print("BLOFY_LEASE_RENEWED",ENGINE,p["sequence"],flush=True)
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("BLOFY_LEASE_AGENT_STOPPED",type(e).__name__,flush=True);sys.exit(1)
