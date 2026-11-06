// BLOFY Pro operator UI. No external AI service, secrets or arbitrary actions.
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const btn=id=>$(id);
  const endpoint='/api/v1/admin/xtream/pro/';
  const current={sourceId:'',channels:[],selected:new Set(),working:false};
  const status=(value,error=false)=>{
    const p=$('studioProStatus');p.textContent=value;p.className=error?'muted studio-pro-error':'muted';
  };
  const safeRequest=(path,options={})=>api(endpoint+path,options);
  const selectSource=()=>$('studioProSource').value;
  const h=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const subtitle=(label,value)=>{
    const node=h('div','studio-pro-stat');
    node.append(h('small','',label),h('strong','',String(value)));
    return node;
  };
  const listRoot=id=>{const root=$(id);root.replaceChildren();return root;};
  const normalize=(n)=>Number(n||0).toLocaleString('en-US');
  const date=value=>value?new Date(value).toLocaleString('ar-SA',{hour12:true}):'غير محدد';
  function sourceChange(){
    current.sourceId=selectSource();
    current.channels=[];
    current.selected.clear();
    $('studioProChannels').replaceChildren();
    for(const elid of ['studioProSnapshots','studioProCollections','studioProEpgResult'])
      $(elid).replaceChildren();
    if(current.sourceId)void Promise.all([overview(),snapshots(),collections(),schedule()]);
  }
  async function sources(){
    try{
      const response=await api('/api/v1/admin/xtream/servers');
      const select=$('studioProSource'),prior=select.value||current.sourceId;
      select.replaceChildren();
      const blank=h('option','','اختر مصدر Xtream');blank.value='';select.append(blank);
      const items=response.items||[];
      for(const src of items){
        const opt=h('option','',src.name+(src.enabled?'':' (متوقف)'));opt.value=src.id;select.append(opt);
      }
      select.value=items.some(x=>x.id===prior)?prior:'';
      sourceChange();
    }catch(error){status('تعذر تحميل قائمة المصادر: '+error.message,true)}
  }
  function needsSource(){
    const id=selectSource();
    if(!id)status('اختر مصدر Xtream أولًا.',true);
    return id;
  }
  async function overview(){
    const id=needsSource();if(!id)return;
    try{
      const response=await safeRequest('overview?serverId='+encodeURIComponent(id));
      if(selectSource()!==id)return;
      const box=listRoot('studioProSummary');
      const source=response.source||{};
      box.append(subtitle('حالة المصدر',source.status||'غير معروفة'),
        subtitle('النشر للمشتركين',source.published?'مفعّل':'متوقف'),
        subtitle('مجموعات إدارية',normalize(response.collectionCount)),
        subtitle('آخر مزامنة',date(source.lastSyncAt)));
      for(const item of response.byType||[]){
        const label={live:'القنوات',movie:'الأفلام',series:'المسلسلات'}[item.media_type]||item.media_type;
        box.append(subtitle('عينة '+label,normalize(item.count)+' · مخفية '+normalize(item.hidden)+
          ' · مميزة '+normalize(item.featured)));
      }
      const foot=h('p','muted','الإحصاءات التفصيلية من أول 1200 عنصر كعينة؛ لا تمثل كل مكتبة ضخمة.');
      foot.style.gridColumn='1 / -1';box.append(foot);
      const events=(response.events||[]).slice(0,3);
      if(events.length){
        const history=h('p','muted','آخر عمليات الإدارة: '+
          events.map(x=>String(x.action).replaceAll('_',' ')+' ('+date(x.created_at)+')').join(' • '));
        history.style.gridColumn='1 / -1';box.append(history);
      }
      status('حالة المصدر محدثة. لا يعني نجاح الفهرسة أن بث الفيديو يعمل.');
    }catch(error){status('تعذر تحميل الإحصاءات: '+error.message,true)}
  }
  function selectedIds(){return current.channels.filter(x=>current.selected.has(x.id)).map(x=>x.id)}
  function renderChannels(){
    const root=listRoot('studioProChannels');
    if(!current.channels.length){root.append(h('p','muted','لم تُرجع العينة قنوات لهذا المصدر.'));return}
    const title=h('p','muted','اختر من '+normalize(current.channels.length)+' قناة في أول صفحة من المكتبة. المحدد: '+current.selected.size);
    root.append(title);
    for(const item of current.channels){
      const label=h('label','studio-pro-channel');
      const input=h('input');input.type='checkbox';input.checked=current.selected.has(item.id);
      input.addEventListener('change',()=>{
        if(input.checked)current.selected.add(item.id);else current.selected.delete(item.id);
        root.querySelector('p').textContent='اختر من '+normalize(current.channels.length)+
          ' قناة في أول صفحة من المكتبة. المحدد: '+current.selected.size;
      });
      const title=h('span','',item.name);
      const sub=h('small','',item.featured?'⭐ مميزة':item.enabled?'ظاهرة':'مخفية');
      label.append(input,title,sub);
      root.append(label);
    }
  }
  async function channels(){
    const id=needsSource();if(!id)return;
    const button=btn('studioProLoadChannels');button.disabled=true;
    try{
      const report=await api('/api/v1/admin/xtream/catalog?'+
        new URLSearchParams({serverId:id,type:'live',limit:'50',offset:'0'}));
      if(selectSource()!==id)return;
      current.channels=Array.isArray(report.items)?report.items.filter(x=>x.serverId===id&&x.type==='live'):[];
      current.selected.clear();
      renderChannels();
      status('عينة القنوات جاهزة. يمكنك تحديد أي عدد حتى 50 في العملية الواحدة.');
    }catch(error){status('تعذر تحميل القنوات: '+error.message,true)}
    finally{button.disabled=false}
  }
  async function batch(){
    const id=needsSource();if(!id||current.working)return;
    const ids=selectedIds(),action=$('studioProBulkAction').value;
    const names={feature:'تثبيت كمميزة',unfeature:'إلغاء التثبيت',
      show:'إظهار',hide:'إخفاء',renumber:'ترقيم متسلسل',clear_numbers:'إزالة الترقيم'};
    if(!ids.length){status('حدد قناة واحدة على الأقل من العينة.',true);return}
    const startNumber=Number($('studioProStartNumber').value);
    if(action==='renumber'&&(!Number.isInteger(startNumber)||startNumber<1||startNumber+ids.length-1>99999)){
      status('رقم البداية غير صحيح أو يتجاوز الحد المسموح.',true);return;
    }
    const affected=current.channels.filter(x=>current.selected.has(x.id)).slice(0,5).map(x=>x.name);
    if(!window.confirm('معاينة التغيير:\nالمصدر: '+$('studioProSource').selectedOptions[0].text+
      '\nالإجراء: '+names[action]+'\nعدد القنوات: '+ids.length+
      (action==='renumber'?'\nالأرقام: '+startNumber+'–'+(startNumber+ids.length-1):'')+
      '\nمثال: '+affected.join('، ')+'\n\nهل تعتمد التنفيذ؟'))return;
    current.working=true;btn('studioProApplyBulk').disabled=true;
    try{
      const result=await safeRequest('bulk',{method:'POST',body:JSON.stringify({
        serverId:id,mediaType:'live',ids,action,startNumber
      })});
      status('✓ تم تعديل '+normalize(result.updated)+' قناة. تستطيع حفظ نسخة من التخصيصات.');
      await channels();await overview();
    }catch(error){status('فشل حفظ التخصيص الجماعي: '+error.message,true)}
    finally{current.working=false;btn('studioProApplyBulk').disabled=false}
  }
  async function snapshots(){
    const id=needsSource();if(!id)return;
    try{
      const response=await safeRequest('snapshots?serverId='+encodeURIComponent(id));
      if(selectSource()!==id)return;
      const root=listRoot('studioProSnapshots');
      if(!response.items?.length){root.append(h('p','muted','ما فيه نسخ محفوظة بعد.'));return}
      for(const item of response.items){
        const row=h('div','studio-pro-record');
        row.append(h('strong','',item.label),h('small','',date(item.createdAt)+
          ' · أقسام '+normalize(item.categories)+' · تخصيصات '+normalize(item.items)));
        const restore=h('button','button ghost','استعادة');
        restore.type='button';restore.addEventListener('click',()=>void restoreSnapshot(item));
        row.append(restore);root.append(row);
      }
    }catch(error){status('تعذر عرض النسخ: '+error.message,true)}
  }
  async function createSnapshot(nameOverride){
    const id=needsSource();if(!id)return false;
    const label=String(nameOverride||$('studioProSnapshotName').value).trim();
    if(!label||label.length>80){status('اكتب اسمًا للنسخة الاحتياطية (80 حرفًا كحد أقصى).',true);return false}
    try{
      const saved=await safeRequest('snapshots',{method:'POST',body:JSON.stringify({serverId:id,label})});
      await snapshots();
      status('✓ تم حفظ نسخة «'+saved.label+'» من ترتيب الأقسام والتخصيصات.');
      return true;
    }catch(error){status('تعذر إنشاء النسخة: '+error.message,true);return false}
  }
  async function restoreSnapshot(item){
    const id=needsSource();if(!id)return;
    if(!window.confirm('ستُعاد حالة ظهور القنوات وتخصيصاتها وترتيب الأقسام في المصدر المحدد إلى «'+
      item.label+'». بيانات المصدر والمشتركين لا تتغير.\nهل تريد إنشاء نسخة حالية ثم الاستعادة؟'))return;
    const backup=await createSnapshot('نسخة تلقائية قبل استعادة '+item.label.slice(0,35));
    if(!backup){status('أوقفت الاستعادة لأن نسخة الأمان الحالية لم تُحفَظ.',true);return}
    if(!window.confirm('التأكيد الأخير: استعادة «'+item.label+'» الآن؟'))return;
    try{
      const result=await safeRequest('snapshots/'+encodeURIComponent(item.id)+'/restore',{
        method:'POST',body:JSON.stringify({serverId:id})
      });
      status('✓ تمت الاستعادة: '+normalize(result.categories)+' قسمًا و'+normalize(result.items)+
        ' تخصيصًا. النسخة السابقة محفوظة للتراجع.');
      await Promise.all([overview(),snapshots(),channels()]);
    }catch(error){status('تعذر الاستعادة وتم الحفاظ على النسخة الحالية: '+error.message,true)}
  }
  async function collections(){
    const id=needsSource();if(!id)return;
    try{
      const response=await safeRequest('collections?serverId='+encodeURIComponent(id));
      if(selectSource()!==id)return;
      const root=listRoot('studioProCollections');
      if(!response.items?.length){root.append(h('p','muted','لا توجد مجموعات محفوظة.'));return}
      for(const item of response.items){
        const row=h('div','studio-pro-record');
        row.append(h('strong','',item.name),h('small','',normalize(item.itemCount)+' قناة · حفظ إداري فقط'));
        const remove=h('button','button ghost','حذف المجموعة');
        remove.type='button';remove.addEventListener('click',()=>void deleteCollection(item));
        row.append(remove);root.append(row);
      }
    }catch(error){status('تعذر قراءة المجموعات: '+error.message,true)}
  }
  async function createCollection(){
    const id=needsSource();const ids=selectedIds();
    const name=$('studioProCollectionName').value.trim();
    if(!id||!name||!ids.length){status('اكتب اسم مجموعة وحدد قناة على الأقل.',true);return}
    if(!window.confirm('حفظ مجموعة «'+name+'» تضم '+ids.length+
      ' قناة؟ المجموعة إدارية ولا تغيّر صلاحيات المشتركين.'))return;
    try{
      await safeRequest('collections',{method:'POST',body:JSON.stringify({
        serverId:id,mediaType:'live',itemIds:ids,name
      })});
      $('studioProCollectionName').value='';
      status('✓ حُفظت مجموعة «'+name+'» من '+ids.length+' قناة.');
      await Promise.all([collections(),overview()]);
    }catch(error){status('تعذر إنشاء المجموعة: '+error.message,true)}
  }
  async function deleteCollection(item){
    const id=needsSource();if(!id)return;
    if(!window.confirm('حذف المجموعة الإدارية «'+item.name+'» فقط؟ القنوات نفسها لن تُحذف.'))return;
    try{
      await safeRequest('collections/'+encodeURIComponent(item.id)+'?serverId='+encodeURIComponent(id),{method:'DELETE'});
      status('✓ حُذفت المجموعة فقط.');
      await Promise.all([collections(),overview()]);
    }catch(error){status('تعذر حذف المجموعة: '+error.message,true)}
  }
  async function schedule(){
    const id=needsSource();if(!id)return;
    try{
      const config=await safeRequest('schedule/'+encodeURIComponent(id));
      if(selectSource()!==id)return;
      $('studioProScheduleHours').value=String(config.intervalHours||24);
      $('studioProScheduleTypes').value=config.types?.length===3?'all':config.types?.[0]||'all';
      $('studioProScheduleStatus').textContent=config.enabled?
        '✅ مفعلة. التشغيل القادم المتوقع: '+date(config.nextRunAt):
        'غير مفعلة. لن تبدأ أي مزامنة تلقائية حتى تقوم بتفعيلها.';
    }catch(error){status('تعذر قراءة الجدولة: '+error.message,true)}
  }
  async function saveSchedule(enabled){
    const id=needsSource();if(!id)return;
    const selected=$('studioProScheduleTypes').value;
    const types=selected==='all'?['live','movie','series']:[selected];
    const hours=Number($('studioProScheduleHours').value);
    if(!window.confirm(enabled?'تفعيل مزامنة دورية كل '+hours+
      ' ساعة لهذا المصدر فقط؟ لن تعيد البث أو تتجاوز رفض المزود.':
      'إيقاف المزامنة المجدولة لهذا المصدر؟'))return;
    try{
      await safeRequest('schedule/'+encodeURIComponent(id),{method:'PUT',
        body:JSON.stringify({enabled,intervalHours:hours,types})});
      await Promise.all([schedule(),overview()]);
      status(enabled?'✓ حُفظت الجدولة. يبدأ التحديث في الموعد القادم.':'✓ توقفت الجدولة.');
    }catch(error){status('تعذر حفظ الجدولة: '+error.message,true)}
  }
  async function health(){
    const button=btn('studioProLoadHealth');button.disabled=true;
    try{
      const report=await api('/api/v1/admin/xtream-gateway/playback-health');
      const m=report.metrics||{},codes=m.upstreamCodes||{};
      const root=listRoot('studioProHealth');
      root.append(subtitle('بدأت التشغيل',normalize(m.started)),
        subtitle('فشل تشغيل',normalize(m.failed)),
        subtitle('توقف أثناء التشغيل',normalize(m.interrupted)),
        subtitle('تأخير بدء P95',m.p95StartMs==null?'غير متوفر':normalize(m.p95StartMs)+' ms'),
        subtitle('رفض HTTP 456',normalize(codes[456]||0)),
        subtitle('رفض HTTP 403',normalize(codes[403]||0)));
      if(Number(codes[456]||0)+Number(codes[403]||0)>0){
        const caution=h('p','studio-pro-warning','تنبيه: رصد النظام رفض المصدر لبعض طلبات التشغيل. هذا لا يثبت حظر IP تحديدًا؛ راجع صلاحيات المزود.');caution.style.gridColumn='1/-1';root.append(caution);
      }
      const note=h('p','muted','النطاق: آخر '+(m.windowMinutes||60)+' دقيقة على هذه النسخة فقط، وقد تُصفّر الأرقام عند إعادة نشر Railway.');
      note.style.gridColumn='1/-1';root.append(note);
    }catch(error){status('تعذر قراءة مؤشرات التشغيل: '+error.message,true)}
    finally{button.disabled=false}
  }
  async function epg(){
    const serverId=needsSource(),ids=selectedIds();
    if(!serverId)return;
    if(ids.length!==1){status('حدد قناة واحدة فقط من العينة لقراءة EPG.',true);return}
    const root=listRoot('studioProEpgResult');
    root.append(h('p','muted','جارٍ جلب دليل البرامج الحقيقي من مزود القناة…'));
    try{
      const report=await safeRequest('epg?'+new URLSearchParams({serverId,sourceId:ids[0]}));
      root.replaceChildren();
      const entries=report.epg_listings||[];
      if(!entries.length){root.append(h('p','muted','المزود لم يرجع برامج لهذه القناة.'));return}
      for(const epg of entries.slice(0,12)){
        const row=h('div','studio-pro-record');
        row.append(h('strong','',epg.title||'عنوان غير معروف'),
          h('small','',String(epg.start||'')+' — '+String(epg.end||'')+
            (epg.description?' · '+String(epg.description).slice(0,110):'')));
        root.append(row);
      }
    }catch(error){root.replaceChildren(h('p','studio-pro-warning','تعذر قراءة الدليل: '+error.message))}
  }
  $('studioProSource').addEventListener('change',sourceChange);
  $('studioProRefresh').addEventListener('click',()=>void sources());
  $('studioProLoadChannels').addEventListener('click',()=>void channels());
  $('studioProSelectAll').addEventListener('click',()=>{
    for(const item of current.channels)current.selected.add(item.id);renderChannels();
  });
  $('studioProClearSelection').addEventListener('click',()=>{current.selected.clear();renderChannels()});
  $('studioProApplyBulk').addEventListener('click',()=>void batch());
  $('studioProCreateSnapshot').addEventListener('click',()=>void createSnapshot());
  $('studioProCreateCollection').addEventListener('click',()=>void createCollection());
  $('studioProEnableSchedule').addEventListener('click',()=>void saveSchedule(true));
  $('studioProDisableSchedule').addEventListener('click',()=>void saveSchedule(false));
  $('studioProLoadHealth').addEventListener('click',()=>void health());
  $('studioProEpg').addEventListener('click',()=>void epg());
  for(const tab of document.querySelectorAll('[data-tab=studio]'))
    tab.addEventListener('click',()=>void sources());
  if(location.hash==='#studio')void sources();
})();
