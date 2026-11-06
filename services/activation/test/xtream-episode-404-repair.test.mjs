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
    'm3u8/../../secret'
  ])assert.deepEqual(verifiedEpisodeExtension({episodes:{'1':[{
    id:415,container_extension:extension
  }]}},415,'mp4'),{status:'unavailable'},extension);
});

test('episode gateway keeps same provider ID and bound source when repairing 404',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const metrics=await readFile(new URL('../src/xtream-playback-metrics.mjs',import.meta.url),'utf8');
  const ui=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(src,/SELECT e.gateway_id,e.server_id,e.series_source_id,e.source_episode_id/);
  assert.match(src,/verifiedEpisodeRecovery\(series,currentId/);
  assert.match(src,/get_series_info/);
  assert.match(src,/episodeRepairCooldown/);
  assert.match(src,/now\+90000/);
  assert.match(src,/kind==='series' && response.status===404/);
  assert.match(src,/const repaired=await repairEpisodeOn404\(row\)/);
  assert.match(src,/const fix=await repairEpisodeOn404\(row\)/);
  assert.match(src,/upstream=repaired.url\|\|mediaUpstreamUrl\(row,kind,sourceId,repaired.extension\)/);
  assert.match(src,/AND source_episode_id=\$3\s+RETURNING gateway_id/);
  assert.doesNotMatch(src,/UPDATE blofy_xtream_gateway_episode_map[\s\S]{0,140}source_episode_id=\$4/);
  assert.match(src,/reason:'episode_missing_from_source'/);
  assert.match(src,/reason:'episode_position_unknown'/);
  assert.match(src,/reason:'episode_media_404_at_source'/);
  assert.match(src,/status:'catalog_media_mismatch'/);
  assert.match(src,/status:'position_unknown'/);
  assert.match(src,/metadata_upstream_/);
  assert.match(src,/xtream episode 404 diagnosis/);
  assert.match(metrics,/episode_missing_from_source/);
  assert.match(ui,/الحلقة لم تعد موجودة/);
});

test('repair recovers a changed episode ID only for an exact unique known season and episode',async()=>{
  const {episodeOrdinal,verifiedEpisodeRecovery}=await import('../src/xtream-episode-repair.mjs');
  assert.equal(episodeOrdinal('001'), '1');
  assert.equal(episodeOrdinal('0',{allowZero:true}), '0');
  assert.equal(episodeOrdinal('1.5'),null);
  const relocated=verifiedEpisodeRecovery(info,'old-415','mp4','01','1');
  assert.deepEqual(relocated,{status:'relocated',sourceId:'415',extension:'mkv'});
  assert.deepEqual(verifiedEpisodeRecovery(info,'415','mp4','1','1'),
    {status:'changed',extension:'mkv'});
  assert.deepEqual(verifiedEpisodeRecovery(info,'old-415','mp4',null,'1'),
    {status:'missing'});
  assert.deepEqual(verifiedEpisodeRecovery(info,'old-415','mp4','3','1'),
    {status:'missing'});
  assert.deepEqual(verifiedEpisodeRecovery(info,'old-415','mp4','1','2'),
    {status:'relocated',sourceId:'416',extension:'mp4'});
  const ambiguous={episodes:{'1':[
    {id:'777',episode_num:1,container_extension:'mp4'},
    {id:'778',episode_num:1,container_extension:'mkv'}]}};
  assert.deepEqual(verifiedEpisodeRecovery(ambiguous,'old','mp4',1,1),
    {status:'missing'});
  assert.deepEqual(verifiedEpisodeRecovery({episodes:{'1':[
    {id:'../outside',episode_num:1,container_extension:'mp4'}]}},'old','mp4',1,1),
    {status:'missing'});
  assert.deepEqual(verifiedEpisodeRecovery({episodes:{'1':[
    {id:'777',episode_num:1,container_extension:'../mp4'}]}},'old','mp4',1,1),
    {status:'missing'});
});

test('media ID relocation is only committed after real source media verification',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  assert.match(src,/ADD COLUMN IF NOT EXISTS season_number TEXT/);
  assert.match(src,/ADD COLUMN IF NOT EXISTS episode_number TEXT/);
  assert.match(src,/ADD COLUMN IF NOT EXISTS resolved_source_episode_id TEXT/);
  assert.match(src,/const seasonNumber=episodeOrdinal\(seasonLabel,\{allowZero:true\}\)/);
  assert.match(src,/episodeNumber:episodeOrdinal\(episode.episode_num\)/);
  assert.match(src,/decision.status==='relocated' &&\s*!await confirmEpisodeReplacement/);
  assert.match(src,/const inspection=inspectXtreamMediaChunk\(Buffer.concat\(parts,total\),response.headers.get\('content-type'\)\)/);
  assert.match(src,/return inspection.valid && inspection.format!=='unknown'/);
  assert.match(src,/resolved_source_episode_id=COALESCE\(\$5::text,resolved_source_episode_id\)/);
  assert.match(src,/ADD COLUMN IF NOT EXISTS verified_container_extension TEXT/);
  assert.match(src,/COALESCE\(e.verified_container_extension,e.container_extension\) AS container_extension/);
  assert.match(src,/COALESCE\(verified_container_extension,container_extension\) AS container_extension/);
  assert.match(src,/verified_container_extension=CASE/);
  assert.match(src,/WHEN blofy_xtream_gateway_episode_map.container_extension IS DISTINCT FROM EXCLUDED.container_extension/);
  assert.match(src,/SET verified_container_extension=\$4/);
  assert.match(src,/sameEpisodeContainerCandidates\(currentExtension\)/);
  assert.match(src,/\['changed','relocated','alternate_extension'\].includes\(repaired.status\)/);
  assert.match(src,/\['changed','relocated','alternate_extension'\].includes\(fix.status\)/);
  assert.match(src,/sourceId = row.resolved_source_episode_id \|\| row.source_episode_id/);
  assert.match(src,/sourceId=repaired.sourceId\|\|sourceId/);
  assert.match(src,/sourceId=fix.sourceId\|\|sourceId/);
});

test('alternative extension recovery tries only existing episode ID and common containers',async()=>{
  const {sameEpisodeContainerCandidates}=await import('../src/xtream-episode-repair.mjs');
  assert.deepEqual(sameEpisodeContainerCandidates('mp4'),['mkv','ts']);
  assert.deepEqual(sameEpisodeContainerCandidates('mkv'),['mp4','ts']);
  assert.deepEqual(sameEpisodeContainerCandidates('.TS'),['mp4','mkv']);
  for(const unsafe of [
    '../mkv','mp4?user=attacker','hls','m3u8','',null,'https://example.com/video.mkv'
  ])assert.deepEqual(sameEpisodeContainerCandidates(unsafe),[],String(unsafe));
});

test('provider-rejected media does not trigger guessing or authorization bypass',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const playback=src.slice(src.indexOf('async function proxyMedia('),src.indexOf('async function probeGatewayMedia('));
  const fallback=src.slice(src.indexOf('async function repairEpisodeOn404('),src.indexOf('function mediaUpstreamUrl('));
  assert.match(playback,/kind==='series' && response.status===404/);
  assert.match(playback,/mediaDenialCooldown.denied\(cooldownKey,response.status\)/);
  assert.match(fallback,/if\(decision.status==='unchanged'\)/);
  assert.match(fallback,/confirmEpisodeReplacement\(row,currentId,candidate\)/);
  assert.match(fallback,/source_episode_id=\$3/);
  assert.doesNotMatch(fallback,/encodeURIComponent\(creds.password\)/);
  assert.doesNotMatch(fallback,/new URL\(.*candidate/);
});
