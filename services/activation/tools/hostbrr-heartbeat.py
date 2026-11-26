#!/usr/bin/env python3
"""Read-only heartbeat; never starts workers or accesses source credentials."""
import datetime,json,os,re,stat,subprocess,urllib.request
from pathlib import Path
TOKEN=Path('/etc/blofy-security/hostbrr-heartbeat.token')
STATUS=Path('/var/lib/blofy-real-live/status.json')
ENDPOINT='https://api.blofyplayer.com/api/v1/internal/hostbrr-worker-heartbeat'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None
def active(unit):
    return subprocess.run(['systemctl','is-active','--quiet',unit],timeout=5).returncode==0
def healthy(url,marker):
    try:
        with urllib.request.build_opener(NoRedirect()).open(url,timeout=5) as r:
            return r.status==200 and r.read(129).strip()==marker
    except Exception:
        return False
def main():
    st=TOKEN.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o600:
        raise ValueError('token permissions')
    token=TOKEN.read_text().strip()
    if not re.fullmatch('[a-f0-9]{64}',token):raise ValueError('token format')
    worker='unknown'
    try:
        if STATUS.exists():
            if STATUS.stat().st_size>16384:raise ValueError('status too large')
            p=json.loads(STATUS.read_text())
            if p.get('synthetic') is not True:
                worker=p.get('status','unknown')
                if worker in ('opening','private_hls_ready','releasing') and not active('blofy-hoster-live-pilot.service'):
                    worker='unknown'
        elif not active('blofy-hoster-live-pilot.service'):
            worker='inactive'
    except Exception:pass
    if worker not in ('inactive','opening','private_hls_ready','releasing','released','release_unverified','unknown'):worker='unknown'
    memory=next(int(l.split()[1])//1024 for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))
    disk=os.statvfs('/')
    payload=json.dumps(dict(engineId='hostbrr',mode='monitoring-only',customerTrafficEnabled=False,
        timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),workerStatus=worker,
        deliveryHealthy=healthy('http://127.0.0.1:3022/healthz',b'private delivery only'),
        gatewayHealthy=healthy('https://media2.blofyplayer.com/healthz',b'BLOFY_HOSTER_GATEWAY_READY'),
        memoryAvailableMiB=memory,diskFreeMiB=disk.f_bavail*disk.f_frsize//1048576)).encode()
    req=urllib.request.Request(ENDPOINT,data=payload,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.build_opener(NoRedirect()).open(req,timeout=10) as r:
        if r.status!=200 or json.loads(r.read(512)).get('ok') is not True:raise ValueError('heartbeat rejected')
    print('BLOFY_HOSTBRR_HEARTBEAT_OK')
if __name__=='__main__':
    try:main()
    except Exception as e:
        print('BLOFY_HOSTBRR_HEARTBEAT_FAILED',type(e).__name__)
        raise SystemExit(1)
