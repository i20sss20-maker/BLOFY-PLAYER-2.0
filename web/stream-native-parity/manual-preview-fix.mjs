import {readFileSync,writeFileSync} from 'node:fs';
let app=readFileSync('app.js','utf8');
function change(a,b){if(app.split(a).length!==2)throw Error('Unexpected source '+a);app=app.replace(a,b)}
change("if(desc)desc.textContent='معاينة '+title(item)+' • التشغيل تلقائي عند التحديد';","if(desc)desc.textContent='معاينة '+title(item)+' • تبدأ تلقائيًا عند استقرار التحديد';");
change(" if(activate)beginPreview(item)",` if(S.autoPreviewTimer){clearTimeout(S.autoPreviewTimer);S.autoPreviewTimer=null}
 if(activate&&!S.previewToFullPending){
  var selectedVideo=document.getElementById('live-video');
  S.autoPreviewTimer=setTimeout(function(){
   S.autoPreviewTimer=null;
   if(S.route==='live'&&String(S.selected)===String(id)&&!S.previewToFullPending&&selectedVideo&&selectedVideo.isConnected&&document.getElementById('live-video')===selectedVideo)beginPreview(item)
  },800)
 }`);
change("function beginPreview(item){","function beginPreview(item){\n if(S.autoPreviewTimer){clearTimeout(S.autoPreviewTimer);S.autoPreviewTimer=null}\n if(S.previewToFullPending)return;");
change("function openPlayer(kind,id,extension,name,from,replacePlayerHistory){","function openPlayer(kind,id,extension,name,from,replacePlayerHistory){\n if(S.autoPreviewTimer){clearTimeout(S.autoPreviewTimer);S.autoPreviewTimer=null}");
change(" if(isLive&&oldPreview&&oldPreview.preview&&(\n  oldPreview.hlsKey===fullKey||oldPreview.hlsKey===fullKey+'/compat'||\n  (oldPreview.hlsKey||'').indexOf(fullKey+'/sid-')===0)){"," if(isLive&&S.previewStopPending){var pendingStatus=document.getElementById('live-status');if(pendingStatus)pendingStatus.textContent='جار إنهاء اتصال المعاينة؛ أعد الضغط بعد اكتماله.';return}\n if(isLive&&oldPreview&&oldPreview.preview&&oldPreview.hlsKey){");

 // The HLS recovery STOP is also a pending preview handoff. Without this
 // guard a new selection can start while the recovering decoder is draining.
change("   if(preview)S.livePreview=String(id);\n   playHls(video,kind,id,extension,track,statusElement,preview,recoveryAttempt)","   if(preview)S.livePreview=String(id);\n   playHls(video,kind,id,extension,track,statusElement,preview,recoveryAttempt)");
change("  var token=(S.hlsStopEpoch||0)+1;S.hlsStopEpoch=token;\n  stopPlayback(false);","  var token=(S.hlsStopEpoch||0)+1;S.hlsStopEpoch=token;\n  if(preview)S.previewRecoveryStop=token;\n  stopPlayback(false);");
change("   if(settled)return;settled=true;clearTimeout(timer);\n   if(S.hlsStopEpoch!==token||!video.isConnected||!S.userVerified)return;","   if(settled)return;settled=true;clearTimeout(timer);\n   if(preview&&S.previewRecoveryStop===token){\n    S.previewRecoveryStop=null;\n    var queued=S.previewRecoveryItem;S.previewRecoveryItem=null;\n    if(queued&&S.route==='live'&&video.isConnected&&S.userVerified&&String(itemId(queued,'live'))===String(S.selected)){\n     if(status===200||status===404){beginPreview(queued)}else if(statusElement)statusElement.textContent='تعذر إنهاء الاتصال السابق؛ أعد المحاولة.';\n     return\n    }\n   }\n   if(S.hlsStopEpoch!==token||!video.isConnected||!S.userVerified)return;");
change(" if(S.previewToFullPending)return;\n var video=document.getElementById('live-video')"," if(S.previewToFullPending)return;\n if(S.previewRecoveryStop){S.previewRecoveryItem=item;return}\n var video=document.getElementById('live-video')");
change(" if(isLive&&S.previewStopPending){"," if(isLive&&(S.previewStopPending||S.previewRecoveryStop)){");


 // Hls.startLoad alone cannot recover an initial failed manifest: no
 // level exists yet. Reload that manifest on the same authenticated SID.
change("function playHls(",`function resumeLiveHlsNetwork(engine,manifest,record){
 if(!record.manifestParsed)engine.loadSource(manifest);
 else engine.startLoad()
}
function playHls(`);
change("engine.on(window.Hls.Events.MANIFEST_PARSED,function(){if(!alive())return;try{var p=video.play();","engine.on(window.Hls.Events.MANIFEST_PARSED,function(){if(!alive())return;record.manifestParsed=true;try{var p=video.play();");
change("    var code=Number(detail.response&&detail.response.code)||0;","    var code=Number(detail.response&&detail.response.code||detail.networkDetails&&detail.networkDetails.status)||0;");
change("    if(record.ultra&&(code===429||code===503)&&setCompatibility(true,true))return;","    // Capacity/source errors are not codec errors. Keep the original quality.");
change("      try{engine.startLoad()}catch(e){recoverConnection()}\n     },delay);\n     return\n    }\n    if((code===502","      try{resumeLiveHlsNetwork(engine,manifest,record)}catch(e){recoverConnection()}\n     },delay);\n     return\n    }\n    if((code===502");
change("      try{engine.startLoad()}catch(e){recoverConnection()}\n     },delay);\n     return\n    }\n    if((record.transientRetries","      try{resumeLiveHlsNetwork(engine,manifest,record)}catch(e){recoverConnection()}\n     },delay);\n     return\n    }\n    if((record.transientRetries");
change("      try{engine.startLoad()}catch(e){recoverConnection()}\n     },pause);","      try{resumeLiveHlsNetwork(engine,manifest,record)}catch(e){recoverConnection()}\n     },pause);");


 // A vanished segment/session cannot be recovered by retrying its old URL.
 // A fresh SID is created only after the old session's STOP is confirmed.
change("function resumeLiveHlsNetwork(",`function liveSessionLost(record,detail,code){
 if(!record.manifestParsed||!detail||!detail.fatal)return false;
 if(code===404)return !!detail.frag||/fragLoad/i.test(String(detail.details||''));
 return code===503&&/manifestLoad|levelLoad/i.test(String(detail.details||''))
}
function liveSessionRetryDelay(attempt,retryAfter){
 var seconds=Number(retryAfter);
 return Math.max(attempt>=4?25000:Math.min(15000,5000+attempt*2500),
  Number.isFinite(seconds)&&seconds>=1&&seconds<=30?seconds*1000:0)
}
function resumeLiveHlsNetwork(`);
change("    if(!detail.fatal)return;\n    diagnose('live','hls_error','video',0);",`    if(!detail.fatal||record.reconnecting)return;
    diagnose('live','hls_error','video',0);
    if(detail.type===window.Hls.ErrorTypes.NETWORK_ERROR&&liveSessionLost(record,detail,code)){
     record.reconnecting=true;
     var attempt=record.recoveryAttempt||0,retryAfter=0;
     try{
      var network=detail.networkDetails;
      if(network&&typeof network.getResponseHeader==='function')retryAfter=network.getResponseHeader('Retry-After');
      else if(network&&network.headers&&network.headers.get)retryAfter=network.headers.get('Retry-After')
     }catch(e){}
     var delay=liveSessionRetryDelay(attempt,retryAfter);
     if(record.startupTimer)clearTimeout(record.startupTimer);
     if(record.stallTimer)clearTimeout(record.stallTimer);
     if(record.progressWatchdog)clearInterval(record.progressWatchdog);
     if(record.stableTimer)clearTimeout(record.stableTimer);
     if(record.retryTimer)clearTimeout(record.retryTimer);
     if(record.capacityTimer)clearTimeout(record.capacityTimer);
     if(record.originTimer)clearTimeout(record.originTimer);
     try{engine.stopLoad()}catch(e){}
     status('انتهت جلسة المصدر؛ جار استعادة البث خلال '+Math.ceil(delay/1000)+' ثوانٍ…');
     record.originTimer=setTimeout(function(){
      record.originTimer=null;
      if(!alive()||!video.isConnected)return;
      if(preview&&(S.route!=='live'||String(S.selected)!==String(id)))return;
      if(!preview&&(S.route!=='player'||!S.playerView||S.playerView.video!==video||String(S.playerView.id)!==String(id)||S.playerView.userPaused))return;
      playHls(video,kind,id,extension,track,statusElement,preview,attempt>=4?0:attempt+1)
     },delay);
     return
    }`);

change("   engine.on(window.Hls.Events.FRAG_LOADED,function(){\n    if(alive()){","   engine.on(window.Hls.Events.FRAG_LOADED,function(){\n    if(alive()&&!record.reconnecting){");

 // A modest extra segment of latency cushions short provider reconnects.
 // Preview remains responsive; neither native HLS nor VOD is changed.
change("function resumeLiveHlsNetwork(",`function liveBufferProfile(preview){
 return preview?{sync:4,maxLatency:10,buffer:35}:{sync:5,maxLatency:12,buffer:45}
}
function resumeLiveHlsNetwork(`);
change("   var engine=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,liveSyncDurationCount:4,liveMaxLatencyDurationCount:10,maxBufferLength:35,maxBufferHole:1.5,","   var bufferProfile=liveBufferProfile(preview);\n   var engine=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,liveSyncDurationCount:bufferProfile.sync,liveMaxLatencyDurationCount:Infinity,maxBufferLength:bufferProfile.buffer,maxBufferHole:1.5,");
 // A watchdog must never cancel an intentional delayed source recovery.
change(" if(!alive()||record.ready||video.paused)return;\n  recoverConnection()"," if(!alive()||record.ready||record.reconnecting||video.paused)return;\n  recoverConnection()");
change("   if(!alive()||!record.ready||!video.isConnected)return;\n   if(preview&&","   if(!alive()||!record.ready||record.reconnecting||!video.isConnected)return;\n   if(preview&&");


 // Resync must never seek backwards: an expired playlist can advertise a
 // live edge behind the actual current decoder position.
change("(!Number.isFinite(current)||edge-current>2)","Number.isFinite(current)&&edge-current>2");
change("   if(!alive()||!detail)return;\n    var code=Number(detail.response","   if(!alive()||!detail)return;\n    var code=Number(detail.response");
 // Track monotonic playlist sequence within one HLS SID. A reset signals
 // that a source/worker session was recreated under the same URL.
