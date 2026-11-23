/* BLOFY STREAM Web — visual parity port from Android STREAM 56.0.4.
 * Source references in README.md; native Android-only APIs are not emulated.
 * ES5-compatible UI code for older VIDAA WebKit/Chromium engines.
 * Playback is deliberately distinct: LIVE HLS, VOD seekable MP4 when possible.
 */
(function(){
'use strict';
var app=document.getElementById('app');
var S={route:'boot',kind:'movie',cat:{live:'all',movie:'all',series:'all'},cats:{},pages:{},loaded:{},selected:null,livePreview:null,
 item:null,episodes:null,selectedSeason:'1',play:null,history:[],sort:'source',heroIndex:0,searchToken:0,requestNum:0,library:{},
 watch:{},favoriteItems:{},lastPlaybackDiag:null,profileKey:'',accountEpoch:0,epgToken:0,epgTimer:null,epgCache:{},host:'',userVerified:false,heading:'',loading:false,listingInflight:{},catsInflight:{},views:{},keyboardMode:false,refreshing:false,catalogVersion:null,lastCatalogCheck:0,aiTurns:[],aiBusy:false,aiToken:0,aiSearchTitle:null,searchRequests:[],searchKind:'all',recentSearches:[]};
var NAV=[['home','⌂','الرئيسية'],['live','◉','البث المباشر'],['movie','▣','الأفلام'],['series','▤','المسلسلات'],['collections','▦','التصنيفات'],['favorites','♡','المفضلة'],['search','⌕','البحث'],['ai','✧','الذكاء الاصطناعي'],['settings','⚙','الإعدادات']];
function readJson(key,backup){try{var value=JSON.parse(localStorage.getItem(key)||'null');return value||backup}catch(e){return backup}}
function writeJson(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(e){}}
function profileStorageKey(name){return 'blofy_web_profile_v1:'+S.profileKey+':'+name}
function profileSave(name,value){if(S.profileKey)writeJson(profileStorageKey(name),value)}
function useProfile(id){
 if(!/^[a-f0-9]{24}$/.test(String(id||'')))return false;
 var changed=S.profileKey!==id;
 if(changed)S.accountEpoch++;
 S.profileKey=id;
 S.library=readJson(profileStorageKey('favorites'),{});
 S.watch=readJson(profileStorageKey('watch'),{});
 S.favoriteItems=readJson(profileStorageKey('favoriteItems'),{});
 S.recentSearches=readJson(profileStorageKey('recentSearches'),[]);
 S.lastPlaybackDiag=readJson(profileStorageKey('lastPlaybackDiag'),null);
 if(changed){
  if(S.epgTimer){clearTimeout(S.epgTimer);S.epgTimer=null}
  S.epgToken++;S.epgCache={};
  S.loaded={};S.cats={};S.pages={};S.item=null;S.episodes=null;S.views={};S.aiTurns=[];
  S.selected=null;S.livePreview=null;S.listingInflight={};S.catsInflight={}
 }
 return true
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function enc(s){return encodeURIComponent(String(s==null?'':s))}
function urlPic(raw){if(Array.isArray(raw))raw=raw[0];if(typeof raw!=='string')return '';var s=raw.trim();if(!/^https?:\/\/[^\s<>]+$/i.test(s))return '';if(/[?&](username|password|token|api_key|auth)=/i.test(s))return '';if(s.slice(0,5)==='http:')s='https:'+s.slice(5);return s}
function art(x){if(!x)return '';var arr=[x.stream_icon,x.cover_big,x.cover,x.movie_image,x.poster,x.poster_url,x.thumbnail,x.icon,x.backdrop,x.backdrop_path];for(var i=0;i<arr.length;i++){var p=urlPic(arr[i]);if(p)return p}return ''}
function title(x){return x&&(x.name||x.title||x.episode_name)||'بدون عنوان'}
function kindName(k){return k==='live'?'البث المباشر':k==='movie'?'الأفلام':k==='series'?'المسلسلات':'BLOFY STREAM'}
function itemId(x,k){return String(x?(k==='series'?(x.series_id||x.id):(x.stream_id||x.id))||'':'')}
function findItem(k,id){var sets=[];var keys=Object.keys(S.loaded);for(var i=0;i<keys.length;i++)if(keys[i].indexOf(k+':')===0)sets.push(S.loaded[keys[i]].items||[]);for(var a=0;a<sets.length;a++)for(var b=0;b<sets[a].length;b++)if(itemId(sets[a][b],k)===id)return sets[a][b];return S.favoriteItems[k+':'+id]||null}
function api(method,endpoint,payload,cb){
 var xhr=new XMLHttpRequest(),done=false,epoch=S.accountEpoch;
 try{xhr.open(method,endpoint,true);xhr.withCredentials=true;xhr.timeout=40000;
 xhr.setRequestHeader('Accept','application/json');if(method==='POST')xhr.setRequestHeader('Content-Type','application/json');
 xhr.onreadystatechange=function(){if(xhr.readyState===4&&!done){done=true;
   if(epoch!==S.accountEpoch)return;
   var json={};try{json=JSON.parse(xhr.responseText)}catch(e){}cb(xhr.status,json)
  }};
 xhr.onerror=xhr.ontimeout=function(){if(!done){done=true;
   if(epoch===S.accountEpoch)cb(0,{error:'network_unavailable'})
  }};
 xhr.send(payload?JSON.stringify(payload):null);
  return xhr
 }catch(e){cb(0,{error:'request_failed'});return null}
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
 S.accountEpoch++;
 cleanupPlayer();S.route='login';S.userVerified=false;S.history=[];
 S.profileKey='';S.library={};S.watch={};S.favoriteItems={};S.recentSearches=[];S.lastPlaybackDiag=null;
 S.loaded={};S.cats={};S.pages={};S.item=null;S.episodes=null;S.views={};S.aiTurns=[];
 S.listingInflight={};S.catsInflight={};S.selected=null;S.livePreview=null;
 if(S.epgTimer){clearTimeout(S.epgTimer);S.epgTimer=null}
 S.epgToken++;S.epgCache={};
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
  if(st===200&&r.ok&&useProfile(r.profileKey)){S.userVerified=true;navigate('home',{},true)}
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
 if(S.route==='search'&&route!=='search')cancelSearch();
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
 return api('GET',endpoint,null,function(st,result){
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
  '<div class="row"><button class="btn" data-preview-play>▶ المعاينة</button><button class="btn secondary" data-preview-full>⛶ ملء الشاشة</button></div><div class="preview-status" id="live-status"></div>'+
   '<section class="epg-panel" aria-label="دليل برامج القناة"><strong class="epg-heading">دليل البرامج</strong><div id="live-epg" class="epg-content" role="status" aria-live="polite">اختر قناة لعرض البرامج المتوفرة</div></section></div></section>'+
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
 if(player&&player.kind===kind&&String(player.id)===String(id))player.completed=true;
 delete S.watch[progressKey(kind,id)];
 profileSave('watch',S.watch)
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
 document.getElementById('search-input').oninput=function(){var q=this.value.trim();if(S.searchTimer)clearTimeout(S.searchTimer);
 if(q.length<2){cancelSearch();document.getElementById('search-result').innerHTML='';document.getElementById('search-status').textContent='اكتب حرفين على الأقل';return}
 var token=++S.searchToken;document.getElementById('search-status').textContent='جار البحث في المكتبة…';
 S.searchTimer=setTimeout(function(){searchNow(q,token)},260)
 };
 document.getElementById('search-input').focus();
 if(S.aiSearchTitle){
  var text=S.aiSearchTitle;S.aiSearchTitle=null;
  var input=document.getElementById('search-input');input.value=text;
  if(text.length>=2){var token=++S.searchToken;searchNow(text,token)}
 }
}
function searchNow(q,token){
 var old=S.searchRequests||[];S.searchRequests=[];
 for(var j=0;j<old.length;j++)try{old[j].abort()}catch(e){}
 var kinds=S.searchKind==='all'?['live','movie','series']:[S.searchKind],
 responses={live:[],movie:[],series:[]},pending=kinds.length;
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
  var xhr=pageRequest(k,'all',0,20,function(st,p){
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
  },q);
  if(xhr)S.searchRequests.push(xhr)
 })(kinds[i])
}
function aiScreen(){
 S.route='ai';
 shell('مساعد BLOFY الذكي','<section class="ai-chat-screen" aria-label="محادثة مساعد BLOFY">'+
  '<div class="ai-note">المساعد يستخدم خدمة BLOFY نفسها الموجودة في تطبيق Android. الاقتراحات تُعرض كبحث داخل مكتبتك، وليست روابط لمحتوى غير متحقق.</div>'+
  '<div class="ai-thread" id="ai-thread" role="log" aria-live="polite"></div>'+
  '<div class="ai-prompts" id="ai-prompts"><button class="chip" data-ai-prompt="اقترح أفلام أكشن">أفلام أكشن</button>'+
  '<button class="chip" data-ai-prompt="رشح لي مسلسل كوميدي">مسلسلات كوميدية</button>'+
  '<button class="chip" data-ai-prompt="اقترح فيلم رعب جديد">أفلام رعب جديدة</button></div>'+
  '<div class="ai-compose"><input class="input" id="ai-text" maxlength="160" placeholder="اسأل عن فيلم أو مسلسل ترغب بمشاهدته…" autocomplete="off">'+
  '<button class="btn" id="ai-send">إرسال ⟵</button></div>'+
  '<p class="muted small">الذكاء الاصطناعي قد يخطئ. اضغط على العنوان لعرض النتائج الفعلية في مكتبتك.</p></section>');
 function render(){
  if(S.route!=='ai')return;
  var box=document.getElementById('ai-thread');if(!box)return;
  var turns=S.aiTurns.slice(-16);
  box.innerHTML=turns.map(function(turn){
   var suggestions=(turn.suggestions||[]).map(function(t){
    return '<button class="chip ai-result" data-ai-result="'+esc(t)+'">⌕ '+esc(t)+'</button>'
   }).join('');
   return '<div class="ai-bubble '+(turn.user?'mine':'assistant')+'"><strong>'+(turn.user?'أنت':'BLOFY AI')+'</strong>'+
    '<p>'+esc(turn.text)+'</p>'+(suggestions?'<div class="ai-links">'+suggestions+'</div>':'')+'</div>'
  }).join('')+(S.aiBusy?'<div class="ai-bubble assistant"><strong>BLOFY AI</strong><p>جار تحليل طلبك…</p></div>':'');
  box.scrollTop=box.scrollHeight
 }
 if(!S.aiTurns.length)S.aiTurns.push({user:false,text:'أهلًا بك في مساعد BLOFY. أخبرني بنوع الأفلام أو المسلسلات التي تحبها، وسأقترح عناوين للبحث عنها في مكتبتك.'});
 render();
 function ask(text){
  var query=String(text||'').trim().slice(0,160);
  if(query.length<3||S.aiBusy)return;
  S.aiBusy=true;var token=++S.aiToken;
  S.aiTurns.push({user:true,text:query});
  document.getElementById('ai-text').value='';
  render();
  api('POST','/api/ai/interpret',{text:query,locale:document.documentElement.lang==='en'?'en':'ar'},function(st,data){
   if(token!==S.aiToken)return;
   S.aiBusy=false;
   if(st===200&&data&&data.ok){
    var suggestions=Array.isArray(data.suggestedTitles)?data.suggestedTitles.slice(0,10):[];
    if(data.title&&suggestions.indexOf(data.title)<0)suggestions.unshift(data.title);
    S.aiTurns.push({user:false,text:String(data.reply||'اضغط على أحد العناوين للبحث عنه في مكتبة BLOFY.').slice(0,240),suggestions:suggestions})
   }else{
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
 document.getElementById('ai-text').onkeydown=function(e){if((e.keyCode||e.which)===13){e.preventDefault();ask(this.value)}};
 document.getElementById('ai-prompts').onclick=function(e){
  var t=e.target.getAttribute('data-ai-prompt');if(t)ask(t)
 };
 document.getElementById('ai-thread').onclick=function(e){
  var node=e.target;
  while(node&&node!==this&&!node.getAttribute('data-ai-result'))node=node.parentNode;
  if(node&&node!==this){var title=node.getAttribute('data-ai-result');S.aiSearchTitle=title;navigate('search')}
 };
}
function refreshCatalog(manual){
 if(S.refreshing||!S.userVerified)return;
 S.refreshing=true;
 var kinds=['live','movie','series'],errors=[],done=0;
 var button=document.getElementById('refresh-content');
 if(button)button.disabled=true;
 function notify(message){
  var box=document.getElementById('refresh-progress');
  if(box)box.textContent=message
 }
 notify('جار تحديث المحتوى • 0٪');
 function finish(){
  S.refreshing=false;if(button)button.disabled=false;
  if(!errors.length){
   // Keep the existing screen stable; lists are reused when user opens them.
   S.cats={};S.pages={};S.catsInflight={};
   notify('✓ اكتمل تحديث القنوات والأفلام والمسلسلات — 100٪');
  }else notify('تم تحديث '+(3-errors.length)+' من 3 أقسام. تعذر: '+errors.join('، ')+' — حاول مرة أخرى');
 }
 function next(){
  if(done===kinds.length){finish();return}
  var kind=kinds[done],label=kindName(kind);
  notify('جار تحديث '+label+' • '+Math.round(done/3*100)+'٪');
  pageRequest(kind,'all',0,36,function(st,result){
   if(st===200&&result){
    S.loaded[keyOf(kind,'all')]=result;
    // Other category caches are invalidated lazily, without disrupting a playing video.
    var keys=Object.keys(S.loaded);
    for(var i=0;i<keys.length;i++)if(keys[i].indexOf(kind+':')===0&&keys[i]!==kind+':all')delete S.loaded[keys[i]];
   }else errors.push(label);
   done++;next()
  })
 }
 next()
}
function checkCatalogVersion(){
 if(!S.userVerified||S.refreshing||S.route==='player'||document.hidden)return;
 var now=Date.now();if(now-S.lastCatalogCheck<10*60*1000)return;S.lastCatalogCheck=now;
 api('GET','/api/catalog?action=get_blofy_catalog_version',null,function(st,v){
  if(st!==200||!v)return;
  var raw=v.version||v.epoch||v.catalogVersion||v.revision||v.lastModified;
  if(!raw||typeof raw!=='string'&&typeof raw!=='number')return;
  var version=String(raw);
  if(S.catalogVersion&&S.catalogVersion!==version){
   // Refresh in the background only while browsing non-live pages; never interrupt playback.
   refreshCatalog(false)
  }
  S.catalogVersion=version
 })
}
function settingsScreen(){
 var diag=S.lastPlaybackDiag,mode=diag&&({fullvod:'VOD كامل',vodhls:'HLS مؤقت',direct:'MP4 مباشر',hls:'بث HLS',mpegts:'MPEG-TS'}[diag.mode]||'غير معروف');
 var diagText=!diag?'لا توجد مشاهدة مسجلة بعد. شغّل محتوى، ثم ارجع إلى الإعدادات لمعرفة أداء المشغّل.':
  'آخر مشاهدة: '+(diag.kind==='live'?'بث مباشر':diag.kind==='series'?'حلقة':'فيلم')+
  ' • المحرك: '+mode+
  ' • بداية التشغيل: '+(diag.startupMs===null?'لم تبدأ':(diag.startupMs/1000).toFixed(1)+' ث')+
  ' • مرات الانتظار: '+(diag.bufferingEvents||0)+
  ' • زمن الانتظار: '+Math.round((diag.bufferingMs||0)/1000)+' ث'+
  ' • طلبات التقديم: '+(diag.seekAttempts||0)+
  ' • التقديم الذي وصل للمكان المطلوب: '+(diag.seekReady||0)+
  ' • حالات انتظار تجاوزت 30 ثانية: '+(diag.seekTimeouts||0)+
  ' • زمن آخر تقديم ناجح: '+(diag.lastSeekMs===null?'غير متوفر':(diag.lastSeekMs/1000).toFixed(1)+' ث')+
  ' • أخطاء الوسائط: '+(diag.errors||0)+'.';
 shell('الإعدادات','<div class="settings-grid"><section class="setting-panel"><h3>تحديث المحتوى</h3><p>إعادة قراءة القنوات والأفلام والمسلسلات من خادم BLOFY.</p><button class="btn" id="refresh-content">↻ تحديث المحتوى</button><p id="refresh-progress" role="status" aria-live="polite">فهرس المحتوى يُراجع تلقائيًا عند توفر رقم إصدار جديد.</p></section>'+
 '<section class="setting-panel"><h3>حالة مشغّل الفيديو</h3><p>تحقق من جاهزية خادم الأفلام والمسلسلات دون التأثير على اشتراكك أو تشغيل العملاء.</p>'+
  '<button class="btn secondary" id="check-player-health">فحص جاهزية الفيديو</button>'+
  '<p class="small muted" id="player-health-status" role="status" aria-live="polite">الفحص يؤكد جاهزية المحرك، وليس صلاحية كل مصدر فيديو.</p></section>'+
 '<section class="setting-panel"><h3>آخر اختبار مشاهدة فعلي</h3><p id="last-playback-diagnostic" role="status" aria-live="polite">'+esc(diagText)+'</p>'+
  '<button class="btn secondary" id="clear-playback-diagnostic">مسح بيانات التشخيص</button>'+
  '<p class="small muted">إحصاءات من المشاهدة داخل هذا المتصفح فقط؛ ليست اختبارًا لكل مصادر Xtream. لا نحفظ بيانات الاشتراك أو رابط المصدر.</p></section>'+
 '<section class="setting-panel"><h3>المفضلة والمتابعة</h3><p>تُحفظ المفضلة وسجل المشاهدة والبحث لهذا الاشتراك فقط على هذا المتصفح. المزامنة مع أندرويد غير مفعلة بعد.</p>'+
  '<button class="btn secondary" data-go="favorites">المفضلة</button> '+
  '<button class="btn secondary" id="clear-watch-history">مسح سجل المشاهدة والبحث</button></section>'+
 '<section class="setting-panel"><h3>حساب BLOFY</h3><p>الخروج من هذا الجهاز فقط، دون التأثير على التطبيقات الأصلية.</p><button class="btn danger" id="logout">تسجيل الخروج</button></section></div>'+
 '<div id="page-status" class="info" style="margin-top:20px">BLOFY STREAM Web — نسخة مطابقة قيد التطوير.</div>');
 document.getElementById('refresh-content').onclick=function(){refreshCatalog(true)};
 document.getElementById('check-player-health').onclick=function(){
  var button=this,box=document.getElementById('player-health-status');
  button.disabled=true;box.textContent='جار فحص خادم تشغيل الأفلام والمسلسلات…';
  api('GET','/api/health/media',null,function(st,result){
   button.disabled=false;if(!box||S.route!=='settings')return;
   if(st===200&&result&&result.ok){
    box.textContent='✓ مشغّل الفيديو جاهز. الاختبار التجريبي للتقديم والبث نجح. العمليات الحالية: '+
     (result.converting||0)+' من '+(result.capacity||0)+'.';
   }else{
    box.textContent='تعذر فحص مشغّل الفيديو الآن. هذا لا يعني انتهاء اشتراكك؛ حاول مجددًا بعد قليل.'
   }
  })
 };
 document.getElementById('clear-playback-diagnostic').onclick=function(){
  S.lastPlaybackDiag=null;profileSave('lastPlaybackDiag',null);
  var box=document.getElementById('last-playback-diagnostic');
  if(box)box.textContent='تم حذف بيانات التشخيص لهذا الاشتراك من المتصفح.'
 };
 document.getElementById('clear-watch-history').onclick=function(){
  if(!window.confirm('حذف سجل المشاهدة وعمليات البحث لهذا الاشتراك من هذا المتصفح فقط؟ لن تُحذف المفضلة أو الاشتراك.'))return;
  S.watch={};S.recentSearches=[];
  profileSave('watch',S.watch);profileSave('recentSearches',S.recentSearches);
  setStatus('تم حذف سجل المشاهدة والبحث المحلي لهذا الاشتراك؛ المفضلة محفوظة.')
 };
 document.getElementById('logout').onclick=function(){api('POST','/api/logout',{},function(){login('تم تسجيل الخروج')})}
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
 try{
  if(old.timer)clearTimeout(old.timer);
  if(old.stallTimer)clearTimeout(old.stallTimer);
  if(old.startupTimer)clearTimeout(old.startupTimer)
 }catch(e){}
 if(old.engine){try{old.engine.destroy()}catch(e){}}
 try{if(old.video){old.video.pause();old.video.removeAttribute('src');old.video.load()}}catch(e){}
 if(sendStop!==false&&(old.hlsKey||old.stopUrl))api('POST',old.stopUrl||'/api/hls/'+old.hlsKey+'/stop',{},function(){})
}
function cleanupPlayer(){
 if(S.playerView){
  if(S.playerView.directTimer){clearTimeout(S.playerView.directTimer);S.playerView.directTimer=null}
  if(S.playerView.directSeekCheck){clearTimeout(S.playerView.directSeekCheck);S.playerView.directSeekCheck=null}
  if(S.playerView.directSeekVerify){clearTimeout(S.playerView.directSeekVerify);S.playerView.directSeekVerify=null}
  if(S.playerView.directStartupTimer){clearTimeout(S.playerView.directStartupTimer);S.playerView.directStartupTimer=null}
  if(S.playerView.liveEpgTimer){clearTimeout(S.playerView.liveEpgTimer);S.playerView.liveEpgTimer=null}
  if(S.playerView.seekWatchdog){clearTimeout(S.playerView.seekWatchdog);S.playerView.seekWatchdog=null}
  if(S.playerView.seekLogTimer){clearTimeout(S.playerView.seekLogTimer);S.playerView.seekLogTimer=null}
  if(S.playerView.seekDebounce){clearTimeout(S.playerView.seekDebounce);S.playerView.seekDebounce=null}
  if(S.playerView.healthTimer){clearInterval(S.playerView.healthTimer);S.playerView.healthTimer=null}
  S.playerView.pendingSeek=null;
  if(S.playerView.hudTimer){clearTimeout(S.playerView.hudTimer);S.playerView.hudTimer=null}
  if(S.playerView.releaseWakeLock)S.playerView.releaseWakeLock()
 }
 stopPlayback(true)
}
function playerStatus(message,error){
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
 diagnose(kind,'vod_full_start','fullvod',0);
 video.autoplay=true;video.muted=false;video.defaultMuted=false;video.controls=false;
 playerStatus('جار فتح الفيلم الكامل مع التقديم والترجيع…');
 function alive(){return S.route==='player'&&S.play===rec}
 function fail(msg){
  if(!alive())return;
  if(rec.timer)clearTimeout(rec.timer);
  if(rec.stallTimer)clearTimeout(rec.stallTimer);
  if(rec.startupTimer)clearTimeout(rec.startupTimer);
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
  rec.ready=true;if(rec.timer)clearTimeout(rec.timer);
  if(rec.startupTimer){clearTimeout(rec.startupTimer);rec.startupTimer=null}
  if(rec.stallTimer){clearTimeout(rec.stallTimer);rec.stallTimer=null}
  ready()
 };
 video.onwaiting=video.onstalled=function(){
  if(!alive()||video.paused)return;
  playerStatus('جار تحميل الجزء المطلوب من الفيلم…');
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
   var hls=new window.Hls({enableWorker:false,lowLatencyMode:false,startPosition:state.resume||0,maxBufferLength:36,
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
     fail('خادم معالجة الفيديو مشغول حاليًا. تم حفظ مكان المشاهدة؛ حاول لاحقًا.');
     return
    }
    if(recovery<1&&detail.type===window.Hls.ErrorTypes.NETWORK_ERROR){recovery++;try{hls.startLoad()}catch(e){};return}
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
 video.onplaying=function(){if(!alive())return;rec.ready=true;if(rec.timer)clearTimeout(rec.timer);ready();};
 video.onwaiting=function(){if(alive()&&rec.ready)playerStatus('جار تحميل المقطع التالي من الفيلم…')};
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
 '<div class="player-hud"><div class="player-title">'+esc(name||title(item))+' <span class="player-mode-badge" id="player-mode-badge" aria-live="polite">'+(isLive?'بث مباشر':'جار فحص وضع التشغيل')+'</span></div>'+
 (isLive?'<section class="player-live-guide" aria-label="برنامج القناة"><span class="small">دليل البرامج</span><div id="player-live-epg" role="status" aria-live="polite">جار قراءة دليل القناة…</div></section>':'<div class="player-time"><span id="now-time">00:00:00</span><span id="total-time">--:--</span></div><input id="seek" type="range" min="0" max="1000" value="0" step="1" class="seek-line" disabled>')+
 '<div class="player-actions"><button class="btn secondary" id="player-back">↶ رجوع</button><button class="btn" id="player-toggle">⏯ تشغيل / إيقاف</button>'+
 (isLive?'':'<button class="btn secondary" id="player-skip-back">−30 ثانية</button><button class="btn secondary" id="player-skip-forward">+30 ثانية</button><button class="btn secondary" id="player-skip-forward5">+5 دقائق</button><button class="btn secondary" id="player-jump-toggle" aria-controls="player-jump-panel" aria-expanded="false">↪ دقيقة محددة</button><button class="btn secondary" id="player-restart">↺ من البداية</button>')+
 (nextEpisode?'<button class="btn secondary" id="player-next-episode">الحلقة التالية ⏭</button>':'')+
 '<button class="btn secondary" id="player-audio" aria-label="تغيير المسار الصوتي">🔊 الصوت</button>'+
 (isLive?'':'<button class="btn secondary" id="player-subtitles" aria-label="خيارات الترجمة">CC الترجمة</button><button class="btn secondary" id="player-speed">السرعة 1×</button>')+
 '<button class="btn secondary" id="player-fullscreen">⛶ ملء الشاشة</button>'+
 '<button class="btn secondary" id="player-retry" style="display:none">⟳ إعادة المحاولة</button>'+
 '<button class="btn secondary" id="player-health-toggle" aria-expanded="false" aria-controls="player-health-panel">📊 حالة التشغيل</button></div>'+
 '<section class="player-health-panel" id="player-health-panel" hidden role="status" aria-live="off"></section>'+
 (isLive?'':'<form class="player-jump-panel" id="player-jump-panel" hidden><label for="player-jump-minute">الانتقال إلى الدقيقة (0–359)</label>'+
 '<input id="player-jump-minute" type="number" inputmode="numeric" min="0" max="359" step="1" required placeholder="مثلاً 10">'+
 '<button class="btn" type="submit">انتقال</button><button class="btn secondary" type="button" id="player-jump-cancel">إلغاء</button>'+
 '<small>القفز يعتمد على دعم المصدر للقراءة العشوائية؛ بعض مصادر Xtream قد لا تسمح به.</small></form>')+
 '</div></section>';
 var video=document.getElementById('player-media'),state={kind:kind,id:id,ext:ext,video:video,name:name,offset:0,
 mode:isLive?'hls':'direct',resume:resume,duration:knownDuration(kind,id,item),didResume:false,ready:false,track:0,lastSaved:0,
  art:art(item)||prior&&prior.art||'',seriesId:kind==='series'&&S.item&&S.item.id||'',playbackId:freshPlaybackId(),
   stats:{openedAt:Date.now(),firstFrameAt:0,bufferEvents:0,bufferMs:0,bufferSince:0,errors:0,
    seekAttempts:0,seekReady:0,seekTimeouts:0,lastSeekMs:null}};
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
  box.textContent='المحرك: '+mode+' | بدء الصورة: '+(startup===null?'لم يبدأ':(startup/1000).toFixed(1)+' ثانية')+
   ' | مرات الانتظار: '+(st.bufferEvents||0)+' | إجمالي الانتظار: '+Math.round(buffering/1000)+' ثانية'+
   ' | التقديم: '+(st.seekReady||0)+' ناجح من '+(st.seekAttempts||0)+
   (pending?' | جار الوصول إلى '+formatTime(pending.target):'')+
   ' | أخطاء المشغل: '+(st.errors||0);
 }
 var healthToggle=document.getElementById('player-health-toggle');
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
 function onBufferEvent(){
  var stats=state.stats;
  if(S.route!=='player'||S.playerView!==state||video.paused||!stats.firstFrameAt)return;
  if(!stats.bufferSince){stats.bufferEvents++;stats.bufferSince=Date.now()}
 }
 function confirmSeek(){
  var pending=state.pendingSeek;
  if(!pending||S.route!=='player'||S.playerView!==state||video.readyState<2||video.seeking)return;
  var now=Date.now(),actual=state.mode==='vodhls'?
   state.offset+Math.max(0,Number(video.currentTime)||0):Math.max(0,Number(video.currentTime)||0);
  if(Math.abs(actual-pending.target)>8)return;
  if(state.seekWatchdog){clearTimeout(state.seekWatchdog);state.seekWatchdog=null}
  if(state.seekLogTimer){clearTimeout(state.seekLogTimer);state.seekLogTimer=null}
  if(!pending.logged)diagnose(kind,'vod_seek_request',state.mode,0);
  state.pendingSeek=null;
  state.seekIncomplete=false;
  state.stats.seekReady++;
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
  var pending={target:target,startedAt:now,logged:false};
  state.pendingSeek=pending;
  state.seekIncomplete=true;
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
   state.stats.seekTimeouts++;
   if(state.seekLogTimer){clearTimeout(state.seekLogTimer);state.seekLogTimer=null}
   if(!pending.logged)diagnose(kind,'vod_seek_request',state.mode,0);
   diagnose(kind,'vod_seek_timeout',state.mode,0);
   playerStatus('التقديم يستغرق وقتًا أطول من المتوقع. سيستمر المشغّل بالمحاولة، ويمكنك إعادة التشغيل إذا لم يتحرك الفيديو.')
  },30000)
 }
 function onPlayingEvent(){
  var stats=state.stats,now=Date.now();
  if(!stats.firstFrameAt)stats.firstFrameAt=now;
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
   if(S.route!=='player'||!state.ready||video.paused||!root.isConnected)return;
   var loading=document.getElementById('player-status');
   if(loading&&loading.style.display!=='none'&&loading.textContent)return;
   // TV remote users need to see focused controls before seeking.
   if(hud.contains(document.activeElement))return;
   root.classList.add('controls-hidden')
  },5500)
 }
 root.addEventListener('pointermove',revealControls,{passive:true});
 root.addEventListener('pointerdown',revealControls,{passive:true});
 root.addEventListener('keydown',revealControls);
 root.addEventListener('focusin',revealControls);
 video.addEventListener('click',revealControls);
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
  state.ready=true;var status=document.getElementById('player-status');if(status)status.style.display='none';
  if(state.directStartupTimer){clearTimeout(state.directStartupTimer);state.directStartupTimer=null}
  revealControls();
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
     S.episodes=result;
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
 state.toggle=function(){if(video.paused){var p=video.play();if(p&&p.catch)p.catch(function(){})}else video.pause()};
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
  playerStatus('جار تعبئة مخزن الفيديو…');
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
 document.getElementById('player-back').onclick=closePlayer;
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
  state.pendingSeek=null;state.seekIncomplete=false;state.completed=false;
  state.lastSeekTarget=0;state.lastSeekAt=Date.now();state.requestedSeek=0;
  delete S.watch[progressKey(kind,id)];profileSave('watch',S.watch);resume=0;state.resume=0;
  if(state.mode==='direct'&&video.seekable&&video.seekable.length){try{video.currentTime=0}catch(e){}}
  else if(state.mode==='fullvod'){try{video.currentTime=0}catch(e){startVod(0)}}
  else{state.ready=false;startVod(0)}
 };
 document.getElementById('player-audio').onclick=function(){
  var tracks=video.audioTracks,engine=S.play&&S.play.engine;
  if(tracks&&tracks.length>1){
   var current=-1;for(var a=0;a<tracks.length;a++)if(tracks[a].enabled){current=a;break}
   var next=(current+1)%tracks.length;
   for(var j=0;j<tracks.length;j++)tracks[j].enabled=j===next;
   playerStatus('تم اختيار المسار الصوتي '+(next+1));
   this.textContent='🔊 الصوت '+(next+1);
   return
  }
  if(engine&&engine.audioTracks&&engine.audioTracks.length>1){
   engine.audioTrack=(engine.audioTrack+1)%engine.audioTracks.length;
   this.textContent='🔊 الصوت '+(engine.audioTrack+1);playerStatus('تم تغيير مسار الصوت');
   return
  }
  this.textContent='🔊 المسار الافتراضي';
  playerStatus('هذا المصدر لا يعرض مسارات صوتية إضافية في المتصفح.')
 };
 var subtitleButton=document.getElementById('player-subtitles');
 if(subtitleButton)subtitleButton.onclick=function(){
  var all=video.textTracks,native=[],engine=S.play&&S.play.engine;
  if(all&&all.length){
   for(var i=0;i<all.length;i++)if(all[i].kind==='subtitles'||all[i].kind==='captions')native.push(all[i])
  }
  if(native.length){
   var current=-1;
   for(var j=0;j<native.length;j++)if(native[j].mode==='showing'){current=j;break}
   var next=current+1<native.length?current+1:-1;
   for(var k=0;k<native.length;k++)native[k].mode=k===next?'showing':'disabled';
   var label=next<0?'إيقاف':String(native[next].label||native[next].language||('مسار '+(next+1))).slice(0,26);
   this.textContent='CC '+label;
   playerStatus(next<0?'تم إيقاف الترجمة':'الترجمة: '+label);
   return
  }
  if(engine&&engine.subtitleTracks&&engine.subtitleTracks.length){
   var tracks=engine.subtitleTracks;
   var current=Number(engine.subtitleTrack);
   var next=isFinite(current)&&current>=0?current+1:0;
   if(next>=tracks.length)next=-1;
   engine.subtitleDisplay=next>=0;
   engine.subtitleTrack=next;
   var label=next<0?'إيقاف':String(tracks[next].name||tracks[next].lang||('مسار '+(next+1))).slice(0,26);
   this.textContent='CC '+label;
   playerStatus(next<0?'تم إيقاف الترجمة':'الترجمة: '+label);
   return
  }
  this.textContent='CC غير متوفرة';
  playerStatus('المصدر الحالي لا يعرض مسارات ترجمة. لا تتوفر ترجمة تلقائية.')
 };
 var speeds=[1,1.25,1.5,2,0.75],speedBtn=document.getElementById('player-speed');
 if(speedBtn)speedBtn.onclick=function(){
  var idx=speeds.indexOf(video.playbackRate),next=speeds[(idx+1)%speeds.length];
  video.playbackRate=next;this.textContent='السرعة '+next+'×'
 };
 document.getElementById('player-fullscreen').onclick=function(){
  var el=document.getElementById('player-root');
  if(document.fullscreenElement&&document.exitFullscreen){document.exitFullscreen();return}
  var request=el&&(el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen);
  if(request){try{var p=request.call(el);if(p&&p.catch)p.catch(function(){playerStatus('تعذر فتح ملء الشاشة')})}catch(e){playerStatus('ملء الشاشة غير مدعوم على هذا الجهاز')}}
  else playerStatus('ملء الشاشة غير مدعوم على هذا الجهاز')
 };
 var back30=document.getElementById('player-skip-back'),forward30=document.getElementById('player-skip-forward');
 if(back30)back30.onclick=function(){state.seekBy(-30)};
 if(forward30)forward30.onclick=function(){state.seekBy(30)};
 var forward5=document.getElementById('player-skip-forward5');
 if(forward5)forward5.onclick=function(){state.seekBy(300)};
 var nextBtn=document.getElementById('player-next-episode');
 if(nextBtn&&nextEpisode)nextBtn.onclick=function(){
  if(state.ready)saveResume(kind,id,checkpointPosition(state),totalDuration(),true);
  var previous=S.previousBeforePlayer||{route:'episodes',kind:'series',id:id};
  recordPlaybackQuality(state);
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
 S.playerView=state;
 if(isLive){
  // Do not poll provider guide continuously; a 10-minute refresh is enough.
  function refreshLiveGuide(){
   if(S.route!=='player'||S.playerView!==state||!S.userVerified)return;
   var el=document.getElementById('player-live-epg');
   if(!el)return;
   var cached=S.epgCache[String(id)],fresh=cached&&Date.now()-cached.time<300000;
   if(fresh)el.innerHTML=cached.html;
   else{
    el.textContent='جار قراءة دليل القناة…';
    api('GET','/api/catalog?action=get_short_epg&stream_id='+enc(id)+'&limit=5',null,function(st,data){
     if(S.route!=='player'||S.playerView!==state)return;
     var node=document.getElementById('player-live-epg');if(!node)return;
     var html=st===200?formatEpg(data):'<span class="epg-empty">دليل البرامج غير متوفر حاليًا.</span>';
     node.innerHTML=html;
     if(st===200)S.epgCache[String(id)]={html:html,time:Date.now()}
    })
   }
   state.liveEpgTimer=setTimeout(refreshLiveGuide,10*60*1000)
  }
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
  if(S.route==='detail'&&S.item)details({kind:S.item.kind,id:S.item.id});else favoritesScreen();
  return
 }
 if(watch){var a=watch.split(':'),kind=a[0],id=a[1],it=findItem(kind,id),ext=node.getAttribute('data-ext')||(it&&it.container_extension)||'mp4',name=node.getAttribute('data-name')||title(it);openPlayer(kind,id,ext,name,Number(node.getAttribute('data-from'))||0);return}
 if(node.hasAttribute('data-preview-play')){var x=findItem('live',S.selected);if(x)beginPreview(x);return}
 if(node.hasAttribute('data-preview-full')){var live=findItem('live',S.selected);if(live)openPlayer('live',S.selected,'ts',title(live),0);return}
 if(node.hasAttribute('data-reload')){delete S.loaded[keyOf(node.getAttribute('data-reload'),S.cat[node.getAttribute('data-reload')])];catalog(node.getAttribute('data-reload'))}
}
function directional(e){
 var code=e.keyCode||e.which;
 var editable=e.target&&((e.target.tagName==='INPUT'&&e.target.type!=='range')||
  /^(TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable);
 if(code===37||code===38||code===39||code===40||code===13||code===27||code===461||code===10009||code===8)S.keyboardMode=true;
 if(code===27||code===461||code===10009||code===8){
  if(editable&&code===8)return;
  if(S.route==='login')return;
  e.preventDefault();back();return
 }
 if(S.route==='player'&&(!editable||document.activeElement&&document.activeElement.id==='seek')){
  var p=S.playerView,active=document.activeElement;
  if(code===32&&p&&p.toggle&&(!active||active===document.body||active===p.video)){
   e.preventDefault();p.toggle();return
  }
  if(p&&p.kind!=='live'&&p.seekBy&&(code===37||code===39)&&
   ((!active||active===document.body||active===p.video)||active.id==='seek')){
   // Keep focus on the time slider. Old TV browsers otherwise treat arrows
   // as navigation and jump away instead of seeking.
   e.preventDefault();p.seekBy(code===37?-30:30);return
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
document.addEventListener('visibilitychange',function(){
 if(document.hidden){
  persistPlaybackCheckpoint();
  if(S.playerView&&S.playerView.releaseWakeLock)S.playerView.releaseWakeLock()
 }else if(S.playerView&&S.playerView.acquireWakeLock)S.playerView.acquireWakeLock()
});
api('GET','/api/session',null,function(st,json){
 if(st===200&&json.active&&useProfile(json.profileKey)){S.userVerified=true;navigate('home',{},true);setTimeout(checkCatalogVersion,25000)}
 else login('أدخل كود اشتراك BLOFY STREAM للتفعيل')
});
setInterval(checkCatalogVersion,10*60*1000);
// Optional installable web shell. The worker never caches subscription tokens,
// API responses, movie streams or account content.
if('serviceWorker' in navigator&&window.isSecureContext){
 window.addEventListener('load',function(){
  navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){})
 })
}
})();