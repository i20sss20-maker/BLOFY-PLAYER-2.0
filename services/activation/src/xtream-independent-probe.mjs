// Non-production one-shot comparison of an existing authorized Xtream
// source account API between the original portal and independent STREAM API.
// Source credentials travel only in HTTPS POST body with a secret bearer;
// never appear in customer responses or logs. Does not sync/mutate catalog.
const PINNED='https://blofy-stream-api-production.up.railway.app';
const ALLOWED=new Set(['account_verified','account_rejected','invalid_json',
  'upstream_http_status','connection_reset','timeout','connection_refused',
  'dns_failed','network_error','reply_too_large','invalid_account_url',
  'invalid_source_host']);
export async function compareXtreamFromIndependentRailway(accountUrl,{
 env=process.env,fetchImpl=fetch,timeoutMs=13500
}={}){
 const token=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
 if(token.length<32||env.BLOFY_STREAM_RELAY_ORIGIN!==PINNED)
   return {ok:false,code:'bridge_unconfigured',via:'isolated_stream'};
 if(!accountUrl||typeof accountUrl!=='string'||accountUrl.length>2500)
   return {ok:false,code:'bad_request',via:'isolated_stream'};
 try{
  const response=await fetchImpl(PINNED+'/internal/xtream-account-diagnostic',{
   method:'POST',redirect:'manual',
   headers:{authorization:'Bearer '+token,'content-type':'application/json',
     accept:'application/json'},
   body:JSON.stringify({accountUrl}),signal:AbortSignal.timeout(timeoutMs)
  });
  if(response.status!==200){
   await response.body?.cancel().catch(()=>{});
   return {ok:false,code:'probe_service_denied',status:response.status,via:'isolated_stream'};
  }
  if(Number(response.headers.get('content-length')||0)>1200)
    throw new Error('invalid_diagnostic_result');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength>1200)throw new Error('invalid_diagnostic_result');
  const data=JSON.parse(Buffer.from(bytes).toString('utf8'));
  const code=ALLOWED.has(data?.code)?data.code:'invalid_diagnostic_result';
  return {ok:data?.ok===true&&code==='account_verified',
   code,stage:['validation','http','connect','body'].includes(data?.stage)?data.stage:'unknown',
   httpStatus:Number.isInteger(data?.httpStatus)&&data.httpStatus>=100&&data.httpStatus<=599?
    data.httpStatus:null,via:'isolated_stream',mediaVerified:false,customerCutover:false};
 }catch{return {ok:false,code:'probe_unreachable',via:'isolated_stream',
     mediaVerified:false,customerCutover:false};}
}
