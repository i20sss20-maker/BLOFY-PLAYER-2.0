import test from 'node:test';
import assert from 'node:assert/strict';
import {findActiveMirrorEpisode}
 from '../src/xtream-mirror-episode-bridge.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const row={source_id:ID,media_id:'ep_42',gateway_id:42,
 series_media_id:'series_11',extension:'mkv',expected_bytes:'16777216',
 copy_run_id:'mirror_'+'a'.repeat(40)};

test('one specific leased episode has active rights, exact series identity, and size',async()=>{
 const sql=[];
 const item=await findActiveMirrorEpisode({
  query:async(q,params)=>{sql.push({q,params});return {rows:[row]}}
 },{gatewayId:42,sourceId:ID});
 assert.equal(item.gatewayId,42);
 assert.equal(item.mediaId,'ep_42');
 assert.equal(item.seriesMediaId,'series_11');
 assert.equal(item.sourceId,ID);
 assert.equal(item.expectedBytes,16777216);
 assert.equal(sql.length,1);
 assert.deepEqual(sql[0].params,[42,ID]);
 for(const needle of [
  "q.media_kind='episode'","q.state='copying'",
  "q.copy_lease_until>NOW()","q.mapping_conflict=FALSE","q.source_id=$2::uuid",
  "e.source_episode_id=q.media_id","s.last_sync_at>NOW()",
  "q.rights_ref_sha256", "q.expected_bytes BETWEEN"
 ])assert.ok(sql[0].q.includes(needle),needle);
});
test('invalid ID, no approved lease or impossible source size fails closed',async()=>{
 assert.equal(await findActiveMirrorEpisode({query:async()=>{throw Error('bad')}},
  {gatewayId:0}),null);
 assert.equal(await findActiveMirrorEpisode({query:async()=>({rows:[]})},
  {gatewayId:42,sourceId:ID}),null);
 assert.equal(await findActiveMirrorEpisode({query:async()=>({
  rows:[{...row,expected_bytes:'99999999999'}]})},
  {gatewayId:42,sourceId:ID}),null);
});

test('private episode bridge requires the ORIGINAL attested series source',async()=>{
 const sql=[];
 await findActiveMirrorEpisode({query:async q=>{sql.push(q);
  return {rows:[row]}}},{gatewayId:42,sourceId:ID});
 assert.equal(sql.length,1);
 assert.match(sql[0],/e.series_source_id=q.series_media_id/);
});

test('private mirror bridge refuses a missing, invalid or unpinned source before querying',async()=>{
 let reads=0;
 const db={query:async()=>{reads++;return {rows:[row]}}};
 assert.equal(await findActiveMirrorEpisode(
  db,{gatewayId:42}),null);
 assert.equal(await findActiveMirrorEpisode(
  db,{gatewayId:42,sourceId:'wrong-source'}),null);
 assert.equal(reads,0);
});

test('missing leased episode parent cannot produce private source authorization',async()=>{
 const db={query:async()=>({rows:[{...row,series_media_id:null}]})};
 assert.equal(await findActiveMirrorEpisode(db,{
  gatewayId:42,sourceId:ID}),null);
});
