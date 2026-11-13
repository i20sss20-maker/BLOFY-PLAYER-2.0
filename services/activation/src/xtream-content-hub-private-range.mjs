import crypto from 'node:crypto';
const MAX_RANGE=8*1024*1024;
const MAX_FILE=64*1024*1024*1024;
const SAFE_TOKEN=/^[A-Za-z0-9_\-]{32,128}$/;

export function contentHubBridgeAuth(value,token){
 if(typeof token!=='string'||!SAFE_TOKEN.test(token)||
   typeof value!=='string'||!value.startsWith('Bearer '))return false;
 const left=Buffer.from(value.slice(7)),right=Buffer.from(token);
 return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
export function parseContentHubClientRange(header){
 const m=/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(
  String(header||'').trim());
 if(!m)return null;
 const from=Number(m[1]),to=Number(m[2]);
 if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||
   to<from||to-from+1>MAX_RANGE||to>=MAX_FILE)
  return null;
 return {from,to,length:to-from+1};
}
export function validContentHubResponse(response,requestRange){
 if(!response||response.status!==206||!requestRange)return null;
 const text=String(response.headers.get('content-range')||'').trim();
 const m=/^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/([1-9][0-9]*)$/.exec(text);
 if(!m)return null;
 const values=m.slice(1).map(Number);
 if(!values.every(Number.isSafeInteger)||
   values[0]!==requestRange.from||values[1]!==requestRange.to||
   values[2]<=requestRange.to||values[2]>MAX_FILE)return null;
 const len=response.headers.get('content-length');
 if(len!==null&&(Number(len)!==requestRange.length))return null;
 const etag=String(response.headers.get('etag')||'');
 const lm=String(response.headers.get('last-modified')||'');
 const validator=etag||lm;
 if(validator.length>140||/[\r\n]/.test(validator))return null;
 return {size:values[2],contentRange:text,validator,
   etag:etag.length<=140?etag:'',lastModified:lm.length<=140?lm:''};
}
export function approvedContentHubMedia(row,{allowSource='saleh'}={}){
 return Boolean(row&&row.server_enabled===true&&
   String(row.source_name||'').trim().toLowerCase()===allowSource&&
   Number(row.source_name_matches)===1&&
   typeof row.source_id==='string'&&
   /^[A-Za-z0-9._-]{1,128}$/.test(row.source_id)&&
   /^[a-f0-9-]{36}$/i.test(String(row.server_id||''))&&
   ['mp4','mkv','avi','ts'].includes(String(row.container_extension||'').toLowerCase()));
}
export const CONTENT_HUB_MAX_RANGE_BYTES=MAX_RANGE;
