import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseSalehCatalogCopy,safeSalehCopySample}
 from '../src/xtream-saleh-copy-capability.mjs';
const saleh='9adc6472-5d4e-4359-83e4-0298cc038ae3';
function db({sources=1,map=21}={}){
 const queries=[];
 const query=async(sql,args=[])=>{
  queries.push({sql,args});
  if(sql.includes('FROM blofy_xtream_servers'))
   return {rows:Array.from({length:sources},()=>({id:saleh}))};
  if(sql.includes('GROUP BY media_type'))
   return {rows:[{media_type:'live',total:100},{media_type:'movie',total:24000},
    {media_type:'series',total:5000}]};
  if(sql.includes('SELECT m.gateway_id'))
   return {rows:map?[{gateway_id:map}]:[]};
  throw Error('unexpected SQL');
 };
 return {query,queries};
}
test('single indexed movie read probe does not copy media and emits no IDs/URLs',async()=>{
 const d=db();let mediaRequests=0;
 const r=await diagnoseSalehCatalogCopy({query:d.query,probeMovie:async id=>{
  mediaRequests++;assert.equal(id,21);
  return {ok:true,httpStatus:206,format:'mp4',elapsedMs:71,
    rangeApplied:true,reason:'private-secret-cannot-appear',
    providerUrl:'https://upstream.example/get.php?password=secret'};
 }});
 assert.equal(r.ok,true);
 assert.equal(r.counts.movie,24000);
 assert.equal(r.sample.mediaSampleReadable,true);
 assert.equal(r.sample.rangeAccepted,true);
 assert.equal(r.sample.fullDownloadVerified,false);
 assert.equal(r.sample.completeFileCopied,false);
 assert.equal(mediaRequests,1);
 assert.equal(r.mediaRequestCount,1);
 assert.equal(d.queries.length,3);
 assert.doesNotMatch(JSON.stringify(r),/upstream\.example|password=secret|9adc6472|private-secret-cannot-appear/);
 assert.equal(r.customerTrafficChanged,false);
});
test('fails safely for missing/duplicate source without contacting media',async()=>{
 for(const sources of [0,2]){
  let count=0;
  const r=await diagnoseSalehCatalogCopy({query:db({sources}).query,
   probeMovie:async()=>{count++;}});
  assert.equal(r.ok,false);assert.equal(count,0);assert.equal(r.mediaRequestCount,0);
 }
});
test('missing mapped movie is indexed-only evidence, not a playable copy claim',async()=>{
 const d=db({map:null});
 const r=await diagnoseSalehCatalogCopy({query:d.query,
   probeMovie:async()=>{throw Error('must never request media')}});
 assert.equal(r.catalogIndexed,true);
 assert.equal(r.mediaRequestCount,0);
 assert.equal(r.sample.fullDownloadVerified,false);
});
test('provider range unsupported or 404 are not described as downloadable files',async()=>{
 const noRange=safeSalehCopySample({ok:true,httpStatus:200,format:'mp4'});
 assert.equal(noRange.mediaSampleReadable,true);
 assert.equal(noRange.rangeAccepted,false);
 assert.equal(noRange.fullDownloadVerified,false);
 const denied=safeSalehCopySample({ok:false,httpStatus:404,reason:'upstream_http_404'});
 assert.equal(denied.mediaSampleReadable,false);
 assert.equal(denied.httpStatus,404);
});
