(function(){
  'use strict';
  var root=document.getElementById('admin-live-service');
  var text=document.getElementById('admin-live-service-text');
  if(!root||!text)return;
  var timer=null;
  var inFlight=false;
  var lastHealthy=null;
  function render(ok,label){
    root.classList.toggle('ok',ok===true);
    root.classList.toggle('bad',ok===false);
    text.textContent=label;
  }
  function schedule(){
    clearTimeout(timer);
    timer=setTimeout(check,60000);
  }
  function check(){
    if(inFlight)return;
    inFlight=true;
    if(lastHealthy===null)render(null,'جارٍ التحقق…');
    var started=performance.now();
    fetch('/health',{cache:'no-store',headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)})
      .then(function(response){if(!response.ok)throw new Error('health_'+response.status);return response.json();})
      .then(function(payload){
        var healthy=payload&&payload.ok===true&&payload.database==='ready'&&payload.playlistEncryption==='ready';
        var app=(payload.release&&payload.release.app)||{};
        var version=app.versionName?(' • '+app.versionName):'';
        lastHealthy=healthy;
        var latency=Math.round(performance.now()-started);
        render(healthy,healthy?('متصل'+version+' • '+latency+'ms'):'خلل في خدمة أساسية');
      })
      .catch(function(){lastHealthy=false;render(false,'تعذر الوصول للخدمة أو انتهت المهلة');})
      .finally(function(){inFlight=false;schedule();});
  }
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')check();});
  check();
})();
