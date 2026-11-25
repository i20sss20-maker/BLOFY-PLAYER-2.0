/* STREAM Web 20-minute local real-playback acceptance, ES5 / no media requests.
 * A passing report proves only video continuity observations in THIS browser:
 * it cannot validate pitch, true source resolution, licensing or TV models.
 * No stream IDs, tokens, urls or credentials are kept here.
 */
(function(root){
 'use strict';
 var TARGET_MS=1200000,STALL_MS=16000,MAX_SAMPLE_GAP=10000;
 var REASONS={
  paused:'توقف الفيديو أثناء الفحص',
  hidden:'أصبحت الصفحة في الخلفية ولم يعد الفحص متواصلًا',
  playback_error:'ظهر خطأ في تشغيل الفيديو',
  media_rewind:'عاد توقيت البث إلى الخلف أثناء الفحص',
  clock_regressed:'تراجع توقيت مؤقت الفحص',
  playback_restarted:'أعيد تشغيل المشغل خلال الفحص',
  video_stalled:'توقفت حركة صورة الفيديو',
  long_gap:'توقف مؤقت الفحص أو دخل الجهاز وضع السكون',
  buffering:'تجاوز انتظار التخزين 30 ثانية',
  stopped:'خرجت من القناة قبل اكتمال الفحص',
  inconclusive:'الجهاز لم يقدّم قياس إطارات موثوقًا؛ لا يمكن إثبات استمرار الصورة',
  success:'استمر عرض إطارات الفيديو لمدة 20 دقيقة دون انقطاع مكتشف'
 };
 function number(n,def){
  if(n===null||n===undefined||n==='')return def;
  n=Number(n);
  return isFinite(n)&&n>=0?n:def
 }
 function init(kind,at,first){
  var now=number(at,0),snapshot=first||{};
  if(kind!=='live'&&kind!=='movie'&&kind!=='series')throw Error('invalid_kind');
  if(!snapshot.playing||snapshot.hidden||!snapshot.width||!snapshot.height)
   throw Error('player_not_ready');
  return {
   kind:kind,startedAt:now,lastTickAt:now,lastMotionAt:now,
   initialFrames:number(snapshot.frames,null),initialPresented:number(snapshot.presented,null),
   lastFrames:number(snapshot.frames,null),lastPresented:number(snapshot.presented,null),
   lastTime:number(snapshot.time,null),hasFrameProof:false,hasTimeProof:false,
   baselineErrors:number(snapshot.errors,0),baselineRecoveries:number(snapshot.recoveries,0),
   baselineBufferMs:number(snapshot.bufferMs,0),bufferMs:0,observations:0,finished:false,
   result:null
  }
 }
 function summary(state,status,reason,at){
  var now=number(at,state.lastTickAt),length=Math.max(0,Math.min(86400000,now-state.startedAt));
  state.finished=true;
  state.result={
   kind:state.kind,status:status,reason:reason,
   elapsedSeconds:Math.round(length/1000),videoFramesObserved:state.hasFrameProof,
   timeProgressObserved:state.hasTimeProof,
   bufferingSeconds:Math.round(state.bufferMs/1000),
   samples:state.observations
  };
  return state.result
 }
 function tick(state,snapshot){
  if(!state||state.finished)return state&&state.result||null;
  snapshot=snapshot||{};
  var at=number(snapshot.at,state.lastTickAt);
  if(at<state.lastTickAt)return summary(state,'inconclusive','clock_regressed',state.lastTickAt);
  var since=at-state.lastTickAt;
  if(since>MAX_SAMPLE_GAP)return summary(state,'failed','long_gap',at);
  state.lastTickAt=at;state.observations++;
  if(snapshot.hidden)return summary(state,'failed','hidden',at);
  if(!snapshot.playing)return summary(state,'failed','paused',at);
  if(number(snapshot.errors,0)>state.baselineErrors)
   return summary(state,'failed','playback_error',at);
  if(number(snapshot.recoveries,0)>state.baselineRecoveries)
   return summary(state,'failed','playback_restarted',at);
  state.bufferMs=Math.max(0,number(snapshot.bufferMs,0)-state.baselineBufferMs);
  if(state.bufferMs>30000)return summary(state,'failed','buffering',at);
  var frames=number(snapshot.frames,null),presented=number(snapshot.presented,null),
   currentTime=number(snapshot.time,null);
  // Live media time must not regress by more than ordinary sample jitter.
  // This detects decoder timeline resets, not upstream replay with new PTS.
  if(state.kind==='live'&&currentTime!==null&&state.lastTime!==null&&currentTime<state.lastTime-1)
   return summary(state,'failed','media_rewind',at);
  var pixelProof=false,timeProof=false;
  if(frames!==null&&state.lastFrames!==null&&frames>state.lastFrames)pixelProof=true;
  if(presented!==null&&state.lastPresented!==null&&presented>state.lastPresented)pixelProof=true;
  if(pixelProof&&number(snapshot.width,0)>0&&number(snapshot.height,0)>0){
   state.hasFrameProof=true;state.lastMotionAt=at
  }
  if(currentTime!==null&&state.lastTime!==null&&currentTime>state.lastTime+.05){
   timeProof=true;state.hasTimeProof=true;
   if(!state.hasFrameProof)state.lastMotionAt=at
  }
  if(frames!==null)state.lastFrames=frames;
  if(presented!==null)state.lastPresented=presented;
  if(currentTime!==null)state.lastTime=currentTime;
  // Time-only clocks are NOT proof of decoded images. Once frame counters
  // are available, a rising audio clock must not conceal a frozen picture.
  if(at-state.lastMotionAt>=STALL_MS)return summary(state,'failed','video_stalled',at);
  if(at-state.startedAt>=TARGET_MS)
   return summary(state,state.hasFrameProof&&state.hasTimeProof?'passed':'inconclusive',
    state.hasFrameProof&&state.hasTimeProof?'success':'inconclusive',at);
  return null
 }
 function stop(state,at){
  if(!state||state.finished)return state&&state.result||null;
  return summary(state,'failed','stopped',at)
 }
 function message(result){
  if(!result)return '';
  return (result.status==='passed'?'✓ اجتاز فحص الصورة (الصوت يحتاج استماع)':result.status==='failed'?'✕ لم يجتز الفحص':
   '⚠ الفحص غير حاسم')+' • '+(REASONS[result.reason]||'لا يتوفر سبب محدد')+
   ' • المدة '+Math.floor(result.elapsedSeconds/60)+' دقيقة و'+result.elapsedSeconds%60+
   ' ثانية • الانتظار '+result.bufferingSeconds+' ثانية';
 }
 var api={init:init,tick:tick,stop:stop,message:message,targetMs:TARGET_MS};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BlofyPlaybackAcceptance=api
})(typeof window!=='undefined'?window:null);
