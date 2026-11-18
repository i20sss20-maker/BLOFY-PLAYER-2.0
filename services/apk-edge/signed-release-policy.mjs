// Pin immutable, owner-signed artifacts. This stateless edge is a CANARY;
// no existing BLOFY download URL is redirected here without a later release gate.
export const SIGNED_APKS=Object.freeze([
  Object.freeze({
    name:'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk',
    size:135775044,
    sha256:'2f5abba6d367d41fd9bab71cb8355f234678a8d715c4bebff899760642bf474e'
  }),
  Object.freeze({
    name:'BLOFY-STREAM-56.0-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk',
    size:135783643,
    sha256:'bba9e340d50c95ab8ab9e1c42f96bef8f2d676dee888e975d7a161f2027d8064'
  })
]);
export function resolveSignedApk(pathname,pins=SIGNED_APKS){
  if(typeof pathname!=='string')return null;
  const prefix='/files/releases/';
  if(!pathname.startsWith(prefix))return null;
  const name=pathname.slice(prefix.length);
  if(!/^[a-z0-9][a-z0-9._-]{0,180}\.apk$/i.test(name))return null;
  return pins.find(x=>x.name===name)||null;
}
export function resolveRange(value,size){
  if(!Number.isSafeInteger(size)||size<1)throw Error('invalid_signed_apk_size');
  if(value===undefined||value===null||value==='')return {
    status:200,start:0,end:size-1,length:size,contentRange:null
  };
  if(typeof value!=='string'||value.length>100)return {status:416,contentRange:`bytes */${size}`};
  const m=/^bytes=([0-9]*)-([0-9]*)$/.exec(value.trim());
  if(!m||(!m[1]&&!m[2]))return {status:416,contentRange:`bytes */${size}`};
  let start=0,end=size-1;
  if(m[1]){
    start=Number(m[1]);
    if(m[2])end=Number(m[2]);
  }else{
    const suffix=Number(m[2]);
    if(!Number.isSafeInteger(suffix)||suffix<1)return {status:416,contentRange:`bytes */${size}`};
    start=Math.max(0,size-suffix);
  }
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
    start<0||start>=size||end<start)return {status:416,contentRange:`bytes */${size}`};
  end=Math.min(end,size-1);
  return {status:206,start,end,length:end-start+1,
    contentRange:`bytes ${start}-${end}/${size}`};
}
export const keyOf=pin=>'signed-apk/sha256/'+pin.sha256+'.apk';
