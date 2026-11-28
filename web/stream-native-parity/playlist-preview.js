import {loadApprovedM3u,approvedXtreamPlaylistUrl} from './approved-m3u-loader.mjs';
const $=id=>document.getElementById(id);
const form=$('playlist-form'),video=$('playlist-video'),status=$('playlist-status'),group=$('playlist-group'),query=$('playlist-query'),items=$('playlist-items'),more=$('playlist-more');
let catalog=[],shown=0,engine=null,request=null,epoch=0,playEpoch=0,policy=[],mode='m3u';
function notice(text){status.textContent=text}
function stop(){playEpoch++;video.onerror=video.onplaying=null;if(engine){try{engine.destroy()}catch{}engine=null}video.pause();video.removeAttribute('src');video.load();video.hidden=true}
function clear(){epoch++;if(request)request.abort();request=null;stop();catalog=[];shown=0;items.replaceChildren();group.replaceChildren();query.value='';$('playlist-url').value='';$('external-password').value='';$('external-username').value='';$('playlist-controls').hidden=true;more.hidden=true;$('playlist-load').disabled=false}
function options(){group.replaceChildren();group.add(new Option('الكل',''));const names=Array.from(new Set(catalog.map(x=>x.group).filter(Boolean))).sort((a,b)=>a.localeCompare(b,'ar'));for(const name of names)group.add(new Option(name,name))}
function render(reset){
 if(reset){shown=0;items.replaceChildren()}
 const q=query.value.trim().toLowerCase(),g=group.value;
 const filtered=catalog.filter(x=>(!g||x.group===g)&&(!q||x.name.toLowerCase().includes(q)));
 for(const item of filtered.slice(shown,shown+100)){const b=document.createElement('button');b.type='button';b.className='btn secondary playlist-item';b.textContent=item.name;b.onclick=()=>play(item);items.appendChild(b)}
 shown=Math.min(shown+100,filtered.length);more.hidden=shown>=filtered.length;
}
function play(item){
 if(!catalog.includes(item))return;
 stop();video.hidden=false;notice('جار التشغيل…');
 const generation=epoch,playGeneration=playEpoch;
 function current(){return generation===epoch&&playGeneration===playEpoch}
 function failed(){if(!current())return;stop();notice('تعذر تشغيل هذا المصدر في المتصفح. تحقق من دعم HTTPS وCORS والترميز.')}
 video.onerror=failed;
 video.onplaying=()=>{if(current())notice(item.name)};
 const url=new URL(item.url);
 if(!policy.includes(url.origin)){failed();return}
 // HLS.js requests are additionally restricted by CSP to approved origins.
 // No custom provider cookies, headers, credentials or server proxy.
 if(/\.m3u8$/i.test(url.pathname)&&!video.canPlayType('application/vnd.apple.mpegurl')&&window.Hls&&window.Hls.isSupported()){
  const allowed=new Set(policy);
  engine=new window.Hls({enableWorker:true,xhrSetup(xhr,target){try{if(!allowed.has(new URL(target).origin))throw Error('origin_denied');xhr.withCredentials=false}catch{ xhr.abort();throw Error('origin_denied') }}});
  engine.on(window.Hls.Events.ERROR,(_,event)=>{if(event.fatal)failed()});
  engine.on(window.Hls.Events.MANIFEST_PARSED,()=>{if(current())video.play().catch(()=>{if(current())notice('اضغط تشغيل لبدء المشاهدة.')})});
  engine.loadSource(item.url);engine.attachMedia(video);
 }else{video.src=item.url;video.play().catch(()=>{if(current())notice('اضغط تشغيل لبدء المشاهدة.')})}
}
function selectMode(next){
 if(next===mode)return;
 clear();mode=next;
 const xtream=mode==='xtream';
 $('external-m3u-fields').hidden=xtream;$('external-xtream-fields').hidden=!xtream;
 $('playlist-url').disabled=xtream;
 for(const id of ['external-host','external-username','external-password']){$(id).disabled=!xtream;$(id).required=xtream}
 for(const name of ['m3u','xtream']){const button=$('external-mode-'+name);button.setAttribute('aria-pressed',String(mode===name));button.classList.toggle('secondary',mode!==name)}
 $('playlist-load').disabled=!policy.length;
 notice(policy.length?'أدخل بيانات المصدر المعتمد.':'المصادر الخارجية غير مفعلة حاليًا.');
}
$('external-mode-m3u').onclick=()=>selectMode('m3u');
$('external-mode-xtream').onclick=()=>selectMode('xtream');
form.addEventListener('submit',async e=>{
 e.preventDefault();if(!policy.length)return;
 let raw;
 try{
  raw=mode==='xtream'?approvedXtreamPlaylistUrl({host:$('external-host').value.trim(),username:$('external-username').value,password:$('external-password').value},policy):$('playlist-url').value.trim();
 }catch{$('external-password').value='';notice('تحقق من الهوست المعتمد وبيانات الاشتراك.');return}
 if(!raw)return;
 clear();const generation=epoch;request=new AbortController();$('playlist-load').disabled=true;notice('جار تحميل القائمة…');
 try{const result=await loadApprovedM3u(raw,{approvedOrigins:policy,fetchImpl:window.fetch.bind(window),signal:request.signal});if(generation!==epoch)return;catalog=result.items;options();$('playlist-controls').hidden=false;render(true);notice('تم تحميل '+catalog.length+' عنصر'+(result.rejected?'؛ تم استبعاد '+result.rejected+' مدخل غير صالح':'')+'. اختر عنصرًا للتشغيل.')}
 catch{if(generation===epoch)notice('تعذر تحميل القائمة. تحقق من اعتماد المزود وHTTPS وCORS.')}
 finally{if(generation===epoch){request=null;$('playlist-load').disabled=false}}
});
group.onchange=()=>render(true);query.oninput=()=>render(true);more.onclick=()=>render(false);$('playlist-clear').onclick=()=>{clear();notice('تمت إزالة القائمة من الذاكرة.')};
window.addEventListener('pagehide',clear);
$('playlist-load').disabled=true;
try{const response=await fetch('/playlist-preview-policy',{cache:'no-store',credentials:'same-origin'});const data=await response.json();if(response.ok&&Array.isArray(data.origins)){policy=data.origins; $('playlist-load').disabled=!policy.length}}
catch{}
if(!policy.length)notice('المصادر الخارجية غير مفعلة حاليًا.');
