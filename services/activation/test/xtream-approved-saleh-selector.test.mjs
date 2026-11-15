import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolveExclusiveApprovedSaleh} from '../src/xtream-approved-saleh-selector.mjs';
const ID='123e4567-e89b-42d3-a456-426614174000';
function db(rows){
 const calls=[];
 return {calls,query:async(sql)=>{
  calls.push(sql);return {rows};
 }};
}
test('exactly one active, published saleh source is pinned from database',async()=>{
 const d=db([{id:ID,enabled:true,publish_catalog:true,
  deletion_requested_at:null}]);
 const r=await resolveExclusiveApprovedSaleh(d);
 assert.equal(r.ok,true);
 assert.equal(r.sourceId,ID);
 assert.equal(r.oneSourceOnly,true);
 assert.equal(d.calls.length,1);
 assert.match(d.calls[0],/lower\(btrim\(name\)\)='saleh'/);
 assert.match(d.calls[0],/LIMIT 2/);
});
test('no accidental egress fallback when the canonical source is absent or duplicated',async()=>{
 const src={id:ID,enabled:true,publish_catalog:true,
  deletion_requested_at:null};
 for(const [rows,code] of [
  [[], 'approved_saleh_not_found'],
  [[src,src],'approved_saleh_ambiguous'],
  [[{...src,enabled:false}],'approved_saleh_not_active_published'],
  [[{...src,publish_catalog:false}],'approved_saleh_not_active_published'],
  [[{...src,deletion_requested_at:new Date()}],
   'approved_saleh_not_active_published']
 ]){
  const r=await resolveExclusiveApprovedSaleh(db(rows));
  assert.equal(r.ok,false);
  assert.equal(r.code,code);
  assert.equal(r.sourceId,undefined);
 }
});
test('owner catalog, physical S3 HEAD, copy intake and daily refresh share exact-saleh resolver',async()=>{
 const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const uses=src.match(/approvedSalehMirrorSource\(\)/g)||[];
 assert.ok(uses.length>=7,'one helper, daily scheduler and five gated routes');
 assert.match(src,/BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:selected\.ok\?/);
 assert.match(src,/selected\.sourceId:'-'/);
 assert.match(src,/sourceId=selectedSaleh\.ok\?selectedSaleh\.sourceId:null/);
 assert.match(src,/mirror_intake_source_unconfigured/);
 assert.doesNotMatch(src,/const sourceId=configuredDailySourceId\(process\.env\);/);
});
