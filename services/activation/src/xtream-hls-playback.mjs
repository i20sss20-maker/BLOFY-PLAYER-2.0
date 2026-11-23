// Authorized Xtream HLS playback. Provider segment/key URLs never reach
// subscribers: authenticated manifests contain short-lived encrypted tickets.
import crypto from 'node:crypto';

const TOKEN_LIFETIME_MS = 12 * 60 * 1000;
// A valid, reauthenticated session can rotate short-lived URLs for extended
// live playback, without leaving an old unbounded provider URL usable.
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_PLAYLIST_BYTES = 768 * 1024;
const MAX_DEPTH = 5;
const UUID = /^[0-9a-f-]{36}$/i;
const ID = /^[1-9][0-9]{0,15}$/;

function validatedKey(keyHex) {
  if (!/^[0-9a-f]{64}$/i.test(String(keyHex||''))) throw new Error('hls_gateway_key_unavailable');
  return Buffer.from(keyHex, 'hex');
}
function validateDestination(raw, base) {
  const url = new URL(String(raw).trim(), String(base));
  if (!['http:', 'https:'].includes(url.protocol) ||
      !url.hostname || url.username || url.password ||
      ['localhost','127.0.0.1','::1'].includes(url.hostname.toLowerCase()))
    throw new Error('hls_destination_denied');
  url.hash = '';
  return url.href;
}
export function sealXtreamHlsTicket({url,accountId,gatewayId,sourceId,depth=0,
  sessionStartedAt=now,now=Date.now(),keyHex}) {
  const key = validatedKey(keyHex);
  if (!UUID.test(String(accountId)) || !UUID.test(String(sourceId)) ||
      !ID.test(String(gatewayId)) || !Number.isSafeInteger(depth) ||
      depth<0 || depth>MAX_DEPTH || !Number.isSafeInteger(sessionStartedAt) ||
      sessionStartedAt>now+60000 || now-sessionStartedAt>SESSION_LIFETIME_MS)
    throw new Error('hls_ticket_invalid');
  const dest = validateDestination(url,url);
  const payload = JSON.stringify({
    u:dest,a:String(accountId),g:String(gatewayId),s:String(sourceId),
    d:depth,e:now+TOKEN_LIFETIME_MS,b:sessionStartedAt
  });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
  const ciphertext = Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');
}
export function unsealXtreamHlsTicket(token,{keyHex,now=Date.now(),forRenewal=false}={}) {
  const key = validatedKey(keyHex);
  if (!/^[A-Za-z0-9_-]{50,6000}$/.test(String(token||''))) return null;
  try {
    const binary = Buffer.from(token,'base64url');
    if (binary.length<45 || binary.length>4500) return null;
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,binary.subarray(0,12));
    decipher.setAuthTag(binary.subarray(12,28));
    const info=JSON.parse(Buffer.concat([
      decipher.update(binary.subarray(28)),decipher.final()
    ]).toString('utf8'));
    if (!UUID.test(String(info.a)) || !UUID.test(String(info.s)) ||
        !ID.test(String(info.g)) || !Number.isSafeInteger(info.d) ||
        info.d<0 || info.d>MAX_DEPTH ||
        !Number.isSafeInteger(info.e) ||
        (!forRenewal&&info.e<=now) ||
        info.e>now+TOKEN_LIFETIME_MS+60000 ||
        (forRenewal&&info.e<=now-SESSION_LIFETIME_MS-TOKEN_LIFETIME_MS) ||
        typeof info.u!=='string' || info.u.length>3000) return null;
    const originalStart=info.b??info.e-TOKEN_LIFETIME_MS;
    if(!Number.isSafeInteger(originalStart)||originalStart>now+60000||
       now-originalStart>SESSION_LIFETIME_MS)return null;
    info.b=originalStart;
    info.u=validateDestination(info.u,info.u);
    return info;
  }catch{return null}
}
// Only call AFTER reauthenticating the BLOFY account and verifying its
// current channel entitlement against the stored source. The old ticket
// must still have valid GCM authentication and be within the maximum
// session lifetime. This helper never returns provider URLs to the client.
export function refreshExpiredXtreamHlsTicket(ticket,{keyHex,now=Date.now()}={}){
 const info=unsealXtreamHlsTicket(ticket,{keyHex,now,forRenewal:true});
 if(!info||info.e>now)return null;
 const renewed=sealXtreamHlsTicket({
  url:info.u,accountId:info.a,gatewayId:info.g,sourceId:info.s,
  depth:info.d,sessionStartedAt:info.b,now,keyHex
 });
 return {ticket:renewed,accountId:info.a,gatewayId:info.g,sourceId:info.s};
}

export function rewriteXtreamHlsManifest({
  manifest,playlistUrl,publicOrigin,username,password,accountId,
  gatewayId,sourceId,depth=0,keyHex,now=Date.now(),sessionStartedAt=now
}) {
  const source=String(manifest||'');
  if(source.length>MAX_PLAYLIST_BYTES || !/^\s*#EXTM3U(?:\r?\n|$)/.test(source))
    throw new Error('hls_manifest_invalid');
  if(depth>=MAX_DEPTH)throw new Error('hls_manifest_depth_exceeded');
  const cleanOrigin=new URL(publicOrigin);
  if(cleanOrigin.protocol!=='https:' || cleanOrigin.username || cleanOrigin.password)
    throw new Error('hls_public_origin_invalid');
  const prefix=cleanOrigin.origin+'/hls/'+encodeURIComponent(username)+'/'+
    encodeURIComponent(password)+'/'+encodeURIComponent(String(gatewayId))+'/';
  const ticketFor=(uri)=>{
    const target=validateDestination(uri,playlistUrl);
    const ticket=sealXtreamHlsTicket({url:target,accountId,gatewayId,sourceId,
      depth:depth+1,keyHex,now,sessionStartedAt});
    return prefix+ticket;
  };
  let rewritten=0;
  const result=source.split(/\r?\n/).map(line=>{
    if (!line.trim()) return line;
    if(line.startsWith('#')) {
      // URI on key lines, variants, alternate audio and init maps.
      const replaced=line.replace(/\bURI="([^"]+)"/g,(_full,uri)=>{
        rewritten++;
        return 'URI="'+ticketFor(uri)+'"';
      });
      return replaced;
    }
    rewritten++;
    return ticketFor(line.trim());
  }).join('\n');
  if(rewritten===0)throw new Error('hls_manifest_empty');
  return result;
}
export async function readXtreamHlsManifest(reader,{firstChunk=null,maxBytes=MAX_PLAYLIST_BYTES}={}) {
  const chunks=[];
  let total=0;
  if(firstChunk?.byteLength) {total+=firstChunk.byteLength;chunks.push(Buffer.from(firstChunk))}
  while(true){
    if(total>maxBytes)throw new Error('hls_manifest_too_large');
    const next=await reader.read();
    if(next.done)break;
    total+=next.value?.byteLength||0;
    if(total>maxBytes)throw new Error('hls_manifest_too_large');
    if(next.value?.byteLength)chunks.push(Buffer.from(next.value));
  }
  return Buffer.concat(chunks,total).toString('utf8');
}
