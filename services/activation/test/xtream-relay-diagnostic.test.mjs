import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readSanitizedXtreamRelayFailure} from '../src/xtream-relay-diagnostic.mjs';
function diagnostic(status,payload){
 return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});
}
test('safe relay 404 is classified distinctly from outer HTTP 502',async()=>{
 const code=await readSanitizedXtreamRelayFailure(diagnostic(502,{
  ok:false,code:'relay_provider_not_found',upstreamStatus:404
 }));
 assert.equal(code,'relay_provider_not_found');
});
test('invalid/forged relay 404 codes and unapproved replies are not trusted',async()=>{
 for(const response of [
  diagnostic(502,{ok:false,code:'relay_provider_not_found',upstreamStatus:500}),
  diagnostic(502,{ok:false,code:'http://private.example/u/p',upstreamStatus:404}),
  diagnostic(502,{ok:true,code:'relay_provider_not_found',upstreamStatus:404}),
  diagnostic(404,{ok:false,code:'relay_provider_not_found',upstreamStatus:404}),
  new Response('x'.repeat(700),{status:502})
 ])assert.equal(await readSanitizedXtreamRelayFailure(response),null);
});
test('known timeout is captured but no source data is returned',async()=>{
 assert.equal(await readSanitizedXtreamRelayFailure(diagnostic(502,{
  ok:false,code:'relay_first_byte_timeout'
 })),'relay_first_byte_timeout');
});
test('admin relay probe gate and diagnostics use only an issued grant',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function probeXtreamPlayback('),b=c.indexOf('async function fetchAccount(',a);
 const s=c.slice(a,b);
 assert.match(s,/let usingIndependentRelay=false/);
 assert.match(s,/usingIndependentRelay=true/);
 assert.match(s,/usingIndependentRelay&&response.status===502/);
 assert.match(s,/readSanitizedXtreamRelayFailure\(response\)/);
 assert.match(s,/shouldUseIndependentSourceMedia\(\{/);
});

test('episode probe also reports sanitized provider failures only after a relay grant',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function probeXtreamEpisodeMedia('),b=c.indexOf('async function probeXtreamSeries(',a);
 const s=c.slice(a,b);
 assert.match(s,/usingIndependentRelay=true/);
 assert.match(s,/usingIndependentRelay&&response.status===502/);
 assert.match(s,/readSanitizedXtreamRelayFailure\(response\)/);
});

test('gateway marks confirmed relay 404 terminal and does not retry that movie',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf('async function proxyMedia('),b=c.indexOf('// Explicit operator-only probe.',a);
 const block=c.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(block,/let usingIndependentRelay=false/);
 assert.match(block,/usingIndependentRelay=true/);
 assert.match(block,/usingIndependentRelay&&response.status===502/);
 assert.match(block,/readSanitizedXtreamRelayFailure\(response\)/);
 assert.match(block,/confirmedMissing=relayFailure==='relay_provider_not_found'/);
 assert.match(block,/retryable=!confirmedMissing/);
 assert.match(block,/reason:relayFailure\|\|/);
 assert.match(block,/providerHint=retryWithoutRange\|\|shouldRefresh\|\|usingIndependentRelay\?null/);
});
