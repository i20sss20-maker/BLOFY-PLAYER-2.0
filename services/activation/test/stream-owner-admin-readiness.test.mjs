import test from 'node:test';
import assert from 'node:assert/strict';
import {readOwnerAdminStoreReadiness} from '../src/stream-owner-admin-readiness.mjs';
const schema={
 blofy_xtream_gateway_duration_codes:['id','code_hash','code_hint',
  'code_channel','source_id','duration_days','expires_at','revoked_at'],
 blofy_stream_distributors:['id','username','password_hash','enabled',
  'credits','issued_count']
};
function fixture({missing=null,incomplete=null,readFails=null}={}){
 const queries=[];
 const pool={async query(sql,args=[]){
  queries.push({sql,args});
  assert.match(sql,/^SELECT /i,'all diagnostics must be read-only SQL');
  assert.doesNotMatch(sql,/\b(?:ALTER|CREATE|UPDATE|DELETE|INSERT|DROP|TRUNCATE)\b/i);
  if(sql.includes('to_regclass($1::text) AS table_oid')){
   const name=args[0].replace(/^public\./,'');
   return {rows:[{table_oid:name===missing?null:'public.'+name}]};
  }
  if(sql.includes('pg_catalog.pg_attribute')){
   const name=args[0].replace(/^public\./,'');
   const cols=name===incomplete?['id']:schema[name];
   return {rows:cols.map(attname=>({attname}))};
  }
  if(sql.startsWith('SELECT 1 FROM public.')){
   const name=sql.split('public.')[1].split(' ')[0];
   if(name===readFails)throw Error('could leak private database error');
   return {rows:[{one:1}]};
  }
  throw Error('unexpected SQL');
 }};
 return {pool,queries};
}
test('code issuance and distributor stores are read and schema-inspected without migration or customer rows',async()=>{
 const x=fixture();
 const result=await readOwnerAdminStoreReadiness({pool:x.pool,checkedAt:()=> '2026-11-17T12:00:00.000Z'});
 assert.equal(result.ok,true);
 assert.equal(result.checkedAt,'2026-11-17T12:00:00.000Z');
 assert.deepEqual(result.stores.map(s=>s.id),['codes','distributors']);
 assert.deepEqual(result.stores.map(s=>s.state),['readable','readable']);
 assert.equal(result.codeIssuanceTested,false);
 assert.equal(result.distributorCreditsChanged,false);
 assert.equal(result.customerCutover,false);
 assert.equal(result.customerWrites,0);
 assert.equal(result.schemaMutations,0);
 assert.equal(result.tableRowsReturned,false);
 assert.equal(x.queries.length,6);
 assert.doesNotMatch(JSON.stringify(result),/accountId|code_hash|username|password_hash|subscriber|private/);
});
test('missing table remains missing; no CREATE, ALTER or user-data query is attempted',async()=>{
 const x=fixture({missing:'blofy_xtream_gateway_duration_codes'});
 const r=await readOwnerAdminStoreReadiness({pool:x.pool});
 assert.equal(r.ok,false);
 assert.equal(r.stores[0].state,'table_missing');
 assert.equal(r.stores[1].state,'readable');
 assert.equal(x.queries.length,4);
 assert.ok(!x.queries.some(q=>q.sql.includes('SELECT 1 FROM public.blofy_xtream_gateway_duration_codes')));
});
test('incomplete table cannot be advertised as ready',async()=>{
 const x=fixture({incomplete:'blofy_stream_distributors'});
 const r=await readOwnerAdminStoreReadiness({pool:x.pool});
 assert.equal(r.ok,false);
 assert.equal(r.stores[0].state,'readable');
 assert.equal(r.stores[1].state,'columns_incomplete');
 assert.equal(r.stores[1].selectReady,false);
});
test('database read errors are classified without returning underlying exception details',async()=>{
 const x=fixture({readFails:'blofy_stream_distributors'});
 const r=await readOwnerAdminStoreReadiness({pool:x.pool});
 assert.equal(r.ok,false);
 assert.equal(r.stores[1].state,'database_unavailable');
 assert.doesNotMatch(JSON.stringify(r),/leak private database error/);
});
test('unconfigured pool is refused before touching database',async()=>{
 await assert.rejects(()=>readOwnerAdminStoreReadiness({pool:{}}),
  /stream_owner_admin_readiness_pool_required/);
});

test('unified Portal requires authenticated owner bridge before read-only admin QA',async()=>{
 const {readFile}=await import('node:fs/promises');
 const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=src.indexOf('async function unifiedStreamBridge(');
 const auth=src.indexOf('streamBridgeAuthorized(',start);
 const route=src.indexOf("p==='/internal/blofy-stream/ops/admin-readiness'",start);
 assert.ok(start>=0&&auth>start&&route>auth);
 assert.match(src.slice(route-80,route+510),/req\.method!=='GET'\|\|url\.search/);
 assert.match(src.slice(route,route+600),/readOwnerAdminStoreReadiness\(\{pool\}\)/);
 assert.match(src.slice(route,route+700),/report\.ok\?200:503/);
});
