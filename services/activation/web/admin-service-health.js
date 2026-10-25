(function(){
  'use strict';
  var root=document.getElementById('admin-live-service');
  var text=document.getElementById('admin-live-service-text');
  if(!root||!text)return;
  var timer=null;
  var inFlight=false;
  var lastHealthy=null;
  var failures=0;
  var history=[];
  var originalTitle=document.title;
  var warningShown=false;
  var errorSince=null;
  var detail=document.createElement('small');
  detail.setAttribute('aria-live','off');
  detail.style.cssText='display:block;opacity:.75;margin-top:3px';
  text.parentNode.appendChild(detail);
  function record(ok,latency){
    failures=ok?0:failures+1;
    if(ok)errorSince=null;
    else if(errorSince===null)errorSince=Date.now();
    history.push({ok:ok,latency:latency});
    if(history.length>10)history.shift();
    var success=history.filter(function(x){return x.ok;}).length;
    detail.textContent='آخر 10 فحوصات: '+success+'/'+history.length+' ناجحة'+(failures>=2?' • تنبيه: '+failures+' إخفاقات متتالية':'');
    root.dataset.healthFailures=String(failures);
    root.dataset.healthLastCheck=new Date().toISOString();
    root.title='آخر فحص: '+new Date().toLocaleString('en-US')+(latency!=null?' • '+latency+'ms':'');
    if(failures>=2){
      document.title='⚠ خلل في خدمة BLOFY | '+originalTitle;
      root.setAttribute('aria-label','تنبيه: تعذر التحقق من خدمة BLOFY مرتين متتاليتين');
      if(!warningShown){warningShown=true;root.setAttribute('data-health-warning','true');}
    }else if(ok){
      document.title=originalTitle;
      root.removeAttribute('aria-label');
      root.removeAttribute('data-health-warning');
      warningShown=false;
    }
  }
  function render(ok,label){
    root.classList.toggle('ok',ok===true);
    root.classList.toggle('bad',ok===false);
    text.textContent=label;
  }
  function schedule(){
    clearTimeout(timer);
    if(!document.hidden)timer=setTimeout(check,60000);
  }
  function check(){
    if(document.hidden||inFlight)return;
    inFlight=true;
    if(lastHealthy===null)render(null,'جارٍ التحقق…');
    var started=performance.now();
    var controller=new AbortController();
    var timeout=setTimeout(function(){controller.abort();},10000);
    fetch('/health',{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json'},signal:controller.signal})
      .then(function(response){if(!response.ok)throw new Error('health_'+response.status);return response.json();})
      .then(function(payload){
        var healthy=payload&&payload.ok===true&&payload.database==='ready'&&payload.playlistEncryption==='ready';
        var app=(payload.release&&payload.release.app)||{};
        var version=app.versionName?(' • '+app.versionName):'';
        lastHealthy=healthy;
        var latency=Math.round(performance.now()-started);
        record(healthy,latency);
        render(healthy,healthy?('متصل'+version+' • '+latency+'ms'):'خلل في خدمة أساسية');
      })
      .catch(function(){lastHealthy=false;record(false,null);render(false,'تعذر الوصول للخدمة أو انتهت المهلة');})
      .finally(function(){clearTimeout(timeout);inFlight=false;schedule();});
  }
  root.setAttribute('role','button');
  root.setAttribute('tabindex','0');
  root.setAttribute('title','اضغط لتحديث حالة الخدمة');
  root.addEventListener('click',function(){check();});
  root.addEventListener('keydown',function(event){
    if(event.key==='Enter'||event.key===' '){event.preventDefault();check();}
  });
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)clearTimeout(timer);
    else check();
  });
  check();
})();
