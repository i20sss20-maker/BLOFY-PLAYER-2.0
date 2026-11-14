import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildUnifiedOpsOverview} from '../src/content-hub-overview.mjs';

const health={ok:true,privateBucketAvailable:true,databaseAvailable:true,
 pilotRunning:false,episodeCopyBusy:false,secretToken:'should_not_appear'};
const movie={ok:true,accounting:{verifiedCount:2,verifiedBytes:1000,
 activeCount:1,failedCount:0,stagedChunkBytes:200},
 runs:[{username:'upstream-secret',password:'do-not-expose'}]};
const analytics={ok:true,totals:{episodeCount:12,seasonCount:3,
 verifiedCount:8,failedCount:1,queuedCount:2,pausedCount:1,
 runningCount:0,storedBytes:4300,verifiedBytes:2500,expectedBytes:12000,
 transferBytesMeasured:900,transferSamples:2,averageBytesPerSecond:1000},
 worker:{active:false,state:'paused',currentRunId:null},
 seasonSummaries:[
  {seasonKey:'series_11_s1',episodeCount:5,verifiedCount:5,
   failedCount:0,storedBytes:1900,expectedBytes:5000,percent:38},
  {seasonKey:'series_11_s2',episodeCount:4,verifiedCount:2,
   failedCount:1,storedBytes:1500,expectedBytes:4000,percent:37},
  {seasonKey:'series_22_s1',episodeCount:3,verifiedCount:1,
   failedCount:0,storedBytes:900,expectedBytes:3000,percent:30}
 ],seasonSummariesLimited:false,privateSource:'https://secret.example/?password=oops'};
const attention={ok:true,counts:{critical:1,warning:1,notice:0,info:0},
 items:[{runId:'season_0123456789abcdef01234567',
  seasonKey:'series_11_s2',episodeNumber:3,severity:'critical',
  type:'needs_manual_integrity_or_rights_review',
  code:'episode_private_sha256_mismatch',retryEligible:false,
  updatedAt:'2026-11-14T09:00:00Z',sourceUrl:'https://secret.example',
  password:'hidden'}]};
test('unified dashboard preserves exact independent movie/episode accounting',()=>{
 const out=buildUnifiedOpsOverview({status:health,pilots:movie,
  analytics,attention,checkedAt:'2026-11-14T09:20:00Z'});
 assert.equal(out.ok,true);
 assert.equal(out.readOnly,true);
 assert.equal(out.partial,false);
 assert.equal(out.providerMediaRequests,0);
 assert.equal(out.automaticDownload,false);
 assert.equal(out.automaticRetry,false);
 assert.equal(out.movies.verifiedCount,2);
 assert.equal(out.movies.verifiedBytes,1000);
 assert.equal(out.seasons.episodeCount,12);
 assert.equal(out.seasons.seasonCount,3);
 assert.equal(out.seasons.seriesCount,2);
 assert.equal(out.seasons.verifiedCount,8);
 assert.equal(out.seasons.seriesCountPartial,false);
 assert.equal(out.storage.recordedMovieVerifiedBytes,1000);
 assert.equal(out.storage.recordedEpisodeBytes,4300);
 assert.equal(out.storage.combinedKnownBytes,5300);
 assert.equal(out.storage.completeBucketUsage,false);
 assert.equal(out.storage.bucketCapacityBytes,null);
 assert.equal(out.storage.bucketFreeBytes,null);
 assert.equal(out.attention.items[0].retryEligible,false);
 assert.ok(out.incidents.some(x=>x.code==='critical_episode_attention'));
 assert.ok(out.incidents.some(x=>x.code==='season_failed_episodes'));
 const json=JSON.stringify(out);
 for(const value of ['do-not-expose','upstream-secret',
  'https://secret.example','should_not_appear','hidden']){
  assert.equal(json.includes(value),false,value);
 }
});
test('partial API responses are visibly unavailable rather than fake zero',()=>{
 const out=buildUnifiedOpsOverview({status:health,analytics});
 assert.equal(out.ok,true);
 assert.equal(out.partial,true);
 assert.deepEqual(out.unavailableSources,['movies','alerts']);
 assert.equal(out.movies.verifiedCount,null);
 assert.equal(out.storage.combinedKnownBytes,null);
 assert.equal(out.storage.combinedKnownBytesAvailable,false);
 assert.equal(out.attention.counts,null);
 assert.equal(out.seasons.seriesCount,2);
 assert.ok(out.incidents.some(x=>x.code==='some_sources_unavailable'));
 const none=buildUnifiedOpsOverview();
 assert.equal(none.ok,false);
 assert.equal(none.storage.combinedKnownBytes,null);
 assert.equal(none.health.privateBucketAvailable,null);
 assert.equal(none.seasons.failedCount,null);
});
test('series count is tagged partial for truncated season lists',()=>{
 const x=buildUnifiedOpsOverview({analytics:{...analytics,
  seasonSummaries:analytics.seasonSummaries.slice(0,2),
  seasonSummariesLimited:true}});
 assert.equal(x.seasons.seriesCount,1);
 assert.equal(x.seasons.seriesCountPartial,true);
 assert.equal(x.seasons.seasonCount,3);
 assert.equal(x.seasons.seasonSummaries.length,2);
});
test('malicious or malformed upstream rows never become HTML or links',()=>{
 const out=buildUnifiedOpsOverview({status:health,pilots:movie,
  analytics:{...analytics,seasonSummaries:[
   {seasonKey:'../foo<script>',episodeCount:1},
   {seasonKey:'series_11_s1',episodeCount:1,verifiedCount:1}
  ]},
  attention:{...attention,items:[
   {...attention.items[0],seasonKey:'../bad'},
   attention.items[0]
  ]}});
 assert.equal(out.seasons.seasonSummaries.length,1);
 assert.equal(out.attention.items.length,1);
 assert.equal(JSON.stringify(out).includes('<script>'),false);
});
test('owner-only summary UI is a single direct read-only API with navigation',async()=>{
 const page=await readFile(new URL('../web/admin-content-hub.html',import.meta.url),'utf8');
 const js=await readFile(new URL('../web/admin-ops-overview.js',import.meta.url),'utf8');
 const hook=await readFile(new URL('../src/content-hub-admin-hook.mjs',import.meta.url),'utf8');
 const css=await readFile(new URL('../web/admin-content-hub.css',import.meta.url),'utf8');
 for(const id of ['opsOverview','opsMoviesVerified','opsEpisodesVerified',
  'opsSeasonsCount','opsSeriesCount','opsFailedEpisodes','opsKnownStorage',
  'opsStorageBreakdown','opsSeasons','opsTopAlerts','opsRefresh','opsStatus']){
  assert.equal((page.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
  if(id!=='opsOverview')assert.ok(js.includes(id),id);
 }
 assert.match(page,/admin-ops-overview\.js/);
 assert.match(page,/href="#attentionTitle"/);
 assert.match(page,/href="#runs"/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/document\.hidden/);
 assert.match(js,/60000/);
 assert.doesNotMatch(js,/method:'POST'/);
 assert.doesNotMatch(js,/\/internal\//);
 assert.match(hook,/buildUnifiedOpsOverview/);
 assert.match(hook,/if\(!authorized\(req,res\)\)return/);
 assert.match(hook,/\/api\/v1\/admin\/content-hub\/overview/);
 assert.match(css,/\.ops-overview/);
 assert.match(css,/max-width:480px/);
});
