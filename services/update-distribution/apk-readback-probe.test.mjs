import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApkMirrorReadiness} from './apk-readback-probe.mjs';
import {pinnedSignedApks} from './signed-apk-mirror.mjs';
const pins=pinnedSignedApks();
const config={enabled:true,ready:true};
const byte=(offset)=>offset%251;
function fixtures({corrupt=false,badHead=false,unavailable=false}={}){
  let reads=0,headCalls=0,rangeCalls=0,closed=0;
  const t={now:1000};
  const mock=createApkMirrorReadiness({
    config,now:()=>t.now,cooldownMs:1000,sampleSize:64,
    openFile:async file=>({
      async read(buffer,position,length,start){
        reads++;
        for(let j=0;j<length;j++)buffer[j]=byte(start+j);
        return {bytesRead:length,buffer};
      },async close(){closed++;}
    }),
    storeFactory:async()=>({
      head:async key=>{
        headCalls++;
        if(unavailable)throw Error('storage_unavailable');
        const pin=pins.find(v=>key.includes(v.sha256));
        return {ContentLength:badHead?1:pin.size,Metadata:{sha256:pin.sha256}};
      },
      readRange:async (key,start,end)=>{
        rangeCalls++;
        const arr=Buffer.alloc(end-start+1);
        for(let j=0;j<arr.length;j++)arr[j]=byte(start+j);
        if(corrupt&&start>0)arr[0]^=0xff;
        return arr;
      },
      close(){}
    })
  });
  return {mock,t,stats:()=>({reads,headCalls,rangeCalls,closed})};
}
test('canary reads first and last range for both pinned signed objects without touching customers',async()=>{
 const f=fixtures();
 const report=await f.mock.probe();
 assert.equal(report.ok,true);
 assert.equal(report.mode,'read_only');
 assert.equal(report.customerTrafficChanged,false);
 assert.equal(report.results.length,2);
 assert.equal(report.results.every(x=>x.ok),true);
 assert.equal(f.stats().headCalls,2);
 assert.equal(f.stats().reads,4);
 assert.equal(f.stats().rangeCalls,4);
 assert.ok(!JSON.stringify(report).includes('signed-apk/sha256/'));
});
test('corruption and conflicting HEAD metadata block cutover',async()=>{
 for(const opts of [{corrupt:true},{badHead:true},{unavailable:true}]){
   const f=fixtures(opts);
   const r=await f.mock.probe();
   assert.equal(r.ok,false);
   assert.equal(r.code,'readback_failed');
   assert.equal(r.customerTrafficChanged,false);
 }
});
test('repeat canary within cooldown returns cached result without more object requests',async()=>{
 const f=fixtures();
 const first=await f.mock.probe();
 const second=await f.mock.probe();
 assert.equal(first.ok,true);
 assert.equal(second.rateLimited,true);
 assert.equal(f.stats().headCalls,2);
 f.t.now+=2000;
 const third=await f.mock.probe();
 assert.equal(third.ok,true);
 assert.equal(f.stats().headCalls,4);
});
test('unconfigured storage is fail-closed and never accessed',async()=>{
 let count=0;
 const canary=createApkMirrorReadiness({
   config:{enabled:false,ready:false},storeFactory:async()=>{count++;}
 });
 const r=await canary.probe();
 assert.equal(r.ok,false);
 assert.equal(count,0);
 assert.equal(canary.status().code,'not_tested');
});
test('readiness endpoint is admin protected, POST-only, origin checked, and does not redirect',async()=>{
 const [server,docker,pkg,store]=await Promise.all([
   readFile(new URL('./server.mjs',import.meta.url),'utf8'),
   readFile(new URL('./Dockerfile',import.meta.url),'utf8'),
   readFile(new URL('./package.json',import.meta.url),'utf8'),
   readFile(new URL('./signed-apk-mirror.mjs',import.meta.url),'utf8')
 ]);
 assert.match(server,/pathname === '\/health\/apk-mirror\/probe' && method === 'POST'/);
 assert.match(server,/if \(!requireAdmin\(req, res, securityHeaders\)\) return/);
 assert.match(server,/if \(!sameOrigin\(req\)\)/);
 assert.match(server,/apkMirrorReadiness\.probe\(\)/);
 assert.match(server,/customerDownloadCutover:false/);
 assert.match(docker,/apk-readback-probe\.mjs/);
 assert.match(pkg,/apk-readback-probe\.test\.mjs/);
 assert.match(store,/GetObjectCommand/);
 assert.match(store,/ContentRange/);
});
