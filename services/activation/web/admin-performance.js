(function(){'use strict';
var output=document.getElementById('blofy-performance-results');
var button=document.getElementById('blofy-performance-refresh');
if(!output)return;
function metric(label,value){var item=document.createElement('span');item.className='blofy-performance-metric';var name=document.createElement('small');name.textContent=label;var strong=document.createElement('strong');strong.textContent=value;item.appendChild(name);item.appendChild(strong);return item;}
function render(){output.replaceChildren();var nav=performance.getEntriesByType('navigation')[0];if(nav){output.appendChild(metric('تحميل الصفحة',Math.round(nav.loadEventEnd||performance.now())+' ms'));output.appendChild(metric('استجابة السيرفر',Math.round(nav.responseStart-nav.requestStart)+' ms'));output.appendChild(metric('جاهزية DOM',Math.round(nav.domContentLoadedEventEnd)+' ms'));}else{output.appendChild(metric('التحميل','غير متاح في هذا المتصفح'));}
var resources=performance.getEntriesByType('resource');output.appendChild(metric('ملفات تم تحميلها',String(resources.length)));if(navigator.connection&&navigator.connection.effectiveType)output.appendChild(metric('نوع الشبكة',navigator.connection.effectiveType));}
if(button)button.addEventListener('click',render);
if(document.readyState==='complete')render();else window.addEventListener('load',render,{once:true});
})();