import test from 'node:test';
import assert from 'node:assert/strict';
import {readXtreamPrivateMirrorCoverage} from '../src/xtream-mirror-coverage.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const fixture=(have)=>{
 const queries=[];
 return {queries,db:{async query(sql,args){
  queries.push(sql);
  if(sql.includes('FROM blofy_xtream_servers'))return {rows:[{
   id:ID,last_sync_at:'2026-11-14T01:00:00Z',status:'online'
  }]};
  if(sql.includes('FROM blofy_xtream_items'))return {rows:[
    {media_type:'live',total:'99'}, {media_type:'movie',total:'200'},
    {media_type:'series',total:'23'}
  ]};
  if(sql.includes('to_regclass'))return {rows:[have]};
  if(sql.includes('FROM blofy_xtream_gateway_item_map')&&
     !sql.includes('EXISTS'))return {rows:[{total:'199'}]};
  if(sql.includes('FROM blofy_xtream_gateway_episode_map')&&
     !sql.includes('EXISTS'))return {rows:[{total:'300'}]};
  if(sql.includes('FROM blofy_content_hub_chunk_runs'))return {
    rows:[{verified:'7',bytes:'104857600'}]};
  if(sql.includes('FROM blofy_content_hub_episode_runs'))return {
    rows:[{verified:'17',bytes:'285212672'}]};
  throw Error('unexpected SQL: '+sql.slice(0,120));
 }}};
};

test('coverage distinguishes indexed Xtream, gateway episodes and verified copies',async()=>{
 const f=fixture({movies_mapped:true,episodes_mapped:true,
  movie_runs:true,episode_runs:true});
 const r=await readXtreamPrivateMirrorCoverage(f.db,{sourceId:ID});
 assert.equal(r.ok,true);
 assert.equal(r.catalogTotals.movie,200);
 assert.equal(r.gatewayMapped.movie,199);
 assert.equal(r.gatewayMapped.episode,300);
 assert.equal(r.verifiedPrivateManifests.movie,7);
 assert.equal(r.verifiedPrivateManifests.episode,17);
 assert.equal(r.verifiedPrivateManifests.knownBytes,390070272);
 assert.equal(r.restrictions.completeCatalogCopyProven,false);
 assert.equal(r.restrictions.episodesAreMappedSubsetOnly,true);
 assert.equal(r.providerRequests,0);
 assert.equal(r.customerCutover,false);
 assert.equal(f.queries.length,7);
});

test('missing optional private manifest tables report unknown not zero',async()=>{
 const f=fixture({movies_mapped:false,episodes_mapped:false,
  movie_runs:false,episode_runs:false});
 const r=await readXtreamPrivateMirrorCoverage(f.db,{sourceId:ID});
 assert.equal(r.gatewayMapped.movie,null);
 assert.equal(r.verifiedPrivateManifests.episode,null);
 assert.equal(r.verifiedPrivateManifests.knownBytes,null);
 assert.equal(f.queries.length,3);
});

test('source scope required and no unlicensed host accepted',async()=>{
 await assert.rejects(()=>readXtreamPrivateMirrorCoverage({query:async()=>{}},{
  sourceId:'other'
 }),/invalid_request/);
 const missing=await readXtreamPrivateMirrorCoverage({
  query:async()=>({rows:[]})
 },{sourceId:ID});
 assert.equal(missing.code,'approved_source_not_found');
});
