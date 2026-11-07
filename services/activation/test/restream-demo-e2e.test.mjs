import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkDemoProxy,demoProxyLoopbackOrigin} from '../src/restream-demo-e2e.mjs';
import {DEMO_PREFIX} from '../src/restream-demo-hls.mjs';

test('authenticated synthetic route proves master + variant + TS while keeping admin token secret',async()=>{
  const requests=[],ts=Buffer.alloc(188*3,0x11);
  for(let i=0;i<ts.length;i+=188)ts[i]=0x47;
  const request=async(url,opts)=>{
    requests.push({path:url.pathname,auth:opts.headers.authorization,cookie:opts.headers.cookie||''});
    const name=url.pathname.slice(DEMO_PREFIX.length);
    if(name==='index.m3u8')return new Response(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000\n'+DEMO_PREFIX+'variant.m3u8\n',
      {headers:{'set-cookie':'blofy_hls_session=abc123; Path='+DEMO_PREFIX+'; HttpOnly'}}
    );
    if(name==='variant.m3u8')return new Response(
      '#EXTM3U\n#EXTINF:2.0,\n'+DEMO_PREFIX+'seg0.ts\n');
    if(name==='seg0.ts')return new Response(ts);
    return new Response('',{status:404});
  };
  const report=await checkDemoProxy({adminToken:'PRIVATE_TOKEN',fetchImpl:request,delay:async()=>{}});
  assert.equal(report.ok,true);
  assert.equal(report.mediaVerified,true);
  assert.equal(report.authVerified,true);
  assert.equal(report.audioVideoDecoded,false);
  assert.equal(report.realSourceVerified,false);
  assert.equal(report.bytesVerified,564);
  assert.equal(requests.length,3);
  assert.deepEqual(requests.map(x=>x.path),[
    DEMO_PREFIX+'index.m3u8',DEMO_PREFIX+'variant.m3u8',DEMO_PREFIX+'seg0.ts'
  ]);
  assert.ok(requests.every(x=>x.auth==='Bearer PRIVATE_TOKEN'));
  assert.ok(requests.slice(1).every(x=>x.cookie==='blofy_hls_session=abc123'));
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_TOKEN|session|railway\.internal/);
});

test('synthetic route rejects external HLS media URI without requesting it',async()=>{
  let calls=0;
  const fake=async()=>{calls++;return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://untrusted.example/live.ts\n');};
  const report=await checkDemoProxy({adminToken:'token',fetchImpl:fake});
  assert.equal(report.ok,false);
  assert.equal(report.reason,'demo_proxy_unsafe_asset');
  assert.equal(calls,1);
});

test('admin denial cannot be mistaken for a media success',async()=>{
  const fake=async()=>new Response('forbidden',{status:401});
  const report=await checkDemoProxy({adminToken:'token',fetchImpl:fake});
  assert.equal(report.ok,false);
  assert.equal(report.reason,'demo_proxy_unauthorized');
  assert.equal(report.mediaVerified,false);
});

test('fixed loopback origin rejects invalid or privileged ports; no client origin accepted',()=>{
  assert.equal(demoProxyLoopbackOrigin(3000),'http://127.0.0.1:3000');
  for(const port of [0,1,22,-1,65536,80.3,'not-a-number']){
    assert.throws(()=>demoProxyLoopbackOrigin(port),/demo_proxy_loopback_invalid/);
  }
});

test('production HLS e2e is protected and explicitly opt-in on boot',async()=>{
  const hook=await readFile(new URL('../src/restream-engine-hook.mjs',import.meta.url),'utf8');
  const start=hook.indexOf("req.url?.split('?')[0]==='/api/v1/admin/restream-engine/demo/check'");
  const end=hook.indexOf("if(req.url?.split('?')[0]?.startsWith(DEMO_PREFIX))",start);
  assert.ok(start>0&&end>start);
  assert.match(hook.slice(start,end),/if\(!authorized\(req.headers.authorization\)\)/);
  assert.match(hook.slice(start,end),/void runProxyCheck\(res\)/);
  assert.match(hook,/BLOFY_RESTREAM_DEMO_E2E_ON_BOOT==='1'/);
  assert.match(hook,/adminToken:ADMIN_TOKEN/);
  assert.match(hook,/30_000/);
  const js=await readFile(new URL('../web/blofy-one-preview.js',import.meta.url),'utf8');
  const html=await readFile(new URL('../web/blofy-one-preview.html',import.meta.url),'utf8');
  assert.match(js,/restream-engine\/demo\/check/);
  assert.match(html,/one-preview-e2e/);
  assert.doesNotMatch(js,/localStorage|sessionStorage/);
});
