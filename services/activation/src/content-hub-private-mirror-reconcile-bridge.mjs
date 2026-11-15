// Private fixed-host Portal -> Content Hub manifest status bridge.
// The caller is already an authenticated STREAM website owner with the
// exact approved source. No arbitrary URLs, object keys or media downloads.
const HUB='http://blofy-content-hub.railway.internal:3000/internal/mirror/verified-inventory';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MOVIE=/^[A-Za-z0-9._:-]{1,128}$/;
const EPISODE=/^[1-9][0-9]{0,11}$/;
const KNOWN=new Set(['not_recorded','copy_incomplete','copy_failed',
 'verified_manifest','verification_inconsistent']);
const unknown={status:'not_assessed',storedManifestVerified:false,
 physicalS3Checked:false};
export async function reconcileStreamCatalogPage({
 sourceId,items=[],hubToken='',fetchImpl=fetch
}={}){
 if(!UUID.test(String(sourceId||''))||!Array.isArray(items)||
  items.length<1||items.length>50||
  items.some(x=>!['movie','episode'].includes(x?.kind)||
   !(x.kind==='movie'?MOVIE:EPISODE).test(String(x.id||'')))){
  return {ok:false,code:'stream_manifest_scope_invalid',items:[],
   physicalS3Checked:false};
 }
 if(typeof hubToken!=='string'||hubToken.length<32)
  return {ok:false,code:'stream_manifest_bridge_unconfigured',
   items:items.map(x=>({...x,...unknown})),
   physicalS3Checked:false};
 const signal=AbortSignal.timeout(11000);
 try{
  const response=await fetchImpl(HUB,{method:'POST',
   redirect:'manual',signal,headers:{
    authorization:'Bearer '+hubToken,
    'content-type':'application/json',
    'x-blofy-owner-action':'private-catalog-manifest-reconcile',
    accept:'application/json'},
   body:JSON.stringify({sourceId,items})
  });
  if(response.status!==200)return {ok:false,
   code:response.status===404?'stream_manifest_feature_off':
    'stream_manifest_bridge_unavailable',
   items:items.map(x=>({...x,...unknown})),physicalS3Checked:false};
  if(Number(response.headers.get('content-length')||0)>20000)
   throw Error('stream_manifest_large');
  const raw=await response.text();
  if(Buffer.byteLength(raw)>20000)throw Error('stream_manifest_large');
  const data=JSON.parse(raw);
  if(data?.ok!==true||data.sourceId!==sourceId||
    data.scope!=='private_manifest_database_only'||
    data.count!==items.length||
    data.physicalS3Checked!==false||
    data.providerRequests!==0||data.mediaBytesTransferred!==0||
    data.customerCutover!==false||data.automaticCopyStarted!==false||
    !Array.isArray(data.items)||data.items.length!==items.length)
   throw Error('stream_manifest_untrusted');
  const mapped=new Map();
  for(const item of data.items){
   if(!['movie','episode'].includes(item?.kind)||
      typeof item.id!=='string'||!KNOWN.has(item.status)||
      item.physicalS3Checked!==false||
      typeof item.storedManifestVerified!=='boolean')
    throw Error('stream_manifest_item_untrusted');
   const key=item.kind+':'+item.id;
   if(mapped.has(key))throw Error('stream_manifest_duplicate');
   mapped.set(key,item);
  }
  const merged=items.map(item=>{
   const status=mapped.get(item.kind+':'+item.id);
   if(!status)throw Error('stream_manifest_missing');
   return {kind:item.kind,id:item.id,status:status.status,
    storedManifestVerified:status.storedManifestVerified,
    physicalS3Checked:false,
    expectedBytes:Number.isSafeInteger(status.expectedBytes)?
     status.expectedBytes:null,
    storedBytes:Number.isSafeInteger(status.storedBytes)?
     status.storedBytes:null};
  });
  return {ok:true,code:'stream_manifest_database_checked',items:merged,
   physicalS3Checked:false};
 }catch{return {ok:false,code:'stream_manifest_bridge_failed',
   items:items.map(x=>({...x,...unknown})),physicalS3Checked:false}}
}
