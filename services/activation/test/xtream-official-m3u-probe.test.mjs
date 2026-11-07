import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {probeOfficialXtreamPlaylistRoute} from '../src/xtream-official-m3u-probe.mjs';
const env={BLOFY_STREAM_RELAY_ORIGIN:'https://blofy-stream-api-production.up.railway.app',
 BLOFY_STREAM_RELAY_SHARED_TOKEN:'n'.repeat(50)};
test('official M3U probe is HTTPS pinned and never exposes credentials to logs',async()=>{
 const manifest='http://provider.example/get.php?username=user&password=SECRET&type=m3u_plus&output=ts';
 const result=await probeOfficialXtreamPlaylistRoute(manifest,{env,
 fetchImpl:async(url,opts)=>{
   assert.equal(url,env.BLOFY_STREAM_RELAY_ORIGIN+'/internal/xtream-official-m3u-diagnostic');
   assert.equal(opts.redirect,'manual');
   assert.equal(opts.method,'POST');
   assert.equal(opts.headers.authorization,'Bearer '+env.BLOFY_STREAM_RELAY_SHARED_TOKEN);
   assert.equal(JSON.parse(opts.body).manifestUrl,manifest);
   return new Response(JSON.stringify({ok:true,stage:'compared',playlistHttpStatus:200,
     playlistMediaUrlsFound:2,anyDifferentMediaOrigin:true,mediaTransportVerified:false,
     checks:[{index:1,sameOrigin:false,scheme:'https',route:'live',
      httpStatus:503,code:'http_status',format:'none',mediaBytesPresent:false,
      secret:'NEVER_SHARED'}]}),{status:200});
 }});
 assert.equal(result.ok,true);
 assert.equal(result.mediaTransportVerified,false);
 assert.equal(result.anyDifferentMediaOrigin,true);
 assert.equal(result.checks[0].httpStatus,503);
 assert.doesNotMatch(JSON.stringify(result),/provider|SECRET|NEVER_SHARED|username|password/);
});
test('disabled by default or wrong pinned host fail before HTTP request',async()=>{
 let n=0;
 const result=await probeOfficialXtreamPlaylistRoute('http://provider.example/get.php',{
   env:{...env,BLOFY_STREAM_RELAY_ORIGIN:'https://different.example'},
   fetchImpl:async()=>{n++;return new Response('{}');}});
 assert.equal(result.ok,false);
 assert.equal(result.code,'bridge_not_configured');
 assert.equal(n,0);
});
test('server source comparison runs one time only when flag is 1 and source is allowlisted',async()=>{
 const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const mark="if(process.env.BLOFY_XTREAM_OFFICIAL_M3U_PROBE_ON_BOOT==='1')";
 const from=src.indexOf(mark),to=src.indexOf('async function cancelSourceSync(',from);
 assert.ok(from>0&&to>from);
 const part=src.slice(from,to);
 assert.match(part,/shouldUseIndependentXtreamSource\(sourceId\)/);
 assert.match(part,/xtreamM3uUrl\(row.base_url,creds.username,creds.password,'ts'\)/);
 assert.match(part,/credentialsLogged:false/);
 assert.doesNotMatch(part,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
});
