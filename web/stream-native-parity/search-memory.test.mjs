import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('function searchNow(q,token)'),source.indexOf('function aiScreen()'));
function fixture(){
 const S={route:'search',searchToken:1,searchKind:'all',searchRequests:[],loaded:{'movie:all':{items:[{id:88}]}}};
 const calls=[],output={innerHTML:''},status={textContent:''};
 const context=vm.createContext({S,keyOf:(k,c)=>k+':'+c,itemId:(x,k)=>String(x?(k==='series'?(x.series_id||x.id):(x.stream_id||x.id))||'':''),clearTimeout,posterCard:item=>'<b>'+item.id+'</b>',
 document:{getElementById:id=>id==='search-result'?output:status},
 pageRequest:(kind,cat,offset,limit,cb,q)=>{const request={kind,cb,q,aborted:false,abort(){this.aborted=true}};calls.push(request);return request}});
 vm.runInContext(snippet,context);
 return {S,calls,output,status,search:q=>context.searchNow(q,S.searchToken)};
}
test('new search replaces retained results and ignores old callbacks',()=>{
 const f=fixture();f.search('old');f.calls[1].cb(200,{items:[{id:1}]});
 assert.equal(f.S.loaded['movie:search'].items[0].id,1);
 f.S.searchToken++;f.search('new');
 assert.equal(f.S.loaded['movie:search'],undefined);
 assert.ok(f.calls.slice(0,3).every(x=>x.aborted));
 f.calls[0].cb(200,{items:[{id:999}]});
 assert.equal(f.S.loaded['live:search'],undefined);
 f.calls[4].cb(200,{items:Array.from({length:40},(_,id)=>({id}))});
 assert.equal(f.S.loaded['movie:search'].items.length,20);
 assert.equal(f.S.loaded['movie:all'].items[0].id,88);
});
test('failed search does not claim that catalog contains no matching items',()=>{
 const f=fixture();f.search('query');
 f.calls[0].cb(503,null);f.calls[1].cb(200,{items:[]});f.calls[2].cb(200,{items:[]});
 assert.match(f.output.innerHTML,/تعذر البحث/);
 assert.doesNotMatch(f.output.innerHTML,/لم يتم العثور/);
});
test('successful empty search completes with no results rather than loading forever',()=>{
 const f=fixture();f.search('query');
 for(const c of f.calls)c.cb(200,{items:[]});
 assert.match(f.output.innerHTML,/لم يتم العثور/);
 assert.equal(f.status.textContent,'لا توجد نتائج');
});

test('cached Arabic search is deduplicated, marked partial and replaced by authoritative matches',()=>{
 const f=fixture();f.S.loaded['movie:all'].items=[{id:88,name:'الفيلم الأزرق'},{id:88,name:'الفيلم الأزرق'}];
 f.search('ازرق الفيلم');
 assert.equal(f.S.loaded['movie:search'].items.length,1);
 assert.match(f.status.textContent,/أولية/);
 f.calls[1].cb(200,{items:[{id:99}]});
 assert.equal(f.S.loaded['movie:search'].items[0].id,99);
 assert.doesNotMatch(f.status.textContent,/أولية/);
});
test('failed authoritative search retains cached matches without claiming completeness',()=>{
 const f=fixture();f.S.loaded['movie:all'].items=[{id:88,name:'الفيلم الأزرق'}];f.search('ازرق');
 f.calls[0].cb(200,{items:[]});f.calls[1].cb(503,null);f.calls[2].cb(200,{items:[]});
 assert.equal(f.S.loaded['movie:search'].items[0].id,88);
 assert.match(f.status.textContent,/غير مكتملة/);
});
