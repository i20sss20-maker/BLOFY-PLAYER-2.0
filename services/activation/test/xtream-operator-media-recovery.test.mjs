import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {operatorMediaRegistryOutcome}
 from '../src/xtream-operator-media-recovery.mjs';

test('only real provider 404 and authenticated relay provider-not-found are recorded missing',()=>{
 assert.equal(operatorMediaRegistryOutcome({ok:false,httpStatus:404}), 'missing');
 assert.equal(operatorMediaRegistryOutcome({
  ok:false,httpStatus:502,error:'relay_provider_not_found'
 }), 'missing');
 for(const probe of [
  {ok:false,httpStatus:502,error:'relay_transport_connection_reset'},
  {ok:false,httpStatus:502,error:'relay_first_byte_timeout'},
  {ok:false,httpStatus:503,error:'relay_provider_not_found'},
  {ok:false,httpStatus:200,error:'empty_media'},
  {ok:false,httpStatus:403,error:'unauthorized'},
  {ok:false,httpStatus:416,error:'invalid_range'},
  {ok:true,httpStatus:502,error:'upstream_unknown'},
  {},null
 ])assert.equal(operatorMediaRegistryOutcome(probe),null);
});
test('restored state requires actual validated media bytes, not status 200 alone',()=>{
 for(const status of [200,206])
  assert.equal(operatorMediaRegistryOutcome({ok:true,httpStatus:status}),'recovered');
 assert.equal(operatorMediaRegistryOutcome({ok:false,httpStatus:200} ),null);
 assert.equal(operatorMediaRegistryOutcome({ok:false,httpStatus:206,error:'empty_media'}),null);
});
test('admin source probe writes only exact source IDs after source allowlisting and no account changes',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const first=code.indexOf('async function recordOperatorVodAvailability(');
 const end=code.indexOf('async function probeXtreamEpisodeMedia(',first);
 assert.ok(first>0&&end>first);
 const part=code.slice(first,end);
 assert.match(part,/if\(!source\?\.enabled\|\|!source\.publish_catalog\|\|/);
 assert.match(part,/!recoverySources\(\)\.has\(String\(source\.id\|\|''\)\.toLowerCase\(\)\)/);
 assert.match(part,/validUnavailableKey\(\{serverId:source\.id,kind,itemId,seriesId\}\)/);
 assert.match(part,/operatorMediaRegistryOutcome\(probe\)/);
 assert.match(part,/if\(outcome==='missing'\)await registerProvider404\(pool,key\)/);
 assert.match(part,/else if\(outcome==='recovered'\)await noteMediaRestored\(pool,key\)/);
 assert.doesNotMatch(part,/console\.warn\([^;]*itemId|console\.warn\([^;]*seriesId|sourceUrl|password_secret|UPDATE blofy_xtream_gateway_accounts/);
});
test('the original admin output remains redacted, while operator checks become recoverable',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 assert.match(code,/await ensureUnavailableMediaTable\(client\)/);
 assert.match(code,/await recordOperatorVodAvailability\(source,'series',String\(episode\.id\),\s*String\(series\.source_id\),playback\)/);
 assert.match(code,/if\(mediaType==='movie'\)\s*await recordOperatorVodAvailability\(source,'movie',String\(item\.source_id\),'',/);
 assert.match(code,/const position=' · '/);
 assert.match(code,/title:cleanText\(series\.name,120\)\+position,mediaType/);
 assert.match(code,/title:cleanText\(item\.name,160\),mediaType,httpStatus,contentType/);
 assert.doesNotMatch(code,/checks\.push\(\{\s*source_id:|checks\.push\(\{\s*episode_id:/);
});
