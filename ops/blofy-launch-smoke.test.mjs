import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {smoke,checks,checkOne} from './blofy-launch-smoke.mjs';
const headers=values=>({get:name=>values[String(name).toLowerCase()]||null});
const good=async(url,options)=>{
 if(url.endsWith('.apk')){
  assert.equal(options.headers.range,'bytes=0-31');
  return {status:206,headers:headers({'content-range':'bytes 0-31/135783643',
    'content-length':'32','cache-control':'private, no-store'}),
    arrayBuffer:async()=>Buffer.concat([Buffer.from('PK'),Buffer.alloc(30)])};
 }
 return {status:200,headers:headers({}),json:async()=>({ok:true,token:'never-log-me'})};
};
test('only five immutable owned URLs and one safe S3 partial GET',()=>{
 const set=checks();
 assert.equal(set.length,5);
 assert.ok(set.every(x=>x.url.startsWith('https://')));
 assert.equal(set.filter(x=>x.range).length,1);
 assert.ok(set.every(x=>!x.url.includes('?')));
});
test('all-green read-only smoke never claims playback or payments',async()=>{
 const status=await smoke({fetchImpl:good});
 assert.equal(status.ok,true);
 assert.equal(status.checks.length,5);
 assert.equal(status.customerTrafficChanged,false);
 assert.equal(status.paymentsCaptured,0);
 assert.equal(status.providerMediaRequests,0);
 assert.ok(!JSON.stringify(status).includes('never-log-me'));
 assert.ok(!JSON.stringify(status).includes('https://'));
});
test('bad cached byte ranges must fail even if 206 returned',async()=>{
 const failed=await checkOne(checks().at(-1),{
  fetchImpl:async()=>({status:206,headers:headers({
    'content-range':'bytes 40-71/135783643',
    'content-length':'32','cache-control':'public, max-age=300'
  }),arrayBuffer:async()=>Buffer.alloc(32)})
 });
 assert.equal(failed.ok,false);
});
test('redirects and errors never count as healthy',async()=>{
 const failed=await smoke({fetchImpl:async()=>({
  status:302,headers:headers({}),json:async()=>({ok:true})
 })});
 assert.equal(failed.ok,false);
 assert.ok(failed.checks.every(x=>!x.ok));
});
