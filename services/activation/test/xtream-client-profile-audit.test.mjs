import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {probeIndependentXtreamClientProfiles} from '../src/xtream-independent-catalog-relay.mjs';

const env={
 BLOFY_STREAM_RELAY_ORIGIN:'https://blofy-stream-api-production.up.railway.app',
 BLOFY_STREAM_RELAY_SHARED_TOKEN:'a'.repeat(48)
};
test('operator same-item comparison proxy enforces shared token and returns sanitized status only',async()=>{
 let n=0;
 const report=await probeIndependentXtreamClientProfiles([{
  kind:'movie',sourceUrl:'http://provider.example/movie/u/SECRET/42.mkv'
 }],{
  env,fetchImpl:async(input,options)=>{
   n++;
   assert.equal(options.method,'POST');
   assert.equal(options.redirect,'manual');
   assert.equal(JSON.parse(options.body).compareHttp11,true);
   assert.match(input,/\/internal\/xtream-media-client-profiles$/);
   assert.match(options.headers.authorization,/Bearer /);
   return new Response(JSON.stringify({ok:true,samples:[{
    index:1,kind:'movie',checks:[
     {profile:'relay_range',status:404,code:'provider_not_found'},
     {profile:'relay_plain',status:404,code:'provider_not_found'},
     {profile:'player_plain',status:206,code:'media_checked',mediaBytes:true,
      sourceUrl:'http://provider.example/movie/u/SECRET/42.mkv',
      bad:'SECRET'}
    ]
   }]}),{status:200});
  }
 });
 assert.equal(n,1);
 assert.equal(report.samples[0].checks[2].mediaBytes,true);
 assert.equal(report.samples[0].checks[2].status,206);
 assert.doesNotMatch(JSON.stringify(report),/SECRET|provider\.example|sourceUrl|bad/);
});
test('operator media client comparison is default-off when STREAM bridge not configured',async()=>{
 await assert.rejects(probeIndependentXtreamClientProfiles([{
  kind:'movie',sourceUrl:'http://provider.example/movie/u/p/1.mp4'
 }],{env:{},fetchImpl:async()=>{throw Error('should not connect')}}),
 /xtream_profile_diagnostic_unavailable/);
});
test('one-shot source-only boot comparison selects existing IDs, not guessed media files',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=code.indexOf("if(process.env.BLOFY_XTREAM_MEDIA_CLIENT_PROFILES_ON_BOOT==='1')");
 const end=code.indexOf('// Full local audit scans every imported item',start);
 const section=code.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.match(section,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(section,/ORDER BY name ASC LIMIT 3/);
 assert.match(section,/server_id=\$1 AND media_type='movie'/);
 assert.match(section,/probeIndependentXtreamClientProfiles\(samples\)/);
 assert.match(section,/catalogMutation:false/);
 assert.doesNotMatch(section,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
});

test('operator logs only allowlisted HTTP11 comparison fields from source bridge',async()=>{
 const report=await probeIndependentXtreamClientProfiles([{
  kind:'movie',sourceUrl:'http://provider.example/movie/u/HIDDEN/15.mkv'
 }],{env,fetchImpl:async()=>new Response(JSON.stringify({
  ok:true,samples:[{index:1,kind:'movie',checks:[
   {profile:'http11_plain',status:200,mediaBytes:true,code:'media_checked',
    sourceUrl:'http://provider.example/movie/u/HIDDEN/15.mkv',secret:'HIDDEN'}
  ]}]
 }),{status:200})});
 assert.equal(report.samples[0].checks[0].profile,'http11_plain');
 assert.equal(report.samples[0].checks[0].mediaBytes,true);
 assert.doesNotMatch(JSON.stringify(report),/HIDDEN|sourceUrl|provider.example/);
});
