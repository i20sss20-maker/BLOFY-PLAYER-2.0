/* Actual order statistics and consent-based, verified customer reviews.
   No invented names, ratings or order totals are rendered by this file. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const start=()=>{
  if(!$('blofy-voices'))return;
  const list=$('voices-list'),state=$('voices-state'),
    form=$('voices-review-form'),button=$('voices-review-submit'),
    submitStatus=$('voices-submit-status');
  const number=value=>Number(value||0).toLocaleString('en-US');
  const create=(tag,text,cls)=>{
   const el=document.createElement(tag);el.textContent=String(text);
   if(cls)el.className=cls;
   return el;
  };
  async function load(){
   try{
    const response=await fetch('/api/v1/store/social-proof',{
      credentials:'omit',cache:'no-store',headers:{accept:'application/json'}
    });
    if(!response.ok)throw Error('stats_unavailable');
    const data=await response.json();
    if(data.ok!==true||data.syntheticReviews!==false||!data.metrics||!data.reviews)
      throw Error('stats_unverified');
    $('voices-orders-number').textContent=number(data.metrics.fulfilledPaidOrders);
    $('voices-trials-number').textContent=number(data.metrics.deliveredTrials);
    $('voices-reviews-number').textContent=number(data.reviews.total);
    list.replaceChildren();
    const rows=Array.isArray(data.reviews.items)?data.reviews.items:[];
    for(const review of rows.slice(0,6)){
      const card=create('article','','voice-card');
      const rating=Math.max(1,Math.min(5,Number(review.rating)||1));
      const stars=create('div','★'.repeat(rating)+'☆'.repeat(5-rating),'voice-stars');
      stars.setAttribute('aria-label','التقييم '+rating+' من 5');
      const quote=create('p',review.text);
      const footer=document.createElement('footer');
      const by=create('b',review.displayName||'عميل BLOFY');
      const when=create('time',new Date(review.date).toLocaleDateString('ar-SA',{
        year:'numeric',month:'short',timeZone:'Asia/Riyadh'
      }));
      footer.append(by,when);card.append(stars,quote,footer);list.append(card);
    }
    if(!rows.length)list.append(create('div',
      'هنا تُنشر تقييمات العملاء الحقيقيين بعد موافقتهم ومراجعتها. شاركنا تجربتك لتكون من أوائل المشاركين.',
      'voices-empty'));
    $('voices-average').textContent=data.reviews.average==null?
      'لم تتوفر تقييمات منشورة بعد':
      'متوسط التقييمات المنشورة: '+data.reviews.average.toLocaleString('en-US')+' / 5';
    state.textContent='أرقام الطلبات والتجارب مأخوذة من السجلات الفعلية للمتجر.';
   }catch{
    for(const id of ['voices-orders-number','voices-trials-number','voices-reviews-number'])
      $(id).textContent='—';
    list.replaceChildren();
    list.append(create('div','تعذّر تحديث التقييمات الآن. نعرض الأرقام المؤكدة فقط، دون تقديرات أو أعداد افتراضية.','voices-empty'));
    state.textContent='الإحصائيات غير متاحة مؤقتًا، حاول تحديث الصفحة.';
   }
  }
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   const body=$('voices-review-text').value.trim();
   const rating=Number($('voices-review-rating').value);
   if(body.length<15||body.length>600){
     submitStatus.textContent='اكتب تقييمًا حقيقيًا من 15 إلى 600 حرف.';return;
   }
   button.disabled=true;
   submitStatus.textContent='جارٍ إرسال التقييم إلى فريق BLOFY للمراجعة…';
   try{
    const response=await fetch('/api/v1/store/reviews',{
     method:'POST',credentials:'same-origin',cache:'no-store',
     headers:{accept:'application/json','content-type':'application/json'},
     body:JSON.stringify({
       rating,body,showFirstName:$('voices-first-name').checked
     })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.ok!==true){
     const message={
      review_login_required:'لإضافة تقييم، سجل الدخول ببريدك الإلكتروني من صفحة «حسابي» أولًا.',
      review_verified_order_required:'يمكن نشر تقييم بعد طلب تجربة مجانية أو شراء اشتراك من حسابك.',
      review_personal_info_disallowed:'لا تكتب أرقام الجوال أو البريد الإلكتروني أو الروابط داخل التقييم.',
      review_update_cooldown:'تم إرسال تقييمك مؤخرًا. انتظر قليلًا قبل تعديله.',
      review_rate_limited:'طلبات كثيرة خلال فترة قصيرة. حاول لاحقًا.',
      review_rating_invalid:'اختر تقييمًا من 1 إلى 5.',
      review_text_invalid:'اكتب تقييمًا من 15 إلى 600 حرف.'
     }[data.error]||'تعذّر تسجيل تقييمك الآن. لم يتم نشر أي شيء.';
     throw Error(message);
    }
    form.reset();
    submitStatus.textContent='✓ تم حفظ رأيك للمراجعة، ولن يُنشر إلا بعد مراجعته.';
   }catch(e){
    submitStatus.textContent=e.message||'تعذر الاتصال الآن.';
   }finally{button.disabled=false;}
  });
  void load();
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
 else start();
})();
