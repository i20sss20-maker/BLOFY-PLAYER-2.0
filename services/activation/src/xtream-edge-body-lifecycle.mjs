// Stream one already-authorized response; never reconnect or replay bytes.
// Report only bounded numeric data and fixed reasons, not raw fetch errors.
export function observeEdgeBody(body,{signal,onFinish=()=>{},now=Date.now}={}){
 if(!body)return null;
 const reader=body.getReader();
 const started=now();
 let received=0,finished=false,reading=false;
 function done(reason){
  if(finished)return;
  finished=true;
  try{onFinish({reason,bytes:received,elapsedMs:Math.max(0,now()-started)})}catch{}
 }
 return new ReadableStream({
  async pull(controller){
   if(finished||reading)return;
   reading=true;
   try{
    const part=await reader.read();
    if(finished)return;
    if(part.done){done(signal?.aborted?'client_cancelled':'eof');controller.close();return}
    received+=part.value.byteLength;
    controller.enqueue(part.value);
   }catch{
    if(finished)return;
    const cancelled=signal?.aborted===true;
    done(cancelled?'client_cancelled':'upstream_body_error');
    // Keep a truncated transport a failure. Never fabricate a clean EOF
    // or expose a fetch error that contains a credential-bearing URL.
    controller.error(new Error(cancelled?'edge_client_cancelled':'edge_upstream_body_error'));
   }finally{reading=false}
  },
  async cancel(){
   done('client_cancelled');
   try{await reader.cancel()}catch{}
  }
 },{highWaterMark:0});
}
