/* BLOFY ONE · measured STREAM capacity, not a load-test or subscriber census.
 * Read-only cross-service snapshots from authenticated same-origin operator proxy.
 * No provider media fetch, customer identification or changes to quotas.
 */
(() => {
  'use strict';
  const root=document.getElementById('one-capacity');
  if(!root)return;
  const $=id=>document.getElementById('one-capacity-'+id);
  const count=v=>Number.isSafeInteger(v)&&v>=0?new Intl.NumberFormat('en-US').format(v):'—';
  const alertNames={
    feed_near_capacity:'قناة تقترب من حد المشاهدين الداخلي',
    feed_media_stalled:'توقف تدفق بيانات الفيديو',
    provider_failures_increased:'ارتفاع أخطاء مزوّد البث',
    capacity_rejections_increased:'رفض طلبات بسبب الحد الداخلي',
    reconnects_increased:'زيادة إعادة الاتصال بالمصدر',
    slow_viewer_disconnects_increased:'مشاهدون بطيئو الاتصال انقطعوا',
    operator_hls_probe_failed:'فشل فحص مسار HLS الإداري'
  };
  const source=[
    ['/operator/api/smart-ops','الأداء'],
    ['/operator/api/security','الحماية'],
    ['/operator/api/playback-health','المشغل']
  ];
  let busy=false,seq=0,lastSuccess=0,interval=null;
  function mark(id,v){const el=$(id);if(el)el.textContent=v;}
  function indicator(label,state){
    const el=$('indicator');el.textContent=label;el.dataset.state=state;
  }
  function clear(reason){
    for(const id of ['viewers','feeds','feed-limit','tickets','capacity-rejected',
      'provider-failures','reconnects','samples'])mark(id,'—');
    $('alerts').replaceChildren();
    mark('status',reason);
    indicator('غير مؤكّد','unknown');
  }
  function el(tag,text,className=''){
    const e=document.createElement(tag);e.textContent=String(text??'');
    if(className)e.className=className;
    return e;
  }
  function renderAlerts(alerts){
    const list=$('alerts');list.replaceChildren();
    if(!Array.isArray(alerts)||alerts.length===0){
      list.append(el('li','لا توجد تنبيهات من المراقبة الداخلية في أحدث عينة. لا يعني ذلك أن جميع قنوات المصدر تعمل.','one-capacity-clear'));
      return;
    }
    for(const a of alerts.slice(0,12)){
      const li=el('li',(alertNames[a?.code]||'حدث يحتاج مراجعة')+
        (Number.isSafeInteger(a?.count)&&a.count>0?' · '+count(a.count):''),
        a?.level==='critical'?'critical':'warning');
      list.append(li);
    }
  }
  function renderTrend(points){
    const container=$('trend');container.replaceChildren();
    const safe=Array.isArray(points)?points.filter(x=>x&&
      Number.isSafeInteger(x.viewers)&&x.viewers>=0).slice(-24):[];
    const max=Math.max(1,...safe.map(x=>x.viewers));
    for(const point of safe){
      const bar=document.createElement('i');
      bar.style.height=Math.max(5,Math.round(point.viewers/max*100))+'%';
      bar.title=count(point.viewers)+' مشاهدة داخل الريلاي · '+new Date(point.at).toLocaleTimeString('ar-SA');
      bar.setAttribute('aria-label',bar.title);
      container.append(bar);
    }
    mark('samples',count(safe.length));
  }
  async function read(path,timeout=9000){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
    try{
      const reply=await fetch(path,{method:'GET',credentials:'same-origin',
        redirect:'error',cache:'no-store',headers:{accept:'application/json'},
        signal:ctrl.signal});
      if(reply.status===401)throw Error('جلسة المشرف منتهية');
      if(!reply.ok)throw Error('فشل قراءة '+reply.status);
      const type=reply.headers.get('content-type')||'';
      if(!type.includes('application/json'))throw Error('استجابة غير متوقعة');
      const text=await reply.text();
      if(text.length>180000)throw Error('تقرير أكبر من الحد');
      const result=JSON.parse(text);
      if(result?.ok!==true)throw Error('تقرير غير جاهز');
      return result;
    }finally{clearTimeout(timer);}
  }
  async function load(){
    if(busy||document.hidden)return;
    busy=true;const request=++seq;
    $('refresh').disabled=true;
    mark('status','جارٍ فحص اتصال البث والمؤشرات الأمنية من سجلات المشغّل…');
    try{
      const results=await Promise.allSettled(source.map(item=>read(item[0])));
      if(request!==seq)return;
      const ops=results[0].status==='fulfilled'?results[0].value:null;
      const security=results[1].status==='fulfilled'?results[1].value:null;
      const playback=results[2].status==='fulfilled'?results[2].value:null;
      const cap=ops?.capacity,relay=security?.relay,media=security?.media;
      if(!ops||ops.readOnly!==true||ops.scope!=='shared_relay_and_operator_restream_only'||
        ops.isAllSubscribersMeasured!==false){
        clear('مؤشرات STREAM الداخلية غير متاحة أو لم تؤكد نطاق القياس؛ لا تُعرض أرقام تخمينية.');
        return;
      }
      mark('viewers',count(cap?.activeViewers));
      mark('feeds',count(cap?.activeFeeds));
      mark('feed-limit',count(cap?.maxViewersPerFeed));
      mark('tickets',count(relay?.activeTickets));
      mark('capacity-rejected',count(relay?.capacityRejected));
      mark('provider-failures',count(media?.providerFailures));
      mark('reconnects',count(media?.upstreamReconnects));
      renderAlerts(ops.alerts);
      renderTrend(ops.trend);
      const critical=Number(ops.criticalCount)||0;
      const warnings=Number(ops.alertCount)||0;
      indicator(critical>0?'تنبيه حرج':warnings>0?'يحتاج مراجعة':
        'مراقبة الريلاي تعمل',critical>0?'critical':warnings>0?'warning':'healthy');
      const sources=results.filter(x=>x.status==='fulfilled').length;
      const playbackScope=playback?.scope||'';
      mark('status','آخر قراءة: '+new Date().toLocaleString('ar-SA')+
        ' · تقارير استجابت: '+sources+' / '+source.length+
        ' · القراءات تخص الريلاي الداخلي فقط، لا تمثل العدد الحقيقي لكل المشتركين أو سعة المصدر المرخّص.');
      if(playback?.ok===true&&typeof playbackScope==='string')
        $('playback-note').textContent='فحص المشغل: تقرير مراقبة داخلية متوفر، وليس اختبار قناة فعلية.';
      else $('playback-note').textContent='فحص المشغل: لا توجد نتيجة مؤكدة؛ لا نفترض سلامة الصوت والصورة.';
      lastSuccess=Date.now();
    }catch{
      clear('تعذر التحقق من مراقبة STREAM. راجع لوحة STREAM ولا تفترض أن المشاهدين صفر.');
    }finally{busy=false;$('refresh').disabled=false;}
  }
  $('refresh').addEventListener('click',()=>void load());
  root.addEventListener('focusin',()=>{
    if(Date.now()-lastSuccess>60000)void load();
  });
  // A modest refresh avoids unnecessary load on the operator proxy.
  interval=setInterval(()=>{
    if(!document.hidden&&Date.now()-lastSuccess>45000)void load();
  },60000);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&Date.now()-lastSuccess>45000)void load();
  });
  window.addEventListener('pagehide',()=>clearInterval(interval),{once:true});
  void load();
})();