change("function liveBufferProfile(preview){",`function liveSequenceRegressed(record,details){
 if(!details||details.live===false||details.startSN===null||details.startSN===undefined||details.endSN===null||details.endSN===undefined)return false;
 var first=Number(details.startSN),last=Number(details.endSN);
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||first<0||last<first)return false;
 if(Number.isSafeInteger(record.highestLiveEndSN)&&last<record.highestLiveEndSN)return true;
 record.highestLiveEndSN=last;
 return false
}
function liveBufferProfile(preview){`);
change("   engine.on(window.Hls.Events.MANIFEST_PARSED,function(){if(!alive())return;record.manifestParsed=true;",`   engine.on(window.Hls.Events.LEVEL_LOADED,function(event,data){
    if(!alive()||record.reconnecting||!liveSequenceRegressed(record,data&&data.details))return;
    // Stop stale segment loading before asking for a new authenticated SID.
    record.reconnecting=true;
    if(record.startupTimer)clearTimeout(record.startupTimer);
    if(record.stallTimer)clearTimeout(record.stallTimer);
    if(record.progressWatchdog)clearInterval(record.progressWatchdog);
    if(record.stableTimer)clearTimeout(record.stableTimer);
    if(record.retryTimer)clearTimeout(record.retryTimer);
    if(record.capacityTimer)clearTimeout(record.capacityTimer);
    if(record.originTimer)clearTimeout(record.originTimer);
    try{engine.stopLoad()}catch(e){}
    status('تغيّر تسلسل البث؛ جار العودة إلى البث المباشر…');
    var attempt=record.recoveryAttempt||0;
    record.originTimer=setTimeout(function(){
     record.originTimer=null;
     if(!alive()||!video.isConnected)return;
     if(preview&&(S.route!=='live'||String(S.selected)!==String(id)))return;
     if(!preview&&(S.route!=='player'||!S.playerView||S.playerView.video!==video||String(S.playerView.id)!==String(id)||S.playerView.userPaused))return;
     playHls(video,kind,id,extension,track,statusElement,preview,attempt>=4?0:attempt+1)
    },liveSessionRetryDelay(attempt,0))
   });
   engine.on(window.Hls.Events.MANIFEST_PARSED,function(){if(!alive())return;record.manifestParsed=true;`);


change("function liveSessionRetryDelay(attempt,retryAfter){",`function liveRetryHint(detail){
 try{
  var n=detail&&detail.networkDetails;
  var raw=n&&typeof n.getResponseHeader==='function'?n.getResponseHeader('Retry-After'):
   n&&n.headers&&typeof n.headers.get==='function'?n.headers.get('Retry-After'):null;
  var seconds=Number(raw);
  return Number.isInteger(seconds)&&seconds>=1&&seconds<=30?seconds*1000:0
 }catch(e){return 0}
}
function liveSessionRetryDelay(attempt,retryAfter){`);
change("var delay=liveCapacityRetryMs(record.capacityRetries);","var delay=Math.max(liveCapacityRetryMs(record.capacityRetries),liveRetryHint(detail));");
change("var delay=liveOriginRetryMs(record.originRetries);","var delay=Math.max(liveOriginRetryMs(record.originRetries),liveRetryHint(detail));");
change("var pause=liveTransientRetryMs(record.transientRetries);","var pause=Math.max(liveTransientRetryMs(record.transientRetries),liveRetryHint(detail));");


 // HLS.js maxBufferLength is a target, not a ceiling. Cap forward
 // buffering and evict old decoded data during long TV sessions.
 // Apply only to the established live HLS engine, never VOD.
change("maxBufferLength:bufferProfile.buffer,maxBufferHole:1.5,","maxBufferLength:bufferProfile.buffer,maxMaxBufferLength:preview?45:60,backBufferLength:preview?12:30,maxBufferHole:1.5,");


// Aborted XHR must release the STOP accounting exactly once too.
change(" xhr.onerror=xhr.ontimeout=function(){if(!done){done=true;finishMediaStop();"," xhr.onerror=xhr.ontimeout=xhr.onabort=function(){if(!done){done=true;finishMediaStop();");


change("function liveRetryHint(detail){",`function liveStartupDecision(record,context){
 if(!context.active||record.ready||record.reconnecting||context.userPaused||record.autoplayBlocked)return 'stop';
 if(context.hidden||context.offline||record.retryTimer||record.capacityTimer||record.originTimer)return 'defer';
 // A decoder may remain paused while waiting for media, even without a
 // user pause or autoplay restriction. That is not a reason to give up.
 return 'recover'
}
function liveRetryHint(detail){`);
change(" record.startupTimer=setTimeout(function(){\n  record.startupTimer=null;\n  if(!alive()||record.ready||record.reconnecting||video.paused)return;\n  recoverConnection()\n },50000);",` function startupCheck(){
  record.startupTimer=null;
  var decision=liveStartupDecision(record,{active:alive()&&video.isConnected&&
   (preview?S.route==='live'&&String(S.selected)===String(id):
    S.route==='player'&&S.playerView&&S.playerView.video===video&&String(S.playerView.id)===String(id)),
   userPaused:!preview&&S.playerView&&S.playerView.userPaused,
   hidden:document.hidden,offline:navigator.onLine===false});
  if(decision==='defer'){record.startupTimer=setTimeout(startupCheck,10000);return}
  if(decision==='recover')recoverConnection()
 }
 record.startupTimer=setTimeout(startupCheck,50000);
 function handleLivePlayRejection(error){
  if(!alive())return;
  if(error&&error.name==='NotAllowedError'){
   record.autoplayBlocked=true;
   status('اضغط تشغيل ▶');
  }
 }`);
change("if(p&&p.catch)p.catch(function(){status('اضغط ▶ في المشغّل')})","if(p&&p.catch)p.catch(handleLivePlayRejection)");
change("record.manifestParsed=true;try{var p=video.play();if(p&&p.catch)p.catch(function(){status('اضغط تشغيل ▶')})}","record.manifestParsed=true;try{var p=video.play();if(p&&p.catch)p.catch(handleLivePlayRejection)}");
change("  record.ready=true;record.retries=0;record.stallChecks=0;record.bufferSince=0;","  record.autoplayBlocked=false;record.ready=true;record.retries=0;record.stallChecks=0;record.bufferSince=0;");


change("window.addEventListener('pagehide',persistPlaybackCheckpoint);",`// Full navigation/close must release this browser's unique live HLS SID.
// A hidden tab or bfcache page is not an abandoned viewer.
function releaseLiveOnPageExit(event){
 if(event&&event.persisted)return false;
 var record=S.play;
 if(!record||record.kind!=='live'||!record.hlsKey||
    !/^live\\/[^/]+\\/[^/]+\\/[^/]+\\/sid-[a-zA-Z0-9_-]+(?:\\/(?:compat|ultra))?$/.test(record.hlsKey))return false;
 var url='/api/hls/'+record.hlsKey+'/stop';
 stopPlayback(false);
 try{
  if(typeof navigator.sendBeacon==='function'&&navigator.sendBeacon(url,'{}'))return true
 }catch(e){}
 try{
  if(typeof fetch==='function'){
   fetch(url,{method:'POST',credentials:'same-origin',keepalive:true,body:'{}',headers:{'Content-Type':'application/json'}}).catch(function(){});
   return true
  }
 }catch(e){}
 api('POST',url,{},function(){});
 return true
}
window.addEventListener('pagehide',function(event){
 persistPlaybackCheckpoint();
 releaseLiveOnPageExit(event)
});`);


change("function playDirectMpegts(video,id,statusElement){",`// Desktop full-screen can use the same authenticated TS gateway as native
// clients, avoiding an unnecessary per-viewer HLS encoding pipeline.
// Keep the proven HLS path for TV, touch devices, and unsupported MSE.
function preferDesktopDirectLive(family,mediaSource){
 if(family!=='desktop'||!mediaSource||typeof mediaSource.isTypeSupported!=='function')return false;
 try{return mediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"')===true}catch(e){return false}
}
function playDirectMpegts(video,id,statusElement){`);
change(" if(isLive){playHls(video,kind,id,'ts',0,document.getElementById('player-status'),false)}",` if(isLive){
  var family=document.documentElement.getAttribute('data-blofy-device');
  if(preferDesktopDirectLive(family,window.MediaSource))
   playDirectMpegts(video,String(id),document.getElementById('player-status'));
  else playHls(video,kind,id,'ts',0,document.getElementById('player-status'),false)
 }`);
change("    transport.on(window.mpegts.Events.ERROR,function(){\n     if(alive())fallback('تعذر فك ترميز MPEG-TS من المصدر؛ جار تجربة مشغّل HLS.')\n    });",`    transport.on(window.mpegts.Events.ERROR,function(type,detail,info){
     if(!alive())return;
     var statusCode=Number(info&&(info.code||info.status)||0);
     // Admission failures are not decoder failures. Do not create another
     // source request via HLS immediately when the provider is busy.
     if(statusCode===429||statusCode===503){
      stopPlayback(false);
      playerStatus('مصدر القناة مشغول مؤقتًا. اضغط إعادة المحاولة بعد لحظات.',true);
      return
     }
     fallback('تعذر فك ترميز MPEG-TS من المصدر؛ جار تجربة مشغّل HLS.')
    });`);


change("function playDirectMpegts(video,id,statusElement){",`function resumeSelectedLiveTransport(state,video,statusElement){
 if(!state||state.directStopPending)return;
 if(state.mode==='mpegts')playDirectMpegts(video,String(state.id),statusElement);
 else playHls(video,'live',String(state.id),'ts',0,statusElement,false,0)
}
function playDirectMpegts(video,id,statusElement){`);
change(" var old=S.play,oldKey=old&&old.hlsKey;\n if(oldKey){\n  stopPlayback(false);",` var requestedState=S.playerView;
 if(requestedState.directStopPending)return;
 var old=S.play,oldKey=old&&old.hlsKey;
 if(oldKey){
  requestedState.directStopPending=true;
  stopPlayback(false);`);
change("   if(settled)return;settled=true;clearTimeout(timer);\n   if(epoch!==S.accountEpoch||S.route!=='player'||!S.playerView||\n      S.playerView.video!==video||String(S.playerView.id)!==String(id))return;",`   if(settled)return;settled=true;clearTimeout(timer);
   requestedState.directStopPending=false;
   if(epoch!==S.accountEpoch||S.route!=='player'||S.playerView!==requestedState||
      requestedState.video!==video||!video.isConnected)return;`);
change("   playDirectMpegts(video,id,statusElement)\n  }\n  api('POST','/api/hls/'+oldKey+'/stop'", "   playDirectMpegts(video,String(requestedState.id),statusElement)\n  }\n  api('POST','/api/hls/'+oldKey+'/stop'");
change(" if(directTsButton)directTsButton.onclick=function(){\n  if(S.route!=='player'||S.playerView!==state)return;", " if(directTsButton)directTsButton.onclick=function(){\n  if(S.route!=='player'||S.playerView!==state||state.directStopPending)return;");
change("  if(isLive)playHls(video,kind,id,'ts',0,document.getElementById('player-status'),false);","  if(isLive)resumeSelectedLiveTransport(state,video,document.getElementById('player-status'));");
change("    playHls(video,'live',id,'ts',0,document.getElementById('player-status'),false);\n    if(state.refreshLiveGuide)state.refreshLiveGuide()", "    resumeSelectedLiveTransport(state,video,document.getElementById('player-status'));\n    if(state.refreshLiveGuide)state.refreshLiveGuide()");


change("    enableWorker:false,enableStashBuffer:true,stashInitialSize:131072,\n    lazyLoad:false,autoCleanupSourceBuffer:true,autoCleanupMaxBackwardDuration:30",`    enableWorker:false,enableStashBuffer:true,stashInitialSize:393216,
    liveBufferLatencyChasing:false,liveSync:false,
    lazyLoad:false,autoCleanupSourceBuffer:true,autoCleanupMaxBackwardDuration:45,
    autoCleanupMinBackwardDuration:15`);


