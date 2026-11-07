import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {
  DEMO_PREFIX,serveRestreamDemo,rewritePrivateDemoPlaylist
} from '../src/restream-demo-hls.mjs';

const ORIGIN='http://blofy-restream-engine.railway.internal:8888';
async function withDemo(fetchImpl,callback){
  const server=createServer((req,res)=>{
    void serveRestreamDemo(req,res,{engineUrl:ORIGIN,fetchImpl});
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  try{await callback(base)}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('synthetic HLS master, variant, and TS segment remain same-origin and cookie scoped',async()=>{
  let paths=[],cookies=[];
  const ts=Buffer.alloc(188*3,33);
  for(let i=0;i<ts.length;i+=188)ts[i]=0x47;
  const engine=async(url,opts)=>{
    const path=new URL(url).pathname;
    paths.push(path);cookies.push(opts.headers.cookie||'');
    if(path==='/smoke/index.m3u8')
      return new Response(null,{status:302,headers:{
        location:'/smoke/master.m3u8','set-cookie':'mtx_sid=ABCdef123; Path=/; Domain=private.example'
      }});
    if(path==='/smoke/master.m3u8')
      return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant.m3u8\n');
    if(path==='/smoke/variant.m3u8')
      return new Response('#EXTM3U\n#EXTINF:2.000,\nsegment0.ts\n');
    if(path==='/smoke/segment0.ts')return new Response(ts,{headers:{'content-type':'video/mp2t'}});
    throw new Error('unexpected fixture');
  };
  await withDemo(engine,async base=>{
    const x=await fetch(base+DEMO_PREFIX+'index.m3u8',{
      headers:{cookie:'blofy_admin_session=NEVER_FORWARD_THIS'}});
    assert.equal(x.status,200);
    assert.match(await x.text(),new RegExp(DEMO_PREFIX+'variant.m3u8'));
    const setCookie=x.headers.get('set-cookie')||'';
    assert.match(setCookie,/blofy_hls_mtx_sid=ABCdef123/);
    assert.match(setCookie,/SameSite=Strict/);
    assert.match(setCookie,/HttpOnly/);
    assert.doesNotMatch(setCookie,/Domain=private.example|railway.internal/);
    assert.equal(cookies[0],'');
    assert.equal(cookies[1],'mtx_sid=ABCdef123');
    const y=await fetch(base+DEMO_PREFIX+'variant.m3u8',{
      headers:{cookie:'blofy_admin_session=SECRET; blofy_hls_mtx_sid=ABCdef123'}});
    assert.equal(y.status,200);
    assert.match(await y.text(),new RegExp(DEMO_PREFIX+'segment0.ts'));
    assert.equal(cookies.at(-1),'mtx_sid=ABCdef123');
    const segment=await fetch(base+DEMO_PREFIX+'segment0.ts',{
      headers:{cookie:'blofy_hls_mtx_sid=ABCdef123'}});
    assert.equal(segment.status,200);
    assert.equal(segment.headers.get('content-type'),'video/mp2t');
    assert.deepEqual(Buffer.from(await segment.arrayBuffer()),ts);
    assert.deepEqual(paths,['/smoke/index.m3u8','/smoke/master.m3u8','/smoke/variant.m3u8','/smoke/segment0.ts']);
  });
});

test('HLS playlist never leaks internal origin or accepts cross-origin URI',()=>{
  const src='#EXTM3U\n#EXTINF:2.0,\nseg01.ts\n';
  const clean=rewritePrivateDemoPlaylist(src,new URL('/smoke/variant.m3u8',ORIGIN),ORIGIN);
  assert.match(clean,new RegExp(DEMO_PREFIX+'seg01.ts'));
  assert.doesNotMatch(clean,/railway\.internal/);
  assert.throws(()=>rewritePrivateDemoPlaylist(
    '#EXTM3U\n#EXTINF:2.0,\nhttps://private.example/segment.ts\n',
    new URL('/smoke/variant.m3u8',ORIGIN),ORIGIN
  ),/restream_demo_invalid_playlist/);
  assert.throws(()=>rewritePrivateDemoPlaylist(
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://outside.example/key"\n',
    new URL('/smoke/variant.m3u8',ORIGIN),ORIGIN
  ),/restream_demo_unsupported_playlist/);
});

test('invalid or untrusted HLS asset never reaches internal network',async()=>{
  let calls=0;
  await withDemo(async()=>{calls++;throw Error('never call')},async base=>{
    for(const path of [
      DEMO_PREFIX+'..%2fprivate.ts',
      DEMO_PREFIX+'not-a-segment.txt',
      DEMO_PREFIX+'segment.ts?target=https://outside.example',
      DEMO_PREFIX+'%2e%2e%2fcredentials.ts'
    ]){
      const resp=await fetch(base+path);
      assert.equal(resp.status,404,path);
    }
    const result=await fetch(base+DEMO_PREFIX+'index.m3u8',{method:'POST'});
    assert.equal(result.status,405);
    assert.equal(calls,0);
  });
});

test('HLS 401 from engine is never reported as successful media',async()=>{
  await withDemo(async()=>new Response('secret or forbidden',{status:401}),async base=>{
    const v=await fetch(base+DEMO_PREFIX+'index.m3u8');
    assert.equal(v.status,502);
    const body=await v.text();
    assert.match(body,/restream_demo_unavailable/);
    assert.doesNotMatch(body,/secret|railway.internal/);
  });
});

test('every preview playlist and segment needs admin authorization and preview HTML needs signed session',async()=>{
  const hook=await readFile(new URL('../src/restream-engine-hook.mjs',import.meta.url),'utf8');
  const authRoute=hook.slice(hook.indexOf("if(req.url?.split('?')[0]?.startsWith(DEMO_PREFIX))"),
    hook.indexOf("if(req.method==='GET'&&req.url?.split('?')[0]==='/api/v1/admin/restream-engine/smoke')"));
  assert.match(authRoute,/if\(!authorized\(req\.headers\.authorization\)\)/);
  assert.match(authRoute,/serveRestreamDemo\(req,res,\{engineUrl:ENGINE\}\)/);
  const session=await readFile(new URL('../src/admin-session-hook.mjs',import.meta.url),'utf8');
  assert.match(session,/url\.pathname==='\/one\/media-lab'\) return html\(res, await validSession\(req\)\?await blofyOnePreviewPage\(\):await loginPage\(\)\)/);
  const assets=await readFile(new URL('../src/admin-console-hook.mjs',import.meta.url),'utf8');
  assert.match(assets,/blofy-one-preview\.js/);
  const page=await readFile(new URL('../web/blofy-one-preview.html',import.meta.url),'utf8');
  assert.match(page,/BLOFY ONE/);
  assert.match(page,/محتوى اشتراكات العملاء/);
  assert.match(page,/<video/);
});
