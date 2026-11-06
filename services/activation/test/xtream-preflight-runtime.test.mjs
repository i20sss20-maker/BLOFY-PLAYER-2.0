import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the actual production preflightSource implementation with safe fake
// upstream responses and an isolated in-memory SQL adapter. This catches
// runtime ReferenceErrors that syntax checks and regex-based tests missed.
async function buildPreflight({movieSucceeds=true,seriesSucceeds=true,twoBands=false}={}){
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=src.indexOf('async function preflightSource(');
  const end=src.indexOf('async function runIssuancePreflight(',start);
  assert.ok(start>=0&&end>start,'real source preflight exists');
  const body=src.slice(start,end);
  const db={
    query:async(sql,params)=>{
      assert.match(sql,/blofy_xtream_items/);
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
  const mocks={
    pool:db,
    fetchUpstreamApi:async(row,action,params)=>{
      if(action===null)return {user_info:{auth:1}};
      assert.equal(action,'get_series_info');
      if(twoBands&&params.series_id==='903')return latestData;
      assert.equal(params.series_id,'303');
      return data;
    },
    sanitizeXtreamAccount:x=>({authenticated:x.user_info?.auth===1}),
    xtreamEpisodePlaybackCandidates:x=>x.episodes['1'].map(y=>({id:y.id,extension:y.container_extension})),
    probeIssuanceMedia:async(row,kind,id,ext)=>{
      if(kind==='series'){
        const isNewest=twoBands&&row.series_source_id==='903';
        assert.equal(row.series_source_id,isNewest?'903':'303');
        assert.equal(row.series_payload,isNewest?latestData:data);
        assert.equal(id,isNewest?'904':'404');
        assert.equal(ext,isNewest?'mp4':'mkv');
      }
      if(kind==='movie')return {kind,ok:movieSucceeds,reason:movieSucceeds?null:'upstream_http_404'};
      if(kind==='series')return {kind,ok:seriesSucceeds,reason:seriesSucceeds?null:'upstream_http_404'};
      return {kind,ok:true};
    },
    safeGatewayExtension:(value,fallback)=>value||fallback,
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
});
