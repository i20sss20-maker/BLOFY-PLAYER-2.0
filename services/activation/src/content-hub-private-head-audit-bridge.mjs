// Owner-only private fixed Portal -> Content Hub HEAD inventory check.
// Never send object keys, S3 secrets, arbitrary URLs, or source media bytes.
const HUB='http://blofy-content-hub.railway.internal:3000/internal/mirror/physical-head-audit';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MOVIE=/^[A-Za-z0-9._:-]{1,128}$/;
const EPISODE=/^[1-9][0-9]{0,9}$/;
const STATES=new Set(['present_size_match','missing','size_mismatch',
 'head_unavailable','head_invalid_length']);
export async function forwardStreamS3HeadAudit({
 sourceId,kind,id,start=0,hubToken='',fetchImpl=fetch
}={}){
 if(!UUID.test(String(sourceId||''))||
   !['movie','episode'].includes(kind)||
   !(kind==='movie'?MOVIE:EPISODE).test(String(id||''))||
   !Number.isSafeInteger(start)||start<0||start>504||start%8!==0)
  return {ok:false,code:'stream_head_selection_invalid'};
 if(typeof hubToken!=='string'||hubToken.length<32)
  return {ok:false,code:'stream_head_bridge_not_configured'};
 try{
  const r=await fetchImpl(HUB,{method:'POST',
   redirect:'manual',signal:AbortSignal.timeout(12000),
   headers:{authorization:'Bearer '+hubToken,
    'content-type':'application/json',
    'x-blofy-owner-action':'private-verified-s3-head-audit',
    accept:'application/json'},
   body:JSON.stringify({sourceId,kind,id,start})});
  if(r.status===429)return {ok:false,code:'stream_head_audit_busy'};
  if(r.status===404)return {ok:false,code:'stream_head_audit_disabled'};
  if(r.status!==200)return {ok:false,code:'stream_head_audit_unavailable'};
  if(Number(r.headers.get('content-length')||0)>6500)
   throw Error('stream_head_large');
  const raw=await r.text();
  if(Buffer.byteLength(raw)>6500)throw Error('stream_head_large');
  const data=JSON.parse(raw);
  if(data?.ok!==true||data.sourceId!==sourceId||
    data.kind!==kind||data.id!==id||
    data.partStart!==start||
    data.currentPhysicalS3ProofType!=='HEAD_object_size_only'||
    data.contentSha256Recomputed!==false||
    data.mediaBytesTransferred!==0||data.providerRequests!==0||
    data.automaticCopyStarted!==false||data.customerCutover!==false||
    !/^[a-f0-9]{64}$/.test(String(data.manifestSha256||''))||
    !Number.isSafeInteger(data.originalFileBytes)||
    data.originalFileBytes<8192||
    !Number.isInteger(data.totalParts)||data.totalParts<1||
    data.totalParts>512||!Array.isArray(data.checks)||
    !Number.isInteger(data.partsChecked)||data.partsChecked<1||
    data.partsChecked>8||data.partsChecked!==data.checks.length||
    data.partStart+data.partsChecked>data.totalParts||
    !Number.isInteger(data.matchedParts)||
    !Number.isInteger(data.failures)||
    data.matchedParts+data.failures!==data.partsChecked||
    data.nextPartStart!==null&&(
      !Number.isInteger(data.nextPartStart)||
      data.nextPartStart!==start+8||
      data.nextPartStart>504))
   throw Error('stream_head_proof_invalid');
  const checked=new Set();
  for(const entry of data.checks){
   if(!Number.isInteger(entry?.partNumber)||
      entry.partNumber<=start||
      entry.partNumber>start+8||checked.has(entry.partNumber)||
      !STATES.has(entry.status)||
      typeof entry.sizeMatched!=='boolean'||
      entry.sizeMatched!==(entry.status==='present_size_match'))
    throw Error('stream_head_check_invalid');
   checked.add(entry.partNumber);
  }
  // Never echo any S3 keys, internal run IDs or source credentials.
  return {ok:true,code:data.code,kind,id,
   partStart:start,totalParts:data.totalParts,
   checkedParts:data.partsChecked,matchedParts:data.matchedParts,
   failures:data.failures,
   checks:data.checks.map(c=>({partNumber:c.partNumber,
     status:c.status,sizeMatched:c.sizeMatched})),
   manifestSha256:data.manifestSha256,
   nextPartStart:data.nextPartStart,
   entireFileHeadCheckedInThisRequest:
     data.entireFileHeadCheckedInThisRequest===true,
   contentSha256Recomputed:false,physicalProof:'HEAD_object_size_only',
   mediaBytesTransferred:0,providerRequests:0,customerCutover:false};
 }catch{return {ok:false,code:'stream_head_bridge_failed'}}
}
