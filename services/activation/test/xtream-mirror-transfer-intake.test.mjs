import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 validateMirrorIntakeSelection,stageMirrorIntake,
 listMirrorIntake,cancelMirrorIntake,mirrorIntakeLimit
} from '../src/xtream-mirror-transfer-intake.mjs';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
function fixture({existing=null,cap=0,sourceApproved=true,
 episode=false,validCatalog=true}={}){
 const calls=[];
 const staged={row:existing};
 const client={
  async query(sql,args=[]){
   calls.push({sql,args});
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||
      sql.startsWith('SET LOCAL')||sql.includes('pg_advisory_xact_lock'))
    return {rowCount:1,rows:[]};
   if(sql.includes('INSERT INTO blofy_xtream_gateway_item_map'))
    return {rowCount:1,rows:[]};
   if(sql.includes('SELECT gateway_id FROM blofy_xtream_gateway_item_map'))
    return {rowCount:1,rows:[{gateway_id:125}]};
   if(sql.includes('FROM blofy_xtream_servers'))
    return {rowCount:sourceApproved?1:0,rows:sourceApproved?[{id:SOURCE}]:[]};
   if(sql.includes('FROM blofy_xtream_gateway_episode_map e')||
      sql.includes('FROM blofy_xtream_items i')){
    return {rowCount:validCatalog?1:0,rows:validCatalog?
      [{title:episode?'Episode 7':'Film 7',extension:'mkv'}]:[]};
   }
   if(sql.includes('FROM blofy_stream_mirror_intents')&&
      sql.includes('catalog_id=$3'))
    return {rowCount:staged.row?1:0,rows:staged.row?[staged.row]:[]};
   if(sql.includes('COUNT(*)::int AS total'))
    return {rows:[{total:cap}]};
   if(sql.includes('INSERT INTO blofy_stream_mirror_intents')){
    const row={media_kind:args[1],catalog_id:args[2],
      title:args[3],extension:args[4],state:args[5],
      created_at:'2026-11-15T00:00:00Z',
      updated_at:'2026-11-15T00:00:00Z'};
    staged.row=row;return {rowCount:1,rows:[row]};
   }
   throw Error('unexpected SQL in transaction');
  },
  release(){calls.push({sql:'RELEASE'})}
 };
 const db={
  query:async(sql,args)=>{
   calls.push({sql,args});
   if(sql.startsWith('CREATE TABLE'))return {rowCount:0,rows:[]};
   if(sql.includes('UPDATE blofy_stream_mirror_intents'))
    return {rowCount:1,rows:[{catalog_id:args[2]}]};
   if(sql.includes('FROM blofy_stream_mirror_intents'))
    return {rows:staged.row?[staged.row]:[]};
   throw Error('unexpected SQL from pool');
  },
  connect:async()=>client
 };
 return {db,calls,staged};
}
test('one source-scoped movie intent is durable but cannot be copied or sold',async()=>{
 const {db,calls}=fixture();
 const result=await stageMirrorIntake(db,{
  sourceId:SOURCE,kind:'movie',id:'1349410',
  manifestStatus:'not_recorded',ownerConfirmed:true});
 assert.equal(result.ok,true);
 assert.equal(result.code,'mirror_intake_staged_metadata_only');
 assert.equal(result.item.state,'awaiting_size_and_license');
 assert.equal(result.item.expectedBytes,null);
 assert.equal(result.item.transferReady,false);
 assert.equal(result.mediaBytesTransferred,0);
 assert.equal(result.copyWorkerEnabled,false);
 assert.equal(result.customerCutover,false);
 assert.equal(result.requires.length,4);
 const sql=calls.map(x=>x.sql).join('\n');
 assert.ok(sql.includes('pg_advisory_xact_lock'));
 assert.ok(sql.includes("lower(btrim(name))='saleh'"));
 assert.ok(sql.includes("media_type='movie'"));
 assert.ok(sql.includes('ON CONFLICT(source_id,media_kind,catalog_id)'));
 assert.ok(!sql.includes('GetObject'));
 const out=await listMirrorIntake(db,{sourceId:SOURCE});
 assert.equal(out.ok,true);
 assert.equal(out.pending,1);
 assert.equal(out.items[0].id,'1349410');
 assert.equal(out.mediaBytesTransferred,0);
});
test('known verified manifest cannot enter staging, even if operator clicks',async()=>{
 const {db,calls}=fixture();
 const r=await stageMirrorIntake(db,{
  sourceId:SOURCE,kind:'movie',id:'1349410',
  manifestStatus:'verified_manifest',ownerConfirmed:true});
 assert.equal(r.ok,false);
 assert.equal(calls.length,0);
});
test('unapproved source and unknown catalog movie fail without writes',async()=>{
 for(const f of [fixture({sourceApproved:false}),
  fixture({validCatalog:false})]){
  const r=await stageMirrorIntake(f.db,{
   sourceId:SOURCE,kind:'movie',id:'other',
   manifestStatus:'not_recorded',ownerConfirmed:true});
  assert.equal(r.ok,false);
  assert.equal(f.calls.some(x=>x.sql.includes('INSERT INTO')),false);
  assert.equal(f.calls.some(x=>x.sql==='ROLLBACK'),true);
 }
});
test('selected movie alone is mapped, with no wholesale Xtream catalog materialization',async()=>{
 const f=fixture();
 const r=await stageMirrorIntake(f.db,{
  sourceId:SOURCE,kind:'movie',id:'new_movie_999',
  manifestStatus:'not_recorded',ownerConfirmed:true
 });
 assert.equal(r.ok,true);
 const writes=f.calls.filter(x=>x.sql.includes('INSERT INTO blofy_xtream_gateway_item_map'));
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0].args,[SOURCE,'new_movie_999']);
 assert.match(writes[0].sql,/i.source_id=\$2/);
 assert.match(writes[0].sql,/ON CONFLICT\(server_id,media_type,source_id\)/);
 assert.equal(f.calls.some(x=>x.sql.includes('INSERT INTO blofy_xtream_gateway_category_map')),false);
});
test('episode intent uses mapped episode gateway ID, never a freeform URL',async()=>{
 const f=fixture({episode:true});
 const r=await stageMirrorIntake(f.db,{
  sourceId:SOURCE,kind:'episode',id:'127434',
  manifestStatus:'not_recorded',ownerConfirmed:true});
 assert.equal(r.ok,true);
 const q=f.calls.find(x=>x.sql.includes('FROM blofy_xtream_gateway_episode_map e'));
 assert.equal(q.args[1],127434);
 assert.equal(r.item.extension,'mkv');
 assert.equal(r.item.rightsEvidenceRecorded,false);
});
test('a repeated click returns existing planned copy without duplicate queue entry',async()=>{
 const row={media_kind:'movie',catalog_id:'1349410',state:'awaiting_size_and_license',
  title:'Existing film',extension:'mkv'};
 const f=fixture({existing:row});
 const r=await stageMirrorIntake(f.db,{
  sourceId:SOURCE,kind:'movie',id:'1349410',
  manifestStatus:'not_recorded',ownerConfirmed:true});
 assert.equal(r.code,'mirror_intake_already_staged');
 assert.equal(f.calls.filter(x=>x.sql.includes('INSERT INTO blofy_stream_mirror_intents')).length,0);
 assert.equal(f.calls.filter(x=>x.sql.includes('INSERT INTO blofy_xtream_gateway_item_map')).length,1);
});
test('per-source cap blocks a 25th staging record',async()=>{
 const f=fixture({cap:mirrorIntakeLimit});
 const r=await stageMirrorIntake(f.db,{
  sourceId:SOURCE,kind:'movie',id:'1349410',
  manifestStatus:'not_recorded',ownerConfirmed:true});
 assert.equal(r.ok,false);
 assert.equal(r.code,'mirror_intake_queue_limit');
 assert.equal(f.calls.some(x=>x.sql.includes('INSERT INTO')),false);
});
test('cancellation changes only metadata intake state, never media worker',async()=>{
 const f=fixture();
 const r=await cancelMirrorIntake(f.db,{
  sourceId:SOURCE,kind:'movie',id:'1349410',ownerConfirmed:true});
 assert.equal(r.ok,true);assert.equal(r.mediaCopyStarted,false);
 assert.equal(r.code,'mirror_intake_cancelled');
 assert.equal(f.calls.some(x=>x.sql.includes("state='cancelled'")),true);
});
test('input rejects path traversal, bulk rows, unconfirmed and unsupported media',async()=>{
 const f=fixture();
 for(const request of [
  {sourceId:SOURCE,kind:'movie',id:'../../etc/passwd',manifestStatus:'not_recorded',ownerConfirmed:true},
  {sourceId:SOURCE,kind:'live',id:'1',manifestStatus:'not_recorded',ownerConfirmed:true},
  {sourceId:SOURCE,kind:'episode',id:'abc',manifestStatus:'not_recorded',ownerConfirmed:true},
  {sourceId:SOURCE,kind:'movie',id:'133',manifestStatus:'not_assessed',ownerConfirmed:true},
  {sourceId:SOURCE,kind:'movie',id:'133',manifestStatus:'not_recorded',ownerConfirmed:false}
 ])assert.equal((await stageMirrorIntake(f.db,request)).ok,false);
 assert.equal(f.calls.length,0);
 assert.equal(validateMirrorIntakeSelection({
  sourceId:SOURCE,kind:'movie',id:'133'}),true);
});
test('Portal endpoint requires explicit owner action and confirmed manifest reconciliation',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 for(const expected of [
  'BLOFY_STREAM_MIRROR_INTAKE_ENABLED',
  'stage-private-mirror-intake',
  'cancel-private-mirror-intake',
  'BLOFY_STREAM_MIRROR_MANIFEST_RECONCILE_ENABLED',
  'mirror_intake_already_verified_in_private_hub',
  'mirror_intake_existing_manifest_inconsistent',
  'mirror_intake_manifest_check_unavailable',
  'sourceId=selectedSaleh.ok?selectedSaleh.sourceId:null'
 ])assert.ok(code.includes(expected),expected);
});
