import test from 'node:test';
import assert from 'node:assert/strict';
import {readCatalogPage} from './catalog-array-reader.mjs';
function reader(text,chunk=7){
 const bytes=new TextEncoder().encode(text);let at=0;
 return {read:async()=>at>=bytes.length?{done:true}:{done:false,value:bytes.slice(at,at+=chunk)}};
}
test('reads bounded matching page with Arabic text and nested objects across chunks',async()=>{
 const rows=[{id:1,name:'فيلم',info:{title:'a "quote"'}},{id:2,name:'skip'},{id:3,name:'مسلسل'},{id:4,name:'آخر'}];
 const page=await readCatalogPage(reader(JSON.stringify(rows),1),{offset:1,limit:1,match:x=>x.id!==2});
 assert.deepEqual(page,{items:[rows[2]],hasMore:true,nextOffset:2});
});
test('rejects truncated, non-array and malformed catalog payloads',async()=>{
 for(const body of ['','{"error":"expired"}','<html>error</html>','[{"id":1}', '[{"id":1},]', '[{"id":1} {"id":2}]','[{"id":}]','[]junk']){
  await assert.rejects(readCatalogPage(reader(body),{offset:0,limit:36}),undefined,body);
 }
});
test('accepts genuine empty arrays and complete final pages',async()=>{
 assert.deepEqual(await readCatalogPage(reader('[]'),{offset:0,limit:36}),{items:[],hasMore:false,nextOffset:0});
 assert.deepEqual(await readCatalogPage(reader('[{"id":1}]'),{offset:0,limit:36}),{items:[{id:1}],hasMore:false,nextOffset:1});
});
test('fails closed when byte limit is exceeded instead of claiming a final page',async()=>{
 await assert.rejects(readCatalogPage(reader('[{"id":1},{"id":2}]'),{offset:0,limit:36,maxBytes:10}),/catalog_byte_limit/);
});
