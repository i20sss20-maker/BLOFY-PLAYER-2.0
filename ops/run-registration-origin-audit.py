"""Use the existing Azure deployment identity and container console for a read-only query."""
import base64
import os
from pathlib import Path
import pty
import signal

source = Path('ops/registration-origin-audit.cjs').read_bytes()
encoded = base64.b64encode(source).decode('ascii')
# Azure's WebSocket URL also carries the command. Keep that URL short; stream the
# reviewed source through stdin only after the remote process reports readiness.
program = '''let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{s+=c;if(s.includes('\\nBLOFY_AUDIT_END\\n')){process.stdin.pause();Promise.resolve(eval(Buffer.from(s.split('\\nBLOFY_AUDIT_END\\n')[0],'base64').toString())).finally(()=>process.stdin.destroy());}});console.log('BLOFY_AUDIT_READY');'''
# Container Apps tokenizes --command directly, without a shell's quote removal.
prelude = base64.b64encode(program.encode()).decode('ascii')
command = "node -e eval(Buffer.from('"+prelude+"','base64').toString())"
args = ['az', 'containerapp', 'exec', '--name', 'blofy-activation',
        '--resource-group', os.environ['AZURE_RG'], '--container', 'activation', '--command', command]
captured = bytearray()
sent = False
payload = ('\n'.join(encoded[i:i+256] for i in range(0,len(encoded),256))+'\nBLOFY_AUDIT_END\n').encode()

def read_output(fd):
    global sent
    data = os.read(fd, 65536)
    captured.extend(data)
    if not sent and b'BLOFY_AUDIT_READY' in captured:
        sent = True
        for start in range(0, len(payload), 512):
            os.write(fd, payload[start:start+512])
    return data

signal.alarm(180)
status = pty.spawn(args, master_read=read_output)
signal.alarm(0)
assert os.waitstatus_to_exitcode(status) == 0, 'Azure console command failed'
assert b'BLOFY_REGISTRATION_AUDIT_OK' in captured, 'Read-only audit did not finish'
assert b'BLOFY_REGISTRATION_AUDIT_FAILED=' not in captured, 'Read-only audit failed'
