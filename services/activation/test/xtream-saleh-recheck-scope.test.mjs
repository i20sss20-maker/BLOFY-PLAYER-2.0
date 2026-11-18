import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {activePublishedSalehRecheckIds} from '../src/xtream-saleh-recheck-scope.mjs';

const SALEH='d2bb0397-1c56-4751-adc9-1a17758022f6';
const PAUSED='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';

test('recheck never probes paused secondary Xtream even with old env allowlist',async()=>{
 let queries=0;
 const pool={query:async(sql,args)=>{queries++;assert.match(sql,/enabled=TRUE AND publish_catalog=TRUE/);assert.match(sql,/deletion_requested_at IS NULL/);assert.match(sql,/name\)\)='saleh'/);assert.deepEqual(args,[SALEH]);return{rows:[{id:SALEH}]}}};
 assert.deepEqual([...await activePublishedSalehRecheckIds(pool,[PAUSED])],[]);
 assert.equal(queries,0);
 assert.deepEqual([...await activePublishedSalehRecheckIds(pool,[PAUSED,SALEH,SALEH])],[SALEH]);
 assert.equal(queries,1);
});
test('recheck fails closed when saleh is disabled or missing',async()=>{
 const none=await activePublishedSalehRecheckIds({query:async()=>({rows:[]})},[SALEH]);
 assert.equal(none.size,0);
 const wrong=await activePublishedSalehRecheckIds({query:async()=>({rows:[{id:PAUSED}]})},[SALEH]);
 assert.equal(wrong.size,0);
 await assert.rejects(activePublishedSalehRecheckIds({query:async()=>{throw Error('db_down')}},[SALEH]),/db_down/);
});
test('both scheduled and operator rechecks require active published saleh',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=gateway.indexOf('async function runDueUnavailableMedia(');
 const end=gateway.indexOf('// Explicit operator one-shot:',start);
 const timer=gateway.slice(start,end);
 assert.match(timer,/activePublishedSalehRecheckIds\(pool,\[\.\.\.recoverySources\(\)\]\)/);
 assert.match(timer,/eligible\.has\(sourceId\)/);
 const op=gateway.slice(gateway.indexOf("url.pathname==='/api/v1/admin/xtream-gateway/unavailable-media/recheck-now'"),gateway.indexOf("url.pathname==='/api/v1/admin/xtream-gateway/codes'"));
 assert.match(op,/activePublishedSalehRecheckIds\(pool,\[sourceId\]\)/);
 assert.match(op,/unavailable_source_paused_or_unpublished/);
 assert.doesNotMatch(timer,/sourceEnabled\s*=\s*true/);
});
