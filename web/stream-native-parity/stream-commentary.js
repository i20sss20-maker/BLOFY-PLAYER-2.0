/* BLOFY STREAM web commentary sidecar for LIVE only.
 * The authenticated catalogue exposes track IDs/labels, never provider URLs.
 * Only one companion audio element exists at a time; original video audio is
 * restored on source error, a channel switch, logout, pause or teardown.
 */
(function(global){
 'use strict';
 function create(video,channelId,notify){
  var audio=null,activeId='',tracks=[],generation=0,disposed=false,
    savedMuted=!!video.muted,savedVolume=video.volume,delayTimer=null;
  function say(msg){if(typeof notify==='function')notify(msg)}
  function clearDelay(){if(delayTimer){clearTimeout(delayTimer);delayTimer=null}}
  function restore(){video.muted=savedMuted;video.volume=savedVolume}
  function stop(){
   generation++;clearDelay();
   if(audio){var a=audio;audio=null;a.onplaying=null;a.onerror=null;a.onended=null;
    try{a.pause();a.removeAttribute('src');a.load()}catch(e){}}
   activeId='';restore()
  }
  function validTrack(id){return tracks.find(function(x){return x.id===id})||null}
  function select(id){
   if(disposed)return false;
   if(id==='original'){stop();say('الصوت الأصلي للقناة');return true}
   var track=validTrack(id);if(!track){say('الصوتية غير متاحة للقناة الحالية');return false}
   if(track.format==='hls'){say('هذه الصوتية تحتاج تشغيل HLS مخصصًا للويب ولم تُفعّل بعد');return false}
   stop();var epoch=generation;
   savedMuted=video.muted;savedVolume=video.volume;
   var next=new Audio();next.preload='none';next.autoplay=false;next.controls=false;
   next.onplaying=function(){if(disposed||epoch!==generation)return;
    video.muted=true;activeId=id;say('المعلق: '+track.label)};
   next.onerror=next.onended=function(){if(epoch===generation){stop();say('تعذر تشغيل المعلق؛ رجع صوت القناة الأصلي')}};
   next.src='/api/audio/track/'+encodeURIComponent(id)+'?channel='+encodeURIComponent(channelId);
   audio=next;
   var delay=Math.max(0,Math.min(15000,(Number(track.delaySeconds)||0)*1000));
   function start(){if(disposed||epoch!==generation||audio!==next)return;
    var play=next.play();if(play&&play.catch)play.catch(function(){if(epoch===generation){stop();say('اضغط خيار المعلق مرة أخرى لتفعيل الصوت')}})}
   if(delay){say('جار مزامنة صوت المعلق…');delayTimer=setTimeout(function(){delayTimer=null;start()},delay)}
   else start();
   return true
  }
  function load(){
   if(disposed)return Promise.resolve([]);
   var epoch=++generation;
   return fetch('/api/audio/catalog?channel='+encodeURIComponent(channelId),{
     credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
    }).then(function(res){if(!res.ok)throw Error('catalog_unavailable');return res.json()})
     .then(function(data){
      if(disposed||epoch!==generation)return [];
      tracks=Array.isArray(data.tracks)?data.tracks.filter(function(t){
       return t&&/^[A-Za-z0-9_-]{1,64}$/.test(t.id)&&typeof t.label==='string'&&t.label.length<=80
      }).slice(0,60):[];
      return tracks.slice()
     }).catch(function(){if(epoch===generation&&!disposed)say('الصوتيات غير متاحة حاليًا؛ صوت القناة الأصلي مستمر');return []})
  }
  function onVideoPause(){if(audio&&!video.ended){try{audio.pause()}catch(e){}}}
  function onVideoPlay(){if(audio&&activeId){var play=audio.play();if(play&&play.catch)play.catch(function(){})}}
  video.addEventListener('pause',onVideoPause);video.addEventListener('play',onVideoPlay);
  return {load:load,select:select,stop:stop,current:function(){return activeId},
   destroy:function(){disposed=true;stop();video.removeEventListener('pause',onVideoPause);
    video.removeEventListener('play',onVideoPlay)}}
 }
 global.BlofyCommentary={create:create};
})(window);
