// Private owner-only cinematic browse surface. All cards use saved, already
// authenticated metadata returned by the existing read-only library search.
// There is no public route, automatic video playback, provider crawl or S3 read.
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const el=(tag,cls,content)=>{
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 if(content!==undefined)n.textContent=String(content);
 return n;
};
const num=value=>Number(value||0).toLocaleString('ar-SA');
const posterPath=value=>typeof value==='string'&&
 /^\/[A-Za-z0-9_-]{5,90}\.(?:jpg|jpeg|png|webp)$/.test(value)?value:null;
const genreNames={unspecified:'غير مصنّف',drama:'دراما',action:'أكشن',
 comedy:'كوميديا',thriller:'تشويق',romance:'رومانسي',family:'عائلي',
 animation:'أنيميشن',documentary:'وثائقي',horror:'رعب',
 science_fiction:'خيال علمي',fantasy:'فانتازيا',crime:'جريمة',
 adventure:'مغامرة',other:'أخرى'};
const stateNames={verified:'مكتمل',queued:'بالانتظار',running:'جارٍ النقل',
 paused:'متوقف',failed:'متعثر',unknown:'غير محدد'};
const seasonName=value=>/^series_([1-9][0-9]{0,14})_s[0-9]{1,3}$/.exec(
 String(value||''));
