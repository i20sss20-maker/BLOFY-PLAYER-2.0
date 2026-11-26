#!/usr/bin/env python3
"""One bounded, explicitly authorized pilot. Never arbitrary remote execution."""
import base64,json,os,re,secrets,socket,subprocess,sys,tempfile,time
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
URL="https://blofy-engine-control-qa-production.up.railway.app/control/pilot/poll"
PUBLIC="MCowBQYDK2VwAyEAxtbHHm7Ic1yMvEAldZh36zPYHCvllmh9KqgM6mxS0P4="
ENGINE,UNIT,EXPECTED={
 "blofy-engine-01":("linode","blofy-real-live.service","/opt/blofy/source-transport-v3/live_runtime.py"),
 "blofy-engine-02":("hostbrr","blofy-hoster-live-pilot.service","/opt/blofy/hostbrr-stage-v1/live_runtime.py"),
}[socket.gethostname().split(".")[0]]
STATE=Path("/var/lib/blofy-bounded-pilot")
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
def systemctl(*args):
 return subprocess.check_output(["/usr/bin/systemctl",*args,UNIT],text=True,timeout=10).strip()
def proof():
 return json.loads(subprocess.check_output(["/usr/sbin/runuser","-u","blofycontrolqa","--","/usr/bin/env","SSH_ORIGINAL_COMMAND=status "+secrets.token_hex(16),"/usr/bin/python3","-I","/var/lib/blofy-control-qa/control.py"],timeout=12))
def poll():
 req=Request(URL,data=json.dumps(proof()).encode(),headers={"Content-Type":"application/json"},method="POST")
 with build_opener(ProxyHandler({}),NoRedirect()).open(req,timeout=10) as r:
  data=r.read(4097)
  if len(data)>4096:raise RuntimeError("oversize")
  return json.loads(data)
def main():
 if os.getuid()!=0:raise RuntimeError("root_required")
 os.umask(0o077)
 STATE.mkdir(mode=0o700,exist_ok=True)
 if STATE.is_symlink() or STATE.stat().st_uid!=0 or STATE.stat().st_mode&0o077:raise RuntimeError("state_permissions")
 check=sys.argv[1:]==["--check"]
 if sys.argv[1:] and not check:raise RuntimeError("invalid_arguments")
 if not check and not (STATE/"armed-permit").is_file():return
 e=poll()
 if e.get("ok") is not True:raise RuntimeError("poll_failed")
 if e.get("permit") is None:
  print("BLOFY_PILOT_STANDBY",ENGINE,flush=True);return
 if check:raise RuntimeError("permit_present_check_only")
 p=e["permit"];now=time.time_ns()//1000000
 fields=["version","engineId","operation","permitId","issuedAt","expiresAt"]
 if set(e)!={"ok","permit","signature"} or set(p)!=set(fields) or p["version"]!=1 or p["engineId"]!=ENGINE or p["operation"]!="run_bounded_pilot" or not re.fullmatch(r"[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}",p["permitId"]) or type(p["issuedAt"]) is not int or type(p["expiresAt"]) is not int or not p["issuedAt"]<=now+2000 or not 420000<=p["expiresAt"]-now<=600000 or p["expiresAt"]-p["issuedAt"]>600000 or not re.fullmatch(r"[A-Za-z0-9_-]{86}",e["signature"]):raise RuntimeError("invalid_permit")
 with tempfile.TemporaryDirectory() as d:
  q=Path(d);(q/"key").write_bytes(base64.b64decode(PUBLIC));(q/"msg").write_bytes(json.dumps(["BLOFY_BOUNDED_PILOT_V1",*[p[k] for k in fields]],separators=(",",":")).encode());(q/"sig").write_bytes(base64.urlsafe_b64decode(e["signature"]+"=="))
  subprocess.run(["/usr/bin/openssl","pkeyutl","-verify","-pubin","-keyform","DER","-inkey",str(q/"key"),"-rawin","-in",str(q/"msg"),"-sigfile",str(q/"sig")],check=True,timeout=5,stdout=subprocess.DEVNULL)
 # Only a pre-existing fixed pilot with a hard local service deadline.
 # Never accept command strings, source URLs, channels or environment remotely.
 if systemctl("show","-p","LoadState","--value")!="loaded" or systemctl("show","-p","Restart","--value")!="no" or systemctl("show","-p","Type","--value") not in ("simple","exec") or systemctl("show","-p","RuntimeMaxUSec","--value") not in ("6min","5min","4min","3min") or EXPECTED not in systemctl("show","-p","ExecStart","--value") or systemctl("show","-p","ActiveState","--value")!="inactive":raise RuntimeError("pilot_unit_not_bounded_or_idle")
 # Local root must independently arm the exact permit after the maintenance
 # barriers and provider exclusivity are verified. Installation alone cannot
 # start a feed. Consume the local arm and persist a tombstone before launch.
 arm=STATE/"armed-permit"
 if not arm.is_file() or arm.is_symlink() or arm.stat().st_uid!=0 or arm.stat().st_mode&0o077 or arm.read_text().strip()!=p["permitId"]:raise RuntimeError("local_exclusive_arm_required")
 if p["expiresAt"]-time.time_ns()//1000000<420000:raise RuntimeError("window_too_short")
 marker=STATE/(p["permitId"]+".used")
 try:fd=os.open(marker,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 except FileExistsError:return
 with os.fdopen(fd,"w") as f:f.write(str(now));f.flush();os.fsync(f.fileno())
 arm.unlink()
 fd=os.open(STATE,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
 subprocess.run(["/usr/bin/systemctl","start","--no-block",UNIT],check=True,timeout=10)
 print("BLOFY_BOUNDED_PILOT_DISPATCHED",ENGINE,p["permitId"],flush=True)
if __name__=="__main__":main()
