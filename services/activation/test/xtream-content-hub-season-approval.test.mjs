import test from 'node:test';
import assert from 'node:assert/strict';
import {findRunningApprovedSeasonEpisode} from '../src/xtream-content-hub-season-approval.mjs';
const gatewayId=127435;
const candidate={
 gateway_id:gatewayId,server_id:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
 source_id:'episode_127435',container_extension:'mkv',
 display_name:'Licensed Series — episode 2'
};
test('source permit requires explicit opt-in and indexed running queue row',async()=>{
 let calls=0;
 const pool={query:async(sql,params)=>{calls++;
  assert.deepEqual(params,[gatewayId]);
  assert.match(sql,/q.state='running'/);
  assert.match(sql,/q.updated_at > NOW\(\) - INTERVAL '3 minutes'/);
  assert.match(sql,/e.gateway_id=q.gateway_id/);
  assert.match(sql,/e.source_episode_id=q.media_id/);
  assert.match(sql,/e.server_id=q.source_id/);
  assert.match(sql,/lower\(btrim\(s.name\)\)='saleh'/);
  assert.match(sql,/i.enabled=TRUE/);
  return {rows:[candidate]}}};
 assert.equal(await findRunningApprovedSeasonEpisode(pool,{
  gatewayId,enabled:false}),null);
 assert.equal(await findRunningApprovedSeasonEpisode(pool,{
  gatewayId:-1,enabled:true}),null);
 assert.equal(calls,0);
 const approved=await findRunningApprovedSeasonEpisode(pool,{
  gatewayId,enabled:true});
 assert.deepEqual(approved,{
  gatewayId,sourceId:candidate.server_id,mediaId:'episode_127435',
  extension:'mkv',title:candidate.display_name,
  sourceName:'saleh',mediaKind:'episode'});
 assert.equal(calls,1);
});
test('no queued episode, invalid result, or PG outage fails closed',async()=>{
 const none={query:async()=>({rows:[]})};
 assert.equal(await findRunningApprovedSeasonEpisode(none,{
  gatewayId,enabled:true}),null);
 const corrupt={query:async()=>({rows:[{...candidate,
  source_id:'http://bad.example/?password=1'}]})};
 assert.equal(await findRunningApprovedSeasonEpisode(corrupt,{
  gatewayId,enabled:true}),null);
 const broken={query:async()=>{throw Error('database_down')}};
 assert.equal(await findRunningApprovedSeasonEpisode(broken,{
  gatewayId,enabled:true}),null);
});
