import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createServer, get as httpGet} from 'node:http';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {installGracefulShutdown} from './graceful-shutdown.mjs';

const log={info(){},warn(){},error(){}};
const data=path=>readFile(new URL(path,import.meta.url),'utf8');

test('SIGTERM refuses new requests but lets an in-flight APK byte stream finish',async()=>{
  const emitter=new EventEmitter();
  let stream,arrived;
  const arrivedPromise=new Promise(resolve=>{arrived=resolve});
  const http=createServer((req,res)=>{
    res.writeHead(200,{'content-type':'application/vnd.android.package-archive'});
    res.write('APK-part-A');
    stream=res;
    arrived();
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const port=http.address().port;
  let received='';
  const complete=new Promise((resolve,reject)=>{
    httpGet({hostname:'127.0.0.1',port,path:'/files/releases/signed.apk'},res=>{
      res.on('data',chunk=>{received+=chunk.toString('utf8')});
      res.on('end',resolve);
      res.on('error',reject);
    }).on('error',reject);
  });
  await arrivedPromise;
  let cleanup=0,stop=0,exitCode=null;
  let didTerminate;
  const termination=new Promise(resolve=>{didTerminate=resolve});
  const gate=installGracefulShutdown({
    server:http,emitter,drainMs:1000,logger:log,
    stopJobs:()=>{stop++},
    closeResources:async()=>{cleanup++},
    terminate:code=>{exitCode=code;didTerminate()}
  });
  emitter.emit('SIGTERM');
  emitter.emit('SIGINT');
  assert.equal(gate.isDraining(),true);
  assert.equal(stop,1,'duplicate signals cannot stop background work twice');
  await delay(25);
  assert.equal(exitCode,null,'must not exit while download is still in progress');
  assert.equal(cleanup,0,'database connections stay alive for in-flight metrics');
  stream.end('APK-part-B');
  await Promise.all([complete,termination]);
  assert.equal(received,'APK-part-AAPK-part-B');
  assert.equal(exitCode,0);
  assert.equal(cleanup,1);
  gate.unregister();
});

test('stuck active downloads are force-closed after bounded deadline',async()=>{
  const emitter=new EventEmitter();
  let closed=0,force=0,stopped=0,finished=0;
  const fakeServer={
    close(){closed++},
    closeIdleConnections(){},
    closeAllConnections(){force++}
  };
  const end=new Promise(resolve=>{
    installGracefulShutdown({
      server:fakeServer,emitter,drainMs:20,logger:log,
      stopJobs:()=>stopped++,
      closeResources:async()=>finished++,
      terminate:code=>resolve(code)
    });
  });
  emitter.emit('SIGTERM');
  const [code]=await Promise.all([end,delay(30)]);
  assert.equal(code,1);
  assert.equal(closed,1);
  assert.equal(force,1);
  assert.equal(stopped,1);
  assert.equal(finished,1);
});

test('server close failures cannot leave process hanging indefinitely',async()=>{
  const emitter=new EventEmitter();
  const fake={close(cb){cb(Object.assign(new Error('server_failed'),{code:'BAD'}))}};
  const result=new Promise(resolve=>{
    installGracefulShutdown({
      server:fake,emitter,drainMs:1000,logger:log,
      terminate:resolve
    });
  });
  emitter.emit('SIGTERM');
  assert.equal(await result,1);
});

test('invalid hooks, invalid deadline and missing server rejected safely',()=>{
  assert.throws(()=>installGracefulShutdown({}),/invalid_graceful_shutdown_configuration/);
  assert.throws(()=>installGracefulShutdown({server:{close(){}},drainMs:115001}),/invalid_graceful_shutdown_configuration/);
  assert.throws(()=>installGracefulShutdown({server:{close(){}},stopJobs:42}),/invalid_graceful_shutdown_configuration/);
});

test('production startup wires Railway signal draining and the Docker image includes its module',async()=>{
  const [src,docker,pkg]=await Promise.all([
    data('./server.mjs'),data('./Dockerfile'),data('./package.json')
  ]);
  assert.match(src,/import \{ installGracefulShutdown \} from '\.\/graceful-shutdown\.mjs'/);
  assert.match(src,/installGracefulShutdown\(\{/);
  assert.match(src,/drainMs:105_000/);
  assert.match(src,/stopJobs:\(\)=>stopScheduledRefresh\(\)/);
  assert.match(src,/closeReleaseStore\(\),closeAppLibrary\(\)/);
  assert.match(docker,/graceful-shutdown\.mjs/);
  assert.match(pkg,/graceful-shutdown\.test\.mjs/);
});
