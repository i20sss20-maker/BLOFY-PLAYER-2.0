// Private fixed-host Content Hub -> Portal licensed VOD data plane.
// Portal alone resolves encrypted Xtream credentials. Hub never accepts an
// arbitrary upstream URL and never exposes the approved source to users.
const ROOT='http://blofy-activation-portal.railway.internal:3000/internal/blofy-content-hub/mirror';
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
function valid(kind,id){
 return ['movie','episode'].includes(kind)&&ID.test(String(id||''))&&
  (kind!=='episode'||/^[1-9][0-9]{0,9}$/.test(String(id||'')));
}
function scoped(signal,timeout){
 const deadline=AbortSignal.timeout(timeout);
 return signal?AbortSignal.any([signal,deadline]):deadline;
}
export function createMirrorPortalBridge({
 token='',fetchImpl=fetch
}={}){
 const configured=typeof token==='string'&&token.length>=32;
 return {
  async approval({kind,id,signal}={}){
   if(!configured||!valid(kind,id))
    return {ok:false,code:'mirror_bridge_approval_unavailable'};
   try{
    const response=await fetchImpl(ROOT+'/approval/'+kind+'/'+id,{
     method:'GET',redirect:'manual',
     headers:{authorization:'Bearer '+token,accept:'application/json'},
     signal:scoped(signal,12000)
    });
    if(response.status!==200)return {ok:false,
      code:'mirror_bridge_approval_denied'};
    if(Number(response.headers.get('content-length')||0)>1800)
     return {ok:false,code:'mirror_bridge_large_approval'};
    const body=await response.text();
    if(Buffer.byteLength(body,'utf8')>1800)
     return {ok:false,code:'mirror_bridge_large_approval'};
    const result=JSON.parse(body);
    if(result?.kind!==kind||String(result?.id)!==String(id))
     return {ok:false,code:'mirror_bridge_wrong_item'};
    return result;
   }catch{return {ok:false,code:'mirror_bridge_approval_unavailable'}}
  },
  async range({approval,from,to,signal}={}){
   const kind=approval?.kind,id=approval?.id;
   if(!configured||!valid(kind,id)||
      !Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
      to<from||to-from+1>8*1024*1024)
    throw Error('mirror_bridge_invalid_range');
   return fetchImpl(ROOT+'/range/'+kind+'/'+id,{
    method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+token,
     'x-blofy-mirror-transfer':'licensed-one-chunk',
     range:'bytes='+from+'-'+to,
     'accept-encoding':'identity'},
    signal:scoped(signal,90000)
   });
  }
 };
}
