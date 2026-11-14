import test from 'node:test';
import assert from 'node:assert/strict';
import {listIndexedXtreamMirrorPage} from '../src/xtream-mirror-inventory.mjs';

const sourceId='123e4567-e89b-42d3-a456-426614174000';
const source={id:sourceId,name:'saleh',status:'online',
 last_sync_at:'2026-11-14T00:00:00.000Z',counts:{live:100,movie:200,series:30}};

test('paged inventory reads catalog only and never provider media',async()=>{
 const queries=[];
 const db={async query(sql,args){
  queries.push(sql);
  if(sql.includes('FROM blofy_xtream_servers'))return {rows:[source]};
  if(sql.includes('FROM blofy_xtream_items'))return {rows:[
   {source_id:'10',name:'Film A',container_extension:'mp4'},
   {source_id:'20',name:'Film B',container_extension:'mkv'},
   {source_id:'30',name:'Film C',container_extension:'ts'}
  ]};
  throw Error('unexpected SQL');
 }};
 const a=await listIndexedXtreamMirrorPage(db,{sourceId,mediaType:'movie',pageSize:2});
 assert.equal(a.ok,true);
 assert.equal(a.items.length,2);
 assert.equal(a.hasMore,true);
 assert.equal(a.nextCursor,'20');
 assert.equal(a.providerRequests,0);
 assert.equal(a.mediaBytesTransferred,0);
 assert.equal(a.storedCopiesVerified,false);
 assert.equal(a.physicalCopyCoverageUnknown,true);
 assert.equal(queries.length,2);
});

test('mapped episode list clearly warns it is not full source episode listing',async()=>{
 const db={async query(sql,args){
  if(sql.includes('FROM blofy_xtream_servers'))return {rows:[source]};
  if(sql.includes('FROM blofy_xtream_gateway_episode_map'))return {rows:[
   {gateway_id:81,source_episode_id:'11',series_source_id:'44',
    container_extension:'mkv',series_name:'Show'}
  ]};
  throw Error('unexpected SQL');
 }};
 const a=await listIndexedXtreamMirrorPage(db,{
  sourceId,mediaType:'episode',cursor:'80',pageSize:10
 });
 assert.equal(a.items[0].id,'81');
 assert.equal(a.metadataCoverage,'previously_mapped_episodes_only');
});

test('fail closed for unknown source or untrusted page cursor',async()=>{
 const db={query:async()=>({rows:[]})};
 const denied=await listIndexedXtreamMirrorPage(db,{sourceId});
 assert.equal(denied.code,'approved_source_not_found');
 assert.equal(denied.providerRequests,0);
 await assert.rejects(
  ()=>listIndexedXtreamMirrorPage(db,{sourceId,mediaType:'movie',cursor:'x\' OR TRUE --'}),
  /inventory_query_invalid/);
 await assert.rejects(
  ()=>listIndexedXtreamMirrorPage(db,{sourceId,mediaType:'episode',cursor:'-1'}),
  /inventory_query_invalid/);
});
