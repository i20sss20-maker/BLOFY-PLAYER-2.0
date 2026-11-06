// Small, explicitly authorized BLOFY Studio controls.
// Never fetch custom artwork from the server: HTTPS artwork is loaded by clients.
function bad(message) {
  return Object.assign(new Error(message), {status:400});
}

export function normalizeStudioName(value) {
  if(typeof value!=='string')throw bad('studio_name_invalid');
  const name=value.trim().replace(/[\u0000-\u001f\u007f]/g,' ');
  if(!name||name.length>72)throw bad('studio_name_invalid');
  return name;
}

export function normalizeStudioArtworkUrl(value) {
  if(value===null||value==='')return null;
  if(typeof value!=='string'||value.length>2048)throw bad('studio_icon_invalid');
  try {
    const url=new URL(value.trim());
    if(url.protocol!=='https:'||url.username||url.password||!url.hostname)throw Error('unsafe');
    return url.href;
  } catch {throw bad('studio_icon_invalid');}
}

export function normalizeStudioItemEdit(body,mediaType) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw bad('studio_item_invalid');
  const allowed=['displayName','iconUrl','featured','channelNumber'];
  const keys=Object.keys(body);
  if(!keys.length||keys.some(x=>!allowed.includes(x)))throw bad('studio_item_invalid');
  if(mediaType!=='live' && (keys.includes('featured')||keys.includes('channelNumber')))
    throw bad('studio_channel_only');
  const result={};
  if('displayName' in body) {
    if(body.displayName===null||body.displayName==='')result.customName=null;
    else {
      if(typeof body.displayName!=='string')throw bad('studio_name_invalid');
      const clean=body.displayName.trim().replace(/[\u0000-\u001f\u007f]/g,' ');
      if(clean.length>160||!clean)throw bad('studio_name_invalid');
      result.customName=clean;
    }
  }
  if('iconUrl' in body)result.customIconUrl=normalizeStudioArtworkUrl(body.iconUrl);
  if('featured' in body) {
    if(typeof body.featured!=='boolean')throw bad('studio_featured_invalid');
    result.featured=body.featured;
  }
  if('channelNumber' in body) {
    const raw=body.channelNumber;
    if(raw===null||raw==='')result.channelNumber=null;
    else if(typeof raw==='number'&&Number.isInteger(raw)&&raw>=1&&raw<=99999)result.channelNumber=raw;
    else throw bad('studio_channel_number_invalid');
  }
  return result;
}

export function validateStudioLogo(bytes,mime) {
  if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>1024*1024)
    throw Object.assign(new Error('studio_logo_size_invalid'),{status:413});
  const type=String(mime||'').split(';')[0].trim().toLowerCase();
  const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const webp=bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(!(type==='image/png'&&png||type==='image/jpeg'&&jpeg||type==='image/webp'&&webp))
    throw bad('studio_logo_type_invalid');
  return type;
}

export async function readStudioLogoRequest(req) {
  const limit=1024*1024;
  const chunks=[];
  let bytes=0;
  for await(const chunk of req) {
    const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    bytes+=buffer.length;
    if(bytes>limit)throw Object.assign(new Error('studio_logo_size_invalid'),{status:413});
    chunks.push(buffer);
  }
  const image=Buffer.concat(chunks,bytes);
  return {image,mime:validateStudioLogo(image,req.headers['content-type'])};
}
