import test from 'node:test';
import assert from 'node:assert/strict';
import {enumerateOneMirrorSeries,shouldEnumerateMirrorSeries,
 readMirrorSeriesEnumerationProgress}
 from '../src/xtream-mirror-series-enumeration.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
function fixture({series=[12,14],sourceApproved=true}={}){
 const state={last_gateway_id:0,started_local_day:null,
  finished_local_day:null},calls=[],ids=[],locks=[];
 const client={
  async query(sql,args=[]){
   calls.push({sql,args});
   if(sql.includes('pg_try_advisory_lock')){
    locks.push('lock');return {rows:[{held:true}]};
   }
   if(sql.includes('pg_advisory_unlock')){
    locks.push('unlock');return {rows:[{held:true}]};
   }
   if(sql.includes('CREATE TABLE')||sql.includes('INSERT INTO'))
    return {rowCount:1,rows:[]};
   if(sql.includes('FROM blofy_xtream_servers'))
    return {rows:sourceApproved?[{id:ID}]:[]};
   if(sql.includes('FROM blofy_xtream_mirror_series_progress'))
    return {rows:[{...state}]};
   if(sql.includes('FROM blofy_xtream_gateway_item_map')){
    const id=series.find(n=>n>args[1]);
    return {rows:id?[{gateway_id:id}]:[]};
   }
   if(sql.includes('UPDATE blofy_xtream_mirror_series_progress')){
    if(sql.includes('finished_local_day=$3::date')){
     state.last_gateway_id=args[1];
     state.started_local_day=args[2];
     state.finished_local_day=args[2];
     state.failed_gateway_id=null;
    }else if(sql.includes('SET failed_gateway_id')){
     state.failed_gateway_id=args[1];
    }else if(sql.includes('SET last_gateway_id=$2')){
     state.last_gateway_id=args[1];
     state.started_local_day=args[3]?args[2]:
      state.started_local_day||args[2];
     state.failed_gateway_id=null;
    }
    return {rowCount:1,rows:[]};
   }
   throw Error('unexpected SQL '+sql.slice(0,120));
  },
  release(){}
 };
 return {db:{connect:async()=>client},
  state,calls,ids,locks,lookup:async(id,sourceId)=>{
   assert.equal(sourceId,ID);
   ids.push(id);return {episodes:[]}
  }};
}

test('series enumeration disabled unless exact approved source configured',()=>{
 assert.equal(shouldEnumerateMirrorSeries({}),false);
 assert.equal(shouldEnumerateMirrorSeries({
  BLOFY_XTREAM_MIRROR_SERIES_ENUM_ENABLED:'1',
  BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:'invalid'
 }),false);
 assert.equal(shouldEnumerateMirrorSeries({
  BLOFY_XTREAM_MIRROR_SERIES_ENUM_ENABLED:'1',
  BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID
 }),true);
});

test('one metadata series per tick, durable cursor and daily completion',async()=>{
 const f=fixture();
 for(const id of [12,14]){
  const r=await enumerateOneMirrorSeries({db:f.db,seriesLookup:f.lookup,
   sourceId:ID,localDay:'2026-11-14'});
  assert.equal(r.ok,true);
  assert.equal(r.gatewayId,id);
  assert.equal(r.providerRequests,1);
  assert.equal(r.mediaBytesTransferred,0);
  assert.equal(r.customerCutover,false);
 }
 const end=await enumerateOneMirrorSeries({db:f.db,seriesLookup:f.lookup,
  sourceId:ID,localDay:'2026-11-14'});
 assert.equal(end.code,'mirror_series_scan_completed');
 const same=await enumerateOneMirrorSeries({db:f.db,seriesLookup:f.lookup,
  sourceId:ID,localDay:'2026-11-14'});
 assert.equal(same.code,'mirror_series_already_scanned_today');
 assert.deepEqual(f.ids,[12,14]);
 assert.equal(f.locks.filter(x=>x==='lock').length,
  f.locks.filter(x=>x==='unlock').length);
 // On the next local day a completed catalog is rechecked from the first
 // gateway; a partial pass should NOT be restarted on a subsequent tick.
 const next=await enumerateOneMirrorSeries({db:f.db,seriesLookup:f.lookup,
  sourceId:ID,localDay:'2026-11-15'});
 assert.equal(next.gatewayId,12);
 const nextSecond=await enumerateOneMirrorSeries({db:f.db,
  seriesLookup:f.lookup,sourceId:ID,localDay:'2026-11-15'});
 assert.equal(nextSecond.gatewayId,14);
});

test('provider failure does not mark a series scanned or advance cursor',async()=>{
 const f=fixture(),bad=await enumerateOneMirrorSeries({
  db:f.db,sourceId:ID,localDay:'2026-11-14',
  seriesLookup:async()=>{throw Error('upstream credentials')}
 });
 assert.equal(bad.ok,false);
 assert.equal(bad.code,'mirror_series_metadata_unavailable');
 assert.equal(f.state.last_gateway_id,0);
 assert.equal(bad.mediaBytesTransferred,0);
 const next=await enumerateOneMirrorSeries({db:f.db,seriesLookup:f.lookup,
  sourceId:ID,localDay:'2026-11-14'});
 assert.equal(next.gatewayId,12);
});

test('unapproved source cannot cause provider traffic',async()=>{
 const f=fixture({sourceApproved:false});
 const r=await enumerateOneMirrorSeries({db:f.db,
  seriesLookup:f.lookup,sourceId:ID,localDay:'2026-11-14'});
 assert.equal(r.code,'mirror_series_source_not_currently_approved');
 assert.equal(r.providerRequests,0);
 assert.deepEqual(f.ids,[]);
});

test('admin series progress reports no previous scan, without guessing coverage',async()=>{
 const p=await readMirrorSeriesEnumerationProgress({
  query:async()=>({rows:[]})
 },{sourceId:ID});
 assert.equal(p.code,'mirror_series_scan_not_started');
 const existing=await readMirrorSeriesEnumerationProgress({
  query:async()=>({rows:[{
   last_gateway_id:14,
   started_local_day:new Date('2026-11-14T00:00:00Z'),
   finished_local_day:null,
   failed_gateway_id:null,
   last_error_code:null,series_scanned:'2',
   updated_at:'2026-11-14T01:00:00Z'
  }]})
 },{sourceId:ID});
 assert.equal(existing.lastGatewayId,14);
 assert.equal(existing.seriesScanned,2);
 assert.equal(existing.startedLocalDay,'2026-11-14');
 assert.equal(existing.episodesCountNotExhaustivelyVerified,true);
 assert.equal(existing.providerRequests,0);
 await assert.rejects(()=>readMirrorSeriesEnumerationProgress({
  query:async()=>({rows:[]})
 },{sourceId:'invalid'}),/status_request_invalid/);
});
