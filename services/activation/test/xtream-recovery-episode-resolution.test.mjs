import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sameSeriesRecoveryEpisode}
 from '../src/xtream-recovery-episode-resolution.mjs';

test('only exact original episode from the original series can be recovered',()=>{
 const payload={episodes:{
  '1':[{id:'7319',container_extension:'mkv',
   direct_source:'https://private.example/secret'},
   {id:'7320',container_extension:'mp4'}],
  '2':[{id:'7455',container_extension:'ts'}]
 }};
 assert.deepEqual(sameSeriesRecoveryEpisode(payload,'7319'),{extension:'mkv'});
 assert.deepEqual(sameSeriesRecoveryEpisode(payload,'7455'),{extension:'ts'});
 assert.equal(sameSeriesRecoveryEpisode(payload,'9999'),null);
 assert.equal(sameSeriesRecoveryEpisode(payload,'731'),null);
 assert.doesNotMatch(JSON.stringify(sameSeriesRecoveryEpisode(payload,'7319')),
   /7319|secret|http|direct_source/);
});
test('malformed and malicious episode IDs are ignored, no fallback to similar numbers',()=>{
 for(const payload of [null,{},[],{episodes:null},{episodes:{}},{episodes:'invalid'}])
  assert.equal(sameSeriesRecoveryEpisode(payload,'1'),null);
 for(const id of [null,'','../7319','7319/other','7319?','7319.avi',
    ' '.repeat(3),'<script>',0])
  assert.equal(sameSeriesRecoveryEpisode({episodes:{'1':[{id:'7319'}]}},id),null);
 assert.deepEqual(sameSeriesRecoveryEpisode({
  episodes:{'1':[{id:'7319',container_extension:'exe'}]}},'7319'),
  {extension:'mp4'});
});
test('worker first checks account-created map, then validates original series if absent',async()=>{
 const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function recoverOriginalUnmappedEpisode(');
 const end=source.indexOf('async function runDueUnavailableMedia(',start);
 assert.ok(start>0&&end>start);
 const scope=source.slice(start,end);
 assert.match(scope,/if\(key\.kind!=='series'\)return null/);
 assert.match(scope,/JOIN blofy_xtream_items i ON i.server_id=s.id/);
 assert.match(scope,/i.media_type='series' AND i.source_id=\$2 AND i.enabled=TRUE/);
 assert.match(scope,/s.id=\$1 AND s.enabled=TRUE AND s.publish_catalog=TRUE/);
 assert.match(scope,/get_series_info',\{series_id:key.seriesId\}/);
 assert.match(scope,/shouldUseIndependentXtreamSource\(key.serverId\)/);
 assert.match(scope,/fetchIndependentXtreamSource\(url.href,\{timeoutMs:6500\}\)/);
 assert.match(scope,/readXtreamGatewayJsonResponse\(response,\{maxBytes:1500000\}\)/);
 assert.match(scope,/sameSeriesRecoveryEpisode\(json,key.itemId\)/);
 assert.match(scope,/if\(!row&&key.kind==='series'\)\s*row=await recoverOriginalUnmappedEpisode\(key\)/);
 assert.match(scope,/const original=mediaUpstreamUrl\(row,key.kind,key.itemId,ext\)/);
 assert.doesNotMatch(scope,/ensureEpisodeMaps\(|INSERT INTO blofy_xtream_gateway_episode_map|UPDATE blofy_xtream_items|direct_source|sourceUrl:.*direct_source/);
});
test('recovery remains exact same source with no entitlement changes or full media download',async()=>{
 const source=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const a=source.indexOf('async function recoverOriginalUnmappedEpisode(');
 const b=source.indexOf('async function runDueUnavailableMedia(',a);
 const scope=source.slice(a,b);
 assert.match(scope,/shouldUseIndependentSourceMedia\(\{/);
 assert.match(scope,/sourceId:key.serverId,kind:key.kind,extension:ext/);
 assert.match(scope,/issueStreamRelayGrant\(\{sourceUrl:original.href,kind:key.kind\}\)/);
 assert.match(scope,/range:'bytes=0-1023'/);
 assert.match(scope,/inspectXtreamMediaChunk\(first.value,response.headers.get\('content-type'\)\)\.valid/);
 assert.doesNotMatch(scope,/proxyMedia\(req|gatewayAccount|grantEntitlement|subscriberCutover:true/);
});
