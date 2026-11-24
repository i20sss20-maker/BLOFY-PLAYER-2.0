import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('var listingAccessSeq=0;'),source.indexOf('function safeImg('));
function fixture(){
 const S={loaded:{},cat:{live:'1',movie:'2',series:'3'},listingInflight:{}};
 const calls=[];
 const ctx=vm.createContext({S,keyOf:(k,c)=>k+':'+c,
 pageRequest:(kind,cat,offset,limit,cb)=>calls.push({kind,cat,cb})});
 vm.runInContext(snippet,ctx);
 function add(key,count=36){S.loaded[key]=ctx.touchListing({items:Array.from({length:count},(_,id)=>({id}))})}
 return {S,ctx,calls,add,prune:()=>ctx.pruneInactiveListings()};
}
test('least recently used inactive categories are evicted without clearing selected shelves or search',()=>{
 const f=fixture();
 for(const key of ['live:all','movie:all','series:all','live:1','movie:2','series:3','movie:search'])f.add(key);
 for(let i=10;i<19;i++)f.add('movie:'+i);
 f.ctx.getListing('movie','10',()=>{});
 assert.equal(f.calls.length,0);
 assert.ok(f.S.loaded['movie:10']);
 assert.equal(f.S.loaded['movie:11'],undefined);
 for(const key of ['live:all','movie:all','series:all','live:1','movie:2','series:3','movie:search'])assert.ok(f.S.loaded[key]);
 assert.equal(Object.keys(f.S.loaded).length,15);
});
test('inactive item budget evicts large old listings without interrupting pending pagination',()=>{
 const f=fixture();f.add('movie:2',800);f.add('movie:10',500);f.add('movie:11',200);f.add('movie:12',500);
 f.S.loaded['movie:12'].loadingMore=true;f.prune();
 assert.equal(f.S.loaded['movie:10'],undefined);
 assert.ok(f.S.loaded['movie:11']);assert.ok(f.S.loaded['movie:12']);assert.ok(f.S.loaded['movie:2']);
 f.S.loaded['movie:12'].loadingMore=false;f.prune();
 assert.equal(f.S.loaded['movie:11'],undefined);assert.ok(f.S.loaded['movie:12']);
});
test('evicted category loads again while repeated requests share the new read',()=>{
 const f=fixture();for(let i=10;i<19;i++)f.add('movie:'+i);f.prune();
 assert.equal(f.S.loaded['movie:10'],undefined);
 f.S.cat.movie='10';let delivered=0;
 f.ctx.getListing('movie','10',(st,r)=>{assert.equal(st,200);assert.equal(r.items[0].id,42);delivered++});
 f.ctx.getListing('movie','10',()=>delivered++);
 assert.equal(f.calls.length,1);
 f.calls[0].cb(200,{items:[{id:42}],hasMore:false});
 assert.equal(delivered,2);assert.ok(f.S.loaded['movie:10']);
});
