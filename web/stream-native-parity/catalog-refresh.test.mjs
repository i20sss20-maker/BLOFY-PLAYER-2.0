import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('function resetCatalogRefresh(){'),source.indexOf('function settingsScreen()'));
function fixture(){
 let now=1000000;
 const S={accountEpoch:1,userVerified:true,route:'home',loaded:{'movie:all':{items:[1]},'series:all':{items:[2]}},cats:{},pages:{},catsInflight:{},catalogVersion:'old',lastCatalogCheck:0};
 const calls=[],polls=[],messages=[],box={set textContent(v){messages.push(v)}};
 const context=vm.createContext({S,Date:{now:()=>now},document:{hidden:false,getElementById:id=>id==='refresh-progress'?box:null},keyOf:(k,c)=>k+':'+c,kindName:k=>k,
 pageRequest:(kind,cat,offset,limit,cb,q,fresh)=>calls.push({kind,cb,fresh}),api:(m,url,p,cb)=>polls.push(cb)});
 vm.runInContext(snippet,context);
 return {S,calls,polls,messages,context,advance:ms=>now+=ms,poll:()=>context.checkCatalogVersion(),reset:()=>context.resetCatalogRefresh()};
}
test('partial refresh retains good lists and retries revision on next poll',()=>{
 const f=fixture();f.poll();f.polls[0](200,{version:'new'});
 assert.equal(f.calls.length,1);assert.equal(f.S.catalogVersion,'old');
 f.calls[0].cb(200,{items:[10]});f.calls[1].cb(503,null);f.calls[2].cb(200,{items:[30]});
 assert.equal(f.S.catalogVersion,'old');assert.equal(f.S.loaded['movie:all'].items[0],1);
 assert.equal(f.S.refreshing,false);
 f.advance(600001);f.poll();f.polls[1](200,{version:'new'});
 for(let i=3;i<6;i++)f.calls[i].cb(200,{items:[i]});
 assert.equal(f.S.catalogVersion,'new');assert.equal(f.S.catalogVersionPending,null);
 assert.equal(f.S.refreshing,false);
});
test('late version response never starts a refresh during playback',()=>{
 const f=fixture();f.poll();f.S.route='player';f.polls[0](200,{version:'new'});
 assert.equal(f.calls.length,0);assert.equal(f.S.catalogVersion,'old');
 f.S.route='home';f.advance(600001);f.poll();f.polls[1](200,{version:'new'});
 assert.equal(f.calls.length,1);
});
test('new account is not blocked by an abandoned previous refresh',()=>{
 const f=fixture();f.poll();f.polls[0](200,{version:'new'});
 f.S.accountEpoch++;f.reset();f.S.loaded={};
 f.calls[0].cb(200,{items:[999]});
 assert.equal(Object.keys(f.S.loaded).length,0);
 assert.equal(f.S.refreshing,false);assert.equal(f.S.catalogVersion,null);
 f.poll();assert.equal(f.polls.length,2);
 f.polls[1](200,{version:'account-two'});assert.equal(f.S.catalogVersion,'account-two');
});
