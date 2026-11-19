/* Approve real, order-verified BLOFY reviews. Never create reviews for users. */
(() => {
 'use strict';
 const init=()=>{
  const $=id=>document.getElementById(id);
  if(!$('one-verified-reviews-admin'))return;
  const list=$('one-reviews-list'),notice=$('one-reviews-notice');
  let busy=false;
  const elt=(tag,value,cls)=>{
   const e=document.createElement(tag);e.textContent=String(value??'');
   if(cls)e.className=cls;return e;
  };
  async function request(url,{payload}={}){
   const res=await fetch(url,{
    method:payload===undefined?'GET':'POST',credentials:'same-origin',
    cache:'no-store',headers:{
      accept:'application/json',...(payload===undefined?{}:{'content-type':'application/json'})
    },body:payload===undefined?undefined:JSON.stringify(payload)
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok||data.ok!==true)throw Error(data.error||'server_'+res.status);
   return data;
  }
  async function load(){
   if(busy)return;
   busy=true;notice.textContent='جارٍ تحميل التعليقات الحقيقية من حسابات العملاء…';
   try{
    const state=$('one-reviews-status').value;
    const data=await request('/api/v1/admin/store/reviews?status='+encodeURIComponent(state));
    list.replaceChildren();
    if(!Array.isArray(data.items))throw Error('reviews_response_invalid');
    for(const review of data.items){
     const card=elt('article','','one-review-admin-card');
     const summary=elt('div','','one-review-admin-top');
     summary.append(elt('strong',(review.fullName||review.displayName||'عميل BLOFY')+
       ' · '+'★'.repeat(Number(review.rating)||1)));
     summary.append(elt('span',review.email||''));
     const text=elt('blockquote',review.text);
     const foot=elt('div','','one-review-admin-footer');
     foot.append(elt('small','تاريخ الاستلام: '+new Date(review.createdAt).toLocaleString('ar-SA')));
     if(state==='pending'){
      const actions=elt('div','','one-review-admin-actions');
      for(const [decision,title] of [['approved','✓ اعتماد ونشر'],['rejected','× إخفاء لسبب مشروع']]){
       const button=elt('button',title);button.type='button';
       button.dataset.action=decision;
       button.addEventListener('click',()=>void moderate(review,decision,button));
       actions.append(button);
      }
      foot.append(actions);
     }
     card.append(summary,text,foot);list.append(card);
    }
    if(!data.items.length)list.append(elt('p','لا توجد تقييمات في هذه الحالة حاليًا.','one-review-empty'));
    notice.textContent='✓ '+data.items.length+' تقييمات من حسابات فعلية · '+state+
      '. لا تُنشر بيانات الجوال أو البريد في المتجر العام.';
   }catch(error){
    notice.textContent='تعذّر قراءة التقييمات: '+error.message;
   }finally{busy=false;}
  }
  let changing=false;
  async function moderate(review,decision,button){
   if(changing||!review?.id)return;
   const action=decision==='approved'?'نشر':'إخفاء';
   const explanation=decision==='approved'?
    'سيصبح التقييم متاحًا في المتجر. افحصه وأزِل أي معلومات شخصية قبل النشر.':
    'الإخفاء للاستخدام عند وجود سبام أو بيانات حساسة أو إساءة، وليس لمجرد انخفاض عدد النجوم.';
   if(!confirm(action+' هذا التقييم الحقيقي؟\n'+explanation))return;
   changing=true;button.disabled=true;
   notice.textContent='جارٍ '+action+' التقييم وتسجيل القرار…';
   try{
    await request('/api/v1/admin/store/reviews/'+encodeURIComponent(review.id)+'/decision',
      {payload:{decision}});
    notice.textContent='✓ تم تسجيل قرار المراجعة. جارٍ تحديث القائمة…';
   }catch(error){
    notice.textContent='تعذّر تأكيد القرار: '+error.message+'، راجع الحالة قبل إعادة المحاولة.';
   }finally{changing=false;button.disabled=false;void load();}
  }
  $('one-reviews-refresh').addEventListener('click',()=>void load());
  $('one-reviews-status').addEventListener('change',()=>void load());
  addEventListener('blofy-one:reviews-admin-visible',()=>void load());
  if(location.hash==='#one-inventory')void load();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();