change("function playDirectMpegts(video,id,statusElement){",`function directLiveRetryDelay(attempt,capacity){
 var n=Math.max(0,Math.min(4,Number(attempt)||0));
 return capacity?Math.min(30000,5000*Math.pow(2,n)):Math.min(20000,2000*Math.pow(2,n))
}
function playDirectMpegts(video,id,statusElement,recoveryAttempt){`);
change("  mode:'mpegts',engine:null,ready:false,started:Date.now(),fallback:false};",
 "  mode:'mpegts',engine:null,ready:false,started:Date.now(),fallback:false,recoveryAttempt:Math.max(0,Number(recoveryAttempt)||0),reconnecting:false};");
change(" function fallback(msg){\n  if(!alive()||record.fallback)return;",` function retryDirect(capacity){
  if(!alive()||record.reconnecting||record.fallback)return;
  if(!capacity&&record.recoveryAttempt>=2){fallback('تعذر استعادة النقل المباشر؛ جار تجربة HLS.');return}
  record.reconnecting=true;
  countVisualOutage(record,video,Date.now());
  if(record.startupTimer)clearTimeout(record.startupTimer);
  if(record.stallTimer)clearTimeout(record.stallTimer);
  if(record.progressWatchdog)clearInterval(record.progressWatchdog);
  if(record.stableTimer)clearTimeout(record.stableTimer);
  // Stop the direct fetch before waiting. Keep the record as a cancellation
  // token so route changes and manual retry invalidate the scheduled attempt.
  var previousEngine=record.engine;record.engine=null;
  try{if(previousEngine)previousEngine.destroy()}catch(e){}
  try{video.pause();video.removeAttribute('src');video.load()}catch(e){}
  var delay=directLiveRetryDelay(record.recoveryAttempt,capacity);
  playerStatus(capacity?'مصدر القناة مشغول مؤقتًا؛ إعادة اتصال تلقائية…':'انقطع النقل المباشر؛ جار استعادة الاتصال…',true);
  function resume(){
   record.retryTimer=null;
   if(!alive())return;
   if(document.hidden||navigator.onLine===false||state.userPaused){
    record.retryTimer=setTimeout(resume,3000);return
   }
   if(state.stats){state.stats.recoveries=(state.stats.recoveries||0)+1;state.stats.lastRecoveryAt=Date.now()}
   recordLiveIncident('reconnect');
   playDirectMpegts(video,id,statusElement,Math.min(4,record.recoveryAttempt+1))
  }
  record.retryTimer=setTimeout(resume,delay)
 }
 function fallback(msg){
  if(!alive()||record.fallback||record.reconnecting)return;`);
change("     if(!alive())return;\n     var statusCode=Number(info&&(info.code||info.status)||0);", "     if(!alive()||record.reconnecting)return;\n     var statusCode=Number(info&&(info.code||info.status)||0);");
change("     if(statusCode===429||statusCode===503){\n      stopPlayback(false);\n      playerStatus('مصدر القناة مشغول مؤقتًا. اضغط إعادة المحاولة بعد لحظات.',true);\n      return\n     }",`     if(statusCode===429||statusCode===503){retryDirect(true);return}
     if(type===window.mpegts.ErrorTypes?.NETWORK_ERROR||/network/i.test(String(type))||statusCode===502||statusCode===504){retryDirect(false);return}`);
change("    if(!alive())return;\n    record.ready=true;\n    record.lastProgressAt=Date.now();",`    if(!alive()||record.reconnecting)return;
    record.ready=true;
    if(record.stableTimer)clearTimeout(record.stableTimer);
    record.stableTimer=setTimeout(function(){if(alive()&&!record.reconnecting&&record.visualProgressSeen)record.recoveryAttempt=0},120000);
    record.lastProgressAt=Date.now();`);
change("if(Math.abs((Number(video.currentTime)||0)-last)<0.3)fallback('توقفت الصورة المباشرة؛ جار التحويل إلى HLS.')","if(Math.abs((Number(video.currentTime)||0)-last)<0.3)retryDirect(false)");
change("     fallback('تجمّدت صورة MPEG-TS؛ جار العودة إلى HLS.')","     retryDirect(false)");
change("type===window.mpegts.ErrorTypes?.NETWORK_ERROR","(window.mpegts.ErrorTypes&&type===window.mpegts.ErrorTypes.NETWORK_ERROR)");


change("   record.retryTimer=setTimeout(function(){\n    record.retryTimer=null;\n    if(!alive()||S.route!=='player'||!video.isConnected||state.userPaused)return;\n    // A decoder may set video.paused=true on a fatal error without user input.\n    playHls(video,kind,id,extension,track,statusElement,false,0)\n   },25000);",`   function resumeHlsRecovery(){
    record.retryTimer=null;
    if(!alive()||S.route!=='player'||!video.isConnected)return;
    if(state.userPaused||document.hidden||navigator.onLine===false){
     record.retryTimer=setTimeout(resumeHlsRecovery,3000);return
    }
    playHls(video,kind,id,extension,track,statusElement,false,0)
   }
   record.retryTimer=setTimeout(resumeHlsRecovery,25000);`);
change("  if(video.paused){\n   state.userPaused=false;\n   var p=video.play();if(p&&p.catch)p.catch(function(){})",`  if(video.paused){
   state.userPaused=false;
   if(isLive&&S.play&&S.play.video===video&&S.play.reconnecting){
    resumeSelectedLiveTransport(state,video,document.getElementById('player-status'));return
   }
   var p=video.play();if(p&&p.catch)p.catch(function(){})`);


change("function resumeSelectedLiveTransport(state,video,statusElement){",`// Safari iPad desktop UA can still be classified as touch. Check the
// actual media API rather than excluding it from the direct TS path.
function directLiveMediaSource(win){
 var candidates=[win.ManagedMediaSource,win.MediaSource];
 for(var i=0;i<candidates.length;i++){
  var m=candidates[i];
  if(preferDesktopDirectLive('desktop',m))return m
 }
 return null
}
function preferDirectLiveForDevice(family,ua,win){
 var media=directLiveMediaSource(win);
 if(!media||family==='tv')return false;
 if(family==='desktop')return true;
 return family==='touch'&&/Safari/i.test(String(ua||''))&&
  /iPhone|iPad|iPod|Macintosh/i.test(String(ua||''))&&
  !/CriOS|FxiOS|EdgiOS/i.test(String(ua||''))
}
function resumeSelectedLiveTransport(state,video,statusElement){`);
change(" if(!window.MediaSource||!window.MediaSource.isTypeSupported){\n  fallback('هذا التلفزيون لا يدعم محرك MPEG-TS المباشر؛ جار تشغيل HLS.');return", " if(!directLiveMediaSource(window)){\n  fallback('هذا الجهاز لا يدعم محرك MPEG-TS المباشر؛ جار تشغيل HLS.');return");
change("  if(preferDesktopDirectLive(family,window.MediaSource))", "  if(preferDirectLiveForDevice(family,navigator.userAgent,window))");
change("   transport.attachMediaElement(video);\n   transport.load();",`   // ManagedMediaSource on Safari requires remote playback disabled
   // unless an alternative AirPlay source is supplied.
   if(window.ManagedMediaSource&&directLiveMediaSource(window)===window.ManagedMediaSource)
    video.disableRemotePlayback=true;
   transport.attachMediaElement(video);
   transport.load();`);
change(" S.play=record;state.mode='mpegts';state.ready=false;", " S.play=record;state.mode='mpegts';state.ready=false;\n diagnose('live','live_start','mpegts',0);");


change("function preferDirectLiveForDevice(family,ua,win){", "function preferDirectLiveForDevice(family,ua,win,standalone){");
change(" return family==='touch'&&/Safari/i.test(String(ua||''))&&", " return family==='touch'&&(/Safari/i.test(String(ua||''))||standalone===true&&/AppleWebKit/i.test(String(ua||'')))&&");
change("preferDirectLiveForDevice(family,navigator.userAgent,window)", "preferDirectLiveForDevice(family,navigator.userAgent,window,installedWebApp())");
change("   if(isLive&&S.play&&S.play.video===video&&S.play.reconnecting){", "   if(isLive&&(!S.play||S.play.video===video&&S.play.reconnecting)){");
change("window.addEventListener('pagehide',function(event){\n persistPlaybackCheckpoint();\n releaseLiveOnPageExit(event)\n});",`// Installed WebKit apps may survive pagehide and later restore the same
// JavaScript document. Restore only a live player we explicitly retired.
var installedLiveResume=null;
function installedLiveResumeDecision(pending,state,record,context){
 if(!pending||!context.installed||!context.verified||context.route!=='player'||
    pending.state!==state||!state||state.kind!=='live'||String(state.id)!==pending.id||
    !state.video||!state.video.isConnected||record)return 'discard';
 if(context.hidden||context.offline||state.userPaused||state.directStopPending)return 'defer';
 return 'resume'
}
function resumeInstalledLiveAfterExit(){
 var pending=installedLiveResume,state=S.playerView;
 var decision=installedLiveResumeDecision(pending,state,S.play,{
  installed:installedWebApp(),verified:S.userVerified,route:S.route,
  hidden:document.hidden,offline:navigator.onLine===false
 });
 if(decision==='discard'){installedLiveResume=null;return}
 if(decision==='defer')return;
 installedLiveResume=null;
 state.ready=false;
 playerStatus('جار استعادة البث بعد العودة للتطبيق…');
 resumeSelectedLiveTransport(state,state.video,document.getElementById('player-status'))
}
window.addEventListener('pagehide',function(event){
 persistPlaybackCheckpoint();
 var state=S.playerView,record=S.play;
 var installed=installedWebApp()&&S.route==='player'&&state&&state.kind==='live'&&
    record&&record.video===state.video&&!(event&&event.persisted);
 var released=releaseLiveOnPageExit(event);
 if(installed&&record.mode==='mpegts'&&S.play===record){
  stopPlayback(false);released=true
 }
 if(installed&&released)installedLiveResume={state:state,id:String(state.id)}
});
window.addEventListener('pageshow',resumeInstalledLiveAfterExit);
window.addEventListener('online',resumeInstalledLiveAfterExit);
document.addEventListener('visibilitychange',function(){
 if(!document.hidden)resumeInstalledLiveAfterExit()
});`);


change(" record.startupTimer=setTimeout(function(){\n  if(alive()&&!record.ready)fallback('تأخر بدء الصورة المباشرة؛ جار التحويل إلى مشغّل HLS.')\n },28000);",` function directStartupCheck(){
  record.startupTimer=null;
  var decision=liveStartupDecision(record,{
   active:alive(),userPaused:state.userPaused,hidden:document.hidden,offline:navigator.onLine===false
  });
  if(decision==='defer'){record.startupTimer=setTimeout(directStartupCheck,5000);return}
  if(decision==='recover')retryDirect(false)
 }
 record.startupTimer=setTimeout(directStartupCheck,28000);`);
