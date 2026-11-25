import {readFileSync,writeFileSync} from 'node:fs';
let app=readFileSync('app.js','utf8'),server=readFileSync('server.ts','utf8');
function change(s,a,b){if(s.split(a).length!==2)throw Error('Unexpected source: '+a);return s.replace(a,b)}
const edits=[
["['commentators','🎙','المعلقين'],",""],
["else if(route==='commentators')commentatorsScreen();","else if(route==='commentators'){S.route='live';catalog('live')}"],
["xhr.timeout=40000;","xhr.timeout=method==='GET'&&endpoint.indexOf('/api/page?')===0&&endpoint.indexOf('&query=')>=0?115000:40000;"],
["function searchNow(q,token){\n var old=","function searchNow(q,token){\n if(token!==S.searchToken||S.route!=='search')return;\n if(S.searchTimer){clearTimeout(S.searchTimer);S.searchTimer=null}\n var old="],
["if(!isLive||!state.commentary)return;","if(!isLive)return;\n if(!state.commentary){showPlayerChoices('المعلقين • BLOFY',embeddedCommentaryChoices({current:function(){return ''},select:function(){}}),origin);return}"],
["var engine=S.play&&S.play.engine,list=[],native=video.textTracks;","var engine=S.play&&S.play.video===video&&S.play.engine,list=[],native=video.textTracks;"],
["  if(list.length){\n   options.push({name:'إيقاف الترجمة'","  if(list.length&&!(engine&&engine.subtitleTracks&&engine.subtitleTracks.length)){\n   options.push({name:'إيقاف الترجمة'"],
["select:function(){engine.subtitleDisplay=false;engine.subtitleTrack=-1;playerStatus('تم إيقاف الترجمة')}","select:function(){engine.subtitleDisplay=false;engine.subtitleTrack=-1;for(var n=0;n<list.length;n++)list[n].mode='disabled';playerStatus('تم إيقاف الترجمة')}"],
["  showPlayerChoices('الترجمة',options,this)","  if(!options.length){playerStatus('لا توجد ترجمة متاحة من مصدر هذا المحتوى حاليًا.');return}\n  showPlayerChoices('الترجمة',options,this)"]
];
for(const [a,b] of edits)app=change(app,a,b);
server=change(server,"(!query||normalizeSearch(item.name||item.title||'').includes(query))","(!query||query.split(/\\s+/).every(word=>normalizeSearch(item.name||item.title||'').includes(word)))");

// Guard first-picture startup against the browser's initial paused state,
// but do not fight a real user pause or autoplay-policy rejection.
const begin=app.indexOf('function playHls('),end=app.indexOf('function playFullVod(',begin);
if(begin<0||end<=begin)throw Error('HLS section unavailable');
let hls=app.slice(begin,end);
hls=change(hls,"if(!alive()||record.reconnecting||liveRetryPending(record))return;","if(!alive()||record.reconnecting||liveRetryPending(record))return;\n  if(!preview&&S.playerView&&S.playerView.video===video&&S.playerView.userPaused)return;");
hls=change(hls," record.startupTimer=setTimeout(function(){\n  record.startupTimer=null;\n  if(!alive()||record.ready||video.paused||liveRetryPending(record))return;\n  recoverConnection()\n },50000);",` function checkStartup(){
  record.startupTimer=null;
  if(!alive()||record.ready||!video.isConnected)return;
  var userPaused=!preview&&S.playerView&&S.playerView.video===video&&S.playerView.userPaused;
  if(userPaused||document.hidden||navigator.onLine===false||record.awaitingPlayGesture||liveRetryPending(record)){
   record.startupTimer=setTimeout(checkStartup,5000);return
  }
  if(Date.now()<(record.startupDeadline||0)){
   record.startupTimer=setTimeout(checkStartup,5000);return
  }
  recoverConnection()
 }
 record.startupDeadline=Date.now()+50000;
 record.startupTimer=setTimeout(checkStartup,50000);
 function noteGestureError(error){
  if(alive()&&error&&error.name==='NotAllowedError'&&!preview)record.awaitingPlayGesture=true;
  return offerIosPlayGesture(error,video,preview)
 }`);
const marker="return offerIosPlayGesture(error,video,preview)";
hls=hls.replaceAll("offerIosPlayGesture(error,video,preview)","noteGestureError(error)").replaceAll("offerIosPlayGesture(e,video,preview)","noteGestureError(e)");
hls=change(hls,"return noteGestureError(error)","return offerIosPlayGesture(error,video,preview)");
hls=change(hls,"record.ready=true;record.retries=0;","record.ready=true;record.awaitingPlayGesture=false;record.retries=0;");
app=app.slice(0,begin)+hls+app.slice(end);
const resume="if(S.play&&S.play.video===video&&S.play.hlsKey&&!S.play.ready){S.play.awaitingPlayGesture=false;S.play.startupDeadline=Date.now()+50000}";
app=change(app,"  hideIosPlayGesture();\n  try{\n   var promise=video.play();","  hideIosPlayGesture();\n  "+resume+"\n  try{\n   var promise=video.play();");
app=change(app,"   state.userPaused=false;\n   try{\n    var p=video.play();","   state.userPaused=false;\n   "+resume+"\n   try{\n    var p=video.play();");
// A new policy denial during an explicit retry must still defer the watchdog.
app=change(app,"    if(!promptIosPlay(error))playerStatus('تعذر تشغيل الوسائط؛ استخدم إعادة المحاولة.',true)","    if(error&&error.name==='NotAllowedError'&&S.play&&S.play.video===video)S.play.awaitingPlayGesture=true;\n    if(!promptIosPlay(error))playerStatus('تعذر تشغيل الوسائط؛ استخدم إعادة المحاولة.',true)");

new Function(app);
writeFileSync('app.js',app);writeFileSync('server.ts',server);
