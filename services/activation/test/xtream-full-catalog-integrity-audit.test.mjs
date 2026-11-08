import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditEntireXtreamStoredCatalog} from '../src/xtream-full-catalog-integrity-audit.mjs';

const source='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
test('read-only whole-catalog scan covers all media types and episode map without URLs',async()=>{
 const calls=[],responses=[
  [{media_type:'live',total:9679,enabled_count:9679,unsafe_id_count:0},
   {media_type:'movie',total:24254,enabled_count:24254,movie_missing_extension_count:3,
    advertised_direct_source_count:15},
   {media_type:'series',total:5218,enabled_count:5218}],
  [{media_type:'movie',missing_category_reference_count:7}],
  [{media_type:'movie',mapped_items:101,mapped_items_no_longer_imported:2}],
  [{mapped_episodes:88450,episodes_parent_series_missing:9,
    episode_unsafe_id_count:0,episode_unsupported_extension_count:4}]
 ];
 let n=0,released=false;
 const db={connect:async()=>({query:async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.trim().startsWith('SELECT'))return {rows:responses[n++]};
  return {rows:[]};
 },release:()=>{released=true}})};
 const r=await auditEntireXtreamStoredCatalog(db,source);
 assert.equal(r.importedItems,39151);
 assert.equal(r.rowsExamined,127601);
 assert.equal(r.episodes.mapped_episodes,88450);
 assert.equal(r.types.find(x=>x.type==='movie').movie_missing_extension_count,3);
 assert.equal(r.integrityWarnings,25);
 assert.equal(r.playbackVerified,false);
 assert.equal(r.readOnly,true);
 assert.equal(r.fullLocalCatalogScan,true);
 assert.equal(released,true);
 assert.ok(calls[0].sql.includes('READ ONLY'));
 assert.equal(calls.filter(x=>x.sql.trim().startsWith('SELECT')).length,4);
 for(const call of calls.filter(x=>x.sql.trim().startsWith('SELECT')))
  assert.deepEqual(call.args,[source]);
 assert.doesNotMatch(JSON.stringify(r),/password|username|secret|http:|https:/i);
});
test('invalid source UUID cannot launch full scan',async()=>{
 let called=false;
 await assert.rejects(auditEntireXtreamStoredCatalog({
  connect:async()=>{called=true;throw Error('should not query');}
 },'1 OR 1=1'),/xtream_audit_source_invalid/);
 assert.equal(called,false);
});
test('operator source-only boot hook cannot mutate catalogs or request provider media',async()=>{
 const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=code.indexOf("if(process.env.BLOFY_XTREAM_FULL_CATALOG_AUDIT_ON_BOOT==='1')");
 const b=code.indexOf('// One-shot, read-only comparison with player_api.php server_info.',a);
 const block=code.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(block,/BLOFY_XTREAM_EGRESS_SOURCE_ID/);
 assert.match(block,/auditEntireXtreamStoredCatalog\(pool,id\)/);
 assert.match(block,/mediaRequests:0,sourceMutation:false/);
 assert.doesNotMatch(block,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
 const module=await readFile(new URL('../src/xtream-full-catalog-integrity-audit.mjs',import.meta.url),'utf8');
 assert.match(module,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(module,/statement_timeout/);
 assert.match(module,/WHERE server_id=\$1/);
 assert.doesNotMatch(module,/https?:\/\/|fetch\(|\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
});
