import test from 'node:test';
import assert from 'node:assert/strict';
import {probeHostbrrGateway} from '../src/hostbrr-gateway-monitor.mjs';
test('only expected HTTPS readiness marker is healthy',async()=>{
 const result=await probeHostbrrGateway(async(url,opts)=>{
  assert.equal(url,'https://media2.blofyplayer.com/healthz');
  assert.equal(opts.redirect,'manual');
  return new Response('BLOFY_HOSTER_GATEWAY_READY');
 });
 assert.equal(result.status,'healthy');
 assert.equal(result.tier,'test');
 assert.equal(result.id,'hostbrr-gateway');
});
test('wrong body, oversized response, redirect and unavailable service are not healthy',async()=>{
 for(const response of [new Response('wrong'),new Response('x'.repeat(129)),new Response(null,{status:302}),new Response(null,{status:503})]){
  assert.equal((await probeHostbrrGateway(async()=>response)).status,'error');
 }
 assert.equal((await probeHostbrrGateway(async()=>{throw Error('offline');})).status,'offline');
});
