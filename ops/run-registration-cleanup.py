"""Run the reviewed, fixed 2026-09-21 cleanup through the existing Azure identity."""
import base64
import json
import os
from pathlib import Path
import pty
import signal
import threading

manifest = json.loads(Path('ops/registration-cleanup-20260921.json').read_text())
assert len(manifest) == 172
source = Path('ops/registration-cleanup.cjs').read_text()
source += '\nconst reviewedManifest=' + json.dumps(manifest, separators=(',', ':')) + ';\n'
source += '''
(async()=>{
  const {Pool}=require('pg');
  const {databaseOptions}=await import('/app/src/database-options.mjs');
  const pool=new Pool(databaseOptions(process.env.DATABASE_URL,{
    max:1,application_name:'blofy-ci-registration-cleanup-20260921',connectionTimeoutMillis:10000
  }));
  const client=await pool.connect();
  try {
    const result=await cleanup(client,reviewedManifest,'ci-registration-cleanup-20260921');
    console.log('BLOFY_REGISTRATION_CLEANUP='+JSON.stringify(result));
    console.log('BLOFY_REGISTRATION_CLEANUP_OK');
  } finally {client.release();await pool.end();}
})().catch(error=>{
  console.error('BLOFY_REGISTRATION_CLEANUP_FAILED='+String(error.code||error.name));
  if(error.code==='ERR_ASSERTION')console.error('CLEANUP_GUARD='+error.message.split('\\n')[0]);
  process.exitCode=1;
});
'''
encoded = base64.b64encode(source.encode()).decode('ascii')
program = '''let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{s+=c;if(s.includes('\\nBLOFY_CLEANUP_END\\n')){process.stdin.pause();Promise.resolve(eval(Buffer.from(s.split('\\nBLOFY_CLEANUP_END\\n')[0],'base64').toString())).finally(()=>process.stdin.destroy());}});console.log('BLOFY_CLEANUP_READY');'''
prelude = base64.b64encode(program.encode()).decode('ascii')
command = "node -e eval(Buffer.from('"+prelude+"','base64').toString())"
args = ['az', 'containerapp', 'exec', '--name', 'blofy-activation',
        '--resource-group', os.environ['AZURE_RG'], '--container', 'activation', '--command', command]
captured = bytearray()
sent = False
payload = ('\n'.join(encoded[i:i+256] for i in range(0,len(encoded),256))+'\nBLOFY_CLEANUP_END\n').encode()

def send_source(fd):
    # Read output concurrently so terminal echo cannot fill the PTY during a large manifest.
    offset = 0
    while offset < len(payload):
        offset += os.write(fd, payload[offset:offset+512])

def read_output(fd):
    global sent
    data = os.read(fd, 65536)
    captured.extend(data)
    if not sent and b'BLOFY_CLEANUP_READY' in captured:
        sent = True
        threading.Thread(target=send_source, args=(fd,), daemon=True).start()
    return data

signal.alarm(180)
status = pty.spawn(args, master_read=read_output)
signal.alarm(0)
assert os.waitstatus_to_exitcode(status) == 0, 'Azure console command failed'
assert b'BLOFY_REGISTRATION_CLEANUP_OK' in captured, 'Cleanup did not finish'
assert b'BLOFY_REGISTRATION_CLEANUP_FAILED=' not in captured, 'Cleanup aborted'
