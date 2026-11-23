import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {queryXtreamCatalogPageNoParallel} from '../src/xtream-catalog-low-memory-query.mjs';

const page={text:'SELECT $1::text AS category',values:['live']};
function fakePool({failAt=null,rollbackFails=false}={}){
 const queries=[];let released=null;
 const client={
  async query(query){
   queries.push(typeof query==='string'?query:query.text);
   const n=queries.length;
   if(failAt===n || (rollbackFails&&query==='ROLLBACK'))throw Error('database_query_error');
   if(query===page)return {rows:[{category:'live'}]};
   return {rows:[]};
  },
  release(broken){released=broken}
 };
 return {queries,client,pool:{async connect(){return client}},
  get releaseArgument(){return released}};
}

test('catalog pages run sequentially in read-only transaction without permanent DB settings',async()=>{
 const f=fakePool();
 assert.deepEqual(await queryXtreamCatalogPageNoParallel(f.pool,page),[{category:'live'}]);
 assert.deepEqual(f.queries,[
  'BEGIN READ ONLY',
  'SET LOCAL max_parallel_workers_per_gather = 0',
  page.text,
  'COMMIT'
 ]);
 assert.equal(f.releaseArgument,false);
 assert.equal(f.queries.some(x=>/^ALTER SYSTEM|^SET max_parallel/i.test(x)),false);
});

test('failed catalog queries rollback and release reserved connections',async()=>{
 const f=fakePool({failAt:3});
 await assert.rejects(queryXtreamCatalogPageNoParallel(f.pool,page),/database_query_error/);
 assert.deepEqual(f.queries.slice(-2),[page.text,'ROLLBACK']);
 assert.equal(f.releaseArgument,false);
});

test('transaction rollback errors discard the broken database session',async()=>{
 const f=fakePool({failAt:3,rollbackFails:true});
 await assert.rejects(queryXtreamCatalogPageNoParallel(f.pool,page),/database_query_error/);
 assert.equal(f.releaseArgument,true);
});

test('invalid inputs cannot acquire a client',async()=>{
 let connected=0;
 const pool={async connect(){connected++;throw Error('unexpected_connect')}};
 await assert.rejects(queryXtreamCatalogPageNoParallel(pool,{text:'SELECT 1',values:null}),/xtream_catalog_page_invalid/);
 assert.equal(connected,0);
});

test('actual customer ordered catalog walker calls the scoped no-parallel reader',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const start=gateway.indexOf('async function walkGatewayItems(');
 const end=gateway.indexOf('async function writeStreamChunk(',start);
 assert.ok(start>=0&&end>start);
 const walker=gateway.slice(start,end);
 assert.match(walker,/queryXtreamCatalogPageNoParallel\(pool,page\)/);
 assert.doesNotMatch(walker,/pool\.query\(page\)/);
});
