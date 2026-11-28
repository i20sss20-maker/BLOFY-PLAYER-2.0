import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeCommentaryTracks,boundedCommentaryJson,validCommentaryId} from '../commentary-catalog.mjs';
const row={id:'anis-max-1',label:'بلوفي ماكس',format:'progressive',delaySeconds:0,playbackUrl:'https://blofyplayer.com/api/v1/stream/media/audio/anis-max-1'};
test('only approved track IDs and exact first-party URLs are accepted',()=>{
 const tracks=safeCommentaryTracks({tracks:[row,row,{...row,id:'../../media'},{...row,id:'anis-evil',playbackUrl:'https://example.org/audio'},{...row,id:'anis-hls',format:'hls'}]},'1');
 assert.deepEqual(tracks,[{id:row.id,label:row.label,delaySeconds:0}]);
 assert.equal(validCommentaryId('anis-../secret'),false);
 assert.deepEqual(safeCommentaryTracks({channels:[{channelId:'2',tracks:[row]}]},'1'),[]);
});
test('catalog input is bounded and rejects malformed JSON',async()=>{
 assert.deepEqual(await boundedCommentaryJson(new Response(JSON.stringify({tracks:[row]}))),{tracks:[row]});
 await assert.rejects(boundedCommentaryJson(new Response('x'.repeat(262145))),/catalog_too_large/);
 await assert.rejects(boundedCommentaryJson(new Response('invalid')));
});
test('same-origin audio stays authenticated and player restores original on failure and exit',()=>{
 const server=readFileSync('server.ts','utf8'),app=readFileSync('app.js','utf8');
 assert.match(server,/ORIGIN\+'\/api\/v1\/stream\/media\/audio\/'\+id/);
 assert.match(server,/headers:\{Authorization:h.Authorization,Accept:'audio\/\*'\},redirect:'manual',signal:req.signal/);
 assert.match(app,/audio.src='\/api\/commentary\/'\+enc\(track.id\)/);
 assert.match(app,/audio.onplaying=function\(\)/);
 assert.match(app,/video.muted=old.originalMuted/);
 assert.match(app,/if\(S.playerView.disposeCommentary\)S.playerView.disposeCommentary\(\)/);
 assert.match(app,/if\(state.stopCommentary\)state.stopCommentary\(\)/);
 assert.match(app,/document.removeEventListener\('visibilitychange',commentaryVisibility\)/);
});

test('manual commentary adjustment is limited to a real seekable audio range',()=>{
 const app=readFileSync('app.js','utf8');
 const a=app.indexOf('function commentarySeekTarget('),b=app.indexOf('function simpleLiveStatus(',a);
 const target=new Function(app.slice(a,b)+';return commentarySeekTarget')();
 const audio={paused:false,seeking:false,currentTime:15,seekable:{length:1,start:()=>10,end:()=>20}};
 assert.equal(target(audio,1),16);assert.equal(target(audio,-1),14);
 assert.equal(target(audio,30),null);
 assert.equal(target({...audio,paused:true},1),null);
 assert.equal(target({...audio,seeking:true},1),null);
 assert.equal(target({...audio,currentTime:10},-1),null);
 assert.equal(target({...audio,currentTime:19.5},1),null);
 assert.equal(target({...audio,seekable:{length:0}},1),null);
 assert.match(app,/active\.audio\.currentTime=target/);
 assert.match(app,/commentary&&commentary\.audible/);
});


