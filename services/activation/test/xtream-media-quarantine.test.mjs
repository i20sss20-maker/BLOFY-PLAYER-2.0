import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canQuarantineXtreamMedia,MEDIA_QUARANTINE_HOURS,
 quarantineMediaWarning} from '../src/xtream-media-quarantine.mjs';
import {gatewayItemsPageQuery} from '../src/xtream-gateway-query.mjs';
import {summarizeIssuancePreflight} from '../src/xtream-issuance-preflight.mjs';

test('quarantine only if same exact item returns both Xtream and M3U 404',()=>{
  const good={kind:'movie',sourceId:'207458',
    probe:{ok:false,httpStatus:404,m3uRecoveryStatus:'provider_404'}};
  assert.equal(canQuarantineXtreamMedia(good),true);
  assert.equal(canQuarantineXtreamMedia({...good,kind:'series',sourceId:'294466'}),true);
  for(const variant of [
    {...good,probe:{ok:false,httpStatus:404,m3uRecoveryStatus:'id_not_in_m3u'}},
    {...good,probe:{ok:false,httpStatus:404,m3uRecoveryStatus:'provider_denied'}},
    {...good,probe:{ok:false,httpStatus:456,m3uRecoveryStatus:'provider_404'}},
    {...good,probe:{ok:true,httpStatus:404,m3uRecoveryStatus:'provider_404'}},
    {...good,kind:'live'},
    {...good,sourceId:'../other'},
    {...good,sourceId:''}
  ])assert.equal(canQuarantineXtreamMedia(variant),false,JSON.stringify(variant));
  assert.equal(MEDIA_QUARANTINE_HOURS,6);
  assert.deepEqual(quarantineMediaWarning('series','294466',{seriesId:'10007'}),{
    reason:'confirmed_source_media_404',kind:'series',
    episodeSourceId:'294466',seriesSourceId:'10007'
  });
});

test('only movies are removed from original catalog page; series and live remain',()=>{
  const movie=gatewayItemsPageQuery('movie',0,{sourceId:'11111111-1111-4111-8111-111111111111'});
  const series=gatewayItemsPageQuery('series',0);
  const live=gatewayItemsPageQuery('live',0);
  assert.match(movie.text,/NOT EXISTS \(SELECT 1 FROM blofy_xtream_media_quarantine/);
  assert.match(movie.text,/q\.source_id=i\.source_id AND q\.expires_at>NOW\(\)/);
  assert.doesNotMatch(series.text,/blofy_xtream_media_quarantine/);
  assert.doesNotMatch(live.text,/blofy_xtream_media_quarantine/);
  assert.equal(movie.values[0],'movie');
});

async function executeRealPreflight({provenM3u404=true,hasReplacement=true}={}){
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function quarantineConfirmedMissingMedia(');
  const end=source.indexOf('async function runIssuancePreflight(',start);
  assert.ok(start>0&&end>start);
  const events=[];
  const pool={query:async(sql,args)=>{
    if(sql.includes('INSERT INTO blofy_xtream_media_quarantine')){
      events.push({type:'quarantined',kind:args[1],id:args[2]});
      assert.equal(args[1],'movie');
      assert.equal(args[2],'207458');
      return {rowCount:1};
    }
    if(sql.includes("media_type='movie'")&&sql.includes('LIMIT 12'))
      return {rows:hasReplacement?[{source_id:'900001',container_extension:'mp4'}]:[]};
    if(sql.includes('ORDER BY source_id DESC')){
      return {rows:[{source_id:args[1]==='movie'?'900000':
        args[1]==='live'?'902':'903',container_extension:'mp4'}]};
    }
    return {rows:[{source_id:args[1]==='movie'?'207458':
      args[1]==='live'?'101':'303',container_extension:'mp4'}]};
  }};
  const fn=new Function('pool','canQuarantineXtreamMedia','MEDIA_QUARANTINE_REASON',
    'MEDIA_QUARANTINE_HOURS','quarantineMediaWarning',
    'fetchUpstreamApi','sanitizeXtreamAccount','safeGatewayExtension',
    'diagnosticXtreamItemId','probeIssuanceWithTransientRetry',
    'xtreamEpisodePlaybackCandidates','issuanceErrorReason',
    source.slice(start,end)+';return preflightSource;')(
      pool,canQuarantineXtreamMedia,'confirmed_source_media_404',
      MEDIA_QUARANTINE_HOURS,quarantineMediaWarning,
      async(row,action,params)=>{
        if(action===null)return {user_info:{auth:1}};
        if(action==='get_series_info')return {episodes:{'1':[{id:'episode-'+params.series_id,
          container_extension:'mp4'}]}};
        throw Error('invalid action');
      },v=>({authenticated:v?.user_info?.auth===1}), (v,f)=>v||f,
      id=>String(id),
      async(row,kind,id)=>{
        events.push({type:'tested',kind,id});
        if(kind==='movie'&&id==='207458')return {kind,ok:false,httpStatus:404,
          reason:'upstream_http_404',m3uRecoveryStatus:
          provenM3u404?'provider_404':'id_not_in_m3u'};
        return {kind,ok:true,format:'mp4'};
      },v=>v.episodes['1'].map(x=>({id:x.id,extension:x.container_extension})),
      ()=> 'source_unreachable'
    );
  const report=await fn({id:'11111111-1111-4111-8111-111111111111',
    server_id:'11111111-1111-4111-8111-111111111111',name:'Fixture'},
    Date.now()+24000);
  return {report,events};
}

test('actual preflight quarantines confirmed file and tests independent good replacement movie before ready',async()=>{
  const {report,events}=await executeRealPreflight();
  assert.deepEqual(events.filter(x=>x.type==='quarantined').map(x=>x.id),['207458']);
  assert.ok(events.some(x=>x.kind==='movie'&&x.id==='900001'));
  assert.equal(report.warnings[0].reason,'confirmed_source_media_404');
  assert.equal(report.warnings[0].itemSourceId,'207458');
  assert.equal(report.checks.filter(x=>x.kind==='movie').length,2);
  assert.equal(summarizeIssuancePreflight([report]).ready,true);
});

test('if no alternate movie works, issuance still blocks',async()=>{
  const {report}=await executeRealPreflight({hasReplacement:false});
  assert.equal(report.checks.find(x=>x.reason==='media_sample_unavailable')?.ok,false);
  assert.equal(summarizeIssuancePreflight([report]).ready,false);
});

test('source 404 without the SAME M3U item returning 404 is never auto-hidden',async()=>{
  const {report,events}=await executeRealPreflight({provenM3u404:false});
  assert.equal(events.filter(x=>x.type==='quarantined').length,0);
  assert.ok(report.checks.some(x=>x.kind==='movie'&&x.ok===false));
  assert.equal(summarizeIssuancePreflight([report]).ready,false);
});

test('gateway prevents quarantined movie/episode playback and filters only exact episode IDs',async()=>{
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  assert.match(source,/CREATE TABLE IF NOT EXISTS blofy_xtream_media_quarantine/);
  assert.match(source,/expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(source,/q\.source_id=COALESCE\(e\.resolved_source_episode_id,e\.source_episode_id\)/);
  assert.match(source,/AND \(\$2 <> 'movie' OR NOT EXISTS/);
  assert.match(source,/hiddenEpisodeIds\.has\(String\(episode\?\.id\)\)/);
  assert.match(source,/ON CONFLICT\(server_id,media_type,source_id\) DO UPDATE/);
});
