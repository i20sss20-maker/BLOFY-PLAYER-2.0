'use strict';
(function(){
 const form=document.getElementById('assistant-form'),
   input=document.getElementById('assistant-question'),
   log=document.getElementById('messages');
 const normalize=s=>String(s||'').normalize('NFKC').toLowerCase()
   .replace(/[ًٌٍَُِّْ]/g,'').replace(/[إأآٱ]/g,'ا')
   .replace(/ى/g,'ي').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const rules=[
  {words:['سعر','اسعار','كم','باقة','مده','مدة'],text:'أسعار الباقات الحالية في BLOFY: 3 أشهر بـ40 ريالًا، 6 أشهر بـ70 ريالًا، وسنة بـ120 ريالًا. يوجد عرض اشتراكين سنويين بسعر 200 ريال. راجع إجمالي السعر في السلة قبل الدفع.',links:[['شوف الباقات','/#products'],['عرض الاشتراكين','/store/offers']]},
  {words:['فرق','الفرق','مقارنه','ستريم','xtream','اكستريم','player','بلاير'],text:'BLOFY STREAM يُستخدم فيه كود تفعيل داخل التطبيق المتوافق. أما Xtream فتستلم بيانات الاتصال الخاصة باشتراكك بالطريقة المدعومة في BLOFY PLAYER. اختر الخيار الذي يتوافق مع جهازك وطريقة التشغيل التي تفضلها.',links:[['عرض باقات STREAM','/products/stream'],['عرض باقات Xtream','/products/xtream']]},
  {words:['تجديد','اجدد','ينتهي','انتهاء','اشتراكي','تمديد'],text:'سجّل دخولك إلى حساب BLOFY بنفس البريد الذي اشتريت به. افتح الاشتراكات وحدد الباقة المؤهلة للتجديد. تجديد نفس الكود يعتمد على أهلية الاشتراك وتأكيد الدفع، فلا تفترض التمديد قبل ظهور الحالة المؤكدة.',links:[['حسابي واشتراكاتي','/store/account']]},
  {words:['شراء','اشتري','اطلب','اكواد','كود','استلام','اسلم','طلب'],text:'اختر الباقة، وأضفها للسلة، وأكّد بريدك برمز الدخول، ثم أكمل الدفع في بوابة جيديا. بعد تأكيد الدفع تظهر الأكواد في حسابك وطلباتي. إذا تعطل الدفع لا تنشئ طلبًا آخر قبل التأكد من حالة الطلب السابق.',links:[['السلة','/store/cart'],['طلباتي','/store/orders']]},
  {words:['دخول','حساب','نسيت','البريد','رمز','تحقق'],text:'افتح حسابي وأدخل بريدك الإلكتروني. سيصلك رمز تحقق من 6 أرقام لتسجيل الدخول، دون كلمة مرور. استخدم نفس البريد المرتبط بطلبك لاستعادة الأكواد والاشتراكات.',links:[['دخول حسابي','/store/account']]},
  {words:['دفع','فيزا','مدى','ماستر','ابل','apple','google','خصم','فشل','فلوسي'],text:'الدفع بالبطاقات المتاحة يظهر في بوابة جيديا. Apple Pay متوقف مؤقتًا بانتظار التحقق من معالجة فشل سابق، وGoogle Pay غير مؤكد الدعم. إذا فشل الدفع أو ظهر خصم من البنك، تحقق من طلباتك وتواصل مع الدعم قبل إعادة المحاولة.',links:[['طلباتي','/store/orders'],['الدعم','/store/contact']]},
  {words:['جهاز','شاشه','شاشة','اندرويد','android','توافق','تطبيق'],text:'توافق التشغيل يعتمد على نوع الجهاز وإصدار النظام والتطبيق المناسب. اذكر موديل جهازك وإصداره عند التواصل مع الدعم قبل شراء الاشتراك.',links:[['صفحة التجربة','/store/trial'],['اسأل الدعم','/store/contact']]},
 ];
 const safeLinks=new Set(['/','/#products','/store/offers','/store/cart','/store/account','/store/orders','/store/contact','/store/trial','/products/stream','/products/xtream']);
 function add(text,mine=false,links=[]){
  const message=document.createElement('div');message.className='bubble '+(mine?'mine':'agent');
  const p=document.createElement('p');p.textContent=text;message.append(p);
  if(links.length){
   const box=document.createElement('div');box.className='reply-links';
   for(const [title,href] of links){
    if(!safeLinks.has(href))continue;
    const a=document.createElement('a');a.href=href;a.textContent=title;box.append(a);
   }
   message.append(box);
  }
  log.append(message);log.scrollTop=log.scrollHeight;
 }
 function answer(question){
  const q=normalize(question);
  if(/(?:بطاقه|بطاقة|password|كلمه المرور|رمز تحقق|رقم الهويه|cvc|cvv)/.test(q)&&/\d{4,}/.test(q)){
   return{text:'لأمانك، لا ترسل بيانات بطاقة أو رموز دخول أو أرقام شخصية. تواصل مع الدعم من صفحة التواصل.',links:[['الدعم','/store/contact']]};
  }
  const found=rules.find(rule=>rule.words.some(word=>q.includes(normalize(word))));
  return found||{text:'أقدر أساعدك في الأسعار، واختيار STREAM أو Xtream، وخطوات الطلب، والدخول وتجديد الاشتراك. جرّب صياغة أخرى أو تواصل مع موظف الدعم.',links:[['الدعم','/store/contact']]};
 }
 function submit(question){
  question=String(question||'').trim().slice(0,400);if(!question)return;
  add(question,true);
  const result=answer(question);add(result.text,false,result.links||[]);
  input.value='';input.focus();
 }
 form.addEventListener('submit',e=>{e.preventDefault();submit(input.value);});
 for(const b of document.querySelectorAll('[data-question]')){
  b.addEventListener('click',()=>submit(b.dataset.question));
 }
})();
