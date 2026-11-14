import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanSeriesCandidate,listLicensedSeries,mappedLicensedSeriesEpisodes,
 buildLicensedSeriesSeasons,findPilotSeriesForEpisode} from '../src/xtream-content-hub-series.mjs';
const serverId='9adc6472-5d4e-4359-83e4-0298cc038ae3';
test('list licensed series only from approved saleh and no passwords',async()=>{
 const pool={query:async(sql,args)=>{
  assert.match(sql,/lower\(btrim\(s.name\)\)='saleh'/);
  assert.match(sql,/m.media_type='series'/);
  assert.deepEqual(args,[30]);
  return {rows:[{gateway_id:31,title:'Test Series'}]} }};
 const result=await listLicensedSeries(pool);
 assert.deepEqual(result,[{seriesGatewayId:31,title:'Test Series',
  sourceName:'saleh',mediaKind:'series'}]);
 assert.equal(cleanSeriesCandidate({gateway_id:0,title:'bad'}),null);
});
test('mapped season content uses stable gateway IDs and correct season/episode ordering',async()=>{
 const pool={query:async(sql,args)=>{
  assert.match(sql,/i.media_type='series'/);
  assert.match(sql,/lower\(btrim\(s.name\)\)='saleh'/);
  assert.deepEqual(args,[serverId,'source_series_1']);
  return {rows:[
   {gateway_id:41,server_id:serverId,source_id:'episode_41',
    container_extension:'mkv',display_name:'Series E02'},
   {gateway_id:42,server_id:serverId,source_id:'episode_42',
    container_extension:'mp4',display_name:'Series E01'}]}}};
 const mapped=await mappedLicensedSeriesEpisodes(pool,{serverId,
  sourceSeriesId:'source_series_1'});
 const result=buildLicensedSeriesSeasons({seriesGatewayId:31,
  title:'Test Series',candidates:mapped,
  info:{episodes:{'1':[
   {id:'41',episode_num:2,title:'Episode 2'},
   {id:'42',episode_num:1,name:'Episode 1'},
   {id:'9999',episode_num:3,title:'Unmapped'}]}}});
 assert.equal(result.seasons.length,1);
 assert.deepEqual(result.seasons[0].episodes.map(x=>x.gatewayId),[42,41]);
 assert.deepEqual(result.seasons[0].episodes.map(x=>x.episodeNumber),[1,2]);
 assert.equal(result.seasons[0].episodes[1].mediaId,'episode_41');
 assert.equal(result.seasons[0].episodes[0].title,'Episode 1');
 assert.equal(result.sourceMediaRequests,0);
});
test('reject malformed season mapping instead of inventing episode files',()=>{
 assert.throws(()=>buildLicensedSeriesSeasons({seriesGatewayId:'oops',
  info:{episodes:{}},candidates:[]}),/licensed_series_metadata_invalid/);
 const result=buildLicensedSeriesSeasons({seriesGatewayId:12,
  info:{episodes:{'__proto__':[{id:'41'}],'9999':[{id:'41'}]}},
  candidates:[]});
 assert.equal(result.seasons.length,0);
});

test('verified pilot episode resolves only to an enabled licensed series gateway',async()=>{
 const pool={query:async(sql,args)=>{
  assert.match(sql,/e.gateway_id=\$1/);
  assert.match(sql,/lower\(btrim\(s.name\)\)='saleh'/);
  assert.deepEqual(args,[127434]);
  return {rows:[{series_gateway_id:31}]};
 }};
 assert.deepEqual(await findPilotSeriesForEpisode(pool,127434),{
  seriesGatewayId:31,episodeGatewayId:127434});
 assert.equal(await findPilotSeriesForEpisode(pool,-1),null);
});
