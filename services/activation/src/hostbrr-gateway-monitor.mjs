const endpoint='https://media2.blofyplayer.com/healthz';
const marker='BLOFY_HOSTER_GATEWAY_READY';
export async function probeHostbrrGateway(fetchImpl=fetch,now=Date.now){
 const start=now();
 const base={id:'hostbrr-gateway',name:'BLOFY ENGINE PRO — HostBrr',tier:'test'};
 const controller=new AbortController();
 const stop=setTimeout(()=>controller.abort(),4500);
 const result=(status,httpStatus,note)=>({...base,status,httpStatus,latencyMs:Math.max(0,now()-start),note});
 let reader;
 try{
  const response=await fetchImpl(endpoint,{method:'GET',redirect:'manual',signal:controller.signal,headers:{accept:'text/plain'}});
  if(response.status!==200||!response.body?.getReader)
   return result('error',response.status,'بوابة HostBrr لم تؤكد الجاهزية');
  reader=response.body.getReader();
  let size=0;const chunks=[];
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>128)return result('error',200,'رد غير متوقع من بوابة HostBrr');
   chunks.push(Buffer.from(part.value));
  }
  if(Buffer.concat(chunks).toString('utf8').trim()!==marker)
   return result('error',200,'رد غير متوقع من بوابة HostBrr');
  return result('healthy',200,'HTTPS جاهز؛ لا يثبت تشغيل المصدر أو العملاء');
 }catch{return result('offline',null,'تعذر الوصول إلى بوابة HostBrr');}
 finally{clearTimeout(stop);if(reader){try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}}
}
