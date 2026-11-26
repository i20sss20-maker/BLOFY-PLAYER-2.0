import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf('var posterRecovery=null;'),source.indexOf('function selectChannel'));
function fixture(){
 let now=100000,calls=[];
 const S={accountEpoch:1};
 const ctx=vm.createContext({S,Date:{now:()=>now},art:x=>x.movie_image||'',
  itemId:x=>String(x.id),enc:encodeURIComponent,urlPic:x=>typeof x==='string'?x:'',
  document:{querySelectorAll:()=>[]},api:(m,url,p,cb)=>calls.push({url,cb})});
 vm.runInContext(snippet,ctx);
 return {S,calls,enrich:(items,kind='movie',force=false)=>ctx.enrichPosters(kind,items,force),
  advance:ms=>now+=ms};
}
test('global queue limits metadata requests and shares duplicate items',()=>{
 const f=fixture(),a={id:1},b={id:1};
 f.enrich([a,{id:2},{id:3}]);f.enrich([b,{id:4}]);
 assert.equal(f.calls.length,2);
 f.calls[0].cb(200,{info:{cover:'https://images.example/a'}});
 assert.equal(a.movie_image,b.movie_image);
 assert.equal(f.calls.length,3);
 const c={id:1};f.enrich([c]);assert.equal(c.movie_image,a.movie_image);
 assert.equal(f.calls.length,3);
});
test('transient failures are retried after bounded cooldown',()=>{
 const f=fixture(),a={id:1};f.enrich([a]);f.calls[0].cb(503,{});
 f.enrich([a]);assert.equal(f.calls.length,1);
 f.advance(30001);f.enrich([a]);assert.equal(f.calls.length,2);
});
test('account changes discard old queues and cached artwork',()=>{
 const f=fixture(),a={id:1},b={id:1};
 f.enrich([a,{id:2},{id:3}]);f.S.accountEpoch++;
 f.enrich([b]);assert.equal(f.calls.length,3);
 f.calls[0].cb(200,{info:{cover:'https://images.example/old'}});
 assert.equal(a.movie_image,undefined);assert.equal(b.movie_image,undefined);
 assert.equal(f.calls.length,3);
 f.calls[2].cb(200,{info:{cover:'https://images.example/new'}});
 assert.equal(b.movie_image,'https://images.example/new');
});

test('broken image can recover from alternate detail data',()=>{
 const f=fixture(),a={id:1,movie_image:'https://images.example/broken'};
 f.enrich([a],'movie',true);assert.equal(f.calls.length,1);
 f.calls[0].cb(200,{info:{},movie_data:{cover:'https://images.example/recovered'}});
 assert.equal(a.movie_image,'https://images.example/recovered');
});
test('metadata queue pauses during playback and resumes on catalog',()=>{
 const f=fixture();f.S.route='player';f.enrich([{id:1},{id:2}]);assert.equal(f.calls.length,0);
 f.S.route='movie';f.enrich([{id:3}]);assert.equal(f.calls.length,2);
});
