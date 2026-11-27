#!/usr/bin/env python3
"""Read-only permanent signed status worker. No remote executable commands."""
import base64,json,re,secrets,socket,subprocess,sys,tempfile,time
from pathlib import Path
from urllib.request import Request,build_opener,HTTPRedirectHandler,ProxyHandler
URL='https://blofy-engine-control-qa-production.up.railway.app'
ENGINE={'blofy-engine-01':'linode','blofy-engine-02':'hostbrr'}[socket.gethostname().split('.')[0]]
PUB=base64.b64decode(sys.argv[1],validate=True)
if len(PUB)!=44: raise RuntimeError('INVALID_CONTROLLER_PIN')
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None
opener=build_opener(ProxyHandler({}),NoRedirect())
def post(path,body):
    req=Request(URL+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
    with opener.open(req,timeout=8) as r:
        data=r.read(4097)
        if len(data)>4096: raise RuntimeError('RESPONSE_TOO_LARGE')
        return json.loads(data)
def status(challenge):
    return json.loads(subprocess.check_output(['/usr/bin/python3','-I','/var/lib/blofy-control-qa/worker-status.py',challenge],timeout=6))
e=post('/control/status/poll',status(secrets.token_hex(16)))
fields=['version','engineId','operation','challenge','issuedAt','expiresAt']
c=e['command']; now=time.time_ns()//1000000
if (set(e)!={'command','signature'} or set(c)!=set(fields) or c['version']!=1 or c['engineId']!=ENGINE or c['operation']!='status' or not re.fullmatch('[a-f0-9]{32}',c['challenge']) or not (now-30000<=c['issuedAt']<=now+2000 and now<c['expiresAt']<=c['issuedAt']+30000) or not re.fullmatch('[A-Za-z0-9_-]{86}',e['signature'])):
    raise RuntimeError('INVALID_COMMAND')
with tempfile.TemporaryDirectory() as tmp:
    d=Path(tmp)
    (d/'key').write_bytes(PUB)
    (d/'msg').write_bytes(json.dumps(['BLOFY_STATUS_COMMAND_V1',*[c[k] for k in fields]],separators=(',',':')).encode())
    (d/'sig').write_bytes(base64.urlsafe_b64decode(e['signature']+'=='))
    subprocess.run(['/usr/bin/openssl','pkeyutl','-verify','-pubin','-keyform','DER','-inkey',str(d/'key'),'-rawin','-in',str(d/'msg'),'-sigfile',str(d/'sig')],check=True,timeout=5,stdout=subprocess.DEVNULL)
if time.time_ns()//1000000>=c['expiresAt']: raise RuntimeError('EXPIRED_COMMAND')
r=post('/control/status/complete',status(c['challenge']))
if r.get('ok') is not True or r.get('engineId')!=ENGINE: raise RuntimeError('ACK_FAILED')
print('BLOFY_DURABLE_WORKER_READY',ENGINE,flush=True)
