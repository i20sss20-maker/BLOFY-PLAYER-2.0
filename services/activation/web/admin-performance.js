(function(){'use strict';
var output=document.getElementById('blofy-performance-results');
var button=document.getElementById('blofy-performance-refresh');
if(!output)return;
function metric(label,value){var item=document.createElement('span');item.className='blofy-performance-metric';var name=document.createElement('small');name.textContent=label;var strong=document.createElement('strong');strong.textContent=value;item.appendChild(name);item.appendChild(strong);return item;}
function render(){output.replaceChildren();var nav=performance.getEntriesByType('navigation')[0];if(nav){output.appendChild(metric('تحميل الصفحة',Math.round(Math.max(0,nav.loadEventEnd-nav.startTime))+' ms'));output.appendChild(metric('استجابة السيرفر',Math.round(Math.max(0,nav.responseStart-nav.requestStart))+' ms'));output.appendChild(metric('جاهزية DOM',Math.round(Math.max(0,nav.domContentLoadedEventEnd-nav.startTime))+' ms'));}else{output.appendChild(metric('التحميل','غير متاح في هذا المتصفح'));}
var resources=performance.getEntriesByType('resource');output.appendChild(metric('ملفات تم تحميلها',String(resources.length)));if(navigator.connection&&navigator.connection.effectiveType)output.appendChild(metric('نوع الشبكة',navigator.connection.effectiveType));}
var exportButton=document.getElementById('blofy-diagnostics-export');
if(exportButton)exportButton.addEventListener('click',function(){
 var nav=performance.getEntriesByType('navigation')[0];
 var health=document.getElementById('admin-live-service');
 var report={product:'BLOFY PLAYER',reportType:'browser-diagnostics',generatedAt:new Date().toISOString(),
 browser:{userAgent:navigator.userAgent,language:navigator.language,online:navigator.onLine},
 navigation:nav?{loadMs:Math.round(Math.max(0,nav.loadEventEnd-nav.startTime)),responseMs:Math.round(Math.max(0,nav.responseStart-nav.requestStart)),domReadyMs:Math.round(Math.max(0,nav.domContentLoadedEventEnd-nav.startTime))}:null,
 resourceCount:performance.getEntriesByType('resource').length,
 serviceHealth:health?{consecutiveFailures:Number(health.dataset.healthFailures||0),lastCheck:health.dataset.healthLastCheck||null,recentChecks:health.dataset.healthHistory||'',latencyMs:Number(health.dataset.healthLatency)||null}:null};
 var blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
 var url=URL.createObjectURL(blob);var link=document.createElement('a');
 link.href=url;link.download='blofy-diagnostics.json';document.body.appendChild(link);link.click();link.remove();
 setTimeout(function(){URL.revokeObjectURL(url);},1000);
});
if(button)button.addEventListener('click',render);
if(document.readyState==='complete')render();else window.addEventListener('load',render,{once:true});
})();