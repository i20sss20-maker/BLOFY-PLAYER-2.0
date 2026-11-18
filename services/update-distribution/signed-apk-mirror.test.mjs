import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  createSignedApkMirror,mirrorConfigFromEnv,pinnedSignedApks
} from './signed-apk-mirror.mjs';

const PINNED=pinnedSignedApks();
const CONF={enabled:true,ready:true,bucket:'test-signed-private',
  endpoint:'https://example.storageapi.dev',region:'auto',
  accessKeyId:'fake',secretAccessKey:'fake',forcePathStyle:false};
const nop={info(){},warn(){},error(){}};

test('only original pinned, owner-signed STREAM artifacts are mirrored',()=>{
  assert.equal(PINNED.length,2);
  assert.deepEqual(PINNED.map(x=>x.filename.includes('56.0-')?'56.0':'55.8.36'),['55.8.36','56.0']);
  for(const pin of PINNED){
    assert.match(pin.sha256,/^[a-f0-9]{64}$/);
    assert.ok(pin.size>100_000_000);
    assert.match(pin.filename,/OWNER-SIGNED\.apk$/);
  }
});

test('no credentials or explicit switch means no connection or customer cutover',async()=>{
  const cfg=mirrorConfigFromEnv({BLOFY_APK_MIRROR_ENABLED:'1',
    BLOFY_APK_MIRROR_ENDPOINT:'https://storage.example',
    BLOFY_APK_MIRROR_BUCKET:'test-bucket'});
  assert.equal(cfg.enabled,true);
  assert.equal(cfg.ready,false);
  let calls=0;
  const mirror=createSignedApkMirror({config:cfg,storeFactory:async()=>{calls++;}});
  const status=await mirror.sync();
  assert.equal(status.mode,'backup_only');
  assert.equal(status.ready,false);
  assert.equal(calls,0);
  assert.ok(!JSON.stringify(status).includes('storage.example'));
  assert.ok(!JSON.stringify(status).includes('test-bucket'));
});

test('hash-validated signed APKs upload once and revalidate S3 object HEAD',async()=>{
  const items=new Map();
  const puts=[];
  let closes=0;
  const mirror=createSignedApkMirror({
    config:CONF,logger:nop,localDir:'/tmp/example-apk',
    fileInfo:async filename=>({
      size:PINNED.find(p=>filename.endsWith(p.filename)).size
    }),
    digest:async filename=>PINNED.find(p=>filename.endsWith(p.filename)).sha256,
    storeFactory:async()=>({
      head:async key=>items.get(key)||null,
      put:async data=>{
        puts.push(data);
        items.set(data.key,{ContentLength:data.size,Metadata:{sha256:data.sha256}});
      },
      close:()=>{closes++;}
    })
  });
  const [a,b]=await Promise.all([mirror.sync(),mirror.sync()]);
  assert.deepEqual(a,b);
  assert.equal(a.counts.mirrored,2);
  assert.equal(puts.length,2);
  assert.equal(closes,1,'concurrent sync runs share one storage client');
  assert.ok(puts.every(x=>x.key.startsWith('signed-apk/sha256/')&&
    x.key.endsWith('.apk')&&x.filePath.startsWith('/tmp/example-apk/')));
  await mirror.sync();
  assert.equal(puts.length,2,'identical immutable object is not uploaded twice');
});

test('missing and hash-mismatched files fail closed without uploading',async()=>{
  let puts=0;
  const mirror=createSignedApkMirror({
    config:CONF,logger:nop,
    fileInfo:async filename=>{
      if(filename.endsWith(PINNED[0].filename))
        throw Object.assign(Error('file_missing'),{code:'ENOENT'});
      return {size:PINNED[1].size};
    },
    digest:async()=>('a'.repeat(64)),
    storeFactory:async()=>({head:async()=>null,put:async()=>{puts++},close(){}})
  });
  const r=await mirror.sync();
  assert.equal(r.counts.missing,1);
  assert.equal(r.counts.failed,1);
  assert.equal(puts,0);
});

test('conflicting existing object cannot be replaced or presented as verified',async()=>{
  let puts=0,warnings=0;
  const mirror=createSignedApkMirror({
    config:CONF,logger:{warn(){warnings++}},
    fileInfo:async filename=>({
      size:PINNED.find(pin=>filename.endsWith(pin.filename)).size
    }),
    digest:async filename=>PINNED.find(pin=>filename.endsWith(pin.filename)).sha256,
    storeFactory:async()=>({
      head:async()=>({ContentLength:1,Metadata:{sha256:'bad'}}),
      put:async()=>{puts++},
      close(){}
    })
  });
  const r=await mirror.sync();
  assert.equal(r.counts.failed,2);
  assert.equal(puts,0);
  assert.equal(warnings,2);
});

test('production wiring is optional, protected and never redirects downloads',async()=>{
  const [server,docker,pkg]=await Promise.all([
    readFile(new URL('./server.mjs',import.meta.url),'utf8'),
    readFile(new URL('./Dockerfile',import.meta.url),'utf8'),
    readFile(new URL('./package.json',import.meta.url),'utf8')
  ]);
  assert.match(server,/const signedApkMirror = createSignedApkMirror\(\)/);
  assert.match(server,/signedApkMirror\.sync\(\)/);
  assert.match(server,/pathname === '\/health\/apk-mirror'/);
  assert.match(server,/requireAdmin\(req, res, securityHeaders\)/);
  assert.match(server,/signedApkMirror\.status\(\)/);
  assert.doesNotMatch(server,/res\.writeHead\(30[127], .*signedApkMirror/);
  assert.match(docker,/signed-apk-mirror\.mjs/);
  assert.match(pkg,/signed-apk-mirror\.test\.mjs/);
  assert.match(pkg,/@aws-sdk\/lib-storage/);
  assert.match(pkg,/@aws-sdk\/client-s3/);
});
