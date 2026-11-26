// Public, no-token BLOFY subscription-store informational pages.
// All content is curated server-side; no customer-provided HTML is interpolated.
const WA='https://wa.me/966568941484?text=';
const link=(label,text)=>'<a class="btn" href="'+WA+encodeURIComponent(text)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>';
const blocks={
  about:{
    title:'عن متجر BLOFY',desc:'اشتراك STRONG 8K مع BLOFY STREAM وXtream عبر BLOFY PLAYER، مع مكتبة بث مباشر وأفلام ومسلسلات.',
    lead:'متجر بلوفي للاشتراكات الرقمية',
    body:'<p>متجر BLOFY يقدم اشتراك STRONG 8K بطريقتين، وعرض اشتراكين سنويين بـ200 ريال. كود BLOFY STREAM، أو Xtream مع تطبيق BLOFY PLAYER. بحسب بيانات الباقة المعلنة، تضم أكثر من 50,000 قناة بث مباشر، وأكثر من 50,000 مسلسل، وأكثر من 185,000 فيلم. تخضع الأرقام للتحديث بحسب المصدر وتوفر حقوق التوزيع.</p>'+
         '<div class="tiles"><div><strong>كود ستريم</strong><p>تفعيل مبسط بإدخال الكود في التطبيق المتوافق.</p></div><div><strong>Xtream BLOFY</strong><p>استخدام كود الاشتراك للحصول على بيانات الاتصال في صفحة التفعيل المخصصة.</p></div><div><strong>دعم مباشر</strong><p>تواصل قبل أو بعد الطلب عبر فريق BLOFY على واتساب.</p></div></div>'
  },
  trial:{
    title:'التجربة | BLOFY',desc:'يوجد تجربة لخدمات BLOFY وفق شروط التوافر. تواصل للاستفسار عن التفاصيل قبل الاشتراك.',
    lead:'يوجد تجربة — جرّب قبل الاشتراك',
    body:'<p>نوفّر خيار الاستفسار عن <strong>تجربة BLOFY</strong> حتى تتعرف على الخدمة ومدى ملاءمتها لجهازك. مدة التجربة ونوعها وإتاحتها تُحدَّد من فريق الدعم حسب المنتج والتوفر؛ لا يتم إصدار كود تجريبي تلقائيًا من هذه الصفحة.</p>'+
         '<div class="note">للحصول على تفاصيل التجربة، اختر نوع المنتج وأرسل طلب تجربة إلى فريق BLOFY عبر واتساب، بدون مشاركة بيانات بطاقة.</div>'+
         '<div class="buttons">'+link('اطلب تجربة كود ستريم','السلام عليكم، أريد الاستفسار عن تجربة كود BLOFY STREAM ومدتها وشروطها.')+
         link('اطلب تجربة Xtream','السلام عليكم، أريد الاستفسار عن تجربة Xtream BLOFY ومدتها وشروطها.')+'</div>'
  },
  faq:{
    title:'الأسئلة الشائعة | BLOFY',desc:'تفاصيل الأسعار والدفع والتجربة والتفعيل لمنتجات بلوفي.',
    lead:'كل الإجابات قبل الاشتراك',
    body:'<div class="faq">'+
      '<details open><summary>كم أسعار المنتجات؟</summary><p>شهر 25 ريال، و3 أشهر 50 ريال، و6 أشهر 70 ريال، وسنة كاملة 120 ريال لكل من كود BLOFY STREAM وXtream BLOFY.</p></details>'+
      '<details><summary>وش عرض الاشتراكين السنويين؟</summary><p>اشتراكان منفصلان كل واحد لمدة سنة بسعر إجمالي 200 ريال بدل 240 ريال، مع اختيار ستريم أو إكستريم لأي من الاثنين. بعد الدفع المؤكد يُسلّم كودان.</p></details>'+
      '<details><summary>وش يحتوي اشتراك STRONG 8K؟</summary><p>حسب بيانات الباقة المعلنة: أكثر من 50 ألف قناة، وأكثر من 50 ألف مسلسل، وأكثر من 185 ألف فيلم. تختلف الإتاحة مع تحديثات المصدر وحقوق المحتوى.</p></details>'+
      '<details><summary>متى تبدأ مدة الاشتراك؟</summary><p>تبدأ عند أول تفعيل ناجح للكود، وليس عند إنشاء الكود في المخزون.</p></details>'+
      '<details><summary>هل تتوفر تجربة؟</summary><p>يوجد خيار تجربة للاستفسار حسب التوفر. تواصل معنا لمعرفة المدة وشروط التجربة.</p></details>'+
      '<details><summary>هل الكود نفسه يصلح للطريقتين؟</summary><p>يمكن ربط الكود نفسه بمسار ستريم وXtream بحسب صلاحيات الباقة والتفعيل المتاح، دون إنشاء اشتراك منفصل تلقائيًا.</p></details>'+
      '<details><summary>هل أحتاج حسابًا أو تسجيل دخول؟</summary><p>نعم. أضف اشتراكاتك للسلة أولًا ثم سجّل دخولك بالبريد ورمز التحقق قبل إتمام أي دفع. تُحفظ السلة وطلباتك في حسابك. الطلبات القديمة المشتراة كزائر تظل قابلة للاسترجاع برابطها الخاص.</p></details>'+
      '<details><summary>كيف أتابع أو أسترجع طلبي؟</summary><p>بعد بدء الدفع تحصل على رقم طلب ورابط خاص؛ افتح صفحة «تتبع طلب» لمراجعة الحالة واسترجاع الأكواد بعد تأكيد الدفع. رقم الطلب وحده لا يكشف الأكواد.</p></details>'+
      '<details><summary>هل يمكن شراء أكثر من اشتراك دفعة واحدة؟</summary><p>نعم، أضف المنتجات والعروض إلى السلة ثم ادفع مرة واحدة. السلة تسمح بحد أقصى ستة أكواد في الطلب الواحد.</p></details>'+
      '<details><summary>متى أستلم الكود؟</summary><p>بعد التحقق من نجاح الدفع يتم إصدار الكود وإظهاره في إيصال الطلب. لا تعِد الدفع إذا كان التحقق جاريًا.</p></details>'+
      '<details><summary>ماذا أفعل عند وجود مشكلة؟</summary><p>تواصل مع الدعم من صفحة الاتصال، واذكر رقم طلبك دون إرسال كلمة مرور أو تفاصيل بطاقة.</p></details>'+
      '</div>'
  },
  contact:{
    title:'التواصل والدعم | BLOFY',desc:'تواصل مع متجر BLOFY عبر واتساب للاستفسار والدعم والمشتريات.',
    lead:'نحن هنا لمساعدتك',
    body:'<p>للاستفسار عن الأكواد، التفعيل، الأسعار، تجربة المنتجات أو متابعة طلب، تواصل مع فريق BLOFY عبر واتساب.</p>'+
         '<div class="note"><b>رقم التواصل:</b> <b dir="ltr">0568941484</b></div>'+
         '<div class="buttons">'+link('محادثة واتساب','السلام عليكم، لدي استفسار عن متجر BLOFY والاشتراكات.')+
         '<a class="btn secondary" href="/support">مركز الدعم</a></div>'+
         '<p>لا تشارك معلومات البطاقة البنكية أو بيانات Xtream الخاصة مع الآخرين.</p>'
  },
  terms:{
    title:'الشروط وإجراءات الشراء | BLOFY',desc:'معلومات الشراء والتسليم والاشتراك والدعم في متجر BLOFY.',
    lead:'شروط واضحة قبل تأكيد الطلب',
    body:'<div class="faq">'+
      '<details open><summary>المنتجات والأسعار</summary><p>تُعرض الباقات ومددها وأسعارها قبل الشراء، ويحدد نوع المنتج طريقة التفعيل. لا تُخصم مبالغ من زر واتساب.</p></details>'+
      '<details open><summary>إصدار الكود</summary><p>يتحقق الموقع من الدفع لدى مزوّد الدفع قبل إصدار كود الاشتراك. مدة الاشتراك تبدأ عند أول تفعيل ناجح، ولا تبدأ عند إنشاء المخزون.</p></details>'+
      '<details open><summary>حقوق المحتوى</summary><p>تخضع الخدمات وتوفرها وطرق الوصول لصلاحيات المصادر والتراخيص والأنظمة ذات الصلة. لا يجوز استخدام الأكواد للوصول إلى محتوى غير مصرح به.</p></details>'+
      '<details open><summary>المشكلات وطلبات الاسترداد</summary><p>عند تعذر التسليم أو وجود خطأ في الطلب، تواصل مع الدعم وقدم رقم الطلب. تراجع الحالات وفق حالة الدفع والتفعيل والقواعد النظامية المعمول بها؛ لا يُعد التواصل ضمانًا تلقائيًا لرد مبلغ مدفوع.</p></details>'+
      '</div>'
  }
};
export function storeInfoPage(slug){
 const page=blocks[slug];
 if(!page)return null;
 return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'+
 '<meta name="viewport" content="width=device-width,initial-scale=1">'+
 '<meta name="theme-color" content="#071326">'+
 '<meta name="description" content="'+page.desc+'">'+
 '<link rel="icon" href="/blofy-logo.png"><title>'+page.title+'</title>'+
 '<style>@font-face{font-family:BLOFYArabic;src:url(/IBMPlexSansArabic-Regular.ttf);font-weight:400;font-display:swap}@font-face{font-family:BLOFYArabic;src:url(/IBMPlexSansArabic-Medium.ttf);font-weight:500 900;font-display:swap}:root{font-family:BLOFYArabic,Tahoma,sans-serif;color-scheme:dark}*{box-sizing:border-box}body{background:radial-gradient(ellipse at top,#1a3061,#050b18 75%);color:#f4f8ff;margin:0;min-height:100vh}a{color:inherit;text-decoration:none}header{border-bottom:1px solid #263e65;background:#060f20ed;position:sticky;top:0;z-index:2}nav{max-width:1100px;min-height:73px;margin:auto;padding:12px 20px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}.brand{direction:ltr;display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;letter-spacing:.09em}.brand img{width:38px;height:38px}.links{display:flex;gap:15px;flex-wrap:wrap;font-size:13px;color:#b7d1ef}main{max-width:1100px;margin:auto;padding:70px 20px 100px}.eyebrow{font-weight:900;color:#92baff;letter-spacing:.15em;font-size:12px}.hero{max-width:820px}h1{font-size:clamp(36px,5vw,56px);font-weight:600;letter-spacing:-.04em;line-height:1.35;margin:16px 0 28px}p{color:#bdcee6;line-height:2;font-size:16px}.content{background:linear-gradient(145deg,#152b50,#0a172c);border:1px solid #3c567988;border-radius:25px;padding:clamp(22px,4vw,42px);margin:24px 0}.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin-top:20px}.tiles>div,.note{border:1px solid #2c5b92;border-radius:16px;padding:18px;background:#0a2040}.tiles p{font-size:13px}.buttons{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.btn{border:1px solid #5283d4;padding:14px 20px;border-radius:13px;display:inline-block;background:linear-gradient(110deg,#3e77f2,#558cf1);color:#03152a;font-weight:900}.btn.secondary{background:#103966;color:#eaf6ff}.faq{display:grid;gap:13px}.faq details{border:1px solid #3d5780;border-radius:15px;padding:18px;background:#0e1d36}.faq summary{font-weight:800;cursor:pointer}.faq p{font-size:14px;margin:13px 0 0}.bottom{border-top:1px solid #244a79;padding:23px 20px;text-align:center;color:#8cafd5;font-size:12px}@media(max-width:700px){.tiles{grid-template-columns:1fr}main{padding:40px 15px 65px}.links{gap:10px}}</style>'+
 '</head><body><header><nav><a class="brand" href="/"><img src="/blofy-logo.png" alt=""> BLOFY</a>'+
 '<div class="links"><a href="/">الرئيسية</a><a href="/#products">الاشتراكات</a><a href="/store/offers">العروض</a><a href="/store/cart">السلة</a><a href="/store/orders">تتبع طلب</a><a href="/store/account">حسابي</a><a href="/store/trial">التجربة</a><a href="/store/about">عن بلوفي</a><a href="/store/faq">الأسئلة</a><a href="/store/contact">التواصل</a></div></nav></header>'+
 '<main><div class="hero"><span class="eyebrow">BLOFY STORE</span><h1>'+page.lead+'</h1></div>'+
 '<section class="content">'+page.body+'</section><div class="buttons"><a href="/#products" class="btn">تصفح الاشتراكات ←</a></div></main>'+
 '<footer class="bottom">BLOFY · <a href="/store/terms">الشروط</a> · <a href="/privacy">الخصوصية</a> · <a href="/store/contact">التواصل</a></footer></body></html>';
}
