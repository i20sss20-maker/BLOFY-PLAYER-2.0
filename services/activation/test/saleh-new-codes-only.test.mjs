import test from 'node:test';
import assert from 'node:assert/strict';
import {assertSalehNewCodeSource} from '../src/xtream-duration-codes.mjs';
const SALEH='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';

function fakeDB({name='saleh',count=1,available=true}={}){
 const calls=[];
 const db={query:async(sql,params=[])=>{
   calls.push({sql,params});
   if(sql.includes('COUNT(*)'))return {rows:[{total:count}]};
   return {rows:available?[{id:SALEH,name}]:[]};
 }};
 return {db,calls};
}
test('saleh-only issue policy selects sole active named saleh source, no upstream calls',async()=>{
 const {db,calls}=fakeDB();
 assert.equal(await assertSalehNewCodeSource(db,SALEH),true);
 assert.equal(calls.length,2);
 assert.deepEqual(calls[0].params,[SALEH]);
 assert.ok(!calls.some(x=>/password|secret|source_url/.test(x.sql)));
});
test('new code policy refuses missing source, other source, duplicate saleh and disabled source',async()=>{
 await assert.rejects(assertSalehNewCodeSource(fakeDB().db,null),
   {message:'stream_saleh_source_required'});
 for(const fixture of [{name:'other'},{count:2},{available:false}]){
   await assert.rejects(assertSalehNewCodeSource(fakeDB(fixture).db,SALEH),
     /stream_saleh_only_new_codes|stream_saleh_source_not_unique/);
 }
});
