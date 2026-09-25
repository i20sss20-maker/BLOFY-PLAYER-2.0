(function(){
  'use strict';
  var root=document.getElementById('admin-live-service');
  var text=document.getElementById('admin-live-service-text');
  if(!root||!text)return;
  var timer=null;
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
    render(null,'جارٍ التحقق…');
    fetch('/health',{cache:'no-store',headers:{accept:'application/json'}})
      .then(function(response){if(!response.ok)throw new Error('health_'+response.status);return response.json();})
      .then(function(payload){
        var healthy=payload&&payload.ok===true&&payload.database==='ready'&&payload.playlistEncryption==='ready';
        var app=(payload.release&&payload.release.app)||{};
        var version=app.versionName?(' • '+app.versionName):'';
        render(healthy,healthy?('متصل'+version):'خلل في خدمة أساسية');
      })
      .catch(function(){render(false,'تعذر الوصول للخدمة');})
      .finally(schedule);
  }
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')check();});
  check();
})();
