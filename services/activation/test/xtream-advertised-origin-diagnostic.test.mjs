import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareXtreamAdvertisedOrigin} from '../src/xtream-advertised-origin-diagnostic.mjs';

test('detects provider media host/port differences without exposing upstream address',()=>{
 const r=compareXtreamAdvertisedOrigin('http://api.example:80',{
  url:'media.example',server_protocol:'http',port:'8080'});
 assert.deepEqual(r,{
  ok:true,code:'origin_differs',hostDiffers:true,portDiffers:true,
  protocolDiffers:false,configuredHasPathPrefix:false,mediaOriginChanged:true
 });
 assert.doesNotMatch(JSON.stringify(r),/api\.example|media\.example|8080/);
});
test('matches advertised origin and preserves relative path-prefix signal',()=>{
 const a=compareXtreamAdvertisedOrigin('http://media.example:8080/panel',{
  url:'http://media.example:8080',server_protocol:'http',port:'8080'});
 assert.equal(a.code,'origin_matches');
 assert.equal(a.configuredHasPathPrefix,true);
});
test('invalid or credential-bearing server-info cannot be trusted for media routing',()=>{
 for(const server of [
  null,{}, {url:'http://user:pass@media.example'},
  {url:'http://localhost/path'}, {url:'media.example',port:'65536'},
  {url:'media.example',server_protocol:'ftp'},
  {url:'http://media.example/?secret=yes'}]){
  const res=compareXtreamAdvertisedOrigin('http://api.example',server);
  assert.equal(res.ok,false);
 }
});
test('one-shot comparison requires operator flag and never modifies subscriber routing',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf("if(process.env.BLOFY_XTREAM_ADVERTISED_ORIGIN_PROBE_ON_BOOT==='1')");
 const b=c.indexOf('// One-time transport compatibility experiment',a);
 const section=c.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(section,/compareXtreamAdvertisedOrigin\(row.base_url,doc\?\.server_info\)/);
 assert.match(section,/size>128000/);
 assert.match(section,/customerCutover:false/);
 assert.match(section,/sourceMutation:false/);
 assert.doesNotMatch(section,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
});
