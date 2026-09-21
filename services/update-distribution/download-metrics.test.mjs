import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { Readable } from 'node:stream';
import { observeDownloadCompletion, recordCompletedDownload } from './download-metrics.mjs';

function transfer(options = {}) {
  const res = new EventEmitter(), body = new EventEmitter();
  res.writableFinished = false;
  let count = 0;
  observeDownloadCompletion({ req: {method:'GET'}, res, body, status:200, length:'4',
    onComplete: () => { count++; }, ...options });
  return { res, body, count: () => count, finish() { res.writableFinished = true; res.emit('finish'); } };
}
const settled = () => new Promise(resolve => setImmediate(resolve));

test('count only after all bytes, upstream EOF and response finish; once per response', async () => {
  const x = transfer(); x.body.emit('data',Buffer.from('APK!'));
  assert.equal(x.count(),0); x.body.emit('end'); assert.equal(x.count(),0);
  x.finish(); x.finish(); await settled(); assert.equal(x.count(),1);
});
test('HEAD, partial ranges, failed, cancelled, truncated and unknown-length requests never count as complete', async () => {
  for (const options of [{req:{method:'HEAD'}},{status:206,contentRange:'bytes 0-3/8'},
    {status:206,contentRange:'bytes 4-7/8'},{status:500},{length:null},{length:'garbage'}]) {
    const x=transfer(options);x.body.emit('data',Buffer.from('APK!'));x.body.emit('end');x.finish();await settled();assert.equal(x.count(),0);
  }
  for (const kind of ['cancelled','truncated','error','missing-eof']) {
    const x=transfer();x.body.emit('data',Buffer.from(kind==='truncated'?'AP':'APK!'));
    if(kind==='cancelled')x.res.emit('close');
    if(kind==='error')x.body.emit('error',new Error('upstream failed'));
    if(kind!=='missing-eof')x.body.emit('end');
    x.finish();await settled();assert.equal(x.count(),0,kind);
  }
});
test('one range containing the entire file counts; logging failure cannot break download', async () => {
  const x=transfer({status:206,contentRange:'bytes 0-3/4'});x.body.emit('data',Buffer.from('APK!'));x.body.emit('end');x.finish();await settled();assert.equal(x.count(),1);
  let logged=false;const y=transfer({onComplete:async()=>{throw Error('database unavailable');},onError:()=>{logged=true;}});
  y.body.emit('data',Buffer.from('APK!'));y.body.emit('end');y.finish();await settled();assert.equal(logged,true);
});
test('invalid metric keys are rejected before querying storage',async()=>{
  let queried=false;const pool={query:()=>{queried=true;}};
  await assert.rejects(recordCompletedDownload(pool,'device:private-id'),/invalid_download_stat_key/);assert.equal(queried,false);
});

test('a real streamed HTTP response records a complete file once, while HEAD records none', async () => {
  const payload = Buffer.alloc(128 * 1024, 42);
  let count = 0;
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'content-length': payload.length});
    if (req.method === 'HEAD') return res.end();
    const body = Readable.fromWeb(new Response(payload).body);
    observeDownloadCompletion({req, res, body, status:200, length:String(payload.length), onComplete:() => { count++; }});
    body.pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/download.apk`;
  try {
    assert.deepEqual(Buffer.from(await (await fetch(url)).arrayBuffer()), payload);
    await settled(); assert.equal(count, 1);
    assert.equal((await fetch(url, {method:'HEAD'})).status, 200);
    await settled(); assert.equal(count, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
