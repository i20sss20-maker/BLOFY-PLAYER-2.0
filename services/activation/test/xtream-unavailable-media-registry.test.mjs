import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 validUnavailableKey,recoverySources,recoveryEnabled,nextRecheckHours,
 createRegistryWriteGuard,ensureUnavailableMediaTable,registerProvider404,
 noteMediaRestored,claimDueMedia,finishUnavailableRecheck,unavailableMediaSummary
} from '../src/xtream-unavailable-media-registry.mjs';
import {classifyUnavailableProbe,runUnavailableRecheckBatch}
 from '../src/xtream-unavailable-media-recheck.mjs';

const server='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const key={serverId:server,kind:'movie',itemId:'1234',seriesId:''};
const ep={serverId:server,kind:'series',itemId:'445',seriesId:'8'};
const fake=(rows=[])=>{
 const calls=[];
 return {calls,async query(sql,args=[]){calls.push({sql,args});return {rows,rowCount:1}}};
};
test('only configured, explicit source can record verified VOD failures',()=>{
 assert.equal(recoverySources({BLOFY_XTREAM_UNAVAILABLE_TRACKING_ENABLED:'0',
  BLOFY_XTREAM_UNAVAILABLE_SOURCE_IDS:server}).size,0);
 const env={BLOFY_XTREAM_UNAVAILABLE_TRACKING_ENABLED:'1',
  BLOFY_XTREAM_UNAVAILABLE_RECHECK_ENABLED:'1',
  BLOFY_XTREAM_UNAVAILABLE_SOURCE_IDS:server+',unauthorized'};
 assert.deepEqual([...recoverySources(env)],[server]);
 assert.equal(recoveryEnabled(env),true);
 assert.equal(recoveryEnabled({...env,BLOFY_XTREAM_UNAVAILABLE_RECHECK_ENABLED:'0'}),false);
 assert.deepEqual(validUnavailableKey(ep),ep);
 assert.deepEqual(validUnavailableKey(key),key);
 for(const candidate of [
  {...key,kind:'live'},{...key,serverId:'not-uuid'},
  {...key,itemId:'../../secret'},{...key,itemId:'p/q'},
  {...key,kind:'series',seriesId:''},
  {...key,seriesId:'something'}
 ]) assert.equal(validUnavailableKey(candidate),null);
});
test('same item cooldown is bounded without secrets in result',()=>{
 const allow=createRegistryWriteGuard({cooldownMs:900000,max:2});
 assert.equal(allow('a',1000),true);
 assert.equal(allow('a',1001),false);
 assert.equal(allow('a',901001),true);
 assert.equal(allow('b',1000),true);
 assert.equal(allow('c',1000),true);
 assert.equal(allow('b',1001),false); // b was not evicted, expired a was.
});
test('persisted schema has source-bound composite key and due-index but no customer fields',async()=>{
 const p=fake();await ensureUnavailableMediaTable(p);
 const sql=p.calls.map(x=>x.sql).join('\n');
 assert.match(sql,/REFERENCES blofy_xtream_servers\(id\) ON DELETE CASCADE/);
 assert.match(sql,/PRIMARY KEY\(server_id,kind,item_id,series_id\)/);
 assert.match(sql,/next_check_at TIMESTAMPTZ/);
 assert.match(sql,/WHERE state='missing'/);
 assert.doesNotMatch(sql,/password|username|device_id|customer_id/);
});
test('verified 404 writes parametrized row, throttles duplicates; restored item needs first bytes',async()=>{
 const p=fake();
 assert.equal(await registerProvider404(p,key),true);
 assert.equal(p.calls.length,1);
 assert.deepEqual(p.calls[0].args,[server,'movie','1234','']);
 assert.match(p.calls[0].sql,/ON CONFLICT\(server_id,kind,item_id,series_id\)/);
 assert.match(p.calls[0].sql,/last_missing_at < NOW\(\)-INTERVAL '15 minutes'/);
 assert.equal(await noteMediaRestored(p,key),true);
 assert.match(p.calls[1].sql,/WHERE server_id=\$1 AND kind=\$2/);
 assert.match(p.calls[1].sql,/AND state='missing'/);
 assert.equal(await registerProvider404(p,{...key,itemId:'../bad'}),false);
 assert.equal(p.calls.length,2);
});
test('transactionally claim at most three due rows and retry only on documented outcomes',async()=>{
 const p=fake([{server_id:server,kind:'series',item_id:'445',
   series_id:'8',recheck_count:0}]);
 assert.equal((await claimDueMedia(p,server,{limit:3})).length,1);
 assert.match(p.calls[0].sql,/FOR UPDATE SKIP LOCKED/);
 assert.match(p.calls[0].sql,/SET next_check_at=NOW\(\)\+INTERVAL '30 minutes'/);
 assert.deepEqual(p.calls[0].args,[server,3]);
 assert.deepEqual(await claimDueMedia(p,server,{limit:500}),[]);
 assert.equal(await finishUnavailableRecheck(p,ep,{result:'provider404',rechecks:0}),true);
 assert.deepEqual(p.calls[1].args,[server,'series','445','8',12,true]);
 assert.equal(await finishUnavailableRecheck(p,ep,{result:'transient',rechecks:0}),true);
 assert.deepEqual(p.calls[2].args,[server,'series','445','8',1,false]);
 assert.deepEqual([0,1,2,3,99].map(nextRecheckHours),[6,12,24,48,48]);
});
test('recheck only restores verified media and never classifies network resets as missing',async()=>{
 for(const value of [
  {status:502,relayFailure:'relay_transport_timeout'},
  {status:502,relayFailure:'other'},
  {status:200,firstChunkValid:false},
  {status:404}
 ])assert.equal(classifyUnavailableProbe(value),'transient');
 assert.equal(classifyUnavailableProbe({status:502,relayFailure:'relay_provider_not_found'}),'provider404');
 assert.equal(classifyUnavailableProbe({status:206,firstChunkValid:true}),'recovered');
 const p=fake([{server_id:server,kind:'movie',item_id:'1234',
  series_id:'',recheck_count:2}]);
 const result=await runUnavailableRecheckBatch({pool:p,sourceId:server,
  probe:async()=> 'recovered',limit:1});
 assert.deepEqual({checked:result.checked,recovered:result.recovered,
  stillMissing:result.stillMissing,transient:result.transient},
  {checked:1,recovered:1,stillMissing:0,transient:0});
 assert.match(p.calls[1].sql,/state='recovered'/);
 assert.equal(result.subscriberCutover,false);
});
test('operator summary provides only per-source counts and never item names/IDs',async()=>{
 const p=fake([{server_id:server,kind:'movie',state:'missing',count:5,due:2}]);
 const result=await unavailableMediaSummary(p,server);
 assert.deepEqual(result.entries,[{sourceId:server,kind:'movie',state:'missing',count:5,due:2}]);
 assert.equal(result.scope,'verified_upstream_404_only');
 assert.doesNotMatch(JSON.stringify(result),/1234|password|movie_title|https:/);
});
test('live customer routes, subscription, and response authentication remain unchanged',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(c,/await ensureXtreamAdminReady\(\)/);
 assert.match(c,/await ensureUnavailableMediaTable\(client\)/);
 assert.match(c,/const unavailableKey=mediaRegistryKey\(row,kind,sourceId\)/);
 assert.match(c,/if\(req\.method==='GET'&&\(confirmedMissing\|\|response\.status===404\)\)/);
 assert.match(c,/asyncNoteMissing\(unavailableKey\)/);
 assert.match(c,/if\(req\.method==='GET'\)asyncNoteRecovered\(unavailableKey\)/);
 assert.match(c,/if\(!unavailableRecoveryTimerStarted&&recoveryEnabled\(\)\)/);
 assert.match(c,/const timer=setInterval\(\(\)=>\{void runDueUnavailableMedia\(\)\.catch\(\(\)=>\{\}\);\},3600000\)/);
 assert.match(c,/await runUnavailableRecheckBatch\(/);
 assert.match(c,/requireAdmin\(req,\s*res\)/);
 assert.match(c,/\/api\/v1\/admin\/xtream-gateway\/unavailable-media/);
 assert.match(c,/const original=mediaUpstreamUrl\(row,key\.kind,key\.itemId,ext\)/);
 assert.match(c,/shouldUseIndependentSourceMedia\(\{/);
 assert.match(c,/issueStreamRelayGrant\(\{sourceUrl:original\.href,kind:key\.kind\}\)/);
 assert.match(c,/range:'bytes=0-1023'/);
 assert.doesNotMatch(c.slice(c.indexOf('async function probeUnavailableMediaOnSameSource('),
   c.indexOf('async function proxyMedia(')),/proxyMedia\(|\b(?:INSERT|UPDATE|DELETE)\b/);
});

test('operator one-shot initial missing movie samples cannot scan or mutate catalog',async()=>{
 const c=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf("async function seedUnavailableMediaOnce(){");
 const end=c.indexOf('async function proxyMedia(',start);
 assert.ok(start>0&&end>start);
 const probe=c.slice(start,end);
 assert.match(probe,/BLOFY_XTREAM_UNAVAILABLE_SEED_ON_BOOT==='1'/);
 assert.match(probe,/for\(const serverId of recoverySources\(\)\)/);
 assert.match(probe,/AND publish_catalog=TRUE/);
 assert.match(probe,/ORDER BY name ASC LIMIT 3/);
 assert.match(probe,/validUnavailableKey\(\{serverId,kind:'movie',itemId:item\.source_id\}\)/);
 assert.match(probe,/if\(result==='provider404'\)\{/);
 assert.match(probe,/await registerProvider404\(pool,key\)/);
 assert.match(probe,/BLOFY_UNAVAILABLE_MEDIA_SEED/);
 assert.doesNotMatch(probe,/\b(?:UPDATE|DELETE|TRUNCATE)\b|creds\.|console\.info\([^)]*item\.source_id|JSON\.stringify\(items\)/);
});