change("    record.ready=true;\n    if(record.stableTimer)clearTimeout(record.stableTimer);", "    record.ready=true;record.autoplayBlocked=false;\n    if(record.stableTimer)clearTimeout(record.stableTimer);");
change("    if(!alive()||video.paused||record.fallback)return;", "    if(!alive()||video.paused||record.fallback||document.hidden||navigator.onLine===false||state.userPaused||record.autoplayBlocked)return;");
change("     if(!alive()||video.paused)return;\n     if(Math.abs((Number(video.currentTime)||0)-last)<0.3)retryDirect(false)", "     if(!alive()||video.paused||document.hidden||navigator.onLine===false||state.userPaused||record.autoplayBlocked)return;\n     if(Math.abs((Number(video.currentTime)||0)-last)<0.3)retryDirect(false)");
change("   if(promise&&promise.catch)promise.catch(function(){if(alive())status('اضغط ▶ لبدء MPEG-TS')})",`   if(promise&&promise.catch)promise.catch(function(error){
    if(!alive()||record.reconnecting)return;
    if(error&&error.name==='NotAllowedError'){
     record.autoplayBlocked=true;
     if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}
     status('اضغط ▶ لبدء MPEG-TS')
    }else if(error&&error.name==='NotSupportedError')fallback('ترميز غير مدعوم؛ جار تجربة HLS.')
    // AbortError may be a normal pause or background suspension, not a codec failure.
   })`);
change("   if(isLive&&(!S.play||S.play.video===video&&S.play.reconnecting)){",`   if(isLive&&S.play&&S.play.video===video&&S.play.autoplayBlocked){
    S.play.autoplayBlocked=false;
    resumeSelectedLiveTransport(state,video,document.getElementById('player-status'));return
   }
   if(isLive&&(!S.play||S.play.video===video&&S.play.reconnecting)){`);


change(" record.startupTimer=setTimeout(directStartupCheck,28000);"," record.startupCheck=directStartupCheck;\n record.startupTimer=setTimeout(directStartupCheck,28000);");
change(" record.startupTimer=setTimeout(startupCheck,50000);"," record.startupCheck=startupCheck;\n record.startupTimer=setTimeout(startupCheck,50000);");
change("    S.play.autoplayBlocked=false;\n    resumeSelectedLiveTransport(state,video,document.getElementById('player-status'));return",`    // Use the existing media element inside this exact user gesture.
    // Recreating an asynchronous engine here loses WebKit activation.
    var blockedRecord=S.play;
    blockedRecord.autoplayBlocked=false;
    var result=video.play();
    if(blockedRecord.startupCheck&&!blockedRecord.startupTimer)
     blockedRecord.startupTimer=setTimeout(blockedRecord.startupCheck,28000);
    if(result&&result.catch)result.catch(function(error){
     if(S.play!==blockedRecord)return;
     if(error&&error.name==='NotAllowedError'){
      blockedRecord.autoplayBlocked=true;
      if(blockedRecord.startupTimer){clearTimeout(blockedRecord.startupTimer);blockedRecord.startupTimer=null}
      playerStatus('اضغط تشغيل ▶ مرة أخرى.',true)
     }
    });
    return`);


change("function diagnose(kind,phase,mode,code){",`// Low-cardinality runtime evidence: never log an account or raw user agent.
function webRuntimeMode(standalone,preview){
 return preview?'preview':standalone?'installed':'browser'
}
function diagnose(kind,phase,mode,code){`);
change("  mode:actualMode,phase:phase,errorCode:", "  runtime:webRuntimeMode(installedWebApp(),kind==='live'&&S.route!=='player'),\n  mode:actualMode,phase:phase,errorCode:");


change("function shouldUseNativeHls(video){",`// Installed Apple WebKit can omit the Safari token. Prefer its own HLS
// decoder if supported; leave the ordinary browser route unchanged.
function installedNativeHlsPreferred(installed,ua,video){
 var agent=String(ua||'');
 return !!(installed&&/AppleWebKit/i.test(agent)&&
  /iPhone|iPad|iPod|Macintosh/i.test(agent)&&
  !/Chrome|Chromium|CriOS|Edg|FxiOS|OPR/i.test(agent)&&
  video&&video.canPlayType&&video.canPlayType('application/vnd.apple.mpegurl'))
}
function shouldUseNativeHls(video){`);
change(" var apple=/Safari/i.test(ua)&&!/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua);",
 " var apple=/Safari/i.test(ua)&&!/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua)||installedNativeHlsPreferred(installedWebApp(),ua,video);");
change("  if(preferDirectLiveForDevice(family,navigator.userAgent,window,installedWebApp()))",
 "  if(!installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&preferDirectLiveForDevice(family,navigator.userAgent,window,installedWebApp()))");
change(" if(shouldUseNativeHls(video)){\n  video.src=manifest;try{var p=video.play();if(p&&p.catch)p.catch(handleLivePlayRejection)}catch(e){}return", " if(shouldUseNativeHls(video)){\n  record.nativeHls=true;\n  video.src=manifest;try{var p=video.play();if(p&&p.catch)p.catch(handleLivePlayRejection)}catch(e){}return");
change(" video.onerror=function(){if(alive()){\n  var unsupported=video.error&&(video.error.code===4||video.error.code===3);",` video.onerror=function(){if(alive()){
  var mediaError=video.error&&video.error.code;
  // Native network errors are not codec errors. Wait before reopening the
  // same channel and avoid consuming a second provider connection.
  if(record.nativeHls&&installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&
      mediaError===2){
   if(record.reconnecting)return;
   record.reconnecting=true;
   if(record.startupTimer)clearTimeout(record.startupTimer);
   if(record.stallTimer)clearTimeout(record.stallTimer);
   if(record.progressWatchdog)clearInterval(record.progressWatchdog);
   if(record.stableTimer)clearTimeout(record.stableTimer);
   var attempt=record.recoveryAttempt||0;
   status('جار استعادة اتصال البث في تطبيق الشاشة الرئيسية…');
   function recoverInstalledNative(){
    record.retryTimer=null;
    if(!alive()||!video.isConnected)return;
    if(document.hidden||navigator.onLine===false||!preview&&S.playerView&&S.playerView.userPaused){
     record.retryTimer=setTimeout(recoverInstalledNative,3000);return
    }
    playHls(video,kind,id,extension,track,statusElement,preview,Math.min(attempt+1,4))
   }
   record.retryTimer=setTimeout(recoverInstalledNative,liveSessionRetryDelay(attempt,0));
   return
  }
  var unsupported=mediaError===4||mediaError===3;`);


change("script.src='/vendor/hls.min.js';", "script.src='/vendor/hls.min.js?v=1.5.20';");
change("script.src='/vendor/mpegts.js';script.async=true;", "script.src='/vendor/mpegts.js?v=1.8.2';script.async=true;");
change('id="install-blofy-web">طريقة إضافة BLOFY</button>', 'id="install-blofy-web">طريقة إضافة BLOFY</button> <button class="btn secondary" type="button" id="refresh-web-shell">تحديث نسخة الويب</button>');
change(" document.getElementById('refresh-content').onclick=function(){refreshCatalog(true)};", ` document.getElementById('refresh-web-shell').onclick=function(){
  if(S.route!=='settings'||navigator.onLine===false){
   setStatus('اتصل بالإنترنت ثم أعد محاولة تحديث نسخة الويب.',true);return
  }
  this.disabled=true;
  setStatus('جار تحديث واجهة BLOFY دون حذف الاشتراك أو المفضلة…');
  // Bypass a restored WebKit document with a fresh navigation. Never clear
  // localStorage, cookies, account data, or caches belonging to other apps.
  var target=new URL('/',window.location.origin);
  target.searchParams.set('shell','2026.11.25.8');
  target.searchParams.set('refresh',String(Date.now()));
  try{window.location.replace(target.href)}catch(e){window.location.reload()}
 };
 document.getElementById('refresh-content').onclick=function(){refreshCatalog(true)};`);


change(" if(activate&&!S.previewToFullPending){",` // Installed WebKit must not occupy the provider's limited channel slot
 // merely by focusing a row. Explicit preview and full playback still work.
 if(installedWebApp()){
  if(desc)desc.textContent='اضغط المعاينة أو تشغيل القناة • لتوفير اتصال البث';
  if(S.play&&S.play.preview&&String(S.play.id)!==String(id))stopPlayback(true);
  return
 }
 if(activate&&!S.previewToFullPending){`);
change(" if(old.originTimer)clearTimeout(old.originTimer);", " if(old.originTimer)clearTimeout(old.originTimer);\n  if(old.admissionAbort)old.admissionAbort.abort();");
change(" if(shouldUseNativeHls(video)){\n  record.nativeHls=true;\n  video.src=manifest;try{var p=video.play();if(p&&p.catch)p.catch(handleLivePlayRejection)}catch(e){}return",` if(shouldUseNativeHls(video)){
  record.nativeHls=true;
  if(installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&typeof fetch==='function'){
   // Native HLS hides response status and can hammer failed playlists.
   // Check the SAME authorized SID before attaching it to the decoder.
   var admissionAttempt=0;
   function openInstalledManifest(){
    record.originTimer=null;
    if(!alive()||!video.isConnected)return;
    if(document.hidden||navigator.onLine===false||(!preview&&S.playerView&&S.playerView.userPaused)){
     record.originTimer=setTimeout(openInstalledManifest,3000);return
    }
    var controller=typeof AbortController==='function'?new AbortController():null;
    record.admissionAbort=controller;
    var timeout=setTimeout(function(){if(controller)controller.abort()},30000);
    fetch(manifest,{credentials:'same-origin',cache:'no-store',signal:controller?controller.signal:undefined}).then(function(response){
     if(!alive())return;
     if(response.ok){
      if(response.body&&response.body.cancel)response.body.cancel().catch(function(){});
      record.admissionAbort=null;
      if(record.startupTimer)clearTimeout(record.startupTimer);
      record.startupTimer=setTimeout(startupCheck,50000);
      video.src=manifest;
      try{var p=video.play();if(p&&p.catch)p.catch(handleLivePlayRejection)}catch(e){}
      return
     }
     var hint=Number(response.headers.get('Retry-After'))||0;
     if(response.body&&response.body.cancel)response.body.cancel().catch(function(){});
     if(response.status===401||response.status===403){
      if(record.startupTimer)clearTimeout(record.startupTimer);
      status('تعذر التحقق من صلاحية تشغيل القناة. أعد فتحها.');return
     }
     deferAdmission(hint)
    }).catch(function(){if(alive())deferAdmission(0)}).finally(function(){clearTimeout(timeout)});
    function deferAdmission(hint){
     record.admissionAbort=null;
     if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}
     status('مصدر البث مشغول أو غير متاح مؤقتًا؛ جار انتظار اتصال متاح…');
     record.originTimer=setTimeout(openInstalledManifest,liveSessionRetryDelay(admissionAttempt++,hint))
    }
   }
   if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}
   openInstalledManifest();return
  }
  video.src=manifest;try{var p=video.play();if(p&&p.catch)p.catch(handleLivePlayRejection)}catch(e){}return`);


change(" if(S.previewToFullPending)return;\n if(S.previewRecoveryStop)", " if(S.previewToFullPending)return;\n if(installedWebApp()&&pendingMediaStops>0){var waitBox=document.getElementById('live-status');if(waitBox)waitBox.textContent='جار إغلاق الاتصال السابق؛ أعد الضغط بعد لحظات.';return}\n if(S.previewRecoveryStop)");
change(" if(isLive&&(S.previewStopPending||S.previewRecoveryStop)){", " if(isLive&&installedWebApp()&&pendingMediaStops>0){var waitBox=document.getElementById('live-status');if(waitBox)waitBox.textContent='جار إغلاق الاتصال السابق؛ أعد الضغط بعد لحظات.';return}\n if(isLive&&(S.previewStopPending||S.previewRecoveryStop)){");
change("     if(response.status===401||response.status===403){", "     if(response.status===401||response.status===403||response.status===400){");
change("     deferAdmission(hint)\n    }).catch(function(){if(alive())deferAdmission(0)}).finally(function(){clearTimeout(timeout)});",`     if(response.status===404){
      // A retired session cannot be revived. Start a new SID using the
      // existing serialized STOP path after the server's cooldown.
      record.originTimer=setTimeout(function(){
       if(!alive())return;
       playHls(video,kind,id,extension,track,statusElement,preview,Math.min((record.recoveryAttempt||0)+1,4))
      },liveSessionRetryDelay(record.recoveryAttempt||0,hint));return
     }
     deferAdmission(hint)
    }).catch(function(){if(alive())deferAdmission(0)}).finally(function(){clearTimeout(timeout)});`);
