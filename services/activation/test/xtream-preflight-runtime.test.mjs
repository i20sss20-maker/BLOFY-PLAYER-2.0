import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the actual production preflightSource implementation with safe fake
// upstream responses and an isolated in-memory SQL adapter. This catches
// runtime ReferenceErrors that syntax checks and regex-based tests missed.
async function buildPreflight({movieSucceeds=true,seriesSucceeds=true,twoBands=false,emptyLast=false,noReplacement=false}={}){
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=src.indexOf('async function preflightSource(');
  const end=src.indexOf('async function runIssuancePreflight(',start);
  assert.ok(start>=0&&end>start,'real source preflight exists');
  const body=src.slice(start,end);
  const db={
    query:async(sql,params)=>{
      assert.match(sql,/blofy_xtream_items/);
      if(sql.includes('LIMIT 12')){
        return {rows:noReplacement?[{source_id:'903'}]:[
          {source_id:'903'},{source_id:'805',container_extension:'mp4'}
        ]};
      }
      const newest=sql.includes('ORDER BY source_id DESC')&&twoBands;
      const byKind=newest?{
        live:[{source_id:'901',container_extension:'ts'}],
        movie:[{source_id:'902',container_extension:'mp4'}],
        series:[{source_id:'903',container_extension:'mp4'}]
      }:{
        live:[{source_id:'101',container_extension:'ts'}],
        movie:[{source_id:'202',container_extension:'mp4'}],
        series:[{source_id:'303',container_extension:'mp4'}]
      };
      return {rows:byKind[params[1]]||[]};
    }
  };
  const data={episodes:{'1':[{id:'404',container_extension:'mkv',episode_num:1}]}};
  const latestData={episodes:{'1':[{id:'904',container_extension:'mp4',episode_num:1}]}};
  const substitute={episodes:{'1':[{id:'806',container_extension:'mp4',episode_num:1}]}};
  const mocks={
    pool:db,
    fetchUpstreamApi:async(row,action,params)=>{
      if(action===null)return {user_info:{auth:1}};
      assert.equal(action,'get_series_info');
      if(twoBands&&params.series_id==='903')return emptyLast?{episodes:{}}:latestData;
      if(params.series_id==='805')return substitute;
      assert.equal(params.series_id,'303');
      return data;
    },
    sanitizeXtreamAccount:x=>({authenticated:x.user_info?.auth===1}),
    xtreamEpisodePlaybackCandidates:x=>(x?.episodes?.['1']||[]).map(y=>({id:y.id,extension:y.container_extension})),
    probeIssuanceWithTransientRetry:async(row,kind,id,ext)=>{
      if(kind==='series'){
        const isNewest=twoBands&&row.series_source_id==='903';
        const isReplacement=row.series_source_id==='805';
        assert.equal(row.series_source_id,isReplacement?'805':isNewest?'903':'303');
        assert.equal(row.series_payload,isReplacement?substitute:isNewest?latestData:data);
        assert.equal(id,isReplacement?'806':isNewest?'904':'404');
        assert.equal(ext,isReplacement?'mp4':isNewest?'mp4':'mkv');
      }
      if(kind==='movie')return {kind,ok:movieSucceeds,reason:movieSucceeds?null:'upstream_http_404'};
      if(kind==='series')return {kind,ok:seriesSucceeds,reason:seriesSucceeds?null:'upstream_http_404'};
      return {kind,ok:true};
    },
    safeGatewayExtension:(value,fallback)=>value||fallback,
    diagnosticXtreamItemId:id=>/^[A-Za-z0-9._-]{1,128}$/.test(String(id))?String(id):null,
    quarantineConfirmedMissingMedia:async()=>false,
    issuanceErrorReason:()=> 'source_unreachable'
  };
  const fn=new Function(...Object.keys(mocks),body+';return preflightSource;')(...Object.values(mocks));
  return fn({id:'source-fixture',server_id:'source-fixture',name:'fixture'},
    Date.now()+30_000);
}

test('pre-issuance real series probe executes without ReferenceError after valid source login',async()=>{
  const report=await buildPreflight();
  assert.deepEqual(report.checks.map(x=>x.kind),['account','live','movie','series']);
  assert.ok(report.checks.every(x=>x.ok),JSON.stringify(report.checks));
});

