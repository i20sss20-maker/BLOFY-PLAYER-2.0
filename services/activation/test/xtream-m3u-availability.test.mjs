import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {probeXtreamM3uAvailability} from '../src/xtream-m3u-availability.mjs';

function sampleResponse(text,{status=200,type='audio/x-mpegurl'}={}){
 let reads=0,cancelled=false;
 return {
  status,headers:{get:key=>key.toLowerCase()==='content-type'?type:null},
  body:{
   cancel:async()=>{cancelled=true},
   getReader:()=>({
    read:async()=>{reads++;return {done:false,value:Buffer.from(text)}},
    cancel:async()=>{cancelled=true}
   })
  },
  state:()=>({reads,cancelled})
 };
}
test('authorized official M3U export is detected without catalog import or URL leak',async()=>{
 let sourceUrl;
 const response=sampleResponse('#EXTM3U\n#EXTINF:-1,Test channel\nhttps://private.example/stream');
 const result=await probeXtreamM3uAvailability({
  baseUrl:'http://example.test:8080/base',username:'secretuser',password:'secretpass'
 },{
  checkPublic:async()=>{},
  fetchImpl:async(url,opts)=>{
   sourceUrl=url;assert.equal(opts.redirect,'manual');
   return response;
  }
 });
 assert.deepEqual(result,{ok:true,stage:'content',status:200,code:'xtream_m3u_reachable'});
 assert.equal(sourceUrl.pathname,'/get.php');
 assert.equal(response.state().reads,1);
 assert.equal(response.state().cancelled,true);
 assert.doesNotMatch(JSON.stringify(result),/secretuser|secretpass|private\.example|stream/);
});
test('HTML protection challenge is not a valid M3U export',async()=>{
 const response=sampleResponse('<html>WAF challenge</html>',{type:'text/html'});
 const result=await probeXtreamM3uAvailability({
  baseUrl:'http://example.test',username:'a',password:'b'
 },{checkPublic:async()=>{},fetchImpl:async()=>response});
 assert.equal(result.ok,false);
 assert.equal(result.code,'xtream_m3u_html_response');
 assert.equal(response.state().reads,0);
});
test('provider 403 and 456 remain denials, no automatic alternate path',async()=>{
 for(const status of [401,403,456]){
  const response=sampleResponse('',{status});
  const report=await probeXtreamM3uAvailability({
   baseUrl:'https://example.test',username:'a',password:'b'
  },{checkPublic:async()=>{},fetchImpl:async()=>response});
  assert.equal(report.code,'xtream_m3u_http_'+status);
  assert.equal(report.ok,false);
  assert.equal(response.state().reads,0);
 }
});
test('upstream connection reset returns safe transport code',async()=>{
 const error=Object.assign(new Error('secret-url'),{code:'ECONNRESET'});
 const r=await probeXtreamM3uAvailability({baseUrl:'http://example.test',username:'a',password:'b'},{
  checkPublic:async()=>{},
  fetchImpl:async()=>{throw error}
 });
 assert.equal(r.ok,false);
 assert.equal(r.code,'xtream_transport_connection_reset');
 assert.doesNotMatch(JSON.stringify(r),/secret-url|example\.test/);
});
test('one-shot gate is limited to a saved source and does not change catalog',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const begin=c.indexOf("if(process.env.BLOFY_XTREAM_M3U_ONE_SHOT==='1')");
 const end=c.indexOf('// One-time transport compatibility experiment',begin);
 assert.ok(begin>0&&end>begin);
 const section=c.slice(begin,end);
 assert.match(section,/probeXtreamM3uAvailability/);
 assert.match(section,/BLOFY_XTREAM_M3U_AVAILABILITY/);
 assert.doesNotMatch(section,/UPDATE |DELETE |INSERT |syncServer\(|probeXtreamPlayback\(|console\.log\(creds/);
});
