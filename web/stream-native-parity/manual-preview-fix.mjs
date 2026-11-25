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

new Function(app);writeFileSync('app.js',app);
