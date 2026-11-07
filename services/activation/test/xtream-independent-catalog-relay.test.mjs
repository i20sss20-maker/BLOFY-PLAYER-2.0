import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {shouldUseIndependentXtreamSource,fetchIndependentXtreamSource}
 from '../src/xtream-independent-catalog-relay.mjs';
const allowed='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const cfg={BLOFY_XTREAM_INDEPENDENT_API_ENABLED:'1',
 BLOFY_XTREAM_INDEPENDENT_API_SOURCE_IDS:allowed,
 BLOFY_STREAM_RELAY_ORIGIN:'https://blofy-stream-api-production.up.railway.app',
 BLOFY_STREAM_RELAY_SHARED_TOKEN:'X'.repeat(48)};
test('routing requires opt-in flag, pinned gateway, correct source UUID and bearer',()=>{
 assert.equal(shouldUseIndependentXtreamSource(allowed,cfg),true);
 assert.equal(shouldUseIndependentXtreamSource('17b02659-4cb8-49aa-a4d6-240f865ef1d1',cfg),false);
 assert.equal(shouldUseIndependentXtreamSource(allowed,{...cfg,
   BLOFY_XTREAM_INDEPENDENT_API_ENABLED:'0'}),false);
 assert.equal(shouldUseIndependentXtreamSource(allowed,{...cfg,
   BLOFY_STREAM_RELAY_ORIGIN:'https://evil.example'}),false);
 assert.equal(shouldUseIndependentXtreamSource(allowed,{...cfg,
   BLOFY_STREAM_RELAY_SHARED_TOKEN:'bad'}),false);
 assert.equal(shouldUseIndependentXtreamSource(allowed,{
   ...cfg,BLOFY_XTREAM_INDEPENDENT_API_SOURCE_IDS:''}),false);
});
test('selected source categories are requested only server-to-server over pinned HTTPS',async()=>{
 let calls=0;
 const url='http://annkel.com/player_api.php?username=real&password=keep_secret&action=get_live_categories';
 const response=await fetchIndependentXtreamSource(url,{env:cfg,fetchImpl:async(route,options)=>{
  calls++;
  assert.equal(route,cfg.BLOFY_STREAM_RELAY_ORIGIN+'/internal/xtream-catalog-relay');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'manual');
  assert.equal(options.headers.authorization,'Bearer '+cfg.BLOFY_STREAM_RELAY_SHARED_TOKEN);
  assert.equal(JSON.parse(options.body).sourceUrl,url);
  return new Response(JSON.stringify([{category_id:'1'}]),
    {status:200,headers:{'content-type':'application/json'}});
 }});
 assert.equal(calls,1);
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),[{category_id:'1'}]);
});
test('invalid methods, arbitrary paths and cross-project HTTP redirects are rejected',async()=>{
 await assert.rejects(fetchIndependentXtreamSource('file:///etc/passwd',{env:cfg}),
   /xtream_independent_source_invalid/);
 await assert.rejects(fetchIndependentXtreamSource('http://annkel.com/get.php?username=x&password=y',{env:cfg}),
   /xtream_independent_source_invalid/);
 await assert.rejects(fetchIndependentXtreamSource('http://annkel.com/player_api.php?username=x&password=y',{env:cfg,
   fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://bad.example/capture'}})}),
   /xtream_independent_redirect_rejected/);
});
test('original account and source filters precede independent catalog redirect',async()=>{
 const code=await fs.readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/shouldUseIndependentXtreamSource\(sourceId\)/);
 assert.match(code,/fetchIndependentXtreamSource\(current,\{timeoutMs\}\)/);
 assert.match(code,/timeoutMs,sourceId:row.id/);
 assert.match(code,/timeoutMs:60000,sourceId:row.id/);
 assert.match(code,/timeoutMs:180000,sourceId:row.id/);
 assert.match(code,/BLOFY_XTREAM_INDEPENDENT_CATALOG_PROBE_ON_BOOT==='1'/);
});
