// Fixed, auditable Arabic/English command parser for BLOFY STREAM.
// This is NOT a remotely hosted language model. Unrecognized intentions never
// become arbitrary operations, and no credentials or customer data are sent out.
(function(root){
  'use strict';
  function norm(value){
    return String(value||'').toLowerCase()
      .replace(/[\u064b-\u065f\u0670\u0640]/g,'')
      .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي')
      .replace(/ة/g,'ه').replace(/\s+/g,' ').trim();
  }
  function parse(input){
    if(typeof input!=='string'||!input.trim()||input.length>400)
      return {intent:'unknown',reason:'اكتب أمرًا قصيرًا وواضحًا (حتى 400 حرف).'};
    // Arabic letters are not JavaScript regex word characters, so Arabic
    // keywords must not use the ASCII-only \\b boundary.
    const text=norm(input);
    // Never infer destructive changes or secret-bearing instructions.
    if(/(احذف|حذف|امسح|مسح|افرغ|صفر|ازاله|اطرد|غير كلمه المرور|استخرج كلمات المرور|تجاوز الحظر|اكسر الحظر)/.test(text))
      return {intent:'unknown',reason:'الحذف وتغيير الصلاحيات أو تجاوز حظر المصدر غير متاح بالأوامر التلقائية.'};
    const live=/(قناه|قنوات|لايف|مباشر|live|channels?)/.test(text);
    const movie=/(فيلم|افلام|movie|movies|vod)/.test(text);
    const series=/(مسلسل|مسلسلات|حلقات|series|episodes?)/.test(text);
    const mentioned=[live?'live':null,movie?'movie':null,series?'series':null].filter(Boolean);
    const mediaTypes=mentioned.length?mentioned:null;
    if(/(شعار|لوقو|logo|هوية|هويه)/.test(text))
      return {intent:'branding',mediaTypes,readOnly:true,label:'إدارة هوية السيرفر'};
    if(/(مزامنه|زامن|استيراد|استورد|sync|تحديث المحتوي|حدث المحتوي|جدد المحتوي|حدث القنوات|تحديث القنوات|تحديث المكتبه)/.test(text)&&
       !/(معلومات|بيانات|تفاصيل|بوستر|ملصق|قصه|تقييم)/.test(text))
      return {intent:'sync',mediaTypes,readOnly:false,label:'مزامنة المحتوى من المصدر'};
    if(/(رتب|ترتيب|نظم|تنظيم|صنف|sort|order|organize)/.test(text)){
      const mode=/(ابجدي|ابجديه|alphabetic)/.test(text)?'alphabetical':
        /(الاكثر|اكثر|شعبيه|popular|المحتوي الاكثر)/.test(text)?'popular':'smart';
      return {intent:'sort',mediaTypes,mode,readOnly:false,label:'ترتيب الأقسام'};
    }
    if(/(تحديث|حدث|حسن|تحسين|اكمل|استكمل|enrich|metadata|معلومات|تفاصيل|صور|صوره|بوسترات|بوستر|اغلفه|اغلف|قصه|تقييم|ملصقات)/.test(text))
      return {intent:'enrich',mediaTypes:mentioned.length?mentioned.filter(x=>x!=='live'):null,
        readOnly:false,label:'استكمال معلومات الأعمال من مصدر Xtream'};
    if(/(فحص|افحص|اختبر|تجربه|جرب|probe|test)/.test(text)&&
       /(بث|تشغيل|قناه|قنوات|فيديو|المصدر|سيرفر|xtream|456|403|live)/.test(text))
      return {intent:'probe',mediaTypes,readOnly:true,label:'فحص تشغيل عينة من المصدر'};
    if(/(تقرير|مراجعه|دقق|تدقيق|حلل|تحليل|audit|report|مكررات|ناقصه|ناقص|المكتبه)/.test(text))
      return {intent:'audit',mediaTypes,readOnly:true,label:'تقرير جودة المكتبة'};
    return {intent:'unknown',reason:'ما فهمت الأمر بدقة. جرّب أحد الأمثلة الموجودة؛ لن أنفذ أمرًا غير واضح.'};
  }
  root.BlofySmartCommands=Object.freeze({parse,norm});
})(globalThis);
