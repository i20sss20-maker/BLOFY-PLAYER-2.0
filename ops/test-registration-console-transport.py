"""Exercise the actual writer under backpressure, without Azure or a database."""
import ast
import base64
import gzip
import os
from pathlib import Path
import select
import subprocess
import threading

tree = ast.parse(Path('ops/run-registration-cleanup.py').read_text())
writer = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'send_source')
program = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == 'program' for target in node.targets))
fixture = '/*'+base64.b64encode(os.urandom(120000)).decode()+'*/\nPromise.resolve().then(()=>console.log("BLOFY_REGISTRATION_CLEANUP_OK"));'
encoded = base64.b64encode(gzip.compress(fixture.encode())).decode()
payload = ('\n'.join(encoded[i:i+256] for i in range(0,len(encoded),256))+'\nBLOFY_CLEANUP_END\n').encode()
reader_fd, writer_fd = os.pipe()
os.set_blocking(writer_fd, False)
scope = {'os':os,'select':select,'payload':payload}
exec(compile(ast.Module(body=[writer],type_ignores=[]),'<actual-console-writer>','exec'),scope)
thread = threading.Thread(target=scope['send_source'],args=(writer_fd,),daemon=True)
thread.start()
received = bytearray()
while len(received) < len(payload):
    assert select.select([reader_fd],[],[],5)[0], 'Writer stalled under backpressure'
    received.extend(os.read(reader_fd,1024))
thread.join(timeout=2)
assert not thread.is_alive() and bytes(received)==payload
os.close(reader_fd)
os.close(writer_fd)
prelude = base64.b64encode(program.encode()).decode()
command = "node -e eval(Buffer.from('"+prelude+"','base64').toString())"
assert len(command)<1000
result = subprocess.run(command.split(' '),input=payload,capture_output=True,timeout=10,check=True)
assert b'BLOFY_REGISTRATION_CLEANUP_OK' in result.stdout and not result.stderr
print('Console writer preserves all bytes under nonblocking backpressure; compressed source executes successfully')
