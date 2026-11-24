/* BLOFY STREAM Web: private, explicit local-profile export/import.
 * No activation codes, cookie, token, device key, source URL, poster URL,
 * search queries, or live media bytes enter a backup. No network requests.
 * ES5 for older VIDAA browser engines; CommonJS export for offline QA.
 */
(function(root){
 'use strict';
 var FORMAT='blofy-stream-web-portable-profile',VERSION=1,MAX_BYTES=240000;
 var ID=/^(live|movie|series):([1-9][0-9]{0,14})$/;
 var EXT=/^(mp4|mkv|avi|mov|ts)$/;
 var SUPPORTED=['format','version','createdAt','favorites','watch'];
 function fail(code){throw new Error('profile_'+code)}
 function own(obj,key){return Object.prototype.hasOwnProperty.call(obj,key)}
 function validKey(key,watchOnly){
  var m=ID.exec(String(key||''));
  return m&&(!watchOnly||m[1]!=='live')?m:null
 }
 function safeText(input,size){
  if(typeof input!=='string')return '';
  var s=input.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,size);
  // A title is display-only; never serialize a copied M3U/Xtream URL or a
  // bearer credential into a file that a customer might share.
  if(/:\/\/|bearer\s+v1\.|password\s*[:=]|username\s*[:=]|api_key\s*[:=]/i.test(s))
   return '';
  return s
 }
 function safeExt(raw,kind){
  var s=String(raw||'').toLowerCase().replace(/^\./,'');
  return kind==='live'?'ts':EXT.test(s)?s:'mp4'
 }
 function safeInt(raw,max){
  var n=Number(raw);
  return Number.isSafeInteger?Number.isSafeInteger(n)&&n>=0&&n<=max?n:null:
   isFinite(n)&&Math.floor(n)===n&&n>=0&&n<=max?n:null
 }
 function toFavorite(key,item){
  var k=validKey(key,false);
  if(!k)return null;
  var obj=item&&typeof item==='object'&&!Array.isArray(item)?item:{};
  return {key:key,name:safeText(obj.name||'',140),ext:safeExt(obj.container_extension||obj.ext,k[1])}
 }
 function toWatch(key,item,now){
  var k=validKey(key,true);
  if(!k||!item||typeof item!=='object'||Array.isArray(item))return null;
  var position=safeInt(item.position,21600),duration=safeInt(item.duration,21600);
  if(position===null||duration===null||duration>0&&position>=duration)return null;
  var updated=safeInt(item.updated,now+86400000);
  if(updated===null)updated=0;
  return {key:key,position:position,duration:duration,updated:updated,
   name:safeText(item.name||'',140),ext:safeExt(item.ext,k[1]),
   seriesId:/^[1-9][0-9]{0,14}$/.test(String(item.seriesId||''))?
    String(item.seriesId):''}
 }
 function create(favorites,watch,favoriteItems,now){
  now=safeInt(now,9000000000000);
  if(now===null)now=Date.now();
  var f=[],w=[],keys=Object.keys(favorites||{}),seen=Object.create(null),i,k,e;
  for(i=0;i<keys.length&&f.length<300;i++){
   k=keys[i];
   if(favorites[k]!==true||seen[k])continue;
   e=toFavorite(k,favoriteItems&&favoriteItems[k]);
   if(e){f.push(e);seen[k]=true}
  }
  keys=Object.keys(watch||{}).sort(function(a,b){
   return Number((watch[b]||{}).updated)||0-(Number((watch[a]||{}).updated)||0)
  });
  seen=Object.create(null);
  for(i=0;i<keys.length&&w.length<160;i++){
   k=keys[i];if(seen[k])continue;
   e=toWatch(k,watch[k],now);
   if(e){w.push(e);seen[k]=true}
  }
  var data={format:FORMAT,version:VERSION,createdAt:now,favorites:f,watch:w};
  var text=JSON.stringify(data);
  if(text.length>MAX_BYTES)fail('too_large');
  return text
 }
 function parse(raw,now){
  if(typeof raw!=='string'||raw.length<30||raw.length>MAX_BYTES)fail('invalid_size');
  var obj;
  try{obj=JSON.parse(raw)}catch(e){fail('invalid_json')}
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
   obj.format!==FORMAT||obj.version!==VERSION||
   !Array.isArray(obj.favorites)||!Array.isArray(obj.watch)||
   obj.favorites.length>300||obj.watch.length>160)fail('invalid_format');
  var fields=Object.keys(obj);
  for(var f=0;f<fields.length;f++)if(SUPPORTED.indexOf(fields[f])<0)fail('unexpected_field');
  var fSeen=Object.create(null),wSeen=Object.create(null),favorites=[],watch=[];
  now=safeInt(now,9000000000000);if(now===null)now=Date.now();
  for(var i=0;i<obj.favorites.length;i++){
   var item=obj.favorites[i];
   if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.key!=='string')
    fail('invalid_favorite');
   var fav=toFavorite(item.key,{name:item.name,ext:item.ext});
   if(!fav||fSeen[fav.key]||item.key.length>32)fail('invalid_favorite');
   favorites.push(fav);fSeen[fav.key]=true
  }
  for(var j=0;j<obj.watch.length;j++){
   var row=obj.watch[j];
   if(!row||typeof row!=='object'||Array.isArray(row)||typeof row.key!=='string')
    fail('invalid_watch');
   var w=toWatch(row.key,row,now);
   if(!w||wSeen[w.key]||row.key.length>32)fail('invalid_watch');
   watch.push(w);wSeen[w.key]=true
  }
  return {favorites:favorites,watch:watch}
 }
 function merge(favorites,watch,favoriteItems,imported){
  var f=Object.assign({},favorites||{}),
   w=Object.assign({},watch||{}),
   items=Object.assign({},favoriteItems||{}),
   stats={newFavorites:0,newCheckpoints:0,updatedCheckpoints:0,preservedCheckpoints:0};
  var favoriteList=imported.favorites||[],watchList=imported.watch||[];
  for(var i=0;i<favoriteList.length;i++){
   var entry=favoriteList[i],parts=validKey(entry.key,false);
   if(!parts)continue;
   if(f[entry.key]!==true){f[entry.key]=true;stats.newFavorites++}
   if(!own(items,entry.key)){
    var meta={id:parts[2],name:entry.name||'محتوى محفوظ',
     container_extension:safeExt(entry.ext,parts[1]),stream_icon:''};
    if(parts[1]==='series')meta.series_id=parts[2];
    else meta.stream_id=parts[2];
    items[entry.key]=meta
   }
  }
  for(var j=0;j<watchList.length;j++){
   var row=watchList[j],old=w[row.key];
   var oldTime=old&&safeInt(old.updated,9000000000000)||0;
   if(old&&row.updated<=oldTime){stats.preservedCheckpoints++;continue}
   w[row.key]={position:row.position,duration:row.duration,
    updated:row.updated,name:row.name,ext:row.ext,art:'',seriesId:row.seriesId};
   if(old)stats.updatedCheckpoints++;else stats.newCheckpoints++
  }
  return {favorites:f,watch:w,favoriteItems:items,stats:stats}
 }
 var api={create:create,parse:parse,merge:merge};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BlofyProfileTransfer=api
})(typeof window!=='undefined'?window:null);
