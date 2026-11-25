/* BLOFY STREAM web commentary sidecar for LIVE only.
 * The authenticated catalogue exposes track IDs/labels, never provider URLs.
 * Only one companion audio element exists at a time; original video audio is
 * restored on source error, a channel switch, logout, pause or teardown.
 */
(function(global){
 'use strict';
 function create(video,channelId,notify){
  var audio=null,activeId='',tracks=[],generation=0,disposed=false,
    savedMuted=!!video.muted,savedVolume=video.volume,delayTimer=null,stallTimer=null,catalogEpoch=0,lastFailure='';
  function say(msg){if(typeof notify==='function')notify(msg)}
  function clearDelay(){if(delayTimer){clearTimeout(delayTimer);delayTimer=null}}
  function clearStall(){if(stallTimer){clearTimeout(stallTimer);stallTimer=null}}
  function restore(){video.muted=savedMuted;video.volume=savedVolume}
  function stop(){
   generation++;catalogEpoch++;clearDelay();clearStall();
   if(audio){var a=audio;audio=null;a.onplaying=null;a.onerror=null;a.onended=null;a.onwaiting=null;a.onstalled=null;a.ontimeupdate=null;
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
    clearStall();
    video.muted=true;activeId=id;say('المعلق: '+track.label)};
   next.onerror=next.onended=function(){if(epoch===generation){stop();say('تعذر تشغيل المعلق؛ رجع صوت القناة الأصلي')}};
   next.ontimeupdate=function(){if(epoch===generation)clearStall()};
   next.onwaiting=next.onstalled=function(){
    if(epoch!==generation||!activeId||stallTimer)return;
    stallTimer=setTimeout(function(){stallTimer=null;
     if(epoch===generation&&audio===next){stop();say('انقطع صوت المعلق؛ عاد صوت القناة الأصلي')}} ,7000)
   };
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
   // Catalogue fetches must not alter the playing companion's generation.
   // Otherwise reopening the options silently disables onplaying/onerror
   // handlers and can leave the original channel audio muted on failure.
   var epoch=++catalogEpoch;
   lastFailure='';
   return fetch('/api/audio/catalog?channel='+encodeURIComponent(channelId),{
     credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}
    }).then(function(res){
      if(!res.ok){
       if(res.status===401||res.status===403)throw Error('unauthorized');
       if(res.status===429)throw Error('busy');
       if(res.status===503)return res.json().catch(function(){return {}}).then(function(body){
        throw Error(body.error==='commentary_not_enabled'?'not_enabled':'source_unavailable')
       });
       throw Error('unavailable')
      }
      return res.json()
     })
     .then(function(data){
      if(disposed||epoch!==catalogEpoch)return [];
      tracks=Array.isArray(data.tracks)?data.tracks.filter(function(t){
       return t&&/^[A-Za-z0-9_-]{1,64}$/.test(t.id)&&typeof t.label==='string'&&t.label.length<=80
      }).slice(0,60):[];
      return tracks.slice()
     }).catch(function(err){if(epoch===catalogEpoch&&!disposed){
       lastFailure=err&&['unauthorized','busy','not_enabled','source_unavailable'].indexOf(err.message)>=0?err.message:'unavailable';
       say(lastFailure==='not_enabled'?'المعلقون الخارجيون غير مفعّلين من السيرفر؛ صوت القناة الأصلي يعمل.':
        lastFailure==='unauthorized'?'تحقق من تفعيل اشتراكك للوصول للمعلقين.':
        lastFailure==='source_unavailable'?'مصدر المعلقين الخارجيين غير متاح حاليًا؛ صوت القناة الأصلي يعمل.':
        'تعذر قراءة المعلقين؛ صوت القناة الأصلي مستمر.')
      }return []})
  }
  function onVideoPause(){if(audio&&!video.ended){try{audio.pause()}catch(e){}}}
  function onVideoPlay(){if(audio&&activeId){var play=audio.play();if(play&&play.catch)play.catch(function(){})}}
  video.addEventListener('pause',onVideoPause);video.addEventListener('play',onVideoPlay);
  return {load:load,select:select,stop:stop,failure:function(){return lastFailure},current:function(){return activeId},
   currentLabel:function(){var item=validTrack(activeId);return item?item.label:''},
   destroy:function(){disposed=true;stop();video.removeEventListener('pause',onVideoPause);
    video.removeEventListener('play',onVideoPlay)}}
 }
 global.BlofyCommentary={create:create};
})(window);
