import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {expediteUnavailableRecheck} from '../src/xtream-unavailable-media-registry.mjs';

const source='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
test('operator expedite selects only two recorded missing entries and preserves active lease',async()=>{
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  return {rows:[{kind:'movie'},{kind:'series'}]};
 }};
 const n=await expediteUnavailableRecheck(pool,source);
 assert.equal(n,2);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].args,[source,2]);
 const sql=calls[0].sql;
 assert.match(sql,/FROM blofy_xtream_unavailable_media/);
 assert.match(sql,/WHERE server_id=\$1 AND state='missing'/);
 assert.match(sql,/next_check_at > NOW\(\)\+INTERVAL '1 hour'/);
 assert.match(sql,/last_checked_at IS NULL OR/);
 assert.match(sql,/last_checked_at < NOW\(\)-INTERVAL '15 minutes'/);
 assert.match(sql,/LIMIT \$2 FOR UPDATE SKIP LOCKED/);
 assert.match(sql,/SET next_check_at=NOW\(\)-INTERVAL '1 minute'/);
 assert.doesNotMatch(sql,/blofy_xtream_items|blofy_xtream_gateway_accounts|TRUNCATE|DELETE/);
});
test('invalid source IDs and larger batches cannot reach database',async()=>{
 const pool={query(){throw Error('query should never run')}};
 for(const id of ['bad',null,'',source+'/../',source+' '])
  assert.equal(await expediteUnavailableRecheck(pool,id),0);
 for(const limit of [-1,0,3,100,1.2])
  assert.equal(await expediteUnavailableRecheck(pool,source,{limit}),0);
});
test('manual endpoint is inside existing authenticated admin route and source allowlist',async()=>{
 const path=new URL('../src/xtream-gateway-hook.mjs',import.meta.url);
 const s=await readFile(path,'utf8');
 const start=s.indexOf("if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway')) return listener(req, res);");
 const endpoint=s.indexOf("url.pathname==='/api/v1/admin/xtream-gateway/unavailable-media/recheck-now'");
 const end=s.indexOf("if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream-gateway')",endpoint);
 assert.ok(start>=0&&endpoint>start&&end>endpoint);
 const body=s.slice(start,end);
 assert.match(body,/if \(!requireAdmin\(req, res\)\) return/);
 assert.match(body,/await ensureReady\(\)/);
 assert.match(body,/const body=await readJson\(req\)/);
 assert.match(body,/if\(!validUuid\(sourceId\)\|\|!recoverySources\(\)\.has\(sourceId\)\)/);
 assert.match(body,/const expedited=await expediteUnavailableRecheck\(pool,sourceId,\{limit:2\}\)/);
 assert.match(body,/const result=await runDueUnavailableMedia\(\)/);
 assert.doesNotMatch(body,/sourceUrl|providerPassword|username_secret|password_secret/);
});
test('one-shot production source probe is disabled by default and never scans catalog',async()=>{
 const s=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const a=s.indexOf("if(process.env.BLOFY_XTREAM_UNAVAILABLE_EXPEDITE_ON_BOOT==='1')");
 const b=s.indexOf('// Optional first rollout: register only provider-confirmed 404',a);
 assert.ok(a>0&&b>a);
 const probe=s.slice(a,b);
 assert.match(probe,/BLOFY_XTREAM_UNAVAILABLE_EXPEDITE_SOURCE_ID/);
 assert.match(probe,/recoverySources\(\)\.has\(sourceId\)/);
 assert.match(probe,/expediteUnavailableRecheck\(pool,sourceId,\{limit:2\}\)/);
 assert.match(probe,/BLOFY_UNAVAILABLE_EXPEDITE_PROOF/);
 assert.match(probe,/catalogMutation:false,subscriberCutover:false,credentialsLogged:false/);
 assert.doesNotMatch(probe,/SELECT.+blofy_xtream_items|UPDATE blofy_xtream_items|INSERT INTO blofy_xtream_items|console\.log\(row/);
});
