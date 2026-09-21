"""Use the existing Azure deployment identity and container console for a read-only query."""
import base64
import os
from pathlib import Path
import pty
import shlex
import signal

source = Path('ops/registration-origin-audit.cjs').read_bytes()
encoded = base64.b64encode(source).decode('ascii')
command = shlex.join(['node', '-e', f"eval(Buffer.from('{encoded}','base64').toString())"])
args = ['az', 'containerapp', 'exec', '--name', 'blofy-activation',
        '--resource-group', os.environ['AZURE_RG'], '--container', 'activation', '--command', command]
captured = bytearray()

def read_output(fd):
    data = os.read(fd, 65536)
    captured.extend(data)
    return data

signal.alarm(180)
status = pty.spawn(args, master_read=read_output)
signal.alarm(0)
assert os.waitstatus_to_exitcode(status) == 0, 'Azure console command failed'
assert b'BLOFY_REGISTRATION_AUDIT_OK' in captured, 'Read-only audit did not finish'
assert b'BLOFY_REGISTRATION_AUDIT_FAILED=' not in captured, 'Read-only audit failed'
