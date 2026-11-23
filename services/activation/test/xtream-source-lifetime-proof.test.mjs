import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {liveTsRecoveryBytes} from '../src/xtream-live-ts-recovery.mjs';

const target='https://approved-origin.example/live/secret-not-to-log.ts';
function packet(){
 const b=new Uint8Array(564);
 b[0]=b[188]=b[376]=0x47;
 return b;
}
function source(){
 return new Response(new ReadableStream({
  start(c){c.enqueue(packet());c.close();}
 }),{status:200,headers:{'content-type':'video/mp2t'}});
}
const immediate=async()=>true;

test('true live socket uptime and last-packet silence are measured separately',async()=>{
 let t=1000,reads=0,calls=0;
 const reader={
  async read(){
   if(reads++===0)return {done:false,value:packet()};
   return {done:true};
  },
  async cancel(){},releaseLock(){}
 };
 const events=[],drop=[];
 const iter=liveTsRecoveryBytes({
  first:packet(),reader,controller:new AbortController(),target,
  now:()=>t,waitRetry:immediate,
  onSourceLifetime:event=>events.push(event),
  onSourceDrop:event=>drop.push(event),
  fetchImpl:async()=>{calls++;return source();}
 });
 assert.equal((await iter.next()).value.length,564);
 t=4000;
 assert.equal((await iter.next()).value.length,564);
 t=5500;
 assert.equal((await iter.next()).value.length,564);
 assert.equal(calls,1,'no extra source request introduced');
 assert.deepEqual(events[0],{
  reason:'live_ts_source_eof',sourceUptimeMs:4500,
  mediaSilenceMs:1500,bytesDelivered:1128
 });
 assert.deepEqual(drop[0],{reason:'live_ts_source_eof',durationMs:1500},
  'existing playback metrics contract stays unchanged');
 // The second source socket starts only after first socket ends.
 t=10500;
 assert.equal((await iter.next()).value.length,564);
 assert.deepEqual(events[1],{
  reason:'live_ts_source_eof',sourceUptimeMs:5000,
  mediaSilenceMs:5000,bytesDelivered:564
 });
 await iter.return();
});

test('diagnostics callback failure cannot stop or add reconnection attempts',async()=>{
 const original=source(),reader=original.body.getReader(),first=(await reader.read()).value;
 let calls=0,recovered=0;
 const iter=liveTsRecoveryBytes({
  first,reader,controller:new AbortController(),target,
  waitRetry:immediate,
  onSourceLifetime:()=>{throw Error('telemetry is not playback');},
  fetchImpl:async()=>{calls++;return source();},
  onReconnect:()=>recovered++
 });
 assert.equal((await iter.next()).value.length,564);
 assert.equal((await iter.next()).value.length,564);
 assert.equal(calls,1);
 assert.equal(recovered,1);
 await iter.return();
});

test('gateway emits bounded source evidence and classified transport phases, without secrets',async()=>{
 const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const lifetime=code.slice(code.indexOf('onSourceLifetime:('),
  code.indexOf('onReconnect:(',code.indexOf('onSourceLifetime:(')));
 assert.match(lifetime,/BLOFY_LIVE_TS_SOURCE_LIFETIME/);
 assert.match(lifetime,/sourceSeconds/);
 assert.match(lifetime,/silenceMs/);
 assert.match(lifetime,/bytesBand/);
 assert.doesNotMatch(lifetime,/target\.href|accountId|username|password|headers|clientIp/);
 const warning=code.slice(code.indexOf("console.warn('xtream media relay error'"),
  code.indexOf('// Switch egress ONLY',code.indexOf("console.warn('xtream media relay error'")));
 assert.match(warning,/JSON\.stringify/);
 assert.match(warning,/phase:res\.headersSent\?'media_body'/);
 assert.match(warning,/independent_relay/);
 assert.doesNotMatch(warning,/target\.href|password|username|clientIp/);
});
