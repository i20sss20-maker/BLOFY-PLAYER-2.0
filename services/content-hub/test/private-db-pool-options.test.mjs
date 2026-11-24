import test from 'node:test';
import assert from 'node:assert/strict';
import {privateDbPoolOptions} from '../src/private-db-pool-options.mjs';
test('private pool guard preserves connection settings and appends parallel limit',()=>{
 const original='postgresql://user:pass@postgres.railway.internal:5432/railway?sslmode=require&options=-c%20statement_timeout%3D5000';
 const result=privateDbPoolOptions(original,{});
 const url=new URL(result.connectionString);
 assert.equal(url.hostname,'postgres.railway.internal');
 assert.equal(url.password,'pass');
 assert.equal(url.searchParams.get('sslmode'),'require');
 assert.equal(url.searchParams.has('options'),false);
 assert.equal(result.options,'-c statement_timeout=5000 -c max_parallel_workers_per_gather=0');
});
test('external connections and opt-out are unchanged',()=>{
 for(const connectionString of ['postgres://test','postgres://postgres.railway.internal.example.com/db','mock']){
  assert.deepEqual(privateDbPoolOptions(connectionString,{}),{connectionString});
 }
 const connectionString='postgres://postgres.railway.internal/db';
 assert.deepEqual(privateDbPoolOptions(connectionString,{BLOFY_POSTGRES_PARALLEL_GATHER_SAFE_MODE:'0'}),{connectionString});
 assert.equal(privateDbPoolOptions(connectionString,{}).options,'-c max_parallel_workers_per_gather=0');
});
