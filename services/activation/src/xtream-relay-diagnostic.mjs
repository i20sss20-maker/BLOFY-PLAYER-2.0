// Admin-only, fixed-code inspection of errors returned by the authenticated
// BLOFY STREAM relay. Never read or return a provider body, URL or account data.
// The caller must invoke this ONLY for a capability URL issued by the relay.
const CODES=new Set([
  'relay_provider_not_found',
  'relay_first_byte_timeout',
  'relay_transport_connection_reset',
  'relay_transport_timeout',
  'relay_not_playable_media',
  'relay_redirect_denied',
  'relay_provider_unavailable'
]);
export async function readSanitizedXtreamRelayFailure(response){
  if(response?.status!==502)return null;
  const len=Number(response.headers?.get('content-length')||0);
  if(!Number.isFinite(len)||len>512)return null;
  const reader=response.body?.getReader();
  if(!reader)return null;
  let size=0,parts=[];
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value?.byteLength||0;
      if(size>512)return null;
      parts.push(Buffer.from(part.value));
    }
    const value=JSON.parse(Buffer.concat(parts).toString('utf8'));
    if(!value||value.ok!==false||!CODES.has(value.code))return null;
    if(value.code==='relay_provider_not_found'&&value.upstreamStatus!==404)return null;
    return value.code;
  }catch{return null}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