change("     if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}\n     status('مصدر البث مشغول أو غير متاح مؤقتًا؛ جار انتظار اتصال متاح…');",`     if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}
     if(admissionAttempt>=5){
      status('المصدر مشغول حاليًا. اضغط إعادة المحاولة أو اختر قناة متاحة.');return
     }
     status('مصدر البث مشغول أو غير متاح مؤقتًا؛ جار انتظار اتصال متاح…');`);


change("var installedLiveResume=null;",`var installedLiveResume=null;
function installedLiveShouldRelease(installed,hidden,record,video,pip){
 return !!(installed&&hidden&&record&&record.kind==='live'&&video&&!pip)
}
// Release at the visibility event, not a timer that WebKit may suspend.
// A foreground restoration waits for the acknowledged STOP of its own SID.
function retireHiddenInstalledLive(){
 var record=S.play,state=S.playerView,video=record&&record.video;
 var pip=video&&(document.pictureInPictureElement===video||video.webkitPresentationMode==='picture-in-picture');
 if(!installedLiveShouldRelease(installedWebApp(),document.hidden,record,video,pip))return;
 var isFull=!record.preview&&S.route==='player'&&state&&state.video===video;
 var key=record.hlsKey;
 var pending=isFull?{state:state,id:String(state.id),stopKey:key||null,stopping:false}:null;
 if(pending)installedLiveResume=pending;
 stopPlayback(false);
 if(key){
  if(pending)confirmInstalledStop(pending);
  else api('POST','/api/hls/'+key+'/stop',{},function(){})
 }
}
function confirmInstalledStop(pending){
 if(!pending||!pending.stopKey||pending.stopping)return;
 pending.stopping=true;
 api('POST','/api/hls/'+pending.stopKey+'/stop',{},function(st){
  pending.stopping=false;
  if(st===200||st===404){
   pending.stopKey=null;
   if(installedLiveResume===pending&&!document.hidden)resumeInstalledLiveAfterExit()
  }else if(installedLiveResume===pending&&!document.hidden){
   playerStatus('تعذر تأكيد إغلاق جلسة البث السابقة؛ أعد فتح القناة بعد لحظات.',true)
  }
 })
}`);
change(" if(decision==='defer')return;\n installedLiveResume=null;", " if(decision==='defer')return;\n if(pending.stopKey){confirmInstalledStop(pending);return}\n installedLiveResume=null;");
change(" if(!document.hidden)resumeInstalledLiveAfterExit()\n});", " if(document.hidden)retireHiddenInstalledLive();else resumeInstalledLiveAfterExit()\n});");
change("     if(response.body&&response.body.cancel)response.body.cancel().catch(function(){});\n     if(response.status===401||response.status===403||response.status===400){", "     return response.json().catch(function(){return {}}).then(function(failure){\n     if(!alive())return;\n     if(response.status===401||response.status===403||response.status===400){");
change("     if(response.status===404){\n      // A retired session", "     if(response.status===404||failure&&failure.error==='hls_session_retired'){\n      if((record.recoveryAttempt||0)>=4){status('انتهت جلسة البث. اضغط إعادة المحاولة.');return}\n      // A retired session");
change("       if(!alive())return;\n       playHls(video,kind,id,extension,track,statusElement,preview,Math.min((record.recoveryAttempt||0)+1,4))", "       if(!alive())return;\n       if(document.hidden||navigator.onLine===false||!preview&&S.playerView&&S.playerView.userPaused){deferAdmission(hint);return}\n       playHls(video,kind,id,extension,track,statusElement,preview,Math.min((record.recoveryAttempt||0)+1,4))");
change("     deferAdmission(hint)\n    }).catch(function(){if(alive())deferAdmission(0)}).finally(function(){clearTimeout(timeout)});", "     deferAdmission(hint)\n     })\n    }).catch(function(){if(alive())deferAdmission(0)}).finally(function(){clearTimeout(timeout)});");


change(" if(!state||state.directStopPending)return;\n if(state.mode==='mpegts')",` if(!state||state.directStopPending)return;
 if(installedLiveResume&&installedLiveResume.state===state&&installedLiveResume.stopKey){
  installedLiveResume.id=String(state.id);
  confirmInstalledStop(installedLiveResume);return
 }
 if(state.mode==='mpegts')`);
change(" pending.stopping=true;\n api('POST','/api/hls/'+pending.stopKey+'/stop',{},function(st){", " pending.stopping=true;\n var stopUrl='/api/hls/'+pending.stopKey+'/stop';\n function finished(st){");
change("   playerStatus('تعذر تأكيد إغلاق جلسة البث السابقة؛ أعد فتح القناة بعد لحظات.',true)\n  }\n })\n}",`   playerStatus('تعذر تأكيد إغلاق جلسة البث السابقة؛ اضغط إعادة المحاولة بعد لحظات.',true)
  }
 }
 if(typeof fetch==='function'){
  fetch(stopUrl,{method:'POST',credentials:'same-origin',keepalive:true,cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}'}).then(function(response){finished(response.status)},function(){finished(0)})
 }else api('POST',stopUrl,{},finished)
}`);

// Explicit channel selection starts the muted preview immediately; passive
// focus on installed WebKit must not start a provider connection.
change("function selectChannel(id,activate){","function selectChannel(id,activate,explicit){");
change("if(selected)selectChannel(itemId(selected,'live'),true);","if(selected)selectChannel(itemId(selected,'live'),true,true);");
change("selectChannel(S.selected,true)\n","selectChannel(S.selected,true,true)\n");
change("if(ch){selectChannel(ch,true);return}","if(ch){selectChannel(ch,true,true);return}");
change(" if(installedWebApp()){\n  if(desc)desc.textContent='اضغط المعاينة أو تشغيل القناة • لتوفير اتصال البث';\n  if(S.play&&S.play.preview&&String(S.play.id)!==String(id))stopPlayback(true);\n  return\n }",` if(installedWebApp()&&!explicit){
  if(desc)desc.textContent='اختر القناة لتشغيلها مباشرة';
  return
 }
 if(activate&&explicit&&!S.previewToFullPending){
  beginPreview(item);return
 }`);
change(" if(installedWebApp()&&pendingMediaStops>0){var waitBox=document.getElementById('live-status');if(waitBox)waitBox.textContent='جار إغلاق الاتصال السابق؛ أعد الضغط بعد لحظات.';return}",` if(installedWebApp()&&pendingMediaStops>0){
  var waitBox=document.getElementById('live-status');
  if(waitBox)waitBox.textContent='جار إغلاق الاتصال السابق وتشغيل القناة…';
  var selectedId=itemId(item,'live'),attempt=0;
  function resumePreview(){
   S.autoPreviewTimer=null;
   if(S.route!=='live'||String(S.selected)!==String(selectedId)||document.hidden)return;
   if(pendingMediaStops>0){
    if(++attempt<40)S.autoPreviewTimer=setTimeout(resumePreview,150);
    else if(waitBox)waitBox.textContent='تعذر إنهاء الاتصال السابق؛ أعد اختيار القناة.';
    return
   }
   beginPreview(item)
  }
  S.autoPreviewTimer=setTimeout(resumePreview,150);return
 }`);
change("if(video.paused&&S.play.ready){","if(video.paused&&(S.play.ready||S.play.autoplayBlocked)){");
change("target.searchParams.set('shell','2026.11.25.8');","target.searchParams.set('shell','2026.11.26.2');");


// Match native STREAM's phone browser: no preview panel or decoder before
// explicit channel choice. Wide desktop/TV keeps the existing preview.
change("function selectChannel(id,activate,explicit){",`function phoneLiveLayout(){
 return document.documentElement.getAttribute('data-blofy-device')==='touch'&&
  !!(window.matchMedia&&window.matchMedia('(max-width: 730px), (max-height: 540px) and (orientation: landscape)').matches)
}
function selectChannel(id,activate,explicit){`);
change(" if(installedWebApp()&&!explicit){"," if(phoneLiveLayout())return;\n if(installedWebApp()&&!explicit){");
change("if(ch){selectChannel(ch,true,true);return}",`if(ch){
  if(phoneLiveLayout()){
   var chosen=findItem('live',ch);
   if(chosen){
    if(S.play&&S.play.preview){selectChannel(ch,false,true)}
    S.selected=ch;openPlayer('live',ch,'ts',title(chosen),0)
   }
  }else selectChannel(ch,true,true);
  return
 }`);
change("function beginPreview(item){\n if(S.autoPreviewTimer)", "function beginPreview(item){\n if(phoneLiveLayout())return;\n if(S.autoPreviewTimer)");
change("'<div class=\"catalog\">'+categoryRail(kind)+","'<div class=\"catalog live-catalog\">'+categoryRail(kind)+");


 // Native Home navigation now lives in app.js; avoid overwriting it during build.
change("var hadScreen=!!target.querySelector('.story-row');","var hadScreen=!!target.querySelector('.home-hero');");
change("var panel=document.querySelector(kind==='live'?'#channel-list':'.poster-panel');","var panel=phoneLiveLayout()?document.getElementById('workspace'):document.querySelector(kind==='live'?'#channel-list':'.poster-panel');");

change("target.searchParams.set('shell','2026.11.26.2');","target.searchParams.set('shell','2026.11.26.3');");

 // Retain the already received native admission response metadata. It is
 // the very same authorized HLS SID, so no duplicate metadata fetch is needed.
change("  record.videoModeProbed=true;\n  fetch(manifest,", "  record.videoModeProbed=true;\n  var cachedInfo=record.admissionVideoInfo;\n  (cachedInfo?Promise.resolve(cachedInfo):fetch(manifest,");
change("  }).then(function(info){\n   if(!info||!alive())return;\n   record.videoMode=info.mode;", "  })).then(function(info){\n   if(!info||!alive())return;\n   record.videoMode=info.mode;");
change("     if(response.ok){\n      if(response.body&&response.body.cancel)", "     if(response.ok){\n      record.admissionVideoInfo={mode:response.headers.get('x-blofy-video-mode')||'',source:response.headers.get('x-blofy-source-resolution')||''};\n      if(response.body&&response.body.cancel)");
change("target.searchParams.set('shell','2026.11.26.3');","target.searchParams.set('shell','2026.11.26.4');");

change("target.searchParams.set('shell','2026.11.26.4');","target.searchParams.set('shell','2026.11.26.5');");
change("target.searchParams.set('shell','2026.11.26.5');","target.searchParams.set('shell','2026.11.26.6');");

