// BLOFY CONTENT HUB private VOD mirror gate.
// Permission to redistribute a stream is NOT permission to persist copies.
// A real upload is impossible unless BOTH explicit operator controls and an
// individual authorized movie/episode are present. Never assume a source
// account's isRestreamer flag grants permanent storage rights.
export const MIN_PART_BYTES=8*1024*1024;
export const MAX_MOVIE_BYTES=64*1024*1024*1024;
const ID=/^[a-zA-Z0-9_-]{1,128}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EXT=new Set(['mp4','mkv','ts','avi','mov']);
const KIND=new Set(['movie','episode']);

export function authorizeMirrorJob({env={},sourceName,sourceId,mediaKind,
  mediaId,extension,privateObjectName,expectedBytes,licenseEvidence,privateBucket,
  activeUpstreamFeeds=0}={}){
 const errors=[];
 if(env.BLOFY_CONTENT_HUB_UPLOAD_ENABLED!=='1')
  errors.push('upload_feature_disabled');
 if(env.BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED!=='1')
  errors.push('storage_rights_not_confirmed');
 if(licenseEvidence?.storagePermitted!==true||
   licenseEvidence?.scope!=='saleh-vod-persistent-copy')
  errors.push('individual_storage_license_missing');
 if(String(sourceName||'').trim().toLowerCase()!=='saleh'||!UUID.test(String(sourceId||'')))
  errors.push('source_not_saleh');
 if(!KIND.has(mediaKind)||!ID.test(String(mediaId||''))||
   !EXT.has(String(extension||'').toLowerCase()))
  errors.push('media_item_invalid');
 if(privateObjectName!==undefined&&!ID.test(String(privateObjectName)))
  errors.push('private_object_name_invalid');
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<8192||
   expectedBytes>MAX_MOVIE_BYTES)
  errors.push('file_size_unverified_or_excessive');
 if(privateBucket?.private!==true||privateBucket?.configured!==true)
  errors.push('private_object_storage_unavailable');
 if(!Number.isInteger(activeUpstreamFeeds)||activeUpstreamFeeds!==0)
  errors.push('source_connection_in_use');
 if(errors.length)return {allowed:false,codes:errors,customerCutover:false};
 const objectKey=`saleh/${mediaKind}/${sourceId}/${privateObjectName||mediaId}.${extension.toLowerCase()}`;
 return {allowed:true,objectKey,expectedBytes,sourceName:'saleh',
  upstreamConnectionBudget:1,customerCutover:false,
  requiresIndependentFileVerification:true};
}
export function rangeParts(totalBytes,{partBytes=MIN_PART_BYTES}={}){
 if(!Number.isSafeInteger(totalBytes)||totalBytes<8192||
   totalBytes>MAX_MOVIE_BYTES)throw Error('content_hub_invalid_size');
 if(!Number.isInteger(partBytes)||partBytes<MIN_PART_BYTES||
   partBytes>64*1024*1024)throw Error('content_hub_invalid_part_size');
 const total=Math.ceil(totalBytes/partBytes);
 if(total>10000)throw Error('content_hub_too_many_parts');
 return Array.from({length:total},(_,idx)=>({
  partNumber:idx+1,from:idx*partBytes,
  to:Math.min((idx+1)*partBytes,totalBytes)-1
 }));
}
export function parseMirrorContentRange(header,{from,to,expectedBytes}={}){
 const m=/^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/([1-9][0-9]*)$/.exec(
   String(header||'').trim());
 if(!m)return false;
 const numbers=m.slice(1).map(Number);
 return numbers.every(Number.isSafeInteger)&&
   numbers[0]===from&&numbers[1]===to&&numbers[2]===expectedBytes;
}
