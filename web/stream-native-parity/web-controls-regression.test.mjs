import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('./server.ts',import.meta.url),'utf8');
const sidecar=readFileSync(new URL('./stream-commentary.js',import.meta.url),'utf8');
const snippet=source.slice(source.indexOf(' function checkStartup(){'),source.indexOf(' function noteGestureError('));
const factory=new Function('record','video','S','preview','document','navigator','alive','liveRetryPending','recoverConnection','setTimeout','Date',snippet+';return checkStartup;');
for(const [name,flags,expected] of [
 ['initial paused decoder',{},'recover'],['autoplay blocked',{gesture:true},'defer'],
 ['manual pause',{pause:true},'defer'],['offline',{offline:true},'defer'],
 ['active retry',{pending:true},'defer'],['hidden',{hidden:true},'defer'],
 ['detached',{detached:true},'stop'],['playing',{ready:true},'stop']
]){
 test('HLS startup: '+name,()=>{
  let result='stop',now=100000;
  const video={paused:true,isConnected:!flags.detached};
  const record={ready:!!flags.ready,awaitingPlayGesture:!!flags.gesture};
  const S={playerView:{video,userPaused:!!flags.pause}};
  const check=factory(record,video,S,false,{hidden:!!flags.hidden},{onLine:!flags.offline},()=>true,()=>!!flags.pending,()=>{result='recover'},()=>{result='defer';return 1},{now:()=>now});
  now+=50001;result='stop';check();assert.equal(result,expected);
 })
}
test('stale search cannot abort the active query',()=>{
 const S={route:'search',searchToken:2,searchRequests:[{abort(){throw Error('stale search aborted newer query')}}]};
 const search=new Function('S',source.slice(source.indexOf('function searchNow(q,token)'),source.indexOf('function aiScreen()'))+';return searchNow;')(S);
 search('old',1)
});
test('navigation, search deadline and subtitle engine preference',()=>{
 assert.doesNotMatch(source.match(/var NAV=.*$/m)[0],/\['commentators'/);
 assert.match(source,/115000:40000/);
 assert.ok(worker.includes('query.split(/\\s+/).every'));
 assert.ok(source.includes('if(list.length&&!(engine&&engine.subtitleTracks&&engine.subtitleTracks.length))'));
});
test('commentary timeout retains original video sound and stops pending audio',async()=>{
 const video={muted:false,volume:.6,addEventListener(){},removeEventListener(){}};
 let pending=new Map(),seq=0,lastAudio;
 const win={};const notices=[];
 class Audio{constructor(){lastAudio=this}play(){return new Promise(()=>{})}pause(){this.paused=true}removeAttribute(){}load(){}}
 vm.runInNewContext(sidecar,{window:win,Audio,Promise,encodeURIComponent,fetch:async()=>({ok:true,json:async()=>({tracks:[{id:'anis-test',label:'Test',format:'progressive',delaySeconds:0}]})}),setTimeout:(f)=>{pending.set(++seq,f);return seq},clearTimeout:id=>pending.delete(id)});
 const manager=win.BlofyCommentary.create(video,'42',s=>notices.push(s));
 await manager.load();assert.equal(manager.select('anis-test'),true);
 assert.equal(video.muted,false);assert.equal(pending.size,1);
 [...pending.values()][0]();assert.equal(video.muted,false);assert.equal(lastAudio.paused,true);assert.equal(manager.current(),'');
 video.muted=true;manager.select('original');assert.equal(video.muted,true);manager.destroy()
});

test('local Arabic matches appear immediately, deduplicate and are replaced by server results',()=>{
 const item={stream_id:42,name:'الأكشن الجديد'};
 const S={route:'search',searchToken:1,searchKind:'movie',searchRequests:[],loaded:{'movie:all':{items:[item]},'movie:7':{items:[item]}}};
 const output={innerHTML:''},status={textContent:''};let reply;
 const search=new Function('S','keyOf','posterCard','document','pageRequest',source.slice(source.indexOf('function searchNow(q,token)'),source.indexOf('function aiScreen()'))+';return searchNow;')(S,(k,c)=>k+':'+c,item=>'<b>'+item.name+'</b>',{getElementById:id=>id==='search-result'?output:status},(k,c,o,l,cb)=>{reply=cb;return {abort(){}}});
 search('اكشن',1);assert.equal(S.loaded['movie:search'].items.length,1);assert.match(status.textContent,/أولية/);
 reply(200,{items:[{stream_id:43,name:'أكشن آخر'}]});
 assert.match(output.innerHTML,/أكشن آخر/);assert.doesNotMatch(output.innerHTML,/الجديد/);assert.doesNotMatch(status.textContent,/أولية/);
 search('اكشن',1);reply(503,null);assert.match(status.textContent,/النتائج غير مكتملة/);assert.match(output.innerHTML,/الجديد/);
});
