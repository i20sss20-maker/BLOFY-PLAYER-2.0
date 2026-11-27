import json,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import blofy_live_lease_guard as guard
data=json.load(sys.stdin)
guard.PIN=data["pin"]
wall=[data["first"]["lease"]["issuedAt"]/1000]
mono=[100.0]
raw=[json.dumps(data["first"]).encode()]
with tempfile.TemporaryDirectory() as d:
    def make():
        return guard.LiveLeaseGuard(None,data["identity"],Path(d)/"state",clock=lambda:wall[0],monotonic=lambda:mono[0],reader=lambda _:raw[0])
    a=make()
    assert a.active()
    try:make().active()
    except guard.LeaseError:pass
    else:raise AssertionError("reservation replay started")
    wall[0]+=1;mono[0]+=1
    raw[0]=json.dumps(data["renewal"]).encode()
    assert a.active() and a.seq==2
    forged=json.loads(raw[0])
    forged["lease"]["sequence"]=3
    forged["lease"]["expiresAt"]+=10000
    raw[0]=json.dumps(forged).encode()
    try:a.active()
    except guard.LeaseError:pass
    else:raise AssertionError("forgery accepted")
    raw[0]=json.dumps(data["renewal"]).encode()
    mono[0]+=61
    try:a.active()
    except guard.LeaseError:pass
    else:raise AssertionError("expired worker lease accepted")
print("BLOFY_LEASE_WIRE_PASS")
