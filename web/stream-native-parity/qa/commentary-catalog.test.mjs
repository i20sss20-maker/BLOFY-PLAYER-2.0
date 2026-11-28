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
 const cleanup=server.slice(server.indexOf('function closeAccountMedia('),server.indexOf('function auth('));
 assert.match(cleanup,/if\(!t\)return;[\s\S]*revokeExternal\('Bearer '\+t\)/);
 const logout=server.slice(server.indexOf("if(p==='/api/logout'"),server.indexOf("if(p==='/api/saved-logins'"));
 assert.match(logout,/closeAccountMedia\(token\(req\)\)/);
 assert.match(logout,/for\(const mode of LOGIN_MODES\)closeAccountMedia\(savedToken\(req,mode\)\)/);
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
 const a=app.indexOf('function bufferedLiveRange('),b=app.indexOf('function simpleLiveStatus(',a);
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
 assert.match(app,/stopCommentary\(\);record.userTimeshift=entry\[0\]!=='latest'/);
 assert.match(app,/record.localBufferSeekUntil=Date.now\(\)\+20000;video.currentTime=target/);
});

test('manual commentary picture timing preserves one active audio stream only for a confirmed buffered seek',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function bufferedLiveRange('),b=app.indexOf('function simpleLiveStatus(',a);
 const target=new Function(app.slice(a,b)+';return bufferedLiveSeekTarget')();
 const ranges=rows=>({length:rows.length,start:i=>rows[i][0],end:i=>rows[i][1]});
 const events={},timers=new Map();let tick=0;
 const video={currentTime:15,readyState:4,seeking:false,ended:false,paused:false,muted:false,seekable:ranges([[0,30]]),buffered:ranges([[5,25]]),addEventListener:(name,fn)=>events[name]=fn};
 const state={},transport={hlsKey:'fixture',ready:true,video},S={route:'player',playerView:state,play:transport};
 const document={hidden:false,getElementById:()=>null,addEventListener(){},removeEventListener(){}};
 const fakeAudio={readyState:4,play(){},pause(){},removeAttribute(){},load(){},remove(){}};
 const doc=Object.assign(document,{createElement:()=>fakeAudio});
 const start=app.indexOf('var commentary=null,commentaryEpoch='),end=app.indexOf('var audioButton=',start);
 const run=new Function('S','state','video','document','root','setTimeout','clearTimeout','enc','bufferedLiveSeekTarget',app.slice(start,end)+';return {start:startCommentary,adjust:adjustCommentaryPicture,active:()=>commentary}');
 const controls=run(S,state,video,doc,{appendChild(){}},fn=>{timers.set(++tick,fn);return tick},id=>timers.delete(id),encodeURIComponent,target);
 controls.start({id:'anis-fixture',label:'Fixture'});fakeAudio.onplaying();assert.equal(video.muted,true);
 assert.equal(controls.adjust('back-one'),true);assert.equal(video.currentTime,14);
 events.seeking();assert.ok(controls.active());events.seeked();assert.ok(controls.active());assert.equal(video.muted,true);
 assert.equal(controls.adjust('forward-one'),true);assert.equal(video.currentTime,15);
 video.currentTime=8;events.seeking();assert.equal(controls.active(),null);assert.equal(video.muted,false);
 controls.start({id:'anis-fixture',label:'Fixture'});fakeAudio.onplaying();
 video.buffered=ranges([[8,8.5]]);assert.equal(controls.adjust('back-one'),false);assert.ok(controls.active());
 video.buffered=ranges([[5,25]]);assert.equal(controls.adjust('forward-one'),true);
 const timeout=[...timers.values()].at(-1);timeout();assert.equal(controls.active(),null);assert.equal(video.muted,false);
});

test('live retained range reports only playable seconds and never crosses holes',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function bufferedLiveRange('),b=app.indexOf('function simpleLiveStatus(',a);
 const {range,target}=new Function(app.slice(a,b)+';return {range:bufferedLiveRange,target:bufferedLiveSeekTarget}')();
 const ranges=rows=>({length:rows.length,start:i=>rows[i][0],end:i=>rows[i][1]});
 const video={currentTime:16,readyState:4,seekable:ranges([[0,40]]),buffered:ranges([[4,30]])};
 const record={ready:true,hlsKey:'fixture'};
 assert.deepEqual(range(video,record),{start:4,end:30,at:16,behind:11,ahead:13});
 assert.equal(target(video,record,'back-ten'),6);assert.equal(target(video,record,'forward-ten'),26);
 assert.equal(target(video,record,'earliest'),4.25);assert.equal(target(video,record,'latest'),29.25);
 video.buffered=ranges([[4,12],[14,19],[22,30]]);
 assert.equal(target(video,record,'back-ten'),null);
 assert.equal(target(video,record,'forward-ten'),18.25);
 assert.equal(target(video,record,'earliest'),14.25);
 assert.equal(range(video,{...record,reconnecting:true}),null);
});

test('local Arabic subtitle files convert to safe WebVTT without external resources',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function localSubtitleVtt('),b=app.indexOf('function simpleLiveStatus(',a);
 const convert=new Function(app.slice(a,b)+';return localSubtitleVtt')();
 const source='\uFEFF1\r\n00:00:01,200 --> 00:00:03,400\r\nمرحبا بالعالم\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\n<script> & hello';
 assert.equal(convert(source),'WEBVTT\n\n00:00:01.200 --> 00:00:03.400\nمرحبا بالعالم\n\n00:00:04.000 --> 00:00:06.000\n&lt;script&gt; &amp; hello\n');
 assert.equal(convert('WEBVTT\n\n00:01.000 --> 00:02.000\nاختبار'),'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nاختبار\n');
 assert.equal(convert('1\n00:00:08,000 --> 00:00:01,000\nbad'),null);
 assert.equal(convert('x'.repeat(2*1024*1024+1)),null);
 assert.match(app,/disposeSubtitles=clearLocalSubtitle/);assert.match(app,/URL.revokeObjectURL\(localSubtitle.url\)/);
});

 test('TimeShift can seek retained server segments beyond the locally buffered video',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function liveTimeshiftRange('),b=app.indexOf('// Convert only bounded',a);
 const {liveTimeshiftRange,liveTimeshiftTarget}=new Function(app.slice(a,b)+';return {liveTimeshiftRange,liveTimeshiftTarget}')();
 const ranges=(a,b)=>({length:1,start:()=>a,end:()=>b});
 const video={currentTime:55,seekable:ranges(0,60),buffered:ranges(50,60),readyState:3};
 const record={hlsKey:'fixture',ready:true,engine:{latestLevelDetails:{live:true,fragmentStart:10,edge:60},liveSyncPosition:56}};
 assert.equal(liveTimeshiftTarget(video,record,'back-thirty'),25);
 assert.equal(liveTimeshiftTarget(video,record,'earliest'),10.25);
 assert.equal(liveTimeshiftTarget(video,record,'latest'),56);
 assert.equal(liveTimeshiftTarget(video,record,'forward-thirty'),59.25);
 assert.equal(liveTimeshiftTarget(video,{...record,preview:true},'back'),null);
 assert.equal(liveTimeshiftRange({...video,currentTime:5},record),null);
 });

test('subtitle language labels reflect actual advertised tracks',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function subtitleTrackLabel('),b=app.indexOf('// Convert only bounded',a);
 const label=new Function(app.slice(a,b)+';return subtitleTrackLabel')();
 assert.equal(label('','ara',0),'العربية');assert.equal(label('eng','en-US',1),'الإنجليزية');assert.equal(label('SDH','ar',2),'العربية • SDH');assert.equal(label('','',2),'ترجمة 3');
 assert.match(app,/لا توجد مسارات ترجمة في التشغيل الحالي/);
});