let current=null,currentKind='all',genre='all',mode='cinema';
function validKey(key){
 return /^(?:movie:[A-Za-z0-9_-]{8,80}|series:[1-9][0-9]{0,14})$/.test(key);
}
function previewPoster(meta,alt){
 const poster=el('div','cinema-poster');
 const safe=posterPath(meta?.posterPath);
 if(safe&&meta?.artworkRightsConfirmed===true){
  const img=el('img','','');
  img.src='https://image.tmdb.org/t/p/w342'+safe;
  img.alt='ملصق '+alt;
  img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
  img.addEventListener('error',()=>img.remove(),{once:true});
  poster.append(img);
 }else{
  poster.classList.add('cinema-poster-placeholder');
  poster.append(el('span','', 'BLOFY'),
   el('span','', 'لم تُضف صورة مصرّح بها'));
 }
 return poster;
}
function typeLabel(kind){
 return {movie:'فيلم',series:'مسلسل',season:'موسم',episode:'حلقة'}[kind]||kind;
}
function collect(data){
 const result={movie:[],series:[],season:[],episode:[]};
 if(data?.ok!==true||data.readOnly!==true||
    !Array.isArray(data.movies)||!Array.isArray(data.seasons)||
    !Array.isArray(data.episodes))return result;
 for(const m of data.movies.slice(0,40)){
  if(!/^[A-Za-z0-9_-]{8,80}$/.test(String(m?.runId||'')))continue;
  const meta=m.metadata||null;
  result.movie.push({kind:'movie',key:'movie:'+m.runId,
   title:meta?.title||'فيلم محفوظ · '+m.runId,
   genre:meta?.genre||'unspecified',year:meta?.year||null,meta,
   state:m.verified===true?'verified':m.state||'unknown',
   caption:m.verified===true?'نسخة متحقق منها في النظام الخاص':
    'نسخة محفوظة أو قيد النقل — لم يُتحقق من تشغيلها',
   progress:Math.min(100,Math.max(0,Number(m.percent)||0)),
   editKey:'movie:'+m.runId,seasonKey:null,verified:m.verified===true});
 }
 const series=new Map();
 for(const s of data.seasons.slice(0,40)){
  const match=seasonName(s?.seasonKey);if(!match)continue;
  const id=match[1],meta=s.metadata||null,seriesKey='series:'+id;
  const existing=series.get(id)||{kind:'series',key:seriesKey,
   title:meta?.title||'مسلسل رقم '+id,
   genre:meta?.genre||'unspecified',year:meta?.year||null,meta,
   seasons:0,episodeCount:0,verifiedCount:0,
   editKey:seriesKey,seasonKey:s.seasonKey,verified:false};
  existing.seasons++;
  existing.episodeCount+=Number(s.episodeCount)||0;
  existing.verifiedCount+=Number(s.verifiedCount)||0;
  if(meta){existing.meta=meta;existing.title=meta.title||existing.title;
   existing.genre=meta.genre||'unspecified';existing.year=meta.year||null;}
  series.set(id,existing);
  result.season.push({kind:'season',key:s.seasonKey,
   title:(meta?.title?meta.title+' · ':'')+s.seasonKey,
   genre:meta?.genre||'unspecified',year:meta?.year||null,meta,
   state:s.fullyVerifiedInQueue===true?'verified':
    Number(s.failedCount)>0?'failed':'queued',
   caption:num(s.verifiedCount)+' من '+num(s.episodeCount)+
    ' حلقة مدرجة متحقق منها',
   progress:Math.min(100,Math.max(0,Number(s.percent)||0)),
   editKey:seriesKey,seasonKey:s.seasonKey,verified:false});
 }
 for(const s of series.values()){
  s.caption=num(s.seasons)+' موسم ظاهر · '+num(s.verifiedCount)+
   ' / '+num(s.episodeCount)+' حلقة مدرجة';
  s.state=s.episodeCount>0&&s.verifiedCount===s.episodeCount?
   'verified':'queued';s.progress=null;
  result.series.push(s);
 }
 for(const e of data.episodes.slice(0,40)){
  const match=seasonName(e?.seasonKey);if(!match)continue;
  const meta=e.seriesMetadata||null;
  result.episode.push({kind:'episode',key:String(e.runId||''),
   title:'الحلقة '+num(e.episodeNumber)+' · '+String(e.title||'دون عنوان'),
   genre:meta?.genre||'unspecified',year:meta?.year||null,meta,
   state:e.verified===true?'verified':e.state||'unknown',
   caption:meta?.title?meta.title+' · '+e.seasonKey:e.seasonKey,
   progress:Math.min(100,Math.max(0,Number(e.percent)||0)),
   editKey:null,seasonKey:e.seasonKey,verified:e.verified===true});
 }
 return result;
}
function openEditor(item){
 if(!item.editKey||!validKey(item.editKey))return;
 document.dispatchEvent(new CustomEvent('blofy:edit-library-metadata',{
  detail:{key:item.editKey,metadata:item.meta||null}}));
}
function openSeason(item){
 if(!seasonName(item.seasonKey))return;
 document.dispatchEvent(new CustomEvent('blofy:open-season-report',{
  detail:{seasonKey:item.seasonKey}}));
}
function openDetail(item){
 if(!['movie','series','season','episode'].includes(item?.kind))return;
 document.dispatchEvent(new CustomEvent('blofy:open-library-detail',{
  detail:{item}
 }));
}
function makeCard(item){
 const card=el('article','cinema-card cinema-kind-'+item.kind);
 const cover=previewPoster(item.meta,item.title);
 const ribbon=el('span','cinema-type',typeLabel(item.kind));
 cover.append(ribbon);
 card.append(cover);
 const body=el('div','cinema-card-body');
 const title=el('h4','',item.title);
 body.append(title);
 const info=el('p','cinema-card-info',
  (item.year?item.year+' · ':'')+
  (genreNames[item.genre]&&item.genre!=='unspecified'?
   genreNames[item.genre]+' · ':'')+
  (stateNames[item.state]||'غير معروف'));
 body.append(info,el('p','cinema-card-caption',item.caption));
 if(item.progress!==null){
  const track=el('div','meter'),fill=el('div','fill');
  fill.style.width=item.progress+'%';track.append(fill);
  track.setAttribute('aria-label','نسبة تقدم النقل '+num(item.progress)+' بالمئة');
  body.append(track);
 }
 const actions=el('div','cinema-card-actions');
 const detail=el('button','cinema-details','تفاصيل العمل');
 detail.type='button';detail.addEventListener('click',()=>openDetail(item));
 actions.append(detail);
 if(item.seasonKey&&seasonName(item.seasonKey)){
  const see=el('button','cinema-see','تفاصيل الموسم');
  see.type='button';see.addEventListener('click',()=>openSeason(item));
  actions.append(see);
 }
 if(item.editKey&&validKey(item.editKey)){
  const edit=el('button','cinema-edit','تعديل البيانات');
  edit.type='button';edit.addEventListener('click',()=>openEditor(item));
  actions.append(edit);
 }
 if(!actions.childElementCount)actions.append(el('small','',
  'معلومات محفوظة فقط — لا يوجد تشغيل تلقائي'));
 body.append(actions);card.append(body);
 return card;
}
function featuredCard(item){
 const hero=el('article','cinema-featured');
 const copy=el('div','cinema-featured-copy');
 copy.append(el('span','cinema-feature-tag','من المحتوى المحفوظ · اختيار عرض بصري'),
  el('h4','',item.title));
 if(item.meta?.overview)copy.append(el('p','cinema-feature-description',
  String(item.meta.overview).slice(0,250)));
 copy.append(el('p','cinema-feature-info',
  typeLabel(item.kind)+' · '+
  (genreNames[item.genre]||'غير مصنّف')+' · '+
  (stateNames[item.state]||'غير محدد')));
 const actions=el('div','cinema-feature-actions');
 const detail=el('button','cinema-details','تفاصيل العمل');
 detail.type='button';detail.addEventListener('click',()=>openDetail(item));
 actions.append(detail);
 if(item.seasonKey&&seasonName(item.seasonKey)){
  const details=el('button','cinema-see','تفاصيل الموسم');
  details.type='button';details.addEventListener('click',()=>openSeason(item));
  actions.append(details);
 }
 if(item.editKey&&validKey(item.editKey)){
  const edit=el('button','cinema-edit','إدارة بيانات العرض');
  edit.type='button';edit.addEventListener('click',()=>openEditor(item));
  actions.append(edit);
 }
 copy.append(actions);hero.append(copy);
 const path=posterPath(item.meta?.posterPath);
 if(path&&item.meta?.artworkRightsConfirmed===true){
  const image=el('img','cinema-feature-art');
  image.src='https://image.tmdb.org/t/p/w500'+path;
  image.alt='صورة العمل '+item.title;
  image.loading='lazy';image.decoding='async';
  image.referrerPolicy='no-referrer';
  image.addEventListener('error',()=>image.remove(),{once:true});
  hero.append(image);
 }
 return hero;
}

