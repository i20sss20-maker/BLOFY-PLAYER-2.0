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
change("   var engine=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,liveSyncDurationCount:4,liveMaxLatencyDurationCount:10,maxBufferLength:35,maxBufferHole:1.5,","   var bufferProfile=liveBufferProfile(preview);\n   var engine=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,liveSyncDurationCount:bufferProfile.sync,liveMaxLatencyDurationCount:bufferProfile.maxLatency,maxBufferLength:bufferProfile.buffer,maxBufferHole:1.5,");
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

new Function(app);writeFileSync('app.js',app);
