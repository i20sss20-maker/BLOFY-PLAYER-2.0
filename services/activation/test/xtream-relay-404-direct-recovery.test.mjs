import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shouldCompareRelay404Direct} from '../src/xtream-relay-404-direct-recovery.mjs';

const affected='d2bb0397-1c56-4751-adc9-1a17758022f6';
const other='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const env={BLOFY_XTREAM_RELAY_404_DIRECT_COMPARE_SOURCE_IDS:affected};
const input={sourceId:affected,kind:'series',method:'GET',
  usingIndependentRelay:true,relayFailure:'relay_provider_not_found'};

test('one-region provider 404 may be compared only for explicitly allowed sources',()=>{
 assert.equal(shouldCompareRelay404Direct(input,env),true);
 assert.equal(shouldCompareRelay404Direct({...input,kind:'movie'},env),true);
 assert.equal(shouldCompareRelay404Direct({...input,range:'bytes=0-1023'},env),true);
 assert.equal(shouldCompareRelay404Direct(input,{}),false);
 assert.equal(shouldCompareRelay404Direct({...input,sourceId:other},env),false);
 assert.equal(shouldCompareRelay404Direct({...input,sourceId:'not-a-uuid'},env),false);
 assert.equal(shouldCompareRelay404Direct(input,{
   BLOFY_XTREAM_RELAY_404_DIRECT_COMPARE_SOURCE_IDS:'invalid'}),false);
});
test('never retries permission failures, generic outages, arbitrary seeks or live',()=>{
 for(const changed of [
   {kind:'live'},{kind:'something'},{method:'HEAD'},
   {usingIndependentRelay:false},{relayFailure:'relay_provider_unavailable'},
   {relayFailure:'relay_redirect_denied'},{relayFailure:''},
   {alreadyTried:true},{range:'bytes=200-400'},{range:'bytes=-4096'},
   {range:'bytes=100-'},{range:'invalid'},
 ]){
   assert.equal(shouldCompareRelay404Direct({...input,...changed},env),false,
     JSON.stringify(changed));
 }
});
test('gateway compares exactly the last authorized same-file direct URL',async()=>{
 const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const a=code.indexOf('async function proxyMedia(');
 const b=code.indexOf('async function probeGatewayMedia(',a);
 const s=code.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(s,/const upstream = mediaUpstreamUrl\(row, kind, sourceId, mediaExtension\)/);
 assert.match(s,/let directSourceTarget=upstream/);
 assert.match(s,/directSourceTarget=corrected/);
 assert.match(s,/shouldCompareRelay404Direct\(\{sourceId:row.server_id,kind/);
 assert.match(s,/relayFailure,alreadyTried:directCompareTried/);
 assert.match(s,/mediaFetchTarget=directSourceTarget/);
 assert.match(s,/usingIndependentRelay=false/);
 assert.match(s,/fallbackTried=true/);
 assert.match(s,/state:'direct_media_first_bytes_received'/);
 assert.doesNotMatch(s,/mediaFetchTarget\s*=\s*new URL\(req\.headers/);
 assert.doesNotMatch(s,/sourceId=.+other/);
});
