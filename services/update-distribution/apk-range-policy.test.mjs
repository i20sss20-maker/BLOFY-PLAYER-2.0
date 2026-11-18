import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {apkRangePolicy,apkCacheControl} from './apk-range-policy.mjs';

test('full APK remains a normal short-cache download',()=>{
  assert.deepEqual(apkRangePolicy('',100),{status:200,start:0,end:99,length:100,contentRange:null});
  assert.equal(apkCacheControl(200),'public, max-age=300');
});

test('all successful single range forms select correct bytes',()=>{
  assert.deepEqual(apkRangePolicy('bytes=0-4',100),{
    status:206,start:0,end:4,length:5,contentRange:'bytes 0-4/100'
  });
  assert.deepEqual(apkRangePolicy('bytes=40-',100),{
    status:206,start:40,end:99,length:60,contentRange:'bytes 40-99/100'
  });
  assert.deepEqual(apkRangePolicy('bytes=-8',100),{
    status:206,start:92,end:99,length:8,contentRange:'bytes 92-99/100'
  });
  assert.deepEqual(apkRangePolicy('bytes=-1000',100),{
    status:206,start:0,end:99,length:100,contentRange:'bytes 0-99/100'
  });
  assert.deepEqual(apkRangePolicy('bytes=50-999',100),{
    status:206,start:50,end:99,length:50,contentRange:'bytes 50-99/100'
  });
  assert.equal(apkCacheControl(206),'private, no-store, max-age=0, s-maxage=0');
  assert.equal(apkCacheControl(416),'private, no-store, max-age=0, s-maxage=0');
});

test('invalid and multi-range requests are not cached and never return APK bytes',()=>{
  for(const value of ['bytes=','bytes=-0','bytes=100-','bytes=1-0',
    'bytes=0-1,90-99','bytes=9999999999999999999-',
    'bytes=--10','items=0-10','bytes=0-9\nCache-Control:public']){
    const response=apkRangePolicy(value,100);
    assert.equal(response.status,416,value);
    assert.equal(response.contentRange,'bytes */100');
    assert.equal(response.length,0);
    assert.match(apkCacheControl(response.status),/no-store/);
  }
  assert.throws(()=>apkRangePolicy('',0),/apk_size_invalid/);
});

test('APK origin consumes range helper and disables CDN cache on 206 and 416',async()=>{
  const src=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
  const docker=await readFile(new URL('./Dockerfile',import.meta.url),'utf8');
  const pkg=await readFile(new URL('./package.json',import.meta.url),'utf8');
  const a=src.indexOf('async function streamLocalApk');
  const b=src.indexOf('async function sha256File',a);
  assert.ok(a>0&&b>a);
  const section=src.slice(a,b);
  assert.match(section,/apkRangePolicy\(String\(req\.headers\.range \|\| ''\)\.trim\(\), total\)/);
  assert.match(section,/apkCacheControl\(416\)/);
  assert.match(section,/apkCacheControl\(status\)/);
  assert.match(section,/policy\.contentRange/);
  assert.match(section,/createReadStream\(filePath, \{ start, end \}\)/);
  assert.match(section,/observeDownloadCompletion/);
  assert.match(docker,/apk-range-policy\.mjs/);
  assert.match(pkg,/apk-range-policy\.test\.mjs/);
});
