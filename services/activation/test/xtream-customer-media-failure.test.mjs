import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {customerMediaFailureStatus} from '../src/xtream-customer-media-failure.mjs';

test('provider 404 hidden inside trusted relay 502 is terminal client 404',()=>{
 assert.equal(customerMediaFailureStatus({
  usingIndependentRelay:true,relayStatus:502,
  relayFailure:'relay_provider_not_found'
 }),404);
});
test('ordinary gateway and relay failures are never mislabeled provider missing',()=>{
 for(const x of [
  {},
  {usingIndependentRelay:true,relayStatus:502,relayFailure:'relay_first_byte_timeout'},
  {usingIndependentRelay:true,relayStatus:502,relayFailure:'relay_transport_connection_reset'},
  {usingIndependentRelay:false,relayStatus:502,relayFailure:'relay_provider_not_found'},
  {usingIndependentRelay:true,relayStatus:404,relayFailure:'relay_provider_not_found'},
  {usingIndependentRelay:true,relayStatus:502,relayFailure:'other'}
 ])assert.equal(customerMediaFailureStatus(x),502);
});
test('client gateway checks source grants before using trusted relay response and does not retry missing media',async()=>{
 const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=code.indexOf('async function proxyMedia(');
 const end=code.indexOf('// Explicit operator-only probe.',start);
 assert.ok(start>=0&&end>start);
 const part=code.slice(start,end);
 const issue=part.indexOf('mediaFetchTarget=new URL(await issueStreamRelayGrant(');
 const proof=part.indexOf('const relayFailure=usingIndependentRelay&&response.status===502?');
 const returnStatus=part.indexOf('customerMediaFailureStatus({');
 assert.ok(issue>=0&&proof>issue&&returnStatus>proof);
 assert.match(part,/retryable=!confirmedMissing/);
 assert.ok(part.includes('upstreamStatus:confirmedMissing?404:response.status'));
 assert.match(part,/return text\(res,clientStatus,/);
 assert.match(part,/clientStatus===404\?'Media unavailable':'Upstream unavailable'/);
 assert.doesNotMatch(part,/res\.writeHead\(404[^\n]*sourceUrl/);
});
