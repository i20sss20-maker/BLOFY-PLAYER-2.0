import test from 'node:test';
import assert from 'node:assert/strict';
import {createXtreamJsonArrayWriter} from '../src/xtream-json-array-writer.mjs';

test('batch writer emits exactly same JSON rows in stable order with fewer writes',async()=>{
  const result=[];
  const writer=createXtreamJsonArrayWriter(
    async chunk=>{result.push(chunk);}, {maxChars:120,maxItems:8});
  const input=Array.from({length:800},(_,i)=>({
    stream_id:i+1,name:'Arabic title '+i,category_id:String(i%6)
  }));
  for(const row of input){
    const pending=writer.append(row);
    if(pending)await pending;
  }
  await writer.finish();
  assert.deepEqual(JSON.parse(result.join('')),input);
  assert.ok(result.length<160,'must not perform one network write per row');
  assert.ok(result.length>20,'must not buffer entire catalog in memory');
});
test('zero rows stream valid empty JSON array',async()=>{
  const chunks=[];
  const writer=createXtreamJsonArrayWriter(x=>chunks.push(x));
  await writer.finish();
  assert.equal(chunks.join(''),'[]');
  assert.throws(()=>writer.append({id:2}),/closed/);
});
test('batch boundary and UTF-8 preserve exact serialized content',async()=>{
  const chunks=[];
  const writer=createXtreamJsonArrayWriter(x=>{chunks.push(x)},{maxChars:18,maxItems:2});
  const rows=[{name:'قناة 📺'},{name:'مسلسل 🎬'},{id:3}];
  for(const row of rows){const p=writer.append(row);if(p)await p}
  await writer.finish();
  assert.deepEqual(JSON.parse(chunks.join('')),rows);
  assert.ok(chunks.length>=2);
});
test('invalid writer/item rejected before network output',()=>{
  assert.throws(()=>createXtreamJsonArrayWriter(null),/invalid/);
  const writer=createXtreamJsonArrayWriter(()=>{});
  assert.throws(()=>writer.append(undefined),/invalid/);
});
