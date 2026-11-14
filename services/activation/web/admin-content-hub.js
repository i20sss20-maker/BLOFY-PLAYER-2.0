'use strict';
const $=id=>document.getElementById(id);
let loaded=false,busy=false,pilotActive=false,selected='';
const formatBytes=n=>{
 const bytes=Number(n||0);
 if(!Number.isFinite(bytes)||bytes<0)return '—';
 if(bytes<1024)return bytes.toLocaleString('en-US')+' B';
 const labels=['KB','MB','GB','TB'];
 let size=bytes,index=-1;
 do{size/=1024;index++}while(size>=1024&&index<labels.length-1);
 return size.toFixed(size>=10?1:2)+' '+labels[index];
};
function stateLabel(s){
 return {verified:'مكتمل ومتحقق منه',started:'جارٍ النقل',
  staged:'محفوظ جزئيًا - قابل للاستكمال',queued:'في الانتظار',
  running:'جارٍ النقل',paused:'موقوف وقابل للاستكمال',
  failed:'لم يكتمل'}[s]||'غير معروف';
}
function div(className,text){
 const el=document.createElement('div');
 el.className=className;
 if(text!==undefined)el.textContent=text;
 return el;
}
function jobCard(entry){
 const btn=document.createElement('button');
 btn.type='button';btn.className='job';btn.disabled=entry.state!=='verified';
 const top=div('jobtop');
 const title=document.createElement('strong');
 title.textContent=String(entry.runId||'عملية');
 const status=div('chip'+(entry.state==='verified'?' ok':
   entry.state==='failed'?' error':''),stateLabel(entry.state));
 top.append(title,status);btn.append(top);
 const progress=Math.min(100,Math.max(0,Number(entry.percent||0)));
 const meter=div('meter');const fill=div('fill');
 fill.style.width=progress+'%';meter.append(fill);btn.append(meter);
 const row=div('row');
 row.append(div('',progress+'%'),div('',
   formatBytes(entry.bytesCopied)+' / '+formatBytes(entry.expectedBytes)));
 btn.append(row);
 if(entry.state==='verified'){
  btn.setAttribute('aria-label','اختبار تشغيل النسخة المؤكدة: '+entry.runId);
  btn.onclick=()=>selectMovie(entry.runId);
 }
 return btn;
}
function selectMovie(id){
 if(!/^[A-Za-z0-9_-]{8,80}$/.test(id))return;
 selected=id;
 const video=$('player');
 video.pause();
 video.removeAttribute('src');
 video.load();
 video.src='/api/v1/admin/content-hub/canary/'+encodeURIComponent(id);
 video.load();
 $('playerNote').textContent='نسخة خاصة قيد الاختبار · '+id+
  ' · تأكد من وجود صورة وصوت قبل اعتماد التشغيل للعملاء.';
}
async function reload(){
 if(busy)return;busy=true;
 try{
  const response=await fetch('/api/v1/admin/content-hub/status',{
   cache:'no-store',credentials:'same-origin'});
  if(response.status===401){window.location.assign('/admin');return}
  if(!response.ok)throw Error('content_hub_unavailable');
  const data=await response.json();
  const online=data.service==='online'&&data.privateBucketAvailable&&
   data.databaseAvailable;
  $('health').textContent=online?'الخادم متصل':'تحتاج الخدمة إلى فحص';
  $('health').className='badge '+(online?'online':'offline');
  const accounting=data.accounting||{};
  $('verified').textContent=Number(accounting.verifiedCount||0).toLocaleString('en-US');
  $('used').textContent=formatBytes(accounting.verifiedBytes);
  $('active').textContent=Number(accounting.activeCount||0).toLocaleString('en-US');
  $('failed').textContent=Number(accounting.failedCount||0).toLocaleString('en-US');
  pilotActive=data.pilotRunning===true;
  $('cancel').disabled=!pilotActive;
  $('nextBatch').disabled=pilotActive||data.chunkedBatchEnabled!==true;
  const entries=Array.isArray(data.runs)?data.runs:[];
  $('runs').replaceChildren(...(entries.length?
    entries.map(jobCard):[div('placeholder','لا توجد عمليات نقل مسجلة حتى الآن.')]));
  $('notice').textContent=pilotActive?'يوجد نقل جارٍ على الخادم.':
   data.chunkedBatchEnabled?'تستطيع نقل دفعة واحدة بعد التحقق من خمول المصدر.':
   'التنزيل الجزئي غير مفعّل حتى تأكيد خمول المصدر وصلاحية التخزين.';
  loaded=true;
 }catch{
  $('health').textContent='تعذر جلب حالة الخادم';
  $('health').className='badge offline';
  if(!loaded)$('runs').replaceChildren(div('placeholder',
   'لم نتمكن من الاتصال بحالة التخزين الخاص.'));
 }finally{busy=false}
}
$('preflight').addEventListener('click',async()=>{
 const btn=$('preflight'),result=$('preflightResult');
 btn.disabled=true;result.className='source-check';
 result.textContent='جارٍ التحقق من تعريف الفيلم في المصدر…';
 try{
  const response=await fetch('/api/v1/admin/content-hub/preflight',{
   cache:'no-store',credentials:'same-origin'});
  if(response.status===401){location.assign('/admin');return}
  const data=await response.json();
  if(!response.ok||!data.ok){
   result.className='source-check warning';
   result.textContent='تعذر فحص تعريف المصدر. لا يمكن بدء نقل فيلم حتى يصبح الاتصال الخاص جاهزًا.';
   return;
  }
  const matches=data.approvedMovieMatches===true;
  result.className='source-check '+(matches?'ok':'warning');
  const yes=value=>value?'✅ مؤكد بالإعدادات':'⛔ غير مفعّل';
  result.textContent=[
   'المصدر: '+(data.sourceName||'غير معروف'),
   'معرّف الفيلم: '+(data.gatewayId||'غير متوفر'),
   'صيغة الفيلم: '+(data.extension||'غير معروفة'),
   'حجم النسخة المستهدفة: '+(data.expectedBytes?formatBytes(data.expectedBytes):'غير محدد'),
   'تطابق الفيلم المعتمد: '+yes(matches),
   'صلاحية التخزين المعلنة: '+yes(data.storageRightsDeclared),
   'فترة الخمول المعلنة: '+yes(data.sourceQuietDeclared),
   'المصدر غير مستخدم (إقرار): '+yes(data.sourceIdleDeclared),
   'نقل الملفات: '+yes(data.uploadFeatureEnabled),
   'تنزيل الفيديو بسبب هذا الفحص: لا',
   'تنبيه: هذا الفحص لا يؤكد فعليًا خمول المصدر أو حقوق تخزين الفيلم.'
  ].join('\n');
 }catch{
  result.className='source-check warning';
  result.textContent='حدث خطأ في فحص المصدر. لم يبدأ أي تنزيل.';
 }finally{btn.disabled=false}
});
$('nextBatch').addEventListener('click',async()=>{
 if($('nextBatch').disabled)return;
 if(!window.confirm('تأكيد نقل 8 ميجابايت من الفيلم المحدد؟ يجب التأكد أن المصدر لا يستخدمه المشتركين وأن حقوق حفظ الفيلم متاحة.'))return;
 $('nextBatch').disabled=true;
 try{
  const response=await fetch('/api/v1/admin/content-hub/batch/next',{
   method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json'},body:'{}'});
  if(response.status===401){location.assign('/admin');return}
  const data=await response.json();
  $('notice').textContent=response.status===202?
   'تم قبول دفعة واحدة. تابع نسبة الإنجاز أدناه.':
   'لا يمكن بدء الدفعة. راجع تطابق الفيلم وخمول المصدر وإعدادات التخزين.';
 }catch{$('notice').textContent='تعذر إرسال طلب الدفعة.'}
 await reload();
});
$('refresh').addEventListener('click',reload);
$('cancel').addEventListener('click',async()=>{
 if(!pilotActive||!window.confirm('إيقاف النسخ الجاري؟ لن يؤثر ذلك على القنوات، لكن عملية النسخ الحالية ستُلغى.'))return;
 $('cancel').disabled=true;
 try{
  const res=await fetch('/api/v1/admin/content-hub/cancel',{
   method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json'},body:'{}'});
  $('notice').textContent=res.status===202?
    'تم إرسال طلب الإيقاف. جارٍ تحرير الموارد.':
    'لم يتم العثور على عملية جارية.';
 }catch{$('notice').textContent='فشل إرسال طلب الإيقاف.'}
 await reload();
});
$('player').addEventListener('error',()=>{
 if(selected)$('playerNote').textContent=
  'تعذر تشغيل هذا الملف في المتصفح. قد تكون صيغة الفيلم غير مدعومة، أو أن النسخة ليست جاهزة.';
});
reload();setInterval(()=>{if(!document.hidden)reload()},10000);


let seasonRequestBusy=false,seasonActive=false,seasonEnabled=false;
const seasonActions={'x-blofy-owner-action':'season-library'};
const queueUrl='/api/v1/admin/content-hub/seasons/';
function percentMeter(progress){
 const meter=div('meter'),fill=div('fill');
 fill.style.width=Math.min(100,Math.max(0,Number(progress||0)))+'%';
 meter.append(fill);
 return meter;
}
function seasonCard(season,episodes){
 const card=div('season-entry');
 const head=div('jobtop'),name=document.createElement('strong');
 name.textContent=season.seasonKey;
 head.append(name,div('chip',
  season.verifiedCount+' / '+season.episodeCount+' حلقة مكتملة'));
 card.append(head,percentMeter(season.percent),
  div('row',String(season.percent)+'%'));
 card.append(div('muted',formatBytes(season.bytesCopied)+
  ' / '+formatBytes(season.expectedBytes)));
 for(const episode of episodes){
  const row=div('season-episode');
  row.append(div('',String(episode.episodeNumber)+'. '+
   String(episode.title||'حلقة')));
  row.append(div('chip'+(episode.state==='verified'?' ok':
   episode.state==='failed'?' error':''),
   stateLabel(episode.state)+' • '+String(episode.percent)+'%'));
  row.append(percentMeter(episode.percent));
  card.append(row);
 }
 return card;
}
async function refreshSeasons(){
 if(seasonRequestBusy)return;
 seasonRequestBusy=true;
 try{
  const response=await fetch(queueUrl+'queue',{
   credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/admin');return}
  if(!response.ok)throw Error('season_queue_unavailable');
  const data=await response.json();
  seasonEnabled=data.downloadQueueEnabled===true;
  seasonActive=data.worker?.active===true;
  const state=$('seasonState');
  state.textContent=seasonActive?'نقل متسلسل جارٍ':
   seasonEnabled?'جاهز للبدء':'التحميل غير مفعّل';
  state.className='badge '+(seasonActive?'online':
   seasonEnabled?'pending':'offline');
  $('startSeasons').disabled=!seasonEnabled||seasonActive;
  $('pauseSeasons').disabled=!seasonActive;
  $('enqueueSeason').disabled=!seasonEnabled;
  const list=Array.isArray(data.episodes)?data.episodes:[];
  const seasons=Array.isArray(data.seasons)?data.seasons:[];
  $('seasonSummary').replaceChildren(...(seasons.length?
   seasons.map(item=>seasonCard(item,list.filter(
    row=>row.seasonKey===item.seasonKey))):
   [div('placeholder','لا توجد حلقات في قائمة الانتظار بعد.')]));
  const blocked=data.readiness?.blockedBy||[];
  $('seasonNotice').textContent=seasonActive?
   'النقل جارٍ بحلقة واحدة في كل مرة؛ يمكنك الإيقاف بأمان.':
   seasonEnabled?'جاهز لنقل الحلقات التي اخترتها بعد تأكيد خمول المصدر.':
   'النقل متوقف إلى أن تُفعّل صلاحيات التخزين وخمول المصدر من إعدادات الخادم.'+
   (blocked.length?' ('+blocked.join(', ')+')':'');
 }catch{
  $('seasonState').textContent='الخدمة غير متاحة';
  $('seasonState').className='badge offline';
  $('startSeasons').disabled=true;
  $('pauseSeasons').disabled=true;
  $('enqueueSeason').disabled=true;
  $('seasonNotice').textContent='لا يمكن قراءة حالة المواسم حاليًا.';
 }finally{seasonRequestBusy=false}
}
function candidateCard(item,index){
 const row=div('candidate-entry'),line=div('candidate-head');
 const check=document.createElement('input');
 check.type='checkbox';check.className='candidate-select';
 check.dataset.gatewayId=String(item.gatewayId);
 check.setAttribute('aria-label','اختيار '+item.title);
 const title=div('candidate-title',String(item.title)+
  ' · ID '+String(item.gatewayId));
 line.append(check,title);
 const fields=div('candidate-fields');
 const number=document.createElement('input');
 number.type='number';number.min='1';number.max='500';number.step='1';
 number.value=String(index+1);number.className='candidate-number';
 number.setAttribute('aria-label','رقم الحلقة '+item.title);
 const bytes=document.createElement('input');
 bytes.type='number';bytes.min=String(8*1024*1024);
 bytes.max=String(4*1024**3);bytes.step='1';
 bytes.className='candidate-bytes';bytes.placeholder='الحجم بالبايت';
 bytes.setAttribute('aria-label','الحجم الدقيق '+item.title);
 const probe=document.createElement('button');
 probe.type='button';probe.textContent='فحص الحجم (4 KB)';
 probe.addEventListener('click',async()=>{
  if(!confirm('الفحص يقرأ 4 كيلوبايت من مصدر الحلقة. هل المصدر متاح الآن للفحص؟'))return;
  probe.disabled=true;
  try{
   const response=await fetch(queueUrl+'probe',{method:'POST',
    credentials:'same-origin',headers:{...seasonActions,
     'content-type':'application/json'},
    body:JSON.stringify({gatewayId:item.gatewayId})});
   const data=await response.json();
   if(response.ok&&data.ok===true&&Number.isSafeInteger(data.expectedBytes)){
    bytes.value=String(data.expectedBytes);
    probe.textContent='✓ حجم مؤكد: '+formatBytes(data.expectedBytes);
   }else probe.textContent='تعذر الفحص، أعد المحاولة';
  }catch{probe.textContent='فشل الاتصال'}
  finally{probe.disabled=false}
 });
 fields.append(div('muted','رقم الحلقة'),number,
  div('muted','الحجم بالبايت'),bytes,probe);
 row.append(line,fields);return row;
}
$('loadCandidates').addEventListener('click',async()=>{
 const button=$('loadCandidates');button.disabled=true;
 try{
  const response=await fetch(queueUrl+'candidates',{
   credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/admin');return}
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error('candidate_unavailable');
  const candidates=Array.isArray(data.candidates)?data.candidates:[];
  $('seasonCandidates').replaceChildren(...(candidates.length?
   candidates.map(candidateCard):
   [div('placeholder','لا توجد حلقات معتمدة ضمن قائمة المصدر الحالية.')]));
 }catch{$('seasonCandidates').replaceChildren(
  div('placeholder','تعذر جلب قائمة الحلقات. لم يبدأ أي تنزيل.'))}
 finally{button.disabled=false}
});
$('enqueueSeason').addEventListener('click',async()=>{
 const seasonKey=$('seasonKey').value.trim();
 if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(seasonKey)){
  $('seasonNotice').textContent='أدخل معرّف موسم مثل series_s01.';
  return;
 }
 const selected=[...document.querySelectorAll(
  '#seasonCandidates .candidate-entry')].filter(row=>
   row.querySelector('.candidate-select').checked);
 if(!selected.length){
  $('seasonNotice').textContent='اختر حلقة واحدة على الأقل.';return;
 }
 const episodes=selected.map(row=>({
  gatewayId:Number(row.querySelector('.candidate-select').dataset.gatewayId),
  episodeNumber:Number(row.querySelector('.candidate-number').value),
  expectedBytes:Number(row.querySelector('.candidate-bytes').value)
 }));
 if(episodes.some(e=>!Number.isSafeInteger(e.expectedBytes)||
   e.expectedBytes<8388608||e.expectedBytes>4*1024**3||
   !Number.isSafeInteger(e.episodeNumber)||e.episodeNumber<1||
   e.episodeNumber>500)){
  $('seasonNotice').textContent='يجب فحص الحجم الدقيق وتحديد رقم صحيح لكل حلقة.';
  return;
 }
 if(!confirm('تأكيد أنك تملك تصريح تخزين هذه الحلقات وأن المصدر خامل؟ ستُضاف للقائمة فقط، ولن يبدأ النقل الآن.'))return;
 $('enqueueSeason').disabled=true;
 try{
  const response=await fetch(queueUrl+'enqueue',{
   method:'POST',credentials:'same-origin',headers:{
    ...seasonActions,'content-type':'application/json'},
   body:JSON.stringify({seasonKey,episodes})});
  const data=await response.json();
  $('seasonNotice').textContent=response.ok?
   'تمت إضافة '+data.added+' حلقة إلى قائمة الانتظار.':
   'تعذرت الإضافة. تحقق من الصلاحيات، تطابق الحلقات، وعدم تكرارها.';
 }catch{$('seasonNotice').textContent='تعذر الاتصال بقائمة الانتظار.'}
 await refreshSeasons();
});
$('startSeasons').addEventListener('click',async()=>{
 if(!confirm('بدء/استكمال النقل الخاص المتسلسل؟ تأكد الآن من خمول المصدر وتوفر ترخيص تخزين كل حلقة.'))return;
 $('startSeasons').disabled=true;
 try{
  const response=await fetch(queueUrl+'start',{method:'POST',
   credentials:'same-origin',headers:seasonActions});
  $('seasonNotice').textContent=response.status===202?
   'بدأ نقل الحلقات بشكل متسلسل مع نقاط استكمال.':
   'تعذر بدء النقل؛ تحقق من خمول المصدر والإعدادات.';
 }catch{$('seasonNotice').textContent='فشل بدء نقل الموسم.'}
 await refreshSeasons();
});
$('pauseSeasons').addEventListener('click',async()=>{
 if(!confirm('إيقاف نقل الحلقات مع الاحتفاظ بالأجزاء المكتملة؟'))return;
 $('pauseSeasons').disabled=true;
 try{
  const response=await fetch(queueUrl+'pause',{method:'POST',
   credentials:'same-origin',headers:seasonActions});
  $('seasonNotice').textContent=response.status===202?
   'تم طلب إيقاف النقل بأمان؛ ستبقى الأجزاء المحفوظة.':
   'لم توجد جلسة نقل حلقات نشطة.';
 }catch{$('seasonNotice').textContent='تعذر إرسال طلب الإيقاف.'}
 await refreshSeasons();
});
$('refreshSeasons').addEventListener('click',refreshSeasons);
refreshSeasons();
setInterval(()=>{if(!document.hidden)refreshSeasons()},10000);

$('loadEpisodePreview').addEventListener('click',()=>{
 episodeSamplePlayed=false;
 $('ownerSawPicture').checked=false;
 $('ownerHeardAudio').checked=false;
 updateOwnerAVButton();
 const video=$('episodePlayer');
 video.pause();video.removeAttribute('src');video.load();
 video.src='/api/v1/admin/content-hub/episodes/preview';
 video.load();
 $('episodePlayerNote').textContent=
  'شغّل المقطع وتحقق من ظهور الصورة وسماع الصوت بنفسك. هذه عينة خاصة لا تغيّر مسارات المشتركين.';
});
$('episodePlayer').addEventListener('error',()=>{
 $('episodePlayerNote').textContent=
  'تعذّر عرض العينة: قد تكون صلاحية المعاينة غير مفعّلة، أو لم يكتمل التحقق، أو المتصفح لا يدعم الملف.';
});


let episodeSamplePlayed=false,episodeAVConfirmed=false;
function updateOwnerAVButton(){
 $('confirmEpisodeAV').disabled=episodeAVConfirmed||
  !episodeSamplePlayed||!$('ownerSawPicture').checked||
  !$('ownerHeardAudio').checked;
}
$('ownerSawPicture').addEventListener('change',updateOwnerAVButton);
$('ownerHeardAudio').addEventListener('change',updateOwnerAVButton);
$('episodePlayer').addEventListener('timeupdate',()=>{
 if($('episodePlayer').currentTime>0.4){
  episodeSamplePlayed=true;updateOwnerAVButton();
 }
});
async function loadEpisodeBrowserConfirmation(){
 try{
  const response=await fetch('/api/v1/admin/content-hub/episodes/confirmation',{
   credentials:'same-origin',cache:'no-store'});
  if(response.status===401){location.assign('/admin');return}
  const data=await response.json();
  if(!response.ok)return;
  episodeAVConfirmed=data.confirmed===true;
  if(episodeAVConfirmed)
   $('episodeAVStatus').textContent='✅ تم تسجيل تأكيد المشاهدة والصوت من المسؤول'+
    (data.confirmedAt?' بتاريخ '+new Date(data.confirmedAt).toLocaleString('ar-SA'):'');
  updateOwnerAVButton();
 }catch{}
}
$('confirmEpisodeAV').addEventListener('click',async()=>{
 if(!episodeSamplePlayed||!$('ownerSawPicture').checked||
   !$('ownerHeardAudio').checked)return;
 if(!confirm('هل شاهدت صورة الحلقة وسمعت صوتها فعليًا داخل المتصفح؟ سيتم حفظ تأكيدك لاستخدامه كشرط قبل بدء نقل المواسم.'))return;
 const btn=$('confirmEpisodeAV');btn.disabled=true;
 try{
  const response=await fetch('/api/v1/admin/content-hub/episodes/confirm',{
   method:'POST',credentials:'same-origin',headers:{
    'x-blofy-owner-action':'browser-av-tested',
    'content-type':'application/json'
   },body:JSON.stringify({videoConfirmed:true,audioConfirmed:true})});
  if(response.status===401){location.assign('/admin');return}
  const data=await response.json();
  if(response.ok&&data.ok){
   episodeAVConfirmed=true;
   $('episodeAVStatus').textContent='✅ تم اعتماد تشغيل الحلقة بالصورة والصوت.'; 
  }else{
   $('episodeAVStatus').textContent=
    'لا يمكن الاعتماد: يجب أن تكون النسخة مكتملة ومتحقق منها وتفعيل المعاينة للمسؤول.';
  }
 }catch{$('episodeAVStatus').textContent='تعذر الاتصال لحفظ تأكيد التشغيل.'}
 updateOwnerAVButton();
});
loadEpisodeBrowserConfirmation();
