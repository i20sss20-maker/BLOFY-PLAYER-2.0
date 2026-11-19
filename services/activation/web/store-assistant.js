'use strict';
(function(){
 const root=document.getElementById('blofy-assistant');
 if(!root)return;
 const toggle=document.getElementById('blofy-assistant-toggle');
 const panel=document.getElementById('blofy-assistant-panel');
 const output=document.getElementById('blofy-assistant-messages');
 const input=document.getElementById('blofy-assistant-input');
 const form=document.getElementById('blofy-assistant-form');
 const submit=document.getElementById('blofy-assistant-send');
 const state=document.getElementById('blofy-assistant-state');
 let busy=false;
 function bubble(text,who,link,label){
   const box=document.createElement('div');box.className='blofy-chat-message '+who;
   const message=document.createElement('p');message.textContent=text;box.append(message);
   if(link&&link.startsWith('/')){
     const a=document.createElement('a');a.href=link;a.textContent=label||'اعرف أكثر';box.append(a);
   }
   output.append(box);output.scrollTop=output.scrollHeight;
 }
 function show(){
   panel.hidden=false;toggle.setAttribute('aria-expanded','true');
   input.focus({preventScroll:true});
 }
 toggle.addEventListener('click',()=>{
   if(panel.hidden)show();
   else{panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}
 });
 panel.addEventListener('keydown',event=>{
   if(event.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}
 });
 document.getElementById('blofy-assistant-close')?.addEventListener('click',()=>{
   panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();
 });
 async function ask(text){
   const question=String(text||'').trim();
   if(busy||question.length<2||question.length>500)return;
   busy=true;submit.disabled=true;
   bubble(question,'from-user');
   state.textContent='جارٍ تجهيز الإجابة...';
   input.value='';
   try{
     const r=await fetch('/api/v1/store/assistant',{
       method:'POST',credentials:'same-origin',cache:'no-store',
       headers:{'content-type':'application/json',accept:'application/json'},
       body:JSON.stringify({message:question})
     });
     const data=await r.json().catch(()=>({}));
     if(!r.ok)throw Error(data.error||'assistant_unavailable');
     bubble(String(data.answer||'تعذر عرض الإجابة.'),'from-blofy',data.url,data.label);
     state.textContent=data.mode==='ai'?'المساعد الذكي — للإرشاد فقط، لا يعرض حالة طلبك.':
       data.temporarilyUnavailable?'المساعد الآلي مؤقتًا؛ هذه إجابة من دليل BLOFY.':
       'دليل BLOFY — لإجابات اشتراكاتك العامة. لا تشارك الأكواد أو بيانات الدفع.';
   }catch{
     bubble('تعذر الرد الآن. يمكنك مشاهدة الأسئلة الشائعة أو التواصل مع الدعم.', 'from-blofy','/store/contact','تواصل مع الدعم');
     state.textContent='تعذّر الاتصال بالمساعد.';
   }finally{busy=false;submit.disabled=false;input.focus({preventScroll:true});}
 }
 form.addEventListener('submit',event=>{event.preventDefault();void ask(input.value);});
 for(const button of root.querySelectorAll('[data-blofy-ask]')){
   button.addEventListener('click',()=>{show();void ask(button.dataset.blofyAsk);});
 }
 bubble('أهلًا! أنا مساعد BLOFY للمنتجات والتفعيل والتجديد. اسألني عن الباقات أو طريقة الشراء. لا ترسل كلمات مرور أو معلومات بطاقات أو أكواد.', 'from-blofy');
})();