function genreToolbar(all){
 const labels=[...new Set(Object.values(all).flat().map(x=>x.genre)
  .filter(x=>x&&x!=='unspecified'&&genreNames[x]))].slice(0,14);
 if(genre!=='all'&&!labels.includes(genre))genre='all';
 const bar=$('cinemaGenreToolbar');
 const choices=['all',...labels];
 bar.replaceChildren(...choices.map(k=>{
  const button=el('button','cinema-genre-chip',
   k==='all'?'جميع التصنيفات':genreNames[k]);
  button.type='button';button.setAttribute('aria-pressed',String(genre===k));
  button.addEventListener('click',()=>{genre=k;render()});
  return button;
 }));
 bar.hidden=labels.length===0;
}
function render(){
 if(!current)return;
 const all=collect(current);
 genreToolbar(all);
 const names={movie:'أفلام خاصة محفوظة',series:'المسلسلات الظاهرة',
  season:'المواسم',episode:'الحلقات'};
 const kinds=currentKind==='all'?
  ['movie','series','season','episode']:[currentKind];
 const containers=[];
 // Feature an already owner-curated image only: never manufacture a cover,
 // recommendation score, or verified playback claim from source metadata.
 const eligible=[...all.movie,...all.series].filter(x=>
  x.meta?.artworkRightsConfirmed===true&&posterPath(x.meta.posterPath)&&
  typeof x.meta.title==='string'&&x.meta.title.trim()&&
  (genre==='all'||genre===x.genre));
 const featured=eligible.find(x=>x.kind==='movie'&&x.state==='verified')||
  eligible[0]||null;
 if(featured&&['all','movie','series'].includes(currentKind))
  containers.push(featuredCard(featured));
 for(const kind of kinds){
  if(!all[kind])continue;
  const rows=all[kind].filter(x=>genre==='all'||x.genre===genre);
  const section=el('section','cinema-rail');
  const head=el('div','cinema-rail-head');
  head.append(el('h4','',names[kind]||kind),
   el('span','cinema-rail-count',num(rows.length)+' عنصر من الصفحة'));
  section.append(head);
  const track=el('div','cinema-track');
  track.setAttribute('role','list');
  track.setAttribute('aria-label',names[kind]);
  for(const item of rows.slice(0,40)){
   const card=makeCard(item);card.setAttribute('role','listitem');
   track.append(card);
  }
  if(!rows.length)track.append(el('p','cinema-empty',
   'لا توجد عناصر مطابقة في هذه الصفحة والتصنيف.'));
  section.append(track);containers.push(section);
 }
 $('libraryCinema').replaceChildren(...containers);
 const some=Object.values(all).reduce((sum,a)=>sum+a.length,0);
 $('cinemaScope').textContent=
  'عرض مرئي لصفحة البحث '+num(current.page||1)+
  ' فقط: '+num(some)+' إدراج (قد يظهر المسلسل مع مواسمه وحلقاته أكثر من مرة). '+
  'الأفلام من أحدث عينة للنسخ الخاصة، والمواسم من السجلات المحفوظة؛ لا يشمل هذا كتالوج المصدر كاملاً. '+
  'الملصقات تظهر فقط عند حفظها مع تأكيد حقوقها. لا يوجد تشغيل أو نقل تلقائي.';
}
function setMode(next){
 mode=next==='details'?'details':'cinema';
 const cinema=mode==='cinema';
 $('cinemaGridButton').setAttribute('aria-pressed',String(cinema));
 $('cinemaDetailsButton').setAttribute('aria-pressed',String(!cinema));
 $('libraryCinema').hidden=!cinema;
 $('libraryResults').hidden=cinema;
 $('cinemaGenreToolbar').hidden=!cinema;
 if(cinema&&current)render();
}
$('cinemaGridButton').addEventListener('click',()=>setMode('cinema'));
$('cinemaDetailsButton').addEventListener('click',()=>setMode('details'));
document.addEventListener('blofy:library-page-ready',event=>{
 const data=event?.detail?.data;
 if(!data||data.readOnly!==true||data.ok!==true)return;
 current=data;
 currentKind=['all','movie','series','season','episode'].includes(
  event.detail.kind)?event.detail.kind:'all';
 if(mode==='cinema')render();
});
setMode('cinema');
})();
