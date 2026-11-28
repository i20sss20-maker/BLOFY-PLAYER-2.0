import test from 'node:test';
import assert from 'node:assert/strict';
import {observeEdgeBody} from '../src/xtream-edge-body-lifecycle.mjs';
test('preserves bytes, chunk boundaries and clean EOF',async()=>{
 const events=[],chunks=[Uint8Array.of(1,2),Uint8Array.of(3,4,5)];
 let i=0;
 const source=new ReadableStream({pull(c){if(i<chunks.length)c.enqueue(chunks[i++]);else c.close()}},{highWaterMark:0});
 const reader=observeEdgeBody(source,{onFinish:e=>events.push(e),now:()=>100}).getReader();
 for(const chunk of chunks)assert.deepEqual((await reader.read()).value,chunk);
 assert.equal((await reader.read()).done,true);
 assert.deepEqual(events,[{reason:'eof',bytes:5,elapsedMs:0}]);
});
test('body reset remains an error after headers; strips credential-bearing exception',async()=>{
 const events=[];let i=0;
 const source=new ReadableStream({pull(c){if(i++===0)c.enqueue(Uint8Array.of(1));else c.error(new Error('private source identifier'))}},{highWaterMark:0});
 const reader=observeEdgeBody(source,{onFinish:e=>events.push(e)}).getReader();
 assert.equal((await reader.read()).value.byteLength,1);
 await assert.rejects(reader.read(),/^Error: edge_upstream_body_error$/);
 assert.equal(events.length,1);assert.equal(events[0].reason,'upstream_body_error');assert.equal(events[0].bytes,1);
 assert.equal(JSON.stringify(events).includes('private source'),false);
});
test('viewer cancellation cancels upstream once and reports once',async()=>{
 let cancels=0;const events=[];
 const source=new ReadableStream({pull(){},cancel(){cancels++}},{highWaterMark:0});
 const reader=observeEdgeBody(source,{onFinish:e=>events.push(e)}).getReader();
 await reader.cancel();
 assert.equal(cancels,1);assert.equal(events.length,1);assert.equal(events[0].reason,'client_cancelled');
});
test('aborted request does not classify a downstream cancellation as source failure',async()=>{
 const events=[],ctrl=new AbortController();ctrl.abort();
 const source=new ReadableStream({pull(c){c.error(new Error('private'))}},{highWaterMark:0});
 const reader=observeEdgeBody(source,{signal:ctrl.signal,onFinish:e=>events.push(e)}).getReader();
 await assert.rejects(reader.read(),/^Error: edge_client_cancelled$/);
 assert.equal(events[0].reason,'client_cancelled');
});