change("   var attempt=record.recoveryAttempt||0;\n   status('جار استعادة اتصال البث في تطبيق الشاشة الرئيسية…');",`   var attempt=record.recoveryAttempt||0;
   if(attempt>=4){
    if(preview)status('تعذر تشغيل المعاينة؛ اختر القناة مجددًا.');
    else playerStatus('تعذر الاتصال بالقناة. أعد المحاولة.',true);
    return
   }
   status('جار استعادة اتصال البث في تطبيق الشاشة الرئيسية…');`);
change("      status('تعذر التحقق من صلاحية تشغيل القناة. أعد فتحها.');return", "      if(preview)status('تعذر التحقق من صلاحية تشغيل القناة.');else playerStatus('تعذر التحقق من صلاحية تشغيل القناة.',true);return");
change("      if((record.recoveryAttempt||0)>=4){status('انتهت جلسة البث. اضغط إعادة المحاولة.');return}", "      if((record.recoveryAttempt||0)>=4){if(preview)status('انتهت جلسة المعاينة.');else playerStatus('انتهت جلسة البث. أعد المحاولة.',true);return}");
change("      status('المصدر مشغول حاليًا. اضغط إعادة المحاولة أو اختر قناة متاحة.');return", "      if(preview)status('القناة غير متاحة حاليًا.');else playerStatus('القناة غير متاحة حاليًا. أعد المحاولة.',true);return");
change("target.searchParams.set('shell','2026.11.26.6');","target.searchParams.set('shell','2026.11.26.7');");

change("target.searchParams.set('shell','2026.11.26.7');","target.searchParams.set('shell','2026.11.26.8');");
change("target.searchParams.set('shell','2026.11.26.8');","target.searchParams.set('shell','2026.11.26.12');");

// Final customer playback policy: selection is explicit play intent;
// keep progress text silent and retry the same retiring SID, never overlap.
change("return 'جار تشغيل القناة…';","return '';");
change("if(!preview&&kind==='live')text=simpleLiveStatus(text,false);","if(kind==='live')text=simpleLiveStatus(text,false);");
change("if(!preview&&text.slice(0,1)!=='●')statusElement.style.display='block'","if(!preview)statusElement.style.display=text&&text.slice(0,1)!=='●'?'block':'none'");
change("if(statusElement){statusElement.textContent=msg;statusElement.style.display='block'}","if(statusElement){msg=simpleLiveStatus(msg,false);statusElement.textContent=msg;statusElement.style.display=msg?'block':'none'}");
change("(isLive?'جار تشغيل القناة…':'جار تجهيز المشغّل…')","(isLive?'':'جار تجهيز المشغّل…')");
change("id=\"player-status\" role=\"status\">","id=\"player-status\" role=\"status\"'+(isLive?' style=\"display:none\"':'')+'>");
change("if(box)box.textContent='جار تبديل المعاينة للقناة المحددة…';","if(box)box.textContent='';");
change("if(box)box.textContent='جار تبديل القناة…';","if(box)box.textContent='';");
change("if(box)box.textContent='جار تشغيل معاينة '+title(item)+' تلقائيًا…';","if(box)box.textContent='';");
change("if(waitBox)waitBox.textContent='جار إغلاق الاتصال السابق وتشغيل القناة…';","if(waitBox)waitBox.textContent='';");
change("if(previewStatus)previewStatus.textContent='جار نقل القناة إلى المشغّل الكامل…';","if(previewStatus)previewStatus.textContent='';");
change("جار تشغيل معاينة القناة…</div>","</div>");
change("if(!newId||newId===String(id))return;","if(!newId)return;\n   state.userPaused=false;\n   if(newId===String(id)){if(!S.play||state.liveHlsHandoff)resumeSelectedLiveTransport(state,video,document.getElementById('player-status'));else if(video.paused&&state.toggle)state.toggle();return}");
change("if(status!==200&&status!==404){ops.error();return}","if(status!==200&&status!==404){\n   pending.failures=(pending.failures||0)+1;\n   if(ops.retry&&pending.failures<=2){ops.retry(function(){if(state.liveHlsHandoff===pending&&ops.current()&&ops.visible()&&!pending.inflight&&!pending.ack)queueLiveHlsHandoff(state,pending.request,null,ops)},pending.failures*700);return}\n   ops.error();return\n  }");
change("timer:setTimeout,clear:clearTimeout,","timer:setTimeout,clear:clearTimeout,retry:setTimeout,");
change("if(!ops.visible()){ops.error();return}","if(!ops.visible())return;");
change("   },260)\n  }\n  function switchChannel","   },120)\n  }\n  function switchChannel");
change("  },800)\n }\n}\nfunction decodeEpgField","  },350)\n }\n}\nfunction decodeEpgField");
// Explicit open while the preview is retiring: remember only latest request.
change(" if(isLive&&installedWebApp()&&pendingMediaStops>0){var waitBox=document.getElementById('live-status');if(waitBox)waitBox.textContent='جار إغلاق الاتصال السابق؛ أعد الضغط بعد لحظات.';return}\n if(isLive&&(S.previewStopPending||S.previewRecoveryStop)){var pendingStatus=document.getElementById('live-status');if(pendingStatus)pendingStatus.textContent='جار إنهاء اتصال المعاينة؛ أعد الضغط بعد اكتماله.';return}",` if(isLive&&((installedWebApp()&&pendingMediaStops>0)||S.previewStopPending||S.previewRecoveryStop||S.previewToFullPending)){
  var intent={id:String(id),route:S.route,epoch:S.accountEpoch,attempt:0};S.queuedLiveOpen=intent;
  function resumeOpen(){
   if(S.queuedLiveOpen!==intent||S.route!==intent.route||S.accountEpoch!==intent.epoch||String(S.selected)!==intent.id||!S.userVerified)return;
   if((installedWebApp()&&pendingMediaStops>0)||S.previewStopPending||S.previewRecoveryStop||S.previewToFullPending){
    if(++intent.attempt<100)setTimeout(resumeOpen,150);
    else{S.queuedLiveOpen=null;var box=document.getElementById('live-status');if(box)box.textContent='تعذر إنهاء الاتصال السابق. أعد المحاولة.'}
    return
   }
   S.queuedLiveOpen=null;openPlayer(kind,id,extension,name,from,replacePlayerHistory)
  }
  setTimeout(resumeOpen,150);return
 }`);
// Preserve the retiring preview SID across transient STOP failures.
change("  var previousKey=previous.hlsKey,settled=false,guard=null;","  var previousKey=previous.hlsKey,settled=false,guard=null,stopAttempts=0;");
change("   settled=true;if(guard)clearTimeout(guard);\n   S.previewStopPending=false;","   if(guard)clearTimeout(guard);\n   if(st!==200&&st!==404&&++stopAttempts<=2&&S.route==='live'&&video.isConnected){setTimeout(sendPreviewStop,stopAttempts*700);return}\n   settled=true;S.previewStopPending=false;");
change("  guard=setTimeout(function(){finished(0)},6500);\n  api('POST','/api/hls/'+previousKey+'/stop',{},function(st){finished(st)});","  function sendPreviewStop(){\n   if(settled)return;\n   api('POST','/api/hls/'+previousKey+'/stop',{},function(st){finished(st)})\n  }\n  sendPreviewStop();");


change(" var externalButton=document.getElementById('player-external');",` function returnFromExternal(next){
  if(state.externalPending)return;
  state.externalPending=true;
  function finish(st){
   state.externalPending=false;
   if(S.playerView!==state||S.route!=='player')return;
   if(st!==200){playerStatus('تعذر إغلاق المشغل الخارجي. أعد المحاولة.',true);return}
   state.externalMode=false;state.userPaused=false;playerStatus('');
   if(next)next();else resumeSelectedLiveTransport(state,video,document.getElementById('player-status'))
  }
  function stopExternal(){api('POST','/api/external/stop',{},finish)}
  if(state.externalRetiringStop)api('POST',state.externalRetiringStop,{},function(st){
   if(st!==200&&st!==404){finish(st);return}
   state.externalRetiringStop=null;stopExternal()
  });else stopExternal()
 }
 state.returnFromExternal=returnFromExternal;
 var externalButton=document.getElementById('player-external');`);
change("  var opts=[];\n  if(typeof video.webkitShowPlaybackTargetPicker", "  if(state.externalMode){showPlayerChoices('التشغيل الخارجي',[{name:'العودة للتشغيل الداخلي',select:function(){returnFromExternal()}}],externalButton);return}\n  var opts=[];\n  if(typeof video.webkitShowPlaybackTargetPicker");
change("   state.externalPending=true;state.userPaused=true;", "   state.externalPending=true;state.externalMode=true;state.userPaused=true;");
change("     ],externalButton)\n    })", "      ,{name:'العودة للتشغيل الداخلي',select:function(){returnFromExternal()}}\n     ],externalButton)\n    })");
change(" state.toggle=function(){\n  if(video.paused){"," state.toggle=function(){\n  if(state.externalMode){returnFromExternal();return}\n  if(video.paused){");
change(" document.getElementById('player-retry').onclick=function(){\n  diagnose", " document.getElementById('player-retry').onclick=function(){\n  if(state.externalMode){returnFromExternal();return}\n  diagnose");
change("  function selectFullscreenChannel(requestedId){\n   if(S.route!=='player'||S.playerView!==state)return;", "  function selectFullscreenChannel(requestedId){\n   if(S.route!=='player'||S.playerView!==state)return;\n   if(state.externalMode){returnFromExternal(function(){selectFullscreenChannel(requestedId)});return}");

change("   state.externalPending=true;state.externalMode=true;state.userPaused=true;", "   state.externalPending=true;state.externalMode=true;state.userPaused=true;state.externalRetiringStop=stop||null;");
change("    if(st===200||st===404)issue();", "    if(st===200||st===404){state.externalRetiringStop=null;issue()}");
change("timer:setTimeout,clear:clearTimeout,retry:setTimeout,", "timer:function(fn,ms){return setTimeout(fn,ms)},clear:function(id){clearTimeout(id)},retry:function(fn,ms){return setTimeout(fn,ms)},");

