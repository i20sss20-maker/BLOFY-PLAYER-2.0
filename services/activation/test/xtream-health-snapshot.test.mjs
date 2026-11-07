import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createXtreamHealthSnapshot} from '../src/xtream-health-snapshot.mjs';

test('Xtream health requests share one database aggregation and refresh after TTL',async()=>{
  let now=1000,calls=0;
  const snapshot=createXtreamHealthSnapshot(async()=>{
    calls++;
    return {ok:true,accounts:calls,catalog:{live:200000}};
  },{ttlMs:15_000,clock:()=>now});
  const values=await Promise.all(Array.from({length:100},()=>snapshot()));
  assert.equal(calls,1);
  assert.ok(values.every(v=>v.accounts===1));
  now+=14999;
  assert.equal((await snapshot()).accounts,1);
  assert.equal(calls,1);
  now++;
  assert.equal((await snapshot()).accounts,2);
  assert.equal(calls,2);
});

test('failing health checks are never cached as success',async()=>{
  let calls=0;
  const snapshot=createXtreamHealthSnapshot(async()=>{
    if(++calls===1)throw new Error('database unavailable');
    return {ok:true,catalog:{live:23}};
  });
  await assert.rejects(snapshot(),/database unavailable/);
  assert.equal((await snapshot()).catalog.live,23);
  assert.equal(calls,2);
});

test('health cache is not used for subscriber authentication or media playback',async()=>{
  const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const auth=gateway.slice(gateway.indexOf('async function authenticate('),
    gateway.indexOf('// A 290k-item catalog'));
  assert.match(auth,/await pool\.query\('SELECT \* FROM blofy_xtream_gateway_accounts WHERE username=\$1'/);
  assert.doesNotMatch(auth,/cachedGatewayHealth|createXtreamHealthSnapshot/);
  const health=gateway.slice(gateway.indexOf('async function collectGatewayHealth('),
    gateway.indexOf('const previousCreateServer ='));
  assert.match(health,/const cachedGatewayHealth = createXtreamHealthSnapshot\(collectGatewayHealth\)/);
  assert.match(health,/async function gatewayHealth\(\)\{ return cachedGatewayHealth\(\); \}/);
  assert.throws(()=>createXtreamHealthSnapshot(()=>({}),{ttlMs:60001}),/xtream_health_cache_invalid/);
});
