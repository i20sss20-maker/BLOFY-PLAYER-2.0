// Web local-storage profile partitions for BLOFY STREAM app bearer.
// Tokens are HMAC-signed and validated by the first-party activation server
// before /api/session is considered active. Never return token/account ID to
// browser; these are opaque, scoped 96-bit hex local-storage partitions.
import {createHmac} from 'node:crypto';
const TOKEN=/^v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/i;
function goodKey(key){return Buffer.isBuffer(key)&&key.length===32}
function opaque(key,namespace,input){
 return createHmac('sha256',key).update(namespace+'\0'+input).digest('hex').slice(0,24)
}
export function legacyTokenProfileKey(token,key){
 if(!goodKey(key)||typeof token!=='string'||!TOKEN.test(token))return null;
 return opaque(key,'BLOFY-WEB-PROFILE-V1',token)
}
export function stableAccountProfileKey(token,key){
 if(!goodKey(key)||typeof token!=='string')return null;
 const match=TOKEN.exec(token);
 if(!match)return null;
 // The account UUID stays the same across renewed/redeemed device-bound codes;
 // MAC contents and code hashes can change, but saved device preferences should
 // not silently disappear. The original bearer remains in an HttpOnly cookie.
 return opaque(key,'BLOFY-WEB-PROFILE-ACCOUNT-V2',match[1].toLowerCase())
}
