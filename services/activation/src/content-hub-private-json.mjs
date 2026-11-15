// An internal Hub endpoint can return JSON for accepted async work (202)
// or a denied request (4xx). Preserve the EXACT allow-listed status instead
// of accidentally turning successful owner QA into a 503.
export async function readPrivateHubJsonResponse(response,{
 allowedStatuses=[200],maxBytes=32*1024
}={}){
 if(!response||!Array.isArray(allowedStatuses)||
   !allowedStatuses.length||!allowedStatuses.every(x=>Number.isInteger(x)&&
      x>=200&&x<=499)||
   !allowedStatuses.includes(response.status))
  throw Error('private_hub_json_status_unexpected');
 const type=String(response.headers?.get?.('content-type')||'');
 if(!/^application\/json(?:\s*;|$)/i.test(type))
  throw Error('private_hub_json_type_invalid');
 const raw=await response.text();
 if(raw.length>maxBytes)throw Error('private_hub_json_too_large');
 let payload;
 try{payload=JSON.parse(raw)}
 catch{throw Error('private_hub_json_parse_failed')}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))
  throw Error('private_hub_json_payload_invalid');
 return payload;
}
