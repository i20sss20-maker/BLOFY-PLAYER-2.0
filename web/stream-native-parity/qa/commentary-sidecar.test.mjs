import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../stream-commentary.js',import.meta.url),'utf8');

function mockSession(tracks){
 const instances=[];
 class AudioMock {
  constructor(){this.src='';this.paused=true;instances.push(this)}
  play(){this.paused=false;return Promise.resolve()}
  pause(){this.paused=true}
  removeAttribute(name){if(name==='src')this.src=''}
  load(){}
 }
 const callbacks=new Map(),video={muted:false,volume:0.65,ended:false,
  addEventListener(type,fn){callbacks.set(type,fn)},
  removeEventListener(type){callbacks.delete(type)}
 };
 const window={};
 const fetch=async()=>({ok:true,json:async()=>({tracks})});
 runInNewContext(source,{window,Audio:AudioMock,fetch,setTimeout,clearTimeout,encodeURIComponent,Promise});
 return {video,instances,callbacks,manager:window.BlofyCommentary.create(video,'31',()=>{})}
}

test('a companion audio source never mutes LIVE video before actual audio frames start',async()=>{
 const {video,instances,manager}=mockSession([{id:'anis-max-1',label:'بلوفي سبورت',format:'progressive',delaySeconds:0}]);
 await manager.load();
 assert.equal(manager.select('anis-max-1'),true);
 assert.equal(video.muted,false);
 assert.equal(instances.length,1);
 assert.match(instances[0].src,/^\/api\/audio\/track\/anis-max-1\?channel=31$/);
 instances[0].onplaying();
 assert.equal(video.muted,true);
 assert.equal(manager.current(),'anis-max-1');
 manager.stop();
 assert.equal(video.muted,false);
 assert.equal(video.volume,0.65);
 assert.equal(instances[0].src,'');
 manager.destroy();
});

test('provider error restores original audio immediately and stops the companion',async()=>{
 const {video,instances,manager,callbacks}=mockSession([{id:'anis-sport-1',label:'معلق',format:'progressive',delaySeconds:0}]);
 await manager.load();
 assert.equal(manager.select('anis-sport-1'),true);
 instances[0].onplaying();
 assert.equal(video.muted,true);
 instances[0].onerror();
 assert.equal(video.muted,false);
 assert.equal(manager.current(),'');
 assert.equal(instances[0].paused,true);
 manager.destroy();
 assert.equal(callbacks.size,0);
});

test('unsupported HLS audio never replaces a working channel or starts a second audio stream',async()=>{
 const {video,instances,manager}=mockSession([{id:'anis-hls-1',label:'HLS',format:'hls',delaySeconds:0}]);
 await manager.load();
 assert.equal(manager.select('anis-hls-1'),false);
 assert.equal(video.muted,false);
 assert.equal(instances.length,0);
 manager.destroy()
});
