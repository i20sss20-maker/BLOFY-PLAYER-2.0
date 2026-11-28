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

test('subtitle language labels reflect actual advertised tracks',()=>{
 const app=readFileSync('app.js','utf8'),a=app.indexOf('function subtitleTrackLabel('),b=app.indexOf('// Convert only bounded',a);
 const label=new Function(app.slice(a,b)+';return subtitleTrackLabel')();
 assert.equal(label('','ara',0),'العربية');assert.equal(label('eng','en-US',1),'الإنجليزية');assert.equal(label('SDH','ar',2),'العربية • SDH');assert.equal(label('','',2),'ترجمة 3');
 assert.match(app,/لا توجد مسارات ترجمة في التشغيل الحالي/);
});

test('commentary suspends when hidden and resumes only the same live channel',()=>{
 const app=readFileSync('app.js','utf8'),start=app.indexOf('var commentary=null,commentaryEpoch='),end=app.indexOf('var audioButton=',start);
 const events={},docEvents={};const timers=new Map();let tick=0;
 const video={readyState:4,paused:false,seeking:false,muted:false,addEventListener:(n,f)=>events[n]=f};
 const state={id:'123'},S={route:'player',playerView:state};
 const audio={play(){},pause(){},removeAttribute(){},load(){},remove(){}};
 const doc={hidden:false,getElementById:()=>null,createElement:()=>audio,addEventListener:(n,f)=>docEvents[n]=f,removeEventListener(){}};
 const controls=new Function('S','state','video','document','root','setTimeout','clearTimeout','enc','bufferedLiveSeekTarget',app.slice(start,end)+';return {start:startCommentary,active:()=>commentary}')(S,state,video,doc,{appendChild(){}},f=>{timers.set(++tick,f);return tick},id=>timers.delete(id),encodeURIComponent,()=>null);
 controls.start({id:'anis-fixture',label:'Fixture'});audio.onplaying();assert.equal(video.muted,true);
 doc.hidden=true;docEvents.visibilitychange();assert.equal(controls.active(),null);assert.equal(video.muted,false);
 events.pause();doc.hidden=false;docEvents.visibilitychange();assert.ok(controls.active());audio.onplaying();assert.equal(video.muted,true);
 doc.hidden=true;docEvents.visibilitychange();state.id='456';doc.hidden=false;docEvents.visibilitychange();assert.equal(controls.active(),null);
 controls.start({id:'anis-fixture',label:'Fixture'});audio.onplaying();doc.hidden=true;docEvents.visibilitychange();state.disposeCommentary();doc.hidden=false;docEvents.visibilitychange();assert.equal(controls.active(),null);
});


test('live TimeShift and picture seeking removed while commentary and VOD remain',()=>{
 const app=readFileSync('app.js','utf8');
 assert.doesNotMatch(app,/player-timeshift|player-live-buffer|mobile-player-timing|openLiveTiming|adjustCommentaryPicture|liveTimeshiftTarget|setLiveTimeshiftMode/);
 assert.match(app,/video.addEventListener\('seeking',stopCommentary\)/);
 assert.match(app,/commentarySeekTarget\(active.audio,-1\)/);
 assert.match(app,/player-skip-forward/);
});
