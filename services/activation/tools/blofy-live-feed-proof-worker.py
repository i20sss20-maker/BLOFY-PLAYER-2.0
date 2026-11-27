#!/usr/bin/env python3
"""Read-only proof of a currently leased local HLS feed. No media requests."""
import base64,json,os,re,secrets,socket,stat,subprocess,tempfile,time
from datetime import datetime
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
from blofy_live_lease_guard import UUID,FIELDS,read_root_file,verify_signature
ENGINE={"blofy-engine-01":"linode","blofy-engine-02":"hostbrr"}.get(socket.gethostname().split(".")[0])
ROOT=Path("/var/lib/blofy-real-live")
KEY=Path("/var/lib/blofy-control-qa/worker.pem")
URL="https://blofy-engine-control-qa-production.up.railway.app"
IDENTITY=("engineId","sourceId","channelId","reservationId","generation")
PROOF_FIELDS=("version",*IDENTITY,"challenge","observedAt","status","lastSegment","localSourceConnections")
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
def post(path,data):
    req=Request(URL+path,data=json.dumps(data).encode(),headers={"Content-Type":"application/json"},method="POST")
    with build_opener(ProxyHandler({}),NoRedirect()).open(req,timeout=5) as r:
        raw=r.read(4097)
        if len(raw)>4096:raise RuntimeError("response_too_large")
        return json.loads(raw)
def sign_proof(proof,key):
    message=json.dumps(["BLOFY_LIVE_FEED_PROOF_V1",*[proof[k] for k in PROOF_FIELDS]],separators=(",",":")).encode()
    with tempfile.TemporaryDirectory() as tmp:
        p=Path(tmp)/"message";p.write_bytes(message)
        sig=subprocess.check_output(["/usr/bin/openssl","pkeyutl","-sign","-inkey",str(key),"-rawin","-in",str(p)],timeout=3,stderr=subprocess.DEVNULL)
    if len(sig)!=64:raise RuntimeError("signature_invalid")
    return {"proof":proof,"signature":base64.urlsafe_b64encode(sig).decode().rstrip("=")}
def make_ready_proof(identity,challenge,status,lease,progress,now):
    if set(identity)!=set(IDENTITY) or identity["engineId"] not in ("linode","hostbrr") or not all(isinstance(identity[k],str) and UUID.fullmatch(identity[k]) for k in ("sourceId","reservationId")):return None
    if not re.fullmatch(r"[1-9][0-9]{0,14}",identity["channelId"]) or identity["generation"]!=identity["reservationId"].replace("-","") or not re.fullmatch(r"[a-f0-9]{32}",challenge):return None
    if set(lease)!=set(FIELDS) or lease["version"]!=1 or any(lease[k]!=identity[k] for k in IDENTITY if k!="generation"):return None
    if not all(type(lease[k]) is int for k in ("issuedAt","expiresAt","sequence")) or not now-90000<=lease["issuedAt"]<=now+2000 or not now<lease["expiresAt"]<=lease["issuedAt"]+90000 or lease["sequence"]<1:return None
    if status.get("status")!="private_hls_ready" or any(status.get(k)!=identity[k] for k in IDENTITY):return None
    try:observed=int(datetime.fromisoformat(status["observedAt"]).timestamp()*1000)
    except (KeyError,TypeError,ValueError):return None
    if not now-10000<=observed<=now+2000 or type(progress) is not int or progress<0 or type(status.get("lastSegment")) is not int or progress<status["lastSegment"]:return None
    return {"version":1,**identity,"challenge":challenge,"observedAt":now,"status":"private_hls_ready","lastSegment":progress,"localSourceConnections":1}
def mainpid():
    raw=subprocess.check_output(["/usr/bin/systemctl","show","-p","ActiveState","-p","MainPID","blofy-leased-live.service"],text=True,timeout=3)
    values=dict(line.split("=",1) for line in raw.splitlines())
    pid=int(values.get("MainPID","0"))
    return pid if values.get("ActiveState")=="active" and pid>1 else 0
def main():
    if os.getuid()!=0 or ENGINE is None:raise RuntimeError("root_or_engine")
    os.umask(0o077)
    pid=mainpid()
    if not pid:return
    status=json.loads(subprocess.check_output(["/usr/sbin/runuser","-u","blofycontrolqa","--","/usr/bin/env","SSH_ORIGINAL_COMMAND=status "+secrets.token_hex(16),"/usr/bin/python3","-I","/var/lib/blofy-control-qa/control.py"],timeout=6))
    reply=post("/control/feed-proof/poll",status)
    if reply.get("ok") is not True:raise RuntimeError("poll_failed")
    if reply.get("challenge") is None:return
    identity=reply["identity"];challenge=reply["challenge"]
    if identity.get("engineId")!=ENGINE or reply["expiresAt"]<=time.time_ns()//1000000:return
    envelope=json.loads(read_root_file(Path("/run/blofy-live-lease/lease.json")))
    lease=envelope["lease"]
    if not verify_signature(lease,envelope["signature"]):return
    s=json.loads(read_root_file(ROOT/"status.json"))
    # Runtime helper validates freshness, complete consecutive segments and
    # rejects symlinks. This is local HLS progress, not upstream-wide proof.
    from live_runtime_leased_candidate import playlist_progress
    generation=identity["generation"]
    if not re.fullmatch(r"[a-f0-9]{32}",generation):return
    progress=playlist_progress(ROOT/generation)
    now=time.time_ns()//1000000
    proof=make_ready_proof(identity,challenge,s,lease,progress,now)
    if proof is None or mainpid()!=pid or reply["expiresAt"]<=time.time_ns()//1000000:return
    st=KEY.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_mode&0o037:raise RuntimeError("key_permissions")
    signed=sign_proof(proof,KEY)
    if mainpid()!=pid or lease["expiresAt"]<=time.time_ns()//1000000:return
    ack=post("/control/feed-proof/complete",signed)
    if ack.get("ok") is not True:raise RuntimeError("proof_rejected")
    print("BLOFY_LIVE_FEED_PROOF_ACCEPTED",ENGINE,flush=True)
if __name__=="__main__":
    try:main()
    except Exception as e:
        print("BLOFY_LIVE_FEED_PROOF_STOPPED",type(e).__name__,flush=True);raise SystemExit(1)