change("function beginPreview(item){",`// A failed preview STOP is not permission to open another source session.
function markPreviewRetiring(key){
 if(key)S.retiredPreview={key:key,epoch:S.accountEpoch,inflight:false,next:null}
}
function confirmPreviewRetired(key,epoch){
 var p=S.retiredPreview;
 if(p&&p.key===key&&p.epoch===epoch)S.retiredPreview=null
}
function retryRetiredPreview(next){
 var p=S.retiredPreview;
 if(!p)return false;
 if(p.epoch!==S.accountEpoch){S.retiredPreview=null;return false}
 p.next=next;
 if(p.inflight)return true;
 p.inflight=true;
 api('POST','/api/hls/'+p.key+'/stop',{},function(st){
  if(S.retiredPreview!==p||S.accountEpoch!==p.epoch)return;
  p.inflight=false;
  if(st===200||st===404){
   var resume=p.next;S.retiredPreview=null;
   if(resume)resume()
  }else{
   var box=document.getElementById('live-status');
   if(box)box.textContent='تعذر إغلاق الاتصال السابق. أعد المحاولة.'
  }
 });
 return true
}
function beginPreview(item){`);
change(" var previous=S.play;\n if(previous&&previous.preview&&previous.hlsKey){", " var chosenEpoch=S.accountEpoch;\n if(retryRetiredPreview(function(){if(S.accountEpoch===chosenEpoch&&S.route==='live'&&!document.hidden&&String(S.selected)===String(id))beginPreview(item)}))return;\n var previous=S.play;\n if(previous&&previous.preview&&previous.hlsKey){");
change("var previousKey=previous.hlsKey,settled=false,guard=null,stopAttempts=0;\n  stopPlayback(false);", "var previousKey=previous.hlsKey,settled=false,guard=null,stopAttempts=0,retireEpoch=S.accountEpoch;\n  markPreviewRetiring(previousKey);stopPlayback(false);");
change("   settled=true;S.previewStopPending=false;", "   settled=true;S.previewStopPending=false;\n   if(st===200||st===404)confirmPreviewRetired(previousKey,retireEpoch);");
change(" if(isLive&&oldPreview&&oldPreview.preview&&oldPreview.hlsKey){", " var openEpoch=S.accountEpoch,openRoute=S.route;\n if(isLive&&retryRetiredPreview(function(){if(S.accountEpoch===openEpoch&&S.route===openRoute&&S.userVerified&&String(S.selected)===String(id))openPlayer(kind,id,extension,name,from,replacePlayerHistory)}))return;\n if(isLive&&oldPreview&&oldPreview.preview&&oldPreview.hlsKey){");
change("  var previewStopKey=oldPreview.hlsKey;", "  var previewStopKey=oldPreview.hlsKey,retireEpoch=S.accountEpoch;\n  markPreviewRetiring(previewStopKey);");
change("   S.previewToFullPending=false;\n   if(S.route!==expectedRoute", "   S.previewToFullPending=false;\n   if(status===200||status===404)confirmPreviewRetired(previewStopKey,retireEpoch);\n   if(S.accountEpoch!==retireEpoch||S.route!==expectedRoute");
change("  promotionTimer=setTimeout(function(){promotionComplete(0)},6500);\n", "");
change("  if(preview)S.previewRecoveryStop=token;", "  var retireEpoch=S.accountEpoch;\n  if(preview){S.previewRecoveryStop=token;markPreviewRetiring(oldHlsKey)}");
change("   if(preview&&S.previewRecoveryStop===token){", "   if(preview&&(status===200||status===404))confirmPreviewRetired(oldHlsKey,retireEpoch);\n   if(preview&&S.previewRecoveryStop===token){");


change("function resumeLiveHlsNetwork(engine,manifest,record){",`// Adapt only existing HLS.js sessions. Native HLS owns its buffer; a
// preview uses a fixed small profile. No new connections or quality changes.
function adaptLiveBuffer(record,engine,now,waiting,preview){
 if(preview||!engine||!engine.config||!record.ready||record.reconnecting)return null;
 var a=record.adaptiveBuffer||(record.adaptiveBuffer={level:0,waits:[],lastWait:0,lastChange:now,lastPressure:now});
 if(waiting){
  if(a.lastWait&&now-a.lastWait<3000)return null;
  a.lastWait=now;a.lastPressure=now;a.waits.push(now);
 }
 a.waits=a.waits.filter(function(t){return now-t<=60000});
 var next=a.level;
 if(waiting&&a.waits.length>=3&&now-a.lastChange>=15000)next=Math.min(2,a.level+1);
 else if(!waiting&&a.level>0&&now-a.lastPressure>=180000&&now-a.lastChange>=180000)next=a.level-1;
 if(next===a.level)return null;
 a.level=next;a.lastChange=now;a.waits=[];
 var profile=[{buffer:45,sync:5,maxLatency:12},{buffer:52,sync:6,maxLatency:14},{buffer:60,sync:7,maxLatency:16}][next];
 // Update the existing engine's buffer and latency policy; do not seek or
 // mutate the source. HLS.js may apply some settings on later reloads.
 engine.config.maxBufferLength=profile.buffer;
 // Adapt buffering without forcing a seek on an otherwise healthy stream.
 record.normalLiveMaxLatency=Infinity;
 engine.config.liveMaxLatencyDurationCount=Infinity;
 engine.config.liveSyncDurationCount=profile.sync;
 return next
}
function resumeLiveHlsNetwork(engine,manifest,record){`);
change("  if(!preview)recordLiveIncident('buffering');", "  if(!preview)recordLiveIncident('buffering');\n  if(!document.hidden&&navigator.onLine!==false)adaptLiveBuffer(record,record.engine,Date.now(),true,preview);");
change("   if(progress.advanced){clearRecoveredLiveLoading();return}\n   if(progress.idleMs>=16000)", "   if(progress.advanced){adaptLiveBuffer(record,record.engine,now,false,preview);clearRecoveredLiveLoading();return}\n   if(progress.idleMs>=16000)");


change("function resumeLiveHlsNetwork(engine,manifest,record){",`function liveRecoveryAllowed(paused,hidden,offline,external){
 return !paused&&!hidden&&!offline&&!external
}
function resumeLiveHlsNetwork(engine,manifest,record){`);
change(" function recoverConnection(){\n  if(!alive()||record.reconnecting)return;\n  if(preview){",` function recoverConnection(){
  if(!alive()||record.reconnecting)return;
  var owner=!preview&&S.playerView;
  if(!liveRecoveryAllowed(owner&&owner.userPaused,document.hidden,navigator.onLine===false,owner&&owner.externalMode)){
   // Keep the current SID. A hidden/offline/paused viewer must not
   // allocate a fresh encoder or trigger codec fallback.
   if(!record.retryTimer&&!(owner&&(owner.userPaused||owner.externalMode))){
    record.retryTimer=setTimeout(function(){record.retryTimer=null;if(alive())recoverConnection()},3000)
   }
   return
  }
  if(preview){`);
change("   if(!alive()||!record.ready||record.reconnecting||!video.isConnected)return;", "   if(!alive()||!record.ready||record.reconnecting||!video.isConnected)return;\n   if(navigator.onLine===false){record.lastProgressAt=Date.now();record.lastVisualSampleAt=record.lastProgressAt;record.visualProgressSeen=false;return}");


change("function playFullVod(video,kind,id,ext,track,duration,state,ready){",`function retireVodBeforeUpgrade(state,stopUrl,ops){
 var pending=state.vodUpgradeStop;
 if(!pending){
  if(!stopUrl)return false;
  pending=state.vodUpgradeStop={url:stopUrl,inflight:false,next:null};
  ops.detach()
 }
 pending.next=ops;
 if(pending.inflight)return true;
 pending.inflight=true;
 ops.stop(pending.url,function(st){
  if(state.vodUpgradeStop!==pending)return;
  pending.inflight=false;
  var latest=pending.next;
  if(!latest.current())return;
  if(st!==200&&st!==404){latest.error();return}
  state.vodUpgradeStop=null;latest.start()
 });
 return true
}
function playFullVod(video,kind,id,ext,track,duration,state,ready){`);
change(` if(previous&&previous.stopUrl&&previous.stopUrl.indexOf('/api/vod/')===0){
  var oldStop=previous.stopUrl;
  stopPlayback(false);
  state.ready=false;
  playerStatus('جار إغلاق اتصال الفيلم المؤقت قبل تفعيل التقديم…');
  var completed=false;
  function proceed(){
   if(completed)return;
   completed=true;clearTimeout(timeout);
   if(S.route!=='player'||S.playerView!==state)return;
   playFullVod(video,kind,id,ext,track,duration,state,ready)
  }
  var timeout=setTimeout(proceed,4000);
  api('POST',oldStop,{},function(){proceed()});
  return
 }`, ` if(retireVodBeforeUpgrade(state,previous&&previous.stopUrl&&previous.stopUrl.indexOf('/api/vod/')===0?previous.stopUrl:null,{
  detach:function(){stopPlayback(false);state.ready=false},
  current:function(){return S.route==='player'&&S.playerView===state&&video.isConnected&&S.userVerified},
  stop:function(url,done){playerStatus('');api('POST',url,{},done)},
  error:function(){playerStatus('تعذر إغلاق اتصال الفيلم السابق. أعد المحاولة.',true)},
  start:function(){playFullVod(video,kind,id,ext,track,duration,state,ready)}
 }))return`);


change(" if(requestedState.directStopPending)return;\n var old=S.play,oldKey=old&&old.hlsKey;", " if(requestedState.directStopPending||requestedState.liveHlsHandoff||requestedState.externalMode)return;\n var old=S.play,oldKey=requestedState.directStopKey||(old&&old.hlsKey);");
change("  requestedState.directStopPending=true;\n  stopPlayback(false);", "  requestedState.directStopPending=true;requestedState.directStopKey=oldKey;\n  stopPlayback(false);");
change("   playDirectMpegts(video,String(requestedState.id),statusElement)\n  }\n  api('POST','/api/hls/'+oldKey+'/stop'", "   requestedState.directStopKey=null;\n   if(!document.hidden&&navigator.onLine!==false&&!requestedState.userPaused)playDirectMpegts(video,String(requestedState.id),statusElement)\n  }\n  api('POST','/api/hls/'+oldKey+'/stop'");
change("  var oldKey=S.play&&S.play.video===video&&S.play.hlsKey;\n  if(queueLiveHlsHandoff", "  if(player.directStopPending||player.externalMode)return;\n  var oldKey=player.directStopKey||(S.play&&S.play.video===video&&S.play.hlsKey);\n  if(queueLiveHlsHandoff");
change("   start:function(next){playerStatus('جار تشغيل القناة…');playHls(", "   start:function(next){player.directStopKey=null;playerStatus('جار تشغيل القناة…');playHls(");


change("  if(S.route!=='player'||S.playerView!==state||state.externalPending||state.liveHlsHandoff)return;", "  if(S.route!=='player'||S.playerView!==state||state.externalPending||state.liveHlsHandoff||state.directStopPending)return;");
change("   if(state.externalPending)return;\n   var record=S.play,selected=String(state.id),stop=record&&(record.stopUrl||(record.hlsKey&&'/api/hls/'+record.hlsKey+'/stop'));", "   if(state.externalPending||state.directStopPending||state.liveHlsHandoff||state.externalMode)return;\n   var record=S.play,selected=String(state.id),stop=state.directStopKey?'/api/hls/'+state.directStopKey+'/stop':record&&(record.stopUrl||(record.hlsKey&&'/api/hls/'+record.hlsKey+'/stop'));");
change("    if(st===200||st===404){state.externalRetiringStop=null;issue()}", "    if(st===200||st===404){state.externalRetiringStop=null;state.directStopKey=null;issue()}");
change("   state.externalRetiringStop=null;stopExternal()", "   state.externalRetiringStop=null;state.directStopKey=null;stopExternal()");

change("function shouldUseNativeHls(video){\n if(S.preferMseHls", "function appleMobileNativeHls(ua,touchPoints,video){return !!(appleTouchBrowser(ua,touchPoints)&&video&&video.canPlayType&&video.canPlayType('application/vnd.apple.mpegurl'))}\nfunction shouldUseNativeHls(video){\n if(appleMobileNativeHls(navigator.userAgent,navigator.maxTouchPoints,video))return true;\n if(S.preferMseHls");
change("if(!installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&preferDirectLiveForDevice", "if(!appleMobileNativeHls(navigator.userAgent,navigator.maxTouchPoints,video)&&!installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&preferDirectLiveForDevice");
change("if(record.nativeHls&&installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&", "if(record.nativeHls&&(appleMobileNativeHls(navigator.userAgent,navigator.maxTouchPoints,video)||installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video))&&");
change("target.searchParams.set('shell','2026.11.26.12');", "target.searchParams.set('shell','2026.11.28.56.0.3');");


