// Fixed private Portal -> Content Hub cost-budget attestation.
// No caller URLs, bucket credentials or operator-entered "free space".
const HUB='http://blofy-content-hub.railway.internal:3000/internal/mirror/preflight-capacity';
const MAX_JSON=1600;
const safeBytes=x=>Number.isSafeInteger(x)&&x>=0;
export async function loadPrivateMirrorCapacity({
 token='',fetchImpl=fetch,now=Date.now()
}={}){
 const base={ok:false,capacity:null,providerRequests:0,
  mediaBytesTransferred:0,customerCutover:false};
 if(typeof token!=='string'||token.length<32)
  return {...base,code:'private_capacity_bridge_unconfigured'};
 try{
  const response=await fetchImpl(HUB,{method:'GET',redirect:'manual',
   headers:{authorization:'Bearer '+token,accept:'application/json',
    'x-blofy-owner-action':'private-bucket-capacity-preflight'},
   signal:AbortSignal.timeout(13500)});
  if(response.status!==200)return {...base,
    code:'private_capacity_hub_not_ready'};
  if(Number(response.headers.get('content-length')||0)>MAX_JSON)
   return {...base,code:'private_capacity_response_oversized'};
  const body=await response.text();
  if(Buffer.byteLength(body,'utf8')>MAX_JSON)
   return {...base,code:'private_capacity_response_oversized'};
  const j=JSON.parse(body);
  if(j.ok!==true||j.code!=='private_capacity_attested'||
     j.privateOnly!==true||j.verifiedPrivateBucket!==true||
     j.usageExact!==true||j.reservedBytes!==0||
     !safeBytes(j.budgetBytes)||!safeBytes(j.usedBytes)||
     !safeBytes(j.objectCount)||!Number.isSafeInteger(j.observedAt)||
     j.observedAt>now||now-j.observedAt>300000||
     j.providerRequests!==0||j.mediaBytesTransferred!==0||
     j.customerCutover!==false||j.automaticDownload!==false)
   return {...base,code:'private_capacity_attestation_invalid'};
  return {...base,ok:true,code:'private_capacity_snapshot_verified',
   capacity:{verifiedPrivateBucket:true,usageExact:true,
    observedAt:j.observedAt,budgetBytes:j.budgetBytes,
    usedBytes:j.usedBytes,reservedBytes:0}};
 }catch{return {...base,code:'private_capacity_bridge_unavailable'}}
}
