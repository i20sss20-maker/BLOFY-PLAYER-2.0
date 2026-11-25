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


 // Search-specific timeout follows the server's bounded 100s scan.
change("xhr.timeout=40000;","xhr.timeout=endpoint.indexOf('/api/page?')===0&&endpoint.indexOf('&query=')>=0?115000:40000;");
change("function searchNow(q,token){\n var old=","function searchNow(q,token){\n if(token!==S.searchToken||S.route!=='search')return;\n if(S.searchTimer){clearTimeout(S.searchTimer);S.searchTimer=null}\n var old=");
change(" function draw(){\n  if(token!==S.searchToken||S.route!=='search')return;",` var localKinds={};
 function normalizeLocal(value){
  var text=String(value||'').toLowerCase();
  if(typeof text.normalize==='function')text=text.normalize('NFKC');
  return text.replace(/[\\u064b-\\u065f\\u0670\\u0640]/g,'').replace(/[\\u0622\\u0623\\u0625\\u0671]/g,'ا').replace(/\\u0649/g,'ي').replace(/\\u0624/g,'و').replace(/\\u0626/g,'ي')
 }
 var words=normalizeLocal(q).trim().slice(0,75).split(/\\s+/).filter(Boolean);
 kinds.forEach(function(k){
  var seen=Object.create(null),keys=Object.keys(S.loaded);
  for(var i=0;i<keys.length&&responses[k].length<20;i++){
   if(keys[i].indexOf(k+':')!==0)continue;
   var items=S.loaded[keys[i]].items||[];
   for(var j=0;j<items.length&&responses[k].length<20;j++){
    var item=items[j],id=itemId(item,k),name=normalizeLocal(item.name||item.title);
    if(!id||seen[id]||!words.length||!words.every(function(w){return name.indexOf(w)>=0}))continue;
    seen[id]=true;responses[k].push(item)
   }
  }
  if(responses[k].length){localKinds[k]=true;S.loaded[keyOf(k,'search')]={items:responses[k]}}
 });
 function draw(){
  if(token!==S.searchToken||S.route!=='search')return;`);
change("  status.textContent=(count?'تم العثور على '+count+' نتيجة':pending?'جار البحث':failed?'تعذر البحث':'لا توجد نتائج')+(pending?' • استكمال باقي المكتبة…':failed&&count?' • تعذر البحث في بعض الأقسام':'')","  status.textContent=(count?(Object.keys(localKinds).length?'نتائج أولية: ':'تم العثور على ')+count+' نتيجة':pending?'جار البحث':failed?'تعذر البحث':'لا توجد نتائج')+(pending?' • استكمال باقي المكتبة…':failed&&count?' • بعض النتائج غير مكتملة':'')");
change(" for(var i=0;i<kinds.length;i++)(function(k){\n  var xhr=pageRequest(k,'all',0,20"," draw();\n for(var i=0;i<kinds.length;i++)(function(k){\n  var xhr=pageRequest(k,'all',0,20");
change("    responses[k]=p.items.slice(0,20);","    delete localKinds[k];\n    responses[k]=p.items.slice(0,20);");
let server=readFileSync('server.ts','utf8');
const oldMatch="(!query||normalizeSearch(item.name||item.title||'').includes(query))";
if(server.split(oldMatch).length!==2)throw Error('unexpected server search filter');
server=server.replace(oldMatch,"(!query||query.split(/\\s+/).every(word=>normalizeSearch(item.name||item.title||'').includes(word)))");
writeFileSync('server.ts',server);

new Function(app);writeFileSync('app.js',app);
