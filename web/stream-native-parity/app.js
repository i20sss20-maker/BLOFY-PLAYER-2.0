/* BLOFY STREAM Web — visual parity port from Android STREAM 56.0.4.
 * Source references in README.md; native Android-only APIs are not emulated.
 * ES5-compatible UI code for older VIDAA WebKit/Chromium engines.
 * Playback is deliberately distinct: LIVE HLS, VOD seekable MP4 when possible.
 */
(function(){
'use strict';
var app=document.getElementById('app');
var S={route:'boot',kind:'movie',cat:{live:'all',movie:'all',series:'all'},cats:{},pages:{},loaded:{},selected:null,livePreview:null,
 item:null,episodes:null,selectedSeason:'1',play:null,history:[],sort:'source',heroIndex:0,searchToken:0,requestNum:0,library:readJson('blofy_web_favorites_v2',{}),
 watch:readJson('blofy_web_watch_v2',{}),host:'',userVerified:false,heading:'',loading:false,listingInflight:{},catsInflight:{},views:{},keyboardMode:false};
var NAV=[['home','⌂','الرئيسية'],['live','◉','البث المباشر'],['movie','▣','الأفلام'],['series','▤','المسلسلات'],['collections','▦','التصنيفات'],['favorites','♡','المفضلة'],['search','⌕','البحث'],['ai','✧','الذكاء الاصطناعي'],['settings','⚙','الإعدادات']];
function readJson(key,backup){try{var value=JSON.parse(localStorage.getItem(key)||'null');return value||backup}catch(e){return backup}}
function writeJson(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(e){}}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function enc(s){return encodeURIComponent(String(s==null?'':s))}
function urlPic(raw){if(Array.isArray(raw))raw=raw[0];if(typeof raw!=='string')return '';var s=raw.trim();if(!/^https?:\/\/[^\s<>]+$/i.test(s))return '';if(/[?&](username|password|token|api_key|auth)=/i.test(s))return '';if(s.slice(0,5)==='http:')s='https:'+s.slice(5);return s}
function art(x){if(!x)return '';var arr=[x.stream_icon,x.cover_big,x.cover,x.movie_image,x.poster,x.poster_url,x.thumbnail,x.icon,x.backdrop,x.backdrop_path];for(var i=0;i<arr.length;i++){var p=urlPic(arr[i]);if(p)return p}return ''}
function title(x){return x&&(x.name||x.title||x.episode_name)||'بدون عنوان'}
function kindName(k){return k==='live'?'البث المباشر':k==='movie'?'الأفلام':k==='series'?'المسلسلات':'BLOFY STREAM'}
function itemId(x,k){return String(x?(k==='series'?(x.series_id||x.id):(x.stream_id||x.id))||'':'')}
function findItem(k,id){var sets=[];var keys=Object.keys(S.loaded);for(var i=0;i<keys.length;i++)if(keys[i].indexOf(k+':')===0)sets.push(S.loaded[keys[i]].items||[]);for(var a=0;a<sets.length;a++)for(var b=0;b<sets[a].length;b++)if(itemId(sets[a][b],k)===id)return sets[a][b];return null}
function api(method,endpoint,payload,cb){
 var xhr=new XMLHttpRequest(),done=false;
 try{xhr.open(method,endpoint,true);xhr.withCredentials=true;xhr.timeout=40000;
 xhr.setRequestHeader('Accept','application/json');if(method==='POST')xhr.setRequestHeader('Content-Type','application/json');
 xhr.onreadystatechange=function(){if(xhr.readyState===4&&!done){done=true;var json={};try{json=JSON.parse(xhr.responseText)}catch(e){}cb(xhr.status,json)}};
 xhr.onerror=xhr.ontimeout=function(){if(!done){done=true;cb(0,{error:'network_unavailable'})}};
 xhr.send(payload?JSON.stringify(payload):null)
 }catch(e){cb(0,{error:'request_failed'})}
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
function login(message){
 cleanupPlayer();S.route='login';S.userVerified=false;S.history=[];
 app.innerHTML='<div class="login-screen screen-appear"><div class="login-panel">'+
 '<div class="login-brand">BLOFY<small>STREAM</small></div><p>أدخل كود BLOFY STREAM لعرض مكتبتك</p>'+
 '<input class="input" id="activation-code" placeholder="كود التفعيل" maxlength="24" inputmode="numeric" autocomplete="off" autofocus>'+
 '<button class="btn" id="redeem">تفعيل الاشتراك</button><div class="login-status" id="login-status">'+esc(message||'تفعيل بالكود فقط • نسخة ويب تحت التطوير')+'</div>'+
 '</div></div>';
 var button=document.getElementById('redeem');
 button.onclick=redeem;
 document.getElementById('activation-code').onkeydown=function(e){if((e.keyCode||e.which)===13)redeem()};
 setTimeout(function(){(document.getElementById('activation-code')||{focus:function(){}}).focus()},70)
}
function redeem(){
 var code=(document.getElementById('activation-code').value||'').replace(/[\s-]/g,'').toUpperCase();
 if(!/^([0-9]{8,12}|[A-F0-9]{24})$/.test(code)){setStatus('تأكد من إدخال كود BLOFY STREAM الصحيح',true);return}
 var btn=document.getElementById('redeem');btn.disabled=true;setStatus('جار التحقق من التفعيل…');
 api('POST','/api/redeem',{code:code,deviceKey:deviceKey()},function(st,r){
  btn.disabled=false;
  if(st===200&&r.ok){S.userVerified=true;navigate('home',{},true)}
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
 var keys=['data-cat','data-channel','data-details','data-watch','data-more','data-season','data-go','data-episodes','data-sort','data-favorite','data-back'];
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
function navHtml(){
 return '<aside class="rail"><div class="brand">BLOFY<em>STREAM</em></div>'+
 NAV.map(function(v){return '<button class="rail-link '+(S.route===v[0]?'active':'')+'" data-go="'+v[0]+'"><span class="symbol">'+v[1]+'</span><span>'+v[2]+'</span></button>'}).join('')+
 '<div class="rail-foot">BLOFY STREAM · WEB</div></aside>'
}
function shell(pageTitle,markup){
 S.heading=pageTitle;app.innerHTML='<div class="app screen-appear">'+navHtml()+'<main class="workspace" id="workspace">'+
 '<div class="toolbar"><h1>'+esc(pageTitle)+'</h1><div class="row">'+(S.route==='home'?'':'<button class="btn secondary back-nav" data-back="1">↶ رجوع</button>')+'<button class="btn secondary" data-go="search">⌕ بحث</button></div></div>'+
 '<div id="screen">'+markup+'</div></main></div>';
 // Pages restore their own controls after data arrives rather than focusing the sidebar.
}
function loading(label){return '<div class="empty-state"><div class="skeleton" style="width:48px;height:48px;border-radius:50%;margin:0 auto 12px"></div>جار تحميل '+esc(label)+' من المكتبة…</div>'}
function navigate(route,opts,replace){
 if(route!==S.route)rememberView();
 if(!S.userVerified&&route!=='login'){login('يرجى تفعيل الكود أولًا');return}
 // Release any live preview session before leaving its page (not just full-screen player).
 if(S.play&&(S.route==='player'||S.route==='live')&&route!==S.route)cleanupPlayer();
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
  if(S.history.length>30)S.history.shift()
 }
 S.route=route;
 if(route==='home')home();
 else if(route==='live'||route==='movie'||route==='series')catalog(route);
 else if(route==='detail')details(opts||{});
 else if(route==='episodes')episodesScreen(opts||{});
 else if(route==='favorites')favoritesScreen();
 else if(route==='search')searchScreen();
 else if(route==='ai')aiScreen();
 else if(route==='settings')settingsScreen();
 else if(route==='collections')collectionsScreen();
 else home()
}
function back(){
 if(S.route==='player'){closePlayer();return}
 var prev=S.history.pop();
 if(prev&&prev.route&&prev.route!=='boot'&&prev.route!=='login'){navigate(prev.route,prev.opts||{},true);return}
 navigate('home',{},true)
}
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
function pageRequest(kind,cat,offset,limit,cb,query){
 var endpoint='/api/page?kind='+enc(kind)+'&offset='+enc(offset||0)+'&limit='+enc(limit||30);
 if(cat&&cat!=='all')endpoint+='&category_id='+enc(cat);
 if(query)endpoint+='&query='+enc(query);
 api('GET',endpoint,null,function(st,result){
  if(st===401){login('انتهت جلسة الاشتراك');return}
  cb(st,result&&Array.isArray(result.items)?result:null)
 })
}
function keyOf(kind,cat){return kind+':'+(cat||'all')}
function getListing(kind,cat,cb,force){
 var key=keyOf(kind,cat);
 if(!force&&S.loaded[key]){cb(200,S.loaded[key]);return}
 if(!force&&S.listingInflight[key]){S.listingInflight[key].push(cb);return}
 if(!force)S.listingInflight[key]=[cb];
 pageRequest(kind,cat,0,36,function(st,r){
  var waiting=force?[cb]:(S.listingInflight[key]||[cb]);
  if(!force)delete S.listingInflight[key];
  if(st===200&&r)S.loaded[key]=r;
  for(var i=0;i<waiting.length;i++)waiting[i](st,st===200?r:null)
 })
}
function safeImg(pic,cls){return pic?'<img class="'+(cls||'')+'" loading="lazy" decoding="async" alt="" src="'+esc(pic)+'">':''}
function posterCard(item,kind){
 var id=itemId(item,kind),name=title(item),image=art(item),key=kind+':'+id,mark=S.watch[key],percent=mark&&mark.duration>0?Math.round(100*mark.position/mark.duration):0;
 return '<button class="poster" data-details="'+esc(kind)+':'+esc(id)+'" title="'+esc(name)+'">'+
 '<span class="poster-art">'+safeImg(image)+'<span class="no-poster">'+esc(name)+'</span><span class="poster-badge">'+(kind==='series'?'مسلسل':kind==='movie'?'فيلم':'مباشر')+'</span></span>'+
 '<span class="poster-caption"><strong>'+esc(name)+'</strong><span>'+(percent>3&&percent<95?'متابعة • '+percent+'٪':'BLOFY STREAM')+'</span></span></button>'
}
function shelves(items,kind){return '<div class="h-scroll">'+items.slice(0,22).map(function(x){return posterCard(x,kind)}).join('')+'</div>'}
function home(){
 shell('الرئيسية','<div id="home-content">'+loading('الواجهة الرئيسية')+'</div>');
 var movies=S.loaded['movie:all'],series=S.loaded['series:all'];
 var pending=0;
 function draw(){
  if(S.route!=='home')return;
  var film=(movies&&movies.items)||[],show=(series&&series.items)||[],combined=film.concat(show),candidate=combined.length?combined[S.heroIndex%combined.length]:null;
  var hero=candidate?'<div class="home-hero">'+safeImg(art(candidate),'hero-art')+'<div class="hero-shade"></div><div class="hero-copy">'+
  '<div class="hero-kicker">'+esc(candidate.series_id?'مسلسل جديد':'أحدث العناوين')+'</div><h2 class="hero-title">'+esc(title(candidate))+'</h2>'+
  '<div class="hero-description">اكتشف أحدث ما أضيف إلى مكتبة BLOFY STREAM، مع تفاصيل ومواسم ومتابعة مشاهدة.</div>'+
  '<div class="hero-actions"><button class="btn" data-details="'+(candidate.series_id?'series:':'movie:')+esc(itemId(candidate,candidate.series_id?'series':'movie'))+'">التفاصيل والمشاهدة</button>'+
  '<button class="btn secondary" data-go="movie">استكشف الأفلام</button></div>'+
  '<div class="hero-dots">'+combined.slice(0,5).map(function(x,n){return '<span class="'+(n===S.heroIndex?'current':'')+'"></span>'}).join('')+'</div></div></div>':
  '<div class="home-hero"><div class="hero-copy"><div class="hero-kicker">BLOFY STREAM</div><h2 class="hero-title">كل ما تحب مشاهدته، في مكان واحد</h2><div class="hero-description">قنوات وأفلام ومسلسلات باستخدام كود اشتراكك.</div></div></div>';
  var shortcuts='<div class="shelf"><div class="shelf-title"><h2>وصول سريع</h2></div><div class="story-row">'+
   '<button class="story" data-go="live"><strong>◉ البث المباشر</strong><small>القنوات المفضلة والتصنيفات</small></button>'+
   '<button class="story" data-go="movie"><strong>▣ الأفلام</strong><small>الملصقات والتفاصيل</small></button>'+
   '<button class="story" data-go="series"><strong>▤ المسلسلات</strong><small>المواسم والحلقات</small></button>'+
   '<button class="story" data-go="search"><strong>⌕ البحث</strong><small>ابحث في المكتبة</small></button></div></div>';
  var shelfMovies=film.length?'<section class="shelf"><div class="shelf-title"><h2>أحدث الأفلام</h2><button class="btn secondary" data-go="movie">عرض الكل</button></div>'+shelves(film,'movie')+'</section>':'';
  var shelfSeries=show.length?'<section class="shelf"><div class="shelf-title"><h2>أحدث المسلسلات</h2><button class="btn secondary" data-go="series">عرض الكل</button></div>'+shelves(show,'series')+'</section>':'';
  var recent=Object.keys(S.watch).map(function(key){var parts=key.split(':'),item=findItem(parts[0],parts[1]);return item?{kind:parts[0],item:item,pos:S.watch[key]}:null}).filter(Boolean).sort(function(a,b){return b.pos.updated-a.pos.updated}).slice(0,12);
  var watch=recent.length?'<section class="shelf"><div class="shelf-title"><h2>أكمل المشاهدة</h2></div><div class="h-scroll">'+recent.map(function(r){return posterCard(r.item,r.kind)}).join('')+'</div></section>':'';
  var target=document.getElementById('home-content');if(target){target.innerHTML=hero+shortcuts+watch+shelfMovies+shelfSeries;restoreView('home')}
 }
 if(!movies){pending++;getListing('movie','all',function(st,d){movies=d||{items:[]};pending--;draw()})}
 if(!series){pending++;getListing('series','all',function(st,d){series=d||{items:[]};pending--;draw()})}
 if(!pending)draw()
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
 data.map(function(x){var id=String(x.category_id);return '<button class="cat-item '+(id===cat?'selected':'')+'" data-cat="'+kind+':'+esc(id)+'">'+esc(x.category_name||'تصنيف')+'</button>'}).join('')+
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
  (pic?safeImg(pic,'channel-image'):'<span class="channel-image"></span>')+
  '<span class="channel-name"><strong>'+esc(title(x))+'</strong><small>شاهد الآن</small></span><span class="accent">▶</span></button>'}).join('')+
  '</div><div class="pane-bottom"><button class="btn secondary" data-more="live" '+(!listing.hasMore?'disabled':'')+'>عرض المزيد</button></div></section>'+
  '<section class="preview"><div class="preview-video-wrap"><div class="preview-empty" id="preview-empty"><span>◉</span>اختر قناة لبدء المعاينة</div><video id="live-video" playsinline controls></video></div>'+
  '<div class="preview-controls"><div class="chip primary">LIVE</div><h3 id="live-title">المعاينة المباشرة</h3><p id="live-desc">تحرك بين القنوات واضغط OK لتشغيلها.</p>'+
  '<div class="row"><button class="btn" data-preview-play>▶ المعاينة</button><button class="btn secondary" data-preview-full>⛶ ملء الشاشة</button></div><div class="preview-status" id="live-status"></div></div></section>'+
  '</div>';
  var selected=findItem('live',S.selected)||source[0];if(selected)selectChannel(itemId(selected,'live'),false)
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
function enrichPosters(kind,source){
 if(kind!=='movie'&&kind!=='series')return;
 // Recover source metadata artwork only for a bounded visible window.
 var queue=source.filter(function(x){return !art(x)&&!x.__cover_checked}).slice(0,16),at=0,inflight=0;
 function pump(){
  while(at<queue.length&&inflight<2){
   var item=queue[at++];item.__cover_checked=true;inflight++;
   (function(x){
    var id=itemId(x,kind),action=kind==='movie'?'get_vod_info&vod_id=':'get_series_info&series_id=';
    api('GET','/api/catalog?action='+action+enc(id),null,function(st,res){
     inflight--;
     if(st===200&&res){
      var data=res.info||res.movie_data||res;
      var cover=urlPic(data.movie_image||data.cover_big||data.cover||data.poster||data.poster_path||data.backdrop_path||'');
      if(cover){
       x.movie_image=cover;
       var buttons=document.querySelectorAll('[data-details="'+kind+':'+id+'"]');
       for(var j=0;j<buttons.length;j++){
        var holder=buttons[j].querySelector('.poster-art');
        if(holder&&!holder.querySelector('img')){
         var image=document.createElement('img');image.loading='lazy';image.alt='';image.src=cover;holder.insertBefore(image,holder.firstChild);
        }
       }
      }
     }
     pump();
    });
   })(item)
  }
 }pump()
}
function selectChannel(id,activate){
 var item=findItem('live',id);if(!item)return;S.selected=id;
 var rows=document.querySelectorAll('[data-channel]');for(var i=0;i<rows.length;i++)rows[i].className='channel-item'+(rows[i].getAttribute('data-channel')===id?' selected':'');
 var name=document.getElementById('live-title'),desc=document.getElementById('live-desc');
 if(name)name.textContent=title(item);if(desc)desc.textContent='معاينة '+title(item)+' • اضغط المعاينة للتشغيل';
 if(activate)beginPreview(item)
}
function beginPreview(item){
 var video=document.getElementById('live-video'),box=document.getElementById('live-status'),empty=document.getElementById('preview-empty');if(!video)return;
 var id=itemId(item,'live');if(S.livePreview===id&&S.play&&S.play.preview)return;
 // Always send /stop for the previous preview before acquiring a new FFmpeg slot.
 stopPlayback(true);
 S.livePreview=id;
 if(empty)empty.style.display='none';
 playHls(video,'live',id,'ts',0,box,true)
}
function loadMore(kind){
 var cat=S.cat[kind]||'all',key=keyOf(kind,cat),listing=S.loaded[key];
 if(!listing||!listing.hasMore||listing.loadingMore)return;
 listing.loadingMore=true;
 var btn=document.querySelector('[data-more="'+kind+'"]');
 if(btn){btn.disabled=true;btn.textContent='جار تحميل المزيد…'}
 pageRequest(kind,cat,listing.nextOffset||listing.items.length,36,function(st,result){
  listing.loadingMore=false;
  if(st!==200||!result||S.route!==kind||(S.cat[kind]||'all')!==cat){
   if(btn&&S.route===kind){btn.disabled=false;btn.textContent='تعذر التحميل، حاول مرة أخرى'}
   return
  }
  var seen={};for(var i=0;i<listing.items.length;i++)seen[itemId(listing.items[i],kind)]=true;
  var next=result.items.filter(function(item){var id=itemId(item,kind);if(seen[id])return false;seen[id]=true;return true});
  listing.items=listing.items.concat(next);listing.nextOffset=result.nextOffset;
  listing.hasMore=!!result.hasMore&&next.length>0;
  var list=kind==='live'?document.getElementById('channel-list'):(S.sort==='source'?document.querySelector('.poster-panel .poster-grid'):null);
  if(!list){buildCatalog(kind,listing);return}
  // Incremental append keeps the existing focus, scroll position and live preview player.
  if(kind==='live'){
   list.insertAdjacentHTML('beforeend',next.map(function(item){
    var id=itemId(item,'live'),pic=art(item);
    return '<button class="channel-item" data-channel="'+esc(id)+'">'+(pic?safeImg(pic,'channel-image'):'<span class="channel-image"></span>')+
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
function progressKey(k,id){return k+':'+id}
function getResume(k,id){return S.watch[progressKey(k,id)]||null}
function saveResume(kind,id,pos,duration,ready){
 if(kind==='live'||!ready||!isFinite(pos)||pos<0)return;
 duration=isFinite(duration)&&duration>0?duration:0;
 var key=progressKey(kind,id),last=S.watch[key];
 // A new player starting at zero must not overwrite a real checkpoint.
 if(pos<5&&(duration===0||(last&&last.position>30)))return;
 if(duration>0&&pos/duration>.96){delete S.watch[key]}else{
 S.watch[key]={position:Math.round(pos),duration:Math.round(duration),updated:Date.now()}
 }
 writeJson('blofy_web_watch_v2',S.watch)
}
function details(o){
 var k=o.kind||S.kind,id=String(o.id||''),item=findItem(k,id)||o.item;
 if(!item){navigate(k,{},true);return}
 if(k==='series'&&S.item&&S.item.id!==id)S.episodes=null;
 S.item={kind:k,id:id,data:item};S.kind=k;S.route='detail';
 shell(title(item),'<div id="detail-root">'+loading('تفاصيل المحتوى')+'</div>');
 function show(extra){
  if(S.route!=='detail'||!S.item||S.item.id!==id)return;
  var info=(extra&&extra.info)||{},artwork=urlPic(info.movie_image||info.cover_big||info.cover||'')||art(item),backdrop=urlPic(info.backdrop_path||info.backdrop||item.backdrop)||artwork;
  var plot=info.plot||info.description||item.plot||'المحتوى متاح ضمن مكتبتك في BLOFY STREAM';
  var gen=info.genre||info.genres||'',year=info.releaseDate||info.release_date||item.release_date||'',rating=info.rating||item.rating||'';
  var key=k+':'+id,resume=getResume(k,id),hasResume=resume&&resume.position>30&&(!resume.duration||resume.position/resume.duration<.95);
  var buttons=k==='movie'?'<button class="btn" data-watch="movie:'+esc(id)+'" data-from="'+(hasResume?Math.round(resume.position):0)+'">▶ '+(hasResume?'متابعة المشاهدة':'شاهد الآن')+'</button>'+
   (hasResume?'<button class="btn secondary" data-watch="movie:'+esc(id)+'" data-from="0">ابدأ من البداية</button>':''):
   '<button class="btn" data-episodes="'+esc(id)+'">▤ المواسم والحلقات</button>';
  buttons+='<button class="btn secondary" data-favorite="'+k+':'+esc(id)+'">'+(S.library[key]?'♥ إزالة من المفضلة':'♡ المفضلة')+'</button>';
  var genre=Array.isArray(gen)?gen.join(' • '):String(gen||'');
  var root=document.getElementById('detail-root');if(!root)return;
  root.innerHTML='<div class="detail-backdrop">'+safeImg(backdrop)+'</div><div class="detail-content">'+
  (artwork?'<img class="detail-poster" src="'+esc(artwork)+'" alt="" >':'<div class="detail-poster"></div>')+
  '<div class="detail-body"><span class="chip primary">'+(k==='movie'?'فيلم':'مسلسل')+'</span><h2 class="detail-title">'+esc(title(item))+'</h2>'+
  '<div class="detail-subtitle">'+esc([genre,year,rating].filter(Boolean).join(' • '))+'</div><p class="detail-plot">'+esc(plot)+'</p>'+
  '<div class="detail-actions">'+buttons+'</div>'+
  (hasResume?'<div class="detail-stat">آخر مشاهدة: '+formatTime(resume.position)+(resume.duration?' من '+formatTime(resume.duration):'')+'</div>'+(resume.duration?'<span class="progress-meter"><i style="width:'+Math.round(resume.position/resume.duration*100)+'%"></i></span>':''):'')+
  '</div></div><section id="related-root"></section>';
  restoreView('detail');
 }
 show();
 var endpoint=k==='movie'?'get_vod_info&vod_id=':'get_series_info&series_id=';
 api('GET','/api/catalog?action='+endpoint+enc(id),null,function(st,data){
  if(S.route!=='detail'||!S.item||S.item.id!==id)return;
  if(st===200&&data){S.item.info=data;show(data);if(k==='series'&&data.episodes){S.episodes=data;var p=document.getElementById('related-root');if(p)p.innerHTML='<div class="related"><h3>المواسم والحلقات</h3><button class="btn" data-episodes="'+esc(id)+'">فتح قائمة المواسم</button></div>'}}
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
 var id=String(opts.id||S.item&&S.item.id||'');var item=findItem('series',id)||S.item&&S.item.data;
 if(!item){navigate('series',{},true);return}
 S.route='episodes';S.kind='series';
 shell(title(item)+' — الحلقات','<div id="episodes-root">'+loading('مواسم المسلسل')+'</div>');
 function finish(data){
  if(S.route!=='episodes')return;
  var list=parseEpisodes(data),seasons={};for(var i=0;i<list.length;i++)seasons[list[i].__season]=true;
  var keys=Object.keys(seasons).sort(function(a,b){return Number(a)-Number(b)});
  if(!keys.length){document.getElementById('episodes-root').innerHTML='<div class="info">تعذر جلب الحلقات لهذا المسلسل.</div>';return}
  if(keys.indexOf(S.selectedSeason)<0)S.selectedSeason=keys[0];
  S.episodes=data;
  var chosen=list.filter(function(x){return x.__season===S.selectedSeason}).sort(function(a,b){return Number(a.episode_num||0)-Number(b.episode_num||0)});
  var rail=keys.map(function(x){return '<button class="cat-item '+(x===S.selectedSeason?'selected':'')+'" data-season="'+esc(x)+'">الموسم '+esc(x)+'</button>'}).join('');
  var html='<div class="episode-layout"><aside class="cat-rail season-rail"><div class="pane-head"><strong>المواسم</strong></div><div class="pane-scroll">'+rail+'</div></aside>'+
  '<section class="episode-list">'+chosen.map(function(x,i){
   var eid=String(x.id||''),name=x.title||'الحلقة '+(x.episode_num||i+1),extension=x.container_extension||'mp4';
   var w=getResume('series',eid),pct=w&&w.duration?Math.round(w.position/w.duration*100):0;
   return '<button class="episode-row" data-watch="series:'+esc(eid)+'" data-ext="'+esc(extension)+'" data-name="'+esc(name)+'" data-from="'+(w&&w.position>30?Math.round(w.position):0)+'">'+
   '<span class="episode-art">▤</span><span><strong class="episode-name">الحلقة '+esc(x.episode_num||i+1)+' — '+esc(name)+'</strong>'+
   '<span class="episode-meta">الموسم '+esc(S.selectedSeason)+(pct?' • شاهدت '+pct+'٪':'')+'</span>'+
   (pct?'<span class="episode-progress"><i style="width:'+pct+'%"></i></span>':'')+'</span></button>'
  }).join('')+'</section></div>';
  document.getElementById('episodes-root').innerHTML=html;restoreView('episodes');
 }
 if(S.episodes&&S.episodes.episodes)finish(S.episodes);
 else api('GET','/api/catalog?action=get_series_info&series_id='+enc(id),null,function(st,d){if(st===200)finish(d);else document.getElementById('episodes-root').innerHTML='<div class="info error">تعذر جلب الحلقات، حاول مرة أخرى.</div>'})
}
function favoritesScreen(){
 shell('المفضلة','<div id="fav-root"></div>');var keys=Object.keys(S.library),html='';
 for(var i=0;i<keys.length;i++){var p=keys[i].split(':'),item=findItem(p[0],p[1]);if(item&&S.library[keys[i]])html+=posterCard(item,p[0])}
 document.getElementById('fav-root').innerHTML=html?'<div class="poster-grid">'+html+'</div>':'<div class="empty-state">أضف أفلامك ومسلسلاتك وقنواتك المفضلة حتى تظهر هنا.</div>';restoreView('favorites')
}
function collectionsScreen(){
 shell('التصنيفات','<div class="story-row"><button class="story" data-go="movie"><strong>أفلام</strong><small>جميع أنواع الأفلام</small></button>'+
 '<button class="story" data-go="series"><strong>مسلسلات</strong><small>المواسم والحلقات</small></button>'+
 '<button class="story" data-go="live"><strong>القنوات</strong><small>البث المباشر</small></button></div>'+
 '<div class="info" style="margin-top:25px">يعرض هذا القسم تصنيفات المصدر نفسها، دون إنشاء مجموعات وهمية.</div>')
}
function searchScreen(){
 S.route='search';
 shell('البحث','<section class="search-screen"><input id="search-input" class="input" placeholder="ابحث عن فيلم أو مسلسل أو قناة…" autofocus>'+
 '<div class="search-tabs"><span class="chip primary">القنوات</span><span class="chip primary">الأفلام</span><span class="chip primary">المسلسلات</span></div>'+
 '<p id="search-status" class="muted">أدخل اسم المحتوى لعرض النتائج من BLOFY</p><div id="search-result" class="search-result-grid"></div></section>');
 document.getElementById('search-input').oninput=function(){var q=this.value.trim();if(S.searchTimer)clearTimeout(S.searchTimer);
 if(q.length<2){++S.searchToken;document.getElementById('search-result').innerHTML='';document.getElementById('search-status').textContent='اكتب حرفين على الأقل';return}
 var token=++S.searchToken;document.getElementById('search-status').textContent='جار البحث في المكتبة…';
 S.searchTimer=setTimeout(function(){searchNow(q,token)},260)
 };
 document.getElementById('search-input').focus()
}
function searchNow(q,token){
 var kinds=['live','movie','series'],responses={live:[],movie:[],series:[]},pending=3;
 function draw(){
  if(token!==S.searchToken||S.route!=='search')return;
  var output=document.getElementById('search-result'),status=document.getElementById('search-status');
  if(!output||!status)return;
  var count=0,html=kinds.map(function(kind){
   var cards=responses[kind];count+=cards.length;
   return cards.map(function(item){return posterCard(item,kind)}).join('')
  }).join('');
  output.innerHTML=html||(pending===0?'<div class="empty-state">لم يتم العثور على نتائج لهذا البحث.</div>':'');
  status.textContent=(count?'تم العثور على '+count+' نتيجة':'جار البحث')+(pending?' • استكمال باقي المكتبة…':'')
 }
 for(var i=0;i<kinds.length;i++)(function(k){
  pageRequest(k,'all',0,20,function(st,p){
   if(token!==S.searchToken||S.route!=='search')return;
   pending--;
   if(st===200&&p){
    responses[k]=p.items;
    var key=keyOf(k,'search');S.loaded[key]=S.loaded[key]||{items:[]};
    for(var a=0;a<p.items.length;a++){
     var item=p.items[a],id=itemId(item,k);
     if(!findItem(k,id))S.loaded[key].items.push(item)
    }
   }
   draw()
  },q)
 })(kinds[i])
}
function aiScreen(){
 shell('الذكاء الاصطناعي','<div class="info">واجهة المحادثة الذكية في نسخة أندرويد تعتمد على خدمة مخصصة. لم أربطها بالويب حتى الآن حتى لا تظهر لك إجابات وهمية. بإمكانك استخدام البحث المباشر في المكتبة الآن.</div>'+
 '<div style="margin-top:16px"><button class="btn" data-go="search">انتقل إلى البحث</button></div>')
}
function settingsScreen(){
 shell('الإعدادات','<div class="settings-grid"><section class="setting-panel"><h3>تحديث المحتوى</h3><p>إعادة قراءة القنوات والأفلام والمسلسلات من خادم BLOFY.</p><button class="btn" id="refresh-content">↻ تحديث المحتوى</button></section>'+
 '<section class="setting-panel"><h3>التشغيل</h3><p>البث المباشر يستخدم HLS. الأفلام تُجرّب المصدر الأصلي القابل للتقديم أولًا. التحويل التلقائي محدود حتى نعتمد تقديم الفيلم واستكماله من نفس الموضع.</p></section>'+
 '<section class="setting-panel"><h3>المفضلة والمتابعة</h3><p>تحفظ هذه النسخة البيانات محليًا في هذا المتصفح فقط؛ المزامنة السحابية مع أندرويد غير مفعلة بعد.</p><button class="btn secondary" data-go="favorites">المفضلة</button></section>'+
 '<section class="setting-panel"><h3>حساب BLOFY</h3><p>الخروج من هذا الجهاز فقط، دون التأثير على التطبيقات الأصلية.</p><button class="btn danger" id="logout">تسجيل الخروج</button></section></div>'+
 '<div id="page-status" class="info" style="margin-top:20px">BLOFY STREAM Web — نسخة مطابقة قيد التطوير.</div>');
 document.getElementById('refresh-content').onclick=function(){S.cats={};S.loaded={};S.pages={};setStatus('تم تحديث فهرس المحتوى المحلي. ستحمّل الصفحات أحدث القوائم عند فتحها.')};
 document.getElementById('logout').onclick=function(){api('POST','/api/logout',{},function(){login('تم تسجيل الخروج')})}
}
function fmt(n){return n<10?'0'+n:String(n)}
function formatTime(seconds){seconds=Math.max(0,Math.floor(Number(seconds)||0));return fmt(Math.floor(seconds/3600))+':'+fmt(Math.floor(seconds/60)%60)+':'+fmt(seconds%60)}

function diagnose(kind,phase,mode,code){
 if(!S.userVerified)return;
 var payload={kind:kind==='live'?'live':kind==='series'?'series':'movie',mode:mode||'direct',phase:phase,errorCode:Math.max(0,Math.min(9,Number(code)||0))};
 api('POST','/api/player-diagnostic',payload,function(){})
}

function shouldUseNativeHls(video){
 if(!video||!video.canPlayType||!video.canPlayType('application/vnd.apple.mpegurl'))return false;
 // Chrome and Edge sometimes report "maybe" here yet fail to decode MPEG-TS
 // with MEDIA_ERR_SRC_NOT_SUPPORTED (4). Use Hls.js/MSE on these browsers.
 var ua=(navigator.userAgent||'');
 var apple=/Safari/i.test(ua)&&!/Chrome|Chromium|CriOS|Edg|OPR|FxiOS/i.test(ua);
 var tv=/VIDAA|Hisense/i.test(ua);
 var mse=!!(window.MediaSource&&window.MediaSource.isTypeSupported);
 return apple||tv||!mse
}

function loadHls(done){
 if(window.Hls){done(true);return}
 if(S.hlsState==='loading'){S.hlsCallbacks.push(done);return}
 if(S.hlsState==='error'){done(false);return}
 S.hlsState='loading';S.hlsCallbacks=[done];var script=document.createElement('script');script.src='/vendor/hls.min.js';
 script.onload=function(){S.hlsState=window.Hls?'ready':'error';var a=S.hlsCallbacks;S.hlsCallbacks=[];for(var i=0;i<a.length;i++)a[i](!!window.Hls)};
 script.onerror=function(){S.hlsState='error';var a=S.hlsCallbacks;S.hlsCallbacks=[];for(var i=0;i<a.length;i++)a[i](false)};
 document.head.appendChild(script)
}
function stopPlayback(sendStop){
 if(!S.play)return;var old=S.play;S.play=null;
 if(old.preview)S.livePreview=null;
 try{if(old.timer)clearInterval(old.timer);if(old.stallTimer)clearTimeout(old.stallTimer)}catch(e){}
 if(old.engine){try{old.engine.destroy()}catch(e){}}
 try{if(old.video){old.video.pause();old.video.removeAttribute('src');old.video.load()}}catch(e){}
 if(sendStop!==false&&(old.hlsKey||old.stopUrl))api('POST',old.stopUrl||'/api/hls/'+old.hlsKey+'/stop',{},function(){})
}
function cleanupPlayer(){stopPlayback(true)}
function playerStatus(message,error){var el=document.getElementById('player-status');if(el){el.textContent=message;el.className=error?'player-error':'player-loading'}}
function playHls(video,kind,id,extension,track,statusElement,preview){
 stopPlayback(true);
 var key=kind+'/'+id+'/'+extension+'/'+track,manifest='/api/hls/'+key+'/index.m3u8',record={video:video,kind:kind,id:id,hlsKey:key,preview:!!preview,engine:null,timer:null,stallTimer:null,retries:0,ready:false,started:Date.now()};
 S.play=record;
 video.muted=!!preview;video.autoplay=true;video.playsInline=true;video.controls=true;
 function alive(){return S.play===record}
 function status(text){if(!alive())return;if(statusElement)statusElement.textContent=text;else playerStatus(text)}
 video.onerror=function(){if(alive()){status('تعذر تشغيل HLS على هذا الجهاز (رمز '+(video.error?video.error.code:0)+').');if(!preview)playerStatus('فشل التشغيل بتنسيق HLS. تأكد من اتصالك أو جرّب مصدر MP4 قابل للتقديم.',true)}};
 video.onplaying=function(){if(!alive())return;record.ready=true;record.retries=0;if(record.stallTimer){clearTimeout(record.stallTimer);record.stallTimer=null}status(preview?'● المعاينة تعمل':'● تشغيل البث');};
 video.onwaiting=video.onstalled=function(){
  if(!alive()||video.paused)return;
  status(preview?'جار تحميل المعاينة…':'جار تعبئة مخزن البث لتقليل التقطيع…');
  if(record.stallTimer)clearTimeout(record.stallTimer);
  record.stallTimer=setTimeout(function(){
   record.stallTimer=null;
   if(!alive()||video.paused||video.readyState>=3)return;
   if(record.engine&&record.retries<3){record.retries++;try{record.engine.startLoad()}catch(e){}}
  },8500)
 };
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
   var engine=new window.Hls({enableWorker:false,lowLatencyMode:false,liveSyncDurationCount:5,liveMaxLatencyDurationCount:12,maxBufferLength:35,maxBufferHole:1.5,manifestLoadingTimeOut:30000,fragLoadingTimeOut:30000});record.engine=engine;
   engine.on(window.Hls.Events.MANIFEST_PARSED,function(){if(!alive())return;try{var p=video.play();if(p&&p.catch)p.catch(function(){status('اضغط تشغيل ▶')})}catch(e){}});
   engine.on(window.Hls.Events.ERROR,function(event,detail){
    if(!alive()||!detail||!detail.fatal)return;
    diagnose('live','hls_error','video',0);
    if(record.retries<3&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     record.retries++;status('انقطاع مؤقت في البث؛ جار استعادة الاتصال…');try{engine.startLoad()}catch(e){};return;
    }
    if(record.retries<2&&detail.type===window.Hls.ErrorTypes.MEDIA_ERROR){
     record.retries++;status('جار إعادة تهيئة الفيديو…');try{engine.recoverMediaError()}catch(e){};return;
    }
    status('تعذر استمرار البث: '+String(detail.details||detail.type).slice(0,55))
   });
   engine.attachMedia(video);engine.loadSource(manifest)
  }catch(e){status('تعذر إعداد مشغّل HLS')}
 })
}

function durationSeconds(value){
 if(typeof value==='number'&&value>0)return value;
 if(typeof value!=='string')return 0;
 if(/^[0-9]+$/.test(value))return Number(value);
 var tokens=value.split(':');if(tokens.length<2||tokens.length>3)return 0;
 var seconds=0;for(var j=0;j<tokens.length;j++)seconds=seconds*60+Number(tokens[j]);
 return isFinite(seconds)&&seconds>0?seconds:0
}
function knownDuration(kind,id,item){
 var opts=[],movieResponse=kind==='movie'&&S.item&&S.item.info,
 movieInfo=movieResponse&&movieResponse.info,movieData=movieResponse&&movieResponse.movie_data;
 // Episode-specific duration must win over a series' parent metadata.
 if(kind==='series'&&S.episodes&&S.episodes.episodes){
  var eps=parseEpisodes(S.episodes);
  for(var i=0;i<eps.length;i++)if(String(eps[i].id)===String(id)){
   var ep=eps[i],ei=ep.info||{};
   opts.push(ep.duration_secs,ei.duration_secs,ep.duration,ei.duration);
   break
  }
 }
 opts=opts.concat([item&&item.duration_secs,item&&item.duration,
  item&&item.info&&item.info.duration_secs,item&&item.info&&item.info.duration,
  movieInfo&&movieInfo.duration_secs,movieInfo&&movieInfo.duration,
  movieData&&movieData.duration_secs,movieData&&movieData.duration]);
 for(var k=0;k<opts.length;k++){var sec=durationSeconds(opts[k]);if(sec>0)return sec}
 var saved=getResume(kind,id);
 return saved&&saved.duration||0
}

/* Real full-length VOD player. EXT-X-ENDLIST exposes the entire runtime to
 * Hls.js from the first manifest. A fragment requested after a seek is
 * transcoded on demand at that absolute movie position by the worker.
 * Unknown-length sources still use the bounded legacy streaming fallback.
 */
function playFullVod(video,kind,id,ext,track,duration,state,ready){
 stopPlayback(true);
 var seconds=Math.round(duration),path='/api/vodfull/'+kind+'/'+id+'/'+ext+'/'+track+'/'+seconds;
 var rec={video:video,kind:kind,id:id,preview:false,engine:null,stopUrl:path+'/stop',hlsKey:null,ready:false,timer:null};
 S.play=rec;state.mode='fullvod';state.offset=0;state.duration=seconds;state.ready=false;
 video.autoplay=true;video.muted=false;video.defaultMuted=false;video.controls=false;
 playerStatus('جار فتح الفيلم الكامل مع التقديم والترجيع…');
 function alive(){return S.route==='player'&&S.play===rec}
 function fail(msg){
  if(!alive())return;
  if(rec.timer)clearTimeout(rec.timer);
  playerStatus(msg,true)
 }
 rec.timer=setTimeout(function(){
  if(alive()&&!rec.ready)playerStatus('جار تجهيز الفيديو من المصدر…')
 },16000);
 video.onplaying=function(){
  if(!alive())return;
  rec.ready=true;if(rec.timer)clearTimeout(rec.timer);
  ready()
 };
 video.onwaiting=function(){
  if(alive()&&rec.ready)playerStatus('جار تحميل الجزء المطلوب من الفيلم…')
 };
 video.onended=function(){
  if(!alive())return;
  saveResume(kind,id,seconds,seconds,true);
  playerStatus('اكتملت المشاهدة')
 };
 video.onerror=function(){
  diagnose(kind,'media_error','video',video.error&&video.error.code);
  fail('تعذر تشغيل هذا المصدر كفيلم قابل للتقديم. المصدر قد لا يدعم الوصول إلى مواضع الملف.')
 };
 function attachNative(){
  video.src=path+'/index.m3u8';
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
   var hls=new window.Hls({enableWorker:false,lowLatencyMode:false,startPosition:state.resume||0,maxBufferLength:36,
    maxMaxBufferLength:70,maxBufferHole:1,fragLoadingTimeOut:35000,manifestLoadingTimeOut:30000,
    fragLoadingMaxRetry:2,manifestLoadingMaxRetry:2});
   rec.engine=hls;
   video.onloadedmetadata=function(){
    if(!alive())return;
    if(state.resume>30&&state.resume<seconds-5&&!state.didResume){
     state.didResume=true;try{video.currentTime=state.resume}catch(e){}
    }
    if(state.onDuration)state.onDuration()
   };
   hls.on(window.Hls.Events.MANIFEST_PARSED,function(){
    if(!alive())return;
    if(state.onDuration)state.onDuration();
    try{
     if(state.resume>30&&state.resume<seconds-5){
      video.currentTime=state.resume
     }
     var p=video.play();
     if(p&&p.catch)p.catch(function(){if(alive())playerStatus('اضغط ▶ لتشغيل الفيلم')})
    }catch(e){playerStatus('اضغط تشغيل للمتابعة')}
   });
   var recovery=0;
   hls.on(window.Hls.Events.ERROR,function(event,detail){
    if(!alive()||!detail||!detail.fatal)return;
    diagnose(kind,'hls_error','video',0);
    if(recovery<1&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){recovery++;try{hls.startLoad()}catch(e){};return}
    if(recovery<1&&detail.type===window.Hls.ErrorTypes.MEDIA_ERROR){recovery++;try{hls.recoverMediaError()}catch(e){};return}
    fail('فشل الوصول إلى جزء من الفيلم. قد يمنع المصدر التقديم إلى هذا الموضع. ارجع وحاول عنوانًا آخر.')
   });
   hls.attachMedia(video);hls.loadSource(path+'/index.m3u8')
  }catch(e){fail('تعذر تهيئة مشغّل الأفلام')}
 })
}

function playVodSegments(video,kind,id,ext,track,start,state,ready){
 var at=Math.max(0,Math.round(start||0)),key=kind+'/'+id+'/'+ext+'/'+track+'/'+at,manifest='/api/vod/'+key+'/index.m3u8';
 state.ready=false;stopPlayback(true);
 state.mode='vodhls';state.offset=at;state.didResume=true;
 var rec={video:video,kind:kind,id:id,preview:false,engine:null,stopUrl:'/api/vod/'+key+'/stop',hlsKey:null,ready:false,started:Date.now(),timer:null};
 S.play=rec;
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
    if(state.onDuration)state.onDuration()
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
 video.onplaying=function(){if(!alive())return;rec.ready=true;if(rec.timer)clearTimeout(rec.timer);ready();};
 video.onwaiting=function(){if(alive()&&rec.ready)playerStatus('جار تحميل المقطع التالي من الفيلم…')};
 video.onended=function(){
  if(!alive())return;
  var absolute=at+Math.max(0,video.currentTime||0),duration=state.duration||0;
  if(duration>0&&absolute<duration-60){
   interrupted('unexpected_end');
  }else{
   saveResume(kind,id,duration||absolute,duration||absolute,true);
   playerStatus('اكتملت المشاهدة')
  }
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
   var engine=new window.Hls({enableWorker:false,lowLatencyMode:false,startPosition:0,liveSyncDurationCount:4,liveMaxLatencyDurationCount:12,maxBufferLength:40,maxBufferHole:1.5,manifestLoadingTimeOut:30000,fragLoadingTimeOut:30000});
   rec.engine=engine;
   engine.on(window.Hls.Events.MANIFEST_PARSED,function(){
    if(!alive())return;try{var p=video.play();if(p&&p.catch)p.catch(function(){playerStatus('اضغط ▶ لتشغيل الفيلم')})}catch(e){}
   });
   var recovered=0;
   engine.on(window.Hls.Events.ERROR,function(event,detail){
    if(!alive()||!detail||!detail.fatal)return;
    diagnose(kind,'hls_error','video',0);
    if(recovered<1&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){
     recovered++;try{engine.startLoad()}catch(e){};return
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
function openPlayer(kind,id,extension,name,from){
 var item=findItem(kind,id)||S.item&&S.item.data,ext=String(extension||item&&item.container_extension||(kind==='live'?'ts':'mp4')).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8);
 if(['ts','mp4','mkv','avi','mov'].indexOf(ext)<0)ext=kind==='live'?'ts':'mp4';
 var explicitStart=from!==undefined&&from!==null&&from!=='';var initial=Math.max(0,Number(from)||0),isLive=kind==='live',prior=getResume(kind,id),resume=explicitStart?initial:(prior&&prior.position||0);
 var nextEpisode=null;
 if(kind==='series'&&S.episodes&&S.episodes.episodes){
  var episodeList=parseEpisodes(S.episodes).sort(function(a,b){return Number(a.__season)-Number(b.__season)||Number(a.episode_num||0)-Number(b.episode_num||0)});
  for(var ix=0;ix<episodeList.length-1;ix++)if(String(episodeList[ix].id)===String(id)){nextEpisode=episodeList[ix+1];break}
 }
 rememberView();S.previousBeforePlayer={route:S.route,kind:kind,id:id};S.route='player';
 app.innerHTML='<section class="player-overlay" id="player-root"><video id="player-media" '+(isLive?'controls':'')+' autoplay playsinline webkit-playsinline></video>'+
 '<div class="player-loading" id="player-status">جار تجهيز المشغّل…</div>'+
 '<div class="player-hud"><div class="player-title">'+esc(name||title(item))+'</div>'+
 (isLive?'':'<div class="player-time"><span id="now-time">00:00:00</span><span id="total-time">--:--</span></div><input id="seek" type="range" min="0" max="1000" value="0" step="1" class="seek-line" disabled>')+
 '<div class="player-actions"><button class="btn secondary" id="player-back">↶ رجوع</button><button class="btn" id="player-toggle">⏯ تشغيل / إيقاف</button>'+
 (isLive?'':'<button class="btn secondary" id="player-skip-back">−30 ثانية</button><button class="btn secondary" id="player-skip-forward">+30 ثانية</button><button class="btn secondary" id="player-skip-forward5">+5 دقائق</button><button class="btn secondary" id="player-restart">↺ من البداية</button>')+
 (nextEpisode?'<button class="btn secondary" id="player-next-episode">الحلقة التالية ⏭</button>':'')+
 '<button class="btn secondary" id="player-audio">◉ الصوت</button></div></div></section>';
 var video=document.getElementById('player-media'),state={kind:kind,id:id,ext:ext,video:video,name:name,offset:0,
 mode:isLive?'hls':'direct',resume:resume,duration:knownDuration(kind,id,item),didResume:false,ready:false,track:0,lastSaved:0};
 function realPos(){return state.mode==='vodhls'?state.offset+Math.max(0,video.currentTime||0):video.currentTime||0}
 function totalDuration(){return state.mode==='vodhls'?state.duration:(isFinite(video.duration)&&video.duration>0?video.duration:state.duration)}
 function markReady(){
  if(S.route!=='player')return;
  state.ready=true;var status=document.getElementById('player-status');if(status)status.style.display='none';
  if(!isLive&&state.mode==='direct'&&!state.didResume&&resume>30&&isFinite(video.duration)&&video.duration>0&&video.seekable&&video.seekable.length){
   state.didResume=true;try{video.currentTime=Math.min(resume,Math.max(0,video.duration-5))}catch(e){}
  }
 }
 function progress(){
  if(S.route!=='player')return;
  var pos=realPos(),duration=totalDuration();
  if(!isLive){
   var n=document.getElementById('now-time'),t=document.getElementById('total-time'),seek=document.getElementById('seek');
   if(n)n.textContent=formatTime(pos);if(t)t.textContent=duration>0&&isFinite(duration)?formatTime(duration):'المدة غير متوفرة';
   if(seek){seek.disabled=!(duration>0&&isFinite(duration))||(state.mode==='direct'&&(!video.seekable||!video.seekable.length));
    if(document.activeElement!==seek&&duration>0&&isFinite(duration))seek.value=String(Math.max(0,Math.min(1000,Math.round(pos/duration*1000))))}
   if(Date.now()-state.lastSaved>5000&&state.ready){saveResume(kind,id,pos,duration,true);state.lastSaved=Date.now()}
  }
 }
 state.onDuration=progress;
 function startVod(at){
  if(state.duration>=120&&state.duration<=21600){
   state.resume=Math.max(0,Math.round(at||0));
   playFullVod(video,kind,id,ext,state.track,state.duration,state,markReady)
  }else{
   playVodSegments(video,kind,id,ext,state.track,at,state,markReady)
  }
 }
 function startWithMetadata(at){
  if(state.duration>=120||kind==='live'){startVod(at);return}
  var settled=false;
  function launch(){if(settled||S.route!=='player')return;settled=true;startVod(at)}
  var timeout=setTimeout(launch,4200);
  var endpoint=kind==='movie'?'get_vod_info&vod_id='+enc(id):
   (kind==='series'&&S.item&&S.item.id?'get_series_info&series_id='+enc(S.item.id):'');
  if(!endpoint){clearTimeout(timeout);launch();return}
  playerStatus('جار قراءة معلومات الفيلم لتفعيل التقديم والترجيع…');
  api('GET','/api/catalog?action='+endpoint,null,function(st,result){
   if(settled||S.route!=='player')return;
   clearTimeout(timeout);
   if(st===200&&result){
    if(kind==='movie'){
     if(S.item&&S.item.kind==='movie'&&S.item.id===id)S.item.info=result;
     var info=result.info||{},data=result.movie_data||{};
     var opts=[info.duration_secs,info.duration,data.duration_secs,data.duration,result.duration_secs,result.duration];
     for(var i=0;i<opts.length;i++){var d=durationSeconds(opts[i]);if(d>=120){state.duration=d;break}}
    }else if(kind==='series'){
     S.episodes=result;
     var eps=parseEpisodes(result);
     for(var j=0;j<eps.length;j++)if(String(eps[j].id)===String(id)){
      var episode=eps[j],extra=episode.info||{},options=[extra.duration_secs,episode.duration_secs,extra.duration,episode.duration];
      for(var k=0;k<options.length;k++){var d2=durationSeconds(options[k]);if(d2>=120){state.duration=d2;break}}
      break
     }
    }
   }
   launch()
  })
 }
 function seekTo(raw){
  if(isLive)return;
  state.recoveries=0;state.recoveryWindow=0;
  var target=Math.max(0,Math.round(Number(raw)||0)),duration=totalDuration();
  if(duration>0&&isFinite(duration))target=Math.min(target,Math.max(0,Math.floor(duration)-2));
  if((state.mode==='direct'||state.mode==='fullvod')&&(state.mode==='fullvod'||video.seekable&&video.seekable.length)){
   try{video.currentTime=target;progress();return}catch(e){}
  }
  // Restart transcoding at the requested absolute time, never silently at 0.
  if(state.ready)saveResume(kind,id,realPos(),duration,true);
  startVod(target);
  playerStatus('جار فتح المقطع عند '+formatTime(target)+'…');
 }
 state.seekTo=seekTo;
 state.toggle=function(){if(video.paused){var p=video.play();if(p&&p.catch)p.catch(function(){})}else video.pause()};
 function startDirect(){
  state.mode='direct';state.offset=0;state.didResume=false;video.onerror=null;
  video.src='/api/media/'+enc(kind)+'/'+enc(id)+'.'+enc(ext);
  try{var ret=video.play();if(ret&&ret.catch)ret.catch(function(){playerStatus('اضغط ▶ لتشغيل الفيديو')})}catch(e){}
 }
 video.onloadedmetadata=function(){if(state.mode==='direct')progress()};
 video.ontimeupdate=progress;video.onpause=function(){progress();if(state.ready&&!isLive)saveResume(kind,id,realPos(),totalDuration(),true)};
 video.onplaying=function(){markReady()};
 video.onerror=function(){
  if(state.mode==='direct'&&!isLive){var at=Math.max(resume,realPos());playerStatus('تعذر المصدر الأصلي. جار فتح نسخة قابلة لاستكمال المشاهدة…');startVod(at)}
  else playerStatus('تعذّر تشغيل هذا المصدر.',true)
 };
 document.getElementById('player-back').onclick=closePlayer;
 document.getElementById('player-toggle').onclick=state.toggle;
 var restart=document.getElementById('player-restart');if(restart)restart.onclick=function(){
  delete S.watch[progressKey(kind,id)];writeJson('blofy_web_watch_v2',S.watch);resume=0;
  if(state.mode==='direct'&&video.seekable&&video.seekable.length){try{video.currentTime=0}catch(e){}}
  else if(state.mode==='fullvod'){try{video.currentTime=0}catch(e){startVod(0)}}
  else{state.ready=false;startVod(0)}
 };
 document.getElementById('player-audio').onclick=function(){
  state.track=(state.track+1)%4;
  if(isLive){state.track=0;playerStatus('تغيير المسار الصوتي للبث غير معتمد بعد، وسيستمر استخدام المسار الافتراضي.');}
  else if(state.mode==='vodhls'){state.track=0;playerStatus('تغيير مسار صوت الفيلم يحتاج قراءة المسارات الفعلية من المصدر.');}
  else {state.track=0;playerStatus('تبديل المسار الصوتي في المشغّل الأصلي يعتمد على دعم المتصفح.');}
  this.innerText='◉ الصوت '+(state.track+1)
 };
 var back30=document.getElementById('player-skip-back'),forward30=document.getElementById('player-skip-forward');
 if(back30)back30.onclick=function(){seekTo(realPos()-30)};
 if(forward30)forward30.onclick=function(){seekTo(realPos()+30)};
 var forward5=document.getElementById('player-skip-forward5');
 if(forward5)forward5.onclick=function(){seekTo(realPos()+300)};
 var nextBtn=document.getElementById('player-next-episode');
 if(nextBtn&&nextEpisode)nextBtn.onclick=function(){
  if(state.ready)saveResume(kind,id,realPos(),totalDuration(),true);
  var previous=S.previousBeforePlayer||{route:'episodes',kind:'series',id:id};
  cleanupPlayer();S.playerView=null;S.route='episodes';
  var nextId=String(nextEpisode.id),checkpoint=getResume('series',nextId);
  openPlayer('series',nextId,nextEpisode.container_extension||'mp4',nextEpisode.title||'الحلقة '+(nextEpisode.episode_num||''),checkpoint&&checkpoint.position>30?checkpoint.position:0);
  S.previousBeforePlayer=previous;
 };
 var seek=document.getElementById('seek');
 if(seek)seek.onchange=function(){
  var duration=totalDuration(),target=Math.round(duration*Number(this.value)/1000);
  if(!(duration>0))return;
  seekTo(target)
 };
 if(isLive){playHls(video,kind,id,'ts',0,document.getElementById('player-status'),false)}
 else if(ext==='mp4'){startDirect()}
 else{startWithMetadata(Math.round(resume))}
 S.playerView=state
}
function closePlayer(){
 var state=S.playerView;
 if(state&&S.route==='player'&&state.kind!=='live'){
  var video=state.video,pos=state.mode==='vodhls'?state.offset+(video.currentTime||0):(video.currentTime||0);
  var duration=state.mode==='vodhls'?state.duration:(video.duration>0?video.duration:state.duration);
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
 if(target&&target.tagName==='IMG'){target.style.display='none';return}
 if(S.route!=='login')diagnose(S.kind,'play_rejected','direct',0);
},true);

function clickHandler(event){
 var node=event.target;while(node&&node!==document.body&&!node.hasAttribute('data-back')&&!node.getAttribute('data-go')&&!node.getAttribute('data-cat')&&!node.getAttribute('data-details')&&!node.getAttribute('data-channel')&&!node.getAttribute('data-more')&&!node.getAttribute('data-sort')&&!node.getAttribute('data-watch')&&!node.getAttribute('data-episodes')&&!node.getAttribute('data-season')&&!node.getAttribute('data-favorite')&&!node.hasAttribute('data-preview-play')&&!node.hasAttribute('data-preview-full')&&!node.getAttribute('data-reload'))node=node.parentNode;
 if(!node||node===document.body)return;
 var go=node.getAttribute('data-go'),cat=node.getAttribute('data-cat'),det=node.getAttribute('data-details'),ch=node.getAttribute('data-channel'),more=node.getAttribute('data-more'),season=node.getAttribute('data-season'),watch=node.getAttribute('data-watch'),ep=node.getAttribute('data-episodes'),fav=node.getAttribute('data-favorite');
 if(node.hasAttribute('data-back')){back();return}
 if(go){if(go!==S.route)navigate(go);return}
 if(cat){var parts=cat.split(':'),kind=parts[0];
  if(S.cat[kind]===parts[1])return;
  rememberView();S.cat[kind]=parts[1];S.selected=null;S.livePreview=null;
  if(S.play&&S.play.preview)stopPlayback(true);
  catalog(kind);return}
 if(det){var sep=det.indexOf(':'),kind=det.slice(0,sep),id=det.slice(sep+1);navigate('detail',{kind:kind,id:id});return}
 if(ch){selectChannel(ch,true);return}
 if(more){loadMore(more);return}
 if(node.getAttribute('data-sort')){S.sort=S.sort==='source'?'new':S.sort==='new'?'alpha':'source';buildCatalog(S.kind,currentListing());return}
 if(ep){navigate('episodes',{id:ep});return}
 if(season){S.selectedSeason=season;episodesScreen({id:S.item&&S.item.id});return}
 if(fav){rememberView();S.library[fav]=!S.library[fav];writeJson('blofy_web_favorites_v2',S.library);if(S.route==='detail'&&S.item)details({kind:S.item.kind,id:S.item.id});else favoritesScreen();return}
 if(watch){var a=watch.split(':'),kind=a[0],id=a[1],it=findItem(kind,id),ext=node.getAttribute('data-ext')||(it&&it.container_extension)||'mp4',name=node.getAttribute('data-name')||title(it);openPlayer(kind,id,ext,name,Number(node.getAttribute('data-from'))||0);return}
 if(node.hasAttribute('data-preview-play')){var x=findItem('live',S.selected);if(x)beginPreview(x);return}
 if(node.hasAttribute('data-preview-full')){var live=findItem('live',S.selected);if(live)openPlayer('live',S.selected,'ts',title(live),0);return}
 if(node.hasAttribute('data-reload')){delete S.loaded[keyOf(node.getAttribute('data-reload'),S.cat[node.getAttribute('data-reload')])];catalog(node.getAttribute('data-reload'))}
}
function directional(e){
 var code=e.keyCode||e.which;
 var editable=e.target&&(/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable);
 if(code===37||code===38||code===39||code===40||code===13||code===27||code===461||code===10009||code===8)S.keyboardMode=true;
 if(code===27||code===461||code===10009||code===8){
  if(editable&&code===8)return;
  if(S.route==='login')return;
  e.preventDefault();back();return
 }
 if(S.route==='player'&&!editable){
  var p=S.playerView,active=document.activeElement;
  if(code===32&&p&&p.toggle&&(!active||active===document.body||active===p.video)){
   e.preventDefault();p.toggle();return
  }
  if(p&&p.kind!=='live'&&p.seekTo&&(code===37||code===39)&&(!active||active===document.body||active===p.video)){
   e.preventDefault();p.seekTo((p.mode==='vodhls'?p.offset:0)+(p.video.currentTime||0)+(code===37?-10:10));return
  }
 }
 if(!editable&&S.userVerified&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&code===191&&S.route!=='player'){
  e.preventDefault();navigate('search');return
 }
 if(code!==37&&code!==38&&code!==39&&code!==40)return;
 if(editable)return;
 var nodes=document.querySelectorAll('button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'),arr=[];
 for(var i=0;i<nodes.length;i++){
  var node=nodes[i],r=node.getBoundingClientRect();
  if(r.width>0&&r.height>0)arr.push({node:node,x:r.left+r.width/2,y:r.top+r.height/2})
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
document.addEventListener('pointerdown',function(){
 S.keyboardMode=false;
 var old=document.querySelector('.remote-focus');if(old)old.classList.remove('remote-focus')
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
window.addEventListener('beforeunload',function(){
 if(S.playerView&&S.playerView.ready&&S.playerView.kind!=='live'){
  var p=S.playerView,v=p.video;
  saveResume(p.kind,p.id,(p.mode==='vodhls'?p.offset:0)+(v.currentTime||0),p.mode==='vodhls'?p.duration:(isFinite(v.duration)?v.duration:p.duration),true)
 }
});
api('GET','/api/session',null,function(st,json){if(st===200&&json.active){S.userVerified=true;navigate('home',{},true)}else login('أدخل كود اشتراك BLOFY STREAM للتفعيل')});
})();