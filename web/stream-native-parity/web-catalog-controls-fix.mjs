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


 // Display matching items already loaded in this account while the authoritative
 // search scans the server. Never treat these partial results as a full search.
app=change(app," function draw(){\n  if(token!==S.searchToken||S.route!=='search')return;",` var previewKinds={};
 function normalizeLocal(value){
  return String(value||'').toLowerCase().normalize('NFKC')
   .replace(/[\\u064b-\\u065f\\u0670\\u0640]/g,'')
   .replace(/[\\u0622\\u0623\\u0625\\u0671]/g,'ا')
   .replace(/\\u0649/g,'ي').replace(/\\u0624/g,'و').replace(/\\u0626/g,'ي')
 }
 var words=normalizeLocal(q).trim().split(/\\s+/).filter(Boolean);
 kinds.forEach(function(k){
  var seen={},keys=Object.keys(S.loaded);
  for(var x=0;x<keys.length&&responses[k].length<20;x++){
   if(keys[x].indexOf(k+':')!==0)continue;
   var items=S.loaded[keys[x]].items||[];
   for(var y=0;y<items.length&&responses[k].length<20;y++){
    var item=items[y],name=normalizeLocal(item.name||item.title),id=String((k==='series'?item.series_id:item.stream_id)||item.id||'');
    if(!id||seen[id]||!name||!words.length||!words.every(function(w){return name.indexOf(w)>=0}))continue;
    seen[id]=true;responses[k].push(item)
   }
  }
  if(responses[k].length){previewKinds[k]=true;S.loaded[keyOf(k,'search')]={items:responses[k]}}
 });
 function draw(){
  if(token!==S.searchToken||S.route!=='search')return;`);
app=change(app,"  status.textContent=(count?'تم العثور على '+count+' نتيجة':pending?'جار البحث':failed?'تعذر البحث':'لا توجد نتائج')+(pending?' • استكمال باقي المكتبة…':failed&&count?' • تعذر البحث في بعض الأقسام':'')",`  var partial=Object.keys(previewKinds).length>0;
  status.textContent=(count?(partial?'نتائج أولية من المكتبة: ':'تم العثور على ')+count+' نتيجة':pending?'جار البحث':failed?'تعذر البحث':'لا توجد نتائج')+(pending?' • استكمال باقي المكتبة…':failed&&count?' • تعذر البحث في بعض الأقسام؛ النتائج غير مكتملة':'')`);
app=change(app," for(var i=0;i<kinds.length;i++)(function(k){\n  var xhr=pageRequest(k,'all',0,20", " draw();\n for(var i=0;i<kinds.length;i++)(function(k){\n  var xhr=pageRequest(k,'all',0,20");
app=change(app,"    responses[k]=p.items.slice(0,20);","    delete previewKinds[k];\n    responses[k]=p.items.slice(0,20);");


 // Engine replacement resets companion audio before the primary decoder
 // changes its mute state. Keep original sound after recovery.
app=change(app," if(!S.play)return;var old=S.play;S.play=null;"," if(!S.play)return;var old=S.play;S.play=null;\n if(old.kind==='live'&&!old.preview&&S.playerView&&S.playerView.video===old.video&&S.playerView.commentary){S.playerView.commentary.stop()}");
 // Surface catalogue errors inside the visible selection panel, not only
 // in the collapsed More menu. Use textContent for provider-facing labels.
app=change(app,"  if(status)status.textContent=String(message||'');","  if(status)status.textContent=String(message||'');\n  var dialogStatus=document.getElementById('player-commentary-dialog-status');\n  if(dialogStatus)dialogStatus.textContent=String(message||'');");
app=change(app,"   '<div class=\"native-player-choice-items\">'+options.map(function(option,index){","   (heading==='المعلقين • BLOFY'?'<p class=\"small muted\" id=\"player-commentary-dialog-status\" role=\"status\" aria-live=\"polite\"></p>':'')+\n   '<div class=\"native-player-choice-items\">'+options.map(function(option,index){");

new Function(app);
writeFileSync('app.js',app);writeFileSync('server.ts',server);
