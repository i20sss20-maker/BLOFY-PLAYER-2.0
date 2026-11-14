import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanEpisodeCandidate,findLicensedEpisodeCandidates}
 from '../src/xtream-content-hub-episode-candidates.mjs';

const candidate={
 gateway_id:231,server_id:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
 source_id:'episode_23',container_extension:'mkv',
 display_name:'Example Series - S01E02'
};
test('licensed episode candidate query is metadata-only and scoped to saleh',async()=>{
 let count=0;
 const pool={query:async(sql,params)=>{
  count++;assert.match(sql,/lower\(btrim\(s.name\)\)='saleh'/);
  assert.match(sql,/FROM blofy_xtream_gateway_episode_map e/);
  assert.match(sql,/i.media_type='series'/);
  assert.match(sql,/i.source_id=e.series_source_id/);
  assert.match(sql,/s.publish_catalog=TRUE/);
  assert.match(sql,/i.enabled=TRUE/);
  assert.match(sql,/LIMIT \$1/);
  assert.deepEqual(params,[8]);return {rows:[candidate]};
 }};
 const records=await findLicensedEpisodeCandidates(pool);
 assert.equal(count,1);
 assert.deepEqual(records,[{
  gatewayId:231,sourceId:candidate.server_id,
  mediaId:'episode_23',title:candidate.display_name,
  extension:'mkv',mediaKind:'episode',sourceName:'saleh'
 }]);
 assert.equal(JSON.stringify(records).includes('password'),false);
});
test('invalid, malformed or secret-bearing records are never exposed to operator',()=>{
 assert.equal(cleanEpisodeCandidate({...candidate,gateway_id:0}),null);
 assert.equal(cleanEpisodeCandidate({...candidate,source_id:'http://secret@evil.com'}),null);
 assert.equal(cleanEpisodeCandidate({...candidate,container_extension:'exe'}),null);
 assert.equal(cleanEpisodeCandidate({...candidate,display_name:''}),null);
 assert.equal(cleanEpisodeCandidate({...candidate,display_name:'a'.repeat(240)}),null);
 assert.equal(cleanEpisodeCandidate({...candidate,server_id:'bad'}),null);
});
