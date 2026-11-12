import test from 'node:test';
import assert from 'node:assert/strict';
import {recordAiPublish,readAiPublishState,revertAiClassification,
 ensureAiJournalSchema} from '../src/stream-ai-publish-journal.mjs';
const sourceId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const planId='b'.repeat(48);
test('AI publication journal stores no upstream credentials and increments durable revision',async()=>{
 const calls=[];
 const client={async query(sql,args=[]){
  calls.push({sql,args});
  if(/RETURNING revision/.test(sql))return {rows:[{revision:'7'}]};
  return {rows:[],rowCount:1};
 }};
 await ensureAiJournalSchema(client);
 const revision=await recordAiPublish(client,{planId,sourceId,mediaType:'live',
  operation:'classify_items',changes:[{
   id:'123',title:'Football',fromCategory:'1',fromOverride:null,toCategory:'2'
  }]});
 assert.equal(revision,7);
 assert.ok(calls.some(x=>x.sql.includes('blofy_library_ai_publish_log')));
 assert.ok(calls.some(x=>x.sql.includes('blofy_library_ai_revisions')));
 assert.ok(!JSON.stringify(calls).includes('password='));
});
test('rollback refuses unsupported plans and always closes transaction',async()=>{
 const calls=[];
 const client={async query(sql){
  calls.push(sql);
  if(sql.includes('SELECT media_type,operation,changes,reverted_at'))
   return {rows:[{media_type:'live',operation:'category_sort',changes:[],reverted_at:null}]};
  return {rows:[],rowCount:1};
 },release(){}};
 const r=await revertAiClassification({connect:async()=>client},{sourceId,planId});
 assert.equal(r.code,'stream_ai_rollback_unsupported');
 assert.ok(calls.includes('ROLLBACK'));
 assert.ok(!calls.includes('COMMIT'));
});
test('rollback conflict aborts all earlier changes atomically',async()=>{
 const calls=[];
 const client={async query(sql,args=[]){
  calls.push(sql);
  if(sql.includes('SELECT media_type,operation,changes,reverted_at'))
   return {rows:[{media_type:'movie',operation:'classify_items',reverted_at:null,
    changes:[{id:'7',toCategory:'2',title:'Film',fromCategory:'1',fromOverride:null}]}]};
  if(sql.includes('UPDATE blofy_xtream_items'))return {rowCount:0,rows:[]};
  return {rows:[],rowCount:1};
 },release(){}};
 const r=await revertAiClassification({connect:async()=>client},{sourceId,planId});
 assert.equal(r.code,'stream_ai_rollback_conflict');
 assert.ok(calls.includes('ROLLBACK'));
 assert.ok(!calls.includes('COMMIT'));
});
test('successful rollback restores original category and advances revision',async()=>{
 const calls=[];
 const client={async query(sql,args=[]){
  calls.push({sql,args});
  if(sql.includes('SELECT media_type,operation,changes,reverted_at'))
   return {rows:[{media_type:'series',operation:'classify_items',reverted_at:null,
    changes:[{id:'9',toCategory:'new',title:'Series',fromCategory:'old',fromOverride:null}]}]};
  if(sql.includes('UPDATE blofy_xtream_items'))return {rowCount:1,rows:[{source_id:'9'}]};
  if(sql.includes('RETURNING revision'))return {rows:[{revision:'8'}]};
  return {rows:[],rowCount:1};
 },release(){}};
 const r=await revertAiClassification({connect:async()=>client},{sourceId,planId});
 assert.equal(r.ok,true);assert.equal(r.restored,1);
 assert.equal(r.revision,8);
 assert.ok(calls.some(x=>x.sql==='COMMIT'));
 assert.ok(!calls.some(x=>x.sql==='ROLLBACK'));
 const u=calls.find(x=>x.sql.includes('UPDATE blofy_xtream_items'));
 assert.equal(u.args[3],'old');
 assert.equal(u.args[4],null);
});
test('status lists metadata only, not changes payload or upstream secrets',async()=>{
 const pool={async query(sql){
  if(sql.includes('SELECT revision,updated_at'))return {rows:[{revision:'4',updated_at:'2026-11-10'}]};
  return {rows:[{plan_id:planId,operation:'classify_items',media_type:'live',
   created_at:'2026-11-10',reverted_at:null,moved:'3'}]};
 }};
 const r=await readAiPublishState(pool,sourceId);
 assert.equal(r.revision,4);assert.equal(r.changes[0].moved,3);
 assert.equal(Object.hasOwn(r.changes[0],'changes'),false);
});
