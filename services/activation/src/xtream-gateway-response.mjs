// Bound Xtream detail-response memory even if a provider omits Content-Length
// or sends a huge/malformed payload. Never return provider text in errors.
export async function readXtreamGatewayJsonResponse(response,{maxBytes=12_000_000}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>12_000_000)
    throw new Error('xtream_gateway_response_limit_invalid');
  if(!response||!Number.isInteger(response.status))
    throw new Error('xtream_gateway_upstream_unavailable');
  if(!response.ok){
    try{await response.body?.cancel()}catch{}
    throw new Error('xtream_gateway_upstream_'+response.status);
  }
  if(!response.body||typeof response.body.getReader!=='function')
    throw new Error('xtream_gateway_upstream_empty');
  const rawLength=response.headers?.get?.('content-length');
  if(typeof rawLength==='string'&&/^\d+$/.test(rawLength)&&Number(rawLength)>maxBytes){
    try{await response.body.cancel()}catch{}
    throw new Error('xtream_gateway_info_too_large');
  }
  const reader=response.body.getReader();
  const chunks=[];
  let size=0,completed=false;
  try{
    for(;;){
      const part=await reader.read();
      if(part.done){completed=true;break;}
      const chunk=Buffer.isBuffer(part.value)?part.value:Buffer.from(part.value||[]);
      size+=chunk.byteLength;
      if(size>maxBytes)throw new Error('xtream_gateway_info_too_large');
      chunks.push(chunk);
    }
  }catch(error){
    if(error?.message==='xtream_gateway_info_too_large')throw error;
    throw new Error('xtream_gateway_upstream_read_failed');
  }finally{
    if(!completed){try{await reader.cancel()}catch{}}
    try{reader.releaseLock()}catch{}
  }
  try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}
  catch{throw new Error('xtream_gateway_upstream_json_invalid');}
}
