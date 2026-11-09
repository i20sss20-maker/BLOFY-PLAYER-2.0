import test from 'node:test';
import assert from 'node:assert/strict';
import {validAiScanArgs,recordAiAnalyzedBatch,getAiScanProgress,
 ensureAiScanSchema} from '../src/stream-ai-scan-progress.mjs';
const sourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('AI progress validates source, count and aligned 12-item batches',()=>{
 assert.equal(validAiScanArgs({sourceId,type:'live',offset:12,seen:12,proposed:3}),true);
 assert.equal(validAiScanArgs({sourceId,type:'live',offset:13,seen:12,proposed:3}),false);
 assert.equal(validAiScanArgs({sourceId,type:'live',offset:12,seen:12,proposed:13}),false);
});
test('analyzed batch is upserted, avoiding duplicate progress counts',async()=>{
 const calls=[];const pool={async query(sql,args=[]){calls.push({sql,args});return {rows:[]}}};
 await ensureAiScanSchema(pool);
 await recordAiAnalyzedBatch(pool,{sourceId,type:'movie',offset:0,seen:12,proposed:1});
 assert.ok(calls.some(x=>x.sql.includes('ON CONFLICT(source_id,media_type,batch_offset)')));
 assert.ok(!JSON.stringify(calls).includes('password'));
});
test('progress returns analyzed, NOT auto-approved, fraction and next cursor',async()=>{
 const pool={async query(sql){
  if(sql.includes('COUNT(*)::int AS total'))return {rows:[{total:96}]};
  return {rows:[{batches:2,analyzed:24,suggestions:8,last_offset:12}]};
 }};
 const r=await getAiScanProgress(pool,{sourceId,type:'series'});
 assert.equal(r.ok,true);assert.equal(r.estimatedPercent,25);
 assert.equal(r.nextSuggestedOffset,24);
 assert.equal(r.complete,false);
 assert.equal(r.analyzedItems,24);
 assert.match(r.note,/لا تعني اعتماد التصنيف/);
});
