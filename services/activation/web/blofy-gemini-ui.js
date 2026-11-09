// Operator-triggered Gemini UI. Uses the existing signed admin session.
// No model API key, provider URLs, or customer data appear in the browser.
(()=>{'use strict';
const el=id=>document.getElementById(id);
const box=el('blofyGeminiBox');
if(!box)return;
const status=el('blofyGeminiConnection'),results=el('blofyGeminiSuggestions');
const prev=el('blofyGeminiPrev'),next=el('blofyGeminiNext'),page=el('blofyGeminiPage');
let offset=0,working=false;
const failures={
 stream_ai_not_configured:'مفتاح Gemini غير موجود في إعدادات الخدمة.',
 stream_ai_model_not_allowed:'اسم نموذج Gemini في Railway غير مدعوم.',
 stream_ai_provider_unavailable:'Gemini رفض الطلب. افحص صلاحيات المفتاح، الرصيد، وحدود الاستخدام.',
 stream_ai_provider_auth_failed:'مفتاح Gemini غير صالح أو لا يملك الصلاحية.',
 stream_ai_provider_quota:'تم تجاوز حصة Gemini أو حد الاستخدام.',
 stream_ai_provider_model_missing:'نموذج Gemini غير متاح لهذا المفتاح أو المشروع.',
 stream_ai_provider_bad_request:'تعذّر قبول إعدادات الطلب من Gemini.',
 stream_ai_request_failed:'تعذر اتصال السيرفر بـ Gemini أو انتهت مهلة الاتصال.',
 stream_ai_incomplete:'لم يكمل Gemini توليد الرد. جرّب مرة أخرى.',
 stream_ai_invalid_output:'رد Gemini لا يطابق الصيغة المطلوبة.',
 stream_ai_no_safe_titles:'لا توجد عناوين صالحة للإرسال إلى Gemini في هذه الدفعة.',
 stream_ai_end_of_catalog:'وصلنا إلى نهاية المحتوى في هذا المصدر.',
 stream_ai_hourly_budget_exhausted:'وصلت إلى الحد الآمن للطلبات في الساعة.',
 stream_ai_selection_invalid:'اختر مصدر Xtream ونوع المحتوى أولًا.',
 stream_library_source_missing:'مصدر Xtream غير متاح أو محذوف.',
 invalid_origin:'تعذر التحقق من الطلب. حدّث صفحة الإدارة.',
 unauthorized:'انتهت جلسة الإدارة. سجّل الدخول مجددًا.',
};
async function request(path,body){
 const r=await fetch(path,{
  method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
  headers:{'content-type':'application/json','accept':'application/json',
   ...(body?{'x-blofy-admin-action':'library-ai'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 });
 let data={};try{data=await r.json()}catch{}
 if(!r.ok)throw Error(data.code||data.error||'unexpected_response');
 return data;
}
function state(isWorking){
 working=isWorking;
 el('blofyGeminiTest').disabled=isWorking;
 el('blofyGeminiSuggest').disabled=isWorking;
 prev.disabled=isWorking||offset===0;
 next.disabled=isWorking;
}
function say(message){status.textContent=message;}
function addText(parent,tag,value,cls=''){
 const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;
 parent.append(e);return e;
}
function render(data){
 results.replaceChildren();
 const items=Array.isArray(data.suggestions)?data.suggestions:[];
 if(!items.length){addText(results,'p','لم يقترح Gemini أي تعديل لهذه الدفعة.');return;}
 for(const item of items.slice(0,12)){
  const card=document.createElement('article');card.className='blofy-ai-suggestion';
  addText(card,'strong',item.currentName);
  addText(card,'p','الاسم المقترح: '+item.suggestedName);
  addText(card,'p','التصنيف: '+item.category+' · الثقة: '+item.confidence);
  addText(card,'small',item.reason);
  results.append(card);
 }
}
function selection(){
 const sourceId=el('catalogServer')?.value||'',type=el('catalogType')?.value||'';
 if(!/^[0-9a-f-]{36}$/i.test(sourceId)||!['live','movie','series'].includes(type))
  throw Error('stream_ai_selection_invalid');
 return {sourceId,type,offset};
}
el('blofyGeminiTest').addEventListener('click',async()=>{
 if(working)return;state(true);say('جاري اختبار اتصال Gemini بمثال عام صغير…');
 try{
  const configured=await request('/api/v1/admin/xtream/library-ai/status');
  if(!configured.configured)throw Error('stream_ai_not_configured');
  if(configured.provider!=='gemini')throw Error('gemini_not_selected');
  const response=await request('/api/v1/admin/xtream/library-ai/connection-test',{sample:true});
  say(response.ok?'✅ اتصال Gemini يعمل. عدد الاقتراحات التجريبية: '+response.suggestionsReturned:
    'لم ينجح اختبار Gemini.');
 }catch(error){say('⚠ '+(failures[error.message]||error.message||'تعذر فحص Gemini'))}
 finally{state(false);}
});
el('blofyGeminiSuggest').addEventListener('click',async()=>{
 if(working)return;
 let chosen;
 try{chosen=selection()}catch(e){say(failures[e.message]||'اختر المصدر.');return;}
 state(true);say('Gemini يحلل الدفعة '+(offset/12+1)+'…');
 try{
  const response=await request('/api/v1/admin/xtream/library-ai/suggest',chosen);
  if(chosen.sourceId!==el('catalogServer')?.value||chosen.type!==el('catalogType')?.value){
   say('تغير المصدر أثناء التحليل، تجاهلت النتائج القديمة.');return;
  }
  render(response);
  say('✅ تمت قراءة '+response.sourceItems+' عنوانًا. هذه اقتراحات للمعاينة فقط؛ لم يتم تعديل المكتبة.');
  next.disabled=response.nextOffset==null;
 }catch(e){say('⚠ '+(failures[e.message]||'تعذّر إنشاء الاقتراحات: '+e.message))}
 finally{state(false);}
});
prev.addEventListener('click',()=>{offset=Math.max(0,offset-12);page.textContent='الدفعة '+(offset/12+1);results.replaceChildren();state(false);});
next.addEventListener('click',()=>{offset+=12;page.textContent='الدفعة '+(offset/12+1);results.replaceChildren();state(false);});
for(const id of ['catalogServer','catalogType'])el(id)?.addEventListener('change',()=>{
 offset=0;page.textContent='الدفعة 1';results.replaceChildren();say('اختر اقتراح ترتيب 12 عنصرًا لبدء التحليل.');state(false);
});
void request('/api/v1/admin/xtream/library-ai/status').then(data=>{
 say(data.configured&&data.provider==='gemini'
  ?'Gemini مهيأ في Railway. استخدم «فحص الاتصال» للتحقق من عمل المفتاح.'
  :'⚠ Gemini غير مهيأ أو لم يتم اختياره كمزود AI في Railway.');
}).catch(()=>say('لا يمكن قراءة حالة Gemini. تحقق من تسجيل الدخول.'));
})();
