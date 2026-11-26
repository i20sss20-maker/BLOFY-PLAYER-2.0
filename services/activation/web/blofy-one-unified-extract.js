/* Owner-only BLOFY ONE: repeatable, READ-ONLY voucher + Xtream extraction.
 * Never redeem, renew, generate, rotate or mutate customer subscriptions.
 * Reveals are explicit, audited by the existing store endpoint, and ephemeral. */
(() => {
  'use strict';
  const start=()=>{
    const $=id=>document.getElementById(id);
    const dialog=$('one-register-dialog'),button=$('one-register-extract'),
      box=$('one-register-xtream-secret'),status=$('one-register-detail-status');
    if(!dialog||!button||!box)return;
    const fields={
      code:$('one-register-bundle-code'),host:$('one-register-xtream-host'),
      user:$('one-register-xtream-user'),password:$('one-register-xtream-password'),
      m3u:$('one-register-xtream-m3u')
    };
    const actions={
      code:$('one-register-bundle-copy'),all:$('one-register-xtream-copy'),
      m3u:$('one-register-m3u-copy')
    };
    const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let selected=null,generation=0,timer=null,busy=false;
    const reasons={
      stream_link_activate_first:'الكود لم يُفعّل بعد، فلا توجد بيانات Xtream لاستخراجها.',
      stream_link_account_expired:'انتهت صلاحية حساب Xtream.',
      stream_link_code_expired:'انتهت صلاحية الكود.',
      stream_link_code_revoked:'الكود ملغى.',
      stream_link_account_unavailable:'حساب Xtream مرتبط لكنه موقوف أو غير موجود.',
      stream_link_credentials_unavailable:'بيانات دخول Xtream القديمة غير قابلة للاسترجاع.',
      stream_link_saleh_source_only:'الحساب مرتبط بمصدر مختلف عن المصدر المعتمد.',
      stream_link_origin_invalid:'إعداد رابط Host غير صالح.',
      code_reveal_rate_limited:'تجاوزت حد كشف الأكواد؛ راجع السجل قبل إعادة المحاولة.',
      code_reveal_unavailable:'الكود الأصلي غير محفوظ بطريقة تسمح باسترجاعه.',
      code_reveal_integrity_failed:'لم تجتز بيانات الكود اختبار السلامة.',
      stream_link_code_not_found:'لم يُعثر على الكود المرتبط بحساب Xtream.'
    };
    function clear(){
      generation++;
      if(timer)clearTimeout(timer);
      timer=null;
      Object.values(fields).forEach(el=>{el.textContent='';});
      Object.values(actions).forEach(el=>{el.disabled=true;});
      box.hidden=true;
    }
    function refreshButton(){
      button.disabled=busy||!selected?.canReveal||selected?.status!=='active';
    }
    function host(raw){
      const value=new URL(String(raw||''));
      if(value.protocol!=='https:'||value.username||value.password||value.search||
         value.hash||!['','/'].includes(value.pathname))
        throw Error('رابط السيرفر المسترجع غير صالح.');
      return 'https://'+value.hostname+':'+(value.port||'443');
    }
    function isCurrent(voucherId,serial){
      return dialog.open&&!document.hidden&&selected?.voucherId===voucherId&&
        serial===generation;
    }
    async function request(path,payload){
      const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),14000);
      try{
        const response=await fetch(path,{
          method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',
          headers:{accept:'application/json','content-type':'application/json'},
          body:JSON.stringify(payload),signal:ctl.signal
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok||data.ok!==true){
          if(response.status===401||response.status===403)
            throw Error('انتهت جلسة الإدارة أو لا تملك صلاحية الكشف.');
          if(response.status===429)throw Error('طلبات كثيرة، أعد المحاولة لاحقًا.');
          throw Error(reasons[data.error||data.code]||
            'تعذر قراءة البيانات من السيرفر (HTTP '+response.status+').');
        }
        return data;
      }catch(error){
        if(error.name==='AbortError')throw Error('انتهت مهلة الاتصال. راجع السجل ثم أعد الاستخراج.');
        throw error;
      }finally{clearTimeout(timeout);}
    }
    dialog.addEventListener('blofy-one:register-open',event=>{
      clear();
      const data=event.detail||{};
      selected=UUID.test(String(data.voucherId||''))?
        {voucherId:data.voucherId,canReveal:data.canReveal===true,status:data.status}:null;
      busy=false;
      button.textContent='⇄ استخراج الكود + Xtream (أو إعادة الاستخراج)';
      refreshButton();
    });
    dialog.addEventListener('close',()=>{clear();selected=null;busy=false;refreshButton();});
    button.addEventListener('click',async()=>{
      if(busy||!selected?.canReveal||selected.status!=='active')return;
      if(!window.confirm('هل تريد استخراج كود BLOFY الأصلي وHost وUsername وPassword من نفس الاشتراك الساري؟ يُسجل كشف الكود، ولا ننشئ حسابًا أو نمدد المدة. تأكد من هوية صاحب الاشتراك قبل مشاركة البيانات.'))return;
      clear();
      const id=selected.voucherId,serial=generation;
      busy=true;refreshButton();
      status.textContent='جارٍ قراءة نفس الكود والتحقق من بيانات Xtream الموجودة…';
      try{
        const revealed=await request('/api/v1/admin/store/codes/reveal',
          {voucherId:id,purpose:'customer_support'});
        if(!isCurrent(id,serial))return;
        if(revealed.voucherId!==id||typeof revealed.code!=='string'||!revealed.code)
          throw Error('بيانات الكود المسترجع لا تطابق السجل.');
        // Lookup by the EXACT original voucher. The mapping is read-only.
        const linked=await request('/api/v1/admin/xtream-gateway/link/code-to-xtream',
          {code:revealed.code});
        if(!isCurrent(id,serial))return;
        const c=linked.credentials||{};
        if(linked.codeId!==id||linked.created!==false||linked.subscriptionUnchanged!==true||
           !c.serverUrl||!c.username||!c.password)
          throw Error('Xtream المسترجع لا يطابق الاشتراك أو لا يحمل بيانات كاملة.');
        const fullHost=host(c.serverUrl);
        const username=String(c.username),password=String(c.password);
        const m3u=fullHost+'/get.php?'+new URLSearchParams({
          username,password,type:'m3u_plus',output:'ts'}).toString();
        fields.code.textContent=revealed.code;fields.host.textContent=fullHost;
        fields.user.textContent=username;fields.password.textContent=password;
        fields.m3u.textContent=m3u;
        box.hidden=false;
        Object.values(actions).forEach(el=>{el.disabled=false;});
        status.textContent='✓ تم استخراج الكود وXtream من الاشتراك نفسه دون تجديد أو إصدار آخر. ستُخفى القيم تلقائيًا بعد 30 ثانية.';
        button.textContent='↻ إعادة استخراج نفس الكود وXtream';
        timer=setTimeout(()=>{if(isCurrent(id,serial))clear();},30000);
      }catch(error){
        if(isCurrent(id,serial)){
          clear();
          status.textContent='تعذّر استخراج الكود وXtream معًا: '+error.message+
            ' يمكنك كشف الكود فقط، أو إدخال الكود القديم يدويًا في تبويب الفحص.';
        }
      }finally{busy=false;refreshButton();}
    });
    async function copy(text,label){
      if(box.hidden||!text)return;
      try{
        await navigator.clipboard.writeText(text);
        status.textContent='✓ نُسخ '+label+'. يُرجى مشاركته مع صاحب الاشتراك فقط.';
      }catch{status.textContent='تعذر النسخ التلقائي؛ انسخ القيمة من الحقل مباشرة.';}
    }
    actions.code.addEventListener('click',()=>void copy(fields.code.textContent,'الكود'));
    actions.all.addEventListener('click',()=>void copy(
      'Host: '+fields.host.textContent+'\nUsername: '+fields.user.textContent+
      '\nPassword: '+fields.password.textContent,'بيانات Xtream'));
    actions.m3u.addEventListener('click',()=>void copy(fields.m3u.textContent,'رابط M3U'));
    $('one-register-xtream-hide').addEventListener('click',clear);
    $('one-register-reveal').addEventListener('click',clear);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
    window.addEventListener('pagehide',clear);
    clear();refreshButton();
  };
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
