import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeGatewayMapWithGuard} from '../src/xtream-gateway-map-serialized.mjs';
const query='INSERT INTO demo_map(id) SELECT id FROM demo_source ON CONFLICT DO NOTHING';
const result={rows:[],rowCount:4};

test('existing fast map writer remains unchanged with feature flag disabled',async()=>{
 const seen=[];
 const pool={query:async(sql,args)=>{seen.push({sql,args});return result;},
  connect:async()=>{throw Error('should not create a client')}};
 assert.strictEqual(await writeGatewayMapWithGuard(pool,query,[1],{enabled:false}),result);
 assert.deepEqual(seen,[{sql:query,args:[1]}]);
});
test('safe mapper serializes two-step write with one connection, nonparallel work and cross-replica advisory lock',async()=>{
 const seen=[];let released=0;
 const client={query:async(sql,args)=>{seen.push({sql,args});return sql===query?result:{rows:[]};},
  release(){released++;}};
 const pool={query:async()=>{throw Error('pool.query must not interleave writes');},
   connect:async()=>client};
 assert.strictEqual(await writeGatewayMapWithGuard(pool,query,['test'],{enabled:true}),result);
 assert.deepEqual(seen.map(x=>x.sql),[
  'BEGIN','SET LOCAL max_parallel_workers_per_gather=0',
  "SET LOCAL work_mem='4MB'",'SELECT pg_advisory_xact_lock(718420927)',
  query,'COMMIT'
 ]);
 assert.deepEqual(seen[4].args,['test']);
 assert.equal(released,1);
});
test('a failed map insertion rolls back and always releases the client',async()=>{
 const seen=[];let released=0;
 const client={query:async sql=>{seen.push(sql);if(sql===query)throw Error('test_deadlock');
   return {rows:[]};},release(){released++}};
 const pool={query:async()=>{},connect:async()=>client};
 await assert.rejects(
  writeGatewayMapWithGuard(pool,query,[],{enabled:true}),/test_deadlock/);
 assert.ok(seen.includes('ROLLBACK'));
 assert.ok(!seen.includes('COMMIT'));
 assert.equal(released,1);
});
test('both Xtream item and category maps call the protected writer only under opt-in',()=>{
 const hook=readFileSync(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(hook,/BLOFY_SAFE_GATEWAY_MAP_WRITES==='1'/);
 assert.match(hook,/oncePerMediaMap\(categoryMapJobs,key,\(\)=>writeGatewayMap/);
 assert.match(hook,/oncePerMediaMap\(itemMapJobs,key,\(\)=>writeGatewayMap/);
 assert.match(hook,/writeGatewayMapWithGuard/);
});