change("return preview?{sync:4,maxLatency:10,buffer:35}:{sync:5,maxLatency:12,buffer:45}", "return preview?{sync:3,maxLatency:8,buffer:18}:{sync:3,maxLatency:10,buffer:25}");
change("var profile=[{buffer:45,sync:5,maxLatency:12},{buffer:52,sync:6,maxLatency:14},{buffer:60,sync:7,maxLatency:16}][next];", "var profile=[{buffer:25,sync:3,maxLatency:10},{buffer:35,sync:4,maxLatency:12},{buffer:45,sync:5,maxLatency:14}][next];");
change("maxMaxBufferLength:preview?45:60,backBufferLength:preview?12:30", "maxMaxBufferLength:preview?25:45,backBufferLength:preview?8:15");
change("if(state.mode==='mpegts')playDirectMpegts(video,String(state.id),statusElement);", "if(state.mode==='mpegts'&&!state.liveHlsHandoff)playDirectMpegts(video,String(state.id),statusElement);");
change("xhr.timeout=40000;", "xhr.timeout=mediaStop?6500:40000;");



change("function liveRetryHint(detail){", "function liveSourceQuotaRejected(detail){\n try{\n  var n=detail&&detail.networkDetails;\n  return (n&&typeof n.getResponseHeader==='function'?n.getResponseHeader('X-Blofy-Live-Status'):n&&n.headers&&n.headers.get?n.headers.get('X-Blofy-Live-Status'):null)==='source_channel_limit'\n }catch(e){return false}\n}\nfunction liveRetryHint(detail){");
change(" if(shouldUseNativeHls(video)){\n  record.nativeHls=true;", " function showSourceQuota(){\n  if(!alive())return;\n  record.reconnecting=true;\n  for(var i=0,timers=['startupTimer','stallTimer','stableTimer','retryTimer','capacityTimer','originTimer','progressWatchdog'];i<timers.length;i++){\n   if(record[timers[i]]){clearTimeout(record[timers[i]]);clearInterval(record[timers[i]]);record[timers[i]]=null}\n  }\n  try{if(record.engine)record.engine.stopLoad()}catch(e){}\n  var message='مصدر البث ممتلئ حاليًا. اختر قناة متاحة أو أعد المحاولة لاحقًا.';\n  if(preview)status(message);else playerStatus(message,true)\n }\n if(shouldUseNativeHls(video)){\n  record.nativeHls=true;");
change("if(installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video)&&typeof fetch==='function'){", "if((appleMobileNativeHls(navigator.userAgent,navigator.maxTouchPoints,video)||installedNativeHlsPreferred(installedWebApp(),navigator.userAgent,video))&&typeof fetch==='function'){");
change("     if(response.status===401||response.status===403||response.status===400){", "     if(response.status===503&&failure&&failure.error==='live_source_channel_limit'){showSourceQuota();return}\n     if(response.status===401||response.status===403||response.status===400){");
change("    if(!detail.fatal||record.reconnecting)return;\n    diagnose('live','hls_error','video',0);", "    if(code===503&&liveSourceQuotaRejected(detail)){showSourceQuota();return}\n    if(!detail.fatal||record.reconnecting)return;\n    diagnose('live','hls_error','video',0);");


change("function deviceKey(){\n var key='';","var webDeviceKeyInMemory='';\nfunction deviceKey(){\n if(/^[0-9a-f]{64}$/.test(webDeviceKeyInMemory))return webDeviceKeyInMemory;\n var key='';");
change(" if(/^[0-9a-f]{64}$/.test(key))return key;\n var bytes="," if(/^[0-9a-f]{64}$/.test(key)){webDeviceKeyInMemory=key;return key}\n key='';\n var bytes=");
change(" try{localStorage.setItem('blofy_stream_web_device_v1',key)}catch(e){}\n return key"," webDeviceKeyInMemory=key;\n try{localStorage.setItem('blofy_stream_web_device_v1',key)}catch(e){}\n return key");
change("else setStatus(st===409?'الكود مرتبط بجهاز مختلف':st===429?'محاولات كثيرة. جرّب لاحقًا.':'تعذّر تفعيل الاشتراك. تحقق من الكود والاتصال.',true)","else setStatus(st===409?'الكود مرتبط بجهاز مختلف':st===429?'محاولات كثيرة. جرّب لاحقًا.':st===401||st===403?'لم يسمح خادم الاشتراك بالتفعيل. تحقق من حالة الاشتراك.':st>=500||st===0?'تعذر الاتصال بخادم التفعيل مؤقتًا. أعد المحاولة دون تغيير الكود.':'تعذّر تفعيل الاشتراك. تحقق من الكود والاتصال.',true)");
change("     if(record.originTimer){clearTimeout(record.originTimer);record.originTimer=null}\n    }\n   });","     if(record.originTimer){clearTimeout(record.originTimer);record.originTimer=null}\n     if(record.capacityTimer){clearTimeout(record.capacityTimer);record.capacityTimer=null}\n    }\n   });");
change("    if(code===429){\n     if(!preview)","    if(code===429){\n     if(record.capacityTimer||record.originTimer||record.retryTimer)return;\n     if(!preview)");
change("    if((code===502||code===503||code===504)&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){\n     if(!preview)","    if((code===502||code===503||code===504)&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){\n     if(record.capacityTimer||record.originTimer||record.retryTimer)return;\n     if(!preview)");
change("    if((record.transientRetries||0)<3&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){\n     record.transientRetries","    if((record.transientRetries||0)<3&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){\n     if(record.capacityTimer||record.originTimer||record.retryTimer)return;\n     record.transientRetries");
change("  if(error&&error.name==='NotAllowedError'){\n   record.autoplayBlocked=true;\n   status('اضغط تشغيل ▶');\n  }","  if(error&&error.name==='NotAllowedError'){\n   if(preview&&!video.muted&&!record.mutedAutoplayRetried){\n    record.mutedAutoplayRetried=true;S.previewAudioEnabled=false;applyPreviewAudio(video,false);\n    try{var mutedPlay=video.play();if(mutedPlay&&mutedPlay.catch)mutedPlay.catch(handleLivePlayRejection);return}catch(e){}\n   }\n   record.autoplayBlocked=true;\n   status('اضغط تشغيل ▶');\n  }");
change("function playerStatus(message,error){","function renderPlaybackNotice(el,message,mode){\n if(!el)return;\n var text=String(message||'');\n if(mode==='transport'&&text.charAt(0)==='●')text='';\n if(el.blofyNoticeTimer&&el.textContent===text&&el.blofyNoticeMode===mode)return;\n if(el.blofyNoticeTimer){clearTimeout(el.blofyNoticeTimer);el.blofyNoticeTimer=null}\n el.blofyNoticeMode=mode;el.textContent=text;el.style.display=text?'block':'none';\n if(text&&mode==='brief'){\n  el.blofyNoticeTimer=setTimeout(function(){\n   el.blofyNoticeTimer=null;\n   if(el.blofyNoticeMode==='brief'&&el.textContent===text){el.textContent='';el.style.display='none'}\n  },3500)\n }\n}\nfunction playerStatus(message,error){");
change(" if(el){el.style.display=message?'block':'none';el.textContent=message||'';el.className=error?'player-error':'player-loading'}"," if(el){\n  var state=S.playerView,video=state&&state.video;\n  var brief=!error&&message&&video&&!video.paused&&video.readyState>=2&&\n   !/^جار |^انتظر|^اضغط/.test(message);\n  el.className=error?'player-error':'player-loading';\n  renderPlaybackNotice(el,message,error?'error':brief?'brief':'transport')\n }");
change("  if(statusElement){if(statusElement.textContent!==text)statusElement.textContent=text;if(!preview)statusElement.style.display=text&&text.slice(0,1)!=='●'?'block':'none'}","  if(statusElement){\n   if(preview&&String(S.selected)!==String(id))return;\n   renderPlaybackNotice(statusElement,text,'transport')\n  }");
change("  if(!alive()||preview||kind!=='live'||!record.ready||record.reconnecting||","  if(!alive()||kind!=='live'||!record.ready||record.reconnecting||");
change("  if(statusElement&&statusElement.classList.contains('player-loading')&&\n     statusElement.textContent==='جار تشغيل القناة…')statusElement.style.display='none'","  if(preview&&String(S.selected)!==String(id))return;\n  if(statusElement&&statusElement.blofyNoticeMode!=='brief'){\n   if(preview)renderPlaybackNotice(statusElement,'','transport');\n   else playerStatus('')\n  }");
change("  status(preview?'● المعاينة تعمل':'● تشغيل البث');","  if(preview)status('');else playerStatus('');");
change("    status('● تشغيل MPEG-TS المباشر');","    playerStatus('');");
change("var firstReady=!state.ready;state.ready=true;var status=document.getElementById('player-status');if(status)status.style.display='none';","var firstReady=!state.ready;state.ready=true;playerStatus('');");
change("var item=findItem('live',id);if(!item)return;S.selected=id;","var item=findItem('live',id);if(!item)return;\n if(String(S.selected)!==String(id)){var oldNotice=document.getElementById('live-status');if(oldNotice)renderPlaybackNotice(oldNotice,'','transport')}\n S.selected=id;");
change("  clearTimeout(commentaryNoticeTimer);el.textContent=message;el.hidden=false;\n  commentaryNoticeTimer=setTimeout(function(){el.hidden=true;el.textContent=''},3500)","  if(commentaryNoticeTimer&&el.textContent===message&&!el.hidden)return;\n  clearTimeout(commentaryNoticeTimer);el.textContent=message;el.hidden=!message;\n  commentaryNoticeTimer=message?setTimeout(function(){commentaryNoticeTimer=null;el.hidden=true;el.textContent=''},3500):null");
change("  commentaryResume=null;\n  commentaryEpoch++;","  commentaryResume=null;\n  commentaryNotice('');\n  commentaryEpoch++;");
change("   else if(list.length===1)commentaryNotice('لا يتوفر معلق إضافي لهذه القناة الآن.');","   else if(list.length===1)commentaryNotice('');");
change("   showPlayerChoices('المعلقين',list,origin)","   showPlayerChoices(list.length===1?'الصوت الأصلي':'المعلقين',list,origin)");
change("لا توجد مسارات ترجمة في التشغيل الحالي","لا توجد مسارات ترجمة في التشغيل الحالي");
new Function(app);writeFileSync('app.js',app);


 // A 503 while a live producer is still preparing a segment or honoring
 // upstream backoff is not proof that its authenticated session vanished.
 // Keep that SID and the existing bounded Retry-After path. Unknown reasons
 // retain the previous conservative recovery policy.
change("function liveSessionLost(record,detail,code){",`function liveHlsFailureReason(detail){
 try{
  var n=detail&&detail.networkDetails;
  return n&&typeof n.getResponseHeader==='function'?n.getResponseHeader('X-Blofy-Hls-Reason'):
   n&&n.headers&&n.headers.get?n.headers.get('X-Blofy-Hls-Reason'):null
 }catch(e){return null}
}
function liveSessionLost(record,detail,code){`);
change(" return code===503&&/manifestLoad|levelLoad/i.test(String(detail.details||''))",` if(code===503&&['hls_live_segment_not_ready','hls_origin_backoff'].indexOf(liveHlsFailureReason(detail))>=0)return false;
 return code===503&&/manifestLoad|levelLoad/i.test(String(detail.details||''))`);
new Function(app);writeFileSync('app.js',app);
