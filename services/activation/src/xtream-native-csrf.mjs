// Session-bound CSRF proof for BLOFY's browser-native Xtream administration.
// Origin may be absent when a browser navigates through Railway's proxy.
// A token is minted only on authenticated admin GET responses and bound to
// the existing signed, revocable admin session cookie, not just a public host.
import crypto from 'node:crypto';

const COOKIE='blofy_admin_session';
function cookieFromRequest(req) {
  const line=String(req?.headers?.cookie||'');
  for(const entry of line.split(';')){
    const at=entry.indexOf('=');
    if(at>0&&entry.slice(0,at).trim()===COOKIE){
      const value=entry.slice(at+1).trim();
      return value.length<=2048?value:'';
    }
  }
  return '';
}

export function nativeXtreamCsrfToken(req, sessionKey) {
  const raw=cookieFromRequest(req);
  if(!raw||!sessionKey)return null;
  return crypto.createHmac('sha256',sessionKey)
    .update('blofy-xtream-native-form-v1\0').update(raw)
    .digest('base64url');
}

export function verifyNativeXtreamCsrf(req, sessionKey, provided) {
  if(typeof provided!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(provided))
    return false;
  const expected=nativeXtreamCsrfToken(req,sessionKey);
  if(!expected)return false;
  const left=Buffer.from(provided,'utf8'),right=Buffer.from(expected,'utf8');
  return left.length===right.length && crypto.timingSafeEqual(left,right);
}

export function nativeXtreamActionUrl(path, token) {
  return String(path) + (token?'?csrf='+encodeURIComponent(token):'');
}
