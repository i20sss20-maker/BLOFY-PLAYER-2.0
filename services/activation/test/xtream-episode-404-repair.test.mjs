import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifiedEpisodeExtension} from '../src/xtream-episode-repair.mjs';

const info={episodes:{
  '1':[{id:415,episode_num:1,container_extension:'mkv'},
       {id:'416',episode_num:2,container_extension:'MP4'}],
  '2':[{id:'417',episode_num:1,container_extension:'.ts'}]
}};

test('repair only the exact provider episode ID, using its actual extension',()=>{
  assert.deepEqual(verifiedEpisodeExtension(info,'415','mp4'),
    {status:'changed',extension:'mkv'});
  assert.deepEqual(verifiedEpisodeExtension(info,416,'mp4'),
    {status:'unchanged',extension:'mp4'});
  assert.deepEqual(verifiedEpisodeExtension(info,417,'mp4'),
    {status:'changed',extension:'ts'});
});

test('a vanished ID never maps automatically to a different episode',()=>{
  assert.deepEqual(verifiedEpisodeExtension(info,418,'mp4'),{status:'missing'});
  assert.deepEqual(verifiedEpisodeExtension({episodes:{'1':[{
    id:777,episode_num:1,container_extension:'mkv'
  }]}},'415','mp4'),{status:'missing'});
  assert.deepEqual(verifiedEpisodeExtension({episodes:null},'415','mp4'),
    {status:'unavailable'});
});

test('invalid or source-controlled extensions never become filesystem URLs',()=>{
  for(const extension of [
    '../mp4','mp4?token=secret','https://other.host/movie','exe','php','',
    'm3u8/../../secret','mp4\n'
  ])assert.deepEqual(verifiedEpisodeExtension({episodes:{'1':[{
    id:415,container_extension:extension
  }]}},415,'mp4'),{status:'unavailable'},extension);
});

test('episode gateway keeps same provider ID and bound source when repairing 404',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const metrics=await readFile(new URL('../src/xtream-playback-metrics.mjs',import.meta.url),'utf8');
  const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(src,/SELECT e.gateway_id,e.server_id,e.series_source_id,e.source_episode_id/);
  assert.match(src,/verifiedEpisodeExtension\(series,row.source_episode_id/);
  assert.match(src,/get_series_info/);
  assert.match(src,/episodeRepairCooldown/);
  assert.match(src,/now\+90000/);
  assert.match(src,/kind==='series' && response.status===404/);
  assert.match(src,/const repaired=await repairEpisodeOn404\(row\)/);
  assert.match(src,/const fix=await repairEpisodeOn404\(row\)/);
  assert.match(src,/upstream=mediaUpstreamUrl\(row,kind,sourceId,repaired.extension\)/);
  assert.match(src,/AND source_episode_id=\$3 RETURNING gateway_id/);
  assert.doesNotMatch(src,/UPDATE blofy_xtream_gateway_episode_map[\s\S]{0,140}source_episode_id=\$4/);
  assert.match(src,/reason:'episode_missing_from_source'/);
  assert.match(metrics,/episode_missing_from_source/);
  assert.match(ui,/الحلقة لم تعد موجودة/);
});
