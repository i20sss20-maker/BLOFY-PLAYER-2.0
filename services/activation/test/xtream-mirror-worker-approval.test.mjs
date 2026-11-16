import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadApprovedMirrorItem} from '../src/xtream-mirror-worker-approval.mjs';

const UUID='123e4567-e89b-42d3-a456-426614174000';
const NOW=1700000000000,CHUNK=8*1024*1024;
function fixture({missing=false,ageMs=0,sourceDuplicate=false,
 license=true,validator=true,mediaChanged=false}={}){
 const queries=[];
 const db={query:async(sql,args=[])=>{
  queries.push({sql,args});
  if(sql.includes("FROM blofy_xtream_servers"))
   return {rows:sourceDuplicate?[{id:UUID},{id:UUID}]:[{id:UUID}]};
  if(sql.includes('FROM blofy_stream_mirror_intents t'))
   return {rows:missing?[]:[{
    intake_extension:'mkv',expected_bytes:CHUNK+15,
    rights_evidence_hash:license?'b'.repeat(64):null,
    measured_at:new Date(NOW-ageMs).toISOString(),
    validator_present:validator
   }]};
  if(sql.includes('FROM blofy_xtream_items i')||
     sql.includes('FROM blofy_xtream_gateway_episode_map e'))
   return {rows:[{media_id:'123456',gateway_id:56,
      extension:mediaChanged?'mp4':'mkv'}]};
  throw Error('unrecognized SQL');
 }};
 return {db,queries};
}
test('only pinned source and eligible staged, recently measured file is approved',async()=>{
 const f=fixture();
 const r=await loadApprovedMirrorItem(f.db,{kind:'movie',id:'123456',now:NOW});
 assert.equal(r.ok,true);
 assert.equal(r.sourceName,'saleh');
 assert.equal(r.expectedBytes,CHUNK+15);
 assert.equal(r.mediaId,'123456');
 assert.equal(r.gatewayId,56);
 assert.equal(r.providerRequests,0);
 assert.equal(r.mediaBytesTransferred,0);
 assert.equal(r.customerCutover,false);
 const sql=f.queries.map(x=>x.sql).join('\n');
 assert.ok(sql.includes("lower(btrim(name))='saleh'"));
 assert.ok(sql.includes("p.state='eligible'"));
 assert.ok(sql.includes("t.state='awaiting_size_and_license'"));
 assert.ok(sql.includes('gateway_item_map'));
});
test('stale or missing evidence cannot be treated as copy permission',async()=>{
 for(const opts of [{missing:true},{ageMs:40*60*1000},
  {sourceDuplicate:true},{license:false},{validator:false},
  {mediaChanged:true}]){
  const f=fixture(opts);
  const out=await loadApprovedMirrorItem(f.db,{
   kind:'movie',id:'123456',now:NOW});
  assert.equal(out.ok,false);
  assert.equal(out.customerCutover,false);
 }
});
test('invalid kind or path id rejected before database lookup',async()=>{
 const f=fixture();
 for(const [kind,id] of [['live','1'],['movie','../../etc'],
  ['episode','abcdef'],['movie','']]){
  const out=await loadApprovedMirrorItem(f.db,{kind,id,now:NOW});
  assert.equal(out.ok,false);
 }
 assert.equal(f.queries.length,0);
});
test('episode approval uses exact mapped numeric episode id',async()=>{
 const f=fixture();
 const out=await loadApprovedMirrorItem(f.db,{
  kind:'episode',id:'123456',now:NOW});
 assert.equal(out.ok,true);
 const sql=f.queries.find(x=>x.sql.includes('FROM blofy_xtream_gateway_episode_map e'));
 assert.ok(sql);
 assert.equal(sql.args[1],123456);
});
test('private source bridge has no public route and requires quiet window',async()=>{
 const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 for(const snippet of [
  "BLOFY_CONTENT_HUB_MIRROR_BRIDGE_ENABLED!=='1'",
  "BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED!=='1'",
  "req.headers['x-blofy-mirror-transfer']!=='licensed-one-chunk'",
  'loadApprovedMirrorItem(pool,{kind,id})',
  'if(verified.etag)headers.etag=verified.etag',
  "if(!range||range.to>=approved.expectedBytes)"
 ])assert.ok(code.includes(snippet),snippet);
});
