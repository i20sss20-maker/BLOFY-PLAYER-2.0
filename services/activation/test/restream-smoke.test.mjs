import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyRestreamSmoke} from '../src/restream-smoke.mjs';

const origin='http://blofy-restream-engine.railway.internal:8888';
const ts=Buffer.alloc(188*3,0x22);
for(let i=0;i<ts.length;i+=188)ts[i]=0x47;
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nmain_stream.m3u8\n';
const variant='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nsegment0.ts\n';

test('private smoke validates real HLS manifest + TS bytes and shares HLS session cookie',async()=>{
  const called=[];
  const fetchImpl=async (url,options)=>{
    const path=new URL(url).pathname;
    called.push({path,cookie:options.headers.cookie||''});
    if(path==='/smoke/index.m3u8'&&!new URL(url).searchParams.has('session'))
      return new Response(null,{status:302,headers:{location:'/smoke/index.m3u8?session=1','set-cookie':'hls_session=abc123; Path=/smoke; HttpOnly'}});
    if(path==='/smoke/main_stream.m3u8')return new Response(variant);
    if(path==='/smoke/segment0.ts')return new Response(ts,{headers:{'content-type':'video/mp2t'}});
    if(new URL(url).searchParams.has('session'))return new Response(master);
    throw Error('unlisted route');
  };
  const output=await verifyRestreamSmoke(origin,{fetchImpl,wait:async()=>{}});
  assert.equal(output.ok,true);
  assert.equal(output.mediaVerified,true);
  assert.equal(output.realSourceVerified,false);
  assert.equal(output.audioVideoDecoded,false);
  assert.equal(output.bytesVerified,564);
  assert.equal(called.length,4);
  assert.ok(called.slice(1).every(a=>a.cookie==='hls_session=abc123'));
  assert.doesNotMatch(JSON.stringify(output),/blofy-restream-engine|session|smoke\//);
});

test('private smoke refuses cross-origin redirects and never follows the external URL',async()=>{
  let calls=0;
  const fetchImpl=async()=>{
    calls++;
    return new Response(null,{status:302,headers:{location:'http://outside.example/steal'}});
  };
  const r=await verifyRestreamSmoke(origin,{fetchImpl});
  assert.equal(r.ok,false);
  assert.equal(r.code,'restream_smoke_invalid_path');
  assert.equal(calls,1);
});

test('private smoke cannot be tricked into accepting out-of-scope HLS references',async()=>{
  const fetchImpl=async url=>{
    if(new URL(url).pathname.endsWith('index.m3u8'))return new Response(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n../../private/password.txt\n');
    throw new Error('must never fetch reference');
  };
  const r=await verifyRestreamSmoke(origin,{fetchImpl});
  assert.equal(r.ok,false);
  assert.equal(r.code,'restream_smoke_invalid_path');
});

test('HLS HTTP 401 does not count as playable media',async()=>{
  const r=await verifyRestreamSmoke(origin,{fetchImpl:async()=>new Response('unauthorized',{status:401})});
  assert.equal(r.ok,false);
  assert.equal(r.code,'restream_smoke_auth_rejected');
});

test('HTML and non-MPEGTS responses never count as playable media',async()=>{
  const fetchImpl=async url=>{
    if(new URL(url).pathname.endsWith('.ts'))return new Response('<html>permission denied</html>');
    return new Response('#EXTM3U\n#EXTINF:2.0,\nx.ts\n');
  };
  const r=await verifyRestreamSmoke(origin,{fetchImpl});
  assert.equal(r.ok,false);
  assert.equal(r.code,'restream_smoke_not_mpegts');
});

test('only admin bearer route and opt-in boot smoke; existing media route remains unaffected',async()=>{
  const source=await readFile(new URL('../src/restream-engine-hook.mjs',import.meta.url),'utf8');
  const protectedRoute=source.slice(
    source.indexOf("if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/smoke')"),
    source.indexOf("if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/health')")
  );
  assert.match(protectedRoute,/if\(!authorized\(req\.headers\.authorization\)\)/);
  assert.match(protectedRoute,/void runSmoke\(res\)/);
  assert.match(source,/BLOFY_RESTREAM_SMOKE_ON_BOOT==='1'/);
  assert.doesNotMatch(source,/proxyMedia|\.pathname===['"]\/live\//);
});
