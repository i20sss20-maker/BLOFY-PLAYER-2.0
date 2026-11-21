import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStoreDbDiagnostics,summarizeDbDiagnostics,DB_DIAGNOSTICS_QUERY} from '../src/store-db-diagnostics.mjs';

const url=new URL('https://blofyplayer.com/api/v1/admin/store/database-health');
const output=(res,code,body,headers)=>{Object.assign(res,{code,body,headers});};
test('DB monitoring only returns aggregate metrics and labels cumulative counters',()=>{
 const result=summarizeDbDiagnostics({
  connections:6,active_queries:2,lock_waiters:0,longest_transaction_seconds:8.5,
  deadlocks_total:12,temp_bytes_total:6291456,stats_reset:'2026-11-01T10:00:00Z'
 });
 assert.equal(result.ok,true);
 assert.equal(result.attention,false,'historical deadlocks alone must not trigger active incident');
 assert.equal(result.connections,6);
 assert.equal(result.deadlocksTotal,12);
 assert.match(result.explanation,/cumulative/);
 assert.ok(!DB_DIAGNOSTICS_QUERY.includes('query AS'));
 assert.ok(!DB_DIAGNOSTICS_QUERY.includes('client_addr'));
 assert.ok(!DB_DIAGNOSTICS_QUERY.includes('pg_terminate_backend'));
 assert.equal(summarizeDbDiagnostics({lock_waiters:1}).attention,true);
 assert.equal(summarizeDbDiagnostics({longest_transaction_seconds:121}).attention,true);
});
test('unauthorized requests never execute PostgreSQL diagnostics',async()=>{
 let calls=0;
 const handler=createStoreDbDiagnostics({pool:{query:async()=>{calls++;throw Error('never query');}},
  json:output,authorizeAdmin:(req,res)=>{res.code=403;return false;}});
 const res={};
 assert.equal(await handler({method:'GET'},res,url),true);
 assert.equal(res.code,403);assert.equal(calls,0);
});
test('authorized report is read-only and never cached',async()=>{
 const queried=[];
 const handler=createStoreDbDiagnostics({pool:{query:async sql=>{
  queried.push(sql);return {rows:[{
   connections:5,active_queries:1,lock_waiters:0,longest_transaction_seconds:2,
   deadlocks_total:6,temp_bytes_total:4096,stats_reset:null
  }]};
 }},json:output,authorizeAdmin:()=>true});
 const res={};
 assert.equal(await handler({method:'GET'},res,url),true);
 assert.equal(res.code,200);
 assert.equal(res.body.available,true);
 assert.equal(res.body.deadlocksTotal,6);
 assert.equal(res.headers['cache-control'],'private, no-store');
 assert.equal(queried.length,1);
 assert.match(queried[0],/pg_stat_database/);
 assert.match(queried[0],/pg_stat_activity/);
});
test('database unavailable is shown as unknown, never a green health state',async()=>{
 const handler=createStoreDbDiagnostics({pool:{query:async()=>{throw Error('connection unavailable');}},
  json:output,authorizeAdmin:()=>true});
 const res={};await handler({method:'GET'},res,url);
 assert.equal(res.code,503);assert.equal(res.body.available,false);
 assert.equal(res.body.error,'database_health_unavailable');
});
test('owner portal exposes on-demand metrics; no polling or anonymous requests',()=>{
 const html=readFileSync(new URL('../web/blofy-one.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/blofy-one-operations.js',import.meta.url),'utf8');
 const handler=readFileSync(new URL('../src/commercial-handlers.mjs',import.meta.url),'utf8');
 assert.match(html,/id="one-db-audit"/);
 assert.match(html,/id="one-db-refresh"/);
 assert.match(js,/dbPanel\.addEventListener\('toggle'/);
 assert.match(js,/\/api\/v1\/admin\/store\/database-health/);
 assert.match(handler,/storeDbDiagnostics\(req,res,url\)/);
 assert.doesNotThrow(()=>new Function(js));
});