test('external live handoff uses a single-use ticket and stops internal playback first',()=>{
 const server=readFileSync('server.ts','utf8'),app=readFileSync('app.js','utf8');
 assert.match(server,/externalTickets\.delete\(key\);\s*const controller=new AbortController/);
 assert.match(server,/Math\.min\(now\+120000,accountExpiry\)/);
 assert.match(server,/if\(externalActive\.has\(ticket\.account\)/);
 assert.match(server,/randomBytes\(32\)\.toString\('base64url'\)/);
 assert.match(server,/if\(t\)revokeExternal\('Bearer '\+t\)/);
 assert.match(app,/stopPlayback\(false\);\s*function issue\(\)/);
 assert.match(app,/api\('POST','\/api\/external\/live'/);
 assert.match(app,/if\(st===200\|\|st===404\)\{state.externalRetiringStop=null;state.directStopKey=null;issue\(\)\}/);
});
test('recognized incompatible commentary is converted without forwarding unknown content',()=>{
 const server=readFileSync('server.ts','utf8');
 assert.match(server,/\['video\/mp2t','audio\/ogg','audio\/flac'\]\.includes\(mime\)/);
 assert.match(server,/fetch\(host\+'\/audio-compat\/'\+id/);
 assert.match(server,/converted\.headers\.get\('content-type'\)!=='audio\/mpeg'/);
});

test('return from external playback waits for both retirements before reopening internal channel',()=>{
 const app=readFileSync('app.js','utf8'),server=readFileSync('server.ts','utf8');
 const a=app.indexOf('function returnFromExternal('),b=app.indexOf('state.returnFromExternal=',a);
 const state={externalMode:true,userPaused:true,externalRetiringStop:'/api/hls/test/stop',directStopKey:'test'},S={route:'player',playerView:state},calls=[],errors=[];let opened=0;
 const restore=new Function('state','S','api','playerStatus','resumeSelectedLiveTransport','video','document',app.slice(a,b)+';return returnFromExternal')(
  state,S,(method,path,body,cb)=>calls.push({path,cb}),(msg,error)=>{if(error)errors.push(msg)},()=>opened++,{}, {getElementById:()=>null});
 restore();assert.equal(calls[0].path,'/api/hls/test/stop');calls[0].cb(503);assert.equal(opened,0);assert.equal(state.externalMode,true);assert.equal(state.directStopKey,'test');
 restore();calls[1].cb(404);assert.equal(state.directStopKey,null);assert.equal(calls[2].path,'/api/external/stop');assert.equal(opened,0);
 calls[2].cb(200);assert.equal(opened,1);assert.equal(state.userPaused,false);assert.equal(state.externalMode,false);
 assert.match(server,/if\(p==='\/api\/external\/stop'&&method==='POST'\)\{[\s\S]*?revokeExternal\(h.Authorization\)/);
});

test('dedicated commentator controls appear only on live and preserve original audio',()=>{
 const app=readFileSync('app.js','utf8');
 assert.ok(app.includes("(isLive?playerControl('player-commentary'"));
 assert.ok(app.includes('(isLive?\'<button class="btn secondary" id="player-commentary-more"'));
 assert.match(app,/function openCommentaryChoices\(origin\)/);
 assert.match(app,/String\(state.id\)!==channel\|\|epoch!==commentaryEpoch/);
 assert.match(app,/video\.muted=old\.originalMuted/);
 assert.match(app,/commentarySeekTarget\(active\.audio,-1\)!==null/);
});

test('live timing only seeks actual retained bytes within one continuous playable range',()=>{
 const app=readFileSync('app.js','utf8');
 const a=app.indexOf('function bufferedLiveSeekTarget('),b=app.indexOf('function simpleLiveStatus(',a);
 assert.ok(a>=0&&b>a);
 const seek=new Function(app.slice(a,b)+';return bufferedLiveSeekTarget')();
 const ranges=(rows)=>({length:rows.length,start:i=>rows[i][0],end:i=>rows[i][1]});
 const video={currentTime:15,readyState:4,seeking:false,ended:false,seekable:ranges([[0,30]]),buffered:ranges([[5,25]])};
 const record={hlsKey:'live/fixture',ready:true};
 assert.equal(seek(video,record,'back'),10);
 assert.equal(seek(video,record,'forward'),20);
 assert.equal(seek(video,record,'latest'),24.25);
 assert.equal(seek({...video,buffered:ranges([[5,11],[14,25]])},record,'back'),null);
 assert.equal(seek({...video,seekable:ranges([[12,30]])},record,'back'),null);
 assert.equal(seek(video,{...record,hlsKey:null},'back'),null);
 assert.equal(seek(video,{...record,preview:true},'back'),null);
 assert.equal(seek(video,{...record,reconnecting:true},'back'),null);
 assert.equal(seek({...video,seeking:true},record,'back'),null);
 assert.equal(seek(video,record,'invalid'),null);
 assert.match(app,/now<\(record.localBufferSeekUntil\|\|0\)/);
 assert.match(app,/stopCommentary\(\);video.currentTime=target;record.localBufferSeekUntil=Date.now\(\)\+20000/);
});