test('source video 404 is returned as a failed media test, never an HTTP 503 or issued user',async()=>{
  const {summarizeIssuancePreflight}=await import('../src/xtream-issuance-preflight.mjs');
  const report=await buildPreflight({movieSucceeds:false,seriesSucceeds:false});
  const summary=summarizeIssuancePreflight([report]);
  assert.equal(summary.ready,false);
  assert.equal(summary.failed,2);
  assert.equal(summary.mediaSampleCount,3);
  assert.equal(report.checks[0].ok,true);
  assert.deepEqual(report.checks.filter(x=>x.ok===false).map(x=>x.kind),
    ['movie','series']);
  const movie=report.checks.find(x=>x.kind==='movie');
  assert.equal(movie.itemSourceId,'202');
  assert.equal(movie.seriesSourceId,undefined);
  const episode=report.checks.find(x=>x.kind==='series');
  assert.equal(episode.seriesSourceId,'303');
  assert.equal(episode.episodeSourceId,'404');
  assert.equal(report.checks.find(x=>x.kind==='live').itemSourceId,undefined);
});

test('404 triage samples both ends of each catalog type and two distinct series',async()=>{
  const report=await buildPreflight({twoBands:true});
  assert.equal(report.checks.length,7);
  for(const kind of ['live','movie','series']){
    const checks=report.checks.filter(check=>check.kind===kind);
    assert.equal(checks.length,2,kind);
    assert.deepEqual(checks.map(check=>check.sampleBand),['low_id','high_id'],kind);
  }
  assert.ok(report.checks.every(check=>check.ok),JSON.stringify(report.checks));
});

test('bad video in both catalog ID bands still blocks issuance',async()=>{
  const {summarizeIssuancePreflight}=await import('../src/xtream-issuance-preflight.mjs');
  const report=await buildPreflight({twoBands:true,movieSucceeds:false,seriesSucceeds:false});
  const summary=summarizeIssuancePreflight([report]);
  assert.equal(summary.ready,false);
  assert.equal(summary.failed,4);
  assert.equal(summary.mediaSampleCount,6);
  assert.deepEqual(report.checks.filter(x=>x.kind==='movie').map(x=>x.itemSourceId),['202','902']);
  assert.deepEqual(report.checks.filter(x=>x.kind==='series').map(x=>x.seriesSourceId),['303','903']);
});


test('a first temporary transport error may recover, but HTTP 404 may never be retried',async()=>{
  const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=source.indexOf('async function probeIssuanceWithTransientRetry(');
  const end=source.indexOf('// The authoritative Xtream API',start);
  assert.ok(start>=0&&end>start);
  const {shouldRetryIssuanceMedia}=await import('../src/xtream-issuance-preflight.mjs');
  let results=[{kind:'live',ok:false,reason:'timeout'},{kind:'live',ok:true}];
  const probe=async()=>results.shift();
  const fn=new Function('probeIssuanceMedia','shouldRetryIssuanceMedia',
    source.slice(start,end)+';return probeIssuanceWithTransientRetry;')(
      probe,shouldRetryIssuanceMedia);
  const result=await fn({},'live','101','ts',Date.now()+20_000);
  assert.equal(result.ok,true);
  assert.equal(result.retried,true);
  assert.equal(result.firstFailureReason,'timeout');
  assert.equal(results.length,0);
  results=[{kind:'movie',ok:false,reason:'upstream_http_404',httpStatus:404}];
  const blocked=await fn({},'movie','202','mp4',Date.now()+20_000);
  assert.equal(blocked.ok,false);
  assert.equal(blocked.httpStatus,404);
  assert.equal(blocked.retried,undefined);
  assert.equal(results.length,0);
});

test('empty series ID is disclosed as warning and replaced with a real checked episode',async()=>{
  const {summarizeIssuancePreflight}=await import('../src/xtream-issuance-preflight.mjs');
  const report=await buildPreflight({twoBands:true,emptyLast:true});
  assert.equal(report.warnings.length,1);
  assert.equal(report.warnings[0].seriesSourceId,'903');
  assert.equal(report.warnings[0].reason,'series_has_no_episodes');
  const series=report.checks.filter(x=>x.kind==='series');
  assert.equal(series.length,2);
  assert.ok(series.every(x=>x.ok));
  assert.equal(series[1].sampleBand,'replacement');
  assert.equal(summarizeIssuancePreflight([report]).ready,true);
});
test('missing all substitute episodes still blocks new user issuance',async()=>{
  const {summarizeIssuancePreflight}=await import('../src/xtream-issuance-preflight.mjs');
  const report=await buildPreflight({twoBands:true,emptyLast:true,noReplacement:true});
  assert.equal(report.warnings.length,1);
  assert.ok(report.checks.some(x=>x.reason==='series_sample_unavailable'&&x.ok===false));
  assert.equal(summarizeIssuancePreflight([report]).ready,false);
});
