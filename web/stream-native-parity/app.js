/* BLOFY STREAM Web — visual parity port from Android STREAM 56.0.4.
 * Source references in README.md; native Android-only APIs are not emulated.
 * ES5-compatible UI code for older VIDAA WebKit/Chromium engines.
 * Playback is deliberately distinct: LIVE HLS, VOD seekable MP4 when possible.
 */
(function(){
'use strict';
// SRAF/older TV engines predate Node.isConnected. Keep media guards working.
if(typeof Node!=='undefined'&& !('isConnected' in Node.prototype)){
 try{Object.defineProperty(Node.prototype,'isConnected',{configurable:true,get:function(){return !!(this.ownerDocument&&this.ownerDocument.documentElement&&this.ownerDocument.documentElement.contains(this))}})}catch(e){}
}
var app=document.getElementById('app');
var S={route:'boot',kind:'movie',cat:{live:'all',movie:'all',series:'all'},cats:{},pages:{},loaded:{},selected:null,livePreview:null,
 item:null,episodes:null,selectedSeason:'1',play:null,history:[],sort:'source',heroIndex:0,searchToken:0,requestNum:0,library:{},
 watch:{},favoriteItems:{},lastPlaybackDiag:null,lastLongPlaybackTest:null,profileKey:'',accountEpoch:0,epgToken:0,epgTimer:null,epgCache:{},host:'',userVerified:false,heading:'',loading:false,listingInflight:{},catsInflight:{},views:{},keyboardMode:false,refreshing:false,catalogVersion:null,lastCatalogCheck:0,aiTurns:[],aiBusy:false,aiToken:0,aiSearchTitle:null,searchRequests:[],searchKind:'all',recentSearches:[]};
var browserDepth=0,handlingBrowserPop=false;
var pendingInstallPrompt=null;
var lastRemoteKeyAt=0;
/* Adapt controls based on device/browser, not width alone. */
function deviceExperience(ua,touchPoints,coarse){
 var agent=String(ua||''),touch=Number(touchPoints)||0;
 if(/VIDAA|Hisense|Toshiba|SRAF\/|SmartTV|SMART-TV|Tizen|webOS|Web0S|HbbTV|Android TV|Google TV|AFT[A-Z0-9]{2,}/i.test(agent))return 'tv';
 if(/iPhone|iPad|iPod|Android|Mobile/i.test(agent)||/Macintosh/i.test(agent)&&touch>1||coarse||touch>0)return 'touch';
 return 'desktop'
}
/* Tap only the video canvas to show/hide the touch HUD. Never intercept
 * TV remote actions, playback menus, native fullscreen, paused video or errors. */
function touchPlayerTapDecision(inputMode,onVideo,hidden,locked){
 if(inputMode!=='touch'||!onVideo)return 'reveal';
 if(hidden)return 'reveal';
 return locked?'reveal':'hide'
}
function appleTouchBrowser(ua,touchPoints){
 return /iPhone|iPad|iPod/i.test(String(ua||''))||
  /Macintosh/i.test(String(ua||''))&&Number(touchPoints)>1
}
/* A double tap only seeks VOD when both taps are on the same outer third
 * of the video, close in time and position. LIVE never creates a seek.
 * Pure helper: no network work, timers or account state. */
function touchSeekDecision(previous,now,x,y,width,kind,blocked){
 var position=Number(x),screenWidth=Number(width),at=Number(now),up=Number(y);
 if(blocked||kind==='live'||!Number.isFinite(at)||!Number.isFinite(position)||
    !Number.isFinite(screenWidth)||screenWidth<90||
    position<0||position>screenWidth||!Number.isFinite(up))
  return {last:null,step:0};
 var side=position<screenWidth*0.34?-1:position>screenWidth*0.66?1:0;
 if(!side)return {last:null,step:0};
 var close=previous&&previous.side===side&&
  at-previous.at>=45&&at-previous.at<=340&&
  Math.abs(previous.x-position)<=46&&Math.abs(previous.y-up)<=46;
 return {last:close?null:{at:at,x:position,y:up,side:side},step:close?side*10:0}
}
function browserConnectionCopy(online){
 return online===false?
  'الجهاز يبدو غير متصل بالإنترنت. لن يُعاد تشغيل القناة تلقائيًا؛ تحقق من اتصال Wi-Fi أو البيانات.':
  'عاد اتصال الجهاز حسب المتصفح. إذا استمر التقطيع فقد يكون السبب بالمصدر أو الشبكة.'
}
function setDeviceInput(mode){
 if(mode!=='remote'&&mode!=='touch'&&mode!=='mouse')return;
 S.keyboardMode=mode==='remote';
 if(document.documentElement)document.documentElement.setAttribute('data-blofy-input',mode);
 if(mode!=='remote'){
  var old=document.querySelector('.remote-focus');
  if(old)old.classList.remove('remote-focus')
 }
 var label=document.getElementById('device-experience-result');
 if(label&&label.isConnected)updateDeviceExperienceStatus()
}
function updateDeviceExperienceStatus(){
 var label=document.getElementById('device-experience-result');
 if(!label)return;
 var family=document.documentElement.getAttribute('data-blofy-device')||'desktop',
  mode=document.documentElement.getAttribute('data-blofy-input')||'mouse';
 var kinds={tv:'شاشة تلفزيون',touch:'هاتف أو جهاز لمس',desktop:'كمبيوتر'},
  inputs={remote:'ريموت أو لوحة مفاتيح',touch:'اللمس',mouse:'الماوس'};
 label.textContent='وضع العرض: '+(kinds[family]||kinds.desktop)+
  ' • التحكم الحالي: '+(inputs[mode]||inputs.mouse)+
  ' • يمكنك تغيير طريقة التحكم فورًا دون إعادة تحميل أو مساس بالبث.'
}
function initDeviceExperience(){
 var coarse=false;
 try{coarse=!!(window.matchMedia&&window.matchMedia('(pointer: coarse)').matches)}catch(e){}
 var family=deviceExperience(navigator.userAgent,navigator.maxTouchPoints,coarse);
 document.documentElement.setAttribute('data-blofy-device',family);
 setDeviceInput(family==='tv'?'remote':family==='touch'?'touch':'mouse')
}
initDeviceExperience();
function webAppInstallGuide(ua,installed,canPrompt,touchPoints){
 if(installed)return {mode:'installed',action:'تمت الإضافة',message:'BLOFY يعمل الآن كتطبيق مستقل على هذا الجهاز. المحتوى يحتاج اتصالاً بالإنترنت واشتراكاً فعالاً.'};
 if(/iPhone|iPad|iPod/i.test(String(ua||''))||/Macintosh/i.test(String(ua||''))&&Number(touchPoints)>1)
  return {mode:'ios',action:'طريقة الإضافة للآيفون',message:'افتح tv.blofyplayer.com من Safari ثم مشاركة ← إضافة إلى الشاشة الرئيسية، وفَعِّل «فتح كتطبيق» إن ظهر. لا يُمكن للموقع تثبيت نفسه تلقائياً على iPhone.'};
 if(/VIDAA|Hisense|Toshiba|SRAF\//i.test(String(ua||'')))
  return {mode:'tv',action:'طريقة الإضافة للتلفزيون',message:'افتح tv.blofyplayer.com في متصفح التلفزيون. استخدم المفضلة أو «إضافة للرئيسية» إذا ظهرت في خيارات المتصفح؛ تثبيت تطبيق VIDAA رسمي يحتاج نشره عبر المنصة. اختبر التنقل بالريموت وتشغيل قناة فعلية.'};
 if(canPrompt)return {mode:'prompt',action:'تثبيت BLOFY على الجهاز',message:'تثبيت التطبيق من المتصفح لا يحمّل القنوات ولا يضيف اشتراكاً جديداً.'};
 if(/Android/i.test(String(ua||'')))
  return {mode:'android',action:'طريقة الإضافة للأندرويد',message:'من Chrome افتح قائمة ⋮ واختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» إذا كانت متاحة.'};
 return {mode:'browser',action:'طريقة إضافة BLOFY',message:'افتح قائمة المتصفح وابحث عن «تثبيت التطبيق» أو «إنشاء اختصار». توفر الخيار يعتمد على الجهاز والمتصفح.'}
}
function installedWebApp(){
 try{
  return navigator.standalone===true||!!(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)
 }catch(e){return false}
}
function updateInstallGuide(){
 var button=document.getElementById('install-blofy-web'),feedback=document.getElementById('install-blofy-help');
 if(!button||!feedback)return;
 var state=webAppInstallGuide(navigator.userAgent,installedWebApp(),!!pendingInstallPrompt,navigator.maxTouchPoints);
 button.textContent=state.action;button.disabled=state.mode==='installed';button.hidden=state.mode==='installed';
 feedback.textContent=state.mode==='installed'?'':state.message
}

var NAV=[['home','⌂','الرئيسية'],['live','◉','البث المباشر'],['movie','▣','الأفلام'],['series','▤','المسلسلات'],['collections','▦','التصنيفات'],['favorites','♡','المفضلة'],['downloads','↓','التنزيلات'],['search','⌕','البحث'],['ai','✧','الذكاء الاصطناعي'],['settings','⚙','الإعدادات']];
function readJson(key,backup){try{var value=JSON.parse(localStorage.getItem(key)||'null');return value||backup}catch(e){return backup}}
function writeJson(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(e){}}
function profileStorageKey(name){return 'blofy_web_profile_v1:'+S.profileKey+':'+name}
function profileSave(name,value){if(S.profileKey)writeJson(profileStorageKey(name),value)}
// Existing preview clients partitioned their favorites by the full MAC of
// the code-bound access token. Renewing that same account changes the token,
// hiding those local favorites. The authenticated server now returns an opaque
// stable account partition plus this exact old-token legacy partition only
// for one-time same-device local migration. Nothing is uploaded to the server.
function migrateLegacyProfile(id,legacy){
 if(!/^[a-f0-9]{24}$/.test(String(id||''))||
  !/^[a-f0-9]{24}$/.test(String(legacy||''))||id===legacy)return;
 var names=['favorites','favoriteItems','watch','recentSearches','lastPlaybackDiag','lastLongPlaybackTest'];
 for(var i=0;i<names.length;i++){
  var newKey='blofy_web_profile_v1:'+id+':'+names[i];
  var oldKey='blofy_web_profile_v1:'+legacy+':'+names[i];
  try{
   // Never erase a newer stable-account value or remove legacy backups.
   // Malformed huge old entries are ignored instead of filling TV storage.
   if(localStorage.getItem(newKey)!==null)continue;
   var oldValue=localStorage.getItem(oldKey);
   if(oldValue===null||oldValue.length>220000)continue;
   JSON.parse(oldValue);
   localStorage.setItem(newKey,oldValue)
  }catch(e){}
 }
}
function useProfile(id,legacy){
 if(!/^[a-f0-9]{24}$/.test(String(id||'')))return false;
 migrateLegacyProfile(id,legacy);
 var changed=S.profileKey!==id;
 if(changed){S.accountEpoch++;S.downloadPending=null;resetCatalogRefresh()}
 S.profileKey=id;
 S.library=readJson(profileStorageKey('favorites'),{});
 S.watch=readJson(profileStorageKey('watch'),{});
 S.favoriteItems=readJson(profileStorageKey('favoriteItems'),{});
 S.recentSearches=readJson(profileStorageKey('recentSearches'),[]);
 S.lastPlaybackDiag=readJson(profileStorageKey('lastPlaybackDiag'),null);
 S.lastLongPlaybackTest=readJson(profileStorageKey('lastLongPlaybackTest'),null);
 if(changed){
  if(S.epgTimer){clearTimeout(S.epgTimer);S.epgTimer=null}
  S.epgToken++;S.epgCache={};
  S.loaded={};S.cats={};S.pages={};S.item=null;S.episodes=null;S.episodesSeriesId='';S.selectedSeason='';S.detailInfo=null;S.views={};S.aiTurns=[];S.aiBusy=false;S.aiToken++;S.aiSearchTitle=null;
  S.selected=null;S.livePreview=null;S.listingInflight={};S.catsInflight={}
 }
 return true
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function enc(s){return encodeURIComponent(String(s==null?'':s))}
function urlPic(raw){if(Array.isArray(raw))raw=raw[0];if(typeof raw!=='string')return '';var s=raw.trim();if(!/^https?:\/\/[^\s<>]+$/i.test(s))return '';if(/[?&](username|password|token|api_key|auth)=/i.test(s))return '';if(s.slice(0,5)==='http:')s='https:'+s.slice(5);return s}
function artCandidates(x){
 if(!x)return [];
 var arr=[x.stream_icon,x.cover_big,x.cover,x.movie_image,x.poster,x.poster_url,x.thumbnail,x.icon,x.backdrop,x.backdrop_path],seen={},result=[];
 for(var i=0;i<arr.length&&result.length<4;i++){
  var p=urlPic(arr[i]);if(p&&!seen[p]){seen[p]=true;result.push(p)}
 }
 return result
}
function art(x){var all=artCandidates(x);return all[0]||''}
function title(x){return x&&(x.name||x.title||x.episode_name)||'بدون عنوان'}
function kindName(k){return k==='live'?'البث المباشر':k==='movie'?'الأفلام':k==='series'?'المسلسلات':'BLOFY STREAM'}
function itemId(x,k){return String(x?(k==='series'?(x.series_id||x.id):(x.stream_id||x.id))||'':'')}
function findItem(k,id){var sets=[];var keys=Object.keys(S.loaded);for(var i=0;i<keys.length;i++)if(keys[i].indexOf(k+':')===0)sets.push(S.loaded[keys[i]].items||[]);for(var a=0;a<sets.length;a++)for(var b=0;b<sets[a].length;b++)if(itemId(sets[a][b],k)===id)return sets[a][b];return S.favoriteItems[k+':'+id]||null}
var pendingMediaStops=0;
function api(method,endpoint,payload,cb){
 var mediaStop=method==='POST'&&/\/stop(?:\?|$)/.test(endpoint);
 if(mediaStop)pendingMediaStops++;
 function finishMediaStop(){if(mediaStop){mediaStop=false;pendingMediaStops=Math.max(0,pendingMediaStops-1)}}
 var xhr=new XMLHttpRequest(),done=false,epoch=S.accountEpoch;
 try{xhr.open(method,endpoint,true);xhr.withCredentials=true;xhr.timeout=40000;
 xhr.setRequestHeader('Accept','application/json');if(method==='POST')xhr.setRequestHeader('Content-Type','application/json');
 xhr.onreadystatechange=function(){if(xhr.readyState===4&&!done){done=true;finishMediaStop();
   if(epoch!==S.accountEpoch)return;
   var json={};try{json=JSON.parse(xhr.responseText)}catch(e){}cb(xhr.status,json)
  }};
 xhr.onerror=xhr.ontimeout=function(){if(!done){done=true;finishMediaStop();
   if(epoch===S.accountEpoch)cb(0,{error:'network_unavailable'})
  }};
 xhr.send(payload?JSON.stringify(payload):null);
  return xhr
 }catch(e){finishMediaStop();cb(0,{error:'request_failed'});return null}
}
function setStatus(text,error){var box=document.getElementById('page-status')||document.getElementById('login-status');if(box){box.textContent=text;box.className=error?'info error':'info'}}
function deviceKey(){
 var key='';try{key=localStorage.getItem('blofy_stream_web_device_v1')||''}catch(e){}
 if(/^[0-9a-f]{64}$/.test(key))return key;
 var bytes=new Uint8Array(32),hex='0123456789abcdef';
 if(window.crypto&&window.crypto.getRandomValues)window.crypto.getRandomValues(bytes);
 else for(var i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
 for(var j=0;j<bytes.length;j++)key+=hex[(bytes[j]>>4)&15]+hex[bytes[j]&15];
 try{localStorage.setItem('blofy_stream_web_device_v1',key)}catch(e){}
 return key
}
var savedLoginEnabled=false,accountSwitching=false;
function reloadSavedLogin(){
 try{localStorage.setItem('blofy-account-switch-notice',String(Date.now()))}catch(e){}
 window.location.reload()
}
window.addEventListener('storage',function(e){
 if(e.key==='blofy-account-switch-notice'&&e.newValue)window.location.reload()
});
function login(message){
 clearOfflineGrant();
 S.accountEpoch++;S.downloadPending=null;resetCatalogRefresh();
 cleanupPlayer();S.route='login';S.userVerified=false;S.history=[];
 S.profileKey='';S.library={};S.watch={};S.favoriteItems={};S.recentSearches=[];S.lastPlaybackDiag=null;S.lastLongPlaybackTest=null;
 S.loaded={};S.cats={};S.pages={};S.item=null;S.episodes=null;S.episodesSeriesId='';S.selectedSeason='';S.detailInfo=null;S.views={};S.aiTurns=[];S.aiBusy=false;S.aiToken++;S.aiSearchTitle=null;
 S.listingInflight={};S.catsInflight={};S.selected=null;S.livePreview=null;
 if(S.epgTimer){clearTimeout(S.epgTimer);S.epgTimer=null}
 S.epgToken++;S.epgCache={};
 app.innerHTML='<div class="login-screen screen-appear native-login-screen"><div class="login-panel native-stream-login">'+
 '<div class="login-brand native-login-brand">BLOFY STREAM</div><p class="native-login-tagline">البث المباشر والأفلام والمسلسلات</p><div class="native-login-divider" aria-hidden="true"></div>'+
 '<div class="native-login-modes" role="group" aria-label="طريقة الدخول"><button class="native-login-mode active" type="button" id="login-mode-code" aria-pressed="true">الكود</button><button class="native-login-mode" type="button" id="login-mode-xtream" aria-pressed="false" disabled aria-describedby="direct-login-notice">اكستريم</button><button class="native-login-mode" type="button" id="login-mode-m3u" aria-pressed="false" disabled aria-describedby="direct-login-notice">M3U</button></div>'+
 '<form id="stream-login-form"><div id="login-code-fields"><label class="native-login-title" for="activation-code">أدخل كود الاشتراك</label>'+
 '<input class="input" id="activation-code" placeholder="•••• ••••" maxlength="24" inputmode="numeric" autocomplete="off" autocapitalize="characters" spellcheck="false" dir="ltr">'+
 '</div><div id="login-direct-fields" hidden></div><button class="btn native-login-submit" id="redeem" type="submit">ابدأ المشاهدة</button></form><div class="login-status" id="login-status" role="status" aria-live="polite">'+esc(message||'أدخل كود اشتراكك')+'</div>'+
 '<div id="saved-login-slots" hidden></div><p class="native-login-secure">اتصال آمن بحسابك</p><p class="native-login-unavailable" id="direct-login-notice">دخول اكستريم وM3U غير متاح في الويب بعد.</p><a class="btn secondary" id="external-playlist-entry" href="/playlist-preview" hidden>مصادر Xtream وM3U الخارجية</a></div></div>';
 var form=document.getElementById('stream-login-form'),mode='code',directReady=false;
 var codeFields=document.getElementById('login-code-fields'),directFields=document.getElementById('login-direct-fields'),notice=document.getElementById('direct-login-notice');
 var modes={code:document.getElementById('login-mode-code'),xtream:document.getElementById('login-mode-xtream'),m3u:document.getElementById('login-mode-m3u')};
 function updateModeButtons(busy){
  Object.keys(modes).forEach(function(k){modes[k].disabled=!!busy||(k!=='code'&&!directReady);modes[k].setAttribute('aria-pressed',String(k===mode));modes[k].classList.toggle('active',k===mode)})
 }
 function selectMode(k){
  if(!modes[k]||modes[k].disabled||document.getElementById('redeem').disabled)return;
  mode=k;codeFields.hidden=k!=='code';directFields.hidden=k==='code';
  directFields.innerHTML=k==='xtream'?'<label class="native-login-title" for="provider-host">الهوست</label><input class="input" id="provider-host" value="https://x.blofyplayer.com" type="url" maxlength="512" dir="ltr" autocomplete="off" spellcheck="false"><label class="native-login-title" for="provider-username">اسم المستخدم</label><input class="input" id="provider-username" maxlength="256" dir="ltr" autocomplete="off" spellcheck="false"><label class="native-login-title" for="provider-password">كلمة المرور</label><input class="input" type="password" id="provider-password" maxlength="256" dir="ltr" autocomplete="off">':k==='m3u'?'<label class="native-login-title" for="provider-url">رابط M3U الخاص ببلوفي</label><input class="input" id="provider-url" type="password" maxlength="2048" dir="ltr" autocomplete="off" spellcheck="false" placeholder="https://x.blofyplayer.com/get.php?...">':'';
  updateModeButtons(false);setStatus(k==='code'?'أدخل كود اشتراكك':'يتطلب اشتراك BLOFY مؤهلًا للدخول المباشر.');
  var field=document.getElementById(k==='code'?'activation-code':k==='xtream'?'provider-username':'provider-url');if(field)field.focus()
 }
 Object.keys(modes).forEach(function(k){modes[k].onclick=function(){selectMode(k)}});
 form.onsubmit=function(e){
  e.preventDefault();if(mode==='code'){redeem();return}
  var btn=document.getElementById('redeem');if(!directReady||!btn||btn.disabled)return;
  var payload={mode:mode,deviceKey:deviceKey()};
  if(mode==='xtream'){
   payload.host=document.getElementById('provider-host').value.trim();payload.username=document.getElementById('provider-username').value;payload.password=document.getElementById('provider-password').value;
   if(!payload.host||!payload.username||!payload.password){setStatus('أكمل بيانات اشتراكك.',true);return}
   document.getElementById('provider-password').value='';
  }else{
   payload.url=document.getElementById('provider-url').value.trim();
   if(!payload.url){setStatus('أدخل رابط اشتراك M3U.',true);return}
   document.getElementById('provider-url').value='';
  }
  btn.disabled=true;updateModeButtons(true);setStatus('جار التحقق من الاشتراك…');
  api('POST','/api/direct-login',payload,function(st,r){
   btn.disabled=false;updateModeButtons(false);
   if(st===200&&r.ok&&savedLoginEnabled){reloadSavedLogin();return}
   if(st===200&&r.ok&&useProfile(r.profileKey,r.legacyProfileKey)){S.userVerified=true;rememberOfflineGrant(r.profileKey,r.expiresAt);navigate('home',{},true);warmDesktopHlsAfterAuth();return}
   setStatus(st===429?'محاولات كثيرة. جرّب لاحقًا.':st===400?'تحقق من رابط أو بيانات BLOFY.':st===401?'تحقق من الاشتراك، أو استخدم كود التفعيل الأصلي إن كان مرتبطًا بجهاز.':'الدخول غير متاح حاليًا. حاول لاحقًا.',true)
  })
 };
 api('GET','/api/login-modes',null,function(st,v){
  if(S.route!=='login'||!form.isConnected)return;
  if(st===200&&v.savedLogins===true){
   savedLoginEnabled=true;
   api('GET','/api/saved-logins',null,function(status,data){
    if(S.route!=='login'||!form.isConnected||status!==200||!data||!Array.isArray(data.modes))return;
    var slot=document.getElementById('saved-login-slots'),labels={code:'الكود',xtream:'اكستريم',m3u:'M3U'};
    var keys=data.modes.filter(function(k){return Object.prototype.hasOwnProperty.call(labels,k)});
    if(!keys.length)return;
    slot.hidden=false;slot.innerHTML='<p>اشتراكات محفوظة</p>'+keys.map(function(k){return '<button type="button" class="btn secondary" data-saved-mode="'+k+'">'+labels[k]+(data.active===k?' • الحالي':'')+'</button> '}).join('');
    slot.onclick=function(e){
     var target=e.target,k=target.getAttribute('data-saved-mode'),btn=document.getElementById('redeem');
     if(!k||!btn||btn.disabled)return;
     btn.disabled=true;updateModeButtons(true);setStatus('جار التحقق من الاشتراك المحفوظ…');
     api('POST','/api/saved-logins/switch',{mode:k},function(st,r){
      if(st===200&&r&&r.ok){reloadSavedLogin();return}
      btn.disabled=false;updateModeButtons(false);setStatus(st===401?'انتهت صلاحية الجلسة المحفوظة. سجل دخول هذا الاشتراك مجددًا.':'تعذر التبديل مؤقتًا، اشتراكاتك محفوظة.',true)
     })
    }
   })
  }
  if(st===200&&v.external===true){var external=document.getElementById('external-playlist-entry');if(external)external.hidden=false}
  if(st===200&&v.direct===true){directReady=true;notice.textContent='دخول اشتراكات BLOFY المؤهلة؛ الروابط الخارجية غير مدعومة هنا.';updateModeButtons(false)}
 });
 setTimeout(function(){if(S.route==='login'&&mode==='code')(document.getElementById('activation-code')||{focus:function(){}}).focus()},70)
}
function redeem(){
 var btn=document.getElementById('redeem');if(!btn||btn.disabled)return;
 var code=(document.getElementById('activation-code').value||'').replace(/[\s-]/g,'').toUpperCase();
 if(!/^([0-9]{8,12}|[A-F0-9]{24})$/.test(code)){setStatus('تأكد من إدخال كود BLOFY STREAM الصحيح',true);return}
 btn.disabled=true;setStatus('جار التحقق من التفعيل…');
 api('POST','/api/redeem',{code:code,deviceKey:deviceKey()},function(st,r){
  btn.disabled=false;
  if(st===200&&r.ok&&savedLoginEnabled){reloadSavedLogin();return}
  if(st===200&&r.ok&&useProfile(r.profileKey,r.legacyProfileKey)){S.userVerified=true;rememberOfflineGrant(r.profileKey,r.expiresAt);navigate('home',{},true);warmDesktopHlsAfterAuth()}
   else if(st===200&&r.ok){setStatus('تم التفعيل ولكن تعذر تهيئة البيانات المحلية للحساب. حاول تحديث الصفحة.',true)}
  else setStatus(st===409?'الكود مرتبط بجهاز مختلف':st===429?'محاولات كثيرة. جرّب لاحقًا.':'تعذّر تفعيل الاشتراك. تحقق من الكود والاتصال.',true)
 })
}
// Remember the exact scroll/focus position so returning from a title never jumps to the top.
function viewKey(route){
 route=route||S.route;
 if(route==='movie'||route==='series'||route==='live')return route+':'+(S.cat[route]||'all');
 if(route==='detail')return 'detail:'+(S.item?S.item.kind+':'+S.item.id:'');
 if(route==='episodes')return 'episodes:'+(S.item&&S.item.id||'');
 return route
}
function focusIdentity(node){
 if(!node||node===document.body)return null;
 var keys=['data-download','data-cat','data-channel','data-details','data-watch','data-more','data-season','data-go','data-episodes','data-sort','data-favorite','data-back'];
 for(var i=0;i<keys.length;i++)if(node.hasAttribute&&node.hasAttribute(keys[i]))return [keys[i],node.getAttribute(keys[i])];
 if(node.id)return ['id',node.id];
 return null
}
function findFocus(identity){
 if(!identity)return null;
 if(identity[0]==='id')return document.getElementById(identity[1]);
 var nodes=document.querySelectorAll('['+identity[0]+']');
 for(var i=0;i<nodes.length;i++)if(nodes[i].getAttribute(identity[0])===identity[1])return nodes[i];
 return null
}
function rememberView(){
 if(S.route==='player'||S.route==='boot'||S.route==='login')return;
 var root=document.getElementById('workspace');
 if(!root)return;
 var key=viewKey(),view={scroll:root.scrollTop,focus:focusIdentity(document.activeElement),parts:{}};
 var scrollers=root.querySelectorAll('.pane-scroll,.poster-panel,.h-scroll,.episode-list');
 for(var i=0;i<scrollers.length;i++)view.parts[i]=[scrollers[i].scrollTop,scrollers[i].scrollLeft];
 S.views[key]=view
}
function restoreView(route,preferred){
 var key=viewKey(route);
 setTimeout(function(){
  if(S.route!==route||viewKey()!==key)return;
  var entry=S.views[key],root=document.getElementById('workspace');
  if(!root)return;
  // Focus only for remote/keyboard use; mouse users keep natural pointer focus.
  var target=findFocus(preferred||(entry&&entry.focus));
  if(!target&&S.keyboardMode){
   target=root.querySelector('.cat-item.selected,.detail-actions .btn,.hero-actions .btn,.poster,.channel-item,.story,.episode-row,.btn:not([disabled])')||
    document.querySelector('.rail-link.active');
  }
  if(target&&S.keyboardMode){try{target.focus({preventScroll:true})}catch(e){target.focus()}}
  if(entry){
   var scrollers=root.querySelectorAll('.pane-scroll,.poster-panel,.h-scroll,.episode-list');
   for(var i=0;i<scrollers.length;i++)if(entry.parts[i]){scrollers[i].scrollTop=entry.parts[i][0];scrollers[i].scrollLeft=entry.parts[i][1]}
   root.scrollTop=entry.scroll||0
  }else if(root)root.scrollTop=0
 },0)
}
function nativeNavIcon(kind){
 var icons={"home":"<path d=\"M3,10 L12,3 L21,10 M5,9 L5,21 L10,21 L10,14 L14,14 L14,21 L19,21 L19,9\"/>","live":"<path d=\"M4,5 L20,5 Q22,5 22,7 L22,17 Q22,19 20,19 L4,19 Q2,19 2,17 L2,7 Q2,5 4,5 M8,22 L16,22 M10,9 L15,12 L10,15 Z\"/>","movie":"<path d=\"M3,7 L21,7 L21,21 L3,21 Z M3,7 L3,3 L21,3 L21,7 M7,3 L5,7 M13,3 L11,7 M19,3 L17,7\"/>","series":"<path d=\"M3,9 L21,9 L21,21 L3,21 Z M5,5 L19,5 M7,1 L17,1\"/>","collections":"<path d=\"M3,3 L10,3 L10,10 L3,10 Z M14,3 L21,3 L21,10 L14,10 Z M3,14 L10,14 L10,21 L3,21 Z M14,14 L21,14 L21,21 L14,21 Z\"/>","downloads":"<path d=\"M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5\"/>","search":"<path d=\"M10,3 A7,7 0,1 0,10,17 A7,7 0,1 0,10,3 M15,15 L22,22\"/>","ai":"<path d=\"M11.5,2L13.8,8.2L20,10.5L13.8,12.8L11.5,19L9.2,12.8L3,10.5L9.2,8.2Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M19,16L19.9,18.1L22,19L19.9,19.9L19,22L18.1,19.9L16,19L18.1,18.1Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M4.5,2L5.1,3.4L6.5,4L5.1,4.6L4.5,6L3.9,4.6L2.5,4L3.9,3.4Z\" fill=\"currentColor\" stroke=\"none\"/>","favorites":"<path d=\"M12,21 L3,12 C-2,5 6,-1 12,6 C18,-1 26,5 21,12 Z\"/>","settings":"<path d=\"M3,6 L21,6 M3,18 L21,18 M8,3 L8,9 M16,15 L16,21\"/>","refresh":"<path d=\"M20 7v6h-6M4 17v-6h6M5 9a8 8 0 0 1 13-4l2 2M4 17l2 2a8 8 0 0 0 13-4\"/>"};
 return '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+(icons[kind]||icons.home)+'</svg>'
}
function compactNativeHome(){
 return S.route==='home'&&document.documentElement.getAttribute('data-blofy-device')==='touch'
}
function compactNativeNavigation(){
 return document.documentElement.getAttribute('data-blofy-device')==='touch'&&['home','downloads','collections'].indexOf(S.route)>=0
}
function nativeHomeHeader(){
 return '<header class="native-home-header"><div class="native-home-brand"><img src="/stream-icon.svg" alt=""><strong>BLOFY STREAM</strong></div>'+
 '<button type="button" class="native-home-icon" id="refresh-content" aria-label="تحديث المحتوى">'+nativeNavIcon('refresh')+'</button>'+
 [['search','البحث'],['ai','الذكاء الاصطناعي'],['settings','الإعدادات']].map(function(v){return '<button class="native-home-icon" type="button" data-go="'+v[0]+'" aria-label="'+v[1]+'">'+nativeNavIcon(v[0])+'</button>'}).join('')+'</header>'+

 '<div class="native-home-refresh" id="refresh-progress" role="status" aria-live="polite"></div>'
}
function navHtml(){
 if(compactNativeNavigation())return '<nav class="rail native-home-bottom" aria-label="التنقل">'+[['home','الرئيسية'],['live','البث المباشر'],['movie','الأفلام'],['series','المسلسلات'],['downloads','التنزيلات'],['collections','التصنيفات']].map(function(v){return '<button class="rail-link '+(S.route===v[0]?'active':'')+'" data-go="'+v[0]+'">'+nativeNavIcon(v[0])+'<span>'+v[1]+'</span></button>'}).join('')+'</nav>';
 return '<aside class="rail native-tv-rail"><div class="brand"><img src="/stream-icon.svg" alt="BLOFY STREAM"></div>'+
 NAV.filter(function(v){return v[0]!=='favorites'}).map(function(v){return '<button class="rail-link '+(S.route===v[0]?'active':'')+'" data-go="'+v[0]+'"><span class="symbol">'+nativeNavIcon(v[0])+'</span><span>'+v[2]+'</span></button>'}).join('')+
 '</aside>'
}
function shell(pageTitle,markup){
 var catalogPage=S.route==='live'||S.route==='movie'||S.route==='series';
 S.heading=pageTitle;
 var nativeHome=compactNativeHome(),nativeNav=compactNativeNavigation(),touchDetail=!catalogPage&&!nativeNav&&document.documentElement.getAttribute('data-blofy-device')==='touch';
 // Each catalog is its own wide TV screen. The global app sidebar belongs
 // to Home, not to the Live/Movies/Series list, as in the native TV workflow.
 app.innerHTML='<div class="app screen-appear'+(catalogPage?' catalog-app':'')+(nativeHome?' native-compact-home':'')+(nativeNav?' native-compact-navigation':'')+(touchDetail?' native-touch-detail':'')+'">'+
 (catalogPage||touchDetail?'':navHtml())+'<main class="workspace" id="workspace">'+
 (nativeHome?nativeHomeHeader():'<div class="toolbar"><h1>'+esc(pageTitle)+'</h1><div class="row">'+
 (S.route==='home'?'':'<button class="btn secondary back-nav" data-back="1">↶ رجوع</button>')+
 (catalogPage?'<button class="btn secondary catalog-home" data-go="home">⌂ الرئيسية</button>':'')+
 '<button class="btn secondary" data-go="search">⌕ بحث</button></div></div>')+
 '<div id="screen">'+markup+'</div></main></div>';
 if(nativeHome){var refresh=document.getElementById('refresh-content');refresh.disabled=!!S.refreshing;refresh.onclick=function(){refreshCatalog(true)}}
 showWebShellUpdateHint();
 // Pages restore their own controls after data arrives rather than focusing the sidebar.
}
function loading(label){return '<div class="empty-state"><div class="skeleton" style="width:48px;height:48px;border-radius:50%;margin:0 auto 12px"></div>جار تحميل '+esc(label)+' من المكتبة…</div>'}
function pushBrowserStep(route,opts){
 if(handlingBrowserPop)return;
 try{
  var next=browserDepth+1;
  window.history.pushState({blofyStreamWeb:true,depth:next,route:route,opts:opts||{}},'',window.location.href);
  browserDepth=next
 }catch(e){}
}
function navigate(route,opts,replace){
 if(S.route==='downloads'||S.route==='offline')closeOfflineVideo();
 if(S.route==='search'&&route!=='search')cancelSearch();
 if(route!==S.route)rememberView();
 if(!S.userVerified&&route!=='login'){login('يرجى تفعيل الكود أولًا');return}
 // Release any live preview session before leaving its page (not just full-screen player).
 if((S.play||S.playerView)&&(S.route==='player'||S.route==='live')&&route!==S.route)cleanupPlayer();
 if(S.route==='player'&&route!=='player'&&S.playerView&&S.playerView.video){
  try{S.playerView.video.pause();S.playerView.video.removeAttribute('src');S.playerView.video.load()}catch(e){}
  S.playerView=null;
 }
 if(route==='login'){login();return}
 if(!replace&&S.route!==route){
  var options={kind:S.kind};
  if(S.route==='detail'&&S.item)options={kind:S.item.kind,id:S.item.id};
  else if(S.route==='episodes'&&S.item)options={id:S.item.id};
  S.history.push({route:S.route,opts:options});
  if(S.history.length>30)S.history.shift();
  pushBrowserStep(route,opts||{})
 }
 S.route=route;
 if(route==='home')home();
 else if(route==='live'||route==='movie'||route==='series')catalog(route);
 else if(route==='detail')details(opts||{});
 else if(route==='episodes')episodesScreen(opts||{});
 else if(route==='favorites')favoritesScreen();
 else if(route==='downloads')downloadsScreen();
 else if(route==='search')searchScreen();
 else if(route==='ai')aiScreen();
 else if(route==='settings')settingsScreen();
 else if(route==='collections')collectionsScreen();
 else home()
}
function back(){
 if(!handlingBrowserPop&&browserDepth>0){
  try{window.history.back();return}catch(e){}
 }
 if(S.route==='player'){closePlayer();return}
 var prev=S.history.pop();
 if(prev&&prev.route&&prev.route!=='boot'&&prev.route!=='login'){navigate(prev.route,prev.opts||{},true);return}
 navigate('home',{},true)
}
window.addEventListener('popstate',function(event){
 if(!S.userVerified)return;
 var next=event.state&&event.state.blofyStreamWeb?Number(event.state.depth)||0:0;
 var forward=next>browserDepth,entry=event.state||{};
 browserDepth=next;handlingBrowserPop=true;
 try{
  if(forward&&entry.route==='player'&&entry.opts){
   var p=entry.opts;openPlayer(p.kind,p.id,p.extension,p.name,p.from)
  }else if(forward&&entry.route&&entry.route!=='boot'&&entry.route!=='login'){
   navigate(entry.route,entry.opts||{})
  }else back()
 }finally{handlingBrowserPop=false}
});
function categories(kind,done){
 if(S.cats[kind]){done(S.cats[kind]);return}
 if(S.catsInflight[kind]){S.catsInflight[kind].push(done);return}
 S.catsInflight[kind]=[done];
 api('GET','/api/catalog?action=get_'+(kind==='movie'?'vod':kind)+'_categories',null,function(st,result){
  var waiting=S.catsInflight[kind]||[];delete S.catsInflight[kind];
  if(st===401){login('انتهت جلسة الاشتراك');return}
  if(st===200&&Array.isArray(result))S.cats[kind]=result;
  for(var i=0;i<waiting.length;i++)waiting[i](S.cats[kind]||[])
 })
}
function pageRequest(kind,cat,offset,limit,cb,query,fresh){
 var endpoint='/api/page?kind='+enc(kind)+'&offset='+enc(offset||0)+'&limit='+enc(limit||30);
 if(cat&&cat!=='all')endpoint+='&category_id='+enc(cat);
 if(query)endpoint+='&query='+enc(query);
 if(fresh)endpoint+='&fresh=1';
 return api('GET',endpoint,null,function(st,result){
  if(st===401){login('انتهت جلسة الاشتراك');return}
  cb(st,result&&Array.isArray(result.items)?result:null)
 })
}
function keyOf(kind,cat){return kind+':'+(cat||'all')}
var listingAccessSeq=0;
function touchListing(listing){listing.cacheAccess=++listingAccessSeq;return listing}
function pruneInactiveListings(){
 // Preserve home shelves, search results, and each selected category.
 // Only inactive categories participate in this bounded LRU cache.
 var keys=Object.keys(S.loaded),inactive=[],items=0;
 for(var i=0;i<keys.length;i++){
  var key=keys[i],split=key.indexOf(':'),kind=key.slice(0,split),cat=key.slice(split+1),row=S.loaded[key];
  if(cat==='all'||cat==='search'||cat===(S.cat[kind]||'all')||row.loadingMore||S.listingInflight[key])continue;
  var count=(row.items||[]).length;items+=count;
  inactive.push({key:key,count:count,access:row.cacheAccess||0})
 }
 inactive.sort(function(a,b){return a.access-b.access});
 while(inactive.length>8||items>576){
  var victim=inactive.shift();items-=victim.count;delete S.loaded[victim.key]
 }
}
function getListing(kind,cat,cb,force){
 var key=keyOf(kind,cat);
 if(!force&&S.loaded[key]){var hit=touchListing(S.loaded[key]);pruneInactiveListings();cb(200,hit);return}
 if(!force&&S.listingInflight[key]){S.listingInflight[key].push(cb);return}
 if(!force)S.listingInflight[key]=[cb];
 pageRequest(kind,cat,0,36,function(st,r){
  var waiting=force?[cb]:(S.listingInflight[key]||[cb]);
  if(!force)delete S.listingInflight[key];
  if(st===200&&r){S.loaded[key]=touchListing(r);pruneInactiveListings()}
  for(var i=0;i<waiting.length;i++)waiting[i](st,st===200?r:null)
 },null,!!force)
}
function safeImg(pic,cls){
 var alternatives=[];
 if(pic&&typeof pic==='object'){
  alternatives=artCandidates(pic);pic=alternatives.shift()||''
 }
 return pic?'<img class="'+(cls||'')+'" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" src="'+esc(pic)+'"'+
  (alternatives.length?' data-art-fallback="'+esc(JSON.stringify(alternatives))+'"':'')+'>':''
}
function arabicCategory(raw){
 var label=String(raw||'').trim();
 if(!label)return '';
 var phrases=[
 [/\bPERSIAN\s+SUB\s*\/\s*DUB\b/gi,'فارسي مترجم ومدبلج'],
 [/\bMULTI[-\s]*SUBS?\b/gi,'ترجمات متعددة'],
 [/\bDOLBY\s+AUDIO\b/gi,'صوت دولبي'],
 [/\bTOP\s+MOVIES\b/gi,'أفضل الأفلام'],
 [/\bTOP\s+KIDS\b/gi,'أفضل أفلام الأطفال'],
 [/\bTOP\s+SERIES\b/gi,'أفضل المسلسلات'],
 [/\bASIA\s+MOVIES\b/gi,'أفلام آسيوية'],
 [/\bMOVIES\b/gi,'أفلام'],[/\bSERIES\b/gi,'مسلسلات'],[/\bKIDS\b/gi,'أطفال'],
 [/\bBLU[-\s]*RAY\b/gi,'بلو راي'],[/\bACTION\b/gi,'أكشن'],[/\bCOMEDY\b/gi,'كوميديا'],
 [/\bDRAMA\b/gi,'دراما'],[/\bHORROR\b/gi,'رعب'],[/\bROMANCE\b/gi,'رومانسي'],
 [/\bDOCUMENTARY\b/gi,'وثائقي'],[/\bANIMATION\b/gi,'رسوم متحركة'],
 [/\bTHRILLER\b/gi,'إثارة'],[/\bSPORTS\b/gi,'رياضة'],[/\bNEWS\b/gi,'أخبار'],
 [/\bARABIC\b/gi,'عربي'],[/\bENGLISH\b/gi,'إنجليزي'],[/\bTURKISH\b/gi,'تركي'],
 [/\bINDIAN\b/gi,'هندي'],[/\bKOREAN\b/gi,'كوري'],[/\bFRENCH\b/gi,'فرنسي'],
 [/\bSUBBED\b/gi,'مترجم'],[/\bDUBBED\b/gi,'مدبلج'],[/\bFAMILY\b/gi,'عائلي'],
 [/\bADVENTURE\b/gi,'مغامرات'],[/\bFANTASY\b/gi,'خيال'],[/\bSCI[-\s]*FI\b/gi,'خيال علمي']
 ];
 phrases.forEach(function(pair){label=label.replace(pair[0],pair[1])});
 return label
}
function posterCategory(item,kind){
 if(!item||kind==='live')return '';
 var raw=item.genre||item.genres||item.genre_name||(item.info&&(item.info.genre||item.info.genres))||'';
 if(Array.isArray(raw))raw=raw.map(function(x){return typeof x==='object'&&x?x.name||'':x}).join(', ');
 if(typeof raw!=='string')return '';
 var rules=[
 [/\b(?:science fiction|sci[- ]?fi)\b|خيال علمي/i,'خيال علمي'],[/\baction\b|أكشن|حركة/i,'أكشن'],[/\bcomedy\b|كوميديا|كوميدي/i,'كوميديا'],
 [/\bdrama\b|دراما/i,'دراما'],[/\bhorror\b|رعب/i,'رعب'],[/\bthriller\b|إثارة|اثارة/i,'إثارة'],[/\bmystery\b|غموض/i,'غموض'],
 [/\bromance\b|رومانسي/i,'رومانسي'],[/\badventure\b|مغامر/i,'مغامرات'],[/\bfantasy\b|فانتازيا|خيال(?! علمي)/i,'فانتازيا'],
 [/\bcrime\b|جريمة|جرائم/i,'جريمة'],[/\banimation\b|رسوم متحركة|أنيميشن/i,'رسوم متحركة'],[/\bdocumentary\b|وثائقي/i,'وثائقي'],
 [/\bfamily\b|عائلي/i,'عائلي'],[/\bhistory\b|تاريخي/i,'تاريخي'],[/\bwar\b|حربي/i,'حربي'],[/\bwestern\b|غرب أمريكي/i,'غرب أمريكي'],
 [/\bmusic(?:al)?\b|موسيقي/i,'موسيقي'],[/\bbiograph(?:y|ical)\b|سيرة ذاتية/i,'سيرة ذاتية'],[/\bsport\b|رياضي/i,'رياضي']
 ];
 var found=[];
 rules.forEach(function(rule){var match=rule[0].exec(raw);if(match)found.push({at:match.index,name:rule[1]})});
 return found.sort(function(x,y){return x.at-y.at}).slice(0,3).map(function(x){return x.name}).join(' • ')
}
function refreshPosterCategories(kind){
 var cards=document.querySelectorAll('[data-details] .poster-category');
 for(var i=0;i<cards.length;i++){
  var card=cards[i].closest('[data-details]'),key=card&&card.getAttribute('data-details')||'',prefix=kind+':';
  if(key.indexOf(prefix)!==0)continue;
  var item=findItem(kind,key.slice(prefix.length)),label=item&&posterCategory(item,kind);
  cards[i].textContent=label||''
 }
}
function posterCard(item,kind){
 var id=itemId(item,kind),name=title(item),key=kind+':'+id,mark=S.watch[key],percent=mark&&mark.duration>0?Math.round(100*mark.position/mark.duration):0;
 return '<button class="poster" data-details="'+esc(kind)+':'+esc(id)+'" title="'+esc(name)+'">'+
 '<span class="poster-art">'+safeImg(item)+'<span class="no-poster">'+esc(name)+'</span><span class="poster-badge">'+(kind==='series'?'مسلسل':kind==='movie'?'فيلم':'مباشر')+'</span></span>'+
 '<span class="poster-caption"><strong>'+esc(name)+'</strong><span class="poster-category">'+esc(posterCategory(item,kind))+'</span>'+(percent>3&&percent<95?'<span>متابعة • '+percent+'٪</span>':'')+'</span></button>'
}
function shelves(items,kind){return '<div class="h-scroll">'+items.slice(0,22).map(function(x){return posterCard(x,kind)}).join('')+'</div>'}
function home(){
 shell('الرئيسية','<div id="home-content">'+loading('الواجهة الرئيسية')+'</div>');
 var movies=S.loaded['movie:all'],series=S.loaded['series:all'];
 function draw(){
  if(S.route!=='home')return;
  var film=(movies&&movies.items)||[],show=(series&&series.items)||[],combined=film.concat(show),candidate=combined.length?combined[S.heroIndex%combined.length]:null;
  var hero=candidate?'<div class="home-hero">'+safeImg(candidate,'hero-art').replace('loading="lazy"','loading="eager" fetchpriority="high"')+'<div class="hero-shade"></div><div class="hero-copy">'+
  '<div class="hero-kicker">'+esc(candidate.series_id?'مسلسل جديد':'أحدث العناوين')+'</div><h2 class="hero-title">'+esc(title(candidate))+'</h2>'+
 
  '<div class="hero-actions"><button class="btn" data-details="'+(candidate.series_id?'series:':'movie:')+esc(itemId(candidate,candidate.series_id?'series':'movie'))+'">التفاصيل والمشاهدة</button>'+
  '</div>'+
  '<div class="hero-dots">'+combined.slice(0,5).map(function(x,n){return '<span class="'+(n===S.heroIndex?'current':'')+'"></span>'}).join('')+'</div></div></div>':
  '<div class="home-hero"><div class="hero-copy"><div class="hero-kicker">BLOFY STREAM</div><h2 class="hero-title">كل ما تحب مشاهدته، في مكان واحد</h2></div></div>';
  var shortcuts='<div class="shelf"><div class="shelf-title"><h2>وصول سريع</h2></div><div class="story-row">'+
   '<button class="story" id="home-shortcut-live" data-go="live"><strong>◉ البث المباشر</strong><small>القنوات المفضلة والتصنيفات</small></button>'+
   '<button class="story" id="home-shortcut-movie" data-go="movie"><strong>▣ الأفلام</strong><small>الملصقات والتفاصيل</small></button>'+
   '<button class="story" id="home-shortcut-series" data-go="series"><strong>▤ المسلسلات</strong><small>المواسم والحلقات</small></button>'+
   '<button class="story" id="home-shortcut-downloads" data-go="downloads"><strong>↓ التنزيلات</strong></button>'+
   '<button class="story" id="home-shortcut-search" data-go="search"><strong>⌕ البحث</strong><small>ابحث في المكتبة</small></button>'+
   '<button class="story" id="home-shortcut-ai" data-go="ai"><strong>✧ الذكاء الاصطناعي</strong></button></div></div>';
  var shelfMovies=film.length?'<section class="shelf"><div class="shelf-title"><h2>أحدث الأفلام</h2><button class="btn secondary" data-go="movie">عرض الكل</button></div>'+shelves(film,'movie')+'</section>':'';
  var shelfSeries=show.length?'<section class="shelf"><div class="shelf-title"><h2>أحدث المسلسلات</h2><button class="btn secondary" data-go="series">عرض الكل</button></div>'+shelves(show,'series')+'</section>':'';
  var recent=Object.keys(S.watch).map(function(key){
   var pos=S.watch[key]||{},split=key.indexOf(':'),kind=key.slice(0,split),id=key.slice(split+1);
   if(split<0||(kind!=='movie'&&kind!=='series')||!(pos.position>30)||pos.duration>0&&pos.position/pos.duration>.95)return null;
   var item=findItem(kind,id),name=pos.name||item&&title(item),poster=pos.art||art(item);
   return name?{kind:kind,id:id,name:name,poster:poster,ext:pos.ext||item&&item.container_extension||'mp4',pos:pos}:null
  }).filter(Boolean).sort(function(a,b){return (b.pos.updated||0)-(a.pos.updated||0)}).slice(0,12);
  var watch=recent.length?'<section class="shelf"><div class="shelf-title"><h2>أكمل المشاهدة</h2></div><div class="h-scroll">'+recent.map(function(r){
   var pct=r.pos.duration>0?Math.round(100*r.pos.position/r.pos.duration):0;
   return '<button class="poster" data-watch="'+esc(r.kind)+':'+esc(r.id)+'" data-ext="'+esc(r.ext)+'" data-name="'+esc(r.name)+'" data-from="'+r.pos.position+'" title="'+esc(r.name)+'">'+
   '<span class="poster-art">'+safeImg(r.poster)+'<span class="no-poster">'+esc(r.name)+'</span></span>'+
   '<span class="poster-caption"><strong>'+esc(r.name)+'</strong><span>متابعة من '+formatTime(r.pos.position)+(pct?' • '+pct+'٪':'')+'</span></span></button>'
  }).join('')+'</div></section>':'';
  var target=document.getElementById('home-content');
  if(target){
   // Returning a slow series listing must not steal TV remote focus, reset
   // scroll, or blank movie cards already visible.
   var hadScreen=!!target.querySelector('.story-row');
   var focus=hadScreen&&S.keyboardMode&&target.contains(document.activeElement)?
    (document.activeElement.id?['id',document.activeElement.id]:focusIdentity(document.activeElement)):null;
   if(hadScreen)rememberView();
   target.innerHTML=hero+watch+shelfMovies+shelfSeries+shortcuts;
   restoreView('home',focus);
   enrichPosters('movie',film.slice(0,12));enrichPosters('series',show.slice(0,12))
  }
 }
 // Render navigation and recent watched items instantly. Movie and series
 // shelves arrive independently; a slow source cannot hold home hostage.
 draw();
 if(!movies)getListing('movie','all',function(st,d){movies=d||{items:[]};draw()});
 if(!series)getListing('series','all',function(st,d){series=d||{items:[]};draw()});
 ['movie','series'].forEach(function(kind){if(!S.cats[kind])categories(kind,function(){if(S.route==='home')refreshPosterCategories(kind)})})
}
function catalog(kind){
 S.kind=kind;var cat=S.cat[kind]||'all';
 shell(kindName(kind),'<div id="catalog-root">'+loading(kindName(kind))+'</div>');
 // Do not block the content grid on slower category metadata.
 getListing(kind,cat,function(st,listing){
  if(S.route!==kind||(S.cat[kind]||'all')!==cat)return;
  var root=document.getElementById('catalog-root');if(!root)return;
  if(st!==200||!listing){
   root.innerHTML='<div class="info error">تعذر تحميل المحتوى. <button class="btn secondary" data-reload="'+kind+'">إعادة المحاولة</button></div>';
   return
  }
  buildCatalog(kind,listing)
 });
 categories(kind,function(){
  if(S.route!==kind||(S.cat[kind]||'all')!==cat)return;
  refreshPosterCategories(kind);
  var panel=document.querySelector('#catalog-root .cat-rail');if(!panel)return;
  var oldScroll=panel.querySelector('.pane-scroll'),y=oldScroll?oldScroll.scrollTop:0;
  var focused=S.keyboardMode&&panel.contains(document.activeElement);
  var prevFocus=focused?focusIdentity(document.activeElement):null;
  panel.outerHTML=categoryRail(kind);
  var next=document.querySelector('#catalog-root .cat-rail .pane-scroll');
  if(next)next.scrollTop=y;
  if(focused){var target=findFocus(prevFocus)||document.querySelector('.cat-item.selected');if(target)target.focus()}
 })
}
function categoryRail(kind){
 var data=S.cats[kind]||[],cat=S.cat[kind]||'all';
 return '<aside class="cat-rail"><div class="pane-head"><strong>الفئات</strong><small>'+data.length+' تصنيف</small></div>'+
 '<div class="pane-scroll"><button class="cat-item '+(cat==='all'?'selected':'')+'" data-cat="'+kind+':all">الكل</button>'+
 data.map(function(x){var id=String(x.category_id);return '<button class="cat-item '+(id===cat?'selected':'')+'" data-cat="'+kind+':'+esc(id)+'">'+esc(arabicCategory(x.category_name)||'تصنيف')+'</button>'}).join('')+
 '</div></aside>'
}
function currentListing(){return S.loaded[keyOf(S.kind,S.cat[S.kind]||'all')]||{items:[],hasMore:false,nextOffset:0}}
function buildCatalog(kind,listing){
 var host=document.getElementById('catalog-root');if(!host)return;var source=listing.items||[];
 if(host.querySelector('.catalog'))rememberView();
 if(kind==='live'){
  host.innerHTML='<div class="catalog">'+categoryRail(kind)+
  '<section class="channels"><div class="pane-head"><strong>القنوات</strong><small>'+source.length+' قناة محمّلة</small></div>'+
  '<div class="pane-scroll" id="channel-list">'+source.map(function(x){var id=itemId(x,kind),pic=art(x);return '<button class="channel-item '+(S.selected===id?'selected':'')+'" data-channel="'+esc(id)+'">'+
  (pic?safeImg(x,'channel-image'):'<span class="channel-image"></span>')+
  '<span class="channel-name"><strong>'+esc(title(x))+'</strong><small>شاهد الآن</small></span><span class="accent">▶</span></button>'}).join('')+
  '</div><div class="pane-bottom"><button class="btn secondary" data-more="live" '+(!listing.hasMore?'disabled':'')+'>عرض المزيد</button></div></section>'+
  '<section class="preview"><div class="preview-video-wrap"><div class="preview-empty" id="preview-empty"><span>◉</span>جار تشغيل معاينة القناة…</div><video id="live-video" playsinline webkit-playsinline autoplay muted preload="auto" aria-label="معاينة البث المباشر"></video></div>'+
  '<div class="preview-controls"><div class="chip primary">LIVE</div><h3 id="live-title">المعاينة المباشرة</h3><p id="live-desc">المعاينة تبدأ تلقائيًا عند تحديد القناة.</p>'+
  '<p class="live-preview-quality" id="live-preview-quality" aria-live="polite">الدقة المعروضة: جار قراءة معلومات الفيديو…</p>'+
  '<div class="row preview-action-row"><button class="btn" data-preview-play>▶ المعاينة</button><button class="btn secondary" id="preview-audio-toggle" type="button" aria-label="صوت المعاينة">🔊 الصوت</button><button class="btn secondary" data-preview-full>⛶ ملء الشاشة</button><button class="btn secondary" id="live-favorite" data-favorite="">♡ المفضلة</button></div><div class="preview-status" id="live-status"></div>'+
   '<section class="epg-panel" aria-label="دليل برامج القناة"><strong class="epg-heading">دليل البرامج</strong><div id="live-epg" class="epg-content" role="status" aria-live="polite">اختر قناة لعرض البرامج المتوفرة</div></section></div></section>'+
  '</div>';
  var previewAudio=document.getElementById('preview-audio-toggle');
  if(previewAudio)previewAudio.onclick=function(){var v=document.getElementById('live-video');if(!v)return;S.previewSound=v.muted;v.muted=!S.previewSound;v.defaultMuted=v.muted;this.textContent=v.muted?'🔇 الصوت':'🔊 الصوت';if(S.previewSound&&v.paused)try{var p=v.play();if(p&&p.catch)p.catch(function(){})}catch(e){}};
  var selected=findItem('live',S.selected)||source[0];
  if(selected)selectChannel(itemId(selected,'live'),true);
  // Arrow navigation on a TV changes the highlighted channel as it settles.
  // A short delay avoids opening one transcoder for every rapid D-pad press.
  var channelList=document.getElementById('channel-list');
  if(channelList){
   channelList.addEventListener('focusin',function(e){
    var row=e.target&&e.target.closest&&e.target.closest('[data-channel]');
    if(!row||S.route!=='live')return;
    var id=row.getAttribute('data-channel');
    if(S.previewFocusTimer)clearTimeout(S.previewFocusTimer);
    if(id===S.selected)return;
    S.previewFocusTimer=setTimeout(function(){
     S.previewFocusTimer=null;
     if(S.route==='live'&&channelList.isConnected&&channelList.contains(document.activeElement))selectChannel(id,true)
    },380)
   });
   channelList.addEventListener('focusout',function(){
    if(S.previewFocusTimer){clearTimeout(S.previewFocusTimer);S.previewFocusTimer=null}
   })
  }
 }else{
  var sorted=source.slice();if(S.sort==='alpha')sorted.sort(function(a,b){return title(a).localeCompare(title(b))});
  if(S.sort==='new')sorted.sort(function(a,b){return Number(b.added||0)-Number(a.added||0)});
  host.innerHTML='<div class="catalog posters">'+categoryRail(kind)+
  '<section class="poster-panel"><div class="poster-panel-header"><div><h2>'+kindName(kind)+'</h2><small>'+sorted.length+' عنوان محمّل • تصفح الملصقات</small></div>'+
  '<div class="sort-bar"><span class="small muted">الترتيب</span><button class="btn secondary" data-sort="next">'+(S.sort==='alpha'?'أبجدي':S.sort==='new'?'الأحدث':'ترتيب المصدر')+'</button></div></div>'+
  '<div class="poster-grid">'+sorted.map(function(x){return posterCard(x,kind)}).join('')+'</div>'+
  '<div style="margin-top:20px;text-align:center"><button class="btn secondary" data-more="'+kind+'" '+(!listing.hasMore?'disabled':'')+'>عرض المزيد</button></div></section></div>';
  enrichPosters(kind,sorted.slice(0,10))
 }
 bindMoreOnScroll(kind);
 restoreView(kind)
}

/* Update a category without destroying the shell, TV focus, or the live
 * preview <video>. Replacing #catalog-root previously flashed the page,
 * restarted HLS and lost the D-pad position on every category press.
 */
function renderCategoryItems(kind,listing){
 var source=listing&&Array.isArray(listing.items)?listing.items:[];
 if(kind==='live'){
  var list=document.getElementById('channel-list'),pane=document.querySelector('.channels');
  if(!list||!pane)return false;
  list.innerHTML=source.length?source.map(function(x){
   var id=itemId(x,'live'),pic=art(x);
   return '<button class="channel-item" data-channel="'+esc(id)+'">'+
    (pic?safeImg(x,'channel-image'):'<span class="channel-image"></span>')+
    '<span class="channel-name"><strong>'+esc(title(x))+'</strong><small>شاهد الآن</small></span><span class="accent">▶</span></button>'
  }).join(''):'<p class="catalog-inline-empty">لا توجد قنوات في هذا التصنيف.</p>';
  list.scrollTop=0;
  var counter=pane.querySelector('.pane-head small');
  if(counter)counter.textContent=source.length+' قناة محمّلة';
  var more=pane.querySelector('[data-more="live"]');
  if(more){more.disabled=!listing.hasMore;more.textContent=listing.hasMore?'عرض المزيد':'تم عرض المحتوى'}
  // Keep the same preview video element while selecting a channel in the
  // new list. beginPreview serializes STOP before the next upstream starts.
  var next=source.find(function(x){return itemId(x,'live')===String(S.selected)})||source[0];
  if(next){
   S.selected=itemId(next,'live');
   selectChannel(S.selected,true)
  }else{
   S.selected=null;S.livePreview=null;
   if(S.play&&S.play.preview)stopPlayback(true);
   var empty=document.getElementById('preview-empty');
   if(empty){empty.style.display='';empty.textContent='لا توجد قناة للمعاينة في هذا التصنيف'}
   var heading=document.getElementById('live-title');
   if(heading)heading.textContent='المعاينة المباشرة';
   var details=document.getElementById('live-desc');
   if(details)details.textContent='اختر تصنيفًا يحتوي على قنوات';
   var status=document.getElementById('live-status');
   if(status)status.textContent='';
  }
  return true
 }
 var grid=document.querySelector('.poster-panel .poster-grid');
 if(!grid)return false;
 var sorted=source.slice();
 if(S.sort==='alpha')sorted.sort(function(a,b){return title(a).localeCompare(title(b))});
 if(S.sort==='new')sorted.sort(function(a,b){return Number(b.added||0)-Number(a.added||0)});
 grid.innerHTML=sorted.length?sorted.map(function(x){return posterCard(x,kind)}).join(''):
  '<p class="catalog-inline-empty">لا يوجد محتوى في هذا التصنيف.</p>';
 var count=document.querySelector('.poster-panel-header small');
 if(count)count.textContent=sorted.length+' عنوان محمّل • تصفح الملصقات';
 var moreButton=document.querySelector('.poster-panel [data-more="'+kind+'"]');
 if(moreButton){moreButton.disabled=!listing.hasMore;moreButton.textContent=listing.hasMore?'عرض المزيد':'تم عرض المحتوى'}
 var sortButton=document.querySelector('.poster-panel [data-sort]');
 if(sortButton)sortButton.textContent=S.sort==='alpha'?'أبجدي':S.sort==='new'?'الأحدث':'ترتيب المصدر';
 var scroller=document.querySelector('.poster-panel');
 if(scroller)scroller.scrollTop=0;
 enrichPosters(kind,sorted.slice(0,10));
 return true
}
function changeCatalogCategory(kind,category){
 if(S.route!==kind||!document.querySelector('#catalog-root .catalog'))return;
 if((S.cat[kind]||'all')===category&&!S.categoryLoadFailed)return;
 S.categoryLoadFailed=false;
 rememberView();
 S.cat[kind]=category;
 var epoch=(S.categoryEpoch||0)+1;S.categoryEpoch=epoch;
 var panel=document.querySelector('#catalog-root .cat-rail');
 if(panel){
  var buttons=panel.querySelectorAll('[data-cat]');
  for(var i=0;i<buttons.length;i++){
   var active=buttons[i].getAttribute('data-cat')===kind+':'+category;
   buttons[i].classList.toggle('selected',active);
   buttons[i].setAttribute('aria-pressed',active?'true':'false')
  }
 }
 // This local status does not touch the video or global layout.
 var root=document.getElementById('catalog-root'),badge=document.getElementById('catalog-update-status');
 if(!badge&&root){badge=document.createElement('div');badge.id='catalog-update-status';
  badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');
  root.insertBefore(badge,root.firstChild)}
 if(badge){badge.hidden=false;badge.textContent='جار عرض التصنيف…'}
 var catalog=root&&root.querySelector('.catalog');
 if(catalog)catalog.setAttribute('aria-busy','true');
 getListing(kind,category,function(st,listing){
  if(S.route!==kind||(S.cat[kind]||'all')!==category||S.categoryEpoch!==epoch||
   !root||!root.isConnected)return;
  if(catalog)catalog.removeAttribute('aria-busy');
  if(st!==200||!listing){
   S.categoryLoadFailed=true;
   if(badge){badge.textContent='تعذر تحميل التصنيف. اختره مرة أخرى للمحاولة.';badge.hidden=false}
   // Remain on previous media rows, rather than blanking the screen.
   return
  }
  renderCategoryItems(kind,listing);
  if(badge){badge.hidden=true;badge.textContent=''}
 })
}

var posterRecovery=null;
function enrichPosters(kind,source,force){
 if(kind!=='movie'&&kind!=='series')return;
 // Share a small recovery queue across category renders and page loads.
 // Account changes invalidate every queued item and all remembered covers.
 if(!posterRecovery||posterRecovery.epoch!==S.accountEpoch)
  posterRecovery={epoch:S.accountEpoch,queue:[],pending:{},cache:{},order:[],active:0};
 var state=posterRecovery;
 function current(){return S.accountEpoch===state.epoch&&posterRecovery===state}
 function apply(item,key,cover,genre,force){
  if(!current())return;
  if(cover&&(force||!art(item)))item.movie_image=cover;
  if(genre&&!posterCategory(item,kind))item.genre=genre;
  var buttons=document.querySelectorAll('[data-details]');
  for(var j=0;j<buttons.length;j++){
   if(buttons[j].getAttribute('data-details')!==key)continue;
   var label=buttons[j].querySelector('.poster-category');if(label&&genre)label.textContent=posterCategory(item,kind);
   var holder=buttons[j].querySelector('.poster-art');
   if(cover&&holder&&!holder.querySelector('img')&&holder.getAttribute('data-art-failed')!==cover){
    var image=document.createElement('img');
    image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';
    image.alt='';image.src=cover;holder.insertBefore(image,holder.firstChild);
   }
  }
 }
 function remember(key,cover,genre,ttl){
  var old=state.order.indexOf(key);if(old>=0)state.order.splice(old,1);
  state.cache[key]={cover:cover,genre:genre,until:Date.now()+ttl};state.order.push(key);
  while(state.order.length>128)delete state.cache[state.order.shift()];
 }
 function pump(){
  if(!current())return;
  while(state.queue.length&&state.active<2&&S.route!=='player'&&S.route!=='live'){
   var job=state.queue.shift();state.active++;
   (function(task){
    var action=task.kind==='movie'?'get_vod_info&vod_id=':'get_series_info&series_id=';
    api('GET','/api/catalog?action='+action+enc(task.id),null,function(st,res){
     if(!current())return;
     state.active--;delete state.pending[task.key];
     var cover='',genre='';
     if(st===200&&res){
      var data=res.info||res.movie_data||res;
      var candidates=[data,res.movie_data||{},res.info||{},res];
      for(var k=0;k<candidates.length;k++){
       var d=candidates[k];if(!cover)cover=urlPic(d.movie_image||d.cover_big||d.cover||d.poster||d.poster_path||d.stream_icon||d.backdrop_path||'');if(!genre)genre=posterCategory(d,task.kind)
      }
     }
     // Failed metadata reads are retryable instead of permanently hiding
     // artwork. Successful covers are reused only inside this account.
     remember(task.key,cover,genre,cover||genre?300000:30000);
     if(cover||genre)for(var i=0;i<task.items.length;i++)apply(task.items[i],task.key,cover,genre,task.force);
     pump();
    });
   })(job)
  }
 }
 var candidates=source.filter(function(x){return force||!art(x)||!posterCategory(x,kind)}).slice(0,16);
 for(var i=0;i<candidates.length;i++){
  var item=candidates[i],id=itemId(item,kind);
  if(!id||id.length>128)continue;
  var key=kind+':'+id,hit=state.cache[key];
  if(hit&&hit.until>Date.now()){apply(item,key,hit.cover,hit.genre,force);continue}
  if(state.pending[key]){
   if(state.pending[key].items.length<16)state.pending[key].items.push(item);
   if(force)state.pending[key].force=true;
   continue
  }
  if(state.queue.length>=32)break;
  var job={kind:kind,id:id,key:key,items:[item],force:!!force};
  state.pending[key]=job;state.queue.push(job)
 }
 pump()
}
function selectChannel(id,activate){
 var item=findItem('live',id);if(!item)return;S.selected=id;
 var rows=document.querySelectorAll('[data-channel]');for(var i=0;i<rows.length;i++)rows[i].className='channel-item'+(rows[i].getAttribute('data-channel')===id?' selected':'');
 var name=document.getElementById('live-title'),desc=document.getElementById('live-desc');
 if(name)name.textContent=title(item);if(desc)desc.textContent='معاينة '+title(item)+' • التشغيل تلقائي عند التحديد';
 var favorite=document.getElementById('live-favorite');if(favorite){
  favorite.setAttribute('data-favorite','live:'+id);
  favorite.textContent=S.library['live:'+id]?'♥ إزالة من المفضلة':'♡ المفضلة'
 }
 loadShortEpg(id);
 if(activate)beginPreview(item)
}
function decodeEpgField(raw){
 var source=String(raw==null?'':raw).trim().slice(0,500);
 if(source.length<8||source.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(source))return source;
 try{
  var binary=atob(source),decoded='';
  if(typeof TextDecoder!=='undefined'){
   var bytes=new Uint8Array(binary.length);
   for(var i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  }else decoded=decodeURIComponent(escape(binary));
  if(decoded&&decoded.indexOf('\ufffd')<0&&!/[\x00-\x08\x0e-\x1f]/.test(decoded))return decoded.slice(0,500)
 }catch(e){}
 return source
}
function epgTime(raw,stamp){
 var t=String(raw||'');
 var match=/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/.exec(t);
 if(match)return (match[1].length===1?'0':'')+match[1]+':'+match[2];
 var n=Number(stamp||0);
 if(n>1000000000&&n<4102444800){
  try{return new Date(n*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'})}catch(e){}
 }
 return ''
}
function formatEpg(value){
 var list=Array.isArray(value)?value:value&&Array.isArray(value.epg_listings)?value.epg_listings:[];
 if(!list.length)return '<span class="epg-empty">دليل البرامج غير متوفر لهذه القناة من المصدر.</span>';
 var seen={},items=[];
 for(var i=0;i<list.length&&items.length<5;i++){
  var x=list[i]||{},name=decodeEpgField(x.title||x.name||'');
  if(!name||seen[name+':'+(x.start||'')])continue;
  seen[name+':'+(x.start||'')]=true;
  var from=epgTime(x.start,x.start_timestamp),to=epgTime(x.end||x.stop,x.stop_timestamp);
  var on=String(x.now_playing||'')==='1';
  items.push('<div class="epg-entry">'+
   '<span class="epg-time">'+esc(from&&to?from+' – '+to:from||'الوقت غير متوفر')+'</span>'+
   '<span class="epg-program">'+(on?'<em>الآن</em> ':'')+esc(name.slice(0,110))+'</span></div>')
 }
 return items.length?items.join(''):'<span class="epg-empty">لم يرسل المصدر بيانات برامج قابلة للعرض.</span>'
}
function loadShortEpg(id){
 var box=document.getElementById('live-epg'),now=Date.now(),cached=S.epgCache[id],token=++S.epgToken;
 if(S.epgTimer){clearTimeout(S.epgTimer);S.epgTimer=null}
 if(!box||S.route!=='live'||!id)return;
 if(cached&&now-cached.time<300000){box.innerHTML=cached.html;return}
 box.textContent='جار تحميل دليل القناة…';
 S.epgTimer=setTimeout(function(){
  S.epgTimer=null;
  if(S.route!=='live'||token!==S.epgToken||S.selected!==id)return;
  api('GET','/api/catalog?action=get_short_epg&stream_id='+enc(id)+'&limit=5',null,function(st,data){
   if(S.route!=='live'||token!==S.epgToken||S.selected!==id)return;
   var target=document.getElementById('live-epg');if(!target)return;
   var html=st===200?formatEpg(data):'<span class="epg-empty">تعذر تحميل دليل البرامج الآن.</span>';
   target.innerHTML=html;
   if(st===200){
    S.epgCache[id]={time:Date.now(),html:html};
    // Keep the TV's memory bounded when browsing hundreds of channels.
    var keys=Object.keys(S.epgCache);
    if(keys.length>80){
     keys.sort(function(a,b){return S.epgCache[a].time-S.epgCache[b].time});
     for(var i=0;i<keys.length-80;i++)delete S.epgCache[keys[i]]
    }
   }
  })
 },450)
}
function beginPreview(item){
 var video=document.getElementById('live-video'),box=document.getElementById('live-status'),empty=document.getElementById('preview-empty');
 if(!video||!item||S.route!=='live')return;
 var id=itemId(item,'live'),key='live/'+id+'/ts/0';
 if(String(S.selected)!==String(id))return;
 if(S.livePreview===id&&S.play&&S.play.preview&&S.play.video===video){
  if(video.paused&&S.play.ready){try{var p=video.play();if(p&&p.catch)p.catch(function(){})}catch(e){}}
  return
 }
 if(empty)empty.style.display='none';
 // Never start the next live FFmpeg session until the server confirms
 // shutdown of the previous preview. We retain only the latest remote choice.
 if(S.previewStopPending){
  S.previewPendingItem=item;
  if(box)box.textContent='جار تبديل المعاينة للقناة المحددة…';
  return
 }
 var previous=S.play;
 if(previous&&previous.preview&&previous.hlsKey){
  S.previewStopPending=true;S.previewPendingItem=item;
  var previousKey=previous.hlsKey,settled=false,guard=null;
  stopPlayback(false);
  if(box)box.textContent='جار تبديل القناة…';
  function finished(st){
   if(settled)return;
   settled=true;if(guard)clearTimeout(guard);
   S.previewStopPending=false;
   var next=S.previewPendingItem;S.previewPendingItem=null;
   if(S.route!=='live'||!video.isConnected)return;
   if(st!==200&&st!==404){
    if(box)box.textContent='تعذر إنهاء اتصال المعاينة السابقة؛ اضغط المعاينة لإعادة المحاولة.';
    return
   }
   if(next&&String(itemId(next,'live'))===String(S.selected))beginPreview(next)
  }
  guard=setTimeout(function(){finished(0)},6500);
  api('POST','/api/hls/'+previousKey+'/stop',{},function(st){finished(st)});
  return
 }
 S.livePreview=id;
 if(box)box.textContent='جار تشغيل معاينة '+title(item)+' تلقائيًا…';
 video.muted=S.previewSound===false;video.defaultMuted=video.muted;
 if(video.muted)video.setAttribute('muted','');else video.removeAttribute('muted');
 video.autoplay=true;video.setAttribute('autoplay','');
 video.playsInline=true;video.controls=false;
 playHls(video,'live',id,'ts',0,box,true)
}
function mergeCatalogPage(listing,result,kind){
 var offset=Number(listing.nextOffset||listing.items.length),nextOffset=Number(result.nextOffset);
 // A repeated cursor must never trigger an endless sequence of requests.
 if(!isFinite(nextOffset)||Math.floor(nextOffset)!==nextOffset||nextOffset<offset||
    (result.hasMore&&nextOffset<=offset))return null;
 var seen=Object.create(null);
 for(var i=0;i<listing.items.length;i++)seen[itemId(listing.items[i],kind)]=true;
 var next=result.items.filter(function(item){
  var id=itemId(item,kind);if(!id||seen[id])return false;seen[id]=true;return true
 });
 listing.items=listing.items.concat(next);listing.nextOffset=nextOffset;
 // Duplicate-only pages can occur when the source changes during browsing.
 // A forward cursor, not the number of newly unique items, determines whether more exists.
 listing.hasMore=!!result.hasMore;
 return next
}
function loadMore(kind){
 var cat=S.cat[kind]||'all',key=keyOf(kind,cat),listing=S.loaded[key];
 if(!listing||!listing.hasMore||listing.loadingMore)return;
 listing.loadingMore=true;
 var btn=document.querySelector('[data-more="'+kind+'"]');
 if(btn){btn.disabled=true;btn.textContent='جار تحميل المزيد…'}
 pageRequest(kind,cat,listing.nextOffset||listing.items.length,36,function(st,result){
  listing.loadingMore=false;
  if(S.loaded[key]!==listing){pruneInactiveListings();return}
  if(st!==200||!result||S.route!==kind||(S.cat[kind]||'all')!==cat){
   pruneInactiveListings();
   if(btn&&S.route===kind){btn.disabled=false;btn.textContent='تعذر التحميل، حاول مرة أخرى'}
   return
  }
  var next=mergeCatalogPage(listing,result,kind);
  if(next===null){
   if(btn){btn.disabled=false;btn.textContent='تعذر التحميل، حاول مرة أخرى'}
   return
  }
  touchListing(listing);pruneInactiveListings();
  var list=kind==='live'?document.getElementById('channel-list'):(S.sort==='source'?document.querySelector('.poster-panel .poster-grid'):null);
  if(!list){buildCatalog(kind,listing);return}
  // Incremental append keeps the existing focus, scroll position and live preview player.
  if(kind==='live'){
   list.insertAdjacentHTML('beforeend',next.map(function(item){
    var id=itemId(item,'live'),pic=art(item);
    return '<button class="channel-item" data-channel="'+esc(id)+'">'+(pic?safeImg(item,'channel-image'):'<span class="channel-image"></span>')+
      '<span class="channel-name"><strong>'+esc(title(item))+'</strong><small>شاهد الآن</small></span><span class="accent">▶</span></button>'
   }).join(''))
  }else{
   list.insertAdjacentHTML('beforeend',next.map(function(item){return posterCard(item,kind)}).join(''));
   enrichPosters(kind,next.slice(0,8))
  }
  var count=document.querySelector(kind==='live'?'.channels .pane-head small':'.poster-panel-header small');
  if(count)count.textContent=listing.items.length+(kind==='live'?' قناة محمّلة':' عنوان محمّل • تصفح الملصقات');
  if(btn){btn.disabled=!listing.hasMore;btn.textContent=listing.hasMore?'عرض المزيد':'تم عرض المحتوى'}
 })
}
function bindMoreOnScroll(kind){
 var panel=document.querySelector(kind==='live'?'#channel-list':'.poster-panel');
 if(!panel)return;
 var queued=false;
 panel.addEventListener('scroll',function(){
  if(queued||S.route!==kind)return;
  queued=true;
  setTimeout(function(){
   queued=false;
   if(S.route!==kind||panel.scrollHeight-panel.scrollTop-panel.clientHeight>480)return;
   var button=document.querySelector('[data-more="'+kind+'"]');
   if(button&&!button.disabled)loadMore(kind)
  },130)
 },{passive:true})
}
function recordPlaybackQuality(p){
 if(!p||!p.stats||!S.profileKey)return;
 var st=p.stats,now=Date.now(),bufferMs=st.bufferMs||0;
 if(st.bufferSince)bufferMs+=Math.max(0,now-st.bufferSince);
 // No channel ID, access token, customer code or provider URL is retained.
 var result={kind:p.kind==='live'?'live':p.kind==='series'?'series':'movie',
  mode:['fullvod','vodhls','direct','hls','mpegts'].indexOf(p.mode)>=0?p.mode:'unknown',
  startupMs:st.firstFrameAt?Math.max(0,Math.min(120000,st.firstFrameAt-st.openedAt)):null,
  bufferingEvents:Math.max(0,Math.min(999,st.bufferEvents||0)),
  bufferingMs:Math.max(0,Math.min(3600000,Math.round(bufferMs))),
  seekAttempts:Math.max(0,Math.min(999,st.seekAttempts||0)),
  seekReady:Math.max(0,Math.min(999,st.seekReady||0)),
  verifiedSeekFrames:Math.max(0,Math.min(999,st.verifiedSeekFrames||0)),
  seekTimeouts:Math.max(0,Math.min(999,st.seekTimeouts||0)),
  lastSeekMs:st.lastSeekMs!==null&&st.lastSeekMs!==undefined&&isFinite(Number(st.lastSeekMs))?Math.max(0,Math.min(120000,Number(st.lastSeekMs))):null,
  errors:Math.max(0,Math.min(99,st.errors||0)),
  stoppedAt:now};
 S.lastPlaybackDiag=result;
 profileSave('lastPlaybackDiag',result)
}
function checkpointPosition(p){
 if(!p||!p.video)return 0;
 var base=(p.mode==='vodhls'?Number(p.offset)||0:0)+Math.max(0,Number(p.video.currentTime)||0);
 // A pending TV key repeat or an in-flight seek has not updated the video
 // element playhead yet. Preserve the user's chosen location on close.
 var pending=p.pendingSeek,now=Date.now(),desired=null;
 if(p.seekDebounce&&p.lastSeekTarget!==undefined&&p.lastSeekTarget!==null)
  desired=p.lastSeekTarget;
 else if(pending&&now-pending.startedAt<55000)desired=pending.target;
 else if(p.seekIncomplete&&p.lastSeekTarget!==undefined&&p.lastSeekTarget!==null&&
  now-(p.lastSeekAt||0)<120000)desired=p.lastSeekTarget;
 if(desired!==null&&desired!==undefined&&isFinite(Number(desired))){
  var runtime=playbackDuration(p),position=Math.max(0,Number(desired));
  if(runtime>0)position=Math.min(position,Math.max(0,runtime-2));
  // Never mark a movie watched merely because someone selected its last frame.
  if(runtime>60&&position>=runtime-60)return Math.min(base,Math.floor(runtime*.94));
  return position
 }
 return base
}
function vodEndedAtRealFinish(duration,position,seekIncomplete){
 // Full-film playback must not be marked complete because a TV decoder
 // emits "ended" after a single 24-second chunk. Unknown EVENT duration
 // cannot prove that an arbitrary source EOF was the end of the title.
 var length=Number(duration),seen=Number(position);
 if(!(length>=120&&length<=21600&&isFinite(length))||
  !(seen>=0&&isFinite(seen))||seekIncomplete)return false;
 var tolerance=Math.min(45,Math.max(8,Math.round(length*.008)));
 return seen>=length-tolerance
}
function playbackDuration(p){
 if(!p)return 0;
 var seconds=Number(p.duration)||0,observed=Number(p.video&&p.video.duration);
 // Some native TV HLS decoders report a single 24-second chunk rather
 // than the real runtime. That wrong number must never erase checkpoints.
 if(p.mode==='fullvod'||p.mode==='vodhls')return seconds>0&&isFinite(seconds)?seconds:0;
 if(seconds>=120&&seconds<=21600)return seconds;
 return observed>=120&&observed<=21600&&isFinite(observed)?observed:0
}
function progressKey(k,id){return k+':'+id}
function getResume(k,id){return S.watch[progressKey(k,id)]||null}
function finishResume(kind,id){
 // Only explicitly verified media EOF can mark a title as fully watched.
 if(kind==='live')return;
 var player=S.playerView;
 var current=player&&player.kind===kind&&String(player.id)===String(id),wasCompleted=current&&player.completed;
 if(current)player.completed=true;
 delete S.watch[progressKey(kind,id)];
 profileSave('watch',S.watch);
 if(current&&!wasCompleted&&typeof player.afterVerifiedEnd==='function')player.afterVerifiedEnd()
}
function saveResume(kind,id,pos,duration,ready){
 if(kind==='live'||!ready||!isFinite(pos)||pos<0)return;
 var player=S.playerView;
 // timeupdate, pause and pagehide can fire AFTER verified EOF. Without this
 // guard they immediately recreate a completed title in Continue Watching.
 if(player&&player.completed&&player.kind===kind&&String(player.id)===String(id))return;
 duration=isFinite(duration)&&duration>0?duration:0;
 var key=progressKey(kind,id),last=S.watch[key];
 // A new player starting at zero must not overwrite a real checkpoint.
 if(pos<5&&(duration===0||(last&&last.position>30)))return;
 // Choosing the last minutes of a film does not prove it was watched.
 // Retain the resume checkpoint until a verified end event fires.
 if(duration>0)pos=Math.min(pos,Math.max(0,duration-1));
 {
  var info=S.playerView&&S.playerView.kind===kind&&String(S.playerView.id)===String(id)?S.playerView:null;
  var entry={position:Math.round(pos),duration:Math.round(duration),updated:Date.now()},old=last||{};
  entry.name=String(info&&info.name||old.name||'').slice(0,140);
  entry.ext=String(info&&info.ext||old.ext||'mp4').slice(0,8);
  entry.art=urlPic(info&&info.art||old.art||'');
  entry.seriesId=String(info&&info.seriesId||old.seriesId||'').slice(0,18);
  S.watch[key]=entry;
  var keys=Object.keys(S.watch);
  if(keys.length>160){
   keys.sort(function(a,b){return (S.watch[a].updated||0)-(S.watch[b].updated||0)});
   for(var i=0;i<keys.length-160;i++)delete S.watch[keys[i]]
  }
 }
 profileSave('watch',S.watch)
}
function needsPlotTranslation(value){
 var text=typeof value==='string'?value.trim():'';
 if(text.length<4||text.length>3900)return false;
 var persianLetters=(text.match(/[\u067e\u0686\u0698\u06af\u06a9\u06cc]/g)||[]).length;
 var persianWords=(text.match(/(?:^|[\s،؛.!؟])(?:این|برای|است|می‌شود|میشود|خواهد|که|را|در)(?=$|[\s،؛.!؟])/g)||[]).length;
 if(persianLetters>=3||persianLetters>=1&&persianWords>=2||persianWords>=4)return true;
 var arabic=(text.match(/[\u0621-\u064a\u066e-\u06d3]/g)||[]).length;
 var latin=(text.match(/[a-zA-Z]/g)||[]).length;
 return arabic<Math.max(3,latin/2)&&(/[a-zA-Z\u00c0-\u052f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text))
}
function details(o){
 var k=o.kind||S.kind,id=String(o.id||''),item=findItem(k,id)||o.item;
 if(!item){navigate(k,{},true);return}
 if(k==='series'&&S.episodesSeriesId!==id){S.episodes=null;S.episodesSeriesId='';S.selectedSeason=''}
 S.item={kind:k,id:id,data:item};S.kind=k;S.route='detail';
 shell(title(item),'<div id="detail-root">'+loading('تفاصيل المحتوى')+'</div>');
 var detailRoot=document.getElementById('detail-root'),detailEpoch=S.accountEpoch,plotSource='',plotTranslation='',plotPending='',plotAttempted='',plotOriginal=false,plotGeneration=0;
 function detailCurrent(){return S.accountEpoch===detailEpoch&&S.route==='detail'&&S.item&&S.item.kind===k&&S.item.id===id&&document.getElementById('detail-root')===detailRoot}
 function renderPlotTranslation(){
  if(!detailCurrent())return;
  var field=document.getElementById('detail-plot-text'),control=document.getElementById('detail-translate'),notice=document.getElementById('detail-translate-status');
  if(!field||!control||!notice)return;
  field.textContent=plotTranslation&&!plotOriginal?plotTranslation:plotSource;
  control.hidden=!needsPlotTranslation(plotSource);
  control.disabled=!!plotPending&&plotPending===plotSource;
  control.textContent=plotTranslation?(plotOriginal?'عرض الترجمة العربية':'عرض الوصف الأصلي'):(control.disabled?'جار الترجمة…':'ترجمة الوصف');
  notice.textContent='';
 }
 function translatePlot(){
  if(!detailCurrent()||!needsPlotTranslation(plotSource)||plotPending===plotSource)return;
  if(plotTranslation){plotOriginal=!plotOriginal;renderPlotTranslation();return}
  var source=plotSource,generation=++plotGeneration;
  plotAttempted=source;plotPending=source;renderPlotTranslation();
  api('POST','/api/ai/translate',{overview:source},function(st,data){
   if(!detailCurrent()||generation!==plotGeneration||plotSource!==source)return;
   plotPending='';
   if(st===200&&data&&data.ok===true&&typeof data.translatedOverview==='string'&&data.translatedOverview.trim()){plotTranslation=data.translatedOverview;plotOriginal=false}
   renderPlotTranslation();
   var notice=document.getElementById('detail-translate-status');
   if(!plotTranslation&&notice)notice.textContent=st===429?'الترجمة مشغولة مؤقتًا، حاول لاحقًا.':'تعذرت الترجمة، يمكنك إعادة المحاولة.';
  });
 }
 function show(extra){
  if(!detailCurrent())return;
  var info=(extra&&extra.info)||{};
  if(extra&&extra.info)S.detailInfo={kind:k,id:id,info:info};
  var artwork=urlPic(info.movie_image||info.cover_big||info.cover||'')||art(item),backdrop=urlPic(info.backdrop_path||info.backdrop||item.backdrop)||artwork;
  var plot=String(info.plot||info.description||info.overview||item.plot||item.description||'المحتوى متاح ضمن مكتبتك في BLOFY STREAM');
  if(plotSource!==plot){plotGeneration++;plotSource=plot;plotTranslation='';plotPending='';plotAttempted='';plotOriginal=false}
  var gen=info.genre||info.genres||item.genre||'',year=info.releaseDate||info.release_date||info.releasedate||item.release_date||item.year||'',rating=info.rating||item.rating||'';
  var key=k+':'+id,resume=getResume(k,id),hasResume=resume&&resume.position>30&&(!resume.duration||resume.position/resume.duration<.95);
  var buttons=k==='movie'?'<button class="btn" data-watch="movie:'+esc(id)+'" data-from="'+(hasResume?Math.round(resume.position):0)+'">▶ '+(hasResume?'متابعة المشاهدة':'شاهد الآن')+'</button>'+
   (hasResume?'<button class="btn secondary" data-watch="movie:'+esc(id)+'" data-from="0">ابدأ من البداية</button>':''):
   '<button class="btn" data-episodes="'+esc(id)+'">▤ المواسم والحلقات</button>';
  if(k==='movie')buttons+='<button class="btn secondary" data-download="movie:'+esc(id)+'" data-ext="'+esc(item.container_extension||'mp4')+'" data-name="'+esc(title(item))+'">↓ تنزيل الفيلم</button>';
  buttons+='<button class="btn secondary" data-favorite="'+k+':'+esc(id)+'">'+(S.library[key]?'♥ إزالة من المفضلة':'♡ المفضلة')+'</button>';
  var genre=Array.isArray(gen)?gen.join(' • '):String(gen||'');
  function field(label,value){if(Array.isArray(value))value=value.map(function(v){return typeof v==='object'&&v?v.name||'':v}).filter(Boolean).join('، ');if(typeof value!=='string'&&typeof value!=='number')return '';var clean=String(value).trim();return clean?'<div class="detail-meta-row"><dt>'+esc(label)+'</dt><dd>'+esc(clean)+'</dd></div>':''}
  var metadata=field('التصنيف',genre||posterCategory(item,k))+field('تاريخ الإصدار',year)+field('التقييم',rating)+field('المدة',info.duration||item.duration)+field('الممثلون',info.cast||info.actors||item.cast)+field('المخرج',info.director||item.director)+field('اللغة',info.language||item.language)+field('الدولة',info.country||item.country);
  var root=document.getElementById('detail-root');if(!root)return;
  var savedFocus=root.contains(document.activeElement)?focusIdentity(document.activeElement):null;
  root.innerHTML='<div class="detail-backdrop">'+safeImg(backdrop)+'</div><div class="detail-content">'+
  (artwork?'<img class="detail-poster" src="'+esc(artwork)+'" alt="" >':'<div class="detail-poster"></div>')+
  '<div class="detail-body"><span class="chip primary">'+(k==='movie'?'فيلم':'مسلسل')+'</span><h2 class="detail-title">'+esc(title(item))+'</h2>'+
  '<div class="detail-subtitle">'+esc([genre,year,rating].filter(Boolean).join(' • '))+'</div><div class="detail-actions">'+buttons+'</div><p class="detail-plot" id="detail-plot-text">'+esc(plot)+'</p><div class="detail-translation"><button type="button" class="btn secondary" id="detail-translate" hidden>ترجمة الوصف</button><span id="detail-translate-status" role="status" aria-live="polite"></span></div>'+
  (metadata?'<details class="detail-metadata"><summary>معلومات المحتوى والممثلون</summary><dl>'+metadata+'</dl></details>':'')+
  (hasResume?'<div class="detail-stat">آخر مشاهدة: '+formatTime(resume.position)+(resume.duration?' من '+formatTime(resume.duration):'')+'</div>'+(resume.duration?'<span class="progress-meter"><i style="width:'+Math.round(resume.position/resume.duration*100)+'%"></i></span>':''):'')+
  '</div></div><section id="related-root"></section>';
  document.getElementById('detail-translate').onclick=translatePlot;
  renderPlotTranslation();
  if(extra&&needsPlotTranslation(plotSource)&&plotAttempted!==plotSource&&!plotTranslation)translatePlot();
  restoreView('detail');
  if(savedFocus&&S.keyboardMode){var target=findFocus(savedFocus);if(target)try{target.focus({preventScroll:true})}catch(e){target.focus()}}
 }
 show();
 var endpoint=k==='movie'?'get_vod_info&vod_id=':'get_series_info&series_id=';
 api('GET','/api/catalog?action='+endpoint+enc(id),null,function(st,data){
  if(!detailCurrent())return;
  if(st===200&&data){S.item.info=data;show(data);if(k==='series'&&data.episodes){S.episodes=data;S.episodesSeriesId=id;var p=document.getElementById('related-root');if(p)p.innerHTML=''}}
 })
}
function parseEpisodes(data){
 var result=[];if(!data||!data.episodes)return result;
 var sets=data.episodes;for(var key in sets){if(!Object.prototype.hasOwnProperty.call(sets,key))continue;var arr=sets[key];if(!Array.isArray(arr))continue;
  for(var i=0;i<arr.length;i++){var ep=arr[i];ep.__season=String(key);result.push(ep)}
 }
 return result
}
function episodesScreen(opts){
 var id=String(opts.id||S.item&&S.item.id||'');var item=findItem('series',id)||(S.item&&S.item.kind==='series'&&S.item.id===id?S.item.data:null);
 if(!item){navigate('series',{},true);return}
 if(S.episodesSeriesId!==id){S.episodes=null;S.episodesSeriesId='';S.selectedSeason=''}
 S.item={kind:'series',id:id,data:item};S.route='episodes';S.kind='series';
 shell(title(item)+' — الحلقات','<div id="episodes-root">'+loading('مواسم المسلسل')+'</div>');
 var episodeRoot=document.getElementById('episodes-root'),episodeEpoch=S.accountEpoch;
 function episodesCurrent(){return S.accountEpoch===episodeEpoch&&S.route==='episodes'&&S.item&&S.item.kind==='series'&&S.item.id===id&&document.getElementById('episodes-root')===episodeRoot}
 function finish(data){
  if(!episodesCurrent())return;
  var list=parseEpisodes(data),seasons={};for(var i=0;i<list.length;i++)seasons[list[i].__season]=true;
  var keys=Object.keys(seasons).sort(function(a,b){return Number(a)-Number(b)});
  if(!keys.length){document.getElementById('episodes-root').innerHTML='<div class="info">تعذر جلب الحلقات لهذا المسلسل.</div>';return}
  if(keys.indexOf(S.selectedSeason)<0)S.selectedSeason=keys[0];
  S.episodes=data;S.episodesSeriesId=id;
  var chosen=list.filter(function(x){return x.__season===S.selectedSeason}).sort(function(a,b){return Number(a.episode_num||0)-Number(b.episode_num||0)});
  var rail=keys.map(function(x){return '<button class="cat-item '+(x===S.selectedSeason?'selected':'')+'" data-season="'+esc(x)+'">الموسم '+esc(x)+'</button>'}).join('');
  var html='<div class="episode-layout"><aside class="cat-rail season-rail"><div class="pane-head"><strong>المواسم</strong></div><div class="pane-scroll">'+rail+'</div></aside>'+
  '<section class="episode-list">'+chosen.map(function(x,i){
   var eid=String(x.id||''),name=x.title||'الحلقة '+(x.episode_num||i+1),extension=x.container_extension||'mp4';
   var w=getResume('series',eid),pct=w&&w.duration?Math.round(w.position/w.duration*100):0;
   return '<button class="episode-row" data-watch="series:'+esc(eid)+'" data-ext="'+esc(extension)+'" data-name="'+esc(name)+'" data-from="'+(w&&w.position>30?Math.round(w.position):0)+'">'+
   '<span class="episode-art">'+(art(x.info)||art(x)||art(item)?safeImg(art(x.info)||art(x)||art(item),'episode-cover'):'')+'<span class="episode-placeholder">▤</span>'+'</span><span class="episode-copy"><strong class="episode-name">الحلقة '+esc(x.episode_num||i+1)+' — '+esc(name)+'</strong>'+
   '<span class="episode-meta">الموسم '+esc(S.selectedSeason)+
   (x.info&&x.info.duration||x.duration?' • '+esc(String(x.info&&x.info.duration||x.duration).slice(0,30)):'')+
   (pct?' • متابعة '+pct+'٪':' • اضغط للمشاهدة')+'</span>'+
   (pct?'<span class="episode-progress"><i style="width:'+pct+'%"></i></span>':'')+'</span></button>'+
   '<button class="btn secondary episode-download" type="button" data-download="series:'+esc(eid)+'" data-ext="'+esc(extension)+'" data-name="'+esc(name)+'">↓ تنزيل الحلقة</button>'
  }).join('')+'</section></div>';
  document.getElementById('episodes-root').innerHTML=html;restoreView('episodes');
 }
 if(S.episodesSeriesId===id&&S.episodes&&S.episodes.episodes)finish(S.episodes);
 else api('GET','/api/catalog?action=get_series_info&series_id='+enc(id),null,function(st,d){if(!episodesCurrent())return;if(st===200)finish(d);else episodeRoot.innerHTML='<div class="info error">تعذر جلب الحلقات، حاول مرة أخرى.</div><button class="btn secondary" data-episodes="'+esc(id)+'">إعادة المحاولة</button>'})
}
/* Web downloads: file delivery is delegated to the browser's download manager.
 * A requested transfer is NOT claimed to be complete or available offline in
 * this web app. All URLs stay same-origin and are reauthorized on the server.
 * This feature never downloads live channels or entire HLS playlists. */
function webDownloadPath(kind,id,ext){
 var k=String(kind||''),n=String(id||''),x=String(ext||'').toLowerCase();
 if((k!=='movie'&&k!=='series')||!/^[1-9][0-9]{0,14}$/.test(n)||
   ['mp4','mkv','avi','mov','ts'].indexOf(x)<0)return '';
 return '/api/download/'+k+'/'+n+'.'+x
}
function webDownloadHistory(){
 var rows=S.profileKey?readJson(profileStorageKey('downloadRequests'),[]):[];
 return Array.isArray(rows)?rows.filter(function(row){
  return row&&webDownloadPath(row.kind,row.id,row.ext)&&
    Number.isFinite(Number(row.at))&&String(row.name||'').length<200
 }).slice(0,40):[]
}
// User-initiated, account-scoped offline media, separate from the shell cache.
// OPFS writes stream directly to disk; no full movie held in JavaScript RAM.
var OFFLINE_GRANT_KEY='blofy_offline_grant_v1',OFFLINE_MAX_BYTES=2*1024*1024*1024,offlineTransfer=null,offlineVideoUrl='',offlinePlaybackTimer=null;
function offlineGrantValid(grant,now){
 return !!grant&&/^[a-f0-9]{24}$/.test(grant.profile||'')&&Number.isFinite(grant.verifiedAt)&&Number.isFinite(grant.until)&&now>=grant.verifiedAt&&now<grant.until&&grant.until-grant.verifiedAt<=86400000
}
function offlineGrant(){
 var grant=readJson(OFFLINE_GRANT_KEY,null);return offlineGrantValid(grant,Date.now())?grant:null
}
function rememberOfflineGrant(profile,expiry){
 var end=typeof expiry==='number'?expiry:Date.parse(String(expiry||'')),now=Date.now();
 if(/^[a-f0-9]{24}$/.test(profile||'')&&Number.isFinite(end)&&end>now)writeJson(OFFLINE_GRANT_KEY,{profile:profile,verifiedAt:now,until:Math.min(end,now+86400000)})
}
function clearOfflineGrant(){try{localStorage.removeItem(OFFLINE_GRANT_KEY)}catch(e){}if(offlineTransfer)offlineTransfer.ctrl.abort();closeOfflineVideo()}
function offlineSupported(){return !!(navigator.storage&&navigator.storage.getDirectory&&window.AbortController&&window.URL&&URL.createObjectURL&&window.ReadableStream)}
function offlineRows(profile){
 var rows=readJson('blofy_web_offline_v1:'+profile,[]);
 return Array.isArray(rows)?rows.filter(function(row){return row&&/^(movie|series)-[1-9][0-9]{0,14}-[a-f0-9]{24}\.mp4$/.test(row.file)&&Number.isSafeInteger(row.size)&&row.size>0&&row.size<=OFFLINE_MAX_BYTES&&typeof row.name==='string'}).slice(0,20):[]
}
async function offlineFolder(profile){
 if(!/^[a-f0-9]{24}$/.test(profile)||!offlineSupported())throw Error('unsupported');
 var root=await navigator.storage.getDirectory(),base=await root.getDirectoryHandle('blofy-offline-v1',{create:true});
 return base.getDirectoryHandle(profile,{create:true})
}
function offlineMessage(text){
 var progress=document.getElementById('offline-progress');if(progress){progress.hidden=!offlineTransfer;progress.value=offlineTransfer?offlineTransfer.pct||0:0}
 var cancel=document.getElementById('offline-cancel');if(cancel)cancel.hidden=!offlineTransfer;
 var el=document.getElementById('offline-status')||document.getElementById('web-download-message');
 if(!el){el=document.createElement('div');el.id='web-download-message';el.className='info';var target=document.querySelector('#detail-root .detail-actions,.episode-list,#screen');if(target)target.appendChild(el)}
 if(el)el.textContent=text
}
function closeOfflineVideo(){
 if(offlinePlaybackTimer){clearInterval(offlinePlaybackTimer);offlinePlaybackTimer=null}
 var video=document.getElementById('offline-video');if(video)try{video.pause();video.removeAttribute('src');video.load()}catch(e){}
 if(offlineVideoUrl){URL.revokeObjectURL(offlineVideoUrl);offlineVideoUrl=''}
}
function drawOfflineDownloads(profile,standalone){
 closeOfflineVideo();
 var root=document.getElementById('offline-library');if(!root)return;
 var rows=offlineRows(profile);
 root.innerHTML=rows.length?rows.map(function(row,index){return '<div class="download-row"><strong>'+esc(row.name)+'</strong><span>'+Math.round(row.size/1048576)+' MB • محفوظ</span><button class="btn" data-offline-play="'+index+'">▶ مشاهدة</button><button class="btn secondary" data-offline-delete="'+index+'">حذف</button></div>'}).join(''):'<div class="empty-state">لا توجد ملفات مكتملة. نزّل فيلم MP4 أو حلقة أثناء اتصالك بالإنترنت.</div>';
 root.onclick=async function(event){
  var node=event.target.closest&&event.target.closest('[data-offline-play],[data-offline-delete]');if(!node||!root.contains(node))return;
  var grant=offlineGrant(),row=rows[Number(node.getAttribute(node.hasAttribute('data-offline-play')?'data-offline-play':'data-offline-delete'))];
  if(!row||!grant||grant.profile!==profile){offlineMessage('اتصل بالإنترنت للتحقق من اشتراكك.');return}
  try{
   var folder=await offlineFolder(profile);
   if(node.hasAttribute('data-offline-delete')){
    await folder.removeEntry(row.file);localStorage.setItem('blofy_web_offline_v1:'+profile,JSON.stringify(offlineRows(profile).filter(function(x){return x.file!==row.file})));drawOfflineDownloads(profile,standalone);return
   }
   var file=await (await folder.getFileHandle(row.file)).getFile();
   if(file.size!==row.size)throw Error('incomplete');
   if(!root.isConnected||!offlineGrant()||offlineGrant().profile!==profile)return;
   closeOfflineVideo();var player=document.getElementById('offline-player');
   if(!player)return;
   player.innerHTML='<video id="offline-video" controls playsinline preload="metadata" style="width:100%;max-height:65vh;background:#000"></video>';
   var video=document.getElementById('offline-video');
   offlineVideoUrl=URL.createObjectURL(file.slice(0,file.size,'video/mp4'));video.src=offlineVideoUrl;
   video.onerror=function(){offlineMessage('هذا الملف غير مدعوم في متصفح جهازك.')};
   offlinePlaybackTimer=setInterval(function(){var current=offlineGrant();if(!current||current.profile!==profile||!video.isConnected){closeOfflineVideo();offlineMessage('اتصل بالإنترنت لتجديد صلاحية المشاهدة.')}},1000);
   var play=video.play();if(play&&play.catch)play.catch(function(){})
  }catch(e){offlineMessage('تعذر فتح الملف المحفوظ. قد تكون مساحة التخزين حُذفت من المتصفح.')}
 }
}
function offlineOnlyScreen(){
 var grant=offlineGrant();if(!grant||!offlineSupported())return false;
 S.route='offline';S.userVerified=false;
 app.innerHTML='<main class="workspace"><h1>BLOFY STREAM</h1><h2>التنزيلات • بدون إنترنت</h2><div id="offline-status" role="status"></div><div id="offline-player"></div><div id="offline-library"></div><button class="btn secondary" id="offline-reconnect">التحقق من الاتصال</button></main>';
 document.getElementById('offline-reconnect').onclick=function(){closeOfflineVideo();S.route='boot';bootSession(0)};
 drawOfflineDownloads(grant.profile,true);return true
}
function offerDeviceDownload(kind,id,ext,name){
 offlineMessage('المشاهدة داخل التطبيق غير متاحة لهذه الصيغة أو الجهاز. يمكنك حفظ الملف في تنزيلات جهازك.');
 var el=document.getElementById('offline-status')||document.getElementById('web-download-message');
 if(!el)return;var button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='حفظ على الجهاز';button.onclick=function(){button.disabled=true;requestWebDownload(kind,id,ext,name)};el.appendChild(button)
}
async function saveOfflineDownload(kind,id,ext,name){
 if(!S.userVerified){offlineMessage('فعّل اشتراكك أولًا.');return}
 if(!webDownloadPath(kind,id,ext)){offlineMessage('صيغة الملف غير مدعومة.');return}
 if(!offlineSupported()||String(ext).toLowerCase()!=='mp4'){offerDeviceDownload(kind,id,ext,name);return}
 if(offlineRows(S.profileKey).some(function(row){return row.file.indexOf(kind+'-'+id+'-')===0})){offlineMessage('هذا الملف محفوظ بالفعل في التنزيلات.');return}
 if(offlineTransfer){offlineMessage('يوجد تنزيل جارٍ.');return}
 var profile=S.profileKey,epoch=S.accountEpoch,ctrl=new AbortController(),task={ctrl:ctrl,name:String(name||'فيديو').slice(0,160),pct:0};offlineTransfer=task;
 var folder=null,fileName='',writer=null,reader=null,committed=false;
 function current(){return S.userVerified&&S.accountEpoch===epoch&&S.profileKey===profile&&!ctrl.signal.aborted}
 function check(){if(!current())throw Error('cancelled')}
 try{
  offlineMessage('جار التحقق من الاشتراك…');
  var session=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',signal:ctrl.signal});
  if(!session.ok)throw Error('auth');var info=await session.json();check();
  if(info.active!==true||info.profileKey!==profile)throw Error('auth');
  rememberOfflineGrant(profile,info.expiresAt);if(!offlineGrant())throw Error('auth');
  if(offlineRows(profile).length>=20)throw Error('quota');
  folder=await offlineFolder(profile);check();
  var nonce=new Uint8Array(12);crypto.getRandomValues(nonce);
  fileName=kind+'-'+id+'-'+Array.from(nonce,function(x){return ('0'+x.toString(16)).slice(-2)}).join('')+'.mp4';
  var handle=await folder.getFileHandle(fileName,{create:true});
  if(typeof handle.createWritable!=='function'){offerDeviceDownload(kind,id,ext,name);return}
  var response=await fetch(webDownloadPath(kind,id,ext),{credentials:'same-origin',cache:'no-store',signal:ctrl.signal});check();
  if(response.status!==200||!response.body||!response.headers.get('content-disposition')||!/^attachment;/i.test(response.headers.get('content-disposition')))throw Error('source');
  var total=Number(response.headers.get('content-length'));
  if(!Number.isSafeInteger(total)||total<1||total>OFFLINE_MAX_BYTES)throw Error('size');
  if(navigator.storage.estimate){var estimate=await navigator.storage.estimate();if(Number.isFinite(estimate.quota)&&Number.isFinite(estimate.usage)&&estimate.quota-estimate.usage<total+1048576)throw Error('quota')}
  writer=await handle.createWritable();reader=response.body.getReader();
  var written=0,last=-1;
  while(true){check();var chunk=await reader.read();if(chunk.done)break;written+=chunk.value.byteLength;if(written>total)throw Error('size');await writer.write(chunk.value);var pct=Math.floor(written/total*100);if(pct!==last){last=pct;task.pct=pct;offlineMessage('جار تنزيل '+task.name+' • '+pct+'٪ • '+Math.floor(written/1048576)+' / '+Math.ceil(total/1048576)+' MB')}}
  check();if(written!==total)throw Error('size');await writer.close();writer=null;
  var saved=await handle.getFile();check();if(saved.size!==total)throw Error('size');
  var rows=offlineRows(profile);rows.unshift({file:fileName,size:total,name:String(name||'فيديو').slice(0,160)});
  localStorage.setItem('blofy_web_offline_v1:'+profile,JSON.stringify(rows.slice(0,20)));committed=true;
  offlineMessage('اكتمل التنزيل. افتح التنزيلات للمشاهدة دون إنترنت.');
  if(S.route==='downloads')drawOfflineDownloads(profile,false)
 }catch(e){offlineMessage(ctrl.signal.aborted?'تم إلغاء التنزيل.':e.message==='quota'||e.name==='QuotaExceededError'?'مساحة التخزين غير كافية. احذف بعض التنزيلات.':e.message==='size'?'حجم الملف غير مدعوم أو التنزيل غير مكتمل.':e.message==='auth'?'تعذر التحقق من الاشتراك.':'تعذر حفظ الفيلم كاملًا. حاول مجددًا عند توفر الاتصال.')}
 finally{try{if(reader)await reader.cancel()}catch(e){}try{if(writer)await writer.abort()}catch(e){}if(!committed&&folder&&fileName)try{await folder.removeEntry(fileName)}catch(e){}ctrl.abort();if(offlineTransfer===task)offlineTransfer=null;var progress=document.getElementById('offline-progress'),cancel=document.getElementById('offline-cancel');if(progress)progress.hidden=true;if(cancel)cancel.hidden=true}
}
function downloadsScreen(){
 shell('التنزيلات','<section class="downloads-page"><p class="small muted">الملفات المحفوظة بالكامل للمشاهدة دون إنترنت.</p><div id="offline-space" class="small muted"></div><div class="row offline-filters"><button class="btn secondary" id="offline-all">الكل</button><button class="btn secondary" id="offline-active">قيد التنزيل</button><button class="btn secondary" id="offline-ready">جاهزة</button></div><div id="offline-status" role="status" aria-live="polite"></div><progress id="offline-progress" max="100" value="0" hidden></progress><button class="btn secondary" id="offline-cancel" hidden>إلغاء التنزيل الجاري</button><div id="offline-player"></div><div id="offline-library"></div><p class="small muted">تجديد صلاحية المشاهدة بالاتصال مرة كل 24 ساعة.</p></section>');
 var profile=S.profileKey,filter='all',library=document.getElementById('offline-library'),space=document.getElementById('offline-space');
 var saved=offlineRows(profile).reduce(function(sum,row){return sum+row.size},0);space.textContent='المساحة المستخدمة: '+Math.round(saved/1048576)+' ميغابايت';
 if(navigator.storage&&navigator.storage.estimate)navigator.storage.estimate().then(function(info){if(space.isConnected&&Number.isFinite(info.quota)&&Number.isFinite(info.usage))space.textContent+=' • المتاحة تقريبًا: '+Math.max(0,Math.floor((info.quota-info.usage)/1048576))+' ميغابايت'}).catch(function(){});
 function setFilter(next){filter=next;library.hidden=filter==='active';['all','active','ready'].forEach(function(key){document.getElementById('offline-'+key).classList.toggle('active',key===filter)});if(next==='active')offlineMessage(offlineTransfer?'جار تنزيل '+offlineTransfer.name+' • '+offlineTransfer.pct+'٪':'لا يوجد تنزيل جارٍ.')}
 ['all','active','ready'].forEach(function(key){document.getElementById('offline-'+key).onclick=function(){setFilter(key)}});
 setFilter('all');if(offlineTransfer)offlineMessage('جار تنزيل '+offlineTransfer.name+' • '+offlineTransfer.pct+'٪');
 document.getElementById('offline-cancel').onclick=function(){if(offlineTransfer)offlineTransfer.ctrl.abort()};
 drawOfflineDownloads(S.profileKey,false);restoreView('downloads')
}
function requestWebDownload(kind,id,ext,name){
 var url=webDownloadPath(kind,id,ext);
 var message=document.getElementById('download-status')||document.getElementById('offline-status')||document.getElementById('web-download-message');
 if(!message){message=document.createElement('div');message.id='web-download-message';message.className='info';message.setAttribute('role','status');
  var target=document.querySelector('#detail-root .detail-actions,.downloads-page,.episode-list');
  if(target)target.insertAdjacentElement('afterend',message);
  else {var hud=document.getElementById('player-more-panel');
   if(hud)hud.appendChild(message);
   else {var screen=document.querySelector('#screen');if(screen)screen.insertBefore(message,screen.firstChild)}}}
 if(!url){if(message)message.textContent='صيغة هذا الملف لا تدعم التنزيل المباشر على الويب.';return}
 if(!S.userVerified){if(message)message.textContent='فعّل اشتراكك أولًا.';return}
 var epoch=S.accountEpoch;
 if(S.downloadPending){if(message)message.textContent='يوجد طلب تنزيل قيد التحقق، حاول بعد انتهائه.';return}
 var pending={epoch:epoch,url:url},controller=typeof AbortController==='function'?new AbortController():null;
 S.downloadPending=pending;
 var timer=setTimeout(function(){if(S.downloadPending!==pending)return;S.downloadPending=null;if(controller)controller.abort();if(message&&epoch===S.accountEpoch)message.textContent='انتهت مهلة التحقق؛ حاول مرة أخرى.'},15000);
 function finish(){clearTimeout(timer);if(S.downloadPending!==pending)return false;S.downloadPending=null;return epoch===S.accountEpoch&&S.userVerified}
 if(message)message.textContent='جار التحقق من صلاحية طلب التنزيل…';
 fetch(url,{method:'HEAD',credentials:'same-origin',cache:'no-store',signal:controller?controller.signal:undefined}).then(function(res){
  if(!finish())return;
  if(!res.ok){if(message)message.textContent=res.status===503?'التنزيلات غير مفعلة على هذا السيرفر حاليًا.':res.status===429?'التنزيلات مشغولة حاليًا، حاول لاحقًا.':'هذا الملف غير متوفر للتنزيل المباشر حاليًا.';return}
  var link=document.createElement('a');link.href=url;link.download='BLOFY-STREAM-'+kind+'-'+id+'.'+ext;
  function recordRequest(){
   if(epoch!==S.accountEpoch||!S.userVerified)return false;
   var rows=webDownloadHistory(),safeName=String(name||((kind==='movie'?'فيلم ':'حلقة ')+id)).slice(0,160);
   rows.unshift({kind:kind,id:id,ext:ext,name:safeName,at:Date.now()});
   profileSave('downloadRequests',rows.slice(0,40));
   return true
  }
  // iOS Safari/PWA may discard a programmatic download after an asynchronous
  // preflight. Offer a real user-activated anchor instead, with no popups.
  if(message&&document.documentElement&&document.documentElement.getAttribute('data-blofy-device')==='touch'){
   message.textContent='';link.className='btn';link.textContent='↓ حفظ الملف على الجهاز';
   link.onclick=function(e){
    if(!recordRequest()){e.preventDefault();link.remove();return}
    setTimeout(function(){if(link.isConnected){link.remove();message.textContent='بدأ طلب الحفظ؛ تابع تنزيلات جهازك.'}},0)
   };
   message.appendChild(link);return
  }
  document.body.appendChild(link);link.click();link.remove();recordRequest();
  if(message)message.textContent='أرسلت طلب التنزيل للمتصفح؛ تابع اكتمال الحفظ من تنزيلات الجهاز.';
  if(S.route==='downloads'){downloadsScreen();var status=document.getElementById('download-status');if(status)status.textContent='أرسلت طلب التنزيل للمتصفح؛ تابع اكتمال الحفظ من تنزيلات الجهاز.'}
 }).catch(function(){if(finish()&&message)message.textContent='تعذر التحقق من التنزيل، حاول مرة أخرى.'})
}
function favoritesScreen(){
 shell('المفضلة','<div id="fav-root"></div>');var keys=Object.keys(S.library),html='';
 for(var i=0;i<keys.length;i++){var p=keys[i].split(':'),item=findItem(p[0],p[1])||S.favoriteItems[keys[i]];if(item&&S.library[keys[i]])html+=posterCard(item,p[0])}
 document.getElementById('fav-root').innerHTML=html?'<div class="poster-grid">'+html+'</div>':'<div class="empty-state">أضف أفلامك ومسلسلاتك وقنواتك المفضلة حتى تظهر هنا.</div>';restoreView('favorites')
}
function collectionsScreen(){
 shell('التصنيفات','<div class="story-row"><button class="story" data-go="movie"><strong>أفلام</strong><small>جميع أنواع الأفلام</small></button>'+
 '<button class="story" data-go="series"><strong>مسلسلات</strong><small>المواسم والحلقات</small></button>'+
 '<button class="story" data-go="live"><strong>القنوات</strong><small>البث المباشر</small></button></div>'+
 '<div class="info" style="margin-top:25px">يعرض هذا القسم تصنيفات المصدر نفسها، دون إنشاء مجموعات وهمية.</div>')
}
function cancelSearch(){
 ++S.searchToken;
 if(S.searchTimer){clearTimeout(S.searchTimer);S.searchTimer=null}
 var old=S.searchRequests||[];S.searchRequests=[];
 for(var i=0;i<old.length;i++)try{old[i].abort()}catch(e){}
}
function searchScreen(){
 S.route='search';
 shell('البحث','<section class="search-screen"><div class="search-compose"><input id="search-input" class="input" placeholder="ابحث عن فيلم أو مسلسل أو قناة…" autofocus>'+
 '<button class="btn" id="search-submit">بحث ⌕</button></div>'+
 '<div class="search-tabs" id="search-filters">'+
 '<button class="chip" data-search-kind="all">الكل</button><button class="chip" data-search-kind="live">القنوات</button>'+
 '<button class="chip" data-search-kind="movie">الأفلام</button><button class="chip" data-search-kind="series">المسلسلات</button></div>'+
 '<div class="search-recent" id="search-recent"></div>'+
 '<p id="search-status" class="muted">أدخل اسم المحتوى لعرض النتائج من BLOFY</p><div id="search-result" class="search-result-grid"></div></section>');
 function renderRecent(){
  var target=document.getElementById('search-recent');if(!target)return;
  var old=S.recentSearches.slice(0,6);
  target.innerHTML=old.length?'<div class="row"><span class="small muted">عمليات البحث الأخيرة</span><button id="search-clear" class="chip">مسح</button></div>'+
   '<div class="search-recent-items">'+old.map(function(v){return '<button class="chip" data-recent-search="'+esc(v)+'">⌕ '+esc(v)+'</button>'}).join('')+'</div>':'';
  var clear=document.getElementById('search-clear');if(clear)clear.onclick=function(){
   S.recentSearches=[];profileSave('recentSearches',S.recentSearches);renderRecent()
  };
  var buttons=target.querySelectorAll('[data-recent-search]');
  for(var i=0;i<buttons.length;i++)buttons[i].onclick=function(){
   var q=this.getAttribute('data-recent-search'),input=document.getElementById('search-input');
   input.value=q;input.focus();var token=++S.searchToken;searchNow(q,token)
  }
 }
 function setSearchKind(kind){
  if(['all','live','movie','series'].indexOf(kind)<0)return;
  S.searchKind=kind;
  var filters=document.querySelectorAll('[data-search-kind]');
  for(var i=0;i<filters.length;i++){
   filters[i].className='chip'+(filters[i].getAttribute('data-search-kind')===kind?' primary':'')
  }
  var q=document.getElementById('search-input').value.trim(),token=++S.searchToken;
  if(q.length>=2)searchNow(q,token)
 }
 var filters=document.querySelectorAll('[data-search-kind]');
 for(var i=0;i<filters.length;i++)filters[i].onclick=function(){setSearchKind(this.getAttribute('data-search-kind'))};
 function commitSearch(){
  var q=document.getElementById('search-input').value.trim().slice(0,75);
  if(q.length<2)return;
  S.recentSearches=[q].concat(S.recentSearches.filter(function(v){return v!==q})).slice(0,8);
  profileSave('recentSearches',S.recentSearches);
  renderRecent();
  var token=++S.searchToken;searchNow(q,token)
 }
 document.getElementById('search-submit').onclick=commitSearch;
 document.getElementById('search-input').onkeydown=function(e){
  if((e.keyCode||e.which)===13){e.preventDefault();commitSearch()}
 };
 setSearchKind(S.searchKind);
 renderRecent();
 document.getElementById('search-input').oninput=function(e){if(e&&e.isComposing)return;var q=this.value.trim().slice(0,75);cancelSearch();
 if(q.length<2){cancelSearch();document.getElementById('search-result').innerHTML='';document.getElementById('search-status').textContent='اكتب حرفين على الأقل';return}
 var token=++S.searchToken;document.getElementById('search-status').textContent='جار البحث في المكتبة…';
 S.searchTimer=setTimeout(function(){S.searchTimer=null;searchNow(q,token)},400)
 };
 document.getElementById('search-input').focus();
 if(S.aiSearchTitle){
  var text=S.aiSearchTitle;S.aiSearchTitle=null;
  var input=document.getElementById('search-input');input.value=text;
  if(text.length>=2){var token=++S.searchToken;searchNow(text,token)}
 }
}
function searchNow(q,token){
 if(token!==S.searchToken||S.route!=='search')return;
 var old=S.searchRequests||[];S.searchRequests=[];
 for(var j=0;j<old.length;j++)try{old[j].abort()}catch(e){}
 var kinds=S.searchKind==='all'?['live','movie','series']:[S.searchKind],
 responses={live:[],movie:[],series:[]},pending=kinds.length,failed=0,more={};
 // Keep only the current search results, not every result ever browsed.
 ['live','movie','series'].forEach(function(k){delete S.loaded[keyOf(k,'search')]});
 function draw(){
  if(token!==S.searchToken||S.route!=='search')return;
  var output=document.getElementById('search-result'),status=document.getElementById('search-status');
  if(!output||!status)return;
  var count=0,html=kinds.map(function(kind){
   var cards=responses[kind];count+=cards.length;
   return cards.map(function(item){return posterCard(item,kind)}).join('')+(more[kind]?'<button class="btn secondary search-more" data-search-more="'+kind+'">المزيد من '+(kind==='movie'?'الأفلام':kind==='series'?'المسلسلات':'القنوات')+'</button>':'')
  }).join('');
  output.innerHTML=html||(pending===0?'<div class="empty-state">'+(failed?'تعذر البحث في بعض الأقسام، حاول مرة أخرى.':'لم يتم العثور على نتائج لهذا البحث.')+'</div>':'');
  var buttons=output.querySelectorAll?output.querySelectorAll('[data-search-more]'):[];
  for(var i=0;i<buttons.length;i++)buttons[i].onclick=function(){var k=this.getAttribute('data-search-more'),offset=more[k];if(!offset)return;delete more[k];pending++;draw();load(k,offset)};
  status.textContent=(count?'تم العثور على '+count+' نتيجة':pending?'جار البحث':failed?'تعذر البحث':'لا توجد نتائج')+(pending?' • استكمال باقي المكتبة…':failed&&count?' • تعذر البحث في بعض الأقسام':'')
 }
 function score(item){
  var query=aiTitleKey(q),words=query.split(' '),names=[item.name,item.title,item.original_name,item.original_title,item.name_ar,item.name_en,item.title_ar,item.title_en].map(aiTitleKey),best=0;
  names.forEach(function(name){if(name===query)best=Math.max(best,1000);else if(name.indexOf(query+' ')===0)best=Math.max(best,800);else if((' '+name+' ').indexOf(' '+query+' ')>=0)best=Math.max(best,650);else if(name.indexOf(query)>=0)best=Math.max(best,500);else if(words.every(function(w){return name.indexOf(w)>=0}))best=Math.max(best,300)});
  return best
 }
 function load(k,offset){
  var xhr=pageRequest(k,'all',offset,48,function(st,p){
   if(token!==S.searchToken||S.route!=='search')return;
   pending--;
   if(st===200&&p){
    responses[k]=responses[k].concat(p.items.slice(0,48)).sort(function(a,b){return score(b)-score(a)});
    if(p.hasMore&&Number(p.nextOffset)>offset&&responses[k].length<192)more[k]=Number(p.nextOffset);
    S.loaded[keyOf(k,'search')]={items:responses[k]};
   }else failed++;
   draw()
  },q);
  if(xhr)S.searchRequests.push(xhr)
 }
 for(var i=0;i<kinds.length;i++)load(kinds[i],0)
}
function aiTitleKey(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g,'').replace(/[إأآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')}
function verifyAiTitles(names,token,done){
 var tasks=[],matches=[],seen={},cursor=0,epoch=S.accountEpoch;
 (names||[]).filter(function(x){return typeof x==='string'&&x.trim().length>=2}).slice(0,4).forEach(function(name){['movie','series'].forEach(function(kind){tasks.push({name:name,kind:kind})})});
 function step(){
  if(token!==S.aiToken||epoch!==S.accountEpoch)return;
  if(cursor>=tasks.length){done(matches);return}
  var job=tasks[cursor++],wanted=aiTitleKey(job.name);
  pageRequest(job.kind,'all',0,24,function(st,p){
   if(token!==S.aiToken||epoch!==S.accountEpoch)return;
   if(st===200&&p){
    var match=p.items.find(function(item){return [item.name,item.title,item.original_name,item.original_title,item.name_ar,item.name_en].some(function(n){var k=aiTitleKey(n);return k===wanted||k.replace(/ (?:19|20)\d{2}$/,'')===wanted})});
    if(match){var id=itemId(match,job.kind),key=job.kind+':'+id;if(id&&!seen[key]){seen[key]=true;var cache=S.loaded[keyOf(job.kind,'ai')]||(S.loaded[keyOf(job.kind,'ai')]={items:[]});cache.items.push(match);if(cache.items.length>48)cache.items.shift();matches.push({kind:job.kind,id:id,name:title(match)})}}
   }
   step()
  },job.name)
 }
 step()
}
function aiScreen(){
 S.route='ai';
 shell('مساعد BLOFY الذكي','<section class="ai-chat-screen" aria-label="محادثة مساعد BLOFY">'+
  '<div class="ai-note">اسأل عن أي موضوع أو اطلب ترشيحات أو مساعدة في BLOFY. تُرسل رسائلك الأخيرة إلى خدمة الذكاء الاصطناعي؛ لا تكتب أكواد الاشتراك أو كلمات المرور.</div>'+
  '<div class="ai-thread" id="ai-thread" role="log" aria-live="polite"></div>'+
  '<div class="ai-prompts" id="ai-prompts"><button class="chip" data-ai-prompt="اقترح أفلام أكشن">أفلام أكشن</button>'+
  '<button class="chip" data-ai-prompt="رشح لي مسلسل كوميدي">مسلسلات كوميدية</button>'+
  '<button class="chip" data-ai-prompt="اقترح فيلم رعب جديد">أفلام رعب جديدة</button></div>'+
  '<div class="ai-compose"><textarea class="input" id="ai-text" maxlength="1600" rows="2" placeholder="اكتب سؤالك…" autocomplete="off"></textarea>'+
  '<button class="btn" id="ai-send">إرسال</button></div><button class="btn secondary" id="ai-new">محادثة جديدة</button>'+
  '<p class="muted small">الذكاء الاصطناعي قد يخطئ. الترشيحات المتاحة تُتحقق من مكتبتك قبل عرضها.</p></section>');
 function render(){
  if(S.route!=='ai')return;
  var box=document.getElementById('ai-thread');if(!box)return;
  var turns=S.aiTurns.slice(-16);
  box.innerHTML=turns.map(function(turn){
   var suggestions=(turn.suggestions||[]).map(function(t){
    return '<button class="chip ai-result" data-ai-result="'+esc(t.kind+':'+t.id)+'">▶ '+esc(t.name)+'</button>'
   }).join('');
   return '<div class="ai-bubble '+(turn.user?'mine':'assistant')+'"><strong>'+(turn.user?'أنت':'BLOFY AI')+'</strong>'+
    '<p>'+esc(turn.text)+'</p>'+(suggestions?'<div class="ai-links">'+suggestions+'</div>':'')+'</div>'
  }).join('')+(S.aiBusy?'<div class="ai-bubble assistant"><strong>BLOFY AI</strong><p>جار تحليل طلبك…</p></div>':'');
  var send=document.getElementById('ai-send');if(send){send.disabled=S.aiBusy;send.textContent=S.aiBusy?'جار الرد…':'إرسال'}
  box.scrollTop=box.scrollHeight
 }
 if(!S.aiTurns.length)S.aiTurns.push({user:false,text:'أهلًا! اسألني عن الأفلام والمسلسلات أو أي سؤال آخر. كيف أقدر أساعدك؟'});
 render();
 function ask(text){
  var query=String(text||'').trim().slice(0,1600);
  if(!query||S.aiBusy)return;
  S.aiBusy=true;var token=++S.aiToken;
  S.aiTurns.push({user:true,text:query});
  document.getElementById('ai-text').value='';
  render();
  var messages=S.aiTurns.filter(function(turn){return turn.user||turn.model===true}).slice(-9).map(function(turn){return {role:turn.user?'user':'assistant',content:String(turn.text||'').slice(0,1600)}});
  api('POST','/api/ai/chat',{messages:messages,locale:document.documentElement.lang==='en'?'en':'ar'},function(st,data){
   if(token!==S.aiToken)return;
   if(st===200&&data&&data.ok){
    var suggestions=Array.isArray(data.suggestedTitles)?data.suggestedTitles.slice(0,10):[];
    if(data.title&&suggestions.indexOf(data.title)<0)suggestions.unshift(data.title);
    var answer=String(data.reply||'لم يصل رد كامل، حاول مرة أخرى.').slice(0,3000);
    verifyAiTitles(suggestions,token,function(matches){
     if(token!==S.aiToken)return;
     S.aiBusy=false;
     var recommendation=/رشح|ترشيح|اقترح|تنصح|recommend|suggest/i.test(query);
     var verifiedText=suggestions.length?(matches.length?'هذه العناوين التي تحققت من وجودها في مكتبتك:':'لم أجد تطابقًا مؤكدًا لهذه الترشيحات في مكتبتك. جرّب طلب نوع آخر أو اسم محدد.'):(recommendation?'لم أجد ترشيحات مؤكدة في مكتبتك لهذا الطلب. جرّب تحديد النوع أو اسم ممثل.':answer);
     S.aiTurns.push({user:false,model:true,text:verifiedText,suggestions:matches});
     if(S.aiTurns.length>18)S.aiTurns=S.aiTurns.slice(-18);render()
    });return
   }else{
    S.aiBusy=false;
    var message=st===429?'تم الوصول إلى حد الطلبات مؤقتًا. جرب بعد قليل.':
     st===401||st===403?'انتهت جلسة الاشتراك. افتح الإعدادات وتحقق من التفعيل.':
     'خدمة المساعد غير متاحة حاليًا. يمكنك استخدام البحث المباشر من القائمة.';
    S.aiTurns.push({user:false,text:message})
   }
   if(S.aiTurns.length>18)S.aiTurns=S.aiTurns.slice(-18);
   render()
  })
 }
 document.getElementById('ai-send').onclick=function(){ask(document.getElementById('ai-text').value)};
 document.getElementById('ai-text').onkeydown=function(e){if((e.keyCode||e.which)===13&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask(this.value)}};
 document.getElementById('ai-new').onclick=function(){S.aiToken++;S.aiBusy=false;S.aiTurns=[];aiScreen()};
 document.getElementById('ai-prompts').onclick=function(e){
  var t=e.target.getAttribute('data-ai-prompt');if(t)ask(t)
 };
 document.getElementById('ai-thread').onclick=function(e){
  var node=e.target;
  while(node&&node!==this&&!node.getAttribute('data-ai-result'))node=node.parentNode;
  if(node&&node!==this){var key=node.getAttribute('data-ai-result'),split=key.indexOf(':'),kind=key.slice(0,split),id=key.slice(split+1);if(findItem(kind,id))navigate('detail',{kind:kind,id:id})}
 };
}
function resetCatalogRefresh(){
 S.refreshing=false;S.catalogVersion=null;S.lastCatalogCheck=0;
 S.catalogVersionPending=null;S.catalogVersionChecking=false;
}
function refreshCatalog(manual,version){
 if(S.refreshing||!S.userVerified)return;
 S.refreshing=true;
 var epoch=S.accountEpoch,kinds=['live','movie','series'],errors=[],done=0;
 var button=document.getElementById('refresh-content');
 if(button)button.disabled=true;
 function current(){return epoch===S.accountEpoch}
 function notify(message){
  if(!current())return;
  var box=document.getElementById('refresh-progress');
  if(box)box.textContent=message
 }
 notify('جار تحديث المحتوى • 0٪');
 function finish(){
  if(!current())return;
  S.refreshing=false;if(button)button.disabled=false;
  if(manual&&S.route==='home'&&button&&button.isConnected){rememberView();home()}
  if(!errors.length){
   if(version)S.catalogVersion=version;
   if(S.catalogVersionPending===version)S.catalogVersionPending=null;
   notify('✓ اكتمل تحديث القنوات والأفلام والمسلسلات — 100٪');
  }else{
   // A partially failed refresh must not acknowledge a new revision.
   // Recheck on the next scheduled poll, while keeping the last good lists.
   notify('تم تحديث '+(3-errors.length)+' من 3 أقسام. تعذر: '+errors.join('، ')+' — حاول مرة أخرى')
  }
 }
 function next(){
  if(!current())return;
  if(done===kinds.length){finish();return}
  var kind=kinds[done],label=kindName(kind);
  notify('جار تحديث '+label+' • '+Math.round(done/3*100)+'٪');
  pageRequest(kind,'all',0,36,function(st,result){
   if(!current())return;
   if(st===200&&result){
    S.loaded[keyOf(kind,'all')]=result;
    var keys=Object.keys(S.loaded);
    for(var i=0;i<keys.length;i++)if(keys[i].indexOf(kind+':')===0&&keys[i]!==kind+':all')delete S.loaded[keys[i]];
    delete S.cats[kind];
    // Do not clear unrelated in-flight callbacks; their callers still need completion.
   }else errors.push(label);
   done++;next()
  },null,true)
 }
 next()
}
function checkCatalogVersion(){
 if(!S.userVerified||S.refreshing||S.catalogVersionChecking||S.route==='player'||document.hidden)return;
 var now=Date.now();if(now-S.lastCatalogCheck<10*60*1000)return;S.lastCatalogCheck=now;
 var epoch=S.accountEpoch;
 S.catalogVersionChecking=true;
 api('GET','/api/catalog?action=get_blofy_catalog_version',null,function(st,v){
  if(epoch!==S.accountEpoch)return;
  S.catalogVersionChecking=false;
  if(st!==200||!v)return;
  var raw=v.version||v.epoch||v.catalogVersion||v.revision||v.lastModified;
  if(!raw||typeof raw!=='string'&&typeof raw!=='number')return;
  var version=String(raw);
  if(!S.catalogVersion){S.catalogVersion=version;return}
  if(S.catalogVersion!==version){
   S.catalogVersionPending=version;
   // A playback session may have started while the version request was pending.
   if(S.route!=='player'&&!document.hidden&&!S.refreshing)refreshCatalog(false,version)
  }else S.catalogVersionPending=null
 })
}
function pictureFitMode(value){return value==='zoom'?'cover':value==='fill'?'fill':'contain'}
function settingsScreen(){
 shell('الإعدادات','<div class="customer-settings">'+
 '<section class="customer-setting-group"><h3>اشتراكي والمكتبة</h3><button class="customer-setting-row" id="subscription-status">اشتراكي <span>‹</span></button><p id="subscription-feedback" class="customer-setting-feedback" role="status" aria-live="polite"></p><button class="customer-setting-row" id="refresh-content">تحديث المحتوى <span>↻</span></button><p id="refresh-progress" class="customer-setting-feedback" role="status" aria-live="polite"></p></section>'+
 '<section class="customer-setting-group"><h3>المشاهدة</h3><button class="customer-setting-row" id="picture-fit">حجم الصورة <span id="picture-fit-label"></span></button><button class="customer-setting-row" id="auto-next-episode">تشغيل الحلقة التالية تلقائيًا <span id="auto-next-label"></span></button></section>'+
 '<section class="customer-setting-group"><h3>التطبيق</h3><button class="customer-setting-row" id="install-blofy-web">طريقة إضافة BLOFY</button><p id="install-blofy-help" class="customer-setting-feedback" role="status" aria-live="polite"></p></section>'+
 '<section class="customer-setting-group"><h3>الحساب</h3><button class="customer-setting-row" data-go="favorites">المفضلة <span>‹</span></button><button class="customer-setting-row" id="clear-watch-history">مسح سجل المشاهدة <span>‹</span></button><button class="customer-setting-row" id="switch-saved-login" hidden>تبديل الاشتراك <span>‹</span></button><button class="customer-setting-row customer-logout" id="logout">تسجيل الخروج <span>‹</span></button></section>'+
 '<p id="page-status" class="customer-setting-feedback" role="status" aria-live="polite"></p>'+
 '<p class="customer-version">BLOFY STREAM · 2026.11.28.56.0.3</p></div>');
 var switchButton=document.getElementById('switch-saved-login');
 api('GET','/api/login-modes',null,function(st,data){
  if(st!==200||!data||data.savedLogins!==true||!switchButton.isConnected)return;
  savedLoginEnabled=true;switchButton.hidden=false;
  document.getElementById('logout').innerHTML='تسجيل الخروج من جميع الاشتراكات <span>‹</span>';
 });
 switchButton.onclick=function(){
  if(accountSwitching)return;
  accountSwitching=true;switchButton.disabled=true;
  cleanupPlayer();var deadline=Date.now()+3500;
  function openSwitch(){
   if(pendingMediaStops>0&&Date.now()<deadline){setTimeout(openSwitch,100);return}
   accountSwitching=false;login('اختر اشتراكًا محفوظًا أو أضف اشتراكًا جديدًا. اشتراكك السابق يبقى محفوظًا.');
  }
  openSwitch()
 };
 document.getElementById('refresh-content').onclick=function(){refreshCatalog(true)};
 var fitButton=document.getElementById('picture-fit'),fitLabel=document.getElementById('picture-fit-label'),fitOptions=['fit','zoom','fill'],fitLabels=['ملاءمة','تكبير','ملء'];
 function updateFit(){var index=fitOptions.indexOf(readJson(profileStorageKey('pictureFit'),'fit'));fitLabel.textContent=fitLabels[Math.max(0,index)]}
 var autoNext=document.getElementById('auto-next-episode'),autoNextLabel=document.getElementById('auto-next-label');
 function updateAutoNext(){autoNextLabel.textContent=readJson(profileStorageKey('autoNextEpisode'),true)!==false?'مفعّل':'متوقف'}
 updateAutoNext();autoNext.onclick=function(){profileSave('autoNextEpisode',readJson(profileStorageKey('autoNextEpisode'),true)===false);updateAutoNext()};
 updateFit();fitButton.onclick=function(){var index=fitOptions.indexOf(readJson(profileStorageKey('pictureFit'),'fit'));profileSave('pictureFit',fitOptions[(Math.max(0,index)+1)%3]);updateFit()};
 document.getElementById('subscription-status').onclick=function(){
  var button=this,notice=document.getElementById('subscription-feedback'),epoch=S.accountEpoch;button.disabled=true;notice.textContent='جار التحقق…';
  api('GET','/api/session',null,function(st,data){
   if(S.accountEpoch!==epoch||S.route!=='settings'||!notice.isConnected)return;
   button.disabled=false;
   if(st===200&&data&&data.active===true&&data.profileKey===S.profileKey){
    var expiry=new Date(data.expiresAt),days=Number(data.daysRemaining);rememberOfflineGrant(S.profileKey,data.expiresAt);
    notice.textContent='الاشتراك نشط'+(data.daysRemaining!=null&&Number.isFinite(days)?' • '+Math.max(0,days)+' يوم متبقي':'')+(data.expiresAt&&!isNaN(expiry.getTime())?' • ينتهي '+expiry.toLocaleDateString('ar-SA'):'')
   }else if(st===401||st===403||st===200&&data&&data.active===false){clearOfflineGrant();notice.textContent='الاشتراك غير نشط. تحقق من التفعيل.'}
   else notice.textContent='تعذر التحقق مؤقتًا، لم يتم إلغاء اشتراكك.'
  })
 };
 document.getElementById('clear-watch-history').onclick=function(){
  var trigger=this,existing=document.getElementById('watch-clear-confirm');
  if(existing){existing.remove();trigger.focus();return}
  var panel=document.createElement('div');
  panel.id='watch-clear-confirm';panel.className='settings-inline-confirm';
  panel.innerHTML='<p>هل تريد حذف سجل المشاهدة والبحث من هذا الجهاز فقط؟ المفضلة والاشتراك لن يتأثرا.</p>'+
   '<button type="button" class="btn danger" id="watch-clear-accept">تأكيد الحذف</button> '+
   '<button type="button" class="btn secondary" id="watch-clear-cancel">إلغاء</button>';
  trigger.parentNode.appendChild(panel);
  panel.querySelector('#watch-clear-accept').onclick=function(){
   S.watch={};S.recentSearches=[];
   profileSave('watch',S.watch);profileSave('recentSearches',S.recentSearches);
   panel.remove();setStatus('تم حذف سجل المشاهدة والبحث المحلي؛ المفضلة محفوظة.');
   trigger.focus()
  };
  panel.querySelector('#watch-clear-cancel').onclick=function(){panel.remove();trigger.focus()};
  panel.querySelector('#watch-clear-cancel').focus()
 };
 var installButton=document.getElementById('install-blofy-web');
 if(installButton){
  updateInstallGuide();
  installButton.onclick=function(){
   var guide=webAppInstallGuide(navigator.userAgent,installedWebApp(),!!pendingInstallPrompt,navigator.maxTouchPoints);
   if(guide.mode!=='prompt'||!pendingInstallPrompt){updateInstallGuide();return}
   var request=pendingInstallPrompt;pendingInstallPrompt=null;
   var feedback=document.getElementById('install-blofy-help');
   try{
    request.prompt();
    if(feedback)feedback.textContent='تم فتح نافذة التثبيت الخاصة بالمتصفح. يمكنك الموافقة أو الإلغاء.';
    if(request.userChoice&&typeof request.userChoice.then==='function')
     request.userChoice.then(function(result){
      if(feedback&&feedback.isConnected)
       feedback.textContent=result&&result.outcome==='accepted'?
        'تم قبول طلب التثبيت من المتصفح.':'لم يتم تثبيت التطبيق؛ يمكنك استخدام الموقع مباشرة.';
      updateInstallGuide()
     });
   }catch(e){if(feedback)feedback.textContent='لم يتمكن المتصفح من فتح التثبيت؛ استخدم قائمة المتصفح.'}
  }
 }
 document.getElementById('logout').onclick=function(){
  if(S.loggingOut)return;
  S.loggingOut=true;clearOfflineGrant();
  var button=document.getElementById('logout');if(button)button.disabled=true;
  // Close the video while the authenticated cookie is still valid. In-flight
  // stop requests otherwise arrive after logout and get a 401, leaking a
  // precious FFmpeg slot until the worker idle timeout.
  cleanupPlayer();
  var deadline=Date.now()+3500;
  function finishLogout(){
   if(pendingMediaStops>0&&Date.now()<deadline){setTimeout(finishLogout,100);return}
   api('POST','/api/logout',{},function(st){S.loggingOut=false;if(savedLoginEnabled){if(st===200){reloadSavedLogin();return}if(button)button.disabled=false;setStatus('تعذر تسجيل الخروج، حاول مرة أخرى.',true);return}login('تم تسجيل الخروج')})
  }
  finishLogout()
 }
}
function fmt(n){return n<10?'0'+n:String(n)}
function formatTime(seconds){seconds=Math.max(0,Math.floor(Number(seconds)||0));return fmt(Math.floor(seconds/3600))+':'+fmt(Math.floor(seconds/60)%60)+':'+fmt(seconds%60)}

function diagnose(kind,phase,mode,code){
 if(!S.userVerified)return;
 var p=S.playerView;
 var actualMode=p&&p.kind===kind?p.mode:mode||'direct';
 if(['direct','audio','video','fullvod','vodhls','hls','mpegts'].indexOf(actualMode)<0)actualMode=mode||'video';
 var itemId=p&&p.kind===kind?p.id:kind==='live'?S.selected:'';
 var video=p&&p.kind===kind?p.video:null;
 var position=p&&p.kind===kind?(p.mode==='vodhls'?p.offset:0)+Number(video&&video.currentTime||0):0;
 var payload={kind:kind==='live'?'live':kind==='series'?'series':'movie',
  mode:actualMode,phase:phase,errorCode:Math.max(0,Math.min(9,Number(code)||0)),
  itemId:String(itemId||''),position:Math.max(0,Math.round(position)),
  duration:Math.max(0,Math.round(Number(p&&p.duration)||0))};
 api('POST','/api/player-diagnostic',payload,function(){})
}

function shouldUseNativeHls(video){
 if(S.preferMseHls&&window.MediaSource&&window.MediaSource.isTypeSupported)return false;
 if(!video||!video.canPlayType||!video.canPlayType('application/vnd.apple.mpegurl'))return false;
 // Chrome and Edge sometimes report "maybe" here yet fail to decode MPEG-TS
 // with MEDIA_ERR_SRC_NOT_SUPPORTED (4). Use Hls.js/MSE on these browsers.
 var ua=(navigator.userAgent||'');
 var apple=/Safari/i.test(ua)&&!/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua);
 var tv=/VIDAA|Hisense|Toshiba|SRAF\//i.test(ua);
 var mse=!!(window.MediaSource&&window.MediaSource.isTypeSupported);
 return apple||tv||!mse
}

function loadHls(done){
 if(window.Hls){done(true);return}
 if(S.hlsState==='loading'){S.hlsCallbacks.push(done);return}
 // A transient failed JS request must not permanently disable HLS after
 // Wi-Fi recovers. Keep retries bounded: one script request per user attempt.
 S.hlsState='loading';S.hlsCallbacks=[done];
 var script=document.createElement('script'),settled=false;
 script.src='/vendor/hls.min.js';
 function finish(ok){
  if(settled)return;settled=true;clearTimeout(timer);
  S.hlsState=ok?'ready':'error';
  var callbacks=S.hlsCallbacks||[];S.hlsCallbacks=[];
  for(var i=0;i<callbacks.length;i++)callbacks[i](ok)
  if(!ok){script.onload=null;script.onerror=null;if(script.parentNode)script.parentNode.removeChild(script)}
 }
 var timer=setTimeout(function(){finish(!!window.Hls)},16000);
 script.onload=function(){finish(!!window.Hls)};
 script.onerror=function(){finish(false)};
 document.head.appendChild(script)
}
/* Reduce first-video startup latency on modern desktop browsers. The HLS
 * library is first-party, and it is downloaded ONLY after a verified session.
 * Never eagerly load it on resource-constrained TV/VIDAA browsers.
 * Delayed callbacks carry an account epoch and cannot cross logout.
 */
function warmDesktopHlsAfterAuth(){
 if(!S.userVerified||document.hidden||!window.MediaSource||
    S.hlsState==='ready'||S.hlsState==='loading')return;
 var ua=String(navigator.userAgent||'');
 if(!/Chrome|Chromium|Edg|Firefox|OPR/i.test(ua)||
    /VIDAA|Hisense|SRAF\/|SmartTV|Tizen|WebOS|Web0S|Android|iPhone|iPad/i.test(ua))return;
 var account=S.accountEpoch;
 var prepare=function(){
  if(!S.userVerified||account!==S.accountEpoch||document.hidden||
     S.route==='player'||S.route==='live')return;
  loadHls(function(){})
 };
 if(typeof window.requestIdleCallback==='function'){
  window.requestIdleCallback(prepare,{timeout:7500})
 }else setTimeout(prepare,3000)
}
function loadMpegts(done){
 if(window.mpegts){done(true);return}
 if(S.mpegtsState==='loading'){S.mpegtsCallbacks.push(done);return}
 S.mpegtsState='loading';S.mpegtsCallbacks=[done];
 var script=document.createElement('script'),settled=false;
 script.src='/vendor/mpegts.js';script.async=true;
 function finish(ok){
  if(settled)return;
  settled=true;clearTimeout(timer);S.mpegtsState=ok?'ready':'error';
  var callbacks=S.mpegtsCallbacks||[];S.mpegtsCallbacks=[];
  if(!ok){script.onload=null;script.onerror=null;if(script.parentNode)script.parentNode.removeChild(script)}
  for(var i=0;i<callbacks.length;i++)callbacks[i](ok)
 }
 var timer=setTimeout(function(){finish(!!window.mpegts)},14000);
 script.onload=function(){finish(!!window.mpegts)};
 script.onerror=function(){finish(false)};
 document.head.appendChild(script)
}
function stopPlayback(sendStop){
 if(!S.play)return;var old=S.play;S.play=null;
 if(old.preview)S.livePreview=null;
 try{
  if(old.timer)clearTimeout(old.timer);
  if(old.stallTimer)clearTimeout(old.stallTimer);
  if(old.quietWaitTimer)clearTimeout(old.quietWaitTimer);
  if(old.progressWatchdog)clearInterval(old.progressWatchdog);
  // Cancel the per-frame observer before switching media nodes, or a delayed
  // callback from an old channel may be mistaken for recovery of the new one.
  if(old.presentedFrameId!==null&&old.presentedFrameId!==undefined&&old.video&&typeof old.video.cancelVideoFrameCallback==='function'){
   try{old.video.cancelVideoFrameCallback(old.presentedFrameId)}catch(err){}
   old.presentedFrameId=null
  }
  if(old.startupTimer)clearTimeout(old.startupTimer);
  if(old.retryTimer)clearTimeout(old.retryTimer);
  if(old.capacityTimer)clearTimeout(old.capacityTimer);
  if(old.originTimer)clearTimeout(old.originTimer);
  if(old.stableTimer)clearTimeout(old.stableTimer);
  if(old.qualityListener&&old.video){old.video.removeEventListener('loadedmetadata',old.qualityListener);old.video.removeEventListener('resize',old.qualityListener)}
 }catch(e){}
 if(old.engine){try{old.engine.destroy()}catch(e){}}
 try{if(old.video){old.video.pause();old.video.removeAttribute('src');old.video.load()}}catch(e){}
 if(sendStop!==false&&(old.hlsKey||old.stopUrl))api('POST',old.stopUrl||'/api/hls/'+old.hlsKey+'/stop',{},function(){})
}
function releaseDetachedPlayerVideo(player,transport){
 var video=player&&player.video;
 if(!video||transport&&transport.video===video)return;
 // Direct MP4 has no S.play record. Removing its DOM node alone does not
 // guarantee decoding/audio stops, especially when advancing to another title.
 video.onplaying=video.onwaiting=video.onstalled=video.onerror=video.onloadedmetadata=video.onended=null;
 try{video.muted=true;video.pause();video.removeAttribute('src');video.load()}catch(e){}
}
function cleanupPlayer(){
 if(S.playerView){
  S.playerView.liveHlsHandoff=null;
  clearVodBufferNotice(S.playerView);
  if(S.playerView.disposeCommentary)S.playerView.disposeCommentary();
  if(S.playerView.nextEpisodeTimer)clearTimeout(S.playerView.nextEpisodeTimer);
  if(S.playerView.disposeSubtitles)S.playerView.disposeSubtitles();
  if(S.playerView.stopLongTest)S.playerView.stopLongTest();
  if(S.playerView.directTimer){clearTimeout(S.playerView.directTimer);S.playerView.directTimer=null}
  if(S.playerView.directSeekCheck){clearTimeout(S.playerView.directSeekCheck);S.playerView.directSeekCheck=null}
  if(S.playerView.directSeekVerify){clearTimeout(S.playerView.directSeekVerify);S.playerView.directSeekVerify=null}
  if(S.playerView.directStartupTimer){clearTimeout(S.playerView.directStartupTimer);S.playerView.directStartupTimer=null}
  if(S.playerView.liveEpgTimer){clearTimeout(S.playerView.liveEpgTimer);S.playerView.liveEpgTimer=null}
  if(S.playerView.channelSwitchTimer){clearTimeout(S.playerView.channelSwitchTimer);S.playerView.channelSwitchTimer=null}
  if(S.playerView.seekWatchdog){clearTimeout(S.playerView.seekWatchdog);S.playerView.seekWatchdog=null}
  if(S.playerView.seekLogTimer){clearTimeout(S.playerView.seekLogTimer);S.playerView.seekLogTimer=null}
  if(S.playerView.seekFrameId!==null&&S.playerView.seekFrameId!==undefined&&
   S.playerView.video&&typeof S.playerView.video.cancelVideoFrameCallback==='function'){
   try{S.playerView.video.cancelVideoFrameCallback(S.playerView.seekFrameId)}catch(e){}
   S.playerView.seekFrameId=null
  }
  if(S.playerView.seekDebounce){clearTimeout(S.playerView.seekDebounce);S.playerView.seekDebounce=null}
  if(S.playerView.healthTimer){clearInterval(S.playerView.healthTimer);S.playerView.healthTimer=null}
  if(S.playerView.firstPictureWatchTimer){clearInterval(S.playerView.firstPictureWatchTimer);S.playerView.firstPictureWatchTimer=null}
  if(S.playerView.firstPictureFrameId!==null&&S.playerView.firstPictureFrameId!==undefined&&
     S.playerView.video&&typeof S.playerView.video.cancelVideoFrameCallback==='function'){
   try{S.playerView.video.cancelVideoFrameCallback(S.playerView.firstPictureFrameId)}catch(e){}
   S.playerView.firstPictureFrameId=null
  }
  S.playerView.pendingSeek=null;
  if(S.playerView.hudTimer){clearTimeout(S.playerView.hudTimer);S.playerView.hudTimer=null}
  if(S.playerView.releaseWakeLock)S.playerView.releaseWakeLock()
  if(S.playerView.cleanupFullscreen)S.playerView.cleanupFullscreen();
  releaseDetachedPlayerVideo(S.playerView,S.play)
 }
 stopPlayback(true)
}
// Audio time is independent of video time. Only move within an actual
// seekable audio range; never promise automatic synchronization.
function commentarySeekTarget(audio,delta){
 if(delta!==1&&delta!==-1||!audio||audio.paused||audio.seeking)return null;
 var at=Number(audio.currentTime),ranges=audio.seekable;
 if(!Number.isFinite(at)||at<0||!ranges)return null;
 try{
  for(var i=0;i<Math.min(ranges.length,32);i++){
   var start=ranges.start(i),end=ranges.end(i),target=at+delta;
   if(Number.isFinite(start)&&Number.isFinite(end)&&at>=start&&at<=end&&target>=start&&target<=end-0.1)return target
  }
 }catch(e){}
 return null
}
// Local HLS buffer only. This does not advertise server-side DVR or
// TimeShift: the source may remove old segments at any moment.
function bufferedLiveRange(video,record){
 if(!video||!record||!record.hlsKey||record.preview||record.reconnecting||!record.ready||video.seeking||video.ended||video.readyState<2)return null;
 var at=Number(video.currentTime),seekable=video.seekable,buffered=video.buffered;
 if(!Number.isFinite(at)||!seekable||!buffered)return null;
 try{
  for(var i=0;i<Math.min(seekable.length,32);i++){
   var ss=seekable.start(i),se=seekable.end(i);
   if(at<ss||at>se)continue;
   for(var j=0;j<Math.min(buffered.length,32);j++){
    var start=Math.max(ss,buffered.start(j)),end=Math.min(se,buffered.end(j));
    if(!Number.isFinite(start)||!Number.isFinite(end)||at<start||at>end||end-start<3)continue;
    return {start:start,end:end,at:at,behind:Math.max(0,Math.floor(at-start-0.1)),ahead:Math.max(0,Math.floor(end-at-0.75))}
   }
  }
 }catch(e){}
 return null
}
function bufferedLiveSeekTarget(video,record,action){
 var range=bufferedLiveRange(video,record);if(!range)return null;
 var start=range.start,end=range.end,at=range.at;
 var target=action==='back'?at-5:action==='forward'?at+5:action==='back-one'?at-1:action==='forward-one'?at+1:action==='back-ten'?at-10:action==='forward-ten'?at+10:action==='earliest'?start+0.25:action==='latest'?end-0.75:NaN;
 if(action==='forward'||action==='forward-ten')target=Math.min(target,end-0.75);
 if(Number.isFinite(target)&&target>=start+0.1&&target<=end-0.5&&Math.abs(target-at)>=0.5)return target;
 return null
}
// TimeShift can request retained server segments outside the local decoded buffer.
function liveTimeshiftRange(video,record){
 if(!video||!record||!record.hlsKey||record.preview||record.reconnecting||!record.ready||video.seeking||video.ended||video.readyState<2)return null;
 var at=Number(video.currentTime),ranges=video.seekable,engine=record.engine,details=engine&&engine.latestLevelDetails;
 if(!Number.isFinite(at)||!ranges)return null;
 try{
  for(var i=0;i<Math.min(ranges.length,32);i++){
   var start=Number(ranges.start(i)),end=Number(ranges.end(i));
   if(details&&details.live&&Number.isFinite(details.fragmentStart)&&Number.isFinite(details.edge)){
    start=Math.max(start,details.fragmentStart);end=Math.min(end,details.edge)
   }
   if(!Number.isFinite(start)||!Number.isFinite(end)||at<start||at>end||end-start<3)continue;
   return {start:start,end:end,at:at,behind:Math.max(0,Math.floor(at-start-0.1)),ahead:Math.max(0,Math.floor(end-at-0.75))}
  }
 }catch(e){}
 return null
}
function liveTimeshiftTarget(video,record,action){
 var range=liveTimeshiftRange(video,record);if(!range)return null;
 var step={'back-one':-1,back:-5,'back-ten':-10,'back-thirty':-30,'forward-one':1,forward:5,'forward-ten':10,'forward-thirty':30};
 var edge=Number(record.engine&&record.engine.liveSyncPosition);
 var target=action==='earliest'?range.start+0.25:action==='latest'?Math.max(range.start+0.1,Math.min(range.end-0.75,Number.isFinite(edge)&&edge>0?edge:range.end-0.75)):range.at+step[action];
 if(!Number.isFinite(target))return null;
 target=Math.max(range.start+0.1,Math.min(range.end-0.75,target));
 return Math.abs(target-range.at)>=0.5?target:null
}
function subtitleTrackLabel(label,language,index){
 var code=String(language||'').toLowerCase().split(/[-_]/)[0],names={ar:'العربية',ara:'العربية',en:'الإنجليزية',eng:'الإنجليزية',fr:'الفرنسية',fra:'الفرنسية',fre:'الفرنسية',es:'الإسبانية',spa:'الإسبانية',fa:'الفارسية',fas:'الفارسية',per:'الفارسية',tr:'التركية',tur:'التركية',de:'الألمانية',deu:'الألمانية',ger:'الألمانية',hi:'الهندية',hin:'الهندية',ur:'الأردية',urd:'الأردية',ru:'الروسية',rus:'الروسية'};
 var name=String(label||'').trim(),localized=names[code]||names[name.toLowerCase()]||'';
 return localized&&(!name||names[name.toLowerCase()]||name.toLowerCase()===code)?localized:localized?localized+' • '+name:name||String(language||'')||('ترجمة '+(index+1))
}
// Convert only bounded plain-text timed cues. No external resources or markup.
function localSubtitleVtt(raw){
 if(typeof raw!=='string'||raw.length>2*1024*1024)return null;
 var blocks=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim().split(/\n[ \t]*\n/),cues=[];
 function stamp(value){
  var m=/^(?:(\d{1,3}):)?([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(value);
  if(!m)return null;
  var h=Number(m[1]||0);return {ms:((h*60+Number(m[2]))*60+Number(m[3]))*1000+Number(m[4]),text:('00'+h).slice(-Math.max(2,String(h).length))+':'+m[2]+':'+m[3]+'.'+m[4]}
 }
 for(var i=0;i<blocks.length&&cues.length<20000;i++){
  var lines=blocks[i].split('\n'),timing=-1;
  if(/^WEBVTT(?:\s|$)|^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0]))continue;
  for(var j=0;j<Math.min(2,lines.length);j++)if(lines[j].indexOf('-->')>=0){timing=j;break}
  if(timing<0)continue;
  var match=/^(\S+)\s+-->\s+(\S+)(?:\s.*)?$/.exec(lines[timing].trim());if(!match)continue;
  var start=stamp(match[1]),end=stamp(match[2]);if(!start||!end||end.ms<=start.ms)continue;
  var body=lines.slice(timing+1).join('\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').trim();
  if(body)cues.push(start.text+' --> '+end.text+'\n'+body)
 }
 return cues.length?'WEBVTT\n\n'+cues.join('\n\n')+'\n':null
}
function simpleLiveStatus(message,error){
 if(error||!message)return message;
 // Collapse internal progress phases, never actionable errors or play prompts.
 if(/^جار |^انتهت جلسة المصدر؛ جار |^تغيّر تسلسل البث؛ جار |^مصدر البث مشغول أو غير متاح مؤقتًا؛ جار |^توقف مشغّل الفيديو دون طلب؛ جار |^تعليق في صورة البث؛ جار |^وصل الصوت أو توقيت البث لكن الصورة لم تظهر؛ جار /.test(message))return 'جار تشغيل القناة…';
 return message
}
// Keep normal rebuffering quiet; show a notice only for sustained waits.
function queueVodBufferNotice(video){
 var state=S.playerView,record=S.play,mode=state&&state.mode;
 if(!state||state.kind==='live'||state.video!==video||state.bufferNoticeTimer||video.paused)return;
 var at=Number(video.currentTime)||0;
 state.bufferNoticeTimer=setTimeout(function(){
  state.bufferNoticeTimer=null;
  if(S.route!=='player'||S.playerView!==state||S.play!==record||state.mode!==mode||
     video.paused||document.hidden||Math.abs((Number(video.currentTime)||0)-at)>0.15)return;
  var el=document.getElementById('player-status');
  if(el&&el.classList.contains('player-error'))return;
  playerStatus('جار التحميل…')
 },2500)
}
function clearVodBufferNotice(state){
 if(state.bufferNoticeTimer){clearTimeout(state.bufferNoticeTimer);state.bufferNoticeTimer=null}
 if(S.playerView!==state)return;
 var el=document.getElementById('player-status');
 if(el&&el.classList.contains('player-loading')&&el.textContent==='جار التحميل…')
  el.style.display='none'
}
function playerStatus(message,error){
 if(S.playerView&&S.playerView.kind==='live')message=simpleLiveStatus(message,error);
 var el=document.getElementById('player-status');
 if(el){el.style.display=message?'block':'none';el.textContent=message||'';el.className=error?'player-error':'player-loading'}
 var retry=document.getElementById('player-retry');
 if(retry)retry.style.display=error?'inline-flex':'none';
 if(error){
  // An error must always expose its recovery button, even if the cinematic
  // controls were hidden before the source stopped.
  var root=document.getElementById('player-root');
  if(root)root.classList.remove('controls-hidden');
  if(S.playerView&&S.playerView.hudTimer){
   clearTimeout(S.playerView.hudTimer);S.playerView.hudTimer=null
  }
 }
}
/* A VIDAA decoder can freeze while readyState still equals 4.
 * Decode/playhead progress is stronger evidence than buffered metadata. */
function livePlaybackProgress(record,video,now){
 var time=Number(video&&video.currentTime),frames=null;
 try{
  var q=video&&video.getVideoPlaybackQuality&&video.getVideoPlaybackQuality();
  if(q&&Number.isFinite(Number(q.totalVideoFrames)))frames=Number(q.totalVideoFrames)
 }catch(e){}
 var advancedTime=Number.isFinite(time)&&Number.isFinite(record.lastMediaTime)&&Math.abs(time-record.lastMediaTime)>0.15;
 var advancedFrames=frames!==null&&record.lastVideoFrames!==null&&record.lastVideoFrames!==undefined&&frames>record.lastVideoFrames;
 // A live audio clock may keep currentTime moving while the picture freezes.
 // If real decoded-frame counters are usable, trust them over audio time.
 // Browsers reporting 0 or unavailable frames retain the time-based fallback.
 // Some TV firmwares expose a non-changing frame counter. Only trust it
 // after seeing that this specific decoder has advanced it at least once.
 if(advancedFrames)record.frameCounterObserved=true;
 var frameCounterUsable=!!record.frameCounterObserved&&frames!==null&&frames>=5;
 var advancedPresented=!!record.framePresentationObserved&&Number(record.lastPresentedFrameAt)>Number(record.lastSampledPresentationAt||0);
 var pictureDimensions=Number(video&&video.videoWidth)>0&&Number(video&&video.videoHeight)>0;
 // A live stream may be audio-only even while currentTime and readyState
 // advance. Never report "visual progress" from that audio clock until
 // the decoder actually exposes a video image. A real presented-frame
 // callback is stronger evidence even on older TVs that omit dimensions.
 var visualProgress=record.framePresentationObserved?advancedPresented:
  pictureDimensions&&(frameCounterUsable?advancedFrames:(advancedTime||advancedFrames));
 // An unsampled interval (for example, a sleeping browser) cannot be
 // counted as observed playback downtime. Do not change the recovery
 // watchdog's lastProgressAt: a genuinely frozen decoder must still recover.
 if(record.visualProgressSeen&&record.lastVisualSampleAt&&now-record.lastVisualSampleAt>6000)
  record.visualOutageReported=true;
 record.lastVisualSampleAt=now;
 if(record.framePresentationObserved)record.lastSampledPresentationAt=record.lastPresentedFrameAt;
 if(Number.isFinite(time))record.lastMediaTime=time;
 if(frames!==null)record.lastVideoFrames=frames;
 if(visualProgress){
  // A recovered picture can close one measured outage.
  countVisualOutage(record,video,now);
  record.visualOutageReported=false;
  record.visualProgressSeen=true;
  record.lastProgressAt=now;record.bufferSince=0;record.stallChecks=0;
  return {advanced:true,idleMs:0}
 }
 return {advanced:false,idleMs:Math.max(0,now-(record.lastProgressAt||record.started||now))}
}
function countVisualOutage(record,video,now){
 // Record only gaps observed after actual picture, never during first play,
 // an intentional pause/seek, hidden tab, or a channel preview.
 if(!record.visualProgressSeen||record.visualOutageReported||!record.ready||
    typeof S==='undefined'||S.route!=='player'||!S.playerView||
    S.playerView.kind!=='live'||S.playerView.video!==video||
    S.playerView.userPaused||video.paused||video.seeking||
    typeof document!=='undefined'&&document.hidden)return false;
 var gap=Math.max(0,now-(record.lastProgressAt||now));
 if(gap<6500||!Number.isFinite(gap))return false;
 // Timers cannot certify a gap if the whole tab was asleep.
 if(record.lastVisualSampleAt&&now-record.lastVisualSampleAt>6000)return false;
 var stats=S.playerView.stats;
 if(!stats)return false;
 stats.visualOutageCount=(stats.visualOutageCount||0)+1;
 stats.visualOutageMs=(stats.visualOutageMs||0)+gap;
 stats.longestVisualOutageMs=Math.max(stats.longestVisualOutageMs||0,gap);
 // Per-engine counters remain aggregated only in this local player session;
 // never send URLs, credentials, channel IDs, or playback events to servers.
 var engineName=record.mode==='mpegts'?'mpegts':'hls';
 if(!stats.visualOutageByEngine)stats.visualOutageByEngine={hls:{count:0,ms:0},mpegts:{count:0,ms:0}};
 if(!stats.visualOutageByEngine[engineName])stats.visualOutageByEngine[engineName]={count:0,ms:0};
 var bucket=stats.visualOutageByEngine[engineName];
 bucket.count=(bucket.count||0)+1;bucket.ms=(bucket.ms||0)+gap;
 record.visualOutageReported=true;
 return true
}
/* Stop a silent ended/paused live decoder from requiring a full page reload.
 * Only act after the video was playing; honor explicit user Pause and a hidden
 * browser tab. On a TV the player can become paused after a fatal decoder error.
 */
function liveExpiredSegmentRecovery(record,engine,video,now){
 record.userTimeshift=false;if(engine&&engine.config)engine.config.liveMaxLatencyDurationCount=10;
 // HLS occasionally requests a sequence that has fallen off the live
 // playlist while the viewer catches up. Prefer an in-place live-edge
 // jump before tearing down a healthy source and FFmpeg decoder.
 if(now-(record.expiredSegmentWindowAt||0)>30000){
  record.expiredSegmentWindowAt=now;record.expiredSegmentRecoveries=0
 }
 if(now-(record.lastExpiredSegmentAt||0)<3500)return 'cooling';
 record.lastExpiredSegmentAt=now;
 record.expiredSegmentRecoveries=(record.expiredSegmentRecoveries||0)+1;
 if(record.expiredSegmentRecoveries>2)return 'restart';
 try{
  if(!engine||typeof engine.startLoad!=='function'||typeof engine.stopLoad!=='function')
   return 'restart';
  engine.stopLoad();
  var edge=Number(engine.liveSyncPosition);
  var current=Number(video.currentTime);
  if(video.readyState>=1&&Number.isFinite(edge)&&edge>0&&
     (!Number.isFinite(current)||edge-current>2)){
   video.currentTime=edge
  }
  engine.startLoad(-1);
  return 'resync'
 }catch(e){return 'restart'}
}
/* A viewer can fall far behind even while the audio/video clocks continue.
 * With MSE Hls.js (not the native TV HLS engine), return to a validated live
 * edge after sustained lag, without restarting its shared source/encoder.
 * The 90-second cool-down protects decoders and slower Wi-Fi connections.
 */
function liveLatencyCatchup(record,engine,video,now,userPaused,hidden){
 if(!engine||userPaused||hidden||video.paused||video.ended||video.seeking||
    record.reconnecting||Number(video.readyState)<2||record.userTimeshift===true||now<(record.localBufferSeekUntil||0)){
  record.liveLagSince=0;return false
 }
 var edge=Number(engine.liveSyncPosition),at=Number(video.currentTime);
 var gap=edge-at;
 if(!Number.isFinite(edge)||!Number.isFinite(at)||edge<=0||at<0||
    !Number.isFinite(gap)||gap<16||gap>180){
  record.liveLagSince=0;return false
 }
 var ranges=video.seekable;
 if(ranges&&ranges.length){
  try{
   var last=ranges.length-1,first=Number(ranges.start(last)),end=Number(ranges.end(last));
   if(!Number.isFinite(first)||!Number.isFinite(end)||edge<first||edge>end+1){
    record.liveLagSince=0;return false
   }
  }catch(e){record.liveLagSince=0;return false}
 }
 if(!record.liveLagSince){record.liveLagSince=now;return false}
 if(now-record.liveLagSince<8000)return false;
 if(record.lastLiveCatchupAt&&now-record.lastLiveCatchupAt<90000)return false;
 try{
  video.currentTime=edge;
  record.lastLiveCatchupAt=now;record.liveLagSince=0;
  return true
 }catch(e){record.liveLagSince=0;return false}
}
function liveTransientRetryMs(attempt){
 // Fatal HLS network errors must not spin at 0 ms. A bounded pause allows
 // a home router/Wi-Fi connection to settle without hammering Railway.
 var n=Math.max(1,Math.min(3,Math.floor(Number(attempt)||1)));
 return [0,950,1800,3600][n]
}
function hlsRemuxWorkerSupported(){
 // MPEG-TS remuxing can block scrolling and remote response on desktop.
 // Keep legacy VIDAA/Android TV on the known main-thread compatibility path.
 var ua=String(navigator.userAgent||'');
 return !!window.Worker&&!!window.Blob&&!!window.MediaSource&&
  !/VIDAA|Hisense|SRAF\/|SmartTV|Tizen|WebOS|Web0S|Android 9|iPad|iPhone/i.test(ua)
}
function liveOriginRetryMs(attempt){
 // A temporary origin failure should not trigger a tight re-open loop.
 var n=Math.min(5,Math.max(1,Math.floor(Number(attempt)||1)));
 return [0,2400,4100,6900,10900,16800][n]
}
function liveCapacityRetryMs(attempt){
 // Shared-source capacity errors must not trigger an immediate request storm.
 var n=Math.min(5,Math.max(1,Math.floor(Number(attempt)||1)));
 return 2500+n*2200
}
/* Private, bounded on-device incident trail. Never store a URL, channel ID,
 * token, account identifier or source error string in the troubleshooting
 * report. It is a small evidence window, not remote telemetry.
 */
function recordLiveIncident(code,now){
 var names={
  playing:'الصورة بدأت تعمل',buffering:'انتظار مقاطع البث',
  decoder_paused:'توقف مفاجئ في المشغل',picture_freeze:'تجمد الصورة',
  picture_missing:'توقيت البث يتحرك لكن لم تظهر أبعاد الصورة',
  reconnect:'بدء استعادة اتصال القناة',decoder_error:'خطأ فك ترميز الصورة',
  source_error:'فشل مؤقت في اتصال المصدر',encoder_capacity:'المحرك مشغول',
  live_edge_resync:'تجاوز مقطع قديم إلى البث الحي',live_catchup:'اللحاق بالبث المباشر',
  channel_switch:'تغيير القناة'
 };
 if(!Object.prototype.hasOwnProperty.call(names,code))return false;
 var st=S.playerView&&S.playerView.stats;
 if(S.route!=='player'||!S.playerView||S.playerView.kind!=='live'||!st)return false;
 var at=Number(now);
 if(!Number.isFinite(at)||at<0)at=Date.now();
 var events=Array.isArray(st.liveEvents)?st.liveEvents:(st.liveEvents=[]);
 var previous=events[events.length-1];
 if(previous&&previous.code===code&&at-previous.at<3000)return false;
 events.push({code:code,at:at});
 if(events.length>12)events.splice(0,events.length-12);
 return true
}
/* Local, evidence-based LIVE playback hint. This is deliberately a symptom
 * classification, not a claim about the upstream provider, router or device.
 * It uses existing observations only and never sends telemetry or URLs. */
function liveCauseHint(rec,video,stats,now,userPaused,hidden){
 function hint(code,title,detail){return {code:code,title:title,detail:detail}}
 if(!rec||!video)return hint('unknown','بيانات غير كافية','لم تتوفر قراءات من مشغل البث الحالي.');
 if(userPaused||hidden||video.paused||video.seeking)
  return hint('paused','المشاهدة متوقفة مؤقتًا','لن تُفسَّر فترة الإيقاف أو إخفاء الصفحة على أنها تقطيع.');
 var last=Number(rec.lastProgressAt);
 var idle=Number.isFinite(last)&&last>0?Math.max(0,now-last):null;
 var seen=!!rec.visualProgressSeen;
 var events=stats&&Array.isArray(stats.liveEvents)?stats.liveEvents:[];
 // Only known, already-redacted incident types; do not trust arbitrary event text.
 var fault=null;
 for(var i=events.length-1;i>=0;i--){
  var event=events[i],age=now-Number(event&&event.at);
  if(!event||!Number.isFinite(age)||age<0||age>25000)continue;
  if(event.code==='encoder_capacity'||event.code==='source_error'||event.code==='decoder_error'){
   fault=event.code;break
  }
 }
 // A recently recovered image outranks an old failure event.
 if(seen&&idle!==null&&idle<6500)
  return hint('progress','الصورة تتقدم حاليًا','لا توجد قرينة على تجمد الصورة الآن؛ الانقطاعات السابقة مسجلة منفصلة.');
 if(fault==='encoder_capacity')
  return hint('capacity','ازدحام محرك الوسائط','رُصد رفض سعة تشغيل سابقًا؛ ينتظر المشغل إعادة المحاولة التدريجية.');
 if(fault==='source_error')
  return hint('upstream_response','استجابة مؤقتة من مسار البث','رُصد رد 502–504؛ لا تكفي هذه القراءة للتمييز بين المصدر والشبكة والوسيط.');
 if(fault==='decoder_error')
  return hint('decoder_error','خطأ في فك ترميز الفيديو','سجّل مشغل HLS خطأ ترميز؛ قد يساعد مسار التوافق الموجود بالفعل.');
 if(!seen)
  return hint('first_picture','بانتظار أول صورة مؤكدة','لم تثبت بعد صورة فعلية؛ وقت فتح القناة ليس دليلًا على تقطيع سابق.');
 if(idle===null||idle<8000)
  return hint('unknown','قراءات غير كافية','لا يمكن تحديد نوع الانقطاع من آخر قياسات المشغل.');
 // Fragment timestamps exist only for HLS.js; native HLS and MPEG-TS
 // must never be blamed for missing a callback the engine cannot expose.
 var fragmentAge=rec.engine&&rec.lastFragmentAt?
  Math.max(0,now-Number(rec.lastFragmentAt)):null;
 if(fragmentAge!==null&&fragmentAge<6000)
  return hint('picture_pipeline','مقاطع تصل دون تقدم الصورة','وصل مقطع HLS مؤخرًا بينما الصورة متوقفة؛ افحص توافق فك الترميز، دون الجزم بسببه.');
 if(fragmentAge!==null&&fragmentAge>=12000)
  return hint('delivery_gap','تأخر وصول مقاطع HLS','لم يُرصد مقطع حديث؛ قد يكون التأخير من المصدر أو الاتصال أو وسيط البث.');
 if(Number(video.videoWidth)<=0||Number(video.videoHeight)<=0)
  return hint('picture_absent','الصورة غير ظاهرة','لم يعرض المتصفح أبعاد صورة صالحة؛ قد تكون المشكلة في ترميز الفيديو أو تهيئة المشغل.');
 return hint('unknown_stall','توقف تقدم الصورة','الانقطاع مرصود، لكن الأدلة لا تكفي لتحديد الشبكة أو المصدر أو الجهاز.')
}
function liveUnexpectedPause(record,video,userPaused,hidden,now){
 if(userPaused||hidden||video.seeking||(!video.paused&&!video.ended)){
  record.unexpectedPauseAt=0;return false
 }
 if(!record.unexpectedPauseAt){record.unexpectedPauseAt=now;return false}
 return now-record.unexpectedPauseAt>=10000
}
/* Explicit direct MPEG-TS mode for H.264/AAC channels in MSE-enabled browsers.
 * Uses the SAME authorized first-party source, not a new external host.
 * Never opens direct TS while a previous HLS producer is still running:
 * the old stream must acknowledge STOP first, preventing double sessions.
 * On unsupported codec/network errors, returns to the normal HLS path.
 */
function playDirectMpegts(video,id,statusElement){
 if(!S.userVerified||S.route!=='player'||!S.playerView||
    S.playerView.video!==video||S.playerView.kind!=='live'||String(S.playerView.id)!==String(id))return;
 var old=S.play,oldKey=old&&old.hlsKey;
 if(oldKey){
  stopPlayback(false);
  if(statusElement){statusElement.textContent='جار إغلاق محرك HLS قبل فتح MPEG-TS المباشر…';statusElement.style.display='block'}
  var epoch=S.accountEpoch,settled=false,timer=setTimeout(function(){finish(0)},6500);
  function finish(st){
   if(settled)return;settled=true;clearTimeout(timer);
   if(epoch!==S.accountEpoch||S.route!=='player'||!S.playerView||
      S.playerView.video!==video||String(S.playerView.id)!==String(id))return;
   if(st!==200&&st!==404){
    playerStatus('لم يتأكد إغلاق اتصال HLS السابق؛ لن أفتح اتصالًا آخر. اضغط إعادة المحاولة.',true);
    return
   }
   playDirectMpegts(video,id,statusElement)
  }
  api('POST','/api/hls/'+oldKey+'/stop',{},function(st){finish(st)});
  return
 }
 stopPlayback(true);
 var state=S.playerView,record={video:video,kind:'live',id:id,preview:false,
  mode:'mpegts',engine:null,ready:false,started:Date.now(),fallback:false};
 S.play=record;state.mode='mpegts';state.ready=false;
 var button=document.getElementById('player-direct-ts');
 if(button)button.textContent='↩ العودة إلى HLS المتوافق';
 var badge=document.getElementById('player-source-mode');
 if(badge){badge.textContent='MPEG-TS مباشر • حسب ترميز المصدر';badge.hidden=false}
 function alive(){return S.play===record&&S.route==='player'&&S.playerView===state&&
  String(state.id)===String(id)&&video.isConnected}
 function status(msg){
  if(!alive())return;
  if(statusElement){statusElement.textContent=msg;statusElement.style.display='block'}
 }
 function fallback(msg){
  if(!alive()||record.fallback)return;
  // Record a sustained picture loss even when the engine must be replaced
  // before it can present another frame.
  countVisualOutage(record,video,Date.now());
  record.fallback=true;
  if(state.stats){state.stats.recoveries=(state.stats.recoveries||0)+1;state.stats.lastRecoveryAt=Date.now()}
  recordLiveIncident('reconnect');
  status(msg||'الترميز المباشر غير مدعوم؛ جار الرجوع إلى HLS المتوافق…');
  // stopPlayback destroys the direct fetch first; there is no old FFmpeg
  // producer and no STOP call or duplicate HLS source on this path.
  playHls(video,'live',id,'ts',0,statusElement,false,0)
 }
 if(!window.MediaSource||!window.MediaSource.isTypeSupported){
  fallback('هذا التلفزيون لا يدعم محرك MPEG-TS المباشر؛ جار تشغيل HLS.');return
 }
 record.startupTimer=setTimeout(function(){
  if(alive()&&!record.ready)fallback('تأخر بدء الصورة المباشرة؛ جار التحويل إلى مشغّل HLS.')
 },28000);
 loadMpegts(function(ok){
  if(!alive())return;
  if(!ok||!window.mpegts||!window.mpegts.isSupported||!window.mpegts.isSupported()){
   fallback('لا يدعم المتصفح محرك MPEG-TS؛ جار العودة إلى HLS.');return
  }
  try{
   var transport=window.mpegts.createPlayer({
    type:'mpegts',isLive:true,url:'/api/media/live/'+enc(id)+'.ts'
   },{
    enableWorker:false,enableStashBuffer:true,stashInitialSize:131072,
    lazyLoad:false,autoCleanupSourceBuffer:true,autoCleanupMaxBackwardDuration:30
   });
   record.engine=transport;
   // A failed direct format must not leave the picture black indefinitely.
   if(window.mpegts.Events&&window.mpegts.Events.ERROR)
    transport.on(window.mpegts.Events.ERROR,function(){
     if(alive())fallback('تعذر فك ترميز MPEG-TS من المصدر؛ جار تجربة مشغّل HLS.')
    });
   video.onplaying=function(){
    if(!alive())return;
    record.ready=true;
    record.lastProgressAt=Date.now();
    record.lastMediaTime=Number(video.currentTime)||0;
    if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}
    status('● تشغيل MPEG-TS المباشر');
    if(statusElement)statusElement.style.display='none';
    state.ready=true;
    // Actual first-picture evidence is recorded by the frame observer below.
    if(state.refreshVideoResolution)state.refreshVideoResolution();
    if(state.revealControls)state.revealControls()
   };
   video.onerror=function(){fallback('رفض المتصفح ترميز البث المباشر؛ جار تجربة HLS.')};
   video.onwaiting=video.onstalled=function(){
    if(!alive()||video.paused||record.fallback)return;
    var last=Number(video.currentTime)||0;
    if(record.stallTimer)clearTimeout(record.stallTimer);
    record.stallTimer=setTimeout(function(){
     if(!alive()||video.paused)return;
     if(Math.abs((Number(video.currentTime)||0)-last)<0.3)fallback('توقفت الصورة المباشرة؛ جار التحويل إلى HLS.')
    },18000)
   };
   // On old decoders the audio time can advance while the picture stays
   // black. Never claim direct TS is healthy based only on onplaying().
   // This uses the same local visual-progress checks as the HLS watchdog.
   record.progressWatchdog=setInterval(function(){
    if(!alive())return;
    if(document.hidden||video.paused||state.userPaused||video.seeking){
     record.lastProgressAt=Date.now();
     record.lastVisualSampleAt=record.lastProgressAt;
     record.visualProgressSeen=false;
     return
    }
    var now=Date.now();
    if(record.ready&&(!video.videoWidth||!video.videoHeight)){
     if(now-(record.lastProgressAt||record.started)>16000)
      fallback('الصوت يعمل لكن صورة MPEG-TS غير ظاهرة؛ جار التحويل إلى HLS.');
     return
    }
    if(!record.ready)return;
    var progress=livePlaybackProgress(record,video,now);
    if(!progress.advanced&&progress.idleMs>18000)
     fallback('تجمّدت صورة MPEG-TS؛ جار العودة إلى HLS.')
   },2000);
   video.defaultPlaybackRate=1;video.playbackRate=1;video.muted=false;
   video.playsInline=true;video.autoplay=true;
   transport.attachMediaElement(video);
   transport.load();
   var promise=transport.play();
   if(promise&&promise.catch)promise.catch(function(){if(alive())status('اضغط ▶ لبدء MPEG-TS')})
   status('جار فتح النقل المباشر MPEG-TS…')
  }catch(e){fallback('تعذر تهيئة المشغّل المباشر؛ جار الرجوع إلى HLS.')}
 })
}
// Keep one in-flight STOP for this player. Every subsequent request replaces
// the desired channel, not the retiring source. Retry must confirm the same
// old SID after a failed STOP rather than opening a second connection.
function queueLiveHlsHandoff(state,request,oldKey,ops){
 var pending=state.liveHlsHandoff;
 if(!pending){
  if(!oldKey)return false;
  pending=state.liveHlsHandoff={key:oldKey,request:request,inflight:false,ack:false};
  ops.detach()
 }else pending.request=request;
 function complete(){
  if(state.liveHlsHandoff!==pending||!ops.current())return;
  if(!ops.visible()){ops.error();return}
  var latest=pending.request;
  if(!ops.matches(latest))return;
  state.liveHlsHandoff=null;ops.start(latest)
 }
 if(pending.ack){complete();return true}
 if(pending.inflight)return true;
 pending.inflight=true;ops.wait();
 var slow=ops.timer(function(){if(state.liveHlsHandoff===pending&&ops.current()&&pending.inflight)ops.error()},6500);
 ops.stop(pending.key,function(status){
  ops.clear(slow);pending.inflight=false;
  if(state.liveHlsHandoff!==pending||!ops.current())return;
  if(status!==200&&status!==404){ops.error();return}
  pending.ack=true;complete()
 });
 return true
}
function playHls(video,kind,id,extension,track,statusElement,preview,recoveryAttempt){
 var player=S.playerView;
 if(!preview&&kind==='live'&&S.route==='player'&&player&&player.video===video){
  var oldKey=S.play&&S.play.video===video&&S.play.hlsKey;
  if(queueLiveHlsHandoff(player,{id:id,ext:extension,track:track,attempt:recoveryAttempt},oldKey,{
   detach:function(){stopPlayback(false)},
   current:function(){return S.route==='player'&&S.playerView===player&&video.isConnected&&S.userVerified},
   visible:function(){return !document.hidden&&navigator.onLine!==false&&!player.userPaused},
   matches:function(next){return String(player.id)===String(next.id)},
   wait:function(){playerStatus('جار تشغيل القناة…')},
   error:function(){playerStatus('تعذر إنهاء الاتصال السابق. أعد المحاولة.',true)},
   timer:setTimeout,clear:clearTimeout,
   stop:function(key,done){api('POST','/api/hls/'+key+'/stop',{},done)},
   start:function(next){playerStatus('جار تشغيل القناة…');playHls(video,'live',next.id,next.ext,next.track,statusElement,false,next.attempt)}
  }))return
 }
 var modeKey=kind+':'+id+':'+extension+':'+track;
 // Thumbnail previews must never start an expensive UHD software encoder.
 var ultra=!preview&&!!(S.hlsForceUltra&&S.hlsForceUltra[modeKey]);
 var compat=ultra||!!(S.hlsForceCompatibility&&S.hlsForceCompatibility[modeKey]);
 // Each opening gets an independent, non-authentication playback SID.
 // A viewer sharing an activation code can no longer stop a different
 // viewer's same-channel feed while restarting or switching engines.
 var key=kind+'/'+id+'/'+extension+'/'+track+'/sid-'+freshPlaybackId()+
     (ultra?'/ultra':compat?'/compat':''),
     manifest='/api/hls/'+key+'/index.m3u8';
 // An existing session with the same key must stop BEFORE the replacement
 // starts. A delayed stop otherwise kills the newly opened channel on VIDAA.
 if(S.play&&S.play.hlsKey&&(S.play.hlsKey===key||S.play.video===video)){
  var oldHlsKey=S.play.hlsKey;
  var token=(S.hlsStopEpoch||0)+1;S.hlsStopEpoch=token;
  stopPlayback(false);
  if(statusElement)statusElement.textContent=preview?'جار تحميل المعاينة…':'جار تشغيل القناة…';
  var settled=false,timer=setTimeout(function(){finish(0)},5500);
  function finish(status){
   if(settled)return;settled=true;clearTimeout(timer);
   if(S.hlsStopEpoch!==token||!video.isConnected||!S.userVerified)return;
   if(preview&&(S.route!=='live'||String(S.selected)!==String(id)))return;
   if(!preview&&(S.route!=='player'||!S.playerView||S.playerView.video!==video||String(S.playerView.id)!==String(id)))return;
   if(status!==200&&status!==404){
    if(!preview)playerStatus('لم يؤكد الخادم إغلاق البث السابق. اضغط إعادة المحاولة.',true);
    else if(statusElement)statusElement.textContent='تعذر تحديث الاتصال، حاول ثانية.';
    return
   }
   if(preview)S.livePreview=String(id);
   playHls(video,kind,id,extension,track,statusElement,preview,recoveryAttempt)
  }
  api('POST','/api/hls/'+oldHlsKey+'/stop',{},function(st){finish(st)});
  return
 }
 stopPlayback(true);
 if(!preview&&S.playerView&&S.playerView.video===video){
  S.playerView.mode='hls';
  var directBtn=document.getElementById('player-direct-ts');
  if(directBtn)directBtn.textContent='⚡ تشغيل MPEG-TS المباشر (بديل)'
 }
 var record={video:video,kind:kind,id:id,hlsKey:key,preview:!!preview,engine:null,timer:null,stallTimer:null,
  retries:0,recoveryAttempt:Math.max(0,Number(recoveryAttempt)||0),ready:false,started:Date.now(),lastProgressAt:0,lastMediaTime:null,lastVideoFrames:null,stallChecks:0,compat:compat,ultra:ultra};
 S.play=record;
 // requestVideoFrameCallback measures frames actually submitted for display;
 // on supported VIDAA engines this catches frozen pictures even when an
 // audio clock keeps advancing or getVideoPlaybackQuality is unreliable.
 if(typeof video.requestVideoFrameCallback==='function'){
  record.watchPresentedFrame=function(){
   if(S.play!==record||!video.isConnected)return;
   try{
    record.presentedFrameId=video.requestVideoFrameCallback(function(now,metadata){
     record.presentedFrameId=null;
     if(S.play!==record)return;
     // An invocation itself proves a presented frame, regardless of
     // metadata formatting differences across legacy TV firmwares.
     record.framePresentationObserved=true;
     record.lastPresentedFrameAt=Date.now();
     record.presentedFrames=(record.presentedFrames||0)+1;
     record.watchPresentedFrame()
    })
   }catch(e){record.presentedFrameId=null}
  };
  record.watchPresentedFrame()
 }
 if(preview){
  record.qualityListener=function(){
   if(S.play!==record||S.route!=='live')return;
   var label=document.getElementById('live-preview-quality');
   if(!label)return;
   var w=Math.max(0,Number(video.videoWidth)||0),h=Math.max(0,Number(video.videoHeight)||0);
   label.textContent=w&&h?'الدقة المعروضة فعليًا: '+w+'×'+h+' • '+(h>=4300?'8K':h>=2100?'4K':h>=1400?'2K':h>=1000?'FHD':h>=690?'HD':'SD')+
    (record.sourceDimensions?' • المصدر '+record.sourceDimensions:''):
    'الدقة المعروضة: جار قراءة معلومات الفيديو…'
  };
  video.addEventListener('loadedmetadata',record.qualityListener);
  video.addEventListener('resize',record.qualityListener);
  record.qualityListener()
 }
 // Always play live at 1x: a stale playback speed must not pitch-shift voices.
 if(kind==='live'){
  video.defaultPlaybackRate=1;video.playbackRate=1;
  if('preservesPitch' in video)video.preservesPitch=true;
  if('webkitPreservesPitch' in video)video.webkitPreservesPitch=true
 }
 video.muted=!!preview&&S.previewSound===false;video.defaultMuted=video.muted;video.autoplay=true;video.playsInline=true;video.controls=false;
 if(preview&&video.removeAttribute&&!video.muted)video.removeAttribute('muted');
 function alive(){return S.play===record}
 function setCompatibility(force,automatic,forceUltra){
  var nextUltra=!!(force&&forceUltra);
  if(!alive()||kind!=='live'||(compat===!!force&&ultra===nextUltra))return false;
  if(!S.hlsForceCompatibility)S.hlsForceCompatibility={};
  if(!S.hlsForceUltra)S.hlsForceUltra={};
  S.hlsForceCompatibility[modeKey]=!!force&&!nextUltra;
  S.hlsForceUltra[modeKey]=nextUltra;
  status(automatic?'تعذر فك ترميز الوضع السابق؛ جار تشغيل توافق 1080p…':
    nextUltra?'جار اختبار 4K من المصدر الحقيقي؛ الأداء يعتمد على الشاشة والاتصال…':
    force?'جار التحويل إلى تشغيل متوافق مع التلفزيون…':'جار العودة لجودة المصدر الأصلية…');
  playHls(video,kind,id,extension,track,statusElement,preview,0);
  return true
 }
 if(!preview&&S.playerView&&S.playerView.video===video){
  S.playerView.setHlsCompatibility=function(force,forceUltra){
   if(S.route==='player'&&S.playerView&&S.playerView.video===video)
    setCompatibility(force,false,forceUltra)
  }
 }
 function recoverConnection(){
  if(!alive()||record.reconnecting)return;
  if(preview){
   if(S.route!=='live'||String(S.selected)!==String(id)||!video.isConnected)return;
   if(record.recoveryAttempt>=2){
    status('المعاينة توقفت بعد محاولات الاستعادة؛ افتح القناة أو اخترها مجددًا.');
    return
   }
   record.reconnecting=true;
   if(record.startupTimer)clearTimeout(record.startupTimer);
   if(record.stallTimer)clearTimeout(record.stallTimer);
   if(record.progressWatchdog)clearInterval(record.progressWatchdog);
   status('جار استعادة معاينة القناة تلقائيًا…');
   var nextAttempt=record.recoveryAttempt+1;
   record.retryTimer=setTimeout(function(){
    record.retryTimer=null;
    if(!alive()||S.route!=='live'||String(S.selected)!==String(id)||!video.isConnected)return;
    playHls(video,kind,id,extension,track,statusElement,true,nextAttempt)
   },1200*nextAttempt);
   return
  }
  var state=S.playerView;
  if(S.route!=='player'||!state||state.video!==video||String(state.id)!==String(id))return;
  countVisualOutage(record,video,Date.now());
  record.reconnecting=true;
  if(state.stats){
   state.stats.recoveries=(state.stats.recoveries||0)+1;
   state.stats.lastRecoveryAt=Date.now();
   recordLiveIncident('reconnect')
  }
  // Recovery order: original-native -> original MSE -> bounded compatibility.
  // Do not sacrifice upstream 4K on the first TV decoder stall.
  if(record.ultra&&record.recoveryAttempt>=1&&setCompatibility(true,true))return;
  if(!record.engine&&record.recoveryAttempt>=1&&window.MediaSource&&window.MediaSource.isTypeSupported){
   S.preferMseHls=true;
  }
  if(!record.compat&&record.recoveryAttempt>=2&&setCompatibility(true,true))return;
  if(record.startupTimer)clearTimeout(record.startupTimer);
  if(record.stallTimer)clearTimeout(record.stallTimer);
  if(record.progressWatchdog)clearInterval(record.progressWatchdog);
  if(record.stableTimer)clearTimeout(record.stableTimer);
  if(record.recoveryAttempt>=4){
   // Allow a struggling source to recover without forcing an app exit.
   playerStatus('انقطع مصدر البث. إعادة محاولة تلقائية بعد 25 ثانية أو اضغط إعادة المحاولة.',true);
   record.retryTimer=setTimeout(function(){
    record.retryTimer=null;
    if(!alive()||S.route!=='player'||!video.isConnected||state.userPaused)return;
    // A decoder may set video.paused=true on a fatal error without user input.
    playHls(video,kind,id,extension,track,statusElement,false,0)
   },25000);
   return
  }
  playerStatus('جار استعادة القناة تلقائيًا… ('+(record.recoveryAttempt+1)+'/4)');
  playHls(video,kind,id,extension,track,statusElement,false,record.recoveryAttempt+1)
 }
 record.startupTimer=setTimeout(function(){
  record.startupTimer=null;
  if(!alive()||record.ready||video.paused)return;
  recoverConnection()
 },50000);

 function probeSourceVideoMode(){
  if(record.videoModeProbed||!alive()||typeof fetch!=='function')return;
  record.videoModeProbed=true;
  fetch(manifest,{method:'GET',credentials:'same-origin',cache:'no-store'}).then(function(response){
   if(!response.ok)return null;
   return {
    mode:response.headers.get('x-blofy-video-mode')||'',
    source:response.headers.get('x-blofy-source-resolution')||''
   }
  }).then(function(info){
   if(!info||!alive())return;
   record.videoMode=info.mode;
   record.sourceDimensions=/^[1-9][0-9]{1,3}x[1-9][0-9]{1,3}$/.test(info.source)?info.source:'';
   if(preview){
    if(record.qualityListener)record.qualityListener();
    return
   }
   if(S.route!=='player'||!S.playerView||S.playerView.video!==video)return;
   if(S.playerView.refreshVideoResolution)S.playerView.refreshVideoResolution();
   var tag=document.getElementById('player-source-mode');
   if(!tag)return;
   if(info.mode==='source_copy'){
    tag.textContent='الفيديو الأصلي • بدون ضغط إضافي';tag.hidden=false
   }else if(info.mode==='ultra_transcode'){
    tag.textContent='4K تجريبي • إعادة ترميز حتى دقة المصدر';tag.hidden=false
   }else if(info.mode==='compatibility_transcode'){
    tag.textContent='وضع توافق • تحويل الصورة';tag.hidden=false
   }else tag.hidden=true
  }).catch(function(){})
 }
 function status(text){if(!alive())return;
  if(!preview&&kind==='live')text=simpleLiveStatus(text,false);
  if(statusElement){if(statusElement.textContent!==text)statusElement.textContent=text;if(!preview&&text.slice(0,1)!=='●')statusElement.style.display='block'}
  else playerStatus(text)
 }
 // WebKit can resume presenting frames without a new playing event.
 function clearRecoveredLiveLoading(){
  if(!alive()||preview||kind!=='live'||!record.ready||record.reconnecting||
     video.paused||video.seeking||document.hidden)return;
  if(record.quietWaitTimer){clearTimeout(record.quietWaitTimer);record.quietWaitTimer=null}
  if(record.stallTimer){clearTimeout(record.stallTimer);record.stallTimer=null}
  if(statusElement&&statusElement.classList.contains('player-loading')&&
     statusElement.textContent==='جار تشغيل القناة…')statusElement.style.display='none'
 }
 video.onerror=function(){if(alive()){
  var unsupported=video.error&&(video.error.code===4||video.error.code===3);
  // Some VIDAA browsers advertise native HLS but cannot actually decode it.
  // Prefer the verified MSE engine on the codec fallback where available.
  if(unsupported&&window.MediaSource&&window.MediaSource.isTypeSupported)S.preferMseHls=true;
  if(unsupported&&setCompatibility(true,true))return;
  if(unsupported&&window.MediaSource&&window.MediaSource.isTypeSupported){
   S.preferMseHls=true;
   status('المشغّل الأصلي لا يدعم الترميز؛ جار التحويل إلى مشغّل HLS المتوافق…')
  }else status('تعذر تشغيل HLS على هذا الجهاز (رمز '+(video.error?video.error.code:0)+').');
  recoverConnection()
 }};
 video.onplaying=function(){
  if(!alive())return;
  record.ready=true;record.retries=0;record.stallChecks=0;record.bufferSince=0;
  record.lastProgressAt=Date.now();
  record.unexpectedPauseAt=0;
  record.lastMediaTime=Number(video.currentTime)||0;
  record.lastVideoFrames=null;
  if(record.startupTimer){clearTimeout(record.startupTimer);record.startupTimer=null}
  if(record.stallTimer){clearTimeout(record.stallTimer);record.stallTimer=null}
  if(record.stableTimer)clearTimeout(record.stableTimer);
  record.stableTimer=setTimeout(function(){
   record.stableTimer=null;
   if(alive()&&record.ready&&video.readyState>=2)record.recoveryAttempt=0
  },120000);
  if(record.quietWaitTimer){clearTimeout(record.quietWaitTimer);record.quietWaitTimer=null}
  status(preview?'● المعاينة تعمل':'● تشغيل البث');
  probeSourceVideoMode();
  if(!preview&&S.route==='player'&&S.playerView&&S.playerView.video===video){
   var state=S.playerView,firstPlay=!state.ready;state.ready=true;
   if(firstPlay)recordLiveIncident('playing');
   // Actual first-picture evidence is recorded by the frame observer below.
   if(statusElement)statusElement.style.display='none';
   if(firstPlay&&state.revealControls)state.revealControls()
  }
 };
 video.onwaiting=video.onstalled=function(){
  if(!alive()||video.paused)return;
  if(!preview)recordLiveIncident('buffering');
  if(!record.bufferSince)record.bufferSince=Date.now();
  if(Date.now()-record.bufferSince>36000){recoverConnection();return}
  // Short decoder waits do not flash a loading message over moving video.
  if(preview||!record.ready)status(preview?'جار تحميل المعاينة…':'جار تشغيل القناة…');
  else if(!record.quietWaitTimer)record.quietWaitTimer=setTimeout(function(){
   record.quietWaitTimer=null;if(alive()&&record.bufferSince&&!video.paused)status('جار تشغيل القناة…')
  },2500);
  if(record.stallTimer)clearTimeout(record.stallTimer);
  record.stallTimer=setTimeout(function(){
   record.stallTimer=null;
   if(!alive()||video.paused)return;
   // Buffering can freeze with readyState=4: inspect actual progress.
   var progress=livePlaybackProgress(record,video,Date.now());
   if(progress.advanced){clearRecoveredLiveLoading();return}
   record.stallChecks++;
   if(record.stallChecks>=3){recoverConnection();return}
   if(record.engine&&record.retries<3){record.retries++;try{record.engine.startLoad()}catch(e){}}
   record.stallTimer=setTimeout(function(){
    record.stallTimer=null;
    if(alive()&&!video.paused&&Date.now()-(record.lastProgressAt||record.started)>15000)recoverConnection()
   },14000)
  },8500)
 };
 // Independent timer covers silent stalls in preview and fullscreen.
 // Preview restarts are capped to two to protect the upstream connection.
 record.progressWatchdog=setInterval(function(){
   if(!alive()||!record.ready||!video.isConnected)return;
   if(preview&&(S.route!=='live'||String(S.selected)!==String(id)))return;
   if(!preview&&S.route!=='player')return;
   var now=Date.now();
   var intentionalPause=!preview&&S.playerView&&S.playerView.video===video&&S.playerView.userPaused;
   if(liveUnexpectedPause(record,video,!!intentionalPause,document.hidden,now)){
    status('توقف مشغّل الفيديو دون طلب؛ جار إعادة اتصال القناة…');
    if(!preview)recordLiveIncident('decoder_paused');
    recoverConnection();return
   }
   if(video.paused||video.ended||video.seeking||document.hidden){
    record.lastProgressAt=now;record.lastVisualSampleAt=now;
    record.visualProgressSeen=false;return
   }
   var progress=livePlaybackProgress(record,video,now);
   if(liveLatencyCatchup(record,record.engine,video,now,!!intentionalPause,document.hidden)){
    if(!preview)recordLiveIncident('live_catchup',now);
    status('تأخر التشغيل عن البث المباشر؛ تم الانتقال لأحدث نقطة متاحة.');
    return
   }
   if(progress.advanced){clearRecoveredLiveLoading();return}
   if(progress.idleMs>=16000){
    diagnose('live','startup_timeout','hls',0);
    if(!preview)recordLiveIncident(Number(video.videoWidth)>0&&Number(video.videoHeight)>0?
      'picture_freeze':'picture_missing',now);
    recoverConnection()
   }else if(progress.idleMs>=6500&&!record.bufferSince){
    record.bufferSince=Date.now();
    status(!video.videoWidth||!video.videoHeight?
     'وصل الصوت أو توقيت البث لكن الصورة لم تظهر؛ جار فحص الفيديو واستعادة التشغيل…':
     'تعليق في صورة البث؛ جار استعادة التشغيل تلقائيًا…')
   }
  },2200);
 if(shouldUseNativeHls(video)){
  video.src=manifest;try{var p=video.play();if(p&&p.catch)p.catch(function(){status('اضغط ▶ في المشغّل')})}catch(e){}return
 }
 loadHls(function(ok){
  if(!alive())return;
  if(!ok||!window.Hls||!window.Hls.isSupported()){
   // Only try native HLS if the browser genuinely advertises it.
   if(video.canPlayType&&video.canPlayType('application/vnd.apple.mpegurl')){
    video.src=manifest;try{video.play()}catch(e){};return
   }
   status('تعذر تحميل مشغّل HLS أو المتصفح لا يدعم MSE.');return
  }
  try{
   var engine=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,liveSyncDurationCount:4,liveMaxLatencyDurationCount:10,maxBufferLength:35,maxBufferHole:1.5,maxLiveSyncPlaybackRate:1,manifestLoadingTimeOut:30000,fragLoadingTimeOut:30000});record.engine=engine;
   engine.on(window.Hls.Events.MANIFEST_PARSED,function(){if(!alive())return;try{var p=video.play();if(p&&p.catch)p.catch(function(){status('اضغط تشغيل ▶')})}catch(e){}});
   // Network and decoder are separate signals. If HLS fragments arrive while
   // actual decoded frames remain frozen, the report can flag a TV decoder
   // problem instead of blaming Railway or the subscriber's source.
   engine.on(window.Hls.Events.FRAG_LOADED,function(){
    if(alive()){
     record.lastFragmentAt=Date.now();
     record.capacityRetries=0;record.originRetries=0;record.transientRetries=0;
     if(record.retryTimer){clearTimeout(record.retryTimer);record.retryTimer=null}
     if(record.originTimer){clearTimeout(record.originTimer);record.originTimer=null}
    }
   });
   engine.on(window.Hls.Events.ERROR,function(event,detail){
    if(!alive()||!detail)return;
    var code=Number(detail.response&&detail.response.code)||0;
    if(code===410&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     if(!preview)recordLiveIncident('live_edge_resync');
     var edgeAction=liveExpiredSegmentRecovery(record,engine,video,Date.now());
     if(edgeAction==='restart')recoverConnection();
     else if(edgeAction==='resync')status('تأخرت بعض مقاطع البث؛ جار الانتقال إلى البث المباشر…');
     return
    }
    if(!detail.fatal)return;
    diagnose('live','hls_error','video',0);
    if(record.ultra&&(code===429||code===503)&&setCompatibility(true,true))return;
    if(code===429){
     if(!preview)recordLiveIncident('encoder_capacity');
     // Only two worker slots exist on the pilot. Back off instead of
     // burning connection attempts, which could cut off healthy viewers.
     record.capacityRetries=(record.capacityRetries||0)+1;
     if(record.capacityRetries>5){recoverConnection();return}
     var delay=liveCapacityRetryMs(record.capacityRetries);
     status('المحرك مشغول مؤقتًا؛ إعادة المحاولة خلال '+Math.ceil(delay/1000)+' ثوانٍ…');
     if(record.capacityTimer)clearTimeout(record.capacityTimer);
     record.capacityTimer=setTimeout(function(){
      record.capacityTimer=null;
      if(!alive())return;
      try{engine.startLoad()}catch(e){recoverConnection()}
     },delay);
     return
    }
    if((code===502||code===503||code===504)&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     if(!preview)recordLiveIncident('source_error');
     record.originRetries=(record.originRetries||0)+1;
     if(record.originRetries>5){recoverConnection();return}
     var delay=liveOriginRetryMs(record.originRetries);
     status('تعثر اتصال مصدر القناة؛ محاولة تدريجية بعد '+Math.ceil(delay/1000)+' ثوانٍ…');
     if(record.originTimer)clearTimeout(record.originTimer);
     record.originTimer=setTimeout(function(){
      record.originTimer=null;
      if(!alive())return;
      try{engine.startLoad()}catch(e){recoverConnection()}
     },delay);
     return
    }
    if((record.transientRetries||0)<3&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     record.transientRetries=(record.transientRetries||0)+1;
     var pause=liveTransientRetryMs(record.transientRetries);
     status('انقطاع شبكة مؤقت؛ إعادة الاتصال خلال '+Math.ceil(pause/1000)+' ثانية…');
     if(record.retryTimer)clearTimeout(record.retryTimer);
     record.retryTimer=setTimeout(function(){
      record.retryTimer=null;
      if(!alive())return;
      try{engine.startLoad()}catch(e){recoverConnection()}
     },pause);
     return
    }
    if(record.retries<2&&detail.type===window.Hls.ErrorTypes.MEDIA_ERROR){
     if(!preview)recordLiveIncident('decoder_error');
     record.retries++;status('جار إعادة تهيئة الفيديو…');try{engine.recoverMediaError()}catch(e){};return;
    }
    if(detail.type===window.Hls.ErrorTypes.MEDIA_ERROR&&setCompatibility(true,true))return;
    recoverConnection()
   });
   engine.attachMedia(video);engine.loadSource(manifest)
  }catch(e){status('تعذر إعداد مشغّل HLS')}
 })
}

function durationSeconds(value,unit){
 if(value===null||value===undefined||value==='')return 0;
 var raw=typeof value==='number'?value:typeof value==='string'?value.trim():NaN;
 if(typeof raw==='string'&&raw.indexOf(':')>=0){
  var parts=raw.split(':');
  if(parts.length<2||parts.length>3)return 0;
  var seconds=0;
  for(var i=0;i<parts.length;i++){
   if(!/^\d{1,3}$/.test(parts[i]))return 0;
   var part=Number(parts[i]);
   if(i>0&&part>=60)return 0;
   seconds=seconds*60+part
  }
  return seconds>0&&seconds<=21600?seconds:0
 }
 if(typeof raw==='string'&&!/^\d+(?:\.\d+)?$/.test(raw))return 0;
 var n=Number(raw);
 if(!isFinite(n)||n<=0)return 0;
 // Xtream duration_secs reports seconds; plain duration often reports minutes.
 if(unit!=='seconds'&&n<=240)n*=60;
 return n>=1&&n<=21600?Math.round(n):0
}
function knownDuration(kind,id,item){
 var opts=[],movieResponse=kind==='movie'&&S.item&&S.item.kind==='movie'&&String(S.item.id)===String(id)&&S.item.info,
 movieInfo=movieResponse&&movieResponse.info,movieData=movieResponse&&movieResponse.movie_data;
 // Episode-specific duration must win over a series' parent metadata.
 if(kind==='series'&&S.episodes&&S.episodes.episodes){
  var eps=parseEpisodes(S.episodes);
  for(var i=0;i<eps.length;i++)if(String(eps[i].id)===String(id)){
   var ep=eps[i],ei=ep.info||{};
   opts.push([ep.duration_secs,'seconds'],[ei.duration_secs,'seconds'],[ep.duration,'duration'],[ei.duration,'duration']);
   break
  }
 }
 opts=opts.concat([[item&&item.duration_secs,'seconds'],[item&&item.duration,'duration'],
  [item&&item.info&&item.info.duration_secs,'seconds'],[item&&item.info&&item.info.duration,'duration'],
  [movieInfo&&movieInfo.duration_secs,'seconds'],[movieInfo&&movieInfo.duration,'duration'],
  [movieData&&movieData.duration_secs,'seconds'],[movieData&&movieData.duration,'duration']]);
 for(var k=0;k<opts.length;k++){var sec=durationSeconds(opts[k][0],opts[k][1]);if(sec>=120)return sec}
 var saved=getResume(kind,id);
 return saved&&saved.duration>=300&&saved.duration<=21600?saved.duration:0
}

/* Real full-length VOD player. EXT-X-ENDLIST exposes the entire runtime to
 * Hls.js from the first manifest. A fragment requested after a seek is
 * transcoded on demand at that absolute movie position by the worker.
 * Unknown-length sources still use the bounded legacy streaming fallback.
 */
function freshPlaybackId(){
 var bytes=new Uint8Array(16),hex='0123456789abcdef',result='';
 if(window.crypto&&window.crypto.getRandomValues)window.crypto.getRandomValues(bytes);
 else for(var k=0;k<bytes.length;k++)bytes[k]=Math.floor(Math.random()*256);
 for(var i=0;i<bytes.length;i++)result+=hex[(bytes[i]>>4)&15]+hex[bytes[i]&15];
 return result
}
function playFullVod(video,kind,id,ext,track,duration,state,ready){
 // Xtream providers sometimes permit one source connection per account.
 // When upgrading a temporary EVENT playlist to full VOD, close that live
 // transcoder before opening the new one instead of racing two connections.
 var previous=S.play;
 if(previous&&previous.stopUrl&&previous.stopUrl.indexOf('/api/vod/')===0){
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
 }
 var seconds=Math.round(duration),path='/api/vodfull/'+kind+'/'+id+'/'+ext+'/'+track+'/'+seconds;
 var sid='sid='+state.playbackId;
 var firstAt=Math.max(0,Math.min(seconds-2,Math.round(Number(state.resume)||0)));
 // Tell the seekable VOD worker which chunk is required first, before Hls.js
 // requests segments. Other chunks are still produced only when requested.
 var playlist=path+'/index.m3u8?'+sid+'&at='+firstAt;
 var stopUrl=path+'/stop?'+sid;
 // A retry of the same full VOD session must NOT issue asynchronous /stop:
 // the delayed stop response could kill the newly started retry.
 var sameSession=!!(S.play&&S.play.stopUrl===stopUrl);
 state.ready=false;
 stopPlayback(!sameSession);
 var rec={video:video,kind:kind,id:id,preview:false,engine:null,stopUrl:stopUrl,hlsKey:null,ready:false,timer:null,stallTimer:null,pendingRecovery:false};
 S.play=rec;state.mode='fullvod';state.offset=0;state.duration=seconds;state.ready=false;state.didResume=false;
 var badge=document.getElementById('player-mode-badge');if(badge)badge.textContent='وضع VOD • مدة كاملة';
 var pathBadge=document.getElementById('player-source-mode');if(pathBadge){pathBadge.textContent='وضع توافق • إعادة ضغط';pathBadge.hidden=false}
 diagnose(kind,'vod_full_start','fullvod',0);
 video.autoplay=true;video.muted=false;video.defaultMuted=false;video.controls=false;
 playerStatus('جار فتح الفيلم الكامل مع التقديم والترجيع…');
 function alive(){return S.route==='player'&&S.play===rec}
 function fail(msg){
  if(!alive())return;
  if(rec.timer)clearTimeout(rec.timer);
  if(rec.stallTimer)clearTimeout(rec.stallTimer);
  if(rec.startupTimer)clearTimeout(rec.startupTimer);
  if(rec.retryTimer){clearTimeout(rec.retryTimer);rec.retryTimer=null}
  playerStatus(msg,true)
 }
 function recoverFilm(){
  if(!alive()||rec.pendingRecovery)return;
  var now=Date.now();
  if(!state.fullRecoveryStart||now-state.fullRecoveryStart>180000){
   state.fullRecoveryStart=now;state.fullRecoveryCount=0
  }
  if((state.fullRecoveryCount||0)>=2){
   fail('المصدر توقف عدة مرات. تم حفظ مكانك؛ استخدم إعادة المحاولة أو اختر محتوى آخر.');
   return
  }
  rec.pendingRecovery=true;state.fullRecoveryCount++;
  // The browser may still report the previous frame while a seek is loading.
  // Retry at the actual requested timestamp, not that stale video.currentTime.
  var pending=state.pendingSeek,requested=pending&&Date.now()-pending.startedAt<55000?pending.target:null;
  if(requested===null&&state.seekIncomplete&&Date.now()-(state.lastSeekAt||0)<80000)
   requested=state.lastSeekTarget;
  var resumeAt=Math.max(0,Math.floor(requested!==null?requested:(video.currentTime||state.resume||0))-1);
  if(state.ready)saveResume(kind,id,resumeAt,seconds,true);
  state.resume=resumeAt;
  diagnose(kind,'vod_retry','fullvod',0);
  playerStatus('انقطع المصدر مؤقتًا؛ جار استكمال الفيلم من '+formatTime(resumeAt)+'…');
  setTimeout(function(){
   if(alive())playFullVod(video,kind,id,ext,track,seconds,state,ready)
  },Math.min(1800,state.fullRecoveryCount*650))
 }
 function checkStall(){
  if(!alive()||video.paused)return;
  if(rec.stallTimer)clearTimeout(rec.stallTimer);
  // The worker can finish a previous 24-second chunk for up to 26s,
  // followed by a 28s segment wait. Avoid canceling useful FFmpeg work:
  // Hls.js handles the 68s fragment deadline before this recovery.
  var observed=Number(video.currentTime)||0;
  rec.stallTimer=setTimeout(function(){
   rec.stallTimer=null;
   if(!alive()||video.paused||video.readyState>=3)return;
   // Ignore an earlier buffering event if new video frames have arrived.
   if(Math.abs((Number(video.currentTime)||0)-observed)>0.9)return;
   recoverFilm()
  },72000)
 }
 rec.timer=setTimeout(function(){
  if(alive()&&!rec.ready)playerStatus('جار تجهيز الفيديو من المصدر…')
 },16000);
 // A source can hang before it emits a video waiting/stalled event. Ensure
 // the initial spinner does not remain forever; allow enough time for a slow
 // on-demand first segment before a bounded recovery attempt. Wait beyond
 // the worker's 75s watchdog so its own timeout governs stalled encoders.
 rec.startupTimer=setTimeout(function(){
  rec.startupTimer=null;
  if(alive()&&!rec.ready&&!video.paused)recoverFilm()
 },82000);
 video.onplaying=function(){
  if(!alive())return;
  if(state.completed&&video.currentTime<5)state.completed=false;
  rec.ready=true;if(rec.timer)clearTimeout(rec.timer);
  if(rec.startupTimer){clearTimeout(rec.startupTimer);rec.startupTimer=null}
  if(rec.stallTimer){clearTimeout(rec.stallTimer);rec.stallTimer=null}
  ready()
 };
 video.onwaiting=video.onstalled=function(){
  if(!alive()||video.paused)return;
  queueVodBufferNotice(video);
  checkStall()
 };
 video.onended=function(){
  if(!alive())return;
  var observed=Math.max(0,Number(video.currentTime)||0);
  if(!vodEndedAtRealFinish(seconds,observed,!!state.seekIncomplete)){
   // A TV HLS decoder sometimes sees only the local 24-second conversion
   // and emits ended, even though our VOD manifest has a full movie timeline.
   var checkpoint=Math.max(0,Math.floor(observed)-1);
   if(state.ready)saveResume(kind,id,checkpoint,seconds,true);
   playerStatus('انتهى مقطع قبل نهاية الفيلم؛ جار استعادة التشغيل من '+formatTime(checkpoint)+'…');
   recoverFilm();return
  }
  finishResume(kind,id);
  playerStatus('اكتملت المشاهدة')
 };
 video.onerror=function(){
  if(!alive())return;
  diagnose(kind,'media_error','video',video.error&&video.error.code);
  recoverFilm()
 };
 function attachNative(){
  video.onloadedmetadata=function(){
   if(!alive())return;
   if(state.resume>30&&state.resume<seconds-5&&!state.didResume){
    state.didResume=true;
    try{video.currentTime=state.resume}catch(e){}
   }
   if(state.onDuration)state.onDuration()
  };
  video.src=playlist;
  try{var p=video.play();if(p&&p.catch)p.catch(function(){if(alive())playerStatus('اضغط تشغيل للمتابعة')})}
  catch(e){fail('تعذر بدء الفيلم')}
 }
 if(shouldUseNativeHls(video)){attachNative();return}
 loadHls(function(ok){
  if(!alive())return;
  if(!ok||!window.Hls||!window.Hls.isSupported()){
   if(video.canPlayType&&video.canPlayType('application/vnd.apple.mpegurl')){attachNative();return}
   fail('المتصفح لا يدعم تشغيل ملفات HLS القابلة للتقديم.');return
  }
  try{
   var hls=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,startPosition:state.resume||0,maxBufferLength:36,
    maxMaxBufferLength:70,maxBufferHole:1,fragLoadingTimeOut:68000,manifestLoadingTimeOut:30000,
    fragLoadingMaxRetry:2,manifestLoadingMaxRetry:2});
   rec.engine=hls;
   video.onloadedmetadata=function(){
    if(!alive())return;
    // Hls.js startPosition already jumps to the saved VOD time.
    // A second assignment here used to abort the initial chunk download,
    // leaving some Android-TV browsers stuck rebuffering.
    state.didResume=state.resume>30&&state.resume<seconds-5;
    if(state.onDuration)state.onDuration()
   };
   hls.on(window.Hls.Events.FRAG_LOADED,function(){
    if(alive())rec.capacityRetries=0
   });
   hls.on(window.Hls.Events.MANIFEST_PARSED,function(){
    if(!alive())return;
    if(state.onDuration)state.onDuration();
    // startPosition already points Hls.js to the right fragment. Avoid issuing
    // a second redundant seek before metadata is ready.
    try{
     var p=video.play();
     if(p&&p.catch)p.catch(function(){if(alive())playerStatus('اضغط ▶ لتشغيل الفيلم')})
    }catch(e){playerStatus('اضغط تشغيل للمتابعة')}
   });
   var recovery=0;
   hls.on(window.Hls.Events.ERROR,function(event,detail){
    if(!alive()||!detail||!detail.fatal)return;
    var status=Number(detail.response&&detail.response.code||detail.networkDetails&&detail.networkDetails.status||0);
    diagnose(kind,'hls_error','video',0);
    if(status===416){
     fail('مصدر هذا الفيلم لا يدعم الوصول إلى الجزء المطلوب. التقديم يحتاج ملفًا يدعم القراءة العشوائية؛ إعادة المحاولة لن تصلح المصدر.');
     return
    }
    if(status===422){
     fail('مدة الفيلم المُعلنة لا تطابق الملف الفعلي، أو الجزء المطلوب غير موجود في المصدر. التقديم لهذا الموضع غير متاح.');
     return
    }
    if(status===401||status===403){
     fail('تعذر تفويض الوصول إلى ملف الفيلم. تحقق من اشتراكك ثم أعد فتح المحتوى.');
     return
    }
    if(status===429){
     // The private worker has an enforced two-encoder capacity. A busy
     // slot should not permanently fail a seek immediately, but repeated
     // attempts must never storm the source or create extra FFmpeg jobs.
     rec.capacityRetries=(rec.capacityRetries||0)+1;
     if(rec.capacityRetries<=2){
      var wait=rec.capacityRetries===1?5000:8500;
      playerStatus('محرك الفيديو مشغول مؤقتًا؛ محاولة آمنة بعد '+Math.ceil(wait/1000)+' ثوانٍ…');
      if(rec.retryTimer)clearTimeout(rec.retryTimer);
      rec.retryTimer=setTimeout(function(){
       rec.retryTimer=null;
       if(!alive())return;
       try{hls.startLoad()}catch(e){recoverFilm()}
      },wait);
      return
     }
     fail('لا تتوفر سعة تحويل إضافية الآن. تم حفظ مكان المشاهدة؛ حاول لاحقًا.');
     return
    }
    if(recovery<2&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     recovery++;
     rec.retryTimer=setTimeout(function(){
      rec.retryTimer=null;
      if(!alive())return;
      try{hls.startLoad()}catch(e){recoverFilm()}
     },liveTransientRetryMs(recovery));return
    }
    if(recovery<1&&detail.type===window.Hls.ErrorTypes.MEDIA_ERROR){recovery++;try{hls.recoverMediaError()}catch(e){};return}
    recoverFilm()
   });
   hls.attachMedia(video);hls.loadSource(playlist)
  }catch(e){fail('تعذر تهيئة مشغّل الأفلام')}
 })
}

function playVodSegments(video,kind,id,ext,track,start,state,ready){
 var at=Math.max(0,Math.round(start||0)),key=kind+'/'+id+'/'+ext+'/'+track+'/'+at,manifest='/api/vod/'+key+'/index.m3u8';
 // Retry the same timestamp without racing against an older asynchronous /stop.
 var newStop='/api/vod/'+key+'/stop',sameSession=!!(S.play&&S.play.stopUrl===newStop);
 state.ready=false;stopPlayback(!sameSession);
 state.mode='vodhls';state.offset=at;state.didResume=true;
 var badge=document.getElementById('player-mode-badge');if(badge)badge.textContent='HLS مؤقت • مدة غير مؤكدة';
 var pathBadge=document.getElementById('player-source-mode');if(pathBadge){pathBadge.textContent='وضع توافق • إعادة ضغط';pathBadge.hidden=false}
 var rec={video:video,kind:kind,id:id,preview:false,engine:null,stopUrl:'/api/vod/'+key+'/stop',hlsKey:null,ready:false,started:Date.now(),timer:null};
 S.play=rec;
 diagnose(kind,'vod_fallback','vodhls',0);
 playerStatus('جار فتح الفيلم من '+formatTime(at)+' بصيغة H.264 / AAC…');
 video.autoplay=true;video.muted=false;video.defaultMuted=false;video.controls=false;
 function alive(){return S.play===rec&&S.route==='player'}
 // Source duration lookup is independent of transcoding and safe before first segment.
 if(!(state.duration>0)&&!state.durationPending){
  state.durationPending=true;
  api('GET','/api/vod/'+key+'/meta',null,function(st,r){
   state.durationPending=false;
   if(!alive())return;
   if(st===200&&r&&Number(r.durationSec)>0){
    state.duration=Math.round(Number(r.durationSec));
    if(state.onDuration)state.onDuration();
    if(state.duration>=120&&state.duration<=21600&&state.mode==='vodhls'){
     var actual=Math.max(at,at+Math.max(0,video.currentTime||0));
     state.resume=Math.round(actual);
     // One-time migration from temporary streaming preview to a seekable full VOD.
     playFullVod(video,kind,id,ext,track,state.duration,state,ready);
     return
    }
   }else if(state.onDuration)state.onDuration()
  })
 }
 function fail(text){if(alive()){if(rec.timer)clearTimeout(rec.timer);playerStatus(text,true)}}
 function interrupted(detail){
  if(!alive())return;
  var current=Math.max(at,at+Math.max(0,video.currentTime||0)-1);
  var now=Date.now();
  if(!state.recoveryWindow||now-state.recoveryWindow>180000){state.recoveryWindow=now;state.recoveries=0}
  if((state.recoveries||0)>=2){
   fail('انقطع مصدر الفيديو أكثر من مرة. موضع المشاهدة محفوظ؛ ارجع ثم افتح العنوان مجددًا.');
   return
  }
  state.recoveries++;
  if(state.ready)saveResume(kind,id,current,state.duration,true);
  playerStatus('انقطع مصدر الفيديو مؤقتًا. جار استكمال المشاهدة من '+formatTime(current)+'…');
  var delay=state.recoveries*650;
  setTimeout(function(){if(alive())playVodSegments(video,kind,id,ext,track,Math.round(current),state,ready)},delay)
 }
 rec.timer=setTimeout(function(){if(alive()&&!rec.ready){diagnose(kind,'startup_timeout','video',video.readyState||0);playerStatus('الفيلم يستغرق وقتًا أطول من المتوقع للتجهيز. جار محاولة تحميل المقاطع الأولى…')}} ,18000);
 video.onerror=function(){if(!alive())return;diagnose(kind,'media_error','video',video.error&&video.error.code);interrupted('media_error')};
 video.onplaying=function(){
  if(!alive())return;
  if(state.completed&&video.currentTime<5)state.completed=false;
  rec.ready=true;if(rec.timer)clearTimeout(rec.timer);ready()
 };
 video.onwaiting=function(){if(alive()&&rec.ready)queueVodBufferNotice(video)};
 video.onended=function(){
  if(!alive())return;
  var absolute=at+Math.max(0,Number(video.currentTime)||0),
   duration=Number(state.duration)||0;
  if(!vodEndedAtRealFinish(duration,absolute,!!state.seekIncomplete)){
   // The short EVENT fallback is NOT a complete movie timeline.
   // Never claim that unknown-duration EOF equals finished viewing.
   interrupted('early_or_unverified_end');return
  }
  finishResume(kind,id);
  playerStatus('اكتملت المشاهدة')
 };
 if(shouldUseNativeHls(video)){
  video.src=manifest;try{var promise=video.play();if(promise&&promise.catch)promise.catch(function(){fail('اضغط ▶ داخل المشغّل للبدء')})}catch(e){}return
 }
 loadHls(function(ok){
  if(!alive())return;
  if(!ok||!window.Hls||!window.Hls.isSupported()){
   if(video.canPlayType&&video.canPlayType('application/vnd.apple.mpegurl')){
    video.src=manifest;try{video.play()}catch(e){};return
   }
   fail('تعذر تحميل مشغّل HLS أو المتصفح لا يدعم MSE.');return
  }
  try{
   var engine=new window.Hls({enableWorker:hlsRemuxWorkerSupported(),lowLatencyMode:false,startPosition:0,liveSyncDurationCount:4,liveMaxLatencyDurationCount:12,maxBufferLength:40,maxBufferHole:1.5,manifestLoadingTimeOut:30000,fragLoadingTimeOut:30000});
   rec.engine=engine;
   engine.on(window.Hls.Events.MANIFEST_PARSED,function(){
    if(!alive())return;try{var p=video.play();if(p&&p.catch)p.catch(function(){playerStatus('اضغط ▶ لتشغيل الفيلم')})}catch(e){}
   });
   var recovered=0;
   engine.on(window.Hls.Events.ERROR,function(event,detail){
    if(!alive()||!detail||!detail.fatal)return;
    diagnose(kind,'hls_error','video',0);
    if(recovered<2&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     recovered++;
     rec.retryTimer=setTimeout(function(){
      rec.retryTimer=null;
      if(!alive())return;
      try{engine.startLoad()}catch(e){interrupted('network_retry_failed')}
     },liveTransientRetryMs(recovered));return
    }
    if(recovered<1&&detail.type===window.Hls.ErrorTypes.MEDIA_ERROR){
     recovered++;try{engine.recoverMediaError()}catch(e){};return
    }
    interrupted(String(detail.details||detail.type).slice(0,80))
   });
   engine.attachMedia(video);engine.loadSource(manifest)
  }catch(e){fail('تعذر فتح محرك الفيلم على هذا المتصفح')}
 })
}

function playerIcon(name){
 var p={
  audio:'<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/>',
  commentary:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  timeshift:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2M3 4v5h5"/>',
  subtitles:'<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="M10 10H7.5a2 2 0 0 0 0 4H10m7-4h-2.5a2 2 0 0 0 0 4H17"/>',
  rewind:'<path d="m11 6-8 6 8 6V6Zm10 0-8 6 8 6V6Z"/>',
  forward:'<path d="m3 6 8 6-8 6V6Zm10 0 8 6-8 6V6Z"/>',
  play:'<path d="m8 5 11 7-11 7V5Z"/>',
  pause:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  previous:'<path d="M5 5v14M19 6 9 12l10 6V6Z"/>',
  next:'<path d="M19 5v14M5 6l10 6-10 6V6Z"/>',
  quality:'<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>',
  health:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.8"/>',
  favorite:'<path d="M20.8 8.3C20.8 13 12 19 12 19S3.2 13 3.2 8.3a4.6 4.6 0 0 1 8.8-1.8 4.6 4.6 0 0 1 8.8 1.8Z"/>'
 };
 return '<svg class="native-player-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">'+(p[name]||p.play)+'</svg>'
}
function playerControl(id,icon,label,primary){
 return '<button class="native-player-control'+(primary?' native-player-primary':'')+((icon==='commentary'||icon==='timeshift')?' native-player-labeled':'')+'" id="'+id+'" type="button" aria-label="'+label+'" title="'+label+'">'+playerIcon(icon)+(icon==='commentary'?'<small>المعلقين</small>':icon==='timeshift'?'<small>TimeShift</small>':'')+'</button>'
}

function openPlayer(kind,id,extension,name,from,replacePlayerHistory){
 var item=findItem(kind,id)||S.item&&S.item.data,ext=String(extension||item&&item.container_extension||(kind==='live'?'ts':'mp4')).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8);
 if(['ts','mp4','mkv','avi','mov'].indexOf(ext)<0)ext=kind==='live'?'ts':'mp4';
 var explicitStart=from!==undefined&&from!==null&&from!=='';var initial=Math.max(0,Number(from)||0),isLive=kind==='live',prior=getResume(kind,id),resume=explicitStart?initial:(prior&&prior.position||0);
 // The preview and fullscreen player share one upstream media-worker HLS key.
 // Never send asynchronous /stop for that key after starting fullscreen:
 // late /stop responses would kill the newly opened FFmpeg session.
 var oldPreview=S.play,fullKey='live/'+id+'/ts/0';
 if(isLive&&oldPreview&&oldPreview.preview&&(
  oldPreview.hlsKey===fullKey||oldPreview.hlsKey===fullKey+'/compat'||
  (oldPreview.hlsKey||'').indexOf(fullKey+'/sid-')===0)){
  if(S.previewToFullPending)return;
  S.previewToFullPending=true;
  var expectedRoute=S.route,expectedId=String(id);
  var previewStopKey=oldPreview.hlsKey;
  var previewStatus=document.getElementById('live-status');
  if(previewStatus)previewStatus.textContent='جار نقل القناة إلى المشغّل الكامل…';
  stopPlayback(false);
  var promotionSettled=false,promotionTimer=null;
  function promotionComplete(status){
   if(promotionSettled)return;
   promotionSettled=true;
   if(promotionTimer)clearTimeout(promotionTimer);
   S.previewToFullPending=false;
   if(S.route!==expectedRoute||!S.userVerified||String(S.selected)!==expectedId)return;
   if(status===200||status===404){
    openPlayer(kind,id,extension,name,from,replacePlayerHistory)
   }else{
    if(previewStatus)previewStatus.textContent='تعذر إغلاق المعاينة السابقة بأمان؛ أعد محاولة فتح القناة.'
   }
  }
  promotionTimer=setTimeout(function(){promotionComplete(0)},6500);
  api('POST','/api/hls/'+previewStopKey+'/stop',{},function(status){promotionComplete(status)});
  return
 }
 var detail=S.detailInfo&&S.detailInfo.kind===kind&&S.detailInfo.id===id?S.detailInfo.info:
  (kind==='series'&&S.episodes&&S.episodes.info||null);
 var overview=String(detail&&(detail.plot||detail.description)||item&&(item.plot||item.description)||'').trim().slice(0,950);
 var attributes=detail?[detail.genre||detail.genres||'',detail.releaseDate||detail.release_date||'',detail.rating||''].filter(Boolean).join(' • '):'';
 var nextEpisode=null,previousEpisode=null;
 if(kind==='series'&&S.episodes&&S.episodes.episodes){
  var episodeList=parseEpisodes(S.episodes).sort(function(a,b){return Number(a.__season)-Number(b.__season)||Number(a.episode_num||0)-Number(b.episode_num||0)});
  for(var ix=0;ix<episodeList.length;ix++)if(String(episodeList[ix].id)===String(id)){
   if(ix>0)previousEpisode=episodeList[ix-1];
   if(ix+1<episodeList.length)nextEpisode=episodeList[ix+1];
   break
  }
 }
 rememberView();S.previousBeforePlayer={route:S.route,kind:kind,id:id};
 if(replacePlayerHistory){
  try{window.history.replaceState({blofyStreamWeb:true,depth:browserDepth,route:'player',
   opts:{kind:kind,id:id,extension:ext,name:name,from:resume}},'',window.location.href)}catch(err){}
 }else pushBrowserStep('player',{kind:kind,id:id,extension:ext,name:name,from:resume});
 S.route='player';
 showWebShellUpdateHint();
 app.innerHTML='<section class="player-overlay" id="player-root"><video id="player-media" autoplay playsinline webkit-playsinline tabindex="0" aria-label="مشغّل الفيديو"></video>'+
 '<div class="player-audio-notice" id="player-audio-notice" role="status" aria-live="polite" hidden></div>'+
 '<div class="player-loading" id="player-status" role="status">'+(isLive?'جار تشغيل القناة…':'جار تجهيز المشغّل…')+'</div>'+
 '<div class="mobile-seek-feedback" id="mobile-seek-feedback" hidden role="status" aria-live="polite"></div>'+
 '<button class="btn secondary player-retry" id="player-retry" style="display:none">⟳ إعادة المحاولة</button>'+
 '<div class="player-hud native-stream-hud">'+
 '<div class="native-player-topline"><button class="native-player-back" id="player-back" type="button">↶ رجوع</button>'+
 '<span class="native-player-eyebrow">BLOFY '+(isLive?'LIVE':kind==='series'?'SERIES':'CINEMA')+'</span>'+
 (isLive?'<button class="native-player-channels" id="player-channels-toggle" type="button" aria-label="قائمة القنوات">☷ القنوات</button>':'')+
 '<button class="native-player-fullscreen" id="player-fullscreen" type="button" aria-label="ملء الشاشة" aria-pressed="false" title="ملء الشاشة">⛶ ملء الشاشة</button>'+ 
 '<button class="native-player-more" id="player-options-toggle" type="button" aria-expanded="false" aria-controls="player-more-panel" aria-label="المزيد من الخيارات" title="المزيد من الخيارات">⋯</button></div>'+
 '<div class="player-title"><span id="player-title-text">'+esc(name||title(item))+'</span> <span class="player-mode-badge" id="player-mode-badge" aria-live="polite">'+(isLive?'بث مباشر':'جار تجهيز الفيديو')+'</span><span class="player-resolution-badge" id="player-resolution" aria-live="polite" hidden></span><span class="player-resolution-badge" id="player-source-mode" aria-live="polite" hidden></span></div>'+
 (isLive?'<section class="player-live-guide" aria-label="برنامج القناة"><span class="small">دليل البرامج</span><div id="player-live-epg" role="status" aria-live="polite">جار قراءة دليل القناة…</div></section>':
 '<div class="native-player-timeline" dir="ltr"><span id="now-time">00:00</span><input id="seek" type="range" min="0" max="1000" value="0" step="1" class="seek-line" disabled aria-label="موضع التشغيل"><span id="total-time">--:--</span></div>')+
 '<div id="player-control-hint" class="native-player-hint" aria-live="polite">'+
 (document.documentElement.getAttribute('data-blofy-device')==='touch'?
  'المس الصورة لإظهار أو إخفاء أدوات التحكم':isLive?'MENU / ↑ الصوتيات • OK القنوات':'')+'</div>'+
 '<div class="mobile-player-actions" id="mobile-player-actions" role="toolbar" aria-label="تحكم سريع باللمس">'+
 '<button class="mobile-player-action" type="button" id="mobile-player-previous" aria-label="'+
 (isLive?'القناة السابقة':previousEpisode?'الحلقة السابقة':'رجوع عشر ثوانٍ')+'">'+
 '<span aria-hidden="true">⏮</span><small>'+(isLive?'قناة سابقة':previousEpisode?'الحلقة السابقة':'−10 ثوانٍ')+'</small></button>'+
 '<button class="mobile-player-action mobile-player-primary" type="button" id="mobile-player-toggle" aria-label="إيقاف مؤقت">'+
 '<span aria-hidden="true" id="mobile-player-toggle-icon">Ⅱ</span><small id="mobile-player-toggle-label">إيقاف</small></button>'+
 '<button class="mobile-player-action" type="button" id="mobile-player-next" aria-label="'+
 (isLive?'القناة التالية':nextEpisode?'الحلقة التالية':'تقديم عشر ثوانٍ')+'">'+
 '<span aria-hidden="true">⏭</span><small>'+(isLive?'قناة تالية':nextEpisode?'الحلقة التالية':'+10 ثوانٍ')+'</small></button>'+
 '<button class="mobile-player-action" type="button" id="mobile-player-fullscreen" aria-label="ملء الشاشة">'+
 '<span aria-hidden="true">⛶</span><small>ملء الشاشة</small></button>'+
 (isLive?'<button class="mobile-player-action" type="button" id="mobile-player-timing" aria-label="تقديم وتأخير البث"><span aria-hidden="true">↶</span><small>توقيت البث</small></button>':'')+'</div>'+
 '<div class="player-actions native-player-dock" dir="ltr" role="toolbar" aria-label="أزرار مشغّل BLOFY STREAM">'+
 playerControl('player-audio','audio','المسارات الصوتية')+
 (isLive?playerControl('player-commentary','commentary','المعلقين')+playerControl('player-timeshift','timeshift','TimeShift • تقديم وتأخير البث'):'')+
 playerControl('player-subtitles','subtitles','الترجمة')+
 (previousEpisode?playerControl('player-previous-episode','previous','الحلقة السابقة'):'')+
 (isLive?playerControl('player-channel-prev','previous','القناة السابقة'):playerControl('player-skip-back','rewind','رجوع 10 ثوانٍ'))+
 playerControl('player-toggle','pause','إيقاف مؤقت',true)+
 (isLive?playerControl('player-channel-next','next','القناة التالية'):playerControl('player-skip-forward','forward','تقديم 10 ثوانٍ'))+
 (nextEpisode?playerControl('player-next-episode','next','الحلقة التالية'):'')+
 playerControl('player-quality','quality','جودة الفيديو')+
 (kind==='series'?'':playerControl('player-favorite','favorite','إضافة إلى المفضلة'))+
 '</div>'+
 '<section class="player-more-panel" id="player-more-panel" hidden aria-label="خيارات إضافية">'+
 (isLive?'':'<button class="btn secondary" id="player-skip-forward5">+5 دقائق</button><button class="btn secondary" id="player-jump-toggle" aria-controls="player-jump-panel" aria-expanded="false">↪ الانتقال لدقيقة</button><button class="btn secondary" id="player-restart">↺ من البداية</button><button class="btn secondary" id="player-speed"'+(isLive?' hidden disabled':'')+'>السرعة 1×</button>')+

 (isLive?'<button class="btn secondary" id="player-commentary-more" type="button">المعلقين</button><button class="btn secondary" id="player-live-buffer" type="button">توقيت البث</button><button class="btn secondary" id="player-external" type="button">تشغيل خارجي</button><button class="btn secondary" id="player-guide-toggle" type="button" aria-expanded="false">دليل البرامج</button>':'')+
 (isLive?'':'<button class="btn secondary" id="player-info-toggle" aria-expanded="false" aria-controls="player-info-panel">ⓘ معلومات المحتوى</button>')+'</section>'+
 (isLive?'':'<section class="player-info-panel" id="player-info-panel" hidden><strong>تفاصيل المحتوى</strong>'+
 (attributes?'<div class="player-info-meta">'+esc(attributes)+'</div>':'')+'<p>'+esc(overview||'لا يتوفر وصف تفصيلي من مصدر المحتوى حاليًا.')+'</p></section>')+
 '<section class="player-health-panel" id="player-health-panel" hidden role="status" aria-live="off"></section>'+
 (isLive?'<section class="player-diagnostic-panel" id="player-diagnostic-panel" hidden role="status" aria-live="off"></section>':'')+
 (isLive?'':'<form class="player-jump-panel" id="player-jump-panel" hidden><label for="player-jump-minute">الانتقال إلى الدقيقة (0–359)</label>'+
 '<input id="player-jump-minute" type="number" inputmode="numeric" min="0" max="359" step="1" required placeholder="مثلاً 10">'+
 '<button class="btn" type="submit">انتقال</button><button class="btn secondary" type="button" id="player-jump-cancel">إلغاء</button>'+
 '<small>القفز يعتمد على دعم المصدر للقراءة العشوائية؛ بعض مصادر Xtream قد لا تسمح به.</small></form>')+
 '</div>'+ (isLive?'<aside id="player-channel-panel" class="native-channel-panel" hidden aria-label="قائمة القنوات"></aside>':'')+'</section>';
 var video=document.getElementById('player-media'),state={kind:kind,id:id,ext:ext,video:video,name:name,offset:0,
 mode:isLive?'hls':'direct',resume:resume,duration:knownDuration(kind,id,item),didResume:false,ready:false,track:0,lastSaved:0,
  art:art(item)||prior&&prior.art||'',seriesId:kind==='series'&&S.item&&S.item.id||'',playbackId:freshPlaybackId(),
   stats:{openedAt:Date.now(),firstFrameAt:0,bufferEvents:0,bufferMs:0,bufferSince:0,errors:0,recoveries:0,lastRecoveryAt:0,liveEvents:[],
    visualOutageCount:0,visualOutageMs:0,longestVisualOutageMs:0,
    visualOutageByEngine:{hls:{count:0,ms:0},mpegts:{count:0,ms:0}},
    seekAttempts:0,seekReady:0,verifiedSeekFrames:0,seekTimeouts:0,lastSeekMs:null}};
 video.style.objectFit=pictureFitMode(readJson(profileStorageKey('pictureFit'),'fit'));
 // The 20-minute acceptance uses existing decoded-frame and source health
 // observations. It never opens a new media, catalog or telemetry request.
 // Monotonic time avoids TV system-clock/date problems.
 var acceptance=window.BlofyPlaybackAcceptance||null,
  verifyButton=document.getElementById('player-verify-20m'),
  verifyStatus=document.getElementById('player-verify-status');
 function acceptanceClock(){
  return window.performance&&typeof window.performance.now==='function'?
   window.performance.now():Date.now()
 }
 function acceptanceSnapshot(){
  var frames=null,rec=S.play&&S.play.video===video?S.play:null,quality=null;
  try{quality=video.getVideoPlaybackQuality&&video.getVideoPlaybackQuality()}catch(e){}
  if(quality&&isFinite(Number(quality.totalVideoFrames))&&Number(quality.totalVideoFrames)>0)
   frames=Number(quality.totalVideoFrames);
  var presented=rec&&rec.framePresentationObserved?Number(rec.presentedFrames)||0:null;
  var bufferMs=(state.stats.bufferMs||0)+(state.stats.bufferSince?
   Math.max(0,Date.now()-state.stats.bufferSince):0);
  return {
   at:acceptanceClock(),playing:!video.paused&&!video.ended&&video.readyState>=2,
   hidden:document.hidden===true,width:Number(video.videoWidth)||0,height:Number(video.videoHeight)||0,
   frames:frames,presented:presented,time:video.currentTime,
   errors:state.stats.errors||0,recoveries:state.stats.recoveries||0,bufferMs:bufferMs
  }
 }
 function acceptanceFinish(result){
  if(!result||!state.longTest)return;
  if(state.longTestTimer){clearInterval(state.longTestTimer);state.longTestTimer=null}
  state.longTest=null;
  if(verifyButton)verifyButton.textContent='◷ بدء اختبار 20 دقيقة';
  var saved={kind:result.kind,status:result.status,reason:result.reason,
   elapsedSeconds:result.elapsedSeconds,videoFramesObserved:result.videoFramesObserved,
   timeProgressObserved:result.timeProgressObserved,bufferingSeconds:result.bufferingSeconds,
   samples:result.samples,finishedAt:Date.now()};
  S.lastLongPlaybackTest=saved;profileSave('lastLongPlaybackTest',saved);
  var msg=acceptance?acceptance.message(result):'اكتمل الاختبار';
  if(verifyStatus)verifyStatus.textContent=msg;
  if(S.route==='player'&&S.playerView===state)playerStatus(msg,false)
 }
 function sampleAcceptance(){
  if(!state.longTest||!acceptance)return;
  if(S.route!=='player'||S.playerView!==state||!video.isConnected){
   acceptanceFinish(acceptance.stop(state.longTest,acceptanceClock()));return
  }
  var result=acceptance.tick(state.longTest,acceptanceSnapshot());
  if(result){acceptanceFinish(result);return}
  var seconds=Math.max(0,Math.round((acceptanceClock()-state.longTest.startedAt)/1000));
  if(verifyStatus)verifyStatus.textContent='جار فحص تشغيل الصورة: '+formatTime(seconds)+
   ' من 00:20:00 • بدون طلبات فيديو إضافية. يمكن إيقاف الفحص من الزر نفسه.'
 }
 state.stopLongTest=function(){
  if(!state.longTest||!acceptance)return;
  acceptanceFinish(acceptance.stop(state.longTest,acceptanceClock()))
 };
 if(verifyButton)verifyButton.onclick=function(){
  if(state.longTest){state.stopLongTest();return}
  if(!acceptance||!S.userVerified||S.route!=='player'||S.playerView!==state){
   if(verifyStatus)verifyStatus.textContent='الفحص غير متاح لهذا المشغل.';return
  }
  try{
   var now=acceptanceClock(),snap=acceptanceSnapshot();
   if(!state.ready||!snap.playing||!snap.width||!snap.height)
    throw Error('not_ready');
   state.longTest=acceptance.init(kind,now,snap);
   verifyButton.textContent='■ إنهاء اختبار 20 دقيقة';
   if(verifyStatus)verifyStatus.textContent='بدأ فحص الصورة المستمر. حافظ على تشغيل القناة وعدم إخفاء الصفحة لمدة 20 دقيقة.';
   state.longTestTimer=setInterval(sampleAcceptance,2000);
   sampleAcceptance()
  }catch(e){
   if(verifyStatus)verifyStatus.textContent='ابدأ تشغيل الفيديو حتى تظهر الصورة أولًا، ثم شغّل اختبار 20 دقيقة.'
  }
 };
 var toggle=document.getElementById('player-toggle'),mobilePlay=document.getElementById('mobile-player-toggle');
 function syncToggle(){
  var paused=video.paused,label=paused?'تشغيل':'إيقاف مؤقت';
  if(toggle){
   toggle.innerHTML=playerIcon(paused?'play':'pause');
   toggle.setAttribute('aria-label',label);toggle.title=label
  }
  if(mobilePlay){
   mobilePlay.setAttribute('aria-label',label);
   var icon=document.getElementById('mobile-player-toggle-icon');
   var title=document.getElementById('mobile-player-toggle-label');
   if(icon)icon.textContent=paused?'▶':'Ⅱ';
   if(title)title.textContent=paused?'تشغيل':'إيقاف'
  }
 }
 video.addEventListener('play',syncToggle);
 video.addEventListener('pause',syncToggle);
 syncToggle();

 var moreToggle=document.getElementById('player-options-toggle');
 if(moreToggle)moreToggle.onclick=function(){
  var panel=document.getElementById('player-more-panel');
  if(!panel)return;
  panel.hidden=!panel.hidden;this.setAttribute('aria-expanded',String(!panel.hidden))
 };
 var externalButton=document.getElementById('player-external');
 if(externalButton)externalButton.onclick=function(){
  if(S.route!=='player'||S.playerView!==state||state.externalPending||state.liveHlsHandoff)return;
  var opts=[];
  if(typeof video.webkitShowPlaybackTargetPicker==='function')opts.push({name:'AirPlay',select:function(){video.webkitShowPlaybackTargetPicker()}});
  if(document.pictureInPictureEnabled&&video.requestPictureInPicture)opts.push({name:'صورة داخل صورة',select:function(){var p=video.requestPictureInPicture();if(p&&p.catch)p.catch(function(){playerStatus('الصورة داخل صورة غير متاحة الآن.')})}});
  else if(video.webkitSetPresentationMode&&video.webkitSupportsPresentationMode&&video.webkitSupportsPresentationMode('picture-in-picture'))
   opts.push({name:'صورة داخل صورة',select:function(){video.webkitSetPresentationMode('picture-in-picture')}});
  opts.push({name:'VLC / مشغل خارجي',select:function(){
   // Leave current playback before issuing a different stream; never open
   // two connections intentionally or expose subscriber credentials.
   if(state.externalPending)return;
   var record=S.play,selected=String(state.id),stop=record&&(record.stopUrl||(record.hlsKey&&'/api/hls/'+record.hlsKey+'/stop'));
   state.externalPending=true;state.userPaused=true;
   if(state.stopCommentary)state.stopCommentary();
   stopPlayback(false);
   function issue(){
    if(S.playerView!==state||S.route!=='player'||String(state.id)!==selected){state.externalPending=false;return}
    api('POST','/api/external/live',{id:selected},function(st,data){
     state.externalPending=false;
     if(S.playerView!==state||S.route!=='player'||String(state.id)!==selected)return;
     if(st!==200||!data||!/^\/external\/live\/[A-Za-z0-9_-]{43}\.ts$/.test(data.path)){playerStatus('تعذر تجهيز المشغل الخارجي. أعد فتح القناة.',true);return}
     var url=window.location.protocol+'//'+window.location.host+data.path;
     playerStatus('تم إيقاف المشغل الداخلي. الرابط صالح لمدة دقيقتين.');
     showPlayerChoices('التشغيل الخارجي — استخدام واحد',[
      {name:'فتح في VLC',select:function(){
       var ua=navigator.userAgent||'';
       if(/iPhone|iPad|iPod/i.test(ua)||appleTouchBrowser(ua,navigator.maxTouchPoints))window.location.href='vlc://'+url;
       else if(/Android/i.test(ua))window.location.href='intent://'+url.replace(/^https:\/\//,'')+'#Intent;scheme=https;package=org.videolan.vlc;type=video/mp2t;end';
       else window.prompt('انسخ الرابط وافتحه في VLC عبر فتح تدفق شبكة',url)
      }},
      {name:'نسخ الرابط لمشغل خارجي',select:function(){
       if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(url).catch(function(){window.prompt('انسخ الرابط',url)});
       else window.prompt('انسخ الرابط',url)
      }}
     ],externalButton)
    })
   }
   if(stop)api('POST',stop,{},function(st){
    if(st===200||st===404)issue();
    else{state.externalPending=false;if(S.playerView===state)playerStatus('تعذر إغلاق جلسة البث السابقة. أعد فتح القناة.',true)}
   });else issue()
  }});
  showPlayerChoices('التشغيل الخارجي',opts,externalButton)
 };
 var guideToggle=document.getElementById('player-guide-toggle');
 if(guideToggle)guideToggle.onclick=function(){var guide=document.querySelector('.player-live-guide');if(guide){var show=guide.classList.toggle('phone-guide-open');this.setAttribute('aria-expanded',String(show));if(show){if(state.refreshLiveGuide)state.refreshLiveGuide();if(moreToggle)moreToggle.click()}revealControls()}};
 var controlHint=document.getElementById('player-control-hint'),dock=document.querySelector('.native-player-dock');
 if(dock&&controlHint){
  dock.addEventListener('focusin',function(e){
   var label=e.target&&e.target.getAttribute('aria-label');
   if(label)controlHint.textContent=label
  });
  dock.addEventListener('pointerover',function(e){
   var button=e.target&&e.target.closest&&e.target.closest('.native-player-control');
   if(button)controlHint.textContent=button.getAttribute('aria-label')||''
  },{passive:true})
 }
 var favoriteButton=document.getElementById('player-favorite');
 function refreshFavoriteButton(){
  if(!favoriteButton)return;
  var marked=!!S.library[kind+':'+state.id];
  favoriteButton.classList.toggle('native-player-liked',marked);
  favoriteButton.setAttribute('aria-pressed',String(marked));
  favoriteButton.setAttribute('aria-label',marked?'إزالة من المفضلة':'إضافة إلى المفضلة');
  favoriteButton.title=marked?'إزالة من المفضلة':'إضافة إلى المفضلة'
 }
 state.refreshFavoriteButton=refreshFavoriteButton;
 if(favoriteButton)favoriteButton.onclick=function(){
  var key=kind+':'+state.id,wasMarked=!!S.library[key],choice=findItem(kind,state.id)||item;
  if(wasMarked){delete S.library[key];delete S.favoriteItems[key]}
  else{
   S.library[key]=true;
   var record={id:String(state.id),name:String(state.name||title(choice)).slice(0,160),
    stream_icon:art(choice),container_extension:choice&&choice.container_extension||'mp4'};
   if(kind==='series')record.series_id=String(state.id);else record.stream_id=String(state.id);
   S.favoriteItems[key]=record
  }
  profileSave('favorites',S.library);
  profileSave('favoriteItems',S.favoriteItems);
  refreshFavoriteButton();
  if(controlHint)controlHint.textContent=wasMarked?'تمت الإزالة من المفضلة':'تمت الإضافة إلى المفضلة'
 };
 refreshFavoriteButton();
 var qualityButton=document.getElementById('player-quality');
 if(qualityButton)qualityButton.onclick=function(){
  var engine=S.play&&S.play.engine,levels=engine&&engine.levels||[];
  if(!engine||!levels.length){playerStatus('المصدر يحدد جودة الفيديو؛ لا توجد دقات متعددة قابلة للاختيار.');return}
  var current=Number(engine.currentLevel),next=current<0?0:current+1;
  if(next>=levels.length)next=-1;
  try{engine.currentLevel=next}catch(err){playerStatus('تعذر تغيير جودة هذا المصدر.');return}
  var level=next>=0?levels[next]:null,quality=next===-1?'جودة تلقائية':('جودة '+(level.height?level.height+'p':'المستوى '+(next+1)));
  playerStatus(quality);qualityButton.title=quality
 };
 var infoToggle=document.getElementById('player-info-toggle');
 if(infoToggle)infoToggle.onclick=function(){
  var panel=document.getElementById('player-info-panel');if(!panel)return;
  panel.hidden=!panel.hidden;this.setAttribute('aria-expanded',String(!panel.hidden))
 };
 function renderPlayerHealth(){
  if(S.route!=='player'||S.playerView!==state)return;
  var box=document.getElementById('player-health-panel');
  if(!box||box.hidden)return;
  var st=state.stats,now=Date.now();
  var startup=st.firstFrameAt?Math.max(0,st.firstFrameAt-st.openedAt):null;
  var buffering=(st.bufferMs||0)+(st.bufferSince?Math.max(0,now-st.bufferSince):0);
  var modes={fullvod:'فيلم كامل قابل للتقديم',direct:'MP4 أصلي',vodhls:'HLS مؤقت',
   hls:'بث مباشر',mpegts:'MPEG-TS'};
  var mode=modes[state.mode]||'جار تغيير المحرك',pending=state.pendingSeek;
  var liveVideoMode=isLive&&S.play&&S.play.video===video?S.play.videoMode:'';
  var videoPath=isLive?(liveVideoMode==='source_copy'?'أصلي دون إعادة ترميز':liveVideoMode==='ultra_transcode'?'تحويل 4K تجريبي':liveVideoMode==='compatibility_transcode'?'توافق مع إعادة ترميز':'جار تحديد المسار'):'غير مطبق';
  var width=Math.max(0,Number(video.videoWidth)||0),height=Math.max(0,Number(video.videoHeight)||0);
  var screenQuality=width&&height?(width+'×'+height+' (دقة الفيديو المعروضة)'):'بانتظار بيانات الدقة';
  var sourceQuality=isLive&&S.play&&S.play.video===video?S.play.sourceDimensions||'غير محدد':'غير مطبق';
  var frames=video.getVideoPlaybackQuality&&video.getVideoPlaybackQuality();
  var dropped=frames&&Number.isFinite(frames.droppedVideoFrames)?frames.droppedVideoFrames:null;
  var droppedPct=dropped!==null&&frames&&Number(frames.totalVideoFrames)>0?
   Math.min(100,100*dropped/Number(frames.totalVideoFrames)).toFixed(2)+'٪':null;
  var estimate=S.play&&S.play.video===video&&S.play.engine?Number(S.play.engine.bandwidthEstimate)||0:0;
  var bitrate=estimate>100000&&estimate<1e10?(estimate/1000000).toFixed(1)+' Mbps':'غير متوفر';
  var liveRecord=isLive&&S.play&&S.play.video===video?S.play:null;
  var recentSegment=liveRecord&&liveRecord.engine?
   (liveRecord.lastFragmentAt?Math.round((now-liveRecord.lastFragmentAt)/1000)+' ثانية':'بانتظار أول مقطع'):
   'غير متاح بالمشغل الأصلي';
  var lastPresented=liveRecord&&liveRecord.framePresentationObserved?
   Math.round((now-liveRecord.lastPresentedFrameAt)/1000)+' ثانية':
   'غير متاح على هذا الجهاز';
  var uptime=formatTime(Math.max(0,(now-st.openedAt)/1000));
  var status4k=height>=4300&&width>=7600?'8K معروض فعليًا':height>=2100&&width>=3800?'4K معروض فعليًا':
   'الدقة تعتمد على المصدر والجهاز';
  var currentHint=isLive?liveCauseHint(liveRecord,video,st,now,!!state.userPaused,document.hidden):null;
  var metrics=[
   ['الصورة الفعلية',screenQuality],
   ['دقة المصدر',sourceQuality],
   ['مسار الصورة',videoPath],
   ['زمن تشغيل الجلسة',uptime],
   ['انتظارات التخزين',(st.bufferEvents||0)+' مرة / '+Math.round(buffering/1000)+' ثانية'],
   ['إطارات ساقطة',dropped===null?'غير متاح':dropped+(droppedPct?' / '+droppedPct:'')],
   ['سرعة التشغيل',(Number(video.playbackRate)||1).toFixed(2)+'×'],
   ['سرعة شبكة مقدّرة',bitrate],
   ['آخر مقطع HLS',recentSegment],
   ['آخر إطار معروض',lastPresented],
   ['بدء الصورة',startup===null?'لم يؤكد الجهاز أول إطار':(startup/1000).toFixed(1)+' ثانية • '+(st.firstFrameBasis==='presented'?'معروض':'مفكوك')],
   ['أخطاء المشغل',String(st.errors||0)],
   ['استعادات تلقائية',String(st.recoveries||0)]
  ];
  if(isLive){
   var byEngine=st.visualOutageByEngine||{};
   metrics.push(['محرك التشغيل الحالي',state.mode==='mpegts'?'MPEG-TS مباشر':
    liveRecord&&liveRecord.engine?'HLS.js':'HLS أصلي']);
   metrics.push(['انقطاعات الصورة المرصودة',(st.visualOutageCount||0)+' مرة / '+Math.round((st.visualOutageMs||0)/1000)+' ثانية']);
   metrics.push(['أطول انقطاع بالصورة',Math.round((st.longestVisualOutageMs||0)/1000)+' ثانية']);
   metrics.push(['الانقطاعات حسب المحرك','HLS '+((byEngine.hls||{}).count||0)+' / MPEG-TS '+((byEngine.mpegts||{}).count||0)]);
   metrics.push(['مؤشر سبب التقطيع',currentHint.title]);
  }
  box.innerHTML='<div class="playback-health-head"><strong>مراقبة جودة BLOFY المباشرة</strong>'+
   '<small>'+esc(status4k)+' • قياسات حقيقية وليست اسم القناة</small></div>'+
   '<div class="playback-health-grid">'+metrics.map(function(m){
    return '<div class="playback-health-metric"><span>'+esc(m[0])+'</span><strong>'+esc(m[1])+'</strong></div>'
   }).join('')+'</div>'+
   (isLive&&currentHint?'<p class="playback-health-note">'+esc(currentHint.detail)+' • قراءة احتمالية من المشغل وليست تأكيدًا للسبب.</p>':'')+
   (!isLive?'<p class="playback-health-note">التقديم: '+(st.seekReady||0)+' من '+(st.seekAttempts||0)+
   ' • مؤكد بالصورة: '+(st.verifiedSeekFrames||0)+'</p>':'')+
   (pending?'<p class="playback-health-note">جار الوصول إلى '+esc(formatTime(pending.target))+'</p>':'');
 }
 // A redacted diagnostic snapshot that never includes stream URLs, host,
 // account identifiers, codes or auth tokens. Useful for remote TV screenshots.
 function playbackDiagnosticSnapshot(){
  var now=Date.now(),r=S.play&&S.play.video===video?S.play:null,st=state.stats;
  var w=Math.max(0,Number(video.videoWidth)||0),h=Math.max(0,Number(video.videoHeight)||0);
  var frames=null,drops=null;
  try{
   var q=video.getVideoPlaybackQuality&&video.getVideoPlaybackQuality();
   if(q){frames=Number(q.totalVideoFrames);drops=Number(q.droppedVideoFrames)}
  }catch(e){}
  var ms=r&&r.lastFragmentAt?Math.max(0,now-r.lastFragmentAt):null;
  var idle=r&&r.lastProgressAt?Math.max(0,now-r.lastProgressAt):null;
  var evidence=state.kind==='live'?liveCauseHint(r,video,st,now,!!state.userPaused,document.hidden):null;
  var assessment=evidence?evidence.title+' — '+evidence.detail:
   'النتيجة تخص بث الفيديو المباشر فقط؛ لا يمكن تحديد سبب الانقطاع هنا.';
  var mode=r&&r.videoMode==='source_copy'?'أصلي دون إعادة ضغط':r&&r.videoMode==='ultra_transcode'?'تحويل 4K تجريبي':
   r&&r.videoMode==='compatibility_transcode'?'وضع توافق':'غير معروف';
  return [
   'BLOFY STREAM • تقرير فحص آمن',
   'وقت التقرير: '+new Date(now).toISOString(),
   'مدة الجلسة: '+formatTime((now-st.openedAt)/1000),
   'دقة الفيديو المعروضة: '+(w&&h?w+'×'+h:'غير متوفرة'),
   'دقة المصدر: '+(r&&r.sourceDimensions||'غير متوفرة'),
   'المعالجة: '+mode,
   'محرك التشغيل: '+(state.mode==='mpegts'?'MPEG-TS مباشر':r&&r.engine?'HLS.js':state.mode==='direct'?'MP4 أصلي':'HLS أصلي على الجهاز'),
   'آخر مقطع HLS: '+(r&&r.engine?(ms===null?'غير مرصود':Math.round(ms/1000)+' ثانية'):'غير متوفر في المحرك الأصلي'),
   'آخر تقدم للصورة: '+(idle===null?'غير مرصود':Math.round(idle/1000)+' ثانية'),
   'آخر إطار معروض على الشاشة: '+(r&&r.framePresentationObserved?Math.round((now-r.lastPresentedFrameAt)/1000)+' ثانية':'غير مدعوم'),
   'عدد الإطارات المعروضة المرصودة: '+(r&&r.presentedFrames||0),
   'الإطارات: '+(Number.isFinite(frames)?frames:'غير متوفرة')+
    ' • الساقطة: '+(Number.isFinite(drops)?drops:'غير متوفرة'),
   'إعادة الاتصال: '+(st.recoveries||0)+' • أخطاء الفيديو: '+(st.errors||0),
   'انتظار التخزين: '+(st.bufferEvents||0)+' مرة',
   'فترات غياب تقدم الصورة المرصودة: '+(st.visualOutageCount||0)+
     ' • مجموعها التقريبي: '+Math.round((st.visualOutageMs||0)/1000)+' ثانية'+
     ' • الأطول: '+Math.round((st.longestVisualOutageMs||0)/1000)+' ثانية',
   'حسب المحرك: HLS '+(((st.visualOutageByEngine||{}).hls||{}).count||0)+
     ' مرة / '+Math.round(((((st.visualOutageByEngine||{}).hls||{}).ms)||0)/1000)+' ثانية'+
     ' • MPEG-TS '+(((st.visualOutageByEngine||{}).mpegts||{}).count||0)+
     ' مرة / '+Math.round(((((st.visualOutageByEngine||{}).mpegts||{}).ms)||0)/1000)+' ثانية',
   'آخر أحداث البث (وقت UTC):'+(st.liveEvents&&st.liveEvents.length?
    st.liveEvents.slice(-6).map(function(item){
     var labels={playing:'بدأت الصورة',buffering:'انتظار الفيديو',decoder_paused:'توقف المشغل',
      picture_freeze:'تجمد الصورة',picture_missing:'الصورة غير ظاهرة',reconnect:'استعادة الاتصال',decoder_error:'فك الترميز',
      source_error:'المصدر',encoder_capacity:'ازدحام المعالجة',
      live_edge_resync:'العودة للبث المباشر',live_catchup:'تسريع اللحاق بالبث',channel_switch:'تغيير القناة'};
     return ' '+new Date(item.at).toISOString().slice(11,19)+' '+(labels[item.code]||'تشغيل')
    }).join(' ؛ '):' لا توجد أحداث مسجلة'),
   'النتيجة الأولية: '+assessment,
   'ملاحظة: مدة غياب تقدم الصورة تقديرية من العينات، ولا تشمل بدء التشغيل أو فترات توقف المستخدم؛ التقرير يستبعد بيانات الاشتراك والروابط.'
  ].join(String.fromCharCode(10))
 }
 var diagnosticToggle=document.getElementById('player-diagnostic-toggle');
 if(diagnosticToggle)diagnosticToggle.onclick=function(){
  var panel=document.getElementById('player-diagnostic-panel');if(!panel)return;
  panel.hidden=!panel.hidden;
  diagnosticToggle.setAttribute('aria-expanded',String(!panel.hidden));
  if(!panel.hidden){
   panel.textContent=playbackDiagnosticSnapshot();
   root.classList.remove('controls-hidden')
  }
 };
 var healthToggle=document.getElementById('player-health-toggle');
 var healthShortcut=document.getElementById('player-health-shortcut');
 if(healthShortcut)healthShortcut.onclick=function(){
  if(healthToggle)healthToggle.click();
  root.classList.remove('controls-hidden');
 };
 if(healthToggle)healthToggle.onclick=function(){
  var box=document.getElementById('player-health-panel');if(!box)return;
  box.hidden=!box.hidden;
  this.setAttribute('aria-expanded',String(!box.hidden));
  if(state.healthTimer){clearInterval(state.healthTimer);state.healthTimer=null}
  if(!box.hidden){
   renderPlayerHealth();
   state.healthTimer=setInterval(renderPlayerHealth,1700)
  }
 };
 /* Count the *first actual decoded/presented video frame*, not an audio-only
  * HTMLMediaElement 'playing' event. An audio clock can move with a black
  * screen; claiming a fast picture before decoded pixels is misleading.
  * Some older TVs expose neither requestVideoFrameCallback nor decoded
  * frame counters; those devices explicitly report an unavailable metric.
  */
 function noteFirstPicture(basis){
  if(S.route!=='player'||S.playerView!==state||state.stats.firstFrameAt||
     !video.isConnected||!video.videoWidth||!video.videoHeight)return;
  state.stats.firstFrameAt=Date.now();
  state.stats.firstFrameBasis=basis;
  var elapsed=Math.round(state.stats.firstFrameAt-Number(state.stats.openedAt||0));
  if(elapsed>=0&&elapsed<=120000&&S.userVerified){
   api('POST','/api/player-diagnostic',{kind:state.kind,mode:state.mode||'direct',phase:'first_picture',runtime:installedWebApp()?'installed':'browser',errorCode:0,firstPictureMs:elapsed,pictureBasis:basis},function(){})
  }
  if(state.firstPictureWatchTimer){clearInterval(state.firstPictureWatchTimer);state.firstPictureWatchTimer=null}
  if(state.firstPictureFrameId!==null&&state.firstPictureFrameId!==undefined&&
     typeof video.cancelVideoFrameCallback==='function'){
   try{video.cancelVideoFrameCallback(state.firstPictureFrameId)}catch(e){}
   state.firstPictureFrameId=null
  }
 }
 function observeFirstPicture(){
  if(S.route!=='player'||S.playerView!==state||state.stats.firstFrameAt||
     state.pictureObservationAllowed===false||
     !video.isConnected||!video.videoWidth||!video.videoHeight)return;
  var quality=null;
  try{quality=video.getVideoPlaybackQuality&&video.getVideoPlaybackQuality()}catch(e){}
  if(quality&&Number(quality.totalVideoFrames)>0){
   noteFirstPicture('decoded');return
  }
  var webkit=Number(video.webkitDecodedFrameCount)||0;
  if(webkit>0){noteFirstPicture('decoded');return}
  if(typeof video.requestVideoFrameCallback!=='function'||
     state.firstPictureFrameId!==null&&state.firstPictureFrameId!==undefined)return;
  try{
   state.firstPictureFrameId=video.requestVideoFrameCallback(function(){
    state.firstPictureFrameId=null;
    if(S.route==='player'&&S.playerView===state&&video.isConnected&&
       video.videoWidth>0&&video.videoHeight>0)noteFirstPicture('presented')
   })
  }catch(e){state.firstPictureFrameId=null}
 }
 // Run sparingly until the first video frame. This does not fetch media or
 // consume any additional upstream player sessions.
 state.firstPictureWatchTimer=setInterval(observeFirstPicture,800);
 function onBufferEvent(){
  var stats=state.stats;
  if(S.route!=='player'||S.playerView!==state||video.paused||!stats.firstFrameAt)return;
  if(!stats.bufferSince){stats.bufferEvents++;stats.bufferSince=Date.now()}
 }
 function stopSeekFrameWatch(){
  if(state.seekFrameId!==null&&state.seekFrameId!==undefined&&
   typeof video.cancelVideoFrameCallback==='function'){
   try{video.cancelVideoFrameCallback(state.seekFrameId)}catch(e){}
  }
  state.seekFrameId=null
 }
 function watchSeekFrame(pending){
  if(!pending||!pending.requireDecodedFrame||state.pendingSeek!==pending||
   typeof video.requestVideoFrameCallback!=='function')return;
  try{
   state.seekFrameId=video.requestVideoFrameCallback(function(now,frame){
    state.seekFrameId=null;
    if(S.route!=='player'||S.playerView!==state||state.pendingSeek!==pending)return;
    var frameTime=Number(frame&&frame.mediaTime);
    var real=state.mode==='vodhls'?state.offset+frameTime:frameTime;
    if(isFinite(frameTime)&&Math.abs(real-pending.target)<=8&&
     video.readyState>=2&&!video.seeking){
     pending.decodedFrame=true;confirmSeek();return
    }
    watchSeekFrame(pending)
   })
  }catch(e){
   pending.requireDecodedFrame=false;confirmSeek()
  }
 }
 function confirmSeek(){
  var pending=state.pendingSeek;
  if(!pending||S.route!=='player'||S.playerView!==state||video.readyState<2||video.seeking)return;
  var now=Date.now(),actual=state.mode==='vodhls'?
   state.offset+Math.max(0,Number(video.currentTime)||0):Math.max(0,Number(video.currentTime)||0);
  if(Math.abs(actual-pending.target)>8)return;
  // Some TV decoders update currentTime optimistically before the video
  // actually jumps. Prefer the presented-frame clock where supported.
  if(pending.requireDecodedFrame&&!pending.decodedFrame)return;
  stopSeekFrameWatch();
  if(state.seekWatchdog){clearTimeout(state.seekWatchdog);state.seekWatchdog=null}
  if(state.seekLogTimer){clearTimeout(state.seekLogTimer);state.seekLogTimer=null}
  if(!pending.logged)diagnose(kind,'vod_seek_request',state.mode,0);
  state.pendingSeek=null;
  state.seekIncomplete=false;
  state.stats.seekReady++;
  if(pending.requireDecodedFrame&&pending.decodedFrame)state.stats.verifiedSeekFrames++;
  state.stats.lastSeekMs=Math.max(0,now-pending.startedAt);
  diagnose(kind,'vod_seek_ready',state.mode,0);
  // A seek within an already-buffered range may emit "seeked" without a
  // fresh "playing" event. Clear the progress overlay in either case.
  var status=document.getElementById('player-status');
  if(status&&status.className!=='player-error'&&
   /التقديم|جار فتح المقطع|جار فتح الفيلم|جار تحميل الجزء المطلوب/.test(status.textContent||''))playerStatus('')
 }
 function startSeekCheck(target){
  if(isLive)return;
  var now=Date.now(),wasPending=!!state.pendingSeek;
  if(!wasPending)state.stats.seekAttempts++;
  if(state.seekWatchdog)clearTimeout(state.seekWatchdog);
  if(state.seekLogTimer)clearTimeout(state.seekLogTimer);
  stopSeekFrameWatch();
  var canObserveFrames=typeof video.requestVideoFrameCallback==='function'&&!video.paused;
  var pending={target:target,startedAt:now,logged:false,
   requireDecodedFrame:canObserveFrames,decodedFrame:false};
  state.pendingSeek=pending;
  state.seekIncomplete=true;
  watchSeekFrame(pending);
  state.seekLogTimer=setTimeout(function(){
   state.seekLogTimer=null;
   if(S.route!=='player'||S.playerView!==state||state.pendingSeek!==pending)return;
   pending.logged=true;
   diagnose(kind,'vod_seek_request',state.mode,0)
  },320);
  state.seekWatchdog=setTimeout(function(){
   state.seekWatchdog=null;
   if(S.route!=='player'||S.playerView!==state||state.pendingSeek!==pending)return;
   state.pendingSeek=null;
   stopSeekFrameWatch();
   state.stats.seekTimeouts++;
   if(state.seekLogTimer){clearTimeout(state.seekLogTimer);state.seekLogTimer=null}
   if(!pending.logged)diagnose(kind,'vod_seek_request',state.mode,0);
   diagnose(kind,'vod_seek_timeout',state.mode,0);
   playerStatus('التقديم يستغرق وقتًا أطول من المتوقع. سيستمر المشغّل بالمحاولة، ويمكنك إعادة التشغيل إذا لم يتحرك الفيديو.')
  },30000)
 }
 function onPlayingEvent(){
  clearVodBufferNotice(state);
  var stats=state.stats,now=Date.now();
  state.pictureObservationAllowed=true;
  if(!stats.firstFrameAt)observeFirstPicture();
  if(stats.bufferSince){stats.bufferMs+=Math.max(0,now-stats.bufferSince);stats.bufferSince=0}
  confirmSeek()
 }
 function onPauseEvent(){
  var stats=state.stats;
  if(stats.bufferSince){stats.bufferMs+=Math.max(0,Date.now()-stats.bufferSince);stats.bufferSince=0}
 }
 video.addEventListener('waiting',onBufferEvent);
 video.addEventListener('stalled',onBufferEvent);
 video.addEventListener('playing',onPlayingEvent);
 video.addEventListener('seeked',confirmSeek);
 video.addEventListener('canplay',confirmSeek);
 video.addEventListener('loadeddata',confirmSeek);
 video.addEventListener('timeupdate',confirmSeek);
 video.addEventListener('timeupdate',function(){
  if(isLive||S.playerView!==state)return;
  var at=Number(video.currentTime)||0,prev=state.lastBufferNoticeTime;
  state.lastBufferNoticeTime=at;
  if(Number.isFinite(prev)&&at-prev>0.15&&!video.paused&&!video.seeking)
   clearVodBufferNotice(state)
 });
 video.addEventListener('pause',onPauseEvent);
 video.addEventListener('error',function(){state.stats.errors++});
 var root=document.getElementById('player-root'),hud=root.querySelector('.player-hud');
 function releaseWakeLock(){
  var lock=state.wakeLock;state.wakeLock=null;
  if(lock&&lock.release){try{var p=lock.release();if(p&&p.catch)p.catch(function(){})}catch(e){}}
 }
 function acquireWakeLock(){
  if(!navigator.wakeLock||!navigator.wakeLock.request||document.hidden||video.paused||
   S.route!=='player'||state.wakeLock||state.wakeLockPending)return;
  state.wakeLockPending=true;
  try{
   var promise=navigator.wakeLock.request('screen');
   if(promise&&promise.then)promise.then(function(lock){
    state.wakeLockPending=false;
    if(S.route==='player'&&S.playerView===state&&!video.paused&&!document.hidden)state.wakeLock=lock;
    else if(lock&&lock.release){var p=lock.release();if(p&&p.catch)p.catch(function(){})}
   }).catch(function(){state.wakeLockPending=false});
   else state.wakeLockPending=false
  }catch(e){state.wakeLockPending=false}
 }
 state.releaseWakeLock=releaseWakeLock;
 state.acquireWakeLock=acquireWakeLock;
 function revealControls(){
  root.classList.remove('controls-hidden');
  if(state.hudTimer)clearTimeout(state.hudTimer);
  state.hudTimer=setTimeout(function(){
   state.hudTimer=null;
   if(S.route!=='player'||S.playerView!==state||!root.isConnected)return;
   // When the viewer pauses with touch, keep the Resume button available.
   if(document.documentElement.getAttribute('data-blofy-input')==='touch'&&video.paused)return;
   // The buffering notice lives outside the HUD; it remains readable while
   // transport controls fade, including when decoder events are inconsistent.
   var retry=document.getElementById('player-retry');
   if(retry&&retry.style.display!=='none')return;
   // Keep intentional menus visible until the viewer closes them.
   var panels=['player-more-panel','player-info-panel','player-health-panel',
    'player-diagnostic-panel','player-jump-panel','player-choice-panel','player-channel-panel'];
   for(var i=0;i<panels.length;i++){
    var open=document.getElementById(panels[i]);
    if(open&&!open.hidden)return
   }
   // Remote controls retain focus after an OK/arrow press. Blurring a
   // stale control allows the TV HUD to fade after inactivity, and arrows
   // show/re-focus controls again without requiring a mouse.
   var focused=document.activeElement;
   if(focused&&hud.contains(focused)&&typeof focused.blur==='function')focused.blur();
   root.classList.add('controls-hidden')
  },document.documentElement.getAttribute('data-blofy-input')==='touch'?3200:3800)
 }
 state.revealControls=revealControls;
 function touchVideoPointer(e){
  if(e&&e.target===video&&document.documentElement.getAttribute('data-blofy-input')==='touch')return;
  revealControls()
 }
 root.addEventListener('pointermove',touchVideoPointer,{passive:true});
 root.addEventListener('pointerdown',touchVideoPointer,{passive:true});
 root.addEventListener('keydown',revealControls);
 root.addEventListener('focusin',revealControls);
 video.addEventListener('click',function(){
  // A recognized double-tap already applied one VOD seek. Don't let the
  // synthetic click immediately re-hide the controls.
  if(state.touchSkipClickUntil&&Date.now()<state.touchSkipClickUntil){
   revealControls();return
  }
  var panels=['player-more-panel','player-info-panel','player-health-panel',
   'player-diagnostic-panel','player-jump-panel','player-choice-panel','player-channel-panel'];
  var open=false;
  for(var i=0;i<panels.length;i++){
   var p=document.getElementById(panels[i]);
   if(p&&!p.hidden){open=true;break}
  }
  var retry=document.getElementById('player-retry');
  var locked=open||video.paused||retry&&retry.style.display!=='none';
  var action=touchPlayerTapDecision(document.documentElement.getAttribute('data-blofy-input'),
    true,root.classList.contains('controls-hidden'),locked);
  if(action==='hide'){
   if(state.hudTimer){clearTimeout(state.hudTimer);state.hudTimer=null}
   root.classList.add('controls-hidden')
  }else revealControls()
 });
 function showTouchSeekFeedback(step){
  var note=document.getElementById('mobile-seek-feedback');
  if(!note||!note.isConnected)return;
  note.textContent=(step>0?'+':'−')+Math.abs(step)+' ثوانٍ';
  note.hidden=false;
  if(state.touchSeekFeedbackTimer)clearTimeout(state.touchSeekFeedbackTimer);
  state.touchSeekFeedbackTimer=setTimeout(function(){
   state.touchSeekFeedbackTimer=null;
   if(note.isConnected)note.hidden=true
  },1150)
 }
 function handleTouchVideoGesture(clientX,clientY){
  if(S.route!=='player'||S.playerView!==state||isLive||!state.seekBy||!state.ready)return;
  if(document.documentElement.getAttribute('data-blofy-input')!=='touch')return;
  var retry=document.getElementById('player-retry');
  if(video.paused||video.seeking||retry&&retry.style.display!=='none')return;
  var panels=['player-more-panel','player-info-panel','player-health-panel',
   'player-diagnostic-panel','player-jump-panel','player-choice-panel','player-channel-panel'];
  for(var i=0;i<panels.length;i++){
   var item=document.getElementById(panels[i]);
   if(item&&!item.hidden){state.touchSeekLastTap=null;return}
  }
  var rect=video.getBoundingClientRect();
  var decision=touchSeekDecision(state.touchSeekLastTap,Date.now(),
    Number(clientX)-rect.left,Number(clientY)-rect.top,rect.width,kind,false);
  state.touchSeekLastTap=decision.last;
  if(decision.step){
   state.touchSkipClickUntil=Date.now()+420;
   state.seekBy(decision.step);
   showTouchSeekFeedback(decision.step);
   revealControls()
  }
 }
 video.addEventListener('pointerup',function(event){
  if(event&&event.pointerType==='touch')
   handleTouchVideoGesture(event.clientX,event.clientY)
 },{passive:true});
 if(!window.PointerEvent)video.addEventListener('touchend',function(event){
  var t=event&&event.changedTouches&&event.changedTouches[0];
  if(t)handleTouchVideoGesture(t.clientX,t.clientY)
 },{passive:true});
 function refreshVideoResolution(){
  if(S.route!=='player'||S.playerView!==state)return;
  var w=Math.max(0,Number(video.videoWidth)||0),h=Math.max(0,Number(video.videoHeight)||0);
  var el=document.getElementById('player-resolution');
  if(!el)return;
  if(!w||!h){el.hidden=true;el.textContent='';return}
  var grade=h>=4300?'8K':h>=2100?'4K':h>=1400?'2K':h>=1000?'FHD':h>=690?'HD':'SD';
  // These are actual decoded pixels, not guessed from the Xtream title.
  var copyMode=!!(S.play&&S.play.video===video&&S.play.videoMode==='source_copy');
  var src=S.play&&S.play.video===video?S.play.sourceDimensions||'':'';
  var srcH=src?Number(src.split('x')[1])||0:0;
  el.textContent='المعروض '+w+'×'+h+' • '+grade+
   (src?' • المصدر '+src:(copyMode&&h<690?' • المصدر نفسه SD':''))+
   (srcH>=690&&h<690?' • تحويل خفّض الدقة':'');
  el.title='دقة الصورة التي يعرضها المتصفح، وليس جودة المصدر المعلنة';
  el.hidden=false
 }
 video.addEventListener('loadedmetadata',refreshVideoResolution);
 video.addEventListener('resize',refreshVideoResolution);
 video.addEventListener('playing',refreshVideoResolution);
 state.refreshVideoResolution=refreshVideoResolution;
 function realPos(){return state.mode==='vodhls'?state.offset+Math.max(0,video.currentTime||0):video.currentTime||0}
 function totalDuration(){return playbackDuration(state)}
 function nativeCanSeek(target){
  var ranges=video.seekable;
  if(!ranges||!ranges.length)return false;
  for(var i=0;i<ranges.length;i++){
   try{if(target>=ranges.start(i)-0.4&&target<=ranges.end(i)+0.4)return true}catch(e){}
  }
  return false
 }
 function verifyDirectSeek(target){
  if(state.directSeekVerify){clearTimeout(state.directSeekVerify);state.directSeekVerify=null}
  state.directSeekVerify=setTimeout(function(){
   state.directSeekVerify=null;
   if(S.route!=='player'||state.mode!=='direct'||state.directFallback)return;
   if(Math.abs(Math.max(0,Number(video.currentTime)||0)-target)>8){
    state.resume=target;
    state.requestedSeek=target;
    playerStatus('لم يصل المشغّل الأصلي إلى الموضع المختار؛ جار استخدام مشغّل الفيديو الكامل…');
    state.recoverDirect()
   }
  },4200)
 }
 function markReady(){
  if(S.route!=='player')return;
  var firstReady=!state.ready;state.ready=true;var status=document.getElementById('player-status');if(status)status.style.display='none';
  if(state.directStartupTimer){clearTimeout(state.directStartupTimer);state.directStartupTimer=null}
  if(firstReady)revealControls();
  if(state.mode==='direct'){
   var sourceLabel=document.getElementById('player-source-mode');
   if(sourceLabel){sourceLabel.textContent='المصدر الأصلي • بدون تحويل';sourceLabel.hidden=false}
  }
  acquireWakeLock();
  if(!isLive&&state.mode==='direct'&&!state.didResume&&resume>30){
   // Checkpoints must not be clamped to a misleading 60-second native preview.
   // Trust the real catalog runtime, or retain the exact saved seek target.
   var duration=Number(state.duration)||0;
   var checkpoint=duration>=120?Math.min(resume,Math.max(0,duration-5)):resume;
   state.didResume=true;
   if(nativeCanSeek(checkpoint)){
    try{video.currentTime=checkpoint;verifyDirectSeek(checkpoint)}catch(e){state.requestedSeek=checkpoint;state.recoverDirect()}
   }else{
    // Never discard a saved checkpoint because a pseudo-live source advertises
    // only the first minute as seekable.
    state.resume=checkpoint;
    state.requestedSeek=checkpoint;
    state.recoverDirect()
   }
  }
 }
 function progress(){
  if(S.route!=='player')return;
  var pos=realPos(),duration=totalDuration();
  if(!isLive){
   var n=document.getElementById('now-time'),t=document.getElementById('total-time'),seek=document.getElementById('seek');
   if(n)n.textContent=formatTime(pos);if(t)t.textContent=duration>0&&isFinite(duration)?formatTime(duration):'المدة غير متوفرة';
   if(seek){seek.disabled=!(duration>0&&isFinite(duration));
    if(document.activeElement!==seek&&duration>0&&isFinite(duration))seek.value=String(Math.max(0,Math.min(1000,Math.round(pos/duration*1000))))}
   // Seek-timeout can clear pendingSeek while the browser still displays
   // the desired time rather than decoded frames. Do not treat that as watched.
   if(!state.pendingSeek&&!state.seekDebounce&&!state.seekIncomplete&&
    Date.now()-state.lastSaved>5000&&state.ready){
    saveResume(kind,id,pos,duration,true);state.lastSaved=Date.now()
   }
  }
 }
 state.onDuration=progress;
 function releaseDirectSource(){
  if(isLive||state.mode!=='direct')return;
  // Some Xtream accounts permit a single active source connection.
  // The old HTML5 MP4 fetch otherwise continues while the HLS worker opens
  // the same movie, causing the provider to reset the new connection.
  state.mode='switching';state.ready=false;
  for(var i=0;i<4;i++){
   var key=['directTimer','directSeekCheck','directSeekVerify','directStartupTimer'][i];
   if(state[key]){clearTimeout(state[key]);state[key]=null}
  }
  video.onplaying=null;video.onwaiting=null;video.onstalled=null;
  video.onerror=null;video.onloadedmetadata=null;video.onended=null;
  try{video.pause();video.removeAttribute('src');video.load()}catch(e){}
 }
 function startVod(at,metadataGeneration){
  // Late Xtream info requests must not reopen an older seek position.
  // Only the metadata request that launched the current fallback may keep
  // its generation; all other restarts invalidate pending metadata.
  if(metadataGeneration===undefined||(metadataGeneration!==state.mediaGeneration)){
   state.mediaGeneration=(state.mediaGeneration||0)+1
  }
  releaseDirectSource();
  if(state.duration>=120&&state.duration<=21600){
   state.resume=Math.max(0,Math.round(at||0));
   playFullVod(video,kind,id,ext,state.track,state.duration,state,markReady)
  }else{
   playVodSegments(video,kind,id,ext,state.track,at,state,markReady)
  }
 }
 function startWithMetadata(at){
  if(state.duration>=120||kind==='live'){startVod(at);return}
  releaseDirectSource();
  var requestGeneration=state.mediaGeneration=(state.mediaGeneration||0)+1;
  var settled=false;
  function launch(){
   if(settled||S.route!=='player'||S.playerView!==state||requestGeneration!==state.mediaGeneration)return;
   settled=true;
   startVod(at,requestGeneration)
  }
  var timeout=setTimeout(launch,4200);
  var episodeParent=kind==='series'&&(
   (prior&&prior.seriesId)||
   (S.item&&S.item.kind==='series'&&S.episodes&&parseEpisodes(S.episodes).some(function(ep){return String(ep.id)===String(id)})?S.item.id:'')
  );
  var endpoint=kind==='movie'?'get_vod_info&vod_id='+enc(id):
   (kind==='series'&&episodeParent?'get_series_info&series_id='+enc(episodeParent):'');
  if(!endpoint){clearTimeout(timeout);setTimeout(launch,0);return}
  playerStatus('جار قراءة معلومات الفيلم لتفعيل التقديم والترجيع…');
  api('GET','/api/catalog?action='+endpoint,null,function(st,result){
   if(S.route!=='player'||S.playerView!==state||requestGeneration!==state.mediaGeneration)return;
   var alreadyStarted=settled;
   clearTimeout(timeout);
   if(st===200&&result){
    if(kind==='movie'){
     if(S.item&&S.item.kind==='movie'&&S.item.id===id)S.item.info=result;
     var info=result.info||{},data=result.movie_data||{};
     var opts=[[info.duration_secs,'seconds'],[info.duration,'duration'],
      [data.duration_secs,'seconds'],[data.duration,'duration'],
      [result.duration_secs,'seconds'],[result.duration,'duration']];
     for(var i=0;i<opts.length;i++){var d=durationSeconds(opts[i][0],opts[i][1]);if(d>=120){state.duration=d;break}}
    }else if(kind==='series'){
     if(S.item&&S.item.kind==='series'&&S.item.id===String(episodeParent)){S.episodes=result;S.episodesSeriesId=String(episodeParent)}
     var eps=parseEpisodes(result);
     for(var j=0;j<eps.length;j++)if(String(eps[j].id)===String(id)){
      var episode=eps[j],extra=episode.info||{},options=[
       [extra.duration_secs,'seconds'],[episode.duration_secs,'seconds'],
       [extra.duration,'duration'],[episode.duration,'duration']];
      for(var k=0;k<options.length;k++){var d2=durationSeconds(options[k][0],options[k][1]);if(d2>=120){state.duration=d2;break}}
      break
     }
    }
   }
   // Metadata may arrive after the short startup timeout.
   // Upgrade the still-live EVENT fallback to real VOD at the same movie time.
   if(alreadyStarted){
    if(state.duration>=120&&state.duration<=21600&&state.mode==='vodhls')startVod(realPos());
    return
   }
   launch()
  })
 }
 function seekTo(raw){
  if(isLive)return;
  state.completed=false; // Explicitly scrubbing after finish starts a rewatch.
  if(state.seekDebounce){clearTimeout(state.seekDebounce);state.seekDebounce=null}
  state.recoveries=0;state.recoveryWindow=0;
  var target=Math.max(0,Math.round(Number(raw)||0)),duration=totalDuration();
  if(duration>0&&isFinite(duration))target=Math.min(target,Math.max(0,Math.floor(duration)-2));
  state.lastSeekTarget=target;state.lastSeekAt=Date.now();
  if(target<5){
   // Explicitly scrubbing back to the beginning is different from a
   // newly opened player briefly reporting currentTime=0.
   delete S.watch[progressKey(kind,id)];profileSave('watch',S.watch)
  }
  startSeekCheck(target);
  if(state.mode==='fullvod'||state.mode==='direct'&&nativeCanSeek(target)){
   try{
    if(state.mode==='direct'){resume=target;state.resume=target;state.requestedSeek=target}
    if(state.mode==='fullvod')state.resume=target;
    video.currentTime=target;
    if(state.mode==='direct')verifyDirectSeek(target);
    progress();return target
   }catch(e){}
  }
  if(state.mode==='direct'){
   state.directFallback=true;
   // The user may deliberately rewind. Never prefer an earlier, larger
   // checkpoint or the stale MP4 time when switching to VOD.
   state.requestedSeek=target;state.resume=target;resume=target;
   // A nonseekable MP4 reports untrusted duration. Prefer Xtream metadata.
   playerStatus('هذا المصدر لا يسمح بالتقديم إلى '+formatTime(target)+' مباشرة؛ جار فتح مشغّل الأفلام…')
  }
  // Resolve Xtream metadata before converting MP4 to the temporary EVENT
  // playlist. Previously direct-MP4 failures bypassed metadata entirely,
  // leaving episodes looking like one-minute live television.
  if(state.ready&&target>=5)saveResume(kind,id,checkpointPosition(state),duration,true);
  if(state.mode==='direct'&&!(state.duration>=120))startWithMetadata(target);
  else startVod(target);
  playerStatus('جار فتح المقطع عند '+formatTime(target)+'…');
  return target
 }
 state.seekTo=seekTo;
 var jumpToggle=document.getElementById('player-jump-toggle');
 var jumpPanel=document.getElementById('player-jump-panel');
 function closeJumpPanel(){
  if(!jumpPanel)return;
  jumpPanel.hidden=true;
  if(jumpToggle)jumpToggle.setAttribute('aria-expanded','false')
 }
 if(jumpToggle&&jumpPanel){
  jumpToggle.onclick=function(){
   jumpPanel.hidden=!jumpPanel.hidden;
   jumpToggle.setAttribute('aria-expanded',String(!jumpPanel.hidden));
   if(!jumpPanel.hidden){
    var input=document.getElementById('player-jump-minute');
    if(input){input.value=String(Math.max(0,Math.min(359,Math.floor(realPos()/60))));input.focus()}
   }
  };
  var cancel=document.getElementById('player-jump-cancel');
  if(cancel)cancel.onclick=function(){closeJumpPanel();jumpToggle.focus()};
  jumpPanel.onsubmit=function(event){
   event.preventDefault();
   var input=document.getElementById('player-jump-minute');
   var text=input?String(input.value||'').trim():'',minute=Number(text);
   if(!/^\d{1,3}$/.test(text)||!Number.isInteger(minute)||minute<0||minute>359){
    playerStatus('أدخل دقيقة صحيحة بين 0 و359.');if(input)input.focus();return
   }
   closeJumpPanel();jumpToggle.focus();
   seekTo(minute*60)
  }
 }
 state.seekBy=function(delta){
  // TV key-repeat sends many events in one second. Show immediate preview
  // but issue only ONE network seek after the remote stops repeating,
  // otherwise each press kills and restarts FFmpeg at the upstream source.
  var recent=Date.now()-(state.lastSeekAt||0)<4500&&
   state.lastSeekTarget!==null&&state.lastSeekTarget!==undefined&&isFinite(state.lastSeekTarget);
  var target=Math.max(0,Math.round((recent?state.lastSeekTarget:realPos())+delta));
  var duration=totalDuration();
  if(duration>0&&isFinite(duration))target=Math.min(target,Math.max(0,Math.floor(duration)-2));
  state.lastSeekTarget=target;state.lastSeekAt=Date.now();
  if(state.seekDebounce)clearTimeout(state.seekDebounce);
  var n=document.getElementById('now-time'),bar=document.getElementById('seek');
  if(n)n.textContent=formatTime(target);
  if(bar&&duration>0&&isFinite(duration))bar.value=String(Math.max(0,Math.min(1000,Math.round(target/duration*1000))));
  playerStatus('التقديم إلى '+formatTime(target)+'…');
  state.seekDebounce=setTimeout(function(){
   state.seekDebounce=null;
   if(S.route==='player'&&S.playerView===state)seekTo(target)
  },360);
  return target
 };
 state.toggle=function(){
  if(video.paused){
   state.userPaused=false;
   var p=video.play();if(p&&p.catch)p.catch(function(){})
  }else{
   state.userPaused=true;video.pause()
  }
 };
 state.recoverDirect=function(){
  if(state.mode!=='direct'||S.route!=='player'||state.directFallback)return;
  state.directFallback=true;
  if(state.directSeekCheck){clearTimeout(state.directSeekCheck);state.directSeekCheck=null}
  if(state.directSeekVerify){clearTimeout(state.directSeekVerify);state.directSeekVerify=null}
  if(state.directStartupTimer){clearTimeout(state.directStartupTimer);state.directStartupTimer=null}
  if(state.directTimer){clearTimeout(state.directTimer);state.directTimer=null}
  // A user-specified seek is authoritative, including 0 and backward seeks.
  // A plain playback stall without a requested seek resumes at the furthest
  // reliable checkpoint as before.
  var position=state.requestedSeek!==undefined&&state.requestedSeek!==null?
   Math.max(0,Number(state.requestedSeek)||0):
   Math.max(resume,state.resume||0,video.currentTime||0);
  state.requestedSeek=null;
  playerStatus('جار فتح مصدر متوافق لتقديم الفيلم…');
  if(state.duration>=120)startVod(position);
  else startWithMetadata(position)
 };
 function startDirect(){
  state.mode='direct';state.offset=0;state.didResume=false;state.ready=false;
  var badge=document.getElementById('player-mode-badge');if(badge)badge.textContent='MP4 • جار فحص إمكانية التقديم';
  if(state.directStartupTimer)clearTimeout(state.directStartupTimer);
  state.directStartupTimer=setTimeout(function(){
   state.directStartupTimer=null;
   if(S.route!=='player'||S.playerView!==state||state.mode!=='direct'||state.directFallback||state.ready)return;
   if(video.paused){
    playerStatus('اضغط تشغيل لبدء الفيلم. إذا استمر التعليق استخدم إعادة المحاولة.');
    return
   }
   playerStatus('تأخر فتح الفيديو الأصلي؛ جار استخدام مشغّل الأفلام البديل…');
   state.recoverDirect()
  },18000);
  video.src='/api/media/'+enc(kind)+'/'+enc(id)+'.'+enc(ext);
  try{var ret=video.play();if(ret&&ret.catch)ret.catch(function(){playerStatus('اضغط ▶ لتشغيل الفيديو')})}catch(e){}
 }
 video.onloadedmetadata=function(){
  if(state.mode!=='direct')return;
  if(state.directTimer){clearTimeout(state.directTimer);state.directTimer=null}
  var observed=Number(video.duration);
  // Retain the browser estimate only as a hint. Never override the verified
  // catalog duration unless the source really exposes seekable byte ranges.
  if(isFinite(observed)&&observed>=120&&observed<=21600)state.directDurationHint=Math.round(observed);
  progress();
  // HTML5 can decode MP4 yet have NO seekable byte ranges: in that case the
  // film looks like live streaming. Try the full VOD engine automatically.
  if(state.directSeekCheck)clearTimeout(state.directSeekCheck);
  var badge=document.getElementById('player-mode-badge');
  var far=state.directDurationHint&&Math.max(0,Math.min(state.directDurationHint-10,state.directDurationHint*0.75));
  if(badge&&far>0&&nativeCanSeek(far)){
   badge.textContent='MP4 • قابل للتقديم';
   if(!(state.duration>=120))state.duration=state.directDurationHint
  }
  state.directSeekCheck=setTimeout(function(){
   state.directSeekCheck=null;
   if(S.route!=='player'||state.mode!=='direct'||state.directFallback||isLive)return;
   if(!(video.duration>120&&isFinite(video.duration))){
    // A non-live movie/episode advertised as 60 seconds or Infinity is not
    // a usable full-length VOD timeline. Resolve its actual Xtream runtime.
    playerStatus('المدة الظاهرة غير كاملة؛ جار قراءة مدة الفيلم من المصدر…');
    state.recoverDirect();return
   }
   // Some sources expose only a short, moving video range despite reporting
   // a full movie duration. Test a distant timestamp, not just range count.
   var probe=Math.max(video.duration*0.75,video.currentTime+120);
   if(!nativeCanSeek(Math.min(probe,video.duration-10))){
    playerStatus('المصدر يتيح دقائق محدودة فقط؛ جار التحويل إلى مشغّل الأفلام الكامل…');
    state.recoverDirect()
   }else if(state.directDurationHint>=120&&!(state.duration>=120)){
    state.duration=state.directDurationHint;progress()
   }
  },3500)
 };
 video.onwaiting=video.onstalled=function(){
  if(state.mode!=='direct'||video.paused||state.directFallback||!S.userVerified)return;
  queueVodBufferNotice(video);
  if(state.directTimer)clearTimeout(state.directTimer);
  state.directTimer=setTimeout(function(){
   state.directTimer=null;
   if(state.mode==='direct'&&!video.paused&&video.readyState<3)state.recoverDirect()
  },14000)
 };
 video.ontimeupdate=progress;video.onpause=function(){
  releaseWakeLock();progress();
  if(state.ready&&!isLive)saveResume(kind,id,checkpointPosition(state),totalDuration(),true)
 };
 video.onplaying=function(){
  if(state.directTimer){clearTimeout(state.directTimer);state.directTimer=null}
  if(state.completed&&video.currentTime<5)state.completed=false;
  markReady()
 };
 video.onended=function(){
  if(state.mode!=='direct'||S.route!=='player'||S.playerView!==state)return;
  var runtime=totalDuration(),observed=Math.max(0,Number(video.currentTime)||0);
  if(vodEndedAtRealFinish(runtime,observed,!!state.seekIncomplete)){
   finishResume(kind,id);
   playerStatus('اكتملت المشاهدة')
  }else{
   // An early EOF from an incomplete MP4 range must use the fallback
   // rather than making the title disappear from Continue Watching.
   playerStatus('انتهى اتصال الفيلم قبل نهايته؛ جار استخدام مشغّل الفيديو البديل…');
   state.requestedSeek=observed;state.resume=observed;
   state.recoverDirect()
  }
 };
 video.onerror=function(){
  if(state.mode==='direct'&&!isLive)state.recoverDirect();
  else playerStatus('تعذّر تشغيل هذا المصدر.',true)
 };
 var directTsButton=document.getElementById('player-direct-ts');
 if(directTsButton)directTsButton.onclick=function(){
  if(S.route!=='player'||S.playerView!==state)return;
  if(state.mode==='mpegts'){
   playerStatus('جار الرجوع إلى محرك HLS…');
   playHls(video,'live',String(state.id),'ts',0,document.getElementById('player-status'),false,0)
  }else playDirectMpegts(video,String(state.id),document.getElementById('player-status'))
 };
 document.getElementById('player-back').onclick=back;
 document.getElementById('player-toggle').onclick=state.toggle;
 document.getElementById('player-retry').onclick=function(){
  diagnose(kind,'vod_retry',state.mode,0);
  playerStatus('جار إعادة اتصال المشغّل…');
  if(isLive)playHls(video,kind,id,'ts',0,document.getElementById('player-status'),false);
  else startVod(Math.round(state.seekIncomplete&&state.lastSeekTarget!==undefined&&state.lastSeekTarget!==null?
   state.lastSeekTarget:checkpointPosition(state)))
 };
 var restart=document.getElementById('player-restart');if(restart)restart.onclick=function(){
  if(state.seekDebounce){clearTimeout(state.seekDebounce);state.seekDebounce=null}
  if(state.seekWatchdog){clearTimeout(state.seekWatchdog);state.seekWatchdog=null}
  if(state.seekLogTimer){clearTimeout(state.seekLogTimer);state.seekLogTimer=null}
  state.pendingSeek=null;stopSeekFrameWatch();state.seekIncomplete=false;state.completed=false;
  state.lastSeekTarget=0;state.lastSeekAt=Date.now();state.requestedSeek=0;
  delete S.watch[progressKey(kind,id)];profileSave('watch',S.watch);resume=0;state.resume=0;
  if(state.mode==='direct'&&video.seekable&&video.seekable.length){try{video.currentTime=0}catch(e){}}
  else if(state.mode==='fullvod'){try{video.currentTime=0}catch(e){startVod(0)}}
  else{state.ready=false;startVod(0)}
 };
 // Android's audio, subtitles and quality controls open a choice list
 // rather than silently cycling options or replacing their icon labels.
 var choicePanel=document.createElement('section');
 choicePanel.id='player-choice-panel';choicePanel.className='native-player-choice-panel';
 choicePanel.hidden=true;choicePanel.setAttribute('role','dialog');choicePanel.setAttribute('aria-modal','true');
 root.appendChild(choicePanel);
 var choiceOrigin=null;
 function closePlayerChoices(){
  choicePanel.hidden=true;choicePanel.innerHTML='';
  if(choiceOrigin&&choiceOrigin.isConnected)try{choiceOrigin.focus({preventScroll:true})}catch(err){choiceOrigin.focus()}
 }
 state.closePlayerChoices=closePlayerChoices;
 function showPlayerChoices(heading,options,origin){
  if(!options.length){playerStatus('المصدر الحالي لا يتيح خيارات '+heading+' إضافية.');return}
  choiceOrigin=origin;
  choicePanel.innerHTML='<div class="native-player-choice-card">'+
   '<div class="native-player-choice-head"><strong>'+esc(heading)+'</strong><button type="button" id="player-choice-close" aria-label="إغلاق">✕</button></div>'+
   '<div class="native-player-choice-items">'+options.map(function(option,index){
    return '<button class="native-player-choice-item'+(option.selected?' selected':'')+'" type="button" data-choice-index="'+index+'">'+
      (option.selected?'✓ ':'')+esc(option.name)+'</button>'
   }).join('')+'</div></div>';
  choicePanel.hidden=false;root.classList.remove('controls-hidden');
  choicePanel.querySelector('#player-choice-close').onclick=closePlayerChoices;
  Array.prototype.forEach.call(choicePanel.querySelectorAll('[data-choice-index]'),function(button){
   button.onclick=function(){
    var index=Number(button.getAttribute('data-choice-index')),option=options[index];
    if(!option)return;
    try{option.select()}catch(err){playerStatus('لم يتمكن المتصفح من تطبيق الخيار.')}
    closePlayerChoices()
   }
  });
  var chosen=choicePanel.querySelector('.native-player-choice-item.selected')||choicePanel.querySelector('.native-player-choice-item');
  if(chosen)chosen.focus()
 }
 // Independent, first-party audio; never restart or replace the channel video.
 var commentary=null,commentaryEpoch=0,commentaryNoticeTimer=null,commentaryVideoWait=null,commentaryPictureSeek=null,commentaryRetryAfter=0,commentaryRetryTimer=null,commentaryResume=null;
 function commentaryNotice(message){
  var el=document.getElementById('player-audio-notice');if(!el||S.playerView!==state)return;
  clearTimeout(commentaryNoticeTimer);el.textContent=message;el.hidden=false;
  commentaryNoticeTimer=setTimeout(function(){el.hidden=true;el.textContent=''},3500)
 }
 function stopCommentary(){
  commentaryResume=null;
  commentaryEpoch++;
  if(commentaryRetryTimer){clearTimeout(commentaryRetryTimer);commentaryRetryTimer=null}
  if(commentaryPictureSeek){clearTimeout(commentaryPictureSeek.timer);commentaryPictureSeek=null}
  if(commentaryVideoWait){clearTimeout(commentaryVideoWait);commentaryVideoWait=null}
  var old=commentary;commentary=null;
  if(!old)return;
  clearTimeout(old.timer);
  old.audio.onplaying=old.audio.onerror=old.audio.onended=old.audio.onwaiting=old.audio.onstalled=null;
  try{old.audio.pause();old.audio.removeAttribute('src');old.audio.load();old.audio.remove()}catch(e){}
  video.muted=old.originalMuted
 }
 function suspendCommentary(){
  var saved=commentary&&commentary.track?{track:commentary.track,channel:String(state.id)}:commentaryResume;
  stopCommentary();commentaryResume=saved
 }
 function resumeCommentary(){
  var saved=commentaryResume;
  if(!saved||document.hidden||video.paused||video.seeking||video.readyState<3||S.playerView!==state||S.route!=='player')return;
  commentaryResume=null;if(saved.channel!==String(state.id))return;
  startCommentary(saved.track,1)
 }
 function commentaryVisibility(){if(document.hidden)suspendCommentary();else resumeCommentary()}
 document.addEventListener('visibilitychange',commentaryVisibility);
 state.stopCommentary=stopCommentary;
 state.disposeCommentary=function(){document.removeEventListener('visibilitychange',commentaryVisibility);clearTimeout(commentaryNoticeTimer);stopCommentary()};
 video.addEventListener('pause',function(){if(document.hidden)suspendCommentary();else stopCommentary()});
 video.addEventListener('emptied',stopCommentary);
 // Independent live audio cannot safely keep running through a frozen picture.
 video.addEventListener('seeking',function(){
  var intentional=commentaryPictureSeek;
  if(intentional&&commentary===intentional.audio&&S.play===intentional.transport&&Math.abs(Number(video.currentTime)-intentional.target)<0.5)return;
  stopCommentary()
 });
 video.addEventListener('seeked',function(){
  var intentional=commentaryPictureSeek;if(!intentional)return;
  clearTimeout(intentional.timer);commentaryPictureSeek=null;
  if(commentary!==intentional.audio||S.play!==intentional.transport||video.readyState<2||Math.abs(Number(video.currentTime)-intentional.target)>0.5)stopCommentary()
 });
 function adjustCommentaryPicture(action){
  if(!commentary||!commentary.audible||commentaryPictureSeek||video.paused||document.hidden||S.playerView!==state||S.route!=='player')return false;
  var transport=S.play,target=bufferedLiveSeekTarget(video,transport,action);
  if(!transport||transport.video!==video||target===null)return false;
  var intentional={audio:commentary,transport:transport,target:target,timer:null};
  commentaryPictureSeek=intentional;
  intentional.timer=setTimeout(function(){if(commentaryPictureSeek===intentional)stopCommentary()},3000);
  try{transport.localBufferSeekUntil=Date.now()+20000;video.currentTime=target;return true}catch(e){stopCommentary();return false}
 }
 video.addEventListener('playing',function(){if(commentaryVideoWait){clearTimeout(commentaryVideoWait);commentaryVideoWait=null}resumeCommentary()});
 video.addEventListener('waiting',function(){
  if(!commentary||commentaryVideoWait||video.readyState>=3)return;
  var active=commentary;
  commentaryVideoWait=setTimeout(function(){commentaryVideoWait=null;if(commentary===active&&video.readyState<3)suspendCommentary()},3000)
 });
 function startCommentary(track,retryAttempt){
  retryAttempt=Number(retryAttempt)||0;
  if(S.route!=='player'||S.playerView!==state||video.paused||video.seeking||document.hidden||!track||!/^anis-[a-z0-9-]{1,54}$/.test(track.id))return;
  if(Date.now()<commentaryRetryAfter){commentaryNotice('انتظر قليلاً ثم أعد المحاولة.');return}
  stopCommentary();commentaryNotice('جار تشغيل المعلق…');
  var audio=document.createElement('audio'),record={audio:audio,originalMuted:video.muted,id:track.id,track:track,timer:null,audible:false};
  commentary=record;audio.hidden=true;audio.preload='none';root.appendChild(audio);
  function fail(){if(commentary!==record)return;var retry=record.hasPlayed&&retryAttempt<1;stopCommentary();commentaryRetryAfter=Date.now()+5000;commentaryNotice(retry?'جار استعادة المعلق…':'تعذر تشغيل المعلق؛ الصوت الأصلي مستمر. أعد المحاولة بعد 5 ثوانٍ.');if(retry){var epoch=commentaryEpoch;commentaryRetryTimer=setTimeout(function(){commentaryRetryTimer=null;if(commentaryEpoch===epoch&&S.playerView===state&&S.route==='player'&&!document.hidden&&!video.paused&&!video.seeking&&video.readyState>=2)startCommentary(track,retryAttempt+1)},5500)}}
  audio.onplaying=function(){
   if(commentary!==record||S.playerView!==state||video.paused||document.hidden){if(commentary===record)stopCommentary();return}
   clearTimeout(record.timer);record.timer=null;commentaryRetryAfter=0;record.audible=true;record.hasPlayed=true;video.muted=true;
   commentaryNotice('المعلق: '+String(track.label||'').slice(0,80))
  };
  audio.onerror=audio.onended=fail;
  audio.onwaiting=audio.onstalled=function(){
   if(commentary!==record||audio.readyState>=3)return;
   record.audible=false;video.muted=record.originalMuted;
   // Repeated waiting/stalled events cannot shorten startup or extend a retry forever.
   if(!record.timer)record.timer=setTimeout(fail,8000)
  };
  record.timer=setTimeout(fail,24000);
  audio.src='/api/commentary/'+enc(track.id);
  try{var request=audio.play();if(request&&request.catch)request.catch(fail)}catch(e){fail()}
 }
 var audioButton=document.getElementById('player-audio');
 audioButton.onclick=function(){
  var engine=S.play&&S.play.engine,tracks=video.audioTracks,options=[];
  if(isLive)options.push({name:'الصوت الأصلي',selected:!commentary,select:stopCommentary});
  if(tracks&&tracks.length>1){
   for(var i=0;i<tracks.length;i++)(function(track,index){
    options.push({name:track.label||track.language||('المسار الصوتي '+(index+1)),selected:!commentary&&!!track.enabled,
     select:function(){stopCommentary();for(var n=0;n<tracks.length;n++)tracks[n].enabled=n===index}})
   })(tracks[i],i)
  }else if(engine&&engine.audioTracks&&engine.audioTracks.length>1){
   var list=engine.audioTracks;
   for(var j=0;j<list.length;j++)(function(track,index){
    options.push({name:track.name||track.lang||('المسار الصوتي '+(index+1)),selected:!commentary&&engine.audioTrack===index,
     select:function(){stopCommentary();engine.audioTrack=index}})
   })(list[j],j)
  }
  if(!isLive){showPlayerChoices('المسارات الصوتية',options,this);return}
  showPlayerChoices('المسارات الصوتية',options,this)
 };
 function openCommentaryChoices(origin){
  if(!isLive||S.route!=='player'||S.playerView!==state||document.hidden)return;
  var epoch=++commentaryEpoch,channel=String(state.id);
  commentaryNotice('جار تحميل المعلقين…');
  api('GET','/api/commentary?channel='+enc(channel),null,function(st,data){
   if(S.route!=='player'||S.playerView!==state||String(state.id)!==channel||epoch!==commentaryEpoch||document.hidden)return;
   var list=[{name:'الصوت الأصلي للقناة',selected:!commentary,select:stopCommentary}];
   if(st===200&&data&&Array.isArray(data.tracks))data.tracks.slice(0,64).forEach(function(track){
    if(track&&typeof track.label==='string'&&/^anis-[a-z0-9-]{1,54}$/.test(track.id))list.push({name:track.label,selected:!!commentary&&commentary.id===track.id,select:function(){startCommentary(track)}})
   });
   if(commentary&&commentary.audible){
    var active=commentary;
    function adjust(delta){
     if(commentary!==active||!active.audible)return;
     var target=commentarySeekTarget(active.audio,delta);
     if(target===null){commentaryNotice('ضبط التوقيت غير متاح لهذا الصوت.');return}
     try{active.audio.currentTime=target;commentaryNotice(delta<0?'تم تأخير الصوت ثانية':'تم تقديم الصوت ثانية')}catch(e){commentaryNotice('تعذر ضبط توقيت الصوت.')}
    }
    if(commentarySeekTarget(active.audio,-1)!==null)list.push({name:'تأخير المعلق ثانية',selected:false,select:function(){adjust(-1)}});
    if(commentarySeekTarget(active.audio,1)!==null)list.push({name:'تقديم المعلق ثانية',selected:false,select:function(){adjust(1)}});
    // Progressive live audio may not expose a seek range. Instead allow a
    // deliberate one-second picture adjustment inside actual retained HLS bytes.
    ['back-one','forward-one'].forEach(function(action){
     if(bufferedLiveSeekTarget(video,S.play,action)===null)return;
     list.push({name:action==='back-one'?'تأخير الصورة ثانية':'تقديم الصورة ثانية',selected:false,select:function(){
      if(commentary!==active)return;
      commentaryNotice(adjustCommentaryPicture(action)?'تم طلب ضبط توقيت الصورة':'ضبط التوقيت غير متاح الآن.')
     }})
    });
   }
   if(st!==200)commentaryNotice('تعذر جلب المعلقين الآن؛ الصوت الأصلي متاح.');
   else if(list.length===1)commentaryNotice('لا يتوفر معلق إضافي لهذه القناة الآن.');
   else{var notice=document.getElementById('player-audio-notice');if(notice)notice.hidden=true}
   showPlayerChoices('المعلقين',list,origin)
  })
 }
 var commentaryButton=document.getElementById('player-commentary'),commentaryMore=document.getElementById('player-commentary-more');
 if(commentaryButton)commentaryButton.onclick=function(){openCommentaryChoices(this)};
 if(commentaryMore)commentaryMore.onclick=function(){openCommentaryChoices(this)};
 var bufferButton=document.getElementById('player-live-buffer'),timeshiftButton=document.getElementById('player-timeshift');
 function openLiveTiming(){
  if(!isLive||S.playerView!==state||S.route!=='player')return;
  var record=S.play,origin=this,options=[],range=null;
  if(record&&record.video===video){
   range=liveTimeshiftRange(video,record);
   [['earliest','أقدم نقطة محفوظة'],['back-thirty','رجوع 30 ثانية'],['back-ten','رجوع 10 ثوانٍ'],['back','رجوع 5 ثوانٍ'],['back-one','رجوع ثانية'],['forward-one','تقديم ثانية'],['forward','تقديم 5 ثوانٍ'],['forward-ten','تقديم 10 ثوانٍ'],['forward-thirty','تقديم 30 ثانية'],['latest','العودة للبث المباشر']].forEach(function(entry){
    if(liveTimeshiftTarget(video,record,entry[0])===null)return;
    options.push({name:entry[1],selected:false,select:function(){
     if(S.play!==record||S.playerView!==state||S.route!=='player')return;
     var target=liveTimeshiftTarget(video,record,entry[0]);
     if(target===null){playerStatus('انتهت صلاحية الجزء المحفوظ؛ تابع البث المباشر.');return}
     try{stopCommentary();record.userTimeshift=entry[0]!=='latest';if(record.engine&&record.engine.config)record.engine.config.liveMaxLatencyDurationCount=record.userTimeshift?Infinity:10;record.localBufferSeekUntil=Date.now()+20000;video.currentTime=target;playerStatus('')}catch(e){record.userTimeshift=false;if(record.engine&&record.engine.config)record.engine.config.liveMaxLatencyDurationCount=10;playerStatus('تعذر تغيير التوقيت لهذا المصدر.')}
    }})
   });
  }
  if(!options.length){playerStatus('انتظر حتى تتوفر ثوانٍ محفوظة من البث.');return}
  showPlayerChoices('تقديم وتأخير البث • رجوع '+range.behind+' ث • تقديم '+range.ahead+' ث',options,origin)
 }
 if(bufferButton)bufferButton.onclick=openLiveTiming;
 if(timeshiftButton)timeshiftButton.onclick=openLiveTiming;
 var mobileTiming=document.getElementById('mobile-player-timing');if(mobileTiming)mobileTiming.onclick=openLiveTiming;
 var subtitleButton=document.getElementById('player-subtitles'),localSubtitle=null,subtitleGeneration=0;
 function clearLocalSubtitle(){
  subtitleGeneration++;
  if(!localSubtitle)return;
  try{localSubtitle.element.track.mode='disabled';localSubtitle.element.remove();URL.revokeObjectURL(localSubtitle.url)}catch(e){}
  localSubtitle=null
 }
 state.disposeSubtitles=clearLocalSubtitle;
 function disableSubtitles(){
  var activeEngine=S.play&&S.play.engine;
  if(activeEngine&&activeEngine.subtitleTracks&&activeEngine.subtitleTracks.length){try{activeEngine.subtitleDisplay=false;activeEngine.subtitleTrack=-1}catch(e){}}
  var native=video.textTracks;
  if(native)for(var n=0;n<native.length;n++)if(native[n].kind==='subtitles'||native[n].kind==='captions')native[n].mode='disabled'
 }
 function localSubtitlePicker(){
  if(isLive||S.playerView!==state||S.route!=='player'||!window.FileReader||!window.URL||!URL.createObjectURL)return;
  var input=document.createElement('input');input.type='file';input.accept='.srt,.vtt,text/vtt,application/x-subrip';input.hidden=true;
  var generation=++subtitleGeneration;
  input.onchange=function(){
   var file=input.files&&input.files[0];input.remove();
   if(!file||generation!==subtitleGeneration||S.playerView!==state)return;
   if(!/\.(srt|vtt)$/i.test(file.name)||file.size<1||file.size>2*1024*1024){playerStatus('اختر ملف SRT أو VTT بحجم لا يتجاوز 2 ميغابايت.');return}
   var reader=new FileReader();
   reader.onload=function(){
    if(generation!==subtitleGeneration||S.playerView!==state||S.route!=='player')return;
    var vtt=localSubtitleVtt(String(reader.result||''));if(!vtt){playerStatus('ملف الترجمة غير صالح.');return}
    clearLocalSubtitle();disableSubtitles();
    var url=URL.createObjectURL(new Blob([vtt],{type:'text/vtt;charset=utf-8'})),track=document.createElement('track');
    track.kind='subtitles';track.label='ترجمة من الجهاز';track.srclang='ar';track.src=url;
    localSubtitle={element:track,url:url};var chosen=localSubtitle;
    track.onload=function(){if(localSubtitle===chosen&&S.playerView===state)try{track.track.mode='showing'}catch(e){}};
    track.onerror=function(){if(localSubtitle===chosen){clearLocalSubtitle();playerStatus('تعذر قراءة ملف الترجمة.')}};
    video.appendChild(track);try{track.track.mode='showing'}catch(e){}
   };
   reader.onerror=function(){if(generation===subtitleGeneration&&S.playerView===state)playerStatus('تعذر قراءة ملف الترجمة.')};
   reader.readAsText(file,'UTF-8')
  };
  input.oncancel=function(){input.remove()};root.appendChild(input);
  try{input.click()}catch(e){input.remove();playerStatus('المتصفح لا يدعم اختيار ملف الترجمة.')}
 }
 if(subtitleButton)subtitleButton.onclick=function(){
  var engine=S.play&&S.play.engine,native=video.textTracks,list=[],subs=engine&&engine.subtitleTracks||[];
  if(native)for(var i=0;i<native.length;i++)if(native[i].kind==='subtitles'||native[i].kind==='captions')list.push(native[i]);
  var options=[{name:'إيقاف الترجمة',selected:(!subs.length||engine.subtitleTrack===-1)&&list.every(function(track){return track.mode!=='showing'}),select:disableSubtitles}];
  // HLS.js manages its own subtitle tracks. Native textTracks may include
  // duplicate generated tracks; prefer the HLS API for those tracks.
  for(var k=0;k<subs.length;k++)(function(track,index){
   options.push({name:subtitleTrackLabel(track.name,track.lang,index),selected:engine.subtitleTrack===index&&engine.subtitleDisplay!==false,
    select:function(){if(!S.play||S.play.engine!==engine)return;disableSubtitles();engine.subtitleTrack=index;engine.subtitleDisplay=true}})
  })(subs[k],k);
  for(var j=0;j<list.length;j++)(function(track,index){
   if(subs.length&&(!localSubtitle||track!==localSubtitle.element.track))return;
   options.push({name:subtitleTrackLabel(track.label,track.language,index),selected:track.mode==='showing',
    select:function(){disableSubtitles();track.mode='showing'}})
  })(list[j],j);
  if(!isLive&&window.FileReader&&window.URL&&URL.createObjectURL)options.push({name:'اختيار ملف ترجمة SRT / VTT',selected:false,select:localSubtitlePicker});
  showPlayerChoices(subs.length||list.some(function(t){return !localSubtitle||t!==localSubtitle.element.track})?'الترجمة':'لا توجد مسارات ترجمة في التشغيل الحالي',options,this)
 };
 if(qualityButton)qualityButton.onclick=function(){
  // The native-like TV quality panel can explicitly switch H.264 source-copy
  // to the bounded compatible encoder when an older VIDAA decoder rejects it.
  if(isLive&&state.setHlsCompatibility){
   var modeKey='live:'+state.id+':ts:0';
   var ultra=!!(S.hlsForceUltra&&S.hlsForceUltra[modeKey]);
   var forced=ultra||!!(S.hlsForceCompatibility&&S.hlsForceCompatibility[modeKey]);
   var source=S.play&&S.play.video===video?S.play.sourceDimensions||'':'';
   var sourceH=source?Number(source.split('x')[1])||0:0;
   var choices=[
    {name:'جودة المصدر الأصلية • 4K/8K إذا توفرت ودعم الجهاز',selected:!forced,
     select:function(){state.setHlsCompatibility(false)}},
    {name:'متوافق مع التلفزيون • حتى 1080p دون تكبير الصورة',selected:forced&&!ultra,
     select:function(){state.setHlsCompatibility(true)}}
   ];
   if(sourceH>=2100){
    choices.push({name:'تجربة 4K • تحويل حتى 2160p (محرك واحد، قد يكون أبطأ)',selected:ultra,
     select:function(){state.setHlsCompatibility(true,true)}})
   }
   showPlayerChoices('جودة تشغيل البث • المصدر '+(source||'غير محدد'),choices,this);
   return
  }
  var engine=S.play&&S.play.engine,levels=engine&&engine.levels||[];
  if(!engine||!levels.length){
   var width=Number(video.videoWidth)||0,height=Number(video.videoHeight)||0;
   playerStatus('دقة الفيديو المعروضة: '+(width&&height?width+'×'+height:'بانتظار بيانات المصدر')+'؛ لا تتوفر دقات إضافية للاختيار لهذا التشغيل.');return
  }
  var options=[{name:'تلقائي',selected:engine.autoLevelEnabled!==false,
   select:function(){engine.currentLevel=-1;playerStatus('جودة تلقائية')}}];
  for(var i=0;i<levels.length;i++)(function(level,index){
   var name=level.height?level.height+'p':('الجودة '+(index+1));
   options.push({name:name,selected:engine.autoLevelEnabled===false&&engine.currentLevel===index,
    select:function(){engine.currentLevel=index;playerStatus('جودة '+name)}})
  })(levels[i],i);
  showPlayerChoices('جودة الفيديو',options,this)
 };
 var speeds=[1,1.25,1.5,2,0.75],speedBtn=document.getElementById('player-speed');
 if(isLive){
  // Broadcast must stay at 1.00x: a TV remote speed toggle would distort
  // a commentator's voice after several minutes of viewing.
  if(speedBtn){speedBtn.hidden=true;speedBtn.disabled=true}
  video.addEventListener('ratechange',function(){
   if(S.route==='player'&&S.playerView===state&&Math.abs(video.playbackRate-1)>0.001){
    video.defaultPlaybackRate=1;video.playbackRate=1
   }
  });
 }else if(speedBtn)speedBtn.onclick=function(){
  var idx=speeds.indexOf(video.playbackRate),next=speeds[(idx+1)%speeds.length];
  video.playbackRate=next;this.textContent='السرعة '+next+'×'
 };

 // VIDAA packaged web apps run chromeless. For the TV browser use Fullscreen
 // API when allowed, and an honest viewport-only fallback when blocked.
 var fullButton=document.getElementById('player-fullscreen');
 function nativeFullOwner(){return document.fullscreenElement||document.webkitFullscreenElement||
  document.mozFullScreenElement||document.msFullscreenElement||null}
 function isNativeFull(){return nativeFullOwner()===root||nativeFullOwner()===video||!!video.webkitDisplayingFullscreen}
 function isFull(){return isNativeFull()||root.classList.contains('tv-immersive')}
 function updateFullButton(){
  if(!fullButton||!fullButton.isConnected)return;
  var on=isFull();
  fullButton.textContent=on?'⤢ تصغير':'⛶ ملء الشاشة';
  fullButton.setAttribute('aria-label',on?'الخروج من ملء الشاشة':'ملء الشاشة');
  fullButton.setAttribute('aria-pressed',String(on));
  fullButton.title=on?'الخروج من ملء الشاشة':'ملء الشاشة';
  var mobileFull=document.getElementById('mobile-player-fullscreen');
  if(mobileFull){
   mobileFull.setAttribute('aria-label',on?'الخروج من ملء الشاشة':'ملء الشاشة');
   mobileFull.setAttribute('aria-pressed',String(on));
   var shortLabel=mobileFull.querySelector('small');
   if(shortLabel)shortLabel.textContent=on?'تصغير':'ملء الشاشة'
  }
 }
 function enterViewportMode(){
  if(!root.isConnected||S.route!=='player')return;
  root.classList.add('tv-immersive');
  document.documentElement.classList.add('blofy-tv-immersive');
  document.body.classList.add('blofy-tv-immersive');
  updateFullButton();
  var hint=document.getElementById('player-control-hint');
  if(hint)hint.textContent='وضع ملء الصفحة • قد يُظهر متصفح التلفزيون شريط النظام'
 }
 function exitFull(){
  var owner=nativeFullOwner(),exit=document.exitFullscreen||document.webkitExitFullscreen||
    document.mozCancelFullScreen||document.msExitFullscreen;
  if(owner&&exit){try{var p=exit.call(document);if(p&&p.catch)p.catch(function(){})}catch(err){}}
  if(video.webkitDisplayingFullscreen&&video.webkitExitFullscreen){try{video.webkitExitFullscreen()}catch(err){}}
  root.classList.remove('tv-immersive');
  document.documentElement.classList.remove('blofy-tv-immersive');
  document.body.classList.remove('blofy-tv-immersive');
  updateFullButton()
 }
 function toggleFull(){
  if(isFull()){exitFull();return}
  var request=root.requestFullscreen||root.webkitRequestFullscreen||root.mozRequestFullScreen||root.msRequestFullscreen;
  if(request){
   try{
    var p=request.call(root);
    if(p&&p.then){
     p.then(function(){updateFullButton()},function(){
      if(appleTouchBrowser(navigator.userAgent,navigator.maxTouchPoints)&&video.webkitEnterFullscreen){
       try{video.webkitEnterFullscreen();updateFullButton();return}catch(err){}
      }
      enterViewportMode()
     })
    }else setTimeout(function(){
     if(!isNativeFull()&&S.route==='player')enterViewportMode();
     else updateFullButton()
    },600);
    return
   }catch(err){}
  }
  if(/iPhone|iPad|iPod/i.test(navigator.userAgent||'')&&video.webkitEnterFullscreen){
   try{video.webkitEnterFullscreen();updateFullButton();return}catch(err){}
  }
  enterViewportMode()
 }
 state.isFullscreen=isFull;state.exitFullscreen=exitFull;state.toggleFullscreen=toggleFull;
 if(fullButton)fullButton.onclick=toggleFull;
 var mobileFullButton=document.getElementById('mobile-player-fullscreen');
 if(mobileFullButton)mobileFullButton.onclick=function(){toggleFull();revealControls()};
 function fullscreenChanged(){updateFullButton()}
 var events=['fullscreenchange','webkitfullscreenchange','mozfullscreenchange','MSFullscreenChange'];
 events.forEach(function(e){document.addEventListener(e,fullscreenChanged)});
 video.addEventListener('webkitbeginfullscreen',fullscreenChanged);
 video.addEventListener('webkitendfullscreen',fullscreenChanged);
 state.cleanupFullscreen=function(){
  events.forEach(function(e){document.removeEventListener(e,fullscreenChanged)});
  video.removeEventListener('webkitbeginfullscreen',fullscreenChanged);
  video.removeEventListener('webkitendfullscreen',fullscreenChanged);
  exitFull()
 };
 updateFullButton();
 var back30=document.getElementById('player-skip-back'),forward30=document.getElementById('player-skip-forward');
 if(back30)back30.onclick=function(){state.seekBy(-10)};
 if(forward30)forward30.onclick=function(){state.seekBy(10)};
 var forward5=document.getElementById('player-skip-forward5');
 if(forward5)forward5.onclick=function(){state.seekBy(300)};
 function jumpEpisode(targetEpisode){
  if(!targetEpisode||S.route!=='player')return;
  if(state.ready)saveResume(kind,id,checkpointPosition(state),totalDuration(),true);
  var previous=S.previousBeforePlayer||{route:'episodes',kind:'series',id:id};
  recordPlaybackQuality(state);
  cleanupPlayer();S.playerView=null;S.route='episodes';
  var selectedId=String(targetEpisode.id),checkpoint=getResume('series',selectedId);
  openPlayer('series',selectedId,targetEpisode.container_extension||'mp4',
   targetEpisode.title||'الحلقة '+(targetEpisode.episode_num||''),checkpoint&&checkpoint.position>30?checkpoint.position:0,true);
  S.previousBeforePlayer=previous;
 }
 state.afterVerifiedEnd=function(){
  if(kind!=='series'||!nextEpisode||readJson(profileStorageKey('autoNextEpisode'),true)===false||document.hidden)return;
  if(state.nextEpisodeTimer)return;
  state.nextEpisodeTimer=setTimeout(function(){state.nextEpisodeTimer=null;if(S.playerView===state&&S.route==='player'&&state.completed&&!document.hidden&&readJson(profileStorageKey('autoNextEpisode'),true)!==false)jumpEpisode(nextEpisode)},3000)
 };
 var nextBtn=document.getElementById('player-next-episode'),previousBtn=document.getElementById('player-previous-episode');
 if(nextBtn&&nextEpisode)nextBtn.onclick=function(){jumpEpisode(nextEpisode)};
 if(previousBtn&&previousEpisode)previousBtn.onclick=function(){jumpEpisode(previousEpisode)};
 var mobilePrevious=document.getElementById('mobile-player-previous'),
  mobileNext=document.getElementById('mobile-player-next');
 if(mobilePlay)mobilePlay.onclick=function(){
  if(S.route!=='player'||S.playerView!==state||!state.toggle)return;
  state.toggle();revealControls()
 };
 if(mobilePrevious)mobilePrevious.onclick=function(){
  if(S.route!=='player'||S.playerView!==state)return;
  if(isLive&&state.switchChannel)state.switchChannel(-1);
  else if(previousEpisode)jumpEpisode(previousEpisode);
  else if(state.seekBy)state.seekBy(-10);
  if(S.route==='player'&&S.playerView===state)revealControls()
 };
 if(mobileNext)mobileNext.onclick=function(){
  if(S.route!=='player'||S.playerView!==state)return;
  if(isLive&&state.switchChannel)state.switchChannel(1);
  else if(nextEpisode)jumpEpisode(nextEpisode);
  else if(state.seekBy)state.seekBy(10);
  if(S.route==='player'&&S.playerView===state)revealControls()
 };
 var seek=document.getElementById('seek');
 if(seek)seek.onchange=function(){
  var duration=totalDuration(),target=Math.round(duration*Number(this.value)/1000);
  if(!(duration>0))return;
  seekTo(target)
 };
 // Register the player before starting its media engine. The native-like
 // quality dialog and first-frame callbacks need state during startup.
 S.playerView=state;
 if(isLive){playHls(video,kind,id,'ts',0,document.getElementById('player-status'),false)}
 else if(ext==='mp4'){startDirect()}
 else{startWithMetadata(Math.round(resume))}
 if(isLive){
  function liveItems(){
   var listing=S.loaded[keyOf('live',S.cat.live)]||S.loaded['live:all'];
   return listing&&Array.isArray(listing.items)?listing.items:[]
  }
  function selectFullscreenChannel(requestedId){
   if(S.route!=='player'||S.playerView!==state)return;
   var items=liveItems(),next=items.find(function(item){return itemId(item,'live')===String(requestedId)});
   if(!next){playerStatus('هذه القناة ليست في القائمة المحمّلة؛ ارجع للقائمة لعرض المزيد.');return}
   var newId=itemId(next,'live');
   if(!newId||newId===String(id))return;
   if(state.stopCommentary)state.stopCommentary();
   id=newId;state.id=id;state.name=title(next);state.ready=false;S.selected=id;S.livePreview=null;
   if(state.stats){state.pictureObservationAllowed=false;state.stats.liveEvents=[];state.stats.firstFrameAt=0;state.stats.firstFrameBasis=null;state.stats.openedAt=Date.now();
    // Do not report the previous channel's frozen frames as this channel's QoE.
    state.stats.visualOutageCount=0;state.stats.visualOutageMs=0;state.stats.longestVisualOutageMs=0;
    state.stats.visualOutageByEngine={hls:{count:0,ms:0},mpegts:{count:0,ms:0}};
    recordLiveIncident('channel_switch')}
   if(state.refreshFavoriteButton)state.refreshFavoriteButton();
   var qualityPath=document.getElementById('player-source-mode');if(qualityPath)qualityPath.hidden=true;
   var heading=document.getElementById('player-title-text');if(heading)heading.textContent=state.name;
   if(state.liveEpgTimer){clearTimeout(state.liveEpgTimer);state.liveEpgTimer=null}
   var epg=document.getElementById('player-live-epg');if(epg)epg.textContent='جار قراءة دليل القناة…';
   if(state.firstPictureFrameId!==null&&state.firstPictureFrameId!==undefined&&
      typeof video.cancelVideoFrameCallback==='function'){
    try{video.cancelVideoFrameCallback(state.firstPictureFrameId)}catch(e){}
    state.firstPictureFrameId=null
   }
   playerStatus('جار التبديل إلى '+state.name+'…');
   if(state.channelSwitchTimer)clearTimeout(state.channelSwitchTimer);
   state.channelSwitchTimer=setTimeout(function(){
    state.channelSwitchTimer=null;
    if(S.route!=='player'||S.playerView!==state)return;
    playHls(video,'live',id,'ts',0,document.getElementById('player-status'),false);
    if(state.refreshLiveGuide)state.refreshLiveGuide()
   },260)
  }
  function switchChannel(step){
   var items=liveItems(),current=items.findIndex(function(item){return itemId(item,'live')===String(id)});
   if(current<0||!items.length){playerStatus('افتح قائمة القنوات أولًا ثم حاول التبديل.');return}
   selectFullscreenChannel(itemId(items[(current+step+items.length)%items.length],'live'))
  }
  function closeLiveChannels(){
   var panel=document.getElementById('player-channel-panel');
   if(panel)panel.hidden=true;
   var toggle=document.getElementById('player-channels-toggle');
   if(toggle)toggle.setAttribute('aria-expanded','false')
  }
  function openLiveChannels(){
   if(S.route!=='player'||S.playerView!==state)return;
   var panel=document.getElementById('player-channel-panel'),items=liveItems();
   if(!panel)return;
   var chosen=String(id);
   panel.innerHTML='<div class="native-channel-heading"><strong>القنوات</strong>'+
    '<button class="native-channel-close" id="player-channel-close" type="button">✕ إغلاق</button></div>'+
    '<div class="native-channel-items">'+(items.length?items.slice(0,150).map(function(ch){
     var cid=itemId(ch,'live'),selected=cid===chosen;
     return '<button class="native-channel-item'+(selected?' selected':'')+'" data-player-channel="'+esc(cid)+'">'+
      (art(ch)?safeImg(ch,'native-channel-art'):'<span class="native-channel-art native-channel-empty">◉</span>')+
      '<span>'+esc(title(ch))+'</span>'+(selected?'<span class="native-channel-now">يعمل الآن</span>':'')+'</button>'
    }).join(''):'<div class="info">لا توجد قنوات محمّلة في هذا التصنيف.</div>')+'</div>'+
    (items.length>150?'<p class="small muted">لعرض بقية القنوات، افتح القائمة الرئيسية.</p>':'');
   panel.hidden=false;
   var toggle=document.getElementById('player-channels-toggle');if(toggle)toggle.setAttribute('aria-expanded','true');
   var root=document.getElementById('player-root');if(root)root.classList.remove('controls-hidden');
   var close=document.getElementById('player-channel-close');
   if(close)close.onclick=function(){closeLiveChannels();if(video)video.focus()};
   Array.prototype.forEach.call(panel.querySelectorAll('[data-player-channel]'),function(button){
    button.onclick=function(){
     selectFullscreenChannel(button.getAttribute('data-player-channel'));
     closeLiveChannels();
     if(video)video.focus()
    }
   });
   var selectedButton=panel.querySelector('.native-channel-item.selected')||panel.querySelector('.native-channel-item');
   if(selectedButton){selectedButton.focus();selectedButton.scrollIntoView({block:'nearest'})}
  }
  state.switchChannel=switchChannel;
  state.openChannels=openLiveChannels;
  state.closeChannels=closeLiveChannels;
  var channelToggle=document.getElementById('player-channels-toggle');
  if(channelToggle)channelToggle.onclick=function(){
   var panel=document.getElementById('player-channel-panel');
   if(panel&&!panel.hidden)closeLiveChannels();else openLiveChannels()
  };
  var previousChannel=document.getElementById('player-channel-prev'),nextChannel=document.getElementById('player-channel-next');
  if(previousChannel)previousChannel.onclick=function(){switchChannel(-1)};
  if(nextChannel)nextChannel.onclick=function(){switchChannel(1)};

  // Do not poll provider guide continuously; a 10-minute refresh is enough.
  function refreshLiveGuide(){
   if(S.route!=='player'||S.playerView!==state||!S.userVerified)return;
   var requestedId=String(id);
   var el=document.getElementById('player-live-epg');
   if(!el)return;
   if(state.liveEpgTimer){clearTimeout(state.liveEpgTimer);state.liveEpgTimer=null}
   var guide=document.querySelector('.player-live-guide');
   if(phoneLiveLayout()&&(!guide||!guide.classList.contains('phone-guide-open')))return;
   var cached=S.epgCache[String(id)],fresh=cached&&Date.now()-cached.time<300000;
   if(fresh)el.innerHTML=cached.html;
   else{
    el.textContent='جار قراءة دليل القناة…';
    api('GET','/api/catalog?action=get_short_epg&stream_id='+enc(id)+'&limit=5',null,function(st,data){
     if(S.route!=='player'||S.playerView!==state||String(id)!==requestedId)return;
     var node=document.getElementById('player-live-epg');if(!node)return;
     var html=st===200?formatEpg(data):'<span class="epg-empty">دليل البرامج غير متوفر حاليًا.</span>';
     node.innerHTML=html;
     if(st===200)S.epgCache[String(id)]={html:html,time:Date.now()}
    })
   }
   state.liveEpgTimer=setTimeout(refreshLiveGuide,10*60*1000)
  }
  state.refreshLiveGuide=refreshLiveGuide;
  refreshLiveGuide()
 }
}
function closePlayer(){
 var state=S.playerView;
 if(state&&S.route==='player')recordPlaybackQuality(state);
 if(state&&S.route==='player'&&state.kind!=='live'){
  var pos=checkpointPosition(state),duration=playbackDuration(state);
  if(state.ready)saveResume(state.kind,state.id,pos,duration,true)
 }
 cleanupPlayer();
 var previous=S.previousBeforePlayer||{route:'home'};
 S.playerView=null;S.route=previous.route==='player'?'home':previous.route;
 if(previous.route==='detail')navigate('detail',{kind:previous.kind,id:previous.id},true);
 else if(previous.route==='episodes')navigate('episodes',{id:S.item&&S.item.id},true);
 else navigate(previous.route||'home',{},true)
}
window.addEventListener('error',function(e){
 var target=e&&e.target;
 if(target&&target.tagName==='IMG'){
  var fallbacks=[];try{fallbacks=JSON.parse(target.getAttribute('data-art-fallback')||'[]')}catch(err){}
  if(Array.isArray(fallbacks)&&fallbacks.length){
   var next=fallbacks.shift();target.setAttribute('data-art-fallback',JSON.stringify(fallbacks));
   target.src=next;return
  }
  var card=target.closest&&target.closest('[data-details]'),holder=target.parentNode;
  if(card&&holder&&holder.classList.contains('poster-art')){
   var key=card.getAttribute('data-details')||'',split=key.indexOf(':'),kind=key.slice(0,split),id=key.slice(split+1);
   var item=findItem(kind,id);holder.setAttribute('data-art-failed',target.getAttribute('src')||'');
   target.remove();if(item&&split>0)enrichPosters(kind,[item],true);return
  }
  target.style.display='none';return
 }
 if(S.route!=='login')diagnose(S.kind,'play_rejected','direct',0);
},true);

function clickHandler(event){
 var node=event.target;while(node&&node!==document.body&&!node.hasAttribute('data-back')&&!node.getAttribute('data-go')&&!node.getAttribute('data-cat')&&!node.getAttribute('data-details')&&!node.getAttribute('data-channel')&&!node.getAttribute('data-more')&&!node.getAttribute('data-sort')&&!node.getAttribute('data-watch')&&!node.getAttribute('data-episodes')&&!node.getAttribute('data-season')&&!node.getAttribute('data-favorite')&&!node.hasAttribute('data-preview-play')&&!node.hasAttribute('data-preview-full')&&!node.getAttribute('data-reload')&&!node.getAttribute('data-download'))node=node.parentNode;
 if(!node||node===document.body)return;
 var go=node.getAttribute('data-go'),cat=node.getAttribute('data-cat'),det=node.getAttribute('data-details'),ch=node.getAttribute('data-channel'),more=node.getAttribute('data-more'),season=node.getAttribute('data-season'),watch=node.getAttribute('data-watch'),ep=node.getAttribute('data-episodes'),fav=node.getAttribute('data-favorite');
 var download=node.getAttribute('data-download');if(download){var parts=download.split(':');saveOfflineDownload(parts[0],parts[1],node.getAttribute('data-ext'),node.getAttribute('data-name'));return}
 if(node.hasAttribute('data-back')){back();return}
 if(go){if(go!==S.route)navigate(go);return}
 if(cat){var parts=cat.split(':'),kind=parts[0];
  changeCatalogCategory(kind,parts[1]||'all');return}
 if(det){var sep=det.indexOf(':'),kind=det.slice(0,sep),id=det.slice(sep+1);
  if(kind==='live'){var channel=findItem('live',id);openPlayer('live',id,'ts',title(channel),0);return}
  navigate('detail',{kind:kind,id:id});return}
 if(ch){selectChannel(ch,true);return}
 if(more){loadMore(more);return}
 if(node.getAttribute('data-sort')){
  S.sort=S.sort==='source'?'new':S.sort==='new'?'alpha':'source';
  renderCategoryItems(S.kind,currentListing());return
 }
 if(ep){navigate('episodes',{id:ep});return}
 if(season){S.selectedSeason=season;episodesScreen({id:S.item&&S.item.id});return}
 if(fav){
  rememberView();S.library[fav]=!S.library[fav];
  if(S.library[fav]){
   var split=fav.indexOf(':'),kind=fav.slice(0,split),id=fav.slice(split+1),item=findItem(kind,id)||S.item&&S.item.data;
   if(item){
    var record={id:id,name:String(title(item)).slice(0,160),stream_icon:art(item),container_extension:item.container_extension||'mp4'};
    if(kind==='series')record.series_id=id;else record.stream_id=id;
    S.favoriteItems[fav]=record
   }
  }else delete S.favoriteItems[fav];
  profileSave('favorites',S.library);
  profileSave('favoriteItems',S.favoriteItems);
  if(S.route==='live'){
   var liveFavorite=document.getElementById('live-favorite');
   if(liveFavorite)liveFavorite.textContent=S.library[fav]?'♥ إزالة من المفضلة':'♡ المفضلة'
  }else if(S.route==='detail'&&S.item)details({kind:S.item.kind,id:S.item.id});else favoritesScreen();
  return
 }
 if(watch){var a=watch.split(':'),kind=a[0],id=a[1],it=findItem(kind,id),ext=node.getAttribute('data-ext')||(it&&it.container_extension)||'mp4',name=node.getAttribute('data-name')||title(it);openPlayer(kind,id,ext,name,Number(node.getAttribute('data-from'))||0);return}
 if(node.hasAttribute('data-preview-play')){var x=findItem('live',S.selected);if(x)beginPreview(x);return}
 if(node.hasAttribute('data-preview-full')){var live=findItem('live',S.selected);if(live)openPlayer('live',S.selected,'ts',title(live),0);return}
 if(node.hasAttribute('data-reload')){delete S.loaded[keyOf(node.getAttribute('data-reload'),S.cat[node.getAttribute('data-reload')])];catalog(node.getAttribute('data-reload'))}
}
function directional(e){
 var code=e.keyCode||e.which||({ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Enter:13,Escape:27,Backspace:8,GoBack:461,Back:461}[e.key]||0);
 var editable=e.target&&((e.target.tagName==='INPUT'&&e.target.type!=='range')||
  /^(TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable);
 if(code===37||code===38||code===39||code===40||code===13||code===27||
    code===461||code===10009||code===8&&!editable){
  lastRemoteKeyAt=Date.now();
  setDeviceInput('remote')
 }
 if(code===27||code===461||code===10009||code===8){
  if(editable&&code===8)return;
  if(S.route==='login')return;
  if(S.route==='player'){
   var choice=document.getElementById('player-choice-panel');
   if(choice&&!choice.hidden&&S.playerView&&S.playerView.closePlayerChoices){S.playerView.closePlayerChoices();e.preventDefault();return}
   var channels=document.getElementById('player-channel-panel');
   if(channels&&!channels.hidden&&S.playerView&&S.playerView.closeChannels){S.playerView.closeChannels();e.preventDefault();return}
   var report=document.getElementById('player-diagnostic-panel');
   if(report&&!report.hidden){
    report.hidden=true;
    var reportBtn=document.getElementById('player-diagnostic-toggle');
    if(reportBtn)reportBtn.setAttribute('aria-expanded','false');
    e.preventDefault();return
   }
   var panel=document.getElementById('player-more-panel');
   if(panel&&!panel.hidden){panel.hidden=true;var more=document.getElementById('player-options-toggle');if(more)more.setAttribute('aria-expanded','false');e.preventDefault();return}
   var info=document.getElementById('player-info-panel');
   if(info&&!info.hidden){info.hidden=true;var infoBtn=document.getElementById('player-info-toggle');if(infoBtn)infoBtn.setAttribute('aria-expanded','false');e.preventDefault();return}
   var jump=document.getElementById('player-jump-panel');
   if(jump&&!jump.hidden){jump.hidden=true;e.preventDefault();return}
   if(S.playerView&&S.playerView.isFullscreen&&S.playerView.isFullscreen()){
    e.preventDefault();S.playerView.exitFullscreen();return
   }
  }
  e.preventDefault();back();return
 }
 if(S.route==='player'&&!editable&&(code===37||code===38||code===39||code===40)){
  var activePanel=document.getElementById('player-choice-panel');
  if(!activePanel||activePanel.hidden)activePanel=document.getElementById('player-channel-panel');
  if(activePanel&&!activePanel.hidden){
   var panelButtons=Array.prototype.slice.call(activePanel.querySelectorAll('button:not([disabled])'));
   if(panelButtons.length){
    var currentIndex=panelButtons.indexOf(document.activeElement);
    var step=code===38||code===37?-1:1;
    var targetIndex=currentIndex<0?0:(currentIndex+step+panelButtons.length)%panelButtons.length;
    e.preventDefault();
    panelButtons[targetIndex].focus();
    panelButtons[targetIndex].scrollIntoView({block:'nearest'});
    return
   }
  }
 }
 if(S.route==='player'&&!editable&&(code===37||code===38||code===39||code===40)){
  var hiddenRoot=document.getElementById('player-root');
  if(hiddenRoot&&hiddenRoot.classList.contains('controls-hidden')&&S.playerView&&S.playerView.revealControls){
   e.preventDefault();S.playerView.revealControls();
   var focusTarget=document.getElementById(code===38?'player-audio':'player-toggle');
   if(focusTarget)focusTarget.focus();
   return
  }
 }
 if(S.route==='player'&&!editable){
  var transport=S.playerView;
  if(code===70&&transport&&transport.toggleFullscreen){e.preventDefault();transport.toggleFullscreen();return}
  if(code===413){e.preventDefault();back();return}
  if((code===415||code===19||code===179)&&transport){
   e.preventDefault();
   if(code===415&&!transport.video.paused)return;
   if(code===19&&transport.video.paused)return;
   transport.toggle();return
  }
  if((code===412||code===417)&&transport&&transport.kind!=='live'&&transport.seekBy){
   e.preventDefault();transport.seekBy(code===412?-10:10);return
  }
  if((code===427||code===428)&&transport&&transport.kind==='live'&&transport.switchChannel){
   e.preventDefault();transport.switchChannel(code===427?1:-1);return
  }
 }
 if(S.route==='player'&&(!editable||document.activeElement&&document.activeElement.id==='seek')){
  var p=S.playerView,active=document.activeElement;
  if(code===13&&p&&p.kind==='live'&&p.openChannels&&(!active||active===document.body||active===p.video)){
   e.preventDefault();p.openChannels();return
  }
  if(code===32||code===13){
   if(p&&p.toggle&&(!active||active===document.body||active===p.video)){
    e.preventDefault();p.toggle();return
   }
  }
  if(p&&p.kind==='live'&&(code===38||code===40)&&
   (!active||active===document.body||active===p.video)){
   var audio=document.getElementById('player-audio');
   if(audio){e.preventDefault();var root=document.getElementById('player-root');if(root)root.classList.remove('controls-hidden');audio.focus();return}
  }
  if(p&&p.kind==='live'&&p.switchChannel&&(code===33||code===34)){
   e.preventDefault();p.switchChannel(code===33?-1:1);return
  }
  if(p&&p.kind!=='live'&&p.seekBy&&(code===37||code===39)&&
   ((!active||active===document.body||active===p.video)||active.id==='seek')){
   // Keep focus on the time slider. Old TV browsers otherwise treat arrows
   // as navigation and jump away instead of seeking.
   e.preventDefault();p.seekBy(code===37?-10:10);return
  }
 }
 if(!editable&&S.userVerified&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&code===191&&S.route!=='player'){
  e.preventDefault();navigate('search');return
 }
 if(code!==37&&code!==38&&code!==39&&code!==40)return;
 if(editable){
  // On a television leave the field with Up/Down, keeping left/right for text editing.
  if(document.documentElement.getAttribute('data-blofy-device')!=='tv'||(code!==38&&code!==40)||e.target.tagName==='SELECT')return;
 }
 var nodes=document.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href],select:not([disabled]),[tabindex]:not([tabindex="-1"])'),arr=[];
 for(var i=0;i<nodes.length;i++){
  var node=nodes[i],r=node.getBoundingClientRect();
  if(r.width>0&&r.height>0&&node.tabIndex>=0&&(!node.closest||!node.closest('[hidden],[aria-hidden="true"],[inert]'))&&getComputedStyle(node).visibility!=='hidden')arr.push({node:node,x:r.left+r.width/2,y:r.top+r.height/2})
 }
 var active=document.activeElement,from=null;
 for(var j=0;j<arr.length;j++)if(arr[j].node===active){from=arr[j];break}
 if(!from){
  var preferred=document.querySelector('.cat-item.selected,.hero-actions .btn,.episode-row,.poster,.channel-item,.story,.detail-actions .btn,.player-actions .btn')||document.querySelector('.rail-link.active');
  if(preferred){preferred.focus();e.preventDefault()}return
 }
 var best=null,score=1e9;
 for(var k=0;k<arr.length;k++){
  var n=arr[k],dx=n.x-from.x,dy=n.y-from.y;
  if(n.node===active)continue;
  if(code===37&&dx>=-3||code===39&&dx<=3||code===38&&dy>=-3||code===40&&dy<=3)continue;
  var primary=(code===37||code===39)?Math.abs(dx):Math.abs(dy);
  var secondary=(code===37||code===39)?Math.abs(dy):Math.abs(dx);
  var metric=primary+secondary*2.7;
  if(metric<score){best=n;score=metric}
 }
 if(best){
  try{best.node.focus({preventScroll:true})}catch(err){best.node.focus()}
  try{best.node.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'})}catch(err){best.node.scrollIntoView(false)}
  e.preventDefault()
 }
}
document.addEventListener('pointerdown',function(e){
 if(e&&(e.pointerType==='touch'||e.pointerType==='pen')){setDeviceInput('touch');return}
 // Some TV remotes synthesize a mouse event after OK/Enter.
 if(document.documentElement.getAttribute('data-blofy-device')==='tv'&&
    Date.now()-lastRemoteKeyAt<600)return;
 setDeviceInput('mouse')
},true);
if(!window.PointerEvent)document.addEventListener('touchstart',function(){
 setDeviceInput('touch')
},true);
document.addEventListener('focusin',function(e){
 var old=document.querySelector('.remote-focus');
 if(old&&old!==e.target)old.classList.remove('remote-focus');
 if(S.keyboardMode&&e.target&&e.target.classList)e.target.classList.add('remote-focus')
},true);
document.addEventListener('focusout',function(e){
 if(e.target&&e.target.classList)e.target.classList.remove('remote-focus')
},true);
document.addEventListener('click',clickHandler,false);
document.addEventListener('keydown',directional,false);
function persistPlaybackCheckpoint(){
 var p=S.playerView;
 if(!p||!p.ready||p.kind==='live')return;
 var pos=checkpointPosition(p),duration=playbackDuration(p);
 saveResume(p.kind,p.id,pos,duration,true)
}
window.addEventListener('beforeunload',function(){
 persistPlaybackCheckpoint();
 if(S.playerView)recordPlaybackQuality(S.playerView)
});
window.addEventListener('pagehide',persistPlaybackCheckpoint);
/* Browser network indicators are advisory; never claim to know the quality
 * of Xtream or create another FFmpeg session when Wi-Fi reconnects. */
var connectivityHideTimer=null;
function showBrowserConnectionNotice(online){
 var box=document.getElementById('blofy-connectivity-notice');
 if(!box){
  box=document.createElement('div');box.id='blofy-connectivity-notice';
  box.setAttribute('role','status');box.setAttribute('aria-live','polite');
  document.body.appendChild(box)
 }
 if(connectivityHideTimer){clearTimeout(connectivityHideTimer);connectivityHideTimer=null}
 box.textContent=browserConnectionCopy(online);box.hidden=false;
 box.setAttribute('data-connection',online?'restored':'offline');
 if(online)connectivityHideTimer=setTimeout(function(){
  connectivityHideTimer=null;if(box.isConnected)box.hidden=true
 },5000)
}
window.addEventListener('offline',function(){showBrowserConnectionNotice(false)});
window.addEventListener('online',function(){showBrowserConnectionNotice(true)});
if(navigator.onLine===false)showBrowserConnectionNotice(false);
document.addEventListener('visibilitychange',function(){
 if(document.hidden){
  persistPlaybackCheckpoint();
  if(S.playerView&&S.playerView.releaseWakeLock)S.playerView.releaseWakeLock()
 }else if(S.playerView&&S.playerView.acquireWakeLock)S.playerView.acquireWakeLock()
});
try{window.history.replaceState({blofyStreamWeb:true,depth:0,route:'boot'},'',window.location.href)}catch(e){}
function bootSession(attempt){
 if(navigator.onLine===false&&offlineOnlyScreen())return;
 api('GET','/api/session',null,function(st,data){
  if(S.route!=='boot'||S.userVerified)return;
  if(st===200&&data.active&&useProfile(data.profileKey,data.legacyProfileKey)){S.userVerified=true;rememberOfflineGrant(data.profileKey,data.expiresAt);navigate('home',{},true);warmDesktopHlsAfterAuth();setTimeout(checkCatalogVersion,25000);return}
  if(st===401||st===403||(st===200&&data.active===false)){login('أدخل كود اشتراك BLOFY STREAM للتفعيل');return}
  if(attempt<3){setTimeout(function(){if(S.route==='boot'&&!S.userVerified)bootSession(attempt+1)},[1000,2500,5000][attempt]);return}
  app.innerHTML='<div class="login-screen"><div class="login-panel"><div class="login-brand">BLOFY<small>STREAM</small></div><p>تعذر الاتصال مؤقتًا. لم يتم إلغاء اشتراكك.</p><button class="btn" id="retry-session">إعادة المحاولة</button></div></div>';
  document.getElementById('retry-session').onclick=function(){this.disabled=true;bootSession(0)}
 })
}
bootSession(0);
setInterval(checkCatalogVersion,10*60*1000);
// Install prompts are optional browser capabilities: never fake a native
// install on iOS or VIDAA. Only prompt after an explicit user gesture.
window.addEventListener('beforeinstallprompt',function(event){
 if(event&&event.preventDefault)event.preventDefault();
 pendingInstallPrompt=event;
 updateInstallGuide()
});
window.addEventListener('appinstalled',function(){
 pendingInstallPrompt=null;
 updateInstallGuide()
});
/* A newly activated shell must never interrupt an active film or TV
 * channel. Offer reload only on a non-player page and only when an existing
 * controller was genuinely replaced (not first-install activation). */
var freshShellAvailable=false,previousShellController=null,lastShellCheckAt=0;
function showWebShellUpdateHint(){
 var note=document.getElementById('blofy-shell-update');
 if(!freshShellAvailable||S.route==='player'){
  if(note)note.hidden=true;return
 }
 if(!note){
  note=document.createElement('div');note.id='blofy-shell-update';
  note.setAttribute('role','status');note.setAttribute('aria-live','polite');
  note.innerHTML='<span>يتوفر تحديث جديد لواجهة BLOFY STREAM.</span> '+
   '<button type="button" id="blofy-reload-shell">تحديث الآن</button>';
  document.body.appendChild(note);
  var apply=document.getElementById('blofy-reload-shell');
  apply.onclick=function(){
   if(S.route==='player')return; // A click cannot interrupt a video.
   try{window.location.reload()}catch(e){}
  }
 }
 note.hidden=false
}
// Shell-only service worker: it never caches customer data, Xtream,
// subscription APIs or media. Browser detection is optional on older TVs.
if('serviceWorker' in navigator&&window.isSecureContext){
 previousShellController=navigator.serviceWorker.controller||null;
 navigator.serviceWorker.addEventListener('controllerchange',function(){
  var current=navigator.serviceWorker.controller||null;
  if(previousShellController&&current&&current!==previousShellController){
   freshShellAvailable=true;showWebShellUpdateHint()
  }
  previousShellController=current
 });
 window.addEventListener('load',function(){
  navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(function(reg){
   if(!reg||!reg.update)return;
   // Coalesce one low-priority update check per 30 minutes; never during
   // active playback or while the device reports offline.
   function checkShellUpdate(){
    var now=Date.now();
    if(S.route==='player'||navigator.onLine===false||
      now-lastShellCheckAt<30*60*1000)return;
    lastShellCheckAt=now;
    try{var pending=reg.update();if(pending&&pending.catch)pending.catch(function(){})}catch(e){}
   }
   checkShellUpdate();
   document.addEventListener('visibilitychange',function(){
    if(!document.hidden)checkShellUpdate()
   })
  }).catch(function(){})
 })
}
})();