import test from 'node:test';
import assert from 'node:assert/strict';
import {collectXtreamTsFirstPackets} from '../src/xtream-live-ts-first-packets.mjs';

const ts=()=>{const b=Buffer.alloc(564,0);b[0]=b[188]=b[376]=0x47;return b;};

test('split MPEG TS packets are gathered without missing or duplicating bytes',async()=>{
 const original=ts();const parts=[original.subarray(64,169),original.subarray(169)];
 const waits=[];
 const data=await collectXtreamTsFirstPackets(original.subarray(0,64),async ms=>{
  waits.push(ms);
  return {done:false,value:parts.shift()};
 },{now:()=>1000});
 assert.deepEqual(data,original);
 assert.equal(parts.length,0);
 assert.equal(waits.length,2);
 assert.ok(waits.every(ms=>ms>0&&ms<=3000));
});

test('complete TS packets and unrelated binary do not create extra upstream reads',async()=>{
 let called=0;
 const read=async()=>{called++;throw Error('unexpected_read');};
 const complete=ts();
 assert.deepEqual(await collectXtreamTsFirstPackets(complete,read),complete);
 const unrelated=Buffer.from([0x1a,0x45,0xdf,0xa3]);
 assert.deepEqual(await collectXtreamTsFirstPackets(unrelated,read),unrelated);
 assert.equal(called,0);
});

test('short live TS source EOF is refused, not announced as valid playback',async()=>{
 await assert.rejects(
  collectXtreamTsFirstPackets(ts().subarray(0,33),async()=>({done:true})),
  /upstream_empty_media/
 );
});

test('probe is bounded by total elapsed time and number of reads',async()=>{
 let time=0,calls=0;
 await assert.rejects(collectXtreamTsFirstPackets(Buffer.from([0x47]),async()=>{
  calls++;time+=1500;
  return {done:false,value:Buffer.from([0x00])};
 },{now:()=>time,maxDelayMs:3000,maxReads:8}),/upstream_empty_media/);
 assert.equal(calls,2);
 let attempts=0;
 await assert.rejects(collectXtreamTsFirstPackets(Buffer.from([0x47]),async()=>{
  attempts++;return {done:false,value:new Uint8Array(0)};
 },{now:()=>0,maxReads:8}),/upstream_empty_media/);
 assert.equal(attempts,8);
});

test('transport timeout is propagated rather than silently approving bad TS',async()=>{
 await assert.rejects(
  collectXtreamTsFirstPackets(Buffer.from([0x47]),async()=>{throw Error('media_read_timeout');}),
  /media_read_timeout/
 );
});
