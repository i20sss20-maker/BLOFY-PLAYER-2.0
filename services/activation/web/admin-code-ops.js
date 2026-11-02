/* BLOFY Admin Code Operations. Credentials and issued codes are memory-only. */
(() => {
  'use strict';
  if (document.body.dataset.page !== 'admin') return;
  const byId = id => document.getElementById(id);
  const make = (tag, value, className) => {
    const el = document.createElement(tag);
    if (value != null) el.textContent = String(value);
    if (className) el.className = className;
    return el;
  };
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const date = n => n ? new Date(n).toLocaleDateString('en-US', {
    year:'numeric',month:'short',day:'numeric'
  }) : 'لم يحدد المزوّد';
  const status = (id, message, bad = false) => {
    const el=byId(id);
    el.textContent=message;
    el.classList.toggle('bad',bad);
  };
  const errors = {
    invalid_host_name:'اسم السيرفر يجب أن يحتوي حرفين على الأقل.',
    invalid_code_host:'هوست غير صالح أو لا يشير إلى عنوان عام موثوق.',
    too_many_hosts:'وصلت للحد الأقصى وهو 40 هوست.',
    host_already_saved:'اسم السيرفر مسجل مسبقًا.',
    code_source_expired:'الاشتراك منتهٍ لدى المزوّد.',
    code_source_credentials_invalid:'اسم المستخدم أو كلمة المرور غير صحيحين.',
    code_source_unavailable:'تعذر التحقق من حساب مزوّد البث.',
    invalid_code_account:'بيانات الحساب غير صحيحة.',
    legacy_code_no_host:'هذا كود قديم لا يحفظ الهوست.',
    rate_limited:'طلبات كثيرة. أعد المحاولة لاحقًا.'
  };
  async function request(path, body, method) {
    const controller = new AbortController();
    const timer=setTimeout(()=>controller.abort(),22000);
    try {
      const response = await fetch(path,{
        method:method || (body === undefined ? 'GET' : 'POST'),
        credentials:'same-origin',
        headers:body === undefined ? {} : {'content-type':'application/json'},
        body:body === undefined ? undefined : JSON.stringify(body),
        signal:controller.signal
      });
      if(response.status === 401) { location.assign('/admin'); throw Error('انتهت جلسة الإدارة.'); }
      const data = await response.json();
      if(!response.ok)throw Error(errors[data.error] || 'فشل الطلب. تحقق من الاتصال.');
      return data;
    } catch(error) {
      if(error.name === 'AbortError')throw Error('انتهت مهلة الاتصال.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  let page = 1, more = false, started = false, bulkRunning = false, bulkResults = [];
  const elText = (id,text) => { byId(id).textContent=text; };

  async function loadSummary() {
    const area=byId('code-ops-stats');
    try {
      const data=await request('/api/v1/admin/code-ops/summary');
      const stats=[
        ['total','إجمالي الأكواد'],['enabled','سارية حسب آخر فحص'],
        ['bound','مرتبطة بأجهزة'],['unbound','بدون جهاز'],
        ['expiring','تنتهي خلال 7 أيام'],['expired','منتهية'],['revoked','موقوفة']
      ];
      area.replaceChildren();
      for(const [key,label] of stats) {
        const card=make('div',null,'code-ops-stat');
        card.append(make('strong',fmt(data.totals[key])),make('span',label));
        if(['expiring','expired'].includes(key) && Number(data.totals[key])>0)card.classList.add('code-ops-attention');
        if(key==='expiring' || key==='expired') {
          card.role='button';card.tabIndex=0;
          const choose=()=>{byId('code-ops-search-form').elements.status.value=key;page=1;loadSearch();};
          card.addEventListener('click',choose);
          card.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' ') {event.preventDefault();choose();}});
        }
        area.append(card);
      }
      const list=byId('code-ops-alert-list');
      list.replaceChildren();
      for(const item of data.alerts || []) {
        const card=make('div',null,'code-ops-alert');
        const text=make('span',item.source+' · '+date(item.expiresAt));
        text.append(make('small',item.boundDeviceId || 'لم يُربط بجهاز'));
        const button=make('button','فحص','ghost');
        button.type='button';
        button.addEventListener('click',()=>checkCode(item.providerId,button));
        card.append(text,button);list.append(card);
      }
      if(!data.alerts?.length)list.append(make('p','لا توجد تنبيهات قريبة في آخر تواريخ محفوظة.','empty'));
    } catch(error) {
      area.replaceChildren(make('p',error.message,'status bad'));
      byId('code-ops-alert-list').replaceChildren(make('p','تعذر جلب التنبيهات.','status bad'));
    }
  }

  const hostList=byId('code-ops-host-list');
  async function loadHosts() {
    try {
      const {items}=await request('/api/v1/admin/code-ops/hosts');
      hostList.replaceChildren();
      for(const host of items) {
        const row=make('div',null,'code-ops-host');
        const title=make('div',null,'code-ops-host-details');
        title.append(make('strong',host.name),make('small',host.source==='strong'?'STROING 8K':'Xtream'));
        title.append(make('code',host.host));
        const use=make('button','اختيار','ghost');use.type='button';
        use.addEventListener('click',()=>{
          const select=byId('code-source');
          select.value=host.source;
          select.dispatchEvent(new Event('change',{bubbles:true}));
          byId('code-custom-host').value=host.host;
          byId('code-form').scrollIntoView({behavior:'smooth',block:'center'});
          status('code-ops-host-status','تم تحديد '+host.name+' لاستخدامه عند إصدار الكود.');
        });
        const check=make('button','فحص DNS','ghost');check.type='button';
        check.addEventListener('click',async()=>{
          check.disabled=true;
          try {
            const data=await request('/api/v1/admin/code-ops/hosts/'+encodeURIComponent(host.id)+'/check',{});
            status('code-ops-host-status', data.ok
              ? 'تم التحقق من DNS العام لـ '+host.name+'؛ لم تُفحص صلاحية اشتراك البث.'
              : 'هوست '+host.name+' لا يجتاز فحص DNS الآمن.',!data.ok);
          }catch(error){status('code-ops-host-status',error.message,true);}
          finally{check.disabled=false;}
        });
        const remove=make('button','حذف','ghost');remove.type='button';
        remove.addEventListener('click',async()=>{
          if(!confirm('حذف الهوست المحفوظ؟ الأكواد القديمة لن تتأثر.'))return;
          remove.disabled=true;
          try {
            await request('/api/v1/admin/code-ops/hosts/'+encodeURIComponent(host.id),undefined,'DELETE');
            await loadHosts();
          }catch(error){status('code-ops-host-status',error.message,true);remove.disabled=false;}
        });
        const actions=make('div',null,'code-ops-host-actions');actions.append(use,check,remove);
        row.append(title,actions);hostList.append(row);
      }
      if(!items.length)hostList.append(make('p','لم تحفظ أي سيرفر بعد.','empty'));
    }catch(error){hostList.replaceChildren(make('p',error.message,'status bad'));}
  }

  byId('code-ops-host-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget, button=form.querySelector('button[type=submit]');
    button.disabled=true;status('code-ops-host-status','جارٍ التحقق من DNS وحفظ الهوست…');
    try {
      const values=new FormData(form);
      await request('/api/v1/admin/code-ops/hosts',{
        name:String(values.get('name')||'').trim(),
        source:String(values.get('source')||'custom'),
        host:String(values.get('host')||'').trim()
      });
      form.reset();
      status('code-ops-host-status','تم حفظ السيرفر. يمكنك اختياره من القائمة.');
      await loadHosts();
    }catch(error){status('code-ops-host-status',error.message,true);}
    finally{button.disabled=false;}
  });

  async function checkCode(id,button) {
    button.disabled=true;const prior=button.textContent;button.textContent='جارٍ الفحص…';
    try {
      const result=await request('/api/v1/admin/code-ops/codes/'+encodeURIComponent(id)+'/check',{});
      status('code-ops-search-status',result.ok
        ? 'تم التحقق من الاشتراك: '+(result.expiresAt ? 'ينتهي '+date(result.expiresAt) : 'لم يحدد المزوّد تاريخ الانتهاء')
        : 'فشل فحص الاشتراك: '+({expired:'منتهي',invalid_account:'حساب غير صالح',unreachable:'المزوّد غير متاح'}[result.status]||'غير معروف'),
        !result.ok);
      await Promise.all([loadSummary(),loadSearch()]);
    }catch(error){status('code-ops-search-status',error.message,true);}
    finally{button.disabled=false;button.textContent=prior;}
  }

  async function loadSearch() {
    const form=byId('code-ops-search-form');
    const params=new URLSearchParams({
      q:String(form.elements.q.value||'').trim(),
      status:form.elements.status.value,page:String(page)
    });
    const list=byId('code-ops-search-rows');list.replaceChildren();
    try{
      const data=await request('/api/v1/admin/code-ops/search?'+params);
      for(const item of data.items) {
        const row=make('tr');
        const btn=make('button','فحص المصدر','ghost');btn.type='button';btn.disabled=!item.active;
        btn.addEventListener('click',()=>checkCode(item.providerId,btn));
        const act=make('td');act.append(btn);
        const current=!item.active?'موقوف':item.expiresAt&&item.expiresAt<=Date.now()?'منتهي':'نشط حسب السجل';
        row.append(make('td',item.providerId,'version-cell'),make('td',item.source),
          make('td',current),make('td',item.boundDeviceId||'—'),
          make('td',date(item.expiresAt)),act);
        list.append(row);
      }
      if(!data.items.length){const tr=make('tr');const td=make('td','لا توجد نتائج','empty');td.colSpan=6;tr.append(td);list.append(tr);}
      more=Boolean(data.hasMore);byId('code-ops-prev').disabled=page<=1;
      byId('code-ops-next').disabled=!more;elText('code-ops-page',String(page));
    }catch(error){status('code-ops-search-status',error.message,true);}
  }
  byId('code-ops-search-form').addEventListener('submit',event=>{event.preventDefault();page=1;loadSearch();});
  byId('code-ops-prev').addEventListener('click',()=>{if(page>1){page--;loadSearch();}});
  byId('code-ops-next').addEventListener('click',()=>{if(more){page++;loadSearch();}});

  function parseCSV(raw) {
    const text=String(raw||'').replace(/^\uFEFF/,'');
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(quoted && text[i+1]==='"'){field+='"';i++;continue;}
        if(!quoted && field!=='')throw Error('علامات الاقتباس غير صحيحة في CSV.');
        quoted=!quoted;
      }else if(ch===',' && !quoted){row.push(field);field='';}
      else if((ch==='\n'||ch==='\r')&&!quoted){
        row.push(field);field='';if(row.some(x=>x.trim()))rows.push(row);row=[];
        if(ch==='\r' && text[i+1]==='\n')i++;
      }else{field+=ch;}
    }
    if(quoted)throw Error('ملف CSV غير مكتمل الاقتباس.');
    row.push(field);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length<2)throw Error('الملف لا يحتوي اشتراكات.');
    const header=rows.shift().map(x=>x.toLowerCase().trim());
    const expected=['source','host','username','password'];
    if(header.length!==4||expected.some((name,index)=>header[index]!==name))
      throw Error('الأعمدة المطلوبة بالترتيب: source,host,username,password');
    if(rows.length>20)throw Error('الحد الأعلى 20 اشتراكًا في كل ملف.');
    return rows.map((cells,index)=>{
      if(cells.length!==4)throw Error('صف رقم '+(index+2)+' يحتوي عدد أعمدة خاطئ.');
      const [source,host,username,password]=cells.map(x=>x.trim());
      if(!['blofy','strong','custom'].includes(source))throw Error('مصدر غير صحيح في الصف '+(index+2));
      if(!username||!password||username.length>256||password.length>512 ||
         (source==='custom'&&!host)||host.length>512)
        throw Error('بيانات ناقصة أو غير صحيحة في الصف '+(index+2));
      return {source,host,username,password,row:index+2};
    });
  }

  function renderBatch() {
    const table=byId('code-ops-bulk-rows');table.replaceChildren();
    for(const item of bulkResults) {
      const tr=make('tr');
      const code=make('td',item.code||'—');code.dir='ltr';
      tr.append(make('td',item.row),make('td',item.source),
        make('td',item.error||'تم الإصدار'),code);
      table.append(tr);
    }
    byId('code-ops-bulk-export').disabled=!bulkResults.some(x=>x.code);
  }

  byId('code-ops-bulk-start').addEventListener('click',async()=>{
    if(bulkRunning)return;
    const input=byId('code-ops-csv'),file=input.files[0];
    if(!file){status('code-ops-bulk-status','اختر ملف CSV أولًا.',true);return;}
    if(file.size>16_384){status('code-ops-bulk-status','الملف كبير؛ الحد 16 كيلوبايت.',true);return;}
    let records;
    try {records=parseCSV(await file.text());}
    catch(error){status('code-ops-bulk-status',error.message,true);return;}
    if(bulkResults.some(x=>x.code) && !confirm('لديك أكواد لم تحفظها. تأكد من تنزيلها قبل مسح نتائج الدفعة السابقة.'))return;
    if(!confirm('سيتم فحص '+records.length+' اشتراكًا وإصدار كود لكل حساب صالح. لا تعِد العملية عند نجاح جزئي. متابعة؟'))return;
    bulkResults=[];renderBatch();bulkRunning=true;
    const btn=byId('code-ops-bulk-start');btn.disabled=true;input.disabled=true;
    try {
      for(const record of records) {
        status('code-ops-bulk-status','جارٍ فحص وإصدار '+(bulkResults.length+1)+' من '+records.length+'…');
        const payload={source:record.source,username:record.username,password:record.password};
        if(record.host)payload.host=record.host;
        try {
          const result=await request('/api/v1/admin/blofy-codes',payload);
          bulkResults.push({row:record.row,source:record.source,code:result.code,error:''});
        }catch(error){
          bulkResults.push({row:record.row,source:record.source,code:'',error:error.message});
          // Network timeouts have unknown outcome: stop to prevent duplicate issuance.
          if(/مهلة|الاتصال|انتهت جلسة/.test(error.message)){renderBatch();break;}
        }
        renderBatch();
        await new Promise(resolve=>setTimeout(resolve,220));
      }
      const successes=bulkResults.filter(x=>x.code).length;
      status('code-ops-bulk-status','اكتملت '+bulkResults.length+' محاولة؛ نجح '+successes+'. احفظ الأكواد قبل مغادرة الصفحة.',successes!==records.length);
      await Promise.all([loadSummary(),loadSearch()]);
    } finally {bulkRunning=false;btn.disabled=false;input.disabled=false;}
  });

  byId('code-ops-bulk-export').addEventListener('click',()=>{
    const completed=bulkResults.filter(x=>x.code);
    if(!completed.length)return;
    // Plain text preserves leading zeros in numeric codes and avoids CSV formula injection.
    const file=new Blob([completed.map(x=>x.row+' | '+x.code).join('\n')+'\n'],{type:'text/plain;charset=utf-8'});
    const url=URL.createObjectURL(file),link=make('a');
    link.href=url;link.download='BLOFY-issued-codes.txt';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),2500);
  });
  byId('code-ops-bulk-clear').addEventListener('click',()=>{
    if(bulkRunning)return;
    if(bulkResults.some(x=>x.code) && !confirm('هل حفظت الأكواد؟ لن يمكن استرجاع الأرقام بعد المسح.'))return;
    bulkResults=[];renderBatch();byId('code-ops-csv').value='';
    status('code-ops-bulk-status','تم مسح النتائج والملف من الصفحة.');
  });
  async function openHub() {
    if(location.hash!=='#codes')return;
    if(started)return; started=true;
    await Promise.all([loadSummary(),loadHosts(),loadSearch()]);
  }
  byId('code-ops-refresh').addEventListener('click',async()=>{
    await Promise.all([loadSummary(),loadHosts(),loadSearch()]);
  });
  addEventListener('hashchange',openHub);
  openHub();
})();
